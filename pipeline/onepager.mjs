// One-pager: brief + brand + scene stills -> output/<slug>/onepager.html -> PDF
//
// Layout follows the house one-pager: a hero band (logo, pill, two-tone
// headline, intro, hero visual), then feature rows alternating visual-left /
// visual-right on soft panels, then a closing call-to-action band and footer
// on the last page. Page one holds the hero and two rows; later pages hold
// three; the CTA always lands on the last page with at least one row.
//
// The HTML is kept next to the PDF with its assets copied beside it, so it can
// be opened, inspected (the QA stage screenshots it) and re-printed on its own.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { env, escapeHtml as e } from './env.mjs';
import { brandCss, brandFontFiles } from './brand.mjs';
import { headlineParts } from './brief.mjs';
import { withBrowser, settle } from './chrome.mjs';

export const PAGE_SIZES = { A4: { width: 794, height: 1123, css: 'A4' }, Letter: { width: 816, height: 1056, css: 'letter' } };
export const pageSize = () => PAGE_SIZES[env('PAGE_SIZE', 'A4')] ?? PAGE_SIZES.A4;

// Rows per page: [page one, every later page]. See the header comment.
export function paginate(sections) {
  const n = sections.length;
  const first = n === 1 ? 1 : Math.min(2, n - 1);
  const pages = [sections.slice(0, first)];
  for (let i = first; i < n; i += 3) pages.push(sections.slice(i, i + 3));
  return pages;
}

export const pdfName = (brief) => `${brief.feature} One-Pager.pdf`.replace(/[\\/:*?"<>|]/g, '');

const copyInto = (dir, file, name = path.basename(file)) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, name));
  return name;
};

export const headlineHtml = (h) => headlineParts(h).map((p) => (p.accent ? `<span class="accent">${e(p.text)}</span>` : e(p.text))).join('');

export function socialHtml(brand) {
  return brand.social
    .map((s) => `<a href="${e(s.url)}" aria-label="${e(s.name)}" class="social">${brand.icon(s.icon)}</a>`)
    .join('');
}

const contactLine = (brand) => [brand.websiteLabel, brand.phone].filter(Boolean).map(e).join('<span class="slash">/</span>');

function css(size) {
  return `
@page { size: ${size.css}; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: var(--font-body); color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
* { box-sizing: border-box; }
.page { width: ${size.width}px; height: ${size.height}px; position: relative; overflow: hidden; break-after: page; background: var(--white); display: flex; flex-direction: column; }
.page:last-child { break-after: auto; }

.hero { height: ${Math.round(size.height * 0.396)}px; flex: none; position: relative; padding: 22px 24px 0 24px;
  background: radial-gradient(120% 140% at 100% 30%, var(--hero-tint) 0%, color-mix(in srgb, var(--hero-tint) 45%, white) 45%, var(--white) 85%); }
.hero .top { display: flex; justify-content: space-between; align-items: center; position: relative; z-index: 2; }
.hero .logo > :is(svg, img) { height: 30px; width: auto; display: block; }
.pill { background: var(--primary); color: var(--white); font-size: 16px; font-weight: 500; padding: 5px 13px 6px; border-radius: 999px; letter-spacing: -.01em; }
.hero .copy { position: absolute; left: 24px; top: 0; bottom: 0; width: 44%; display: flex; flex-direction: column; justify-content: center; padding-top: 44px; z-index: 2; }
.hero h1 { font-family: var(--font-display); font-weight: var(--display-weight); font-size: 40px; line-height: 1.03; letter-spacing: -.025em; margin: 0 0 18px; }
.accent { color: var(--primary); }
.hero p { font-size: 10.6px; line-height: 1.6; margin: 0; }
.hero .visual { position: absolute; right: 18px; top: 46px; bottom: 30px; width: 50%; display: flex; align-items: center; justify-content: center; }
.hero .visual > img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.art { position: relative; width: 100%; }
.art > img { width: 100%; display: block; }
.art .overlay { position: absolute; }
/* On screen the visuals animate (GIFs); printed, they are the high-resolution stills. */
.shot .anim { display: none; }
@media screen {
  .shot:has(.anim) .still { display: none; }
  .shot .anim { display: block; }
}
@media print { .art > img.overlay { display: none; } } /* must outrank .art > img */

.rows { flex: 1; display: flex; flex-direction: column; justify-content: space-evenly; padding: 18px 45px 8px; }
.row { display: flex; align-items: center; gap: 56px; }
.row.flip { flex-direction: row-reverse; }
.shot { flex: none; width: 325px; height: 246px; border-radius: 22px; background: var(--surface); padding: 20px 20px 0; overflow: hidden; }
.shot img { width: 100%; display: block; }
/* a real screenshot gets the app-window treatment a kit scene draws itself */
.shot img.capture { border-radius: 10px 10px 0 0; box-shadow: 0 1px 2px rgba(16,24,40,.06), 0 10px 28px rgba(16,24,40,.10); }
.row .text { flex: 1; min-width: 0; }
.row h2 { font-size: 15px; line-height: 1.25; font-weight: 600; letter-spacing: -.01em; margin: 0 0 9px; }
.row h2 .eyebrow { display: block; }
.row p { font-size: 10.6px; line-height: 1.6; margin: 0; color: color-mix(in srgb, var(--ink) 72%, white); }

.foot { flex: none; height: 52px; display: flex; align-items: center; justify-content: center; font-size: 9.5px; color: var(--muted); }
.slash { margin: 0 8px; }

.cta { flex: none; height: ${Math.round(size.height * 0.195)}px; position: relative; text-align: center; padding-top: 34px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--hero-tint) 25%, white) 0%, color-mix(in srgb, var(--hero-tint) 75%, white) 100%); }
.cta h3 { font-family: var(--font-display); font-weight: var(--display-weight); font-size: 23px; letter-spacing: -.02em; margin: 0 0 6px; }
.cta p { font-size: 10.5px; margin: 0 0 16px; }
.cta .button { display: inline-block; background: var(--cta-button, var(--cta)); color: var(--white); font-size: 11px; font-weight: 500; padding: 8px 15px; border-radius: 6px; text-decoration: none; }
.cta .bar { position: absolute; left: 45px; right: 45px; bottom: 18px; display: flex; align-items: center; justify-content: space-between; font-size: 9.5px; color: var(--muted); }
.cta .bar .logo > :is(svg, img) { height: 24px; width: auto; display: block; }
.socials { display: flex; gap: 12px; color: var(--muted); }
.social { color: inherit; display: inline-flex; }
.social svg { height: 11px; width: auto; }
`;
}

