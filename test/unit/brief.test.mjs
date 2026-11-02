import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SANDBOX } from '../helpers.mjs';
import { LIMITS, loadFeature, loadBrief, headlineParts, plainHeadline, validateBrief } from '../../pipeline/brief.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { readJson, writeJson } from '../../pipeline/env.mjs';

const SLUG = 'smart-scheduling';
const example = () => readJson(path.join(SANDBOX, 'library', 'features', SLUG, 'brief.json'));

// A feature folder in the sandbox: brief (with the example's scenes) and input.
let n = 0;
function feature(brief, { sidecar, description = '# x\n' } = {}) {
  const slug = `brief-case-${++n}`;
  const b = typeof brief === 'function' ? brief({ ...example(), slug }) : brief;
  writeJson(path.join(SANDBOX, 'library', 'features', slug, 'brief.json'), b);
  const input = path.join(SANDBOX, 'input', slug);
  fs.mkdirSync(input, { recursive: true });
  if (description !== null) fs.writeFileSync(path.join(input, 'feature.md'), description);
  if (sidecar) writeJson(path.join(input, 'feature.json'), sidecar);
  return slug;
}
const errorsOf = (slug) => validateBrief(slug).errors.join('\n');
const warningsOf = (slug) => validateBrief(slug).warnings.join('\n');

