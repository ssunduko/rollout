// Web page: brief + brand + scene renders -> output/<slug>/web/
//
// A feature page laid out like a marketing site's feature pages, so it can be
// dropped into the site as is: header (logo, contact line, nav, sign-in, two
// buttons), centred headline and lead, a 16:9 video slot, a trial sign-up
// card, one alternating row per section (visual, title, body, trial button),
// a closing call-to-action band and a column footer. Every label and link of
// the site chrome comes from the brand's "web" block (docs/brief.md); the
// copy comes from the brief.
//
// Section visuals are the web cut of each scene (webmedia.mjs): a fixed
// 1180x676 GIF, zoomed and framed — not the one-pager's GIF. Until the brief
// names a video (web.video), the video slot holds a poster: the hero composition
// (web.poster, default hero.scene) on the hero gradient with a play button,
// framed like the GIFs. The folder is self-contained (fonts and media copied into
// web/assets/) so it can be uploaded anywhere as is.
//
// page.json beside index.html is the page's sidecar: the same content as
// structured data with asset paths, for importing into a CMS instead of
// shipping the HTML.

import fs from 'node:fs';
import path from 'node:path';
import { escapeHtml as e, writeJson } from './env.mjs';
import { brandCss, brandFontFiles } from './brand.mjs';
import { headlineParts, plainHeadline } from './brief.mjs';
import { framedMedia, renderPoster, webSettings } from './webmedia.mjs';

const copyInto = (dir, file, name = path.basename(file)) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, name));
  return name;
};

const VIDEO = { width: 1600, height: 900 };

