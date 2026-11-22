import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEO_LIMITS, keywordIn, checkMeta, checkAlt, checkSlug, checkFaq, checkCmsFields,
  jsonLdScript, featureJsonLd, episodeJsonLd, auditHtml, seoLimits, checkAnswerFirst, checkLinks,
} from '../../pipeline/seo.mjs';

const brand = {
  name: 'Acme Cloud', website: 'https://www.acme.example',
  web: { schema: { product: { operatingSystem: 'Web, iOS, Android', offers: { price: '29', priceCurrency: 'USD' } } } },
};
const good = {
  title: 'Smart Scheduling: Book Meetings Over Text | Acme Cloud',
  description: 'Smart Scheduling books meetings inside the text conversation: suggest open times, sync team calendars and send reminders automatically.',
};
const faq = [
  { q: 'What is Smart Scheduling?', a: 'Smart Scheduling lets customers book a meeting without leaving the text conversation.' },
  { q: 'Which calendars does it work with?', a: 'It connects to Google and Microsoft calendars and books the next free rep.' },
  { q: 'Are reminders sent automatically?', a: 'Yes. Reminders go out 24 hours and 1 hour before every meeting.' },
];

test('keywordIn matches whole words, ignoring case and punctuation', () => {
  assert.ok(keywordIn('Meet Inbox Pilot, the assistant', 'inbox pilot'));
  assert.ok(keywordIn('Smart-Scheduling: book', 'Smart Scheduling'));
  assert.ok(!keywordIn('Inbox Pilots everywhere', 'Inbox Pilot'));
  assert.ok(!keywordIn('anything', null));
});

test('checkMeta: a good title and description pass', () => {
  assert.deepEqual(checkMeta({ ...good, keyword: 'Smart Scheduling' }), []);
});

test('checkMeta: lengths, the keyword, missing and repeated text', () => {
  const long = checkMeta({ title: 'x'.repeat(SEO_LIMITS.title[1] + 1), description: 'y'.repeat(SEO_LIMITS.description[1] + 1), where: 'p' });
  assert.ok(long.some((m) => /^p: the SEO title is 61 characters — search results cut it/.test(m)));
  assert.ok(long.some((m) => /the meta description is 161 characters/.test(m)));
  const short = checkMeta({ title: 'Short', description: 'Too short.' });
  assert.ok(short.some((m) => /SEO title is only 5 characters \(aim for 30–60\)/.test(m)));
  assert.ok(short.some((m) => /meta description is only 10 characters \(aim for 120–160\)/.test(m)));
  const off = checkMeta({ ...good, keyword: 'Inbox Pilot' });
  assert.ok(off.some((m) => /the SEO title does not name "Inbox Pilot"/.test(m)));
  assert.ok(off.some((m) => /the meta description does not name "Inbox Pilot"/.test(m)));
  assert.deepEqual(checkMeta({}), ['page: no SEO title', 'page: no meta description']);
  const same = 'Smart Scheduling books meetings over text for every team in the company, with calendars, reminders and booking rules per inbox.';
  assert.ok(checkMeta({ title: same, description: same }).some((m) => /repeats the title/.test(m)));
});

test('checkAlt: says what the image shows — not a file name, not "image of"', () => {
  assert.deepEqual(checkAlt('A reply offering three open meeting times in a text conversation', 'hero'), []);
  assert.deepEqual(checkAlt('', 'hero'), ['hero: no alt text']);
  assert.deepEqual(checkAlt(null, 'hero'), ['hero: no alt text']);
  assert.match(checkAlt('podcast-1280x720.png', 'img')[0], /is a file name/);
  assert.match(checkAlt('feature-hero-image', 'img')[0], /is a file name/);
  assert.match(checkAlt('Screenshot of the scheduling settings page', 'img')[0], /starts with "Screenshot of"/);
  assert.match(checkAlt('An image of the inbox with three open times', 'img')[0], /starts with "An image of"/);
  assert.ok(checkAlt('x'.repeat(130), 'img').some((m) => /130 characters/.test(m)));
  assert.ok(checkAlt('Logo', 'img').some((m) => /too short/.test(m)));
});

