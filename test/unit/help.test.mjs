import '../setup.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SLUG } from '../setup.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { loadBrief } from '../../pipeline/brief.mjs';
import { writeJson, readJson } from '../../pipeline/env.mjs';
import { loadHelp, validateHelp, helpSceneIds, buildHelp, helpFile, helpDir, publishedFile, readPublished, HELP_LIMITS } from '../../pipeline/help.mjs';

const brand = loadBrand();
const brief = loadBrief(SLUG, brand);
const original = fs.readFileSync(helpFile(SLUG), 'utf8');
const base = JSON.parse(original);

// a help.json for the example feature, changed by fn
const withHelp = (fn) => {
  const h = structuredClone(base);
  fn?.(h);
  fs.writeFileSync(helpFile(SLUG), JSON.stringify(h));
  return h;
};
const errorsOf = (fn) => { withHelp(fn); return validateHelp(SLUG, brief, brand).errors; };

beforeEach(() => {
  fs.writeFileSync(helpFile(SLUG), original);
  fs.rmSync(publishedFile(SLUG), { force: true });
  for (const k of ['HELP_AUTHOR_ID', 'HELP_COLLECTION_ID', 'HELP_IMAGE_STORE', 'HELP_IMAGE_BASE_URL']) delete process.env[k];
});

test('HELP_LIMITS', () => {
  assert.deepEqual(HELP_LIMITS.title, [3, 80]);
  assert.deepEqual(HELP_LIMITS.description, [20, 160]);
});

test('loadHelp: null without help.json', () => {
  fs.rmSync(helpFile(SLUG));
  assert.equal(loadHelp(SLUG, brief, brand), null);
  assert.deepEqual(validateHelp(SLUG, brief, brand), { errors: [], warnings: ['no help.json — the help article is not built'] });
});

test('loadHelp: defaults from the brief, brand and .env', () => {
  withHelp((h) => { delete h.title; delete h.cta; delete h.closing; delete h.publish; h.intro = 'One paragraph.'; });
  process.env.HELP_AUTHOR_ID = '42';
  process.env.HELP_COLLECTION_ID = '7';
  const h = loadHelp(SLUG, brief, brand);
  assert.equal(h.title, brief.feature);
  assert.deepEqual(h.intro, [{ p: 'One paragraph.' }]);
  assert.deepEqual(h.cta, brand.help.cta);
  assert.deepEqual(h.closing, brand.help.closing);
  assert.equal(h.faqTitle, brand.help.faqTitle);
  assert.deepEqual(h.publish, { articleId: null, state: 'draft', authorId: '42', parentId: '7', updatedAt: null });
  assert.ok(h.sections.every((s) => s.level >= 1 && Array.isArray(s.blocks)));
  assert.equal(h.live, null);
});

test('loadHelp: cta and closing false turn them off; the live record fills the article id', () => {
  withHelp((h) => { h.cta = false; h.closing = false; delete h.publish; });
  writeJson(publishedFile(SLUG), { articleId: '123', state: 'draft' });
  const h = loadHelp(SLUG, brief, brand);
  assert.equal(h.cta, null);
  assert.equal(h.closing, null);
  assert.equal(h.publish.articleId, '123');
  assert.deepEqual(readPublished(SLUG), { articleId: '123', state: 'draft' });
});

test('helpSceneIds: each scene image once, URLs left out', () => {
  withHelp((h) => {
    h.intro = [{ image: 'smart-scheduling--hero', alt: 'a' }, { image: 'https://cdn.example/x.png', alt: 'b' }];
    h.sections[0].blocks.push({ image: 'smart-scheduling--calendars', alt: 'again' });
  });
  const ids = helpSceneIds(loadHelp(SLUG, brief, brand));
  assert.equal(ids[0], 'smart-scheduling--hero');
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('smart-scheduling--calendars'));
  assert.ok(!ids.some((i) => i.startsWith('https')));
});

test('validateHelp: the committed example passes', () => {
  const r = validateHelp(SLUG, brief, brand);
  assert.deepEqual(r.errors, []);
});

test('validateHelp: invalid JSON is an error', () => {
  fs.writeFileSync(helpFile(SLUG), '{ nope');
  assert.match(validateHelp(SLUG, brief, brand).errors[0], /help\.json is not valid JSON/);
});

test('validateHelp: title and description lengths', () => {
  assert.ok(errorsOf((h) => { h.title = 'x'.repeat(81); }).some((e) => /title is 81 characters; at most 80/.test(e)));
  assert.ok(errorsOf((h) => { h.description = ''; }).includes('description is missing'));
  withHelp((h) => { h.description = 'Too short.'; });
  assert.ok(validateHelp(SLUG, brief, brand).warnings.some((w) => /description is only 10 characters/.test(w)));
});

