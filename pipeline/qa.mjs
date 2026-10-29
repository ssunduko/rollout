// QA: measure the built outputs and take the screenshots the layout-qa agent
// reviews. Writes output/<slug>/qa/{qa.json, pdf-page-N.png,
// web-{desktop,mobile}.png (full page), web-{desktop,mobile}-fold.png (first
// screen)}. The web page is loaded over HTTP from a local server. Measured
// checks only — whether a visual matches the copy beside it is the agent's
// call, made by looking at the screenshots.
//
//   overflow   an element runs past its page, or a text column past its row
//   images     an image failed to load
//   mobile     the web page scrolls sideways at phone width
//   web        the served page: HTTP status, failed requests, script errors,
//              title/description/h1, links with no destination, missing alt,
//              the video placeholder still in place (warn), section visuals
//              fitted instead of cut for the web (warn, from build.json)
//   brief      validate() errors and warnings, the brand's copy rules included
//   copy       the copy pack's limits and copy rules (validateCopy)
//   animation  a GIF on the web page has fewer than 3 distinct frames
//   terms      a QA_FORBIDDEN_TERMS word appears in the outputs (another
//              brand's name, an internal codename)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { env, writeJson } from './env.mjs';
import { withBrowser, settle } from './chrome.mjs';
import { validateBrief } from './brief.mjs';
import { validateCopy, copyFile, copyDir } from './copy.mjs';
import { pageSize, pdfName } from './onepager.mjs';
import { sceneDir } from './library.mjs';
import { serveDir } from './serve.mjs';

