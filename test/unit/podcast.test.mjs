import '../setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mockFetch, bodyOf, readFixture, putFixture, haveFfmpeg, SANDBOX } from '../helpers.mjs';
import { featurePaths, writeJson, readJson } from '../../pipeline/env.mjs';
import {
  scriptLines, scriptLength, validatePodcast, showVoices, videoSource, podcastStudio, podcastDirectory,
  findEpisode, readEpisodeCollection, uploadEpisodeAssets, recordEpisodeItem, transcribeVideo, producePodcast,
  podcastFile, podcastRecordFile, podcastDir, readPodcastRecord, loadPodcast,
} from '../../pipeline/podcast.mjs';

const SLUG = 'smart-scheduling';
const fixture = () => readFixture('podcast-smart-scheduling.json');
const quiet = () => {};
const outFile = (rel) => path.join(featurePaths(SLUG).output, rel);

// Each test starts from the fixture podcast.json, no record, no podcast output, and no service keys.
const KEYS = ['PODCAST_VIDEO_SOURCE', 'PODCAST_STUDIO', 'PODCAST_DIRECTORY', 'PODCAST_VIDEO_MAX_MB', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REFRESH_TOKEN', 'ELEVENLABS_API_KEY', 'ELEVENLABS_API_URL', 'ELEVENLABS_HOST_VOICE_ID', 'ELEVENLABS_HOST_NAME', 'ELEVENLABS_GUEST_VOICE_ID',
  'ELEVENLABS_GUEST_NAME', 'ELEVENLABS_STABILITY', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_SHOW_ID', 'SPOTIFY_REFRESH_TOKEN', 'WEBFLOW_PODCASTS_COLLECTION_ID'];
beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  putFixture('podcast-smart-scheduling.json', `library/features/${SLUG}/podcast.json`);
  fs.rmSync(podcastRecordFile(SLUG), { force: true });
  fs.rmSync(podcastDir(SLUG), { recursive: true, force: true });
});
const writePodcast = (change) => {
  const p = fixture();
  change(p);
  writeJson(podcastFile(SLUG), p);
};

// ---- the script ----

test('scriptLines: intro and outro by the host around the lines', () => {
  const lines = scriptLines(fixture());
  assert.equal(lines.length, 6);
  assert.deepEqual(lines[0], { speaker: 'host', text: 'Welcome to the Acme Deep Dive. Today: Smart Scheduling.' });
  assert.equal(lines[1].speaker, 'guest');
  assert.deepEqual(lines.at(-1), { speaker: 'host', text: 'That is it for this episode of the Acme Deep Dive.' });
  assert.deepEqual(scriptLines({}), []);
  assert.deepEqual(scriptLines({ script: { lines: [{ speaker: 'guest', text: 'x' }] } }), [{ speaker: 'guest', text: 'x' }]);
});

test('scriptLength: words without the audio tags, at 180 a minute', () => {
  assert.deepEqual(scriptLength({ script: { lines: [{ speaker: 'host', text: '[laughs] one  two\nthree [pause]' }] } }), { words: 3, minutes: 0 });
  const words = Array.from({ length: 180 }, () => 'w').join(' ');
  assert.deepEqual(scriptLength({ script: { intro: words, lines: [{ speaker: 'guest', text: words }] } }), { words: 360, minutes: 2 });
  assert.deepEqual(scriptLength({}), { words: 0, minutes: 0 });
});

// ---- podcast.json ----

test('validatePodcast: the fixture passes, warning only that the collection was not read', () => {
  assert.deepEqual(validatePodcast(SLUG), { errors: [], warnings: [`the episode collection has not been read — run rollout.mjs podcast-site ${SLUG}`] });
});

test('validatePodcast: no podcast.json', () => {
  const r = validatePodcast('no-such-feature');
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^no .*podcast\.json$/);
});

