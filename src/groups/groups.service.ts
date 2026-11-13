import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RolGrupo } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { CategoriesService } from '../categories/categories.service';
import { GroupsRepository } from './groups.repository';
import { CreateGroupDto } from './dto/create-group.dto';
import { FilterGroupsDto, MemberFiltersDto } from './dto/filter-groups.dto';
import { TransferAdminDto } from './dto/transfer-admin.dto';
import { parseGroupId } from './utils/group-id';

@Injectable()
export class GroupsService {
  constructor(
    private readonly repository: GroupsRepository,
    private readonly categories: CategoriesService,
  ) {}

  async create(dto: CreateGroupDto, user: AuthenticatedUser) {
    const idCategoria = parseGroupId(dto.categoryId);
    await this.categories.ensureCategoryExists(idCategoria);
    return this.repository.createGroupWithAdmin({
      nombre: dto.name,
      descripcion: dto.description,
      idCategoria,
      idCreador: user.id,
    });
  }

  findAll(filters: FilterGroupsDto, user: AuthenticatedUser) {
    return this.repository.findAllCursor(
      {
        q: filters.q,
        limite: filters.limit,
        mios: filters.mine,
        categoria:
          filters.categoryId == null
            ? undefined
            : parseGroupId(filters.categoryId),
        cursor:
          filters.cursor == null ? undefined : parseGroupId(filters.cursor),
      },
      user.id,
    );
  }

  async findOne(groupId: bigint, user: AuthenticatedUser) {
    const group = await this.repository.findByIdWithRole(groupId, user.id);
    if (!group) throw new NotFoundException('Group not found');
    return group;
  }

  async joinGroup(groupId: bigint, user: AuthenticatedUser) {
    try {
      return await this.repository.withGroupLock(
        groupId,
        async (repository) => {
          if (await repository.findMembership(groupId, user.id))
            throw new ConflictException(
              'You are already a member of this group',
            );
          return repository.addMember(groupId, user.id);
        },
      );
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException('You are already a member of this group');
      throw error;
    }
  }

  async leaveGroup(groupId: bigint, user: AuthenticatedUser): Promise<void> {
    await this.repository.withGroupLock(groupId, async (repository) => {
      await this.ensureCanRemove(
        repository,
        groupId,
        user.id,
        'You are the only administrator; transfer administration before leaving',
      );
      await repository.removeMember(groupId, user.id);
    });
  }

  async listMembers(
    groupId: bigint,
    filters: MemberFiltersDto,
    user: AuthenticatedUser,
  ) {
    return this.repository.withGroupLock(
      groupId,
      async (repository) => {
        if (!(await repository.findMembership(groupId, user.id)))
          throw new ForbiddenException('You must be a member of this group');
        return repository.listMembersCursor(
          groupId,
          filters.q,
          filters.cursor == null ? undefined : parseGroupId(filters.cursor),
          filters.limit,
        );
      },
      'read',
    );
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
      if (!member) throw new NotFoundException('Member not found');
      if (
        member.rol === RolGrupo.administrador &&
        rol !== RolGrupo.administrador &&
        (await repository.countAdmins(groupId)) <= 1
      )
        throw new ConflictException(
          'The group must have at least one administrator',
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
        'The group must have at least one administrator',
      );
      await repository.removeMember(groupId, userId);
    });
  }

  async transferAdministration(
    groupId: bigint,
    dto: TransferAdminDto,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const newAdminId = parseGroupId(dto.newAdministratorId);
    if (newAdminId === actor.id)
      throw new BadRequestException(
        'You cannot transfer administration to yourself',
      );
    await this.repository.transferAdminTransaction(
      groupId,
      actor.id,
      newAdminId,
      dto.leave,
    );
  }

  private async ensureAdmin(
    repository: GroupsRepository,
    groupId: bigint,
    actor: AuthenticatedUser,
  ): Promise<void> {
    // Recheck after obtaining the lock: the guard's result can become stale.
    if (
      (await repository.findMembership(groupId, actor.id))?.rol !==
      RolGrupo.administrador
    )
      throw new ForbiddenException(
        'You must currently be an administrator of this group to manage members',
      );
  }

  private async ensureCanRemove(
    repository: GroupsRepository,
    groupId: bigint,
    userId: bigint,
    message: string,
  ): Promise<void> {
    const member = await repository.findMembership(groupId, userId);
    if (!member) throw new NotFoundException('Member not found');
    if (
      member.rol === RolGrupo.administrador &&
      (await repository.countAdmins(groupId)) <= 1
    )
      throw new ConflictException(message);
  }
}
