jest.mock('@nestjs/config', () => ({
  ConfigService: class {},
  ConfigModule: class {},
}));
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RolGrupo } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroupsRepository } from './groups.repository';

describe('GroupsRepository', () => {
  const tx = {
    $queryRaw: jest.fn(),
    grupoEstudio: {
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    miembroGrupo: {
      create: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const transaction = jest.fn();
  const repository = new GroupsRepository({
    ...tx,
    $transaction: transaction,
  } as unknown as PrismaService);
  beforeEach(() => {
    jest.resetAllMocks();
    transaction.mockImplementation(
      (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    );
    tx.$queryRaw.mockResolvedValue([{ id_grupo: 10n }]);
  });

  it('creates the group and administrator in the same transaction', async () => {
    tx.grupoEstudio.create.mockResolvedValue({ id_grupo: 10n });
    tx.grupoEstudio.findUniqueOrThrow.mockResolvedValue({
      id_grupo: 10n,
      _count: { miembros: 1 },
    });
    expect(
      await repository.createGroupWithAdmin({
        nombre: 'Grupo',
        idCategoria: 2n,
        idCreador: 1n,
      }),
    ).toEqual({
      id_grupo: 10n,
      _count: { miembros: 1 },
      miRol: 'administrador',
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.miembroGrupo.create).toHaveBeenCalledWith({
      data: { id_grupo: 10n, id_usuario: 1n, rol: 'administrador' },
    });
  });
  it('propagates creation failures so Prisma rolls the transaction back', async () => {
    tx.grupoEstudio.create.mockResolvedValue({ id_grupo: 10n });
    tx.miembroGrupo.create.mockRejectedValue(new Error('membership failed'));
    await expect(
      repository.createGroupWithAdmin({
        nombre: 'Grupo',
        idCategoria: 2n,
        idCreador: 1n,
      }),
    ).rejects.toThrow('membership failed');
    expect(tx.grupoEstudio.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('uses keyset pagination, all filters, and only the current membership', async () => {
    tx.grupoEstudio.findMany.mockResolvedValue([
      { id_grupo: 9n, miembros: [{ rol: 'miembro' }] },
      { id_grupo: 8n, miembros: [] },
    ]);
    expect(
      await repository.findAllCursor(
        { q: 'alg', categoria: 2n, mios: true, cursor: 10n, limite: 1 },
        7n,
      ),
    ).toEqual({ items: [{ id_grupo: 9n, miRol: 'miembro' }], nextCursor: '9' });
    expect(tx.grupoEstudio.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          nombre: { contains: 'alg', mode: 'insensitive' },
          id_categoria: 2n,
          miembros: { some: { id_usuario: 7n } },
          id_grupo: { lt: 10n },
        },
        take: 2,
        orderBy: { id_grupo: 'desc' },
        select: expect.objectContaining({
          miembros: { where: { id_usuario: 7n }, select: { rol: true } },
        }) as unknown,
      }),
    );
  });
  it('caps pages at 50 and omits the next cursor at the end', async () => {
    tx.grupoEstudio.findMany.mockResolvedValue([
      { id_grupo: 9n, miembros: [] },
    ]);
    expect(
      await repository.findAllCursor({ mios: false, limite: 500 }, 7n),
    ).toEqual({ items: [{ id_grupo: 9n, miRol: null }], nextCursor: null });
    expect(tx.grupoEstudio.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51, where: {} }),
    );
  });
  it('returns only administrator profiles and the caller role on detail', async () => {
    tx.grupoEstudio.findUnique.mockResolvedValue({
      id_grupo: 10n,
      miembros: [
        {
          id_usuario: 1n,
          rol: 'administrador',
          usuario: { id_usuario: 1n, nombre: 'Ana' },
        },
        {
          id_usuario: 7n,
          rol: 'miembro',
          usuario: { id_usuario: 7n, nombre: 'Luis' },
        },
      ],
    });
    expect(await repository.findByIdWithRole(10n, 7n)).toEqual({
      id_grupo: 10n,
      miRol: 'miembro',
      administradores: [{ id_usuario: 1n, nombre: 'Ana' }],
    });
  });
  it('returns null for an absent group', async () => {
    tx.grupoEstudio.findUnique.mockResolvedValue(null);
    expect(await repository.findByIdWithRole(10n, 7n)).toBeNull();
  });
  it('uses the exact composite membership key', async () => {
    await repository.findMembership(10n, 7n);
    expect(tx.miembroGrupo.findUnique).toHaveBeenCalledWith({
      where: { id_grupo_id_usuario: { id_grupo: 10n, id_usuario: 7n } },
    });
  });
  it('limits member fields and uses a stable member cursor', async () => {
    tx.miembroGrupo.findMany.mockResolvedValue([
      { usuario: { id_usuario: 8n } },
      { usuario: { id_usuario: 7n } },
    ]);
    expect(await repository.listMembersCursor(10n, 'ana', 9n, 1)).toEqual({
      items: [{ usuario: { id_usuario: 8n } }],
      nextCursor: '8',
    });
    expect(tx.miembroGrupo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        orderBy: { id_usuario: 'desc' },
        select: {
          rol: true,
          fecha_union: true,
          usuario: {
            select: {
              id_usuario: true,
              nombre: true,
              apellido: true,
              correo: true,
              carrera: true,
              foto_url: true,
            },
          },
        },
      }),
    );
  });
  it('locks the parent row before executing the callback', async () => {
    const callback = jest.fn().mockResolvedValue('ok');
    expect(await repository.withGroupLock(10n, callback)).toBe('ok');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      callback.mock.invocationCallOrder[0],
    );
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    const query = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, bigint];
    expect(query[0].join('?')).toContain('WHERE id_grupo = ? FOR UPDATE');
    expect(query[1]).toBe(10n);
  });
  it('rejects a missing group without executing mutations', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    const callback = jest.fn();
    await expect(
      repository.withGroupLock(10n, callback),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(callback).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'transfers atomically with leave=%s',
    async (leave) => {
      tx.miembroGrupo.findUnique
        .mockResolvedValueOnce({ rol: 'administrador' })
        .mockResolvedValueOnce({ rol: 'miembro' });
      await repository.transferAdminTransaction(10n, 1n, 2n, leave);
      expect(tx.miembroGrupo.update).toHaveBeenNthCalledWith(1, {
        where: { id_grupo_id_usuario: { id_grupo: 10n, id_usuario: 2n } },
        data: { rol: 'administrador' },
      });
      if (leave) expect(tx.miembroGrupo.delete).toHaveBeenCalledTimes(1);
      else
        expect(tx.miembroGrupo.update).toHaveBeenNthCalledWith(2, {
          where: { id_grupo_id_usuario: { id_grupo: 10n, id_usuario: 1n } },
          data: { rol: RolGrupo.miembro },
        });
    },
  );
  it('rejects self transfer', async () => {
    await expect(
      repository.transferAdminTransaction(10n, 1n, 1n, true),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.miembroGrupo.update).not.toHaveBeenCalled();
  });
  it('rejects transfer by an actor without local administrator membership', async () => {
    tx.miembroGrupo.findUnique.mockResolvedValue(null);
    await expect(
      repository.transferAdminTransaction(10n, 1n, 2n, false),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects transfer to a nonmember', async () => {
    tx.miembroGrupo.findUnique
      .mockResolvedValueOnce({ rol: 'administrador' })
      .mockResolvedValueOnce(null);
    await expect(
      repository.transferAdminTransaction(10n, 1n, 2n, false),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.miembroGrupo.update).not.toHaveBeenCalled();
  });
});
