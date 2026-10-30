// Help article: library/features/<slug>/help.json + brand + scene stills
// -> output/<slug>/help/
//
// The help-center article that explains how to use a feature, beside the
// one-pager and web page that sell it. help.json is the rollout-help-writer
// agent's sidecar: the article as structured blocks, plus the record of where
// it is published. This renders it to the HTML body a help center keeps as is,
// in the house style of the existing articles: a divider (hr) before each
// section, h2 sections, h3 steps and h4 sub-topics in bold, a blank paragraph
// between blocks, images in the help center's own container at their display
// size (narrow ones centred), lists, tables as plain rows, video iframes,
// bold, italic and links — any other div or unknown tag would become a
// paragraph. Publishing is separate: `rollout.mjs help-publish`
// sends the built article over the help center's API (helpcenter.mjs), on the
// user's go-ahead, and records where it lives in help.published.json.
//
//   article.html    the body exactly as it is sent
//   article.json    title, description, where it goes (author, collection,
//                   the live article id when it is an update), its images,
//                   and anything that blocks publishing
//   preview.html    the article as a page, with local images, to read first
//   images/         the scene stills (or GIFs) the article shows
//
// Images: the help center fetches each image from its src URL when the article
// is sent and serves its own copy, so the URL must be public only then. After
// a publish, help.published.json maps each image file (by content hash) to the
// help center's copy, and later builds use that copy, so only new or changed
// images need hosting. With an image store (HELP_IMAGE_STORE, imagestore.mjs)
// they are marked upload: true, and help-publish uploads them and builds again
// with their URLs (buildHelp's uploaded). Otherwise, with HELP_IMAGE_BASE_URL
// set, such an image's src is <base>/<slug>/<file> (host
// output/<slug>/help/images/ there); with neither, the article gets a visible
// placeholder for an editor to replace, and article.json lists it as a blocker
// to publishing (a draft is fine). Images already in a live article are kept
// by their help-center URL.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env, envNumber, escapeHtml as e, featurePaths, readJson, writeJson } from './env.mjs';
import { brandCss } from './brand.mjs';
import { SCENE_ID_RE, sceneFile } from './library.mjs';
import { imageStoreName } from './imagestore.mjs';
import { framedHelpImage } from './webmedia.mjs';

export const HELP_LIMITS = {
  title: [3, 80],
  description: [20, 160],
  heading: 90,
  alt: 140,
};

export const helpFile = (slug) => path.join(featurePaths(slug).library, 'help.json');
export const helpDir = (slug) => path.join(featurePaths(slug).output, 'help');
// written by helpcenter.mjs after each publish: the live article
export const publishedFile = (slug) => path.join(featurePaths(slug).library, 'help.published.json');
export const readPublished = (slug) => (fs.existsSync(publishedFile(slug)) ? readJson(publishedFile(slug)) : null);

const BLOCK_KINDS = ['p', 'steps', 'bullets', 'image', 'video', 'note', 'table'];
// the video hosts a help center embeds; anything else fails the request
const VIDEO_RE = /^https:\/\/(www\.)?(youtube\.com\/embed\/|player\.vimeo\.com\/video\/|fast\.wistia\.(net|com)\/embed\/|(www\.)?loom\.com\/embed\/|play\.vidyard\.com\/|streamio\.com\/)/;
const blockKind = (b) => BLOCK_KINDS.find((k) => k in (b ?? {}));
const isUrl = (s) => /^https:\/\//.test(s);
// heading tag per section level: the house style keeps h1 for the trial link
const HEADING = { 1: 'h2', 2: 'h3', 3: 'h4' };
// images narrower than this are centred, as the house style shows UI panels
const CENTER_BELOW = 640;
// a blank line: the help center drops an empty paragraph sent over its API,
// so it holds a zero-width space
const SPACER = '<p>​</p>';
// the frame drawn around each scene image, in display (1x) pixels
const frameSettings = () => ({
  pad: envNumber('HELP_FRAME_PAD', 24),
  radius: envNumber('HELP_FRAME_RADIUS', 12),
  border: env('HELP_FRAME_BORDER', env('WEB_FRAME_BORDER', '#e3e7ec')),
});

