// Google Drive adapter for pipeline/podcast.mjs: reads the feature video
// through the Drive API v3, signed in one of two ways:
//
//   as a person (rollout.mjs google-login), reading what they can see:
//     GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET  an OAuth client of type "Desktop app"
//     GOOGLE_OAUTH_REFRESH_TOKEN                          written by google-login. Secret
//   or as a service account, reading what is shared with it:
//     GOOGLE_SERVICE_ACCOUNT_KEY_FILE                     its JSON key; share the video folder
//                                                         with its client_email (Viewer)
//
// A refresh token, when set, wins. Either way the access token is
// drive.readonly. Nothing is written to disk: the file is read into memory
// and handed to the transcription service.

import fs from 'node:fs';
import crypto from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

const b64url = (data) => Buffer.from(data).toString('base64url');

// A Drive file id from a share link (…/file/d/<id>/view, ?id=<id>) or the id itself.
export function driveFileId(ref) {
  const s = String(ref ?? '').trim();
  return s.match(/\/d\/([\w-]{10,})/)?.[1] ?? s.match(/[?&]id=([\w-]{10,})/)?.[1] ?? (/^[\w-]{10,}$/.test(s) ? s : null);
}

// Trade a grant for an access token at Google's token endpoint.
async function grant(tokenUri, params) {
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = json.error === 'invalid_grant' && params.grant_type === 'refresh_token' ? ' — the sign-in expired or was revoked: run rollout.mjs google-login again' : '';
    throw new Error(`video source sign-in -> ${res.status} ${json.error_description ?? json.error ?? ''}${hint}`);
  }
  return json;
}

// How the adapter signs in: { account, fetchToken() -> { access_token, expires_in } }
function signIn({ keyFile, oauth }) {
  if (oauth?.refreshToken) {
    if (!oauth.clientId || !oauth.clientSecret) throw new Error('GOOGLE_OAUTH_REFRESH_TOKEN is set but GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not');
    return {
      account: 'signed in by google-login',
      fetchToken: () => grant(TOKEN_URI, { grant_type: 'refresh_token', client_id: oauth.clientId, client_secret: oauth.clientSecret, refresh_token: oauth.refreshToken }),
    };
  }
  if (!keyFile) throw new Error('no Google sign-in: run rollout.mjs google-login (GOOGLE_OAUTH_CLIENT_ID / _SECRET in .env), or set GOOGLE_SERVICE_ACCOUNT_KEY_FILE');
  if (/^https?:/i.test(keyFile)) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY_FILE is a link — it is the path to the service account\'s JSON key file');
  if (!fs.existsSync(keyFile)) throw new Error(`GOOGLE_SERVICE_ACCOUNT_KEY_FILE: no file at ${keyFile}`);
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  if (!key.client_email || !key.private_key) throw new Error(`${keyFile} is not a service account key (no client_email / private_key)`);
  const tokenUri = key.token_uri ?? TOKEN_URI;
  return {
    account: `service account ${key.client_email} — share the video folder with it`,
    // a JWT signed with the account's private key
    fetchToken: () => {
      const now = Math.floor(Date.now() / 1000);
      const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }));
      const signature = crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(key.private_key, 'base64url');
      return grant(tokenUri, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${signature}` });
    },
  };
}

export function connect({ keyFile, oauth }) {
  const auth = signIn({ keyFile, oauth });
  let token = null;

  const accessToken = async () => {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const json = await auth.fetchToken();
    token = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
    return token.value;
  };

  const call = async (route) => {
    const res = await fetch(`${API}${route}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!res.ok) {
      const why = (await res.text()).slice(0, 300);
      const hint = res.status === 404 ? ` — can the signed-in account (${auth.account.replace(/ — .*/, '')}) open it?` : '';
      throw new Error(`video source GET ${route.split('?')[0]} -> ${res.status} ${why}${hint}`);
    }
    return res;
  };

  return {
    account: auth.account,
    // who Drive sees: proves the sign-in works
    async whoami() {
      const r = await (await call('/about?fields=user(emailAddress,displayName)')).json();
      return { email: r.user?.emailAddress ?? null, name: r.user?.displayName ?? null };
    },
    // { id, name, mimeType, size, md5, modifiedAt }
    async file(ref) {
      const id = driveFileId(ref);
      if (!id) throw new Error(`"${ref}" is not a Drive file link or id`);
      const f = await (await call(`/files/${id}?fields=id,name,mimeType,size,md5Checksum,modifiedTime&supportsAllDrives=true`)).json();
      return { id: f.id, name: f.name, mimeType: f.mimeType, size: Number(f.size ?? 0), md5: f.md5Checksum ?? null, modifiedAt: f.modifiedTime ?? null };
    },
    // the file's bytes, as a Blob ready for a multipart upload
    async download(ref) {
      const meta = await this.file(ref);
      const res = await call(`/files/${meta.id}?alt=media&supportsAllDrives=true`);
      return { ...meta, blob: new Blob([await res.arrayBuffer()], { type: meta.mimeType }) };
    },
  };
}

// The one-time sign-in as a person (rollout.mjs google-login): Google's
// installed-app flow with PKCE, back to a loopback address. offline access and
// the consent prompt make Google return a refresh token.
export function authorizeUrl({ clientId, redirectUri, state }) {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, state,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256',
  })}`;
  return { url, verifier };
}

export async function exchangeCode({ clientId, clientSecret, redirectUri, code, verifier }) {
  const json = await grant(TOKEN_URI, { grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code, code_verifier: verifier });
  if (!json.refresh_token) throw new Error('Google returned no refresh token — remove the app\'s access at myaccount.google.com/permissions and run google-login again');
  return { refreshToken: json.refresh_token };
}
