// Capture: log into the real application and record a feature's moment as a
// GIF, plus a high-resolution still, plus the web page's GIF (web.gif): the
// same recording, zoomed into its own region and framed (webmedia.mjs).
//
// How it works: Chrome runs with a persistent profile (so an SSO session
// survives between runs) or signs in through the login form off camera; setup
// steps put the app in the starting state; then a CDP screencast records while
// the steps run with eased, human-paced mouse moves. The cursor is a DOM overlay injected into every
// page, so it is in the frames themselves — headless Chrome draws none.
//
// A capture scene (library/scenes/<id>/scene.json, "source": "capture"):
//   target     targets/<name>.json (default: the feature's, then CAPTURE_TARGET)
//   start      URL to open first, relative to the app ({secret} placeholders allowed)
//   viewport   override of the target's viewport
//   setup      steps run before recording (navigate, close popups) — off camera
//   steps      steps run while recording
//   clip       a selector (its box at the still moment, plus pad), a rect
//              {x,y,width,height} in CSS px, or "viewport"
//   pad        px around a selector clip (default 16)
//   aspect     crop the clip to width/height (the PDF panel is ~1.26)
//   anchor     which part of the clip an aspect crop keeps: top | center | bottom
//   web        the web page's GIF, cut from the same recording:
//                clip   selector or rect the region is cut from; without it
//                       the region is centred (vertically) on where the
//                       recorded steps point (clicks, hovers, typing) and
//                       keeps the clip's left edge, inside the clip
//                pad    px around a selector (default 16)
//                width  CSS px of the region shown; less = more zoom
//                       (default 600, or wider to fit every point)
//                align  with clip: top-left (default) | top | center
//              the region always has the web canvas's shape (1180x676) and
//              may bleed off the UI's right and bottom edges, as feature
//              pages show it
//   hide/blur  extra selectors to hide / blur for this scene
//   holdEnd    ms to keep recording after the last step (default 1200)
//
// Steps: open {url} · wait {sel} · waitGone {sel} · click {sel} · hover {sel}
// · move {to: sel | [x,y]} · type {sel, text | secret} · press {key}
// · scroll {sel?, dy} · hold {ms} · ifAppears {sel, timeout, then: [steps]}
// · still (take the still here; default: after the last step)
// Selectors: puppeteer selectors (CSS, ::-p-text(...), ::-p-aria(...)) or
// "btn:Exact text|Alt text" for a visible button, link or menu item by its text.
//
// Live data: a step that sends, creates, edits or deletes must say
// "mutates": true, and capture refuses it unless --allow-mutations is passed —
// which only happens after the user has said yes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { env, envNumber, writeJson } from './env.mjs';
import { resolveChrome } from './chrome.mjs';
import { fillSecrets, requireCredentials } from './target.mjs';
import { encodeWebGif, webSettings } from './webmedia.mjs';

const FFMPEG = env('FFMPEG', 'ffmpeg');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export const captureSettings = () => ({
  scale: envNumber('CAPTURE_SCALE', 2),
  gifFps: envNumber('GIF_FPS', 12),
  gifWidth: envNumber('GIF_WIDTH', 800),
  maxWaitMs: envNumber('CAPTURE_MAX_WAIT_MS', 700),
});

