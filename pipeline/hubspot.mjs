// Outbound HubSpot: library/features/<slug>/hubspot.json + brand + the social
// pack -> output/<slug>/hubspot/ (docs/hubspot.md)
//
// The launch email and the social posts that announce a feature, sent from
// the brand's HubSpot account. hubspot.json is the rollout-hubspot-marketer
// agent's sidecar: the email's words (subject, preview text, headline, intro,
// up to three short sections, the call to action) and one post per network,
// each naming an image from the social pack. This checks it against each
// network's limits, tags every link for attribution, and builds:
//
//   email.json         the email's settings (name, subject, preview text,
//                      from name) and what blocks creating it
//   email.layout.json  the email's content as HubSpot's email editor takes it
//                      (sections > columns > modules), in the brand's colours
//   posts.json         each post: network, the final text with its tagged
//                      link, its image and, once uploaded, the image's file id
//   preview.html       the email and the posts as they will read
//
// Nothing here talks to HubSpot except hubspot-assets: images must be public
// for the email and in HubSpot's File Manager for social posts, so
// `rollout.mjs hubspot-assets <slug> --yes` uploads them over the Files API
// (HUBSPOT_TOKEN) and records each file's id and URL by content hash in
// hubspot.published.json. Creating the email and the posts — always as drafts —
// is the agent's, through HubSpot's own tools, on the user's approval;
// hubspot-record writes their ids beside the files.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env, escapeHtml as e, featurePaths, readJson, writeJson } from './env.mjs';
import { brandCss } from './brand.mjs';
import { socialDir } from './social.mjs';

export const hubspotFile = (slug) => path.join(featurePaths(slug).library, 'hubspot.json');
export const hubspotDir = (slug) => path.join(featurePaths(slug).output, 'hubspot');
export const recordFile = (slug) => path.join(featurePaths(slug).library, 'hubspot.published.json');
export const readRecord = (slug) => (fs.existsSync(recordFile(slug)) ? readJson(recordFile(slug)) : {});
export const loadHubspot = (slug) => (fs.existsSync(hubspotFile(slug)) ? readJson(hubspotFile(slug)) : null);

// Lengths: errors past the hard limit, warnings past what reads well.
export const EMAIL_LIMITS = {
  name: [3, 120],
  subject: { warn: 60, max: 150 },
  previewText: { min: 40, warn: 110, max: 200 },
  headline: 80,
  intro: 400,
  sections: 3,
  sectionTitle: 60,
  sectionBody: 300,
  ctaLabel: 25,
  alt: 140,
};

// Each network HubSpot can post to with an image: its text limit, whether a
// link in the text is clickable, whether an image is required. X counts every
// link as 23 characters.
export const NETWORKS = {
  LINKEDIN: { label: 'LinkedIn', max: 3000, links: true, imageRequired: false, hashtags: 5 },
  FACEBOOK: { label: 'Facebook', max: 5000, links: true, imageRequired: false, hashtags: 3 },
  TWITTER: { label: 'X', max: 280, links: true, imageRequired: false, hashtags: 2, linkLength: 23 },
  INSTAGRAM: { label: 'Instagram', max: 2200, links: false, imageRequired: true, hashtags: 10 },
};

const URL_RE = /https?:\/\/[^\s)]+/g;

// The link with utm_ parameters for attribution, unless it has its own.
export function tagLink(url, { source = 'hubspot', medium, campaign, content } = {}) {
  let u;
  try { u = new URL(url); } catch { return url; }
  if ([...u.searchParams.keys()].some((k) => k.startsWith('utm_'))) return url;
  u.searchParams.set('utm_source', source);
  if (medium) u.searchParams.set('utm_medium', medium);
  if (campaign) u.searchParams.set('utm_campaign', campaign);
  if (content) u.searchParams.set('utm_content', content);
  return u.href;
}

// A post's length as the network counts it.
export function postLength(text, network) {
  const n = NETWORKS[network];
  if (!n?.linkLength) return [...text].length;
  return [...text.replace(URL_RE, 'x'.repeat(n.linkLength))].length;
}

