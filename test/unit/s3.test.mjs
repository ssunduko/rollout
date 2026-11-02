import '../setup.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mockFetch } from '../helpers.mjs';
import { signature, connect } from '../../pipeline/imagestore/s3.mjs';

// The worked examples in AWS's "Signature Version 4: authenticating requests"
// documentation for S3 (examplebucket, 24 May 2013).
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
const DATE = '20130524T000000Z';
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const HOST = 'examplebucket.s3.amazonaws.com';
const aws = (o) => signature({ region: 'us-east-1', secret: SECRET, date: DATE, ...o });

test('signature: AWS example GET object', () => {
  const s = aws({ method: 'GET', path: '/test.txt', headers: { Host: HOST, Range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY, 'x-amz-date': DATE }, payloadHash: EMPTY });
  assert.equal(s.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  assert.equal(s.signedHeaders, 'host;range;x-amz-content-sha256;x-amz-date');
  assert.equal(s.scope, '20130524/us-east-1/s3/aws4_request');
});

test('signature: AWS example PUT object (path encoding, extra headers)', () => {
  const payload = '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072';
  const s = aws({
    method: 'PUT', path: '/test$file.text', payloadHash: payload,
    headers: { Host: HOST, Date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-date': DATE, 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': payload },
  });
  assert.equal(s.signature, '98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

test('signature: AWS example GET bucket lifecycle (empty query value)', () => {
  const s = aws({ method: 'GET', path: '/', query: { lifecycle: '' }, headers: { Host: HOST, 'x-amz-date': DATE, 'x-amz-content-sha256': EMPTY }, payloadHash: EMPTY });
  assert.equal(s.signature, 'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
});

test('signature: AWS example presigned URL', () => {
  const s = aws({
    method: 'GET', path: '/test.txt', payloadHash: 'UNSIGNED-PAYLOAD', headers: { host: HOST },
    query: {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': 'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
      'X-Amz-Date': DATE, 'X-Amz-Expires': 86400, 'X-Amz-SignedHeaders': 'host',
    },
  });
  assert.equal(s.signature, 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

const KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_REGION', 'AWS_PROFILE'];
let mock;
beforeEach(() => {
  for (const k of KEYS) delete process.env[k];
  process.env.AWS_ACCESS_KEY_ID = 'AKIDTEST';
  process.env.AWS_SECRET_ACCESS_KEY = 'secret';
});
afterEach(() => mock?.restore());

test('connect: a bucket is required', () => {
  assert.throws(() => connect({}), /HELP_IMAGE_BUCKET is not set/);
});

test('connect: no credentials anywhere is an error naming the profile', () => {
  delete process.env.AWS_ACCESS_KEY_ID;
  delete process.env.AWS_SECRET_ACCESS_KEY;
  process.env.AWS_PROFILE = 'rollout-test-no-such-profile';
  assert.throws(() => connect({ bucket: 'b', region: 'us-east-1' }), /no S3 credentials.*rollout-test-no-such-profile/);
});

test('describe and region fallbacks', () => {
  assert.equal(connect({ bucket: 'b', region: 'eu-west-1' }).describe(), 's3://b (eu-west-1)');
  process.env.AWS_REGION = 'ap-south-1';
  assert.equal(connect({ bucket: 'b' }).describe(), 's3://b (ap-south-1)');
});

test('put: virtual-hosted URL, signed headers, the body', async () => {
  mock = mockFetch([{ method: 'PUT', url: 'https://imgs.s3.us-east-1.amazonaws.com/help/a%20b.png', reply: { status: 200 } }]);
  const data = Buffer.from('png-bytes');
  await connect({ bucket: 'imgs', region: 'us-east-1' }).put('help/a b.png', data, 'image/png');
  const req = mock.calls[0];
  assert.equal(req.headers.get('content-type'), 'image/png');
  assert.equal(req.headers.get('x-amz-content-sha256'), crypto.createHash('sha256').update(data).digest('hex'));
  assert.match(req.headers.get('x-amz-date'), /^\d{8}T\d{6}Z$/);
  assert.match(req.headers.get('authorization'), /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=content-length;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(req.headers.get('host'), null, 'host is set by fetch, not sent by hand');
  assert.equal(req.body, data);
});

test('put: a session token is sent and signed; errors carry S3\'s message', async () => {
  process.env.AWS_SESSION_TOKEN = 'sess';
  mock = mockFetch([{ method: 'PUT', url: /amazonaws\.com/, reply: { status: 403, text: '<Error><Message>Access Denied</Message></Error>' } }]);
  await assert.rejects(connect({ bucket: 'imgs', region: 'us-east-1' }).put('k.png', Buffer.from('x'), 'image/png'), /S3 PUT k\.png: 403 Access Denied/);
  assert.equal(mock.calls[0].headers.get('x-amz-security-token'), 'sess');
  assert.match(mock.calls[0].headers.get('authorization'), /x-amz-security-token/);
});

test('path-style for a dotted bucket and for a custom endpoint', async () => {
  mock = mockFetch([{ method: 'PUT', url: /./, reply: { status: 200 } }]);
  await connect({ bucket: 'img.acme.example', region: 'us-west-2' }).put('k.png', Buffer.from('x'), 'image/png');
  await connect({ bucket: 'b', region: 'auto', endpoint: 'https://store.acme.example/s3/' }).put('k.png', Buffer.from('x'), 'image/png');
  assert.equal(mock.calls[0].url, 'https://s3.us-west-2.amazonaws.com/img.acme.example/k.png');
  assert.equal(mock.calls[1].url, 'https://store.acme.example/s3/b/k.png');
});

test('exists: 200 yes, 404 and 403 no, anything else throws', async () => {
  const replies = [200, 404, 403, 500];
  mock = mockFetch([{ method: 'HEAD', url: /./, reply: () => ({ status: replies.shift() }) }]);
  const s = connect({ bucket: 'b', region: 'us-east-1' });
  assert.equal(await s.exists('k'), true);
  assert.equal(await s.exists('k'), false);
  assert.equal(await s.exists('k'), false);
  await assert.rejects(s.exists('k'), /S3 HEAD k: 500/);
});

test('url: a presigned GET, expiry clamped to 7 days', () => {
  const u = new URL(connect({ bucket: 'b', region: 'us-east-1' }).url('help/x.png', 10 ** 9));
  assert.equal(u.origin + u.pathname, 'https://b.s3.us-east-1.amazonaws.com/help/x.png');
  assert.equal(u.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.match(u.searchParams.get('X-Amz-Credential'), /^AKIDTEST\/\d{8}\/us-east-1\/s3\/aws4_request$/);
  assert.equal(u.searchParams.get('X-Amz-Expires'), '604800');
  assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.match(u.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
  assert.equal(new URL(connect({ bucket: 'b', region: 'us-east-1' }).url('k', 0)).searchParams.get('X-Amz-Expires'), '1');
});
