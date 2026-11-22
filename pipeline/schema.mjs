// Structured data (schema.org JSON-LD) for every kind of page on the website,
// and a check of what a page carries against what search engines need for a
// rich result (docs/schema.md).
//
// Each page type is one shape — the schema.org types it emits and the
// properties they take — rendered three ways from the same definition:
//
//   pageJsonLd(type, values, ctx)          JSON-LD for one page, from values
//   templateCode(type, fields, ctx)        the head code for a CMS template:
//                                          the same JSON-LD with each value
//                                          bound to the item's field
//   validateJsonLd(data)                   findings for JSON-LD as published
//
// Which field feeds which property, the site's sections and its publisher are
// brand facts: the brand's web.schema block (brand.json), never code.

// ---- the page types ----

// Each property: its kind (how it is bound and checked) and whether the type
// needs it. Kinds: text, url (a page or link), image, date, video (a video
// link), slug (the item's slug, turned into its address).
const P = (kind, required = false) => ({ kind, required });

export const PAGE_TYPES = {
  article: {
    label: 'Blog post or guide (BlogPosting / Article)',
    props: {
      slug: P('slug', true), headline: P('text', true), description: P('text'), image: P('image', true),
      datePublished: P('date', true), dateModified: P('date'), authorName: P('text'), authorUrl: P('slug'),
      authorImage: P('image'), section: P('text'), keywords: P('text'),
    },
    build: (v, c) => [
      clean({
        '@type': c.template?.schemaType ?? 'BlogPosting',
        '@id': `${v.url}#article`,
        mainEntityOfPage: { '@type': 'WebPage', '@id': v.url },
        url: v.url,
        headline: v.headline,
        description: v.description,
        image: v.image,
        datePublished: v.datePublished,
        dateModified: v.dateModified ?? v.datePublished,
        author: v.authorName
          ? clean({ '@type': 'Person', name: v.authorName, url: v.authorUrl && c.authorPath ? join(c.base, c.authorPath, v.authorUrl) : undefined, image: v.authorImage })
          : publisher(c),
        publisher: publisher(c),
        articleSection: v.section,
        keywords: v.keywords,
        inLanguage: c.language,
      }),
    ],
  },
  video: {
    label: 'Video page (VideoObject)',
    props: {
      slug: P('slug', true), name: P('text', true), description: P('text', true), thumbnailUrl: P('image', true),
      uploadDate: P('date', true), embedUrl: P('video', true), duration: P('text'), transcript: P('text'),
    },
    build: (v, c) => [
      clean({
        '@type': 'VideoObject',
        '@id': `${v.url}#video`,
        url: v.url,
        name: v.name,
        description: v.description,
        thumbnailUrl: v.thumbnailUrl,
        uploadDate: v.uploadDate,
        embedUrl: v.embedUrl,
        duration: v.duration,
        transcript: v.transcript,
        publisher: publisher(c),
        inLanguage: c.language,
      }),
    ],
  },
  feature: {
    label: 'Feature page (WebPage + SoftwareApplication)',
    props: {
      slug: P('slug', true), name: P('text', true), description: P('text', true), image: P('image'),
      video: P('video'), dateModified: P('date'),
    },
    build: (v, c) => [
      clean({
        '@type': 'WebPage',
        '@id': v.url,
        url: v.url,
        name: v.name,
        description: v.description,
        primaryImageOfPage: v.image,
        dateModified: v.dateModified,
        about: { '@id': `${v.url}#feature` },
        isPartOf: c.base ? { '@type': 'WebSite', url: c.base } : undefined,
        inLanguage: c.language,
      }),
      clean({
        '@type': 'SoftwareApplication',
        '@id': `${v.url}#feature`,
        name: c.product?.name ? `${c.product.name} ${v.name}` : v.name,
        description: v.description,
        image: v.image,
        applicationCategory: c.product?.applicationCategory ?? 'BusinessApplication',
        operatingSystem: c.product?.operatingSystem,
        offers: c.product?.offers ? clean({ '@type': 'Offer', ...c.product.offers }) : undefined,
        aggregateRating: c.product?.aggregateRating ? clean({ '@type': 'AggregateRating', ...c.product.aggregateRating }) : undefined,
        publisher: publisher(c),
      }),
      v.video ? clean({ '@type': 'VideoObject', name: v.name, description: v.description, thumbnailUrl: v.image, embedUrl: v.video, uploadDate: v.dateModified }) : null,
    ],
  },
  podcast: {
    label: 'Podcast episode (PodcastEpisode)',
    props: {
      slug: P('slug', true), name: P('text', true), description: P('text', true), image: P('image'),
      audioUrl: P('url'), episodeNumber: P('text'), datePublished: P('date'), transcript: P('text'),
    },
    build: (v, c) => [
      clean({
        '@type': 'PodcastEpisode',
        '@id': `${v.url}#episode`,
        url: v.url,
        name: v.name,
        description: v.description,
        image: v.image,
        episodeNumber: v.episodeNumber,
        datePublished: v.datePublished,
        associatedMedia: v.audioUrl ? { '@type': 'MediaObject', contentUrl: v.audioUrl } : undefined,
        partOfSeries: c.template?.series ? clean({ '@type': 'PodcastSeries', name: c.template.series.name, url: c.template.series.url }) : undefined,
        transcript: v.transcript,
        publisher: publisher(c),
        inLanguage: c.language,
      }),
    ],
  },
  event: {
    label: 'Webinar or online event (Event)',
    props: {
      slug: P('slug', true), name: P('text', true), description: P('text', true), image: P('image', true),
      startDate: P('date', true), endDate: P('date'), registrationUrl: P('url'), recordingUrl: P('video'),
    },
    build: (v, c) => [
      clean({
        '@type': 'Event',
        '@id': `${v.url}#event`,
        url: v.url,
        name: v.name,
        description: v.description,
        image: v.image,
        startDate: v.startDate,
        endDate: v.endDate,
        eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
        eventStatus: 'https://schema.org/EventScheduled',
        location: { '@type': 'VirtualLocation', url: v.url },
        organizer: publisher(c),
        offers: c.template?.free
          ? clean({ '@type': 'Offer', price: '0', priceCurrency: c.template.currency ?? 'USD', availability: 'https://schema.org/InStock', url: v.registrationUrl ?? v.url })
          : undefined,
        recordedIn: v.recordingUrl ? { '@type': 'VideoObject', name: v.name, embedUrl: v.recordingUrl, thumbnailUrl: v.image, uploadDate: v.startDate, description: v.description } : undefined,
        inLanguage: c.language,
      }),
    ],
  },
  story: {
    label: 'Customer story (Article about the customer)',
    props: {
      slug: P('slug', true), headline: P('text', true), description: P('text'), image: P('image', true),
      customer: P('text', true), industry: P('text'), location: P('text'), datePublished: P('date'), dateModified: P('date'),
    },
    build: (v, c) => [
      clean({
        '@type': 'Article',
        '@id': `${v.url}#story`,
        mainEntityOfPage: { '@type': 'WebPage', '@id': v.url },
        url: v.url,
        headline: v.headline,
        description: v.description,
        image: v.image,
        datePublished: v.datePublished,
        dateModified: v.dateModified ?? v.datePublished,
        author: publisher(c),
        publisher: publisher(c),
        about: clean({ '@type': 'Organization', name: v.customer, address: v.location ? { '@type': 'PostalAddress', addressLocality: v.location } : undefined, knowsAbout: v.industry }),
        inLanguage: c.language,
      }),
    ],
  },
  profile: {
    label: 'Author page (ProfilePage + Person)',
    props: { slug: P('slug', true), name: P('text', true), description: P('text'), image: P('image'), jobTitle: P('text'), dateModified: P('date') },
    build: (v, c) => [
      clean({
        '@type': 'ProfilePage',
        '@id': v.url,
        url: v.url,
        dateModified: v.dateModified,
        mainEntity: clean({ '@type': 'Person', name: v.name, description: v.description, image: v.image, jobTitle: v.jobTitle, worksFor: publisher(c) }),
        inLanguage: c.language,
      }),
    ],
  },
  partner: {
    label: 'Partner or expert directory entry (ProfilePage + Organization)',
    props: { slug: P('slug', true), name: P('text', true), description: P('text'), image: P('image'), website: P('url'), location: P('text'), dateModified: P('date') },
    build: (v, c) => [
      clean({
        '@type': 'ProfilePage',
        '@id': v.url,
        url: v.url,
        dateModified: v.dateModified,
        mainEntity: clean({
          '@type': c.template?.schemaType ?? 'ProfessionalService',
          name: v.name,
          description: v.description,
          image: v.image,
          url: v.website,
          address: v.location ? { '@type': 'PostalAddress', addressLocality: v.location } : undefined,
        }),
        inLanguage: c.language,
      }),
    ],
  },
  comparison: {
    label: 'Comparison page (WebPage about the products compared)',
    props: { slug: P('slug', true), name: P('text', true), description: P('text', true), image: P('image'), dateModified: P('date') },
    build: (v, c) => [
      clean({
        '@type': 'WebPage',
        '@id': v.url,
        url: v.url,
        name: v.name,
        description: v.description,
        primaryImageOfPage: v.image,
        dateModified: v.dateModified,
        about: c.product?.name ? { '@type': 'SoftwareApplication', name: c.product.name, applicationCategory: c.product.applicationCategory ?? 'BusinessApplication' } : undefined,
        publisher: publisher(c),
        inLanguage: c.language,
      }),
    ],
  },
  page: {
    label: 'Static page (WebPage, or a subtype: AboutPage, ContactPage…)',
    props: { path: P('text', true), name: P('text', true), description: P('text'), image: P('image'), dateModified: P('date') },
    build: (v, c) => [
      clean({
        '@type': c.page?.schemaType ?? 'WebPage',
        '@id': v.url,
        url: v.url,
        name: v.name,
        description: v.description,
        primaryImageOfPage: v.image,
        dateModified: v.dateModified,
        isPartOf: c.base ? { '@type': 'WebSite', url: c.base } : undefined,
        publisher: publisher(c),
        inLanguage: c.language,
      }),
    ],
  },
};

