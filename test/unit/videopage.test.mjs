import '../setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mockFetch } from '../helpers.mjs';
import { featurePaths, writeJson, readJson } from '../../pipeline/env.mjs';
import {
  youtubeId, youtubeWatchUrl, nextSortOrder, transcriptHtml, validateVideoPage, transcribeVideoPage,
  readVideoCollection, uploadVideoPageAssets, recordVideoPageItem,
  videoPageFile, videoPageRecordFile, videoPageDir, readVideoPageRecord,
} from '../../pipeline/videopage.mjs';

const SLUG = 'smart-scheduling';
const quiet = () => {};
const out = (rel) => path.join(featurePaths(SLUG).output, rel);
const inventory = () => path.join(videoPageDir(SLUG), 'site-inventory.json');

// a collection shaped like a site's video collection
const FIELDS = [
  { slug: 'name', name: 'Name', type: 'PlainText', required: true },
  { slug: 'slug', name: 'Slug', type: 'PlainText', required: true },
  { slug: 'description', name: 'Description', type: 'PlainText', required: false },
  { slug: 'cover-image', name: 'Cover image', type: 'Image', required: false },
  { slug: 'video-url', name: 'Video', type: 'VideoLink', required: true },
  { slug: 'custom-sort-order', name: 'Custom sort order', type: 'Number', required: true },
  { slug: 'meta-title', name: 'Meta Title', type: 'PlainText', required: false },
  { slug: 'meta-description', name: 'Meta Description', type: 'PlainText', required: false },
  { slug: 'video-summary', name: 'Video Summary', type: 'RichText', required: false },
  { slug: 'video-transcription', name: 'Video Transcription', type: 'RichText', required: false },
];
const ITEMS = [
  { id: 'v1', slug: 'older-video', name: 'Older', draft: false, publishedAt: '2026-09-01', updatedAt: '2026-09-01', fields: { 'custom-sort-order': 2430, 'video-summary': '<p>Old summary.</p>', 'video-transcription': '<p>Old words.</p>' } },
  { id: 'v2', slug: 'newest-video', name: 'Newest', draft: false, publishedAt: '2026-10-01', updatedAt: '2026-10-02', fields: { 'custom-sort-order': 2450, 'video-summary': '<p>New &amp; improved.</p>', 'video-transcription': `<p>${'word '.repeat(150)}</p>` } },
  { id: 'v3', slug: 'a-draft', name: 'Draft', draft: true, publishedAt: null, updatedAt: '2026-10-05', fields: { 'custom-sort-order': 2440 } },
];
const fakeWs = () => {
  const calls = [];
  return {
    name: 'webflow', siteId: 'site1', calls,
    async collection(id) { calls.push(['collection', id]); return { id, name: 'Videos', slug: 'videos', fields: FIELDS }; },
    async items(id) { calls.push(['items', id]); return structuredClone(ITEMS); },
    async item(cid, id) { calls.push(['item', cid, id]); return { id, slug: 'smart-scheduling', name: 'Book Meetings Over Text', draft: true, updatedAt: '2026-11-05', publishedAt: null }; },
    async site() { return { domains: ['www.acme.example'] }; },
    async uploadAsset(a) { calls.push(['upload', a.name, a.type, a.data.length]); return { id: `asset-${calls.length}`, url: `https://cdn.acme.example/${a.name}` }; },
  };
};

const page = (fields = {}, video = { url: 'https://youtu.be/AbCdEfGhIj1' }) => ({
  video,
  site: {
    fields: {
      name: 'Book Meetings Over Text with Smart Scheduling', slug: 'smart-scheduling',
      'video-url': 'https://www.youtube.com/watch?v=AbCdEfGhIj1', 'custom-sort-order': 2460,
      'meta-title': 'Smart Scheduling: Book Meetings Over Text | Acme',
      'meta-description': 'Smart Scheduling books meetings inside the text conversation: suggest open times, sync calendars and send reminders automatically.',
      ...fields,
    },
  },
});
const write = (p) => writeJson(videoPageFile(SLUG), p);
const errorsOf = () => validateVideoPage(SLUG).errors.join('\n');
const warningsOf = () => validateVideoPage(SLUG).warnings.join('\n');

