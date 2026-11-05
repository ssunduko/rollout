// A website page kept as an item of a CMS collection (the podcast episode
// page, the feature video page): the parts every such page shares.
//
//   readCollectionInventory   the collection's fields and items, written for the agent
//   writeReferences           the newest published items' longest text, for the agent to match their style
//   uploadFieldAssets         the fields' { "asset": "<path in output/<slug>/>" } images to the site's assets
//   itemRecord                the built item read back, as recorded in <x>.published.json
//
// The item itself is created or updated by an agent through the site
// builder's MCP server; the pipeline reads, uploads and records.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeJson } from './env.mjs';

const sha = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 12);
const cut = (v) => (typeof v === 'string' && v.length > 400 ? `${v.slice(0, 400)}… [${v.length} characters]` : v);

// The collection's fields and items, newest first, long text values cut so
// the agent sees how items are filled without whole transcripts.
export async function readCollectionInventory({ ws, cid, file, comment }) {
  const [c, items] = await Promise.all([ws.collection(cid), ws.items(cid)]);
  const inv = {
    $comment: comment,
    ...c,
    items: items
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((i) => ({ ...i, fields: Object.fromEntries(Object.entries(i.fields).map(([k, v]) => [k, cut(v)])) })),
    readAt: new Date().toISOString(),
  };
  writeJson(file, inv);
  return { inv, items };
}

const text = (html) => html.replace(/<\/p>\s*/g, '\n\n').replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, x) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' })[x]).trim();

// The newest published items as plain text in dir/<item slug>.txt: each
// item's longest rich-text field (its transcript), or with fields, those
// rich-text fields in that order under their slugs.
export function writeReferences(dir, items, { count = 3, fields = null } = {}) {
  fs.rmSync(dir, { recursive: true, force: true });
  const published = items.filter((i) => !i.draft && i.publishedAt).sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
  for (const i of published.slice(0, count)) {
    let body;
    if (fields) {
      body = fields.filter((k) => typeof i.fields[k] === 'string' && i.fields[k].trim()).map((k) => `[${k}]\n${text(i.fields[k])}`).join('\n\n');
    } else {
      const longest = Object.values(i.fields).filter((v) => typeof v === 'string' && v.includes('<p')).sort((a, b) => b.length - a.length)[0];
      body = longest ? text(longest) : '';
    }
    if (!body) continue;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${i.slug}.txt`), `${i.name}\n\n${body}\n`);
  }
}

// Upload the fields' { "asset": "<path in outputDir>" } images; ones already
// uploaded (kept, by content hash) are reused. { file: { id, url, hash } }.
export async function uploadFieldAssets({ fields, outputDir, kept = {}, ws, log = console.log }) {
  const out = {};
  for (const v of Object.values(fields ?? {})) {
    if (!v || typeof v !== 'object' || typeof v.asset !== 'string') continue;
    if (out[v.asset]) continue; // one file named in two fields is uploaded once
    const data = fs.readFileSync(path.join(outputDir, v.asset));
    const hash = sha(data);
    if (kept[v.asset]?.hash === hash) {
      out[v.asset] = kept[v.asset];
      log(`  reuse   ${v.asset}`);
      continue;
    }
    const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[path.extname(v.asset).toLowerCase()] ?? 'application/octet-stream';
    const a = await ws.uploadAsset({ name: path.basename(v.asset), data, type });
    out[v.asset] = { id: a.id, url: a.url, hash };
    log(`  upload  ${v.asset}  -> asset ${a.id}`);
  }
  return out;
}

// The item the agent built, read back: where it lives and its state.
export async function itemRecord({ ws, cid, itemId, prior = {} }) {
  const [i, c, s] = await Promise.all([ws.item(cid, itemId), ws.collection(cid), ws.site()]);
  const itemPath = `/${c.slug}/${i.slug}`;
  return {
    provider: ws.name, siteId: ws.siteId, collectionId: c.id, itemId: i.id, title: i.name, path: itemPath,
    url: s.domains[0] ? `https://${s.domains[0]}${itemPath}` : null,
    draft: i.draft, updatedAt: i.updatedAt, publishedAt: i.publishedAt,
    assets: prior.assets ?? {}, action: prior.itemId === i.id ? 'update' : 'create', recordedAt: new Date().toISOString(),
  };
}
