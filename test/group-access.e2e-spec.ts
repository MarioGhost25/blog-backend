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
  let created = false;
  let f: Fixture;
  const cookies = new Map<number, string>();
  const asset = {
    url: 'https://assets.example.test/upload.png',
    publicId: 'synthetic/upload',
  };
  const storage = {
    upload: jest.fn<Promise<typeof asset>, unknown[]>(),
    delete: jest.fn<Promise<void>, unknown[]>(),
  };
  const http = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    actor?: number,
  ) => {
    const call = request(app.getHttpServer() as Server)[method](
      `/api/v1${path}`,
    );
    return actor === undefined ? call : call.set('Cookie', cookies.get(actor)!);
  };
  const resetRates = () => app.get(AuthRateLimitGuard).onModuleDestroy();

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
              JWT_SECRET: randomBytes(32).toString('hex'),
              NODE_ENV: 'test',
            }),
          ],
        }),
        AuthModule,
        GroupsModule,
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
    storage.upload.mockReset().mockResolvedValue(asset);
    storage.delete.mockReset().mockResolvedValue(undefined);
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

  it('lets revocation finish during upload and compensates the asset before rejecting its link', async () => {
    const entered = deferred<void>(),
      complete = deferred<typeof asset>();
    storage.upload.mockImplementationOnce(() => {
      entered.resolve();
      return complete.promise;
    });
    const pending = http('post', `/posts/${f.visible}/attachments`, 2)
      .field('type', 'image')
      .field('title', 'In-flight image')
      .attach('file', Buffer.from('synthetic image bytes'), {
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
    expect(storage.delete).toHaveBeenCalledWith(asset.publicId, 'image');
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

  it('reports a failed provider cleanup after the authorized unlink has committed', async () => {
    storage.delete.mockRejectedValueOnce(
      new BadGatewayException('MediaStorageUnavailable'),
    );
    await http(
      'delete',
      `/posts/${f.visible}/attachments/${f.image}`,
      2,
    ).expect(502);
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