// ---- the cursor overlay, injected into every document ----
function cursorOverlay() {
  const SVG = '<svg viewBox="0 0 30 30" width="26" height="26" xmlns="http://www.w3.org/2000/svg"><path d="M4 2.5l21 9.6-9.2 2.6L11.6 24 4 2.5z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
  const install = () => {
    if (document.getElementById('__rc_cursor') || !document.documentElement) return;
    const style = document.createElement('style');
    style.textContent = `#__rc_cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 3px 4px rgba(0,0,0,.3));transition:scale .08s}
#__rc_cursor.down{scale:.86}
.__rc_ripple{position:fixed;z-index:2147483646;pointer-events:none;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid rgba(37,99,235,.9);animation:__rc 450ms ease-out forwards}
@keyframes __rc{to{transform:scale(4);opacity:0}}`;
    const c = document.createElement('div');
    c.id = '__rc_cursor';
    c.innerHTML = SVG;
    document.documentElement.append(style, c);
    const put = (x, y) => { c.style.transform = `translate(${x - 4}px,${y - 2}px)`; };
    const last = JSON.parse(sessionStorage.getItem('__rc_pos') || 'null');
    if (last) put(last[0], last[1]); else c.style.transform = 'translate(-60px,-60px)';
    addEventListener('mousemove', (e) => { put(e.clientX, e.clientY); sessionStorage.setItem('__rc_pos', JSON.stringify([e.clientX, e.clientY])); }, true);
    addEventListener('mousedown', (e) => {
      c.classList.add('down');
      const r = document.createElement('div');
      r.className = '__rc_ripple';
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.documentElement.append(r);
      setTimeout(() => r.remove(), 500);
    }, true);
    addEventListener('mouseup', () => c.classList.remove('down'), true);
  };
  if (document.documentElement) install();
  document.addEventListener('DOMContentLoaded', install);
}

function cssInjector(css) {
  const add = () => {
    if (!document.documentElement || document.querySelector('style[data-rc-css]')) return;
    const s = document.createElement('style');
    s.dataset.rcCss = '1';
    s.textContent = css;
    document.documentElement.appendChild(s);
  };
  add();
  document.addEventListener('DOMContentLoaded', add);
}

// ---- session ----

export async function openSession(target, { headless = env('CAPTURE_HEADLESS', 'true') !== 'false', viewport, hide = [], blur = [], scale = 1 } = {}) {
  const vp = viewport ?? target.viewport;
  fs.mkdirSync(target.profile, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: resolveChrome(),
    headless,
    userDataDir: target.profile,
    defaultViewport: null,
    args: [`--window-size=${vp.width},${vp.height + 90}`, '--no-first-run', '--no-default-browser-check', '--hide-crash-restore-bubble', '--disable-session-crashed-bubble', '--force-device-scale-factor=1'],
  });
  const page = (await browser.pages())[0] ?? (await browser.newPage());
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: scale });
  const cdp = await page.createCDPSession();

  if (target.blockUrls.length) {
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: target.blockUrls });
  }
  const hideAll = [...target.hideSelectors, ...hide];
  const blurAll = [...target.blurSelectors, ...blur];
  const css = [
    hideAll.length ? `${hideAll.join(',\n')} { display: none !important; }` : '',
    blurAll.length ? `${blurAll.join(',\n')} { filter: blur(6px) !important; }` : '',
  ].join('\n');
  if (css.trim()) await page.evaluateOnNewDocument(cssInjector, css);
  await page.evaluateOnNewDocument(cursorOverlay);
  // no red spell-check underline under text the steps type: off for the whole
  // document (inherited by every field that does not set its own), and on
  // fields that do
  await page.evaluateOnNewDocument(() => {
    const off = () => {
      document.documentElement.spellcheck = false;
      document.querySelectorAll('[spellcheck="true"]').forEach((el) => { el.spellcheck = false; });
    };
    document.addEventListener('DOMContentLoaded', off);
    document.addEventListener('focusin', (e) => { if (e.target instanceof HTMLElement) e.target.spellcheck = false; }, true);
  });

  // Close cleanly: Chrome writes cookies lazily, and a hard kill can sign the
  // profile out — which breaks every app whose login cannot be scripted.
  const close = async () => {
    await Promise.race([browser.close(), sleep(10000)]).catch(() => {});
  };
  return { browser, page, cdp, viewport: vp, close };
}

// ---- element lookup ----