const CSS = `
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:var(--font-body);color:var(--ink);background:var(--white);-webkit-font-smoothing:antialiased}
a{color:inherit}
img{max-width:100%;height:auto;display:block}
.wrap{max-width:1112px;margin:0 auto;padding:0 16px}
.display{font-family:var(--font-display);font-weight:var(--display-weight)}
.mark{color:var(--cta)}
.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:4px;padding:12px 24px;font-family:var(--font-display);font-weight:700;font-size:18px;line-height:1.3;text-decoration:none;border:0;cursor:pointer;white-space:nowrap}
.btn.primary{background:var(--primary);color:var(--white)}
.btn.cta{background:var(--cta);color:var(--white)}
.btn.light{background:color-mix(in srgb,var(--surface) 60%,white);color:var(--primary-dark)}

.site-header{position:sticky;top:0;z-index:10;background:var(--white)}
.site-header .bar{max-width:1140px;margin:0 auto;padding:0 16px;display:flex;align-items:center;gap:20px;height:88px}
@media (min-width:992px){.site-header .bar > *{flex-shrink:0}}
.site-header .logo > :is(svg, img){height:32px;width:auto;display:block}
.contact{font-size:12px;line-height:1.3;text-decoration:none;color:var(--ink);white-space:nowrap}
.contact b{display:block;font-size:14px;font-weight:600;white-space:nowrap}
.nowrap{white-space:nowrap}
.site-header nav{display:flex;align-items:center;gap:22px;flex:1 1 auto;flex-shrink:1;justify-content:center}
.site-header nav a{white-space:nowrap;text-decoration:none;font-family:var(--font-display);font-weight:700;font-size:16px;color:color-mix(in srgb,var(--ink) 85%,white)}
.site-header nav a.menu::after{content:"";display:inline-block;width:6px;height:6px;margin:0 2px 3px 8px;border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(45deg)}
.site-header .actions{display:flex;align-items:center;gap:10px}
.site-header .signin{white-space:nowrap;text-decoration:none;font-family:var(--font-display);font-weight:700;font-size:16px;margin-right:10px;color:color-mix(in srgb,var(--ink) 85%,white)}
.menu-toggle{display:none;background:none;border:0;padding:8px;cursor:pointer;color:var(--ink)}
.menu-toggle span{display:block;width:24px;height:2px;background:currentColor;margin:5px 0}
.back{display:none}

.intro{text-align:center;padding:16px 0 0}
.intro h1{font-size:50px;line-height:1.16;letter-spacing:-.01em;margin:0 auto 20px;max-width:820px}
.intro .lead{font-size:18px;line-height:1.56;margin:0 auto;max-width:820px;color:color-mix(in srgb,var(--ink) 75%,white)}
.video{max-width:816px;margin:48px auto 0;aspect-ratio:16/9;border-radius:8px;overflow:hidden}
.video img,.video iframe{width:100%;height:100%;border:0;display:block;object-fit:cover}

.signup{max-width:450px;margin:48px auto 0;background:color-mix(in srgb,var(--hero-tint) 45%,white);border-radius:8px;padding:28px 18px 24px;text-align:center}
.signup h2{font-size:20px;line-height:1.3;margin:0 0 4px}
.signup p{margin:0 0 24px;font-size:15px;color:color-mix(in srgb,var(--ink) 70%,white)}
.signup form{display:flex;gap:8px}
.signup input{flex:1;min-width:0;border:1px solid color-mix(in srgb,var(--ink) 18%,white);border-radius:4px;font:inherit;font-size:16px;padding:16px 20px;background:var(--white)}
.signup .btn{padding:16px 24px}

.features{padding:96px 0 40px}
.feature{display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;padding:0 0 120px}
.feature.flip .media{order:2}
.media img{width:100%}
.feature .text{display:flex;flex-direction:column;align-items:center}
.feature h2{font-size:40px;line-height:1.2;letter-spacing:-.01em;margin:0 0 24px;text-align:center}
.feature .eyebrow{color:var(--primary);font-weight:600;font-size:14px;letter-spacing:.02em;text-transform:uppercase;margin-bottom:12px}
.feature p{font-size:18px;line-height:1.56;margin:0 0 40px;align-self:stretch;color:color-mix(in srgb,var(--ink) 75%,white)}

.integrations{text-align:center;padding:40px 0 96px}
.integrations h2{font-size:50px;line-height:1.16;margin:0 0 16px}
.integrations p{font-size:22px;line-height:1.5;margin:0 0 40px;color:color-mix(in srgb,var(--ink) 70%,white)}
.integrations .logos{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:32px;max-width:1080px;margin:0 auto}
.integrations .logos img{width:173px;height:65px;object-fit:contain}

.closing{padding:40px 0 64px}
.closing .frame{background:color-mix(in srgb,var(--hero-tint) 45%,white);border-radius:8px;padding:32px}
.closing .band{background:var(--primary);color:var(--white);text-align:center;padding:72px 24px}
.closing h2{font-size:50px;line-height:1.16;margin:0 auto 16px;max-width:760px}
.closing p{font-size:22px;line-height:1.5;margin:0 auto 48px;max-width:600px}
.closing .note{font-size:16px;margin:48px auto 0}
.closing .note a{text-decoration:none}

.site-footer{background:linear-gradient(180deg,var(--white),color-mix(in srgb,var(--hero-tint) 40%,white));padding:40px 0 48px;font-size:16px}
.site-footer .top{display:flex;gap:12px;justify-content:space-between}
.site-footer .cols{display:flex;gap:12px}
.site-footer .col{width:177px}
.site-footer h3{font-size:20px;line-height:1.2;margin:0 0 16px;color:color-mix(in srgb,var(--ink) 75%,white)}
.site-footer ul{list-style:none;padding:0;margin:0;display:grid;gap:14px}
.site-footer li a{text-decoration:none;color:color-mix(in srgb,var(--ink) 70%,white)}
.site-footer .badge{color:var(--cta);font-size:13px;margin-right:4px}
.site-footer .brand{display:flex;flex-direction:column;align-items:flex-end;gap:16px}
.site-footer .logo > :is(svg, img){height:32px;width:auto}
.site-footer .apps{display:flex;gap:8px}
.site-footer .apps img{height:40px;width:auto}
.site-footer .copy{text-align:center;font-size:14px;color:var(--muted);margin:56px 0 12px}
.site-footer .legal{text-align:center;font-size:14px;color:var(--muted)}
.site-footer .legal a{text-decoration:none}
.site-footer .legal span{margin:0 8px}

@media (max-width:991px){
  .contact,.site-header .actions .btn,.site-header .signin{display:none}
  .site-header .bar{height:72px;gap:16px}
  .menu-toggle{display:block;margin-left:auto}
  .site-header nav{display:none;position:absolute;top:72px;left:0;right:0;flex-direction:column;align-items:flex-start;gap:0;background:var(--white);padding:8px 16px 16px;box-shadow:0 12px 24px rgba(16,24,40,.08)}
  .site-header.open nav{display:flex}
  .site-header nav a{padding:12px 0}
  .contact{display:block;white-space:normal;min-width:0}
}
@media (max-width:767px){
  .back{display:inline-flex;align-items:center;gap:8px;color:var(--primary);font-family:var(--font-display);font-weight:700;font-size:18px;text-decoration:none;margin:8px 0 24px}
  .back::before{content:"";width:9px;height:9px;border:solid currentColor;border-width:0 0 3px 3px;transform:rotate(45deg)}
  .intro{text-align:left}
  .intro h1{font-size:36px;text-align:center}
  .intro .lead{text-align:center;font-size:18px}
  .video{margin-top:32px}
  .signup{margin-top:32px}
  .signup form{flex-direction:column}
  .features{padding-top:64px}
  .feature{grid-template-columns:1fr;gap:32px;padding-bottom:80px}
  .feature.flip .media{order:0}
  .feature h2{font-size:30px}
  .feature p{text-align:center;margin-bottom:28px}
  .integrations h2,.closing h2{font-size:34px}
  .integrations .logos{gap:16px 24px}
  .integrations .logos img{width:130px;height:50px}
  .integrations p,.closing p{font-size:16px}
  .closing .frame{padding:0;background:none}
  .closing .band{padding:40px 18px;border-radius:8px}
  .closing .note{text-align:left}
  .site-footer .top{flex-direction:column-reverse;align-items:center;gap:40px}
  .site-footer .brand{align-items:center}
  .site-footer .cols{flex-wrap:wrap;justify-content:center;gap:32px 12px}
  .site-footer .col{width:170px}
  .site-footer .col li{text-align:center}
  .site-footer .copy{margin-top:40px}
}
`;

