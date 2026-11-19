// General-purpose images: the Lucide icon set (pipeline/lucide/, ISC licence),
// drawn in the brand's colours.
//
// Two uses:
//   - in kit scenes, <i data-lucide="name"></i> is any of Lucide's icons, drawn
//     like the kit's own <i data-icon> (currentColor, 16 px unless sized);
//   - standalone images (rollout.mjs icons make): an icon as an SVG and a PNG in
//     one of a few looks — line, tile, solid, circle — for blogs, help articles,
//     slides and anywhere else an icon image is needed.
//
// Colours are never written here: a look names brand colour keys (primary,
// heroTint, white…) and loadBrand() supplies the values, so every brand gets
// its own set from the same command.
//
// lucide.json is { version, icons: { name: [path d…] }, aliases: { old: name } },
// every icon a list of paths in a 24x24 box, built from the lucide-static
// package (Lucide is ISC — pipeline/lucide/LICENSE-lucide.txt).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lucide');
let data;
let tags;
const lucide = () => (data ??= JSON.parse(fs.readFileSync(path.join(DIR, 'lucide.json'), 'utf8')));
const lucideTags = () => (tags ??= JSON.parse(fs.readFileSync(path.join(DIR, 'lucide-tags.json'), 'utf8')));

export const lucideVersion = () => lucide().version;
export const ICON_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// The icon's canonical name (old names are aliases), or null.
export function resolveIcon(name) {
  const { icons, aliases = {} } = lucide();
  if (icons[name]) return name;
  if (aliases[name] && icons[aliases[name]]) return aliases[name];
  return null;
}

