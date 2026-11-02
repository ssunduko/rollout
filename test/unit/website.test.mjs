import '../setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { putFixture, readFixture } from '../helpers.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { featurePaths, writeJson, readJson } from '../../pipeline/env.mjs';
import {
  website, featuresCollectionId, readInventory, loadSite, siteDefaults, siteAssets, validateSite,
  uploadSiteAssets, recordSitePage, recordSiteItem, siteFile, siteRecordFile, siteDir, readSiteRecord,
} from '../../pipeline/website.mjs';

const brand = loadBrand();
const SLUG = 'site-test';
const out = featurePaths(SLUG).output;
const quiet = () => {};
const useSite = (name) => putFixture(name, `library/features/${SLUG}/site.json`);
const writeSite = (obj) => writeJson(siteFile(SLUG), obj);
const inventory = (inv) => writeJson(path.join(siteDir(SLUG), 'inventory.json'), inv);

// the build's files the fixtures name
function buildFiles() {
  fs.mkdirSync(path.join(out, 'web', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(out, 'assets', 'social'), { recursive: true });
  fs.writeFileSync(path.join(out, 'web', 'assets', 'hero.png'), 'HERO');
  fs.writeFileSync(path.join(out, 'assets', 'social', 'feature-1280x720.png'), 'OG');
}

const KEYS = ['WEBSITE', 'WEBFLOW_API_TOKEN', 'WEBFLOW_SITE_ID', 'WEBFLOW_API_URL', 'WEBFLOW_FEATURES_COLLECTION_ID', 'WEBFLOW_PAGE_FOLDER_ID', 'WEBFLOW_COMPONENT_GROUP'];
beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  fs.rmSync(featurePaths(SLUG).library, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(featurePaths(SLUG).library, { recursive: true });
  buildFiles();
});

test('website: provider, token and site id from .env', async () => {
  await assert.rejects(website({ ...brand, web: {} }), /no website configured/);
  process.env.WEBSITE = 'wix';
  await assert.rejects(website(brand), /no website adapter "wix" \(webflow\)/);
  process.env.WEBSITE = 'webflow';
  await assert.rejects(website(brand), /WEBFLOW_API_TOKEN is not set/);
  process.env.WEBFLOW_API_TOKEN = 't';
  await assert.rejects(website(brand), /WEBFLOW_SITE_ID is not set/);
  const any = await website(brand, { anySite: true });
  assert.equal(any.name, 'webflow');
  process.env.WEBFLOW_SITE_ID = 's1';
  const ws = await website(brand);
  assert.equal(ws.siteId, 's1');
  for (const k of ['sites', 'site', 'pages', 'page', 'components', 'collection', 'items', 'item', 'uploadAsset']) assert.equal(typeof ws[k], 'function');
});

test('siteDefaults: the plan\'s folder, else .env; the component group', () => {
  assert.deepEqual(siteDefaults(null), { folderId: null, group: 'Rollout' });
  process.env.WEBFLOW_PAGE_FOLDER_ID = 'f-env';
  process.env.WEBFLOW_COMPONENT_GROUP = 'Launches';
  assert.deepEqual(siteDefaults({}), { folderId: 'f-env', group: 'Launches' });
  assert.equal(siteDefaults({ page: { folderId: 'f-plan' } }).folderId, 'f-plan');
});

test('siteAssets: asset props, cms fields and the og image, once each', () => {
  assert.deepEqual(siteAssets(readFixture('site-sections.json')).sort(), ['assets/social/feature-1280x720.png', 'hero.png']);
  assert.deepEqual(siteAssets(readFixture('site-cms.json')), ['hero.png']);
  assert.deepEqual(siteAssets({ sections: [{ props: { a: { asset: 'x.gif' }, b: { asset: 'x.gif' }, c: 'text' } }] }), ['x.gif']);
  assert.deepEqual(siteAssets({}), []);
});

test('loadSite / readSiteRecord: null when missing', () => {
  assert.equal(loadSite(SLUG), null);
  assert.equal(readSiteRecord(SLUG), null);
  writeSite({ page: {} });
  assert.deepEqual(loadSite(SLUG), { page: {} });
});

test('validateSite: no site.json', () => {
  assert.match(validateSite(SLUG).errors[0], /^no .*site\.json$/);
});

