import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { CategoriesRepository } from './categories.repository';
import type { Category } from './categories.repository';

@Injectable()
export class CategoriesService implements OnModuleInit {
  private readonly cacheTtlMs = 3600 * 1000;
  private cache: { data: Category[]; expiresAt: number } | undefined;
  private pending: Promise<Category[]> | undefined;

  constructor(private readonly repository: CategoriesRepository) {}

  async onModuleInit(): Promise<void> {
    await this.repository.seedDefaultsIfEmpty();
  }

  async findAll(): Promise<Category[]> {
    if (this.cache && Date.now() < this.cache.expiresAt) {
      return this.cache.data.map((category) => ({ ...category }));
    }

    this.pending ??= this.repository
      .findAll()
      .then((categories) => {
        const data = categories.map((category) => ({ ...category }));
        this.cache = { data, expiresAt: Date.now() + this.cacheTtlMs };
        return data;
      })
      .finally(() => {
        this.pending = undefined;
      });
    const categories = await this.pending;
    return categories.map((category) => ({ ...category }));
  }

  async ensureCategoryExists(id: bigint): Promise<Category> {
    const category = await this.repository.findById(id);
    if (!category) {
      throw new NotFoundException('La categoría indicada no existe');
    }
    return category;
  }
}
