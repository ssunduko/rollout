// Social pack: brief + brand + library/features/<slug>/social.json + scene
// stills -> output/<slug>/assets/social/
//
// The launch images that go beside the one-pager, made from the rollout's own
// assets so they read as part of it: the brief's headline and sections,
// the hero composition and the same section stills the PDF shows, in the
// one-pager's look (hero band, soft surface panels, tinted pill).
//
//   cover      1080x1350  headline over the hero composition (carousel slide 1)
//   slide      1080x1350  one per section: step counter, a short title, the
//                         section still on a surface panel, progress dots (a
//                         body only when social.json gives one)
//   carousel   PDF        cover + slides, one page each (LinkedIn)
//   feature    1280x720   the one-pager's hero band: headline beside the hero
//                         composition
//   podcast    1280x720   the hero composition in a framed card with a play
//                         button; no headline (the episode title sits beside it)
//   youtube    1280x720   big headline, the whole hero composition on the right
//   email      1100x600   the hero band: logo, pill, headline, hero composition
//   signature  500x175    headline, CTA button, and a crop of the hero (social.json
//                         "signature": {crop}) or a kit scene id, else the hero
//
// social.json is the visual designer's sidecar (docs/social.md): which words
// of each title are accented and how each still is cropped. Everything else
// defaults to the brief and brand.json; the pack never invents copy.
//
// Stills keep the scene's own pixels; a crop is cut with ffmpeg and laid out
// at STILL_SCALE, so a 1080x1350 slide is a 2160x2700 PNG.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { env, envNumber, escapeHtml as e, featurePaths, readJson, writeJson } from './env.mjs';
import { brandCss } from './brand.mjs';
import { headlineParts } from './brief.mjs';
import { withBrowser, settle } from './chrome.mjs';

const FFMPEG = env('FFMPEG', 'ffmpeg');

export const SOCIAL_FORMATS = {
  cover: { width: 1080, height: 1350, label: 'Social cover (Facebook, X; carousel slide 1)' },
  slide: { width: 1080, height: 1350, label: 'Carousel slide, one per section (Instagram, LinkedIn)' },
  feature: { width: 1280, height: 720, label: 'Landing page / feature thumbnail' },
  podcast: { width: 1280, height: 720, label: 'Podcast / video thumbnail with a play button' },
  youtube: { width: 1280, height: 720, label: 'YouTube thumbnail' },
  email: { width: 1100, height: 600, label: 'Email body image' },
  signature: { width: 500, height: 175, label: 'Email signature banner' },
};

export const socialFile = (slug) => path.join(featurePaths(slug).library, 'social.json');
export const socialDir = (slug) => path.join(featurePaths(slug).output, 'assets', 'social');

// "\n" in a headline is a line break; inline layouts (the signature) pass breaks: false.
const twoTone = (h, { breaks = true } = {}) => headlineParts(breaks ? h : h.replace(/\s*\n\s*/g, ' '))
  .map((p) => (p.accent ? `<span class="hl">${e(p.text)}</span>` : e(p.text)).replace(/\n/g, '<br>'))
  .join('');

// social.json with every default filled in from the brief and brand.
export function loadSocial(slug, brief, brand) {
  const file = socialFile(slug);
  if (!fs.existsSync(file)) return null;
  const raw = readJson(file);
  const pack = brand.socialPack ?? {};
  const slides = (raw.slides ?? brief.sections.map((_, i) => ({ section: i }))).map((s, i) => {
    const section = brief.sections[s.section ?? i];
    if (!section) throw new Error(`social.json slide ${i + 1}: brief has no section ${s.section ?? i}`);
    // slides carry a short title only; a body appears when the sidecar asks for one
    return { title: s.title ?? section.title, body: s.body ?? '', panel: { scene: section.scene, ...(s.panel ?? {}) } };
  });
  return {
    name: raw.name ?? brief.feature,
    pill: raw.pill ?? brief.pill ?? brand.pill ?? `#${raw.name ?? brief.feature}`,
    headline: raw.headline ?? brief.headline,
    button: raw.button ?? pack.button ?? brand.cta?.heroButton ?? 'Learn more',
    hero: raw.hero ?? brief.hero.scene,
    // a scene id (its own small motif), or {crop} of the hero still, so the
    // signature reads as part of the same campaign
    signature: raw.signature ?? null,
    podcast: { play: raw.podcast?.play ?? [0.5, 0.5] },
    slides,
    formats: raw.formats ?? Object.keys(SOCIAL_FORMATS),
  };
}