// ---- helpers ----

// Drop empty properties (null, undefined, '', [], {}), keeping zeros.
export function clean(o) {
  if (Array.isArray(o)) return o.map(clean).filter((x) => !isEmpty(x));
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const c = clean(v);
    if (!isEmpty(c)) out[k] = c;
  }
  return out;
}
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);

const trimSlash = (s) => String(s ?? '').replace(/\/+$/, '');
// base + section path + slug, one slash between each
const join = (base, ...parts) => [trimSlash(base), ...parts.map((p) => String(p).replace(/^\/+|\/+$/g, ''))].filter((x) => x !== '').join('/');

const publisher = (c) =>
  c.org?.name ? clean({ '@type': 'Organization', '@id': c.org.id, name: c.org.name, url: c.org.url ?? c.base, logo: c.org.logo ? { '@type': 'ImageObject', url: c.org.logo } : undefined }) : undefined;

// Home > section > page, the last without a link (Google: the page itself).
function breadcrumb(c, name, url) {
  const items = [{ name: c.homeName ?? 'Home', item: c.base ? `${trimSlash(c.base)}/` : undefined }];
  // the section's listing page; a section without one is left out, as a
  // breadcrumb step must link somewhere
  if (c.template?.section?.path) items.push({ name: c.template.section.name, item: join(c.base, c.template.section.path) });
  items.push({ name, item: url });
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((x, i) => clean({ '@type': 'ListItem', position: i + 1, name: x.name, item: x.item })),
  };
}