test('the example brief validates without errors', () => {
  const { errors, warnings } = validateBrief(SLUG);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('headlineParts marks bracketed words', () => {
  assert.deepEqual(headlineParts('Book [right inside] the chat'), [
    { text: 'Book ', accent: false }, { text: 'right inside', accent: true }, { text: ' the chat', accent: false },
  ]);
  assert.deepEqual(headlineParts('[All] of it'), [{ text: 'All', accent: true }, { text: ' of it', accent: false }]);
  assert.deepEqual(headlineParts('plain'), [{ text: 'plain', accent: false }]);
  assert.deepEqual(headlineParts('[a][b]').map((p) => p.text), ['a', 'b']);
  assert.equal(plainHeadline('Book [right inside] the [chat]'), 'Book right inside the chat');
});

test('loadFeature: description, sidecar and assets', () => {
  const f = loadFeature(SLUG);
  assert.equal(f.sidecar.target, 'demo-app');
  assert.match(f.description, /\S/);
  assert.ok(Array.isArray(f.assets));
  const slug = feature(example(), { description: null });
  assert.throws(() => loadFeature(slug), /no feature description.*rollout\.mjs init/s);
  assert.throws(() => loadFeature('Bad Slug'), /not a feature slug/);
});

test('loadFeature lists assets, skipping dotfiles and the README', () => {
  const slug = feature(example());
  const assets = path.join(SANDBOX, 'input', slug, 'assets');
  fs.mkdirSync(assets);
  for (const f of ['shot.png', '.DS_Store', 'README.md']) fs.writeFileSync(path.join(assets, f), '');
  assert.deepEqual(loadFeature(slug).assets, ['shot.png']);
});

test('loadBrief fills defaults: .env, then brand, then feature.json, then the brief', () => {
  const plain = loadBrief(SLUG);
  assert.equal(plain.slug, SLUG);
  assert.equal(plain.pill, '#product update'); // TOPIC_PILL in .env.example
  assert.equal(plain.cta.button, 'Start a free 14-day trial');
  assert.equal(plain.web.heroButton, 'Try for free');
  assert.equal(plain.seo.title, 'Smart Scheduling: Book Meetings Over Text | Acme Cloud');
  assert.match(plain.seo.description, /^Smart Scheduling books meetings/);
  assert.equal(plain.seo.keyword, 'Smart Scheduling');
  assert.equal(plain.faq.length, 5);

  const slug = feature((b) => ({ ...b, cta: { button: 'Brief button' }, seo: undefined }), {
    sidecar: { pill: 'Sidecar pill', cta: { title: 'Sidecar title', button: 'Sidecar button' } },
  });
  const brand = { ...loadBrand(), pill: 'Brand pill', cta: { url: 'https://brand.example/go', title: 'Brand title', heroButton: 'Brand hero' } };
  const b = loadBrief(slug, brand);
  assert.equal(b.pill, 'Sidecar pill');
  assert.equal(b.cta.url, 'https://brand.example/go');
  assert.equal(b.cta.title, 'Sidecar title');
  assert.equal(b.cta.button, 'Brief button');
  assert.equal(b.web.heroButton, 'Brand hero');
  assert.equal(b.seo.description, b.intro.slice(0, 155)); // no seo: the intro, cut
});

test('loadBrief without a brief points at the copywriter', () => {
  assert.throws(() => loadBrief('no-brief-here'), /no brief at .*copywriter/s);
});

test('a missing or broken brief is one error', () => {
  assert.match(errorsOf('no-brief-here'), /missing .*brief\.json/);
  const slug = feature({});
  fs.writeFileSync(path.join(SANDBOX, 'library', 'features', slug, 'brief.json'), '{ nope');
  assert.match(errorsOf(slug), /not valid JSON/);
});

test('length limits: too long is an error, too short a warning', () => {
  const long = feature((b) => ({ ...b, intro: 'x'.repeat(LIMITS.intro[1] + 1) }));
  assert.match(errorsOf(long), new RegExp(`intro is ${LIMITS.intro[1] + 1} characters; at most ${LIMITS.intro[1]}`));
  const short = feature((b) => ({ ...b, intro: 'Short intro.' }));
  assert.deepEqual(validateBrief(short).errors, []);
  assert.match(warningsOf(short), /intro is only 12 characters/);
  const body = feature((b) => ({ ...b, sections: b.sections.map((s, i) => (i === 1 ? { ...s, body: 'y'.repeat(LIMITS.body[1] + 5) } : s)) }));
  assert.match(errorsOf(body), /sections\[1\]\.body is \d+ characters/);
});

test('required fields, slug and pill', () => {
  const slug = feature((b) => ({ ...b, slug: 'other', feature: undefined, pill: 'p'.repeat(LIMITS.pill + 1) }));
  const errs = errorsOf(slug);
  assert.match(errs, /slug is "other" but the folder is/);
  assert.match(errs, /feature is missing/);
  assert.match(errs, /pill is \d+ characters; at most 28/);
  assert.match(errorsOf(feature((b) => ({ ...b, intro: 42 }))), /intro must be text/);
});

test('a non-text headline is reported, not thrown', () => {
  assert.match(errorsOf(feature((b) => ({ ...b, headline: 42 }))), /headline must be text/);
});

test('headline highlight warnings', () => {
  assert.match(warningsOf(feature((b) => ({ ...b, headline: 'Book meetings right inside the chat' }))), /no \[highlighted\] words/);
  assert.match(warningsOf(feature((b) => ({ ...b, headline: '[Book] [meetings] [inside] it' }))), /more than two runs/);
});

test('lead: optional with a warning, limited when present', () => {
  assert.match(warningsOf(feature((b) => ({ ...b, lead: undefined }))), /lead is missing/);
  assert.match(errorsOf(feature((b) => ({ ...b, lead: 'l'.repeat(LIMITS.lead[1] + 1) }))), /lead is \d+ characters/);
});

test('scenes: missing, malformed, nonexistent, alt text', () => {
  const slug = feature((b) => ({
    ...b,
    hero: { alt: 'x' },
    sections: [
      { ...b.sections[0], scene: 'Not An Id' },
      { ...b.sections[1], scene: 'smart-scheduling--nonexistent' },
      { ...b.sections[2], alt: undefined },
      { ...b.sections[3], alt: 'a'.repeat(LIMITS.alt + 1) },
    ],
  }));
  const errs = errorsOf(slug);
  assert.match(errs, /hero\.scene is missing/);
  assert.match(errs, /sections\[0\]\.scene "Not An Id" is not a scene id/);
  assert.match(errs, /sections\[1\]\.scene "smart-scheduling--nonexistent" does not exist/);
  const warns = warningsOf(slug);
  assert.match(warns, /sections\[2\]\.alt is missing/);
  assert.match(warns, /sections\[3\]\.alt is long/);
});

test('section count, eyebrow and duplicate scenes', () => {
  assert.match(errorsOf(feature((b) => ({ ...b, sections: [] }))), /0 sections; between 1 and 8/);
  assert.match(errorsOf(feature((b) => ({ ...b, sections: Array(9).fill(b.sections[0]) }))), /9 sections/);
  assert.match(errorsOf(feature((b) => ({ ...b, sections: [{ ...b.sections[0], eyebrow: 'e'.repeat(25) }] }))), /eyebrow is longer than 24/);
  assert.match(warningsOf(feature((b) => ({ ...b, sections: [b.sections[0], b.sections[0]] }))), /scene used twice: smart-scheduling--suggest-times/);
});

test('web.video must be https; web.poster must be a scene', () => {
  assert.match(errorsOf(feature((b) => ({ ...b, web: { video: 'http://x.example/v' } }))), /web\.video must be an https embed URL/);
  assert.deepEqual(validateBrief(feature((b) => ({ ...b, web: { video: 'https://x.example/v', poster: 'smart-scheduling--hero' } }))).errors, []);
  assert.match(errorsOf(feature((b) => ({ ...b, web: { poster: 'smart-scheduling--gone' } }))), /web\.poster\.scene "smart-scheduling--gone" does not exist/);
});

test('cta limits', () => {
  const errs = errorsOf(feature((b) => ({ ...b, cta: { title: 't'.repeat(LIMITS.ctaTitle + 1), subtitle: 's'.repeat(LIMITS.ctaSubtitle + 1) } })));
  assert.match(errs, /cta\.title is longer than 64/);
  assert.match(errs, /cta\.subtitle is longer than 110/);
});

test('search and answer engines: keyword, SEO text, FAQ and alt text (warnings; a malformed FAQ is an error)', () => {
  // the example brief carries all of it: no warnings (first test)
  const w = warningsOf(feature((b) => ({ ...b, seo: { title: 'Book Meetings Over Text, the Easy Way Today | Acme' }, faq: undefined, lead: 'Offer open times right in the thread and sync your calendars.' })));
  assert.match(w, /seo\.description is missing — the page falls back to the intro/);
  assert.match(w, /seo: the SEO title does not name "Smart Scheduling"/);
  assert.match(w, /neither the headline nor the lead names "Smart Scheduling"/);
  assert.match(w, /faq: no FAQ/);

  const k = warningsOf(feature((b) => ({ ...b, seo: { ...b.seo, keyword: 'Meeting Booking' } })));
  assert.match(k, /does not name "Meeting Booking"/);
  assert.match(errorsOf(feature((b) => ({ ...b, seo: { ...b.seo, keyword: '' } }))), /seo\.keyword is the words people search for/);

  assert.match(errorsOf(feature((b) => ({ ...b, faq: [{ q: 'Only a question?' }] }))), /faq\[0\] needs a question "q" and an answer "a"/);
  assert.match(warningsOf(feature((b) => ({ ...b, faq: b.faq.slice(0, 1) }))), /faq: 1 question\(s\)/);

  const alt = warningsOf(feature((b) => ({ ...b, hero: { ...b.hero, alt: 'hero.png' }, sections: b.sections.map((s, i) => (i ? s : { ...s, alt: 'Screenshot of the composer with three times' })) })));
  assert.match(alt, /hero\.alt: the alt text "hero\.png" is a file name/);
  assert.match(alt, /sections\[0\]\.alt: the alt text starts with "Screenshot of"/);
});
