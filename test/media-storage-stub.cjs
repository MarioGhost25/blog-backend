// Explicit preload for the browser integration suite only. Never loaded by the app.
if (process.env.NODE_ENV !== 'test' || process.env.MEDIA_TEST_STUB !== 'enabled') throw new Error('Test-only media stub');
const { Writable } = require('node:stream');
const { v2: cloudinary } = require('cloudinary');
let postAttempt = 0;
cloudinary.uploader.upload_stream = (options, callback) => new Writable({
  write(_chunk, _encoding, done) { done(); },
  final(done) {
    if (options.folder === 'posts' && postAttempt++ === 0) callback({ message: 'Synthetic private provider failure' });
    else callback(null, { secure_url: 'http://127.0.0.1:24002/image.png', public_id: `synthetic/${options.folder}` });
    done();
  },
});
cloudinary.uploader.destroy = async () => ({ result: 'ok' });
