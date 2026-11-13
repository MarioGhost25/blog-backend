// Real Next -> BFF -> Nest -> PostgreSQL smoke test. No development DB is used.
const { Client } = require('pg');
const { randomBytes } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { hash } = require('bcrypt');
const { connect: connectTcp } = require('node:net');
const { createServer, request: httpRequest } = require('node:http');
const { chromium } = require('../../blog-frontend/node_modules/playwright');

const backend = resolve(__dirname, '..');
const frontend = resolve(backend, '../blog-frontend');
const databaseName = `web_${randomBytes(8).toString('hex')}_test`;
const testUrl = 'postgresql://audit:local-test-only@127.0.0.1:55432/blog_test';
const admin = new Client({ connectionString: testUrl });
const children = [];
let browser, created = false;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC', 'base64');
const media = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(png); });
const identitySecret = randomBytes(32).toString('hex');
let clientIp = '192.0.2.10';
// Isolated trusted edge fixture. The browser cannot choose its forwarded identity.
const edge = createServer((req, res) => {
  const headers = { ...req.headers, 'x-real-ip': clientIp };
  delete headers['x-forwarded-for'];
  for (const key of Object.keys(headers)) if (key.startsWith('x-blog-')) delete headers[key];
  const upstream = httpRequest({ hostname: '127.0.0.1', port: 3017, path: req.url, method: req.method, headers }, result => {
    res.writeHead(result.statusCode, result.headers); result.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(503); res.end(); });
  req.pipe(upstream);
});