beforeEach(() => {
  delete process.env.WEBFLOW_VIDEOS_COLLECTION_ID;
  for (const f of [videoPageFile(SLUG), videoPageRecordFile(SLUG)]) fs.rmSync(f, { force: true });
  fs.rmSync(videoPageDir(SLUG), { recursive: true, force: true });
});

test('youtubeId: watch, short, embed and Shorts links; anything else is null', () => {
  for (const u of ['https://youtu.be/AbCdEfGhIj1', 'https://www.youtube.com/watch?v=AbCdEfGhIj1&t=4', 'https://youtube.com/watch?feature=x&v=AbCdEfGhIj1',
    'https://www.youtube.com/embed/AbCdEfGhIj1', 'https://m.youtube.com/shorts/AbCdEfGhIj1?s=1']) assert.equal(youtubeId(u), 'AbCdEfGhIj1', u);
  for (const u of ['https://vimeo.com/123', 'https://youtu.be/short', '', null, 'AbCdEfGhIj1']) assert.equal(youtubeId(u), null, String(u));
  assert.equal(youtubeWatchUrl('AbCdEfGhIj1'), 'https://www.youtube.com/watch?v=AbCdEfGhIj1');
});

test('nextSortOrder: the highest sort value plus 10; 10 for an empty collection; null without a sort field', () => {
  assert.deepEqual(nextSortOrder({ fields: FIELDS, items: ITEMS }), { field: 'custom-sort-order', max: 2450, next: 2460 });
  assert.deepEqual(nextSortOrder({ fields: FIELDS, items: [] }), { field: 'custom-sort-order', max: null, next: 10 });
  assert.equal(nextSortOrder({ fields: [{ slug: 'name', type: 'PlainText' }], items: ITEMS }), null);
});

test('transcriptHtml: the passages as paragraphs of a few sentences, escaped', () => {
  const html = transcriptHtml({ utterances: [{ text: 'One. Two? Three! Four.' }, { text: 'Five & six. "Seven" here.' }] }, { sentences: 2 });
  assert.equal(html, '<p>One. Two?</p><p>Three! Four.</p><p>Five &amp; six. &quot;Seven&quot; here.</p>');
  assert.equal(transcriptHtml({ utterances: [] }), '');
});

