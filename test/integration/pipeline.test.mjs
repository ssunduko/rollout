// The whole pipeline on the example feature, end to end: capture the demo
// app, render the kit scenes, build the PDF, web page, social pack and help
// article, QA them, serve the page, and send the article to a fake help
// center. Needs Chrome and ffmpeg (skipped without them, except in CI).

import '../setup.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cli, cliAsync, putFixture, haveChrome, haveFfmpeg, required, startServer, ROOT, SANDBOX } from '../helpers.mjs';
import { freePort, fakeHelpCenter } from '../fakes.mjs';

const SLUG = 'smart-scheduling';
const out = path.join(SANDBOX, 'output', SLUG);
const skip = required((await haveChrome()) && haveFfmpeg(), 'Chrome and ffmpeg');
const BUILD_TIMEOUT = 600_000;

let app;
let env;
before(async () => {
  if (skip) return;
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  env = { DEMO_APP_PORT: String(port), DEMO_APP_URL: url };
  app = await startServer('demo-app/server.mjs', { env, url: `${url}/login` });
  putFixture('integration-social.json', `library/features/${SLUG}/social.json`);
});
after(() => app?.stop());

const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);
const isPng = (f) => fs.readFileSync(f).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const isGif = (f) => fs.readFileSync(f).subarray(0, 4).toString('latin1') === 'GIF8';

test('build: captures, scenes, PDF, web page, social pack, help article', { skip, timeout: BUILD_TIMEOUT }, () => {
  const r = cli(['build', SLUG], { env, timeout: BUILD_TIMEOUT });
  assert.equal(r.code, 0, r.out);
  for (const id of ['suggest-times', 'calendars', 'reminders', 'inbox-rules']) assert.match(r.out, new RegExp(`capture smart-scheduling--${id} .*\\[demo-app\\]`));
  for (const id of ['hero', 'reschedule']) assert.match(r.out, new RegExp(`render\\s+smart-scheduling--${id}`));

  // the one-pager: a real PDF of the pages the build reported
  const pdf = path.join(out, 'Smart Scheduling One-Pager.pdf');
  assert.ok(fs.existsSync(pdf), 'PDF exists');
  const pdfBytes = fs.readFileSync(pdf);
  assert.equal(pdfBytes.subarray(0, 5).toString('latin1'), '%PDF-');
  const pages = Number(r.out.match(/One-Pager\.pdf\s+\((\d+) pages?\)/)?.[1]);
  assert.ok(pages >= 1 && pages <= 3, `pages ${pages}`);
  assert.ok(fs.existsSync(path.join(out, 'onepager.html')));

  // the web page: self-contained, every local reference present
  const web = path.join(out, 'web');
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  assert.match(html, /Smart Scheduling|smart scheduling/i);
  const refs = [...html.matchAll(/(?:src|href)="(?!https?:|data:|#|mailto:|tel:)([^"]+)"/g)].map((m) => decodeURI(m[1]));
  assert.ok(refs.length > 0);
  for (const ref of refs) assert.ok(fs.existsSync(path.join(web, ref.split(/[?#]/)[0])), `web page references a missing file: ${ref}`);
  assert.ok(fs.existsSync(path.join(web, 'page.json')));

  // the scenes, as stills and GIFs
  const assets = path.join(out, 'assets');
  const media = files(assets);
  assert.ok(media.some((f) => f.endsWith('.gif')), 'GIFs');
  for (const f of media.filter((x) => x.endsWith('.png'))) assert.ok(isPng(path.join(assets, f)), f);
  for (const f of media.filter((x) => x.endsWith('.gif'))) assert.ok(isGif(path.join(assets, f)), f);

  // the social pack
  const social = files(path.join(assets, 'social'));
  assert.ok(social.length >= 4, `social pack: ${social.join(', ')}`);
  assert.ok(social.some((f) => /podcast/.test(f)), 'podcast thumbnail');

  // the help article, with its images as placeholders (no image store in the test env)
  const help = path.join(out, 'help');
  assert.ok(fs.existsSync(path.join(help, 'article.html')));
  const article = JSON.parse(fs.readFileSync(path.join(help, 'article.json'), 'utf8'));
  assert.ok(article.title);
  assert.ok(article.images.length >= 1);

  // renders are cached in the library by content
  assert.ok(files(path.join(SANDBOX, 'library', 'renders')).length >= 6);
  assert.ok(fs.existsSync(path.join(out, 'build.json')));
});

test('a second build reuses every cached render', { skip, timeout: BUILD_TIMEOUT }, () => {
  const t = Date.now();
  const r = cli(['build', SLUG], { env, timeout: BUILD_TIMEOUT });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /capture smart-scheduling--\S+ .*still\+gif in/, 'nothing captured again');
  assert.ok(Date.now() - t < 120_000, 'cached build is quick');
});

test('qa: the measured checks pass and the screenshots exist', { skip, timeout: 300_000 }, () => {
  const r = cli(['qa', SLUG], { env, timeout: 300_000 });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /VERDICT \(measured\): PASS\s+0 fail/);
  const qa = JSON.parse(fs.readFileSync(path.join(out, 'qa', 'qa.json'), 'utf8'));
  assert.ok(qa);
  for (const f of ['pdf-page-1.png', 'web-desktop.png', 'web-desktop-fold.png', 'web-mobile.png', 'web-mobile-fold.png']) {
    assert.ok(isPng(path.join(out, 'qa', f)), f);
  }
});

test('serve: the built page over HTTP', { skip, timeout: 60_000 }, async () => {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'pipeline', 'rollout.mjs'), 'serve', SLUG], {
    cwd: ROOT, env: { ...process.env, ...env, WEB_PORT: String(port) }, stdio: 'pipe',
  });
  try {
    let res;
    for (let i = 0; i < 100 && !res; i++) {
      res = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
      if (!res) await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(res, 'serve answered');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /<html/i);
  } finally {
    child.kill();
  }
});