// Production-like same-origin WebSocket proxy; Next handles HTTP/BFF only.
edge.on('upgrade',(req,socket,head) => {
  if (req.url !== '/tiempo-real') { socket.destroy(); return; }
  const upstream = connectTcp(24001,'127.0.0.1',() => {
    const headers = req.rawHeaders.reduce((text,value,index,all) => index % 2 === 0 ? text + `${value}: ${all[index+1]}\r\n` : text,'');
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error',() => socket.destroy()); socket.on('error',() => upstream.destroy()); socket.on('close',() => upstream.destroy());
});

async function ready(url, child) {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error('Test service exited before becoming ready');
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Timed out waiting for test service');
}
function start(cwd, args, env) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  // Drain output without copying environment or provider messages into reports.
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  children.push(child);
  return child;
}
async function adminSmoke(databaseUrl) {
  const panelDb = new Client({connectionString:databaseUrl}); await panelDb.connect();
  try { await panelDb.query("UPDATE usuario SET rol='administrador' WHERE correo='other@example.test'"); } finally { await panelDb.end(); }
  const panelContext = await browser.newContext(); const panel = await panelContext.newPage();
  try {
    assert.equal((await panel.request.post('http://127.0.0.1:3016/api/auth/login',{headers:{Origin:'http://127.0.0.1:3016'},data:{email:'other@example.test',password:'Local-test-42!'}})).status(),200);
    await panel.goto('http://127.0.0.1:3016/admin');
    await panel.getByRole('heading',{name:'Administración global',exact:true}).waitFor();
    await panel.goto('http://127.0.0.1:3016/admin/usuarios?q=Synthetic');
    const row=panel.getByRole('listitem').filter({hasText:'Synthetic Student'});
    await row.getByLabel('Motivo',{exact:true}).fill('Suspensión administrativa de prueba');
    panel.once('dialog',d=>d.accept()); await row.getByRole('button',{name:'Suspender',exact:true}).click();
    try { await row.getByRole('button',{name:'Reactivar',exact:true}).waitFor(); } catch(error) { console.error('ADMIN_UI',await panel.locator('main').innerText()); throw error; }
    panel.once('dialog',d=>d.accept()); await row.getByRole('button',{name:'Reactivar',exact:true}).click();
    await row.getByRole('button',{name:'Suspender',exact:true}).waitFor();
    await panel.goto('http://127.0.0.1:3016/admin/publicaciones');
    await panel.getByRole('heading',{name:'Publicaciones',exact:true}).waitFor();
    console.log('PASS browser: administrative summary, user search, manual suspension/reactivation and global group content.');
  } finally { await panelContext.close(); }
}
async function main() {
  // Do not accidentally test a stale/unrelated server after a failed run.
  for (const port of [24001, 3017]) {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  }
  await new Promise((resolve, reject) => { media.once('error', reject); media.listen(24002, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => { edge.once('error', reject); edge.listen(3016, '127.0.0.1', resolve); });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${databaseName}`);
  created = true;
  const url = new URL(testUrl); url.pathname = `/${databaseName}`;
  const db = new Client({ connectionString: url.href });
  await db.connect();
  try {
    for (const migration of readdirSync(resolve(backend, 'prisma/migrations')).filter(x => /^\d/.test(x)).sort()) {
      await db.query(readFileSync(resolve(backend, 'prisma/migrations', migration, 'migration.sql'), 'utf8'));
    }
    await db.query("INSERT INTO usuario(nombre,apellido,correo,contrasena_hash) VALUES('Synthetic','Student','web@example.test',$1)", [await hash('Local-test-42!', 12)]);
    await db.query("INSERT INTO categoria(nombre) VALUES('Materia de pruebas')");
    for (let i = 1; i <= 21; i++) await db.query("INSERT INTO publicacion(id_autor,id_categoria,titulo,contenido) VALUES(1,1,$1,$2)", [`Matrices audit ${i}`, '<p>Álgebra segura</p><script>window.__auditXss=true</script>']);
    await db.query("INSERT INTO publicacion(id_autor,id_categoria,titulo,contenido,estado) VALUES(1,1,'Contenido reservado','PRIVATE_SENTINEL','retenido')");
    await db.query("INSERT INTO usuario(nombre,apellido,correo,contrasena_hash) VALUES('Other','Student','other@example.test',$1)", [await hash('Local-test-42!', 12)]);
    await db.query("INSERT INTO publicacion(id_autor,id_categoria,titulo,contenido) VALUES(2,1,'Otra autoría','<p>Sin acceso de escritura</p>')");
  } finally { await db.end(); }
  const api = start(backend, ['--require', './test/media-storage-stub.cjs', 'dist/src/main.js'], {
    PORT: '24001', DATABASE_URL: url.href, NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'),
    SMTP_HOST: '127.0.0.1', SMTP_PORT: '11025', SMTP_FROM: 'test@example.test', SMTP_SECURE: 'false',
    RECOVERY_URL: 'http://localhost:3016/recuperar', FRONTEND_URL: 'http://127.0.0.1:3016',
    MEDIA_TEST_STUB: 'enabled', CLOUDINARY_CLOUD_NAME: 'synthetic', CLOUDINARY_API_KEY: 'synthetic', CLOUDINARY_API_SECRET: 'synthetic',
    BFF_IDENTITY_SECRET: identitySecret,
  });
  await ready('http://127.0.0.1:24001/api/v1', api);
  const web = start(frontend, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3017'], {
    BACKEND_API_URL: 'http://127.0.0.1:24001/api/v1', APP_ORIGIN: 'http://127.0.0.1:3016', NODE_ENV: 'production',
    BFF_IDENTITY_SECRET: identitySecret, BFF_CLIENT_IP_SOURCE: 'trusted-proxy',
  });
  await ready('http://127.0.0.1:3016/buscar', web);
  const apiResult = await fetch('http://127.0.0.1:3016/api/posts');
  assert.equal(apiResult.status, 200);
  const payload = await apiResult.json();
  assert.equal(payload.elementos.length, 20);
  assert.equal(JSON.stringify(payload).includes('PRIVATE_SENTINEL'), false);
  assert.equal(JSON.stringify(payload).includes('cloudinaryPublicId'), false);
  assert.equal((await fetch('http://127.0.0.1:3016/publicaciones/999999')).status, 404);
  assert.equal((await fetch('http://127.0.0.1:3016/api/users/me/posts')).status, 401);
  browser = await chromium.launch({ headless: true });
  if (process.argv.includes('--admin-only')) { clientIp='192.0.2.70'; await adminSmoke(url.href); return; }
  const context = await browser.newContext();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  await page.goto('http://127.0.0.1:3016/buscar');
  await page.getByRole('heading', { name: 'Matrices audit 21', exact: true }).waitFor();
  assert.equal(await page.locator('article').count(), 20);
  await page.getByRole('button', { name: 'Cargar más publicaciones' }).click();
  await page.getByRole('heading', { name: 'Matrices audit 1', exact: true }).waitFor();
  assert.equal(await page.locator('article').count(), 22);
  await page.locator('#public-query').fill('Matrices');
  await page.locator('.search-page-form').getByRole('button', { name: 'Buscar', exact: true }).click();
  await page.waitForURL('**/buscar?q=Matrices&categoryId=');
  await page.getByRole('heading', { name: 'Matrices audit 21', exact: true }).click();
  await page.locator('.article-body').waitFor();
  assert.equal(await page.locator('.article-body script').count(), 0);
  assert.equal(await page.evaluate(() => window.__auditXss), undefined);
  assert.equal(await page.locator('.article-body').textContent(), 'Álgebra segura');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:3016/buscar');
  await page.getByRole('heading', { name: 'Matrices audit 21', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  clientIp = '192.0.2.11';
  const login = await page.request.post('http://127.0.0.1:3016/api/auth/login', {
    headers: { Origin: 'http://127.0.0.1:3016' }, data: { email: 'web@example.test', password: 'Local-test-42!' },
  });
  assert.equal(login.status(), 200);
  await page.goto('http://127.0.0.1:3016/grupos');
  await page.getByLabel('Nombre', { exact: true }).fill('Grupo de integración G01');
  await page.locator('select[name=categoryId]').last().selectOption('1');
  await page.getByRole('button', { name: 'Crear grupo', exact: true }).click();
  await page.waitForURL(/\/grupos\/\d+$/);
  const groupUrl = page.url();
  await page.getByText('Tu rol: Administrador', { exact: true }).waitFor();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Salir del grupo' }).click();
  await page.getByRole('alert').filter({ hasText: 'último administrador' }).waitFor();
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  assert.equal((await otherPage.request.post('http://127.0.0.1:3016/api/auth/login', { headers: { Origin: 'http://127.0.0.1:3016' }, data: { email: 'other@example.test', password: 'Local-test-42!' } })).status(), 200);
  await otherPage.goto(groupUrl);
  await otherPage.getByRole('button', { name: 'Unirme al grupo' }).click();
  await otherPage.getByText('Tu rol: Miembro', { exact: true }).waitFor();
  otherPage.once('dialog', d => d.accept());
  await otherPage.getByRole('button', { name: 'Salir del grupo' }).click();
  await otherPage.getByRole('button', { name: 'Unirme al grupo' }).waitFor();
  await otherContext.close();
  clientIp = '192.0.2.14';
  await page.goto('http://127.0.0.1:3016/perfil');
  // Streaming SSR can temporarily retain an identical input in a hidden segment.
  await page.getByLabel('Foto de perfil', { exact: true }).filter({visible:true}).setInputFiles({ name: 'profile.png', mimeType: 'image/png', buffer: png });
  const photoResponse = page.waitForResponse(r => r.url().endsWith('/api/users/me/photo') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Guardar foto', exact: true }).click();
  assert.equal((await photoResponse).status(), 200);
  const profile = await (await page.request.get('http://127.0.0.1:3016/api/users/me')).json();
  assert.equal(profile.photoUrl, 'http://127.0.0.1:24002/image.png');
  assert.equal(Object.hasOwn(profile, 'photoPublicId'), false);
  await page.goto('http://127.0.0.1:3016/mis-publicaciones?status=visible');
  await page.getByRole('heading', { name: 'Matrices audit 21', exact: true }).waitFor();
  assert.equal(await page.locator('article').count(), 20);
  await page.getByRole('button', { name: 'Cargar más publicaciones propias' }).click();
  await page.getByRole('heading', { name: 'Matrices audit 1', exact: true }).waitFor();
  assert.equal(await page.locator('article').count(), 21);
  assert.equal(await page.getByRole('heading', { name: 'Otra autoría', exact: true }).count(), 0);
  await page.getByLabel('Estado', { exact: true }).selectOption('held');
  await page.getByRole('button', { name: 'Filtrar', exact: true }).click();
  await page.getByRole('heading', { name: 'Contenido reservado', exact: true }).waitFor();
  assert.equal(await page.locator('article').count(), 1);
  const badFilter = await page.request.get('http://127.0.0.1:3016/api/users/me/posts?limit=20');
  assert.equal(badFilter.status(), 400);
  await page.goto('http://127.0.0.1:3016/publicaciones/nueva');
  await page.getByLabel('Título', { exact: true }).fill('Publicación creada desde navegador');
  await page.getByLabel('Materia', { exact: true }).selectOption('1');
  await page.getByLabel('Contenido', { exact: true }).fill('Álgebra y matrices. '.repeat(600));
  await page.getByRole('button', { name: 'Guardar publicación' }).click();
  await page.waitForURL(/\/publicaciones\/\d+$/);
  const createdUrl = page.url();
  await page.getByRole('heading', { name: 'Publicación creada desde navegador', exact: true }).waitFor();
  await page.getByLabel('Imagen de la publicación', { exact: true }).setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('Descripción de la imagen', { exact: true }).fill('Diagrama de prueba');
  const failedImage = page.waitForResponse(r => r.url().endsWith('/attachments') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Subir imagen', exact: true }).click();
  assert.equal((await failedImage).status(), 502);
  await page.getByRole('button', { name: 'Recargar recursos', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Publicación creada desde navegador', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Recargar recursos', exact: true }).click();
  await page.getByLabel('Imagen de la publicación', { exact: true }).setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('Descripción de la imagen', { exact: true }).fill('Diagrama de prueba');
  const uploadedImage = page.waitForResponse(r => r.url().endsWith('/attachments') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Subir imagen', exact: true }).click();
  const uploaded = await uploadedImage;
  assert.equal(uploaded.status(), 201);
  assert.equal(Object.hasOwn(await uploaded.json(), 'cloudinaryPublicId'), false);
  await page.getByRole('img', { name: 'Diagrama de prueba', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('img[alt="Diagrama de prueba"]')?.naturalWidth === 1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar imagen: Diagrama de prueba', exact: true }).click();
  await page.getByRole('img', { name: 'Diagrama de prueba', exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('link', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Título', { exact: true }).waitFor();
  const otherTab = await context.newPage();
  await otherTab.goto(page.url());
  await otherTab.getByLabel('Título', { exact: true }).waitFor();
  await page.getByLabel('Título', { exact: true }).fill('Publicación editada');
  await page.getByRole('button', { name: 'Guardar publicación' }).click();
  await page.waitForURL(createdUrl);
  await otherTab.getByLabel('Título', { exact: true }).fill('Borrador que se conserva');
  const conflictResponse = otherTab.waitForResponse(response => response.url().includes('/api/posts/') && response.request().method() === 'PATCH');
  await otherTab.getByRole('button', { name: 'Guardar publicación' }).click();
  assert.equal((await conflictResponse).status(), 409);
  await otherTab.locator('form').getByRole('alert').waitFor();
  assert.equal(await otherTab.getByLabel('Título', { exact: true }).inputValue(), 'Borrador que se conserva');
  await otherTab.getByRole('button', { name: 'Cargar versión actual' }).waitFor();
  await otherTab.close();
  const id = createdUrl.split('/').at(-1);
  const forbidden = await page.request.delete(`http://127.0.0.1:3016/api/posts/${id}`, { headers: { Origin: 'https://attacker.example.test' } });
  assert.equal(forbidden.status(), 403);
  assert.equal((await page.request.get('http://127.0.0.1:3016/api/auth/me')).status(), 200);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForURL('**/inicio');
  assert.equal((await page.request.get(createdUrl)).status(), 404);
  await page.goto('http://127.0.0.1:3016/mis-publicaciones?status=deleted');
  await page.getByRole('heading', { name: 'Publicación editada', exact: true }).waitFor();
  assert.equal(await page.locator('article a').count(), 0);
  assert.equal(await page.locator('article button').count(), 0);
  clientIp = '192.0.2.20';
  await require('./publication-recovery-smoke.cjs')({ page, context, databaseUrl: url.href });
  clientIp = '192.0.2.12';
  const changeAccount = await page.request.post('http://127.0.0.1:3016/api/auth/login', {
    headers: { Origin: 'http://127.0.0.1:3016' }, data: { email: 'other@example.test', password: 'Local-test-42!' },
  });
  assert.equal(changeAccount.status(), 200);
  await page.goto('http://127.0.0.1:3016/mis-publicaciones');
  await page.getByRole('heading', { name: 'Otra autoría', exact: true }).waitFor();
  assert.equal(await page.locator('article').count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Contenido reservado', exact: true }).count(), 0);
  const forbiddenEdit = await page.request.patch('http://127.0.0.1:3016/api/posts/1', {
    headers: { Origin: 'http://127.0.0.1:3016' }, data: { title: 'Cambio ajeno', version: 1 },
  });
  assert.equal(forbiddenEdit.status(), 403);
  assert.equal((await page.request.get('http://127.0.0.1:3016/api/auth/me')).status(), 200);
  clientIp = '192.0.2.50';
  let groupIp = 50;
  await require('./groups-content-smoke.cjs')({browser,groupUrl,png,advanceIp:() => { clientIp = `192.0.2.${++groupIp}`; }});
  clientIp = '192.0.2.70';
  await adminSmoke(url.href);
  clientIp = '192.0.2.12';
  for (let i = 0; i < 31; i++) {
    const result = await page.request.get('http://127.0.0.1:3016/api/posts?q=matrices', {
      headers: { 'X-Forwarded-For': `203.0.113.${i}`, 'x-blog-client-ip': `203.0.113.${i}` },
    });
    assert.equal(result.status(), i < 30 ? 200 : 429);
    if (i === 30) {
      const body = await result.json();
      assert.equal(body.error, 'RateLimited');
      assert.equal(body.correlationId, result.headers()['x-request-id']);
      assert.equal(String(body.retryAfter), result.headers()['retry-after']);
    }
  }
  clientIp = '192.0.2.13';
  assert.equal((await page.request.get('http://127.0.0.1:3016/api/posts?q=matrices')).status(), 200);
  assert.equal(problems.length, 0);
  console.log('PASS browser: content/auth/media and publication recovery; draft navigation, lost POST/PATCH/DELETE replies, session recovery/account isolation; trusted edge -> BFF signature -> Nest; spoofed headers ignored, per-client search budgets, Retry-After and correlation. Media provider stubbed locally.');
}
main().catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  media.close();
  edge.close();
  for (const child of children.reverse()) {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  }
  if (created) await admin.query(`DROP DATABASE ${databaseName}`);
  await admin.end();
});
