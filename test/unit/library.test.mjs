import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SANDBOX } from '../helpers.mjs';
import {
  SCENES_DIR, RENDERS_DIR, INDEX_FILE, SCENE_ID_RE, sceneDir, sceneFile, loadScene, localRefs, renderHash, renderDir,
  rebuildIndex, readIndex, searchScenes, forkScene,
} from '../../pipeline/library.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { readJson, writeJson } from '../../pipeline/env.mjs';

const brand = loadBrand();
const settings = { stillScale: 2 };

// a kit scene of its own in the sandbox library
function kitScene(id, spec = {}, html = '<div>hi</div>', files = {}) {
  writeJson(sceneFile(id), { title: id, size: { width: 100, height: 80 }, ...spec });
  fs.writeFileSync(path.join(sceneDir(id), spec.html ?? 'scene.html'), html);
  for (const [f, content] of Object.entries(files)) fs.writeFileSync(path.join(sceneDir(id), f), content);
  return loadScene(id);
}

test('the library lives in the sandbox', () => {
  assert.equal(SCENES_DIR, path.join(SANDBOX, 'library', 'scenes'));
  assert.equal(RENDERS_DIR, path.join(SANDBOX, 'library', 'renders'));
  assert.equal(renderDir('abc'), path.join(RENDERS_DIR, 'abc'));
});

test('SCENE_ID_RE: <feature>--<name>, or a plain name', () => {
  for (const ok of ['smart-scheduling--hero', 'a--b', 'plain', 'a-1--b-2']) assert.ok(SCENE_ID_RE.test(ok), ok);
  for (const bad of ['A--b', 'a---b', 'a--b--c', '--b', 'a--', 'a b', '../x']) assert.ok(!SCENE_ID_RE.test(bad), bad);
});

test('loadScene: a kit scene with its markup, a capture scene without', () => {
  const hero = loadScene('smart-scheduling--hero');
  assert.equal(hero.id, 'smart-scheduling--hero');
  assert.equal(hero.htmlFile, path.join(sceneDir(hero.id), 'scene.html'));
  assert.ok(hero.markup.length > 0);
  const cap = loadScene('smart-scheduling--calendars');
  assert.equal(cap.source, 'capture');
  assert.equal(cap.htmlFile, null);
  assert.equal(cap.markup, '');
});

test('loadScene errors: bad id, missing scene, missing html', () => {
  assert.throws(() => loadScene('Bad Id'), /not a scene id/);
  assert.throws(() => loadScene('lib-test--absent'), /no scene lib-test--absent/);
  writeJson(sceneFile('lib-test--nohtml'), { size: { width: 1, height: 1 } });
  assert.throws(() => loadScene('lib-test--nohtml'), /scene\.html is missing/);
});

test('loadScene honours a custom html file name', () => {
  const s = kitScene('lib-test--custom', { html: 'other.html' }, '<p>custom</p>');
  assert.equal(s.markup, '<p>custom</p>');
});

test('localRefs: local files only, from markup and css', () => {
  const refs = localRefs({
    markup: '<img src="a.png"><img src="data:image/png;base64,x"><img src="https://x/y.png"><a href="#top"></a><img src="brand:logo"><img src="scene:x--y">',
    css: '.a{background:url(bg.svg)} .b{background:url("q.jpg")} .c{background:url(https://x/z.png)}',
  });
  assert.deepEqual(refs.sort(), ['a.png', 'bg.svg', 'q.jpg']);
});

test('renderHash: stable; changes with the look, a local file or the brand, not with meta fields', () => {
  const s = kitScene('lib-test--hash', { tags: ['a'] }, '<img src="pic.png">', { 'pic.png': 'one' });
  const h = renderHash(s, brand, settings);
  assert.match(h, /^[0-9a-f]{16}$/);
  assert.equal(renderHash(loadScene(s.id), brand, settings), h);
  assert.equal(renderHash({ ...s, title: 'new', description: 'd', tags: ['b'], notes: 'n' }, brand, settings), h);
  assert.notEqual(renderHash({ ...s, size: { width: 101, height: 80 } }, brand, settings), h);
  assert.notEqual(renderHash(s, { ...brand, hash: 'other' }, settings), h);
  assert.notEqual(renderHash(s, brand, { stillScale: 3 }), h);
  fs.writeFileSync(path.join(s.dir, 'pic.png'), 'two');
  assert.notEqual(renderHash(s, brand, settings), h);
});