// The post's final text: its words, then its tagged link on a line of its own
// (Instagram gets none: its captions cannot link).
export function postText(post, slug, campaign) {
  const n = NETWORKS[post.network];
  const words = String(post.content ?? '').trim();
  if (!post.link || !n?.links) return words;
  const link = tagLink(post.link, { medium: 'social', campaign: campaign ?? slug, content: post.network.toLowerCase() });
  return words.includes(post.link) ? words.split(post.link).join(link) : `${words}\n\n${link}`;
}

// The image a post or the email names: a file of the social pack.
const imagePath = (slug, file) => (file ? path.join(socialDir(slug), file) : null);
const hashOf = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

// errors block the build; warnings are for the agent to judge.
export function validateHubspot(slug, data = loadHubspot(slug)) {
  const errors = [];
  const warnings = [];
  if (!data) return { errors: [`no ${path.relative(process.cwd(), hubspotFile(slug))} — the hubspot marketer writes it`], warnings };
  const len = (s) => [...String(s ?? '')].length;
  const absolute = (u) => /^https:\/\//.test(String(u ?? ''));
  const image = (file, where, required) => {
    if (!file) { if (required) errors.push(`${where}: no image`); return; }
    if (!fs.existsSync(imagePath(slug, file))) errors.push(`${where}: image ${file} is not in the social pack (build ${slug} first; files in output/${slug}/assets/social/)`);
  };

  const m = data.email;
  if (m) {
    if (len(m.name) < EMAIL_LIMITS.name[0] || len(m.name) > EMAIL_LIMITS.name[1]) errors.push(`email.name: ${EMAIL_LIMITS.name[0]}–${EMAIL_LIMITS.name[1]} characters (it is the email's name inside HubSpot)`);
    if (!m.subject) errors.push('email.subject: missing');
    else if (len(m.subject) > EMAIL_LIMITS.subject.max) errors.push(`email.subject: ${len(m.subject)} characters (at most ${EMAIL_LIMITS.subject.max})`);
    else if (len(m.subject) > EMAIL_LIMITS.subject.warn) warnings.push(`email.subject: ${len(m.subject)} characters — inboxes cut it after about ${EMAIL_LIMITS.subject.warn}`);
    if (!m.previewText) warnings.push('email.previewText: missing — the inbox shows the first words of the body instead');
    else if (len(m.previewText) > EMAIL_LIMITS.previewText.max) errors.push(`email.previewText: ${len(m.previewText)} characters (at most ${EMAIL_LIMITS.previewText.max})`);
    else if (len(m.previewText) < EMAIL_LIMITS.previewText.min || len(m.previewText) > EMAIL_LIMITS.previewText.warn) warnings.push(`email.previewText: ${len(m.previewText)} characters — ${EMAIL_LIMITS.previewText.min}–${EMAIL_LIMITS.previewText.warn} reads in full`);
    if (m.previewText && m.subject && m.previewText.trim().toLowerCase() === m.subject.trim().toLowerCase()) warnings.push('email.previewText repeats the subject — say the next thing');
    if (!m.headline) errors.push('email.headline: missing');
    else if (len(m.headline) > EMAIL_LIMITS.headline) warnings.push(`email.headline: ${len(m.headline)} characters (keep it under ${EMAIL_LIMITS.headline})`);
    if (!m.intro) errors.push('email.intro: missing');
    else if (len(m.intro) > EMAIL_LIMITS.intro) warnings.push(`email.intro: ${len(m.intro)} characters (keep it under ${EMAIL_LIMITS.intro})`);
    const sections = m.sections ?? [];
    if (sections.length > EMAIL_LIMITS.sections) errors.push(`email.sections: ${sections.length} (at most ${EMAIL_LIMITS.sections} — the page tells the rest)`);
    sections.forEach((s, i) => {
      if (!s.title || !s.body) errors.push(`email.sections[${i}]: a title and a body`);
      if (len(s.title) > EMAIL_LIMITS.sectionTitle) warnings.push(`email.sections[${i}].title: ${len(s.title)} characters (under ${EMAIL_LIMITS.sectionTitle})`);
      if (len(s.body) > EMAIL_LIMITS.sectionBody) warnings.push(`email.sections[${i}].body: ${len(s.body)} characters (under ${EMAIL_LIMITS.sectionBody})`);
    });
    if (!m.cta?.label || !m.cta?.url) errors.push('email.cta: a label and a url');
    else {
      if (!absolute(m.cta.url)) errors.push(`email.cta.url: "${m.cta.url}" is not an https URL`);
      if (len(m.cta.label) > EMAIL_LIMITS.ctaLabel) warnings.push(`email.cta.label: ${len(m.cta.label)} characters (a button reads best under ${EMAIL_LIMITS.ctaLabel})`);
    }
    image(m.image, 'email.image', true);
    if (m.image && !m.imageAlt) errors.push('email.imageAlt: say what the image shows (it is all some readers get)');
    else if (len(m.imageAlt) > EMAIL_LIMITS.alt) warnings.push(`email.imageAlt: ${len(m.imageAlt)} characters (under ${EMAIL_LIMITS.alt})`);
  }

  const posts = data.social ?? [];
  if (!m && !posts.length) errors.push('nothing to make: give an email, social posts, or both');
  const seen = new Set();
  posts.forEach((p, i) => {
    const where = `social[${i}]${p.network ? ` (${p.network})` : ''}`;
    const n = NETWORKS[p.network];
    if (!n) { errors.push(`${where}: network must be one of ${Object.keys(NETWORKS).join(', ')}`); return; }
    if (seen.has(p.network)) warnings.push(`${where}: a second ${n.label} post — one per network reads as a launch, more as noise`);
    seen.add(p.network);
    if (!p.content) { errors.push(`${where}: no content`); return; }
    const text = postText(p, slug, data.campaign);
    const length = postLength(text, p.network);
    if (length > n.max) errors.push(`${where}: ${length} characters with its link (${n.label} allows ${n.max})`);
    image(p.image, `${where}.image`, n.imageRequired);
    if (p.link && !absolute(p.link)) errors.push(`${where}.link: "${p.link}" is not an https URL`);
    if (!n.links && (URL_RE.test(p.content) || p.link)) warnings.push(`${where}: ${n.label} captions do not link — point to "the link in bio" in the words`);
    URL_RE.lastIndex = 0;
    if (n.links && !p.link && !URL_RE.test(p.content)) warnings.push(`${where}: no link — say where to learn more`);
    URL_RE.lastIndex = 0;
    const tags = (p.content.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).length;
    if (tags > n.hashtags) warnings.push(`${where}: ${tags} hashtags (${n.label} reads best with ${n.hashtags} or fewer)`);
  });
  return { errors, warnings };
}