// help.json with every default filled in from the brief, brand and .env.
export function loadHelp(slug, brief, brand) {
  const file = helpFile(slug);
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  const h = brand.help ?? {};
  const publish = raw.publish ?? {};
  const live = readPublished(slug);
  return {
    title: raw.title ?? brief.feature,
    description: raw.description ?? '',
    // paragraphs, or blocks (a hero image under the first paragraph)
    intro: [].concat(raw.intro ?? []).map((x) => (typeof x === 'string' ? { p: x } : x)),
    sections: (raw.sections ?? []).map((s) => ({ level: 1, blocks: [], ...s })),
    faq: raw.faq ?? [],
    cta: raw.cta === false ? null : (raw.cta ?? h.cta ?? null),
    faqTitle: h.faqTitle ?? 'Frequently Asked Questions',
    closing: raw.closing === false ? null : (raw.closing ?? h.closing ?? null),
    // what the agent chose (the article to update, the state); the live
    // article from help.published.json once one has been sent
    publish: {
      articleId: publish.articleId ?? live?.articleId ?? null,
      state: publish.state ?? 'draft',
      authorId: publish.authorId ?? env('HELP_AUTHOR_ID') ?? null,
      parentId: publish.parentId ?? env('HELP_COLLECTION_ID') ?? null,
      updatedAt: publish.updatedAt ?? null,
    },
    live,
  };
}

// Every scene the article shows, for rendering before it is laid out.
export const helpSceneIds = (help) => [...new Set([...help.intro, ...help.sections.flatMap((s) => s.blocks)]
  .filter((b) => blockKind(b) === 'image' && !isUrl(b.image)).map((b) => b.image))];

export function validateHelp(slug, brief, brand) {
  const errors = [];
  const warnings = [];
  let help;
  try {
    help = loadHelp(slug, brief, brand);
  } catch (err) {
    return { errors: [`help.json is not valid JSON: ${err.message}`], warnings };
  }
  if (!help) return { errors, warnings: ['no help.json — the help article is not built'] };

  const len = (label, value, [min, max]) => {
    if (!value) return errors.push(`${label} is missing`);
    if (value.length > max) errors.push(`${label} is ${value.length} characters; at most ${max}`);
    if (value.length < min) warnings.push(`${label} is only ${value.length} characters (aim for ${min}+)`);
  };
  const links = (label, text) => {
    for (const m of String(text).matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)) {
      if (!/^(https:\/\/|mailto:)/.test(m[2])) errors.push(`${label}: link "${m[1]}" must be https:// or mailto: (got "${m[2]}")`);
    }
  };
  len('title', help.title, HELP_LIMITS.title);
  len('description', help.description, HELP_LIMITS.description);
  if (!help.sections.length) errors.push('sections is empty');
  if (help.sections[0] && help.sections[0].level !== 1) errors.push('sections[0].level must be 1: a step or sub-topic needs a section above it');
  const blocks = (at, list) => list.forEach((b, k) => {
      const bt = `${at}[${k}]`;
      const kind = blockKind(b);
      if (!kind) return errors.push(`${bt}: one of ${BLOCK_KINDS.join(', ')} expected`);
      if (kind === 'p' || kind === 'note') return links(bt, b[kind]);
      if (kind === 'steps' || kind === 'bullets') {
        if (!Array.isArray(b[kind]) || !b[kind].length) return errors.push(`${bt}.${kind} must be a non-empty list`);
        return b[kind].forEach((item) => links(bt, item));
      }
      if (kind === 'table') {
        const { head, rows } = b.table ?? {};
        if (!Array.isArray(head) || !Array.isArray(rows) || rows.some((r) => !Array.isArray(r) || r.length !== head.length)) {
          errors.push(`${bt}.table needs head [] and rows [[]] of the same width`);
        }
        return;
      }
      if (kind === 'video') {
        if (!VIDEO_RE.test(b.video ?? '')) errors.push(`${bt}.video must be an embed URL from YouTube, Vimeo, Wistia, Loom, Vidyard or StreamIO`);
        return;
      }
      // image: a library scene, or the URL of an image already in the live article
      if (!b.alt) warnings.push(`${bt}.alt is missing`);
      else if (b.alt.length > HELP_LIMITS.alt) warnings.push(`${bt}.alt is long (${b.alt.length} characters)`);
      if (isUrl(b.image)) return;
      if (!SCENE_ID_RE.test(b.image ?? '')) return errors.push(`${bt}.image "${b.image}" is neither a scene id nor an https URL`);
      if (!fs.existsSync(sceneFile(b.image))) errors.push(`${bt}.image "${b.image}" does not exist in library/scenes/`);
      if (b.width !== undefined && !(Number.isInteger(b.width) && b.width > 0)) errors.push(`${bt}.width must be a whole number of pixels`);
    });
  blocks('intro', help.intro);
  help.sections.forEach((s, i) => {
    const at = `sections[${i}]`;
    if (!s.heading) errors.push(`${at}.heading is missing`);
    else if (s.heading.length > HELP_LIMITS.heading) warnings.push(`${at}.heading is long (${s.heading.length} characters)`);
    if (!HEADING[s.level]) errors.push(`${at}.level must be 1 (section), 2 (step) or 3 (sub-topic)`);
    // a section may hold only its steps
    if (!s.blocks.length && !(help.sections[i + 1]?.level > s.level)) warnings.push(`${at} has no blocks`);
    blocks(`${at}.blocks`, s.blocks);
  });
  help.faq.forEach((f, i) => {
    if (!f.q || !f.a) errors.push(`faq[${i}] needs q and a`);
    else links(`faq[${i}]`, f.a);
  });
  if (help.cta && !(help.cta.label && isUrl(help.cta.url ?? ''))) errors.push('cta needs a label and an https url');
  if (help.closing?.body) links('closing', help.closing.body);
  const p = help.publish;
  if (p.articleId && !/^\d+$/.test(String(p.articleId))) errors.push(`publish.articleId "${p.articleId}" is not a numeric article id`);
  if (!['draft', 'published'].includes(p.state)) errors.push('publish.state must be draft or published');
  if (p.parentId && !/^\d+$/.test(String(p.parentId))) errors.push(`publish.parentId "${p.parentId}" is not a numeric collection id`);
  if (help.live && p.articleId && String(p.articleId) !== String(help.live.articleId)) warnings.push(`publish.articleId ${p.articleId} differs from the article last published (${help.live.articleId})`);
  return { errors, warnings };
}

