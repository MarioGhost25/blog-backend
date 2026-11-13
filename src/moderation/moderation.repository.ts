import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { lockPostHierarchy } from '../common/database/content-locks';
import { notify } from '../notifications/notification-writer';
import { suspendAccount } from '../auth/account-suspension';
const postSelect = {
  id_publicacion: true,
  id_autor: true,
  id_grupo: true,
  titulo: true,
  contenido: true,
  estado: true,
  version: true,
} as const;
const reportInclude = {
  publicacion: { select: postSelect },
  comentario: { include: { publicacion: { select: postSelect } } },
} satisfies Prisma.ReporteInclude;
export function moderationScope(
  user: AuthenticatedUser,
  groupId?: bigint,
): Prisma.PublicacionWhereInput {
  return {
    ...(groupId ? { id_grupo: groupId } : {}),
    ...(user.role === 'administrador'
      ? {}
      : {
          grupo: {
            miembros: {
              some: {
                id_usuario: user.id,
                rol: { in: ['moderador', 'administrador'] },
              },
            },
          },
        }),
  };
}
@Injectable()
export class ModerationRepository {
  private tx?: Prisma.TransactionClient;
  constructor(private readonly prisma: PrismaService) {}
  private get db() {
    return this.tx ?? this.prisma;
  }
  withPost<T>(
    postId: bigint,
    work: (repository: ModerationRepository) => Promise<T>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockPostHierarchy(tx, postId, 'write', true);
        const scoped = new ModerationRepository(this.prisma);
        scoped.tx = tx;
        return work(scoped);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }
  post(id: bigint) {
    return this.db.publicacion.findUnique({
      where: { id_publicacion: id },
      select: postSelect,
    });
  }
  comment(id: bigint) {
    return this.db.comentario.findUnique({ where: { id_comentario: id } });
  }
  report(id: bigint) {
    return this.db.reporte.findUnique({
      where: { id_reporte: id },
      include: reportInclude,
    });
  }
  membership(groupId: bigint, userId: bigint) {
    return this.db.miembroGrupo.findUnique({
      where: { id_grupo_id_usuario: { id_grupo: groupId, id_usuario: userId } },
    });
  }
  async createReport(
    actor: bigint,
    reason: string,
    postId: bigint,
    commentId?: bigint,
  ) {
    const tx = this.tx!;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`report-budget:${actor}`},0))::text`;
    if (
      (await tx.reporte.count({
        where: {
          id_reportante: actor,
          fecha_creacion: { gt: new Date(Date.now() - 3600000) },
        },
      })) >= 10
    )
      throw new HttpException(
        { error: 'RateLimited', message: 'Report limit reached' },
        429,
      );
    const row = await tx.reporte.create({
      data: {
        id_reportante: actor,
        motivo: reason,
        ...(commentId
          ? { id_comentario: commentId }
          : { id_publicacion: postId }),
      },
    });
    const post = await this.post(postId);
    const globals = await tx.usuario.findMany({
      where: { rol: 'administrador', estado: 'activo' },
      select: { id_usuario: true },
    });
    const locals = post?.id_grupo
      ? await tx.miembroGrupo.findMany({
          where: {
            id_grupo: post.id_grupo,
            rol: { in: ['moderador', 'administrador'] },
            usuario: { estado: 'activo' },
          },
          select: { id_usuario: true },
        })
      : [];
    await notify(
      tx,
      'nuevo_reporte',
      [...globals, ...locals].map((u) => u.id_usuario),
      actor,
      { reportId: row.id_reporte },
    );
    return { id: row.id_reporte, status: row.estado };
  }
  reports(
    user: AuthenticatedUser,
    groupId?: bigint,
    cursor?: bigint,
    status = 'pendiente',
    type?: string,
  ) {
    const scope = moderationScope(user, groupId);
    return this.db.reporte.findMany({
      where: {
        estado: status as 'pendiente',
        ...(cursor ? { id_reporte: { lt: cursor } } : {}),
        OR: [
          ...(type !== 'comment' ? [{ publicacion: scope }] : []),
          ...(type !== 'post' ? [{ comentario: { publicacion: scope } }] : []),
        ],
      },
      include: reportInclude,
      orderBy: { id_reporte: 'desc' },
      take: 21,
    });
  }
  retainedPosts(user: AuthenticatedUser, groupId?: bigint, cursor?: bigint) {
    return this.db.publicacion.findMany({
      where: {
        ...moderationScope(user, groupId),
        estado: 'retenido',
        ...(cursor ? { id_publicacion: { lt: cursor } } : {}),
      },
      select: postSelect,
      orderBy: { id_publicacion: 'desc' },
      take: 21,
    });
  }
  retainedComments(user: AuthenticatedUser, groupId?: bigint, cursor?: bigint) {
    return this.db.comentario.findMany({
      where: {
        publicacion: {
          ...moderationScope(user, groupId),
          estado: { not: 'eliminado' },
        },
        estado: 'retenido',
        ...(cursor ? { id_comentario: { lt: cursor } } : {}),
      },
      include: { publicacion: { select: postSelect } },
      orderBy: { id_comentario: 'desc' },
      take: 21,
    });
  }
  async decide(
    type: 'post' | 'comment',
    id: bigint,
    author: bigint,
    actor: bigint,
    decision: 'publish' | 'remove',
    observation?: string,
  ) {
    const tx = this.tx!;
    if (type === 'post')
      await tx.publicacion.update({
        where: { id_publicacion: id },
        data: {
          estado: decision === 'publish' ? 'visible' : 'eliminado',
          version: { increment: 1 },
          fecha_edicion: new Date(),
        },
      });
    else
      await tx.comentario.update({
        where: { id_comentario: id },
        data: { estado: decision === 'publish' ? 'visible' : 'eliminado' },
      });
    await tx.revisionContenido.create({
      data: {
        tipo: type,
        id_contenido: id,
        id_actor: actor,
        decision,
        observacion: observation,
      },
    });
    if (decision === 'remove')
      await notify(
        tx,
        'contenido_retirado',
        [author],
        actor,
        type === 'post' ? { postId: id } : { commentId: id },
      );
    else if (type === 'post') {
      const post = await this.post(id);
      if (post?.id_grupo) {
        const members = await tx.miembroGrupo.findMany({
          where: { id_grupo: post.id_grupo },
          select: { id_usuario: true },
        });
        await notify(
          tx,
          'publicacion_grupo',
          members.map((m) => m.id_usuario),
          author,
          { postId: id },
        );
      }
    } else {
      const comment = await this.comment(id);
      const post = await this.post(comment!.id_publicacion);
      const parent = comment!.id_comentario_padre
        ? await this.comment(comment!.id_comentario_padre)
        : null;
      if (parent)
        await notify(tx, 'respuesta', [parent.id_autor], author, {
          commentId: id,
        });
      if (post!.id_autor !== parent?.id_autor)
        await notify(tx, 'comentario', [post!.id_autor], author, {
          commentId: id,
        });
    }
  }
  async resolve(
    id: bigint,
    actor: bigint,
    reporter: bigint,
    decision: 'desestimado' | 'contenido_retirado' | 'usuario_suspendido',
    observation: string,
  ) {
    await this.tx!.reporte.update({
      where: { id_reporte: id },
      data: {
        estado: decision,
        observacion: observation,
        id_moderador: actor,
        fecha_resolucion: new Date(),
      },
    });
    await notify(this.tx!, 'resultado_reporte', [reporter], actor, {
      reportId: id,
    });
  }
  async suspend(id: bigint, actor: bigint, days: number, reason: string) {
    if (!this.tx) throw new Error('Suspension requires a transaction');
    await suspendAccount(this.tx, id, actor, days, reason);
  }
}
