// The example application captures sign in to: login, session, pages.

import '../setup.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../helpers.mjs';
import { freePort } from '../fakes.mjs';

let app;
let base;
before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  app = await startServer('demo-app/server.mjs', { env: { DEMO_APP_PORT: String(port) }, url: `${base}/login` });
});
after(() => app?.stop());

const get = (p, cookie) => fetch(`${base}${p}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const login = (email, password, next) => fetch(`${base}/login`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ email, password, ...(next ? { next } : {}) }),
});

test('pages need a session: redirect to the login with next', async () => {
  const r = await get('/meetings');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login?next=%2Fmeetings');
});

test('the login page has the form the target signs in with', async () => {
  const html = await (await get('/login')).text();
  assert.match(html, /name="email"/);
  assert.match(html, /name="password"/);
  assert.match(html, /type="submit"/);
});

test('wrong credentials: 401, no session', async () => {
  const r = await login('demo@acme.example', 'wrong');
  assert.equal(r.status, 401);
  assert.equal(r.headers.get('set-cookie'), null);
});

test('right credentials: a session cookie, then every page of the example feature', async () => {
  const r = await login('demo@acme.example', 'demo-password', '/meetings');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/meetings');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.match(cookie, /^sid=\w+/);
  for (const p of ['/', '/conversations', '/meetings', '/settings/scheduling', '/settings/booking-rules']) {
    const page = await get(p, cookie);
    assert.equal(page.status, 200, p);
    const html = await page.text();
    assert.match(html, /data-testid="user-menu"/, `${p} shows the signed-in marker`);
  }
  // personal data is marked for blurring, the banner for hiding (targets/demo-app.json)
  const conv = await (await get('/conversations', cookie)).text();
  assert.match(conv, /data-pii/);
  assert.match(conv, /data-testid="system-banner"/);
});

test('an outside next is not followed', async () => {
  const r = await login('demo@acme.example', 'demo-password', 'https://evil.example/');
  assert.equal(r.headers.get('location'), '/conversations');
});

test('logout ends the session', async () => {
  const cookie = (await login('demo@acme.example', 'demo-password')).headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/logout', cookie)).status, 302);
  assert.equal((await get('/meetings', cookie)).status, 302);
});

test('styles, script and brand fonts are served; unknown paths are 404', async () => {
  assert.match((await get('/app.css')).headers.get('content-type'), /text\/css/);
  assert.match((await get('/app.js')).headers.get('content-type'), /javascript/);
  assert.equal((await get('/fonts/Inter-Regular.woff2')).status, 200);
  assert.equal((await get('/fonts/nope.woff2')).status, 404);
  const cookie = (await login('demo@acme.example', 'demo-password')).headers.get('set-cookie').split(';')[0];
  assert.equal((await get('/no-such-page', cookie)).status, 404);
});
