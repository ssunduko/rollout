// Unit tests for the pipeline's pure parts: the brief, the social pack's
// validation and the copy pack. Run: npm test (node --test).
//
// The pipeline reads its folders from the environment when env.mjs is first
// imported, so each run builds a throwaway input/ and library/ in the OS temp
// folder and points INPUT_DIR / LIBRARY_DIR / OUTPUT_DIR at them before any
// pipeline module loads. Nothing in the repo's own folders is read or written.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-test-'));
Object.assign(process.env, {
  INPUT_DIR: path.join(TMP, 'input'),
  LIBRARY_DIR: path.join(TMP, 'library'),
  OUTPUT_DIR: path.join(TMP, 'output'),
  BRAND_DIR: 'brand/example',
  CTA_TITLE: 'Get started today',
  CTA_BUTTON: 'Start a trial',
  CTA_URL: 'https://example.test/signup',
  TOPIC_PILL: '#product update',
});

const { LIMITS, loadBrief, validateBrief, headlineParts, plainHeadline, copyStyle, styleProblems, sentenceCount } = await import('../pipeline/brief.mjs');
const { validateSocial } = await import('../pipeline/social.mjs');
const { loadCopy, validateCopy, buildCopy, composePost, composeEmail, xLength, brandCopy, copyDir } = await import('../pipeline/copy.mjs');

const SLUG = 'demo';
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};
const featureDir = path.join(TMP, 'library', 'features', SLUG);

// A brief that passes every check, to break one field at a time.
const validBrief = () => ({
  slug: SLUG,
  feature: 'Demo Feature',
  headline: 'Book meetings [right inside] the thread',
  intro: 'Demo Feature turns a question about timing into a booked meeting in one reply. Open times from your calendars appear in the thread, customers pick a slot, and the meeting is confirmed and reminded for you, so fewer leads slip away.',
  lead: 'Offer open times in the thread, sync calendars and send reminders automatically.',
  hero: { scene: 'demo--hero', alt: 'The hero visual' },
  sections: [
    {
      title: 'Offer open times without leaving',
      body: 'Click Suggest times to drop three open slots into your reply. Customers answer with a number and the meeting is booked on the spot.',
      short: 'Drop open times into any reply so customers book without leaving the thread.',
      scene: 'demo--suggest',
      alt: 'The composer with three suggested times',
    },
  ],
  seo: { description: 'Book meetings inside the conversation.', url: '/demo-updates' },
});
const writeBrief = (brief) => write(path.join(featureDir, 'brief.json'), brief);
const errorsOf = (brief, brand = null) => { writeBrief(brief); return validateBrief(SLUG, brand); };

// A brand object with only what the copy code reads.
const brand = (copy = {}) => ({ id: 'test', name: 'Acme', website: 'https://acme.test', copy, colors: { cta: '#0a0', ink: '#111' }, fonts: { body: { family: 'Inter' } }, web: null });

before(() => {
  write(path.join(TMP, 'input', SLUG, 'feature.md'), '# Demo\n');
  write(path.join(TMP, 'input', SLUG, 'feature.json'), { slug: SLUG, name: 'Demo Feature' });
  for (const id of ['demo--hero', 'demo--suggest']) write(path.join(TMP, 'library', 'scenes', id, 'scene.json'), { title: id, tags: [] });
});
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Behaviour that existed before the copy pack: must be unchanged.
// ---------------------------------------------------------------------------

