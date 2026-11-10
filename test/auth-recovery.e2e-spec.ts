import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { randomBytes, createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AuthRateLimitGuard } from '../src/auth/guards/auth-rate-limit.guard';
import { PostsModule } from '../src/posts/posts.module';
import { AuthModule } from '../src/auth/auth.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApiValidationPipe } from '../src/common/validation/api-validation.pipe';
import { configureHttpSecurity } from '../src/common/security/http-security';

describe('auth with real PostgreSQL and local SMTP', () => {
  jest.setTimeout(60000);
  const name = `auth_${randomBytes(8).toString('hex')}_test`;
  const email = `${name}@example.test`;
  const original = 'Original-test-42!';
  const replacement = 'Replacement-test-42!';
  const identitySecret = randomBytes(32).toString('hex');
  let admin: Client;
  let app: INestApplication;
  let prisma: PrismaService;
  let created = false;
  let cookie: string;
  let usedToken: string;

  beforeAll(async () => {
    const value = process.env.TEST_DATABASE_URL;
    if (!value) throw new Error('TEST_DATABASE_URL required');
    const url = new URL(value);
    // This suite is specifically for docker-compose.test.yml, never development.
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
    const database = new Client({ connectionString: url.href });
    await database.connect();
    try {
      for (const migration of [
        '20261016223549_init',
        '20261108000100_generated_search',
        '20261108000200_business_checks',
        '20261109000100_post_operations',
      ]) {
        await database.query(
          readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
        );
      }
    } finally {
      await database.end();
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
              BFF_IDENTITY_SECRET: identitySecret,
              NODE_ENV: 'test',
              SMTP_HOST: '127.0.0.1',
              SMTP_PORT: 11025,
              SMTP_FROM: 'test@example.test',
              SMTP_SECURE: false,
              RECOVERY_URL: 'http://localhost:3000/recuperar',
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
  });

  // Tests retain their synthetic user but start independent rate-limit windows.
  beforeEach(() => app.get(AuthRateLimitGuard).onModuleDestroy());

  function identity(ip: string, method: string, path: string) {
    const timestamp = String(Date.now());
    return {
      'x-blog-client-ip': ip,
      'x-blog-client-time': timestamp,
      'x-blog-client-signature': createHmac('sha256', identitySecret)
        .update(`v1\n${ip}\n${timestamp}\n${method}\n${path}`)
        .digest('hex'),
    };
  }

  it('isolates signed clients and does not trust forged forwarding headers', async () => {
    const path = '/api/v1/auth/login';
    for (let i = 0; i < 5; i++)
      await request(app.getHttpServer() as Server)
        .post(path)
        .set(identity('192.0.2.1', 'POST', path))
        .send({ email: 'missing@example.test', password: 'Wrong-test-42!' })
        .expect(401);
    const limited = await request(app.getHttpServer() as Server)
      .post(path)
      .set(identity('192.0.2.1', 'POST', path))
      .send({ email: 'missing@example.test', password: 'Wrong-test-42!' })
      .expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect((limited.body as { idCorrelacion: string }).idCorrelacion).toBe(
      limited.headers['x-request-id'],
    );
    await request(app.getHttpServer() as Server)
      .post(path)
      .set(identity('192.0.2.2', 'POST', path))
      .send({ email: 'missing@example.test', password: 'Wrong-test-42!' })
      .expect(401);
    for (let i = 0; i < 6; i++)
      await request(app.getHttpServer() as Server)
        .post(path)
        .set({
          'X-Forwarded-For': `192.0.2.${i + 10}`,
          'x-blog-client-ip': `192.0.2.${i + 10}`,
          'x-blog-client-time': String(Date.now()),
          'x-blog-client-signature': '0'.repeat(64),
        })
        .send({ email: 'missing@example.test', password: 'Wrong-test-42!' })
        .expect(i < 5 ? 401 : 429);
  });

  it('enforces global and search budgets across both public search routes', async () => {
    for (let i = 0; i < 30; i++)
      await request(app.getHttpServer() as Server)
        .get(
          i % 2
            ? '/api/v1/posts?q=matrices'
            : '/api/v1/posts/search?q=matrices',
        )
        .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/posts/search?q=matrices')
      .expect(429);
    app.get(AuthRateLimitGuard).onModuleDestroy();
    for (let i = 0; i < 100; i++)
      await request(app.getHttpServer() as Server)
        .get('/api/v1/posts?limit=1')
        .expect(200);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/posts?limit=1')
      .expect(429);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (created) await admin.query(`DROP DATABASE ${name}`);
    if (admin) await admin.end();
  });

  it('registers, authenticates an administrator and reads the authenticated profile', async () => {
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/register')
      .send({
        firstName: 'Synthetic',
        lastName: 'Admin',
        email,
        password: original,
      })
      .expect(201);
    await prisma.usuario.update({
      where: { correo: email },
      data: { rol: 'administrador' },
    });
    const login = await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/login')
      .send({ email, password: original })
      .expect(200);
    expect((login.body as { role: unknown }).role).toBe('administrator');
    cookie = login.headers['set-cookie'][0].split(';')[0];
    const me = await request(app.getHttpServer() as Server)
      .get('/api/v1/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect((me.body as { role: unknown }).role).toBe('administrator');
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('delivers a single-use link; existing and missing accounts have the same response window', async () => {
    const started = Date.now();
    const [existing, missing] = await Promise.all([
      request(app.getHttpServer() as Server)
        .post('/api/v1/auth/forgot-password')
        .send({ email }),
      request(app.getHttpServer() as Server)
        .post('/api/v1/auth/forgot-password')
        .send({ email: `absent-${email}` }),
    ]);
    expect(existing.status).toBe(202);
    expect(missing.status).toBe(202);
    expect(existing.body).toEqual(missing.body);
    expect(Date.now() - started).toBeGreaterThanOrEqual(11900);
    const listing = (await fetch('http://127.0.0.1:18025/api/v1/messages').then(
      (r) => r.json(),
    )) as { messages: Array<{ ID: string; To: Array<{ Address: string }> }> };
    const entry = listing.messages.find((m) =>
      m.To.some((to) => to.Address === email),
    );
    expect(Boolean(entry)).toBe(true);
    const mail = (await fetch(
      `http://127.0.0.1:18025/api/v1/message/${entry!.ID}`,
    ).then((r) => r.json())) as { Text: string };
    const match = mail.Text.match(
      /http:\/\/localhost:3000\/recuperar\/([A-Za-z0-9_-]{43})/,
    );
    expect(Boolean(match)).toBe(true);
    usedToken = match![1];
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer() as Server)
          .post('/api/v1/auth/reset-password')
          .send({ token: usedToken, newPassword: replacement }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([204, 410]);
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/login')
      .send({ email, password: original })
      .expect(401);
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/login')
      .send({ email, password: replacement })
      .expect(200);
  });

  it('keeps only one unused token after simultaneous recovery requests', async () => {
    await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer() as Server)
          .post('/api/v1/auth/forgot-password')
          .send({ email })
          .expect(202),
      ),
    );
    const user = await prisma.usuario.findUniqueOrThrow({
      where: { correo: email },
    });
    expect(
      await prisma.tokenRecuperacion.count({
        where: { id_usuario: user.id_usuario, fecha_uso: null },
      }),
    ).toBe(1);
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/reset-password')
      .send({ token: usedToken, newPassword: original })
      .expect(410);
  });
  it('enforces recovery rate limits over HTTP, including spoofed forwarding headers', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        request(app.getHttpServer() as Server)
          .post('/api/v1/auth/forgot-password')
          .set('X-Forwarded-For', `192.0.2.${i}`)
          .send({ email: `absent-${i}@example.test` }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([202, 202, 202, 429]);
    expect(
      results.find((r) => r.status === 429)?.headers['retry-after'],
    ).toBeDefined();
  });

  it('rejects an expired recovery token', async () => {
    const user = await prisma.usuario.findUniqueOrThrow({
      where: { correo: email },
    });
    const expired = randomBytes(32).toString('base64url');
    await prisma.tokenRecuperacion.create({
      data: {
        id_usuario: user.id_usuario,
        token_hash: createHash('sha256').update(expired).digest('hex'),
        fecha_expiracion: new Date(0),
      },
    });
    await request(app.getHttpServer() as Server)
      .post('/api/v1/auth/reset-password')
      .send({ token: expired, newPassword: original })
      .expect(410);
  });
  it('reports unconfigured image storage without modifying the profile', async () => {
    const before = await prisma.usuario.findUniqueOrThrow({
      where: { correo: email },
    });
    const response = await request(app.getHttpServer() as Server)
      .put('/api/v1/users/me/photo')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('synthetic-image'), {
        filename: 'profile.png',
        contentType: 'image/png',
      })
      .expect(503);
    expect((response.body as { error: string }).error).toBe(
      'MediaStorageNotConfigured',
    );
    const after = await prisma.usuario.findUniqueOrThrow({
      where: { correo: email },
    });
    expect(after.foto_url).toBe(before.foto_url);
    expect(after.foto_public_id).toBe(before.foto_public_id);
  });
  it('searches public visible posts, filters categories and reindexes after edits', async () => {
    const user = await prisma.usuario.findUniqueOrThrow({
      where: { correo: email },
    });
    const category = await prisma.categoria.create({
      data: { nombre: 'Álgebra' },
    });
    const other = await prisma.categoria.create({
      data: { nombre: 'Geometría' },
    });
    const group = await prisma.grupoEstudio.create({
      data: {
        nombre: 'Grupo privado',
        id_categoria: category.id_categoria,
        id_creador: user.id_usuario,
      },
    });
    for (const extra of [
      { estado: 'retenido' as const },
      { estado: 'eliminado' as const },
      { id_grupo: group.id_grupo },
      { id_categoria: other.id_categoria },
    ]) {
      await prisma.publicacion.create({
        data: {
          id_autor: user.id_usuario,
          id_categoria: category.id_categoria,
          titulo: 'Matrices',
          contenido: 'Matrices',
          ...extra,
        },
      });
    }
    const created = await request(app.getHttpServer() as Server)
      .post('/api/v1/posts')
      .set('Cookie', cookie)
      .send({
        title: 'Matrices públicas',
        content: '<p>Determinantes de matrices</p>',
        categoryId: Number(category.id_categoria),
      })
      .expect(201);
    const post = created.body as {
      id: string;
      version: number;
      updatedAt: string | null;
    };
    expect(post.updatedAt).toBeNull();
    const search = await request(app.getHttpServer() as Server)
      .get('/api/v1/posts/search')
      .query({ q: 'matrices', categoryId: category.id_categoria.toString() })
      .expect(200);
    expect(
      (search.body as { items: Array<{ id: string }> }).items.map((p) => p.id),
    ).toEqual([post.id]);
    await request(app.getHttpServer() as Server)
      .patch(`/api/v1/posts/${post.id}`)
      .set('Cookie', cookie)
      .send({
        title: 'Triángulos',
        content: '<p>Geometría triangular</p>',
        version: post.version,
      })
      .expect(200);
    const updated = await request(app.getHttpServer() as Server)
      .get('/api/v1/posts/search')
      .query({ q: 'triángulos' })
      .expect(200);
    expect(
      (updated.body as { items: Array<{ id: string }> }).items.map((p) => p.id),
    ).toEqual([post.id]);
    await request(app.getHttpServer() as Server)
      .get('/api/v1/posts/search')
      .query({ q: 'a' })
      .expect(400);
    await request(app.getHttpServer() as Server)
      .delete(`/api/v1/posts/${post.id}`)
      .set('Cookie', cookie)
      .expect(204);
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/posts/${post.id}`)
      .expect(404);
  });
});
