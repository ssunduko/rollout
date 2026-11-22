// Search (SEO) and answer-engine (AEO) rules for every page the pipeline
// builds or plans for the website: the feature page, its CMS item, the
// podcast episode page (docs/seo.md). Brand-agnostic: the words come from the
// brief and the sidecars.
//
// SEO: a title and description of the length search results show, the page's
// subject (its keyword) in the title, description, heading and address, one
// <h1>, alt text on every image saying what it shows.
// AEO: answer engines (AI search and assistants) quote pages that answer a
// question directly: an answer-first lead, an FAQ of the questions customers
// ask with short self-contained answers, and structured data (JSON-LD)
// naming what the page is about — the feature, its FAQ, the podcast episode
// and its transcript.
//
// Every check returns messages a person or an agent can act on; they are
// warnings unless the data is malformed, so SEO never blocks a build.

import { validateJsonLd, unresolvedReferences } from './schema.mjs';

export const SEO_LIMITS = {
  title: [30, 60],
  description: [120, 160],
  alt: [10, 125],
  slugWords: 6,
  faq: [3, 8],
  question: [10, 120],
  answer: [40, 320],
};

// The limits for a brand's pages: the defaults, with the brand's own
// (web.seo.limits in brand.json, e.g. the site's SEO rules asking for 50–60
// character titles) over them.
export function seoLimits(brand) {
  const own = brand?.web?.seo?.limits ?? {};
  return { ...SEO_LIMITS, ...Object.fromEntries(Object.entries(own).filter(([k]) => k in SEO_LIMITS)) };
}

// How many words of a page's text the direct answer must come within.
export const ANSWER_WITHIN_WORDS = 100;
// Anchor text that says nothing about the page it links to.
const WEAK_ANCHOR = /^(click here|here|read more|learn more|more|this|link|this link|go|see more)$/i;

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const keywordIn = (text, keyword) => Boolean(keyword) && ` ${norm(text)} `.includes(` ${norm(keyword)} `);
const strip = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// Title and description: lengths, the keyword, not the same text twice.
export function checkMeta({ title, description, keyword, where = 'page', limits = SEO_LIMITS }) {
  const w = [];
  const [tMin, tMax] = limits.title;
  const [dMin, dMax] = limits.description;
  if (!title?.trim()) w.push(`${where}: no SEO title`);
  else {
    if (title.length > tMax) w.push(`${where}: the SEO title is ${title.length} characters — search results cut it after about ${tMax}`);
    if (title.length < tMin) w.push(`${where}: the SEO title is only ${title.length} characters (aim for ${tMin}–${tMax})`);
    if (keyword && !keywordIn(title, keyword)) w.push(`${where}: the SEO title does not name "${keyword}"`);
  }
  if (!description?.trim()) w.push(`${where}: no meta description`);
  else {
    if (description.length > dMax) w.push(`${where}: the meta description is ${description.length} characters — search results cut it after about ${dMax}`);
    if (description.length < dMin) w.push(`${where}: the meta description is only ${description.length} characters (aim for ${dMin}–${dMax})`);
    if (keyword && !keywordIn(description, keyword)) w.push(`${where}: the meta description does not name "${keyword}"`);
    if (title && norm(title) === norm(description)) w.push(`${where}: the meta description repeats the title`);
  }
  return w;
}

// Alt text says what the image shows, in a sentence — not a file name, not "image of".
export function checkAlt(alt, where) {
  const [min, max] = SEO_LIMITS.alt;
  if (alt == null || !String(alt).trim()) return [`${where}: no alt text`];
  const a = String(alt).trim();
  const w = [];
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(a) || /^[\w-]+$/.test(a) && a.includes('-')) w.push(`${where}: the alt text "${a}" is a file name — say what the image shows`);
  if (/^(an? )?(image|picture|photo|screenshot|graphic) of\b/i.test(a)) w.push(`${where}: the alt text starts with "${a.split(' of')[0]} of" — start with what it shows`);
  if (a.length > max) w.push(`${where}: the alt text is ${a.length} characters (screen readers and search read about ${max})`);
  if (a.length < min) w.push(`${where}: the alt text "${a}" is too short to describe the image`);
  return w;
}