// The context every shape reads, from the brand's web.schema block.
export function schemaContext(brand, extra = {}) {
  const s = brand.web?.schema ?? {};
  const base = trimSlash(s.base ?? brand.website ?? '');
  return {
    base,
    language: s.language ?? 'en',
    homeName: s.homeName ?? 'Home',
    authorPath: s.authorPath ?? null,
    org: { name: s.organization?.name ?? brand.name, url: s.organization?.url ?? base, logo: s.organization?.logo ?? null, id: s.organization?.id ?? null },
    product: s.product ?? null,
    ...extra,
  };
}

// The page's own address from its slug and the template's path.
const pageUrl = (c, slug) => (c.template?.path ? join(c.base, c.template.path.replace('{slug}', slug)) : join(c.base, slug));

function graph(type, v, c, { faq = null, crumbs = true } = {}) {
  const def = PAGE_TYPES[type];
  if (!def) throw new Error(`no page type "${type}" — ${Object.keys(PAGE_TYPES).join(', ')}`);
  const nodes = def.build(v, c).filter(Boolean);
  if (Array.isArray(faq) && faq.length) nodes.push(faqPage(faq));
  if (crumbs && type !== 'page') nodes.push(breadcrumb(c, v.name ?? v.headline, v.url));
  // a static page sits right under Home
  if (crumbs && type === 'page' && c.page?.breadcrumb) nodes.push(breadcrumb({ ...c, template: null }, c.page.breadcrumb.name ?? v.name, v.url));
  return { '@context': 'https://schema.org', '@graph': nodes };
}