// "Start Your [Free 14-Day] Trial" -> the bracketed words marked.
const marked = (text) => headlineParts(text).map((p) => (p.accent ? `<span class="mark">${e(p.text)}</span>` : e(p.text))).join('');

// Headline-style capitals for brands whose site uses them (web.titleCase):
// every word capitalised except short joining words mid-title (never the
// first or last word), and words
// already holding capitals (brand names, "AI") left as written.
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'via', 'vs', 'with']);
export const titleCase = (text) =>
  text.replace(/[A-Za-z][\w'’]*/g, (w, i) => (/[A-Z]/.test(w.slice(1)) || /^[A-Z]/.test(w) ? w : i > 0 && SMALL.has(w) && /[A-Za-z]/.test(text.slice(i + w.length)) && !/[:—–-]\s*$/.test(text.slice(0, i)) ? w : w[0].toUpperCase() + w.slice(1)));

// Phone numbers in running text never break across lines.
const keepPhones = (html) => html.replace(/\+?\(?\d[\d\s().-]{6,}\d/g, (m) => `<span class="nowrap">${m}</span>`);

const link = (l, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${e(l.url)}">${e(l.label)}</a>`;

// The site chrome: the brand's "web" block, with the brand's older fields and
// the brief's CTA as fallbacks, so a brand without the block still builds.
export function webChrome(brief, brand) {
  const w = brand.web ?? {};
  const signupUrl = w.signup?.action ?? brief.cta.url;
  return {
    header: {
      contact: w.header?.contact ?? null,
      nav: w.header?.nav ?? brand.nav,
      signIn: w.header?.signIn ?? null,
      buttons: w.header?.buttons ?? [{ label: brief.web.heroButton, url: brief.cta.url, style: 'cta' }],
    },
    back: w.back ?? null,
    signup: {
      title: w.signup?.title ?? brief.cta.title,
      subtitle: w.signup?.subtitle ?? '',
      placeholder: w.signup?.placeholder ?? 'Work email',
      button: w.signup?.button ?? brief.web.heroButton,
      field: w.signup?.field ?? 'email',
      action: signupUrl,
    },
    sectionButton: { ...(w.sectionButton ?? { label: brief.cta.button, url: brief.cta.url }), ...(brief.web.sectionButton ?? {}) },
    integrations: w.integrations ?? null,
    closingNote: w.closing?.note ?? null,
    footer: {
      columns: w.footer?.columns ?? (brand.nav.length ? [{ title: 'Product', links: brand.nav }] : []),
      apps: w.footer?.apps ?? [],
      copyright: w.footer?.copyright ?? brand.name,
      legal: w.footer?.legal ?? brand.legal,
    },
  };
}

export function webpageHtml({ brief, brand, media, fontUrl }) {
  const title = brief.seo.title ?? `${brief.feature} | ${brand.name}`;
  const chrome = webChrome(brief, brand);
  const heading = (t) => (brand.web?.titleCase ? titleCase(t) : t);
  const { header, signup, sectionButton, footer } = chrome;
  const year = new Date().getFullYear();

  const sections = brief.sections
    .map(
      (s, i) => `<div class="feature${i % 2 ? ' flip' : ''}">
    <div class="media"><img src="${e(media[s.scene].src)}" width="${media[s.scene].width}" height="${media[s.scene].height}" alt="${e(s.alt ?? s.title)}" loading="lazy"></div>
    <div class="text">${s.eyebrow ? `<span class="eyebrow">${e(s.eyebrow)}</span>` : ''}<h2 class="display">${e(heading(s.title))}</h2><p>${e(s.body)}</p>${link(sectionButton, 'btn cta')}</div>
  </div>`,
    )
    .join('\n  ');

  const video = brief.web.video
    ? `<iframe src="${e(brief.web.video)}" title="${e(brief.feature)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
    : `<img src="${e(media.video.src)}" width="${VIDEO.width}" height="${VIDEO.height}" alt="${e(`${brief.feature} video (coming soon)`)}" data-placeholder="video">`;

  const integrations = chrome.integrations
    ? `<section class="integrations"><div class="wrap">
  <h2 class="display">${e(chrome.integrations.title)}</h2>
  ${chrome.integrations.subtitle ? `<p>${e(chrome.integrations.subtitle)}</p>` : ''}
  <div class="logos">${(chrome.integrations.logos ?? []).map((l) => `<img src="${e(l.src)}" alt="${e(l.alt)}" loading="lazy">`).join('')}</div>
</div></section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(brief.seo.description)}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(brief.seo.description)}">
<meta property="og:image" content="${e(media.og)}">
<meta name="twitter:card" content="summary_large_image">
<style>${brandCss(brand, { fontUrl })}</style>
<style>${CSS}</style>
</head>
<body>
<header class="site-header"><div class="bar">
  <a class="logo" href="${e(brand.website || '/')}" aria-label="${e(brand.name)}">${brand.logo.primary}</a>
  ${header.contact ? `<a class="contact" href="${e(header.contact.url ?? '#')}">${e(header.contact.label)}<b>${e(header.contact.value)}</b></a>` : ''}
  <nav>${header.nav.map((n) => `<a${n.menu ? ' class="menu"' : ''} href="${e(n.url)}">${e(n.label)}</a>`).join('')}</nav>
  <div class="actions">
    ${header.signIn ? link(header.signIn, 'signin') : ''}
    ${header.buttons.map((b) => link(b, `btn ${b.style ?? 'primary'}`)).join('\n    ')}
  </div>
  <button class="menu-toggle" type="button" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>
</div></header>

<main>
<section class="intro"><div class="wrap">
  ${chrome.back ? link(chrome.back, 'back') : ''}
  <h1 class="display">${e(heading(plainHeadline(brief.headline)))}</h1>
  <p class="lead">${e(brief.lead ?? brief.intro)}</p>
  <div class="video">${video}</div>
  <div class="signup">
    <h2 class="display">${marked(signup.title)}</h2>
    ${signup.subtitle ? `<p>${e(signup.subtitle)}</p>` : ''}
    <form action="${e(signup.action)}" method="get">
      <input type="email" name="${e(signup.field)}" placeholder="${e(signup.placeholder)}" aria-label="${e(signup.placeholder)}" required>
      <button class="btn cta" type="submit">${e(signup.button)}</button>
    </form>
  </div>
</div></section>

<section class="features"><div class="wrap">
  ${sections}
</div></section>

${integrations}
<section class="closing"><div class="wrap"><div class="frame"><div class="band">
  <h2 class="display">${e(brief.cta.title)}</h2>
  ${brief.cta.subtitle ? `<p>${e(brief.cta.subtitle)}</p>` : ''}
  <a class="btn light" href="${e(brief.cta.url)}">${e(brief.cta.button)}</a>
  ${chrome.closingNote ? `<p class="note">${keepPhones(e(chrome.closingNote))}</p>` : ''}
</div></div></div></section>
</main>

<footer class="site-footer"><div class="wrap">
  <div class="top">
    <div class="cols">${footer.columns
      .map((c) => `<div class="col"><h3 class="display">${e(c.title)}</h3><ul>${c.links.map((l) => `<li>${l.badge ? `<span class="badge">${e(l.badge)}</span>` : ''}${link(l)}</li>`).join('')}</ul></div>`)
      .join('')}</div>
    <div class="brand">
      <a class="logo" href="${e(brand.website || '/')}" aria-label="${e(brand.name)}">${brand.logo.primary}</a>
      ${footer.apps.length ? `<div class="apps">${footer.apps.map((a) => `<a href="${e(a.url)}"><img src="${e(a.src)}" alt="${e(a.alt)}"></a>`).join('')}</div>` : ''}
    </div>
  </div>
  <p class="copy">© ${year} ${e(footer.copyright)}</p>
  <p class="legal">${footer.legal.map((l) => link(l)).join('<span>/</span>')}</p>
</div></footer>
<script>
document.querySelector('.menu-toggle').addEventListener('click', function () {
  var h = document.querySelector('.site-header');
  this.setAttribute('aria-expanded', h.classList.toggle('open'));
});
</script>
</body>
</html>
`;
}

// Write output/<slug>/web/{index.html, page.json, assets/}. Returns the
// section visuals that had no web cut of their own and were fitted instead.
export async function buildWebpage({ brief, brand, renders, outDir }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const assets = path.join(outDir, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const { width, height } = webSettings();
  const media = {};
  const fitted = [];
  for (const id of new Set(brief.sections.map((s) => s.scene))) {
    const r = renders[id];
    const name = `${id}.gif`;
    if (r.webGif) copyInto(assets, r.webGif, name);
    else {
      await framedMedia({ file: r.gif ?? r.still, out: path.join(assets, name) });
      fitted.push(id);
    }
    media[id] = { src: `assets/${name}`, width, height, cut: r.webGif ? 'web' : 'fitted', source: r.kind };
  }
  const poster = renders[brief.web.poster ?? brief.hero.scene];
  await renderPoster({ still: poster.still, out: path.join(assets, 'video-poster.png'), brand, ...VIDEO });
  media.video = { src: 'assets/video-poster.png', ...VIDEO };

  // brand-folder images the chrome names (integration logos, app badges)
  // travel with the page; URLs stay as they are
  const brandAsset = (src) => (/^(https?:|data:)/.test(src) ? src : `assets/brand/${copyInto(path.join(assets, 'brand'), path.resolve(brand.dir, src))}`);
  const w = brand.web ?? {};
  brand = { ...brand, web: { ...w,
    ...(w.integrations ? { integrations: { ...w.integrations, logos: (w.integrations.logos ?? []).map((l) => ({ ...l, src: brandAsset(l.src) })) } } : {}),
    ...(w.footer?.apps ? { footer: { ...w.footer, apps: w.footer.apps.map((a) => ({ ...a, src: brandAsset(a.src) })) } } : {}),
  } };
  media.og = `assets/${copyInto(assets, renders[brief.hero.scene].still, 'og-image.png')}`;
  for (const f of brandFontFiles(brand)) copyInto(path.join(assets, 'fonts'), f);

  const htmlFile = path.join(outDir, 'index.html');
  fs.writeFileSync(htmlFile, webpageHtml({ brief, brand, media, fontUrl: (p) => `assets/fonts/${path.basename(p)}` }));

  const chrome = webChrome(brief, brand);
  writeJson(path.join(outDir, 'page.json'), {
    $comment: 'Sidecar of index.html: the page content as data, for CMS import. Generated by pipeline/webpage.mjs.',
    slug: brief.slug,
    title: brief.seo.title ?? `${brief.feature} | ${brand.name}`,
    description: brief.seo.description,
    headline: plainHeadline(brief.headline),
    lead: brief.lead ?? brief.intro,
    video: brief.web.video ? { url: brief.web.video } : { placeholder: media.video.src, width: VIDEO.width, height: VIDEO.height },
    signup: chrome.signup,
    sections: brief.sections.map((s) => ({ eyebrow: s.eyebrow ?? null, title: s.title, body: s.body, media: media[s.scene], alt: s.alt, button: chrome.sectionButton })),
    cta: { ...brief.cta, note: chrome.closingNote },
    ogImage: media.og,
  });
  return { htmlFile, fitted };
}
