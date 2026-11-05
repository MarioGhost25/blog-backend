// Run after compilation: node src/users/verification/photo-flow.cjs [build-directory]
const assert = require('node:assert/strict');
const path = require('node:path');
const { Writable } = require('node:stream');
const { Test } = require('@nestjs/testing');
const { BadGatewayException } = require('@nestjs/common');
const request = require('supertest');
const { v2: cloudinary } = require('cloudinary');
const build = path.resolve(process.argv[2] ?? 'dist', 'src');
const { UsersController } = require(path.join(build, 'users/users.controller'));
const { UsersService } = require(path.join(build, 'users/users.service'));
const { UsersRepository } = require(path.join(build, 'users/users.repository'));
const { CloudinaryService } = require(
  path.join(build, 'users/cloudinary.service'),
);
const { JwtAuthGuard } = require(
  path.join(build, 'auth/guards/jwt-auth.guard'),
);
const { MAX_PROFILE_PHOTO_BYTES: max } = require(
  path.join(build, 'users/types/uploaded-image'),
);

async function main() {
  const events = [];
  let failure;
  const profile = {
    id_usuario: 1n,
    foto_public_id: 'old',
    foto_url: 'https://example.com/old.png',
  };
  const repository = {
    findProfileById: async () => profile,
    updatePhoto: async (id, url, publicId) => {
      events.push('update');
      assert.equal(id, 1n);
      if (failure === 'database') throw new Error('Database unavailable');
      return { ...profile, foto_url: url, foto_public_id: publicId };
    },
  };
  const media = {
    uploadImage: async (file) => {
      events.push('upload');
      assert.ok(Buffer.isBuffer(file.buffer));
      assert.equal(file.buffer.length, file.size);
      if (failure === 'cloudinary')
        throw new BadGatewayException('Storage unavailable');
      return { url: 'https://example.com/new.png', publicId: 'new' };
    },
    deleteAsset: async (id) => {
      events.push(`delete:${id}`);
    },
  };
  const module = await Test.createTestingModule({
    controllers: [UsersController],
    providers: [
      UsersService,
      { provide: UsersRepository, useValue: repository },
      { provide: CloudinaryService, useValue: media },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate(context) {
        context.switchToHttp().getRequest().user = { id: 1n };
        return true;
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  await app.init();
  try {
    const send = (size, type = 'image/png', field = 'file') =>
      request(app.getHttpServer())
        .put('/users/me/photo')
        .attach(field, Buffer.alloc(size), {
          filename: 'photo.png',
          contentType: type,
        });
    await request(app.getHttpServer()).put('/users/me/photo').expect(400);
    await send(10, 'image/png', 'name').expect(400);
    await send(10, 'image/gif').expect(415);
    await send(max + 1).expect(413);
    assert.deepEqual(events, []);
    const response = await send(max).expect(200);
    assert.equal(response.body.photoUrl, 'https://example.com/new.png');
    assert.equal(response.body.photoPublicId, 'new');
    assert.deepEqual(events, ['upload', 'update', 'delete:old']);
    events.length = 0;
    failure = 'database';
    await send(10).expect(500);
    assert.deepEqual(events, ['upload', 'update', 'delete:new']);
    events.length = 0;
    failure = 'cloudinary';
    await send(10).expect(502);
    assert.deepEqual(events, ['upload']);
  } finally {
    await app.close();
  }

  // Exercise the real adapter with an in-memory SDK replacement; no remote writes.
  const adapter = new CloudinaryService({ get: () => undefined });
  const originalUpload = cloudinary.uploader.upload_stream;
  const originalDestroy = cloudinary.uploader.destroy;
  try {
    cloudinary.uploader.upload_stream = (options, callback) => {
      assert.equal(options.folder, 'profiles');
      return new Writable({
        write(chunk, encoding, done) {
          done();
        },
        final(done) {
          callback(undefined, {
            secure_url: 'https://example.com/photo.png',
            public_id: 'new',
          });
          done();
        },
      });
    };
    assert.deepEqual(
      await adapter.uploadImage({ buffer: Buffer.from('image') }),
      { url: 'https://example.com/photo.png', publicId: 'new' },
    );
    cloudinary.uploader.upload_stream = () => {
      throw new Error('Provider unavailable');
    };
    await assert.rejects(
      adapter.uploadImage({ buffer: Buffer.from('image') }),
      (error) => error.getStatus() === 502,
    );
    cloudinary.uploader.destroy = async () => {
      throw new Error('Provider unavailable');
    };
    await adapter.deleteAsset('old');
  } finally {
    cloudinary.uploader.upload_stream = originalUpload;
    cloudinary.uploader.destroy = originalDestroy;
  }
  console.log(
    'Photo flow checks passed: multipart, size boundaries, MIME type, serialization, cleanup and Cloudinary error handling. Authentication and external services were mocked.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
