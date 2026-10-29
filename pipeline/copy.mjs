// Copy pack: brief + brand + library/features/<slug>/copy.json -> output/<slug>/copy/
//
// The written launch copy that goes beside the one-pager, in the order a
// rollout is prepared:
//
//   1 subfeature descriptions   title, short (1 sentence), long (the section body)   from the brief
//   2 rollout page header       headline, SEO URL, subheadline, meta description     from the brief
//   3 one-pager intro                                                                from the brief
//   4 email announcement        sender, subject, preview, body, CTA, sign-off        copy.json
//     list email (optional)     the same, its body a numbered list of the sections   copy.json + brief
//   5 social posts              Facebook / LinkedIn, Instagram, X, in-app post       copy.json
//   6 podcast brief             the brief the hosts record from                      copy.json
//
// copy.json is the copywriter's sidecar (docs/copy.md). It holds the parts;
// this file composes them into the finished posts (bullets, hashtags, links,
// the brand's sign-off), so the house style lives in brand.json "copy" and
// every channel stays consistent. Writes rollout-copy.md (all six, ready to
// paste), one .txt per channel, email.html and copy.json (what was built).

import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml as e, featurePaths, readJson, writeJson } from './env.mjs';
import { plainHeadline, copyStyle, styleProblems, sentenceCount } from './brief.mjs';
import { titleCase } from './webpage.mjs';

export const copyFile = (slug) => path.join(featurePaths(slug).library, 'copy.json');
export const copyDir = (slug) => path.join(featurePaths(slug).output, 'copy');

// The channels a post is written for, and their platform limits.
export const CHANNELS = {
  feed: { label: 'Facebook / LinkedIn', max: 3000, hashtags: [4, 5], bullets: [4, 5], image: 'cover' },
  instagram: { label: 'Instagram', max: 2200, hashtags: [4, 5], bullets: [0, 5], image: 'slides' },
  x: { label: 'Twitter / X', max: 280, hashtags: [2, 3], bullets: [0, 5], image: 'feature' },
  inApp: { label: 'In-app post', max: 2000, hashtags: [0, 0], bullets: [3, 5], image: 'feature' },
};

export const COPY_LIMITS = { subject: [20, 60], subjectMax: 78, preview: [40, 110], previewMax: 140, meta: 160 };

// A link not known yet, written as a placeholder ("[link]") to fill in when it is published.
const PLACEHOLDER = /^\[[^\]]+\]$/;

// The other pages the header copy is written for, beside the web page (the brief's own).
export const HEADER_PAGES = { video: 'video page', podcast: 'podcast page' };

// Which social-pack files an image name stands for (docs/social.md).
const IMAGES = {
  cover: (f) => f.startsWith('slide-1-cover'),
  slides: (f) => /^slide-\d+-.*\.png$/.test(f),
  carousel: (f) => f.startsWith('carousel-'),
  feature: (f) => f.startsWith('feature-'),
  podcast: (f) => f.startsWith('podcast-'),
  youtube: (f) => f.startsWith('youtube-'),
  email: (f) => f.startsWith('email-'),
  none: () => false,
};

// The brand's copy block with every default filled in.
export function brandCopy(brand) {
  const c = brand.copy ?? {};
  return {
    ...copyStyle(brand),
    sender: c.sender ?? brand.name,
    signoff: c.signoff ?? `The ${brand.name} Team`,
    ctaPrefix: c.ctaPrefix ?? '',
    linkInBio: c.linkInBio ?? 'Link in bio',
    greeting: c.greeting ?? 'Hi {{First Name}},',
    bullets: { feed: '•', instagram: '•', x: '•', inApp: '•', ...(c.bullets ?? {}) },
    hashtags: c.hashtags ?? [],
    labels: Object.fromEntries(Object.entries(CHANNELS).map(([k, v]) => [k, c.labels?.[k] ?? v.label])),
    hosts: c.podcast?.hosts ?? [{ label: 'Host A', persona: '' }, { label: 'Host B', persona: '' }],
    notes: c.notes ?? [],
    // headings in headline style when the site uses it (brand web.titleCase, or copy.titleCase)
    titleCase: c.titleCase ?? brand.web?.titleCase ?? false,
  };
}

const tag = (t) => (t.startsWith('#') ? t : `#${t}`);

