import '../setup.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, bodyOf } from '../helpers.mjs';
import { connect } from '../../pipeline/news/intercom.mjs';

let mock;
afterEach(() => mock?.restore());

const API = 'https://api.intercom.io';
const raw = {
  id: '12', type: 'news-item', title: 'T', body: '<p>Hello <b>there</b></p>', sender_id: 5, state: 'draft', labels: ['New feature'],
  newsfeed_assignments: [{ newsfeed_id: 7, published_at: null }], cover_image_url: null, reactions: ['🎉', '👍'], deliver_silently: true,
  created_at: 1700000000, updated_at: 1700000100, published_at: null,
};
const json = async (req) => JSON.parse(await bodyOf(req));

test('get: bearer token, version header, and the item in the contract shape', async () => {
  mock = mockFetch([{ method: 'GET', url: `${API}/news/news_items/12`, reply: { json: raw } }]);
  const x = await connect({ token: 'tok' }).get('12');
  assert.deepEqual(x, {
    id: '12', title: 'T', body: '<p>Hello <b>there</b></p>', text: 'Hello there', state: 'draft', senderId: '5', labels: ['New feature'],
    newsfeedIds: ['7'], coverImageUrl: null, reactions: ['🎉', '👍'], silent: true, publishedAt: null, updatedAt: 1700000100, url: null,
  });
  const req = mock.calls[0];
  assert.equal(req.headers.get('authorization'), 'Bearer tok');
  assert.equal(req.headers.get('intercom-version'), '2.14');
});

test('all pages through the list, 20 at a time', async () => {
  mock = mockFetch([{ url: `${API}/news/news_items?`, reply: (req) => {
    const page = Number(new URL(req.url).searchParams.get('page'));
    return { json: { data: page === 1 ? Array(20).fill(raw) : [raw], pages: { total_pages: 2 } } };
  } }]);
  assert.equal((await connect({ token: 't', baseUrl: `${API}/`, version: '2.11' }).all()).length, 21);
  assert.equal(new URL(mock.calls[0].url).searchParams.get('per_page'), '20');
  assert.equal(mock.calls[0].headers.get('intercom-version'), '2.11');
});

test('create: a draft by default; numeric ids; lists always sent', async () => {
  mock = mockFetch([{ method: 'POST', url: `${API}/news/news_items`, reply: { json: raw } }]);
  await connect({ token: 't' }).create({ title: 'T', body: '<p/>', senderId: '5', silent: true, newsfeedIds: ['7', '9'] });
  assert.deepEqual(await json(mock.calls[0]), {
    title: 'T', body: '<p/>', sender_id: 5, state: 'draft', deliver_silently: true, labels: [],
    newsfeed_assignments: [{ newsfeed_id: 7 }, { newsfeed_id: 9 }], reactions: [],
  });
});

test('update: PUT with the sender and every list (the API clears lists left out)', async () => {
  mock = mockFetch([{ method: 'PUT', url: `${API}/news/news_items/12`, reply: { json: raw } }]);
  await connect({ token: 't' }).update('12', { title: 'T', body: 'B', senderId: 5, state: 'live', silent: false, labels: ['A'], newsfeedIds: ['7'], coverImageUrl: 'https://x/c.png', reactions: ['🎉'] });
  assert.deepEqual(await json(mock.calls[0]), {
    title: 'T', body: 'B', sender_id: 5, state: 'live', deliver_silently: false, labels: ['A'],
    newsfeed_assignments: [{ newsfeed_id: 7 }], cover_image_url: 'https://x/c.png', reactions: ['🎉'],
  });
});

test('newsfeeds (names unescaped) and senders (admins only)', async () => {
  mock = mockFetch([
    { url: `${API}/news/newsfeeds`, reply: { json: { data: [{ id: 7, name: 'Users &amp; Leads' }] } } },
    { url: `${API}/admins`, reply: { json: { admins: [{ type: 'admin', id: 1, name: 'A' }, { type: 'team', id: 2, name: 'T' }] } } },
  ]);
  const c = connect({ token: 't' });
  assert.deepEqual(await c.newsfeeds(), [{ id: '7', name: 'Users & Leads' }]);
  assert.deepEqual(await c.senders(), [{ id: '1', name: 'A' }]);
});

test('errors name the route and the reason; an empty 404 means News is off', async () => {
  mock = mockFetch([
    { url: `${API}/news/news_items/1`, reply: { status: 401, json: { errors: [{ code: 'unauthorized', message: 'Access Token Invalid' }] } } },
    { url: `${API}/news/news_items/2`, reply: { status: 404, text: '' } },
  ]);
  const c = connect({ token: 't' });
  await assert.rejects(c.get('1'), /GET \/news\/news_items\/1 -> 401 unauthorized: Access Token Invalid \(the token needs read and write access to news\)/);
  await assert.rejects(c.get('2'), /404 \(no body: is News enabled on the workspace\?\)/);
});
