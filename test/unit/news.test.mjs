import '../setup.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mockFetch, bodyOf } from '../helpers.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { writeJson, readJson } from '../../pipeline/env.mjs';
import {
  validateNews, itemHtml, buildNews, matchItems, publishNews, newsService, newsFile, newsDir, newsRecordFile,
} from '../../pipeline/news.mjs';

const brand = loadBrand();
const SLUG = 'news-test';
const API = 'https://api.intercom.io';
const quiet = () => {};

const base = () => ({
  title: 'Acme Widgets spin faster',
  summary: 'Widgets now spin twice as fast.',
  coverImage: 'https://img.acme.example/cover.png',
  image: { url: 'https://img.acme.example/w.gif', alt: 'A spinning widget' },
  sections: [{ title: 'Faster spins', body: 'Spin any widget from the toolbar.' }, { title: 'Also', bullets: ['One', 'Two'] }],
  cta: { label: 'See widgets', url: 'https://www.acme.example/widgets' },
  labels: ['New feature'],
  newsfeedIds: ['7'],
  reactions: ['🎉', '👍'],
  publish: { state: 'draft', notify: false, senderId: '5' },
});
const put = (data) => { fs.rmSync(newsRecordFile(SLUG), { force: true }); writeJson(newsFile(SLUG), data); };

let mock;
let saved;
beforeEach(() => { saved = { ...process.env }; process.env.NEWS = 'intercom'; process.env.NEWS_TOKEN = 'tok'; });
afterEach(() => { mock?.restore(); mock = null; process.env = saved; });