const clickableFn = (text) => {
  const wanted = text.split('|');
  const els = [...document.querySelectorAll('button, a, [role="menuitem"], [role="button"], [role="tab"], [role="option"], [role="switch"]')];
  return (
    els.find((e) => {
      const t = (e.textContent || '').trim();
      const al = (e.getAttribute('aria-label') || '').trim();
      const imgAlt = (e.querySelector('img[alt]')?.getAttribute('alt') || '').trim();
      return wanted.some((w) => t === w || al === w || imgAlt === w) && e.getClientRects().length > 0;
    }) || false
  );
};

async function findOnce(page, spec) {
  try {
    if (spec.startsWith('btn:')) {
      const h = await page.evaluateHandle(clickableFn, spec.slice(4));
      const el = h.asElement();
      if (el) return el;
      await h.dispose();
      return null;
    }
    const el = await page.$(spec);
    if (!el) return null;
    return (await el.isVisible().catch(() => false)) ? el : null;
  } catch {
    return null;
  }
}

async function waitFor(page, spec, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const el = await findOnce(page, spec);
    if (el) return el;
    await sleep(200);
  }
  throw new Error(`timeout after ${timeout}ms waiting for ${spec} at ${page.url()}`);
}

async function waitGone(page, spec, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (!(await findOnce(page, spec))) return;
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${spec} to disappear`);
}

// ---- sign-in ----

export async function signIn(session, target, { start } = {}) {
  const { page } = session;
  const s = target.auth.selectors;
  const url = new URL(fillSecrets(target, start ?? target.startUrl), target.app).href;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

  if (target.auth.mode === 'form') {
    // which screen are we on: the login form, or already the app?
    const end = Date.now() + 20000;
    let state = null;
    while (!state && Date.now() < end) {
      if (s.username && (await findOnce(page, s.username))) state = 'login';
      else if (s.signInLink && (await findOnce(page, s.signInLink))) state = 'link';
      else if (s.signedIn && (await findOnce(page, s.signedIn))) state = 'app';
      else await sleep(250);
    }
    if (state === 'link') {
      (await findOnce(page, s.signInLink)).click();
      await waitFor(page, s.username, 20000);
      state = 'login';
    }
    if (state === 'login') {
      const creds = requireCredentials(target);
      const field = async (spec, text) => {
        const el = await waitFor(page, spec, 15000);
        await el.click({ count: 3 });
        await page.keyboard.type(String(text), { delay: 5 }); // never logged
      };
      await field(s.username, creds.username);
      if (s.password) await field(s.password, creds.password);
      if (s.submit) await (await waitFor(page, s.submit)).click();
      else await page.keyboard.press('Enter');
      if (s.signedIn) {
        // either the app loads, or the form is still there (rejected credentials)
        const submitted = Date.now();
        for (;;) {
          if (await findOnce(page, s.signedIn)) break;
          if (Date.now() - submitted > 4000 && (await findOnce(page, s.username))) {
            throw new Error(`sign-in to ${target.name} failed: still on the login form after submitting (${page.url()}). Check the credentials (auth.username / auth.password).`);
          }
          if (Date.now() - submitted > 45000) throw new Error(`sign-in to ${target.name}: ${s.signedIn} never appeared after submitting (${page.url()})`);
          await sleep(250);
        }
      }
      else await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      // sign-in redirects to the app's landing page; go back to the start
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
  }

  if (s.signedIn) {
    try {
      await waitFor(page, s.signedIn, 30000);
    } catch {
      throw new Error(
        `not signed in to ${target.name} (${s.signedIn} never appeared at ${page.url()}).` +
          (target.auth.mode === 'none' ? ` Sign in once by hand: node pipeline/rollout.mjs login ${target.name}` : ' Check the credentials and auth.selectors.'),
      );
    }
  }
}

// ---- steps ----

function makeActor(session, target, log) {
  const { page, viewport } = session;
  const cursor = { x: viewport.width * 0.82, y: viewport.height * 0.9 };

  async function moveTo(x, y) {
    const dist = Math.hypot(x - cursor.x, y - cursor.y);
    const dur = Math.max(350, Math.min(1000, dist * 0.8));
    const n = Math.max(2, Math.round(dur / 30));
    const from = { ...cursor };
    for (let i = 1; i <= n; i++) {
      const k = ease(i / n);
      cursor.x = from.x + (x - from.x) * k;
      cursor.y = from.y + (y - from.y) * k;
      await page.mouse.move(cursor.x, cursor.y);
      await sleep(30);
    }
    log.points?.push({ x, y });
  }

  async function centre(spec, timeout) {
    const el = await waitFor(page, spec, timeout);
    let box = await el.boundingBox();
    if (!box) throw new Error(`no box for ${spec}`);
    if (box.y < 0 || box.y + box.height > viewport.height) {
      await el.evaluate((n) => n.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      await sleep(700);
      box = await el.boundingBox();
    }
    return { el, x: box.x + Math.min(box.width / 2, 60), y: box.y + Math.min(box.height / 2, 120) };
  }

  const timed = async (kind, fn) => {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      log.waits.push({ kind, start, end: Date.now() });
    }
  };

  async function run(steps) {
    for (const s of steps) {
      switch (s.op) {
        case 'open':
          await timed('open', () => page.goto(new URL(fillSecrets(target, s.url), target.app).href, { waitUntil: 'domcontentloaded', timeout: 45000 }));
          await page.mouse.move(cursor.x, cursor.y); // re-sync the overlay on the new document
          await sleep(300);
          break;
        case 'wait':
          await timed('wait', () => waitFor(page, s.sel, s.timeout));
          break;
        case 'waitGone':
          await timed('waitGone', () => waitGone(page, s.sel, s.timeout));
          break;
        case 'hover':
        case 'move': {
          const to = s.to ?? s.sel;
          if (Array.isArray(to)) await moveTo(to[0], to[1]);
          else { const c = await centre(to, s.timeout); await moveTo(c.x, c.y); }
          break;
        }
        case 'click': {
          const c = await centre(s.sel, s.timeout);
          await moveTo(c.x, c.y);
          await sleep(350);
          await page.mouse.down();
          await sleep(80);
          await page.mouse.up();
          await sleep(250);
          break;
        }
        case 'type': {
          const text = s.secret ? target.secrets[s.secret] : s.text;
          if (text == null) throw new Error(`type into ${s.sel}: nothing to type${s.secret ? ` (secret "${s.secret}" not set)` : ''}`);
          const c = await centre(s.sel, s.timeout);
          await moveTo(c.x, c.y);
          await sleep(250);
          await page.mouse.down();
          await sleep(60);
          await page.mouse.up();
          await sleep(250);
          // refuse to type into whatever else took the click
          const focused = await c.el.evaluate((n) => n === document.activeElement || n.contains(document.activeElement)).catch(() => false);
          if (!focused) throw new Error(`clicking ${s.sel} did not focus it — refusing to type`);
          if (s.clear !== false) {
            const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
            await page.keyboard.down(mod);
            await page.keyboard.press('KeyA');
            await page.keyboard.up(mod);
          }
          for (const ch of String(text)) {
            await page.keyboard.type(ch);
            await sleep(s.delay ?? 45);
          }
          await sleep(200);
          break;
        }
        case 'press':
          await page.keyboard.press(s.key);
          await sleep(200);
          break;
        case 'scroll': {
          if (s.sel) { const c = await centre(s.sel); await moveTo(c.x, c.y); }
          const chunks = Math.max(1, Math.round(Math.abs(s.dy) / 40));
          for (let i = 0; i < chunks; i++) { await page.mouse.wheel({ deltaY: Math.sign(s.dy) * 40 }); await sleep(35); }
          await sleep(300);
          break;
        }
        case 'hold':
          await sleep(s.ms ?? 800);
          break;
        case 'ifAppears': {
          const end = Date.now() + (s.timeout ?? 1500);
          let found = false;
          while (!found && Date.now() < end) { found = Boolean(await findOnce(page, s.sel)); if (!found) await sleep(200); }
          if (found) await run(s.then ?? []);
          break;
        }
        case 'still':
          await log.onStill();
          break;
        default:
          throw new Error(`unknown step op "${s.op}"`);
      }
    }
  }
  return { run, cursor };
}

export function checkMutations(scene, allow) {
  const walk = (steps = []) => steps.flatMap((s) => [s, ...walk(s.then)]);
  const risky = walk([...(scene.setup ?? []), ...(scene.steps ?? [])]).filter((s) => s.mutates);
  if (risky.length && !allow) {
    throw new Error(
      `scene ${scene.id} has ${risky.length} step(s) marked "mutates" (${risky.map((s) => `${s.op} ${s.sel ?? s.url ?? ''}`).join('; ')}). ` +
        'They change live data. Re-run with --allow-mutations only after the user has approved it.',
    );
  }
}

// ---- clip ----

// "viewport", a rect, or a selector's box plus pad — in CSS px.
async function resolveRect(page, c, pad, viewport) {
  if (c === 'viewport') return { x: 0, y: 0, width: viewport.width, height: viewport.height };
  if (typeof c === 'object') return { ...c };
  const el = await findOnce(page, c);
  if (!el) throw new Error(`clip ${c} not found at the still moment`);
  const b = await el.boundingBox();
  return { x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad };
}

async function measureClip(page, scene, viewport) {
  const r = await resolveRect(page, scene.clip ?? 'viewport', scene.pad ?? 16, viewport);
  // aspect (width / height): bring the clip to that shape — the PDF panel is
  // about 1.26. Never by cutting the sides (labels and badges live there): a
  // tall clip is cropped, keeping its top, centre or bottom (anchor); a wide one
  // is extended with the page below it (above, for anchor "bottom").
  if (scene.aspect) {
    const h = r.width / scene.aspect;
    const anchor = scene.anchor ?? 'top';
    if (h < r.height) r.y += anchor === 'bottom' ? r.height - h : anchor === 'center' ? (r.height - h) / 2 : 0;
    else if (anchor === 'bottom') r.y -= h - r.height;
    else if (anchor === 'center') r.y -= (h - r.height) / 2;
    r.height = h;
  }
  const x = Math.max(0, Math.round(r.x));
  const y = Math.max(0, Math.round(r.y));
  return { x, y, width: Math.min(viewport.width - x, Math.round(r.width)), height: Math.min(viewport.height - y, Math.round(r.height)) };
}

// The web GIF's region: the canvas's shape, zoomed to `width` CSS px. With
// web.clip, cut from that box (measured at the still moment); otherwise
// centred on the points the steps moved the cursor to, kept inside the clip.
function placeWebClip(scene, viewport, clip, webBase, points) {
  const w = scene.web ?? {};
  const s = webSettings();
  const aspect = s.width / s.height;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const spread = points.length ? Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * aspect) + 160 : 0;
  let width = Math.min(w.width ?? Math.max(600, spread), viewport.width);
  let height = width / aspect;
  if (height > viewport.height) { height = viewport.height; width = height * aspect; }
  let x;
  let y;
  let inside = { x: 0, y: 0, ...viewport };
  if (webBase) {
    const align = w.align ?? 'top-left';
    x = align === 'top-left' ? webBase.x : webBase.x + (webBase.width - width) / 2;
    y = align === 'center' ? webBase.y + (webBase.height - height) / 2 : webBase.y;
  } else {
    const focus = points.length
      ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
      : { x: clip.x + width / 2, y: clip.y + height / 2 };
    // keep the UI's left edge, as feature pages do (they bleed off the right),
    // sliding right only as far as the rightmost point needs
    x = Math.max(clip.x, (points.length ? Math.max(...xs) + 80 : 0) - width);
    y = focus.y - height / 2;
    // stay within the clip where it is big enough: outside it is UI the scene left out
    inside = { x: clip.x, y: clip.y, width: Math.max(clip.width, width), height: Math.max(clip.height, height) };
  }
  x = Math.min(Math.max(inside.x, x), inside.x + inside.width - width);
  y = Math.min(Math.max(inside.y, y), inside.y + inside.height - height);
  x = Math.min(Math.max(0, x), viewport.width - width);
  y = Math.min(Math.max(0, y), viewport.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

// ---- encoding ----

// Long waits nobody needs to watch (a page loading) are fast-forwarded to at
// most maxWaitMs, the way the video pipeline speeds up dead air.
function timeMap(waits, t0, maxWaitMs) {
  const spans = waits.map((w) => [(w.start - t0) / 1000, (w.end - t0) / 1000]).filter(([a, b]) => b - a > maxWaitMs / 1000).sort((p, q) => p[0] - q[0]);
  return (t) => {
    let out = t;
    for (const [a, b] of spans) {
      const len = b - a;
      const keep = maxWaitMs / 1000;
      if (t >= b) out -= len - keep;
      else if (t > a) out -= ((t - a) / len) * (len - keep);
    }
    return out;
  };
}

function encodeGif({ frames, t0, tEnd, waits, clip, k, settings, out }) {
  const dir = path.dirname(frames[0].file);
  const map = timeMap(waits, t0, settings.maxWaitMs);
  const rel = (f) => path.basename(f.file);
  // the screencast only sends a frame when the page repaints, so the frame on
  // screen at t0 may be older than t0: keep it, pinned to t0, as the opening frame
  const first = Math.max(0, frames.findLastIndex((f) => f.ts * 1000 <= t0));
  const kept = frames.slice(first).filter((f) => f.ts * 1000 <= tEnd).map((f, i) => (i === 0 ? { ...f, ts: Math.max(f.ts, t0 / 1000) } : f));
  if (kept.length < 2) throw new Error('capture produced fewer than 2 frames — the page did not repaint while recording');
  const lines = ['ffconcat version 1.0'];
  kept.forEach((f, i) => {
    const next = i + 1 < kept.length ? kept[i + 1].ts : tEnd / 1000;
    const d = Math.max(0.001, map(next - t0 / 1000) - map(f.ts - t0 / 1000));
    lines.push(`file '${rel(f)}'`, `duration ${d.toFixed(4)}`);
  });
  lines.push(`file '${rel(kept.at(-1))}'`);
  const list = path.join(dir, 'frames.ffconcat');
  fs.writeFileSync(list, lines.join('\n'));
  if (env('CAPTURE_DEBUG')) fs.copyFileSync(list, path.join(path.dirname(out), 'frames.ffconcat.txt'));
  const crop = `crop=${Math.round(clip.width * k)}:${Math.round(clip.height * k)}:${Math.round(clip.x * k)}:${Math.round(clip.y * k)}`;
  const width = Math.min(settings.gifWidth, Math.round(clip.width * k));
  execFileSync(
    FFMPEG,
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
      '-vf', `${crop},scale=${width}:-2:flags=lanczos,fps=${settings.gifFps},split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`,
      '-loop', '0', out],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  return list;
}

// "WxH" from a JPEG's start-of-frame marker — no process per frame.
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return 'unknown';
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return `${buf.readUInt16BE(i + 7)}x${buf.readUInt16BE(i + 5)}`;
    i += 2 + len;
  }
  return 'unknown';
}

// Capture one scene into dir: still.png, anim.gif, web.gif. Returns { size, gif, webGif }.
export async function captureScene(scene, target, dir, { allowMutations = false, log = console.log } = {}) {
  checkMutations(scene, allowMutations);
  const settings = captureSettings();
  const session = await openSession(target, { viewport: scene.viewport, hide: scene.hide, blur: scene.blur, scale: settings.scale });
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-'));
  try {
    const { page, cdp, viewport } = session;
    await signIn(session, target, { start: scene.start });
    const record = { waits: [], onStill: null };
    const actor = makeActor(session, target, record);
    await page.mouse.move(actor.cursor.x, actor.cursor.y);
    await actor.run(scene.setup ?? []);
    await sleep(500);

    const frames = [];
    let rolling = true;
    cdp.on('Page.screencastFrame', async (ev) => {
      if (rolling) {
        const file = path.join(framesDir, `f${String(frames.length).padStart(5, '0')}.jpg`);
        const data = Buffer.from(ev.data, 'base64');
        fs.writeFileSync(file, data);
        frames.push({ ts: ev.metadata.timestamp, arrived: Date.now(), file, size: jpegSize(data) });
      }
      await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
    });
    const startCast = () => cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: viewport.width * settings.scale, maxHeight: viewport.height * settings.scale }).catch(() => {});
    page.on('framenavigated', (f) => { if (rolling && f === page.mainFrame()) startCast(); });

    let clip = null;
    let webBase = null;
    // The screenshot is taken with the screencast paused: while it runs, the
    // cast delivers frames at the screenshot's size, which would break the GIF.
    const takeStill = async () => {
      clip = await measureClip(page, scene, viewport);
      if (scene.web?.clip) webBase = await resolveRect(page, scene.web.clip, scene.web.pad ?? 16, viewport);
      const paused = Date.now();
      await cdp.send('Page.stopScreencast').catch(() => {});
      // clip is in viewport px (as the screencast frames are); the screenshot
      // takes page px, so offset it by however far the page has scrolled
      const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
      await page.screenshot({ path: path.join(dir, 'still.png'), clip: { ...clip, x: clip.x + scroll.x, y: clip.y + scroll.y }, type: 'png' });
      await startCast();
      record.waits.push({ kind: 'still', start: paused, end: Date.now() }); // nothing moves meanwhile: fast-forward it
    };
    record.onStill = takeStill;

    await startCast();
    await sleep(600);
    const t0 = Date.now();
    record.points = []; // where the recorded steps point: the web cut centres on them
    await actor.run(scene.steps ?? []);
    if (!clip) await takeStill();
    await sleep(scene.holdEnd ?? 1200);
    const tEnd = Date.now();
    rolling = false;
    await cdp.send('Page.stopScreencast').catch(() => {});

    // Screencast timestamps are in seconds, but not always on Date.now()'s
    // clock (it differs between headless and headed Chrome). Align the two by
    // the smallest arrival delay seen: that frame arrived almost instantly.
    if (!frames.length) throw new Error(`scene ${scene.id}: the screencast produced no frames`);
    const offset = Math.min(...frames.map((fr) => fr.arrived - fr.ts * 1000));
    for (const fr of frames) fr.ts = (fr.ts * 1000 + offset) / 1000;
    // keep only frames at the take's own size (the most common one)
    const sizes = {};
    for (const fr of frames) sizes[fr.size] = (sizes[fr.size] ?? 0) + 1;
    const main = Object.entries(sizes).sort((a, b) => b[1] - a[1])[0][0];
    const usable = frames.filter((fr) => fr.size === main);
    const k = Number(main.split('x')[0]) / viewport.width;
    const list = encodeGif({ frames: usable, t0: t0 - 200, tEnd, waits: record.waits, clip, k, settings, out: path.join(dir, 'anim.gif') });
    const webClip = placeWebClip(scene, viewport, clip, webBase, record.points);
    const px = (r) => Object.fromEntries(Object.entries(r).map(([key, v]) => [key, Math.round(v * k)]));
    await encodeWebGif({ list, crop: px(webClip), out: path.join(dir, 'web.gif') });
    writeJson(path.join(dir, 'capture.json'), { url: page.url().replace(/[?#].*$/, ''), viewport, clip, webClip, frames: frames.length, waits: record.waits.map((w) => ({ kind: w.kind, ms: w.end - w.start })) });
    return { size: { width: clip.width, height: clip.height }, gif: true, webGif: true };
  } finally {
    if (env('CAPTURE_DEBUG')) log(`  frames kept in ${framesDir}`);
    else fs.rmSync(framesDir, { recursive: true, force: true });
    await session.close();
  }
}

// ---- probe: what is on a page, for an agent choosing selectors and clips ----

export async function probe(target, { open, setup = [], out, headless }) {
  const session = await openSession(target, { headless });
  try {
    await signIn(session, target, { start: open });
    const actor = makeActor(session, target, { waits: [], onStill: async () => {} });
    await actor.run(setup);
    await sleep(800);
    fs.mkdirSync(out, { recursive: true });
    await session.page.screenshot({ path: path.join(out, 'probe.png') });
    const elements = await session.page.evaluate(() => {
      const looksGenerated = (s) => /\d{3,}|[a-z]+-[a-f0-9]{5,}|^:r/i.test(s);
      const esc = (s) => s.replace(/"/g, '\\"');
      const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch { return 0; } };
      const out = [];
      const seen = new Set();
      const q = 'button,a[href],[role=button],[role=menuitem],[role=tab],[role=switch],[role=checkbox],[role=option],input,textarea,select,[contenteditable=true],[data-testid],[aria-label],h1,h2,h3,h4,[role=dialog],[role=region],form,section,table';
      for (const el of document.querySelectorAll(q)) {
        if (seen.has(el) || el.id === '__rc_cursor') continue;
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
        const text = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const aria = el.getAttribute('aria-label');
        const testid = el.getAttribute('data-testid');
        let suggest = null;
        if (testid) suggest = `[data-testid="${esc(testid)}"]`;
        else if (el.id && !looksGenerated(el.id)) suggest = `#${CSS.escape(el.id)}`;
        else if (aria) suggest = `[aria-label="${esc(aria)}"]`;
        else if (el.name) suggest = `${el.tagName.toLowerCase()}[name="${esc(el.name)}"]`;
        else if (el.placeholder) suggest = `[placeholder="${esc(el.placeholder)}"]`;
        else if (/^(BUTTON|A)$/.test(el.tagName) && text && text.length < 40) suggest = `btn:${text}`;
        else if (/^H\d$/.test(el.tagName) && text) suggest = `::-p-text(${text})`;
        out.push({
          tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), text, aria, testid,
          suggest, matches: suggest && !suggest.startsWith('btn:') && !suggest.startsWith('::') ? count(suggest) : null,
          box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        });
        if (out.length >= 300) break;
      }
      return { url: location.href.replace(/[?#].*$/, ''), title: document.title, viewport: { width: innerWidth, height: innerHeight }, elements: out };
    });
    writeJson(path.join(out, 'probe.json'), elements);
    return { screenshot: path.join(out, 'probe.png'), json: path.join(out, 'probe.json'), count: elements.elements.length, url: elements.url };
  } finally {
    await session.close();
  }
}

// ---- login: a person signs in once, by hand, in the target's profile ----

// Plain Chrome, not an automation-driven one: identity providers (Google SSO in
// particular) refuse to sign in to a browser that announces automation.
export async function manualLogin(target) {
  fs.mkdirSync(target.profile, { recursive: true });
  const url = new URL(fillSecrets(target, target.startUrl), target.app).href;
  console.log(`Sign in to ${target.app} in the Chrome window. When the app has loaded, close the window.\nProfile: ${target.profile}`);
  const chrome = spawn(resolveChrome(), [`--user-data-dir=${target.profile}`, '--no-first-run', '--no-default-browser-check', '--new-window', url], { stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    chrome.on('exit', resolve);
    chrome.on('error', reject);
  });
  // Chrome flushes cookies as it exits; check the session actually landed
  const session = await openSession(target);
  try {
    await signIn(session, target);
    console.log(`signed in — ${target.name} captures will use this session`);
  } finally {
    await session.close();
  }
}