// copy.json with every default filled in from the brief and brand.
export function loadCopy(slug, brief, brand) {
  const file = copyFile(slug);
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  const style = brandCopy(brand);
  const link = raw.link ?? brief.cta.url;
  const post = (key) => {
    const p = raw.posts?.[key];
    if (!p) return null;
    return { ...p, bullets: p.bullets ?? [], hashtags: (p.hashtags ?? (key === 'inApp' ? [] : style.hashtags)).map(tag), image: p.image ?? CHANNELS[key].image, link: p.link ?? link };
  };
  const email = raw.email ? {
    sender: style.sender,
    signoff: style.signoff,
    paragraphs: [],
    ...raw.email,
    cta: { label: brief.cta.button, url: link, ...(raw.email.cta ?? {}) },
  } : null;
  // the second email: a numbered list of the brief's sections (title + short description)
  const listEmail = raw.listEmail ? {
    sender: style.sender,
    signoff: style.signoff,
    ...raw.listEmail,
    items: brief.sections.map((s) => ({ title: s.title, text: s.short ?? s.body })),
    cta: { label: brief.cta.button, url: link, ...(raw.listEmail.cta ?? raw.email?.cta ?? {}) },
  } : null;
  return {
    link,
    email,
    listEmail,
    posts: Object.fromEntries(Object.keys(CHANNELS).map((k) => [k, post(k)]).filter(([, p]) => p)),
    podcast: raw.podcast ?? null,
    headers: raw.headers ?? {},
    style,
  };
}

// X counts a link as 23 characters and an emoji or wide character as 2.
export function xLength(text) {
  let n = 0;
  // a [link] placeholder becomes a link: count it as one
  for (const part of text.split(/(https?:\/\/\S+|\[link\])/)) {
    if (/^https?:\/\/|^\[link\]$/.test(part)) { n += 23; continue; }
    for (const ch of part) {
      const cp = ch.codePointAt(0);
      if (cp === 0xfe0f || cp === 0x200d) continue;
      const narrow = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200c) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
      n += narrow ? 1 : 2;
    }
  }
  return n;
}

// ---- composing ----

const join = (...blocks) => blocks.filter((b) => b && String(b).trim()).join('\n\n');
const list = (items, bullet) => items.map((i) => `${bullet} ${i}`).join('\n');
const withPrefix = (prefix, text) => (prefix ? `${prefix} ${text}` : text);

export function composePost(key, p, style) {
  const bullets = list(p.bullets, style.bullets[key]);
  const hashtags = p.hashtags.join(' ');
  if (key === 'instagram') return join(p.hook, p.intro, bullets, p.closing, withPrefix(style.ctaPrefix, p.cta ?? style.linkInBio), hashtags);
  if (key === 'inApp') return join(p.title && `Title: ${p.title}`, style.greeting, p.intro, bullets, p.closing, p.cta);
  const cta = [withPrefix(style.ctaPrefix, p.cta ?? ''), p.link].filter(Boolean).join(' ');
  if (key === 'x') return join(p.hook, bullets, cta, hashtags);
  return join(p.hook, p.intro, bullets, p.closing, cta, hashtags);
}

export function composeEmail(m, style) {
  return join(m.opener, ...m.paragraphs, m.closing, withPrefix(style.ctaPrefix, `${m.cta.label} ${m.cta.url}`), m.signoff);
}

export function composeListEmail(m, style) {
  const list = m.items.map((it, i) => `${i + 1}. ${style.titleCase ? titleCase(it.title) : it.title}: ${it.text}`).join('\n');
  return join(m.intro, list, m.closing, withPrefix(style.ctaPrefix, `${m.cta.label} ${m.cta.url}`), m.signoff);
}

// ---- validation ----

