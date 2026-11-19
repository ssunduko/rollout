import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_TYPES, clean, schemaContext, pageJsonLd, faqFromHtml, templateCode, wfBinding, fillTemplate,
  validateJsonLd, nodesOf, ITEM_FIELDS,
} from '../../pipeline/schema.mjs';
import { auditHtml } from '../../pipeline/seo.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';

const brand = loadBrand(); // brand/example, from .env.example
const BASE = 'https://www.acme.example';
const conf = brand.web.schema;
const ctxFor = (name) => schemaContext(brand, { template: conf.templates[name] });
const fails = (data) => validateJsonLd(data).filter((f) => f.level === 'fail');
const byType = (data, t) => nodesOf(data).find((n) => [n['@type']].flat().includes(t));

// values for every property of every type, so each type's page can be built
const SAMPLE = {
  slug: 'hello', path: '/pricing', headline: 'Hello world', name: 'Hello world', description: 'A page.',
  image: `${BASE}/i.png`, thumbnailUrl: `${BASE}/t.png`, datePublished: '2026-11-01T10:00:00.000Z', dateModified: '2026-11-02',
  uploadDate: '2026-11-01', startDate: '2026-12-01T17:00:00Z', endDate: '2026-12-01T18:00:00Z', embedUrl: 'https://www.youtube.com/embed/x',
  video: 'https://www.youtube.com/embed/x', recordingUrl: 'https://www.youtube.com/embed/y', registrationUrl: `${BASE}/register`,
  authorName: 'Ann Lee', authorUrl: 'ann-lee', authorImage: `${BASE}/ann.png`, section: 'Guides', keywords: 'a, b',
  audioUrl: `${BASE}/e.mp3`, episodeNumber: '3', transcript: 'Words.', customer: 'Northwind', industry: 'Retail',
  location: 'Austin', jobTitle: 'Writer', website: 'https://partner.example', duration: 'PT2M35S',
};

test('the brand context: base, language, publisher and product from web.schema', () => {
  const c = schemaContext(brand);
  assert.equal(c.base, BASE);
  assert.equal(c.language, 'en');
  assert.deepEqual(c.org, { name: brand.name, url: BASE, logo: conf.organization.logo, id: null });
  assert.equal(c.product.name, conf.product.name);
  assert.equal(schemaContext({ name: 'X', website: 'https://x.example/', web: { schema: { organization: { name: 'Y' } } } }).org.name, 'Y');
  assert.equal(schemaContext({ name: 'X', website: 'https://x.example/' }).base, 'https://x.example');
});

test('clean drops empty values at any depth and keeps zeros and false', () => {
  assert.deepEqual(clean({ a: '', b: null, c: [], d: {}, e: { f: undefined }, g: 0, h: false, i: [1, null, ''], j: { k: 'x' } }), { g: 0, h: false, i: [1], j: { k: 'x' } });
});

test('every page type builds valid JSON-LD from full values, with a breadcrumb under its section', () => {
  const templates = Object.fromEntries(Object.entries(conf.templates).map(([n, t]) => [t.type, n]));
  for (const type of Object.keys(PAGE_TYPES)) {
    const ctx = type === 'page' ? schemaContext(brand, { page: { breadcrumb: { name: 'Pricing' } } }) : ctxFor(templates[type]);
    const data = pageJsonLd(type, SAMPLE, ctx);
    assert.equal(data['@context'], 'https://schema.org', type);
    assert.deepEqual(fails(data), [], `${type}: ${JSON.stringify(fails(data))}`);
    const crumbs = byType(data, 'BreadcrumbList');
    assert.ok(crumbs, `${type} has a breadcrumb`);
    const items = crumbs.itemListElement;
    assert.equal(items[0].item, `${BASE}/`, type);
    assert.equal(items.at(-1).item.startsWith(BASE), true, type);
  }
});