test('validateVideoPage: no sidecar, no YouTube link, no fields', () => {
  assert.match(errorsOf(), /no .*video\.json/);
  write({ video: { url: 'https://vimeo.com/1' } });
  assert.match(errorsOf(), /video\.url is the video's YouTube link/);
  assert.match(errorsOf(), /site\.fields is required/);
});

test('validateVideoPage: name, slug and images; without the collection read, a warning', () => {
  write(page({ name: ' ', slug: 'Bad Slug', 'cover-image': { asset: 'assets/social/missing.png', alt: 'x' }, extra: { url: 'http://x' } }));
  const errs = errorsOf();
  assert.match(errs, /site\.fields\.name .* is required/);
  assert.match(errs, /site\.fields\.slug "Bad Slug" must be lower-case/);
  assert.match(errs, /\["cover-image"\]\.asset assets\/social\/missing\.png is not in output/);
  assert.match(errs, /\["extra"\]\.url is an https link/);
  assert.match(warningsOf(), /the video collection has not been read — run rollout\.mjs video-site/);
});

test('validateVideoPage: against the collection — unknown and required fields, the video, a taken slug, the sort order', async () => {
  process.env.WEBFLOW_VIDEOS_COLLECTION_ID = 'col1';
  await readVideoCollection(SLUG, fakeWs());
  write(page({ 'video-url': 'https://youtu.be/ZZZZZZZZZZZ', 'custom-sort-order': 2440, slug: 'newest-video', nope: 'x' }));
  let errs = errorsOf();
  assert.match(errs, /\["nope"\]: no field "nope" in Videos/);
  assert.match(errs, /\["video-url"\] plays ZZZZZZZZZZZ, not video\.url's AbCdEfGhIj1/);
  assert.match(errs, /a video page with slug "newest-video" already exists \(v2\)/);
  assert.match(warningsOf(), /\["custom-sort-order"\] is 2440; the newest video has 2450 — a new one takes 2460/);
  write(page({ 'video-url': null, 'custom-sort-order': null }));
  errs = errorsOf();
  assert.match(errs, /\["video-url"\] \(Video\) is required by Videos/);
  assert.match(errs, /\["custom-sort-order"\] \(Custom sort order\) is required by Videos/);
  // a complete page passes; the VideoLink field may hold Webflow's { url } shape
  fs.mkdirSync(out('assets/social'), { recursive: true });
  fs.writeFileSync(out('assets/social/feature.png'), 'png');
  write(page({ 'video-url': { url: 'https://www.youtube.com/watch?v=AbCdEfGhIj1' }, 'cover-image': { asset: 'assets/social/feature.png', alt: 'The Smart Scheduling panel suggesting open times in a text thread.' } }));
  assert.deepEqual(validateVideoPage(SLUG).errors, []);
});

test('validateVideoPage: the page\'s own recorded item may keep its slug and sort order', async () => {
  process.env.WEBFLOW_VIDEOS_COLLECTION_ID = 'col1';
  await readVideoCollection(SLUG, fakeWs());
  writeJson(videoPageRecordFile(SLUG), { site: { itemId: 'v2' } });
  write(page({ slug: 'newest-video', 'custom-sort-order': 2450 }));
  assert.doesNotMatch(errorsOf(), /already exists/);
  assert.doesNotMatch(warningsOf(), /a new one takes/);
});

test('readVideoCollection: needs the collection id; writes the inventory, the next sort order and the newest published pages as text', async () => {
  await assert.rejects(readVideoCollection(SLUG, fakeWs()), /WEBFLOW_VIDEOS_COLLECTION_ID is not set/);
  await assert.rejects(recordVideoPageItem({ slug: SLUG, ws: fakeWs(), itemId: 'x' }), /WEBFLOW_VIDEOS_COLLECTION_ID is not set/);
  process.env.WEBFLOW_VIDEOS_COLLECTION_ID = 'col1';
  const c = await readVideoCollection(SLUG, fakeWs());
  assert.equal(c.items[0].id, 'v3', 'newest first');
  assert.deepEqual(c.sortOrder, { field: 'custom-sort-order', max: 2450, next: 2460 });
  const inv = readJson(inventory());
  assert.match(inv.items.find((i) => i.id === 'v2').fields['video-transcription'], /… \[\d+ characters\]$/);
  const ref = path.join(videoPageDir(SLUG), 'reference');
  assert.deepEqual(fs.readdirSync(ref).sort(), ['newest-video.txt', 'older-video.txt'], 'published only');
  const text = fs.readFileSync(path.join(ref, 'newest-video.txt'), 'utf8');
  assert.match(text, /^Newest\n\n\[video-summary\]\nNew & improved\.\n\n\[video-transcription\]\nword word/);
});

test('uploadVideoPageAssets: uploads the image fields once, then reuses them; recordVideoPageItem records the item', async () => {
  process.env.WEBFLOW_VIDEOS_COLLECTION_ID = 'col1';
  fs.mkdirSync(out('assets/social'), { recursive: true });
  fs.writeFileSync(out('assets/social/feature.png'), 'png-bytes');
  const p = page({ 'cover-image': { asset: 'assets/social/feature.png', alt: 'a' }, 'og-image': { asset: 'assets/social/feature.png', alt: 'a' } });
  const ws = fakeWs();
  const a = await uploadVideoPageAssets({ slug: SLUG, page: p, ws, log: quiet });
  assert.equal(ws.calls.filter((c) => c[0] === 'upload').length, 1, 'one file in two fields goes once');
  assert.deepEqual(ws.calls.find((c) => c[0] === 'upload'), ['upload', 'feature.png', 'image/png', 9]);
  const again = fakeWs();
  assert.deepEqual(await uploadVideoPageAssets({ slug: SLUG, page: p, ws: again, log: quiet }), a);
  assert.equal(again.calls.length, 0, 'unchanged: reused');
  const r = await recordVideoPageItem({ slug: SLUG, ws: fakeWs(), itemId: 'item9' });
  assert.equal(r.path, '/videos/smart-scheduling');
  assert.equal(r.url, 'https://www.acme.example/videos/smart-scheduling');
  assert.equal(r.action, 'create');
  assert.deepEqual(r.assets, a, 'the uploaded images stay in the record');
  assert.equal(readVideoPageRecord(SLUG).site.itemId, 'item9');
  assert.equal((await recordVideoPageItem({ slug: SLUG, ws: fakeWs(), itemId: 'item9' })).action, 'update');
});

test('transcribeVideoPage: needs video.file; transcribes through the video source and studio, then writes the page\'s transcript', async () => {
  await assert.rejects(transcribeVideoPage({ slug: SLUG, page: page(), log: quiet }), /video\.file .* is needed/);
  Object.assign(process.env, { PODCAST_VIDEO_SOURCE: 'gdrive', PODCAST_STUDIO: 'elevenlabs', ELEVENLABS_API_KEY: 'k', GOOGLE_OAUTH_CLIENT_ID: 'c', GOOGLE_OAUTH_CLIENT_SECRET: 's', GOOGLE_OAUTH_REFRESH_TOKEN: 'r' });
  const m = mockFetch([
    { url: 'https://oauth2.googleapis.com/token', reply: { json: { access_token: 'g', expires_in: 3600 } } },
    { url: /googleapis\.com\/drive\/v3\/files\/[\w-]+\?alt=media/, reply: { body: 'video-bytes', headers: { 'content-type': 'video/mp4' } } },
    { url: /googleapis\.com\/drive\/v3\/files\//, reply: { json: { id: 'f1aaaaaaaaaa', name: 'demo.mp4', mimeType: 'video/mp4', size: '11', md5Checksum: 'abc' } } },
    { url: 'https://api.elevenlabs.io/v1/speech-to-text', reply: { json: { language_code: 'en', words: [
      { type: 'word', text: 'Hello', start: 0, end: 0.4, speaker_id: 'speaker_0' }, { type: 'spacing', text: ' ' },
      { type: 'word', text: 'there.', start: 0.4, end: 0.9, speaker_id: 'speaker_0' }, { type: 'spacing', text: ' ' },
      { type: 'word', text: 'Book', start: 1, end: 1.3, speaker_id: 'speaker_0' }, { type: 'spacing', text: ' ' },
      { type: 'word', text: 'it.', start: 1.3, end: 1.6, speaker_id: 'speaker_0' },
    ] } } },
  ]);
  try {
    const r = await transcribeVideoPage({ slug: SLUG, page: page({}, { url: 'https://youtu.be/AbCdEfGhIj1', file: 'f1aaaaaaaaaa' }), log: quiet });
    assert.match(r.html, /^<p>Hello there\. Book it\.<\/p>$/);
    assert.equal(fs.readFileSync(path.join(videoPageDir(SLUG), 'transcript.txt'), 'utf8'), 'Hello there. Book it.\n');
    assert.equal(readVideoPageRecord(SLUG).video.name, 'demo.mp4');
  } finally {
    m.restore();
    for (const k of ['PODCAST_VIDEO_SOURCE', 'PODCAST_STUDIO', 'ELEVENLABS_API_KEY', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REFRESH_TOKEN']) delete process.env[k];
  }
});
