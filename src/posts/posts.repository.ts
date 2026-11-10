import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mapAttachment } from './mappers/attachment';
import type { PostStatus, PostWrite } from './types/posts.types';
import type { OperationInput } from './types/post-operation';
import {
  lockGroup,
  lockPostHierarchy,
  type ContentLock,
} from '../common/database/content-locks';

const databaseStatuses = {
  visible: 'visible',
  retained: 'retenido',
  deleted: 'eliminado',
} as const;
const domainStatuses = {
  visible: 'visible',
  retenido: 'retained',
  eliminado: 'deleted',
} as const;
const include = {
  autor: {
    select: { id_usuario: true, nombre: true, apellido: true, foto_url: true },
  },
  categoria: true,
  grupo: { select: { id_grupo: true, nombre: true } },
  adjuntos: { orderBy: { orden: 'asc' as const } },
  _count: {
    select: { comentarios: { where: { estado: 'visible' as const } } },
  },
} satisfies Prisma.PublicacionInclude;
type PostRow = Prisma.PublicacionGetPayload<{ include: typeof include }>;
function mapPost(row: PostRow) {
  return {
    id: row.id_publicacion,
    authorId: row.id_autor,
    categoryId: row.id_categoria,
    groupId: row.id_grupo,
    title: row.titulo,
    content: row.contenido,
    status: domainStatuses[row.estado],
    version: row.version,
    createdAt: row.fecha_creacion,
    updatedAt: row.fecha_edicion,
    author: {
      id: row.autor.id_usuario,
      firstName: row.autor.nombre,
      lastName: row.autor.apellido,
      photoUrl: row.autor.foto_url,
    },
    category: {
      id: row.categoria.id_categoria,
      name: row.categoria.nombre,
      description: row.categoria.descripcion,
    },
    group: row.grupo
      ? { id: row.grupo.id_grupo, name: row.grupo.nombre }
      : null,
    attachments: row.adjuntos.map(mapAttachment),
    commentCount: row._count.comentarios,
  };
}
export type PostDetail = ReturnType<typeof mapPost>;