export function checkSlug(slug, keyword, where = 'page') {
  const w = [];
  const words = String(slug ?? '').split('-').filter(Boolean);
  if (words.length > SEO_LIMITS.slugWords) w.push(`${where}: the address slug has ${words.length} words — keep it to ${SEO_LIMITS.slugWords} or fewer`);
  if (keyword && !norm(slug).includes(norm(keyword).split(' ')[0])) w.push(`${where}: the address slug "${slug}" does not carry "${keyword}"`);
  return w;
}

// The FAQ: [{ q, a }]. Questions as customers ask them; each answer starts
// with the answer and stands on its own (answer engines quote it alone).
export function checkFaq(faq, where = 'faq') {
  const errors = [];
  const warnings = [];
  if (faq == null) return { errors, warnings: [`${where}: no FAQ — answer engines quote pages that answer questions directly`] };
  if (!Array.isArray(faq)) return { errors: [`${where} is a list of { "q": "…", "a": "…" }`], warnings };
  const [min, max] = SEO_LIMITS.faq;
  if (faq.length < min) warnings.push(`${where}: ${faq.length} question(s) — aim for ${min}–${max}`);
  if (faq.length > max) warnings.push(`${where}: ${faq.length} questions — keep the ${max} customers ask most`);
  const seen = new Set();
  faq.forEach((x, i) => {
    const at = `${where}[${i}]`;
    if (!x || typeof x.q !== 'string' || typeof x.a !== 'string' || !x.q.trim() || !x.a.trim()) return errors.push(`${at} needs a question "q" and an answer "a"`);
    const [qMin, qMax] = SEO_LIMITS.question;
    const [aMin, aMax] = SEO_LIMITS.answer;
    if (!x.q.trim().endsWith('?')) warnings.push(`${at}.q is not a question (end it with "?")`);
    if (x.q.length > qMax || x.q.length < qMin) warnings.push(`${at}.q is ${x.q.length} characters (${qMin}–${qMax})`);
    if (x.a.length > aMax) warnings.push(`${at}.a is ${x.a.length} characters — answer in ${aMax} or fewer; answer engines quote short answers`);
    if (x.a.length < aMin) warnings.push(`${at}.a is only ${x.a.length} characters — answer in a full sentence`);
    if (/^(yes|no)\b[^,.]*$/i.test(x.a.trim())) warnings.push(`${at}.a is a bare yes/no — add the sentence that explains it`);
    if (seen.has(norm(x.q))) warnings.push(`${at}.q repeats an earlier question`);
    seen.add(norm(x.q));
  });
  return { errors, warnings };
}

// Answer-first: the page's text names its subject and says what it is within
// its first words, so an answer engine can quote the opening on its own.
export function checkAnswerFirst(html, keyword, where = 'page') {
  const text = strip(html);
  if (!text) return [`${where}: no text — answer engines need a direct answer to quote`];
  const opening = text.split(' ').slice(0, ANSWER_WITHIN_WORDS).join(' ');
  const first = String(html).match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? (/<p\b/i.test(html) ? null : html);
  const w = [];
  if (keyword && !keywordIn(opening, keyword)) w.push(`${where}: the first ${ANSWER_WITHIN_WORDS} words do not name "${keyword}" — open with the direct answer: what it is and what it does`);
  if (first != null && strip(first).split(' ').length > ANSWER_WITHIN_WORDS) w.push(`${where}: the first paragraph is ${strip(first).split(' ').length} words — answer in the first ${ANSWER_WITHIN_WORDS}, then explain`);
  return w;
}