export const faqPage = (faq) => ({
  '@type': 'FAQPage',
  mainEntity: faq.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })),
});

// ---- one page, from values ----

// JSON-LD for one page: values are the type's properties (slug or path gives
// the address). Missing optional properties are left out.
export function pageJsonLd(type, values, ctx, { faq = null } = {}) {
  const v = { ...values };
  v.url = type === 'page' ? join(ctx.base, v.path ?? '') : pageUrl(ctx, v.slug);
  if (type === 'page' && (v.path ?? '/') === '/') v.url = `${trimSlash(ctx.base)}/`;
  return graph(type, v, ctx, { faq });
}

// Questions and answers from an FAQ section in HTML: each <h3> (or <h2>)
// ending in "?" and the paragraphs after it, up to the next heading.
export function faqFromHtml(html) {
  const text = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  const out = [];
  const re = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[1-6]\b|$)/gi;
  for (const m of String(html ?? '').matchAll(re)) {
    const q = text(m[2]);
    const a = [...m[3].matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((p) => text(p[2])).filter(Boolean).join(' ');
    if (q.endsWith('?') && a) out.push({ q, a });
  }
  return out;
}

// ---- a CMS template's head code ----

// Every item's own dates, which Webflow binds like fields.
export const ITEM_FIELDS = { 'published-on': 'publishedAt', 'updated-on': 'updatedAt', 'created-on': 'createdAt' };

// Webflow's field type for each kind, as its "Add field" inserts it.
const WF_TYPE = { text: 'PlainText', image: 'ImageRef', date: 'Date', url: 'Link', video: 'VideoLink', slug: 'PlainText' };

// How a field reads in Webflow's custom code: {{wf {"path":…,"type":…} }},
// quotes as &quot; and the closing brace escaped, as the Designer writes it.
export const wfBinding = (field, kind) =>
  `{{wf {&quot;path&quot;:&quot;${field}&quot;,&quot;type&quot;:&quot;${WF_TYPE[kind] ?? 'PlainText'}&quot;\\} }}`;

