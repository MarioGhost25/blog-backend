import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PostsRepository } from '../posts/posts.repository';
import {
  lockPostHierarchy,
  type ContentLock,
} from '../common/database/content-locks';
import { notify } from '../notifications/notification-writer';
const author = {
  select: { id_usuario: true, nombre: true, apellido: true },
} as const;
const include = {
  autor: author,
  comentario_padre: {
    select: { id_comentario: true, estado: true, contenido: true },
  },
} satisfies Prisma.ComentarioInclude;
type Row = Prisma.ComentarioGetPayload<{ include: typeof include }>;
export function commentDto(row: Row) {
  return {
    id: row.id_comentario,
    postId: row.id_publicacion,
    author: {
      id: row.autor.id_usuario,
      firstName: row.autor.nombre,
      lastName: row.autor.apellido,
    },
    content: row.estado === 'eliminado' ? null : row.contenido,
    status: (
      {
        visible: 'visible',
        retenido: 'retained',
        eliminado: 'deleted',
      } as const
    )[row.estado],
    createdAt: row.fecha_creacion,
    parent: row.comentario_padre
      ? {
          id: row.comentario_padre.id_comentario,
          content:
            row.comentario_padre.estado === 'visible'
              ? row.comentario_padre.contenido
              : null,
        }
      : null,
  };
}
@Injectable()
export class CommentsRepository {
  private tx?: Prisma.TransactionClient;
  constructor(private readonly prisma: PrismaService) {}
  private get db() {
    return this.tx ?? this.prisma;
  }
  withPost<T>(
    id: bigint,
    work: (
      repository: CommentsRepository,
      posts: PostsRepository,
    ) => Promise<T>,
    mode: ContentLock = 'write',
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockPostHierarchy(tx, id, mode);
        const repository = new CommentsRepository(this.prisma);
        repository.tx = tx;
        return work(
          repository,
          new PostsRepository(this.prisma).inTransaction(tx),
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
  find(id: bigint) {
    return this.db.comentario.findUnique({
      where: { id_comentario: id },
      include,
    });
  }
  async page(
    postId: bigint,
    userId: bigint | undefined,
    cursor: bigint | undefined,
    limit: number,
  ) {
    const rows = await this.db.comentario.findMany({
      where: {
        id_publicacion: postId,
        OR: [
          { estado: 'visible' },
          ...(userId
            ? [{ estado: 'retenido' as const, id_autor: userId }]
            : []),
          { estado: 'eliminado', respuestas: { some: { estado: 'visible' } } },
        ],
      },
      include,
      orderBy: [{ fecha_creacion: 'desc' }, { id_comentario: 'desc' }],
      ...(cursor ? { cursor: { id_comentario: cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit).map(commentDto),
      nextCursor:
        rows.length > limit ? rows[limit - 1].id_comentario.toString() : null,
    };
  }
  async create(
    postId: bigint,
    authorId: bigint,
    content: string,
    retained: boolean,
    parentId: bigint | undefined,
    postAuthorId: bigint,
    parentAuthorId?: bigint,
  ) {
    if (!this.tx) throw new Error('Comment write requires a parent lock');
    const row = await this.tx.comentario.create({
      data: {
        id_publicacion: postId,
        id_autor: authorId,
        contenido: content,
        estado: retained ? 'retenido' : 'visible',
        id_comentario_padre: parentId,
      },
      include,
    });
    if (!retained) {
      if (parentAuthorId)
        await notify(this.tx, 'respuesta', [parentAuthorId], authorId, {
          commentId: row.id_comentario,
        });
      if (postAuthorId !== parentAuthorId)
        await notify(this.tx, 'comentario', [postAuthorId], authorId, {
          commentId: row.id_comentario,
        });
    }
    return commentDto(row);
  }
  async remove(
    id: bigint,
    actor: bigint,
    authorId: bigint,
    observation?: string,
  ) {
    if (!this.tx) throw new Error('Comment write requires a parent lock');
    await this.tx.comentario.update({
      where: { id_comentario: id },
      data: { estado: 'eliminado' },
    });
    if (actor !== authorId)
      await this.tx.revisionContenido.create({
        data: {
          tipo: 'comment',
          id_contenido: id,
          id_actor: actor,
          decision: 'remove',
          observacion: observation,
        },
      });
    if (actor !== authorId)
      await notify(this.tx, 'contenido_retirado', [authorId], actor, {
        commentId: id,
      });
  }
}