test('validateHelp: sections are required and start at level 1', () => {
  assert.ok(errorsOf((h) => { h.sections = []; }).includes('sections is empty'));
  assert.ok(errorsOf((h) => { h.sections[0].level = 2; }).some((e) => /sections\[0\]\.level must be 1/.test(e)));
  assert.ok(errorsOf((h) => { h.sections[1].level = 4; }).some((e) => /sections\[1\]\.level must be 1 \(section\), 2 \(step\) or 3/.test(e)));
  assert.ok(errorsOf((h) => { delete h.sections[1].heading; }).includes('sections[1].heading is missing'));
});

test('validateHelp: a section with no blocks warns unless steps follow it', () => {
  withHelp((h) => { h.sections.push({ heading: 'Empty' }); });
  assert.ok(validateHelp(SLUG, brief, brand).warnings.some((w) => /has no blocks/.test(w)));
  withHelp((h) => { h.sections.push({ heading: 'Parent' }, { heading: 'Step', level: 2, blocks: [{ p: 'x' }] }); });
  assert.ok(!validateHelp(SLUG, brief, brand).warnings.some((w) => /has no blocks/.test(w)));
});

test('validateHelp: block checks', () => {
  const at = (b) => errorsOf((h) => { h.sections[0].blocks = [b]; });
  assert.match(at({ quote: 'x' }).join(), /one of p, steps, bullets, image, video, note, table expected/);
  assert.match(at({ p: 'see [docs](http://acme.example)' }).join(), /link "docs" must be https:\/\/ or mailto:/);
  assert.deepEqual(at({ p: 'see [docs](https://acme.example) or [mail](mailto:a@acme.example)' }), []);
  assert.match(at({ steps: [] }).join(), /steps must be a non-empty list/);
  assert.match(at({ bullets: 'x' }).join(), /bullets must be a non-empty list/);
  assert.match(at({ table: { head: ['a', 'b'], rows: [['1']] } }).join(), /table needs head \[\] and rows \[\[\]\] of the same width/);
  assert.match(at({ video: 'https://evil.example/embed/1' }).join(), /video must be an embed URL/);
  assert.deepEqual(at({ video: 'https://www.youtube.com/embed/abc' }), []);
  assert.match(at({ image: 'Not A Scene', alt: 'x' }).join(), /is neither a scene id nor an https URL/);
  assert.match(at({ image: 'no-such--scene', alt: 'x' }).join(), /does not exist in library\/scenes/);
  assert.match(at({ image: 'smart-scheduling--hero', alt: 'x', width: 1.5 }).join(), /width must be a whole number/);
  assert.deepEqual(at({ image: 'https://cdn.example/a.png', alt: 'x' }), []);
});

