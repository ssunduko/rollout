import '../setup.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mockFetch, bodyOf } from '../helpers.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { writeJson, readJson } from '../../pipeline/env.mjs';
import {
  validateChangelog, entryMarkdown, markdownHtml, buildChangelog, matchEntries, publishChangelog, changelogService,
  changelogFile, changelogDir, changelogRecordFile,
} from '../../pipeline/changelog.mjs';

const brand = loadBrand();
const SLUG = 'cl-test';
const API = 'https://canny.io/api/v1';
const quiet = () => {};

const base = () => ({
  title: 'Acme Widgets: spin them faster',
  types: ['new'],
  summary: 'Widgets now spin twice as fast.',
  sections: [{ title: 'Faster spins', body: 'Spin any widget from the toolbar.' }, { title: 'Also', bullets: ['One', 'Two'] }],
  image: { url: 'https://img.acme.example/w.png', alt: 'A spinning widget' },
  cta: { label: 'See widgets', url: 'https://www.acme.example/widgets' },
  labelIds: ['l1'],
  publish: { status: 'draft', notify: false },
});
const put = (data) => { fs.rmSync(changelogRecordFile(SLUG), { force: true }); writeJson(changelogFile(SLUG), data); };

let mock;
let saved;
beforeEach(() => { saved = { ...process.env }; process.env.CHANGELOG = 'canny'; process.env.CHANGELOG_API_KEY = 'k'; });
afterEach(() => { mock?.restore(); mock = null; process.env = saved; });

