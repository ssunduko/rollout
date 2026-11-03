import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { frameOverlay, frameSvg } from '../../pipeline/webmedia.mjs';
import { haveChrome, haveFfmpeg, required } from '../helpers.mjs';

const CHROME = await haveChrome();
const FF = haveFfmpeg();

// The overlay's alpha channel, one byte per pixel, read back with ffmpeg.
function alpha(file, w, h) {
  const r = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: w * h * 4 + 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const a = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) a[i] = r.stdout[i * 4 + 3];
  return a;
}

test('frameSvg: a white mask outside the rounded corners and a border inside', () => {
  const svg = frameSvg({ width: 608, height: 492, radius: 12, border: '#e3e7ec' });
  assert.match(svg, /width="608" height="492"/);
  assert.match(svg, /fill-rule="evenodd"/);
  assert.match(svg, /stroke="#e3e7ec" stroke-width="2"/);
});

test('frameOverlay: transparent inside, opaque only at the edges — no band repeated across the middle', { skip: required(CHROME && FF, 'Chrome and ffmpeg') }, async () => {
  // a size whose screenshot-drawn overlay repeated its top band near the bottom
  const s = { width: 608, height: 492, radius: 12, border: '#a1b2c3' };
  const file = await frameOverlay(s);
  try {
    assert.match(file, /rollout-webframe-v2-608x492-12-a1b2c3\.png$/);
    const a = alpha(file, s.width, s.height);
    const at = (x, y) => a[y * s.width + x];
    assert.ok(at(0, 0) > 200, 'the corner is masked white');
    assert.ok(at(s.width / 2, 0) > 200, 'the top border is drawn');
    assert.ok(at(s.width / 2, s.height - 1) > 200, 'the bottom border is drawn');
    // every row strictly inside the border is clear across the middle
    for (let y = 4; y < s.height - 4; y++) {
      for (let x = 40; x < s.width - 40; x += 8) assert.equal(at(x, y), 0, `opaque pixel at ${x},${y}`);
    }
  } finally {
    fs.rmSync(file, { force: true });
  }
});
