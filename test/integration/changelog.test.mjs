// The changelog commands as a person or agent runs them, on the example
// feature's sidecar. Nothing here reaches a changelog: sending is refused
// without --yes, and the connection needs CHANGELOG and its key.

import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, SANDBOX } from '../helpers.mjs';

const SLUG = 'smart-scheduling';
const out = (...p) => path.join(SANDBOX, 'output', SLUG, 'changelog', ...p);

test('changelog builds the entry and its preview', () => {
  const r = cli(['changelog', SLUG]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /changelog {2}create \(draft\) -> /);
  assert.match(r.out, /entry {4}"Smart Scheduling: book meetings inside the conversation" {2}\[new\]/);
  assert.match(r.out, /preview {2}.*changelog\/preview\.html/);
  for (const f of ['entry.md', 'entry.json', 'preview.html']) assert.ok(fs.existsSync(out(f)), f);
  assert.match(fs.readFileSync(out('entry.md'), 'utf8'), /utm_source=changelog/);
});

test('changelog without a sidecar says who writes it', () => {
  const r = cli(['changelog', 'no-such-feature']);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no library\/features\/no-such-feature\/changelog\.json — ask the changelog writer/);
});

test('changelog-publish refuses without --yes; the connection names what is missing', () => {
  const p = cli(['changelog-publish', SLUG]);
  assert.notEqual(p.code, 0);
  assert.match(p.out, /run it only after the user approved, with --yes/);
  const c = cli(['changelog-check']);
  assert.notEqual(c.code, 0);
  assert.match(c.out, /no changelog configured — set CHANGELOG/);
  const k = cli(['changelog-check'], { env: { CHANGELOG: 'canny' } });
  assert.match(k.out, /CHANGELOG_API_KEY is not set/);
  const f = cli(['changelog-find', SLUG], { env: { CHANGELOG: 'canny' } });
  assert.match(f.out, /CHANGELOG_API_KEY is not set/);
});
