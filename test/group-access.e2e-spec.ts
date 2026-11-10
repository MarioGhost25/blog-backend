import { CommentsModule } from '../src/comments/comments.module';
import { NotificationsModule } from '../src/notifications/notifications.module';
import { ModerationModule } from '../src/moderation/moderation.module';
import { RealtimeModule } from '../src/realtime/realtime.module';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { BadGatewayException, type INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AuthModule } from '../src/auth/auth.module';
import { AuthRateLimitGuard } from '../src/auth/guards/auth-rate-limit.guard';
import { GroupsModule } from '../src/groups/groups.module';
import { PostsModule } from '../src/posts/posts.module';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { MediaCleanupService } from '../src/posts/media-cleanup.service';
import { AttachmentStorageService } from '../src/posts/attachment-storage.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createApiValidationPipe } from '../src/common/validation/api-validation.pipe';
import { configureHttpSecurity } from '../src/common/security/http-security';

type PageBody = {
  items: { postId: string; user?: { userId: string } }[];
  nextCursor: string | null;
};
type Fixture = {
  a: bigint;
  b: bigint;
  visible: bigint;
  held: bigint;
  foreign: bigint;
  publicPost: bigint;
  image: bigint;
  link: bigint;
  foreignAttachment: bigint;
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('G02 roles, privacy and revocation with real PostgreSQL/HTTP', () => {
  jest.setTimeout(60000);
  const name = `groups_${randomBytes(8).toString('hex')}_test`;
  let admin: Client,
    app: INestApplication,
    prisma: PrismaService,
    databaseUrl: string;
  let secondary: INestApplication;
  const jwtSecret = randomBytes(32).toString('hex');
  let created = false;
  let f: Fixture;
  const cookies = new Map<number, string>();
  const asset = {
    url: 'https://assets.example.test/upload.png',
    publicId: 'synthetic/upload',
  };
  let png: Buffer;
  const storage = {
    upload: jest.fn<Promise<typeof asset>, unknown[]>(),
    delete: jest.fn<Promise<void>, unknown[]>(),
    read: jest.fn<Promise<Buffer>, unknown[]>(),
  };
  const http = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    actor?: number,
  ) => {
    const call = request(app.getHttpServer() as Server)[method](
      `/api/v1${path}`,
    );
    if (method === 'delete' && /^\/posts\/\d+$/.test(path))
      call.send({ observation: 'Synthetic moderation reason' });
    return actor === undefined ? call : call.set('Cookie', cookies.get(actor)!);
  };
  const resetRates = () => app.get(AuthRateLimitGuard).onModuleDestroy();

  beforeAll(async () => {
    png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
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
      throw new Error(
        'Use only docker-compose.test.yml on 127.0.0.1:55432/blog_test',
      );
    }
    admin = new Client({ connectionString: url.href });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    created = true;
    url.pathname = `/${name}`;
    databaseUrl = url.href;
    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      for (const migration of readdirSync('prisma/migrations')
        .filter((x) => /^\d/.test(x))
        .sort()) {
        await db.query(
          readFileSync(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
        );
      }
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
              DATABASE_URL: databaseUrl,
              JWT_SECRET: jwtSecret,
              FRONTEND_URL: 'http://localhost:3000',
              NODE_ENV: 'test',
            }),
          ],
        }),
        AuthModule,
        GroupsModule,
        CommentsModule,
        NotificationsModule,
        ModerationModule,
        RealtimeModule,
        PostsModule,
      ],
    })
      .overrideProvider(AttachmentStorageService)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    configureHttpSecurity(app);
    app.use(cookieParser());
    app.useGlobalPipes(createApiValidationPipe());
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.listen(0, '127.0.0.1');
    const secondModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DATABASE_URL: databaseUrl,
              JWT_SECRET: jwtSecret,
              FRONTEND_URL: 'http://localhost:3000',
              NODE_ENV: 'test',
            }),
          ],
        }),
        AuthModule,
        PostsModule,
        RealtimeModule,
      ],
    })
      .overrideProvider(AttachmentStorageService)
      .useValue(storage)
      .compile();
    secondary = secondModule.createNestApplication({ logger: false });
    await secondary.init();
    await secondary.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    for (let id = 1; id <= 10; id++) {
      const role = [6, 9].includes(id) ? 'administrador' : 'usuario';
      const status = id === 10 ? 'suspendido' : 'activo';
      const user = await prisma.usuario.create({
        data: {
          nombre: `Person${id}`,
          apellido: 'Synthetic',
          correo: `secret-contact-${id}@example.test`,
          contrasena_hash: 'unused',
          rol: role,
          estado: status,
          ...(status === 'suspendido'
            ? {
                suspendido_hasta: new Date(Date.now() + 86400000),
                motivo_suspension: 'Synthetic suspension',
                suspendido_por: 6n,
              }
            : {}),
        },
      });
      expect(user.id_usuario).toBe(BigInt(id));
      cookies.set(
        id,
        `jwt=${await app.get(JwtService).signAsync({ sub: String(id), role, status })}`,
      );
    }
    await prisma.categoria.create({ data: { nombre: 'Synthetic category' } });
  });
  beforeEach(async () => {
    if (!app) return;
    resetRates();
    await prisma.usuario.updateMany({
      where: { id_usuario: { not: 10n } },
      data: {
        estado: 'activo',
        suspendido_hasta: null,
        suspendido_por: null,
        motivo_suspension: null,
      },
    });
    storage.upload.mockReset().mockResolvedValue(asset);
    storage.delete.mockReset().mockResolvedValue(undefined);
    storage.read.mockReset().mockResolvedValue(png);
    await prisma.activoMultimedia.deleteMany();
    await prisma.revisionContenido.deleteMany();
    // This database was created by this suite; no development data can reach it.
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE grupo_estudio, publicacion RESTART IDENTITY CASCADE',
    );
    const a = await prisma.grupoEstudio.create({
      data: { nombre: 'Group Alpha', id_categoria: 1n, id_creador: 1n },
    });
    const b = await prisma.grupoEstudio.create({
      data: { nombre: 'Group Beta', id_categoria: 1n, id_creador: 8n },
    });
    await prisma.miembroGrupo.createMany({
      data: [
        { id_grupo: a.id_grupo, id_usuario: 1n, rol: 'administrador' },
        { id_grupo: a.id_grupo, id_usuario: 2n, rol: 'miembro' },
        { id_grupo: a.id_grupo, id_usuario: 3n, rol: 'miembro' },
        { id_grupo: a.id_grupo, id_usuario: 4n, rol: 'moderador' },
        { id_grupo: a.id_grupo, id_usuario: 7n, rol: 'administrador' },
        { id_grupo: a.id_grupo, id_usuario: 9n, rol: 'miembro' },
        { id_grupo: b.id_grupo, id_usuario: 8n, rol: 'administrador' },
      ],
    });
    const seedPost = (
      authorId: bigint,
      groupId: bigint | null,
      title: string,
      held = false,
    ) =>
      prisma.publicacion.create({
        data: {
          id_autor: authorId,
          id_grupo: groupId,
          id_categoria: 1n,
          titulo: title,
          contenido: `<p>${title}</p>`,
          estado: held ? 'retenido' : 'visible',
        },
      });
    const visible = await seedPost(2n, a.id_grupo, 'GROUP_SECRET_ALPHA');
    const held = await seedPost(2n, a.id_grupo, 'GROUP_HELD_SECRET', true);
    const foreign = await seedPost(8n, b.id_grupo, 'GROUP_SECRET_BETA');
    const publicPost = await seedPost(2n, null, 'PUBLIC_CONTENT');
    await seedPost(2n, null, 'PUBLIC_HELD', true);
    const image = await prisma.adjunto.create({
      data: {
        id_publicacion: visible.id_publicacion,
        tipo: 'imagen',
        titulo: 'Group image',
        url: 'https://assets.example.test/group.png',
        cloudinary_public_id: 'synthetic/existing',
        orden: 1,
      },
    });
    const link = await prisma.adjunto.create({
      data: {
        id_publicacion: visible.id_publicacion,
        tipo: 'enlace',
        titulo: 'Group link',
        url: 'https://example.test/resource',
        orden: 2,
      },
    });
    const foreignAttachment = await prisma.adjunto.create({
      data: {
        id_publicacion: foreign.id_publicacion,
        tipo: 'enlace',
        titulo: 'Other group link',
        url: 'https://example.test/other',
        orden: 1,
      },
    });
    f = {
      a: a.id_grupo,
      b: b.id_grupo,
      visible: visible.id_publicacion,
      held: held.id_publicacion,
      foreign: foreign.id_publicacion,
      publicPost: publicPost.id_publicacion,
      image: image.id_adjunto,
      link: link.id_adjunto,
      foreignAttachment: foreignAttachment.id_adjunto,
    };
  });
  afterAll(async () => {
    if (secondary) await secondary.close();
    if (app) await app.close();
    if (created) await admin.query(`DROP DATABASE ${name}`);
    if (admin) await admin.end();
  });

  it.each([
    {
      actor: 1,
      label: 'local administrator',
      member: true,
      manage: true,
      moderate: true,
      author: false,
    },
    {
      actor: 2,
      label: 'member/author',
      member: true,
      manage: false,
      moderate: false,
      author: true,
    },
    {
      actor: 3,
      label: 'member/non-author',
      member: true,
      manage: false,
      moderate: false,
      author: false,
    },
    {
      actor: 4,
      label: 'local moderator',
      member: true,
      manage: false,
      moderate: true,
      author: false,
    },
    {
      actor: 5,
      label: 'non-member',
      member: false,
      manage: false,
      moderate: false,
      author: false,
    },
    {
      actor: 6,
      label: 'global administrator/non-member',
      member: false,
      manage: false,
      moderate: true,
      author: false,
    },
    {
      actor: 8,
      label: 'administrator of another group',
      member: false,
      manage: false,
      moderate: false,
      author: false,
    },
    {
      actor: 9,
      label: 'global administrator/ordinary member',
      member: true,
      manage: false,
      moderate: true,
      author: false,
    },
  ])(
    'enforces the HTTP matrix for $label',
    async ({ actor, member, manage, moderate, author }) => {
      await http('get', `/groups/${f.a}`, actor).expect(200);
      await http('get', `/groups/${f.a}/members`, actor).expect(
        member ? 200 : 403,
      );
      await http('get', `/posts/group/${f.a}`, actor).expect(
        member || moderate ? 200 : 403,
      );
      await http('get', `/posts/${f.visible}`, actor).expect(
        member || moderate ? 200 : 403,
      );
      await http('get', `/posts/${f.held}`, actor).expect(
        author || moderate ? 200 : 403,
      );
      await http('post', '/posts', actor)
        .send({
          title: 'Group contribution',
          content: '<p>Text</p>',
          categoryId: 1,
          groupId: Number(f.a),
        })
        .expect(member ? 201 : 403);
      await http('patch', `/posts/${f.visible}`, actor)
        .send({ title: 'Author edit', version: 1 })
        .expect(author ? 200 : 403);
      await http('patch', `/posts/${f.visible}/attachments/order`, actor)
        .send({ attachmentIds: [Number(f.link), Number(f.image)] })
        .expect(author ? 200 : 403);
      await http(
        'delete',
        `/posts/${f.visible}/attachments/${f.image}`,
        actor,
      ).expect(author ? 204 : 403);
      await http('post', `/posts/${f.visible}/attachments`, actor)
        .send({
          type: 'link',
          title: 'Added link',
          url: 'https://example.test/new',
        })
        .expect(author ? 201 : 403);
      await http('patch', `/groups/${f.a}/members/3`, actor)
        .send({ role: 'moderator' })
        .expect(manage ? 200 : 403);
      await http('delete', `/groups/${f.a}/members/3`, actor).expect(
        manage ? 204 : 403,
      );
      await http('delete', `/posts/${f.visible}`, actor).expect(
        author || moderate ? 204 : 403,
      );
    },
  );

  it('rejects visitors/suspended accounts and keeps public reading independent of membership', async () => {
    for (const path of [
      '/groups',
      `/groups/${f.a}/members`,
      `/posts/group/${f.a}`,
    ])
      await http('get', path).expect(401);
    await http('get', `/posts/${f.visible}`).expect(403);
    await http('get', `/posts/${f.publicPost}`).expect(200);
    await http('get', `/groups/${f.a}/members`, 10).expect(403);
    await http('post', '/posts', 10)
      .send({
        title: 'Denied suspended',
        content: '<p>Text</p>',
        categoryId: 1,
        groupId: Number(f.a),
      })
      .expect(403);
    await http('post', '/posts', 6)
      .send({
        title: 'Public administrator post',
        content: '<p>Text</p>',
        categoryId: 1,
      })
      .expect(201);
  });

  it('does not return or search member email and paginates using public identifiers', async () => {
    const members = await http(
      'get',
      `/groups/${f.a}/members?limit=2`,
      2,
    ).expect(200);
    expect(JSON.stringify(members.body)).not.toMatch(
      /email|correo|secret-contact/,
    );
    expect(members.headers['cache-control']).toBe('private, no-store');
    expect(members.headers.vary).toContain('Cookie');
    const page = members.body as PageBody;
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();
    const next = await http(
      'get',
      `/groups/${f.a}/members?limit=2&cursor=${page.nextCursor}`,
      2,
    ).expect(200);
    const ids = [...page.items, ...(next.body as PageBody).items].map(
      (row) => row.user!.userId,
    );
    expect(new Set(ids).size).toBe(4);
    for (const q of ['secret-contact-2', 'secret-contact-2@example.test']) {
      const result = await http(
        'get',
        `/groups/${f.a}/members?q=${encodeURIComponent(q)}`,
        2,
      ).expect(200);
      expect((result.body as PageBody).items).toEqual([]);
      expect((result.body as PageBody).nextCursor).toBeNull();
    }
    const byName = await http(
      'get',
      `/groups/${f.a}/members?q=Person2`,
      2,
    ).expect(200);
    expect(
      (byName.body as PageBody).items.map((row) => row.user!.userId),
    ).toEqual(['2']);
  });

  it.each(['expulsion', 'leave'] as const)(
    'removes authors after %s from private reads, edits, attachment actions, own lists and counts',
    async (action) => {
      await http(
        'delete',
        `/groups/${f.a}/members/${action === 'leave' ? 'me' : '2'}`,
        action === 'leave' ? 2 : 1,
      ).expect(204);
      for (const path of [
        `/posts/group/${f.a}`,
        `/posts/${f.visible}`,
        `/posts/${f.held}`,
      ])
        await http('get', path, 2).expect(403);
      await http('patch', `/posts/${f.visible}`, 2)
        .send({ title: 'Revoked edit', version: 1 })
        .expect(403);
      await http('delete', `/posts/${f.visible}`, 2).expect(403);
      await http('post', `/posts/${f.visible}/attachments`, 2)
        .send({
          type: 'link',
          title: 'Revoked link',
          url: 'https://example.test/denied',
        })
        .expect(403);
      await http(
        'delete',
        `/posts/${f.visible}/attachments/${f.image}`,
        2,
      ).expect(403);
      const mine = await http('get', '/users/me/posts', 2).expect(200);
      expect(mine.headers['cache-control']).toBe('private, no-store');
      expect(mine.headers.vary).toContain('Cookie');
      expect((mine.body as PageBody).items).toHaveLength(2);
      expect(JSON.stringify(mine.body)).not.toContain('GROUP_');
      const profile = await http('get', '/users/me', 2).expect(200);
      expect(profile.headers['cache-control']).toBe('private, no-store');
      expect(profile.body).toMatchObject({ _count: { posts: 2 } });
      const publicProfile = await http('get', '/users/2').expect(200);
      expect(publicProfile.body).toMatchObject({ _count: { posts: 1 } });
      expect(storage.upload).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
      // Rejoining is allowed by the existing product policy; it grants member,
      // never restores an old elevated role implicitly.
      const joined = await http('post', `/groups/${f.a}/members`, 2).expect(
        201,
      );
      expect(joined.body).toMatchObject({ role: 'member' });
      await http('get', `/posts/${f.held}`, 2).expect(200);
    },
  );

  it('hides group publications from the public feed/search and public profile counts even while joined', async () => {
    const mine = await http('get', '/users/me/posts', 2).expect(200);
    expect((mine.body as PageBody).items).toHaveLength(4);
    const profile = await http('get', '/users/2').expect(200);
    expect(profile.body).toMatchObject({ _count: { posts: 1 } });
    for (const path of ['/posts', '/posts/search?q=GROUP']) {
      const feed = await http('get', path).expect(200);
      expect(JSON.stringify(feed.body)).not.toContain('GROUP_');
    }
  });

  it('rejects foreign attachment IDs before any provider action', async () => {
    await http(
      'delete',
      `/posts/${f.visible}/attachments/${f.foreignAttachment}`,
      2,
    ).expect(404);
    expect(storage.delete).not.toHaveBeenCalled();
    expect(
      await prisma.adjunto.count({
        where: { id_adjunto: f.foreignAttachment },
      }),
    ).toBe(1);
  });

  it('serializes duplicate joins into one membership', async () => {
    const results = await Promise.all([
      http('post', `/groups/${f.a}/members`, 5),
      http('post', `/groups/${f.a}/members`, 5),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.miembroGrupo.count({
        where: { id_grupo: f.a, id_usuario: 5n },
      }),
    ).toBe(1);
  });

  it('keeps one administrator when both administrators leave concurrently', async () => {
    const results = await Promise.all(
      [1, 7].map((actor) => http('delete', `/groups/${f.a}/members/me`, actor)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(
      await prisma.miembroGrupo.count({
        where: { id_grupo: f.a, rol: 'administrador' },
      }),
    ).toBe(1);
  });

  it('keeps one administrator when both demote themselves concurrently', async () => {
    const results = await Promise.all(
      [1, 7].map((actor) =>
        http('patch', `/groups/${f.a}/members/${actor}`, actor).send({
          role: 'member',
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.miembroGrupo.count({
        where: { id_grupo: f.a, rol: 'administrador' },
      }),
    ).toBe(1);
  });

  it('rechecks management roles when administrators expel each other concurrently', async () => {
    const results = await Promise.all([
      http('delete', `/groups/${f.a}/members/7`, 1),
      http('delete', `/groups/${f.a}/members/1`, 7),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([204, 403]);
    expect(
      await prisma.miembroGrupo.count({
        where: { id_grupo: f.a, rol: 'administrador' },
      }),
    ).toBe(1);
  });

  it.each([false, true])(
    'transfers the last administration atomically with leave=%s',
    async (leave) => {
      await http('delete', `/groups/${f.a}/members/7`, 1).expect(204);
      await http('post', `/groups/${f.a}/transfer`, 1)
        .send({ newAdministratorId: '3', leave })
        .expect(204);
      const admins = await prisma.miembroGrupo.findMany({
        where: { id_grupo: f.a, rol: 'administrador' },
      });
      expect(admins.map((row) => row.id_usuario)).toEqual([3n]);
      const previous = await prisma.miembroGrupo.findUnique({
        where: { id_grupo_id_usuario: { id_grupo: f.a, id_usuario: 1n } },
      });
      expect(previous?.rol ?? null).toBe(leave ? null : 'miembro');
    },
  );

  it('rejects global-only/member transfers, self-transfer and non-member recipients', async () => {
    for (const actor of [2, 6, 9])
      await http('post', `/groups/${f.a}/transfer`, actor)
        .send({ newAdministratorId: '3', leave: true })
        .expect(403);
    for (const newAdministratorId of ['1', '5'])
      await http('post', `/groups/${f.a}/transfer`, 1)
        .send({ newAdministratorId, leave: true })
        .expect(400);
    expect(
      await prisma.miembroGrupo.count({
        where: { id_grupo: f.a, rol: 'administrador' },
      }),
    ).toBe(2);
  });

  it.each([false, true])(
    'allows only one concurrent transfer by the same last administrator with leave=%s',
    async (leave) => {
      await http('delete', `/groups/${f.a}/members/7`, 1).expect(204);
      const results = await Promise.all(
        ['3', '4'].map((newAdministratorId) =>
          http('post', `/groups/${f.a}/transfer`, 1).send({
            newAdministratorId,
            leave,
          }),
        ),
      );
      expect(results.map((result) => result.status).sort()).toEqual([204, 403]);
      const admins = await prisma.miembroGrupo.findMany({
        where: { id_grupo: f.a, rol: 'administrador' },
      });
      expect(admins).toHaveLength(1);
      expect([3n, 4n]).toContain(admins[0].id_usuario);
      const previous = await prisma.miembroGrupo.findUnique({
        where: { id_grupo_id_usuario: { id_grupo: f.a, id_usuario: 1n } },
      });
      expect(previous?.rol ?? null).toBe(leave ? null : 'miembro');
    },
  );

  async function waitUntilBlocked(blockerPid: number) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      const waits = await admin.query(
        'SELECT 1 FROM pg_stat_activity WHERE datname=$1 AND $2=ANY(pg_blocking_pids(pid))',
        [name, blockerPid],
      );
      if (waits.rowCount) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('The content operation did not wait for the group lock');
  }

  it.each([
    'create',
    'edit',
    'delete',
    'attach',
    'reorder',
    'remove-attachment',
    'read-post',
    'read-feed',
    'read-members',
  ] as const)(
    'rechecks membership after a concurrent revocation wins against %s',
    async (action) => {
      const holder = new Client({ connectionString: databaseUrl });
      await holder.connect();
      await holder.query('BEGIN');
      await holder.query(
        'SELECT id_grupo FROM grupo_estudio WHERE id_grupo=$1 FOR UPDATE',
        [f.a.toString()],
      );
      const pid = (
        await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      ).rows[0].pid;
      const calls = {
        create: () =>
          http('post', '/posts', 2).send({
            title: 'Race create',
            content: '<p>Text</p>',
            categoryId: 1,
            groupId: Number(f.a),
          }),
        edit: () =>
          http('patch', `/posts/${f.visible}`, 2).send({
            title: 'Race edit',
            version: 1,
          }),
        delete: () => http('delete', `/posts/${f.visible}`, 2),
        attach: () =>
          http('post', `/posts/${f.visible}/attachments`, 2).send({
            type: 'link',
            title: 'Race link',
            url: 'https://example.test/race',
          }),
        reorder: () =>
          http('patch', `/posts/${f.visible}/attachments/order`, 2).send({
            attachmentIds: [Number(f.link), Number(f.image)],
          }),
        'remove-attachment': () =>
          http('delete', `/posts/${f.visible}/attachments/${f.image}`, 2),
        'read-post': () => http('get', `/posts/${f.visible}`, 2),
        'read-feed': () => http('get', `/posts/group/${f.a}`, 2),
        'read-members': () => http('get', `/groups/${f.a}/members`, 2),
      };
      const pending = calls[action]().then(
        (response) => ({ response }),
        (error: unknown) => ({ error }),
      );
      try {
        await waitUntilBlocked(pid);
        await holder.query(
          'DELETE FROM miembro_grupo WHERE id_grupo=$1 AND id_usuario=2',
          [f.a.toString()],
        );
        await holder.query('COMMIT');
        const result = await pending;
        if ('error' in result) throw result.error;
        expect(result.response.status).toBe(403);
        const post = await prisma.publicacion.findUniqueOrThrow({
          where: { id_publicacion: f.visible },
        });
        expect(post).toMatchObject({
          titulo: 'GROUP_SECRET_ALPHA',
          version: 1,
          estado: 'visible',
        });
        expect(await prisma.publicacion.count()).toBe(5);
        const attachments = await prisma.adjunto.findMany({
          where: { id_publicacion: f.visible },
          orderBy: { orden: 'asc' },
        });
        expect(attachments.map((row) => row.id_adjunto)).toEqual([
          f.image,
          f.link,
        ]);
        expect(storage.delete).not.toHaveBeenCalled();
      } finally {
        await holder.query('ROLLBACK');
        await holder.end();
        await pending;
      }
    },
  );

  it('rechecks an administrator demoted while its management request waits', async () => {
    const holder = new Client({ connectionString: databaseUrl });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query(
      'SELECT id_grupo FROM grupo_estudio WHERE id_grupo=$1 FOR UPDATE',
      [f.a.toString()],
    );
    const pid = (
      await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    ).rows[0].pid;
    const pending = http('patch', `/groups/${f.a}/members/3`, 7)
      .send({ role: 'administrator' })
      .then((response) => response);
    try {
      await waitUntilBlocked(pid);
      await holder.query(
        "UPDATE miembro_grupo SET rol='miembro' WHERE id_grupo=$1 AND id_usuario=7",
        [f.a.toString()],
      );
      await holder.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect(
        (
          await prisma.miembroGrupo.findUniqueOrThrow({
            where: { id_grupo_id_usuario: { id_grupo: f.a, id_usuario: 3n } },
          })
        ).rol,
      ).toBe('miembro');
    } finally {
      await holder.query('ROLLBACK');
      await holder.end();
      await pending;
    }
  });

  it('lets revocation finish during upload and durably queues the unlinked asset', async () => {
    const entered = deferred<void>(),
      complete = deferred<typeof asset>();
    storage.upload.mockImplementationOnce(() => {
      entered.resolve();
      return complete.promise;
    });
    const pending = http('post', `/posts/${f.visible}/attachments`, 2)
      .field('type', 'image')
      .field('title', 'In-flight image')
      .attach('file', png, {
        filename: 'test.png',
        contentType: 'image/png',
      })
      .then((response) => response);
    try {
      await entered.promise;
      // This must complete while the provider is still pending: no group lock
      // may be held during the external call.
      await http('delete', `/groups/${f.a}/members/2`, 1).expect(204);
    } finally {
      complete.resolve(asset);
    }
    expect((await pending).status).toBe(403);
    const orphan = await prisma.activoMultimedia.findFirstOrThrow({
      where: { estado: 'pending' },
    });
    expect(storage.delete).not.toHaveBeenCalled();
    await prisma.activoMultimedia.update({
      where: { public_id: orphan.public_id },
      data: { siguiente_intento: new Date(0) },
    });
    await app.get(MediaCleanupService).sweep();
    expect(storage.delete).toHaveBeenCalledWith(
      orphan.public_id,
      'image',
      'authenticated',
    );
    expect(await prisma.activoMultimedia.count()).toBe(0);
    expect(
      await prisma.adjunto.count({
        where: { cloudinary_public_id: asset.publicId },
      }),
    ).toBe(0);
  });

  it('commits authorized unlinking before provider cleanup and releases locks during that cleanup', async () => {
    const entered = deferred<void>(),
      complete = deferred<void>();
    storage.delete.mockImplementationOnce(() => {
      entered.resolve();
      return complete.promise;
    });
    const pending = http(
      'delete',
      `/posts/${f.visible}/attachments/${f.image}`,
      2,
    ).then((response) => response);
    try {
      await entered.promise;
      expect(
        await prisma.adjunto.count({ where: { id_adjunto: f.image } }),
      ).toBe(0);
      await http('delete', `/groups/${f.a}/members/2`, 1).expect(204);
    } finally {
      complete.resolve();
    }
    expect((await pending).status).toBe(204);
  });

  it('retains a failed provider deletion durably without undoing the committed unlink', async () => {
    storage.delete.mockRejectedValueOnce(
      new BadGatewayException('MediaStorageUnavailable'),
    );
    await http(
      'delete',
      `/posts/${f.visible}/attachments/${f.image}`,
      2,
    ).expect(204);
    const retry = await prisma.activoMultimedia.findUniqueOrThrow({
      where: { public_id: 'synthetic/existing' },
    });
    expect(retry.estado).toBe('deleting');
    expect(retry.intentos).toBe(1);
    expect(await prisma.adjunto.count({ where: { id_adjunto: f.image } })).toBe(
      0,
    );
    const detail = await http('get', `/posts/${f.visible}`, 2).expect(200);
    expect(
      (detail.body as { attachments: { id: string }[] }).attachments,
    ).toHaveLength(1);
    await http(
      'delete',
      `/posts/${f.visible}/attachments/${f.image}`,
      2,
    ).expect(404);
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });

  it('delivers private image bytes only to current readers and strips provider details', async () => {
    const response = await http('post', `/posts/${f.visible}/attachments`, 2)
      .field('type', 'image')
      .field('title', 'Private image')
      .attach('file', png, { filename: 'image.png', contentType: 'image/png' })
      .expect(201);
    const attachment = response.body as { id: string; url: string };
    expect(response.body).not.toHaveProperty('cloudinaryPublicId');
    expect(response.body).not.toHaveProperty('delivery');
    expect(attachment.url).toBe(
      `/api/v1/posts/${f.visible}/attachments/${attachment.id}/content`,
    );
    const path = attachment.url.replace('/api/v1', '');
    await http('get', path).expect(403);
    await http('get', path, 5).expect(403);
    const allowed = await http('get', path, 2).expect(200);
    expect(allowed.headers['cache-control']).toContain('no-store');
    expect(allowed.body).toEqual(png);
    await http('delete', `/groups/${f.a}/members/2`, 1).expect(204);
    await http('get', path, 2).expect(403);
    await http('get', path, 6).expect(200);
    await http('delete', `/posts/${f.visible}`, 6).expect(204);
    await http('get', path, 6).expect(404);
  });

  it('rechecks membership after fetching bytes from a slow provider', async () => {
    const upload = await http('post', `/posts/${f.visible}/attachments`, 2)
      .field('type', 'image')
      .field('title', 'Private image')
      .attach('file', png, { filename: 'image.png', contentType: 'image/png' })
      .expect(201);
    const { url } = upload.body as { url: string };
    const entered = deferred<void>(),
      done = deferred<Buffer>();
    storage.read.mockImplementationOnce(() => {
      entered.resolve();
      return done.promise;
    });
    const pending = http('get', url.replace('/api/v1', ''), 2).then((r) => r);
    try {
      await entered.promise;
      await http('delete', `/groups/${f.a}/members/2`, 1).expect(204);
    } finally {
      done.resolve(png);
    }
    expect((await pending).status).toBe(403);
  });

  it('hides legacy group URLs and requires migration instead of serving their public originals', async () => {
    const response = await http('get', `/posts/${f.visible}`, 2).expect(200);
    expect(JSON.stringify(response.body)).not.toContain('assets.example.test');
    await http(
      'get',
      `/posts/${f.visible}/attachments/${f.image}/content`,
      2,
    ).expect(410);
    expect(storage.read).not.toHaveBeenCalled();
  });

  it('validates real bytes and extensions before contacting storage, and accepts a parsed PDF', async () => {
    for (const [buffer, filename, mime, type] of [
      [Buffer.from('<html>bad</html>'), 'image.png', 'image/png', 'image'],
      [png, 'image.jpg', 'image/jpeg', 'image'],
      [png, 'image.exe', 'image/png', 'image'],
      [
        Buffer.from('%PDF-1.7 invalid'),
        'file.pdf',
        'application/pdf',
        'document',
      ],
    ] as const) {
      await http('post', `/posts/${f.visible}/attachments`, 2)
        .field('type', type)
        .field('title', 'Invalid')
        .attach('file', buffer, { filename, contentType: mime })
        .expect(415);
    }
    expect(storage.upload).not.toHaveBeenCalled();
    const pdf = await PDFDocument.create();
    pdf.addPage();
    await http('post', `/posts/${f.visible}/attachments`, 2)
      .field('type', 'document')
      .field('title', 'Valid PDF')
      .attach('file', Buffer.from(await pdf.save()), {
        filename: 'file.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    expect(
      await prisma.activoMultimedia.count({ where: { estado: 'linked' } }),
    ).toBe(1);
  });

  it('recovers expired upload intents and retries deletion on a later sweep', async () => {
    const cleanup = app.get(MediaCleanupService);
    const id = await cleanup.begin('image');
    await prisma.activoMultimedia.update({
      where: { public_id: id },
      data: { siguiente_intento: new Date(0) },
    });
    storage.delete.mockRejectedValueOnce(new Error('Provider offline'));
    await cleanup.sweep();
    expect(
      (
        await prisma.activoMultimedia.findUniqueOrThrow({
          where: { public_id: id },
        })
      ).intentos,
    ).toBe(1);
    await prisma.activoMultimedia.update({
      where: { public_id: id },
      data: { siguiente_intento: new Date(0) },
    });
    await Promise.all([cleanup.cleanup(id), cleanup.cleanup(id)]);
    expect(await prisma.activoMultimedia.count()).toBe(0);
    expect(storage.delete).toHaveBeenCalledTimes(2);
  });

  it('combines only public posts and current memberships with stable pagination, including global admins', async () => {
    const first = await http('get', '/users/me/feed?limit=1', 2).expect(200);
    expect(first.headers['cache-control']).toContain('no-store');
    expect(
      (first.body as { items: { id: string }[] }).items.map((p) => p.id),
    ).toEqual([String(f.publicPost)]);
    const second = await http(
      'get',
      `/users/me/feed?limit=1&cursor=${String(f.publicPost)}`,
      2,
    ).expect(200);
    expect(
      (second.body as { items: { id: string }[] }).items.map((p) => p.id),
    ).toEqual([String(f.visible)]);
    for (const actor of [5, 6]) {
      const feed = await http('get', '/users/me/feed', actor).expect(200);
      expect(
        (feed.body as { items: { id: string }[] }).items.map((p) => p.id),
      ).toEqual([String(f.publicPost)]);
    }
    await http('delete', `/groups/${f.a}/members/2`, 1).expect(204);
    const after = await http('get', '/users/me/feed', 2).expect(200);
    expect(
      (after.body as { items: { id: string }[] }).items.map((p) => p.id),
    ).toEqual([String(f.publicPost)]);
  });

  it('uses durable receipts for group creation and edits without bypassing membership', async () => {
    const key = 'f240207a-c326-4e20-b647-ab91bc5d0001';
    const send = () =>
      http('post', '/posts', 2)
        .set('Idempotency-Key', key)
        .set('X-Post-Owner', '2')
        .send({
          title: 'Group receipt',
          content: '<p>Content</p>',
          categoryId: 1,
          groupId: Number(f.a),
        });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body).toEqual(b.body);
    expect(
      await prisma.publicacion.count({ where: { titulo: 'Group receipt' } }),
    ).toBe(1);
    await http('delete', `/groups/${f.a}/members/2`, 1).expect(204);
    const id = (a.body as { postId: string }).postId;
    await http('patch', `/posts/${id}`, 2)
      .set('Idempotency-Key', 'f240207a-c326-4e20-b647-ab91bc5d0002')
      .set('X-Post-Owner', '2')
      .send({ version: 1, title: 'Revoked edit' })
      .expect(403);
  });

  it('creates visible comments/replies with deduplicated transactional notifications and neutral tombstones', async () => {
    const first = await http('post', `/posts/${f.visible}/comments`, 3)
      .send({ content: 'Una duda interesante' })
      .expect(201);
    const id = (first.body as { id: string }).id;
    expect(
      await prisma.notificacion.count({
        where: { id_destinatario: 2n, tipo: 'comentario' },
      }),
    ).toBe(1);
    const reply = await http('post', `/posts/${f.visible}/comments`, 2)
      .send({ content: 'Respuesta a la duda', parentCommentId: id })
      .expect(201);
    expect(reply.body).toMatchObject({
      parent: { id, content: 'Una duda interesante' },
    });
    expect(
      await prisma.notificacion.count({
        where: { id_destinatario: 3n, tipo: 'respuesta' },
      }),
    ).toBe(1);
    expect(
      await prisma.notificacion.count({
        where: { id_destinatario: 2n, tipo: 'respuesta' },
      }),
    ).toBe(0);
    await http('delete', `/comments/${id}`, 3).expect(204);
    const page = await http('get', `/posts/${f.visible}/comments`, 2).expect(
      200,
    );
    const items = (
      page.body as {
        items: {
          id: string;
          content: string | null;
          parent: { content: string | null } | null;
        }[];
      }
    ).items;
    expect(items.find((c) => c.id === id)?.content).toBeNull();
    expect(
      items.find((c) => c.id === (reply.body as { id: string }).id)?.parent
        ?.content,
    ).toBeNull();
    expect((await http('get', `/posts/${f.visible}`, 2)).body).toMatchObject({
      commentCount: 1,
    });
  });

  it('rejects crossed replies, forged membership, empty/long content and writes in retained posts', async () => {
    const first = await http('post', `/posts/${f.publicPost}/comments`, 3)
      .send({ content: 'Public parent' })
      .expect(201);
    await http('post', `/posts/${f.visible}/comments`, 3)
      .send({
        content: 'Crossed reply',
        parentCommentId: (first.body as { id: string }).id,
      })
      .expect(400);
    await http('post', `/posts/${f.visible}/comments`, 5)
      .send({ content: 'Not a member' })
      .expect(403);
    await http('post', `/posts/${f.visible}/comments`, 10)
      .send({ content: 'Suspended' })
      .expect(403);
    await http('post', `/posts/${f.held}/comments`, 2)
      .send({ content: 'Not yet visible' })
      .expect(403);
    for (const content of ['  ', '<script>bad()</script>', 'x'.repeat(2001)])
      await http('post', `/posts/${f.visible}/comments`, 3)
        .send({ content })
        .expect(400);
    await http('post', `/posts/${f.publicPost}/comments`, 3)
      .send({ content: 'x'.repeat(2000) })
      .expect(201);
  });

  it('keeps filtered comments private until a scoped moderator publishes them once', async () => {
    const held = await http('post', `/posts/${f.visible}/comments`, 3)
      .send({ content: 'Esto es una mierda' })
      .expect(201);
    const id = (held.body as { id: string }).id;
    expect(held.body).toMatchObject({ status: 'retenido' });
    expect(await prisma.notificacion.count()).toBe(0);
    expect(
      (await http('get', `/posts/${f.visible}/comments`, 2)).body,
    ).toMatchObject({ items: [] });
    const queue = await http(
      'get',
      `/moderation/retained?type=comment&groupId=${f.a}`,
      4,
    ).expect(200);
    expect(
      (queue.body as { items: { id: string }[] }).items.map((c) => c.id),
    ).toContain(id);
    await http('patch', `/moderation/retained/comment/${id}`, 8)
      .send({ decision: 'publish' })
      .expect(403);
    await http('patch', `/moderation/retained/comment/${id}`, 4)
      .send({ decision: 'publish' })
      .expect(204);
    await http('patch', `/moderation/retained/comment/${id}`, 4)
      .send({ decision: 'publish' })
      .expect(409);
    expect(
      await prisma.notificacion.count({ where: { tipo: 'comentario' } }),
    ).toBe(1);
  });

  it('rolls comments back when their notification fails', async () => {
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION fail_comment_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tipo = 'comentario' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$",
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER fail_comment_notice BEFORE INSERT ON notificacion FOR EACH ROW EXECUTE FUNCTION fail_comment_notice()',
    );
    try {
      await http('post', `/posts/${f.visible}/comments`, 3)
        .send({ content: 'Must roll back' })
        .expect(500);
      expect(await prisma.comentario.count()).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER fail_comment_notice ON notificacion',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION fail_comment_notice()');
    }
  });

  it('requires an observation for another author comment and records moderation atomically', async () => {
    const row = await http('post', `/posts/${f.visible}/comments`, 3)
      .send({ content: 'A comment to moderate' })
      .expect(201);
    const id = (row.body as { id: string }).id;
    await http('delete', `/comments/${id}`, 4).send({}).expect(400);
    await http('delete', `/comments/${id}`, 8)
      .send({ observation: 'A valid reason' })
      .expect(403);
    await http('delete', `/comments/${id}`, 4)
      .send({ observation: 'A valid reason' })
      .expect(204);
    expect(
      await prisma.revisionContenido.count({
        where: { tipo: 'comment', id_contenido: BigInt(id) },
      }),
    ).toBe(1);
    expect(
      await prisma.notificacion.count({
        where: { tipo: 'contenido_retirado', id_destinatario: 3n },
      }),
    ).toBe(1);
  });

  it('creates one report under concurrent requests and restricts queue/resolution to the current scope', async () => {
    const send = () =>
      http('post', '/reports', 3).send({
        postId: String(f.visible),
        reason: 'Revisar la fuente de este contenido',
      });
    const results = await Promise.all([send(), send()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const id = (results.find((r) => r.status === 201)!.body as { id: string })
      .id;
    await http('post', '/reports', 5)
      .send({ postId: String(f.visible), reason: 'No tengo acceso' })
      .expect(403);
    expect((await http('get', '/moderation/reports', 8)).body).toMatchObject({
      items: [],
    });
    await http('patch', `/moderation/reports/${id}`, 8)
      .send({ decision: 'desestimado', observation: 'Fuera de mi ámbito' })
      .expect(403);
    const decisions = await Promise.all(
      [4, 1].map((actor) =>
        http('patch', `/moderation/reports/${id}`, actor).send({
          decision: 'contenido_retirado',
          observation: 'Contenido sin fuente válida',
        }),
      ),
    );
    expect(decisions.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(
      await prisma.notificacion.count({
        where: { tipo: 'resultado_reporte', id_destinatario: 3n },
      }),
    ).toBe(1);
    expect(
      await prisma.notificacion.count({
        where: { tipo: 'contenido_retirado', id_destinatario: 2n },
      }),
    ).toBe(1);
  });

  it('uses post versions for retained reviews and forbids local suspension decisions', async () => {
    await http('patch', `/moderation/retained/post/${f.held}`, 4)
      .send({ decision: 'publish', version: 99 })
      .expect(409);
    await http('patch', `/moderation/retained/post/${f.held}`, 4)
      .send({ decision: 'publish', version: 1 })
      .expect(204);
    const report = await http('post', '/reports', 3)
      .send({
        postId: String(f.visible),
        reason: 'Contenido que requiere revisión',
      })
      .expect(201);
    const id = (report.body as { id: string }).id;
    await http('patch', `/moderation/reports/${id}`, 4)
      .send({
        decision: 'usuario_suspendido',
        observation: 'Motivo de suspensión',
        suspensionDays: 1,
      })
      .expect(403);
    await http('patch', `/moderation/reports/${id}`, 6)
      .send({
        decision: 'usuario_suspendido',
        observation: 'Motivo de suspensión',
        suspensionDays: 1,
      })
      .expect(204);
    await http('get', '/users/me', 2).expect(403);
    await prisma.usuario.update({
      where: { id_usuario: 2n },
      data: { suspendido_hasta: new Date(Date.now() - 1000) },
    });
    await http('get', '/users/me', 2).expect(200);
  });

  it('keeps notification destinations neutral after revocation and scopes read state to its recipient', async () => {
    await http('post', `/posts/${f.visible}/comments`, 3)
      .send({ content: 'Private activity' })
      .expect(201);
    const before = await http('get', '/notifications', 2).expect(200);
    const notification = (
      before.body as { items: { id: string; href: string }[] }
    ).items[0];
    expect(notification.href).toBe(`/publicaciones/${f.visible}`);
    await http('patch', `/notifications/${notification.id}/read`, 3).expect(
      404,
    );
    await http('delete', `/groups/${f.a}/members/2`, 1).expect(204);
    const after = await http('get', '/notifications', 2).expect(200);
    expect(after.body).toMatchObject({
      items: [{ href: null }],
      unreadCount: 1,
    });
    expect(JSON.stringify(after.body)).not.toContain('GROUP_SECRET');
    await http('patch', '/notifications/read', 2)
      .send({ throughId: notification.id })
      .expect(204);
    expect((await http('get', '/notifications/unread/count', 2)).body).toEqual({
      count: 0,
    });
  });

  function websocket(
    instance: INestApplication,
    actor?: number,
    origin = 'http://localhost:3000',
  ) {
    const port = (instance.getHttpServer() as Server).address() as AddressInfo;
    const socket = new WebSocket(`ws://127.0.0.1:${port.port}/tiempo-real`, {
      headers: {
        Origin: origin,
        ...(actor ? { Cookie: cookies.get(actor)! } : {}),
      },
    });
    const events: { event: string; data: { room?: string; count?: number } }[] =
      [];
    socket.on('message', (raw) => {
      events.push(
        JSON.parse(
          (Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.isBuffer(raw)
              ? raw
              : Buffer.from(raw)
          ).toString(),
        ) as (typeof events)[number],
      );
    });
    const wait = (
      name: string,
      predicate: (event: (typeof events)[number]) => boolean = () => true,
    ) =>
      new Promise<(typeof events)[number]>((resolve, reject) => {
        const existing = events.find((e) => e.event === name && predicate(e));
        if (existing) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(() => {
          socket.off('message', listener);
          reject(new Error(`Missing socket event ${name}`));
        }, 5000);
        const listener = () => {
          const found = events.find((e) => e.event === name && predicate(e));
          if (found) {
            clearTimeout(timer);
            socket.off('message', listener);
            resolve(found);
          }
        };
        socket.on('message', listener);
      });
    return { socket, events, wait };
  }

  it('authenticates WebSocket upgrades and rejects forged Origin or absent cookie', async () => {
    for (const [actor, origin] of [
      [undefined, 'http://localhost:3000'],
      [2, 'https://foreign.example'],
    ] as const) {
      const ws = websocket(app, actor, origin).socket;
      await new Promise<void>((resolve, reject) => {
        ws.on('unexpected-response', (_req, res) => {
          expect(res.statusCode).toBe(401);
          ws.terminate();
          resolve();
        });
        ws.on('open', () => reject(new Error('Unauthorized upgrade')));
        ws.on('error', () => undefined);
      });
    }
  });

  it('broadcasts committed comments across instances, counts distinct users and revokes an existing remote connection', async () => {
    const a = websocket(app, 2),
      b = websocket(secondary, 2),
      c = websocket(secondary, 3);
    try {
      await Promise.all([
        a.wait('conexion:lista'),
        b.wait('conexion:lista'),
        c.wait('conexion:lista'),
      ]);
      for (const client of [a, b, c])
        client.socket.send(
          JSON.stringify({
            event: 'sala:unirse',
            data: { type: 'publicacion', id: String(f.visible) },
          }),
        );
      await Promise.all([
        a.wait('presencia:conectados', (e) => e.data.count === 2),
        b.wait('presencia:conectados', (e) => e.data.count === 2),
      ]);
      await http('post', `/posts/${f.visible}/comments`, 3)
        .send({ content: 'Committed across instances' })
        .expect(201);
      await Promise.all([
        a.wait('comentario:nuevo'),
        b.wait('comentario:nuevo'),
      ]);
      expect(JSON.stringify(b.events)).not.toContain(
        'Committed across instances',
      );
      const before = b.events.filter(
        (e) => e.event === 'comentario:nuevo',
      ).length;
      await http('delete', `/groups/${f.a}/members/2`, 1).expect(204);
      await Promise.all([a.wait('acceso:revocado'), b.wait('acceso:revocado')]);
      await http('post', `/posts/${f.visible}/comments`, 3)
        .send({ content: 'After revocation' })
        .expect(201);
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(
        b.events.filter((e) => e.event === 'comentario:nuevo'),
      ).toHaveLength(before);
    } finally {
      for (const client of [a, b, c]) client.socket.terminate();
    }
  });

  it('normalizes group/registration names and bounds searches through the direct API', async () => {
    await http('post', '/groups', 5)
      .send({ name: '   \n ', categoryId: 1 })
      .expect(400);
    const created = await http('post', '/groups', 5)
      .send({ name: '  <b>Jose\u0301</b>   Estudio  ', categoryId: '1' })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'José Estudio',
      myRole: 'administrator',
    });
    await http('post', '/auth/register')
      .send({
        firstName: '   ',
        lastName: 'Synthetic',
        email: 'invalid@example.test',
        password: 'Synthetic-test-42!',
      })
      .expect(400);
    const account = await http('post', '/auth/register')
      .send({
        firstName: '  Jose\u0301  ',
        lastName: '<b>Prueba</b>',
        email: 'normalized@example.test',
        password: 'Synthetic-test-42!',
      })
      .expect(201);
    expect(account.body).toMatchObject({
      firstName: 'José',
      lastName: 'Prueba',
    });
    for (const path of [`/groups/${f.a}/members`, '/groups', '/posts/search'])
      await http('get', `${path}?q=${'x'.repeat(255)}`, 2).expect(400);
  });
});
