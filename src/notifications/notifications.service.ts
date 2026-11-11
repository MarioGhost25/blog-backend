import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { PostsService } from '../posts/posts.service';
import { NotificationsRepository } from './notifications.repository';
import { notificationMessages } from './notification-writer';
@Injectable()
export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly posts: PostsService,
  ) {}
  count(user: AuthenticatedUser) {
    return this.repository.count(user.id);
  }
  async list(user: AuthenticatedUser, cursor?: bigint, unread = false) {
    const rows = await this.repository.list(user.id, cursor, unread);
    const items = await Promise.all(
      rows.slice(0, 20).map(async (row) => {
        let href: string | null = null;
        let message = notificationMessages[row.tipo];
        if (
          row.tipo === 'resultado_reporte' &&
          row.reporte?.id_reportante === user.id
        ) {
          const outcomes = {
            pendiente: 'Tu reporte está pendiente de revisión.',
            desestimado: 'Tu reporte fue revisado y desestimado.',
            contenido_retirado: 'Se retiró el contenido de tu reporte.',
            usuario_suspendido:
              'Se retiró el contenido de tu reporte y se suspendió a su autor.',
          };
          message = outcomes[row.reporte.estado];
        }
        if (row.tipo === 'nuevo_reporte' && row.reporte) {
          const groupId =
            row.reporte.publicacion?.id_grupo ??
            row.reporte.comentario?.publicacion.id_grupo;
          if (user.role === 'administrador') href = '/moderacion';
          else if (
            groupId &&
            (await this.repository.canModerateGroup(user.id, groupId))
          )
            href = `/grupos/${groupId}/moderacion`;
        }
        const postId =
          row.publicacion?.id_publicacion ?? row.comentario?.id_publicacion;
        if (postId && (!row.comentario || row.comentario.estado === 'visible'))
          try {
            await this.posts.findOne(postId, user);
            href = `/publicaciones/${postId}`;
          } catch {
            /* A neutral persisted notice never discloses revoked content. */
          }
        return {
          id: row.id_notificacion,
          type: row.tipo,
          message,
          href,
          createdAt: row.fecha_creacion,
          readAt: row.fecha_lectura,
        };
      }),
    );
    return {
      items,
      nextCursor: rows.length > 20 ? rows[19].id_notificacion.toString() : null,
      unreadCount: await this.count(user),
    };
  }
  async read(user: AuthenticatedUser, id: bigint) {
    if (!(await this.repository.read(user.id, id)).count)
      throw new NotFoundException();
  }
  async readThrough(user: AuthenticatedUser, id: bigint) {
    await this.repository.readThrough(user.id, id);
  }
}