test('article: the page address from the template path, the author linked under authorPath', () => {
  const data = pageJsonLd('article', SAMPLE, ctxFor('blog'));
  const a = byType(data, 'BlogPosting');
  assert.equal(a.url, `${BASE}/blog/hello`);
  assert.equal(a['@id'], `${BASE}/blog/hello#article`);
  assert.deepEqual(a.author, { '@type': 'Person', name: 'Ann Lee', url: `${BASE}/author/ann-lee`, image: `${BASE}/ann.png` });
  assert.equal(a.publisher.name, brand.name);
  assert.deepEqual(byType(data, 'BreadcrumbList').itemListElement.map((i) => i.name), ['Home', 'Blog', 'Hello world']);
  const noAuthor = byType(pageJsonLd('article', { ...SAMPLE, authorName: undefined }, ctxFor('blog')), 'BlogPosting');
  assert.equal(noAuthor.author['@type'], 'Organization', 'no author: the publisher wrote it');
  assert.equal(byType(pageJsonLd('article', SAMPLE, ctxFor('playbooks')), 'Article').url, `${BASE}/playbooks/hello`, 'schemaType: Article');
});

test('feature: WebPage about a SoftwareApplication with the brand\'s product facts, and its video', () => {
  const data = pageJsonLd('feature', SAMPLE, ctxFor('features'));
  const app = byType(data, 'SoftwareApplication');
  assert.equal(app.name, `${conf.product.name} Hello world`);
  assert.deepEqual(app.offers, { '@type': 'Offer', ...conf.product.offers });
  assert.equal(byType(data, 'WebPage').about['@id'], app['@id']);
  assert.equal(byType(data, 'VideoObject').embedUrl, SAMPLE.video);
});

test('event: an online event at its own page, free when the template says so, with its recording', () => {
  const e = byType(pageJsonLd('event', SAMPLE, ctxFor('webinars')), 'Event');
  assert.equal(e.eventAttendanceMode, 'https://schema.org/OnlineEventAttendanceMode');
  assert.deepEqual(e.location, { '@type': 'VirtualLocation', url: `${BASE}/webinars/hello` });
  assert.equal(e.offers.price, '0');
  assert.equal(e.offers.url, SAMPLE.registrationUrl);
  assert.equal(e.recordedIn.embedUrl, SAMPLE.recordingUrl);
});

test('the other types: podcast series, story subject, author and partner profiles, comparison, static page', () => {
  assert.equal(byType(pageJsonLd('podcast', SAMPLE, ctxFor('podcasts')), 'PodcastEpisode').partOfSeries.name, conf.templates.podcasts.series.name);
  assert.equal(byType(pageJsonLd('story', SAMPLE, ctxFor('stories')), 'Article').about.name, 'Northwind');
  assert.equal(byType(pageJsonLd('profile', SAMPLE, ctxFor('authors')), 'ProfilePage').mainEntity['@type'], 'Person');
  assert.equal(byType(pageJsonLd('partner', SAMPLE, ctxFor('partners')), 'ProfilePage').mainEntity['@type'], 'ProfessionalService');
  assert.equal(byType(pageJsonLd('comparison', SAMPLE, ctxFor('compare')), 'WebPage').about.name, conf.product.name);
  const about = pageJsonLd('page', { path: '/about', name: 'About' }, schemaContext(brand, { page: conf.pages['/about'] }));
  assert.equal(nodesOf(about)[0]['@type'], 'AboutPage');
  assert.equal(nodesOf(about).length, 1, 'no breadcrumb unless the page asks for one');
  assert.equal(nodesOf(pageJsonLd('page', { path: '/', name: 'Home' }, schemaContext(brand)))[0].url, `${BASE}/`);
});

test('a section without a listing page is left out of the breadcrumb', () => {
  const ctx = schemaContext(brand, { template: { ...conf.templates.compare, section: { name: 'Compare' } } });
  assert.deepEqual(byType(pageJsonLd('comparison', SAMPLE, ctx), 'BreadcrumbList').itemListElement.map((i) => i.name), ['Home', 'Hello world']);
});

