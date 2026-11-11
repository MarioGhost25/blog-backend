import { suspendAccount } from '../auth/account-suspension';
import type { EstadoUsuario, RolGlobal, EstadoContenido } from '@prisma/client';
import {
  ForbiddenException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class AdminRepository {
  constructor(private readonly db: PrismaService) {}
  async summary(days: number) {
    const since = new Date(Date.now() - days * 86400000);
    const [users, suspended, posts, comments, reports, groups] =
      await Promise.all([
        this.db.usuario.count(),
        this.db.usuario.count({ where: { estado: 'suspendido' } }),
        this.db.publicacion.count({
          where: { fecha_creacion: { gte: since }, estado: 'visible' },
        }),
        this.db.comentario.count({
          where: { fecha_creacion: { gte: since }, estado: 'visible' },
        }),
        this.db.reporte.count({ where: { estado: 'pendiente' } }),
        this.db.grupoEstudio.count(),
      ]);
    return { days, users, suspended, posts, comments, reports, groups };
  }
  async users(
    q?: string,
    cursor?: bigint,
    role?: RolGlobal,
    status?: EstadoUsuario,
  ) {
    const rows = await this.db.usuario.findMany({
      where: {
        ...(role ? { rol: role } : {}),
        ...(status ? { estado: status } : {}),
        ...(cursor ? { id_usuario: { lt: cursor } } : {}),
        ...(q
          ? {
              OR: [
                { nombre: { contains: q, mode: 'insensitive' as const } },
                { apellido: { contains: q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: { id_usuario: 'desc' },
      take: 21,
      select: {
        id_usuario: true,
        nombre: true,
        apellido: true,
        rol: true,
        estado: true,
        suspendido_hasta: true,
      },
    });
    return {
      items: rows.slice(0, 20),
      nextCursor: rows.length > 20 ? String(rows[19].id_usuario) : null,
    };
  }
  async suspension(id: bigint, actor: bigint, days?: number, reason?: string) {
    return this.db.$transaction(async (tx) => {
      if (days !== undefined)
        return suspendAccount(tx, id, actor, days, reason!);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(61110001)::text`;
      const current = await tx.usuario.findUnique({
        where: { id_usuario: actor },
        select: { rol: true, estado: true },
      });
      if (current?.rol !== 'administrador' || current.estado !== 'activo')
        throw new ForbiddenException();
      if (id === actor)
        throw new BadRequestException('Cannot reactivate yourself');
      await tx.usuario.update({
        where: { id_usuario: id },
        data: {
          estado: 'activo',
          suspendido_hasta: null,
          suspendido_por: null,
          motivo_suspension: null,
        },
      });
    });
  }
  async posts(
    q?: string,
    cursor?: bigint,
    status?: EstadoContenido,
    scope?: string,
    categoryId?: bigint,
  ) {
    const rows = await this.db.publicacion.findMany({
      where: {
        ...(q ? { titulo: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(cursor ? { id_publicacion: { lt: cursor } } : {}),
        ...(status ? { estado: status } : {}),
        ...(scope === 'public'
          ? { id_grupo: null }
          : scope === 'group'
            ? { id_grupo: { not: null } }
            : {}),
        ...(categoryId ? { id_categoria: categoryId } : {}),
      },
      take: 21,
      orderBy: { id_publicacion: 'desc' },
      select: {
        id_publicacion: true,
        titulo: true,
        estado: true,
        version: true,
        id_grupo: true,
        id_autor: true,
      },
    });
    return {
      items: rows.slice(0, 20),
      nextCursor: rows.length > 20 ? String(rows[19].id_publicacion) : null,
    };
  }
}
