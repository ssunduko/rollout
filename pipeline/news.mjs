// In-app product news: library/features/<slug>/news.json + brand ->
// output/<slug>/news/, and the news item in the messenger's newsfeeds
// (docs/news.md).
//
// news.json is the rollout-news-writer agent's sidecar: the item's title, a
// summary, a few short sections, a cover image and an inline image by URL,
// the video's link, the call to action, its labels, newsfeeds and reactions,
// and how to send it. This checks it, writes the item's HTML body, and builds:
//
//   item.html     the body, as the news service takes it (also pastes into an
//                 in-app post, which no API creates)
//   item.json     title, labels, newsfeeds, create or update, what blocks sending
//   preview.html  the item as it will read
//
// Which service is a deployment fact: NEWS in .env, else the brand's
// news.provider. Each provider is an adapter in news/ with the same calls:
//
//   all({ max })          every item, newest first
//   get(id)               one item
//   create(fields)        a new item (a draft unless state says live)
//   update(id, fields)    an item; lists (labels, newsfeeds, reactions) sent whole
//   newsfeeds()           [{ id, name }]
//   senders()             [{ id, name }] — teammates who can send an item
//
// An item: { id, title, body, text, state, senderId, labels, newsfeedIds,
// coverImageUrl, reactions, silent, publishedAt, updatedAt (seconds), url }.
//
// publishNews sends it, only on the user's approval: a draft unless live;
// with a notification badge only with notify. The record
// (news.published.json) keeps the item's id, so the next send updates it.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env, escapeHtml as e, featurePaths, readJson, writeJson } from './env.mjs';
import { brandCss } from './brand.mjs';
import { tagLink } from './hubspot.mjs';

export const newsFile = (slug) => path.join(featurePaths(slug).library, 'news.json');
export const newsDir = (slug) => path.join(featurePaths(slug).output, 'news');
export const newsLiveDir = (slug) => path.join(featurePaths(slug).output, 'news-live');
export const newsRecordFile = (slug) => path.join(featurePaths(slug).library, 'news.published.json');
export const readNewsRecord = (slug) => (fs.existsSync(newsRecordFile(slug)) ? readJson(newsRecordFile(slug)) : null);
export const loadNews = (slug) => (fs.existsSync(newsFile(slug)) ? readJson(newsFile(slug)) : null);

// Lengths: errors past the hard limit, warnings past what reads well.
export const LIMITS = {
  title: { warn: 70, max: 150 },
  summary: { warn: 300, max: 600 },
  sections: 4,
  sectionTitle: 60,
  sectionBody: 300,
  bullets: 6,
  bullet: 140,
  ctaLabel: 30,
  alt: 140,
  reactions: 5,
  labels: 5,
};

const len = (s) => [...String(s ?? '')].length;
const https = (u) => /^https:\/\/\S+$/.test(String(u ?? ''));
// one Unicode code point, no skin tone, joiner or variation selector (the API rejects those)
const singleEmoji = (r) => [...String(r)].length === 1 && /\p{Extended_Pictographic}/u.test(r);

// The teammate the item is sent from: news.json, else NEWS_SENDER_ID, else
// the help center's author.
export const senderOf = (data) => data?.publish?.senderId ?? env('NEWS_SENDER_ID') ?? env('HELP_AUTHOR_ID') ?? null;
// The newsfeeds: news.json, else NEWS_NEWSFEED_IDS (comma-separated).
export const newsfeedsOf = (data) => (data?.newsfeedIds?.length ? data.newsfeedIds : String(env('NEWS_NEWSFEED_IDS') ?? '').split(',').map((s) => s.trim()).filter(Boolean));