// Every scene the pack shows, for rendering before it is laid out.
const signatureScene = (social) => (typeof social.signature === 'string' ? social.signature : null);
export const socialSceneIds = (social) => [social.hero, ...(signatureScene(social) ? [signatureScene(social)] : []), ...social.slides.map((s) => s.panel.scene)];

const validCrop = (c) => Array.isArray(c) && c.length === 4 && c.every((n) => typeof n === 'number' && n >= 0 && n <= 1)
  && c[0] + c[2] <= 1.0001 && c[1] + c[3] <= 1.0001 && c[2] > 0 && c[3] > 0;
const plain = (t) => t.replace(/[[\]]/g, '');

export function validateSocial(slug, brief, brand) {
  const errors = [];
  const warnings = [];
  let social;
  try {
    social = loadSocial(slug, brief, brand);
  } catch (err) {
    return { errors: [err.message], warnings };
  }
  if (!social) return { errors, warnings: ['no social.json — the social pack is not built'] };
  social.slides.forEach((s, i) => {
    if (s.panel.crop && !validCrop(s.panel.crop)) errors.push(`slide ${i + 1}: crop must be [x, y, width, height] as fractions of the still, inside it`);
    if (!/\[[^\]]+\]/.test(s.title)) warnings.push(`slide ${i + 1}: title has no [highlighted] words`);
    if (plain(s.title).length > 60) warnings.push(`slide ${i + 1}: title is ${plain(s.title).length} characters; a slide title should be short (60 at most)`);
    if (s.body.length > 140) warnings.push(`slide ${i + 1}: body is ${s.body.length} characters; slides carry a short title, a body of 140 at most`);
  });
  const sig = social.signature;
  if (sig !== null && typeof sig !== 'string' && !(typeof sig === 'object' && validCrop(sig.crop))) {
    errors.push('signature must be a scene id or {"crop": [x, y, width, height]} of the hero still');
  }
  const play = social.podcast.play;
  if (!(Array.isArray(play) && play.length === 2 && play.every((n) => typeof n === 'number' && n >= 0 && n <= 1))) {
    errors.push('podcast.play must be [x, y], the centre of the play button as fractions of the card');
  }
  if (!/\[[^\]]+\]/.test(social.headline)) warnings.push('headline has no [highlighted] words');
  for (const f of social.formats) if (!SOCIAL_FORMATS[f]) errors.push(`formats: unknown format "${f}" (${Object.keys(SOCIAL_FORMATS).join(', ')})`);
  return { errors, warnings };
}

// ---- pieces ----

const PLAY_SVG = '<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><path d="M14 9.5v21c0 1.2 1.3 1.9 2.3 1.3l16.5-10.5c.9-.6.9-2 0-2.6L16.3 8.2C15.3 7.6 14 8.3 14 9.5z" fill="#fff"/></svg>';

// The still cut to its crop, as a file in tmp.
function cropStill(still, crop, tmp, name) {
  if (!crop) return still;
  const out = path.join(tmp, `${name}.png`);
  const [x, y, w, h] = crop;
  const expr = `crop=trunc(iw*${w}):trunc(ih*${h}):trunc(iw*${x}):trunc(ih*${y})`;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', still, '-vf', expr, out], { stdio: ['ignore', 'inherit', 'inherit'] });
  return out;
}

const src = (file) => pathToFileURL(file).href;
const logo = (b) => `<div class="logo">${b.logo.primary}</div>`;
const pill = (text) => `<div class="pill">${e(text)}</div>`;
const hero = (img) => `<img class="hero" src="${src(img.hero)}" alt="">`;
const headline = (h, fit, opts) => `<h1 class="headline" data-fit="${fit}">${twoTone(h, opts)}</h1>`;
const pad2 = (n) => String(n).padStart(2, '0');