// The template's head code: a <script type="application/ld+json"> whose
// values are the item's fields. fields maps each property to a field slug
// ("author:name" for a referenced item's field). Returns { code, bindings,
// missing } — bindings for a person adding fields by hand, missing the
// required properties no field feeds.
export function templateCode(type, fields, ctx) {
  const def = PAGE_TYPES[type];
  if (!def) throw new Error(`no page type "${type}" — ${Object.keys(PAGE_TYPES).join(', ')}`);
  if (type === 'page') throw new Error('page: a static page has no template — use pageJsonLd');
  const unknown = Object.keys(fields ?? {}).filter((k) => !def.props[k]);
  if (unknown.length) throw new Error(`${type}: no property ${unknown.join(', ')} — it takes ${Object.keys(def.props).join(', ')}`);

  // each bound value is a marker string; the markers become bindings once the
  // JSON is written, so they can sit inside URLs (the page's, the author's)
  const marks = [];
  const mark = (field, kind) => { marks.push({ field, kind }); return `@@F${marks.length - 1}@@`; };
  const v = {};
  for (const [prop, field] of Object.entries(fields ?? {})) v[prop] = mark(field, def.props[prop].kind);
  v.url = pageUrl(ctx, v.slug ?? mark('slug', 'slug'));
  const missing = Object.entries(def.props).filter(([k, p]) => p.required && !fields?.[k] && k !== 'slug').map(([k]) => k);

  const json = JSON.stringify(graph(type, v, ctx), null, 2);
  const bindings = [];
  const code = json.replace(/@@F(\d+)@@/g, (_, i) => {
    const m = marks[Number(i)];
    if (!bindings.some((b) => b.field === m.field)) bindings.push({ field: m.field, kind: m.kind, type: WF_TYPE[m.kind] });
    return wfBinding(m.field, m.kind);
  });
  return { code: `<script type="application/ld+json">\n${code}\n</script>`, bindings, missing };
}

// ---- checking JSON-LD as published ----

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const absolute = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
const urlOf = (x) => (typeof x === 'string' ? x : x?.url ?? x?.['@id'] ?? null);
const name = (n) => [n?.['@type']].flat().join('/');

// What Google needs for a rich result of each type (required) and what it
// recommends; Organization, WebSite and WebPage have no rich result but are
// checked for the basics.
const RULES = {
  Article: { required: ['headline', 'image', 'datePublished', 'author'], recommended: ['dateModified', 'publisher', 'mainEntityOfPage'] },
  BlogPosting: 'Article',
  NewsArticle: 'Article',
  VideoObject: { required: ['name', 'thumbnailUrl', 'uploadDate'], recommended: ['description', 'embedUrl|contentUrl', 'duration'] },
  Event: { required: ['name', 'startDate', 'location'], recommended: ['description', 'image', 'endDate', 'eventAttendanceMode', 'eventStatus', 'organizer', 'offers'] },
  FAQPage: { required: ['mainEntity'] },
  BreadcrumbList: { required: ['itemListElement'] },
  SoftwareApplication: { required: ['name', 'offers|aggregateRating'], recommended: ['applicationCategory', 'operatingSystem'] },
  PodcastEpisode: { required: ['name', 'url'], recommended: ['description', 'associatedMedia', 'partOfSeries', 'datePublished'] },
  ProfilePage: { required: ['mainEntity'], recommended: ['dateModified'] },
  Organization: { required: ['name', 'url'], recommended: ['logo'] },
  WebSite: { required: ['name', 'url'] },
  WebPage: { required: ['name'], recommended: ['description', 'url'] },
};
const ruleFor = (t) => {
  let r = RULES[t];
  while (typeof r === 'string') r = RULES[r];
  return r ?? null;
};
const has = (node, key) => key.split('|').some((k) => !isEmpty(node[k]));

// Who writes a template's or page's structured data: its `owner` in
// web.schema, else Rollout. Another owner (another tool, the site builder's
// schema setting) means Rollout generates nothing for it, so a page never
// carries two blocks describing the same thing.
export const ROLLOUT = 'rollout';
export const ownerOf = (entry) => String(entry?.owner ?? ROLLOUT).trim() || ROLLOUT;
export const ownedByRollout = (entry) => ownerOf(entry).toLowerCase() === ROLLOUT;

// Every node of a JSON-LD document: @graph members and arrays, flattened.
export const nodesOf = (d) => (Array.isArray(d) ? d.flatMap(nodesOf) : d?.['@graph'] ? nodesOf(d['@graph']) : d && typeof d === 'object' ? [d] : []);

