// The podcast: an audio episode about the feature, made from its video and
// published to the brand's show (docs/podcast.md).
//
// Three services, each a deployment fact in .env with an adapter folder of its
// own; nothing here knows one provider from another:
//
//   PODCAST_VIDEO_SOURCE  videosource/       file(ref), download(ref)       where the feature video lives
//   PODCAST_STUDIO        podcaststudio/     transcribe, dialogue, voices, voice   speech to text; voices the script
//   PODCAST_DIRECTORY     podcastdirectory/  show, episodes                  where listeners find it (read only)
//
// The rollout-podcast-producer agent writes library/features/<slug>/podcast.json:
// the video, the episode's title and notes, the website episode page's
// fields, and the episode's script — the two hosts' lines, written from the
// brief and the video transcript. The pipeline transcribes the video, has the
// studio voice the script into an MP3 that a person uploads to the show,
// finds it in the directory once it is published there, and keeps the record
// of all of it:
// library/features/<slug>/podcast.published.json.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { env, envNumber, escapeHtml as e, featurePaths, readJson, writeJson, SLUG_RE } from './env.mjs';

const ADAPTERS = {
  video: { key: 'PODCAST_VIDEO_SOURCE', dir: 'videosource', all: { gdrive: () => import('./videosource/gdrive.mjs') } },
  studio: { key: 'PODCAST_STUDIO', dir: 'podcaststudio', all: { elevenlabs: () => import('./podcaststudio/elevenlabs.mjs') } },
  directory: { key: 'PODCAST_DIRECTORY', dir: 'podcastdirectory', all: { spotify: () => import('./podcastdirectory/spotify.mjs') } },
};

export const podcastFile = (slug) => path.join(featurePaths(slug).library, 'podcast.json');
export const podcastRecordFile = (slug) => path.join(featurePaths(slug).library, 'podcast.published.json');
// what the pipeline made and read for the episode: transcripts, the MP3, the site's collection
export const podcastDir = (slug) => path.join(featurePaths(slug).output, 'podcast');
export const readPodcastRecord = (slug) => (fs.existsSync(podcastRecordFile(slug)) ? readJson(podcastRecordFile(slug)) : null);
export const loadPodcast = (slug) => (fs.existsSync(podcastFile(slug)) ? readJson(podcastFile(slug)) : null);

// Merge one part of the record (video, studio, directory, site) and write it.
function record(slug, part, value) {
  const r = readPodcastRecord(slug) ?? {
    $comment: 'Where the podcast episode lives: written by pipeline/podcast.mjs. studio is the produced episode (rerun only with --force), directory the episode where listeners find it once uploaded to the show, site the website episode page.',
  };
  r[part] = value;
  r.updatedAt = new Date().toISOString();
  writeJson(podcastRecordFile(slug), r);
  return r;
}

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);

async function connectTo(role, settings) {
  const a = ADAPTERS[role];
  const name = env(a.key);
  if (!name) throw new Error(`${a.key} is not set in .env (${Object.keys(a.all).join(', ')})`);
  if (!a.all[name]) throw new Error(`no ${a.dir} adapter "${name}" (${Object.keys(a.all).join(', ')})`);
  return { name, ...(await a.all[name]()).connect(settings) };
}

