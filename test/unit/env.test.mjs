import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SANDBOX } from '../helpers.mjs';
import { env, envNumber, assertSlug, SLUG_RE, featurePaths, escapeHtml, readJson, writeJson, BRAND_DIR, INPUT_DIR, LIBRARY_DIR, OUTPUT_DIR, ROOT } from '../../pipeline/env.mjs';

test('reads .env.example, not the real .env', () => {
  assert.equal(path.relative(ROOT, BRAND_DIR).split(path.sep).join('/'), 'brand/example');
  assert.equal(env('DEMO_APP_USERNAME'), 'demo@acme.example');
  assert.equal(env('HELP_CENTER_TOKEN'), undefined);
});

test('the shell wins over the file: the sandbox folders', () => {
  assert.equal(INPUT_DIR, path.join(SANDBOX, 'input'));
  assert.equal(LIBRARY_DIR, path.join(SANDBOX, 'library'));
  assert.equal(OUTPUT_DIR, path.join(SANDBOX, 'output'));
});

test('env: empty means unset, fallbacks apply', () => {
  process.env.T_EMPTY = '';
  assert.equal(env('T_EMPTY', 'x'), 'x');
  assert.equal(env('T_MISSING'), undefined);
  process.env.T_SET = 'v';
  assert.equal(env('T_SET', 'x'), 'v');
});

test('envNumber: numbers, and the fallback for junk', () => {
  process.env.T_NUM = '12.5';
  assert.equal(envNumber('T_NUM', 3), 12.5);
  process.env.T_NUM = 'abc';
  assert.equal(envNumber('T_NUM', 3), 3);
  assert.equal(envNumber('T_NONE', 7), 7);
});

test('assertSlug accepts kebab-case only', () => {
  for (const ok of ['a', 'smart-scheduling', 'v2-api']) assert.equal(assertSlug(ok), ok);
  for (const bad of [undefined, '', 'Smart', 'a--b', '-a', 'a-', 'a_b', '../x', 'a b']) assert.throws(() => assertSlug(bad), /not a feature slug/);
  assert.ok(SLUG_RE.test('x-1'));
});

test('featurePaths: one feature\'s folders', () => {
  const p = featurePaths('demo');
  assert.equal(p.brief, path.join(LIBRARY_DIR, 'features', 'demo', 'brief.json'));
  assert.equal(p.description, path.join(INPUT_DIR, 'demo', 'feature.md'));
  assert.equal(p.web, path.join(OUTPUT_DIR, 'demo', 'web'));
  assert.equal(p.qa, path.join(OUTPUT_DIR, 'demo', 'qa'));
});

test('writeJson creates folders; readJson reads it back', () => {
  const f = path.join(SANDBOX, 'deep', 'er', 'x.json');
  writeJson(f, { a: [1, 'b'] });
  assert.ok(fs.readFileSync(f, 'utf8').endsWith('\n'));
  assert.deepEqual(readJson(f), { a: [1, 'b'] });
});

test('escapeHtml escapes the five characters, and null', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(3), '3');
});