test('help-publish: a draft article in the help center, then an update', { skip, timeout: BUILD_TIMEOUT }, async () => {
  const hc = await fakeHelpCenter();
  try {
    const henv = { ...env, HELP_CENTER: 'intercom', HELP_CENTER_TOKEN: hc.token, HELP_CENTER_API_URL: hc.url, HELP_AUTHOR_ID: '7' };
    const status = await cliAsync(['help-center'], { env: henv });
    assert.equal(status.code, 0, status.out);
    assert.match(status.out, /connected as Test Admin/);

    const created = await cliAsync(['help-publish', SLUG, '--yes'], { env: henv, timeout: BUILD_TIMEOUT });
    assert.equal(created.code, 0, created.out);
    assert.match(created.out, /created article (\d+)\s+\[draft\]/);
    assert.equal(hc.articles.size, 1);
    const [a] = hc.articles.values();
    assert.equal(a.state, 'draft');
    assert.equal(a.author_id, 7);

    const rec = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'library', 'features', SLUG, 'help.published.json'), 'utf8'));
    assert.equal(rec.articleId, a.id);
    assert.equal(rec.action, 'create');

    // the agent records the article as read (help.json publish.articleId / updatedAt), then the next publish updates it
    const helpFile = path.join(SANDBOX, 'library', 'features', SLUG, 'help.json');
    const help = JSON.parse(fs.readFileSync(helpFile, 'utf8'));
    help.publish = { ...help.publish, articleId: a.id, updatedAt: a.updated_at };
    fs.writeFileSync(helpFile, JSON.stringify(help, null, 2));
    const found = await cliAsync(['help-find', SLUG], { env: henv });
    assert.match(found.out, new RegExp(`${a.id}\\s+\\[draft\\]`));
    const updated = await cliAsync(['help-publish', SLUG, '--yes'], { env: henv, timeout: BUILD_TIMEOUT });
    assert.equal(updated.code, 0, updated.out);
    assert.match(updated.out, new RegExp(`updated article ${a.id}`));
    assert.equal(hc.articles.size, 1, 'no duplicate article');

    // someone edits it in the help center: the next publish refuses
    a.updated_at += 100;
    const refused = await cliAsync(['help-publish', SLUG, '--yes'], { env: henv, timeout: BUILD_TIMEOUT });
    assert.notEqual(refused.code, 0);
    assert.match(refused.out, /edited in the help center since it was read/);
  } finally {
    await hc.close();
  }
});
