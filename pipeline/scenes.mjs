// Scene renderer: library/scenes/<id> -> library/renders/<hash>/{still.png, anim.gif, web.gif}
// (web.gif: captures only — the web page's framed, zoomed cut; see webmedia.mjs)
//
// Two kinds of scene:
//
//   capture (scene.json "source": "capture") — the real application. capture.mjs
//   logs into the scene's target, runs its steps while a screencast records,
//   and keeps a high-resolution still of the clip. This is how feature visuals
//   are made: the GIF shows the product actually doing the thing.
//
//   kit (the default) — HTML from the scene kit (pipeline/kit/kit.css), painted
//   in the brand and made seekable by kit/runtime.js. For compositions (the
//   hero: a captured still framed with avatars) and for UI that does not exist
//   yet (coming soon). The still is one seek at stillAt; the GIF a seek per
//   frame, so the same scene always renders the same pixels.
//
// A kit scene can embed another scene's still with src="scene:<id>"; that
// scene renders first and its hash becomes part of this one's.
//
// A kit scene with a "web" field also renders the web page's version
// (web.gif): the same scene laid out again at web.size (default the web
// canvas's shape), with class "web" on <html> so the scene's CSS can set
// larger type for it, framed like a capture's web cut. The PDF keeps the
// scene's own size.
//
// Kit stills keep a transparent background (the PDF lays them on its own
// panels); kit GIF frames are filled with gifBackground, default the brand
// surface colour, because GIF transparency is one bit.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { KIT_DIR, INPUT_DIR, env, envNumber, readJson, writeJson } from './env.mjs';
import { brandCss } from './brand.mjs';
import puppeteer from 'puppeteer-core';
import { resolveChrome, settle } from './chrome.mjs';
import { loadScene, localRefs, renderHash, renderDir, rebuildIndex } from './library.mjs';
import { loadTarget, targetLook } from './target.mjs';
import { captureScene, captureSettings, checkMutations } from './capture.mjs';
import { encodeFramesWebGif, webSettings } from './webmedia.mjs';

const FFMPEG = env('FFMPEG', 'ffmpeg');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

export const renderSettings = () => ({
  stillScale: envNumber('STILL_SCALE', 2),
  gifFps: envNumber('GIF_FPS', 12),
  gifScale: envNumber('GIF_SCALE', 1),
});

const dataUri = (file) => `data:${MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'};base64,${fs.readFileSync(file).toString('base64')}`;

export const isCapture = (scene) => scene.source === 'capture';
export const sceneRefs = (scene) => (isCapture(scene) ? [] : [...new Set([...`${scene.markup}${scene.css ?? ''}`.matchAll(/scene:([a-z0-9-]+(?:--[a-z0-9-]+)?)/g)].map((m) => m[1]))]);

// The target a capture logs into: the scene's own, else its feature's
// (input/<feature>/feature.json "target"), else CAPTURE_TARGET.
export function targetNameFor(scene) {
  if (scene.target) return scene.target;
  const sidecar = path.join(INPUT_DIR, scene.feature ?? scene.id.split('--')[0], 'feature.json');
  if (fs.existsSync(sidecar)) {
    const t = readJson(sidecar).target;
    if (t) return t;
  }
  return env('CAPTURE_TARGET');
}

