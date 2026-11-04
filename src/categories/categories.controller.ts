import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { CategoriesService } from './categories.service';
import type { Category } from './categories.repository';

type CategoryResponse = Omit<Category, 'id_categoria'> & {
  id_categoria: string;
};

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get()
  async findAll(): Promise<CategoryResponse[]> {
    const categories = await this.categoriesService.findAll();
    return categories.map((category) => ({
      ...category,
      id_categoria: category.id_categoria.toString(),
    }));
  }
}
