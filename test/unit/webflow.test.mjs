import '../setup.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mockFetch, bodyOf } from '../helpers.mjs';
import { connect } from '../../pipeline/website/webflow.mjs';

const API = 'https://api.webflow.com/v2';
let mock;
afterEach(() => mock?.restore());
const wf = (o = {}) => connect({ token: 'tok', siteId: 'site 1', ...o });

test('site and sites: headers, encoded id, domains', async () => {
  mock = mockFetch([
    { url: `${API}/sites/site%201`, reply: { json: { id: 's1', displayName: 'Acme', customDomains: [{ url: 'www.acme.example' }], previewUrl: 'p' } } },
    { url: `${API}/sites`, reply: { json: { sites: [{ id: 's1', displayName: 'Acme' }] } } },
  ]);
  assert.deepEqual(await wf().site(), { id: 's1', name: 'Acme', domains: ['www.acme.example'], previewUrl: 'p' });
  assert.deepEqual(await wf().sites(), [{ id: 's1', name: 'Acme', domains: [] }]);
  const req = mock.calls[0];
  assert.equal(req.method, 'GET');
  assert.equal(req.headers.get('authorization'), 'Bearer tok');
  assert.equal(req.headers.get('accept'), 'application/json');
});

test('pages: every page of a paginated list, in the contract shape', async () => {
  const p = (i) => ({ id: `p${i}`, title: `T${i}`, slug: `s${i}`, parentId: 'f', lastUpdated: 'u', draft: i === 0 });
  mock = mockFetch([{ url: `${API}/sites/site%201/pages?`, reply: (req) => {
    const off = Number(new URL(req.url).searchParams.get('offset'));
    assert.equal(new URL(req.url).searchParams.get('limit'), '100');
    return { json: { pages: off === 0 ? Array.from({ length: 100 }, (_, i) => p(i)) : [p(100)], pagination: { total: 101 } } };
  } }]);
  const pages = await wf().pages();
  assert.equal(pages.length, 101);
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(pages[0], { id: 'p0', title: 'T0', slug: 's0', path: '/s0', folderId: 'f', collectionId: null, draft: true, archived: false, updatedAt: 'u', seo: null, openGraph: null });
});

test('page: the published path wins; components', async () => {
  mock = mockFetch([
    { url: `${API}/pages/p1`, reply: { json: { id: 'p1', slug: 'x', publishedPath: '/features/x' } } },
    { url: `${API}/sites/site%201/components?`, reply: { json: { components: [{ id: 'c1', name: 'Hero', readonly: 1 }] } } },
  ]);
  assert.equal((await wf().page('p1')).path, '/features/x');
  assert.deepEqual(await wf().components(), [{ id: 'c1', name: 'Hero', group: null, description: null, readonly: true }]);
});

test('collection, items, item', async () => {
  const it = { id: 'i1', fieldData: { name: 'N', slug: 'n', x: 1 }, isDraft: true, lastUpdated: 'u', lastPublished: null };
  mock = mockFetch([
    { url: `${API}/collections/c1/items/i1`, reply: { json: it } },
    { url: `${API}/collections/c1/items?`, reply: { json: { items: [it], pagination: { total: 1 } } } },
    { url: `${API}/collections/c1`, reply: { json: { id: 'c1', displayName: 'Features', slug: 'features', fields: [{ slug: 'name', displayName: 'Name', type: 'PlainText', isRequired: true }] } } },
  ]);
  assert.deepEqual(await wf().collection('c1'), { id: 'c1', name: 'Features', slug: 'features', fields: [{ slug: 'name', name: 'Name', type: 'PlainText', required: true }] });
  const want = { id: 'i1', name: 'N', slug: 'n', draft: true, archived: false, updatedAt: 'u', publishedAt: null, fields: { name: 'N', slug: 'n', x: 1 } };
  assert.deepEqual(await wf().items('c1'), [want]);
  assert.deepEqual(await wf().item('c1', 'i1'), want);
});

test('uploadAsset: register with the MD5, then send the form to the storage URL', async () => {
  const data = Buffer.from('gif-bytes');
  mock = mockFetch([
    { method: 'POST', url: `${API}/sites/site%201/assets`, reply: { json: { id: 'a1', uploadUrl: 'https://storage.acme.example/up', uploadDetails: { key: 'k', policy: 'p' }, hostedUrl: 'https://cdn.acme.example/a1.gif' } } },
    { method: 'POST', url: 'https://storage.acme.example/up', reply: { status: 201 } },
  ]);
  assert.deepEqual(await wf().uploadAsset({ name: 'x.gif', data, type: 'image/gif' }), { id: 'a1', url: 'https://cdn.acme.example/a1.gif' });
  assert.deepEqual(JSON.parse(await bodyOf(mock.calls[0])), { fileName: 'x.gif', fileHash: crypto.createHash('md5').update(data).digest('hex') });
  const form = mock.calls[1].body;
  assert.ok(form instanceof FormData);
  assert.deepEqual([...form.keys()], ['key', 'policy', 'file']);
  assert.equal(await form.get('file').text(), 'gif-bytes');
  assert.equal(form.get('file').name, 'x.gif');
});

test('uploadAsset: a failed storage upload is an error', async () => {
  mock = mockFetch([
    { method: 'POST', url: `${API}/sites`, reply: { json: { id: 'a1', uploadUrl: 'https://storage.acme.example/up' } } },
    { method: 'POST', url: 'https://storage.acme.example/up', reply: { status: 403, text: 'denied' } },
  ]);
  await assert.rejects(wf().uploadAsset({ name: 'x.png', data: Buffer.from('x'), type: 'image/png' }), /website asset upload x\.png -> 403 denied/);
});

test('errors: code, message and details; the base URL is configurable', async () => {
  mock = mockFetch([{ url: 'https://wf.acme.example/v2/sites/site%201', reply: { status: 400, json: { code: 'validation_error', message: 'Bad', details: ['one', { f: 2 }] } } }]);
  await assert.rejects(wf({ baseUrl: 'https://wf.acme.example/v2/' }).site(), /website GET \/sites\/site%201 -> 400 validation_error: Bad: one: \{"f":2\}/);
});
