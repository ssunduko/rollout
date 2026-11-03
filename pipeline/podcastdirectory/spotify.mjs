// Spotify adapter for pipeline/podcast.mjs: finds a published episode on the
// show through the Spotify Web API, with the Client Credentials flow (an app
// token; no user signs in).
//
//   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET   the app (developer.spotify.com). Secret
//   SPOTIFY_SHOW_ID    the show, as Spotify lists it (open.spotify.com/show/<id>)
//   SPOTIFY_MARKET     the market episodes are read in (default US)
//   SPOTIFY_REFRESH_TOKEN   written by spotify-login: a person's sign-in, so the
//                      episode can be saved to their library. Secret
//
// The Web API cannot publish: episodes reach Spotify through the podcast
// host's RSS feed, usually within hours of being published there. With a
// person's sign-in it can save the episode to their library ("Your Library").

const AUTHORIZE = 'https://accounts.spotify.com/authorize';
const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
// saving to and reading the person's library
export const SCOPE = 'user-library-modify user-library-read';

const basic = (clientId, clientSecret) => `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;

async function tokenRequest({ clientId, clientSecret, params, what }) {
  const res = await fetch(ACCOUNTS, {
    method: 'POST',
    headers: { Authorization: basic(clientId, clientSecret), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = json.error === 'invalid_grant' && params.grant_type === 'refresh_token' ? ' — the sign-in expired or was revoked: run rollout.mjs spotify-login again' : '';
    throw new Error(`${what} -> ${res.status} ${json.error_description ?? json.error ?? ''}${hint}`);
  }
  return json;
}

// The one-time sign-in as a person (rollout.mjs spotify-login): the
// Authorization Code flow back to a loopback address, which must be listed
// in the app's Redirect URIs (Spotify takes 127.0.0.1, never "localhost").
export function authorizeUrl({ clientId, redirectUri, state }) {
  return `${AUTHORIZE}?${new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, scope: SCOPE, state, show_dialog: 'true' })}`;
}

export async function exchangeCode({ clientId, clientSecret, redirectUri, code }) {
  const json = await tokenRequest({ clientId, clientSecret, what: 'Spotify sign-in', params: { grant_type: 'authorization_code', code, redirect_uri: redirectUri } });
  if (!json.refresh_token) throw new Error('Spotify returned no refresh token — run spotify-login again');
  return { refreshToken: json.refresh_token, scope: json.scope ?? '' };
}

export function connect({ clientId, clientSecret, showId, market = 'US', refreshToken = null }) {
  if (!clientId || !clientSecret) throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set in .env');
  let token = null;
  const accessToken = async () => {
    if (token && token.expires > Date.now() + 60_000) return token.value;
    const res = await fetch(ACCOUNTS, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`podcast directory sign-in -> ${res.status} ${json.error_description ?? json.error ?? ''}`);
    token = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
    return token.value;
  };
  // the person's token, from SPOTIFY_REFRESH_TOKEN; Spotify may hand back a
  // new refresh token, which replaces the old one (rotatedRefreshToken)
  let user = null;
  let rotated = null;
  const userToken = async () => {
    if (!refreshToken) throw new Error('no Spotify sign-in: run rollout.mjs spotify-login (it saves SPOTIFY_REFRESH_TOKEN in .env)');
    if (user && user.expires > Date.now() + 60_000) return user.value;
    const current = rotated ?? refreshToken;
    const json = await tokenRequest({ clientId, clientSecret, what: 'Spotify sign-in', params: { grant_type: 'refresh_token', refresh_token: current } });
    if (json.refresh_token && json.refresh_token !== current) rotated = json.refresh_token;
    user = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
    return user.value;
  };
  const asUser = async (method, route) => {
    const res = await fetch(`${API}${route}`, { method, headers: { Authorization: `Bearer ${await userToken()}` } });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* plain-text errors */ }
    if (!res.ok) {
      const hint = res.status === 403 ? ' — sign in again with rollout.mjs spotify-login (library permission), and check the app owner has Premium' : '';
      throw new Error(`podcast directory ${method} ${route.split('?')[0]} -> ${res.status} ${json?.error?.message ?? text.slice(0, 300)}${hint}`);
    }
    return json;
  };

  const get = async (route) => {
    const res = await fetch(`${API}${route}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* some errors come as plain text */ }
    if (!res.ok) throw new Error(`podcast directory GET ${route.split('?')[0]} -> ${res.status} ${json.error?.message ?? text.slice(0, 300)}`);
    return json;
  };
  const episode = (e) => ({
    id: e.id,
    title: e.name,
    releaseDate: e.release_date ?? null,
    url: e.external_urls?.spotify ?? `https://open.spotify.com/episode/${e.id}`,
    embedUrl: `https://open.spotify.com/embed/episode/${e.id}`,
  });

  return {
    async show(id = showId) {
      if (!id) throw new Error('SPOTIFY_SHOW_ID is not set in .env');
      const s = await get(`/shows/${encodeURIComponent(id)}?market=${market}`);
      return { id: s.id, title: s.name, publisher: s.publisher, episodes: s.total_episodes ?? null, url: s.external_urls?.spotify ?? null };
    },
    // the show's newest episodes
    async episodes({ id = showId, limit = 50 } = {}) {
      if (!id) throw new Error('SPOTIFY_SHOW_ID is not set in .env');
      const r = await get(`/shows/${encodeURIComponent(id)}/episodes?market=${market}&limit=${limit}`);
      return (r.items ?? []).filter(Boolean).map(episode);
    },
    // whether a person signed in (spotify-login), so saveEpisode can run
    signedIn: Boolean(refreshToken),
    // Save the episode to the signed-in person's library; a no-op when it is
    // there already. Returns { saved: true, already }.
    async saveEpisode(id) {
      if (!id) throw new Error('saveEpisode: no episode id');
      const uris = encodeURIComponent(`spotify:episode:${id}`);
      const [has] = (await asUser('GET', `/me/library/contains?uris=${uris}`)) ?? [];
      if (has === true) return { saved: true, already: true };
      await asUser('PUT', `/me/library?uris=${uris}`);
      return { saved: true, already: false };
    },
    // a refresh token Spotify issued in place of SPOTIFY_REFRESH_TOKEN, or null
    rotatedRefreshToken: () => rotated,
  };
}