test('rebuildIndex: scenes, kinds, features and who uses what', () => {
  const index = rebuildIndex();
  assert.ok(fs.existsSync(INDEX_FILE));
  assert.equal(index.scenes['smart-scheduling--hero'].kind, 'kit');
  assert.equal(index.scenes['smart-scheduling--calendars'].kind, 'capture');
  assert.equal(index.scenes['smart-scheduling--calendars'].animated, true);
  assert.deepEqual(index.scenes['smart-scheduling--hero'].usedBy, ['smart-scheduling']);
  assert.equal(index.features['smart-scheduling'].feature, 'Smart Scheduling');
  assert.equal(index.features['smart-scheduling'].scenes.length, 6);
  assert.deepEqual(readIndex(), readJson(INDEX_FILE));
});

test('rebuildIndex keeps the newest render per brand and per capture target', () => {
  const put = (hash, meta) => writeJson(path.join(renderDir(hash), 'render.json'), meta);
  put('h-old', { scene: 'smart-scheduling--hero', brand: 'example', renderedAt: '2026-01-01T00:00:00Z' });
  put('h-new', { scene: 'smart-scheduling--hero', brand: 'example', renderedAt: '2026-02-01T00:00:00Z', gif: true });
  put('h-other', { scene: 'smart-scheduling--hero', brand: 'other', renderedAt: '2026-01-15T00:00:00Z' });
  put('c-1', { scene: 'smart-scheduling--calendars', kind: 'capture', target: 'demo-app', renderedAt: '2026-01-01T00:00:00Z' });
  put('orphan', { scene: 'not-a-scene', brand: 'example', renderedAt: '2026-01-01T00:00:00Z' });
  const { scenes } = rebuildIndex();
  assert.deepEqual(Object.keys(scenes['smart-scheduling--hero'].renders).sort(), ['example', 'other']);
  assert.equal(scenes['smart-scheduling--hero'].renders.example.hash, 'h-new');
  assert.equal(scenes['smart-scheduling--hero'].renders.example.gif, 'renders/h-new/anim.gif');
  assert.equal(scenes['smart-scheduling--calendars'].renders['capture:demo-app'].hash, 'c-1');
  fs.rmSync(RENDERS_DIR, { recursive: true, force: true });
});

test('searchScenes ranks by words, tags counting double', () => {
  const hits = searchScenes('calendar round-robin');
  assert.equal(hits[0].id, 'smart-scheduling--calendars');
  assert.ok(hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score));
  assert.deepEqual(searchScenes('zzzz-nothing-matches'), []);
});

test('forkScene copies under a new id and records where it came from', () => {
  forkScene('smart-scheduling--hero', 'other-feature--hero');
  const forked = readJson(sceneFile('other-feature--hero'));
  assert.equal(forked.forkedFrom, 'smart-scheduling--hero');
  assert.equal(forked.feature, 'other-feature');
  assert.ok(fs.existsSync(path.join(sceneDir('other-feature--hero'), 'scene.html')));
  assert.equal(readJson(sceneFile('smart-scheduling--hero')).forkedFrom, undefined); // original untouched
  assert.ok(readIndex().scenes['other-feature--hero']);
  forkScene('smart-scheduling--hero', 'other-feature--hero-two', 'named');
  assert.equal(readJson(sceneFile('other-feature--hero-two')).feature, 'named');
  assert.throws(() => forkScene('smart-scheduling--hero', 'other-feature--hero'), /already exists/);
  assert.throws(() => forkScene('smart-scheduling--hero', 'Bad'), /not a scene id/);
});
