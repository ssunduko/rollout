import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleCase, webChrome, webpageHtml } from '../../pipeline/webpage.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { loadBrief } from '../../pipeline/brief.mjs';

const brand = loadBrand();
const brief = () => loadBrief('smart-scheduling', brand);
function mediaFor(b) {
  const media = { video: { src: 'assets/video.png' }, og: 'assets/og.png' };
  for (const s of b.sections) media[s.scene] = { src: `assets/${s.scene}.gif`, width: 1180, height: 676 };
  return media;
}
const page = (b = brief(), br = brand) => webpageHtml({ brief: b, brand: br, media: mediaFor(b), fontUrl: (p) => `assets/fonts/${p.split(/[\\/]/).pop()}` });
const count = (html, re) => (html.match(re) ?? []).length;

test('titleCase: capitals except small joining words mid-title', () => {
  assert.equal(titleCase('book meetings in the conversation'), 'Book Meetings in the Conversation');
  assert.equal(titleCase('the start of it'), 'The Start of It'); // first and last always capitalised
  assert.equal(titleCase('AI for iOS and SMS'), 'AI for iOS and SMS'); // words with capitals kept
  assert.equal(titleCase('step one: the setup'), 'Step One: The Setup'); // after a colon starts again
  assert.equal(titleCase("what's new with you"), "What's New with You");
});

test('webChrome: the brand\'s web block', () => {
  const c = webChrome(brief(), brand);
  assert.equal(c.header.contact.value, '(555) 010-0199');
  assert.equal(c.header.buttons.length, 2);
  assert.equal(c.signup.action, 'https://www.acme.example/signup');
  assert.equal(c.signup.placeholder, 'Work Email Address*');
  assert.deepEqual(c.sectionButton, { label: 'Start Your 14-Day Trial', url: 'https://www.acme.example/signup' });
  assert.equal(c.closingNote, 'Still have questions? Call us: (555) 010-0199');
  assert.equal(c.integrations, null);
});

test('webChrome: a brand without a web block falls back to the brief and brand', () => {
  const b = brief();
  const c = webChrome(b, { ...brand, web: null });
  assert.deepEqual(c.header.buttons, [{ label: 'Try for free', url: b.cta.url, style: 'cta' }]);
  assert.equal(c.header.nav, brand.nav);
  assert.equal(c.signup.title, b.cta.title);
  assert.equal(c.signup.button, 'Try for free');
  assert.deepEqual(c.sectionButton, { label: b.cta.button, url: b.cta.url });
  assert.deepEqual(c.footer.columns, [{ title: 'Product', links: brand.nav }]);
  assert.equal(c.footer.copyright, 'Acme Cloud');
  assert.equal(c.footer.legal, brand.legal);
  assert.deepEqual(webChrome(b, { ...brand, web: null, nav: [] }).footer.columns, []);
});

test('webChrome: the brief\'s section button overrides the brand\'s', () => {
  const b = brief();
  b.web.sectionButton = { label: 'Go' };
  assert.deepEqual(webChrome(b, brand).sectionButton, { label: 'Go', url: 'https://www.acme.example/signup' });
});

test('webChrome: the brief\'s back link overrides the brand\'s', () => {
  assert.deepEqual(webChrome(brief(), brand).back, { label: 'All features', url: 'https://www.acme.example/features' });
  const b = brief();
  b.web.back = { label: 'All product updates', url: 'https://www.acme.example/product-updates' };
  assert.deepEqual(webChrome(b, brand).back, b.web.back);
  b.web.back = { label: 'All updates' };
  assert.deepEqual(webChrome(b, brand).back, { label: 'All updates', url: 'https://www.acme.example/features' });
  assert.match(page(b), /<a class="back" href="https:\/\/www\.acme\.example\/features">All updates<\/a>/);
});

test('webpageHtml: the example page', () => {
  const html = page();
  assert.match(html, /<title>Smart Scheduling: Book Meetings Over Text \| Acme Cloud<\/title>/);
  assert.match(html, /<meta name="description" content="Smart Scheduling books meetings inside the text conversation/);
  assert.match(html, /<meta property="og:image" content="assets\/og\.png">/);
  assert.match(html, /<h1 class="display">Book meetings right inside the conversation<\/h1>/); // no brackets
  assert.match(html, /<p class="lead">Smart Scheduling books meetings inside the text thread/); // lead, not intro
  // search and answer engines: the canonical address (brand web.pageUrl), the FAQ on the page, and JSON-LD
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.acme\.example\/features\/smart-scheduling">/);
  assert.equal(count(html, /<div class="qa"><h3>[^<]+\?<\/h3><p>/g), 5);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  assert.deepEqual(ld['@graph'].map((g) => g['@type']), ['WebPage', 'SoftwareApplication', 'FAQPage']);
  assert.equal(ld['@graph'][2].mainEntity[0].name, 'What is Smart Scheduling?');
  assert.equal(count(html, /<div class="feature/g), 5);
  assert.equal(count(html, /<div class="feature flip">/g), 2);
  assert.equal(count(html, /class="btn cta" href="https:\/\/www\.acme\.example\/signup">Start Your 14-Day Trial</g), 5);
  assert.match(html, /<img src="assets\/smart-scheduling--calendars\.gif" width="1180" height="676" alt="Scheduling settings/);
  assert.match(html, /<span class="eyebrow">Coming soon!<\/span>/);
  assert.match(html, /data-placeholder="video"/); // no web.video yet
  assert.match(html, /<h2 class="display">Start Your <span class="mark">Free 14-Day<\/span> Trial<\/h2>/);
  assert.match(html, /<form action="https:\/\/www\.acme\.example\/signup" method="get">/);
  assert.match(html, /<span class="nowrap">\(555\) 010-0199<\/span>/); // phone kept on one line
  assert.match(html, new RegExp(`© ${new Date().getFullYear()} `));
  assert.match(html, /src:url\("assets\/fonts\/Inter-Regular\.woff2"\)/);
  assert.doesNotMatch(html, /class="integrations"/);
});

test('webpageHtml: a video embed replaces the placeholder', () => {
  const b = brief();
  b.web.video = 'https://player.example/embed/1';
  const html = page(b);
  assert.match(html, /<iframe src="https:\/\/player\.example\/embed\/1" title="Smart Scheduling"/);
  assert.doesNotMatch(html, /data-placeholder/);
});

test('webpageHtml: titleCase brands, SEO title, intro fallback, integrations strip', () => {
  const b = brief();
  b.seo.title = 'Custom <Title>';
  delete b.lead;
  const br = { ...brand, web: { ...brand.web, titleCase: true, integrations: { title: 'Works with', subtitle: 'Your tools', logos: [{ src: 'a.png', alt: 'A' }] } } };
  const html = page(b, br);
  assert.match(html, /<title>Custom &lt;Title&gt;<\/title>/);
  assert.match(html, /<h1 class="display">Book Meetings Right Inside the Conversation<\/h1>/);
  assert.match(html, /<h2 class="display">Offer Open Times Without Leaving the Thread<\/h2>/);
  assert.match(html, /<p class="lead">Smart Scheduling turns/);
  assert.match(html, /<section class="integrations">[\s\S]*<img src="a\.png" alt="A" loading="lazy">/);
});

test('webpageHtml escapes copy and alt text', () => {
  const b = brief();
  b.sections[0] = { ...b.sections[0], title: '<script>', alt: '"quoted"' };
  const html = page(b);
  assert.equal(count(html, /<script>/g), 1); // only the menu script
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /alt="&quot;quoted&quot;"/);
});
