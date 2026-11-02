// The CLI as a person or agent runs it, in a child process, on the sandbox
// copy of the example feature. Nothing here needs Chrome or ffmpeg.

import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cli, SANDBOX } from '../helpers.mjs';

const SLUG = 'smart-scheduling';

test('no command prints the usage; an unknown one fails with it', () => {
  const none = cli([]);
  assert.equal(none.code, 0);
  assert.match(none.out, /rollout\.mjs init <slug>/);
  const bad = cli(['no-such-command']);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /rollout\.mjs init <slug>/);
});

test('a slug that is not kebab-case is refused', () => {
  for (const cmd of ['validate', 'status', 'build', 'init']) {
    const r = cli([cmd, 'Bad_Slug']);
    assert.notEqual(r.code, 0, cmd);
    assert.match(r.out, /not a feature slug/, cmd);
  }
});

test('init creates input/<slug>/ from the template, once', () => {
  const r = cli(['init', 'new-thing', '--name', 'New Thing']);
  assert.equal(r.code, 0, r.out);
  const dir = path.join(SANDBOX, 'input', 'new-thing');
  assert.ok(fs.existsSync(path.join(dir, 'feature.md')));
  assert.ok(fs.existsSync(path.join(dir, 'feature.json')));
  assert.match(fs.readFileSync(path.join(dir, 'feature.md'), 'utf8') + fs.readFileSync(path.join(dir, 'feature.json'), 'utf8'), /New Thing/);
  const again = cli(['init', 'new-thing']);
  assert.notEqual(again.code, 0, 'init must not overwrite an existing feature');
});

test('status: what exists and what is next', () => {
  const fresh = cli(['status', 'status-only']);
  assert.match(fresh.out, /input|feature\.md/);
  cli(['init', 'status-new']);
  const started = cli(['status', 'status-new']);
  assert.equal(started.code, 0, started.out);
  assert.match(started.out, /brief\s+next: copywriter agent/);
  const example = cli(['status', SLUG]);
  assert.equal(example.code, 0, example.out);
  assert.match(example.out, /✓ brief valid/);
  assert.match(example.out, /captures\s+4 from target demo-app/);
});

test('validate: the example brief passes; a missing or broken one fails', () => {
  const ok = cli(['validate', SLUG]);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /brief OK/);

  const noInput = cli(['validate', 'nothing-here']);
  assert.notEqual(noInput.code, 0);
  assert.match(noInput.out, /no feature description/);

  cli(['init', 'no-brief-yet']);
  const missing = cli(['validate', 'no-brief-yet']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.out, /missing .*brief\.json/);

  // the example brief with a headline far past its limit
  const dir = path.join(SANDBOX, 'library', 'features', 'too-long');
  fs.cpSync(path.join(SANDBOX, 'library', 'features', SLUG), dir, { recursive: true });
  fs.cpSync(path.join(SANDBOX, 'input', SLUG), path.join(SANDBOX, 'input', 'too-long'), { recursive: true });
  const brief = JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8'));
  brief.headline = `${'Much too long a headline '.repeat(12)}[accent]`;
  fs.writeFileSync(path.join(dir, 'brief.json'), JSON.stringify(brief));
  fs.rmSync(path.join(dir, 'help.json'), { force: true });
  const long = cli(['validate', 'too-long']);
  assert.notEqual(long.code, 0, long.out);
  assert.match(long.out, /headline/i);
});

test('brand: the example brand, resolved', () => {
  const r = cli(['brand']);
  assert.equal(r.code, 0, r.out);
  const b = JSON.parse(r.stdout);
  assert.equal(b.id, 'example');
  assert.equal(b.name, 'Acme Cloud');
});

test('targets lists the demo app', () => {
  const r = cli(['targets']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /demo-app\s+http:\/\/localhost:4173\s+auth: form/);
});

