import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { CategoriesService } from './categories.service';

type CategoryResponse = {
  categoryId: string;
  name: string;
  description: string | null;
};

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Get()
  async findAll(): Promise<CategoryResponse[]> {
    const categories = await this.categoriesService.findAll();
    return categories.map((category) => ({
      categoryId: category.id_categoria.toString(),
      name: category.nombre,
      description: category.descripcion,
    }));
  }
}