@Injectable()
export class PostsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private transaction?: Prisma.TransactionClient;
  private get db() {
    return this.transaction ?? this.prisma;
  }

  inTransaction(tx: Prisma.TransactionClient) {
    const scoped = new PostsRepository(this.prisma);
    scoped.transaction = tx;
    return scoped;
  }

  private withTransaction<T>(
    work: (
      repository: PostsRepository,
      tx: Prisma.TransactionClient,
    ) => Promise<T>,
  ) {
    if (this.transaction) return work(this, this.transaction);
    return this.prisma.$transaction((tx) => work(this.inTransaction(tx), tx), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5000,
      timeout: 10000,
    });
  }

  withGroupLock<T>(
    groupId: bigint | null,
    work: (repository: PostsRepository) => Promise<T>,
    mode: ContentLock = 'write',
  ) {
    return this.withTransaction(async (repository, tx) => {
      if (groupId !== null) await lockGroup(tx, groupId, mode);
      return work(repository);
    });
  }

  withPostLock<T>(
    postId: bigint,
    work: (repository: PostsRepository) => Promise<T>,
    mode: ContentLock = 'write',
  ) {
    return this.withTransaction(async (repository, tx) => {
      await lockPostHierarchy(tx, postId, mode);
      return work(repository);
    });
  }

  async findOperation(userId: bigint, key: string) {
    const row = await this.db.operacionPublicacion.findUnique({
      where: { id_usuario_clave: { id_usuario: userId, clave: key } },
      select: {
        clave: true,
        metodo: true,
        id_publicacion: true,
        version: true,
      },
    });
    return row
      ? {
          status: 'confirmed' as const,
          key: row.clave,
          method: row.metodo,
          postId: row.id_publicacion.toString(),
          version: row.version,
        }
      : { status: 'unknown' as const };
  }

  async executeOperation(
    operation: OperationInput,
    write: (
      repository: PostsRepository,
    ) => Promise<{ id: bigint; version: number }>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        // Serializes the same actor/key even before a receipt exists. Hash collisions
        // only serialize unrelated work; the exact composite key still selects data.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${operation.userId}:${operation.key}`}, 0))::text`;
        const previous = await tx.operacionPublicacion.findUnique({
          where: {
            id_usuario_clave: {
              id_usuario: operation.userId,
              clave: operation.key,
            },
          },
        });
        if (
          previous &&
          (previous.huella !== operation.fingerprint ||
            previous.metodo !== operation.method)
        ) {
          throw new ConflictException({
            error: 'OperationKeyConflict',
            message: 'This operation key was used with a different request',
          });
        }
        const repository = this.inTransaction(tx);
        if (!previous) {
          const result = await write(repository);
          await tx.operacionPublicacion.create({
            data: {
              id_usuario: operation.userId,
              clave: operation.key,
              metodo: operation.method,
              huella: operation.fingerprint,
              id_publicacion: result.id,
              version: result.version,
            },
          });
        }
        return repository.findOperation(operation.userId, operation.key);
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }

  async create(data: PostWrite) {
    return mapPost(
      await this.db.publicacion.create({
        data: {
          id_autor: data.authorId,
          id_categoria: data.categoryId,
          id_grupo: data.groupId,
          titulo: data.title,
          contenido: data.content,
          estado: databaseStatuses[data.status],
        },
        include,
      }),
    );
  }

  async findById(postId: bigint) {
    const row = await this.db.publicacion.findUnique({
      where: { id_publicacion: postId },
      include,
    });
    return row ? mapPost(row) : null;
  }

  findPublicFeedCursor(filters: {
    categoryId?: bigint;
    cursor?: bigint;
    limit: number;
  }) {
    return this.feed(
      { id_grupo: null, id_categoria: filters.categoryId, estado: 'visible' },
      filters.cursor,
      filters.limit,
    );
  }

  findGroupFeedCursor(
    groupId: bigint,
    cursor?: bigint,
    limit = 20,
    categoryId?: bigint,
  ) {
    return this.feed(
      { id_grupo: groupId, estado: 'visible', id_categoria: categoryId },
      cursor,
      limit,
    );
  }

  private async feed(
    where: Prisma.PublicacionWhereInput,
    cursor: bigint | undefined,
    limit: number,
  ) {
    const rows = await this.db.publicacion.findMany({
      where,
      include,
      orderBy: [{ fecha_creacion: 'desc' }, { id_publicacion: 'desc' }],
      ...(cursor ? { cursor: { id_publicacion: cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    return rows.map(mapPost);
  }

  async searchFullText(
    q: string,
    categoryId?: bigint,
    cursor?: bigint,
    limit = 20,
  ) {
    const ids = await this.db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
      SELECT p.id_publicacion AS id FROM publicacion p
      WHERE p.busqueda @@ plainto_tsquery('spanish', ${q})
        AND p.id_grupo IS NULL AND p.estado = 'visible'
        ${categoryId === undefined ? Prisma.empty : Prisma.sql`AND p.id_categoria = ${categoryId}`}
        ${
          cursor === undefined
            ? Prisma.empty
            : Prisma.sql`AND (p.fecha_creacion, p.id_publicacion) <
          (SELECT fecha_creacion, id_publicacion FROM publicacion WHERE id_publicacion = ${cursor})`
        }
      ORDER BY p.fecha_creacion DESC, p.id_publicacion DESC LIMIT ${limit + 1}`);
    if (!ids.length) return [];
    const rows = await this.db.publicacion.findMany({
      where: {
        id_publicacion: { in: ids.map(({ id }) => id) },
        id_grupo: null,
        estado: 'visible',
      },
      include,
      orderBy: [{ fecha_creacion: 'desc' }, { id_publicacion: 'desc' }],
    });
    return rows.map(mapPost);
  }

  async updateWithOptimisticLock(
    postId: bigint,
    currentVersion: number,
    data: {
      title?: string;
      content?: string;
      categoryId?: bigint;
      status: Exclude<PostStatus, 'deleted'>;
    },
  ) {
    const result = await this.db.publicacion.updateMany({
      where: {
        id_publicacion: postId,
        version: currentVersion,
        estado: { not: 'eliminado' },
      },
      data: {
        titulo: data.title,
        contenido: data.content,
        id_categoria: data.categoryId,
        estado: databaseStatuses[data.status],
        version: { increment: 1 },
        fecha_edicion: new Date(),
      },
    });
    return result.count;
  }

  async changeStatus(postId: bigint, status: PostStatus) {
    await this.db.publicacion.updateMany({
      where: { id_publicacion: postId, estado: { not: 'eliminado' } },
      data: {
        estado: databaseStatuses[status],
        version: { increment: 1 },
        fecha_edicion: new Date(),
      },
    });
  }

  async categoryExists(categoryId: bigint) {
    return (
      (await this.db.categoria.count({
        where: { id_categoria: categoryId },
      })) > 0
    );
  }

  async findGroupMembership(groupId: bigint, userId: bigint) {
    const row = await this.db.miembroGrupo.findUnique({
      where: { id_grupo_id_usuario: { id_grupo: groupId, id_usuario: userId } },
    });
    const roles = {
      miembro: 'member',
      moderador: 'moderator',
      administrador: 'administrator',
    } as const;
    return row
      ? { groupId: row.id_grupo, userId: row.id_usuario, role: roles[row.rol] }
      : null;
  }
}