test('pageJsonLd adds an FAQPage; faqFromHtml reads question headings and their answers', () => {
  const html = '<h2>FAQs</h2><h3>Is it free?</h3><p>Yes, &amp; always.</p><h3>Not a question</h3><p>x</p><h3>Can I <em>cancel</em>?</h3><p>Any time.</p><ul><li>Online</li></ul><h2>Next</h2>';
  const faq = faqFromHtml(html);
  assert.deepEqual(faq, [{ q: 'Is it free?', a: 'Yes, & always.' }, { q: 'Can I cancel ?', a: 'Any time. Online' }]);
  const data = pageJsonLd('page', { path: '/pricing', name: 'Pricing' }, schemaContext(brand), { faq });
  assert.equal(byType(data, 'FAQPage').mainEntity[0].acceptedAnswer.text, 'Yes, & always.');
  assert.deepEqual(faqFromHtml('<p>nothing</p>'), []);
});

test('pageJsonLd refuses an unknown type', () => {
  assert.throws(() => pageJsonLd('recipe', SAMPLE, schemaContext(brand)), /no page type "recipe" — article, video/);
});

test('templateCode: every value bound to its field, inside URLs too; the bindings and what is missing', () => {
  const { code, bindings, missing } = templateCode('article', conf.templates.blog.fields, ctxFor('blog'));
  assert.match(code, /^<script type="application\/ld\+json">\n[\s\S]*\n<\/script>$/);
  assert.ok(code.includes(`"headline": "${wfBinding('title', 'text')}"`));
  assert.ok(code.includes(`"url": "${BASE}/blog/${wfBinding('slug', 'slug')}"`));
  assert.ok(code.includes(`"@id": "${BASE}/blog/${wfBinding('slug', 'slug')}#article"`));
  assert.ok(code.includes(`"url": "${BASE}/author/${wfBinding('author:slug', 'slug')}"`));
  assert.ok(code.includes(`"image": "${wfBinding('main-image', 'image')}"`));
  assert.ok(code.includes(`"datePublished": "${wfBinding('date', 'date')}"`));
  assert.deepEqual(bindings.find((b) => b.field === 'main-image'), { field: 'main-image', kind: 'image', type: 'ImageRef' });
  assert.equal(bindings.filter((b) => b.field === 'slug').length, 1, 'each field listed once');
  assert.deepEqual(missing, []);
  assert.doesNotMatch(code, /@@F\d+@@/);
  const thin = templateCode('video', { name: 'name' }, ctxFor('videos'));
  assert.deepEqual(thin.missing, ['description', 'thumbnailUrl', 'uploadDate', 'embedUrl']);
});

test('wfBinding: the field as Webflow\'s custom code writes it', () => {
  assert.equal(wfBinding('title', 'text'), '{{wf {&quot;path&quot;:&quot;title&quot;,&quot;type&quot;:&quot;PlainText&quot;\\} }}');
  assert.match(wfBinding('main-image', 'image'), /ImageRef/);
  assert.match(wfBinding('date', 'date'), /&quot;Date&quot;/);
});

test('templateCode refuses unknown properties and static pages', () => {
  assert.throws(() => templateCode('video', { nope: 'x' }, ctxFor('videos')), /video: no property nope — it takes slug, name/);
  assert.throws(() => templateCode('page', {}, schemaContext(brand)), /no template/);
});

test('fillTemplate: a template filled with an item is valid JSON-LD; empty and risky values are listed', () => {
  const { code } = templateCode('article', conf.templates.blog.fields, ctxFor('blog'));
  const { data, risky, unbound } = fillTemplate(code, {
    slug: 'hello', title: 'Say "hi"', 'meta-description': 'D', 'main-image': { url: `${BASE}/i.png` }, date: '2026-11-01T00:00:00.000Z',
    'author:name': 'Ann', 'author:slug': 'ann', 'category:name': '',
  });
  const a = byType(data, 'BlogPosting');
  assert.equal(a.headline, 'Say "hi"');
  assert.equal(a.image, `${BASE}/i.png`);
  assert.equal(a.author.url, `${BASE}/author/ann`);
  assert.equal(a.articleSection, undefined, 'an empty field leaves its property out');
  assert.deepEqual(unbound, ['category:name']);
  assert.deepEqual(risky.map((r) => r.field), ['title']);
  assert.deepEqual(fails(data), []);
});

