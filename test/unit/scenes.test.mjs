import '../setup.mjs';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SANDBOX } from '../helpers.mjs';
import { renderSettings, isCapture, sceneRefs, targetNameFor, scenePage } from '../../pipeline/scenes.mjs';
import { loadScene, sceneDir, sceneFile } from '../../pipeline/library.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { writeJson } from '../../pipeline/env.mjs';

const brand = loadBrand();
const TARGET = process.env.CAPTURE_TARGET; // demo-app, from .env.example
afterEach(() => { delete process.env.STILL_SCALE; process.env.CAPTURE_TARGET = TARGET; });

function kitScene(id, spec, html, files = {}) {
  writeJson(sceneFile(id), spec);
  fs.writeFileSync(path.join(sceneDir(id), 'scene.html'), html);
  for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(sceneDir(id), f), c);
  return loadScene(id);
}

test('renderSettings from the environment', () => {
  assert.deepEqual(renderSettings(), { stillScale: 2, gifFps: 12, gifScale: 1 });
  process.env.STILL_SCALE = '3';
  assert.equal(renderSettings().stillScale, 3);
});

test('isCapture', () => {
  assert.equal(isCapture(loadScene('smart-scheduling--calendars')), true);
  assert.equal(isCapture(loadScene('smart-scheduling--hero')), false);
});

test('sceneRefs: the scenes a kit scene embeds, once each; none for captures', () => {
  assert.deepEqual(sceneRefs(loadScene('smart-scheduling--hero')), ['smart-scheduling--suggest-times']);
  assert.deepEqual(sceneRefs({ markup: '<img src="scene:a--b"><img src="scene:a--b">', css: '.x{background:url(scene:c)}' }), ['a--b', 'c']);
  assert.deepEqual(sceneRefs({ source: 'capture', markup: 'scene:a--b' }), []);
});

test('targetNameFor: the scene\'s, else the feature\'s, else CAPTURE_TARGET', () => {
  assert.equal(targetNameFor({ id: 'x--y', target: 'own' }), 'own');
  assert.equal(targetNameFor({ id: 'smart-scheduling--calendars' }), 'demo-app'); // input/smart-scheduling/feature.json
  assert.equal(targetNameFor({ id: 'whatever--y', feature: 'smart-scheduling' }), 'demo-app');
  assert.equal(targetNameFor({ id: 'nofeature--y' }), 'demo-app'); // CAPTURE_TARGET in .env.example
  process.env.CAPTURE_TARGET = 'fallback';
  assert.equal(targetNameFor({ id: 'nofeature--y' }), 'fallback');
});

test('scenePage: a self-contained page for a kit scene', () => {
  const s = kitScene('scenes-test--page', { size: { width: 320, height: 200 }, background: '#fff', css: '.bg{background:url(bg.svg)}', animation: { duration: 900 }, stillAt: 500 },
    '<div class="bg"><img src="pic.png"><img src="brand:logo"></div>', { 'pic.png': 'PNGDATA', 'bg.svg': '<svg/>' });
  const html = scenePage(s, brand);
  assert.match(html, /^<!doctype html><html><head>/);
  assert.match(html, /#frame\{width:320px;height:200px;background:#fff;\}/);
  assert.match(html, /src="data:image\/png;base64,UE5HREFUQQ=="/); // pic.png inlined
  assert.match(html, /url\(data:image\/svg\+xml;base64,/); // css ref inlined
  assert.doesNotMatch(html, /brand:logo|pic\.png|bg\.svg/);
  assert.match(html, /--primary:#5b4cf5/); // brand css
  assert.match(html, /window\.__sceneSpec=\{"animation":\{"duration":900\},"stillAt":500\}/);
});

test('scenePage: scene: embeds take the given still, tagged with data-scene', () => {
  const still = path.join(SANDBOX, 'still.png');
  fs.writeFileSync(still, 'S');
  const s = kitScene('scenes-test--embed', { size: { width: 10, height: 10 } }, '<img src="scene:a--b">');
  assert.match(scenePage(s, brand, { 'a--b': still }), /<img data-scene="a--b" src="data:image\/png;base64,Uw==">/);
  assert.throws(() => scenePage(s, brand, {}), /embeds scene:a--b, which has no still/);
});

test('scenePage: missing local file is an error; default size and transparent background', () => {
  const s = kitScene('scenes-test--missing', {}, '<img src="gone.png">');
  assert.throws(() => scenePage(s, brand), /references gone\.png, which is not in/);
  const plain = kitScene('scenes-test--plain', {}, '<p>x</p>');
  assert.match(scenePage(plain, brand), /#frame\{width:640px;height:480px;background:transparent;\}/);
});

test('scenePage web layout: class "web" and the web size', () => {
  const s = kitScene('scenes-test--web', { size: { width: 300, height: 200 }, web: {} }, '<p>x</p>');
  const html = scenePage(s, brand, {}, { web: true });
  assert.match(html, /<html class="web">/);
  assert.match(html, /#frame\{width:600px;height:344px;/); // 600 wide at 1180x676
  const sized = kitScene('scenes-test--websized', { web: { size: { width: 500, height: 250 } } }, '<p>x</p>');
  assert.match(scenePage(sized, brand, {}, { web: true }), /#frame\{width:500px;height:250px;/);
});

test('the example hero renders to a page with its capture embedded', () => {
  const still = path.join(SANDBOX, 'hero-embed.png');
  fs.writeFileSync(still, 'X');
  const html = scenePage(loadScene('smart-scheduling--hero'), brand, { 'smart-scheduling--suggest-times': still });
  assert.match(html, /data-scene="smart-scheduling--suggest-times"/);
  assert.match(html, /#frame\{width:680px;height:560px;/);
});
