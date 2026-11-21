import '../setup.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mockFetch } from '../helpers.mjs';
import {
  NETWORKS, EMAIL_LIMITS, tagLink, postLength, postText, validateHubspot, emailLayout, buildHubspot,
  uploadHubspotAssets, recordCreated, readRecord, recordFile, hubspotFile, hubspotDir, loadHubspot, tokenInfo, uploadForm,
} from '../../pipeline/hubspot.mjs';
import { socialDir } from '../../pipeline/social.mjs';
import { loadBrand } from '../../pipeline/brand.mjs';
import { readJson, writeJson } from '../../pipeline/env.mjs';

const SLUG = 'smart-scheduling';
const brand = loadBrand();
const original = readJson(hubspotFile(SLUG));
const PAGE = 'https://www.acme.example/features/smart-scheduling';

// the social pack images the sidecar names, as tiny distinct files
function pack(files = ['email-1100x600.png', 'slide-1-cover-1080x1350.png', 'feature-1280x720.png']) {
  fs.mkdirSync(socialDir(SLUG), { recursive: true });
  files.forEach((f, i) => fs.writeFileSync(path.join(socialDir(SLUG), f), Buffer.from(`\x89PNG fake ${f} ${i}`)));
}
const withData = (patch) => writeJson(hubspotFile(SLUG), patch(structuredClone(original)));

beforeEach(() => {
  pack();
  writeJson(hubspotFile(SLUG), original);
  fs.rmSync(recordFile(SLUG), { force: true });
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = 'hs-token';
});
afterEach(() => { delete process.env.HUBSPOT_PRIVATE_APP_TOKEN; delete process.env.HUBSPOT_FILES_FOLDER; });

test('tagLink adds utm_ parameters, keeps a link that has its own, leaves non-URLs alone', () => {
  assert.equal(tagLink(PAGE, { medium: 'email', campaign: 'launch', content: 'button' }), `${PAGE}?utm_source=hubspot&utm_medium=email&utm_campaign=launch&utm_content=button`);
  assert.equal(tagLink(`${PAGE}?utm_source=x`, { medium: 'email' }), `${PAGE}?utm_source=x`);
  assert.equal(tagLink(`${PAGE}?a=1`, { medium: 'social' }), `${PAGE}?a=1&utm_source=hubspot&utm_medium=social`);
  assert.equal(tagLink('not a url'), 'not a url');
});

test('postText puts the tagged link on its own line (or in place); Instagram gets no link', () => {
  const li = postText({ network: 'LINKEDIN', content: 'Hi.', link: PAGE }, SLUG, 'launch');
  assert.equal(li, `Hi.\n\n${PAGE}?utm_source=hubspot&utm_medium=social&utm_campaign=launch&utm_content=linkedin`);
  assert.equal(postText({ network: 'FACEBOOK', content: `Read ${PAGE} now`, link: PAGE }, SLUG), `Read ${PAGE}?utm_source=hubspot&utm_medium=social&utm_campaign=${SLUG}&utm_content=facebook now`);
  assert.equal(postText({ network: 'INSTAGRAM', content: 'Hi. Link in bio.', link: PAGE }, SLUG), 'Hi. Link in bio.');
  assert.equal(postText({ network: 'TWITTER', content: '  Hi.  ' }, SLUG), 'Hi.');
});

test('postLength: characters as each network counts them (X: every link is 23)', () => {
  const t = `Hi ${'x'.repeat(10)} https://example.com/${'a'.repeat(80)}`;
  assert.equal(postLength(t, 'TWITTER'), 3 + 10 + 1 + 23);
  assert.equal(postLength(t, 'LINKEDIN'), [...t].length);
  assert.equal(postLength('📅 ok', 'LINKEDIN'), 4, 'an emoji is one character');
});

test('validateHubspot: the example sidecar is clean', () => {
  assert.deepEqual(validateHubspot(SLUG), { errors: [], warnings: [] });
});

