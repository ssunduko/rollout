import '../setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { putFixture, readFixture } from '../helpers.mjs';
import { SLUG } from '../setup.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { loadBrief } from '../../pipeline/brief.mjs';
import { loadSocial, validateSocial, socialSceneIds, socialFile, socialDir, SOCIAL_FORMATS } from '../../pipeline/social.mjs';

const brand = loadBrand();
const brief = loadBrief(SLUG, brand);
const write = (obj) => fs.writeFileSync(socialFile(SLUG), JSON.stringify(obj));

beforeEach(() => fs.rmSync(socialFile(SLUG), { force: true }));

test('SOCIAL_FORMATS: every format has a size and a label', () => {
  assert.deepEqual(Object.keys(SOCIAL_FORMATS), ['cover', 'slide', 'feature', 'podcast', 'youtube', 'email', 'signature']);
  for (const f of Object.values(SOCIAL_FORMATS)) {
    assert.ok(Number.isInteger(f.width) && Number.isInteger(f.height) && f.label);
  }
  assert.deepEqual([SOCIAL_FORMATS.cover.width, SOCIAL_FORMATS.cover.height], [1080, 1350]);
  assert.deepEqual([SOCIAL_FORMATS.signature.width, SOCIAL_FORMATS.signature.height], [500, 175]);
});

test('paths: the sidecar in the library, the pack in output/<slug>/assets/social', () => {
  assert.match(socialFile(SLUG).replace(/\\/g, '/'), /library\/features\/smart-scheduling\/social\.json$/);
  assert.match(socialDir(SLUG).replace(/\\/g, '/'), /output\/smart-scheduling\/assets\/social$/);
});

test('loadSocial: null without social.json', () => {
  assert.equal(loadSocial(SLUG, brief, brand), null);
});

test('loadSocial: an empty social.json takes everything from the brief and brand', () => {
  write({});
  const s = loadSocial(SLUG, brief, brand);
  assert.equal(s.name, brief.feature);
  assert.equal(s.headline, brief.headline);
  assert.equal(s.pill, brief.pill);
  assert.equal(s.button, brand.socialPack.button);
  assert.equal(s.hero, brief.hero.scene);
  assert.equal(s.signature, null);
  assert.deepEqual(s.podcast, { play: [0.5, 0.5] });
  assert.equal(s.slides.length, brief.sections.length);
  s.slides.forEach((slide, i) => {
    assert.equal(slide.title, brief.sections[i].title);
    assert.equal(slide.body, '', 'slides carry a title only unless the sidecar gives a body');
    assert.deepEqual(slide.panel, { scene: brief.sections[i].scene });
  });
  assert.deepEqual(s.formats, Object.keys(SOCIAL_FORMATS));
});

test('loadSocial: the sidecar\'s own values win; slides pick sections', () => {
  putFixture('social-acme.json', `library/features/${SLUG}/social.json`);
  const raw = readFixture('social-acme.json');
  const s = loadSocial(SLUG, brief, brand);
  assert.equal(s.headline, raw.headline);
  assert.equal(s.signature, raw.signature);
  assert.equal(s.slides.length, 2);
  assert.equal(s.slides[0].title, 'Offer [open times]');
  assert.equal(s.slides[0].body, '');
  assert.deepEqual(s.slides[0].panel, { scene: brief.sections[0].scene, crop: [0, 0.1, 1, 0.6] });
  assert.equal(s.slides[1].title, brief.sections[2].title);
  assert.deepEqual(s.formats, ['cover', 'slide', 'signature']);
});

test('loadSocial: button falls back to the brand CTA, then "Learn more"', () => {
  write({});
  const noPack = { ...brand, socialPack: undefined };
  assert.equal(loadSocial(SLUG, brief, noPack).button, brand.cta?.heroButton ?? 'Learn more');
  assert.equal(loadSocial(SLUG, brief, { ...brand, socialPack: undefined, cta: undefined }).button, 'Learn more');
});

test('loadSocial: a slide naming a missing section throws', () => {
  write({ slides: [{ section: 99 }] });
  assert.throws(() => loadSocial(SLUG, brief, brand), /slide 1: brief has no section 99/);
});