describe('brief (existing behaviour)', () => {
  test('headlineParts splits [accent] runs', () => {
    assert.deepEqual(headlineParts('Qualify leads [automatically] with [AI]'), [
      { text: 'Qualify leads ', accent: false },
      { text: 'automatically', accent: true },
      { text: ' with ', accent: false },
      { text: 'AI', accent: true },
    ]);
    assert.deepEqual(headlineParts('No accent'), [{ text: 'No accent', accent: false }]);
  });

  test('plainHeadline drops the brackets', () => {
    assert.equal(plainHeadline('Book [right inside] the thread'), 'Book right inside the thread');
  });

  test('a valid brief has no errors', () => {
    const { errors } = errorsOf(validBrief());
    assert.deepEqual(errors, []);
  });

  test('the layout limits are unchanged', () => {
    assert.deepEqual(LIMITS.headline, [12, 62]);
    assert.deepEqual(LIMITS.intro, [160, 540]);
    assert.deepEqual(LIMITS.lead, [60, 220]);
    assert.deepEqual(LIMITS.sectionTitle, [8, 70]);
    assert.deepEqual(LIMITS.body, [110, 330]);
    assert.deepEqual(LIMITS.sections, [1, 8]);
    assert.equal(LIMITS.pill, 28);
  });

  test('a headline over the limit is an error', () => {
    const b = validBrief();
    b.headline = `[Long] ${'word '.repeat(20)}`;
    assert.match(errorsOf(b).errors.join('\n'), /headline is \d+ characters; at most 62/);
  });

  test('missing required fields are errors', () => {
    const b = validBrief();
    delete b.feature;
    delete b.intro;
    const { errors } = errorsOf(b);
    assert.ok(errors.includes('feature is missing'));
    assert.ok(errors.includes('intro is missing'));
  });

  test('too many sections is an error', () => {
    const b = validBrief();
    b.sections = Array.from({ length: 9 }, () => ({ ...b.sections[0] }));
    assert.match(errorsOf(b).errors.join('\n'), /9 sections; between 1 and 8/);
  });

  test('a section body over 330 characters is an error', () => {
    const b = validBrief();
    b.sections[0].body = 'x'.repeat(331);
    assert.match(errorsOf(b).errors.join('\n'), /sections\[0\]\.body is 331 characters/);
  });

  test('a scene that does not exist, or a bad scene id, is an error', () => {
    const b = validBrief();
    b.sections[0].scene = 'demo--missing';
    assert.match(errorsOf(b).errors.join('\n'), /does not exist in library\/scenes/);
    b.sections[0].scene = 'Not An Id';
    assert.match(errorsOf(b).errors.join('\n'), /is not a scene id/);
  });

  test('eyebrow, cta and web.video limits are errors', () => {
    const b = validBrief();
    b.sections[0].eyebrow = 'x'.repeat(25);
    b.cta = { title: 'x'.repeat(65), subtitle: 'y'.repeat(111) };
    b.web = { video: 'http://not-https.test' };
    const e = errorsOf(b).errors.join('\n');
    assert.match(e, /eyebrow is longer than 24/);
    assert.match(e, /cta\.title is longer than 64/);
    assert.match(e, /cta\.subtitle is longer than 110/);
    assert.match(e, /web\.video must be an https embed URL/);
  });

  test('a slug that does not match the folder is an error', () => {
    const b = validBrief();
    b.slug = 'other';
    assert.match(errorsOf(b).errors.join('\n'), /slug is "other" but the folder is "demo"/);
  });

  test('warnings: no highlight, no lead, a scene used twice', () => {
    const b = validBrief();
    b.headline = 'Book meetings inside the thread';
    delete b.lead;
    b.hero.scene = 'demo--suggest';
    const w = errorsOf(b).warnings.join('\n');
    assert.match(w, /headline has no \[highlighted\] words/);
    assert.match(w, /lead is missing/);
    assert.match(w, /scene used twice/);
  });

  test('invalid JSON is reported, not thrown', () => {
    write(path.join(featureDir, 'brief.json'), '{ not json');
    assert.match(validateBrief(SLUG).errors[0], /not valid JSON/);
  });

  test('without a brand, validateBrief skips copy rules (old call shape)', () => {
    const b = validBrief();
    b.intro = `Introducing Demo — ${b.intro}`;
    assert.deepEqual(errorsOf(b).errors, []);
  });

  test('loadBrief fills defaults: pill, cta from .env, seo description', () => {
    const b = validBrief();
    delete b.seo;
    writeBrief(b);
    const loaded = loadBrief(SLUG, null);
    assert.equal(loaded.pill, '#product update');
    assert.equal(loaded.cta.title, 'Get started today');
    assert.equal(loaded.cta.button, 'Start a trial');
    assert.equal(loaded.cta.url, 'https://example.test/signup');
    assert.equal(loaded.seo.description, b.intro.slice(0, 155));
    assert.equal(loaded.web.heroButton, 'Try for free');
  });

  test('loadBrief: brief overrides beat brand, brand beats .env', () => {
    const b = validBrief();
    b.cta = { button: 'From the brief' };
    writeBrief(b);
    const loaded = loadBrief(SLUG, { pill: '#brand pill', cta: { title: 'From the brand', button: 'Brand button' } });
    assert.equal(loaded.pill, '#brand pill');
    assert.equal(loaded.cta.title, 'From the brand');
    assert.equal(loaded.cta.button, 'From the brief');
  });
});

