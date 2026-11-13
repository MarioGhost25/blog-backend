import type { EstadoUsuario, RolGlobal, EstadoContenido } from '@prisma/client';
import { Injectable } from '@nestjs/common';
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
      items: rows.slice(0, 20).map((row) => ({
        id: row.id_usuario,
        firstName: row.nombre,
        lastName: row.apellido,
        role: row.rol === 'administrador' ? 'administrator' : 'user',
        status: row.estado === 'activo' ? 'active' : 'suspended',
        suspendedUntil: row.suspendido_hasta,
      })),
      nextCursor: rows.length > 20 ? String(rows[19].id_usuario) : null,
    };
  }
  async updateSuspension(
    id: bigint,
    actor: bigint,
    data: import('@prisma/client').Prisma.UsuarioUncheckedUpdateInput,
    authorize: (
      current: { rol: RolGlobal; estado: EstadoUsuario } | null,
    ) => void,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(61110001)::text`;
      const current = await tx.usuario.findUnique({
        where: { id_usuario: actor },
        select: { rol: true, estado: true },
      });
      authorize(current);
      await tx.usuario.update({ where: { id_usuario: id }, data });
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
      items: rows.slice(0, 20).map((row) => ({
        postId: row.id_publicacion,
        title: row.titulo,
        status: (
          {
            visible: 'visible',
            retenido: 'retained',
            eliminado: 'deleted',
          } as const
        )[row.estado],
        version: row.version,
        groupId: row.id_grupo,
        authorId: row.id_autor,
      })),
      nextCursor: rows.length > 20 ? String(rows[19].id_publicacion) : null,
    };
  }
}
