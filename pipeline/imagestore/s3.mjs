// S3, or any S3-compatible store (HELP_IMAGE_ENDPOINT), as the help article's
// image store. Requests are signed with Signature Version 4 over fetch — no
// SDK. Links are presigned GET URLs unless the objects are public behind a
// base URL, so the bucket can stay private: the help center only needs to
// read each image once, when it makes its own copy.
//
// Credentials: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (/ AWS_SESSION_TOKEN),
// else the profile (AWS_PROFILE, default "default") in ~/.aws/credentials.
// Region: HELP_IMAGE_REGION, AWS_REGION, the profile's region in
// ~/.aws/config, else us-east-1.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../env.mjs';

const UNSIGNED = 'UNSIGNED-PAYLOAD';
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// RFC 3986 encoding, as the signature expects it
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encPath = (p) => p.split('/').map(enc).join('/');
const amzDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// The Signature V4 signature of one request. path is unencoded; query and
// headers are plain objects (headers must include host).
export function signature({ method, path: p, query = {}, headers, payloadHash, region, secret, date }) {
  const day = date.slice(0, 8);
  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const names = Object.keys(h).sort();
  const canonical = [
    method,
    encPath(p),
    Object.entries(query).map(([k, v]) => [enc(k), enc(String(v))]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&'),
    names.map((n) => `${n}:${h[n]}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonical)].join('\n');
  const key = ['s3', 'aws4_request'].reduce(hmac, hmac(hmac(`AWS4${secret}`, day), region));
  return { signature: crypto.createHmac('sha256', key).update(toSign).digest('hex'), scope, signedHeaders: names.join(';') };
}

// One INI file's [section] as an object; {} when the file or section is missing.
function iniSection(file, name) {
  if (!fs.existsSync(file)) return {};
  let cur = null;
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (s) { cur = s[1].trim(); continue; }
    const kv = line.match(/^\s*([^=#;\s]+)\s*=\s*(.*?)\s*$/);
    if (kv && cur === name) out[kv[1]] = kv[2];
  }
  return out;
}

function credentials() {
  if (env('AWS_ACCESS_KEY_ID') && env('AWS_SECRET_ACCESS_KEY')) {
    return { id: env('AWS_ACCESS_KEY_ID'), secret: env('AWS_SECRET_ACCESS_KEY'), token: env('AWS_SESSION_TOKEN') };
  }
  const profile = env('AWS_PROFILE', 'default');
  const file = path.join(os.homedir(), '.aws', 'credentials');
  const c = iniSection(file, profile);
  if (!c.aws_access_key_id || !c.aws_secret_access_key) {
    throw new Error(`no S3 credentials: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env, or keys for profile "${profile}" in ${file}`);
  }
  return { id: c.aws_access_key_id, secret: c.aws_secret_access_key, token: c.aws_session_token };
}

function profileRegion() {
  const profile = env('AWS_PROFILE', 'default');
  const file = path.join(os.homedir(), '.aws', 'config');
  return iniSection(file, profile === 'default' ? 'default' : `profile ${profile}`).region;
}

export function connect({ bucket, region, endpoint }) {
  if (!bucket) throw new Error('HELP_IMAGE_BUCKET is not set in .env');
  region = region ?? env('AWS_REGION') ?? profileRegion() ?? 'us-east-1';
  const creds = credentials();
  // virtual-hosted on S3 itself; path-style for a custom endpoint or a dotted bucket name (TLS)
  const base = endpoint
    ? { origin: endpoint.replace(/\/$/, ''), prefix: `/${bucket}` }
    : bucket.includes('.')
      ? { origin: `https://s3.${region}.amazonaws.com`, prefix: `/${bucket}` }
      : { origin: `https://${bucket}.s3.${region}.amazonaws.com`, prefix: '' };
  const { host, origin, pathname } = new URL(base.origin);
  const objectPath = (key) => `${pathname.replace(/\/$/, '')}${base.prefix}/${key}`;

  async function send(method, key, body) {
    const date = amzDate(new Date());
    const payloadHash = body ? sha256(body.data) : sha256('');
    const headers = { host, 'x-amz-date': date, 'x-amz-content-sha256': payloadHash };
    if (creds.token) headers['x-amz-security-token'] = creds.token;
    if (body) Object.assign(headers, { 'content-type': body.type, 'content-length': body.data.length });
    const p = objectPath(key);
    const s = signature({ method, path: p, headers, payloadHash, region, secret: creds.secret, date });
    const { host: _, ...sent } = headers;
    return fetch(`${origin}${encPath(p)}`, {
      method,
      headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${creds.id}/${s.scope}, SignedHeaders=${s.signedHeaders}, Signature=${s.signature}` },
      body: body?.data,
    });
  }

  return {
    describe: () => `s3://${bucket} (${region})`,

    async exists(key) {
      const r = await send('HEAD', key);
      if (r.status === 404 || r.status === 403) return false; // 403: no ListBucket right, so a missing key reads as forbidden
      if (!r.ok) throw new Error(`S3 HEAD ${key}: ${r.status} ${r.statusText}`);
      return true;
    },

    async put(key, data, type) {
      const r = await send('PUT', key, { data, type });
      if (!r.ok) throw new Error(`S3 PUT ${key}: ${r.status} ${(await r.text()).match(/<Message>([^<]*)/)?.[1] ?? r.statusText}`);
    },

    // a GET URL valid for ttl seconds (at most 7 days)
    url(key, ttl) {
      const date = amzDate(new Date());
      const query = {
        'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
        'X-Amz-Credential': `${creds.id}/${date.slice(0, 8)}/${region}/s3/aws4_request`,
        'X-Amz-Date': date,
        'X-Amz-Expires': Math.min(Math.max(1, ttl), 604800),
        'X-Amz-SignedHeaders': 'host',
      };
      if (creds.token) query['X-Amz-Security-Token'] = creds.token;
      const p = objectPath(key);
      const s = signature({ method: 'GET', path: p, query, headers: { host }, payloadHash: UNSIGNED, region, secret: creds.secret, date });
      const qs = Object.entries({ ...query, 'X-Amz-Signature': s.signature }).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join('&');
      return `${origin}${encPath(p)}?${qs}`;
    },
  };
}
