jest.mock('@nestjs/config', () => ({
  ConfigService: class {},
  ConfigModule: class {},
}));
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RolGlobal, RolGrupo, EstadoUsuario } from '@prisma/client';
import { GroupsService } from './groups.service';
import { GroupsRepository } from './groups.repository';
import { CategoriesService } from '../categories/categories.service';
import type { AuthenticatedUser } from '../auth/types/auth.types';

const actor: AuthenticatedUser = {
  id: 1n,
  role: RolGlobal.usuario,
  status: EstadoUsuario.activo,
};
const member = (rol: RolGrupo = RolGrupo.miembro) => ({
  id_grupo: 10n,
  id_usuario: 1n,
  rol,
  fecha_union: new Date(),
});

describe('GroupsService business rules', () => {
  let service: GroupsService;
  let repository: {
    withGroupLock: jest.Mock;
    createGroupWithAdmin: jest.Mock;
    findAllCursor: jest.Mock;
    findByIdWithRole: jest.Mock;
    findMembership: jest.Mock;
    addMember: jest.Mock;
    removeMember: jest.Mock;
    countAdmins: jest.Mock;
    updateMemberRole: jest.Mock;
    listMembersCursor: jest.Mock;
    transferAdminTransaction: jest.Mock;
  };
  const categories = { ensureCategoryExists: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    repository = {
      withGroupLock: jest.fn(),
      createGroupWithAdmin: jest.fn(),
      findAllCursor: jest.fn(),
      findByIdWithRole: jest.fn(),
      findMembership: jest.fn(),
      addMember: jest.fn(),
      removeMember: jest.fn(),
      countAdmins: jest.fn(),
      updateMemberRole: jest.fn(),
      listMembersCursor: jest.fn(),
      transferAdminTransaction: jest.fn(),
    };
    repository.withGroupLock.mockImplementation(
      (_id: bigint, work: (repo: GroupsRepository) => Promise<unknown>) =>
        work(repository as unknown as GroupsRepository),
    );
    service = new GroupsService(
      repository as unknown as GroupsRepository,
      categories as unknown as CategoriesService,
    );
  });

  it('validates the category before creating the group and admin', async () => {
    await service.create(
      { nombre: 'Grupo', idCategoria: '9223372036854775807' },
      actor,
    );
    expect(categories.ensureCategoryExists).toHaveBeenCalledWith(
      9223372036854775807n,
    );
    expect(repository.createGroupWithAdmin).toHaveBeenCalledWith({
      nombre: 'Grupo',
      descripcion: undefined,
      idCategoria: 9223372036854775807n,
      idCreador: 1n,
    });
  });
  it('rejects missing categories without creating a group', async () => {
    categories.ensureCategoryExists.mockRejectedValue(new NotFoundException());
    await expect(
      service.create({ nombre: 'Grupo', idCategoria: 1 }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.createGroupWithAdmin).not.toHaveBeenCalled();
  });
  it('passes filters with exact IDs and preserves mios=false', async () => {
    await service.findAll(
      { mios: false, categoria: '2', cursor: '9223372036854775807', limite: 5 },
      actor,
    );
    expect(repository.findAllCursor).toHaveBeenCalledWith(
      { mios: false, categoria: 2n, cursor: 9223372036854775807n, limite: 5 },
      1n,
    );
  });
  it('returns 404 for a missing group', async () => {
    await expect(service.findOne(10n, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('joins under the group lock', async () => {
    await service.joinGroup(10n, actor);
    expect(repository.withGroupLock).toHaveBeenCalledWith(
      10n,
      expect.any(Function),
    );
    expect(repository.addMember).toHaveBeenCalledWith(10n, 1n);
  });
  it('rejects duplicate membership', async () => {
    repository.findMembership.mockResolvedValue(member());
    await expect(service.joinGroup(10n, actor)).rejects.toThrow(
      'Ya eres miembro de este grupo',
    );
    expect(repository.addMember).not.toHaveBeenCalled();
  });
  it('maps concurrent unique constraint conflicts to 409', async () => {
    repository.addMember.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '7',
      }),
    );
    await expect(service.joinGroup(10n, actor)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('allows ordinary members to leave', async () => {
    repository.findMembership.mockResolvedValue(member());
    await service.leaveGroup(10n, actor);
    expect(repository.removeMember).toHaveBeenCalledWith(10n, 1n);
  });
  it('rejects leaving without membership', async () => {
    await expect(service.leaveGroup(10n, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('rejects leaving as the sole administrator', async () => {
    repository.findMembership.mockResolvedValue(member(RolGrupo.administrador));
    repository.countAdmins.mockResolvedValue(1);
    await expect(service.leaveGroup(10n, actor)).rejects.toThrow(
      'Eres el único administrador; transfiere la administración antes de salir',
    );
    expect(repository.removeMember).not.toHaveBeenCalled();
  });
  it('allows an administrator to leave when another remains', async () => {
    repository.findMembership.mockResolvedValue(member(RolGrupo.administrador));
    repository.countAdmins.mockResolvedValue(2);
    await service.leaveGroup(10n, actor);
    expect(repository.removeMember).toHaveBeenCalled();
  });
  it('rejects member listing by a global administrator without membership', async () => {
    await expect(
      service.listMembers(10n, {}, { ...actor, role: RolGlobal.administrador }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('lists members for a current member', async () => {
    repository.findMembership.mockResolvedValue(member());
    await service.listMembers(10n, { q: 'ana', cursor: '9', limite: 2 }, actor);
    expect(repository.listMembersCursor).toHaveBeenCalledWith(
      10n,
      'ana',
      9n,
      2,
    );
  });
  it('rechecks authorization inside the role-change transaction', async () => {
    repository.findMembership.mockResolvedValue(member(RolGrupo.moderador));
    await expect(
      service.changeMemberRole(10n, 2n, RolGrupo.miembro, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.updateMemberRole).not.toHaveBeenCalled();
  });
  it('rejects demoting the last administrator', async () => {
    repository.findMembership.mockResolvedValue(member(RolGrupo.administrador));
    repository.countAdmins.mockResolvedValue(1);
    await expect(
      service.changeMemberRole(10n, 1n, RolGrupo.miembro, actor),
    ).rejects.toThrow('El grupo no puede quedar sin administrador');
  });
  it('allows promotion by a local administrator', async () => {
    repository.findMembership
      .mockResolvedValueOnce(member(RolGrupo.administrador))
      .mockResolvedValueOnce(member());
    await service.changeMemberRole(10n, 2n, RolGrupo.moderador, actor);
    expect(repository.updateMemberRole).toHaveBeenCalledWith(
      10n,
      2n,
      RolGrupo.moderador,
    );
  });
  it('rejects changing an absent member', async () => {
    await expect(
      service.changeMemberRole(10n, 2n, RolGrupo.miembro, {
        ...actor,
        role: RolGlobal.administrador,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects expelling the sole administrator, including oneself', async () => {
    repository.findMembership.mockResolvedValue(member(RolGrupo.administrador));
    repository.countAdmins.mockResolvedValue(1);
    await expect(
      service.removeMemberByAdmin(10n, 1n, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.removeMember).not.toHaveBeenCalled();
  });
  it('allows expelling an ordinary member', async () => {
    repository.findMembership
      .mockResolvedValueOnce(member(RolGrupo.administrador))
      .mockResolvedValueOnce(member());
    await service.removeMemberByAdmin(10n, 2n, actor);
    expect(repository.removeMember).toHaveBeenCalledWith(10n, 2n);
  });
  it('rejects self-transfer before starting a transaction', async () => {
    await expect(
      service.transferAdministration(
        10n,
        { idNuevoAdministrador: 1, salir: false },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.transferAdminTransaction).not.toHaveBeenCalled();
  });
  it('delegates transfer to the transaction with exact IDs', async () => {
    await service.transferAdministration(
      10n,
      { idNuevoAdministrador: '9223372036854775807', salir: true },
      actor,
    );
    expect(repository.transferAdminTransaction).toHaveBeenCalledWith(
      10n,
      1n,
      9223372036854775807n,
      true,
    );
  });
});
