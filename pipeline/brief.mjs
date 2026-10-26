// A feature's input and its brief.
//
//   input/<slug>/feature.md      what the feature is, in plain English (a person writes it)
//   input/<slug>/feature.json    its sidecar: name, status, hints, optional assets
//   input/<slug>/assets/         optional sidecar assets: screenshots, photos, logos
//   library/features/<slug>/brief.json   the copy, written by the copywriter agent
//
// The brief is the one document both outputs are built from. Its limits are
// the PDF's: a section body longer than LIMITS.body pushes the page over, so
// validate() refuses it before anything renders.

import fs from 'node:fs';
import path from 'node:path';
import { env, featurePaths, assertSlug, readJson } from './env.mjs';
import { SCENE_ID_RE, sceneFile } from './library.mjs';

export const LIMITS = {
  pill: 28,
  headline: [12, 62],
  intro: [160, 540],
  lead: [60, 220],
  sectionTitle: [8, 70],
  body: [110, 330],
  sections: [1, 8],
  ctaTitle: 64,
  ctaSubtitle: 110,
  alt: 140,
};

export function loadFeature(slug) {
  assertSlug(slug);
  const p = featurePaths(slug);
  if (!fs.existsSync(p.description)) throw new Error(`no feature description at ${p.description} — run: node pipeline/rollout.mjs init ${slug}`);
  const sidecar = fs.existsSync(p.sidecar) ? readJson(p.sidecar) : {};
  const assets = fs.existsSync(p.inputAssets) ? fs.readdirSync(p.inputAssets).filter((f) => !f.startsWith('.') && f !== 'README.md') : [];
  return { slug, paths: p, sidecar, description: fs.readFileSync(p.description, 'utf8'), assets };
}

// The brief with every default filled in, ready for a template. Defaults,
// later wins: .env, the brand's brand.json, the feature's feature.json, the brief.
export function loadBrief(slug, brand = null) {
  const p = featurePaths(assertSlug(slug));
  if (!fs.existsSync(p.brief)) throw new Error(`no brief at ${p.brief} — the copywriter agent writes it from input/${slug}/feature.md`);
  const brief = readJson(p.brief);
  const sidecar = fs.existsSync(p.sidecar) ? readJson(p.sidecar) : {};
  return {
    ...brief,
    slug,
    pill: brief.pill ?? sidecar.pill ?? brand?.pill ?? env('TOPIC_PILL', '#product update'),
    cta: {
      title: env('CTA_TITLE', 'Get started today'),
      subtitle: env('CTA_SUBTITLE', ''),
      button: env('CTA_BUTTON', 'Get started'),
      url: env('CTA_URL', '#'),
      ...(brand?.cta ?? {}),
      ...(sidecar.cta ?? {}),
      ...(brief.cta ?? {}),
    },
    web: { heroButton: brand?.cta?.heroButton ?? env('WEB_HERO_BUTTON', 'Try for free'), ...(brief.web ?? {}) },
    seo: { title: brief.seo?.title ?? null, description: brief.seo?.description ?? brief.intro?.slice(0, 155) },
  };
}

// "Qualify leads [automatically] with AI" -> parts with the bracketed words marked.
export function headlineParts(headline) {
  const parts = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  for (const m of headline.matchAll(re)) {
    if (m.index > last) parts.push({ text: headline.slice(last, m.index), accent: false });
    parts.push({ text: m[1], accent: true });
    last = m.index + m[0].length;
  }
  if (last < headline.length) parts.push({ text: headline.slice(last), accent: false });
  return parts;
}

export const plainHeadline = (h) => h.replace(/[[\]]/g, '');

// Every problem with a brief, as messages a person (or an agent) can act on.
export function validateBrief(slug) {
  const errors = [];
  const warnings = [];
  const p = featurePaths(slug);
  if (!fs.existsSync(p.brief)) return { errors: [`missing ${path.relative(process.cwd(), p.brief)}`], warnings };

  let b;
  try {
    b = readJson(p.brief);
  } catch (e) {
    return { errors: [`brief.json is not valid JSON: ${e.message}`], warnings };
  }

  const len = (label, value, [min, max], required = true) => {
    if (value === undefined || value === null || value === '') {
      if (required) errors.push(`${label} is missing`);
      return;
    }
    if (typeof value !== 'string') return errors.push(`${label} must be text`);
    if (value.length > max) errors.push(`${label} is ${value.length} characters; at most ${max} fit the layout`);
    if (value.length < min) warnings.push(`${label} is only ${value.length} characters (aim for ${min}+)`);
  };
  const scene = (label, ref) => {
    if (!ref?.scene) return errors.push(`${label}.scene is missing`);
    if (!SCENE_ID_RE.test(ref.scene)) return errors.push(`${label}.scene "${ref.scene}" is not a scene id (<feature>--<name>)`);
    if (!fs.existsSync(sceneFile(ref.scene))) errors.push(`${label}.scene "${ref.scene}" does not exist in library/scenes/ yet (the visual-designer agent creates it)`);
    if (!ref.alt) warnings.push(`${label}.alt is missing (alt text for the web page)`);
    else if (ref.alt.length > LIMITS.alt) warnings.push(`${label}.alt is long (${ref.alt.length} characters)`);
  };

  if (b.slug && b.slug !== slug) errors.push(`slug is "${b.slug}" but the folder is "${slug}"`);
  len('feature', b.feature, [2, 60]);
  len('headline', b.headline, LIMITS.headline);
  if (b.headline && !/\[[^\]]+\]/.test(b.headline)) warnings.push('headline has no [highlighted] words');
  if (b.headline && (b.headline.match(/\[/g) ?? []).length > 2) warnings.push('headline highlights more than two runs of words');
  len('intro', b.intro, LIMITS.intro);
  // the web page's line under the headline: the intro is the PDF's, too long there
  if (b.lead) len('lead', b.lead, LIMITS.lead);
  else warnings.push('lead is missing (the web page falls back to the whole intro)');
  if (b.web?.video && !/^https:\/\//.test(b.web.video)) errors.push('web.video must be an https embed URL');
  if (b.web?.poster) scene('web.poster', { scene: b.web.poster, alt: '-' });
  if (b.pill && b.pill.length > LIMITS.pill) errors.push(`pill is ${b.pill.length} characters; at most ${LIMITS.pill}`);
  scene('hero', b.hero);

  const sections = Array.isArray(b.sections) ? b.sections : [];
  if (sections.length < LIMITS.sections[0] || sections.length > LIMITS.sections[1]) {
    errors.push(`${sections.length} sections; between ${LIMITS.sections[0]} and ${LIMITS.sections[1]} are supported`);
  }
  sections.forEach((s, i) => {
    len(`sections[${i}].title`, s.title, LIMITS.sectionTitle);
    len(`sections[${i}].body`, s.body, LIMITS.body);
    if (s.eyebrow && s.eyebrow.length > 24) errors.push(`sections[${i}].eyebrow is longer than 24 characters`);
    scene(`sections[${i}]`, s);
  });
  const ids = [b.hero?.scene, ...sections.map((s) => s.scene)].filter(Boolean);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) warnings.push(`scene used twice: ${[...new Set(dup)].join(', ')}`);

  if (b.cta?.title && b.cta.title.length > LIMITS.ctaTitle) errors.push(`cta.title is longer than ${LIMITS.ctaTitle} characters`);
  if (b.cta?.subtitle && b.cta.subtitle.length > LIMITS.ctaSubtitle) errors.push(`cta.subtitle is longer than ${LIMITS.ctaSubtitle} characters`);

  return { errors, warnings };
}
