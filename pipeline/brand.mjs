// The brand sidecar, read from one place.
//
// A brand is a folder (BRAND_DIR) with a brand.json and the files it names:
// logos, icons, fonts. Every stage that paints anything — scene renders, the
// PDF, the web page — imports this, so a colour cannot end up in one output and
// not another, and no brand value is ever written into pipeline code.
//
// BRAND_* variables in .env override brand.json, so one brand folder can serve
// several deployments (a different phone number per region, say).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { BRAND_DIR, INPUT_DIR, ROOT, env } from './env.mjs';

// A neutral brand for anything brand.json leaves out.
const DEFAULT_COLORS = {
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  cta: '#16a34a',
  ink: '#111827',
  muted: '#6b7280',
  navy: '#1e293b',
  surface: '#f1f5f9',
  heroTint: '#dbeafe',
  white: '#ffffff',
  success: '#16a34a',
  danger: '#ef4444',
  warning: '#f59e0b',
};

const readSvg = (file) => {
  if (!file || !fs.existsSync(file)) return '';
  // Inlined, not <img>: an inline SVG's <text> uses the page's web fonts.
  return fs
    .readFileSync(file, 'utf8')
    .replace(/<\?xml[^>]*>/, '')
    .trim();
};

// A logo may be SVG (inlined) or a raster image (embedded as a data URI).
const RASTER = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const readMark = (file) => {
  if (!file || !fs.existsSync(file)) return '';
  const mime = RASTER[path.extname(file).toLowerCase()];
  if (!mime) return readSvg(file);
  return `<img src="data:${mime};base64,${fs.readFileSync(file).toString('base64')}" alt="">`;
};

// Monochrome icons are recoloured with CSS, so their own fills become currentColor.
const monochrome = (svg) => svg.replace(/fill="#[0-9a-f]{3,8}"/gi, 'fill="currentColor"');

export function loadBrand(dir = BRAND_DIR) {
  const file = path.join(dir, 'brand.json');
  if (!fs.existsSync(file)) {
    throw new Error(`no brand sidecar at ${file} — set BRAND_DIR in .env to a folder with a brand.json`);
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const at = (p) => (p ? path.resolve(dir, p) : null);

  const colors = { ...DEFAULT_COLORS, ...(raw.colors ?? {}) };
  for (const key of Object.keys(colors)) {
    const override = env(`BRAND_COLOR_${key.toUpperCase()}`);
    if (override) colors[key] = override;
  }

  const font = (f, fallbackFamily) => ({
    family: f?.family ?? fallbackFamily,
    weight: f?.weight ?? 700,
    fallback: f?.fallback ?? ['Arial', 'sans-serif'],
    faces: (f?.faces ?? []).map((face) => ({ ...face, path: at(face.file) })).filter((face) => face.path && fs.existsSync(face.path)),
  });
  const body = font(raw.fonts?.body, 'Arial');
  const display = font(raw.fonts?.display ?? raw.fonts?.headline ?? raw.fonts?.body, body.family);

  const logoFiles = Object.fromEntries(Object.entries(raw.logos ?? {}).map(([k, v]) => [k, at(v)]));
  const iconFiles = Object.fromEntries(Object.entries(raw.icons ?? {}).map(([k, v]) => [k, at(v)]));

  const brand = {
    dir,
    id: raw.id ?? path.basename(dir),
    name: env('BRAND_NAME', raw.name ?? 'Your Company'),
    website: env('BRAND_WEBSITE', raw.website ?? ''),
    websiteLabel: env('BRAND_WEBSITE_LABEL', raw.websiteLabel ?? (raw.website ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')),
    phone: env('BRAND_PHONE', raw.phone ?? ''),
    email: env('BRAND_EMAIL', raw.email ?? ''),
    tagline: raw.tagline ?? '',
    // copy defaults for this brand's rollouts (a feature or brief can still override them)
    pill: raw.pill ?? null,
    cta: raw.cta ?? null,
    social: raw.social ?? [],
    // defaults for the social pack's images (pipeline/social.mjs), e.g. the signature button label
    socialPack: raw.socialPack ?? {},
    nav: raw.nav ?? [],
    // the web page's site chrome (header, sign-up card, footer); see docs/brief.md
    web: raw.web ?? null,
    // the help article's fixed parts (trial link, FAQ title, closing); see docs/help.md
    help: raw.help ?? null,
    legal: raw.legal ?? [],
    voice: raw.voice ?? [],
    rules: raw.rules ?? [],
    colors,
    fonts: { body, display },
    logoFiles,
    iconFiles,
    logo: {
      primary: readMark(logoFiles.primary),
      reversed: readMark(logoFiles.reversed ?? logoFiles.primary),
      icon: readMark(logoFiles.icon ?? logoFiles.primary),
    },
    icon: (name) => monochrome(readSvg(iconFiles[name])),
  };

  // Identifies this brand's look in the render cache: change a colour or a
  // font and every scene re-renders; change a phone number and none does.
  brand.hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ colors, body: body.family, display: display.family, faces: [...body.faces, ...display.faces].map((f) => f.file) }))
    .digest('hex')
    .slice(0, 12);

  return brand;
}

const stack = (f) => [f.family, ...f.fallback].map((n) => (/\s/.test(n) ? `"${n}"` : n)).join(', ');

// The brand as CSS: @font-face rules plus custom properties. fontUrl maps a
// font file to the URL the page will load it from (file:// while rendering,
// a copied relative path in the web output).
export function brandCss(brand, { fontUrl = (p) => pathToFileURL(p).href } = {}) {
  const faces = [];
  for (const f of [brand.fonts.body, brand.fonts.display]) {
    for (const face of f.faces) {
      faces.push(
        `@font-face{font-family:"${f.family}";font-weight:${face.weight};font-style:normal;font-display:block;src:url("${fontUrl(face.path)}") format("woff2");}`,
      );
    }
  }
  const vars = Object.entries(brand.colors).map(([k, v]) => `--${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${v};`);
  return `${faces.join('\n')}
:root{${vars.join('')}
--font-body:${stack(brand.fonts.body)};
--font-display:${stack(brand.fonts.display)};
--display-weight:${brand.fonts.display.weight};}`;
}

// The brand a feature is built in: input/<slug>/feature.json "brand" (a folder
// name under brand/, or a path), else BRAND_DIR. Lets one repo roll out
// features for several brands without editing .env between them.
export function brandForFeature(slug) {
  const sidecar = path.join(INPUT_DIR, slug, 'feature.json');
  const name = fs.existsSync(sidecar) ? JSON.parse(fs.readFileSync(sidecar, 'utf8')).brand : null;
  if (!name) return loadBrand();
  return loadBrand(/[\\/]/.test(name) ? path.resolve(ROOT, name) : path.join(ROOT, 'brand', name));
}

// Every font file the brand uses, for copying next to a web page.
export const brandFontFiles = (brand) => [...new Set([...brand.fonts.body.faces, ...brand.fonts.display.faces].map((f) => f.path))];
