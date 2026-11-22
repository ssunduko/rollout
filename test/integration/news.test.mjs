// The news commands as a person or agent runs them, on the example feature's
// sidecar. Nothing here reaches a news service: sending is refused without
// --yes, and the connection needs NEWS and a token.

import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, SANDBOX } from '../helpers.mjs';

const SLUG = 'smart-scheduling';
const out = (...p) => path.join(SANDBOX, 'output', SLUG, 'news', ...p);

test('news builds the item and its preview, and names what blocks sending', () => {
  const r = cli(['news', SLUG]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /news {2}create \(draft, silent\) -> /);
  assert.match(r.out, /item {5}"Book meetings right inside the conversation" {2}labels New feature {2}newsfeeds none/);
  assert.match(r.out, /todo {5}no sender/);
  assert.match(r.out, /todo {5}no newsfeed/);
  for (const f of ['item.html', 'item.json', 'preview.html']) assert.ok(fs.existsSync(out(f)), f);
  const withFeeds = cli(['news', SLUG], { env: { NEWS_NEWSFEED_IDS: '7', NEWS_SENDER_ID: '5' } });
  assert.match(withFeeds.out, /newsfeeds 7/);
  assert.doesNotMatch(withFeeds.out, /todo/);
});

test('news without a sidecar says who writes it', () => {
  const r = cli(['news', 'no-such-feature']);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no library\/features\/no-such-feature\/news\.json — ask the news writer/);
});

test('news-publish refuses without --yes; the connection names what is missing', () => {
  const p = cli(['news-publish', SLUG]);
  assert.notEqual(p.code, 0);
  assert.match(p.out, /run it only after the user approved, with --yes/);
  assert.match(cli(['news-check']).out, /no news service configured — set NEWS/);
  assert.match(cli(['news-check'], { env: { NEWS: 'intercom' } }).out, /NEWS_TOKEN is not set/);
  assert.match(cli(['news-find', SLUG], { env: { NEWS: 'intercom' } }).out, /NEWS_TOKEN is not set/);
});