test('validatePodcast: required fields and bad values', () => {
  writePodcast((p) => {
    delete p.video;
    p.episode = { title: ' ', number: 0, description: '' };
    p.script.lines = [{ speaker: 'narrator', text: 'hi' }, { speaker: 'host', text: '[laughs]' }, { speaker: 'guest', text: 'x'.repeat(1201) }];
    p.script.minutes = -1;
    p.site.fields.name = '';
    p.site.fields.slug = 'Not A Slug';
  });
  const { errors } = validatePodcast(SLUG);
  for (const want of [
    /^video\.file .* is required$/, /^episode\.title is required$/, /^episode\.number is a whole number above 0$/,
    /^episode\.description .* is required$/, /^script\.lines\[0\]\.speaker is host or guest$/, /^script\.lines\[1\]\.text is empty$/,
    /^script\.lines\[2\] is 1201 characters — split it \(at most 1200\)$/, /^script\.minutes .* above 0$/,
    /^site\.fields\.name .* is required$/, /^site\.fields\.slug "Not A Slug" must be/,
  ]) assert.ok(errors.some((e) => want.test(e)), `${want} in ${JSON.stringify(errors, null, 1)}`);
});

test('validatePodcast: warnings — long notes, retired fields, no lines, length off target', () => {
  writePodcast((p) => {
    p.episode.description = 'x'.repeat(4001);
    p.script.duration = 'short';
    p.script.highlights = [];
    delete p.site;
  });
  let { errors, warnings } = validatePodcast(SLUG);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => /episode\.description is 4001 characters/.test(w)));
  assert.ok(warnings.some((w) => /script\.duration is no longer used/.test(w)));
  assert.ok(warnings.some((w) => /script\.highlights is no longer used/.test(w)));

  writePodcast((p) => { p.script.lines = []; p.script.minutes = 8; });
  ({ warnings } = validatePodcast(SLUG));
  assert.ok(warnings.some((w) => /script\.lines is empty/.test(w)));

  writePodcast((p) => { p.script.minutes = 10; });
  ({ warnings } = validatePodcast(SLUG));
  assert.ok(warnings.some((w) => /the script runs about 0\.4 min .* asks for 10/.test(w)), JSON.stringify(warnings));
});

test('validatePodcast: the episode image must be built', () => {
  writePodcast((p) => { p.episode.image = 'assets/social/podcast-1280x720.png'; });
  assert.ok(validatePodcast(SLUG).errors.some((e) => /episode\.image .* is not in output\/smart-scheduling\/ — build first/.test(e)));
  fs.mkdirSync(path.dirname(outFile('assets/social/podcast-1280x720.png')), { recursive: true });
  fs.writeFileSync(outFile('assets/social/podcast-1280x720.png'), 'png');
  assert.deepEqual(validatePodcast(SLUG).errors, []);
});

test('validatePodcast: site.fields against the read collection — unknown fields, a taken slug', () => {
  writeJson(path.join(podcastDir(SLUG), 'site-inventory.json'), {
    name: 'Podcasts', fields: [{ slug: 'name' }, { slug: 'slug' }],
    items: [{ id: 'other', slug: 'episode-7-smart-scheduling' }],
  });
  const { errors, warnings } = validatePodcast(SLUG);
  assert.ok(errors.some((e) => /site\.fields\["main-image"\]: no field "main-image" in Podcasts — fields: name, slug/.test(e)));
  assert.ok(errors.some((e) => /slug "episode-7-smart-scheduling" already exists \(other\)/.test(e)));
  assert.ok(!warnings.some((w) => /has not been read/.test(w)));

  // the page this feature already made is not a clash
  writeJson(podcastRecordFile(SLUG), { site: { itemId: 'other' } });
  assert.ok(!validatePodcast(SLUG).errors.some((e) => /already exists/.test(e)));
});

// ---- services ----

test('showVoices: the host is required, the guest optional, names default', () => {
  assert.throws(() => showVoices(), /ELEVENLABS_HOST_VOICE_ID is not set/);
  process.env.ELEVENLABS_HOST_VOICE_ID = 'vh';
  assert.deepEqual(showVoices(), { host: { id: 'vh', name: 'Host' }, guest: null });
  Object.assign(process.env, { ELEVENLABS_HOST_NAME: 'Ava', ELEVENLABS_GUEST_VOICE_ID: 'vg', ELEVENLABS_GUEST_NAME: 'Ben' });
  assert.deepEqual(showVoices(), { host: { id: 'vh', name: 'Ava' }, guest: { id: 'vg', name: 'Ben' } });
});

