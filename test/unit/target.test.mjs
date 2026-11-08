import '../setup.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../helpers.mjs';
import { TARGETS_DIR, PROFILES_DIR, listTargets, loadTarget, targetLook, fillSecrets, requireCredentials } from '../../pipeline/target.mjs';

// Targets live in the repo's targets/ (not configurable): test targets are
// written there under a unique prefix and removed afterwards.
const PREFIX = `zz-test-${process.pid}`;
const written = [];
function target(name, json, local) {
  const n = `${PREFIX}-${name}`;
  const put = (file, v) => { fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v)); written.push(file); };
  if (json !== undefined) put(path.join(TARGETS_DIR, `${n}.json`), json);
  if (local !== undefined) put(path.join(TARGETS_DIR, `${n}.local.json`), local);
  return n;
}
after(() => { for (const f of written) fs.rmSync(f, { force: true }); });

test('targets and profiles live in the repo', () => {
  assert.equal(TARGETS_DIR, path.join(ROOT, 'targets'));
  assert.equal(PROFILES_DIR, path.join(ROOT, 'profiles'));
});

test('the demo-app target resolves from .env.example', () => {
  const t = loadTarget('demo-app');
  assert.equal(t.app, 'http://localhost:4173');
  assert.equal(t.startUrl, '/conversations');
  assert.deepEqual(t.viewport, { width: 1280, height: 800 });
  assert.equal(t.auth.mode, 'form');
  assert.equal(t.auth.username, 'demo@acme.example');
  assert.equal(t.auth.password, 'demo-password');
  assert.equal(t.profile, path.join(ROOT, 'profiles', 'demo-app'));
  assert.deepEqual(t.missingEnv, []);
  assert.deepEqual(requireCredentials(t), t.auth);
});

test('listTargets includes local-only targets, once each', () => {
  const both = target('both', { app: 'https://a.example' }, { secrets: {} });
  const localOnly = target('localonly', undefined, { app: 'https://b.example' });
  const names = listTargets();
  assert.ok(names.includes('demo-app'));
  assert.ok(names.includes(localOnly));
  assert.equal(names.filter((n) => n === both).length, 1);
  assert.equal(loadTarget(localOnly).app, 'https://b.example');
});

test('defaults for everything but app', () => {
  const t = loadTarget(target('min', { app: 'https://min.example' }));
  assert.equal(t.startUrl, '/');
  assert.deepEqual(t.viewport, { width: 1440, height: 900 });
  assert.deepEqual([t.hideSelectors, t.blurSelectors, t.replaceText, t.blockUrls, t.pageUrlMatch], [[], [], [], [], []]);
  assert.equal(t.auth.mode, 'none');
  assert.deepEqual(t.secrets, {});
});

test('.local.json deep-merges over the committed file', () => {
  const name = target('merge',
    { app: 'https://base.example', viewport: { width: 1000, height: 700 }, auth: { mode: 'form', selectors: { username: '#u', password: '#p' } }, hideSelectors: ['.a'] },
    { auth: { username: 'me', password: 'pw', selectors: { password: '#pw' } }, hideSelectors: ['.b'] });
  const t = loadTarget(name);
  assert.deepEqual(t.viewport, { width: 1000, height: 700 });
  assert.deepEqual(t.auth.selectors, { username: '#u', password: '#pw' });
  assert.equal(t.auth.username, 'me');
  assert.deepEqual(t.hideSelectors, ['.b']); // arrays are replaced, not merged
});

test('targetLook: replaceText joins the capture hash only when set', () => {
  const t = loadTarget(target('look', { app: 'https://look.example' }));
  assert.equal('replace' in targetLook(t), false); // captures from before it keep their hash
  const r = loadTarget(target('look2', { app: 'https://look.example', replaceText: [{ from: 'Real Name', to: 'Maya Brooks' }] }));
  assert.deepEqual(targetLook(r).replace, [{ from: 'Real Name', to: 'Maya Brooks' }]);
});

test('env: references resolve; missing ones are recorded by path', () => {
  process.env.ZZ_TEST_APP = 'https://env.example';
  process.env.ZZ_TEST_USER = 'envuser';
  const t = loadTarget(target('env', {
    app: 'env:ZZ_TEST_APP',
    auth: { mode: 'form', username: 'env:ZZ_TEST_USER', password: 'env:ZZ_TEST_NOPE' },
    secrets: { team: 'env:ZZ_TEST_NOPE2' },
  }));
  assert.equal(t.app, 'https://env.example');
  assert.equal(t.auth.username, 'envuser');
  assert.equal(t.auth.password, null);
  assert.deepEqual(t.missingEnv, [{ at: 'auth.password', variable: 'ZZ_TEST_NOPE' }, { at: 'secrets.team', variable: 'ZZ_TEST_NOPE2' }]);
  assert.throws(() => requireCredentials(t), /no password \(unset: ZZ_TEST_NOPE\)/);
});

test('errors: no name, unknown target, bad app, bad auth mode, bad JSON', () => {
  assert.throws(() => loadTarget(''), /no target/);
  assert.throws(() => loadTarget(`${PREFIX}-absent`), /not found in targets\/.*Known: .*demo-app/s);
  assert.throws(() => loadTarget(target('noapp', { app: 'ftp://x' })), /"app" must be an http\(s\) URL/);
  assert.throws(() => loadTarget(target('envapp', { app: 'env:ZZ_TEST_UNSET_APP' })), /ZZ_TEST_UNSET_APP is not set/);
  assert.throws(() => loadTarget(target('auth', { app: 'https://x.example', auth: { mode: 'oauth' } })), /auth\.mode must be/);
  assert.throws(() => loadTarget(target('json', '{ broken')), /is not valid JSON/);
});

test('unknown keys warn but load; // comment keys do not', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  loadTarget(target('keys', { app: 'https://x.example', '//app': 'comment', colour: 'red' }));
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /unknown key "colour"/);
});

test('targetLook carries no credentials or secrets', () => {
  const look = targetLook(loadTarget('demo-app'));
  assert.deepEqual(Object.keys(look).sort(), ['app', 'block', 'blur', 'hide', 'name', 'viewport']);
  assert.doesNotMatch(JSON.stringify(look), /demo-password/);
});

test('fillSecrets: placeholders filled and URL-encoded; a missing one named', () => {
  const t = { name: 'x', secrets: { team: 'a b/c', id: '7' } };
  assert.equal(fillSecrets(t, '/teams/{team}/items/{id}'), '/teams/a%20b%2Fc/items/7');
  assert.equal(fillSecrets(t, '/plain'), '/plain');
  assert.throws(() => fillSecrets(t, '/x/{nope}'), /has no secret "nope"/);
});

test('requireCredentials names what is missing', () => {
  assert.throws(() => requireCredentials({ name: 'x', missingEnv: [], auth: { username: null, password: 'p' } }), /no username/);
});
