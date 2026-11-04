// Configuration is outside these tests; PrismaService is replaced by a test double.
// This also isolates the ESM-only config package from the existing CommonJS Jest runner.
jest.mock('@nestjs/config', () => ({
  ConfigService: class ConfigService {},
  ConfigModule: class ConfigModule {},
}));

import type { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CategoriesModule } from './categories.module';

describe('Categories HTTP endpoint', () => {
  let app: INestApplication;
  const rows = [
    {
      id_categoria: 9223372036854775807n,
      nombre: 'Bases de Datos',
      descripcion: null,
    },
    { id_categoria: 2n, nombre: 'Cálculo I', descripcion: 'Límites' },
  ];
  const categoria = {
    count: jest.fn().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValue(rows),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [CategoriesModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        categoria,
        $transaction: (
          work: (tx: { categoria: typeof categoria }) => Promise<void>,
        ) => work({ categoria }),
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Use the real guard: removing @Public() makes the request fail.
    app.useGlobalGuards(new JwtAuthGuard(app.get(Reflector)));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 200 without credentials and serializes bigint IDs losslessly', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get('/api/v1/categories')
      .expect(200);
    expect(response.body).toEqual([
      {
        id_categoria: '9223372036854775807',
        nombre: 'Bases de Datos',
        descripcion: null,
      },
      { id_categoria: '2', nombre: 'Cálculo I', descripcion: 'Límites' },
    ]);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/categories')
      .expect(200);
    expect(categoria.findMany).toHaveBeenCalledTimes(1);
    expect(categoria.count).toHaveBeenCalledTimes(1);
  });

  it('does not expose generated CRUD routes', async () => {
    const server = app.getHttpServer() as Server;
    await request(server).post('/api/v1/categories').send({}).expect(404);
    await request(server).get('/api/v1/categories/1').expect(404);
    await request(server).patch('/api/v1/categories/1').send({}).expect(404);
    await request(server).delete('/api/v1/categories/1').expect(404);
  });
});