export function validateCopy(slug, brief, brand) {
  const errors = [];
  const warnings = [];
  let copy;
  try {
    copy = loadCopy(slug, brief, brand);
  } catch (err) {
    return { errors: [`copy.json: ${err.message}`], warnings };
  }
  if (!copy) return { errors, warnings: ['no copy.json — the copy pack (email, posts, podcast brief) is not built'] };
  const { style } = copy;
  const text = (label, value) => errors.push(...styleProblems(label, value, style));
  const need = (label, value) => { if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) errors.push(`${label} is missing`); };
  const count = (label, n, [min, max], what) => { if (n < min || n > max) warnings.push(`${label} has ${n} ${what} (aim for ${min === max ? min : `${min}-${max}`})`); };

  const m = copy.email;
  if (!m) warnings.push('email is missing');
  else {
    for (const k of ['subject', 'preview', 'opener', 'closing']) need(`email.${k}`, m[k]);
    if (m.paragraphs.length < 1 || m.paragraphs.length > 3) warnings.push(`email.paragraphs has ${m.paragraphs.length} paragraphs (aim for 2)`);
    if (m.subject?.length > COPY_LIMITS.subjectMax) errors.push(`email.subject is ${m.subject.length} characters; inboxes cut it after about ${COPY_LIMITS.subjectMax}`);
    else if (m.subject?.length > COPY_LIMITS.subject[1]) warnings.push(`email.subject is ${m.subject.length} characters (aim for ${COPY_LIMITS.subject[1]} or fewer)`);
    if (m.preview?.length > COPY_LIMITS.previewMax) errors.push(`email.preview is ${m.preview.length} characters; at most ${COPY_LIMITS.previewMax} show`);
    else if (m.preview?.length > COPY_LIMITS.preview[1]) warnings.push(`email.preview is ${m.preview.length} characters (aim for ${COPY_LIMITS.preview[1]} or fewer)`);
    if (m.preview && sentenceCount(m.preview) > 1) warnings.push('email.preview is more than one sentence');
    if (PLACEHOLDER.test(m.cta.url ?? '')) warnings.push(`email.cta.url is the placeholder "${m.cta.url}": replace it once the page is published`);
    else if (!/^https?:\/\//.test(m.cta.url ?? '')) errors.push(`email.cta.url is "${m.cta.url ?? ''}"; it must be an http(s) link (set copy.json link, the brief's cta.url or CTA_URL in .env)`);
    [['subject', m.subject], ['preview', m.preview], ['opener', m.opener], ...m.paragraphs.map((p, i) => [`paragraphs[${i}]`, p]), ['closing', m.closing], ['cta.label', m.cta.label]]
      .forEach(([k, v]) => text(`email.${k}`, v));
  }

  for (const [page, h] of Object.entries(copy.headers)) {
    if (!HEADER_PAGES[page]) { errors.push(`headers.${page} is not one of ${Object.keys(HEADER_PAGES).join(', ')}`); continue; }
    for (const k of ['headline', 'subheadline', 'description']) need(`headers.${page}.${k}`, h[k]);
    if (h.description?.length > COPY_LIMITS.meta) warnings.push(`headers.${page}.description is ${h.description.length} characters (search results show about ${COPY_LIMITS.meta})`);
    for (const k of ['headline', 'subheadline', 'description']) text(`headers.${page}.${k}`, h[k]);
  }

  const l = copy.listEmail;
  if (l) {
    for (const k of ['subject', 'preview', 'intro', 'closing']) need(`listEmail.${k}`, l[k]);
    if (l.subject?.length > COPY_LIMITS.subjectMax) errors.push(`listEmail.subject is ${l.subject.length} characters; inboxes cut it after about ${COPY_LIMITS.subjectMax}`);
    else if (l.subject?.length > COPY_LIMITS.subject[1]) warnings.push(`listEmail.subject is ${l.subject.length} characters (aim for ${COPY_LIMITS.subject[1]} or fewer)`);
    if (l.preview?.length > COPY_LIMITS.previewMax) errors.push(`listEmail.preview is ${l.preview.length} characters; at most ${COPY_LIMITS.previewMax} show`);
    [['subject', l.subject], ['preview', l.preview], ['intro', l.intro], ['closing', l.closing]].forEach(([k, v]) => text(`listEmail.${k}`, v));
  }

  for (const key of Object.keys(CHANNELS)) {
    const p = copy.posts[key];
    const label = `posts.${key}`;
    if (!p) { warnings.push(`${label} is missing (${CHANNELS[key].label})`); continue; }
    need(`${label}.${key === 'inApp' ? 'intro' : 'hook'}`, key === 'inApp' ? p.intro : p.hook);
    if (!IMAGES[p.image]) errors.push(`${label}.image "${p.image}" is not one of ${Object.keys(IMAGES).join(', ')}`);
    count(label, p.bullets.length, CHANNELS[key].bullets, 'bullets');
    count(label, p.hashtags.length, CHANNELS[key].hashtags, 'hashtags');
    const composed = composePost(key, p, style);
    const n = key === 'x' ? xLength(composed) : [...composed].length;
    if (n > CHANNELS[key].max) errors.push(`${label} is ${n} characters${key === 'x' ? ' as X counts them' : ''}; at most ${CHANNELS[key].max}`);
    text(label, composed);
  }
  if (copy.posts.instagram && copy.posts.feed && [...composePost('instagram', copy.posts.instagram, style)].length > [...composePost('feed', copy.posts.feed, style)].length) {
    warnings.push('posts.instagram is longer than posts.feed (it is the shorter version)');
  }

  const pod = copy.podcast;
  if (!pod) warnings.push('podcast is missing (the podcast brief)');
  else {
    for (const k of ['title', 'description', 'audience', 'tone', 'duration']) need(`podcast.${k}`, pod[k]);
    for (const k of ['proposition', 'before', 'after']) need(`podcast.value.${k}`, pod.value?.[k]);
    need('podcast.useCases.primary', pod.useCases?.primary);
    need('podcast.cta.text', pod.cta?.text);
    for (const k of ['steps', 'standout', 'focus', 'talkingPoints', 'questions']) need(`podcast.${k}`, pod[k]);
    if (pod.description) count('podcast.description', sentenceCount(pod.description), [3, 4], 'sentences');
    if (pod.steps) count('podcast.steps', pod.steps.length, [4, 4], 'steps');
    if (pod.focus) count('podcast.focus', pod.focus.length, [3, 4], 'areas');
    count('podcast.useCases.secondary', pod.useCases?.secondary?.length ?? 0, [2, 3], 'use cases');
    if ((pod.hosts ?? []).length !== style.hosts.length) warnings.push(`podcast.hosts has ${(pod.hosts ?? []).length} entries; the brand has ${style.hosts.length} hosts`);
    text('podcast', JSON.stringify(pod));
  }
  return { errors, warnings };
}