// Links in a text, and link fields: at least one to the site's own pages
// (the feature page, related pages); each link in the text with anchor text
// that says where it goes. links: extra URLs the page links to (a CMS
// item's link fields, such as its related videos).
export function checkLinks(html, { site = null, where = 'page', links: extra = [] } = {}) {
  const host = (() => { try { return site ? new URL(site).host : null; } catch { return null; } })();
  const ours = (href) => String(href).startsWith('/') || (host && (() => { try { return new URL(href).host === host; } catch { return false; } })());
  const links = [...String(html ?? '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ href: m[1], text: strip(m[2]) }));
  const w = [];
  if (!links.some((l) => ours(l.href)) && !extra.some(ours)) w.push(`${where}: no link to the site's own pages — link the feature page (and related pages) with descriptive anchor text`);
  for (const l of links.filter((x) => WEAK_ANCHOR.test(x.text))) w.push(`${where}: the link "${l.text}" (${l.href}) says nothing about its page — use anchor text that names it`);
  return w;
}

// The item's opening text, whatever the collection calls it: a rich-text
// summary, description or notes field, else a plain one (an episode's
// subtitle). Never an SEO field, a transcript or a code embed.
const NOT_BODY = /(meta|seo|og|transcri|embed|keyword|link|name|slug)/;
const bodyKey = (f) => {
  const keys = Object.keys(f).filter((k) => typeof f[k] === 'string' && f[k].trim() && !NOT_BODY.test(k));
  return keys.find((k) => /<p\b/i.test(f[k]) && /(summary|description|notes|body|content|about)/.test(k))
    ?? keys.find((k) => /(summary|subtitle|description|intro|excerpt)/.test(k));
};
const isUrl = (v) => typeof v === 'string' && /^(https?:\/\/|\/)\S+$/.test(v.trim());

// A CMS item's fields, whatever the collection calls them: the SEO title
// and description fields, the item's name and slug, and every image's alt.
// With aeo, also the body (answer-first, linked to the site's pages) — what
// the site's SEO rules ask of content pages such as video and episode pages.
export function checkCmsFields(fields, { keyword, where = 'item', limits = SEO_LIMITS, aeo = false, site = null } = {}) {
  const f = fields ?? {};
  const pick = (re) => Object.keys(f).find((k) => re.test(k));
  const titleKey = pick(/(meta|seo|og).*title|title.*(tag|seo)/);
  const descKey = pick(/(meta|seo|og).*desc/);
  const w = [];
  if (aeo) {
    const body = bodyKey(f);
    if (!body) w.push(`${where}: no summary or description text — answer engines need a direct answer to quote`);
    else w.push(...checkAnswerFirst(f[body], keyword, `${where}.${body}`));
    // links: in the item's rich text, and its link fields (related pages);
    // a collection with neither has its links in the template, not the item
    const rich = Object.entries(f).filter(([k, v]) => typeof v === 'string' && /<p\b/i.test(v) && !/transcri/.test(k)).map(([, v]) => v).join(' ');
    const linkFields = Object.entries(f).filter(([k, v]) => /link|url/.test(k) && !/video-url|mp3|embed/.test(k) && isUrl(v)).map(([, v]) => v.trim());
    if (rich || linkFields.length) w.push(...checkLinks(rich, { site, where, links: linkFields }));
  }
  // without a field of its own the title is the template's (often the name and
  // the brand): only the fields the collection has are checked
  if (titleKey || descKey) {
    const m = checkMeta({ title: titleKey ? f[titleKey] : null, description: descKey ? f[descKey] : null, keyword, where, limits });
    w.push(...m.filter((x) => (titleKey || !/SEO title/.test(x)) && (descKey || !/meta description/.test(x))));
  }
  // the page's title is its one <h1>: rich text that opens with another one
  // gives the page several. Where the template styles rich-text headings by
  // tag, the fix is the template's, not the item's (docs/seo.md)
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === 'string' && /<h1\b/i.test(v)) w.push(`${where}.${k}: the text holds an <h1> — the page's title should be its one <h1>; if the site's other items do the same, it is a template fix (docs/seo.md)`);
  }
  if (f.name && keyword && !keywordIn(f.name, keyword)) w.push(`${where}: the title (name) does not name "${keyword}"`);
  if (f.slug) w.push(...checkSlug(f.slug, keyword, where));
  for (const [k, v] of Object.entries(f)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && (v.asset || v.fileId || v.siteAsset)) w.push(...checkAlt(v.alt, `${where}.${k}`));
  }
  return w;
}

