import '../setup.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, bodyOf } from '../helpers.mjs';
import { connect } from '../../pipeline/helpcenter/intercom.mjs';

let mock;
afterEach(() => mock?.restore());

const API = 'https://api.intercom.io';
const raw = { id: 12, title: 'T', description: null, body: '<p>b</p>', state: 'draft', url: null, author_id: 3, parent_id: 9, updated_at: 1700000000 };

test('get: method, URL, headers, and the article in the contract shape', async () => {
  mock = mockFetch([{ url: `${API}/articles/12`, reply: { json: raw } }]);
  const a = await connect({ token: 'tok' }).get(12);
  assert.deepEqual(a, { id: '12', title: 'T', description: '', body: '<p>b</p>', state: 'draft', url: null, authorId: 3, parentIds: [9], updatedAt: 1700000000 });
  const req = mock.calls[0];
  assert.equal(req.method, 'GET');
  assert.equal(req.headers.get('authorization'), 'Bearer tok');
  assert.equal(req.headers.get('accept'), 'application/json');
  assert.equal(req.headers.get('intercom-version'), '2.14');
  assert.equal(req.headers.get('content-type'), null);
});

test('base URL and version are configurable; ids are URL-encoded', async () => {
  mock = mockFetch([{ url: 'https://api.eu.intercom.io/articles/a%2Fb', reply: { json: { ...raw, parent_ids: [1, 2] } } }]);
  const a = await connect({ token: 't', baseUrl: 'https://api.eu.intercom.io/', version: '2.11' }).get('a/b');
  assert.deepEqual(a.parentIds, [1, 2]);
  assert.equal(mock.calls[0].headers.get('intercom-version'), '2.11');
});

test('find: the search query and the articles', async () => {
  mock = mockFetch([{ url: `${API}/articles/search?`, reply: { json: { data: { articles: [raw] } } } }]);
  const r = await connect({ token: 't' }).find('smart scheduling', { state: 'published' });
  assert.equal(r.length, 1);
  const u = new URL(mock.calls[0].url);
  assert.equal(u.searchParams.get('phrase'), 'smart scheduling');
  assert.equal(u.searchParams.get('state'), 'published');
  assert.equal(u.searchParams.get('per_page'), '20');
  mock.restore();
  mock = mockFetch([{ url: `${API}/articles/search?`, reply: { json: {} } }]);
  assert.deepEqual(await connect({ token: 't' }).find('x'), []);
  assert.equal(new URL(mock.calls[0].url).searchParams.get('state'), 'all');
});

test('create: POST with numeric author and parent', async () => {
  mock = mockFetch([{ method: 'POST', url: `${API}/articles`, reply: { json: raw } }]);
  await connect({ token: 't' }).create({ title: 'T', description: 'D', body: '<p/>', authorId: '3', state: 'draft', parentId: '9' });
  const req = mock.calls[0];
  assert.equal(req.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(await bodyOf(req)), { title: 'T', description: 'D', body: '<p/>', state: 'draft', author_id: 3, parent_id: 9 });
  mock.calls.length = 0;
  await connect({ token: 't' }).create({ title: 'T', description: 'D', body: '', authorId: '3', state: 'draft' });
  assert.ok(!('parent_id' in JSON.parse(await bodyOf(mock.calls[0]))));
});

test('update: PUT, state only when given', async () => {
  mock = mockFetch([{ method: 'PUT', url: `${API}/articles/12`, reply: { json: raw } }]);
  const hc = connect({ token: 't' });
  await hc.update('12', { title: 'T', description: 'D', body: 'B', state: 'published' });
  assert.deepEqual(JSON.parse(await bodyOf(mock.calls[0])), { title: 'T', description: 'D', body: 'B', state: 'published' });
  await hc.update('12', { title: 'T', description: 'D', body: 'B' });
  assert.ok(!('state' in JSON.parse(await bodyOf(mock.calls[1]))));
});

test('me, authors (admins only), collections (names unescaped)', async () => {
  mock = mockFetch([
    { url: `${API}/me`, reply: { json: { id: 5, name: 'Pat' } } },
    { url: `${API}/admins`, reply: { json: { admins: [{ type: 'admin', id: 1, name: 'A' }, { type: 'team', id: 2, name: 'Team' }] } } },
    { url: `${API}/help_center/collections?per_page=150`, reply: { json: { data: [{ id: 8, name: 'Billing &amp; Plans', parent_id: null }, { id: 9, name: 'Sub', parent_id: 8 }] } } },
  ]);
  const hc = connect({ token: 't' });
  assert.deepEqual(await hc.me(), { id: '5', name: 'Pat' });
  assert.deepEqual(await hc.authors(), [{ id: '1', name: 'A' }]);
  assert.deepEqual(await hc.collections(), [{ id: '8', name: 'Billing & Plans', parentId: null }, { id: '9', name: 'Sub', parentId: 8 }]);
});

test('errors carry the method, route, status and the API\'s reasons', async () => {
  mock = mockFetch([{ url: `${API}/articles/1`, reply: { status: 401, json: { errors: [{ code: 'unauthorized', message: 'Access Token Invalid' }] } } }]);
  await assert.rejects(connect({ token: 't' }).get(1), /help center GET \/articles\/1 -> 401 unauthorized: Access Token Invalid/);
  mock.restore();
  mock = mockFetch([{ url: `${API}/articles/1`, reply: { status: 500, text: '' } }]);
  await assert.rejects(connect({ token: 't' }).get(1), /-> 500/);
});
