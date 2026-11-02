import '../setup.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { SANDBOX } from '../helpers.mjs';
import { serveDir } from '../../pipeline/serve.mjs';

const ROOT_DIR = path.join(SANDBOX, 'site');
let server;
let url;

before(async () => {
  fs.mkdirSync(path.join(ROOT_DIR, 'assets', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(ROOT_DIR, 'index.html'), '<h1>home</h1>');
  fs.writeFileSync(path.join(ROOT_DIR, 'assets', 'app.css'), 'body{}');
  fs.writeFileSync(path.join(ROOT_DIR, 'assets', 'pic.GIF'), 'GIF89a');
  fs.writeFileSync(path.join(ROOT_DIR, 'assets', 'font.woff2'), 'w');
  fs.writeFileSync(path.join(ROOT_DIR, 'assets', 'blob.xyz'), 'b');
  fs.writeFileSync(path.join(ROOT_DIR, 'assets', 'sub', 'index.html'), 'sub');
  fs.writeFileSync(path.join(ROOT_DIR, 'assets', 'a b.txt'), 'spaced');
  fs.writeFileSync(path.join(SANDBOX, 'secret.txt'), 'outside');
  ({ server, url } = await serveDir(ROOT_DIR));
});
after(() => server.close());

// raw GET without URL normalisation (fetch would resolve ../ itself)
const raw = (p) => new Promise((resolve, reject) => {
  const { port } = new URL(url);
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
  }).on('error', reject);
});

test('listens on a free port on localhost', () => {
  assert.match(url, /^http:\/\/localhost:\d+\/$/);
  assert.notEqual(new URL(url).port, '0');
});

test('serves index.html for the root and for folders', async () => {
  const home = await raw('/');
  assert.equal(home.status, 200);
  assert.equal(home.type, 'text/html; charset=utf-8');
  assert.equal(home.body, '<h1>home</h1>');
  assert.equal((await raw('/assets/sub/')).body, 'sub');
});

test('content types by extension, any case; unknown is octet-stream', async () => {
  assert.equal((await raw('/assets/app.css')).type, 'text/css');
  assert.equal((await raw('/assets/pic.GIF')).type, 'image/gif');
  assert.equal((await raw('/assets/font.woff2')).type, 'font/woff2');
  assert.equal((await raw('/assets/blob.xyz')).type, 'application/octet-stream');
});

test('decodes percent-encoded paths; no caching', async () => {
  const r = await fetch(`${url}assets/a%20b.txt`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'spaced');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('404 for a missing file', async () => {
  const r = await raw('/nope.html');
  assert.equal(r.status, 404);
  assert.equal(r.body, 'not found');
});

test('never serves files outside the folder', async () => {
  for (const p of ['/../secret.txt', '/assets/../../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/..%5csecret.txt']) {
    const r = await raw(p);
    assert.notEqual(r.body, 'outside', p);
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
  }
});

test('a port in use is an error', async () => {
  const port = Number(new URL(url).port);
  await assert.rejects(serveDir(ROOT_DIR, port), /EADDRINUSE/);
});