test('validateHubspot: the email\'s missing and overlong parts, bad links and images', () => {
  withData((d) => {
    d.email.subject = 'x'.repeat(EMAIL_LIMITS.subject.warn + 1);
    d.email.previewText = d.email.subject;
    delete d.email.intro;
    d.email.sections = [...d.email.sections, { title: 'Four' , body: 'b' }];
    d.email.cta.url = 'http://insecure.example';
    d.email.imageAlt = '';
    d.email.image = 'nope.png';
    return d;
  });
  const { errors, warnings } = validateHubspot(SLUG);
  assert.ok(errors.includes('email.intro: missing'));
  assert.ok(errors.includes('email.sections: 4 (at most 3 — the page tells the rest)'));
  assert.ok(errors.includes('email.cta.url: "http://insecure.example" is not an https URL'));
  assert.ok(errors.some((m) => /^email\.image: image nope\.png is not in the social pack/.test(m)));
  assert.ok(errors.includes('email.imageAlt: say what the image shows (it is all some readers get)'));
  assert.ok(warnings.includes(`email.subject: ${EMAIL_LIMITS.subject.warn + 1} characters — inboxes cut it after about ${EMAIL_LIMITS.subject.warn}`));
  assert.ok(warnings.includes('email.previewText repeats the subject — say the next thing'));
});

test('validateHubspot: each network\'s limits, required images, links and hashtags', () => {
  withData((d) => {
    d.social = [
      { network: 'TWITTER', content: 'y'.repeat(260), link: PAGE },
      { network: 'INSTAGRAM', content: `See ${PAGE}` },
      { network: 'LINKEDIN', content: 'No link. #a #b #c #d #e #f' },
      { network: 'LINKEDIN', content: 'Again', link: PAGE },
      { network: 'MYSPACE', content: 'x' },
      { network: 'FACEBOOK' },
    ];
    return d;
  });
  const { errors, warnings } = validateHubspot(SLUG);
  assert.ok(errors.includes('social[0] (TWITTER): 285 characters with its link (X allows 280)'), errors.join('\n'));
  assert.ok(errors.includes('social[1] (INSTAGRAM).image: no image'));
  assert.ok(warnings.includes('social[1] (INSTAGRAM): Instagram captions do not link — point to "the link in bio" in the words'));
  assert.ok(warnings.includes('social[2] (LINKEDIN): no link — say where to learn more'));
  assert.ok(warnings.includes('social[2] (LINKEDIN): 6 hashtags (LinkedIn reads best with 5 or fewer)'));
  assert.ok(warnings.includes('social[3] (LINKEDIN): a second LinkedIn post — one per network reads as a launch, more as noise'));
  assert.ok(errors.includes(`social[4] (MYSPACE): network must be one of ${Object.keys(NETWORKS).join(', ')}`));
  assert.ok(errors.includes('social[5] (FACEBOOK): no content'));
});

test('validateHubspot: no sidecar, or nothing in it', () => {
  fs.rmSync(hubspotFile(SLUG));
  assert.match(validateHubspot(SLUG).errors[0], /^no .*hubspot\.json — the hubspot marketer writes it/);
  writeJson(hubspotFile(SLUG), { campaign: 'x' });
  assert.deepEqual(validateHubspot(SLUG).errors, ['nothing to make: give an email, social posts, or both']);
});

test('emailLayout: one column — image, headline, intro, sections, button, footer — in the brand\'s colours, links tagged', () => {
  const layout = emailLayout(loadHubspot(SLUG), brand, { slug: SLUG, imageUrl: 'https://cdn.example/email.png' });
  assert.equal(layout.contentWidth, 600);
  assert.equal(layout.previewText, original.email.previewText);
  assert.equal(layout.sections.length, 1);
  const col = layout.sections[0].columns[0];
  assert.equal(col.width, 12);
  const types = col.modules.map((m) => m._type);
  assert.deepEqual(types, ['EmailImageModule', 'EmailTextModule', 'EmailTextModule', 'EmailTextModule', 'EmailTextModule', 'EmailTextModule', 'EmailButtonModule', 'EmailFooterModule']);
  const [img, h1] = col.modules;
  assert.equal(img.src, 'https://cdn.example/email.png');
  assert.equal(img.alt, original.email.imageAlt);
  assert.match(img.link, /utm_medium=email&utm_campaign=smart-scheduling-launch&utm_content=image$/);
  assert.match(h1.html, /^<h1 [^>]*>Book meetings right inside the conversation<\/h1>$/);
  const button = col.modules.find((m) => m._type === 'EmailButtonModule');
  assert.equal(button.text, 'See how it works');
  assert.equal(button.backgroundColor, brand.colors.cta);
  assert.match(button.linkTarget.destination, /utm_content=button$/);
  assert.equal(emailLayout(loadHubspot(SLUG), brand, { slug: SLUG }).sections[0].columns[0].modules[0].src, null, 'no URL until uploaded');
});

