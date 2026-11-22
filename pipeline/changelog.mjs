// The product changelog: library/features/<slug>/changelog.json + brand ->
// output/<slug>/changelog/, and the entry in the changelog service (docs/changelog.md).
//
// changelog.json is the rollout-changelog-writer agent's sidecar: the entry's
// title, its types (new, improved, fixed), a summary, a few short sections,
// an optional image and video by URL, the call to action, and how to publish
// it. This checks it, writes the entry's Markdown, and builds:
//
//   entry.md      the entry's details, as the changelog service takes them
//   entry.json    title, types, labels, create or update, what blocks sending
//   preview.html  the entry as it will read
//
// Which service is a deployment fact: CHANGELOG in .env, else the brand's
// changelog.provider. Each provider is an adapter in changelog/ with the same
// calls; nothing here knows one from another:
//
//   list({ limit, skip, sort, status })   a page of entries: { hasMore, entries }
//   all({ max })                          every entry, newest saved first
//   get(id)                               one entry
//   create({ title, details, types, labelIds, notify })   a new, unpublished entry: { id }
//   update(id, fields)                    an entry's content; fields left out unchanged
//   changeStatus(id, status)              draft | published
//
// An entry: { id, title, status, types, labels: [{ id, name }], markdown,
// text, url, lastSaved, publishedAt, scheduledFor, created }.
//
// publishChangelog sends it, only on the user's approval: always as a draft
// first; published only with live; subscribers emailed only with notify. The
// record (changelog.published.json) keeps the entry's id, so the next send
// updates the same entry.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env, escapeHtml as e, featurePaths, readJson, writeJson } from './env.mjs';
import { brandCss } from './brand.mjs';
import { tagLink } from './hubspot.mjs';

export const changelogFile = (slug) => path.join(featurePaths(slug).library, 'changelog.json');
export const changelogDir = (slug) => path.join(featurePaths(slug).output, 'changelog');
export const changelogLiveDir = (slug) => path.join(featurePaths(slug).output, 'changelog-live');
export const changelogRecordFile = (slug) => path.join(featurePaths(slug).library, 'changelog.published.json');
export const readChangelogRecord = (slug) => (fs.existsSync(changelogRecordFile(slug)) ? readJson(changelogRecordFile(slug)) : null);
export const loadChangelog = (slug) => (fs.existsSync(changelogFile(slug)) ? readJson(changelogFile(slug)) : null);

export const TYPES = ['new', 'improved', 'fixed'];

// Lengths: errors past the hard limit, warnings past what reads well.
export const LIMITS = {
  title: { warn: 80, max: 150 },
  summary: { warn: 400, max: 800 },
  sections: 5,
  sectionTitle: 60,
  sectionBody: 400,
  bullets: 8,
  bullet: 160,
  ctaLabel: 30,
  alt: 140,
};

const len = (s) => [...String(s ?? '')].length;
const https = (u) => /^https:\/\/\S+$/.test(String(u ?? ''));
const toTime = (iso) => (iso ? Date.parse(iso) : NaN);