// ---- building ----

// The email's content as HubSpot's email editor takes it: one column of
// modules — the image, the headline, the intro, each section, the button, the
// footer with the unsubscribe links. Images are public URLs (uploaded) or
// null until hubspot-assets has run.
export function emailLayout(data, brand, { slug, imageUrl = null } = {}) {
  const m = data.email;
  const c = brand.colors;
  const font = brand.fonts?.body?.family ?? 'Arial';
  const text = (html) => ({ _type: 'EmailTextModule', html });
  const p = (s, extra = '') => `<p style="font-family:${font};font-size:16px;line-height:1.5;color:${c.ink};${extra}">${e(s)}</p>`;
  const modules = [
    ...(m.image ? [{ _type: 'EmailImageModule', src: imageUrl, alt: m.imageAlt, alignment: 'CENTER', width: 600, link: tagLink(m.cta.url, { medium: 'email', campaign: data.campaign ?? slug, content: 'image' }), modulePadding: { paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px' } }] : []),
    text(`<h1 style="font-family:${font};font-size:28px;line-height:1.25;color:${c.ink};margin:0">${e(m.headline)}</h1>`),
    text(p(m.intro)),
    ...(m.sections ?? []).map((s) => text(`<h3 style="font-family:${font};font-size:18px;color:${c.ink};margin:0 0 4px">${e(s.title)}</h3>${p(s.body, 'margin:0')}`)),
    {
      _type: 'EmailButtonModule',
      text: m.cta.label,
      alignment: 'LEFT',
      backgroundColor: c.cta ?? c.primary,
      cornerRadius: 8,
      fontStyle: { color: '#ffffff', bold: true, fontFamily: font, fontSize: 16 },
      linkTarget: { _type: 'UrlButtonLink', destination: tagLink(m.cta.url, { medium: 'email', campaign: data.campaign ?? slug, content: 'button' }) },
    },
    ...(m.ps ? [text(p(`P.S. ${m.ps}`, `color:${c.muted};font-size:14px`))] : []),
    { _type: 'EmailFooterModule', alignment: 'CENTER' },
  ];
  return {
    contentWidth: 600,
    backgroundColor: c.surface ?? '#f4f4f4',
    bodyColor: '#ffffff',
    previewText: m.previewText,
    baseFontStyle: { fontFamily: font, fontSize: 16, color: c.ink },
    baseLinkFontStyle: { color: c.primary, underline: true },
    sections: [{ columns: [{ width: 12, modules }] }],
  };
}

// Build output/<slug>/hubspot/. Returns { dir, email, posts, blockers }.
export function buildHubspot({ slug, brand, log = console.log }) {
  const data = loadHubspot(slug);
  const { errors, warnings } = validateHubspot(slug, data);
  if (errors.length) throw new Error(`hubspot.json:\n  ${errors.join('\n  ')}`);
  warnings.forEach((w) => log(`  warn   ${w}`));
  const dir = hubspotDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const assets = readRecord(slug).assets ?? {};
  const uploaded = (file) => (file && fs.existsSync(imagePath(slug, file)) ? assets[hashOf(imagePath(slug, file))] ?? null : null);
  const blockers = [];

  let email = null;
  if (data.email) {
    const img = uploaded(data.email.image);
    if (data.email.image && !img) blockers.push(`email image ${data.email.image} is not in HubSpot yet (hubspot-assets ${slug} --yes)`);
    email = {
      name: data.email.name,
      subject: data.email.subject,
      previewText: data.email.previewText ?? null,
      fromName: data.email.fromName ?? null,
      image: data.email.image ? { file: data.email.image, fileId: img?.id ?? null, url: img?.url ?? null } : null,
      created: readRecord(slug).email ?? null,
    };
    writeJson(path.join(dir, 'email.json'), { ...email, blockers: blockers.filter((b) => b.startsWith('email')) });
    writeJson(path.join(dir, 'email.layout.json'), emailLayout(data, brand, { slug, imageUrl: img?.url ?? null }));
  }

  const posts = (data.social ?? []).map((p) => {
    const img = uploaded(p.image);
    if (p.image && !img) blockers.push(`${p.network} image ${p.image} is not in HubSpot yet (hubspot-assets ${slug} --yes)`);
    return {
      network: p.network,
      content: postText(p, slug, data.campaign),
      length: postLength(postText(p, slug, data.campaign), p.network),
      limit: NETWORKS[p.network].max,
      image: p.image ? { file: p.image, fileId: img?.id ?? null, url: img?.url ?? null } : null,
      created: readRecord(slug).posts?.[p.network] ?? null,
    };
  });
  writeJson(path.join(dir, 'posts.json'), posts);
  fs.writeFileSync(path.join(dir, 'preview.html'), previewPage({ slug, data, brand, posts }));
  log(`  hubspot  ${email ? 'email' : 'no email'}, ${posts.length} post${posts.length === 1 ? '' : 's'} -> ${path.relative(process.cwd(), dir)}/${blockers.length ? `  (${blockers.length} to upload before creating)` : ''}`);
  return { dir, email, posts, blockers };
}

// The email and the posts as they will read, with the local images.
function previewPage({ slug, data, brand, posts }) {
  const img = (file) => (file ? `<img src="${path.relative(hubspotDir(slug), imagePath(slug, file)).replace(/\\/g, '/')}" alt="">` : '');
  const m = data.email;
  const email = m
    ? `<section class="email"><p class="meta"><b>${e(m.subject)}</b><br>${e(m.previewText ?? '')}</p>
<div class="mail">${img(m.image)}<h1>${e(m.headline)}</h1><p>${e(m.intro)}</p>${(m.sections ?? []).map((s) => `<h3>${e(s.title)}</h3><p>${e(s.body)}</p>`).join('')}
<a class="btn" href="${e(m.cta.url)}">${e(m.cta.label)}</a>${m.ps ? `<p class="ps">P.S. ${e(m.ps)}</p>` : ''}</div></section>`
    : '';
  const social = posts
    .map((p) => `<section class="post"><p class="meta"><b>${e(NETWORKS[p.network].label)}</b> · ${p.length}/${p.limit}</p><div class="card"><p>${e(p.content).replace(/\n/g, '<br>')}</p>${img(p.image?.file)}</div></section>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${e(slug)} — HubSpot</title><style>${brandCss(brand)}
body{margin:0;background:var(--surface);font-family:var(--font-body,Arial),Arial,sans-serif;color:var(--ink);padding:24px}
section{max-width:640px;margin:0 auto 32px}.meta{color:var(--muted);font-size:14px}
.mail,.card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
.mail img,.card img{width:100%;border-radius:8px;display:block;margin:12px 0}
.btn{display:inline-block;background:var(--cta);color:#fff;font-weight:700;padding:12px 20px;border-radius:8px;text-decoration:none}
.ps{color:var(--muted);font-size:14px}</style></head><body>${email}${social}</body></html>`;
}

// ---- HubSpot: files and the account ----

const API = () => (env('HUBSPOT_API_URL') ?? 'https://api.hubapi.com').replace(/\/$/, '');

async function call(method, route, { body, form } = {}) {
  const token = env('HUBSPOT_TOKEN');
  if (!token) throw new Error('HUBSPOT_TOKEN is not set in .env (a private app token with the files scope; docs/hubspot.md)');
  const res = await fetch(`${API()}${route}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`hubspot ${method} ${route} -> ${res.status} ${json.message ?? text.slice(0, 200)}`);
  return json;
}

// The account the token reaches: { portalId, uiDomain, timeZone }.
export async function hubspotAccount() {
  const a = await call('GET', '/account-info/v3/details');
  return { portalId: a.portalId, uiDomain: a.uiDomain ?? null, timeZone: a.timeZone ?? null };
}

// Upload the images the email and the posts name to the File Manager (public,
// not indexed), each once: a file already uploaded (same content) is kept.
// Records { hash: { id, url, file } } in hubspot.published.json.
export async function uploadHubspotAssets({ slug, log = console.log }) {
  const data = loadHubspot(slug);
  const { errors } = validateHubspot(slug, data);
  if (errors.length) throw new Error(`hubspot.json:\n  ${errors.join('\n  ')}`);
  const files = [...new Set([data.email?.image, ...(data.social ?? []).map((p) => p.image)].filter(Boolean))];
  const record = readRecord(slug);
  record.assets ??= {};
  const folder = (env('HUBSPOT_FILES_FOLDER') ?? '/rollout/{slug}').replace('{slug}', slug);
  for (const file of files) {
    const full = imagePath(slug, file);
    const hash = hashOf(full);
    if (record.assets[hash]) { log(`  keep    ${file}  (file ${record.assets[hash].id})`); continue; }
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(full)], { type: 'image/png' }), `${path.basename(file, path.extname(file))}.${hash}${path.extname(file)}`);
    form.append('folderPath', folder);
    form.append('options', JSON.stringify({ access: 'PUBLIC_NOT_INDEXABLE', overwrite: false, duplicateValidationStrategy: 'NONE' }));
    const r = await call('POST', '/files/v3/files', { form });
    record.assets[hash] = { id: String(r.id), url: r.url, file };
    log(`  upload  ${file}  -> file ${r.id}`);
    writeJson(recordFile(slug), record);
  }
  writeJson(recordFile(slug), record);
  return record.assets;
}

// After the agent creates them in HubSpot: the email's id and each post's id.
export function recordCreated(slug, { email = null, posts = {} } = {}) {
  const record = readRecord(slug);
  const at = new Date().toISOString();
  if (email) record.email = { id: String(email), createdAt: at };
  for (const [network, guid] of Object.entries(posts)) {
    if (!NETWORKS[network]) throw new Error(`no network ${network} — ${Object.keys(NETWORKS).join(', ')}`);
    record.posts = { ...(record.posts ?? {}), [network]: { id: String(guid), createdAt: at } };
  }
  writeJson(recordFile(slug), record);
  return record;
}