// errors block the build; warnings are for the agent to judge.
export function validateNews(slug, data = loadNews(slug)) {
  const errors = [];
  const warnings = [];
  if (!data) return { errors: [`no ${path.relative(process.cwd(), newsFile(slug))} — the news writer writes it`], warnings };

  if (!data.title) errors.push('title: missing');
  else if (len(data.title) > LIMITS.title.max) errors.push(`title: ${len(data.title)} characters (at most ${LIMITS.title.max})`);
  else if (len(data.title) > LIMITS.title.warn) warnings.push(`title: ${len(data.title)} characters — the newsfeed reads best under ${LIMITS.title.warn}`);

  if (!data.summary) errors.push('summary: missing (the first thing readers see)');
  else if (len(data.summary) > LIMITS.summary.max) errors.push(`summary: ${len(data.summary)} characters (at most ${LIMITS.summary.max})`);
  else if (len(data.summary) > LIMITS.summary.warn) warnings.push(`summary: ${len(data.summary)} characters (keep it under ${LIMITS.summary.warn}: the messenger is narrow)`);

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

  if (data.coverImage !== undefined) {
    if (!https(data.coverImage)) errors.push(`coverImage: "${data.coverImage}" is not a public https URL`);
    else if (!/\.(png|jpg)/.test(data.coverImage)) errors.push('coverImage: the URL must end in lower-case .png or .jpg (the news API rejects .jpeg, .PNG and other types)');
  }
  if (data.image) {
    if (!https(data.image.url)) errors.push(`image.url: "${data.image.url ?? ''}" is not a public https URL`);
    if (!data.image.alt) errors.push('image.alt: say what the image shows');
    else if (len(data.image.alt) > LIMITS.alt) warnings.push(`image.alt: ${len(data.image.alt)} characters (under ${LIMITS.alt})`);
  }
  if (data.video && !https(data.video.url)) errors.push(`video.url: "${data.video.url ?? ''}" is not an https URL`);

  if (!data.cta) warnings.push('cta: none — say where to learn more (the feature page or help article)');
  else if (!data.cta.label || !https(data.cta.url)) errors.push('cta: a label and an https url');
  else if (len(data.cta.label) > LIMITS.ctaLabel) warnings.push(`cta.label: ${len(data.cta.label)} characters (under ${LIMITS.ctaLabel})`);

  const labels = data.labels ?? [];
  if (!Array.isArray(labels) || labels.some((l) => typeof l !== 'string' || !l.trim())) errors.push('labels: a list of label names');
  else if (labels.length > LIMITS.labels) warnings.push(`labels: ${labels.length} (${LIMITS.labels} or fewer read as a category)`);
  const feeds = data.newsfeedIds ?? [];
  if (!Array.isArray(feeds) || feeds.some((f) => !/^\d+$/.test(String(f)))) errors.push('newsfeedIds: a list of newsfeed ids (news-check lists them)');
  const reactions = data.reactions ?? [];
  if (!Array.isArray(reactions)) errors.push('reactions: a list of emoji ([] for none)');
  else {
    if (reactions.length > LIMITS.reactions) errors.push(`reactions: ${reactions.length} (at most ${LIMITS.reactions})`);
    reactions.filter((r) => !singleEmoji(r)).forEach((r) => errors.push(`reactions: "${r}" must be one emoji code point (no skin tone, joiner or variation selector)`));
  }

  const p = data.publish ?? {};
  if (p.state && !['draft', 'live'].includes(p.state)) errors.push('publish.state: draft or live');
  if (p.notify !== undefined && typeof p.notify !== 'boolean') errors.push('publish.notify: true or false');
  if (p.itemId && p.updatedAt == null) errors.push('publish.updatedAt: an update needs the item\'s updatedAt from news-find, so nobody\'s edit is overwritten');
  if (p.updatedAt != null && !Number.isFinite(Number(p.updatedAt))) errors.push('publish.updatedAt: the number news-find prints');
  if (p.state === 'live' && !newsfeedsOf(data).length) errors.push('newsfeedIds: a live item needs at least one newsfeed (news-check lists them), or NEWS_NEWSFEED_IDS');

  const text = [data.summary, ...sections.flatMap((s) => [s.body, ...(s.bullets ?? [])])].join(' ');
  if (/\]\(|<[a-z]/i.test(text)) warnings.push('the text has Markdown or HTML of its own — write plain sentences; the pipeline adds the formatting');
  return { errors, warnings };
}

// ---- building ----

