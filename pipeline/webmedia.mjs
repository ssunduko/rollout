// The web page's section visuals: one fixed format, the way marketing-site
// feature pages show product UI — a WEB_GIF_WIDTH x WEB_GIF_HEIGHT canvas
// (default 1180x676, about 1.75:1), zoomed in on the part of the UI the
// section is about, inside a thin light-grey rounded frame that is part of the
// image (the page draws no border of its own).
//
// Captures encode it from their own screencast frames (capture.mjs, scene
// "web" field), so the zoom stays sharp. framedMedia() is the fallback for kit
// scenes and older renders: the whole visual fitted inside the same frame.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { env, envNumber } from './env.mjs';
import { withBrowser } from './chrome.mjs';

const FFMPEG = env('FFMPEG', 'ffmpeg');

export const webSettings = () => ({
  width: envNumber('WEB_GIF_WIDTH', 1180),
  height: envNumber('WEB_GIF_HEIGHT', 676),
  fps: envNumber('WEB_GIF_FPS', 20),
  border: env('WEB_FRAME_BORDER', '#e3e7ec'),
  radius: envNumber('WEB_FRAME_RADIUS', 20),
});

// The frame as a transparent PNG laid over every GIF frame: white outside the
// rounded corners, a 2px border along them. Drawn once per size and colour.
export async function frameOverlay(s = webSettings()) {
  const file = path.join(os.tmpdir(), `rollout-webframe-${s.width}x${s.height}-${s.radius}-${s.border.replace(/\W/g, '')}.png`);
  if (fs.existsSync(file)) return file;
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setViewport({ width: s.width, height: s.height, deviceScaleFactor: 1 });
    const r = s.radius;
    await page.setContent(`<html><body style="margin:0;background:transparent">
<svg width="${s.width}" height="${s.height}" xmlns="http://www.w3.org/2000/svg">
  <path fill="#fff" fill-rule="evenodd" d="M0 0H${s.width}V${s.height}H0Z M${r} 0H${s.width - r}A${r} ${r} 0 0 1 ${s.width} ${r}V${s.height - r}A${r} ${r} 0 0 1 ${s.width - r} ${s.height}H${r}A${r} ${r} 0 0 1 0 ${s.height - r}V${r}A${r} ${r} 0 0 1 ${r} 0Z"/>
  <rect x="1" y="1" width="${s.width - 2}" height="${s.height - 2}" rx="${r - 1}" fill="none" stroke="${s.border}" stroke-width="2"/>
</svg></body></html>`);
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: s.width, height: s.height } });
  });
  return file;
}

// ffmpeg filter graph: input 0 is the picture (palette from every pixel of
// every frame — "diff" mode starves UI that never moves, e.g. status chips) (already cropped/fitted to the
// canvas by `fit`), input 1 the frame overlay.
const graph = (fit, s) =>
  `[0:v]${fit},fps=${s.fps}[c];[c][1:v]overlay=0:0,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;

// Captured frames (an ffconcat list) -> the web GIF. crop is in source pixels
// and already has the canvas's aspect ratio.
export async function encodeWebGif({ list, crop, out }) {
  const s = webSettings();
  const overlay = await frameOverlay(s);
  const fit = `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${s.width}:${s.height}:flags=lanczos`;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', overlay, '-filter_complex', graph(fit, s), '-loop', '0', out], { stdio: ['ignore', 'inherit', 'inherit'] });
}

// Any GIF or still -> the web GIF, the whole visual fitted inside the frame on
// white (pad keeps it off the border). Used for kit scenes and for captures
// rendered before they made their own web GIF.
export async function framedMedia({ file, out, pad = 40 }) {
  const s = webSettings();
  const overlay = await frameOverlay(s);
  const w = s.width - 2 * pad;
  const h = s.height - 2 * pad;
  const fit = `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${s.width}:${s.height}:(ow-iw)/2:(oh-ih)/2:white`;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', file, '-i', overlay, '-filter_complex', graph(fit, s), '-loop', '0', out], { stdio: ['ignore', 'inherit', 'inherit'] });
}

// A help-article image: the GIF or still on white, pad px inside a thin
// rounded border drawn into the image (help centers keep no CSS border). size
// is the source's pixel size; pad and radius are in source pixels. Cached in
// the temp folder by content, so rebuilds give the same bytes (and hash).
export async function framedHelpImage({ file, out, size, pad, radius, border }) {
  const data = fs.readFileSync(file);
  const key = crypto.createHash('sha256').update(data).update(`${pad}|${radius}|${border}`).digest('hex').slice(0, 16);
  const cached = path.join(os.tmpdir(), `rollout-helpframe-${key}${path.extname(file)}`);
  if (!fs.existsSync(cached)) {
    const s = { width: size.width + 2 * pad, height: size.height + 2 * pad, radius, border };
    const overlay = await frameOverlay(s);
    const fit = `[0:v]pad=${s.width}:${s.height}:${pad}:${pad}:white[c];[c][1:v]overlay=0:0`;
    const args = path.extname(file) === '.gif'
      ? ['-filter_complex', `${fit},split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-loop', '0']
      : ['-filter_complex', fit, '-frames:v', '1'];
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', file, '-i', overlay, ...args, cached], { stdio: ['ignore', 'inherit', 'inherit'] });
  }
  fs.copyFileSync(cached, out);
}

