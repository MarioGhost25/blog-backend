// Run after npm run build. Uses the configured database; all group/user fixtures roll back.
// The normal CategoriesModule startup seed is intentionally retained.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');
const { ValidationPipe } = require('@nestjs/common');
const { JwtService } = require('@nestjs/jwt');
const { ConfigService } = require('@nestjs/config');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { AppModule } = require('../../../dist/src/app.module');
const { PrismaService } = require('../../../dist/src/prisma/prisma.service');

if (process.env.RUN_REMOTE_SMOKE !== '1') throw new Error('Set RUN_REMOTE_SMOKE=1 to explicitly run database checks');
function configure(app) {
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
}
(async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  configure(app);
  let checks = 0;
  try {
    await app.init();
    const catalog = await request(app.getHttpServer()).get('/api/v1/categories').expect(200);
    assert.ok(catalog.body.length >= 6);
    assert.ok(catalog.body.every(row => typeof row.id_categoria === 'string'));
    await request(app.getHttpServer()).get('/api/v1/grupos').expect(401);
    checks += 3;
    const prisma = app.get(PrismaService);
    const before = await Promise.all([prisma.usuario.count(), prisma.grupoEstudio.count(), prisma.miembroGrupo.count()]);
    const rollback = new Error('ROLLBACK_VERIFICATION_FIXTURES');
    try {
      await prisma.$transaction(async tx => {
        const marker = randomUUID();
        const users = [];
        for (let i = 0; i < 3; i++) users.push(await tx.usuario.create({ data: {
          nombre: 'Verification', apellido: 'Fixture', correo: 'verification-' + marker + '-' + i + '@example.invalid',
          contrasena_hash: 'not-a-login-credential',
        } }));
        const scoped = new Proxy(tx, { get(target, key) {
          if (key === '$transaction') return work => work(target);
          if (key === 'onModuleInit' || key === 'onModuleDestroy') return () => {};
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        } });
        const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(scoped).compile();
        const testApp = module.createNestApplication({ logger: false });
        configure(testApp);
        try {
          await testApp.init();
          const server = testApp.getHttpServer();
          const jwt = new JwtService({ secret: testApp.get(ConfigService).getOrThrow('JWT_SECRET'), signOptions: { algorithm: 'HS256', expiresIn: '5m' } });
          const cookies = users.map(user => 'jwt=' + jwt.sign({ sub: user.id_usuario.toString(), role: 'usuario', status: 'activo' }));
          const create = await request(server).post('/api/v1/grupos').set('Cookie', cookies[0]).send({ nombre: 'Verification ' + marker, idCategoria: catalog.body[0].id_categoria }).expect(201);
          const groupId = create.body.id_grupo;
          assert.equal(typeof groupId, 'string');
          assert.equal(create.body.miRol, 'administrador');
          assert.equal(create.body._count.miembros, 1);
          const base = '/api/v1/grupos/' + groupId;
          await request(server).post(base + '/miembros').set('Cookie', cookies[1]).expect(201);
          await request(server).post(base + '/miembros').set('Cookie', cookies[1]).expect(409);
          const listed = await request(server).get('/api/v1/grupos').query({ mios: 'true', q: marker, categoria: catalog.body[0].id_categoria, limite: 1 }).set('Cookie', cookies[1]).expect(200);
          assert.equal(listed.body.items[0].miRol, 'miembro');
          assert.equal(listed.body.nextCursor, null);
          assert.equal('miembros' in listed.body.items[0], false);
          await request(server).get(base).set('Cookie', cookies[1]).expect(200);
          const members = await request(server).get(base + '/miembros?limite=1').set('Cookie', cookies[1]).expect(200);
          assert.ok(members.body.nextCursor);
          assert.equal('contrasena_hash' in members.body.items[0].usuario, false);
          await request(server).get(base + '/miembros?cursor=' + members.body.nextCursor).set('Cookie', cookies[1]).expect(200);
          await request(server).get(base + '/miembros').set('Cookie', cookies[2]).expect(403);
          await request(server).patch(base + '/miembros/' + users[0].id_usuario).set('Cookie', cookies[1]).send({ rol: 'miembro' }).expect(403);
          await request(server).delete(base + '/miembros/me').set('Cookie', cookies[0]).expect(409);
          await request(server).patch(base + '/miembros/' + users[0].id_usuario).set('Cookie', cookies[0]).send({ rol: 'miembro' }).expect(409);
          await request(server).delete(base + '/miembros/' + users[0].id_usuario).set('Cookie', cookies[0]).expect(409);
          await request(server).post(base + '/transferencia').set('Cookie', cookies[0]).send({ idNuevoAdministrador: users[2].id_usuario.toString(), salir: false }).expect(400);
          await request(server).post(base + '/transferencia').set('Cookie', cookies[0]).send({ idNuevoAdministrador: users[0].id_usuario.toString(), salir: false }).expect(400);
          await request(server).patch(base + '/miembros/' + users[1].id_usuario).set('Cookie', cookies[0]).send({ rol: 'moderador' }).expect(200);
          const transferred = await request(server).post(base + '/transferencia').set('Cookie', cookies[0]).send({ idNuevoAdministrador: users[1].id_usuario.toString(), salir: false }).expect(204);
          assert.equal(transferred.text, '');
          const detail = await request(server).get(base).set('Cookie', cookies[0]).expect(200);
          assert.equal(detail.body.miRol, 'miembro');
          await request(server).post(base + '/miembros').set('Cookie', cookies[2]).expect(201);
          const removed = await request(server).delete(base + '/miembros/' + users[2].id_usuario).set('Cookie', cookies[1]).expect(204);
          assert.equal(removed.text, '');
          const left = await request(server).delete(base + '/miembros/me').set('Cookie', cookies[0]).expect(204);
          assert.equal(left.text, '');
          assert.equal(await tx.miembroGrupo.count({ where: { id_grupo: BigInt(groupId), rol: 'administrador' } }), 1);
          checks += 25;
        } finally { await testApp.close(); }
        throw rollback;
      }, { timeout: 120000 });
    } catch (error) { if (error !== rollback) throw error; }
    const after = await Promise.all([prisma.usuario.count(), prisma.grupoEstudio.count(), prisma.miembroGrupo.count()]);
    assert.deepEqual(after, before, 'Verification fixtures must not persist');
    console.log(JSON.stringify({ checks, categories: catalog.body.length, fixtureRollbackVerified: true }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
