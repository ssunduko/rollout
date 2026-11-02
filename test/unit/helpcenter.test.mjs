import '../setup.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mockFetch, bodyOf } from '../helpers.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { writeJson, readJson } from '../../pipeline/env.mjs';
import { helpDir, publishedFile } from '../../pipeline/help.mjs';
import { helpCenter, publishHelp } from '../../pipeline/helpcenter.mjs';

const brand = loadBrand();
const SLUG = 'hc-test';
const API = 'https://api.intercom.io';
const quiet = () => {};

// The built article on disk: one image already hosted at a public URL.
const SENT_IMG = 'https://img.acme.example/help/hc-test/shot.abc.png';
function writeBuilt({ images = [{ file: 'shot.png', hash: 'abc', src: SENT_IMG, reused: false }] } = {}) {
  const dir = helpDir(SLUG);
  fs.mkdirSync(dir, { recursive: true });
  const body = images.map((i) => `<img src="${i.src ?? ''}" alt="">`).join('') + '<p>Body</p>';
  fs.writeFileSync(path.join(dir, 'article.html'), body);
  writeJson(path.join(dir, 'article.json'), { title: 'Acme Widgets', description: 'How to use Acme Widgets.', images });
  return body;
}

// A help center with articles in memory, over mocked fetch.
function fakeIntercom(articles = {}) {
  let next = 100;
  const host = (body) => body.replace(/https:\/\/img\.acme\.example\/[^"]+/g, (u) => `https://downloads.intercomcdn.example/${u.split('/').pop()}`);
  const json = (a) => ({ json: { ...a, updated_at: a.updated_at, parent_ids: a.parent_ids ?? [] } });
  return mockFetch([
    { method: 'GET', url: /\/articles\/\d+$/, reply: (req) => { const a = articles[req.url.split('/').pop()]; return a ? json(a) : { status: 404, json: { errors: [{ code: 'not_found', message: 'nope' }] } }; } },
    { method: 'POST', url: `${API}/articles`, reply: async (req) => {
      const b = JSON.parse(await bodyOf(req));
      const id = String(next++);
      articles[id] = { id, ...b, body: host(b.body), url: `https://help.acme.example/${id}`, updated_at: 2000 };
      return json(articles[id]);
    } },
    { method: 'PUT', url: /\/articles\/\d+$/, reply: async (req) => {
      const id = req.url.split('/').pop();
      const b = JSON.parse(await bodyOf(req));
      articles[id] = { ...articles[id], ...b, body: host(b.body), updated_at: 3000 };
      return json(articles[id]);
    } },
  ]);
}

const help = (publish = {}, live = null) => ({ publish: { articleId: null, state: 'draft', authorId: '7', parentId: null, updatedAt: null, ...publish }, live });

let mock;
beforeEach(() => {
  process.env.HELP_CENTER_TOKEN = 'test-token';
  delete process.env.HELP_CENTER;
  fs.rmSync(publishedFile(SLUG), { force: true });
});
afterEach(() => mock?.restore());

test('helpCenter: provider from HELP_CENTER, else the brand; token required', async () => {
  const hc = await helpCenter(brand);
  assert.equal(hc.name, 'intercom');
  for (const k of ['find', 'get', 'create', 'update', 'me', 'authors', 'collections']) assert.equal(typeof hc[k], 'function');
  await assert.rejects(helpCenter({ ...brand, help: {} }), /no help center configured/);
  process.env.HELP_CENTER = 'zendesk';
  await assert.rejects(helpCenter(brand), /no help-center adapter "zendesk" \(intercom\)/);
  process.env.HELP_CENTER = 'intercom';
  delete process.env.HELP_CENTER_TOKEN;
  await assert.rejects(helpCenter(brand), /HELP_CENTER_TOKEN is not set/);
});

test('helpCenter: HELP_CENTER_API_URL is the base URL', async () => {
  process.env.HELP_CENTER_API_URL = 'https://api.eu.intercom.io';
  mock = mockFetch([{ url: 'https://api.eu.intercom.io/me', reply: { json: { id: 1, name: 'x' } } }]);
  try {
    await (await helpCenter(brand)).me();
    assert.equal(mock.calls[0].headers.get('authorization'), 'Bearer test-token');
  } finally {
    delete process.env.HELP_CENTER_API_URL;
  }
});

test('create: a new draft, recorded with the help center\'s image copies', async () => {
  writeBuilt();
  const store = {};
  mock = fakeIntercom(store);
  const rec = await publishHelp({ slug: SLUG, help: help({ parentId: '55' }), brand, log: quiet });
  const post = mock.calls.find((c) => c.method === 'POST');
  assert.deepEqual(JSON.parse(await bodyOf(post)), {
    title: 'Acme Widgets', description: 'How to use Acme Widgets.', body: `<img src="${SENT_IMG}" alt=""><p>Body</p>`,
    state: 'draft', author_id: 7, parent_id: 55,
  });
  assert.equal(rec.action, 'create');
  assert.equal(rec.articleId, '100');
  assert.equal(rec.state, 'draft');
  assert.equal(rec.provider, 'intercom');
  assert.deepEqual(rec.images, { 'shot.png': { hash: 'abc', url: 'https://downloads.intercomcdn.example/shot.abc.png' } });
  assert.deepEqual(readJson(publishedFile(SLUG)).articleId, '100');
});

test('create: refused without an author, or published without --live or with placeholders', async () => {
  writeBuilt();
  mock = fakeIntercom();
  await assert.rejects(publishHelp({ slug: SLUG, help: help({ authorId: null }), brand, log: quiet }), /no author/);
  await assert.rejects(publishHelp({ slug: SLUG, help: help(), brand, state: 'published', log: quiet }), /publishing makes it live — pass --live/);
  writeBuilt({ images: [{ file: 'x.png', hash: 'h', src: null }] });
  await assert.rejects(publishHelp({ slug: SLUG, help: help(), brand, state: 'published', live: true, log: quiet }), /placeholder images cannot be published/);
  assert.ok(!mock.calls.some((c) => c.method === 'POST'), 'nothing was created');
  // a placeholder in a draft is fine
  await publishHelp({ slug: SLUG, help: help(), brand, log: quiet });
  assert.ok(mock.calls.some((c) => c.method === 'POST'));
});

test('create: published with --live', async () => {
  writeBuilt();
  mock = fakeIntercom();
  const rec = await publishHelp({ slug: SLUG, help: help(), brand, state: 'published', live: true, log: quiet });
  assert.equal(rec.state, 'published');
});

test('update: refused when never read, or edited since it was read', async () => {
  writeBuilt();
  mock = fakeIntercom({ 5: { id: '5', title: 'Old', body: '', state: 'draft', updated_at: 1500 } });
  await assert.rejects(publishHelp({ slug: SLUG, help: help({ articleId: '5' }), brand, log: quiet }), /article 5 was never read/);
  await assert.rejects(publishHelp({ slug: SLUG, help: help({ articleId: '5', updatedAt: 1000 }), brand, log: quiet }), /article 5 was edited in the help center since it was read/);
  // our own last publish counts as a read
  await assert.rejects(publishHelp({ slug: SLUG, help: help({ articleId: '5', updatedAt: 1000 }, { updatedAt: 1400 }), brand, log: quiet }), /edited in the help center/);
  assert.ok(!mock.calls.some((c) => c.method === 'PUT'), 'nothing was overwritten');
});

test('update: a draft stays a draft; state is sent', async () => {
  writeBuilt();
  mock = fakeIntercom({ 5: { id: '5', title: 'Old', body: '', state: 'draft', updated_at: 1500 } });
  const rec = await publishHelp({ slug: SLUG, help: help({ articleId: '5', updatedAt: 1500 }), brand, log: quiet });
  const put = mock.calls.find((c) => c.method === 'PUT');
  assert.equal(JSON.parse(await bodyOf(put)).state, 'draft');
  assert.equal(rec.action, 'update');
  assert.equal(rec.updatedAt, 3000);
});

test('update: publishing a draft needs --live and no placeholders', async () => {
  writeBuilt();
  mock = fakeIntercom({ 5: { id: '5', body: '', state: 'draft', updated_at: 1500 } });
  await assert.rejects(publishHelp({ slug: SLUG, help: help({ articleId: '5', updatedAt: 1500 }), brand, state: 'published', log: quiet }), /pass --live/);
  const rec = await publishHelp({ slug: SLUG, help: help({ articleId: '5', updatedAt: 1500 }), brand, state: 'published', live: true, log: quiet });
  assert.equal(rec.state, 'published');
});

test('update of a published article: never as a draft, only --live, no placeholders, state left out', async () => {
  writeBuilt();
  mock = fakeIntercom({ 5: { id: '5', body: '', state: 'published', updated_at: 1500 } });
  const h = help({ articleId: '5', updatedAt: 1500 });
  await assert.rejects(publishHelp({ slug: SLUG, help: h, brand, log: quiet }), /sending it as a draft would unpublish it/);
  await assert.rejects(publishHelp({ slug: SLUG, help: h, brand, state: 'published', log: quiet }), /the update goes live at once — pass --live/);
  writeBuilt({ images: [{ file: 'x.png', hash: 'h', src: null }] });
  await assert.rejects(publishHelp({ slug: SLUG, help: h, brand, state: 'published', live: true, log: quiet }), /placeholder images and would go live/);
  writeBuilt();
  await publishHelp({ slug: SLUG, help: h, brand, state: 'published', live: true, log: quiet });
  const put = mock.calls.find((c) => c.method === 'PUT');
  assert.ok(!('state' in JSON.parse(await bodyOf(put))));
});

test('image copies: a reused image keeps its URL; an uncopied one and a count mismatch are not recorded', async () => {
  const reusedUrl = 'https://downloads.intercomcdn.example/old.png';
  writeBuilt({ images: [{ file: 'old.png', hash: 'o', src: reusedUrl, reused: true }, { file: 'raw.png', hash: 'r', src: 'https://elsewhere.example/raw.png' }] });
  mock = fakeIntercom();
  const logs = [];
  const rec = await publishHelp({ slug: SLUG, help: help(), brand, log: (l) => logs.push(l) });
  assert.deepEqual(rec.images, { 'old.png': { hash: 'o', url: reusedUrl } });
  assert.ok(logs.some((l) => /raw\.png: the help center still points at/.test(l)));

  mock.restore();
  writeBuilt();
  mock = mockFetch([
    { method: 'POST', url: `${API}/articles`, reply: { json: { id: 1, state: 'draft', body: '', updated_at: 1 } } },
    { method: 'GET', url: `${API}/articles/1`, reply: { json: { id: 1, state: 'draft', body: '<p>no images</p>', updated_at: 1 } } },
  ]);
  logs.length = 0;
  const r2 = await publishHelp({ slug: SLUG, help: help(), brand, log: (l) => logs.push(l) });
  assert.deepEqual(r2.images, {});
  assert.ok(logs.some((l) => /came back with 0 images for 1 sent/.test(l)));
});