test('the example sidecar is valid', () => {
  const r = validateChangelog('smart-scheduling');
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('validation: required fields, types, URLs, limits and an update needing lastSaved', () => {
  const v = (patch) => validateChangelog(SLUG, { ...base(), ...patch });
  assert.deepEqual(v({}).errors, []);
  assert.match(v({ title: '' }).errors.join(), /title: missing/);
  assert.match(v({ types: [] }).errors.join(), /types: one or more of new, improved, fixed/);
  assert.match(v({ types: ['feature'] }).errors.join(), /"feature" is not one of/);
  assert.match(v({ summary: 'x'.repeat(801) }).errors.join(), /summary: 801 characters/);
  assert.match(v({ summary: 'x'.repeat(500) }).warnings.join(), /keep it under 400/);
  assert.match(v({ sections: Array(6).fill({ title: 'T', body: 'B' }) }).errors.join(), /sections: 6/);
  assert.match(v({ sections: [{ title: 'T' }] }).errors.join(), /a body, bullets, or both/);
  assert.match(v({ image: { url: 'http://x/y.png', alt: 'a' } }).errors.join(), /not a public https URL/);
  assert.match(v({ image: { url: 'https://x/y.png' } }).errors.join(), /image.alt/);
  assert.match(v({ cta: { label: 'Go', url: '/relative' } }).errors.join(), /cta: a label and an https url/);
  assert.match(v({ cta: undefined }).warnings.join(), /cta: none/);
  assert.match(v({ labelIds: [3] }).errors.join(), /labelIds/);
  assert.match(v({ publish: { status: 'live' } }).errors.join(), /publish.status: draft or published/);
  assert.match(v({ publish: { entryId: 'e1' } }).errors.join(), /publish.lastSaved: an update needs/);
  assert.match(v({ summary: 'See [here](https://x)' }).warnings.join(), /Markdown or HTML of its own/);
  assert.match(validateChangelog('missing-feature', null).errors.join(), /the changelog writer writes it/);
});

test('the Markdown, in the house style: summary, video embedded under it, image, # headings, bullets, the tagged call to action', () => {
  const md = entryMarkdown({ ...base(), video: { url: 'https://www.youtube.com/watch?v=abc' } }, SLUG);
  assert.equal(md, [
    'Widgets now spin twice as fast.',
    '![](https://www.youtube.com/watch?v=abc)',
    '![A spinning widget](https://img.acme.example/w.png)',
    '# Faster spins\nSpin any widget from the toolbar.',
    '# Also\n- One\n- Two',
    '[See widgets](https://www.acme.example/widgets?utm_source=changelog&utm_medium=changelog&utm_campaign=cl-test&utm_content=cta)',
  ].join('\n\n') + '\n');
  const html = markdownHtml(md);
  assert.match(html, /<a class="video" href="https:\/\/www\.youtube\.com\/watch\?v=abc">/);
  assert.match(html, /<img src="https:\/\/img\.acme\.example\/w\.png" alt="A spinning widget">/);
  assert.match(html, /<h2>Faster spins<\/h2><p>Spin any widget from the toolbar\.<\/p>/);
  assert.match(html, /<h2>Also<\/h2><ul><li>One<\/li><li>Two<\/li><\/ul>/);
  assert.match(markdownHtml('a <b> & c'), /a &lt;b&gt; &amp; c/);
  assert.doesNotMatch(entryMarkdown(base(), SLUG), /youtube/);
});

test('build writes entry.md, entry.json and the preview', () => {
  put(base());
  const r = buildChangelog({ slug: SLUG, brand, log: quiet });
  assert.equal(r.entry.action, 'create');
  assert.equal(r.entry.status, 'draft');
  for (const f of ['entry.md', 'entry.json', 'preview.html']) assert.ok(fs.existsSync(path.join(changelogDir(SLUG), f)), f);
  assert.match(fs.readFileSync(path.join(changelogDir(SLUG), 'preview.html'), 'utf8'), /<span class="badge new">new<\/span><h1>Acme Widgets: spin them faster<\/h1>/);
  assert.throws(() => { put({ ...base(), title: '' }); buildChangelog({ slug: SLUG, brand, log: quiet }); }, /title: missing/);
});

test('matchEntries: every word of a phrase, in the title or text', () => {
  const entries = [{ id: '1', title: 'Smart Scheduling is here', text: '' }, { id: '2', title: 'Fixes', text: 'smart replies' }, { id: '3', title: 'x', text: 'Scheduling got smart' }];
  assert.deepEqual(matchEntries(entries, ['smart scheduling']).map((x) => x.id), ['1', '3']);
  assert.deepEqual(matchEntries(entries, ['fixes', 'nothing']).map((x) => x.id), ['2']);
});

test('the service needs a provider and a key', async () => {
  delete process.env.CHANGELOG;
  await assert.rejects(changelogService(brand), /no changelog configured/);
  process.env.CHANGELOG = 'other';
  await assert.rejects(changelogService(brand), /no changelog adapter "other"/);
  process.env.CHANGELOG = 'canny';
  delete process.env.CHANGELOG_API_KEY;
  await assert.rejects(changelogService(brand), /CHANGELOG_API_KEY is not set/);
});

// A changelog with entries in memory, over mocked fetch.
function fakeCanny(entries = {}) {
  let next = 1;
  let clock = Date.parse('2026-11-10T00:00:00Z');
  const tick = () => new Date((clock += 1000)).toISOString();
  const out = (x) => ({ ...x, markdownDetails: x.details, plaintextDetails: x.details, url: `https://acme.canny.io/changelog/${x.id}`, labels: (x.labelIDs ?? []).map((id) => ({ id, name: id })) });
  return mockFetch([
    { url: `${API}/entries/list`, reply: () => ({ json: { hasMore: false, entries: Object.values(entries).map(out) } }) },
    { url: `${API}/entries/create`, reply: async (req) => {
      const b = JSON.parse(await bodyOf(req));
      const id = `e${next++}`;
      entries[id] = { id, title: b.title, details: b.details, types: b.type ? [b.type] : [], labelIDs: b.labelIDs, notify: b.notify, status: b.published ? 'published' : 'draft', lastSaved: tick() };
      return { json: { id } };
    } },
    { url: `${API}/entries/update`, reply: async (req) => {
      const { entryID, apiKey, labelIDs, ...b } = JSON.parse(await bodyOf(req));
      Object.assign(entries[entryID], b, labelIDs ? { labelIDs } : {}, { lastSaved: tick() });
      return { text: 'success' };
    } },
    { url: `${API}/entries/change_status`, reply: async (req) => {
      const { entryID, status } = JSON.parse(await bodyOf(req));
      Object.assign(entries[entryID], { status, publishedAt: status === 'published' ? tick() : null });
      return { text: 'success' };
    } },
  ]);
}

test('publish: a new entry is created as a draft and recorded; the next send updates it', async () => {
  const entries = {};
  mock = fakeCanny(entries);
  put(base());
  const r = await publishChangelog({ slug: SLUG, brand, log: quiet });
  assert.equal(r.action, 'create');
  assert.equal(r.status, 'draft');
  assert.equal(entries[r.entryId].details, entryMarkdown(base(), SLUG));
  assert.deepEqual(entries[r.entryId].labelIDs, ['l1']);
  assert.deepEqual(readJson(changelogRecordFile(SLUG)).entryId, r.entryId);

  writeJson(changelogFile(SLUG), { ...base(), summary: 'Widgets now spin three times as fast.' });
  const u = await publishChangelog({ slug: SLUG, brand, log: quiet });
  assert.equal(u.action, 'update');
  assert.equal(u.entryId, r.entryId);
  assert.equal(Object.keys(entries).length, 1);
  assert.match(entries[r.entryId].details, /three times/);
});

test('publish refuses an entry saved in the changelog since it was read', async () => {
  const entries = {};
  mock = fakeCanny(entries);
  put(base());
  const r = await publishChangelog({ slug: SLUG, brand, log: quiet });
  entries[r.entryId].lastSaved = '2026-12-01T00:00:00.000Z'; // someone edited it in the changelog
  await assert.rejects(publishChangelog({ slug: SLUG, brand, log: quiet }), /was saved in the changelog since it was read/);
});

test('publish: an existing entry needs lastSaved; a published one needs live and never goes back to draft', async () => {
  const entries = { old: { id: 'old', title: 'Old', details: 'D', types: ['new'], status: 'published', lastSaved: '2026-11-01T00:00:00.000Z' } };
  mock = fakeCanny(entries);
  put({ ...base(), publish: { entryId: 'old', lastSaved: '2026-11-01T00:00:00.000Z', status: 'draft' } });
  await assert.rejects(publishChangelog({ slug: SLUG, brand, log: quiet }), /is published: sending it as a draft would unpublish it/);
  put({ ...base(), publish: { entryId: 'old', lastSaved: '2026-11-01T00:00:00.000Z', status: 'published' } });
  await assert.rejects(publishChangelog({ slug: SLUG, brand, log: quiet }), /pass --live once that is approved/);
  const r = await publishChangelog({ slug: SLUG, brand, live: true, log: quiet });
  assert.equal(r.action, 'update');
  assert.equal(r.status, 'published');
  assert.equal(entries.old.title, base().title);
});

test('publish: published only with live; notify only with notify, both ways', async () => {
  const entries = {};
  mock = fakeCanny(entries);
  put({ ...base(), publish: { status: 'published' } });
  await assert.rejects(publishChangelog({ slug: SLUG, brand, log: quiet }), /makes the entry public — pass --live/);
  assert.equal(Object.keys(entries).length, 0);
  put({ ...base(), publish: { status: 'published', notify: true } });
  await assert.rejects(publishChangelog({ slug: SLUG, brand, live: true, log: quiet }), /emails the changelog's subscribers — pass --notify/);
  put(base());
  await assert.rejects(publishChangelog({ slug: SLUG, brand, notify: true, log: quiet }), /does not set publish.notify: true/);
  assert.equal(Object.keys(entries).length, 0);
  put({ ...base(), publish: { status: 'published', notify: true } });
  const r = await publishChangelog({ slug: SLUG, brand, live: true, notify: true, log: quiet });
  assert.equal(r.status, 'published');
  assert.equal(entries[r.entryId].notify, true);
});
