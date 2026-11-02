import '../setup.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mockFetch, SANDBOX } from '../helpers.mjs';
import { imageStore, imageStoreName, uploadImages } from '../../pipeline/imagestore.mjs';

const KEYS = ['HELP_IMAGE_STORE', 'HELP_IMAGE_BUCKET', 'HELP_IMAGE_REGION', 'HELP_IMAGE_ENDPOINT', 'HELP_IMAGE_PREFIX', 'HELP_IMAGE_BASE_URL', 'HELP_IMAGE_URL_TTL'];
const dir = path.join(SANDBOX, 'output', 'store-test', 'help');
const quiet = () => {};

let mock;
beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { HELP_IMAGE_STORE: 's3', HELP_IMAGE_BUCKET: 'imgs', HELP_IMAGE_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'AKIDTEST', AWS_SECRET_ACCESS_KEY: 'secret' });
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'images', 'a.png'), 'A');
  fs.writeFileSync(path.join(dir, 'images', 'b.gif'), 'B');
});
afterEach(() => mock?.restore());

test('imageStore: none without HELP_IMAGE_STORE; unknown adapters are refused', async () => {
  delete process.env.HELP_IMAGE_STORE;
  assert.equal(imageStoreName(), null);
  assert.equal(await imageStore(), null);
  process.env.HELP_IMAGE_STORE = 'ftp';
  await assert.rejects(imageStore(), /no image-store adapter "ftp" \(s3\)/);
});

test('imageStore: the s3 adapter, configured from .env', async () => {
  const s = await imageStore();
  assert.equal(s.name, 's3');
  assert.equal(s.describe(), 's3://imgs (us-east-1)');
});

test('uploadImages: nothing to upload, no store opened', async () => {
  delete process.env.HELP_IMAGE_STORE; // would throw if it were opened
  assert.deepEqual(await uploadImages({ slug: 'store-test', images: [{ file: 'a.png', upload: false }], dir, log: quiet }), {});
});

test('uploadImages: content-hashed keys, existing objects not sent again, public base URL', async () => {
  process.env.HELP_IMAGE_BASE_URL = 'https://img.acme.example/';
  process.env.HELP_IMAGE_PREFIX = '/help/';
  mock = mockFetch([
    { method: 'HEAD', url: /a\.h1\.png$/, reply: { status: 200 } },
    { method: 'HEAD', url: /b\.h2\.gif$/, reply: { status: 404 } },
    { method: 'PUT', url: /b\.h2\.gif$/, reply: { status: 200 } },
  ]);
  const out = await uploadImages({
    slug: 'store-test', dir, log: quiet,
    images: [{ file: 'a.png', hash: 'h1', upload: true }, { file: 'b.gif', hash: 'h2', upload: true }, { file: 'c.png', hash: 'h3', upload: false }],
  });
  assert.deepEqual(out, {
    'a.png': 'https://img.acme.example/store-test/a.h1.png',
    'b.gif': 'https://img.acme.example/store-test/b.h2.gif',
  });
  const puts = mock.calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].url, 'https://imgs.s3.us-east-1.amazonaws.com/help/store-test/b.h2.gif');
  assert.equal(puts[0].headers.get('content-type'), 'image/gif');
  assert.equal(String(puts[0].body), 'B');
});

test('uploadImages: without a base URL, presigned links for HELP_IMAGE_URL_TTL', async () => {
  process.env.HELP_IMAGE_URL_TTL = '3600';
  mock = mockFetch([{ method: 'HEAD', url: /./, reply: { status: 200 } }]);
  const out = await uploadImages({ slug: 'store-test', dir, log: quiet, images: [{ file: 'a.png', hash: 'h1', upload: true }] });
  const u = new URL(out['a.png']);
  assert.equal(u.pathname, '/help/store-test/a.h1.png');
  assert.equal(u.searchParams.get('X-Amz-Expires'), '3600');
});