test('adapters: the .env key must be set and name a known adapter', async () => {
  await assert.rejects(videoSource(), /PODCAST_VIDEO_SOURCE is not set in \.env \(gdrive\)/);
  await assert.rejects(podcastStudio(), /PODCAST_STUDIO is not set in \.env \(elevenlabs\)/);
  await assert.rejects(podcastDirectory(), /PODCAST_DIRECTORY is not set in \.env \(spotify\)/);
  Object.assign(process.env, { PODCAST_VIDEO_SOURCE: 'dropbox', PODCAST_STUDIO: 'nope', PODCAST_DIRECTORY: 'apple' });
  await assert.rejects(videoSource(), /no videosource adapter "dropbox" \(gdrive\)/);
  await assert.rejects(podcastStudio(), /no podcaststudio adapter "nope" \(elevenlabs\)/);
  await assert.rejects(podcastDirectory(), /no podcastdirectory adapter "apple" \(spotify\)/);
});

test('adapters: a known adapter is connected with its .env settings and named', async () => {
  Object.assign(process.env, { PODCAST_STUDIO: 'elevenlabs', PODCAST_DIRECTORY: 'spotify', PODCAST_VIDEO_SOURCE: 'gdrive' });
  await assert.rejects(podcastStudio(), /ELEVENLABS_API_KEY is not set/);
  await assert.rejects(podcastDirectory(), /SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set/);
  await assert.rejects(videoSource(), /no Google sign-in/);
  process.env.ELEVENLABS_API_KEY = 'k';
  const s = await podcastStudio();
  assert.equal(s.name, 'elevenlabs');
  assert.equal(typeof s.dialogue, 'function');
});

// ---- the directory ----

const spotify = (items) => {
  Object.assign(process.env, { PODCAST_DIRECTORY: 'spotify', SPOTIFY_CLIENT_ID: 'i', SPOTIFY_CLIENT_SECRET: 's', SPOTIFY_SHOW_ID: 'show1' });
  return mockFetch([
    { url: 'https://accounts.spotify.com/api/token', reply: { json: { access_token: 't', expires_in: 3600 } } },
    { url: 'https://api.spotify.com/v1/shows/show1/episodes', reply: { json: { items } } },
  ]);
};

test('findEpisode: matched by title ignoring case and punctuation, and recorded', async () => {
  const m = spotify([
    { id: 'e6', name: 'Episode 6: Something Else' },
    { id: 'e7', name: 'episode 7 — book the right time in one tap!', release_date: '2026-10-30' },
  ]);
  try {
    const r = await findEpisode({ slug: SLUG, podcast: fixture() });
    assert.equal(r.directory, 'spotify');
    assert.equal(r.episode.id, 'e7');
    const rec = readPodcastRecord(SLUG);
    assert.equal(rec.directory.provider, 'spotify');
    assert.equal(rec.directory.id, 'e7');
    assert.equal(rec.directory.url, 'https://open.spotify.com/episode/e7');
    assert.equal(rec.directory.embedUrl, 'https://open.spotify.com/embed/episode/e7');
    assert.ok(rec.directory.foundAt && rec.updatedAt);
    assert.match(rec.$comment, /written by pipeline\/podcast\.mjs/);
  } finally {
    m.restore();
  }
});

test('findEpisode: not there yet — null, nothing recorded', async () => {
  const m = spotify([{ id: 'e6', name: 'Episode 6' }]);
  try {
    assert.deepEqual(await findEpisode({ slug: SLUG, podcast: fixture() }), { directory: 'spotify', episode: null, library: null, savedNow: false, signedIn: false, rotatedRefreshToken: null });
    assert.equal(readPodcastRecord(SLUG), null);
  } finally {
    m.restore();
  }
});

test('findEpisode: keeps the other parts of the record', async () => {
  writeJson(podcastRecordFile(SLUG), { studio: { state: 'produced' } });
  const m = spotify([{ id: 'e7', name: 'Episode 7: Book the Right Time in One Tap' }]);
  try {
    await findEpisode({ slug: SLUG, podcast: fixture() });
    const rec = readPodcastRecord(SLUG);
    assert.deepEqual(rec.studio, { state: 'produced' });
    assert.equal(rec.directory.id, 'e7');
  } finally {
    m.restore();
  }
});