test('checkSlug: short and carrying the keyword', () => {
  assert.deepEqual(checkSlug('smart-scheduling', 'Smart Scheduling'), []);
  assert.deepEqual(checkSlug('episode-24-inbox-pilot', 'Inbox Pilot'), []);
  assert.ok(checkSlug('a-b-c-d-e-f-g', null)[0].includes('7 words'));
  assert.match(checkSlug('book-meetings', 'Smart Scheduling')[0], /does not carry "Smart Scheduling"/);
});

test('checkFaq: shape is an error, quality a warning, none a warning', () => {
  assert.deepEqual(checkFaq(faq), { errors: [], warnings: [] });
  assert.match(checkFaq(undefined).warnings[0], /no FAQ/);
  assert.deepEqual(checkFaq('nope').errors, ['faq is a list of { "q": "…", "a": "…" }']);
  assert.deepEqual(checkFaq([...faq, { q: 'Only a question?' }]).errors, ['faq[3] needs a question "q" and an answer "a"']);
  const w = checkFaq([
    { q: 'Tell me about it', a: 'It books meetings in the conversation, with reminders.' },
    { q: 'Does it work?', a: 'Yes' },
    { q: 'Does it work?', a: 'x'.repeat(SEO_LIMITS.answer[1] + 1) },
  ]).warnings;
  assert.ok(w.some((m) => /faq\[0\]\.q is not a question/.test(m)));
  assert.ok(w.some((m) => /faq\[1\]\.a is a bare yes\/no/.test(m)));
  assert.ok(w.some((m) => /faq\[1\]\.a is only 3 characters/.test(m)));
  assert.ok(w.some((m) => /faq\[2\]\.q repeats an earlier question/.test(m)));
  assert.ok(w.some((m) => /faq\[2\]\.a is 321 characters/.test(m)));
  assert.match(checkFaq(faq.slice(0, 1)).warnings[0], /1 question\(s\) — aim for 3–8/);
});

test('checkCmsFields: the collection\'s own SEO fields, images, slug, rich text headings', () => {
  const fields = {
    name: 'Episode 7: Smart Scheduling Books the Right Time',
    slug: 'episode-7-smart-scheduling',
    'meta-title': good.title,
    'meta-description': good.description,
    'main-image': { asset: 'assets/social/podcast-1280x720.png', alt: 'Smart Scheduling offering three open times in a text reply' },
    body: '<h2>How it works</h2><p>…</p>',
  };
  assert.deepEqual(checkCmsFields(fields, { keyword: 'Smart Scheduling', where: 'f' }), []);
  const w = checkCmsFields({ ...fields, 'meta-title': 'x'.repeat(70), 'main-image': { fileId: '1', url: 'u', alt: '' }, body: '<h1>Step</h1>' }, { keyword: 'Smart Scheduling', where: 'f' });
  assert.ok(w.some((m) => /^f: the SEO title is 70 characters/.test(m)));
  assert.ok(w.some((m) => /^f\.main-image: no alt text/.test(m)));
  assert.ok(w.some((m) => /^f\.body: the text holds an <h1>/.test(m)));
  // no SEO-title field: the template's title is not judged, only the description
  const noTitle = checkCmsFields({ name: 'Smart Scheduling', slug: 'smart-scheduling', 'meta-description': 'Short.' }, { keyword: 'Smart Scheduling' });
  assert.ok(noTitle.every((m) => !/SEO title/.test(m)));
  assert.ok(noTitle.some((m) => /meta description is only 6 characters/.test(m)));
  assert.ok(checkCmsFields({ name: 'Book the right time' }, { keyword: 'Smart Scheduling' }).some((m) => /the title \(name\) does not name "Smart Scheduling"/.test(m)));
});

test('jsonLdScript: the data in a script tag that text can never close', () => {
  const s = jsonLdScript({ name: 'a</script><script>alert(1)</script>' });
  assert.match(s, /^<script type="application\/ld\+json">/);
  assert.equal((s.match(/<\/script>/g) ?? []).length, 1);
  assert.equal(JSON.parse(s.slice(s.indexOf('>') + 1, s.lastIndexOf('<'))).name, 'a</script><script>alert(1)</script>');
});

