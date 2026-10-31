// The website: the feature page on the brand's own site, built in the site
// builder from the site's components (docs/website.md).
//
// Which site builder is a deployment fact: WEBSITE in .env, else the brand's
// web.provider. Each provider is an adapter in website/ with the same calls;
// nothing here knows one provider from another.
//
//   sites()                  every site the token can reach
//   site()                   the site: { id, name, domains }
//   pages(), page(id)        pages: { id, title, slug, path, folderId, draft, updatedAt, seo }
//   components()             the site's components: { id, name, group, description }
//   uploadAsset(file)        an image in the site's assets: { id, url }
//
//   collection(id), items(id), item(collectionId, itemId)   CMS collections and their items
//
// The rollout-web-publisher agent plans the page in
// library/features/<slug>/site.json — either the components it is made of, in
// order, with their prop values ("sections"), or, when the site keeps its
// feature pages in a CMS collection (WEBFLOW_FEATURES_COLLECTION_ID), the
// item's field values ("cms") — and, on the user's approval, builds it in the
// site builder. The pipeline checks the plan, uploads its images and keeps the
// record of where the page lives: library/features/<slug>/site.published.json.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env, featurePaths, readJson, writeJson, SLUG_RE } from './env.mjs';

const ADAPTERS = {
  webflow: () => import('./website/webflow.mjs'),
};

export const siteFile = (slug) => path.join(featurePaths(slug).library, 'site.json');
export const siteRecordFile = (slug) => path.join(featurePaths(slug).library, 'site.published.json');
// what the pipeline read from the site for this feature: inventory, pages, uploaded assets
export const siteDir = (slug) => path.join(featurePaths(slug).output, 'site');
export const readSiteRecord = (slug) => (fs.existsSync(siteRecordFile(slug)) ? readJson(siteRecordFile(slug)) : null);

// The connection. { anySite: true } allows a missing WEBFLOW_SITE_ID, for
// listing the sites the token can reach.
export async function website(brand, { anySite = false } = {}) {
  const name = env('WEBSITE') ?? brand.web?.provider;
  if (!name) throw new Error('no website configured — set WEBSITE in .env or web.provider in brand.json');
  if (!ADAPTERS[name]) throw new Error(`no website adapter "${name}" (${Object.keys(ADAPTERS).join(', ')})`);
  const token = env('WEBFLOW_API_TOKEN');
  const siteId = env('WEBFLOW_SITE_ID');
  if (!token) throw new Error('WEBFLOW_API_TOKEN is not set in .env');
  if (!siteId && !anySite) throw new Error('WEBFLOW_SITE_ID is not set in .env — rollout.mjs site lists the sites the token can reach');
  const adapter = await ADAPTERS[name]();
  return { name, siteId, ...adapter.connect({ token, siteId, baseUrl: env('WEBFLOW_API_URL') }) };
}

// The CMS collection feature pages are items of, when the site keeps them there.
export const featuresCollectionId = () => env('WEBFLOW_FEATURES_COLLECTION_ID') ?? null;

// Read the site's pages and components — and the feature collection's fields
// and items, when there is one — into output/<slug>/site/inventory.json, the
// list the agent plans from.
export async function readInventory(slug, ws) {
  const [site, pages, components] = await Promise.all([ws.site(), ws.pages(), ws.components()]);
  let collection = null;
  const cid = featuresCollectionId();
  if (cid) {
    const [c, items] = await Promise.all([ws.collection(cid), ws.items(cid)]);
    collection = { ...c, items: items.map(({ fields, ...i }) => i) };
  }
  const inventory = {
    $comment: 'What the site holds, read by pipeline/website.mjs (rollout.mjs site-find). Never edit; read it again instead.',
    provider: ws.name,
    site,
    pages,
    components,
    collection,
    readAt: new Date().toISOString(),
  };
  writeJson(path.join(siteDir(slug), 'inventory.json'), inventory);
  return inventory;
}

const readInventoryFile = (slug) => {
  const f = path.join(siteDir(slug), 'inventory.json');
  return fs.existsSync(f) ? readJson(f) : null;
};

export function loadSite(slug) {
  return fs.existsSync(siteFile(slug)) ? readJson(siteFile(slug)) : null;
}

// Where a new page goes and which group new components join, unless the plan
// says: WEBFLOW_PAGE_FOLDER_ID (else the site root), WEBFLOW_COMPONENT_GROUP.
export const siteDefaults = (site) => ({
  folderId: site?.page?.folderId ?? env('WEBFLOW_PAGE_FOLDER_ID') ?? null,
  group: env('WEBFLOW_COMPONENT_GROUP', 'Rollout'),
});

// The files a plan uses: { "asset": "<file>" } prop and field values and the og image.
export function siteAssets(site) {
  const files = new Set();
  const walk = (v) => {
    if (v && typeof v === 'object' && typeof v.asset === 'string') files.add(v.asset);
  };
  for (const s of site.sections ?? []) Object.values(s.props ?? {}).forEach(walk);
  Object.values(site.cms?.fields ?? {}).forEach(walk);
  walk(site.page?.openGraph?.image);
  return [...files];
}