test('validateSite (sections): passes against the inventory; warns when it was not read', () => {
  useSite('site-sections.json');
  let r = validateSite(SLUG);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /components have not been read/.test(w)));
  inventory({ components: [{ name: 'Feature Hero' }, { name: 'Feature Row' }] });
  r = validateSite(SLUG);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('validateSite (sections): page, components, props and files', () => {
  inventory({ components: [{ name: 'Feature Hero' }, { name: 'Feature Row' }] });
  const base = readFixture('site-sections.json');
  const errs = (fn) => { const s = structuredClone(base); fn(s); writeSite(s); return validateSite(SLUG).errors.join('\n'); };
  assert.match(errs((s) => { s.page.title = ' '; }), /page\.title is required/);
  assert.match(errs((s) => { s.page.slug = 'Smart_Scheduling'; }), /page\.slug "Smart_Scheduling" must be lower-case/);
  assert.match(errs((s) => { s.sections = []; }), /sections must list the page's components/);
  assert.match(errs((s) => { s.sections[0].component = ''; }), /sections\[0\]: component .* is required/);
  assert.match(errs((s) => { s.sections[0].component = 'Nope'; }), /sections\[0\]: no component "Nope" in the site/);
  assert.match(errs((s) => { s.sections[2].create.description = ''; }), /needs create\.description/);
  assert.match(errs((s) => { s.sections[2].component = 'Feature Row'; }), /"Feature Row" already exists in the site — reuse it/);
  assert.match(errs((s) => { s.sections[2].create.basedOn = 'Ghost'; }), /create\.basedOn "Ghost" is not a component/);
  assert.match(errs((s) => { s.sections[0].props[' / x'] = 'v'; }), /a prop is "<name>" or "<group> \/ <name>"/);
  assert.match(errs((s) => { s.sections[0].props.Bad = { nope: 1 }; }), /props\["Bad"\]: a value is text/);
  assert.match(errs((s) => { s.sections[0].props.Image = { asset: 'missing.png' }; }), /asset missing\.png is not in output\/site-test\/web\/assets\//);
  assert.match(errs((s) => { s.publish = { pageId: 'p1' }; }), /publish\.updatedAt is required with publish\.pageId/);
  assert.match(errs((s) => { s.cms = {}; }), /either "cms" .* or "sections"/);
  const s = structuredClone(base);
  s.page.seo.description = 'x'.repeat(161);
  writeSite(s);
  assert.ok(validateSite(SLUG).warnings.some((w) => /page\.seo: the meta description is 161 characters/.test(w)));
});

test('validateSite (cms): checked against the collection when it was read', () => {
  useSite('site-cms.json');
  let r = validateSite(SLUG);
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /collection's fields have not been read/.test(w)));
  const collection = {
    id: 'col-features', name: 'Features',
    fields: ['name', 'slug', 'headline', 'hero-image', 'featured', 'video', 'summary'].map((slug) => ({ slug, name: slug, required: slug === 'summary' })),
    items: [{ id: 'i-other', slug: 'taken' }],
  };
  inventory({ collection });
  r = validateSite(SLUG);
  assert.deepEqual(r.errors, ['cms.fields["summary"] (summary) is required by Features']);
  collection.fields.find((f) => f.slug === 'summary').required = false;
  inventory({ collection });
  assert.deepEqual(validateSite(SLUG), { errors: [], warnings: [] });

  const base = readFixture('site-cms.json');
  const errs = (fn) => { const s = structuredClone(base); fn(s); writeSite(s); return validateSite(SLUG).errors.join('\n'); };
  assert.match(errs((s) => { delete s.cms.collectionId; }), /cms\.collectionId is required/);
  assert.match(errs((s) => { s.cms.fields.name = ''; }), /cms\.fields\.name .* is required/);
  assert.match(errs((s) => { s.cms.fields.slug = 'Bad Slug'; }), /cms\.fields\.slug "Bad Slug"/);
  assert.match(errs((s) => { s.cms.fields.list = [1]; }), /cms\.fields\["list"\]: a value is text/);
  assert.match(errs((s) => { s.cms.fields.colour = 'red'; }), /no field "colour" in Features/);
  assert.match(errs((s) => { s.cms.fields.slug = 'taken'; }), /an item with slug "taken" already exists \(i-other\)/);
  assert.doesNotMatch(errs((s) => { s.cms.fields.slug = 'taken'; s.publish = { itemId: 'i-other', updatedAt: 'u' }; }), /already exists/);
  assert.match(errs((s) => { s.publish = { itemId: 'i1' }; }), /publish\.updatedAt is required with publish\.itemId/);
  assert.match(errs((s) => { s.cms.fields['hero-image'] = { asset: 'gone.png' }; }), /asset gone\.png is not in/);
});

test('readInventory: pages, components and the feature collection, written for the agent', async () => {
  const ws = {
    name: 'webflow',
    site: async () => ({ id: 's1', name: 'Acme', domains: ['www.acme.example'] }),
    pages: async () => [{ id: 'p1' }],
    components: async () => [{ id: 'c1', name: 'Hero' }],
    collection: async (id) => ({ id, name: 'Features', fields: [] }),
    items: async () => [{ id: 'i1', slug: 's', fields: { big: 'x' } }],
  };
  let inv = await readInventory(SLUG, ws);
  assert.equal(inv.collection, null);
  process.env.WEBFLOW_FEATURES_COLLECTION_ID = 'col-features';
  assert.equal(featuresCollectionId(), 'col-features');
  inv = await readInventory(SLUG, ws);
  assert.deepEqual(inv.collection, { id: 'col-features', name: 'Features', fields: [], items: [{ id: 'i1', slug: 's' }] });
  const saved = readJson(path.join(siteDir(SLUG), 'inventory.json'));
  assert.equal(saved.provider, 'webflow');
  assert.deepEqual(saved.components, [{ id: 'c1', name: 'Hero' }]);
});

test('uploadSiteAssets: uploads once; an unchanged file is reused; the record keeps them', async () => {
  useSite('site-sections.json');
  const site = loadSite(SLUG);
  const uploads = [];
  const ws = { name: 'webflow', siteId: 's1', uploadAsset: async (f) => { uploads.push(f); return { id: `a${uploads.length}`, url: `https://cdn.acme.example/${f.name}` }; } };
  const first = await uploadSiteAssets({ slug: SLUG, site, ws, log: quiet });
  assert.equal(uploads.length, 2);
  assert.equal(uploads.find((u) => u.name === 'hero.png').type, 'image/png');
  assert.equal(String(uploads.find((u) => u.name === 'hero.png').data), 'HERO');
  assert.equal(first['hero.png'].reused, false);
  assert.match(first['hero.png'].hash, /^[0-9a-f]{12}$/);
  const rec = readSiteRecord(SLUG);
  assert.equal(rec.siteId, 's1');
  assert.ok(!('reused' in rec.assets['hero.png']));

  fs.writeFileSync(path.join(out, 'web', 'assets', 'hero.png'), 'HERO v2');
  const second = await uploadSiteAssets({ slug: SLUG, site, ws, log: quiet });
  assert.equal(uploads.length, 3, 'only the changed file is sent again');
  assert.equal(second['assets/social/feature-1280x720.png'].reused, true);
  assert.equal(second['hero.png'].reused, false);
  assert.deepEqual(readJson(path.join(siteDir(SLUG), 'assets.json')), second);
});

test('uploadSiteAssets: images over 4 MB are refused', async () => {
  fs.writeFileSync(path.join(out, 'web', 'assets', 'hero.png'), Buffer.alloc(4 * 1024 * 1024 + 1));
  const ws = { name: 'webflow', siteId: 's1', uploadAsset: async () => assert.fail('must not upload') };
  await assert.rejects(uploadSiteAssets({ slug: SLUG, site: readFixture('site-cms.json'), ws, log: quiet }), /hero\.png is 4\.0 MB — site images must be under 4 MB/);
});

test('recordSitePage: the page, its URL, which planned components exist', async () => {
  writeJson(siteRecordFile(SLUG), { assets: { 'hero.png': { id: 'a1' } } });
  const ws = {
    name: 'webflow', siteId: 's1',
    page: async (id) => ({ id, title: 'Smart Scheduling', path: '/features/smart-scheduling', draft: true, updatedAt: 'u1' }),
    site: async () => ({ domains: ['www.acme.example'] }),
    components: async () => [{ name: 'Feature Hero', id: 'c1' }],
  };
  const site = { sections: [{ component: 'Feature Hero' }, { component: 'Coming Soon Row', create: {} }, { component: 'Feature Hero', create: {} }] };
  const r = await recordSitePage({ slug: SLUG, site, ws, pageId: 'p9' });
  assert.equal(r.url, 'https://www.acme.example/features/smart-scheduling');
  assert.equal(r.action, 'create');
  assert.deepEqual(r.plan, ['Feature Hero', 'Coming Soon Row', 'Feature Hero']);
  assert.deepEqual(r.created, [{ name: 'Feature Hero', id: 'c1' }]);
  assert.deepEqual(r.notCreated, ['Coming Soon Row']);
  assert.deepEqual(r.assets, { 'hero.png': { id: 'a1' } });
  assert.equal((await recordSitePage({ slug: SLUG, site, ws, pageId: 'p9' })).action, 'update');
  const noDomain = await recordSitePage({ slug: SLUG, site: null, ws: { ...ws, site: async () => ({ domains: [] }) }, pageId: 'p9' });
  assert.equal(noDomain.url, null);
  assert.deepEqual(noDomain.plan, []);
});

test('recordSiteItem: the item at /<collection>/<item>', async () => {
  const ws = {
    name: 'webflow', siteId: 's1',
    item: async (c, id) => ({ id, name: 'Smart Scheduling', slug: 'smart-scheduling', draft: true, updatedAt: 'u', publishedAt: null }),
    collection: async (id) => ({ id, slug: 'features' }),
    site: async () => ({ domains: ['www.acme.example'] }),
  };
  const r = await recordSiteItem({ slug: SLUG, ws, collectionId: 'col', itemId: 'i1' });
  assert.equal(r.path, '/features/smart-scheduling');
  assert.equal(r.url, 'https://www.acme.example/features/smart-scheduling');
  assert.equal(r.collectionId, 'col');
  assert.equal(r.action, 'create');
  assert.equal((await recordSiteItem({ slug: SLUG, ws, collectionId: 'col', itemId: 'i1' })).action, 'update');
  assert.deepEqual(readSiteRecord(SLUG).itemId, 'i1');
});