// signed in (spotify-login): the found episode is saved to the person's library
const signedInSpotify = (items, { saved = false, refreshToken } = {}) => {
  Object.assign(process.env, { PODCAST_DIRECTORY: 'spotify', SPOTIFY_CLIENT_ID: 'i', SPOTIFY_CLIENT_SECRET: 's', SPOTIFY_SHOW_ID: 'show1', SPOTIFY_REFRESH_TOKEN: 'r1' });
  return mockFetch([
    { url: 'https://accounts.spotify.com/api/token', reply: { json: { access_token: 't', expires_in: 3600, ...(refreshToken ? { refresh_token: refreshToken } : {}) } } },
    { url: 'https://api.spotify.com/v1/shows/show1/episodes', reply: { json: { items } } },
    { method: 'GET', url: 'https://api.spotify.com/v1/me/library/contains', reply: { json: [saved] } },
    { method: 'PUT', url: 'https://api.spotify.com/v1/me/library', reply: { text: '' } },
  ]);
};

test('findEpisode: signed in — saves the episode to the library once and records it', async () => {
  const m = signedInSpotify([{ id: 'e7', name: 'Episode 7: Book the Right Time in One Tap' }]);
  try {
    const r = await findEpisode({ slug: SLUG, podcast: fixture() });
    assert.equal(r.signedIn, true);
    assert.equal(r.savedNow, true);
    assert.equal(r.library.already, false);
    assert.ok(m.calls.some((c) => c.method === 'PUT' && c.url.endsWith('uris=spotify%3Aepisode%3Ae7')));
    const rec = readPodcastRecord(SLUG);
    assert.equal(rec.directory.id, 'e7');
    assert.ok(rec.directory.library.savedAt);
    // a rerun finds it recorded and calls the library no more
    const before = m.calls.length;
    const again = await findEpisode({ slug: SLUG, podcast: fixture() });
    assert.deepEqual(again.library, rec.directory.library);
    assert.equal(again.savedNow, false, 'the save was recorded by the earlier run');
    assert.ok(!m.calls.slice(before).some((c) => c.url.includes('/me/library')));
  } finally {
    m.restore();
    delete process.env.SPOTIFY_REFRESH_TOKEN;
  }
});

test('findEpisode: signed in, already in the library — recorded as already there; a new refresh token is passed back', async () => {
  const m = signedInSpotify([{ id: 'e7', name: 'Episode 7: Book the Right Time in One Tap' }], { saved: true, refreshToken: 'r2' });
  try {
    const r = await findEpisode({ slug: SLUG, podcast: fixture() });
    assert.equal(r.library.already, true);
    assert.ok(!m.calls.some((c) => c.method === 'PUT'));
    assert.equal(r.rotatedRefreshToken, 'r2');
  } finally {
    m.restore();
    delete process.env.SPOTIFY_REFRESH_TOKEN;
  }
});

test('findEpisode: not signed in — the episode is recorded, the library is not touched', async () => {
  const m = spotify([{ id: 'e7', name: 'Episode 7: Book the Right Time in One Tap' }]);
  try {
    const r = await findEpisode({ slug: SLUG, podcast: fixture() });
    assert.equal(r.signedIn, false);
    assert.equal(r.library, null);
    assert.equal(readPodcastRecord(SLUG).directory.library, undefined);
  } finally {
    m.restore();
  }
});

// ---- the website episode page ----

const long = (n) => `<p>${'word '.repeat(n)}</p><p>A &amp; B&#39;s &quot;line&quot;<br>next</p>`;
const fakeWs = () => {
  const calls = [];
  return {
    name: 'webflow', siteId: 'site1', calls,
    async collection(id) { calls.push(['collection', id]); return { id, name: 'Podcasts', slug: 'podcasts', fields: [{ slug: 'name' }, { slug: 'transcript' }] }; },
    async items(id) {
      calls.push(['items', id]);
      return [
        { id: 'i1', slug: 'episode-5', name: 'Episode 5', draft: false, publishedAt: '2026-09-01', updatedAt: '2026-09-01', fields: { name: 'Episode 5', transcript: long(10) } },
        { id: 'i2', slug: 'episode-6', name: 'Episode 6', draft: false, publishedAt: '2026-10-01', updatedAt: '2026-10-02', fields: { name: 'Episode 6', transcript: long(200) } },
        { id: 'i3', slug: 'episode-7-draft', name: 'Draft', draft: true, publishedAt: null, updatedAt: '2026-10-05', fields: { transcript: long(5) } },
        { id: 'i4', slug: 'episode-4', name: 'Episode 4', draft: false, publishedAt: '2026-08-01', updatedAt: '2026-08-01', fields: { name: 'no transcript' } },
        { id: 'i0', slug: 'episode-3', name: 'Episode 3', draft: false, publishedAt: '2026-07-01', updatedAt: '2026-07-01', fields: { transcript: long(3) } },
      ];
    },
    async item(cid, id) { calls.push(['item', cid, id]); return { id, slug: 'episode-7-smart-scheduling', name: 'Episode 7', draft: true, updatedAt: '2026-11-01', publishedAt: null }; },
    async site() { return { domains: ['www.acme.example', 'acme.example'] }; },
    async uploadAsset(a) { calls.push(['upload', a.name, a.type, a.data.length]); return { id: `asset-${calls.length}`, url: `https://cdn.acme.example/${a.name}` }; },
  };
};