// The page a kit scene is rendered from. Local files, brand: and scene:
// references are inlined, so the page (kept beside the render) opens anywhere.
export function scenePage(scene, brand, stills = {}, { web = false } = {}) {
  let markup = scene.markup;
  let css = scene.css ?? '';
  for (const ref of localRefs(scene)) {
    const file = path.join(scene.dir, ref);
    if (!fs.existsSync(file)) throw new Error(`scene ${scene.id}: references ${ref}, which is not in ${scene.dir}`);
    const uri = dataUri(file);
    markup = markup.split(ref).join(uri);
    css = css.split(ref).join(uri);
  }
  markup = markup.replace(/brand:(logo-reversed|logo|icon)/g, (_, k) => {
    const file = brand.logoFiles[{ logo: 'primary', 'logo-reversed': 'reversed', icon: 'icon' }[k]] ?? brand.logoFiles.primary;
    return file ? dataUri(file) : '';
  });
  // src="scene:<id>" -> that scene's still, tagged so its box can be measured
  // (pages lay the embedded scene's GIF over that box, so the hero animates)
  markup = markup.replace(/src=(["'])scene:([a-z0-9-]+(?:--[a-z0-9-]+)?)\1/g, (_, q, id) => {
    if (!stills[id]) throw new Error(`scene ${scene.id}: embeds scene:${id}, which has no still`);
    return `data-scene="${id}" src="${dataUri(stills[id])}"`;
  });

  const { width, height } = web ? webSize(scene) : scene.size ?? { width: 640, height: 480 };
  return `<!doctype html><html${web ? ' class="web"' : ''}><head><meta charset="utf-8">
<style>${brandCss(brand)}</style>
<style>${fs.readFileSync(path.join(KIT_DIR, 'kit.css'), 'utf8')}</style>
<style>#frame{width:${width}px;height:${height}px;background:${scene.background ?? 'transparent'};}${css}</style>
</head><body><div id="frame"><div id="stage">${markup}</div></div>
<script>window.__sceneSpec=${JSON.stringify({ animation: scene.animation, cursor: scene.cursor, cursorStart: scene.cursorStart, stillAt: scene.stillAt })};</script>
<script>${fs.readFileSync(path.join(KIT_DIR, 'runtime.js'), 'utf8')}</script>
</body></html>`;
}

// The web layout's size in CSS px: web.size, else 600 px wide at the canvas's shape.
const webSize = (scene) => {
  if (scene.web?.size) return scene.web.size;
  const s = webSettings();
  return { width: 600, height: Math.round((600 * s.height) / s.width) };
};

function encodeGif(framesDir, fps, out) {
  execFileSync(
    FFMPEG,
    ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(framesDir, 'f%04d.png'),
      '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
      '-loop', '0', out],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
}

async function renderKit(browser, scene, brand, settings, dir, stills) {
  const page = await browser.newPage();
  try {
    const { width, height } = scene.size ?? { width: 640, height: 480 };
    const pageFile = path.join(dir, 'scene.page.html');
    fs.writeFileSync(pageFile, scenePage(scene, brand, stills));

    await page.setViewport({ width, height, deviceScaleFactor: settings.stillScale });
    await page.goto(pathToFileURL(pageFile).href, { waitUntil: 'load' });
    await settle(page);
    if (!(await page.evaluate(() => Boolean(window.__scene)))) throw new Error(`scene ${scene.id}: runtime did not start`);

    const frame = await page.$('#frame');
    await page.evaluate(() => window.__scene.seek(window.__scene.stillAt));
    await frame.screenshot({ path: path.join(dir, 'still.png'), omitBackground: !scene.background });

    const duration = scene.animation?.duration ?? 0;
    let gif = false;
    if (duration > 0) {
      await page.setViewport({ width, height, deviceScaleFactor: settings.gifScale });
      await page.evaluate((bg) => { document.getElementById('frame').style.background = bg; }, scene.gifBackground ?? scene.background ?? 'var(--surface)');
      await settle(page);
      const hold = scene.animation.holdEnd ?? 1200; // rest on the end state before looping
      const count = Math.ceil(((duration + hold) / 1000) * settings.gifFps);
      const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-'));
      try {
        for (let i = 0; i < count; i++) {
          await page.evaluate((t) => window.__scene.seek(t), Math.min(duration, (i * 1000) / settings.gifFps));
          await frame.screenshot({ path: path.join(framesDir, `f${String(i).padStart(4, '0')}.png`) });
        }
        encodeGif(framesDir, settings.gifFps, path.join(dir, 'anim.gif'));
        gif = true;
      } finally {
        fs.rmSync(framesDir, { recursive: true, force: true });
      }
    }
    // where each embedded scene sits, as fractions of this scene, plus the
    // corner radius of the window around it — for the animated overlay
    await page.evaluate(() => window.__scene.seek(window.__scene.stillAt));
    const embeds = await page.evaluate(() => {
      const f = document.getElementById('frame').getBoundingClientRect();
      return [...document.querySelectorAll('[data-scene]')].map((el) => {
        const r = el.getBoundingClientRect();
        const win = el.closest('.window');
        return {
          scene: el.dataset.scene,
          x: (r.left - f.left) / f.width, y: (r.top - f.top) / f.height, width: r.width / f.width, height: r.height / f.height,
          radius: win ? parseFloat(getComputedStyle(win).borderTopLeftRadius) / r.width : 0,
        };
      });
    });
    const webGif = scene.web ? await renderKitWeb(browser, scene, brand, settings, dir, stills) : false;
    return { gif, webGif, size: { width, height }, embeds };
  } finally {
    await page.close();
  }
}

// The web version of a kit scene: re-laid out at webSize, every frame (or the
// still, held) rendered at the canvas's pixel width, then framed.
async function renderKitWeb(browser, scene, brand, settings, dir, stills) {
  const page = await browser.newPage();
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-web-'));
  try {
    const { width, height } = webSize(scene);
    const pageFile = path.join(dir, 'scene.web.html');
    fs.writeFileSync(pageFile, scenePage(scene, brand, stills, { web: true }));
    await page.setViewport({ width, height, deviceScaleFactor: webSettings().width / width });
    await page.goto(pathToFileURL(pageFile).href, { waitUntil: 'load' });
    await settle(page);
    await page.evaluate((bg) => { document.getElementById('frame').style.background = bg; }, scene.gifBackground ?? scene.background ?? '#ffffff');
    const frame = await page.$('#frame');
    const duration = scene.animation?.duration ?? 0;
    const hold = scene.animation?.holdEnd ?? 1200;
    const fps = settings.gifFps;
    const count = duration > 0 ? Math.ceil(((duration + hold) / 1000) * fps) : 1;
    for (let i = 0; i < count; i++) {
      await page.evaluate((t) => window.__scene.seek(t ?? window.__scene.stillAt), duration > 0 ? Math.min(duration, (i * 1000) / fps) : null);
      await frame.screenshot({ path: path.join(framesDir, `f${String(i).padStart(4, '0')}.png`) });
    }
    await encodeFramesWebGif({ pattern: path.join(framesDir, 'f%04d.png'), fps, out: path.join(dir, 'web.gif') });
    return true;
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
    await page.close();
  }
}

// A capture's hash covers what it shows and where — never the brand (the app
// paints itself) and never credentials. --force re-captures when the app changed.
function captureHash(scene, target, settings) {
  const look = Object.fromEntries(Object.entries(scene).filter(([k]) => !['title', 'description', 'tags', 'feature', 'notes', 'forkedFrom', 'dir', 'htmlFile', 'markup', 'id'].includes(k)));
  // the engine itself too: a change in how captures are framed or encoded re-captures
  const engine = fs.readFileSync(new URL('./capture.mjs', import.meta.url));
  return crypto.createHash('sha256').update(JSON.stringify({ look, target: targetLook(target), settings })).update(engine).digest('hex').slice(0, 16);
}

// Scenes plus everything they embed, dependencies first.
function withDependencies(ids) {
  const order = [];
  const visit = (id, trail = []) => {
    if (order.includes(id)) return;
    if (trail.includes(id)) throw new Error(`scene embed cycle: ${[...trail, id].join(' -> ')}`);
    for (const dep of sceneRefs(loadScene(id))) visit(dep, [...trail, id]);
    order.push(id);
  };
  ids.forEach((id) => visit(id));
  return order;
}

// Render the scenes that need it; return { id: { hash, still, gif, size, kind } }.
export async function renderScenes(ids, brand, { force = false, allowMutations = false, log = console.log } = {}) {
  const kitSettings = renderSettings();
  const capSettings = captureSettings();
  const result = {};
  const order = withDependencies([...new Set(ids)]);

  // Check every capture's mutations up front, before any browser starts.
  for (const id of order) {
    const scene = loadScene(id);
    if (isCapture(scene)) checkMutations(scene, allowMutations);
  }

  let browser = null;
  // one browser for all kit scenes, started only if one needs rendering
  const kitBrowser = async () => browser ?? (browser = await puppeteer.launch({
    executablePath: resolveChrome(), headless: true,
    args: ['--allow-file-access-from-files', '--font-render-hinting=none', '--hide-scrollbars'],
  }));

  try {
    for (const id of order) {
      const scene = loadScene(id);
      const capture = isCapture(scene);
      const target = capture ? loadTarget(targetNameFor(scene)) : null;
      const hash = capture
        ? captureHash(scene, target, capSettings)
        : renderHash({ ...scene, embeds: sceneRefs(scene).map((d) => result[d].hash) }, brand, kitSettings);
      const dir = renderDir(hash);
      const meta = path.join(dir, 'render.json');
      const entry = { hash, dir, still: path.join(dir, 'still.png'), gif: null, webGif: null, scene, kind: capture ? 'capture' : 'kit' };
      result[id] = entry;

      if (fs.existsSync(meta) && !force) {
        const m = readJson(meta);
        entry.gif = m.gif ? path.join(dir, 'anim.gif') : null;
        entry.webGif = m.webGif ? path.join(dir, 'web.gif') : null;
        entry.size = m.size;
        entry.embeds = m.embeds ?? [];
        log(`  reuse   ${id}  (${hash})`);
        continue;
      }

      fs.mkdirSync(dir, { recursive: true });
      const t0 = Date.now();
      const stills = Object.fromEntries(sceneRefs(scene).map((d) => [d, result[d].still]));
      const out = capture
        ? await captureScene(scene, target, dir, { allowMutations, log })
        : await renderKit(await kitBrowser(), scene, brand, kitSettings, dir, stills);
      entry.gif = out.gif ? path.join(dir, 'anim.gif') : null;
      entry.webGif = out.webGif ? path.join(dir, 'web.gif') : null;
      entry.size = out.size;
      entry.embeds = out.embeds ?? [];
      writeJson(meta, {
        scene: id,
        kind: entry.kind,
        brand: capture ? null : brand.id,
        brandHash: capture ? null : brand.hash,
        target: capture ? target.name : null,
        hash,
        size: out.size,
        embeds: out.embeds ?? [],
        settings: capture ? capSettings : kitSettings,
        gif: out.gif,
        webGif: Boolean(out.webGif),
        renderedAt: new Date().toISOString(),
      });
      log(`  ${capture ? 'capture' : 'render '} ${id}  (${hash}) ${out.gif ? 'still+gif' : 'still'} in ${((Date.now() - t0) / 1000).toFixed(1)}s${capture ? `  [${target.name}]` : ''}`);
    }
  } finally {
    await browser?.close();
  }
  rebuildIndex();
  return result;
}
