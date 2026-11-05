// The feature video's page on the website: library/features/<slug>/video.json
// -> an item of the site's video collection (WEBFLOW_VIDEOS_COLLECTION_ID),
// like the video pages the site already keeps: the video (on YouTube), a
// description and summary, the video's transcript, related videos, the cover
// image and the fields search engines read.
//
//   video-transcribe <slug>   the feature video as text (shared with the podcast) -> output/<slug>/video/transcript.html
//   video-site <slug>         the collection's fields and items -> output/<slug>/video/site-inventory.json, reference/
//   video-plan <slug>         video.json checked against the collection
//   video-site-assets --yes   site.fields images -> the site's assets
//   video-site-record <id>    the item the agent built, read back -> video.published.json
//
// The rollout-web-publisher agent writes video.json and creates or updates the
// item through the site builder's MCP server (docs/video.md).

import fs from 'node:fs';
import path from 'node:path';
import { env, escapeHtml as e, featurePaths, readJson, writeJson, SLUG_RE } from './env.mjs';
import { featureKeyword } from './brief.mjs';
import { checkCmsFields } from './seo.mjs';
import { readCollectionInventory, writeReferences, uploadFieldAssets, itemRecord } from './cmsitem.mjs';
import { transcribeVideo } from './podcast.mjs';

export const videoPageFile = (slug) => path.join(featurePaths(slug).library, 'video.json');
export const videoPageRecordFile = (slug) => path.join(featurePaths(slug).library, 'video.published.json');
export const videoPageDir = (slug) => path.join(featurePaths(slug).output, 'video');
export const videosCollectionId = () => env('WEBFLOW_VIDEOS_COLLECTION_ID') ?? null;
export const loadVideoPage = (slug) => (fs.existsSync(videoPageFile(slug)) ? readJson(videoPageFile(slug)) : null);
export const readVideoPageRecord = (slug) => (fs.existsSync(videoPageRecordFile(slug)) ? readJson(videoPageRecordFile(slug)) : null);
const readInventory = (slug) => {
  const f = path.join(videoPageDir(slug), 'site-inventory.json');
  return fs.existsSync(f) ? readJson(f) : null;
};

// One part of the record, kept beside the others.
function record(slug, part, value) {
  const prev = readVideoPageRecord(slug) ?? {};
  const next = {
    $comment: 'Where the feature video page lives: written by pipeline/videopage.mjs. video is the transcribed video, site the page and its uploaded images.',
    ...prev,
    [part]: value,
    updatedAt: new Date().toISOString(),
  };
  writeJson(videoPageRecordFile(slug), next);
  return next;
}