// ---- writing ----

function podcastMarkdown(pod, brief, brand, style) {
  const bullets = (items = []) => items.map((i) => `- ${i}`).join('\n');
  const hosts = style.hosts.map((h, i) => `**${h.label}${h.persona ? ` (${h.persona})` : ''}:** ${(pod.hosts?.[i]?.focus ?? []).join('; ')}`).join('\n');
  return join(
    `**Podcast brief: ${pod.title}**`,
    `**Basic information**\n${bullets([`Feature: ${brief.feature}`, `Company: ${brand.name}`, ...(pod.status ? [`Status: ${pod.status}`] : []), `Estimated duration: ${pod.duration}`, ...(brand.website ? [`Website: ${brand.website}`] : [])])}`,
    `**Feature description**\n${pod.description}`,
    `**Target audience**\n${pod.audience}`,
    `**Value proposition**\n${pod.value.proposition}\n\nBefore: ${pod.value.before}\nAfter: ${pod.value.after}`,
    `**How it works**\n${pod.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    `**Standout elements**\n${bullets(pod.standout)}`,
    `**Real-world use cases**\nPrimary: ${pod.useCases.primary}\n${bullets(pod.useCases.secondary)}`,
    `**Discussion focus**\n${bullets(pod.focus)}`,
    `**Key talking points**\n${bullets(pod.talkingPoints)}`,
    `**Host questions**\n${bullets(pod.questions)}`,
    `**Tone**\n${pod.tone}`,
    `**Call to action and resources**\n${pod.cta.text}${pod.cta.resources?.length ? `\n${bullets(pod.cta.resources.map((r) => (r.url ? `${r.label}: ${r.url}` : r.label ?? r)))}` : ''}`,
    `**Host focus areas**\n${hosts}`,
  );
}

function emailHtml(m, brand, image) {
  const c = brand.colors;
  const font = `${brand.fonts.body.family}, Arial, sans-serif`;
  const p = (t) => `<p style="margin:0 0 16px;font:16px/1.55 ${e(font)};color:${c.ink}">${e(t)}</p>`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(m.subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f6f8">
<div style="display:none;max-height:0;overflow:hidden">${e(m.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px">
${image ? `<tr><td style="padding:24px 24px 0"><img src="${e(image)}" width="552" alt="" style="display:block;width:100%;height:auto;border:0"></td></tr>` : ''}
<tr><td style="padding:28px 32px 32px">
${p(m.opener)}${m.paragraphs.map(p).join('')}${p(m.closing)}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="background:${c.cta};border-radius:8px">
<a href="${e(m.cta.url)}" style="display:inline-block;padding:13px 22px;font:600 16px ${e(font)};color:#fff;text-decoration:none">${e(m.cta.label)}</a></td></tr></table>
<p style="margin:0;font:16px/1.55 ${e(font)};color:${c.ink}">${e(m.signoff)}</p>
</td></tr></table>
</td></tr></table>
</body></html>
`;
}

// Write the pack; returns the files written. Images refer to the social pack.
export function buildCopy({ slug, brief, brand }) {
  const copy = loadCopy(slug, brief, brand);
  if (!copy) return null;
  const { errors } = validateCopy(slug, brief, brand);
  if (errors.length) throw new Error(`copy.json: ${errors.join('; ')}`);
  const { style } = copy;

  const out = copyDir(slug);
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f), { recursive: true, force: true });
  const files = [];
  const write = (name, body) => { fs.writeFileSync(path.join(out, name), body.endsWith('\n') ? body : `${body}\n`); files.push(name); };

  const socialDir = path.join(featurePaths(slug).output, 'assets', 'social');
  const built = fs.existsSync(socialDir) ? fs.readdirSync(socialDir).sort((a, b) => (parseInt(a.slice(6), 10) || 0) - (parseInt(b.slice(6), 10) || 0)) : [];
  const images = (name) => built.filter(IMAGES[name] ?? (() => false)).map((f) => `assets/social/${f}`);
  const attach = (name) => (name === 'none' ? '' : images(name).length ? `Attach: ${images(name).join(', ')}` : `Attach: the social pack's ${name} image (not built yet)`);

  const md = [];
  const heading = (t) => (style.titleCase ? titleCase(t) : t);
  md.push(join('**1. Subfeature descriptions**', ...brief.sections.map((s) => `**${heading(s.title)}**${s.eyebrow ? ` (${s.eyebrow})` : ''}\nShort: ${s.short ?? ''}\nLong: ${s.body}`)));
  // the web page's header is the brief's; video and podcast pages get their own when copy.json has them
  const pages = [['webpage', { headline: plainHeadline(brief.headline), subheadline: brief.lead ?? '', description: brief.seo.description }],
    ...Object.entries(copy.headers).map(([k, h]) => [HEADER_PAGES[k], h])];
  const variants = (key, fmt = (x) => x) => (pages.length === 1 ? fmt(pages[0][1][key]) : `\n${pages.map(([page, h], i) => `${i + 1}. (${page}) ${fmt(h[key])}`).join('\n')}`);
  md.push(join('**2. Rollout page header**', `Headline: ${variants('headline', heading)}\nSEO URL: ${brief.seo.url}\nSubheadline: ${variants('subheadline')}\nMetadescription: ${variants('description')}`));
  md.push(join('**3. One-pager intro**', brief.intro));

  if (copy.email) {
    const m = copy.email;
    const body = composeEmail(m, style);
    md.push(join('**4. Email announcement**', `Sender: ${m.sender}\nSubject: ${m.subject}\nPreview: ${m.preview}\nBody:`, body));
    write('email.txt', `Subject: ${m.subject}\nPreview: ${m.preview}\n\n${body}`);
    const hero = images('email')[0];
    write('email.html', emailHtml(m, brand, hero ? `../${hero}` : null));
  }
  if (copy.listEmail) {
    const m = copy.listEmail;
    const body = composeListEmail(m, style);
    md.push(join('**4b. List email**', `Sender: ${m.sender}\nSubject: ${m.subject}\nPreview: ${m.preview}\nBody:`, body));
    write('email-list.txt', `Subject: ${m.subject}\nPreview: ${m.preview}\n\n${body}`);
  }

  const posts = Object.entries(copy.posts);
  if (posts.length) {
    const blocks = posts.map(([key, p]) => {
      const text = composePost(key, p, style);
      write(`${key === 'inApp' ? 'in-app' : key}.txt`, text);
      return join(`**${style.labels[key]}**`, text, attach(p.image) && `_${attach(p.image)}_`);
    });
    md.push(join('**5. Social posts**', ...blocks));
  }

  if (copy.podcast) {
    const pod = podcastMarkdown(copy.podcast, brief, brand, style);
    write('podcast-brief.md', pod);
    md.push(join('**6. Podcast brief**', pod));
  }

  write('rollout-copy.md', `# ${brief.feature}: rollout copy\n\n${md.join('\n\n---\n\n')}`);
  writeJson(path.join(out, 'copy.json'), {
    $comment: 'What this copy pack holds. Generated by pipeline/copy.mjs from library/features/<slug>/copy.json and the brief.',
    slug,
    brand: brand.id,
    files: [...files, 'copy.json'],
    builtAt: new Date().toISOString(),
  });
  return { dir: out, files };
}
