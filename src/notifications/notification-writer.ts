import type { Prisma, TipoNotificacion } from '@prisma/client';
export const notificationMessages: Record<TipoNotificacion, string> = {
  comentario: 'Hay un nuevo comentario en tu publicación.',
  respuesta: 'Hay una respuesta a tu comentario.',
  publicacion_grupo: 'Hay una nueva publicación en uno de tus grupos.',
  resultado_reporte: 'Se resolvió uno de tus reportes.',
  contenido_retirado: 'Se retiró contenido que publicaste.',
  nuevo_reporte: 'Hay un reporte pendiente de revisión.',
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