describe('social pack validation (existing behaviour)', () => {
  test('no social.json is a warning, not an error', () => {
    writeBrief(validBrief());
    fs.rmSync(path.join(featureDir, 'social.json'), { force: true });
    const r = validateSocial(SLUG, loadBrief(SLUG, null), { socialPack: {}, cta: null });
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings[0], /no social\.json/);
  });

  test('a crop outside the still and an unknown format are errors', () => {
    writeBrief(validBrief());
    write(path.join(featureDir, 'social.json'), { slides: [{ section: 0, panel: { crop: [0.5, 0, 0.8, 1] } }], formats: ['cover', 'billboard'] });
    const r = validateSocial(SLUG, loadBrief(SLUG, null), { socialPack: {}, cta: null });
    assert.match(r.errors.join('\n'), /crop must be/);
    assert.match(r.errors.join('\n'), /unknown format "billboard"/);
    fs.rmSync(path.join(featureDir, 'social.json'));
  });
});

// ---------------------------------------------------------------------------
// New: the brief's additions and the copy pack.
// ---------------------------------------------------------------------------

describe('brief additions', () => {
  test('sentenceCount', () => {
    assert.equal(sentenceCount('One. Two! Three?'), 3);
    assert.equal(sentenceCount('No end mark'), 1);
    assert.equal(sentenceCount('At 10:00 AM it books.'), 1);
    assert.equal(sentenceCount(''), 0);
  });

  test('styleProblems flags forbidden strings and openers, case-insensitively', () => {
    const style = copyStyle({ copy: { forbidden: ['—'], bannedOpeners: ['Introducing'] } });
    assert.equal(styleProblems('x', 'Introducing a — dash', style).length, 2);
    assert.equal(styleProblems('x', 'introducing it', style).length, 1);
    assert.deepEqual(styleProblems('x', 'Fine text.', style), []);
    assert.deepEqual(copyStyle(null), { forbidden: [], bannedOpeners: [] });
  });

  test('with a brand, the copy rules are errors in the brief', () => {
    const b = validBrief();
    b.intro = `Introducing Demo — ${b.intro}`;
    const { errors } = errorsOf(b, { copy: { forbidden: ['—'], bannedOpeners: ['Introducing'] } });
    assert.ok(errors.some((e) => /intro contains "—"/.test(e)));
    assert.ok(errors.some((e) => /intro opens with "Introducing"/.test(e)));
  });

  test('short: missing is a warning, two sentences is a warning', () => {
    const b = validBrief();
    delete b.sections[0].short;
    assert.match(errorsOf(b).warnings.join('\n'), /short is missing/);
    b.sections[0].short = 'Sentence one is here. Sentence two is here too.';
    assert.match(errorsOf(b).warnings.join('\n'), /short has 2 sentences/);
  });

  test('seo.url must be a lowercase hyphenated path; loadBrief defaults it', () => {
    const b = validBrief();
    b.seo.url = 'Demo_Updates';
    assert.match(errorsOf(b).errors.join('\n'), /seo\.url "Demo_Updates"/);
    delete b.seo.url;
    writeBrief(b);
    assert.equal(loadBrief(SLUG, null).seo.url, '/demo');
  });
});