test('featureJsonLd: the page, the feature, its FAQ and video', () => {
  const brief = {
    feature: 'Smart Scheduling', lead: 'Book meetings in the thread.', seo: good, faq,
    sections: [{ title: 'Offer open times' }, { title: 'Sync calendars' }], web: { video: 'https://player.example/embed/1' },
  };
  const d = featureJsonLd({ brief, brand, url: 'https://www.acme.example/features/smart-scheduling', image: 'https://cdn.example/og.png' });
  assert.equal(d['@context'], 'https://schema.org');
  assert.deepEqual(d['@graph'].map((g) => g['@type']), ['WebPage', 'SoftwareApplication', 'FAQPage', 'VideoObject']);
  const [page, app, faqPage, video] = d['@graph'];
  assert.equal(page.name, good.title);
  assert.equal(page.url, 'https://www.acme.example/features/smart-scheduling');
  assert.deepEqual(page.about, { '@id': '#feature' });
  assert.equal(app['@id'], '#feature');
  assert.equal(app.name, 'Acme Cloud Smart Scheduling');
  assert.deepEqual(app.featureList, ['Offer open times', 'Sync calendars']);
  assert.deepEqual(app.publisher, { '@type': 'Organization', name: 'Acme Cloud', url: 'https://www.acme.example' });
  assert.equal(faqPage.mainEntity.length, 3);
  assert.deepEqual(faqPage.mainEntity[0], { '@type': 'Question', name: faq[0].q, acceptedAnswer: { '@type': 'Answer', text: faq[0].a } });
  assert.equal(video.embedUrl, 'https://player.example/embed/1');
  // without a FAQ, video, url or image: only what is known, nothing null
  const bare = featureJsonLd({ brief: { feature: 'X', intro: 'An intro.', sections: [] }, brand: { name: 'Acme' } });
  assert.deepEqual(bare['@graph'].map((g) => g['@type']), ['WebPage', 'SoftwareApplication']);
  assert.ok(!JSON.stringify(bare).includes('null'));
});

test('episodeJsonLd: the episode, its show, the audio and the transcript as text', () => {
  const d = episodeJsonLd({
    podcast: { episode: { number: 7, title: 'Episode 7: Book the Right Time', description: 'Show notes.' } },
    brand, show: { name: 'The Acme Show', url: 'https://open.example/show/1' },
    url: 'https://www.acme.example/podcasts/episode-7', listenUrl: 'https://open.example/episode/7',
    transcript: '<p><strong>Hana:</strong> Welcome &amp; hello.</p>', datePublished: '2026-11-01',
  });
  assert.equal(d['@type'], 'PodcastEpisode');
  assert.equal(d.episodeNumber, 7);
  assert.deepEqual(d.partOfSeries, { '@type': 'PodcastSeries', name: 'The Acme Show', url: 'https://open.example/show/1' });
  assert.deepEqual(d.associatedMedia, { '@type': 'MediaObject', url: 'https://open.example/episode/7' });
  assert.equal(d.transcript, 'Hana: Welcome & hello.');
  assert.equal(d.datePublished, '2026-11-01');
  const bare = episodeJsonLd({ podcast: { episode: { title: 'T', description: 'D' } }, brand });
  assert.deepEqual(Object.keys(bare).sort(), ['@context', '@type', 'description', 'name', 'publisher']);
});

const page = ({ head = '', body = '' } = {}) => `<!doctype html><html><head>
<title>${good.title}</title>
<meta name="description" content="${good.description}">
<link rel="canonical" href="https://www.acme.example/features/smart-scheduling">
<meta property="og:image" content="https://cdn.example/og.png">
<meta property="og:title" content="${good.title}">
<meta property="og:description" content="${good.description}">
<meta name="twitter:card" content="summary_large_image">
${head}</head><body><main>${body}</main></body></html>`;
const LD = jsonLdScript(featureJsonLd({ brief: { feature: 'Smart Scheduling', intro: 'i', sections: [], faq, seo: { title: good.title, description: good.description } }, brand, url: 'https://www.acme.example/features/smart-scheduling' }));

test('auditHtml: a well-made page has no findings', () => {
  const a = auditHtml(page({ head: LD, body: '<h1>Smart Scheduling books meetings in the thread</h1><h2>What is it?</h2><img src="a.png" alt="A reply with three open times">' }), { keyword: 'Smart Scheduling' });
  assert.deepEqual(a.findings, []);
  assert.equal(a.title, good.title);
  assert.equal(a.description, good.description);
  assert.equal(a.canonical, 'https://www.acme.example/features/smart-scheduling');
  assert.deepEqual(a.jsonLd, ['WebPage', 'SoftwareApplication', 'FAQPage']);
  assert.deepEqual(a.questions, ['What is it?']);
});