// The web page's video slot until the feature video exists: the feature's
// hero composition (its screenshots and avatars) on the brand's hero
// gradient, with a play button, framed like the section GIFs (a thin
// light-grey rounded border).
export async function renderPoster({ still, out, brand, width = 1600, height = 900 }) {
  const { pathToFileURL } = await import('node:url');
  const { brandCss } = await import('./brand.mjs');
  const s = webSettings();
  const k = width / s.width; // the frame scaled from the GIF canvas
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${brandCss(brand)}
*{box-sizing:border-box}
html,body{margin:0;background:#fff}
.frame{position:relative;width:${width}px;height:${height}px;overflow:hidden;border:${Math.round(2 * k)}px solid ${s.border};border-radius:${Math.round(s.radius * k)}px;
  background:radial-gradient(120% 140% at 85% 0%,var(--hero-tint) 0%,color-mix(in srgb,var(--hero-tint) 35%,white) 50%,var(--white) 85%);
  display:flex;align-items:center;justify-content:center;padding:56px 80px}
.shot{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 18px 40px rgba(16,24,40,.14))}
.play{position:absolute;left:50%;top:50%;width:150px;height:150px;margin:-75px 0 0 -75px;border-radius:50%;background:var(--primary);
  box-shadow:0 0 0 14px color-mix(in srgb,var(--white) 70%,transparent),0 20px 50px rgba(16,24,40,.30);display:flex;align-items:center;justify-content:center}
.play::after{content:"";margin-left:12px;border-style:solid;border-width:30px 0 30px 50px;border-color:transparent transparent transparent var(--white)}
</style></head><body><div class="frame"><img class="shot" src="${pathToFileURL(still).href}"><div class="play"></div></div></body></html>`;
  const page = path.join(path.dirname(out), '.poster.html');
  fs.writeFileSync(page, html);
  try {
    await withBrowser(async (browser) => {
      const p = await browser.newPage();
      await p.setViewport({ width, height, deviceScaleFactor: 1 });
      await p.goto(pathToFileURL(page).href, { waitUntil: 'load' });
      // the screenshot decoded, then two frames painted: a capture taken
      // earlier can come back as the first raster tiles repeated
      await p.evaluate(async () => {
        await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      await p.screenshot({ path: out, captureBeyondViewport: false });
    });
  } finally {
    fs.rmSync(page, { force: true });
  }
}

// Numbered frames (a kit scene's web render, already at the canvas's shape)
// -> the web GIF, framed like a capture's web cut.
export async function encodeFramesWebGif({ pattern, fps, out }) {
  const s = webSettings();
  const overlay = await frameOverlay(s);
  const fit = `scale=${s.width}:${s.height}:flags=lanczos`;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', pattern, '-i', overlay, '-filter_complex', graph(fit, s), '-loop', '0', out], { stdio: ['ignore', 'inherit', 'inherit'] });
}