test('readEpisodeCollection needs the collection id', async () => {
  await assert.rejects(readEpisodeCollection(SLUG, fakeWs()), /WEBFLOW_PODCASTS_COLLECTION_ID is not set/);
  await assert.rejects(recordEpisodeItem({ slug: SLUG, ws: fakeWs(), itemId: 'x' }), /WEBFLOW_PODCASTS_COLLECTION_ID is not set/);
});

test('readEpisodeCollection: the inventory, newest first, long values cut; the newest published transcripts as text', async () => {
  process.env.WEBFLOW_PODCASTS_COLLECTION_ID = 'col1';
  const ws = fakeWs();
  const inv = await readEpisodeCollection(SLUG, ws);
  assert.deepEqual(ws.calls.slice(0, 2), [['collection', 'col1'], ['items', 'col1']]);
  assert.equal(inv.id, 'col1');
  assert.deepEqual(inv.items.map((i) => i.id), ['i3', 'i2', 'i1', 'i4', 'i0']);
  const cut = inv.items.find((i) => i.id === 'i2').fields.transcript;
  assert.match(cut, /^<p>word .*… \[\d+ characters\]$/);
  assert.equal(cut.length < 450, true);
  assert.equal(inv.items.find((i) => i.id === 'i1').fields.transcript, long(10), 'short values are kept whole');
  assert.deepEqual(readJson(path.join(podcastDir(SLUG), 'site-inventory.json')).items.length, 5);

  const ref = path.join(podcastDir(SLUG), 'reference');
  assert.deepEqual(fs.readdirSync(ref).sort(), ['episode-5.txt', 'episode-6.txt'], 'the 3 newest published; drafts and items without a transcript are skipped');
  const text = fs.readFileSync(path.join(ref, 'episode-5.txt'), 'utf8');
  assert.ok(text.startsWith('Episode 5\n\nword word'));
  assert.ok(text.includes('A & B\'s "line"\nnext'));
  assert.ok(!text.includes('<'));
});

test('readEpisodeCollection: references from an earlier read are replaced', async () => {
  process.env.WEBFLOW_PODCASTS_COLLECTION_ID = 'col1';
  const ref = path.join(podcastDir(SLUG), 'reference');
  fs.mkdirSync(ref, { recursive: true });
  fs.writeFileSync(path.join(ref, 'old.txt'), 'old');
  await readEpisodeCollection(SLUG, fakeWs());
  assert.ok(!fs.existsSync(path.join(ref, 'old.txt')));
});

