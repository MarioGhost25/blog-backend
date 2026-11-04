import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RolGlobal, RolGrupo } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { CategoriesService } from '../categories/categories.service';
import { GroupsRepository } from './groups.repository';
import { CreateGroupDto } from './dto/create-group.dto';
import { FilterGroupsDto, MemberFiltersDto } from './dto/filter-groups.dto';
import { TransferAdminDto } from './dto/transfer-admin.dto';
import { parseGroupId } from './group-id';

@Injectable()
export class GroupsService {
  constructor(
    private readonly repository: GroupsRepository,
    private readonly categories: CategoriesService,
  ) {}

  async create(dto: CreateGroupDto, user: AuthenticatedUser) {
    const idCategoria = parseGroupId(dto.idCategoria);
    await this.categories.ensureCategoryExists(idCategoria);
    return this.repository.createGroupWithAdmin({
      nombre: dto.nombre,
      descripcion: dto.descripcion,
      idCategoria,
      idCreador: user.id,
    });
  }

  findAll(filters: FilterGroupsDto, user: AuthenticatedUser) {
    return this.repository.findAllCursor(
      {
        ...filters,
        categoria:
          filters.categoria == null
            ? undefined
            : parseGroupId(filters.categoria),
        cursor:
          filters.cursor == null ? undefined : parseGroupId(filters.cursor),
      },
      user.id,
    );
  }

  async findOne(groupId: bigint, user: AuthenticatedUser) {
    const group = await this.repository.findByIdWithRole(groupId, user.id);
    if (!group) throw new NotFoundException('El grupo no existe');
    return group;
  }

  async joinGroup(groupId: bigint, user: AuthenticatedUser) {
    try {
      return await this.repository.withGroupLock(
        groupId,
        async (repository) => {
          if (await repository.findMembership(groupId, user.id))
            throw new ConflictException('Ya eres miembro de este grupo');
          return repository.addMember(groupId, user.id);
        },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('Ya eres miembro de este grupo');
      throw error;
    }
  }

  async leaveGroup(groupId: bigint, user: AuthenticatedUser): Promise<void> {
    await this.repository.withGroupLock(groupId, async (repository) => {
      await this.ensureCanRemove(
        repository,
        groupId,
        user.id,
        'Eres el único administrador; transfiere la administración antes de salir',
      );
      await repository.removeMember(groupId, user.id);
    });
  }

  async listMembers(
    groupId: bigint,
    filters: MemberFiltersDto,
    user: AuthenticatedUser,
  ) {
    return this.repository.withGroupLock(groupId, async (repository) => {
      if (!(await repository.findMembership(groupId, user.id)))
        throw new ForbiddenException('Debes ser miembro del grupo');
      return repository.listMembersCursor(
        groupId,
        filters.q,
        filters.cursor == null ? undefined : parseGroupId(filters.cursor),
        filters.limite,
      );
    });
  }

  async changeMemberRole(
    groupId: bigint,
    userId: bigint,
    rol: RolGrupo,
    actor: AuthenticatedUser,
  ) {
    return this.repository.withGroupLock(groupId, async (repository) => {
      await this.ensureAdmin(repository, groupId, actor);
      const member = await repository.findMembership(groupId, userId);
      if (!member) throw new NotFoundException('El integrante no existe');
      if (
        member.rol === RolGrupo.administrador &&
        rol !== RolGrupo.administrador &&
        (await repository.countAdmins(groupId)) <= 1
      )
        throw new ConflictException(
          'El grupo no puede quedar sin administrador',
        );
      return repository.updateMemberRole(groupId, userId, rol);
    });
  }

  async removeMemberByAdmin(
    groupId: bigint,
    userId: bigint,
    actor: AuthenticatedUser,
  ): Promise<void> {
    await this.repository.withGroupLock(groupId, async (repository) => {
      await this.ensureAdmin(repository, groupId, actor);
      await this.ensureCanRemove(
        repository,
        groupId,
        userId,
        'El grupo no puede quedar sin administrador',
      );
      await repository.removeMember(groupId, userId);
    });
  }

  async transferAdministration(
    groupId: bigint,
    dto: TransferAdminDto,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const newAdminId = parseGroupId(dto.idNuevoAdministrador);
    if (newAdminId === actor.id)
      throw new BadRequestException(
        'No puedes transferirte la administración a ti mismo',
      );
    await this.repository.transferAdminTransaction(
      groupId,
      actor.id,
      newAdminId,
      dto.salir,
    );
  }

  private async ensureAdmin(
    repository: GroupsRepository,
    groupId: bigint,
    actor: AuthenticatedUser,
  ): Promise<void> {
    // Recheck after obtaining the lock: the guard's result can become stale.
    if (
      actor.role !== RolGlobal.administrador &&
      (await repository.findMembership(groupId, actor.id))?.rol !==
        RolGrupo.administrador
    )
      throw new ForbiddenException();
  }

  private async ensureCanRemove(
    repository: GroupsRepository,
    groupId: bigint,
    userId: bigint,
    message: string,
  ): Promise<void> {
    const member = await repository.findMembership(groupId, userId);
    if (!member) throw new NotFoundException('El integrante no existe');
    if (
      member.rol === RolGrupo.administrador &&
      (await repository.countAdmins(groupId)) <= 1
    )
      throw new ConflictException(message);
  }
}