// ---- HTML ----

// **bold**, *italic*, [text](https://…) and line breaks on escaped text;
// nothing else is markup.
const inline = (s) => e(s)
  .replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^)\s]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`)
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
  .replace(/\n/g, '<br>');

// Pixel size of a PNG or GIF, from its header.
function pixelSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 1, 4) === 'PNG') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.toString('latin1', 0, 3) === 'GIF') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  return null;
}

// An image in the help center's own container, at its display size (the
// height scales with the column); a narrow one centred.
function imageHtml(img, alt) {
  if (!img.width) return `<img src="${e(img.src)}" alt="${e(alt)}">`;
  const center = img.width < CENTER_BELOW ? ' intercom-align-center' : '';
  return `<div class="intercom-container${center}"><img src="${e(img.src)}" alt="${e(alt)}" width="${img.width}" height="${img.height}" style="height: auto;"></div>`;
}

function blockHtml(b, image) {
  switch (blockKind(b)) {
    case 'p': return `<p>${inline(b.p)}</p>`;
    case 'note': return `<p><b>Note:</b> ${inline(b.note)}</p>`;
    case 'steps': return `<ol>${b.steps.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>`;
    case 'bullets': return `<ul>${b.bullets.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`;
    // header cells are plain cells in bold: thead and th are not kept
    case 'table': return `<table>${[b.table.head.map((c) => `<b>${inline(c)}</b>`), ...b.table.rows.map((r) => r.map(inline))]
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
    case 'image': {
      const img = image(b);
      return img.src ? imageHtml(img, b.alt ?? '') : `<p><b>[Image: ${e(b.alt ?? b.image)}]</b></p>`;
    }
    case 'video': return `<iframe src="${e(b.video)}"></iframe>`;
    default: return '';
  }
}

// The article body. image(block) returns { src, width, height } for an image
// block; src null for a placeholder.
function bodyHtml(help, image) {
  const out = [];
  // blank lines as the editor makes them: between blocks and around every
  // image, none after a heading before text, none before a divider
  let last = 'heading';
  const block = (html) => {
    const image = html.startsWith('<div class="intercom-container');
    if (last !== 'heading' || image) out.push(SPACER);
    out.push(html);
    last = image ? 'image' : 'block';
  };
  const heading = (tag, text, divider) => {
    if (divider) out.push('<hr>');
    else if (last !== 'heading') out.push(SPACER);
    out.push(`<${tag}><b>${text}</b></${tag}>`);
    last = 'heading';
  };
  // the trial link: a centred heading, as help-center articles open
  if (help.cta) out.push(`<h1 class="intercom-align-center"><b><a href="${e(help.cta.url)}">${e(help.cta.label)}</a></b></h1>`);
  help.intro.forEach((b) => block(blockHtml(b, image)));
  for (const s of help.sections) {
    heading(HEADING[s.level], inline(s.heading), s.level === 1);
    s.blocks.forEach((b) => block(blockHtml(b, image)));
  }
  if (help.faq.length) {
    heading('h2', e(help.faqTitle), true);
    help.faq.forEach((f) => block(`<p><b>${inline(f.q)}</b></p><p>${inline(f.a)}</p>`));
  }
  if (help.closing) {
    if (help.closing.title) heading('h2', e(help.closing.title), true);
    if (help.closing.body) block(`<p>${inline(help.closing.body)}</p>`);
  }
  // no whitespace between tags: the help center turns each stray line break into an empty paragraph
  return out.join('');
}

const previewHtml = (help, brand, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(help.title)} — help article preview</title>
<style>
${brandCss(brand)}
body { margin: 0; background: #f6f7f9; color: var(--ink); font: 16px/1.6 var(--font-body); }
main { max-width: 760px; margin: 40px auto; background: #fff; border: 1px solid #e3e7ec; border-radius: 12px; padding: 40px 48px; }
@media (max-width: 700px) { main { margin: 0; border-radius: 0; padding: 24px 16px; } }
.meta { color: var(--muted); font-size: 13px; margin: 0 0 24px; }
h1.title { font: 700 32px/1.2 var(--font-display); margin: 0 0 8px; }
main h1:not(.title) { font: 700 24px/1.3 var(--font-display); margin: 24px 0 16px; }
main h2 { font: 700 22px/1.3 var(--font-display); margin: 0 0 10px; }
main h3 { font: 700 18px/1.3 var(--font-display); margin: 16px 0 8px; }
main h4 { font: 700 16px/1.3 var(--font-display); margin: 12px 0 6px; }
/* the help center's paragraphs have no margin: blank paragraphs space them */
main p { margin: 0; }
main ol, main ul { margin: 0; padding-left: 24px; }
hr { border: 0; border-top: 1px solid #e3e7ec; margin: 28px 0; }
.intercom-container { margin: 0; } .intercom-align-center { text-align: center; }
iframe { width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 8px; }
.description { color: var(--muted); font-size: 18px; margin: 0 0 24px; }
a { color: var(--primary); }
img { max-width: 100%; }
table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #e3e7ec; padding: 6px 10px; text-align: left; }
</style></head>
<body><main>
<p class="meta">Preview of output/${e(help.slug)}/help/article.html — ${help.publish.articleId ? `updates article ${e(help.publish.articleId)}` : 'a new article'}${help.live ? ` (now ${e(help.live.state)})` : `, as ${e(help.publish.state)}`}</p>
<h1 class="title">${e(help.title)}</h1>
<p class="description">${e(help.description)}</p>
${body}</main></body></html>
`;

// Write output/<slug>/help/. Returns null when the feature has no help.json.
// uploaded: { file: url } of images help-publish has put in the image store.
export async function buildHelp({ slug, brief, brand, renders, uploaded = {} }) {
  const help = loadHelp(slug, brief, brand);
  if (!help) return null;
  help.slug = slug;
  const { errors } = validateHelp(slug, brief, brand);
  if (errors.length) throw new Error(`help.json: ${errors.join('; ')}`);

  const out = helpDir(slug);
  // empty it rather than remove it: Windows refuses to remove a folder that is open somewhere
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'images'));

  // Each scene image's src: the help center's own copy when this exact file
  // was sent before (help.published.json images, matched by content hash),
  // else its uploaded URL, else — with an image store — null until help-publish
  // uploads it, else <base>/<slug>/<file>, else null (a placeholder).
  const store = imageStoreName();
  const base = store ? null : env('HELP_IMAGE_BASE_URL')?.replace(/\/$/, '');
  const hosted = help.live?.images ?? {};
  const images = [];
  // The scene's GIF unless the block says "animated": false (or it has none),
  // framed (frameSettings) and shown at its true screen size: GIFs are
  // recorded at 1x, stills at STILL_SCALE; "width" overrides.
  const frame = frameSettings();
  const stillScale = envNumber('STILL_SCALE', 2);
  const imageFor = async (b) => {
    const r = renders[b.image];
    if (!r) throw new Error(`help.json: scene ${b.image} was not rendered`);
    const animated = b.animated !== false && Boolean(r.gif);
    const from = animated ? r.gif : r.still;
    const name = `${b.image}${path.extname(from)}`;
    let img = images.find((i) => i.file === name);
    if (!img) {
      const file = path.join(out, 'images', name);
      const k = animated ? 1 : stillScale;
      await framedHelpImage({ file: from, out: file, size: pixelSize(from), pad: frame.pad * k, radius: frame.radius * k, border: frame.border });
      const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
      const kept = hosted[name]?.hash === hash ? hosted[name].url : null;
      const src = kept ?? uploaded[name] ?? (base ? `${base}/${slug}/${name}` : null);
      const px = pixelSize(file);
      const shown = b.width ?? Math.round(px.width / k);
      img = {
        file: name, scene: b.image, alt: b.alt ?? '', animated, hash, reused: Boolean(kept), upload: Boolean(store && !kept), src,
        width: shown, height: Math.round((px.height * shown) / px.width), pixels: `${px.width}x${px.height}`,
      };
      images.push(img);
    }
    return img;
  };
  // the body that is sent: help-center copies, uploaded or hosted URLs, or
  // placeholders (until help-publish uploads them); the preview: local files.
  // An image already in the live article keeps the size it had there.
  const live = (b) => (b.width && b.height ? { src: b.image, width: b.width, height: b.height } : { src: b.image });
  // frame every scene image first: bodyHtml is synchronous
  const blocks = [...help.intro, ...help.sections.flatMap((s) => s.blocks)];
  const byBlock = new Map();
  for (const x of blocks) if (blockKind(x) === 'image' && !isUrl(x.image)) byBlock.set(x, await imageFor(x));
  const framed = (x) => byBlock.get(x);
  const sent = bodyHtml(help, (b) => (isUrl(b.image) ? live(b) : framed(b)));
  const local = bodyHtml(help, (b) => (isUrl(b.image) ? live(b) : { ...framed(b), src: `images/${framed(b).file}` }));

  fs.writeFileSync(path.join(out, 'article.html'), sent);
  fs.writeFileSync(path.join(out, 'preview.html'), previewHtml(help, brand, local));

  const blockers = [];
  const missing = images.filter((i) => !i.src && !i.upload);
  if (missing.length) blockers.push(`${missing.length} new or changed image(s) are placeholders (${missing.map((i) => i.file).join(', ')}): set HELP_IMAGE_STORE (or HELP_IMAGE_BASE_URL and host output/${slug}/help/images/ there), or add them in the help center's editor`);
  if (!help.publish.authorId) blockers.push('no author: set HELP_AUTHOR_ID in .env or publish.authorId in help.json');
  writeJson(path.join(out, 'article.json'), {
    $comment: 'Sidecar of article.html: what the help-center publish sends. Generated by pipeline/help.mjs; sent by rollout.mjs help-publish.',
    slug,
    title: help.title,
    description: help.description,
    body: 'article.html',
    action: help.publish.articleId ? 'update' : 'create',
    publish: help.publish,
    live: help.live,
    images,
    blockers,
    builtAt: new Date().toISOString(),
  });
  return { dir: out, images, blockers, uploads: images.filter((i) => i.upload && !i.src).length, action: help.publish.articleId ? 'update' : 'create' };
}
