import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { mapAttachment } from './attachments.repository';
import type { PostStatus, PostWrite } from './types/posts.types';

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

  isGlobalAdmin(user?: AuthenticatedUser) {
    return user?.role === 'administrador';
  }

  async create(data: PostWrite) {
    return mapPost(
      await this.prisma.publicacion.create({
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
    const row = await this.prisma.publicacion.findUnique({
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
    const rows = await this.prisma.publicacion.findMany({
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
    const ids = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
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
    const rows = await this.prisma.publicacion.findMany({
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
    const result = await this.prisma.publicacion.updateMany({
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
    await this.prisma.publicacion.updateMany({
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
      (await this.prisma.categoria.count({
        where: { id_categoria: categoryId },
      })) > 0
    );
  }

  async findGroupMembership(groupId: bigint, userId: bigint) {
    const row = await this.prisma.miembroGrupo.findUnique({
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