test('auditHtml: what the a badly made feature page gets wrong', () => {
  const html = `<html><head><title>Ask Inbox Pilot and Get It Done | Acme</title>
<meta content="Too short." name="description">
<meta content="https://cdn.example/item.png" property="og:image"/>
<meta property="og:image" content="https://cdn.example/site-default.png">
<meta name="robots" content="noindex">
<script type="application/ld+json">{ not json }</script>
</head><body><h1>Ask Inbox Pilot</h1><h1></h1><h1><strong>Step two</strong></h1><img src="x.png"></body></html>`;
  const a = auditHtml(html, { keyword: 'Smart Scheduling' });
  const has = (re) => a.findings.some((f) => re.test(f.message));
  assert.equal(a.description, 'Too short.'); // content before name is read too
  assert.deepEqual(a.h1, ['Ask Inbox Pilot', '', 'Step two']);
  assert.ok(has(/the page has 3 <h1> elements/));
  assert.ok(has(/an empty <h1>/));
  assert.ok(has(/the <h1> "Ask Inbox Pilot" does not name "Smart Scheduling"/));
  assert.ok(has(/no canonical link/));
  assert.ok(has(/robots says "noindex"/));
  assert.ok(has(/2 different og:image tags/));
  assert.ok(has(/image without alt text: x\.png/));
  assert.ok(has(/no questions answered on the page/));
  assert.ok(a.findings.some((f) => f.level === 'fail' && /JSON-LD\) does not parse/.test(f.message)));
  assert.ok(has(/no structured data/));
});

test('featureJsonLd: the product\'s offer, rating and platforms from the brand, so the feature can be a rich result', () => {
  const app = featureJsonLd({ brief: { feature: 'X', intro: 'i', sections: [] }, brand })['@graph'][1];
  assert.deepEqual(app.offers, { '@type': 'Offer', price: '29', priceCurrency: 'USD' });
  assert.equal(app.operatingSystem, 'Web, iOS, Android');
  const rated = featureJsonLd({ brief: { feature: 'X', intro: 'i', sections: [] }, brand: { name: 'A', web: { schema: { product: { aggregateRating: { ratingValue: '4.7', reviewCount: '9' } } } } } })['@graph'][1];
  assert.deepEqual(rated.aggregateRating, { '@type': 'AggregateRating', ratingValue: '4.7', reviewCount: '9' });
  assert.equal(rated.offers, undefined);
});

test("seoLimits: the brand's own title and description limits over the defaults", () => {
  assert.deepEqual(seoLimits({}), SEO_LIMITS);
  const l = seoLimits({ web: { seo: { limits: { title: [50, 60], description: [150, 160], unknown: [1, 2] } } } });
  assert.deepEqual(l.title, [50, 60]);
  assert.deepEqual(l.description, [150, 160]);
  assert.deepEqual(l.alt, SEO_LIMITS.alt);
  assert.ok(!('unknown' in l));
  const w = checkMeta({ title: 'Smart Scheduling: Book Meetings | Acme', description: 'Smart Scheduling books meetings in the thread, with reminders that go out on their own so fewer are missed.', keyword: 'Smart Scheduling', limits: l });
  assert.ok(w.some((m) => /SEO title is only 38 characters \(aim for 50–60\)/.test(m)), w.join('\n'));
  assert.ok(w.some((m) => /meta description is only 107 characters \(aim for 150–160\)/.test(m)), w.join('\n'));
});

test('checkAnswerFirst: the subject named within the first 100 words; a short first paragraph', () => {
  assert.deepEqual(checkAnswerFirst('<p>Smart Scheduling books meetings inside the text thread.</p><p>More.</p>', 'Smart Scheduling'), []);
  assert.deepEqual(checkAnswerFirst('Smart Scheduling books meetings in one tap.', 'Smart Scheduling'), []);
  const late = `<p>${'Word '.repeat(110)}Smart Scheduling.</p>`;
  const w = checkAnswerFirst(late, 'Smart Scheduling', 'site.fields.video-summary');
  assert.ok(w.some((m) => /site\.fields\.video-summary: the first 100 words do not name "Smart Scheduling"/.test(m)));
  assert.ok(w.some((m) => /the first paragraph is 112 words/.test(m)));
  assert.match(checkAnswerFirst('', 'X')[0], /no text/);
});