// A plain file name is in output/<slug>/web/assets/; a path ("assets/social/…")
// is relative to output/<slug>/.
const assetPath = (slug, file) => (file.includes('/') ? path.join(featurePaths(slug).output, file) : path.join(featurePaths(slug).web, 'assets', file));

const isValue = (v) => typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number'
  || (v && typeof v === 'object' && (typeof v.asset === 'string' || typeof v.siteAsset === 'string' || typeof v.url === 'string'));
const VALUE_HELP = 'a value is text, a number, true/false, { "asset": "<file>" }, { "siteAsset": "<asset id>" } or { "url": "<link>" }';

// The cms form: the item's fields by slug, checked against the collection when read.
function validateCms(site, inventory, errors, warnings) {
  const cms = site.cms;
  const f = cms.fields ?? {};
  if (!cms.collectionId) errors.push('cms.collectionId is required (WEBFLOW_FEATURES_COLLECTION_ID)');
  if (!String(f.name ?? '').trim()) errors.push('cms.fields.name (the item\'s title) is required');
  if (!SLUG_RE.test(f.slug ?? '')) errors.push(`cms.fields.slug "${f.slug ?? ''}" must be lower-case words joined by hyphens`);
  for (const [k, v] of Object.entries(f)) if (v !== null && !isValue(v)) errors.push(`cms.fields["${k}"]: ${VALUE_HELP}, or null`);
  const col = inventory?.collection;
  if (!col || col.id !== cms.collectionId) return warnings.push(`the collection's fields have not been read — run rollout.mjs site-find with WEBFLOW_FEATURES_COLLECTION_ID set so field names can be checked`);
  const known = new Map(col.fields.map((x) => [x.slug, x]));
  for (const k of Object.keys(f)) if (!known.has(k)) errors.push(`cms.fields["${k}"]: no field "${k}" in ${col.name} — fields: ${[...known.keys()].join(', ')}`);
  for (const x of col.fields) if (x.required && (f[x.slug] == null || f[x.slug] === '')) errors.push(`cms.fields["${x.slug}"] (${x.name}) is required by ${col.name}`);
  const taken = col.items.find((i) => i.slug === f.slug);
  if (taken && taken.id !== site.publish?.itemId) errors.push(`an item with slug "${f.slug}" already exists (${taken.id}) — update it (publish.itemId) or choose another slug`);
}

function checkFiles(slug, site, errors) {
  for (const f of siteAssets(site)) {
    if (!fs.existsSync(assetPath(slug, f))) errors.push(`asset ${f} is not in output/${slug}/${f.includes('/') ? '' : 'web/assets/'} — build first, or use a file the build made`);
  }
}

// Check site.json against the build and, when they have been read, the site's
// components or the feature collection's fields. { errors, warnings }.
export function validateSite(slug) {
  const site = loadSite(slug);
  const errors = [];
  const warnings = [];
  if (!site) return { errors: [`no ${path.relative(process.cwd(), siteFile(slug))}`], warnings };
  const inventory = readInventoryFile(slug);
  if (site.cms && site.sections) errors.push('a plan is either "cms" (an item in the feature collection) or "sections" (a page of components), not both');
  if (site.cms) {
    validateCms(site, inventory, errors, warnings);
    checkFiles(slug, site, errors);
    if (site.publish?.itemId && !site.publish.updatedAt) errors.push('publish.updatedAt is required with publish.itemId: read the item with site-get --item and copy its updatedAt');
    return { errors, warnings };
  }
  const p = site.page ?? {};
  if (!p.title?.trim()) errors.push('page.title is required');
  if (!SLUG_RE.test(p.slug ?? '')) errors.push(`page.slug "${p.slug ?? ''}" must be lower-case words joined by hyphens`);
  if ((p.seo?.description ?? '').length > 160) warnings.push(`page.seo.description is ${p.seo.description.length} characters (search engines show about 160)`);
  if (!Array.isArray(site.sections) || !site.sections.length) errors.push('sections must list the page\'s components, top to bottom');

  const known = new Set((inventory?.components ?? []).map((c) => c.name));
  if (!inventory) warnings.push(`the site's components have not been read — run rollout.mjs site-find ${slug} so component names can be checked`);
  const created = new Set();
  (site.sections ?? []).forEach((s, i) => {
    const at = `sections[${i}]`;
    if (!s.component?.trim()) return errors.push(`${at}: component (its name in the site) is required`);
    if (s.create) {
      if (!s.create.description?.trim()) errors.push(`${at}: a new component needs create.description (what it is for, so it can be reused)`);
      if (inventory && known.has(s.component) && !created.has(s.component)) errors.push(`${at}: "${s.component}" already exists in the site — reuse it (drop "create") or choose another name`);
      if (s.create.basedOn && inventory && !known.has(s.create.basedOn)) errors.push(`${at}: create.basedOn "${s.create.basedOn}" is not a component in the site`);
      created.add(s.component);
    } else if (inventory && !known.has(s.component) && !created.has(s.component)) {
      errors.push(`${at}: no component "${s.component}" in the site — pick one from inventory.json or add "create"`);
    }
    // a prop is named "<name>", or "<group> / <name>" when several share a name
    for (const [prop, v] of Object.entries(s.props ?? {})) {
      if (!prop.split(' / ').every((x) => x.trim())) errors.push(`${at}.props["${prop}"]: a prop is "<name>" or "<group> / <name>"`);
      if (!isValue(v)) errors.push(`${at}.props["${prop}"]: ${VALUE_HELP}`);
    }
  });
  checkFiles(slug, site, errors);
  if (site.publish?.pageId && !site.publish.updatedAt) errors.push('publish.updatedAt is required with publish.pageId: read the page with site-get and copy its updatedAt');
  return { errors, warnings };
}

