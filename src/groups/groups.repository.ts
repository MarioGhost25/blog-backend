import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RolGrupo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const categorySelect = {
  id_categoria: true,
  nombre: true,
  descripcion: true,
} satisfies Prisma.CategoriaSelect;
const memberUserSelect = {
  id_usuario: true,
  nombre: true,
  apellido: true,
  correo: true,
  carrera: true,
  foto_url: true,
} satisfies Prisma.UsuarioSelect;
const adminUserSelect = {
  id_usuario: true,
  nombre: true,
  apellido: true,
  foto_url: true,
} satisfies Prisma.UsuarioSelect;
const groupSelect = {
  id_grupo: true,
  id_categoria: true,
  id_creador: true,
  nombre: true,
  descripcion: true,
  fecha_creacion: true,
  categoria: { select: categorySelect },
  _count: { select: { miembros: true } },
} satisfies Prisma.GrupoEstudioSelect;

export interface GroupFilters {
  q?: string;
  categoria?: bigint;
  mios?: boolean;
  cursor?: bigint;
  limite?: number;
}
export interface CreateGroupData {
  nombre: string;
  descripcion?: string;
  idCategoria: bigint;
  idCreador: bigint;
}

function page<T>(rows: T[], limit: number, id: (row: T) => bigint) {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor:
      rows.length > limit ? id(items[items.length - 1]).toString() : null,
  };
}

@Injectable()
export class GroupsRepository {
  private transaction?: Prisma.TransactionClient;
  constructor(private readonly prisma: PrismaService) {}
  private get db() {
    return this.transaction ?? this.prisma;
  }

  // Every membership mutation locks the same parent row before checking roles.
  // READ COMMITTED ensures checks after a waiter acquires the lock see committed changes.
  async withGroupLock<T>(
    groupId: bigint,
    work: (repository: GroupsRepository) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { id_grupo: bigint }[]
        >`SELECT id_grupo FROM grupo_estudio WHERE id_grupo = ${groupId} FOR UPDATE`;
        if (!rows.length) throw new NotFoundException('Group not found');
        const scoped = new GroupsRepository(this.prisma);
        scoped.transaction = tx;
        return work(scoped);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  async createGroupWithAdmin(data: CreateGroupData) {
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.grupoEstudio.create({
        data: {
          nombre: data.nombre,
          descripcion: data.descripcion,
          id_categoria: data.idCategoria,
          id_creador: data.idCreador,
        },
      });
      await tx.miembroGrupo.create({
        data: {
          id_grupo: group.id_grupo,
          id_usuario: data.idCreador,
          rol: RolGrupo.administrador,
        },
      });
      const result = await tx.grupoEstudio.findUniqueOrThrow({
        where: { id_grupo: group.id_grupo },
        select: groupSelect,
      });
      return { ...result, miRol: RolGrupo.administrador };
    });
  }

  async findAllCursor(filters: GroupFilters, currentUserId: bigint) {
    const limit = Math.min(50, Math.max(1, filters.limite ?? 30));
    const rows = await this.db.grupoEstudio.findMany({
      where: {
        ...(filters.q
          ? { nombre: { contains: filters.q, mode: 'insensitive' as const } }
          : {}),
        ...(filters.categoria ? { id_categoria: filters.categoria } : {}),
        ...(filters.mios === true
          ? { miembros: { some: { id_usuario: currentUserId } } }
          : {}),
        ...(filters.cursor ? { id_grupo: { lt: filters.cursor } } : {}),
      },
      orderBy: { id_grupo: 'desc' },
      take: limit + 1,
      select: {
        ...groupSelect,
        miembros: {
          where: { id_usuario: currentUserId },
          select: { rol: true },
        },
      },
    });
    return page(
      rows.map(({ miembros, ...group }) => ({
        ...group,
        miRol: miembros[0]?.rol ?? null,
      })),
      limit,
      (row) => row.id_grupo,
    );
  }

  async findByIdWithRole(groupId: bigint, currentUserId: bigint) {
    const group = await this.db.grupoEstudio.findUnique({
      where: { id_grupo: groupId },
      select: {
        ...groupSelect,
        miembros: {
          where: {
            OR: [
              { id_usuario: currentUserId },
              { rol: RolGrupo.administrador },
            ],
          },
          select: {
            id_usuario: true,
            rol: true,
            usuario: { select: adminUserSelect },
          },
        },
      },
    });
    if (!group) return null;
    const { miembros, ...data } = group;
    return {
      ...data,
      miRol:
        miembros.find((member) => member.id_usuario === currentUserId)?.rol ??
        null,
      administradores: miembros
        .filter((member) => member.rol === RolGrupo.administrador)
        .map((member) => member.usuario),
    };
  }

  findMembership(groupId: bigint, userId: bigint) {
    return this.db.miembroGrupo.findUnique({
      where: { id_grupo_id_usuario: { id_grupo: groupId, id_usuario: userId } },
    });
  }
  addMember(groupId: bigint, userId: bigint) {
    return this.db.miembroGrupo.create({
      data: { id_grupo: groupId, id_usuario: userId, rol: RolGrupo.miembro },
    });
  }
  removeMember(groupId: bigint, userId: bigint) {
    return this.db.miembroGrupo.delete({
      where: { id_grupo_id_usuario: { id_grupo: groupId, id_usuario: userId } },
    });
  }
  countAdmins(groupId: bigint) {
    return this.db.miembroGrupo.count({
      where: { id_grupo: groupId, rol: RolGrupo.administrador },
    });
  }
  updateMemberRole(groupId: bigint, userId: bigint, rol: RolGrupo) {
    return this.db.miembroGrupo.update({
      where: { id_grupo_id_usuario: { id_grupo: groupId, id_usuario: userId } },
      data: { rol },
    });
  }

  async listMembersCursor(
    groupId: bigint,
    q?: string,
    cursor?: bigint,
    limit = 30,
  ) {
    limit = Math.min(50, Math.max(1, limit));
    const rows = await this.db.miembroGrupo.findMany({
      where: {
        id_grupo: groupId,
        ...(cursor ? { id_usuario: { lt: cursor } } : {}),
        ...(q
          ? {
              usuario: {
                OR: ['nombre', 'apellido', 'correo'].map((field) => ({
                  [field]: { contains: q, mode: 'insensitive' },
                })),
              },
            }
          : {}),
      },
      orderBy: { id_usuario: 'desc' },
      take: limit + 1,
      select: {
        rol: true,
        fecha_union: true,
        usuario: { select: memberUserSelect },
      },
    });
    return page(rows, limit, (row) => row.usuario.id_usuario);
  }

  async transferAdminTransaction(
    groupId: bigint,
    currentAdminId: bigint,
    newAdminId: bigint,
    leave: boolean,
  ): Promise<void> {
    await this.withGroupLock(groupId, async (repository) => {
      if (currentAdminId === newAdminId)
        throw new BadRequestException(
          'You cannot transfer administration to yourself',
        );
      const current = await repository.findMembership(groupId, currentAdminId);
      if (current?.rol !== RolGrupo.administrador)
        throw new ForbiddenException(
          'You must currently be an administrator of this group; global administrator status alone does not allow transfer',
        );
      if (!(await repository.findMembership(groupId, newAdminId)))
        throw new BadRequestException(
          'The new administrator must already be a group member',
        );
      await repository.updateMemberRole(
        groupId,
        newAdminId,
        RolGrupo.administrador,
      );
      if (leave) await repository.removeMember(groupId, currentAdminId);
      else
        await repository.updateMemberRole(
          groupId,
          currentAdminId,
          RolGrupo.miembro,
        );
    });
  }
}