// ---- structured data ----

// JSON-LD in a <script>: "</" is escaped so text can never close the tag.
export const jsonLdScript = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

const faqPage = (faq) => ({
  '@type': 'FAQPage',
  mainEntity: faq.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
});

const organization = (brand) => ({ '@type': 'Organization', name: brand.name, ...(brand.website ? { url: brand.website } : {}) });

// The feature page: the page, the product feature it describes, its FAQ and,
// when there is one, its video.
export function featureJsonLd({ brief, brand, url = null, image = null }) {
  // the product's offer, rating and platforms: a rich result needs an offer
  // or a rating (the brand's web.schema.product, docs/schema.md)
  const product = brand.web?.schema?.product ?? {};
  const graph = [
    {
      '@type': 'WebPage',
      name: brief.seo?.title ?? `${brief.feature} | ${brand.name}`,
      description: brief.seo?.description ?? null,
      ...(url ? { url } : {}),
      about: { '@id': '#feature' },
      ...(image ? { primaryImageOfPage: image } : {}),
      publisher: organization(brand),
    },
    {
      '@type': 'SoftwareApplication',
      '@id': '#feature',
      name: `${brand.name} ${brief.feature}`.trim(),
      applicationCategory: product.applicationCategory ?? 'BusinessApplication',
      ...(product.operatingSystem ? { operatingSystem: product.operatingSystem } : {}),
      ...(product.offers ? { offers: { '@type': 'Offer', ...product.offers } } : {}),
      ...(product.aggregateRating ? { aggregateRating: { '@type': 'AggregateRating', ...product.aggregateRating } } : {}),
      description: brief.lead ?? brief.intro,
      featureList: (brief.sections ?? []).map((s) => s.title),
      publisher: organization(brand),
      ...(image ? { image } : {}),
    },
  ];
  if (Array.isArray(brief.faq) && brief.faq.length) graph.push(faqPage(brief.faq));
  if (brief.web?.video) graph.push({ '@type': 'VideoObject', name: brief.feature, description: brief.lead ?? brief.intro, embedUrl: brief.web.video, ...(image ? { thumbnailUrl: image } : {}) });
  return { '@context': 'https://schema.org', '@graph': graph.map((g) => Object.fromEntries(Object.entries(g).filter(([, v]) => v != null))) };
}

// The podcast episode page: the episode, its show, the audio and the
// transcript (what answer engines read of an episode).
export function episodeJsonLd({ podcast, brand, show = null, url = null, image = null, listenUrl = null, transcript = null, datePublished = null }) {
  const ep = podcast.episode ?? {};
  return {
    '@context': 'https://schema.org',
    '@type': 'PodcastEpisode',
    name: ep.title,
    ...(ep.number ? { episodeNumber: ep.number } : {}),
    description: ep.description,
    ...(url ? { url } : {}),
    ...(datePublished ? { datePublished } : {}),
    ...(image ? { image } : {}),
    ...(show ? { partOfSeries: { '@type': 'PodcastSeries', name: show.name, ...(show.url ? { url: show.url } : {}) } } : {}),
    ...(listenUrl ? { associatedMedia: { '@type': 'MediaObject', url: listenUrl } } : {}),
    ...(transcript ? { transcript: strip(transcript) } : {}),
    publisher: organization(brand),
  };
}

// ---- a page as published ----