test('the example sidecar is valid', () => {
  const r = validateNews('smart-scheduling');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('validation: required fields, the cover image type, reactions, lists, and an update needing updatedAt', () => {
  const v = (patch) => validateNews(SLUG, { ...base(), ...patch });
  assert.deepEqual(v({}).errors, []);
  assert.match(v({ title: '' }).errors.join(), /title: missing/);
  assert.match(v({ summary: 'x'.repeat(601) }).errors.join(), /summary: 601 characters/);
  assert.match(v({ summary: 'x'.repeat(400) }).warnings.join(), /the messenger is narrow/);
  assert.match(v({ sections: Array(5).fill({ title: 'T', body: 'B' }) }).errors.join(), /sections: 5/);
  assert.match(v({ coverImage: 'https://x/c.jpeg' }).errors.join(), /lower-case \.png or \.jpg/);
  assert.match(v({ coverImage: 'https://x/c.PNG' }).errors.join(), /lower-case \.png or \.jpg/);
  assert.match(v({ coverImage: 'http://x/c.png' }).errors.join(), /not a public https URL/);
  assert.match(v({ image: { url: 'https://x/y.png' } }).errors.join(), /image.alt/);
  assert.match(v({ reactions: ['🎉', '👍', '😐', '😊', '🙌', '🔥'] }).errors.join(), /reactions: 6/);
  assert.match(v({ reactions: ['❤️'] }).errors.join(), /one emoji code point/);
  assert.match(v({ reactions: ['👍🏽'] }).errors.join(), /one emoji code point/);
  assert.match(v({ labels: [''] }).errors.join(), /labels: a list of label names/);
  assert.match(v({ newsfeedIds: ['abc'] }).errors.join(), /newsfeedIds: a list of newsfeed ids/);
  assert.match(v({ newsfeedIds: [], publish: { state: 'live' } }).errors.join(), /a live item needs at least one newsfeed/);
  assert.match(v({ publish: { state: 'published' } }).errors.join(), /publish.state: draft or live/);
  assert.match(v({ publish: { itemId: '9' } }).errors.join(), /publish.updatedAt: an update needs/);
  assert.match(v({ cta: undefined }).warnings.join(), /cta: none/);
  assert.match(validateNews('missing-feature', null).errors.join(), /the news writer writes it/);
});

test('the HTML body: summary, image, headings, bullets, the video link, the tagged call to action', () => {
  const html = itemHtml({ ...base(), summary: 'Fast & <easy>', video: { url: 'https://youtu.be/abc' } }, SLUG);
  assert.equal(html, [
    '<p>Fast &amp; &lt;easy&gt;</p>',
    '<img src="https://img.acme.example/w.gif" alt="A spinning widget">',
    '<h2>Faster spins</h2>',
    '<p>Spin any widget from the toolbar.</p>',
    '<h2>Also</h2>',
    '<ul><li>One</li><li>Two</li></ul>',
    '<p><a href="https://youtu.be/abc" target="_blank">Watch the video</a></p>',
    '<p><b><a href="https://www.acme.example/widgets?utm_source=intercom&amp;utm_medium=news&amp;utm_campaign=news-test&amp;utm_content=cta" target="_blank">See widgets</a></b></p>',
  ].join('\n') + '\n');
});

test('build writes item.html, item.json and the preview; names what blocks sending', () => {
  put(base());
  const r = buildNews({ slug: SLUG, brand, log: quiet });
  assert.equal(r.item.action, 'create');
  assert.deepEqual(r.blockers, []);
  for (const f of ['item.html', 'item.json', 'preview.html']) assert.ok(fs.existsSync(path.join(newsDir(SLUG), f)), f);
  assert.match(fs.readFileSync(path.join(newsDir(SLUG), 'preview.html'), 'utf8'), /<span class="label">New feature<\/span><h1>Acme Widgets spin faster<\/h1>/);
  delete process.env.HELP_AUTHOR_ID;
  put({ ...base(), newsfeedIds: [], publish: { state: 'draft' } });
  const b = buildNews({ slug: SLUG, brand, log: quiet });
  assert.match(b.blockers.join(), /no sender/);
  assert.match(b.blockers.join(), /no newsfeed/);
  process.env.NEWS_NEWSFEED_IDS = '3, 4';
  process.env.NEWS_SENDER_ID = '8';
  const c = buildNews({ slug: SLUG, brand, log: quiet });
  assert.deepEqual(c.item.newsfeedIds, ['3', '4']);
  assert.equal(c.item.senderId, '8');
});

test('matchItems: every word of a phrase, in the title or text', () => {
  const items = [{ id: '1', title: 'Smart Scheduling is here', text: '' }, { id: '2', title: null, text: 'scheduling got smart' }, { id: '3', title: 'Other', text: 'smart replies' }];
  assert.deepEqual(matchItems(items, ['smart scheduling']).map((x) => x.id), ['1', '2']);
});

test('the service needs a provider and a token (NEWS_TOKEN, else HELP_CENTER_TOKEN)', async () => {
  delete process.env.NEWS;
  await assert.rejects(newsService(brand), /no news service configured/);
  process.env.NEWS = 'other';
  await assert.rejects(newsService(brand), /no news adapter "other"/);
  process.env.NEWS = 'intercom';
  delete process.env.NEWS_TOKEN;
  delete process.env.HELP_CENTER_TOKEN;
  await assert.rejects(newsService(brand), /NEWS_TOKEN is not set/);
  process.env.HELP_CENTER_TOKEN = 'help-token';
  assert.equal((await newsService(brand)).name, 'intercom');
});

// A news service with items in memory, over mocked fetch.
function fakeIntercom(items = {}) {
  let next = 100;
  let clock = 1700000000;
  const out = (x) => ({ json: { ...x, type: 'news-item' } });
  return mockFetch([
    { method: 'GET', url: /\/news\/news_items\/\d+$/, reply: (req) => { const x = items[req.url.split('/').pop()]; return x ? out(x) : { status: 404, json: { errors: [{ code: 'not_found', message: 'News Item Not Found' }] } }; } },
    { method: 'POST', url: `${API}/news/news_items`, reply: async (req) => {
      const b = JSON.parse(await bodyOf(req));
      const id = String(next++);
      items[id] = { id, ...b, updated_at: (clock += 10) };
      return out(items[id]);
    } },
    { method: 'PUT', url: /\/news\/news_items\/\d+$/, reply: async (req) => {
      const id = req.url.split('/').pop();
      Object.assign(items[id], JSON.parse(await bodyOf(req)), { updated_at: (clock += 10) });
      return out(items[id]);
    } },
  ]);
}

test('publish: a new item is created as a silent draft and recorded; the next send updates it', async () => {
  const items = {};
  mock = fakeIntercom(items);
  put(base());
  const r = await publishNews({ slug: SLUG, brand, log: quiet });
  assert.equal(r.action, 'create');
  assert.equal(r.state, 'draft');
  const sent = items[r.itemId];
  assert.equal(sent.body, itemHtml(base(), SLUG));
  assert.equal(sent.deliver_silently, true);
  assert.equal(sent.sender_id, 5);
  assert.deepEqual(sent.newsfeed_assignments, [{ newsfeed_id: 7 }]);
  assert.equal(sent.cover_image_url, 'https://img.acme.example/cover.png');
  assert.equal(readJson(newsRecordFile(SLUG)).itemId, r.itemId);

  writeJson(newsFile(SLUG), { ...base(), summary: 'Widgets now spin three times as fast.' });
  const u = await publishNews({ slug: SLUG, brand, log: quiet });
  assert.equal(u.action, 'update');
  assert.equal(Object.keys(items).length, 1);
  assert.match(items[r.itemId].body, /three times/);
  assert.deepEqual(items[r.itemId].labels, ['New feature']);
});

test('publish refuses an item changed in the news service since it was read', async () => {
  const items = {};
  mock = fakeIntercom(items);
  put(base());
  const r = await publishNews({ slug: SLUG, brand, log: quiet });
  items[r.itemId].updated_at += 500; // someone edited it in Intercom
  await assert.rejects(publishNews({ slug: SLUG, brand, log: quiet }), /was changed in the news service since it was read/);
});

test('publish: an existing item needs updatedAt; a live one needs live and never goes back to draft', async () => {
  const items = { 50: { id: '50', title: 'Old', body: 'B', sender_id: 5, state: 'live', labels: [], newsfeed_assignments: [{ newsfeed_id: 7 }], updated_at: 1600000000 } };
  mock = fakeIntercom(items);
  put({ ...base(), publish: { itemId: '50', updatedAt: 1600000000, state: 'draft', senderId: '5' } });
  await assert.rejects(publishNews({ slug: SLUG, brand, log: quiet }), /is live: sending it as a draft would take it down/);
  put({ ...base(), publish: { itemId: '50', updatedAt: 1600000000, state: 'live', senderId: '5' } });
  await assert.rejects(publishNews({ slug: SLUG, brand, log: quiet }), /pass --live once that is approved/);
  const r = await publishNews({ slug: SLUG, brand, live: true, log: quiet });
  assert.equal(r.action, 'update');
  assert.equal(items[50].title, base().title);
});

test('publish: live only with live; the badge only with notify, both ways; never without a sender', async () => {
  const items = {};
  mock = fakeIntercom(items);
  put({ ...base(), publish: { state: 'live', senderId: '5' } });
  await assert.rejects(publishNews({ slug: SLUG, brand, log: quiet }), /shows it to users — pass --live/);
  put({ ...base(), publish: { state: 'live', notify: true, senderId: '5' } });
  await assert.rejects(publishNews({ slug: SLUG, brand, live: true, log: quiet }), /notification badge .* pass --notify/);
  put(base());
  await assert.rejects(publishNews({ slug: SLUG, brand, notify: true, log: quiet }), /does not set publish.notify: true/);
  delete process.env.HELP_AUTHOR_ID;
  delete process.env.NEWS_SENDER_ID;
  put({ ...base(), publish: { state: 'draft' } });
  await assert.rejects(publishNews({ slug: SLUG, brand, log: quiet }), /no sender/);
  assert.equal(Object.keys(items).length, 0);
  put({ ...base(), publish: { state: 'live', notify: true, senderId: '5' } });
  const r = await publishNews({ slug: SLUG, brand, live: true, notify: true, log: quiet });
  assert.equal(r.state, 'live');
  assert.equal(items[r.itemId].deliver_silently, false);
});
