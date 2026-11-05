import { EstadoContenido } from '@prisma/client';

export enum PostStatus {
  visible = 'visible',
  held = 'held',
  deleted = 'deleted',
}

export const databasePostStatus: Record<PostStatus, EstadoContenido> = {
  visible: EstadoContenido.visible,
  held: EstadoContenido.retenido,
  deleted: EstadoContenido.eliminado,
};
