jest.mock('@nestjs/config', () => ({
  ConfigService: class {},
  ConfigModule: class {},
}));
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { EstadoUsuario, RolGlobal, RolGrupo } from '@prisma/client';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthRepository } from '../auth/auth.repository';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { CategoriesController } from '../categories/categories.controller';
import { CategoriesService } from '../categories/categories.service';
import { GroupsController } from './groups.controller';
import { GroupRoleGuard } from './group-role.guard';
import { GroupsRepository } from './groups.repository';
import { GroupsService } from './groups.service';

const secret = 'test-only-secret-not-used-outside-unit-tests';
const jwt = new JwtService({
  secret,
  signOptions: { algorithm: 'HS256', expiresIn: '1h' },
});
const token = jwt.sign({ sub: '1', role: 'usuario', status: 'activo' });
const cookie = 'jwt=' + token;

describe('Groups HTTP with real JWT and role guards', () => {
  let app: INestApplication;
  let server: Server;
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    joinGroup: jest.fn(),
    leaveGroup: jest.fn(),
    listMembers: jest.fn(),
    changeMemberRole: jest.fn(),
    removeMemberByAdmin: jest.fn(),
    transferAdministration: jest.fn(),
  };
  const repository = { findMembership: jest.fn() };
  const authRepository = { findById: jest.fn() };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt', session: false }),
      ],
      controllers: [GroupsController, CategoriesController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        GroupRoleGuard,
        { provide: ConfigService, useValue: { getOrThrow: () => secret } },
        { provide: AuthRepository, useValue: authRepository },
        { provide: GroupsRepository, useValue: repository },
        { provide: GroupsService, useValue: service },
        {
          provide: CategoriesService,
          useValue: {
            findAll: () =>
              Promise.resolve([
                { id_categoria: 1n, nombre: 'Cálculo I', descripcion: null },
              ]),
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });
  beforeEach(() => {
    jest.resetAllMocks();
    authRepository.findById.mockResolvedValue({
      id: 1n,
      role: RolGlobal.usuario,
      status: EstadoUsuario.activo,
    });
    repository.findMembership.mockResolvedValue({
      rol: RolGrupo.administrador,
    });
    service.findAll.mockResolvedValue({ items: [], nextCursor: null });
  });
  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['get', '/grupos'],
    ['post', '/grupos'],
    ['get', '/grupos/10'],
    ['post', '/grupos/10/miembros'],
    ['delete', '/grupos/10/miembros/me'],
    ['get', '/grupos/10/miembros'],
    ['patch', '/grupos/10/miembros/2'],
    ['delete', '/grupos/10/miembros/2'],
    ['post', '/grupos/10/transferencia'],
  ] as const)('requires authentication on %s %s', async (method, url) => {
    await request(server)
      [method]('/api/v1' + url)
      .expect(401);
  });
  it('keeps categories public alongside protected groups', async () => {
    const response = await request(server)
      .get('/api/v1/categories')
      .expect(200);
    expect(response.body).toEqual([
      { id_categoria: '1', nombre: 'Cálculo I', descripcion: null },
    ]);
  });
  it('preserves mios=false and decimal category IDs', async () => {
    await request(server)
      .get('/api/v1/grupos?mios=false&categoria=9223372036854775807&limite=2')
      .set('Cookie', cookie)
      .expect(200);
    expect(service.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        mios: false,
        categoria: '9223372036854775807',
        limite: 2,
      }),
      expect.objectContaining({ id: 1n }),
    );
  });
  it('accepts mios=true', async () => {
    await request(server)
      .get('/api/v1/grupos?mios=true')
      .set('Cookie', cookie)
      .expect(200);
    expect(service.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ mios: true }),
      expect.anything(),
    );
  });
  it.each([
    'mios=other',
    'limite=51',
    'limite=0',
    'cursor=abc',
    'categoria=0',
    'categoria=1.5',
    'cursor=9223372036854775808',
  ])('rejects invalid filters: %s', async (query) => {
    await request(server)
      .get('/api/v1/grupos?' + query)
      .set('Cookie', cookie)
      .expect(400);
    expect(service.findAll).not.toHaveBeenCalled();
  });
  it('serializes nested bigint IDs and dates without global prototype helpers', async () => {
    service.create.mockResolvedValue({
      id_grupo: 9223372036854775807n,
      categoria: { id_categoria: 2n },
      fecha_creacion: new Date('2026-01-01T00:00:00Z'),
    });
    const response = await request(server)
      .post('/api/v1/grupos')
      .set('Cookie', cookie)
      .send({ nombre: 'Grupo de estudio', idCategoria: '9223372036854775807' })
      .expect(201);
    expect(response.body).toEqual({
      id_grupo: '9223372036854775807',
      categoria: { id_categoria: '2' },
      fecha_creacion: '2026-01-01T00:00:00.000Z',
    });
  });
  it.each([9007199254740992, 0, -1, 1.5, '9223372036854775808', null])(
    'rejects an unsafe category ID %s',
    async (idCategoria) => {
      await request(server)
        .post('/api/v1/grupos')
        .set('Cookie', cookie)
        .send({ nombre: 'Grupo', idCategoria })
        .expect(400);
    },
  );
  it.each(['0', '-1', 'abc', '1.5', '9223372036854775808'])(
    'rejects invalid route ID %s',
    async (id) => {
      await request(server)
        .get('/api/v1/grupos/' + id)
        .set('Cookie', cookie)
        .expect(400);
    },
  );
  it('rejects unknown input and short names', async () => {
    await request(server)
      .post('/api/v1/grupos')
      .set('Cookie', cookie)
      .send({ nombre: 'ab', idCategoria: 1, injected: true })
      .expect(400);
  });
  it.each([RolGrupo.miembro, RolGrupo.moderador])(
    'forbids administrative routes for %s',
    async (rol) => {
      repository.findMembership.mockResolvedValue({ rol });
      await request(server)
        .patch('/api/v1/grupos/10/miembros/2')
        .set('Cookie', cookie)
        .send({ rol: 'miembro' })
        .expect(403);
      await request(server)
        .delete('/api/v1/grupos/10/miembros/2')
        .set('Cookie', cookie)
        .expect(403);
      await request(server)
        .post('/api/v1/grupos/10/transferencia')
        .set('Cookie', cookie)
        .send({ idNuevoAdministrador: 2, salir: false })
        .expect(403);
    },
  );
  it.each(Object.values(RolGrupo))(
    'allows member listing for hierarchical role %s',
    async (rol) => {
      repository.findMembership.mockResolvedValue({ rol });
      await request(server)
        .get('/api/v1/grupos/10/miembros')
        .set('Cookie', cookie)
        .expect(200);
    },
  );
  it('forbids member listing for a nonmember', async () => {
    repository.findMembership.mockResolvedValue(null);
    await request(server)
      .get('/api/v1/grupos/10/miembros')
      .set('Cookie', cookie)
      .expect(403);
  });
  it('allows the global administrator through the role guard', async () => {
    authRepository.findById.mockResolvedValue({
      id: 1n,
      role: RolGlobal.administrador,
      status: EstadoUsuario.activo,
    });
    await request(server)
      .patch('/api/v1/grupos/10/miembros/2')
      .set('Cookie', cookie)
      .send({ rol: 'moderador' })
      .expect(200);
    expect(repository.findMembership).not.toHaveBeenCalled();
  });
  it('validates role and transfer body', async () => {
    await request(server)
      .patch('/api/v1/grupos/10/miembros/2')
      .set('Cookie', cookie)
      .send({ rol: 'owner' })
      .expect(400);
    await request(server)
      .post('/api/v1/grupos/10/transferencia')
      .set('Cookie', cookie)
      .send({ idNuevoAdministrador: 2, salir: 'false' })
      .expect(400);
  });
  it('returns empty 204 responses for leave, removal and transfer', async () => {
    const leave = await request(server)
      .delete('/api/v1/grupos/10/miembros/me')
      .set('Cookie', cookie)
      .expect(204);
    const remove = await request(server)
      .delete('/api/v1/grupos/10/miembros/2')
      .set('Cookie', cookie)
      .expect(204);
    const transfer = await request(server)
      .post('/api/v1/grupos/10/transferencia')
      .set('Cookie', cookie)
      .send({ idNuevoAdministrador: '2', salir: false })
      .expect(204);
    expect([leave.text, remove.text, transfer.text]).toEqual(['', '', '']);
    expect(service.leaveGroup).toHaveBeenCalledWith(
      10n,
      expect.objectContaining({ id: 1n }),
    );
    expect(service.removeMemberByAdmin).toHaveBeenCalledWith(
      10n,
      2n,
      expect.anything(),
    );
  });
});
