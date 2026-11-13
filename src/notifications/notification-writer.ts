import type { Prisma, TipoNotificacion } from '@prisma/client';
export const notificationMessages: Record<TipoNotificacion, string> = {
  comentario: 'There is a new comment on your post.',
  respuesta: 'There is a reply to your comment.',
  publicacion_grupo: 'There is a new post in one of your groups.',
  resultado_reporte: 'One of your reports was resolved.',
  contenido_retirado: 'Content you published was removed.',
  nuevo_reporte: 'There is a report awaiting review.',
};
export async function notify(
  tx: Prisma.TransactionClient,
  type: TipoNotificacion,
  targets: bigint[],
  actor: bigint,
  reference: { postId?: bigint; commentId?: bigint; reportId?: bigint },
) {
  const ids = [...new Set(targets)].filter((id) => id !== actor);
  if (!ids.length) return;
  await tx.notificacion.createMany({
    data: ids.map((id) => ({
      id_destinatario: id,
      tipo: type,
      mensaje: notificationMessages[type],
      id_publicacion: reference.postId,
      id_comentario: reference.commentId,
      id_reporte: reference.reportId,
    })),
  });
}
