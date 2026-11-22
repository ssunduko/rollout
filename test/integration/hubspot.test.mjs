// The hubspot commands as a person or agent runs them, on the example
// feature's sidecar. Nothing here reaches HubSpot: uploads are refused
// without --yes, and the connection check fails without a token.

import '../setup.mjs';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, SANDBOX } from '../helpers.mjs';

const SLUG = 'smart-scheduling';
const social = path.join(SANDBOX, 'output', SLUG, 'assets', 'social');
const out = (...p) => path.join(SANDBOX, 'output', SLUG, 'hubspot', ...p);
const record = path.join(SANDBOX, 'library', 'features', SLUG, 'hubspot.published.json');

before(() => {
  fs.mkdirSync(social, { recursive: true });
  for (const f of ['email-1100x600.png', 'slide-1-cover-1080x1350.png', 'feature-1280x720.png']) fs.writeFileSync(path.join(social, f), `png ${f}`);
});

test('hubspot builds the email and posts, listing what must be uploaded first', () => {
  const r = cli(['hubspot', SLUG]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /hubspot {2}email, 3 posts -> /);
  assert.match(r.out, /email {4}"Book meetings without leaving the text thread" {2}-> .*email\.layout\.json/);
  assert.match(r.out, /LINKEDIN {2}\d+\/3000 characters {2}slide-1-cover-1080x1350\.png/);
  assert.match(r.out, /TWITTER {3}\d+\/280 characters/);
  assert.match(r.out, /todo {5}email image email-1100x600\.png is not in HubSpot yet/);
  for (const f of ['email.json', 'email.layout.json', 'posts.json', 'preview.html']) assert.ok(fs.existsSync(out(f)), f);
});

test('hubspot without a sidecar says who writes it', () => {
  const r = cli(['hubspot', 'no-such-feature']);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no library\/features\/no-such-feature\/hubspot\.json — ask the hubspot marketer/);
});

test('hubspot-assets refuses without --yes; hubspot-check needs a token', () => {
  const a = cli(['hubspot-assets', SLUG]);
  assert.notEqual(a.code, 0);
  assert.match(a.out, /run it with --yes once the user approved/);
  const c = cli(['hubspot-check']);
  assert.notEqual(c.code, 0);
  assert.match(c.out, /HUBSPOT_PRIVATE_APP_TOKEN is not set/);
});

test('hubspot-record keeps the created email and each post, and the build shows them', () => {
  const e = cli(['hubspot-record', SLUG, '--email', '987']);
  assert.equal(e.code, 0, e.out);
  assert.match(e.out, /recorded {2}email 987/);
  const p = cli(['hubspot-record', SLUG, '--network', 'linkedin', '--guid', 'abc', '--channel', 'ch1', '--url', 'https://app.hubspot.com/x']);
  assert.equal(p.code, 0, p.out);
  assert.match(p.out, /recorded {2}email 987, LINKEDIN abc/);
  const rec = JSON.parse(fs.readFileSync(record, 'utf8'));
  assert.equal(rec.posts.LINKEDIN.channel, 'ch1');
  const posts = JSON.parse(fs.readFileSync(out('posts.json'), 'utf8'));
  assert.equal(posts.find((x) => x.network === 'LINKEDIN').created.id, 'abc');
  assert.match(cli(['hubspot-record', SLUG]).out, /give --email <id>/);
  assert.match(cli(['hubspot-record', SLUG, '--network', 'LINKEDIN']).out, /a post needs --guid/);
  assert.match(cli(['hubspot-record', SLUG, '--email', '1', '--network', 'X', '--guid', 'g']).out, /separate calls/);
});
