import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameSvg } from '../../pipeline/webmedia.mjs';

// The overlay drawn from this SVG is checked pixel by pixel in
// integration/webmedia.test.mjs (it needs Chrome and ffmpeg).
test('frameSvg: a white mask outside the rounded corners and a border inside', () => {
  const svg = frameSvg({ width: 608, height: 492, radius: 12, border: '#e3e7ec' });
  assert.match(svg, /width="608" height="492"/);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /stroke="#e3e7ec" stroke-width="2"/);
});