export const videoSource = () => connectTo('video', {
  keyFile: env('GOOGLE_SERVICE_ACCOUNT_KEY_FILE'),
  oauth: { clientId: env('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: env('GOOGLE_OAUTH_CLIENT_SECRET'), refreshToken: env('GOOGLE_OAUTH_REFRESH_TOKEN') },
});
export const podcastStudio = () => connectTo('studio', { apiKey: env('ELEVENLABS_API_KEY'), baseUrl: env('ELEVENLABS_API_URL') });
export const podcastDirectory = () => connectTo('directory', {
  clientId: env('SPOTIFY_CLIENT_ID'), clientSecret: env('SPOTIFY_CLIENT_SECRET'), showId: env('SPOTIFY_SHOW_ID'), market: env('SPOTIFY_MARKET'),
});

// The show's two fixed voices (the guest is optional: one voice reads alone).
export function showVoices() {
  const host = env('ELEVENLABS_HOST_VOICE_ID');
  if (!host) throw new Error('ELEVENLABS_HOST_VOICE_ID is not set in .env — rollout.mjs podcast-check lists the voices');
  const guest = env('ELEVENLABS_GUEST_VOICE_ID');
  return {
    host: { id: host, name: env('ELEVENLABS_HOST_NAME', 'Host') },
    guest: guest ? { id: guest, name: env('ELEVENLABS_GUEST_NAME', 'Guest') } : null,
  };
}

// The website collection episode pages are items of.
export const podcastsCollectionId = () => env('WEBFLOW_PODCASTS_COLLECTION_ID') ?? null;

const SPEAKERS = ['host', 'guest'];
// what one line may hold, so it always fits a part of its own
const LINE_MAX = 1200;
// spoken pace, words per minute, for the length estimate (the dialogue model's measured pace)
const WPM = 180;

// The words a line says: audio tags like [laughs] and [excited] are directions, not speech.
const spoken = (text) => String(text ?? '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

// The lines voiced, in order: the intro (host), the script, the outro (host).
export function scriptLines(podcast) {
  const s = podcast.script ?? {};
  return [
    ...(s.intro ? [{ speaker: 'host', text: s.intro }] : []),
    ...(s.lines ?? []),
    ...(s.outro ? [{ speaker: 'host', text: s.outro }] : []),
  ];
}

// The script's length: { words, minutes }.
export function scriptLength(podcast) {
  const words = scriptLines(podcast).reduce((n, l) => n + spoken(l.text).split(' ').filter(Boolean).length, 0);
  return { words, minutes: Math.round((words / WPM) * 10) / 10 };
}

// Check podcast.json. { errors, warnings }.
export function validatePodcast(slug) {
  const p = loadPodcast(slug);
  const errors = [];
  const warnings = [];
  if (!p) return { errors: [`no ${path.relative(process.cwd(), podcastFile(slug))}`], warnings };
  if (!p.video?.file) errors.push('video.file (the feature video: a Drive link or file id) is required');
  const ep = p.episode ?? {};
  if (!ep.title?.trim()) errors.push('episode.title is required');
  if (ep.number != null && !(Number.isInteger(ep.number) && ep.number > 0)) errors.push('episode.number is a whole number above 0');
  if (!ep.description?.trim()) errors.push('episode.description (the show notes) is required');
  else if (ep.description.length > 4000) warnings.push(`episode.description is ${ep.description.length} characters — directories cut long notes`);
  if (ep.image && !fs.existsSync(path.join(featurePaths(slug).output, ep.image))) errors.push(`episode.image ${ep.image} is not in output/${slug}/ — build first`);
  const s = p.script ?? {};
  for (const k of ['duration', 'highlights']) if (s[k] != null) warnings.push(`script.${k} is no longer used — the script's lines set the length and the points covered`);
  if (!Array.isArray(s.lines) || !s.lines.length) warnings.push('script.lines is empty — the agent writes the episode\'s script before it can be produced');
  (s.lines ?? []).forEach((l, i) => {
    if (!SPEAKERS.includes(l?.speaker)) errors.push(`script.lines[${i}].speaker is ${SPEAKERS.join(' or ')}`);
    if (!spoken(l?.text)) errors.push(`script.lines[${i}].text is empty`);
    else if (l.text.length > LINE_MAX) errors.push(`script.lines[${i}] is ${l.text.length} characters — split it (at most ${LINE_MAX})`);
  });
  if (s.minutes != null && !(s.minutes > 0)) errors.push('script.minutes (the target length) is a number of minutes above 0');
  if (s.lines?.length && s.minutes > 0) {
    const { minutes } = scriptLength(p);
    if (Math.abs(minutes - s.minutes) > Math.max(1, s.minutes * 0.2)) warnings.push(`the script runs about ${minutes} min at ${WPM} words a minute; script.minutes asks for ${s.minutes}`);
  }
  const f = p.site?.fields;
  if (f) {
    if (!String(f.name ?? '').trim()) errors.push('site.fields.name (the episode page\'s title) is required');
    if (!SLUG_RE.test(f.slug ?? '')) errors.push(`site.fields.slug "${f.slug ?? ''}" must be lower-case words joined by hyphens`);
    const inv = readSiteInventory(slug);
    if (inv) {
      const known = new Set(inv.fields.map((x) => x.slug));
      for (const k of Object.keys(f)) if (!known.has(k)) errors.push(`site.fields["${k}"]: no field "${k}" in ${inv.name} — fields: ${[...known].join(', ')}`);
      const taken = inv.items.find((i) => i.slug === f.slug);
      if (taken && taken.id !== readPodcastRecord(slug)?.site?.itemId) errors.push(`an episode page with slug "${f.slug}" already exists (${taken.id})`);
    } else warnings.push(`the episode collection has not been read — run rollout.mjs podcast-site ${slug}`);
  }
  return { errors, warnings };
}

// ---- 1. the video, transcribed ----

// Transcribe the feature video into output/<slug>/podcast/video-transcript.json.
// The video is read from the source into memory and sent to the studio; it is
// never saved. An unchanged video (same checksum) is not transcribed again.
export async function transcribeVideo({ slug, podcast, force = false, log = console.log }) {
  const file = path.join(podcastDir(slug), 'video-transcript.json');
  const vs = await videoSource();
  const meta = await vs.file(podcast.video.file);
  const prior = fs.existsSync(file) ? readJson(file) : null;
  const version = meta.md5 ?? meta.modifiedAt;
  if (prior && prior.video?.version === version && !force) {
    log(`  have    ${meta.name} — already transcribed (unchanged)`);
    return prior;
  }
  const maxMb = envNumber('PODCAST_VIDEO_MAX_MB', 2048);
  if (meta.size > maxMb * 1048576) throw new Error(`${meta.name} is ${Math.round(meta.size / 1048576)} MB — over PODCAST_VIDEO_MAX_MB (${maxMb})`);
  log(`  read    ${meta.name}  (${(meta.size / 1048576).toFixed(1)} MB, ${vs.name})`);
  const video = await vs.download(podcast.video.file);
  const studio = await podcastStudio();
  log(`  send    to ${studio.name} speech to text`);
  const t = await studio.transcribe({ blob: video.blob, name: video.name, model: env('ELEVENLABS_STT_MODEL', 'scribe_v2'), speakers: podcast.video.speakers });
  const out = {
    $comment: 'The feature video as text, by speaker: written by pipeline/podcast.mjs (podcast-transcribe). Regenerable.',
    video: { source: vs.name, id: meta.id, name: meta.name, version },
    language: t.language,
    seconds: t.seconds,
    utterances: t.utterances,
    transcribedAt: new Date().toISOString(),
  };
  writeJson(file, out);
  record(slug, 'video', out.video);
  return out;
}

// ---- 2. the episode, voiced ----

const FFMPEG = env('FFMPEG', 'ffmpeg');

// Split the lines into parts the studio voices in one request each, never
// splitting a line: [[{ speaker, text, voiceId }]].
function parts(lines, maxChars) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const l of lines) {
    if (cur.length && size + l.text.length > maxChars) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

// Voice the script (podcast.json script: intro, lines, outro) with the show's
// two voices and save the episode: output/<slug>/podcast/episode.mp3 and the
// transcript (json, txt, html). The script is voiced in parts, each
// conditioned on the ones before it, then joined. A part already voiced from
// the same lines, after the same parts, is reused, so a run that stopped
// half-way picks up where it was; a produced episode is not voiced again
// unless its script changed and force says so (it spends credits).
export async function producePodcast({ slug, podcast, force = false, log = console.log }) {
  const lines = scriptLines(podcast);
  if (!podcast.script?.lines?.length) throw new Error(`podcast.json has no script.lines — the rollout-podcast-producer agent writes the script first`);
  const voices = showVoices();
  const voiceOf = { host: voices.host, guest: voices.guest ?? voices.host };
  const dir = podcastDir(slug);
  const partsDir = path.join(dir, 'parts');
  fs.mkdirSync(partsDir, { recursive: true });

  const studio = await podcastStudio();
  const model = env('ELEVENLABS_MODEL_ID', 'eleven_v3');
  const stability = env('ELEVENLABS_STABILITY') == null ? null : envNumber('ELEVENLABS_STABILITY', 0.5);
  const language = podcast.script.language ?? null;
  const voiced = lines.map((l) => ({ ...l, voiceId: voiceOf[l.speaker].id }));
  const scriptHash = sha(JSON.stringify({ model, language, stability, voiced }));
  const prior = readPodcastRecord(slug)?.studio;
  if (prior?.state === 'produced' && prior.scriptHash !== scriptHash && !force) {
    throw new Error('the episode was voiced from another script — voicing it again spends credits: pass --force once that is approved');
  }

  const { words, minutes } = scriptLength(podcast);
  const chunks = parts(voiced, studio.maxChars);
  log(`  voice   ${lines.length} lines, ${words} words (about ${minutes} min) in ${chunks.length} part(s) — ${voices.host.name}${voices.guest ? ` and ${voices.guest.name}` : ''}, ${model}`);
  const done = [];
  const kept = prior?.parts ?? [];
  let chain = true; // reuse only while every part before was reused unchanged
  for (const [i, chunk] of chunks.entries()) {
    const hash = sha(JSON.stringify({ model, language, stability, chunk }));
    const file = path.join(partsDir, `${String(i + 1).padStart(2, '0')}.mp3`);
    if (chain && kept[i]?.hash === hash && fs.existsSync(file)) {
      done.push(kept[i]);
      log(`  have    part ${i + 1}`);
      continue;
    }
    chain = false;
    const r = await studio.dialogue({ lines: chunk, model, language, stability, previousRequestIds: done.map((d) => d.requestId).filter(Boolean) });
    fs.writeFileSync(file, r.audio);
    done.push({ hash, requestId: r.requestId, file: path.basename(file) });
    log(`  part    ${i + 1}/${chunks.length}  (${(r.audio.length / 1048576).toFixed(1)} MB)`);
    // each part is recorded at once, so a run that stops loses nothing voiced
    record(slug, 'studio', { provider: studio.name, mode: 'dialogue', model, scriptHash, state: 'voicing', parts: done });
  }

  // join the parts, re-encoded at the parts' own rate so the joins carry clean timestamps
  const list = path.join(os.tmpdir(), `rollout-podcast-${slug}-${process.pid}.txt`);
  const quoted = (f) => `'${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
  fs.writeFileSync(list, done.map((d) => `file ${quoted(path.join(partsDir, d.file))}`).join('\n'));
  const out = path.join(dir, 'episode.mp3');
  try {
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', out], { stdio: ['ignore', 'inherit', 'inherit'] });
  } finally {
    fs.rmSync(list, { force: true });
  }
  const audio = fs.readFileSync(out);
  const names = { host: voices.host.name, guest: (voices.guest ?? voices.host).name };
  const transcript = lines.map((l) => ({ speaker: names[l.speaker], text: spoken(l.text) }));
  writeTranscript(dir, transcript);
  log(`  saved   episode.mp3 (${(audio.length / 1048576).toFixed(1)} MB), transcript (${transcript.length} lines)`);
  return record(slug, 'studio', {
    provider: studio.name, mode: 'dialogue', model, scriptHash, state: 'produced', parts: done,
    audioHash: sha(audio), lines: transcript.length, words, producedAt: new Date().toISOString(),
  });
}

function writeTranscript(dir, lines) {
  writeJson(path.join(dir, 'transcript.json'), { $comment: 'The episode as said, by speaker: written by pipeline/podcast.mjs. Regenerable.', lines });
  fs.writeFileSync(path.join(dir, 'transcript.txt'), lines.map((l) => `${l.speaker ? `${l.speaker}: ` : ''}${l.text}`).join('\n\n') + '\n');
  // the website's rich-text form: one paragraph per line, the speaker in bold
  fs.writeFileSync(path.join(dir, 'transcript.html'), lines.map((l) => `<p>${l.speaker ? `<strong>${e(l.speaker)}:</strong> ` : ''}${e(l.text)}</p>`).join(''));
}

// ---- 3. the episode, where listeners find it ----

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Look for the published episode in the directory, by title. Found, it is
// recorded with its link and embed URL; not yet, null.
export async function findEpisode({ slug, podcast }) {
  const dir = await podcastDirectory();
  const want = norm(podcast.episode.title);
  const hit = (await dir.episodes()).find((x) => norm(x.title) === want) ?? null;
  if (hit) record(slug, 'directory', { provider: dir.name, ...hit, foundAt: new Date().toISOString() });
  return { directory: dir.name, episode: hit };
}

// ---- 4. the episode page on the website ----

const readSiteInventory = (slug) => {
  const f = path.join(podcastDir(slug), 'site-inventory.json');
  return fs.existsSync(f) ? readJson(f) : null;
};

// Read the episode collection's fields and items into
// output/<slug>/podcast/site-inventory.json; long text values are cut, so the
// agent sees how items are filled without the whole transcripts.
export async function readEpisodeCollection(slug, ws) {
  const cid = podcastsCollectionId();
  if (!cid) throw new Error('WEBFLOW_PODCASTS_COLLECTION_ID is not set in .env');
  const [c, items] = await Promise.all([ws.collection(cid), ws.items(cid)]);
  const cut = (v) => (typeof v === 'string' && v.length > 400 ? `${v.slice(0, 400)}… [${v.length} characters]` : v);
  const inv = {
    $comment: 'The website\'s episode collection, read by pipeline/podcast.mjs (rollout.mjs podcast-site). Never edit; read it again instead.',
    ...c,
    items: items
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((i) => ({ ...i, fields: Object.fromEntries(Object.entries(i.fields).map(([k, v]) => [k, cut(v)])) })),
    readAt: new Date().toISOString(),
  };
  writeJson(path.join(podcastDir(slug), 'site-inventory.json'), inv);
  writeReferences(slug, items);
  return inv;
}

// The show's newest published episodes as plain text, for the agent to write
// the script in the show's own style: output/<slug>/podcast/reference/<item>.txt.
// An episode's transcript is its longest rich-text field.
function writeReferences(slug, items, count = 3) {
  const dir = path.join(podcastDir(slug), 'reference');
  fs.rmSync(dir, { recursive: true, force: true });
  const text = (html) => html.replace(/<\/p>\s*/g, '\n\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, x) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' })[x]).trim();
  const published = items.filter((i) => !i.draft && i.publishedAt).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  for (const i of published.slice(0, count)) {
    const longest = Object.values(i.fields).filter((v) => typeof v === 'string' && v.includes('<p')).sort((a, b) => b.length - a.length)[0];
    if (!longest) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${i.slug}.txt`), `${i.name}\n\n${text(longest)}\n`);
  }
}

