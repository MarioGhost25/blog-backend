import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const categorySelect = {
  id_categoria: true,
  nombre: true,
  descripcion: true,
} satisfies Prisma.CategoriaSelect;

export type Category = Prisma.CategoriaGetPayload<{
  select: typeof categorySelect;
}>;

const defaultCategories = [
  {
    nombre: 'Cálculo I',
    descripcion: 'Límites, derivadas e integrales de una variable.',
  },
  {
    nombre: 'Programación II',
    descripcion: 'Programación orientada a objetos y estructuras de datos.',
  },
  {
    nombre: 'Bases de Datos',
    descripcion: 'Modelado relacional, SQL y gestión de datos.',
  },
  {
    nombre: 'Física General',
    descripcion: 'Fundamentos de mecánica, energía y movimiento.',
  },
  {
    nombre: 'Estadística',
    descripcion: 'Probabilidad, análisis de datos e inferencia estadística.',
  },
  {
    nombre: 'Ingeniería de Software',
    descripcion: 'Diseño, desarrollo y calidad de sistemas de software.',
  },
] satisfies Prisma.CategoriaCreateManyInput[];

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<Category[]> {
    return this.prisma.categoria.findMany({
      orderBy: { nombre: 'asc' },
      select: categorySelect,
    });
  }

  findById(id: bigint): Promise<Category | null> {
    return this.prisma.categoria.findUnique({
      where: { id_categoria: id },
      select: categorySelect,
    });
  }

  async seedDefaultsIfEmpty(): Promise<void> {
    // One atomic statement avoids acquiring an interactive transaction during
    // startup. The unique constraint also protects concurrent application starts.
    const values = Prisma.join(
      defaultCategories.map(
        (category) => Prisma.sql`(${category.nombre}, ${category.descripcion})`,
      ),
    );
    await this.prisma.$executeRaw`
      INSERT INTO categoria (nombre, descripcion)
      SELECT defaults.name, defaults.description
      FROM (VALUES ${values}) AS defaults(name, description)
      WHERE NOT EXISTS (SELECT 1 FROM categoria)
      ON CONFLICT (nombre) DO NOTHING
    `;
  }
}
