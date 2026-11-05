// Run after npm run build. Uses the configured database; all group/user fixtures roll back.
// The normal CategoriesModule startup seed is intentionally retained.
const assert = require('node:assert/strict');
// Match main.ts serialization for auth IDs. Group IDs use their interceptor.
Object.defineProperty(BigInt.prototype, 'toJSON', { configurable: true, value() { return Number(this); } });
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { Test } = require('@nestjs/testing');
const { createApiValidationPipe } = require('../../../dist/src/common/validation/api-validation.pipe');
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
  app.useGlobalPipes(createApiValidationPipe());
}
(async () => {
  const app = await NestFactory.create(AppModule, { logger: false });
  configure(app);
  let checks = 0;
  try {
    await app.init();
    const catalog = await request(app.getHttpServer()).get('/api/v1/categories').expect(200);
    assert.ok(catalog.body.length >= 6);
    assert.ok(catalog.body.every(row => typeof row.categoryId === 'string'));
    await request(app.getHttpServer()).get('/api/v1/groups').expect(401);
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
          const create = await request(server).post('/api/v1/groups').set('Cookie', cookies[0]).send({ name: 'Verification ' + marker, categoryId: catalog.body[0].categoryId }).expect(201);
          const profile = await request(server).get('/api/v1/auth/me').set('Cookie', cookies[0]).expect(200);
          assert.equal(profile.body.role, 'user');
          assert.equal(profile.body.status, 'active');
          const groupId = create.body.groupId;
          assert.equal(typeof groupId, 'string');
          assert.equal(create.body.myRole, 'administrator');
          assert.equal(create.body._count.members, 1);
          const base = '/api/v1/groups/' + groupId;
          const missing = await request(server).post(base + '/transfer').set('Cookie', cookies[0]).send({}).expect(400);
          assert.deepEqual(missing.body.details.map(({field, code}) => ({field, code})), [
            {field: 'newAdministratorId', code: 'required'}, {field: 'leave', code: 'required'},
          ]);
          const wrongType = await request(server).post(base + '/transfer').set('Cookie', cookies[0]).send({newAdministratorId: users[1].id_usuario.toString(), leave: 'false'}).expect(400);
          assert.equal(wrongType.body.details[0].field, 'leave');
          assert.match(wrongType.body.message[0], /without quotes/);
          const oldField = await request(server).patch(base + '/members/' + users[1].id_usuario).set('Cookie', cookies[0]).send({rol: 'moderador'}).expect(400);
          assert.ok(oldField.body.details.some(e => e.field === 'rol' && e.code === 'unknown_field'));
          assert.ok(oldField.body.details.some(e => e.field === 'role' && e.code === 'required'));
          const invalidRole = await request(server).patch(base + '/members/' + users[1].id_usuario).set('Cookie', cookies[0]).send({role: 'owner'}).expect(400);
          assert.match(invalidRole.body.message[0], /member, moderator, administrator/);
          const invalidUserId = await request(server).patch(base + '/members/:userId').set('Cookie', cookies[0]).send({role: 'member'}).expect(400);
          assert.equal(invalidUserId.body.details[0].field, 'userId');
          const invalidGroupId = await request(server).post('/api/v1/groups/:id/transfer').set('Cookie', cookies[0]).send({}).expect(400);
          assert.equal(invalidGroupId.body.details[0].field, 'id');
          const invalidLogin = await request(server).post('/api/v1/auth/login').send({email: 'invalid', password: 'private-test-value'}).expect(400);
          assert.ok(invalidLogin.body.details.some(e => e.field === 'email'));
          assert.equal(JSON.stringify(invalidLogin.body).includes('private-test-value'), false);
          checks += 7;

          await request(server).post(base + '/members').set('Cookie', cookies[1]).expect(201);
          await request(server).post(base + '/members').set('Cookie', cookies[1]).expect(409);
          const listed = await request(server).get('/api/v1/groups').query({ mine: 'true', q: marker, categoryId: catalog.body[0].categoryId, limit: 1 }).set('Cookie', cookies[1]).expect(200);
          assert.equal(listed.body.items[0].myRole, 'member');
          assert.equal(listed.body.nextCursor, null);
          assert.equal('members' in listed.body.items[0], false);
          await request(server).get(base).set('Cookie', cookies[1]).expect(200);
          const members = await request(server).get(base + '/members?limit=1').set('Cookie', cookies[1]).expect(200);
          assert.ok(members.body.nextCursor);
          assert.equal('contrasena_hash' in members.body.items[0].user, false);
          await request(server).get(base + '/members?cursor=' + members.body.nextCursor).set('Cookie', cookies[1]).expect(200);
          await request(server).get(base + '/members').set('Cookie', cookies[2]).expect(403);
          await request(server).patch(base + '/members/' + users[0].id_usuario).set('Cookie', cookies[1]).send({ role: 'member' }).expect(403);
          await request(server).delete(base + '/members/me').set('Cookie', cookies[0]).expect(409);
          await request(server).patch(base + '/members/' + users[0].id_usuario).set('Cookie', cookies[0]).send({ role: 'member' }).expect(409);
          await request(server).delete(base + '/members/' + users[0].id_usuario).set('Cookie', cookies[0]).expect(409);
          await request(server).post(base + '/transfer').set('Cookie', cookies[0]).send({ newAdministratorId: users[2].id_usuario.toString(), leave: false }).expect(400);
          await request(server).post(base + '/transfer').set('Cookie', cookies[0]).send({ newAdministratorId: users[0].id_usuario.toString(), leave: false }).expect(400);
          await request(server).patch(base + '/members/' + users[1].id_usuario).set('Cookie', cookies[0]).send({ role: 'moderator' }).expect(200);
          await request(server).patch(base + '/members/' + users[1].id_usuario).set('Cookie', cookies[0]).send({ role: 'moderador' }).expect(400);
          await request(server).post(base + '/transfer').set('Cookie', cookies[1]).send({ newAdministratorId: users[0].id_usuario.toString(), leave: false }).expect(403);
          const transferred = await request(server).post(base + '/transfer').set('Cookie', cookies[0]).send({ newAdministratorId: users[1].id_usuario.toString(), leave: false }).expect(204);
          assert.equal(transferred.text, '');
          const detail = await request(server).get(base).set('Cookie', cookies[0]).expect(200);
          assert.equal(detail.body.myRole, 'member');
          assert.equal(detail.body._count.members, 2);
          const newAdminDetail = await request(server).get(base).set('Cookie', cookies[1]).expect(200);
          assert.equal(newAdminDetail.body.myRole, 'administrator');
          await request(server).patch(base + '/members/' + users[1].id_usuario).set('Cookie', cookies[0]).send({ role: 'member' }).expect(403);
          await request(server).post(base + '/members').set('Cookie', cookies[2]).expect(201);
          const removed = await request(server).delete(base + '/members/' + users[2].id_usuario).set('Cookie', cookies[1]).expect(204);
          assert.equal(removed.text, '');
          const left = await request(server).delete(base + '/members/me').set('Cookie', cookies[0]).expect(204);
          assert.equal(left.text, '');
          assert.equal(await tx.miembroGrupo.count({ where: { id_grupo: BigInt(groupId), rol: 'administrador' } }), 1);
          checks += 31;
        } finally { await testApp.close(); }
        throw rollback;
      }, { timeout: 120000 });
    } catch (error) { if (error !== rollback) throw error; }
    const after = await Promise.all([prisma.usuario.count(), prisma.grupoEstudio.count(), prisma.miembroGrupo.count()]);
    assert.deepEqual(after, before, 'Verification fixtures must not persist');
    console.log(JSON.stringify({ checks, categories: catalog.body.length, fixtureRollbackVerified: true }));
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