// Findings for one JSON-LD document: [{ level: 'fail'|'warn', type, message }].
// fail: a rich result is impossible (a required property missing or
// malformed); warn: it will be weaker than it could be.
export function validateJsonLd(data) {
  const out = [];
  const add = (level, type, message) => out.push({ level, type, message });
  for (const node of nodesOf(data)) {
    const types = [node['@type']].flat().filter(Boolean);
    if (!types.length) { add('fail', '?', 'a node without @type'); continue; }
    for (const t of types) {
      const r = ruleFor(t);
      if (!r) continue;
      for (const k of r.required ?? []) if (!has(node, k)) add('fail', t, `missing ${k.replace('|', ' or ')} (required)`);
      for (const k of r.recommended ?? []) if (!has(node, k)) add('warn', t, `no ${k.replace('|', ' or ')} (recommended)`);
    }
    const t = name(node);
    for (const k of ['datePublished', 'dateModified', 'uploadDate', 'startDate', 'endDate']) {
      if (typeof node[k] === 'string' && !ISO_DATE.test(node[k])) add('fail', t, `${k} "${node[k]}" is not an ISO 8601 date`);
    }
    for (const k of ['url', 'thumbnailUrl', 'embedUrl', 'contentUrl']) {
      const u = node[k];
      if (typeof u === 'string' && u && !absolute(u)) add('warn', t, `${k} "${u}" is not an absolute URL`);
    }
    if (types.some((x) => ['Article', 'BlogPosting', 'NewsArticle'].includes(x))) {
      if (typeof node.headline === 'string' && node.headline.length > 110) add('warn', t, `headline is ${node.headline.length} characters (Google shows up to 110)`);
      if (typeof node.headline === 'string' && /\s[|–—-]\s\S+$/.test(node.headline)) add('warn', t, `headline "${node.headline}" ends with a site name — use the article's own title`);
      for (const a of [node.author].flat().filter(Boolean)) {
        if (!a.name) add('fail', t, 'author without a name');
        if (a.url && !absolute(a.url)) add('warn', t, `author url "${a.url}" is not an absolute URL`);
      }
      if (node.image && !absolute(urlOf([node.image].flat()[0]))) add('warn', t, 'image is not an absolute URL');
    }
    if (types.includes('FAQPage')) {
      const qs = [node.mainEntity].flat().filter(Boolean);
      qs.forEach((q, i) => {
        if (!q.name) add('fail', 'FAQPage', `question ${i + 1} has no text (name)`);
        if (!q.acceptedAnswer?.text) add('fail', 'FAQPage', `question ${i + 1} has no answer (acceptedAnswer.text)`);
      });
    }
    if (types.includes('BreadcrumbList')) {
      const items = [node.itemListElement].flat().filter(Boolean);
      items.forEach((it, i) => {
        if (it.position !== i + 1) add('fail', 'BreadcrumbList', `item ${i + 1} has position ${it.position ?? 'none'}`);
        if (!it.name) add('fail', 'BreadcrumbList', `item ${i + 1} has no name`);
        if (i < items.length - 1 && !absolute(urlOf(it.item))) add('fail', 'BreadcrumbList', `item ${i + 1} ("${it.name}") has no absolute item URL`);
      });
    }
    if (types.includes('Event') && node.location && !node.location.url && !node.location.address) add('fail', 'Event', 'location has neither a url (online) nor an address');
    if (types.includes('VideoObject') && node.duration && !/^P(T?)/.test(node.duration)) add('warn', 'VideoObject', `duration "${node.duration}" is not ISO 8601 (e.g. PT2M35S)`);
  }
  return out;
}

// ---- previewing a template with an item ----

const BINDING_RE = /\{\{wf \{&quot;path&quot;:&quot;([^&]+)&quot;,&quot;type&quot;:&quot;([A-Za-z]+)&quot;\\} \}\}/g;

