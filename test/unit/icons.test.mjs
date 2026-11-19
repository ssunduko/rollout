import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SANDBOX } from '../helpers.mjs';
import {
  lucideVersion, resolveIcon, searchIcons, iconPaths, iconSvg, expandLucide, usesLucide, LUCIDE_CSS,
  LOOKS, brandColor, imageSvg, writeImages, imageFile,
} from '../../pipeline/icons.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { scenePage } from '../../pipeline/scenes.mjs';
import { renderHash, loadScene, sceneDir, sceneFile } from '../../pipeline/library.mjs';
import { writeJson } from '../../pipeline/env.mjs';

const brand = loadBrand(); // brand/example, from .env.example

test('the bundled set: a version, the whole Lucide set, and its licence beside it', () => {
  assert.match(lucideVersion(), /^\d+\.\d+\.\d+$/);
  const data = JSON.parse(fs.readFileSync(new URL('../../pipeline/lucide/lucide.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(data.icons).length > 1500);
  assert.ok(fs.existsSync(new URL('../../pipeline/lucide/LICENSE-lucide.txt', import.meta.url)));
});

test('resolveIcon: canonical names, old names through aliases, null for none', () => {
  assert.equal(resolveIcon('message-square'), 'message-square');
  const data = JSON.parse(fs.readFileSync(new URL('../../pipeline/lucide/lucide.json', import.meta.url), 'utf8'));
  const [alias, target] = Object.entries(data.aliases).find(([, t]) => data.icons[t]);
  assert.equal(resolveIcon(alias), target);
  assert.equal(resolveIcon('no-such-icon-anywhere'), null);
});

test('searchIcons: every word must match; exact and name matches rank above tags', () => {
  assert.equal(searchIcons('phone')[0].name, 'phone');
  const chat = searchIcons('chat message').map((i) => i.name);
  assert.ok(chat.length > 0 && chat.every((n) => n.includes('message')), chat.join(','));
  assert.deepEqual(searchIcons(''), []);
  assert.deepEqual(searchIcons('zzzz-nothing'), []);
  assert.equal(searchIcons('arrow', 3).length, 3);
});

test('iconPaths / iconSvg: Lucide paths in a 24 box, stroked in currentColor; unknown names suggest others', () => {
  assert.ok(iconPaths('phone').length >= 1);
  const svg = iconSvg('phone');
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /stroke-width="2"/);
  assert.doesNotMatch(svg, / width="/, 'no fixed size: the holder sizes it');
  assert.match(iconSvg('phone', { size: 32, color: '#123456' }), /width="32" height="32".*stroke="#123456"/);
  assert.throws(() => iconPaths('phonee'), /no Lucide icon "phonee" — try .*phone/);
});

test('expandLucide: fills <i>/<span data-lucide> with the icon, keeps attributes, lists icons once', () => {
  const { markup, used } = expandLucide(
    '<i class="accent" data-lucide="phone" style="width:24px"></i><span data-lucide=\'bot\'></span><i data-lucide="phone"></i><i data-icon="check"></i>',
  );
  assert.deepEqual(used, ['phone', 'bot']);
  assert.match(markup, /<i class="accent" data-lucide="phone" style="width:24px"><svg [^>]*viewBox="0 0 24 24"/);
  assert.match(markup, /<span data-lucide='bot'><svg/);
  assert.match(markup, /<i data-icon="check"><\/i>/, 'kit icons are the runtime\'s');
  assert.equal(expandLucide('<p>no icons</p>').used.length, 0);
  assert.throws(() => expandLucide('<i data-lucide="nope-nope"></i>'), /no Lucide icon "nope-nope"/);
  assert.equal(usesLucide('<i data-lucide="x"></i>'), true);
  assert.equal(usesLucide('<i data-icon="x"></i>'), false);
});

function kitScene(id, html) {
  writeJson(sceneFile(id), { id, title: id, tags: [], size: { width: 200, height: 100 } });
  fs.writeFileSync(path.join(sceneDir(id), 'scene.html'), html);
  return loadScene(id);
}

test('scenePage draws Lucide icons with their CSS; only when used', () => {
  const page = scenePage(kitScene('icons-test--uses', '<div><i data-lucide="calendar-clock"></i></div>'), brand);
  assert.match(page, /data-lucide="calendar-clock"><svg/);
  assert.ok(page.includes(LUCIDE_CSS));
  const plain = scenePage(kitScene('icons-test--plain', '<div><i data-icon="check"></i></div>'), brand);
  assert.ok(!plain.includes(LUCIDE_CSS));
  assert.throws(() => scenePage(kitScene('icons-test--bad', '<i data-lucide="nope-nope"></i>'), brand), /no Lucide icon/);
});

test('renderHash: a scene using Lucide includes the set\'s version; others are unchanged by it', () => {
  const settings = { stillScale: 2 };
  const a = kitScene('icons-test--hash-a', '<i data-lucide="phone"></i>');
  const b = kitScene('icons-test--hash-b', '<i data-icon="phone"></i>');
  assert.match(renderHash(a, brand, settings), /^[0-9a-f]{16}$/);
  assert.equal(renderHash(b, brand, settings), renderHash(b, brand, settings));
  assert.notEqual(renderHash(a, brand, settings), renderHash(b, brand, settings));
});

test('brandColor: brand keys and literal hex; unknown keys list the brand\'s', () => {
  assert.equal(brandColor(brand, 'primary'), brand.colors.primary);
  assert.equal(brandColor(brand, '#AbC'), '#AbC');
  assert.throws(() => brandColor(brand, 'chartreuse'), /no brand colour "chartreuse" — the brand has .*primary/);
});

test('imageSvg: each look in the brand\'s colours, the icon centred and scaled', () => {
  const c = brand.colors;
  const line = imageSvg('phone', brand, { look: 'line', size: 256 });
  assert.match(line, /viewBox="0 0 256 256" width="256" height="256"/);
  assert.ok(line.includes(`stroke="${c.primary}"`));
  assert.doesNotMatch(line, /<rect|<circle cx="128"/);

  const tile = imageSvg('phone', brand, { look: 'tile', size: 256 });
  assert.ok(tile.includes(`<rect width="256" height="256" rx="56" fill="${c.heroTint}"/>`));
  assert.ok(tile.includes(`stroke="${c.primary}"`));

  const solid = imageSvg('phone', brand, { look: 'solid', size: 256 });
  assert.ok(solid.includes(`fill="${c.primary}"`) && solid.includes(`stroke="${c.white}"`));

  const circle = imageSvg('phone', brand, { look: 'circle', size: 256 });
  assert.ok(circle.includes(`<circle cx="128" cy="128" r="128" fill="${c.heroTint}"/>`));

  // the icon box: inset on every side, scaled from 24
  const pad = 256 * LOOKS.tile.inset;
  assert.ok(tile.includes(`translate(${pad} ${pad}) scale(${Math.round(((256 - 2 * pad) / 24) * 10000) / 10000})`));

  const custom = imageSvg('phone', brand, { look: 'tile', fg: 'navy', bg: '#ffffff' });
  assert.ok(custom.includes(`stroke="${c.navy}"`) && custom.includes('fill="#ffffff"'));
});

test('imageSvg refuses unknown looks, icons and sizes', () => {
  assert.throws(() => imageSvg('phone', brand, { look: 'neon' }), /no look "neon" — line, tile, solid, circle/);
  assert.throws(() => imageSvg('nope-nope', brand), /no Lucide icon/);
  assert.throws(() => imageSvg('phone', brand, { size: 8 }), /16 to 4096/);
  assert.throws(() => imageSvg('phone', brand, { size: 100.5 }), /whole number/);
});

test('writeImages (SVG only): one file per icon, canonical names, duplicates once', async () => {
  const out = path.join(SANDBOX, 'output', 'images-unit');
  const made = await writeImages(['phone', 'phone', 'bot'], brand, { look: 'circle', size: 64, out, png: false });
  assert.deepEqual(made.map((m) => m.name), ['phone', 'bot']);
  for (const m of made) {
    assert.equal(m.svg, imageFile(out, m.name, 'circle', 'svg'));
    assert.match(fs.readFileSync(m.svg, 'utf8'), /^<svg xmlns/);
    assert.equal(m.png, null);
  }
  await assert.rejects(writeImages(['phone'], brand, { out, png: true }), /need withBrowser/);
  await assert.rejects(writeImages(['phone'], brand, { png: false }), /no output folder/);
});
