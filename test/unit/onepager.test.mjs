import '../setup.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_SIZES, pageSize, paginate, pdfName, headlineHtml, socialHtml, onepagerHtml } from '../../pipeline/onepager.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { loadBrief } from '../../pipeline/brief.mjs';

const brand = loadBrand();
const SIZE = process.env.PAGE_SIZE;
afterEach(() => { process.env.PAGE_SIZE = SIZE; });

const brief = () => loadBrief('smart-scheduling', brand);
// stand-in renders for every scene the brief uses
function stillsFor(b, { gifs = true } = {}) {
  const stills = {};
  for (const s of b.sections) stills[s.scene] = { src: `assets/${s.scene}.png`, gif: gifs ? `assets/${s.scene}.gif` : null, kind: 'capture' };
  stills[b.hero.scene] = { src: `assets/${b.hero.scene}.png`, gif: null, kind: 'kit', size: { width: 680, height: 560 }, embeds: [] };
  return stills;
}
const count = (html, re) => (html.match(re) ?? []).length;

test('paginate: page one holds up to two rows, later pages three, the last at least one', () => {
  const sizes = (n) => paginate(Array.from({ length: n }, (_, i) => i)).map((p) => p.length);
  assert.deepEqual(sizes(1), [1]);
  assert.deepEqual(sizes(2), [1, 1]);
  assert.deepEqual(sizes(3), [2, 1]);
  assert.deepEqual(sizes(5), [2, 3]);
  assert.deepEqual(sizes(6), [2, 3, 1]);
  assert.deepEqual(sizes(8), [2, 3, 3]);
  for (let n = 1; n <= 8; n++) assert.equal(paginate(Array(n).fill(0)).flat().length, n);
});

test('pageSize: A4 by default, Letter on request, A4 for junk', () => {
  assert.equal(pageSize(), PAGE_SIZES.A4);
  process.env.PAGE_SIZE = 'Letter';
  assert.equal(pageSize(), PAGE_SIZES.Letter);
  process.env.PAGE_SIZE = 'Tabloid';
  assert.equal(pageSize(), PAGE_SIZES.A4);
});

test('pdfName drops characters file systems refuse', () => {
  assert.equal(pdfName({ feature: 'Smart Scheduling' }), 'Smart Scheduling One-Pager.pdf');
  assert.equal(pdfName({ feature: 'A/B: "Tests"?*<>|\\' }), 'AB Tests One-Pager.pdf');
});

test('headlineHtml: accents, escaped', () => {
  assert.equal(headlineHtml('Book [right <now>] & go'), 'Book <span class="accent">right &lt;now&gt;</span> &amp; go');
});

test('socialHtml: one link per profile with its icon', () => {
  const html = socialHtml(brand);
  assert.equal(count(html, /<a /g), brand.social.length);
  assert.match(html, /<a href="https:\/\/www\.youtube\.com\/" aria-label="YouTube" class="social"><svg/);
  assert.equal(socialHtml({ ...brand, social: [] }), '');
});

test('onepagerHtml: the example on two A4 pages', () => {
  const b = brief();
  const html = onepagerHtml({ brief: b, brand, stills: stillsFor(b), fontUrl: (p) => `fonts/${p.split(/[\\/]/).pop()}` });
  assert.equal(count(html, /<section class="page">/g), 2);
  assert.equal(count(html, /<header class="hero">/g), 1);
  assert.equal(count(html, /<footer class="cta">/g), 1); // the CTA on the last page only
  assert.equal(count(html, /<footer class="foot">/g), 1);
  assert.equal(count(html, /<div class="row( flip)?">/g), 5);
  assert.equal(count(html, /<div class="row flip">/g), 2); // alternating
  assert.match(html, /<title>Smart Scheduling — Acme Cloud<\/title>/);
  assert.match(html, /<h1>Book meetings <span class="accent">right inside<\/span> the conversation<\/h1>/);
  assert.match(html, /<div class="pill">#product update<\/div>/);
  assert.match(html, /<span class="eyebrow">Coming soon!<\/span>Reschedule with a single text/);
  assert.match(html, /class="anim capture" src="assets\/smart-scheduling--calendars\.gif"/);
  assert.match(html, /<a class="button" href="https:\/\/www\.acme\.example\/signup">Start a free 14-day trial<\/a>/);
  // website, phone and logos are links in the PDF
  assert.match(html, /<a href="https:\/\/www\.acme\.example">acme\.example<\/a><span class="slash">\/<\/span><a href="tel:5550100199">\(555\) 010-0199<\/a>/);
  assert.equal(count(html, /<a class="logo" href="https:\/\/www\.acme\.example"/g), 2); // hero and closing bar
  assert.match(html, /@page \{ size: A4; margin: 0; \}/);
  assert.match(html, /src:url\("fonts\/Inter-Regular\.woff2"\)/);
});

test('onepagerHtml: no GIF, no animated image; Letter size', () => {
  const b = brief();
  const html = onepagerHtml({ brief: b, brand, stills: stillsFor(b, { gifs: false }), fontUrl: (p) => p, size: PAGE_SIZES.Letter });
  assert.equal(count(html, /class="anim/g), 0);
  assert.match(html, /@page \{ size: letter;/);
  assert.match(html, /\.page \{ width: 816px; height: 1056px;/);
});

test('onepagerHtml: the hero animates through overlays over embedded scenes', () => {
  const b = brief();
  const stills = stillsFor(b);
  stills[b.hero.scene].embeds = [{ scene: 'smart-scheduling--suggest-times', x: 0.1, y: 0.2, width: 0.5, height: 0.4, radius: 0.02 }];
  const html = onepagerHtml({ brief: b, brand, stills, fontUrl: (p) => p });
  assert.match(html, /<div class="art"><img src="assets\/smart-scheduling--hero\.png" alt=""><img class="overlay" src="assets\/smart-scheduling--suggest-times\.gif" alt="" style="left:10\.000%;top:20\.000%;width:50\.000%;height:40\.000%;/);
});

test('onepagerHtml escapes copy', () => {
  const b = { ...brief(), feature: 'A <b>&</b>', intro: '<script>x</script>' };
  const html = onepagerHtml({ brief: b, brand, stills: stillsFor(b), fontUrl: (p) => p });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /<title>A &lt;b&gt;&amp;&lt;\/b&gt; — /);
});

test('onepagerHtml: no subtitle, no subtitle paragraph', () => {
  const b = brief();
  b.cta = { ...b.cta, subtitle: '' };
  const html = onepagerHtml({ brief: b, brand, stills: stillsFor(b), fontUrl: (p) => p });
  assert.match(html, /<h3>[^<]+<\/h3>\s*<a class="button"/);
});

test('onepagerHtml: the brief\'s links join the footer line on every page', () => {
  const b = { ...brief(), links: [{ label: 'Help article', url: 'https://help.acme.example/a/1' }, { label: 'Feature page', url: 'https://www.acme.example/f' }] };
  const html = onepagerHtml({ brief: b, brand, stills: stillsFor(b), fontUrl: (p) => p });
  assert.equal(count(html, /<a href="https:\/\/help\.acme\.example\/a\/1">Help article<\/a>/g), 2);
  assert.equal(count(html, /<a href="https:\/\/www\.acme\.example\/f">Feature page<\/a>/g), 2);
});