const LAYOUTS = {
  cover: (s, b, img) => `<div class="band"></div>${logo(b)}${pill(s.pill)}
<div class="text">${headline(s.headline, 420)}</div>${hero(img)}
<div class="foot"><span>${e(b.websiteLabel)}</span><span class="swipe">${s.slides.length} ways it helps <b>→</b></span></div>`,
  slide: (s, b, img, i) => `${logo(b)}<div class="count"><b>${pad2(i + 1)}</b> / ${pad2(s.slides.length)}</div>
<div class="text"><div class="eyebrow">${e(s.name)}</div>${headline(s.slides[i].title, 250)}${s.slides[i].body ? `<p class="body" data-fit="120">${e(s.slides[i].body)}</p>` : ''}</div>
<div class="surface"><div class="pane"><img class="shot" src="${src(img.slides[i])}" alt=""></div></div>
<div class="foot"><span>${e(b.websiteLabel)}</span><span class="dots">${s.slides.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</span></div>`,
  feature: (s, b, img) => `<div class="band"></div>${logo(b)}${pill(s.pill)}
<div class="text">${headline(s.headline, 330)}</div>${hero(img)}`,
  podcast: (s, b, img) => `<div class="band"></div>${logo(b)}${pill(s.pill)}
<div class="card">${hero(img)}<div class="play" style="left:${(s.podcast.play[0] * 100).toFixed(2)}%;top:${(s.podcast.play[1] * 100).toFixed(2)}%">${PLAY_SVG}</div></div>`,
  youtube: (s, b, img) => `<div class="band"></div><div class="text">${pill(s.name)}${headline(s.headline, 480)}</div>${hero(img)}${logo(b)}`,
  email: (s, b, img) => `<div class="band"></div>${logo(b)}${pill(s.pill)}
<div class="text">${headline(s.headline, 300)}</div>${hero(img)}`,
  signature: (s, b, img) => `<div class="band"></div>
<div class="col">${logo(b)}${headline(s.headline, 54, { breaks: false })}<div class="button">${e(s.button)} <span>→</span></div></div>
${img.signature ? `<img class="art" src="${src(img.signature)}" alt="">` : hero(img)}`,
};

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:transparent}
#frame{position:relative;overflow:hidden;font-family:var(--font-body);color:var(--ink);-webkit-font-smoothing:antialiased}
.band{position:absolute;inset:0;background:radial-gradient(120% 120% at 0% 0%, #fff 30%, var(--hero-tint) 100%)}
.logo{position:absolute;z-index:3;display:flex;align-items:center}
.logo svg,.logo img{height:100%;width:auto;display:block}
.pill{position:absolute;z-index:3;background:var(--primary);color:#fff;font-weight:600;border-radius:999px;white-space:nowrap;line-height:1}
.headline{font-family:var(--font-display);font-weight:var(--display-weight);letter-spacing:-.02em;line-height:1.04;color:var(--ink);text-wrap:balance}
.headline .hl{color:var(--primary)}
.text{position:absolute;z-index:2}
.hero{position:absolute;z-index:1;display:block;height:auto;filter:drop-shadow(0 30px 50px color-mix(in srgb, var(--navy) 16%, transparent))}
.foot{position:absolute;z-index:3;display:flex;justify-content:space-between;align-items:center;color:var(--muted)}
.play{position:absolute;z-index:4;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;
  box-shadow:0 0 0 12px rgba(255,255,255,.7),0 18px 40px color-mix(in srgb, var(--primary) 40%, transparent)}
.play svg{width:46%;height:46%;display:block}

/* cover 1080x1350 */
.f-cover .logo{left:72px;top:64px;height:60px}
.f-cover .pill{right:72px;top:62px;font-size:30px;padding:17px 28px}
.f-cover .text{left:72px;right:72px;top:200px}
.f-cover .headline{font-size:104px}
.f-cover .hero{right:0;bottom:104px;width:860px}
.f-cover .foot{left:72px;right:72px;bottom:52px;font-size:28px}
.f-cover .swipe{color:var(--primary);font-weight:600}

/* slide 1080x1350: an inner page of the one-pager */
.f-slide{background:#fff}
.f-slide .logo{left:72px;top:64px;height:52px}
.f-slide .count{position:absolute;right:72px;top:66px;font-size:30px;color:var(--muted);letter-spacing:.04em}
.f-slide .count b{color:var(--primary);font-weight:700}
.f-slide .text{left:72px;right:72px;top:176px}
.f-slide .eyebrow{display:inline-block;background:color-mix(in srgb, var(--primary) 10%, #fff);color:var(--primary-dark);font-weight:600;font-size:24px;padding:10px 18px;border-radius:999px;margin-bottom:28px}
.f-slide .headline{font-size:76px;line-height:1.06}
.f-slide .body{margin-top:28px;font-size:30px;line-height:1.45;color:var(--ink);max-height:200px;overflow:hidden}
/* the area under the title; the surface pane shrinks to the still inside it */
.f-slide .surface{position:absolute;left:72px;right:72px;top:var(--panel-top,700px);bottom:128px;display:flex;align-items:center;justify-content:center}
.f-slide .pane{border-radius:40px;background:var(--surface);padding:40px;display:flex}
.f-slide .shot{display:block;max-width:var(--shot-w,856px);max-height:var(--shot-h,442px);border-radius:18px;background:#fff;
  box-shadow:0 0 0 1px color-mix(in srgb, var(--hero-tint) 70%, #fff),0 24px 48px color-mix(in srgb, var(--navy) 14%, transparent)}
.f-slide .foot{left:72px;right:72px;bottom:52px;font-size:26px}
.f-slide .dots{display:flex;gap:12px}
.f-slide .dots i{width:14px;height:14px;border-radius:50%;background:color-mix(in srgb, var(--primary) 22%, #fff)}
.f-slide .dots i.on{width:44px;border-radius:7px;background:var(--primary)}

/* feature 1280x720: the hero band */
.f-feature .logo{left:64px;top:52px;height:52px}
.f-feature .pill{right:64px;top:50px;font-size:24px;padding:13px 22px}
.f-feature .text{left:64px;top:130px;bottom:40px;width:520px;display:flex;align-items:center}
.f-feature .headline{font-size:88px}
.f-feature .hero{right:24px;top:50%;transform:translateY(-44%);width:660px}

/* podcast 1280x720: the hero in a framed card */
.f-podcast .logo{left:64px;top:46px;height:48px}
.f-podcast .pill{right:64px;top:44px;font-size:22px;padding:12px 20px}
.f-podcast .card{position:absolute;left:110px;right:110px;top:124px;bottom:56px;border-radius:36px;
  background:radial-gradient(110% 120% at 0% 0%, #fff 35%, color-mix(in srgb, var(--hero-tint) 80%, #fff) 100%);
  box-shadow:0 0 0 1.5px #fff inset,0 30px 70px color-mix(in srgb, var(--navy) 16%, transparent);overflow:hidden}
.f-podcast .card .hero{left:50%;top:50%;height:500px;width:auto;transform:translate(-50%,-50%)}
.f-podcast .play{width:144px;height:144px;transform:translate(-50%,-50%)}

/* youtube 1280x720 */
.f-youtube .text{left:64px;top:96px;width:560px}
.f-youtube .pill{position:static;display:inline-block;font-size:26px;padding:14px 22px;margin-bottom:30px}
.f-youtube .headline{font-size:94px;line-height:1}
/* whole, never cut at the edge: a cut falls mid-word on whatever the hero shows */
.f-youtube .hero{right:32px;top:50%;transform:translateY(-50%);width:620px}
.f-youtube .logo{left:64px;bottom:50px;height:50px}

/* email 1100x600: the hero band, opaque so it holds on any mail background */
.f-email .logo{left:56px;top:44px;height:46px}
.f-email .pill{right:56px;top:42px;font-size:22px;padding:12px 20px}
.f-email .text{left:56px;top:120px;bottom:40px;width:440px;display:flex;align-items:center}
.f-email .headline{font-size:72px}
.f-email .hero{right:20px;top:50%;transform:translateY(-42%);width:580px}

/* signature 500x175 */
/* one left column: logo, headline and button on the same edge, evenly spaced */
.f-signature .col{position:absolute;z-index:2;left:18px;top:16px;bottom:16px;width:240px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start}
.f-signature .logo{position:static;height:22px}
.f-signature .headline{font-size:22px;line-height:1.1}
.f-signature .button{background:var(--cta);color:#fff;font-weight:600;font-size:13px;padding:8px 12px;border-radius:6px;white-space:nowrap;line-height:1.2}
.f-signature .hero{right:-6px;top:6px;width:212px;filter:drop-shadow(0 8px 14px color-mix(in srgb, var(--navy) 16%, transparent))}
.f-signature .art{position:absolute;right:8px;top:50%;transform:translateY(-50%);max-width:224px;max-height:159px;display:block;border-radius:10px}
`;

// Shrink each [data-fit] element until it is no taller than its data-fit px
// and nothing overflows sideways; then drop a slide's panel below its text.
const FIT = `for (const el of document.querySelectorAll('[data-fit]')) {
  const max = Number(el.dataset.fit); let size = parseFloat(getComputedStyle(el).fontSize); const floor = size * 0.55;
  const over = () => el.scrollHeight > max || el.scrollWidth > el.clientWidth + 1;
  while (over() && size > floor) { size -= 1; el.style.fontSize = size + 'px'; }
}
{ const t = document.querySelector('.f-slide .text');
  if (t) {
    const area = document.querySelector('.f-slide .surface');
    area.style.setProperty('--panel-top', (t.offsetTop + t.offsetHeight + 48) + 'px');
    area.style.setProperty('--shot-w', (area.clientWidth - 80) + 'px');
    area.style.setProperty('--shot-h', (area.clientHeight - 80) + 'px');
  } }`;

const pageHtml = (brand, format, body) => `<!doctype html><html><head><meta charset="utf-8">
<style>${brandCss(brand)}</style><style>${CSS}</style>
<style>#frame{width:${SOCIAL_FORMATS[format].width}px;height:${SOCIAL_FORMATS[format].height}px}</style>
</head><body><div id="frame" class="f-${format}">${body}</div><script>${FIT}</script></body></html>`;

// Lay out every format; write PNGs, the carousel PDF and a record of the pack.
export async function buildSocial({ slug, brief, brand, renders, log = console.log }) {
  const social = loadSocial(slug, brief, brand);
  if (!social) return null;
  const { errors } = validateSocial(slug, brief, brand);
  if (errors.length) throw new Error(`social.json: ${errors.join('; ')}`);

  const out = socialDir(slug);
  // empty it rather than remove it: Windows refuses to remove a folder that is open somewhere
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) fs.rmSync(path.join(out, f), { recursive: true, force: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-'));
  const scale = envNumber('STILL_SCALE', 2);
  const files = [];
  try {
    const still = (id) => {
      if (!renders[id]) throw new Error(`social.json: scene ${id} was not rendered`);
      return renders[id].still;
    };
    const img = {
      hero: still(social.hero),
      signature: typeof social.signature === 'string' ? still(social.signature)
        : social.signature?.crop ? cropStill(still(social.hero), social.signature.crop, tmp, 'signature') : null,
      slides: social.slides.map((s, i) => cropStill(still(s.panel.scene), s.panel.crop, tmp, `slide-${i + 1}`)),
    };

    const jobs = [];
    for (const f of social.formats) {
      const { width, height } = SOCIAL_FORMATS[f];
      if (f === 'slide') social.slides.forEach((_, i) => jobs.push({ format: f, name: `slide-${i + 2}-${width}x${height}.png`, body: LAYOUTS.slide(social, brand, img, i) }));
      else jobs.push({ format: f, name: f === 'cover' ? `slide-1-cover-${width}x${height}.png` : `${f}-${width}x${height}.png`, body: LAYOUTS[f](social, brand, img) });
    }

    await withBrowser(async (browser) => {
      const page = await browser.newPage();
      for (const job of jobs) {
        const { width, height } = SOCIAL_FORMATS[job.format];
        const html = path.join(tmp, `${job.name}.html`);
        fs.writeFileSync(html, pageHtml(brand, job.format, job.body));
        await page.setViewport({ width, height, deviceScaleFactor: scale });
        await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
        await settle(page);
        await page.evaluate(FIT);
        await (await page.$('#frame')).screenshot({ path: path.join(out, job.name) });
        files.push(job.name);
        log(`  ${job.name}`);
      }

      // LinkedIn carousel: the cover and the slides, one page each, in order
      const pages = files.filter((n) => n.startsWith('slide-')).sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10));
      if (pages.length > 1) {
        const { width, height } = SOCIAL_FORMATS.slide;
        const html = path.join(tmp, 'carousel.html');
        fs.writeFileSync(html, `<!doctype html><html><head><style>@page{size:${width}px ${height}px;margin:0}*{margin:0}img{display:block;width:${width}px;height:${height}px;break-after:page}</style></head><body>${pages.map((p) => `<img src="${src(path.join(out, p))}">`).join('')}</body></html>`);
        await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
        await settle(page);
        const name = `carousel-${width}x${height}.pdf`;
        await page.pdf({ path: path.join(out, name), width: `${width}px`, height: `${height}px`, printBackground: true, preferCSSPageSize: true });
        files.push(name);
        log(`  ${name}  (${pages.length} pages)`);
      }
      await page.close();
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  writeJson(path.join(out, 'social.json'), {
    $comment: 'What this social pack holds. Generated by pipeline/social.mjs from library/features/<slug>/social.json.',
    slug,
    brand: brand.id,
    scale,
    files: files.map((name) => {
      const format = name.startsWith('slide-1-cover') ? 'cover' : name.startsWith('slide-') ? 'slide' : name.startsWith('carousel') ? 'carousel' : name.split('-')[0];
      return { file: name, format, use: format === 'carousel' ? 'LinkedIn carousel (PDF document post)' : SOCIAL_FORMATS[format].label };
    }),
    builtAt: new Date().toISOString(),
  });
  return { dir: out, files };
}
