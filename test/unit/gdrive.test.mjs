import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { mockFetch, bodyOf, SANDBOX } from '../helpers.mjs';
import { driveFileId, authorizeUrl, exchangeCode, connect } from '../../pipeline/videosource/gdrive.mjs';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const OAUTH = { clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtok' };

test('driveFileId: every link form and the bare id', () => {
  for (const ref of [
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/file/d/${ID}/view`,
    `https://drive.google.com/file/d/${ID}`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?export=download&id=${ID}`,
    `https://docs.google.com/document/d/${ID}/edit`,
    ID,
    `  ${ID}  `,
  ]) assert.equal(driveFileId(ref), ID, ref);
});

test('driveFileId: not a Drive file', () => {
  for (const ref of [undefined, null, '', 'short', 'https://example.com/video.mp4', 'has spaces in it ok']) assert.equal(driveFileId(ref), null, String(ref));
});

test('authorizeUrl: offline consent, read-only scope, PKCE S256 matching the verifier', () => {
  const { url, verifier } = authorizeUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:8766/callback', state: 'st' });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  const q = Object.fromEntries(u.searchParams);
  assert.equal(q.client_id, 'cid');
  assert.equal(q.redirect_uri, 'http://127.0.0.1:8766/callback');
  assert.equal(q.response_type, 'code');
  assert.equal(q.scope, 'https://www.googleapis.com/auth/drive.readonly');
  assert.equal(q.state, 'st');
  assert.equal(q.access_type, 'offline');
  assert.equal(q.prompt, 'consent');
  assert.equal(q.code_challenge_method, 'S256');
  assert.match(verifier, /^[A-Za-z0-9_-]{43,128}$/, 'an RFC 7636 verifier');
  assert.equal(q.code_challenge, crypto.createHash('sha256').update(verifier).digest('base64url'));
  assert.notEqual(authorizeUrl({ clientId: 'cid', redirectUri: 'x', state: 's' }).verifier, verifier, 'a new verifier each time');
});

test('exchangeCode: sends the code and verifier, returns the refresh token', async () => {
  const m = mockFetch([{ method: 'POST', url: TOKEN, reply: { json: { access_token: 'a', refresh_token: 'r1', expires_in: 3600 } } }]);
  try {
    assert.deepEqual(await exchangeCode({ clientId: 'cid', clientSecret: 'cs', redirectUri: 'http://127.0.0.1/cb', code: 'c0de', verifier: 'v' }), { refreshToken: 'r1' });
    const sent = Object.fromEntries(new URLSearchParams(await bodyOf(m.calls[0])));
    assert.deepEqual(sent, { grant_type: 'authorization_code', client_id: 'cid', client_secret: 'cs', redirect_uri: 'http://127.0.0.1/cb', code: 'c0de', code_verifier: 'v' });
    assert.equal(m.calls[0].headers.get('content-type'), 'application/x-www-form-urlencoded');
  } finally {
    m.restore();
  }
});

test('exchangeCode: no refresh token, or a refused code, is an error', async () => {
  let m = mockFetch([{ url: TOKEN, reply: { json: { access_token: 'a' } } }]);
  try {
    await assert.rejects(exchangeCode({ clientId: 'c', clientSecret: 's', redirectUri: 'r', code: 'x', verifier: 'v' }), /no refresh token/);
  } finally {
    m.restore();
  }
  m = mockFetch([{ url: TOKEN, reply: { status: 400, json: { error: 'invalid_grant', error_description: 'Bad Request' } } }]);
  try {
    await assert.rejects(exchangeCode({ clientId: 'c', clientSecret: 's', redirectUri: 'r', code: 'x', verifier: 'v' }), (e) => /sign-in -> 400 Bad Request$/.test(e.message));
  } finally {
    m.restore();
  }
});

test('connect: which sign-in, and the errors when there is none', () => {
  assert.equal(connect({ oauth: OAUTH }).account, 'signed in by google-login');
  assert.throws(() => connect({ oauth: { refreshToken: 'r' } }), /GOOGLE_OAUTH_CLIENT_ID \/ GOOGLE_OAUTH_CLIENT_SECRET are not/);
  assert.throws(() => connect({}), /no Google sign-in/);
  assert.throws(() => connect({ oauth: {} }), /no Google sign-in/);
  assert.throws(() => connect({ keyFile: 'https://drive.google.com/x' }), /is a link/);
  assert.throws(() => connect({ keyFile: path.join(SANDBOX, 'missing.json') }), /no file at/);
  const notKey = path.join(SANDBOX, 'not-a-key.json');
  fs.writeFileSync(notKey, '{"type":"authorized_user"}');
  assert.throws(() => connect({ keyFile: notKey }), /is not a service account key/);
});

const driveRoutes = (n) => [
  { method: 'POST', url: TOKEN, reply: () => { n.count++; return { json: { access_token: `at${n.count}`, expires_in: 3600 } }; } },
  { url: `${API}/about`, reply: { json: { user: { emailAddress: 'pat@acme.example', displayName: 'Pat' } } } },
  { url: /\/files\/[^?]+\?alt=media/, reply: { body: Buffer.from('VIDEOBYTES') } },
  { url: `${API}/files/${ID}?fields=`, reply: { json: { id: ID, name: 'demo.mp4', mimeType: 'video/mp4', size: '10', md5Checksum: 'abc', modifiedTime: '2026-10-01T00:00:00Z' } } },
];

test('OAuth: the refresh grant, bearer calls, one token for many calls', async () => {
  const n = { count: 0 };
  const m = mockFetch(driveRoutes(n));
  try {
    const d = connect({ oauth: OAUTH });
    assert.deepEqual(await d.whoami(), { email: 'pat@acme.example', name: 'Pat' });
    const f = await d.file(`https://drive.google.com/file/d/${ID}/view`);
    assert.deepEqual(f, { id: ID, name: 'demo.mp4', mimeType: 'video/mp4', size: 10, md5: 'abc', modifiedAt: '2026-10-01T00:00:00Z' });
    assert.equal(n.count, 1);
    const grant = Object.fromEntries(new URLSearchParams(await bodyOf(m.calls[0])));
    assert.deepEqual(grant, { grant_type: 'refresh_token', client_id: 'cid', client_secret: 'csecret', refresh_token: 'rtok' });
    assert.equal(m.calls[1].headers.get('authorization'), 'Bearer at1');
    assert.match(m.calls[2].url, /supportsAllDrives=true/);
  } finally {
    m.restore();
  }
});

test('download: the bytes as a Blob of the file\'s type', async () => {
  const m = mockFetch(driveRoutes({ count: 0 }));
  try {
    const v = await connect({ oauth: OAUTH }).download(ID);
    assert.equal(v.name, 'demo.mp4');
    assert.ok(v.blob instanceof Blob);
    assert.equal(v.blob.type, 'video/mp4');
    assert.equal(Buffer.from(await v.blob.arrayBuffer()).toString(), 'VIDEOBYTES');
    assert.match(m.calls.at(-1).url, new RegExp(`/files/${ID}\\?alt=media&supportsAllDrives=true$`));
  } finally {
    m.restore();
  }
});

test('file: not a link; 404 hints at access; an expired sign-in says to sign in again', async () => {
  let m = mockFetch([{ url: TOKEN, reply: { json: { access_token: 'a', expires_in: 3600 } } }, { url: `${API}/files/`, reply: { status: 404, text: 'File not found' } }]);
  try {
    const d = connect({ oauth: OAUTH });
    await assert.rejects(d.file('not a link'), /is not a Drive file link or id/);
    await assert.rejects(d.file(ID), /video source GET \/files\/1AbCd\S+ -> 404 File not found — can the signed-in account \(signed in by google-login\) open it\?/);
  } finally {
    m.restore();
  }
  m = mockFetch([{ url: TOKEN, reply: { status: 400, json: { error: 'invalid_grant' } } }]);
  try {
    await assert.rejects(connect({ oauth: OAUTH }).whoami(), /run rollout\.mjs google-login again/);
  } finally {
    m.restore();
  }
});

test('service account: a signed RS256 JWT for the read-only scope, to the key\'s token URI', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyFile = path.join(SANDBOX, 'sa-key.json');
  fs.writeFileSync(keyFile, JSON.stringify({
    type: 'service_account', client_email: 'bot@acme-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.test/token',
  }));
  const m = mockFetch([
    { method: 'POST', url: 'https://oauth2.test/token', reply: { json: { access_token: 'sa-tok', expires_in: 3600 } } },
    { url: `${API}/about`, reply: { json: { user: { emailAddress: 'bot@acme-test.iam.gserviceaccount.com' } } } },
  ]);
  try {
    const d = connect({ keyFile });
    assert.match(d.account, /^service account bot@acme-test\.iam\.gserviceaccount\.com — share/);
    assert.deepEqual(await d.whoami(), { email: 'bot@acme-test.iam.gserviceaccount.com', name: null });
    const sent = Object.fromEntries(new URLSearchParams(await bodyOf(m.calls[0])));
    assert.equal(sent.grant_type, 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [head, claims, sig] = sent.assertion.split('.');
    assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'RS256', typ: 'JWT' });
    const c = JSON.parse(Buffer.from(claims, 'base64url'));
    assert.equal(c.iss, 'bot@acme-test.iam.gserviceaccount.com');
    assert.equal(c.scope, 'https://www.googleapis.com/auth/drive.readonly');
    assert.equal(c.aud, 'https://oauth2.test/token');
    assert.equal(c.exp - c.iat, 3600);
    assert.ok(crypto.createVerify('RSA-SHA256').update(`${head}.${claims}`).verify(publicKey, Buffer.from(sig, 'base64url')), 'signature verifies with the public key');
    assert.equal(m.calls[1].headers.get('authorization'), 'Bearer sa-tok');
  } finally {
    m.restore();
  }
});

test('a refresh token wins over a service account key', () => {
  assert.equal(connect({ oauth: OAUTH, keyFile: 'whatever.json' }).account, 'signed in by google-login');
});
