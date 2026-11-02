import '../setup.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SANDBOX, ROOT } from '../helpers.mjs';
import { loadBrand, brandCss, brandForFeature, brandFontFiles } from '../../pipeline/brand.mjs';

const EXAMPLE = path.join(ROOT, 'brand', 'example');
const OVERRIDES = ['BRAND_NAME', 'BRAND_PHONE', 'BRAND_WEBSITE', 'BRAND_WEBSITE_LABEL', 'BRAND_EMAIL', 'BRAND_COLOR_PRIMARY', 'BRAND_COLOR_HEROTINT'];
afterEach(() => { for (const k of OVERRIDES) delete process.env[k]; });

// a brand folder in the sandbox, from a brand.json object and optional files
function brandDir(name, json, files = {}) {
  const dir = path.join(SANDBOX, 'brands', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify(json));
  for (const [f, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), content);
  }
  return dir;
}

test('loads the example brand: identity, colours, fonts, logos', () => {
  const b = loadBrand();
  assert.equal(b.id, 'example');
  assert.equal(b.name, 'Acme Cloud');
  assert.equal(b.websiteLabel, 'acme.example');
  assert.equal(b.colors.primary, '#5b4cf5');
  assert.equal(b.fonts.display.family, 'Inter Display');
  assert.equal(b.fonts.body.faces.length, 4);
  for (const f of b.fonts.body.faces) assert.ok(fs.existsSync(f.path));
  assert.match(b.logo.primary, /^<svg/);
  assert.doesNotMatch(b.logo.primary, /<\?xml/);
  assert.match(b.hash, /^[0-9a-f]{12}$/);
});

test('a missing brand.json names BRAND_DIR', () => {
  assert.throws(() => loadBrand(path.join(SANDBOX, 'nope')), /no brand sidecar.*BRAND_DIR/s);
});

test('a minimal brand gets the neutral defaults', () => {
  const b = loadBrand(brandDir('minimal', {}));
  assert.equal(b.id, 'minimal');
  assert.equal(b.name, 'Your Company');
  assert.equal(b.colors.primary, '#2563eb');
  assert.equal(b.fonts.body.family, 'Arial');
  assert.equal(b.fonts.display.family, 'Arial');
  assert.deepEqual(b.fonts.body.faces, []);
  assert.equal(b.logo.primary, '');
  assert.deepEqual(b.social, []);
  assert.equal(b.web, null);
});

test('BRAND_* variables override brand.json', () => {
  process.env.BRAND_NAME = 'Other Co';
  process.env.BRAND_PHONE = '555';
  process.env.BRAND_COLOR_PRIMARY = '#000001';
  process.env.BRAND_COLOR_HEROTINT = '#000002';
  const b = loadBrand();
  assert.equal(b.name, 'Other Co');
  assert.equal(b.phone, '555');
  assert.equal(b.colors.primary, '#000001');
  assert.equal(b.colors.heroTint, '#000002');
});

test('the render hash follows the look, not the contact details', () => {
  const base = loadBrand().hash;
  process.env.BRAND_PHONE = '123';
  assert.equal(loadBrand().hash, base);
  process.env.BRAND_COLOR_PRIMARY = '#123456';
  assert.notEqual(loadBrand().hash, base);
});

test('font faces whose file is missing are dropped', () => {
  const b = loadBrand(brandDir('fonts', {
    fonts: { body: { family: 'X Sans', faces: [{ weight: 400, file: 'x.woff2' }, { weight: 700, file: 'missing.woff2' }] } },
  }, { 'x.woff2': 'data' }));
  assert.equal(b.fonts.body.faces.length, 1);
  assert.equal(b.fonts.display.family, 'X Sans'); // display falls back to body
  assert.equal(b.fonts.body.weight, 700);
});

test('raster logos are embedded as data URIs; websiteLabel derived from website', () => {
  const b = loadBrand(brandDir('raster', { website: 'https://www.foo.example/', logos: { primary: 'logo.png' } }, { 'logo.png': Buffer.from([0x89, 0x50]) }));
  assert.match(b.logo.primary, /^<img src="data:image\/png;base64,/);
  assert.equal(b.logo.reversed, b.logo.primary); // reversed and icon fall back to primary
  assert.equal(b.websiteLabel, 'foo.example');
});

test('icons are recoloured to currentColor', () => {
  const b = loadBrand(brandDir('icons', { icons: { dot: 'dot.svg' } }, { 'dot.svg': '<?xml version="1.0"?><svg><path fill="#FF0000"/></svg>' }));
  assert.equal(b.icon('dot'), '<svg><path fill="currentColor"/></svg>');
  assert.equal(b.icon('unknown'), '');
});

test('brandCss: @font-face per face and a custom property per colour', () => {
  const b = loadBrand();
  const css = brandCss(b, { fontUrl: (p) => `fonts/${path.basename(p)}` });
  assert.equal((css.match(/@font-face/g) ?? []).length, 5);
  assert.match(css, /src:url\("fonts\/Inter-Regular\.woff2"\)/);
  assert.match(css, /--primary:#5b4cf5;/);
  assert.match(css, /--primary-dark:#4636e0;/);
  assert.match(css, /--hero-tint:#dcd8ff;/);
  assert.match(css, /--font-display:"Inter Display", Inter, Arial;/);
  assert.match(css, /--display-weight:700;/);
  assert.match(brandCss(b), /src:url\("file:\/\//); // default: file URLs
});

test('brandFontFiles: each font file once', () => {
  const files = brandFontFiles(loadBrand());
  assert.equal(files.length, 5);
  assert.equal(new Set(files).size, files.length);
});

test('brandForFeature: BRAND_DIR unless feature.json names a brand', () => {
  assert.equal(brandForFeature('smart-scheduling').id, 'example');
  assert.equal(brandForFeature('no-such-feature').id, 'example');
  const dir = path.join(SANDBOX, 'input', 'branded');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'feature.json'), JSON.stringify({ brand: path.relative(ROOT, EXAMPLE) }));
  assert.equal(brandForFeature('branded').dir, EXAMPLE); // a path, relative to the repo
  fs.writeFileSync(path.join(dir, 'feature.json'), JSON.stringify({ brand: 'example' }));
  assert.equal(brandForFeature('branded').dir, EXAMPLE); // a folder name under brand/
  fs.writeFileSync(path.join(dir, 'feature.json'), JSON.stringify({ brand: 'no-such-brand' }));
  assert.throws(() => brandForFeature('branded'), /no brand sidecar/);
});
