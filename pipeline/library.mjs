// The asset library: everything the agents author, kept for reuse.
//
//   library/features/<slug>/brief.json   the copy for one feature (copywriter agent)
//   library/scenes/<id>/scene.json       a visual's sidecar: size, animation, tags
//   library/scenes/<id>/scene.html       a kit scene's markup (capture scenes have none:
//                                        their scene.json holds steps against the real app)
//   library/renders/<hash>/still.png     a scene rendered in one brand (PDF, web hero)
//   library/renders/<hash>/anim.gif      the same scene animated (web page)
//   library/index.json                   derived: what exists, searchable
//
// Renders are content-addressed: the hash covers the scene, its local files,
// the brand's look and the kit, so an unchanged scene is never rendered twice
// and a new brand gets its own renders beside the old ones. index.json is
// rebuilt from the folders on every write, so it cannot drift from them.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LIBRARY_DIR, KIT_DIR, readJson, writeJson } from './env.mjs';

export const SCENES_DIR = path.join(LIBRARY_DIR, 'scenes');
export const RENDERS_DIR = path.join(LIBRARY_DIR, 'renders');
export const FEATURES_DIR = path.join(LIBRARY_DIR, 'features');
export const INDEX_FILE = path.join(LIBRARY_DIR, 'index.json');

