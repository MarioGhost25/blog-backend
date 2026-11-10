import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}
  list(userId: bigint, cursor: bigint | undefined, unread: boolean) {
    return this.prisma.notificacion.findMany({
      where: {
        id_destinatario: userId,
        ...(cursor ? { id_notificacion: { lt: cursor } } : {}),
        ...(unread ? { fecha_lectura: null } : {}),
      },
      orderBy: { id_notificacion: 'desc' },
      take: 21,
      include: {
        publicacion: { select: { id_publicacion: true } },
        comentario: { select: { id_publicacion: true, estado: true } },
        reporte: { select: { id_reportante: true, estado: true } },
      },
    });
  }
  count(userId: bigint) {
    return this.prisma.notificacion.count({
      where: { id_destinatario: userId, fecha_lectura: null },
    });
  }
  read(userId: bigint, id: bigint) {
    return this.prisma.notificacion.updateMany({
      where: { id_destinatario: userId, id_notificacion: id },
      data: { fecha_lectura: new Date() },
    });
  }
  readThrough(userId: bigint, id: bigint) {
    return this.prisma.notificacion.updateMany({
      where: {
        id_destinatario: userId,
        id_notificacion: { lte: id },
        fecha_lectura: null,
      },
      data: { fecha_lectura: new Date() },
    });
  }
}