test('ITEM_FIELDS: the item dates Webflow binds without a field', () => {
  assert.deepEqual(Object.keys(ITEM_FIELDS), ['published-on', 'updated-on', 'created-on']);
});

test('validateJsonLd: required properties fail, recommended ones warn', () => {
  const f = validateJsonLd({ '@context': 'https://schema.org', '@type': 'VideoObject', name: 'V' });
  assert.deepEqual(f.filter((x) => x.level === 'fail').map((x) => x.message), ['missing thumbnailUrl (required)', 'missing uploadDate (required)']);
  assert.ok(f.some((x) => x.level === 'warn' && x.message === 'no embedUrl or contentUrl (recommended)'));
  assert.deepEqual(validateJsonLd({ '@type': 'SoftwareApplication', name: 'A', aggregateRating: { ratingValue: '4' } }).filter((x) => x.level === 'fail'), [], 'offers or aggregateRating');
  assert.deepEqual(validateJsonLd({ '@type': 'Thing', name: 'x' }), [], 'types without rules pass');
  assert.equal(validateJsonLd({ name: 'x' })[0].message, 'a node without @type');
});

test('validateJsonLd: dates, URLs, headlines, authors, FAQ, breadcrumbs, events, durations', () => {
  const msgs = (d) => validateJsonLd(d).map((x) => `${x.level} ${x.message}`);
  const article = { '@type': 'BlogPosting', headline: 'Title | Brand', image: '/i.png', datePublished: 'Nov 1, 2026', author: { name: 'A', url: '/author/a' }, publisher: {}, mainEntityOfPage: {} };
  const m = msgs(article);
  assert.ok(m.includes('fail datePublished "Nov 1, 2026" is not an ISO 8601 date'));
  assert.ok(m.some((x) => /^warn headline .* ends with a site name/.test(x)));
  assert.ok(m.includes('warn author url "/author/a" is not an absolute URL'));
  assert.ok(m.includes('warn image is not an absolute URL'));
  assert.ok(msgs({ ...article, headline: 'x'.repeat(111) }).includes('warn headline is 111 characters (Google shows up to 110)'));
  assert.ok(msgs({ ...article, author: { url: 'https://a' } }).includes('fail author without a name'));

  assert.deepEqual(msgs({ '@type': 'FAQPage', mainEntity: [{ name: 'Q?' }, { acceptedAnswer: { text: 'A' } }] }), [
    'fail question 1 has no answer (acceptedAnswer.text)', 'fail question 2 has no text (name)',
  ]);
  assert.deepEqual(msgs({ '@type': 'BreadcrumbList', itemListElement: [{ position: 1, name: 'Home', item: '/' }, { position: 3, name: 'Page' }] }), [
    'fail item 1 ("Home") has no absolute item URL', 'fail item 2 has position 3',
  ]);
  assert.ok(msgs({ '@type': 'Event', name: 'E', startDate: '2026-12-01', location: { '@type': 'Place' } }).includes('fail location has neither a url (online) nor an address'));
  assert.ok(msgs({ '@type': 'VideoObject', name: 'V', thumbnailUrl: 'https://t', uploadDate: '2026-01-01', duration: '2:35' }).includes('warn duration "2:35" is not ISO 8601 (e.g. PT2M35S)'));
  assert.ok(msgs({ '@type': 'WebPage', name: 'P', url: 'page' }).includes('warn url "page" is not an absolute URL'));
});

test('nodesOf flattens @graph and arrays', () => {
  assert.deepEqual(nodesOf([{ '@graph': [{ '@type': 'A' }, [{ '@type': 'B' }]] }, { '@type': 'C' }]).map((n) => n['@type']), ['A', 'B', 'C']);
});

test('auditHtml reports each JSON-LD type\'s missing properties', () => {
  const html = '<title>T</title><script type="application/ld+json">{"@type":"Event","name":"E"}</script><h1>T</h1>';
  const msgs = auditHtml(html).findings.map((f) => `${f.level} ${f.message}`);
  assert.ok(msgs.includes('fail structured data: Event: missing startDate (required)'));
  assert.ok(msgs.includes('warn structured data: Event: no organizer (recommended)'));
});