test('validateHelp: image alt is a warning', () => {
  withHelp((h) => { h.sections[0].blocks = [{ image: 'smart-scheduling--hero' }, { image: 'smart-scheduling--hero', alt: 'y'.repeat(141) }]; });
  const w = validateHelp(SLUG, brief, brand).warnings;
  assert.ok(w.some((x) => /blocks\[0\]\.alt is missing/.test(x)));
  assert.ok(w.some((x) => /blocks\[1\]\.alt is long \(141/.test(x)));
});

test('validateHelp: faq, cta, closing and publish fields', () => {
  assert.ok(errorsOf((h) => { h.faq = [{ q: 'Why?' }]; }).includes('faq[0] needs q and a'));
  assert.ok(errorsOf((h) => { h.cta = { label: 'Go', url: 'http://x' }; }).includes('cta needs a label and an https url'));
  assert.ok(errorsOf((h) => { h.closing = { body: '[x](ftp://y)' }; }).some((e) => /^closing: link/.test(e)));
  assert.ok(errorsOf((h) => { h.publish = { articleId: 'abc' }; }).some((e) => /publish\.articleId "abc" is not a numeric/.test(e)));
  assert.ok(errorsOf((h) => { h.publish = { state: 'live' }; }).includes('publish.state must be draft or published'));
  assert.ok(errorsOf((h) => { h.publish = { parentId: 'x' }; }).some((e) => /publish\.parentId "x"/.test(e)));
  withHelp((h) => { h.publish = { articleId: '5' }; });
  writeJson(publishedFile(SLUG), { articleId: '6' });
  assert.ok(validateHelp(SLUG, brief, brand).warnings.some((w) => /publish\.articleId 5 differs from the article last published \(6\)/.test(w)));
});

// buildHelp without scene images needs no ffmpeg: every image is a live URL.
const URL_SLUG = 'help-urls';
const urlBrief = { feature: 'Acme Widgets' };
function writeUrlHelp(extra = {}) {
  const dir = path.dirname(helpFile(URL_SLUG));
  fs.mkdirSync(dir, { recursive: true });
  writeJson(helpFile(URL_SLUG), {
    description: 'How to use Acme Widgets to tidy up every conversation in one place.',
    intro: ['Widgets **tidy** your *inbox*.', { image: 'https://cdn.acme.example/a.png', alt: 'Hero', width: 800, height: 400 }],
    sections: [
      { heading: 'Get started', blocks: [{ steps: ['Open **Settings**', 'Click [Widgets](https://acme.example/w)'] }, { note: 'Admins only.' }] },
      { heading: 'Pick a widget', level: 2, blocks: [{ bullets: ['One', 'Two'] }, { table: { head: ['A', 'B'], rows: [['1', '2']] } }] },
      { heading: 'Watch', level: 3, blocks: [{ video: 'https://player.vimeo.com/video/1' }, { image: 'https://cdn.acme.example/b.png', alt: 'Small' }] },
    ],
    faq: [{ q: 'Free?', a: 'Yes, [see plans](https://acme.example/plans).' }],
    ...extra,
  });
}

test('buildHelp: null without help.json', async () => {
  assert.equal(await buildHelp({ slug: 'no-help-here', brief: urlBrief, brand, renders: {} }), null);
});

test('buildHelp: writes the article body in the house style', async () => {
  writeUrlHelp();
  const r = await buildHelp({ slug: URL_SLUG, brief: urlBrief, brand, renders: {} });
  assert.equal(r.action, 'create');
  assert.deepEqual(r.images, []);
  assert.equal(r.uploads, 0);
  assert.ok(r.blockers.some((b) => /no author/.test(b)));
  const html = fs.readFileSync(path.join(helpDir(URL_SLUG), 'article.html'), 'utf8');
  assert.ok(!html.includes('\n'), 'no line breaks between tags');
  assert.ok(html.startsWith(`<h1 class="intercom-align-center"><b><a href="${brand.help.cta.url}">`));
  assert.match(html, /<p>Widgets <b>tidy<\/b> your <i>inbox<\/i>\.<\/p>/);
  assert.match(html, /<div class="intercom-container"><img src="https:\/\/cdn\.acme\.example\/a\.png" alt="Hero" width="800" height="400"/);
  assert.match(html, /<img src="https:\/\/cdn\.acme\.example\/b\.png" alt="Small">/);
  assert.match(html, /<hr><h2><b>Get started<\/b><\/h2>/);
  assert.match(html, /<h3><b>Pick a widget<\/b><\/h3>/);
  assert.match(html, /<h4><b>Watch<\/b><\/h4>/);
  assert.match(html, /<ol><li>Open <b>Settings<\/b><\/li><li>Click <a href="https:\/\/acme\.example\/w">Widgets<\/a><\/li><\/ol>/);
  assert.match(html, /<p><b>Note:<\/b> Admins only\.<\/p>/);
  assert.match(html, /<table><tr><td><b>A<\/b><\/td><td><b>B<\/b><\/td><\/tr><tr><td>1<\/td><td>2<\/td><\/tr><\/table>/);
  assert.match(html, /<iframe src="https:\/\/player\.vimeo\.com\/video\/1"><\/iframe>/);
  assert.match(html, /<hr><h2><b>Frequently Asked Questions<\/b><\/h2>/);
  assert.match(html, /<hr><h2><b>Need Help\?<\/b><\/h2>/);
  assert.match(html, /<a href="mailto:hello@acme\.example">/);
  const json = readJson(path.join(helpDir(URL_SLUG), 'article.json'));
  assert.equal(json.title, 'Acme Widgets');
  assert.equal(json.action, 'create');
  assert.equal(json.body, 'article.html');
  const preview = fs.readFileSync(path.join(helpDir(URL_SLUG), 'preview.html'), 'utf8');
  assert.match(preview, /<title>Acme Widgets — help article preview<\/title>/);
  assert.match(preview, /a new article, as draft/);
});

test('buildHelp: escapes text, and an update with an author has no blockers', async () => {
  writeUrlHelp({ title: 'A <b> & "c"', publish: { articleId: '99', authorId: '1' } });
  const r = await buildHelp({ slug: URL_SLUG, brief: urlBrief, brand, renders: {} });
  assert.equal(r.action, 'update');
  assert.deepEqual(r.blockers, []);
  const preview = fs.readFileSync(path.join(helpDir(URL_SLUG), 'preview.html'), 'utf8');
  assert.match(preview, /A &lt;b&gt; &amp; &quot;c&quot;/);
  assert.match(preview, /updates article 99/);
});

test('buildHelp: empties the folder first', async () => {
  writeUrlHelp();
  fs.mkdirSync(helpDir(URL_SLUG), { recursive: true });
  fs.writeFileSync(path.join(helpDir(URL_SLUG), 'stale.txt'), 'x');
  await buildHelp({ slug: URL_SLUG, brief: urlBrief, brand, renders: {} });
  assert.ok(!fs.existsSync(path.join(helpDir(URL_SLUG), 'stale.txt')));
  assert.ok(fs.existsSync(path.join(helpDir(URL_SLUG), 'images')));
});

test('buildHelp: refuses an invalid help.json, and an unrendered scene', async () => {
  writeUrlHelp({ sections: [] });
  await assert.rejects(buildHelp({ slug: URL_SLUG, brief: urlBrief, brand, renders: {} }), /help\.json: sections is empty/);
  await assert.rejects(buildHelp({ slug: SLUG, brief, brand, renders: {} }), /scene smart-scheduling--calendars was not rendered/);
});