test('uploadEpisodeAssets: uploads the image fields, then reuses unchanged ones; a changed one goes again', async () => {
  const img = outFile('assets/social/podcast-1280x720.png');
  fs.mkdirSync(path.dirname(img), { recursive: true });
  fs.writeFileSync(img, 'PNGDATA');
  const ws = fakeWs();
  const podcast = fixture();
  podcast.site.fields.text = 'not an asset';
  const a = await uploadEpisodeAssets({ slug: SLUG, podcast, ws, log: quiet });
  assert.deepEqual(ws.calls, [['upload', 'podcast-1280x720.png', 'image/png', 7]]);
  const one = a['assets/social/podcast-1280x720.png'];
  assert.match(one.url, /^https:\/\/cdn\.acme\.example\//);
  assert.equal(one.hash.length, 12);
  assert.deepEqual(readPodcastRecord(SLUG).site.assets, a);
  assert.deepEqual(readJson(path.join(podcastDir(SLUG), 'site-assets.json')), a);

  const again = fakeWs();
  assert.deepEqual(await uploadEpisodeAssets({ slug: SLUG, podcast, ws: again, log: quiet }), a);
  assert.equal(again.calls.length, 0);

  fs.writeFileSync(img, 'PNGDATA2');
  const changed = fakeWs();
  await uploadEpisodeAssets({ slug: SLUG, podcast, ws: changed, log: quiet });
  assert.equal(changed.calls.length, 1);
});

test('uploadEpisodeAssets: one file named in two fields is uploaded once', async () => {
  const img = outFile('assets/social/podcast-1280x720.png');
  fs.mkdirSync(path.dirname(img), { recursive: true });
  fs.writeFileSync(img, 'PNGDATA');
  const ws = fakeWs();
  const podcast = fixture();
  podcast.site.fields.extra = { asset: 'assets/social/podcast-1280x720.png' };
  await uploadEpisodeAssets({ slug: SLUG, podcast, ws, log: quiet });
  assert.equal(ws.calls.length, 1);
});

test('uploadEpisodeAssets: a missing image file is an error', async () => {
  fs.rmSync(outFile('assets'), { recursive: true, force: true });
  await assert.rejects(uploadEpisodeAssets({ slug: SLUG, podcast: fixture(), ws: fakeWs(), log: quiet }), /ENOENT/);
});

test('recordEpisodeItem: create, then update, keeping the assets', async () => {
  process.env.WEBFLOW_PODCASTS_COLLECTION_ID = 'col1';
  writeJson(podcastRecordFile(SLUG), { site: { assets: { 'a.png': { id: 'x' } } } });
  const site = await recordEpisodeItem({ slug: SLUG, ws: fakeWs(), itemId: 'item7' });
  assert.equal(site.action, 'create');
  assert.equal(site.path, '/podcasts/episode-7-smart-scheduling');
  assert.equal(site.url, 'https://www.acme.example/podcasts/episode-7-smart-scheduling');
  assert.equal(site.collectionId, 'col1');
  assert.equal(site.itemId, 'item7');
  assert.equal(site.siteId, 'site1');
  assert.equal(site.draft, true);
  assert.deepEqual(site.assets, { 'a.png': { id: 'x' } });
  assert.equal((await recordEpisodeItem({ slug: SLUG, ws: fakeWs(), itemId: 'item7' })).action, 'update');
});

test('recordEpisodeItem: a site without a domain has no URL', async () => {
  process.env.WEBFLOW_PODCASTS_COLLECTION_ID = 'col1';
  const ws = { ...fakeWs(), site: async () => ({ domains: [] }) };
  assert.equal((await recordEpisodeItem({ slug: SLUG, ws, itemId: 'i' })).url, null);
});

// ---- the video, transcribed (Drive + ElevenLabs, mocked) ----

const VIDEO_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const videoServices = ({ md5 = 'm1', size = '2048' } = {}) => {
  Object.assign(process.env, {
    PODCAST_VIDEO_SOURCE: 'gdrive', PODCAST_STUDIO: 'elevenlabs', GOOGLE_OAUTH_CLIENT_ID: 'c', GOOGLE_OAUTH_CLIENT_SECRET: 's',
    GOOGLE_OAUTH_REFRESH_TOKEN: 'r', ELEVENLABS_API_KEY: 'k', ELEVENLABS_API_URL: 'https://studio.test',
  });
  return mockFetch([
    { url: 'https://oauth2.googleapis.com/token', reply: { json: { access_token: 'a', expires_in: 3600 } } },
    { url: /\/drive\/v3\/files\/[^?]+\?alt=media/, reply: { body: Buffer.from('VIDEO') } },
    { url: `https://www.googleapis.com/drive/v3/files/${VIDEO_ID}?fields=`, reply: { json: { id: VIDEO_ID, name: 'demo.mp4', mimeType: 'video/mp4', size, md5Checksum: md5 } } },
    { url: 'https://studio.test/v1/speech-to-text', reply: { json: { text: 'Hi.', language_code: 'en', audio_duration_secs: 3, words: [{ text: 'Hi.', speaker_id: 'speaker_0', start: 0 }] } } },
  ]);
};

test('transcribeVideo: reads the video, transcribes it, writes the transcript and records the version', async () => {
  const m = videoServices();
  try {
    const t = await transcribeVideo({ slug: SLUG, podcast: fixture(), log: quiet });
    assert.deepEqual(t.utterances, [{ speaker: 'speaker_0', text: 'Hi.', start: 0 }]);
    assert.deepEqual(t.video, { source: 'gdrive', id: VIDEO_ID, name: 'demo.mp4', version: 'm1' });
    assert.equal(t.language, 'en');
    assert.deepEqual(readJson(path.join(podcastDir(SLUG), 'video-transcript.json')).utterances, t.utterances);
    assert.deepEqual(readPodcastRecord(SLUG).video, t.video);
    const stt = m.calls.find((c) => c.url.endsWith('/v1/speech-to-text'));
    assert.equal(stt.body.get('model_id'), 'scribe_v2');
    assert.equal(stt.body.get('num_speakers'), '1');
    assert.equal(stt.body.get('file').name, 'demo.mp4');
  } finally {
    m.restore();
  }
});

test('transcribeVideo: an unchanged video is not sent again, unless forced; a changed one is', async () => {
  let m = videoServices();
  try {
    await transcribeVideo({ slug: SLUG, podcast: fixture(), log: quiet });
    const before = m.calls.length;
    const logs = [];
    await transcribeVideo({ slug: SLUG, podcast: fixture(), log: (s) => logs.push(s) });
    assert.ok(!m.calls.slice(before).some((c) => /speech-to-text|alt=media/.test(c.url)));
    assert.match(logs[0], /already transcribed \(unchanged\)/);
    await transcribeVideo({ slug: SLUG, podcast: fixture(), force: true, log: quiet });
    assert.ok(m.calls.slice(before).some((c) => /speech-to-text/.test(c.url)));
  } finally {
    m.restore();
  }
  m = videoServices({ md5: 'm2' });
  try {
    const t = await transcribeVideo({ slug: SLUG, podcast: fixture(), log: quiet });
    assert.equal(t.video.version, 'm2');
    assert.ok(m.calls.some((c) => /speech-to-text/.test(c.url)));
  } finally {
    m.restore();
  }
});

test('transcribeVideo: a video over PODCAST_VIDEO_MAX_MB is refused before it is read', async () => {
  const m = videoServices({ size: String(3 * 1048576) });
  process.env.PODCAST_VIDEO_MAX_MB = '2';
  try {
    await assert.rejects(transcribeVideo({ slug: SLUG, podcast: fixture(), log: quiet }), /demo\.mp4 is 3 MB — over PODCAST_VIDEO_MAX_MB \(2\)/);
    assert.ok(!m.calls.some((c) => /alt=media|speech-to-text/.test(c.url)));
  } finally {
    m.restore();
  }
});

// ---- the episode, voiced (ElevenLabs mocked; the parts are joined by the real ffmpeg) ----

const FF = haveFfmpeg();
let silence;
const mp3 = () => {
  if (!silence) {
    const f = path.join(SANDBOX, 'silence.mp3');
    const r = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.3', '-c:a', 'libmp3lame', '-b:a', '64k', f]);
    assert.equal(r.status, 0, String(r.stderr));
    silence = fs.readFileSync(f);
  }
  return silence;
};
const studio = () => {
  Object.assign(process.env, { PODCAST_STUDIO: 'elevenlabs', ELEVENLABS_API_KEY: 'k', ELEVENLABS_API_URL: 'https://studio.test', ELEVENLABS_HOST_VOICE_ID: 'vh', ELEVENLABS_HOST_NAME: 'Ava', ELEVENLABS_GUEST_VOICE_ID: 'vg', ELEVENLABS_GUEST_NAME: 'Ben' });
  let n = 0;
  return mockFetch([{ method: 'POST', url: 'https://studio.test/v1/text-to-dialogue', reply: () => ({ body: mp3(), headers: { 'request-id': `req-${++n}` } }) }]);
};
const longScript = () => {
  const p = fixture();
  p.script.lines = Array.from({ length: 5 }, (_, i) => ({ speaker: i % 2 ? 'host' : 'guest', text: `[excited] Line ${i} ${'talk '.repeat(180)}` }));
  return p;
};

test('producePodcast: no script lines, or no host voice, is an error before anything is voiced', async () => {
  const p = fixture();
  p.script.lines = [];
  await assert.rejects(producePodcast({ slug: SLUG, podcast: p, log: quiet }), /no script\.lines/);
  await assert.rejects(producePodcast({ slug: SLUG, podcast: fixture(), log: quiet }), /ELEVENLABS_HOST_VOICE_ID is not set/);
});

test('producePodcast: voices the script in parts of at most 2,000 characters, chained, joined into episode.mp3 with a transcript', { skip: FF ? false : 'ffmpeg not installed (integration/podcast.test.mjs covers the join)' }, async () => {
  const m = studio();
  try {
    const podcast = longScript();
    const rec = await producePodcast({ slug: SLUG, podcast, log: quiet });
    const bodies = await Promise.all(m.calls.map(async (c) => JSON.parse(await bodyOf(c))));
    assert.ok(bodies.length >= 3, `${bodies.length} parts`);
    for (const b of bodies) assert.ok(b.inputs.reduce((n, x) => n + x.text.length, 0) <= 2000 || b.inputs.length === 1);
    assert.deepEqual(bodies.flatMap((b) => b.inputs.map((x) => x.voice_id)), scriptLines(podcast).map((l) => (l.speaker === 'host' ? 'vh' : 'vg')), 'every line once, in order, in its voice');
    assert.equal(bodies[0].model_id, 'eleven_v3');
    assert.equal(bodies[0].language_code, 'en');
    assert.equal(bodies[0].previous_request_ids, undefined);
    assert.deepEqual(bodies[1].previous_request_ids, ['req-1']);

    assert.equal(rec.studio.state, 'produced');
    assert.equal(rec.studio.parts.length, bodies.length);
    assert.equal(rec.studio.lines, scriptLines(podcast).length);
    const dir = podcastDir(SLUG);
    assert.ok(fs.statSync(path.join(dir, 'episode.mp3')).size > 0);
    const tx = readJson(path.join(dir, 'transcript.json')).lines;
    assert.equal(tx[0].speaker, 'Ava');
    assert.equal(tx[1].speaker, 'Ben');
    assert.ok(!tx.some((l) => l.text.includes('[')), 'audio tags are left out of the transcript');
    assert.match(fs.readFileSync(path.join(dir, 'transcript.html'), 'utf8'), /^<p><strong>Ava:<\/strong> Welcome to the Acme Deep Dive/);
    assert.match(fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8'), /^Ava: Welcome/);
  } finally {
    m.restore();
  }
});

test('producePodcast: an unchanged script reuses every part; a changed one needs force and voices from the change on', { skip: FF ? false : 'ffmpeg not installed (integration/podcast.test.mjs covers the join)' }, async () => {
  const m = studio();
  try {
    const podcast = longScript();
    await producePodcast({ slug: SLUG, podcast, log: quiet });
    const first = m.calls.length;

    await producePodcast({ slug: SLUG, podcast, log: quiet });
    assert.equal(m.calls.length, first, 'nothing voiced again');

    podcast.script.outro = 'A new goodbye.';
    await assert.rejects(producePodcast({ slug: SLUG, podcast, log: quiet }), /voiced from another script .* --force/);
    await producePodcast({ slug: SLUG, podcast, force: true, log: quiet });
    assert.equal(m.calls.length - first, 1, 'only the last part, which holds the outro');
    assert.equal(readPodcastRecord(SLUG).studio.state, 'produced');
  } finally {
    m.restore();
  }
});

test('producePodcast: one voice reads every line when there is no guest', { skip: FF ? false : 'ffmpeg not installed (integration/podcast.test.mjs covers the join)' }, async () => {
  const m = studio();
  delete process.env.ELEVENLABS_GUEST_VOICE_ID;
  try {
    await producePodcast({ slug: SLUG, podcast: fixture(), log: quiet });
    const b = JSON.parse(await bodyOf(m.calls[0]));
    assert.deepEqual([...new Set(b.inputs.map((x) => x.voice_id))], ['vh']);
    assert.equal(readJson(path.join(podcastDir(SLUG), 'transcript.json')).lines[1].speaker, 'Ava');
  } finally {
    m.restore();
  }
});

test('loadPodcast: null for a feature without one', () => {
  assert.equal(loadPodcast('no-such-feature'), null);
  assert.equal(loadPodcast(SLUG).episode.number, 7);
});