test('socialSceneIds: hero, signature, then each slide\'s scene', () => {
  putFixture('social-acme.json', `library/features/${SLUG}/social.json`);
  const s = loadSocial(SLUG, brief, brand);
  assert.deepEqual(socialSceneIds(s), [brief.hero.scene, 'smart-scheduling--reschedule', brief.sections[0].scene, brief.sections[2].scene]);
  write({});
  assert.equal(socialSceneIds(loadSocial(SLUG, brief, brand))[1], brief.sections[0].scene);
});

test('validateSocial: no social.json is a warning, not an error', () => {
  const r = validateSocial(SLUG, brief, brand);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings[0], /no social\.json/);
});

test('validateSocial: the fixture passes', () => {
  putFixture('social-acme.json', `library/features/${SLUG}/social.json`);
  const r = validateSocial(SLUG, brief, brand);
  assert.deepEqual(r.errors, []);
  // slide 2 takes the brief's title, which has no [highlight]
  assert.ok(r.warnings.some((w) => /slide 2: title has no \[highlighted\] words/.test(w)));
});

test('validateSocial: crops must be fractions inside the still', () => {
  for (const crop of [[0, 0, 1.2, 1], [0.5, 0, 0.6, 1], [-0.1, 0, 0.5, 0.5], [0, 0, '1', 1]]) {
    write({ slides: [{ section: 0, title: '[x]', panel: { crop } }] });
    const r = validateSocial(SLUG, brief, brand);
    assert.match(r.errors.join(), /slide 1: crop must be/, JSON.stringify(crop));
  }
  write({ slides: [{ section: 0, title: '[x]', panel: { crop: [0.25, 0.25, 0.75, 0.75] } }] });
  assert.deepEqual(validateSocial(SLUG, brief, brand).errors, []);
});

test('validateSocial: unknown formats, long bodies, plain headlines', () => {
  write({ headline: 'No highlight', formats: ['cover', 'tiktok'], slides: [{ section: 0, title: `[x] ${'z'.repeat(70)}`, body: 'y'.repeat(141) }] });
  const r = validateSocial(SLUG, brief, brand);
  assert.match(r.errors.join(), /unknown format "tiktok"/);
  assert.ok(r.warnings.some((w) => /body is 141 characters/.test(w)));
  assert.ok(r.warnings.some((w) => /slide 1: title is 72 characters/.test(w)));
  assert.ok(r.warnings.includes('headline has no [highlighted] words'));
});

test('validateSocial: a load error becomes the error', () => {
  write({ slides: [{ section: 7 }] });
  assert.deepEqual(validateSocial(SLUG, brief, brand).errors, ['social.json slide 1: brief has no section 7']);
});

test('signature: a scene id adds a scene; a crop of the hero adds none', () => {
  write({ signature: { crop: [0, 0, 0.6, 0.5] } });
  const s = loadSocial(SLUG, brief, brand);
  assert.deepEqual(s.signature, { crop: [0, 0, 0.6, 0.5] });
  assert.deepEqual(validateSocial(SLUG, brief, brand).errors, []);
  assert.equal(socialSceneIds(s).length, 1 + s.slides.length);
  for (const signature of [{ crop: [0, 0, 1.2, 1] }, { scene: 'x' }, 7]) {
    write({ signature });
    assert.match(validateSocial(SLUG, brief, brand).errors.join(), /signature must be a scene id or \{"crop"/, JSON.stringify(signature));
  }
});

test('podcast.play: the play button centre, fractions of the card', () => {
  write({ podcast: { play: [0.7, 0.4] } });
  assert.deepEqual(loadSocial(SLUG, brief, brand).podcast.play, [0.7, 0.4]);
  assert.deepEqual(validateSocial(SLUG, brief, brand).errors, []);
  for (const play of [[1.2, 0.5], [0.5], 'center']) {
    write({ podcast: { play } });
    assert.match(validateSocial(SLUG, brief, brand).errors.join(), /podcast\.play must be/, JSON.stringify(play));
  }
});