// The hero still, with the GIF of each scene it embeds laid over the embedded
// screenshot (screen only), so the composition animates when the HTML is viewed.
function heroArt(h, stills) {
  const pct = (v) => `${(v * 100).toFixed(3)}%`;
  const overlays = (h.embeds ?? [])
    .filter((x) => stills[x.scene]?.gif)
    .map((x) => {
      const ry = (x.radius * x.width * h.size.width) / (x.height * h.size.height);
      return `<img class="overlay" src="${e(stills[x.scene].gif)}" alt="" style="left:${pct(x.x)};top:${pct(x.y)};width:${pct(x.width)};height:${pct(x.height)};border-radius:${pct(x.radius)} / ${pct(ry)}">`;
    })
    .join('');
  if (!overlays) return `<img src="${e(h.src)}" alt="">`;
  return `<div class="art"><img src="${e(h.src)}" alt="">${overlays}</div>`;
}

export function onepagerHtml({ brief, brand, stills, fontUrl, size = pageSize() }) {
  const pages = paginate(brief.sections);
  let rowIndex = 0;
  const row = (s) => {
    const flip = rowIndex++ % 2 === 1;
    return `<div class="row${flip ? ' flip' : ''}">
  <div class="shot"><img class="still ${stills[s.scene].kind}" src="${e(stills[s.scene].src)}" alt="">${stills[s.scene].gif ? `<img class="anim ${stills[s.scene].kind}" src="${e(stills[s.scene].gif)}" alt="">` : ''}</div>
  <div class="text"><h2>${s.eyebrow ? `<span class="eyebrow">${e(s.eyebrow)}</span>` : ''}${e(s.title)}</h2><p>${e(s.body)}</p></div>
</div>`;
  };

  const html = pages.map((rows, i) => {
    const first = i === 0;
    const last = i === pages.length - 1;
    return `<section class="page">
${first ? `<header class="hero">
  <div class="top"><div class="logo">${brand.logo.primary}</div><div class="pill">${e(brief.pill)}</div></div>
  <div class="copy"><h1>${headlineHtml(brief.headline)}</h1><p>${e(brief.intro)}</p></div>
  <div class="visual">${heroArt(stills[brief.hero.scene], stills)}</div>
</header>` : ''}
<div class="rows">${rows.map(row).join('\n')}</div>
${last ? `<footer class="cta">
  <h3>${e(brief.cta.title)}</h3>${brief.cta.subtitle ? `<p>${e(brief.cta.subtitle)}</p>` : ''}
  <a class="button" href="${e(brief.cta.url)}">${e(brief.cta.button)}</a>
  <div class="bar"><div class="logo">${brand.logo.primary}</div><div>${contactLine(brand)}</div><div class="socials">${socialHtml(brand)}</div></div>
</footer>` : `<footer class="foot">${contactLine(brand)}</footer>`}
</section>`;
  });

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(brief.feature)} — ${e(brand.name)}</title>
<style>${brandCss(brand, { fontUrl })}</style><style>${css(size)}</style></head>
<body>${html.join('\n')}</body></html>`;
}

// Write output/<slug>/onepager.html (+ assets/) and print it to PDF.
export async function buildOnepager({ brief, brand, renders, outDir }) {
  const assets = path.join(outDir, 'assets');
  fs.rmSync(assets, { recursive: true, force: true });
  const stills = {};
  for (const [id, r] of Object.entries(renders)) {
    stills[id] = {
      src: `assets/${copyInto(assets, r.still, `${id}.png`)}`,
      gif: r.gif ? `assets/${copyInto(assets, r.gif, `${id}.gif`)}` : null,
      kind: r.kind,
      size: r.size ?? r.scene.size,
      embeds: r.embeds ?? [],
    };
  }
  for (const f of brandFontFiles(brand)) copyInto(path.join(assets, 'fonts'), f);

  const size = pageSize();
  const htmlFile = path.join(outDir, 'onepager.html');
  fs.writeFileSync(htmlFile, onepagerHtml({ brief, brand, stills, size, fontUrl: (p) => `assets/fonts/${path.basename(p)}` }));

  const pdfFile = path.join(outDir, pdfName(brief));
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setViewport({ width: size.width, height: size.height });
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await settle(page);
    await page.pdf({ path: pdfFile, preferCSSPageSize: true, printBackground: true });
  });
  return { htmlFile, pdfFile, pages: paginate(brief.sections).length };
}
