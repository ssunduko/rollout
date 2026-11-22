// The schema command as a person or agent runs it, on the example brand:
// template head code, a static page's JSON-LD, and checking published pages
// (served here by a local server). Nothing here needs Chrome.

import '../setup.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { cliAsync, SANDBOX } from '../helpers.mjs';
import { freePort } from '../fakes.mjs';

const out = (...p) => path.join(SANDBOX, 'output', 'schema', 'example', ...p);
let server;
let base;
const PAGES = {
  '/good': '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Acme","url":"https://www.acme.example"}</script></head></html>',
  '/bad': '<html><head><script type="application/ld+json">{"@type":"VideoObject","name":"V"}</script><script type="application/ld+json">{nope</script></head></html>',
  '/none': '<html><head></head></html>',
  '/dangling': '<html><head><script type="application/ld+json">{"@type":"WebPage","name":"P","url":"https://www.acme.example/p","description":"d","publisher":{"@id":"#organization"}}</script></head></html>',
  '/twice': '<html><head><script type="application/ld+json">{"@type":"BreadcrumbList","@id":"#breadcrumb","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.acme.example/"}]}</script><script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.acme.example/"}]}</script></head></html>',
  '/linked': '<html><head><script type="application/ld+json">{"@type":"WebPage","name":"P","url":"https://www.acme.example/p","description":"d","publisher":{"@id":"/#organization"}}</script><script type="application/ld+json">{"@type":"Organization","@id":"/#organization","name":"Acme","url":"https://www.acme.example"}</script></head></html>',
};

