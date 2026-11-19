// The icons command as a person or agent runs it: search, and general-purpose
// images in the brand's colours. The PNGs need Chrome (skipped without it,
// except in CI); everything else runs anywhere.

import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, haveChrome, required, SANDBOX } from '../helpers.mjs';

const images = (...p) => path.join(SANDBOX, 'output', 'images', ...p);

test('icons search lists matching Lucide icons with their tags', () => {
  const r = cli(['icons', 'search', 'phone']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^ {2}phone {2}\[/m);
  assert.match(cli(['icons', 'search', 'zzzz-nothing']).out, /no matching icons/);
});

test('icons make --svg-only: the brand\'s colours, into output/images/<brand>/<look>/', () => {
  const r = cli(['icons', 'make', 'phone', 'calendar-clock', '--look', 'solid', '--size', '128', '--svg-only']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2 solid images .*128px \(Lucide \d+\.\d+\.\d+\)/);
  const svg = fs.readFileSync(images('example', 'solid', 'phone-solid.svg'), 'utf8');
  assert.match(svg, /width="128" height="128"/);
  assert.ok(fs.existsSync(images('example', 'solid', 'calendar-clock-solid.svg')));
  assert.ok(!fs.existsSync(images('example', 'solid', 'phone-solid.png')));
});

test('icons make refuses no names, unknown icons, looks and colours', () => {
  assert.match(cli(['icons', 'make']).out, /name at least one icon/);
  assert.match(cli(['icons', 'make', 'phonee', '--svg-only']).out, /no Lucide icon "phonee" — try/);
  assert.match(cli(['icons', 'make', 'phone', '--look', 'neon', '--svg-only']).out, /no look "neon"/);
  assert.match(cli(['icons', 'make', 'phone', '--fg', 'chartreuse', '--svg-only']).out, /no brand colour "chartreuse"/);
  assert.match(cli(['icons']).out, /icons: search <words> \| make <name>/);
});

test('icons make: a PNG beside each SVG, the size asked, transparent outside the shape', { skip: required(await haveChrome(), 'Chrome') }, () => {
  const out = path.join(SANDBOX, 'output', 'icons-png');
  const r = cli(['icons', 'make', 'phone', '--look', 'circle', '--size', '96', '--out', out]);
  assert.equal(r.code, 0, r.out);
  const png = fs.readFileSync(path.join(out, 'phone-circle.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 96, 'width');
  assert.equal(png.readUInt32BE(20), 96, 'height');
  assert.equal(png[25], 6, 'RGBA, so the corners outside the circle are transparent');
});
