// Configuration is outside these tests; PrismaService is replaced by a test double.
// This also isolates the ESM-only config package from the existing CommonJS Jest runner.
jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
  ConfigModule: class ConfigModule {},
}));

import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CategoriesRepository } from './categories.repository';
import type { Category } from './categories.repository';
import { CategoriesService } from './categories.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  const categories: Category[] = [
    { id_categoria: 1n, nombre: 'Bases de Datos', descripcion: null },
    { id_categoria: 2n, nombre: 'Cálculo I', descripcion: 'Límites' },
  ];
  const repository = {
    findAll: jest.fn<Promise<Category[]>, []>(),
    findById: jest.fn<Promise<Category | null>, [bigint]>(),
    seedDefaultsIfEmpty: jest.fn<Promise<void>, []>(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01'));
    repository.findAll.mockResolvedValue(categories);
    const module = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: CategoriesRepository, useValue: repository },
      ],
    }).compile();
    service = module.get(CategoriesService);
  });

  afterEach(() => jest.useRealTimers());

  it('initializes the catalog and propagates initialization failures', async () => {
    await service.onModuleInit();
    expect(repository.seedDefaultsIfEmpty).toHaveBeenCalledTimes(1);
    const error = new Error('Connection failed');
    repository.seedDefaultsIfEmpty.mockRejectedValueOnce(error);
    await expect(service.onModuleInit()).rejects.toBe(error);
  });

  it('returns the ordered repository catalog and caches for one hour', async () => {
    expect(await service.findAll()).toEqual(categories);
    jest.advanceTimersByTime(3_599_999);
    expect(await service.findAll()).toEqual(categories);
    expect(repository.findAll).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await service.findAll();
    expect(repository.findAll).toHaveBeenCalledTimes(2);
  });

  it('does not expose mutable cache references', async () => {
    const first = await service.findAll();
    first[0].nombre = 'Changed';
    first.pop();
    expect(await service.findAll()).toEqual(categories);
  });

  it('shares a concurrent cache load without sharing response objects', async () => {
    const [first, second] = await Promise.all([
      service.findAll(),
      service.findAll(),
    ]);
    expect(repository.findAll).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first[0]).not.toBe(second[0]);
  });

  it('retries after a failed cache load', async () => {
    repository.findAll.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(service.findAll()).rejects.toThrow('Unavailable');
    expect(await service.findAll()).toEqual(categories);
    expect(repository.findAll).toHaveBeenCalledTimes(2);
  });

  it('caches an empty catalog', async () => {
    repository.findAll.mockResolvedValue([]);
    expect(await service.findAll()).toEqual([]);
    expect(await service.findAll()).toEqual([]);
    expect(repository.findAll).toHaveBeenCalledTimes(1);
  });

  it('returns an existing category without losing bigint precision', async () => {
    const category = { ...categories[0], id_categoria: 9223372036854775807n };
    repository.findById.mockResolvedValue(category);
    expect(await service.ensureCategoryExists(category.id_categoria)).toEqual(
      category,
    );
    expect(repository.findById).toHaveBeenCalledWith(9223372036854775807n);
  });

  it('throws the required 404 when the category is absent', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(service.ensureCategoryExists(99n)).rejects.toEqual(
      new NotFoundException('La categoría indicada no existe'),
    );
  });
});