// Upload the site.fields images ({ "asset": "<path in output/<slug>/>" }) to
// the site's assets; unchanged ones are reused. { file: { id, url, hash } }.
export async function uploadEpisodeAssets({ slug, podcast, ws, log = console.log }) {
  const rec = readPodcastRecord(slug)?.site ?? {};
  const kept = rec.assets ?? {};
  const out = {};
  for (const v of Object.values(podcast.site?.fields ?? {})) {
    if (!v || typeof v !== 'object' || typeof v.asset !== 'string') continue;
    if (out[v.asset]) continue; // one file named in two fields is uploaded once
    const data = fs.readFileSync(path.join(featurePaths(slug).output, v.asset));
    const hash = sha(data);
    if (kept[v.asset]?.hash === hash) {
      out[v.asset] = kept[v.asset];
      log(`  reuse   ${v.asset}`);
      continue;
    }
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(v.asset).toLowerCase()] ?? 'application/octet-stream';
    const a = await ws.uploadAsset({ name: path.basename(v.asset), data, type });
    out[v.asset] = { id: a.id, url: a.url, hash };
    log(`  upload  ${v.asset}  -> asset ${a.id}`);
  }
  record(slug, 'site', { ...rec, assets: { ...kept, ...out } });
  writeJson(path.join(podcastDir(slug), 'site-assets.json'), out);
  return out;
}

// After the agent created or updated the episode page: read it back and record it.
export async function recordEpisodeItem({ slug, ws, itemId }) {
  const cid = podcastsCollectionId();
  if (!cid) throw new Error('WEBFLOW_PODCASTS_COLLECTION_ID is not set in .env');
  const [i, c, s] = await Promise.all([ws.item(cid, itemId), ws.collection(cid), ws.site()]);
  const prior = readPodcastRecord(slug)?.site ?? {};
  const itemPath = `/${c.slug}/${i.slug}`;
  return record(slug, 'site', {
    provider: ws.name, siteId: ws.siteId, collectionId: c.id, itemId: i.id, title: i.name, path: itemPath,
    url: s.domains[0] ? `https://${s.domains[0]}${itemPath}` : null,
    draft: i.draft, updatedAt: i.updatedAt, publishedAt: i.publishedAt,
    assets: prior.assets ?? {}, action: prior.itemId === i.id ? 'update' : 'create', recordedAt: new Date().toISOString(),
  }).site;
}