// The item's body as HTML: the summary, the image, each section (a heading,
// its paragraph and bullets), the video's link, then the call to action, its
// link tagged for attribution.
export function itemHtml(data, slug) {
  const link = (url, label) => `<a href="${e(url)}" target="_blank">${e(label)}</a>`;
  const out = [`<p>${e(String(data.summary).trim())}</p>`];
  if (data.image) out.push(`<img src="${e(data.image.url)}" alt="${e(data.image.alt)}">`);
  for (const s of data.sections ?? []) {
    out.push(`<h2>${e(s.title.trim())}</h2>`);
    if (s.body) out.push(`<p>${e(s.body.trim())}</p>`);
    if (s.bullets?.length) out.push(`<ul>${s.bullets.map((b) => `<li>${e(b.trim())}</li>`).join('')}</ul>`);
  }
  if (data.video) out.push(`<p>${link(data.video.url, data.video.label ?? 'Watch the video')}</p>`);
  if (data.cta) out.push(`<p><b>${link(tagLink(data.cta.url, { source: 'intercom', medium: 'news', campaign: data.campaign ?? slug, content: 'cta' }), data.cta.label.trim())}</b></p>`);
  return `${out.join('\n')}\n`;
}

// Build output/<slug>/news/. Returns { dir, item, html, blockers }.
export function buildNews({ slug, brand, log = console.log }) {
  const data = loadNews(slug);
  const { errors, warnings } = validateNews(slug, data);
  if (errors.length) throw new Error(`news.json:\n  ${errors.join('\n  ')}`);
  warnings.forEach((w) => log(`  warn   ${w}`));
  const dir = newsDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const html = itemHtml(data, slug);
  const record = readNewsRecord(slug);
  const itemId = data.publish?.itemId ?? record?.itemId ?? null;
  const blockers = [];
  if (!senderOf(data)) blockers.push('no sender: set NEWS_SENDER_ID in .env or publish.senderId in news.json (news-check lists teammates)');
  if (!newsfeedsOf(data).length) blockers.push('no newsfeed: the item would show in none — set newsfeedIds (news-check lists them) or NEWS_NEWSFEED_IDS');
  const item = {
    title: data.title,
    labels: data.labels ?? [],
    newsfeedIds: newsfeedsOf(data),
    reactions: data.reactions ?? [],
    coverImage: data.coverImage ?? null,
    senderId: senderOf(data),
    action: itemId ? 'update' : 'create',
    itemId,
    state: data.publish?.state ?? 'draft',
    notify: data.publish?.notify === true,
    live: record ? { state: record.state, updatedAt: record.updatedAt } : null,
    htmlHash: crypto.createHash('sha256').update(html).digest('hex').slice(0, 12),
    blockers,
  };
  fs.writeFileSync(path.join(dir, 'item.html'), html);
  writeJson(path.join(dir, 'item.json'), item);
  fs.writeFileSync(path.join(dir, 'preview.html'), previewPage({ slug, data, brand, html }));
  log(`  news  ${item.action}${itemId ? ` ${itemId}` : ''} (${item.state}${item.notify ? ', notify' : ', silent'}) -> ${path.relative(process.cwd(), dir).replace(/\\/g, '/')}/`);
  return { dir, item, html, blockers };
}

function previewPage({ slug, data, brand, html }) {
  const labels = (data.labels ?? []).map((l) => `<span class="label">${e(l)}</span>`).join('');
  const cover = data.coverImage ? `<img class="cover" src="${e(data.coverImage)}" alt="">` : '';
  const reactions = (data.reactions ?? []).length ? `<p class="reactions">${data.reactions.map(e).join(' ')}</p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(slug)} — news</title><style>${brandCss(brand)}
body{margin:0;background:var(--surface);font-family:var(--font-body,Arial),Arial,sans-serif;color:var(--ink);padding:24px}
article{max-width:376px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}
.in{padding:20px}.cover{width:100%;display:block}h1{font-size:20px;margin:8px 0 12px}h2{font-size:16px;margin:18px 0 6px}
p,li{font-size:14px;line-height:1.5}img{max-width:100%;border-radius:8px}a{color:var(--primary)}
.label{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:#eef;color:#335;margin-right:4px}
.reactions{font-size:20px;text-align:center;border-top:1px solid #eee;padding-top:12px}</style></head>
<body><article>${cover}<div class="in">${labels}<h1>${e(data.title)}</h1>${html}${reactions}</div></article></body></html>`;
}

// ---- the news service ----

const ADAPTERS = {
  intercom: () => import('./news/intercom.mjs'),
};