test('library: list, search, show, fork, index', () => {
  const list = cli(['library', 'list']);
  assert.equal(list.code, 0, list.out);
  assert.match(list.out, /smart-scheduling\s+Smart Scheduling\s+— 6 scenes/);

  const search = cli(['library', 'search', 'reminders']);
  assert.match(search.out, /smart-scheduling--reminders/);
  assert.doesNotMatch(search.out, /smart-scheduling--calendars/);

  const show = cli(['library', 'show', 'smart-scheduling--hero']);
  assert.equal(show.code, 0, show.out);
  assert.ok(JSON.parse(show.stdout).title);

  const fork = cli(['library', 'fork', 'smart-scheduling--hero', 'other--hero']);
  assert.equal(fork.code, 0, fork.out);
  const forked = path.join(SANDBOX, 'library', 'scenes', 'other--hero');
  assert.ok(fs.existsSync(path.join(forked, 'scene.json')));
  assert.ok(fs.existsSync(path.join(forked, 'scene.html')));
  assert.notEqual(cli(['library', 'fork', 'smart-scheduling--hero', 'other--hero']).code, 0, 'fork must not overwrite');

  const index = cli(['library', 'index']);
  assert.equal(index.code, 0, index.out);
  const idx = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'library', 'index.json'), 'utf8'));
  assert.ok(JSON.stringify(idx).includes('other--hero'));
});

test('every outward or costly step refuses without --yes', () => {
  for (const [cmd, why] of [
    ['help-publish', /only after the user approved, with --yes/],
    ['site-assets', /only after the user approved, with --yes/],
    ['podcast', /spends credits.*--yes/],
    ['podcast-site-assets', /only after the user approved, with --yes/],
  ]) {
    const r = cli([cmd, SLUG]);
    assert.notEqual(r.code, 0, cmd);
    assert.match(r.out, why, cmd);
  }
});

test('services that are not configured say which key is missing', () => {
  const hc = cli(['help-center']);
  assert.notEqual(hc.code, 0);
  assert.match(hc.out, /HELP_CENTER_TOKEN is not set|no help center configured/);
  const site = cli(['site']);
  assert.notEqual(site.code, 0);
  assert.match(site.out, /no website configured|WEBFLOW/);
  const pc = cli(['podcast-check']);
  assert.match(pc.out, /PODCAST_VIDEO_SOURCE is not set/);
  assert.match(pc.out, /PODCAST_STUDIO is not set/);
  assert.match(pc.out, /PODCAST_DIRECTORY is not set/);
});

test('seo: checks the feature, writes its JSON-LD, audits a published page (read only)', async () => {
  const http = await import('node:http');
  const { cliAsync } = await import('../helpers.mjs');
  const bad = '<html><head><title>Book</title><meta property="og:image" content="a.png"><meta property="og:image" content="b.png"></head><body><h1>Book</h1><h1></h1><img src="x.png"></body></html>';
  const server = http.createServer((req, res) => {
    if (req.url === '/missing') { res.writeHead(404); return res.end('no'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(bad);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await cliAsync(['seo', SLUG, '--url', `${base}/features/smart-scheduling`]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /keyword\s+"Smart Scheduling"/);
    assert.match(r.out, /^brief\s+ok$/m, 'the example brief has no SEO findings');
    assert.match(r.out, /page\s+http:\/\/127\.0\.0\.1:\d+\/features\/smart-scheduling\s+\[HTTP 200\]/);
    for (const re of [/the page has 2 <h1> elements/, /an empty <h1>/, /2 different og:image tags/, /no structured data/, /no canonical link/, /no meta description/, /image without alt text: x\.png/]) assert.match(r.out, re);

    const dir = path.join(SANDBOX, 'output', SLUG, 'seo');
    const ld = JSON.parse(fs.readFileSync(path.join(dir, 'feature.jsonld.json'), 'utf8'));
    assert.deepEqual(ld['@graph'].map((g) => g['@type']), ['WebPage', 'SoftwareApplication', 'FAQPage']);
    assert.equal(ld['@graph'][0].url, 'https://www.acme.example/features/smart-scheduling'); // the brand's web.pageUrl
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'seo.json'), 'utf8'));
    assert.equal(report.pages.length, 1);
    assert.ok(report.pages[0].findings.length >= 7);

    // a page that does not answer fails the command
    const missing = await cliAsync(['seo', SLUG, '--url', `${base}/missing`]);
    assert.notEqual(missing.code, 0);
    assert.match(missing.out, /fail\s+HTTP 404/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