describe('copy pack', () => {
  const validCopy = () => ({
    email: { subject: 'Book meetings inside the thread', preview: 'Offer open times and send reminders automatically.', opener: 'Finding a time should not take five texts.', paragraphs: ['First paragraph.', 'Second paragraph.'], closing: 'Spend less time scheduling.' },
    posts: {
      feed: { hook: 'Hook line', intro: 'Intro.', bullets: ['a', 'b', 'c', 'd'], closing: 'Closing.', cta: 'See how:', hashtags: ['One', 'Two', 'Three', 'Four'] },
      instagram: { hook: 'Hook', intro: 'Short.', closing: 'Bye.', hashtags: ['One', 'Two', 'Three', 'Four'] },
      x: { hook: 'Hook', bullets: ['a'], cta: 'See:', hashtags: ['One', 'Two'] },
      inApp: { title: 'Discover it', intro: 'Intro.', bullets: ['a', 'b', 'c'], closing: 'Closing.', cta: 'Open settings.' },
    },
    podcast: {
      title: 'T', status: 'Live', duration: '8 minutes', description: 'One. Two. Three.', audience: 'Teams', tone: 'Warm',
      value: { proposition: 'P', before: 'B', after: 'A' }, steps: ['1', '2', '3', '4'], standout: ['s'],
      useCases: { primary: 'p', secondary: ['a', 'b'] }, focus: ['a', 'b', 'c'], talkingPoints: ['t'], questions: ['q'],
      cta: { text: 'Try it' }, hosts: [{ focus: ['x'] }, { focus: ['y'] }],
    },
  });
  const setup = (copy, b = validBrief()) => { writeBrief(b); write(path.join(featureDir, 'copy.json'), copy); return loadBrief(SLUG, null); };

  test('no copy.json: loadCopy is null and validation only warns', () => {
    writeBrief(validBrief());
    fs.rmSync(path.join(featureDir, 'copy.json'), { force: true });
    const brief = loadBrief(SLUG, null);
    assert.equal(loadCopy(SLUG, brief, brand()), null);
    const r = validateCopy(SLUG, brief, brand());
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings[0], /no copy\.json/);
  });

  test('a complete copy.json validates without errors', () => {
    const brief = setup(validCopy());
    assert.deepEqual(validateCopy(SLUG, brief, brand()).errors, []);
  });

  test('defaults: link and email CTA from the brief, sender and sign-off from the brand', () => {
    const brief = setup(validCopy());
    const c = loadCopy(SLUG, brief, brand());
    assert.equal(c.link, 'https://example.test/signup');
    assert.equal(c.email.cta.url, 'https://example.test/signup');
    assert.equal(c.email.cta.label, 'Start a trial');
    assert.equal(c.email.sender, 'Acme');
    assert.equal(c.email.signoff, 'The Acme Team');
    assert.equal(c.posts.feed.image, 'cover');
    assert.deepEqual(c.posts.feed.hashtags, ['#One', '#Two', '#Three', '#Four']);
  });

  test('xLength: links count 23, emoji 2, punctuation 1, [link] 23', () => {
    assert.equal(xLength('abc'), 3);
    assert.equal(xLength('https://example.test/a/very/long/path'), 23);
    assert.equal(xLength('✅'), 2);
    assert.equal(xLength('👉'), 2);
    assert.equal(xLength('“quote”'), 7);
    assert.equal(xLength('[link]'), 23);
  });

  test('an X post over 280 is an error; a long subject is an error', () => {
    const c = validCopy();
    c.posts.x.bullets = Array.from({ length: 5 }, () => 'a fairly long bullet that keeps on going for a while');
    c.email.subject = 's'.repeat(80);
    const e = validateCopy(SLUG, setup(c), brand()).errors.join('\n');
    assert.match(e, /posts\.x is \d+ characters as X counts them; at most 280/);
    assert.match(e, /email\.subject is 80 characters; inboxes cut it/);
  });

  test('copy rules apply to every post and the email', () => {
    const c = validCopy();
    c.email.opener = 'Introducing a — dash';
    const e = validateCopy(SLUG, setup(c), brand({ forbidden: ['—'], bannedOpeners: ['Introducing'] })).errors.join('\n');
    assert.match(e, /email\.opener contains "—"/);
    assert.match(e, /email\.opener opens with "Introducing"/);
  });

  test('unknown image, missing podcast fields and a non-link CTA are errors', () => {
    const c = validCopy();
    c.posts.feed.image = 'banner';
    delete c.podcast.tone;
    c.email.cta = { url: 'nowhere' };
    const e = validateCopy(SLUG, setup(c), brand()).errors.join('\n');
    assert.match(e, /posts\.feed\.image "banner"/);
    assert.match(e, /podcast\.tone is missing/);
    assert.match(e, /email\.cta\.url is "nowhere"/);
  });

  test('a [link] placeholder is a warning, not an error', () => {
    const c = { ...validCopy(), link: '[link]' };
    const r = validateCopy(SLUG, setup(c), brand());
    assert.deepEqual(r.errors, []);
    assert.match(r.warnings.join('\n'), /placeholder "\[link\]"/);
  });

  test('composePost builds each channel with the brand markers', () => {
    const style = brandCopy(brand({ bullets: { feed: '🔷', x: '✅' }, ctaPrefix: '👉' }));
    const feed = composePost('feed', { hook: 'H', intro: 'I', bullets: ['a', 'b'], closing: 'C', cta: 'See:', hashtags: ['#T'], link: 'https://l.test' }, style);
    assert.equal(feed, 'H\n\nI\n\n🔷 a\n🔷 b\n\nC\n\n👉 See: https://l.test\n\n#T');
    const ig = composePost('instagram', { hook: 'H', intro: 'I', bullets: [], closing: 'C', hashtags: ['#T'] }, style);
    assert.match(ig, /👉 Link in bio/);
    const inApp = composePost('inApp', { title: 'T', intro: 'I', bullets: ['a'], closing: 'C', cta: 'Go', hashtags: [] }, style);
    assert.equal(inApp, 'Title: T\n\nHi {{First Name}},\n\nI\n\n• a\n\nC\n\nGo');
  });

  test('composeEmail ends with the CTA line and the sign-off', () => {
    const body = composeEmail({ opener: 'O', paragraphs: ['P'], closing: 'C', cta: { label: 'Go', url: 'https://g.test' }, signoff: 'Team' }, brandCopy(brand({ ctaPrefix: '👉' })));
    assert.equal(body, 'O\n\nP\n\nC\n\n👉 Go https://g.test\n\nTeam');
  });

  test('buildCopy writes the pack, with header variants and the list email', () => {
    const c = {
      ...validCopy(),
      listEmail: { subject: '5 ways it helps', preview: 'A list.', intro: 'Here they are:', closing: 'Done.' },
      headers: { video: { headline: 'Watch it work', subheadline: 'See it.', description: 'Video meta.' } },
    };
    const brief = setup(c);
    const r = buildCopy({ slug: SLUG, brief, brand: brand() });
    for (const f of ['rollout-copy.md', 'email.txt', 'email.html', 'email-list.txt', 'feed.txt', 'instagram.txt', 'x.txt', 'in-app.txt', 'podcast-brief.md']) {
      assert.ok(r.files.includes(f), `${f} written`);
      assert.ok(fs.existsSync(path.join(copyDir(SLUG), f)));
    }
    const md = fs.readFileSync(path.join(copyDir(SLUG), 'rollout-copy.md'), 'utf8');
    assert.match(md, /1\. \(webpage\) Book meetings right inside the thread/);
    assert.match(md, /2\. \(video page\) Watch it work/);
    assert.match(md, /1\. Offer open times without leaving: Drop open times/);
    const html = fs.readFileSync(path.join(copyDir(SLUG), 'email.html'), 'utf8');
    assert.match(html, /href="https:\/\/example\.test\/signup"/);
  });

  test('buildCopy refuses copy with errors', () => {
    const c = validCopy();
    c.posts.feed.image = 'banner';
    const brief = setup(c);
    assert.throws(() => buildCopy({ slug: SLUG, brief, brand: brand() }), /copy\.json:/);
  });
});