export const SCENE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:--[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

// Fields that describe a scene without changing how it looks: editing them
// must not invalidate its renders.
const META_FIELDS = new Set(['title', 'description', 'tags', 'feature', 'notes', 'forkedFrom']);

export const sceneDir = (id) => path.join(SCENES_DIR, id);
export const sceneFile = (id) => path.join(sceneDir(id), 'scene.json');

export function loadScene(id) {
  if (!SCENE_ID_RE.test(id)) throw new Error(`"${id}" is not a scene id (<feature>--<name>, lowercase and dashes)`);
  const file = sceneFile(id);
  if (!fs.existsSync(file)) throw new Error(`no scene ${id} (expected ${file})`);
  const spec = readJson(file);
  // a capture scene is steps against the real app: no markup of its own
  if (spec.source === 'capture') return { ...spec, id, dir: sceneDir(id), htmlFile: null, markup: '' };
  const htmlFile = path.join(sceneDir(id), spec.html ?? 'scene.html');
  if (!fs.existsSync(htmlFile)) throw new Error(`scene ${id}: ${path.relative(LIBRARY_DIR, htmlFile)} is missing`);
  return { ...spec, id, dir: sceneDir(id), htmlFile, markup: fs.readFileSync(htmlFile, 'utf8') };
}

// Local files a scene references (src="photo.png", url(bg.svg)): inlined at
// render time, and part of the hash.
export function localRefs(scene) {
  const refs = new Set();
  const re = /(?:src|href)=["']([^"':]+?)["']|url\(["']?([^"')]+?)["']?\)/g;
  for (const m of (scene.markup + (scene.css ?? '')).matchAll(re)) {
    const ref = m[1] ?? m[2];
    if (ref && !/^(data:|https?:|#|brand:)/.test(ref)) refs.add(ref);
  }
  return [...refs];
}

let kitHash;
const hashKit = () =>
  (kitHash ??= crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(KIT_DIR, 'kit.css')))
    .update(fs.readFileSync(path.join(KIT_DIR, 'runtime.js')))
    .digest('hex'));

export function renderHash(scene, brand, settings) {
  const h = crypto.createHash('sha256');
  const look = Object.fromEntries(Object.entries(scene).filter(([k]) => !META_FIELDS.has(k) && !['dir', 'htmlFile', 'id'].includes(k)));
  h.update(JSON.stringify(look));
  for (const ref of localRefs(scene).sort()) {
    const file = path.join(scene.dir, ref);
    h.update(ref).update(fs.existsSync(file) ? fs.readFileSync(file) : 'missing');
  }
  h.update(brand.hash).update(hashKit()).update(JSON.stringify(settings));
  return h.digest('hex').slice(0, 16);
}

export const renderDir = (hash) => path.join(RENDERS_DIR, hash);

// ---- index ----

export function rebuildIndex() {
  const scenes = {};
  if (fs.existsSync(SCENES_DIR)) {
    for (const id of fs.readdirSync(SCENES_DIR).sort()) {
      const file = sceneFile(id);
      if (!fs.existsSync(file)) continue;
      const s = readJson(file);
      scenes[id] = {
        title: s.title ?? id,
        description: s.description ?? '',
        tags: s.tags ?? [],
        feature: s.feature ?? id.split('--')[0],
        size: s.size,
        kind: s.source === 'capture' ? 'capture' : 'kit',
        target: s.target ?? null,
        animated: s.source === 'capture' || Boolean(s.animation?.duration),
        renders: {},
      };
    }
  }
  if (fs.existsSync(RENDERS_DIR)) {
    for (const hash of fs.readdirSync(RENDERS_DIR).sort()) {
      const meta = path.join(renderDir(hash), 'render.json');
      if (!fs.existsSync(meta)) continue;
      const r = readJson(meta);
      if (!scenes[r.scene]) continue;
      // newest render per brand wins
      // kit renders are per brand; captures are per target (the app paints itself)
      const key = r.kind === 'capture' ? `capture:${r.target}` : r.brand;
      const prev = scenes[r.scene].renders[key];
      if (!prev || prev.renderedAt < r.renderedAt) {
        scenes[r.scene].renders[key] = { hash, renderedAt: r.renderedAt, still: `renders/${hash}/still.png`, gif: r.gif ? `renders/${hash}/anim.gif` : null };
      }
    }
  }
  const features = {};
  if (fs.existsSync(FEATURES_DIR)) {
    for (const slug of fs.readdirSync(FEATURES_DIR).sort()) {
      const brief = path.join(FEATURES_DIR, slug, 'brief.json');
      if (!fs.existsSync(brief)) continue;
      const b = readJson(brief);
      const used = [b.hero?.scene, ...(b.sections ?? []).map((s) => s.scene)].filter(Boolean);
      features[slug] = { feature: b.feature ?? slug, headline: b.headline ?? '', scenes: used };
    }
  }
  // which features use each scene: the reuse record
  for (const [slug, f] of Object.entries(features)) for (const id of f.scenes) scenes[id] && (scenes[id].usedBy ??= []).push(slug);

  const index = { $comment: 'Derived from library/ by pipeline/library.mjs — do not edit; it is rebuilt on every render and build.', scenes, features };
  writeJson(INDEX_FILE, index);
  return index;
}

export const readIndex = () => (fs.existsSync(INDEX_FILE) ? readJson(INDEX_FILE) : rebuildIndex());

// Plain word search over id, title, tags and description. Good enough for an
// agent deciding whether a visual it needs already exists.
export function searchScenes(query) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const { scenes } = rebuildIndex();
  return Object.entries(scenes)
    .map(([id, s]) => {
      const hay = `${id} ${s.title} ${s.tags.join(' ')} ${s.description}`.toLowerCase();
      const score = words.reduce((n, w) => n + (hay.includes(w) ? (s.tags.includes(w) ? 2 : 1) : 0), 0);
      return { id, score, ...s };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Copy a scene under a new id (to adapt it for another feature without
// touching the original's renders).
export function forkScene(fromId, toId, feature) {
  if (!SCENE_ID_RE.test(toId)) throw new Error(`"${toId}" is not a scene id`);
  if (fs.existsSync(sceneDir(toId))) throw new Error(`scene ${toId} already exists`);
  fs.cpSync(sceneDir(fromId), sceneDir(toId), { recursive: true });
  const spec = readJson(sceneFile(toId));
  writeJson(sceneFile(toId), { ...spec, feature: feature ?? toId.split('--')[0], forkedFrom: fromId });
  rebuildIndex();
}