// What a page's HTML shows search and answer engines: { title, description,
// canonical, robots, h1, ogImages, jsonLd: [types], images without alt,
// findings: [{ level, message }] }. Regular expressions, no DOM: enough for
// the head and the headings, which is what this checks.
export function auditHtml(html, { keyword = null, limits = SEO_LIMITS, expect = [] } = {}) {
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'))?.[1] ?? null;
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (key, val) => metas.filter((m) => (attr(m, key) ?? '').toLowerCase() === val).map((m) => attr(m, 'content'));
  const decode = (s) => (s == null ? s : strip(s));
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null);
  const description = decode(meta('name', 'description')[0] ?? null);
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((l) => /\brel\s*=\s*["']canonical["']/i.test(l));
  const robots = meta('name', 'robots')[0] ?? null;
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => strip(m[1]));
  const ogImages = [...new Set(meta('property', 'og:image'))];
  const jsonLd = [];
  const badJsonLd = [];
  const schemaFindings = [];
  const docs = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const d = JSON.parse(m[1]);
      const types = (x) => (Array.isArray(x) ? x.flatMap(types) : x?.['@graph'] ? types(x['@graph']) : [x?.['@type']].flat().filter(Boolean));
      jsonLd.push(...types(d));
      docs.push(d);
      schemaFindings.push(...validateJsonLd(d));
    } catch (err) {
      badJsonLd.push(err.message);
    }
  }
  const noAlt = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((t) => attr(t, 'alt') == null).map((t) => attr(t, 'src') ?? '?');
  const questions = [...html.matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map((m) => strip(m[1])).filter((t) => t.endsWith('?'));

  const findings = [];
  const add = (level, message) => findings.push({ level, message });
  checkMeta({ title, description, keyword, where: 'page', limits }).forEach((m) => add('warn', m));
  if (h1.length !== 1) add('warn', `the page has ${h1.length} <h1> elements (expected 1)`);
  // heading levels in order: a page jumping from <h2> to <h5> breaks its outline
  const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  const jump = levels.findIndex((l, i) => i > 0 && l > levels[i - 1] + 1);
  if (jump > 0) add('warn', `the headings skip a level (<h${levels[jump - 1]}> then <h${levels[jump]}>) — set the tag by its place in the outline and its look with a class`);
  if (!/<main\b/i.test(html)) add('warn', 'no <main> element around the page\'s own content');
  if (!meta('property', 'og:title').some(Boolean)) add('warn', 'no og:title — link previews fall back to the page title');
  if (!meta('property', 'og:description').some(Boolean)) add('warn', 'no og:description — link previews show no summary');
  if (!meta('name', 'twitter:card').some(Boolean)) add('warn', 'no twitter:card — X shows a bare link');
  h1.filter((t) => !t).forEach(() => add('warn', 'an empty <h1> — remove it or give it the page\'s heading'));
  const heading = h1.find(Boolean);
  if (keyword && heading && !keywordIn(heading, keyword)) add('warn', `the <h1> "${heading}" does not name "${keyword}"`);
  if (!canonical) add('warn', 'no canonical link — say which address is the page\'s own');
  if (robots && /noindex/i.test(robots)) add('warn', `robots says "${robots}": search engines leave the page out`);
  if (ogImages.length > 1) add('warn', `${ogImages.length} different og:image tags — link previews pick one at random; keep the page's own`);
  if (!ogImages.length) add('warn', 'no og:image — link previews show no picture');
  badJsonLd.forEach((m) => add('fail', `structured data (JSON-LD) does not parse: ${m}`));
  // each type's required and recommended properties, and references between
  // the page's blocks, resolved against its canonical address (schema.mjs)
  schemaFindings.push(...unresolvedReferences(docs, canonical ? attr(canonical, 'href') : null));
  schemaFindings.forEach((f) => add(f.level, `structured data: ${f.type}: ${f.message}`));
  if (!jsonLd.length) add('warn', 'no structured data (JSON-LD) — answer engines cannot tell what the page is about');
  // what this kind of page should say it is (a video page its VideoObject, an episode page its PodcastEpisode)
  for (const t of expect.filter((x) => !jsonLd.includes(x))) add('warn', `no ${t} in the structured data — this page should describe its ${t === 'VideoObject' ? 'video' : t === 'PodcastEpisode' ? 'episode' : t}; add it in the block of whoever owns the template (docs/schema.md, "Who owns each page")`);
  noAlt.forEach((src) => add('warn', `image without alt text: ${src}`));
  if (!questions.length && !jsonLd.includes('FAQPage')) add('warn', 'no questions answered on the page (an FAQ) — answer engines quote direct answers');
  return { title, description, canonical: canonical ? attr(canonical, 'href') : null, robots, h1, ogImages, jsonLd, noAlt, questions, findings };
}