export async function newsService(brand) {
  const name = env('NEWS') ?? brand?.news?.provider;
  if (!name) throw new Error('no news service configured — set NEWS in .env (intercom) or news.provider in brand.json');
  if (!ADAPTERS[name]) throw new Error(`no news adapter "${name}" (${Object.keys(ADAPTERS).join(', ')})`);
  const token = env('NEWS_TOKEN') ?? env('HELP_CENTER_TOKEN');
  if (!token) throw new Error('NEWS_TOKEN is not set in .env (or HELP_CENTER_TOKEN, when the help center is the same workspace; docs/news.md)');
  const adapter = await ADAPTERS[name]();
  return { name, ...adapter.connect({ token, baseUrl: env('NEWS_API_URL') ?? env('HELP_CENTER_API_URL'), version: env('NEWS_API_VERSION') ?? env('HELP_CENTER_API_VERSION') }) };
}

// Items that may already announce the feature: every word of a phrase in the
// title or text (case-insensitive), any of the phrases.
export function matchItems(items, phrases) {
  const words = phrases.map((p) => p.toLowerCase().split(/\s+/).filter((w) => w.length > 1));
  return items.filter((x) => {
    const hay = `${x.title} ${x.text}`.toLowerCase();
    return words.some((ws) => ws.length && ws.every((w) => hay.includes(w)));
  });
}

// Send the built item (output/<slug>/news/). Refuses, with the reason, when
// sending would lose someone's work, show users what was not approved, or
// notify them without approval:
// - an update when the item changed in the news service since it was read;
// - any change to a live item without live (it shows at once), and "draft"
//   for a live item (that would take it down);
// - setting it live without live;
// - notify set in news.json without notify passed, or the reverse;
// - no sender, or (going live) no newsfeed.
export async function publishNews({ slug, brand, live = false, notify = false, log = console.log }) {
  const data = loadNews(slug);
  const built = buildNews({ slug, brand, log: () => {} });
  const record = readNewsRecord(slug);
  const want = data.publish?.state ?? 'draft';
  const wantNotify = data.publish?.notify === true;
  if (wantNotify && !notify) throw new Error('news.json sets publish.notify: the item shows a notification badge in the messenger — pass --notify once that is approved');
  if (notify && !wantNotify) throw new Error('--notify was passed but news.json does not set publish.notify: true');
  if (want === 'live' && !live) throw new Error('setting the item live shows it to users — pass --live once that is approved');
  if (!built.item.senderId) throw new Error(built.blockers[0]);
  if (want === 'live' && !built.item.newsfeedIds.length) throw new Error('a live item needs a newsfeed: set newsfeedIds or NEWS_NEWSFEED_IDS');
  const svc = await newsService(brand);
  const fields = {
    title: data.title,
    body: built.html,
    senderId: built.item.senderId,
    silent: !wantNotify,
    labels: built.item.labels,
    newsfeedIds: built.item.newsfeedIds,
    coverImageUrl: data.coverImage,
    reactions: built.item.reactions,
  };

  let id = built.item.itemId;
  let action;
  if (id) {
    const current = await svc.get(id);
    const known = Math.max(Number(data.publish?.updatedAt ?? 0), Number(record?.updatedAt ?? 0));
    if (!known) throw new Error(`item ${id} was never read: run news-find ${slug} and set publish.updatedAt in news.json`);
    if (Number(current.updatedAt) > known) throw new Error(`item ${id} was changed in the news service since it was read (${current.updatedAt} > ${known}) — read it again with news-find and merge before sending`);
    if (current.state === 'live') {
      if (want === 'draft') throw new Error(`item ${id} is live: sending it as a draft would take it down. Set publish.state live and pass --live, or leave it`);
      if (!live) throw new Error(`item ${id} is live: the update shows at once — pass --live once that is approved`);
    }
    log(`  update ${id} (${current.state === 'live' ? 'live' : `${current.state} -> ${want}`})`);
    await svc.update(id, { ...fields, state: want });
    action = 'update';
  } else {
    log(`  create (${want})`);
    ({ id } = await svc.create({ ...fields, state: want }));
    action = 'create';
  }

  const after = await svc.get(id);
  const published = {
    $comment: 'Where the news item lives: written by pipeline/news.mjs after each send. The next send updates this item, and refuses if it changed in the news service after updatedAt.',
    provider: svc.name,
    itemId: after.id,
    state: after.state,
    newsfeedIds: after.newsfeedIds,
    labels: after.labels,
    silent: after.silent,
    updatedAt: after.updatedAt,
    publishedAt: after.publishedAt,
    action,
    htmlHash: built.item.htmlHash,
    sentAt: new Date().toISOString(),
  };
  writeJson(newsRecordFile(slug), published);
  return published;
}