const TYPES = { '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

// Upload the plan's images to the site's assets. An image already uploaded
// unchanged (same content hash in the record) is reused. Returns
// { file: { id, url, hash, reused } }, also written to output/<slug>/site/assets.json.
export async function uploadSiteAssets({ slug, site, ws, log = console.log }) {
  const record = readSiteRecord(slug) ?? {};
  const kept = record.assets ?? {};
  const out = {};
  for (const file of siteAssets(site)) {
    const data = fs.readFileSync(assetPath(slug, file));
    const hash = crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
    if (kept[file]?.hash === hash) {
      out[file] = { ...kept[file], reused: true };
      log(`  reuse   ${file}`);
      continue;
    }
    if (data.length > 4 * 1024 * 1024) throw new Error(`${file} is ${(data.length / 1048576).toFixed(1)} MB — site images must be under 4 MB`);
    const a = await ws.uploadAsset({ name: path.basename(file), data, type: TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
    out[file] = { id: a.id, url: a.url, hash, reused: false };
    log(`  upload  ${file}  -> asset ${a.id}`);
  }
  // assets are recorded at once, page or no page yet, so a retry never uploads them twice
  writeJson(siteRecordFile(slug), { ...record, provider: ws.name, siteId: ws.siteId, assets: { ...kept, ...Object.fromEntries(Object.entries(out).map(([f, { reused, ...a }]) => [f, a])) } });
  writeJson(path.join(siteDir(slug), 'assets.json'), out);
  return out;
}

// After the agent built or updated the page: read it back and record where it
// lives, so the next run updates the same page and can tell when someone
// edited it in the site builder since.
export async function recordSitePage({ slug, site, ws, pageId }) {
  const p = await ws.page(pageId);
  const [s, live] = await Promise.all([ws.site(), ws.components()]);
  const record = readSiteRecord(slug) ?? {};
  // the plan's new components as they stand in the site: only those that exist count as created
  const ids = new Map(live.map((c) => [c.name, c.id]));
  const planned = [...new Set((site?.sections ?? []).filter((x) => x.create).map((x) => x.component))];
  const out = {
    $comment: 'Where the feature page lives: written by pipeline/website.mjs (rollout.mjs site-record) after the rollout-web-publisher agent builds or updates it. assets maps each image file (by content hash) to its copy in the site.',
    provider: ws.name,
    siteId: ws.siteId,
    pageId: p.id,
    title: p.title,
    path: p.path,
    url: s.domains[0] && p.path ? `https://${s.domains[0]}${p.path}` : null,
    draft: p.draft,
    updatedAt: p.updatedAt,
    plan: (site?.sections ?? []).map((x) => x.component),
    created: planned.filter((n) => ids.has(n)).map((name) => ({ name, id: ids.get(name) })),
    notCreated: planned.filter((n) => !ids.has(n)),
    assets: record.assets ?? {},
    action: record.pageId === p.id ? 'update' : 'create',
    recordedAt: new Date().toISOString(),
  };
  writeJson(siteRecordFile(slug), out);
  return out;
}

// The same for a CMS item: the feature page is the collection's template
// showing this item, at /<collection slug>/<item slug>.
export async function recordSiteItem({ slug, ws, collectionId, itemId }) {
  const [i, c, s] = await Promise.all([ws.item(collectionId, itemId), ws.collection(collectionId), ws.site()]);
  const record = readSiteRecord(slug) ?? {};
  const itemPath = `/${c.slug}/${i.slug}`;
  const out = {
    $comment: 'Where the feature page lives: written by pipeline/website.mjs (rollout.mjs site-record --item) after the rollout-web-publisher agent creates or updates the CMS item. assets maps each image file (by content hash) to its copy in the site.',
    provider: ws.name,
    siteId: ws.siteId,
    collectionId: c.id,
    itemId: i.id,
    title: i.name,
    path: itemPath,
    url: s.domains[0] ? `https://${s.domains[0]}${itemPath}` : null,
    draft: i.draft,
    updatedAt: i.updatedAt,
    publishedAt: i.publishedAt,
    assets: record.assets ?? {},
    action: record.itemId === i.id ? 'update' : 'create',
    recordedAt: new Date().toISOString(),
  };
  writeJson(siteRecordFile(slug), out);
  return out;
}
