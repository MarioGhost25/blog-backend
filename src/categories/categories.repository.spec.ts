// Configuration is outside these tests; PrismaService is replaced by a test double.
// This also isolates the ESM-only config package from the existing CommonJS Jest runner.
jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
  ConfigModule: class ConfigModule {},
}));

import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesRepository } from './categories.repository';

describe('CategoriesRepository', () => {
  let repository: CategoriesRepository;
  const categoria = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    count: jest.fn<Promise<number>, []>(),
    createMany: jest.fn(),
  };
  const transaction = jest.fn(
    (work: (tx: { categoria: typeof categoria }) => Promise<void>) =>
      work({ categoria }),
  );
  const select = { id_categoria: true, nombre: true, descripcion: true };

  beforeEach(async () => {
    jest.clearAllMocks();
    categoria.count.mockResolvedValue(0);
    const module = await Test.createTestingModule({
      providers: [
        CategoriesRepository,
        {
          provide: PrismaService,
          useValue: { categoria, $transaction: transaction },
        },
      ],
    }).compile();
    repository = module.get(CategoriesRepository);
  });

  it('requests alphabetical ordering and only the catalog fields', async () => {
    const rows = [
      { id_categoria: 1n, nombre: 'Bases de Datos', descripcion: null },
      { id_categoria: 2n, nombre: 'Cálculo I', descripcion: null },
    ];
    categoria.findMany.mockResolvedValueOnce(rows);
    expect(await repository.findAll()).toEqual(rows);
    expect(categoria.findMany).toHaveBeenCalledWith({
      orderBy: { nombre: 'asc' },
      select,
    });
  });

  it('looks up the unique bigint identifier and preserves null', async () => {
    categoria.findUnique.mockResolvedValueOnce(null);
    expect(await repository.findById(9223372036854775807n)).toBeNull();
    expect(categoria.findUnique).toHaveBeenCalledWith({
      where: { id_categoria: 9223372036854775807n },
      select,
    });
  });

  it('seeds exactly the six defaults in a transaction with duplicate protection', async () => {
    await repository.seedDefaultsIfEmpty();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(categoria.createMany).toHaveBeenCalledTimes(1);
    expect(categoria.createMany).toHaveBeenCalledWith({
      data: [
        'Cálculo I',
        'Programación II',
        'Bases de Datos',
        'Física General',
        'Estadística',
        'Ingeniería de Software',
      ].map((nombre) => ({
        nombre,
        descripcion: expect.any(String) as unknown,
      })),
      skipDuplicates: true,
    });
  });

  it('leaves a nonempty catalog untouched', async () => {
    categoria.count.mockResolvedValueOnce(1);
    await repository.seedDefaultsIfEmpty();
    expect(categoria.createMany).not.toHaveBeenCalled();
  });

  it('propagates database failures', async () => {
    const error = new Error('Database unavailable');
    categoria.count.mockRejectedValueOnce(error);
    await expect(repository.seedDefaultsIfEmpty()).rejects.toBe(error);
    expect(categoria.createMany).not.toHaveBeenCalled();
  });
});
