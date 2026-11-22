import '../setup.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, bodyOf } from '../helpers.mjs';
import { connect } from '../../pipeline/changelog/canny.mjs';

let mock;
afterEach(() => mock?.restore());

const API = 'https://canny.io/api/v1';
const raw = {
  id: 'e1', title: 'T', status: 'draft', types: ['new'], labels: [{ id: 'l1', name: 'Calendar', entryCount: 3 }],
  markdownDetails: '**x**', plaintextDetails: 'x', url: 'https://acme.canny.io/changelog/t', lastSaved: '2026-11-01T10:00:00.000Z',
  publishedAt: null, scheduledFor: null, created: '2026-10-30T09:00:00.000Z',
};
const json = async (req) => JSON.parse(await bodyOf(req));

test('list: POST with the key in a JSON body; entries in the contract shape', async () => {
  mock = mockFetch([{ method: 'POST', url: `${API}/entries/list`, reply: { json: { hasMore: false, entries: [raw] } } }]);
  const r = await connect({ apiKey: 'key' }).list({ status: 'draft,published' });
  assert.deepEqual(r.entries[0], {
    id: 'e1', title: 'T', status: 'draft', types: ['new'], labels: [{ id: 'l1', name: 'Calendar' }], markdown: '**x**', text: 'x',
    url: 'https://acme.canny.io/changelog/t', lastSaved: '2026-11-01T10:00:00.000Z', publishedAt: null, scheduledFor: null, created: '2026-10-30T09:00:00.000Z',
  });
  const req = mock.calls[0];
  assert.equal(req.headers.get('content-type'), 'application/json');
  assert.equal(req.headers.get('authorization'), null);
  assert.deepEqual(await json(req), { apiKey: 'key', limit: 100, skip: 0, sort: 'lastSaved', status: 'draft,published' });
});

test('all pages through the list; get finds one entry by id', async () => {
  const page = (n, from) => Array.from({ length: n }, (_, i) => ({ ...raw, id: `e${from + i}` }));
  mock = mockFetch([{ url: `${API}/entries/list`, reply: async (req) => {
    const { skip } = await json(req);
    return { json: skip === 0 ? { hasMore: true, entries: page(100, 0) } : { hasMore: false, entries: page(5, 100) } };
  } }]);
  const c = connect({ apiKey: 'k', baseUrl: `${API}/` });
  assert.equal((await c.all()).length, 105);
  assert.equal((await c.get('e103')).id, 'e103');
  await assert.rejects(c.get('nope'), /entry nope not found/);
});

test('create: unpublished, one type; extra types set by an update', async () => {
  mock = mockFetch([
    { url: `${API}/entries/create`, reply: { json: { id: 'new1' } } },
    { url: `${API}/entries/update`, reply: { text: 'success' } },
  ]);
  const c = connect({ apiKey: 'k' });
  assert.deepEqual(await c.create({ title: 'T', details: 'D', types: ['new', 'improved'], labelIds: ['l1'], notify: false }), { id: 'new1' });
  assert.deepEqual(await json(mock.calls[0]), { apiKey: 'k', title: 'T', details: 'D', notify: false, published: false, type: 'new', labelIDs: ['l1'] });
  assert.deepEqual(await json(mock.calls[1]), { apiKey: 'k', entryID: 'new1', types: ['new', 'improved'] });
  mock.calls.length = 0;
  await c.create({ title: 'T', details: 'D', types: ['fixed'] });
  assert.equal(mock.calls.length, 1);
  assert.ok(!('labelIDs' in await json(mock.calls[0])));
});

test('update sends only the given fields; change_status names the status', async () => {
  mock = mockFetch([{ url: /\/entries\/(update|change_status)$/, reply: { text: 'success' } }]);
  const c = connect({ apiKey: 'k' });
  await c.update('e1', { details: 'D2' });
  assert.deepEqual(await json(mock.calls[0]), { apiKey: 'k', entryID: 'e1', details: 'D2' });
  await c.update('e1', { title: 'T', details: 'D', types: ['fixed'], labelIds: [], notify: true });
  assert.deepEqual(await json(mock.calls[1]), { apiKey: 'k', entryID: 'e1', title: 'T', details: 'D', types: ['fixed'], labelIDs: [], notify: true });
  await c.changeStatus('e1', 'published');
  assert.equal(mock.calls[2].url, `${API}/entries/change_status`);
  assert.deepEqual(await json(mock.calls[2]), { apiKey: 'k', entryID: 'e1', status: 'published' });
});

test('errors name the route and the reason, never the key', async () => {
  mock = mockFetch([
    { url: `${API}/entries/list`, reply: { status: 400, json: { error: 'invalid api key' } } },
    { url: `${API}/entries/create`, reply: { status: 429, headers: { 'retry-after': '7' }, json: { error: 'slow down' } } },
  ]);
  const c = connect({ apiKey: 'secret-key-123' });
  await assert.rejects(c.list(), (err) => /\/entries\/list -> 400 invalid api key \(check CHANGELOG_API_KEY\)/.test(err.message) && !err.message.includes('secret-key-123'));
  await assert.rejects(c.create({ title: 'T', details: 'D' }), /429 slow down \(rate limited; retry after 7s\)/);
});
