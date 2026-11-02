// The podcast commands end to end against a fake studio (ELEVENLABS_API_URL):
// the script is voiced in parts, the parts joined with the real ffmpeg, the
// transcript written, a rerun reuses every part, and a changed script needs
// --force. Needs ffmpeg (skipped without it, except in CI).

import '../setup.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cliAsync, haveFfmpeg, required, SANDBOX } from '../helpers.mjs';
import { fakeStudio } from '../fakes.mjs';

const SLUG = 'smart-scheduling';
const skip = required(haveFfmpeg(), 'ffmpeg');
const lib = path.join(SANDBOX, 'library', 'features', SLUG);
const dir = path.join(SANDBOX, 'output', SLUG, 'podcast');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';

// enough lines for more than one part (the studio takes about 2,000 characters a request)
const line = (i) => `Line ${i}: the assistant offers three open times from the calendar, and the customer taps one to book it without any back and forth at all.`;
const podcast = (extra = '') => ({
  video: { file: 'https://drive.google.com/file/d/abc123/view' },
  episode: { number: 3, title: 'Episode 3: Book the Right Time', description: 'Two hosts on offering open times in a reply.' },
  script: {
    instructions: 'Upbeat and practical.',
    minutes: 2,
    intro: 'Welcome to the Acme show.',
    lines: Array.from({ length: 24 }, (_, i) => ({ speaker: i % 2 ? 'guest' : 'host', text: `${i % 3 === 0 ? '[laughs] ' : ''}${line(i)}${extra}` })),
    outro: 'That is it for today.',
    language: 'en',
  },
});

let studio;
let env;
before(async () => {
  if (skip) return;
  const mp3 = path.join(SANDBOX, 'tone.mp3');
  const r = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-c:a', 'libmp3lame', '-b:a', '64k', mp3]);
  assert.equal(r.status, 0, String(r.stderr));
  studio = await fakeStudio({ mp3: fs.readFileSync(mp3) });
  env = {
    PODCAST_STUDIO: 'elevenlabs', ELEVENLABS_API_KEY: studio.apiKey, ELEVENLABS_API_URL: studio.url,
    ELEVENLABS_HOST_VOICE_ID: 'v-host', ELEVENLABS_HOST_NAME: 'Hana', ELEVENLABS_GUEST_VOICE_ID: 'v-guest', ELEVENLABS_GUEST_NAME: 'Gus',
  };
  fs.writeFileSync(path.join(lib, 'podcast.json'), JSON.stringify(podcast(), null, 2));
});
after(() => studio?.close());

const dialogues = () => studio.requests.filter((r) => r.url.startsWith('/v1/text-to-dialogue'));

test('podcast-script shows the script with the hosts\' names and its length', { skip }, async () => {
  const r = await cliAsync(['podcast-script', SLUG], { env });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^Hana: Welcome to the Acme show\./m);
  assert.match(r.out, /^Gus: Line 1:/m);
  assert.match(r.out, /26 lines, \d+ words — about [\d.]+ min \(target 2\)/);
});

test('podcast --yes voices the script in parts and joins them', { skip, timeout: 120_000 }, async () => {
  const r = await cliAsync(['podcast', SLUG, '--yes'], { env });
  assert.equal(r.code, 0, r.out);
  const calls = dialogues();
  assert.ok(calls.length >= 2, `voiced in ${calls.length} part(s)`);
  for (const c of calls) {
    assert.ok(c.json.inputs.every((i) => ['v-host', 'v-guest'].includes(i.voice_id)));
    assert.ok(c.json.inputs.reduce((n, i) => n + i.text.length, 0) <= 2000 + 200, 'a part stays near the size limit');
    assert.equal(c.json.model_id, 'eleven_v3');
    assert.equal(c.json.language_code, 'en');
  }
  // each part after the first is conditioned on the ones before
  assert.deepEqual(calls[1].json.previous_request_ids, ['req-1']);
  // every line voiced once, in order, intro first and outro last
  const said = calls.flatMap((c) => c.json.inputs.map((i) => i.text));
  assert.equal(said.length, 26);
  assert.equal(said[0], 'Welcome to the Acme show.');
  assert.equal(said.at(-1), 'That is it for today.');

  const episode = path.join(dir, 'episode.mp3');
  assert.ok(fs.statSync(episode).size > 1000);
  const probe = spawnSync(ffmpeg, ['-v', 'error', '-i', episode, '-f', 'null', '-'], { encoding: 'utf8' });
  assert.equal(probe.status, 0, `episode.mp3 decodes: ${probe.stderr}`);

  // the transcript: speakers by name, audio tags left out
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'transcript.json'), 'utf8')).lines;
  assert.equal(t.length, 26);
  assert.deepEqual(t[0], { speaker: 'Hana', text: 'Welcome to the Acme show.' });
  assert.ok(t.every((l) => !/\[laughs\]/.test(l.text)));
  assert.match(fs.readFileSync(path.join(dir, 'transcript.html'), 'utf8'), /^<p><strong>Hana:<\/strong> Welcome/);

  const rec = JSON.parse(fs.readFileSync(path.join(lib, 'podcast.published.json'), 'utf8'));
  assert.equal(rec.studio.state, 'produced');
  assert.equal(rec.studio.parts.length, calls.length);
  assert.match(r.out, /next\s+upload episode\.mp3 to the show by hand/);
});

test('a rerun reuses every voiced part: nothing is spent again', { skip, timeout: 120_000 }, async () => {
  const before = dialogues().length;
  const r = await cliAsync(['podcast', SLUG, '--yes'], { env });
  assert.equal(r.code, 0, r.out);
  assert.equal(dialogues().length, before);
  assert.match(r.out, /have\s+part 1/);
});

test('a changed script is voiced again only with --force, from the first changed part', { skip, timeout: 120_000 }, async () => {
  const p = podcast();
  p.script.outro = 'That is it for today. See you next week.';
  fs.writeFileSync(path.join(lib, 'podcast.json'), JSON.stringify(p, null, 2));
  const refused = await cliAsync(['podcast', SLUG, '--yes'], { env });
  assert.notEqual(refused.code, 0);
  assert.match(refused.out, /voiced from another script.*--force/);

  const before = dialogues().length;
  const parts = JSON.parse(fs.readFileSync(path.join(lib, 'podcast.published.json'), 'utf8')).studio.parts.length;
  const forced = await cliAsync(['podcast', SLUG, '--yes', '--force'], { env });
  assert.equal(forced.code, 0, forced.out);
  assert.equal(dialogues().length - before, 1, 'only the last part (with the outro) is voiced again');
  assert.equal((forced.out.match(/have\s+part/g) ?? []).length, parts - 1);
});

test('a wrong key is reported by the studio, readably', { skip }, async () => {
  const r = await cliAsync(['podcast-check'], { env: { ...env, ELEVENLABS_API_KEY: 'wrong' } });
  assert.match(r.out, /podcast studio GET \/v2\/voices\?page_size=100 -> 401 invalid api key/);
});