// errors block the build; warnings are for the agent to judge.
export function validateChangelog(slug, data = loadChangelog(slug)) {
  const errors = [];
  const warnings = [];
  if (!data) return { errors: [`no ${path.relative(process.cwd(), changelogFile(slug))} — the changelog writer writes it`], warnings };

  if (!data.title) errors.push('title: missing');
  else if (len(data.title) > LIMITS.title.max) errors.push(`title: ${len(data.title)} characters (at most ${LIMITS.title.max})`);
  else if (len(data.title) > LIMITS.title.warn) warnings.push(`title: ${len(data.title)} characters — a changelog title reads best under ${LIMITS.title.warn}`);

  const types = data.types ?? [];
  if (!Array.isArray(types) || !types.length) errors.push(`types: one or more of ${TYPES.join(', ')}`);
  else types.filter((t) => !TYPES.includes(t)).forEach((t) => errors.push(`types: "${t}" is not one of ${TYPES.join(', ')}`));

  if (!data.summary) errors.push('summary: missing (the first thing readers see)');
  else if (len(data.summary) > LIMITS.summary.max) errors.push(`summary: ${len(data.summary)} characters (at most ${LIMITS.summary.max})`);
  else if (len(data.summary) > LIMITS.summary.warn) warnings.push(`summary: ${len(data.summary)} characters (keep it under ${LIMITS.summary.warn})`);

  const sections = data.sections ?? [];
  if (sections.length > LIMITS.sections) errors.push(`sections: ${sections.length} (at most ${LIMITS.sections} — link to the page for the rest)`);
  sections.forEach((s, i) => {
    const where = `sections[${i}]`;
    if (!s.title) errors.push(`${where}: a title`);
    else if (len(s.title) > LIMITS.sectionTitle) warnings.push(`${where}.title: ${len(s.title)} characters (under ${LIMITS.sectionTitle})`);
    if (!s.body && !s.bullets?.length) errors.push(`${where}: a body, bullets, or both`);
    if (len(s.body) > LIMITS.sectionBody) warnings.push(`${where}.body: ${len(s.body)} characters (under ${LIMITS.sectionBody})`);
    if ((s.bullets ?? []).length > LIMITS.bullets) warnings.push(`${where}.bullets: ${s.bullets.length} (at most ${LIMITS.bullets} read well)`);
    (s.bullets ?? []).forEach((b, j) => { if (len(b) > LIMITS.bullet) warnings.push(`${where}.bullets[${j}]: ${len(b)} characters (under ${LIMITS.bullet})`); });
  });

  if (data.image) {
    if (!https(data.image.url)) errors.push(`image.url: "${data.image.url ?? ''}" is not a public https URL (the changelog shows it by URL)`);
    if (!data.image.alt) errors.push('image.alt: say what the image shows');
    else if (len(data.image.alt) > LIMITS.alt) warnings.push(`image.alt: ${len(data.image.alt)} characters (under ${LIMITS.alt})`);
  }
  if (data.video && !https(data.video.url)) errors.push(`video.url: "${data.video.url ?? ''}" is not an https URL`);

  if (!data.cta) warnings.push('cta: none — say where to learn more (the feature page or help article)');
  else if (!data.cta.label || !https(data.cta.url)) errors.push('cta: a label and an https url');
  else if (len(data.cta.label) > LIMITS.ctaLabel) warnings.push(`cta.label: ${len(data.cta.label)} characters (under ${LIMITS.ctaLabel})`);

  const labels = data.labelIds ?? [];
  if (!Array.isArray(labels) || labels.some((l) => typeof l !== 'string' || !l)) errors.push('labelIds: a list of label ids (changelog-check lists them)');

  const p = data.publish ?? {};
  if (p.status && !['draft', 'published'].includes(p.status)) errors.push('publish.status: draft or published');
  if (p.notify !== undefined && typeof p.notify !== 'boolean') errors.push('publish.notify: true or false');
  if (p.entryId && !p.lastSaved) errors.push(`publish.lastSaved: an update needs the entry's lastSaved from changelog-find, so nobody's edit is overwritten`);
  if (p.lastSaved && Number.isNaN(toTime(p.lastSaved))) errors.push('publish.lastSaved: an ISO date as changelog-find prints it');

  const text = [data.summary, ...sections.flatMap((s) => [s.body, ...(s.bullets ?? [])])].join(' ');
  if (/\]\(|!\[|<[a-z]/i.test(text)) warnings.push('the text has Markdown or HTML of its own — write plain sentences; the pipeline adds the formatting');
  return { errors, warnings };
}

// ---- building ----

// The entry's details as Markdown, in the changelog's house style: the
// summary, the video embedded right under it (the changelog turns an image
// whose URL is a video into a player), the image, each section under a
// heading with its paragraph and bullets, then the call to action, its link
// tagged for attribution.
export function entryMarkdown(data, slug) {
  const out = [String(data.summary).trim()];
  if (data.video) out.push(`![](${data.video.url})`);
  if (data.image) out.push(`![${data.image.alt.replace(/[[\]]/g, '')}](${data.image.url})`);
  for (const s of data.sections ?? []) {
    const block = [`# ${s.title.trim()}`];
    if (s.body) block.push(s.body.trim());
    if (s.bullets?.length) block.push(s.bullets.map((b) => `- ${b.trim()}`).join('\n'));
    out.push(block.join('\n'));
  }
  if (data.cta) out.push(`[${data.cta.label.trim()}](${tagLink(data.cta.url, { source: 'changelog', medium: 'changelog', campaign: data.campaign ?? slug, content: 'cta' })})`);
  return `${out.join('\n\n')}\n`;
}

const VIDEO_RE = /youtu\.?be|vimeo\.com|loom\.com|wistia/i;

// Our own Markdown (the subset entryMarkdown writes) as HTML, for the preview.
export function markdownHtml(md) {
  const inline = (s) => e(s)
    .replace(/!\[([^\]]*)\]\((https:[^)\s]+)\)/g, (_, alt, url) => (VIDEO_RE.test(url)
      ? `<a class="video" href="${url}">&#9654; Video: ${url}</a>`
      : `<img src="${url}" alt="${alt}">`))
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return md.trim().split(/\n{2,}/).map((block) => {
    const html = [];
    let list = [];
    const flush = () => { if (list.length) html.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = []; };
    for (const line of block.split('\n')) {
      if (line.startsWith('- ')) { list.push(line.slice(2)); continue; }
      flush();
      if (line.startsWith('# ')) html.push(`<h2>${inline(line.slice(2))}</h2>`);
      else if (/^!\[/.test(line)) html.push(inline(line));
      else html.push(`<p>${inline(line)}</p>`);
    }
    flush();
    return html.join('');
  }).join('\n');
}

