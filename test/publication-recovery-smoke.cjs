// Called only by web-smoke.cjs against its disposable database and local servers.
// route.fetch waits for the real BFF/Nest commit BEFORE dropping the browser reply.
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { expect } = require('../../blog-frontend/node_modules/@playwright/test');

module.exports = async function publicationRecovery({ page, context, databaseUrl }) {
  const origin = 'http://127.0.0.1:3016';
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const title = page.getByLabel('Título', { exact: true });
  const save = page.getByRole('button', { name: 'Guardar publicación', exact: true });
  async function draft(name) {
    await page.goto(`${origin}/publicaciones/nueva`);
    await title.fill(name);
    await page.getByLabel('Materia', { exact: true }).selectOption('1');
    await page.getByLabel('Contenido', { exact: true }).fill('Borrador de recuperación con contenido válido.');
  }
  async function dialogAction(action, accept = false) {
    const shown = page.waitForEvent('dialog', { timeout: 10000 }).then(dialog => accept ? dialog.accept() : dialog.dismiss());
    await Promise.all([shown, action()]);
  }
  function dropFirstReply(pattern, method, beforeCommit = false) {
    const sent = [];
    const handler = async route => {
      const request = route.request();
      if (request.method() !== method) return route.continue();
      sent.push({ key: request.headers()['idempotency-key'], owner: request.headers()['x-post-owner'], body: request.postData() });
      if (sent.length > 1) return route.continue();
      if (beforeCommit) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic offline' }) });
      const result = await route.fetch();
      assert.equal(result.status(), method === 'POST' ? 201 : method === 'DELETE' ? 204 : 200);
      await route.abort('failed');
    };
    return page.route(pattern, handler).then(() => ({ sent, remove: () => page.unroute(pattern, handler) }));
  }
  try {
    // Real Next same-document history, including forward restoration.
    await page.goto(`${origin}/mis-publicaciones`);
    await page.getByRole('link', { name: 'Crear publicación', exact: true }).click();
    await title.fill('Borrador de navegación');
    const editorUrl = page.url();
    await dialogAction(() => page.locator('a[href="/buscar"]:visible').first().click());
    await expect(page).toHaveURL(editorUrl);
    await dialogAction(() => page.evaluate(() => history.back()));
    await expect(page).toHaveURL(editorUrl);
    await expect(title).toHaveValue('Borrador de navegación');
    // A cancelled reload never reaches Playwright's navigation/load wait.
    await dialogAction(() => page.evaluate(() => window.location.reload()));
    await expect(title).toHaveValue('Borrador de navegación');
    await dialogAction(() => page.locator('a[href="/buscar"]:visible').first().click(), true);
    await page.waitForURL('**/buscar');
    await page.goBack();
    await title.fill('Borrador antes de Adelante');
    await dialogAction(() => page.evaluate(() => history.forward()));
    await expect(page).toHaveURL(editorUrl);
    await expect(title).toHaveValue('Borrador antes de Adelante');
    await dialogAction(() => page.evaluate(() => history.forward()), true);
    await page.waitForURL('**/buscar');

    // A double click and explicit retry share a single frozen operation.
    const createLoss = await dropFirstReply(`${origin}/api/posts`, 'POST');
    await draft('P03 POST respuesta perdida');
    await save.evaluate(button => { button.click(); button.click(); });
    await page.getByRole('button', { name: 'Reintentar mismo guardado', exact: true }).waitFor();
    assert.equal(createLoss.sent.length, 1);
    await expect(title).toBeDisabled();
    await page.getByRole('button', { name: 'Reintentar mismo guardado', exact: true }).click();
    await page.waitForURL(/\/publicaciones\/\d+$/);
    const postUrl = page.url(), postId = postUrl.split('/').at(-1);
    assert.deepEqual(createLoss.sent[1], createLoss.sent[0]);
    assert.equal((await db.query('SELECT count(*)::int AS total FROM publicacion WHERE titulo=$1', ['P03 POST respuesta perdida'])).rows[0].total, 1);
    await createLoss.remove();

    // No commit yet: unknown must not enable a new operation or editable fields.
    const beforeSend = await dropFirstReply(`${origin}/api/posts`, 'POST', true);
    await draft('P03 sin commit inicial');
    await save.click();
    await page.getByRole('button', { name: 'Comprobar guardado', exact: true }).click();
    await expect(page.getByText('El servidor aún no confirma este guardado.', { exact: false })).toBeVisible();
    await expect(title).toBeDisabled();
    await page.getByRole('button', { name: 'Reintentar mismo guardado', exact: true }).click();
    await page.waitForURL(/\/publicaciones\/\d+$/);
    assert.deepEqual(beforeSend.sent[1], beforeSend.sent[0]);
    await beforeSend.remove();

    // A receipt for PATCH proves that write, never that its version is current.
    await page.goto(`${postUrl}/editar`);
    const patchLoss = await dropFirstReply(`${origin}/api/posts/${postId}`, 'PATCH');
    await title.fill('P03 edición con respuesta perdida');
    await save.click();
    await page.getByRole('button', { name: 'Comprobar guardado', exact: true }).waitFor();
    const later = await page.request.patch(`${origin}/api/posts/${postId}`, {
      headers: { Origin: origin }, data: { title: 'P03 edición posterior', version: 2 },
    });
    assert.equal(later.status(), 200);
    await page.getByRole('button', { name: 'Comprobar guardado', exact: true }).click();
    await page.getByRole('button', { name: 'Ver versión actual', exact: true }).waitFor();
    assert.equal(patchLoss.sent.length, 1);
    assert.equal((await db.query('SELECT titulo FROM publicacion WHERE id_publicacion=$1', [postId])).rows[0].titulo, 'P03 edición posterior');
    await page.getByRole('button', { name: 'Ver versión actual', exact: true }).click();
    await page.waitForURL(postUrl);
    await page.getByRole('heading', { name: 'P03 edición posterior', exact: true }).waitFor();
    await patchLoss.remove();

    const deleteLoss = await dropFirstReply(`${origin}/api/posts/${postId}`, 'DELETE');
    await dialogAction(() => page.getByRole('button', { name: 'Eliminar', exact: true }).click(), true);
    await page.getByRole('button', { name: 'Comprobar eliminación', exact: true }).waitFor();
    assert.equal((await page.request.get(postUrl)).status(), 404);
    await page.getByRole('button', { name: 'Comprobar eliminación', exact: true }).click();
    await page.waitForURL('**/inicio');
    assert.equal(deleteLoss.sent.length, 1);
    await deleteLoss.remove();

    // Real 401 hides but keeps the mounted draft. Login in another tab restores it.
    await draft('P03 borrador de sesión');
    await context.clearCookies();
    const expired = page.waitForResponse(r => r.url() === `${origin}/api/posts` && r.request().method() === 'POST');
    await save.click();
    const expiredResponse = await expired;
    assert.equal(expiredResponse.status(), 401);
    assert.equal(expiredResponse.headers()['set-cookie'], undefined);
    await page.getByRole('region', { name: 'Recuperar sesión de edición' }).waitFor();
    assert.equal(await title.count(), 0);
    assert.equal(page.url(), `${origin}/publicaciones/nueva`);
    const sessionTab = await context.newPage();
    try {
      await sessionTab.goto(`${origin}/acceso`);
      await sessionTab.getByLabel('Correo electrónico').fill('web@example.test');
      await sessionTab.getByLabel('Contraseña', { exact: true }).fill('Local-test-42!');
      await sessionTab.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
      await sessionTab.waitForURL('**/inicio');
      await expect(title).toHaveValue('P03 borrador de sesión');
      await expect(page.getByLabel('Materia', { exact: true })).toHaveValue('1');
      await expect(page.getByLabel('Contenido', { exact: true })).toHaveValue('Borrador de recuperación con contenido válido.');
      for (const email of ['other@example.test', 'web@example.test']) {
        const login = await sessionTab.request.post(`${origin}/api/auth/login`, {
          headers: { Origin: origin }, data: { email, password: 'Local-test-42!' },
        });
        assert.equal(login.status(), 200);
        await sessionTab.evaluate(() => {
          const channel = new BroadcastChannel('blog-auth-session');
          channel.postMessage({ type: 'session-changed', sender: 'synthetic-other-tab' }); channel.close();
        });
        if (email === 'other@example.test') {
          await expect(page.getByText('La cuenta cambió.', { exact: false })).toBeVisible();
          assert.equal(await title.count(), 0);
        } else {
          // The discarded document may reload after the next broadcast. It
          // must start a fresh form, never resurrect the previous draft.
          await expect(title).toHaveValue('');
        }
      }
      assert.equal((await db.query('SELECT count(*)::int AS total FROM publicacion WHERE titulo=$1', ['P03 borrador de sesión'])).rows[0].total, 0);
    } finally { await sessionTab.close(); }
  } finally { await db.end(); }
};