before(async () => {
  const port = await freePort();
  server = http.createServer((req, res) => {
    const body = PAGES[req.url];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body ?? 'not found');
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  base = `http://127.0.0.1:${port}`;
});
after(() => server?.close());

test('schema templates: one head-code file per template, its fields listed', async () => {
  const r = await cliAsync(['schema', 'templates']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^blog {2}article {2}\/blog\/\{slug\} {2}-> /m);
  assert.match(r.out, /fields {3}slug \(PlainText\), title \(PlainText\)/);
  assert.match(r.out, /all templates OK/);
  const html = fs.readFileSync(out('templates', 'blog.html'), 'utf8');
  assert.match(html, /^<!-- blog: Blog post or guide \(BlogPosting \/ Article\)\. Paste into the blog template's Page settings/);
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.match(html, /\{\{wf \{&quot;path&quot;:&quot;title&quot;/);
  for (const t of ['videos', 'features', 'podcasts', 'webinars', 'stories', 'authors', 'playbooks', 'compare', 'partners']) {
    assert.ok(fs.existsSync(out('templates', `${t}.html`)), t);
  }
});

test('schema page: a configured static page\'s JSON-LD, with or without the leading slash', async () => {
  const r = await cliAsync(['schema', 'page', 'pricing']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\/pricing {2}WebPage, BreadcrumbList {2}-> /);
  const data = JSON.parse(fs.readFileSync(out('pages', 'pricing.json'), 'utf8'));
  assert.equal(data['@graph'][0].url, 'https://www.acme.example/pricing');
  const home = await cliAsync(['schema', 'page', '/']);
  assert.equal(home.code, 0, home.out);
  assert.ok(fs.existsSync(out('pages', 'home.json')));
  const none = await cliAsync(['schema', 'page', 'nowhere']);
  assert.notEqual(none.code, 0);
  assert.match(none.out, /no web\.schema\.pages\["\/nowhere"\] .* pages: \/, \/pricing/);
});

test('schema check: each published block against its type; a failing page fails the command', async () => {
  const good = await cliAsync(['schema', 'check', `${base}/good`]);
  assert.equal(good.code, 0, good.out);
  assert.match(good.out, /json-ld {2}WebSite {2}ok/);

  const bad = await cliAsync(['schema', 'check', `${base}/bad`, `${base}/none`, `${base}/missing`]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /fail {3}VideoObject: missing thumbnailUrl \(required\)/);
  assert.match(bad.out, /fail {5}JSON-LD does not parse/);
  assert.match(bad.out, /warn {5}no structured data \(JSON-LD\)/);
  assert.match(bad.out, /\[HTTP 404\]/);
  assert.match(bad.out, /\d+ failing/);
});

test('schema check: a reference nothing on the page defines fails; one defined in another block passes', async () => {
  const dangling = await cliAsync(['schema', 'check', `${base}/dangling`]);
  assert.notEqual(dangling.code, 0);
  assert.match(dangling.out, /fail {5}WebPage: publisher refers to "#organization", which nothing on the page defines/);
  const linked = await cliAsync(['schema', 'check', `${base}/linked`]);
  assert.equal(linked.code, 0, linked.out);
  assert.match(linked.out, /refs {5}ok/);
});

test('schema with no or an unknown subcommand says what it takes', async () => {
  assert.match((await cliAsync(['schema'])).out, /schema: templates \| preview <template> <slug> \| page <path> \| check <url>/);
  assert.match((await cliAsync(['schema', 'check'])).out, /give one or more page URLs/);
});

// A fake site builder: one blog collection whose items reference an author.
async function fakeWebflow() {
  const port = await freePort();
  const routes = {
    '/collections/COL': { id: 'COL', displayName: 'Blog', slug: 'blog', fields: [
      { slug: 'title', displayName: 'Title', type: 'PlainText' },
      { slug: 'meta-description', displayName: 'Meta', type: 'PlainText' },
      { slug: 'main-image', displayName: 'Image', type: 'Image' },
      { slug: 'date', displayName: 'Date', type: 'DateTime' },
      { slug: 'author', displayName: 'Author', type: 'Reference', validations: { collectionId: 'AUTH' } },
    ] },
    '/collections/COL/items': { items: [{ id: 'i1', lastPublished: '2026-11-02T00:00:00.000Z', lastUpdated: '2026-11-03T00:00:00.000Z', fieldData: {
      name: 'Hello', slug: 'hello', title: 'Hello "world"', 'meta-description': 'D', 'main-image': { url: 'https://cdn.example/i.png' },
      date: '2026-11-01T00:00:00.000Z', author: 'a1',
    } }], pagination: { total: 1 } },
    '/collections/AUTH/items/a1': { id: 'a1', fieldData: { name: 'Ann Lee', slug: 'ann-lee' } },
  };
  const srv = http.createServer((req, res) => {
    const body = routes[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { message: 'not found' }));
  });
  await new Promise((r) => srv.listen(port, '127.0.0.1', r));
  return { srv, env: { WEBSITE: 'webflow', WEBFLOW_API_TOKEN: 't', WEBFLOW_SITE_ID: 's', WEBFLOW_API_URL: `http://127.0.0.1:${port}` } };
}

// the example brand with the blog template pointed at the fake collection
function brandCopy() {
  const dir = path.join(SANDBOX, 'brand-schema');
  fs.cpSync(path.join(import.meta.dirname, '..', '..', 'brand', 'example'), dir, { recursive: true });
  const file = path.join(dir, 'brand.json');
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b.web.schema.templates = { blog: { ...b.web.schema.templates.blog, collectionId: 'COL' } };
  fs.writeFileSync(file, JSON.stringify(b));
  return dir;
}

test('schema templates --check: a field the collection lacks is an error', async () => {
  const { srv, env } = await fakeWebflow();
  try {
    const r = await cliAsync(['schema', 'templates', '--check', '--brand', brandCopy()], { env });
    assert.match(r.out, /error {4}the collection has no field "category"/);
    assert.match(r.out, /1 to fix/);
    assert.doesNotMatch(r.out, /no field "(title|author|date|main-image|meta-description|slug)"/);
  } finally {
    srv.close();
  }
});

test('schema preview: one live item in its template — references resolved, risky values and empty fields named', async () => {
  const { srv, env } = await fakeWebflow();
  try {
    const r = await cliAsync(['schema', 'preview', 'blog', 'hello', '--brand', brandCopy()], { env });
    assert.equal(r.code, 0, r.out);
    const data = JSON.parse(r.stdout.slice(0, r.stdout.lastIndexOf('}') + 1));
    const post = data['@graph'].find((n) => n['@type'] === 'BlogPosting');
    assert.equal(post.headline, 'Hello "world"');
    assert.equal(post.url, 'https://www.acme.example/blog/hello');
    assert.deepEqual(post.author, { '@type': 'Person', name: 'Ann Lee', url: 'https://www.acme.example/author/ann-lee' });
    assert.equal(post.image, 'https://cdn.example/i.png');
    assert.match(r.out, /warn {5}title holds a quote, backslash or line break/);
    assert.match(r.out, /warn {5}category:name is empty on this item/);
    const missing = await cliAsync(['schema', 'preview', 'blog', 'nope', '--brand', brandCopy()], { env });
    assert.match(missing.out, /no item with slug "nope"/);
  } finally {
    srv.close();
  }
});

// the example brand with one template and one page owned by another tool
function ownedBrand() {
  const dir = path.join(SANDBOX, 'brand-owned');
  fs.cpSync(path.join(import.meta.dirname, '..', '..', 'brand', 'example'), dir, { recursive: true });
  const file = path.join(dir, 'brand.json');
  const b = JSON.parse(fs.readFileSync(file, 'utf8'));
  b.web.schema.templates.blog.owner = 'site-schema-tool';
  b.web.schema.pages['/pricing'].owner = 'site-schema-tool';
  fs.writeFileSync(file, JSON.stringify(b));
  return dir;
}

test('owner: a template or page another tool owns gets no code, and its old file is removed', async () => {
  assert.equal((await cliAsync(['schema', 'templates'])).code, 0);
  assert.equal((await cliAsync(['schema', 'page', 'pricing'])).code, 0);
  assert.ok(fs.existsSync(out('templates', 'blog.html')));
  const brand = ownedBrand();
  const r = await cliAsync(['schema', 'templates', '--brand', brand]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^blog {2}owned by site-schema-tool: not generated \(removed the old .*blog\.html\)/m);
  assert.match(r.out, /^videos {2}video /m);
  assert.ok(!fs.existsSync(out('templates', 'blog.html')));
  assert.ok(fs.existsSync(out('templates', 'videos.html')));
  const again = await cliAsync(['schema', 'templates', '--brand', brand]);
  assert.match(again.out, /^blog {2}owned by site-schema-tool: not generated$/m);
  const preview = await cliAsync(['schema', 'preview', 'blog', 'any', '--brand', brand]);
  assert.notEqual(preview.code, 0);
  assert.match(preview.out, /blog is owned by site-schema-tool: Rollout generates no code for it/);
  const page = await cliAsync(['schema', 'page', 'pricing', '--brand', brand]);
  assert.notEqual(page.code, 0);
  assert.match(page.out, /\/pricing is owned by site-schema-tool/);
  assert.ok(!fs.existsSync(out('pages', 'pricing.json')));
});

test('schema check: the same kind of node twice on a page is a warning naming the owner setting', async () => {
  const r = await cliAsync(['schema', 'check', `${base}/twice`]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /warn {5}BreadcrumbList: 2 BreadcrumbList nodes on one page — two tools may both write its structured data/);
});