// Build output/<slug>/changelog/. Returns { dir, entry, markdown, blockers }.
export function buildChangelog({ slug, brand, log = console.log }) {
  const data = loadChangelog(slug);
  const { errors, warnings } = validateChangelog(slug, data);
  if (errors.length) throw new Error(`changelog.json:\n  ${errors.join('\n  ')}`);
  warnings.forEach((w) => log(`  warn   ${w}`));
  const dir = changelogDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const markdown = entryMarkdown(data, slug);
  const record = readChangelogRecord(slug);
  const entryId = data.publish?.entryId ?? record?.entryId ?? null;
  const blockers = [];
  if (entryId && !data.publish?.lastSaved && !record?.lastSaved) blockers.push(`entry ${entryId} was never read: changelog-find ${slug}, then set publish.lastSaved`);
  const entry = {
    title: data.title,
    types: data.types,
    labelIds: data.labelIds ?? [],
    action: entryId ? 'update' : 'create',
    entryId,
    status: data.publish?.status ?? 'draft',
    notify: data.publish?.notify === true,
    live: record ? { status: record.status, url: record.url, lastSaved: record.lastSaved } : null,
    markdownHash: crypto.createHash('sha256').update(markdown).digest('hex').slice(0, 12),
    blockers,
  };
  fs.writeFileSync(path.join(dir, 'entry.md'), markdown);
  writeJson(path.join(dir, 'entry.json'), entry);
  fs.writeFileSync(path.join(dir, 'preview.html'), previewPage({ slug, data, brand, markdown }));
  log(`  changelog  ${entry.action}${entryId ? ` ${entryId}` : ''} (${entry.status}${entry.notify ? ', notify' : ''}) -> ${path.relative(process.cwd(), dir).replace(/\\/g, '/')}/`);
  return { dir, entry, markdown, blockers };
}