// The JSON-LD a template's page carries for one item: each binding replaced by
// values[field] (a referenced item's field as "ref:field"). Values are written
// JSON-safe here; Webflow inserts them as they are, so a value holding a
// double quote, a backslash or a line break is listed in risky — it would
// break the live JSON. Returns { data, risky, unbound }.
export function fillTemplate(code, values) {
  const risky = [];
  const unbound = [];
  const body = String(code).replace(/^[\s\S]*?<script[^>]*>/, '').replace(/<\/script>[\s\S]*$/, '');
  const filled = body.replace(BINDING_RE, (_, field) => {
    const v = values[field];
    if (v == null || v === '') { if (!unbound.includes(field)) unbound.push(field); return ''; }
    const s = typeof v === 'object' ? v.url ?? '' : String(v);
    if (/["\\\n\r]/.test(s) && !risky.some((r) => r.field === field)) risky.push({ field, value: s.length > 60 ? `${s.slice(0, 60)}…` : s });
    return JSON.stringify(s).slice(1, -1);
  });
  return { data: clean(JSON.parse(filled)), risky, unbound };
}

// ---- references between blocks ----

// A reference is an object holding only an @id (e.g. "publisher": {"@id":
// "https://…/#organization"}): it names a node defined elsewhere on the page,
// in the same block or another. An @id is resolved against the page's address,
// so "#organization" on https://site/blog/x is https://site/blog/x#organization.
const resolveId = (id, pageUrl) => {
  try { return pageUrl ? new URL(id, pageUrl).href : id; } catch { return id; }
};
const isReference = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v['@id'] === 'string';

// Kinds of node a page should describe once: two of them on one page usually
// means two tools write its structured data (docs/schema.md, "Who owns each
// page"). Organization, Person, WebSite and the like legitimately repeat.
export const ONCE_PER_PAGE = ['BreadcrumbList', 'WebPage', 'ProfilePage', 'AboutPage', 'ContactPage', 'FAQPage',
  'Article', 'BlogPosting', 'NewsArticle', 'Product', 'SoftwareApplication', 'VideoObject', 'PodcastEpisode', 'Event'];

// The page's top-level nodes of a kind that should appear once, found more
// than once across its blocks: [{ level: 'warn', type, message }]. Nodes with
// the same @id are one node said twice, and are not counted again.
export function duplicateNodes(docs, pageUrl = null) {
  const seen = new Map();
  for (const n of [docs].flat().flatMap(nodesOf)) {
    const id = typeof n['@id'] === 'string' ? resolveId(n['@id'], pageUrl) : null;
    for (const t of [n['@type']].flat().filter((x) => ONCE_PER_PAGE.includes(x))) {
      const s = seen.get(t) ?? { count: 0, ids: new Set() };
      if (id && s.ids.has(id)) continue;
      if (id) s.ids.add(id);
      s.count += 1;
      seen.set(t, s);
    }
  }
  return [...seen].filter(([, s]) => s.count > 1).map(([t, s]) => ({
    level: 'warn',
    type: t,
    message: `${s.count} ${t} nodes on one page — two tools may both write its structured data; give the page type one owner (web.schema owner, docs/schema.md)`,
  }));
}

// Every reference on the page that no node defines: [{ level: 'fail', type,
// message }]. docs are the page's parsed JSON-LD blocks; a node defines its
// @id when it says more than the @id (a @type or any other property).
export function unresolvedReferences(docs, pageUrl = null) {
  const defined = new Set();
  const refs = [];
  const walk = (v, owner, key) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, owner, key));
    if (!v || typeof v !== 'object') return;
    if (isReference(v)) return refs.push({ id: v['@id'], owner, key });
    if (typeof v['@id'] === 'string') defined.add(resolveId(v['@id'], pageUrl));
    const type = [v['@type']].flat().filter(Boolean).join('/') || owner;
    for (const [k, x] of Object.entries(v)) if (k !== '@id' && k !== '@context') walk(x, type, k);
  };
  for (const d of [docs].flat()) walk(d, '?', null);
  const out = [];
  const seen = new Set();
  for (const r of refs) {
    const id = resolveId(r.id, pageUrl);
    if (defined.has(id) || seen.has(`${r.owner} ${r.key} ${id}`)) continue;
    seen.add(`${r.owner} ${r.key} ${id}`);
    out.push({ level: 'fail', type: r.owner, message: `${r.key} refers to "${r.id}", which nothing on the page defines (give that node an @id, or write the ${r.key} out)` });
  }
  return out;
}
