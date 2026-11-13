// Explicit preload for the browser integration suite only. Never loaded by the app.
if (process.env.NODE_ENV !== 'test' || process.env.MEDIA_TEST_STUB !== 'enabled') throw new Error('Test-only media stub');
const { Writable } = require('node:stream');
const { v2: cloudinary } = require('cloudinary');
let postAttempt = 0;
const assets = new Map();
cloudinary.uploader.upload_stream = (options, callback) => { const chunks = []; return new Writable({
  write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
  final(done) {
    if (options.public_id?.startsWith('posts/') && postAttempt++ < 3) callback({ message: 'Synthetic private provider failure' });
    else { assets.set(options.public_id,Buffer.concat(chunks)); callback(null, { secure_url: 'http://127.0.0.1:24002/image.png', public_id: options.public_id ?? `synthetic/${options.folder}` }); }
    done();
  },
}); };
cloudinary.utils.private_download_url = id => `data:application/octet-stream;base64,${assets.get(id).toString('base64')}`;
cloudinary.uploader.destroy = async id => { assets.delete(id); return { result: 'ok' }; };