function previewPage({ slug, data, brand, markdown }) {
  const badges = (data.types ?? []).map((t) => `<span class="badge ${t}">${e(t)}</span>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(slug)} — changelog</title><style>${brandCss(brand)}
body{margin:0;background:var(--surface);font-family:var(--font-body,Arial),Arial,sans-serif;color:var(--ink);padding:24px}
article{max-width:680px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
h1{font-size:24px;margin:8px 0 16px}h2{font-size:19px;margin:24px 0 6px}p,li{line-height:1.55}p{margin:0 0 10px}
.video{display:block;padding:40px 16px;margin:16px 0;border-radius:8px;background:#111;color:#fff;text-align:center;text-decoration:none;font-size:14px}img{max-width:100%;border-radius:8px;display:block;margin:16px 0}
a{color:var(--primary)}.badge{display:inline-block;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:999px;margin-right:6px;background:#eef;color:#335}
.badge.new{background:#e6f6ec;color:#1d6b3a}.badge.improved{background:#e8f0fe;color:#1a4fa0}.badge.fixed{background:#fdf0e6;color:#8a4a12}</style></head>
<body><article>${badges}<h1>${e(data.title)}</h1>${markdownHtml(markdown)}</article></body></html>`;
}

// ---- the changelog service ----

const ADAPTERS = {
  canny: () => import('./changelog/canny.mjs'),
};

export async function changelogService(brand) {
  const name = env('CHANGELOG') ?? brand?.changelog?.provider;
  if (!name) throw new Error('no changelog configured — set CHANGELOG in .env (canny) or changelog.provider in brand.json');
  if (!ADAPTERS[name]) throw new Error(`no changelog adapter "${name}" (${Object.keys(ADAPTERS).join(', ')})`);
  const apiKey = env('CHANGELOG_API_KEY');
  if (!apiKey) throw new Error('CHANGELOG_API_KEY is not set in .env (docs/changelog.md)');
  const adapter = await ADAPTERS[name]();
  return { name, ...adapter.connect({ apiKey, baseUrl: env('CHANGELOG_API_URL') }) };
}

// Entries that may already announce the feature: every word of a phrase in
// the title or text (case-insensitive), any of the phrases.
export function matchEntries(entries, phrases) {
  const words = phrases.map((p) => p.toLowerCase().split(/\s+/).filter((w) => w.length > 1));
  return entries.filter((x) => {
    const hay = `${x.title} ${x.text || x.markdown}`.toLowerCase();
    return words.some((ws) => ws.length && ws.every((w) => hay.includes(w)));
  });
}

// Send the built entry (output/<slug>/changelog/). Refuses, with the reason,
// when sending would lose someone's work, publish what was not approved, or
// email subscribers without approval:
// - an update when the entry was saved in the changelog since it was read;
// - any change to a published entry without live (it shows at once), and
//   "draft" for a published entry (that would unpublish it);
// - publishing without live;
// - notify set in changelog.json without notify passed, or the reverse.
export async function publishChangelog({ slug, brand, live = false, notify = false, log = console.log }) {
  const data = loadChangelog(slug);
  const built = buildChangelog({ slug, brand, log: () => {} });
  const record = readChangelogRecord(slug);
  const want = data.publish?.status ?? 'draft';
  const wantNotify = data.publish?.notify === true;
  if (wantNotify && !notify) throw new Error('changelog.json sets publish.notify: publishing emails the changelog\'s subscribers — pass --notify once that is approved');
  if (notify && !wantNotify) throw new Error('--notify was passed but changelog.json does not set publish.notify: true');
  if (want === 'published' && !live) throw new Error('publishing makes the entry public — pass --live once that is approved');
  const svc = await changelogService(brand);
  const fields = { title: data.title, details: built.markdown, types: data.types, labelIds: data.labelIds ?? [], notify: wantNotify };

  let id = built.entry.entryId;
  let action;
  if (id) {
    const current = await svc.get(id);
    const known = Math.max(toTime(data.publish?.lastSaved) || 0, toTime(record?.lastSaved) || 0);
    if (!known) throw new Error(`entry ${id} was never read: run changelog-find ${slug} and set publish.lastSaved in changelog.json`);
    if (toTime(current.lastSaved) > known) throw new Error(`entry ${id} was saved in the changelog since it was read (${current.lastSaved} > ${new Date(known).toISOString()}) — read it again with changelog-find and merge before sending`);
    if (current.status === 'published') {
      if (want === 'draft') throw new Error(`entry ${id} is published: sending it as a draft would unpublish it. Set publish.status published and pass --live, or leave it`);
      if (!live) throw new Error(`entry ${id} is published: the update shows at once — pass --live once that is approved`);
    }
    log(`  update ${id}${current.status === 'published' ? ' (live)' : ` (${current.status})`}`);
    await svc.update(id, fields);
    action = 'update';
    if (want === 'published' && current.status !== 'published') { log(`  publish ${id}`); await svc.changeStatus(id, 'published'); }
  } else {
    log('  create (draft)');
    ({ id } = await svc.create(fields));
    action = 'create';
    if (want === 'published') { log(`  publish ${id}`); await svc.changeStatus(id, 'published'); }
  }

  // read it back: its URL, status and the save time the next send compares against
  const after = await svc.get(id);
  const published = {
    $comment: 'Where the changelog entry lives: written by pipeline/changelog.mjs after each send. The next send updates this entry, and refuses if it was saved in the changelog after lastSaved.',
    provider: svc.name,
    entryId: after.id,
    url: after.url,
    status: after.status,
    types: after.types,
    labels: after.labels,
    lastSaved: after.lastSaved,
    publishedAt: after.publishedAt,
    action,
    markdownHash: built.entry.markdownHash,
    sentAt: new Date().toISOString(),
  };
  writeJson(changelogRecordFile(slug), published);
  return published;
}
