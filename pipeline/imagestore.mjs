// The image store: where help-article images are uploaded while the article is
// sent, so the help center can fetch them and keep its own copy.
//
// Which store is a deployment fact: HELP_IMAGE_STORE in .env. Each store is an
// adapter in imagestore/ with the same calls; nothing here knows one from
// another.
//
//   exists(key)              whether the object is already there
//   put(key, data, type)     upload one object
//   url(key, ttl)            a URL the help center can fetch it from for ttl seconds
//   describe()               where it is, for the log
//
// Object keys carry the file's content hash (<prefix>/<slug>/<scene>.<hash>.png),
// so an object never changes once written: an unchanged image is not uploaded
// twice, and no cache can serve an old picture under a new article.

import fs from 'node:fs';
import path from 'node:path';
import { env, envNumber } from './env.mjs';

const ADAPTERS = {
  s3: () => import('./imagestore/s3.mjs'),
};

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

export const imageStoreName = () => env('HELP_IMAGE_STORE') ?? null;

export async function imageStore() {
  const name = imageStoreName();
  if (!name) return null;
  if (!ADAPTERS[name]) throw new Error(`no image-store adapter "${name}" (${Object.keys(ADAPTERS).join(', ')})`);
  const adapter = await ADAPTERS[name]();
  return { name, ...adapter.connect({ bucket: env('HELP_IMAGE_BUCKET'), region: env('HELP_IMAGE_REGION'), endpoint: env('HELP_IMAGE_ENDPOINT') }) };
}

// Upload each image the article still needs hosted (article.json images with
// upload: true) from dir/images/. Returns { file: url } for the build to link.
// With HELP_IMAGE_BASE_URL the objects are public at <base>/<slug>/<object>;
// without it each URL is presigned for HELP_IMAGE_URL_TTL seconds.
export async function uploadImages({ slug, images, dir, log = console.log }) {
  const pending = images.filter((i) => i.upload);
  if (!pending.length) return {};
  const store = await imageStore();
  const prefix = (env('HELP_IMAGE_PREFIX') ?? 'help').replace(/^\/+|\/+$/g, '');
  const base = env('HELP_IMAGE_BASE_URL')?.replace(/\/$/, '');
  const ttl = envNumber('HELP_IMAGE_URL_TTL', 86400);
  log(`  images  ${pending.length} to ${store.describe()}${base ? '' : `, linked by URLs valid ${Math.round(ttl / 3600)}h`}`);
  const out = {};
  for (const img of pending) {
    const ext = path.extname(img.file);
    const object = `${slug}/${path.basename(img.file, ext)}.${img.hash}${ext}`;
    const key = prefix ? `${prefix}/${object}` : object;
    if (await store.exists(key)) log(`  have    ${key}`);
    else {
      await store.put(key, fs.readFileSync(path.join(dir, 'images', img.file)), TYPES[ext.toLowerCase()] ?? 'application/octet-stream');
      log(`  upload  ${key}`);
    }
    out[img.file] = base ? `${base}/${object}` : store.url(key, ttl);
  }
  return out;
}
