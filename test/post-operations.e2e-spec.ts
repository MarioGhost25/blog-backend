import type { Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AuthModule } from '../src/auth/auth.module';
import { AuthRateLimitGuard } from '../src/auth/guards/auth-rate-limit.guard';
import { PostsModule } from '../src/posts/posts.module';
import { PostsRepository } from '../src/posts/posts.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { identifyOperation } from '../src/posts/types/post-operation';
import { createApiValidationPipe } from '../src/common/validation/api-validation.pipe';
import { configureHttpSecurity } from '../src/common/security/http-security';

type Receipt = {
  status: 'confirmed';
  key: string;
  method: string;
  postId: string;
  version: number;
};
describe('publication operations with real PostgreSQL and HTTP', () => {
  jest.setTimeout(60000);
  const name = `posts_${randomBytes(8).toString('hex')}_test`;
  let admin: Client, app: INestApplication, prisma: PrismaService;
  let created = false;
  const cookies: string[] = [];
  const path = '/api/v1/posts';
  const body = {
    title: 'Synthetic publication',
    content: '<p>Draft</p>',
    categoryId: 1,
  };
  const server = () => app.getHttpServer() as Server;
  const headers = (key: string, owner = '1') => ({
    Cookie: cookies[Number(owner) - 1],
    'Idempotency-Key': key,
    'X-Post-Owner': owner,
  });

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL)
      throw new Error('TEST_DATABASE_URL required');
    const url = new URL(process.env.TEST_DATABASE_URL);
    if (
      url.hostname !== '127.0.0.1' ||
      url.port !== '55432' ||
      url.pathname !== '/blog_test' ||
      url.search ||
      url.hash
    ) {
      throw new Error('Use the dedicated local test container on port 55432');
    }
    admin = new Client({ connectionString: url.href });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    created = true;
    url.pathname = `/${name}`;
    const db = new Client({ connectionString: url.href });
    await db.connect();
    try {
      for (const migration of readdirSync('prisma/migrations')
        .filter((x) => /^\d/.test(x))
        .sort()) {
        await db.query(
          readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
        );
      }
      await db.query(
        "INSERT INTO usuario(nombre,apellido,correo,contrasena_hash) VALUES ('Synthetic','One','one@example.test','unused'), ('Synthetic','Two','two@example.test','unused')",
      );
      await db.query(
        "INSERT INTO categoria(nombre) VALUES ('Synthetic category')",
      );
    } finally {
      await db.end();
    }
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DATABASE_URL: url.href,
              JWT_SECRET: randomBytes(32).toString('hex'),
              NODE_ENV: 'test',
            }),
          ],
        }),
        AuthModule,
        PostsModule,
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttpSecurity(app);
    app.use(cookieParser());
    app.useGlobalPipes(createApiValidationPipe());
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    for (const sub of ['1', '2'])
      cookies.push(
        `jwt=${await app.get(JwtService).signAsync({ sub, role: 'usuario', status: 'activo' })}`,
      );
  });
  beforeEach(() => {
    if (app) app.get(AuthRateLimitGuard).onModuleDestroy();
  });
  afterAll(async () => {
    if (app) await app.close();
    if (created) await admin.query(`DROP DATABASE ${name}`);
    if (admin) await admin.end();
  });

  async function create(key = randomUUID()) {
    const response = await request(server())
      .post(path)
      .set(headers(key))
      .send(body)
      .expect(201);
    return response.body as Receipt;
  }

  it('serializes concurrent identical POSTs into one post and one receipt', async () => {
    const key = randomUUID(),
      title = `Concurrent ${key}`;
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        request(server())
          .post(path)
          .set(headers(key))
          .send({ ...body, title }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    for (const response of responses)
      expect(response.body).toEqual(responses[0].body);
    expect(await prisma.publicacion.count({ where: { titulo: title } })).toBe(
      1,
    );
    expect(
      await prisma.operacionPublicacion.count({ where: { clave: key } }),
    ).toBe(1);
    expect(responses[0].body).not.toHaveProperty('content');
  });

  it('rejects key reuse with a different body, method or target', async () => {
    const receipt = await create();
    const changed = await request(server())
      .post(path)
      .set(headers(receipt.key))
      .send({ ...body, title: 'Changed body' })
      .expect(409);
    expect(changed.body).toMatchObject({ error: 'OperationKeyConflict' });
    await request(server())
      .delete(`${path}/${receipt.postId}`)
      .set(headers(receipt.key))
      .expect(409);
    const other = await create();
    const patchKey = randomUUID();
    await request(server())
      .patch(`${path}/${receipt.postId}`)
      .set(headers(patchKey))
      .send({ title: 'First edit', version: 1 })
      .expect(200);
    await request(server())
      .patch(`${path}/${other.postId}`)
      .set(headers(patchKey))
      .send({ title: 'First edit', version: 1 })
      .expect(409);
  });

  it('reconciles POST after later deletion without recreating it', async () => {
    const receipt = await create();
    const deleteKey = randomUUID();
    await request(server())
      .delete(`${path}/${receipt.postId}`)
      .set(headers(deleteKey))
      .expect(204);
    await request(server())
      .get(`${path}/${receipt.postId}`)
      .set('Cookie', cookies[0])
      .expect(404);
    const replay = await request(server())
      .post(path)
      .set(headers(receipt.key))
      .send(body)
      .expect(201);
    expect(replay.body).toEqual(receipt);
    const check = await request(server())
      .get(`${path}/operations/${receipt.key}`)
      .set(headers(receipt.key))
      .expect(200);
    expect(check.body).toEqual(receipt);
    expect(
      (
        await prisma.publicacion.findUniqueOrThrow({
          where: { id_publicacion: BigInt(receipt.postId) },
        })
      ).estado,
    ).toBe('eliminado');
  });

  it('replays an old PATCH receipt without overwriting a later edit', async () => {
    const receipt = await create(),
      key = randomUUID();
    const patch = { title: 'First version', version: 1 };
    const first = await request(server())
      .patch(`${path}/${receipt.postId}`)
      .set(headers(key))
      .send(patch)
      .expect(200);
    await request(server())
      .patch(`${path}/${receipt.postId}`)
      .set(headers(randomUUID()))
      .send({ title: 'Second version', version: 2 })
      .expect(200);
    const replay = await request(server())
      .patch(`${path}/${receipt.postId}`)
      .set(headers(key))
      .send(patch)
      .expect(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.body).toMatchObject({ version: 2 });
    const current = await prisma.publicacion.findUniqueOrThrow({
      where: { id_publicacion: BigInt(receipt.postId) },
    });
    expect(current.titulo).toBe('Second version');
    expect(current.version).toBe(3);
  });

  it('confirms and repeats DELETE after the public detail already returns 404', async () => {
    const receipt = await create(),
      key = randomUUID();
    await request(server())
      .delete(`${path}/${receipt.postId}`)
      .set(headers(key))
      .expect(204);
    await request(server())
      .delete(`${path}/${receipt.postId}`)
      .set(headers(key))
      .expect(204);
    const check = await request(server())
      .get(`${path}/operations/${key}`)
      .set(headers(key))
      .expect(200);
    expect(check.body).toEqual({
      status: 'confirmed',
      key,
      method: 'DELETE',
      postId: receipt.postId,
      version: 2,
    });
    expect(
      (
        await prisma.publicacion.findUniqueOrThrow({
          where: { id_publicacion: BigInt(receipt.postId) },
        })
      ).version,
    ).toBe(2);
  });

  it('isolates receipts and mutations by authenticated account, including expired sessions', async () => {
    const receipt = await create();
    await request(server())
      .get(`${path}/operations/${receipt.key}`)
      .expect(401);
    const unknown = await request(server())
      .get(`${path}/operations/${receipt.key}`)
      .set(headers(receipt.key, '2'))
      .expect(200);
    expect(unknown.body).toEqual({ status: 'unknown' });
    const mismatch = await request(server())
      .post(path)
      .set({ ...headers(randomUUID(), '2'), 'X-Post-Owner': '1' })
      .send(body)
      .expect(403);
    expect(mismatch.body).toMatchObject({ error: 'OperationOwnerChanged' });
    await request(server())
      .get(`${path}/operations/${receipt.key}`)
      .set({ ...headers(receipt.key, '2'), 'X-Post-Owner': '1' })
      .expect(403);
    await request(server())
      .patch(`${path}/${receipt.postId}`)
      .set(headers(randomUUID(), '2'))
      .send({ title: 'Foreign edit', version: 1 })
      .expect(403);
    const expired = await app
      .get(JwtService)
      .signAsync(
        { sub: '1', role: 'usuario', status: 'activo' },
        { expiresIn: -1 },
      );
    await request(server())
      .post(path)
      .set({ ...headers(randomUUID()), Cookie: `jwt=${expired}` })
      .send(body)
      .expect(401);
    const other = await request(server())
      .post(path)
      .set(headers(receipt.key, '2'))
      .send(body)
      .expect(201);
    expect((other.body as Receipt).postId).not.toBe(receipt.postId);
  });

  it('leaves no receipt after validation or optimistic version rejection', async () => {
    const receipt = await create(),
      key = randomUUID();
    await request(server())
      .patch(`${path}/${receipt.postId}`)
      .set(headers(key))
      .send({ title: 'Invalid version', version: 9 })
      .expect(409);
    expect(
      await prisma.operacionPublicacion.count({ where: { clave: key } }),
    ).toBe(0);
    await request(server())
      .patch(`${path}/${receipt.postId}`)
      .set(headers(key))
      .send({ title: 'Valid version', version: 1 })
      .expect(200);
    await request(server())
      .post(path)
      .set(headers('invalid'))
      .send(body)
      .expect(400);
    await request(server())
      .post(path)
      .set(headers(randomUUID()))
      .send({ ...body, authorId: 2 })
      .expect(400);
  });

  it('rolls back the post if the receipt insert fails in the same SQL transaction', async () => {
    const key = randomUUID(),
      title = `Rollback ${key}`;
    const repository = app.get(PostsRepository);
    // 65 characters violate huella CHAR(64) after the post has been inserted.
    await expect(
      repository.executeOperation(
        {
          ...identifyOperation(1n, key, '1', 'POST', undefined, body),
          fingerprint: 'x'.repeat(65),
        },
        (scoped) =>
          scoped.create({
            authorId: 1n,
            categoryId: 1n,
            groupId: null,
            title,
            content: body.content,
            status: 'visible',
          }),
      ),
    ).rejects.toThrow();
    expect(await prisma.publicacion.count({ where: { titulo: title } })).toBe(
      0,
    );
    expect(
      await prisma.operacionPublicacion.count({ where: { clave: key } }),
    ).toBe(0);
  });
});