test('buildHubspot: the files, and images not in HubSpot yet as blockers', () => {
  const { dir, email, posts, blockers } = buildHubspot({ slug: SLUG, brand, log: () => {} });
  assert.equal(dir, hubspotDir(SLUG));
  for (const f of ['email.json', 'email.layout.json', 'posts.json', 'preview.html']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.equal(email.subject, original.email.subject);
  assert.deepEqual(posts.map((p) => p.network), ['LINKEDIN', 'TWITTER', 'INSTAGRAM']);
  assert.ok(posts[0].content.endsWith('utm_content=linkedin'));
  assert.ok(!posts[2].content.includes('http'), 'Instagram: no link');
  assert.equal(blockers.length, 4);
  assert.match(blockers[0], /^email image email-1100x600\.png is not in HubSpot yet \(hubspot-assets smart-scheduling --yes\)$/);
  const preview = fs.readFileSync(path.join(dir, 'preview.html'), 'utf8');
  assert.match(preview, /<b>Book meetings without leaving the text thread<\/b>/);
  assert.match(preview, /src="\.\.\/assets\/social\/email-1100x600\.png"/);
  withData((d) => { d.email.cta.url = 'http://x'; return d; });
  assert.throws(() => buildHubspot({ slug: SLUG, brand, log: () => {} }), /hubspot\.json:\n {2}email\.cta\.url/);
});

test('uploadHubspotAssets: each image once, public in the slug\'s folder, recorded by content; the build then uses the URLs', async () => {
  let n = 0;
  const m = mockFetch([{ method: 'POST', url: 'https://api.hubapi.com/files/v3/files', reply: () => ({ json: { id: 100 + ++n, url: `https://cdn.hubspot.example/f${n}.png` } }) }]);
  try {
    const assets = await uploadHubspotAssets({ slug: SLUG, log: () => {} });
    assert.equal(m.calls.length, 3, 'three distinct images');
    assert.equal(m.calls[0].headers.get('authorization'), 'Bearer hs-token');
    const form = m.calls[0].body;
    assert.equal(form.get('folderPath'), '/rollout/smart-scheduling');
    assert.deepEqual(JSON.parse(form.get('options')), { access: 'PUBLIC_NOT_INDEXABLE', overwrite: false, duplicateValidationStrategy: 'NONE' });
    assert.match(form.get('file').name, /^email-1100x600\.[0-9a-f]{16}\.png$/);
    assert.equal(Object.keys(assets).length, 3);
    assert.deepEqual(readRecord(SLUG).assets, assets);

    await uploadHubspotAssets({ slug: SLUG, log: () => {} });
    assert.equal(m.calls.length, 3, 'already uploaded: kept');

    const { blockers, posts } = buildHubspot({ slug: SLUG, brand, log: () => {} });
    assert.deepEqual(blockers, []);
    assert.match(posts[0].image.url, /^https:\/\/cdn\.hubspot\.example\//);
    assert.ok(posts[0].image.fileId);
    const layout = readJson(path.join(hubspotDir(SLUG), 'email.layout.json'));
    assert.match(layout.sections[0].columns[0].modules[0].src, /^https:\/\/cdn\.hubspot\.example\//);

    process.env.HUBSPOT_FILES_FOLDER = '/launches/{slug}';
    pack(['email-1100x600.png']);
    fs.writeFileSync(path.join(socialDir(SLUG), 'email-1100x600.png'), 'changed');
    await uploadHubspotAssets({ slug: SLUG, log: () => {} });
    assert.equal(m.calls.length, 4, 'a changed image is uploaded again');
    assert.equal(m.calls[3].body.get('folderPath'), '/launches/smart-scheduling');
  } finally {
    m.restore();
  }
});

test('uploadHubspotAssets without a token sends no Authorization (a cloud session proxy adds it) and explains 401 and 403', async () => {
  delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  let status = 401;
  const m = mockFetch([{ url: 'https://api.hubapi.com/files/v3/files', reply: () => ({ status, json: { message: 'nope' } }) }]);
  try {
    await assert.rejects(uploadHubspotAssets({ slug: SLUG, log: () => {} }), /HTTP 401: nope \(set HUBSPOT_PRIVATE_APP_TOKEN, or the api\.hubapi\.com network secret in a cloud session\)/);
    assert.equal(m.calls[0].headers.get('authorization'), null);
    process.env.HUBSPOT_PRIVATE_APP_TOKEN = 't';
    status = 403;
    await assert.rejects(uploadHubspotAssets({ slug: SLUG, log: () => {} }), /HTTP 403: nope \(the private app needs the "files" scope\)/);
  } finally {
    m.restore();
  }
});

test('uploadForm: the file, its name, the folder, public and not indexed; only images, only absolute folders', () => {
  const full = path.join(socialDir(SLUG), 'email-1100x600.png');
  const form = uploadForm(full, { folderPath: '/rollout/x', fileName: 'a.png' });
  assert.equal(form.get('fileName'), 'a.png');
  assert.equal(form.get('file').type, 'image/png');
  assert.equal(uploadForm(full, { folderPath: '/r', fileName: 'a.webp' }).get('file').type, 'image/webp');
  assert.throws(() => uploadForm(full, { folderPath: '/r', fileName: 'a.gif' }), /a.gif: only .png .jpg .jpeg .webp can be uploaded/);
  assert.throws(() => uploadForm(full, { folderPath: 'relative', fileName: 'a.png' }), /must be an absolute HubSpot folder path/);
});

test('tokenInfo: the lookup HubSpot offers of what the private app may do; the token is never sent as a header', async () => {
  const m = mockFetch([{ method: 'POST', url: 'https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info', reply: { json: { hubId: 42, appId: 7, scopes: ['files', 'oauth'] } } }]);
  try {
    assert.deepEqual(await tokenInfo(), { hubId: 42, appId: 7, scopes: ['files', 'oauth'] });
    assert.equal(JSON.parse(m.calls[0].body).tokenKey, 'hs-token');
    assert.equal(m.calls[0].headers.get('authorization'), null);
  } finally {
    m.restore();
  }
  delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  await assert.rejects(tokenInfo(), /HUBSPOT_PRIVATE_APP_TOKEN is not set/);
});

test('recordCreated keeps the email and each post (guid, channel, link) beside the uploaded files; the build shows them', () => {
  recordCreated(SLUG, { email: { id: 555, url: 'https://app.hubspot.com/email/1/edit/555' } });
  const r = recordCreated(SLUG, { post: { network: 'LINKEDIN', guid: 'guid-1', channel: 'ch-9', url: 'https://app.hubspot.com/social/1/x' } });
  assert.equal(r.email.id, '555');
  assert.equal(r.email.url, 'https://app.hubspot.com/email/1/edit/555');
  assert.deepEqual({ ...r.posts.LINKEDIN, createdAt: undefined }, { id: 'guid-1', channel: 'ch-9', url: 'https://app.hubspot.com/social/1/x', createdAt: undefined });
  assert.match(r.posts.LINKEDIN.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.throws(() => recordCreated(SLUG, { post: { network: 'MYSPACE', guid: 'x' } }), /no network MYSPACE/);
  const { email, posts } = buildHubspot({ slug: SLUG, brand, log: () => {} });
  assert.equal(email.created.id, '555');
  assert.equal(posts[0].created.channel, 'ch-9');
  assert.equal(posts[1].created, null);
});