export async function runQa({ slug, brief, brand, paths: p }) {
  const findings = [];
  const add = (level, check, message, where) => findings.push({ level, check, message, ...(where ? { where } : {}) });

  const v = validateBrief(slug, brand);
  v.errors.forEach((m) => add('fail', 'brief', m));
  v.warnings.forEach((m) => add('warn', 'brief', m));
  if (fs.existsSync(copyFile(slug))) {
    const c = validateCopy(slug, brief, brand);
    c.errors.forEach((m) => add('fail', 'copy', m));
    c.warnings.forEach((m) => add('warn', 'copy', m));
    if (!fs.existsSync(path.join(copyDir(slug), 'rollout-copy.md'))) add('fail', 'missing', 'copy/rollout-copy.md was not built');
  }

  const onepager = path.join(p.output, 'onepager.html');
  const web = path.join(p.web, 'index.html');
  const pdf = path.join(p.output, pdfName(brief));
  for (const f of [onepager, web, pdf]) if (!fs.existsSync(f)) add('fail', 'missing', `${path.relative(p.output, f)} was not built`);

  fs.rmSync(p.qa, { recursive: true, force: true });
  fs.mkdirSync(p.qa, { recursive: true });
  const shots = [];

  await withBrowser(async (browser) => {
    if (fs.existsSync(onepager)) {
      const size = pageSize();
      const page = await browser.newPage();
      await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1.5 });
      await page.emulateMediaType('print'); // what the PDF shows: stills, not GIFs
      await page.goto(pathToFileURL(onepager).href, { waitUntil: 'load' });
      await settle(page);
      const m = await page.evaluate(() => {
        const out = { pages: 0, overflow: [], images: [] };
        document.querySelectorAll('.page').forEach((pg, i) => {
          out.pages++;
          const box = pg.getBoundingClientRect();
          pg.querySelectorAll('h1, h2, h3, p, img, .row, .shot, .cta, .copy').forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.bottom > box.bottom + 1 || r.right > box.right + 1) out.overflow.push({ page: i + 1, el: el.className || el.tagName.toLowerCase(), by: Math.round(Math.max(r.bottom - box.bottom, r.right - box.right)) });
          });
          const rows = pg.querySelector('.rows');
          if (rows && rows.scrollHeight > rows.clientHeight + 1) out.overflow.push({ page: i + 1, el: 'rows', by: rows.scrollHeight - rows.clientHeight });
          const copy = pg.querySelector('.hero .copy');
          if (copy) {
            const last = copy.lastElementChild.getBoundingClientRect();
            const hero = pg.querySelector('.hero').getBoundingClientRect();
            if (last.bottom > hero.bottom - 8) out.overflow.push({ page: i + 1, el: 'hero intro', by: Math.round(last.bottom - hero.bottom + 8) });
          }
        });
        document.querySelectorAll('img').forEach((img) => { if (!img.naturalWidth) out.images.push(img.getAttribute('src')); });
        return out;
      });
      m.overflow.forEach((o) => add('fail', 'overflow', `PDF page ${o.page}: ${o.el} runs ${o.by}px past its box — shorten the copy on that page`, `pdf p${o.page}`));
      m.images.forEach((src) => add('fail', 'images', `PDF image did not load: ${src}`));
      const pages = await page.$$('.page');
      for (let i = 0; i < pages.length; i++) {
        const file = path.join(p.qa, `pdf-page-${i + 1}.png`);
        await pages[i].screenshot({ path: file });
        shots.push(file);
      }
      await page.close();
    }

    if (fs.existsSync(web)) {
      // over HTTP, as a host would serve it: file:// hides absolute paths and
      // anything else that only breaks once the folder is uploaded
      const { server, url } = await serveDir(p.web);
      try {
        for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
          const page = await browser.newPage();
          await page.setViewport({ width, height, deviceScaleFactor: 1 });
          const errors = [];
          const broken = [];
          page.on('pageerror', (err) => errors.push(err.message));
          // resource failures are reported from the network events below, once
          page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(msg.text()); });
          page.on('requestfailed', (req) => broken.push(`${req.url()} (${req.failure()?.errorText})`));
          // Chrome asks for /favicon.ico by itself; the page does not reference it
          page.on('response', (res) => { if (res.status() >= 400 && !res.url().endsWith('/favicon.ico')) broken.push(`${res.url()} (HTTP ${res.status()})`); });
          const res = await page.goto(url, { waitUntil: 'load' });
          if (!res?.ok()) add('fail', 'web', `the served page answered HTTP ${res?.status()} (${name})`, `web ${name}`);
          // lazy images only load when scrolled to
          await page.evaluate(async () => { document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; }); });
          await settle(page);
          const m = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            images: [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')),
            title: document.title.trim(),
            description: document.querySelector('meta[name=description]')?.content?.trim(),
            h1: document.querySelectorAll('h1').length,
            deadLinks: [...document.querySelectorAll('a')].filter((a) => !a.getAttribute('href') || a.getAttribute('href') === '#').map((a) => a.textContent.trim() || a.outerHTML.slice(0, 60)),
            noAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).map((i) => i.getAttribute('src')),
            placeholder: Boolean(document.querySelector('[data-placeholder=video]')),
          }));
          if (m.scrollWidth > width + 1) add('fail', 'mobile', `web page is ${m.scrollWidth}px wide at a ${width}px viewport (scrolls sideways)`, `web ${name}`);
          m.images.forEach((src) => add('fail', 'images', `web image did not load (${name}): ${src}`));
          const local = (u) => u.startsWith(url);
          broken.filter(local).forEach((b) => add('fail', 'web', `request failed (${name}): ${b}`, `web ${name}`));
          broken.filter((b) => !local(b)).forEach((b) => add('warn', 'web', `external request failed (${name}): ${b}`, `web ${name}`));
          errors.forEach((e) => add('fail', 'web', `script error (${name}): ${e}`, `web ${name}`));
          if (name === 'desktop') {
            if (!m.title) add('fail', 'web', 'the page has no <title>');
            if (!m.description) add('warn', 'web', 'the page has no meta description');
            if (m.h1 !== 1) add('warn', 'web', `the page has ${m.h1} <h1> elements (expected 1)`);
            m.deadLinks.forEach((l) => add('warn', 'web', `link with no destination: ${l}`));
            m.noAlt.forEach((src) => add('warn', 'web', `image without alt text: ${src}`));
            if (m.placeholder) add('warn', 'web', 'the video slot still shows the placeholder — set web.video in the brief when the video exists');
          }
          // the first screen a visitor sees, and the whole page
          const fold = path.join(p.qa, `web-${name}-fold.png`);
          await page.screenshot({ path: fold });
          const file = path.join(p.qa, `web-${name}.png`);
          await page.screenshot({ path: file, fullPage: true });
          shots.push(fold, file);
          await page.close();
        }
      } finally {
        server.close();
      }
    }
  });

  // every GIF on the web page must actually move: count its distinct frames
  const assetsDir = path.join(p.web, 'assets');
  if (fs.existsSync(assetsDir)) {
    for (const gif of fs.readdirSync(assetsDir).filter((f) => f.endsWith('.gif'))) {
      const md5 = execFileSync(env('FFMPEG', 'ffmpeg'), ['-v', 'error', '-i', path.join(assetsDir, gif), '-f', 'framemd5', '-'], { maxBuffer: 64 << 20 }).toString();
      const distinct = new Set(md5.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim())).size;
      if (distinct < 3) add('fail', 'animation', `${gif} has ${distinct} distinct frame(s) — it does not animate; check the scene's steps actually change the screen`, `web ${gif}`);
    }
  }

  const build = path.join(p.output, 'build.json');
  const fitted = fs.existsSync(build) ? JSON.parse(fs.readFileSync(build, 'utf8')).webFitted ?? [] : [];
  fitted.forEach((id) => add('warn', 'web', `${id} has no web cut of its own (kit scene or older capture); it is fitted into the frame`, `web ${id}`));

  const terms = env('QA_FORBIDDEN_TERMS', '').split(',').map((t) => t.trim()).filter(Boolean);
  if (terms.length) {
    // scene markup too: a visual can draw another brand's name
    const scenes = [brief.hero.scene, ...brief.sections.map((s) => s.scene)].map((id) => path.join(sceneDir(id), 'scene.html'));
    const copied = fs.existsSync(copyDir(slug)) ? fs.readdirSync(copyDir(slug)).map((f) => path.join(copyDir(slug), f)) : [];
    const texts = [onepager, web, path.join(p.web, 'page.json'), p.brief, copyFile(slug), ...scenes, ...copied].filter((f) => fs.existsSync(f)).map((f) => [f, fs.readFileSync(f, 'utf8').toLowerCase()]);
    for (const t of terms) for (const [f, text] of texts) if (text.includes(t.toLowerCase())) add('fail', 'terms', `"${t}" appears in ${path.relative(p.output, f)}`);
  }

  const fails = findings.filter((f) => f.level === 'fail').length;
  const report = { slug, verdict: fails ? 'FAIL' : 'PASS', fails, warns: findings.length - fails, findings, screenshots: shots.map((s) => path.relative(p.output, s)), checkedAt: new Date().toISOString() };
  writeJson(path.join(p.qa, 'qa.json'), report);
  return report;
}
