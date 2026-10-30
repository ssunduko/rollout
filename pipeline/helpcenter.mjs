// The help center: find, read and publish help articles over its REST API.
//
// Which help center is a deployment fact: HELP_CENTER in .env, else the
// brand's help.provider. Each provider is an adapter in helpcenter/ with the
// same calls; nothing here knows one provider from another.
//
//   find(phrase, { state })   articles matching a phrase: [{ id, title, state, url, updatedAt }]
//   get(id)                   one article, with its HTML body
//   create(fields)            a new article
//   update(id, fields)        an existing article; fields left out are unchanged
//   me()                      the teammate the token belongs to
//   authors(), collections()  who can be credited, where articles can be filed
//
// The publish record (what was sent, where it lives now) is
// library/features/<slug>/help.published.json, written here after every
// create or update, so the next publish updates the same article.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env, readJson, writeJson } from './env.mjs';
import { helpDir, publishedFile } from './help.mjs';

const ADAPTERS = {
  intercom: () => import('./helpcenter/intercom.mjs'),
};

export async function helpCenter(brand) {
  const name = env('HELP_CENTER') ?? brand.help?.provider;
  if (!name) throw new Error('no help center configured — set HELP_CENTER in .env or help.provider in brand.json');
  if (!ADAPTERS[name]) throw new Error(`no help-center adapter "${name}" (${Object.keys(ADAPTERS).join(', ')})`);
  const token = env('HELP_CENTER_TOKEN');
  if (!token) throw new Error('HELP_CENTER_TOKEN is not set in .env');
  const adapter = await ADAPTERS[name]();
  return { name, ...adapter.connect({ token, baseUrl: env('HELP_CENTER_API_URL'), version: env('HELP_CENTER_API_VERSION') }) };
}

// Where a live article was read to, and so the newest change we know of: the
// agent's read (help.json publish.updatedAt) or our own last publish.
const knownUpdatedAt = (help, record) => Math.max(Number(help.publish.updatedAt ?? 0), Number(record?.updatedAt ?? 0)) || null;

// Send the built article (output/<slug>/help/). Refuses, with the reason, when
// sending would lose someone's work or publish what was not approved:
// - an update when the live article changed since it was last read;
// - any change to a live article without live: true (edits to a published
//   article go live at once, and sending "draft" would unpublish it);
// - placeholder images in anything that is or becomes published;
// - a create without an author.
export async function publishHelp({ slug, help, brand, state, live = false, log = console.log }) {
  const dir = helpDir(slug);
  const article = readJson(path.join(dir, 'article.json'));
  const body = fs.readFileSync(path.join(dir, 'article.html'), 'utf8');
  const record = help.live;
  const articleId = help.publish.articleId;
  const want = state ?? help.publish.state;
  const placeholders = article.images.some((i) => !i.src);
  const hc = await helpCenter(brand);
  const fields = { title: article.title, description: article.description, body };

  let result;
  if (articleId) {
    const current = await hc.get(articleId);
    const known = knownUpdatedAt(help, record);
    if (!known) throw new Error(`article ${articleId} was never read: run help-get ${slug} ${articleId} and record its updatedAt in help.json publish.updatedAt`);
    if (current.updatedAt > known) {
      throw new Error(`article ${articleId} was edited in the help center since it was read (${iso(current.updatedAt)} > ${iso(known)}) — read it again with help-get and merge before publishing`);
    }
    if (current.state === 'published') {
      if (want === 'draft') throw new Error(`article ${articleId} is published: sending it as a draft would unpublish it. Publish the update live (--state published --live) or leave it`);
      if (!live) throw new Error(`article ${articleId} is published: the update goes live at once — pass --live once that is approved`);
      if (placeholders) throw new Error('the article has placeholder images and would go live — set HELP_IMAGE_STORE (or HELP_IMAGE_BASE_URL) first');
      log(`  update ${articleId} (live)`);
      result = await hc.update(articleId, fields); // state left out: it stays published
    } else {
      if (want === 'published' && (placeholders || !live)) throw new Error(placeholders ? 'placeholder images cannot be published' : 'publishing makes it live — pass --live once that is approved');
      log(`  update ${articleId} (${want})`);
      result = await hc.update(articleId, { ...fields, state: want });
    }
  } else {
    const authorId = help.publish.authorId;
    if (!authorId) throw new Error('no author: set HELP_AUTHOR_ID in .env or publish.authorId in help.json (help-center lists them)');
    if (want === 'published' && (placeholders || !live)) throw new Error(placeholders ? 'placeholder images cannot be published' : 'publishing makes it live — pass --live once that is approved');
    log(`  create (${want})`);
    result = await hc.create({ ...fields, authorId, state: want, parentId: help.publish.parentId });
  }

  // read it back: the help center now serves its own copy of each image
  const after = await hc.get(result.id);
  const published = {
    $comment: 'Where the help article lives: written by pipeline/helpcenter.mjs after each publish. The next publish updates this article; images maps each image file (by content hash) to the help center\'s copy, so unchanged images are not sent again.',
    provider: hc.name,
    articleId: after.id,
    url: after.url,
    state: after.state,
    parentIds: after.parentIds,
    updatedAt: after.updatedAt,
    images: hostedCopies(article.images, body, after.body, log),
    action: articleId ? 'update' : 'create',
    bodyHash: crypto.createHash('sha256').update(body).digest('hex').slice(0, 12),
    publishedAt: new Date().toISOString(),
  };
  writeJson(publishedFile(slug), published);
  return published;
}

const iso = (s) => new Date(s * 1000).toISOString();

const imgSrcs = (html) => [...html.matchAll(/<img\b[^>]*?\bsrc="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

// { file: { hash, url } } for every scene image the help center now serves a
// copy of. The sent and returned bodies hold the same images in the same
// order, so the n-th src sent became the n-th src served. An image the help
// center has not copied (same URL back) is left out: it is sent again next time.
function hostedCopies(images, sentBody, liveBody, log) {
  const sent = imgSrcs(sentBody);
  const live = imgSrcs(liveBody);
  const out = {};
  if (sent.length !== live.length) {
    log(`  note    the article came back with ${live.length} images for ${sent.length} sent — image copies not recorded; they are sent again next time`);
    return out;
  }
  for (const img of images) {
    if (!img.src) continue;
    const url = live[sent.indexOf(img.src)];
    if (img.reused || (url && url !== img.src)) out[img.file] = { hash: img.hash, url: img.reused ? img.src : url };
    else log(`  note    ${img.file}: the help center still points at ${img.src} — not recorded as copied`);
  }
  return out;
}