test("checkLinks: one link to the site's own pages, in the text or a link field; no 'click here'", () => {
  const site = 'https://www.acme.example';
  assert.deepEqual(checkLinks('<p>See <a href="/features/smart-scheduling">Smart Scheduling</a>.</p>', { site }), []);
  assert.deepEqual(checkLinks('<p>No links.</p>', { site, links: ['https://www.acme.example/videos/other'] }), []);
  assert.match(checkLinks('<p>Go <a href="https://elsewhere.example/x">elsewhere</a>.</p>', { site })[0], /no link to the site's own pages/);
  const weak = checkLinks('<p><a href="/features/x">Click here</a></p>', { site });
  assert.equal(weak.length, 1);
  assert.match(weak[0], /the link "Click here" \(\/features\/x\) says nothing about its page/);
});

test("checkCmsFields with aeo: a video item's summary and related links; an episode's subtitle", () => {
  const site = 'https://www.acme.example';
  const video = {
    name: 'Smart Scheduling walkthrough', slug: 'smart-scheduling-walkthrough',
    'meta-title': 'Smart Scheduling Walkthrough: Book Meetings by Text | Acme',
    'meta-description': 'Smart Scheduling in action: offer open times in the text thread, sync team calendars and send reminders automatically, so more meetings happen on time.',
    'video-summary': '<p>Smart Scheduling books meetings inside the text thread.</p>',
    'video-transcription': '<p>Hello and welcome.</p>',
    'related-videos-link-1': 'https://www.acme.example/videos/other',
  };
  const opts = { keyword: 'Smart Scheduling', where: 'site.fields', limits: seoLimits({ web: { seo: { limits: { title: [50, 60], description: [150, 160] } } } }), aeo: true, site };
  assert.deepEqual(checkCmsFields(video, opts), []);
  const noLink = checkCmsFields({ ...video, 'related-videos-link-1': '' }, opts);
  assert.ok(noLink.some((m) => /no link to the site's own pages/.test(m)), noLink.join('\n'));
  const late = checkCmsFields({ ...video, 'video-summary': '<p>Welcome to our channel, where we cover lots of things.</p>' }, opts);
  assert.ok(late.some((m) => /site\.fields\.video-summary: the first 100 words do not name "Smart Scheduling"/.test(m)));
  // an episode: its subtitle is the opening; no rich text or link field, so no link check
  const episode = { name: 'Episode 7: Smart Scheduling', slug: 'episode-7-smart-scheduling', subtitle: 'Smart Scheduling books meetings in the thread.' };
  assert.deepEqual(checkCmsFields(episode, { ...opts, limits: undefined }).filter((m) => /answer|link/.test(m)), []);
  assert.match(checkCmsFields({ name: 'E', slug: 'e' }, { ...opts, limits: undefined }).join('\n'), /no summary or description text/);
  // without aeo (the feature item), none of these checks run
  assert.ok(!checkCmsFields({ name: 'E', slug: 'e' }, { keyword: 'X' }).some((m) => /summary or description/.test(m)));
});

test("auditHtml: heading levels in order, <main>, Open Graph and Twitter tags, and the page's own type", () => {
  const html = `<html><head><title>${good.title}</title><meta name="description" content="${good.description}">
<link rel="canonical" href="https://www.acme.example/videos/x"><meta property="og:image" content="https://cdn.example/og.png">
<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.acme.example/"}]}</script>
</head><body><h1>Smart Scheduling</h1><h2>Part</h2><h5>Accordion</h5><h3>What is it?</h3></body></html>`;
  const a = auditHtml(html, { keyword: 'Smart Scheduling', expect: ['VideoObject'] });
  const has = (re) => a.findings.some((f) => re.test(f.message));
  assert.ok(has(/the headings skip a level \(<h2> then <h5>\)/));
  assert.ok(has(/no <main> element/));
  assert.ok(has(/no og:title/));
  assert.ok(has(/no og:description/));
  assert.ok(has(/no twitter:card/));
  assert.ok(has(/no VideoObject in the structured data — this page should describe its video; add it in the block of whoever owns the template/));
  assert.ok(!has(/PodcastEpisode/));
});