// Icons whose name or tags match every word, best first: exact name, name
// containing the word, then tag matches. Each: { name, tags }.
export function searchIcons(words, limit = 20) {
  const terms = String(words ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const { icons } = lucide();
  const all = lucideTags();
  const scored = [];
  for (const name of Object.keys(icons)) {
    const t = all[name] ?? [];
    let score = 0;
    let every = true;
    for (const w of terms) {
      if (name === w) score += 100;
      else if (name.split('-').includes(w)) score += 40;
      else if (name.includes(w)) score += 20;
      else if (t.some((x) => x.toLowerCase() === w)) score += 10;
      else if (t.some((x) => x.toLowerCase().includes(w))) score += 4;
      else { every = false; break; }
    }
    if (every) scored.push({ name, tags: t, score });
  }
  scored.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map(({ name, tags: t }) => ({ name, tags: t }));
}

// An unknown icon's error, with the closest names to try.
function unknown(name) {
  // the words as given, then the first word shortened a letter at a time (typos)
  let near = searchIcons(String(name).replace(/-/g, ' '), 5).map((i) => i.name);
  for (let w = String(name).split('-')[0]; !near.length && w.length >= 3; w = w.slice(0, -1)) {
    near = searchIcons(w, 5).map((i) => i.name);
  }
  return new Error(`no Lucide icon "${name}"${near.length ? ` — try ${near.join(', ')}` : ''} (rollout.mjs icons search <words>)`);
}

export function iconPaths(name) {
  const key = resolveIcon(name);
  if (!key) throw unknown(name);
  return lucide().icons[key];
}

// The icon's drawing inside a <g>: Lucide's own stroke (2 at 24 px), round caps.
const strokeGroup = (paths, color, strokeWidth) =>
  `<g fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${paths
    .map((d) => `<path d="${d}"/>`)
    .join('')}</g>`;

// The plain icon: a 24x24 SVG in currentColor (or color), for inlining.
export function iconSvg(name, { color = 'currentColor', strokeWidth = 2, size } = {}) {
  const dims = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"${dims}>${strokeGroup(iconPaths(name), color, strokeWidth)}</svg>`;
}

// ---- in kit scenes ----

// <i data-lucide="name" …></i> (or <span>) gets the icon's SVG inside it.
// Returns the markup and the icons it used, in order, once each.
const LUCIDE_TAG = /<(i|span)(\s[^>]*?)?\sdata-lucide=(["'])([^"']+)\3([^>]*)>\s*<\/\1>/g;

export function expandLucide(markup) {
  const used = [];
  const out = String(markup ?? '').replace(LUCIDE_TAG, (_, tag, before = '', q, name, after) => {
    const key = resolveIcon(name);
    if (!key) throw unknown(name);
    if (!used.includes(key)) used.push(key);
    return `<${tag}${before} data-lucide=${q}${name}${q}${after}>${iconSvg(key)}</${tag}>`;
  });
  return { markup: out, used };
}

export const usesLucide = (markup) => /\sdata-lucide=/.test(String(markup ?? ''));

// Sized and coloured like the kit's <i data-icon>.
export const LUCIDE_CSS = '[data-lucide]{display:inline-flex;width:16px;height:16px;flex:none;}[data-lucide] svg{width:100%;height:100%;}';

// ---- standalone images ----

// Each look: the background shape and the colour keys it uses. "fg" is the
// icon; "bg" the shape behind it (none for line). Keys are brand colours.
export const LOOKS = {
  line: { shape: null, fg: 'primary', bg: null, inset: 0.08 },
  tile: { shape: 'rounded', fg: 'primary', bg: 'heroTint', inset: 0.24 },
  solid: { shape: 'rounded', fg: 'white', bg: 'primary', inset: 0.24 },
  circle: { shape: 'circle', fg: 'primary', bg: 'heroTint', inset: 0.26 },
};

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// A brand colour key (primary, heroTint, navy…) or a literal #hex.
export function brandColor(brand, key) {
  if (HEX_RE.test(key)) return key;
  const v = brand.colors?.[key];
  if (!v) throw new Error(`no brand colour "${key}" — the brand has ${Object.keys(brand.colors ?? {}).join(', ')}`);
  return v;
}

// The image's SVG: size x size px, the icon centred in its look.
export function imageSvg(name, brand, { look = 'tile', fg, bg, size = 512 } = {}) {
  const l = LOOKS[look];
  if (!l) throw new Error(`no look "${look}" — ${Object.keys(LOOKS).join(', ')}`);
  if (!Number.isInteger(size) || size < 16 || size > 4096) throw new Error(`size ${size}: a whole number of px, 16 to 4096`);
  const fgColor = brandColor(brand, fg ?? l.fg);
  const bgKey = bg ?? l.bg;
  const bgColor = bgKey ? brandColor(brand, bgKey) : null;
  const paths = iconPaths(name);

  const pad = size * l.inset;
  const scale = (size - 2 * pad) / 24;
  // keep the stroke as heavy as Lucide's at the drawn size, never under 1.5 px
  const strokeWidth = Math.round(Math.max(2, 1.5 / scale) * 1000) / 1000;
  const back =
    !bgColor || !l.shape
      ? ''
      : l.shape === 'circle'
        ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${bgColor}"/>`
        : `<rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="${bgColor}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${back}<g transform="translate(${pad} ${pad}) scale(${Math.round(scale * 10000) / 10000})">${strokeGroup(paths, fgColor, strokeWidth)}</g></svg>`;
}

// The files for one image: <out>/<name>-<look>.svg and .png.
export const imageFile = (out, name, look, ext) => path.join(out, `${name}-${look}.${ext}`);

// Write each icon's SVG, and a PNG of it (transparent outside the shape)
// through the shared browser. Returns [{ name, svg, png }].
export async function writeImages(names, brand, { look = 'tile', fg, bg, size = 512, out, png = true, withBrowser } = {}) {
  if (!out) throw new Error('writeImages: no output folder');
  const list = [...new Set(names)].map((n) => {
    const key = resolveIcon(n);
    if (!key) throw unknown(n);
    return key;
  });
  fs.mkdirSync(out, { recursive: true });
  const made = list.map((name) => {
    const svg = imageFile(out, name, look, 'svg');
    fs.writeFileSync(svg, imageSvg(name, brand, { look, fg, bg, size }));
    return { name, svg, png: null };
  });
  if (!png) return made;
  if (!withBrowser) throw new Error('writeImages: PNGs need withBrowser (pipeline/chrome.mjs)');
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    for (const m of made) {
      const svg = fs.readFileSync(m.svg, 'utf8');
      await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`);
      m.png = imageFile(out, m.name, look, 'png');
      await page.screenshot({ path: m.png, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    }
    await page.close();
  });
  return made;
}