// A YouTube video's id from a watch, short, embed or Shorts link, else null.
export function youtubeId(ref) {
  const s = String(ref ?? '').trim();
  const m = s.match(/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})(?:[?&#/]|$)/);
  return m ? m[1] : null;
}
export const youtubeWatchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

// The sort order a new item takes: the site counts up (by 10, its help text
// says), newest last. Null when no item has one.
export function nextSortOrder(inv) {
  const f = inv?.fields?.find((x) => x.type === 'Number' && /sort/i.test(`${x.slug} ${x.name ?? ''}`));
  if (!f) return null;
  const values = (inv.items ?? []).map((i) => Number(i.fields?.[f.slug])).filter(Number.isFinite);
  return { field: f.slug, max: values.length ? Math.max(...values) : null, next: values.length ? Math.max(...values) + 10 : 10 };
}

const isImageValue = (v) => v && typeof v === 'object' && !Array.isArray(v) && ('asset' in v || 'url' in v || 'fileId' in v);

export function validateVideoPage(slug) {
  const v = loadVideoPage(slug);
  const errors = [];
  const warnings = [];
  if (!v) return { errors: [`no ${path.relative(process.cwd(), videoPageFile(slug))}`], warnings };
  const id = youtubeId(v.video?.url);
  if (!id) errors.push('video.url is the video\'s YouTube link (youtube.com/watch?v=…, youtu.be/…)');
  const f = v.site?.fields;
  if (!f || typeof f !== 'object') {
    errors.push('site.fields is required: the video page by the collection\'s field slugs (video-site lists them)');
    return { errors, warnings };
  }
  if (!String(f.name ?? '').trim()) errors.push('site.fields.name (the video page\'s title) is required');
  if (!SLUG_RE.test(f.slug ?? '')) errors.push(`site.fields.slug "${f.slug ?? ''}" must be lower-case words joined by hyphens`);
  for (const [k, val] of Object.entries(f)) {
    if (!isImageValue(val)) continue;
    if (typeof val.asset === 'string' && !fs.existsSync(path.join(featurePaths(slug).output, val.asset))) errors.push(`site.fields["${k}"].asset ${val.asset} is not in output/${slug}/ — build first`);
    if ('url' in val && !/^https:\/\//.test(String(val.url ?? ''))) errors.push(`site.fields["${k}"].url is an https link to an image`);
  }
  // what search and answer engines read of the page (pipeline/seo.mjs)
  warnings.push(...checkCmsFields(f, { keyword: featureKeyword(slug), where: 'site.fields' }));

  const inv = readInventory(slug);
  if (!inv) {
    warnings.push(`the video collection has not been read — run rollout.mjs video-site ${slug}`);
    return { errors, warnings };
  }
  const bySlug = new Map(inv.fields.map((x) => [x.slug, x]));
  for (const k of Object.keys(f)) if (!bySlug.has(k)) errors.push(`site.fields["${k}"]: no field "${k}" in ${inv.name} — fields: ${[...bySlug.keys()].join(', ')}`);
  for (const x of inv.fields) {
    if (x.required && (f[x.slug] == null || f[x.slug] === '')) errors.push(`site.fields["${x.slug}"] (${x.name ?? x.slug}) is required by ${inv.name}`);
  }
  // the page plays the video this sidecar names
  for (const x of inv.fields.filter((y) => y.type === 'VideoLink')) {
    const val = f[x.slug];
    const vid = youtubeId(typeof val === 'object' && val ? val.url : val);
    if (val != null && id && vid !== id) errors.push(`site.fields["${x.slug}"] plays ${vid ?? 'no YouTube video'}, not video.url's ${id}`);
  }
  const mine = readVideoPageRecord(slug)?.site?.itemId;
  const taken = inv.items.find((i) => i.slug === f.slug);
  if (taken && taken.id !== mine) errors.push(`a video page with slug "${f.slug}" already exists (${taken.id})`);
  const sort = nextSortOrder(inv);
  if (sort && !mine && sort.max != null && Number(f[sort.field]) <= sort.max) warnings.push(`site.fields["${sort.field}"] is ${f[sort.field]}; the newest video has ${sort.max} — a new one takes ${sort.next}`);
  return { errors, warnings };
}

// ---- 1. the video, as text ----

// The transcript as paragraphs of a few sentences, for the page's
// transcription field.
export function transcriptHtml(transcript, { sentences = 4 } = {}) {
  const all = (transcript?.utterances ?? []).map((u) => String(u.text ?? '').trim()).filter(Boolean).join(' ');
  const parts = all.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'])/).filter(Boolean);
  const paras = [];
  for (let i = 0; i < parts.length; i += sentences) paras.push(parts.slice(i, i + sentences).join(' '));
  return paras.map((p) => `<p>${e(p)}</p>`).join('');
}

// Transcribe the feature video (video.file, the same video source as the
// podcast; an unchanged video is not transcribed again) and write
// output/<slug>/video/transcript.html and .txt for the page.
export async function transcribeVideoPage({ slug, page, force = false, log = console.log }) {
  if (!page.video?.file) throw new Error('video.file (the video in the video source: a Drive link or file id) is needed to transcribe it');
  const t = await transcribeVideo({ slug, podcast: { video: { file: page.video.file, speakers: page.video.speakers } }, force, log });
  const dir = videoPageDir(slug);
  fs.mkdirSync(dir, { recursive: true });
  const html = transcriptHtml(t);
  fs.writeFileSync(path.join(dir, 'transcript.html'), html);
  fs.writeFileSync(path.join(dir, 'transcript.txt'), html.replace(/<\/p>/g, '\n\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() + '\n');
  record(slug, 'video', { ...t.video, seconds: t.seconds, transcribedAt: t.transcribedAt });
  return { transcript: t, html };
}

// ---- 2. the page on the website ----

// Read the video collection's fields and items into
// output/<slug>/video/site-inventory.json, and the newest published pages'
// summary and transcript as text into reference/, for the agent to write in
// the site's own style. Returns the inventory with the next sort order.
export async function readVideoCollection(slug, ws) {
  const cid = videosCollectionId();
  if (!cid) throw new Error('WEBFLOW_VIDEOS_COLLECTION_ID is not set in .env');
  const { inv, items } = await readCollectionInventory({
    ws, cid, file: path.join(videoPageDir(slug), 'site-inventory.json'),
    comment: 'The website\'s video collection, read by pipeline/videopage.mjs (rollout.mjs video-site). Never edit; read it again instead.',
  });
  const rich = inv.fields.filter((x) => x.type === 'RichText').map((x) => x.slug);
  writeReferences(path.join(videoPageDir(slug), 'reference'), items, { fields: rich.length ? rich : null });
  return { ...inv, sortOrder: nextSortOrder(inv) };
}

export async function uploadVideoPageAssets({ slug, page, ws, log = console.log }) {
  const rec = readVideoPageRecord(slug)?.site ?? {};
  const kept = rec.assets ?? {};
  const out = await uploadFieldAssets({ fields: page.site?.fields, outputDir: featurePaths(slug).output, kept, ws, log });
  record(slug, 'site', { ...rec, assets: { ...kept, ...out } });
  writeJson(path.join(videoPageDir(slug), 'site-assets.json'), out);
  return out;
}

// After the agent created or updated the video page: read it back and record it.
export async function recordVideoPageItem({ slug, ws, itemId }) {
  const cid = videosCollectionId();
  if (!cid) throw new Error('WEBFLOW_VIDEOS_COLLECTION_ID is not set in .env');
  return record(slug, 'site', await itemRecord({ ws, cid, itemId, prior: readVideoPageRecord(slug)?.site ?? {} })).site;
}
