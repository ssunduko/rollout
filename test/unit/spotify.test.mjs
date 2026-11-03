import '../setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockFetch, bodyOf } from '../helpers.mjs';
import { connect, authorizeUrl, exchangeCode, SCOPE } from '../../pipeline/podcastdirectory/spotify.mjs';

const TOKEN = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const signIn = (n = { count: 0 }) => ({ method: 'POST', url: TOKEN, reply: () => { n.count++; return { json: { access_token: `tok${n.count}`, expires_in: 3600 } }; } });

test('connect needs the app\'s id and secret', () => {
  assert.throws(() => connect({ clientId: 'a' }), /SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set/);
});

test('client credentials sign-in: Basic auth, form body; the token is reused while valid', async () => {
  const n = { count: 0 };
  const m = mockFetch([signIn(n), { url: `${API}/shows/`, reply: { json: { id: 's1', name: 'Acme Deep Dive', publisher: 'Acme', total_episodes: 7, external_urls: { spotify: 'https://open.spotify.com/show/s1' } } } }]);
  try {
    const d = connect({ clientId: 'id', clientSecret: 'secret', showId: 's1' });
    const show = await d.show();
    await d.show();
    assert.deepEqual(show, { id: 's1', title: 'Acme Deep Dive', publisher: 'Acme', episodes: 7, url: 'https://open.spotify.com/show/s1' });
    assert.equal(n.count, 1, 'one sign-in for two calls');
    const auth = m.calls[0].headers.get('authorization');
    assert.equal(Buffer.from(auth.replace('Basic ', ''), 'base64').toString(), 'id:secret');
    assert.equal(await bodyOf(m.calls[0]), 'grant_type=client_credentials');
    assert.equal(m.calls[1].headers.get('authorization'), 'Bearer tok1');
    assert.equal(m.calls[1].url, `${API}/shows/s1?market=US`);
  } finally {
    m.restore();
  }
});

test('a token about to expire is renewed', async () => {
  const n = { count: 0 };
  const m = mockFetch([
    { url: TOKEN, reply: () => { n.count++; return { json: { access_token: `tok${n.count}`, expires_in: 30 } }; } },
    { url: `${API}/shows/`, reply: { json: { id: 's1' } } },
  ]);
  try {
    const d = connect({ clientId: 'id', clientSecret: 'secret', showId: 's1' });
    await d.show();
    await d.show();
    assert.equal(n.count, 2);
    assert.equal(m.calls.at(-1).headers.get('authorization'), 'Bearer tok2');
  } finally {
    m.restore();
  }
});

test('a failed sign-in names the reason', async () => {
  const m = mockFetch([{ url: TOKEN, reply: { status: 400, json: { error: 'invalid_client', error_description: 'Invalid client secret' } } }]);
  try {
    await assert.rejects(connect({ clientId: 'id', clientSecret: 'bad', showId: 's' }).show(), /podcast directory sign-in -> 400 Invalid client secret/);
  } finally {
    m.restore();
  }
});

test('episodes: market and limit, newest list mapped, null items skipped, link fallback', async () => {
  const m = mockFetch([signIn(), {
    url: `${API}/shows/s1/episodes`,
    reply: { json: { items: [
      { id: 'e1', name: 'Episode 7: Book', release_date: '2026-10-30', external_urls: { spotify: 'https://open.spotify.com/episode/e1' } },
      null,
      { id: 'e2', name: 'Episode 6' },
    ] } },
  }]);
  try {
    const eps = await connect({ clientId: 'i', clientSecret: 's', showId: 's1', market: 'GB' }).episodes({ limit: 10 });
    assert.equal(m.calls[1].url, `${API}/shows/s1/episodes?market=GB&limit=10`);
    assert.deepEqual(eps, [
      { id: 'e1', title: 'Episode 7: Book', releaseDate: '2026-10-30', url: 'https://open.spotify.com/episode/e1', embedUrl: 'https://open.spotify.com/embed/episode/e1' },
      { id: 'e2', title: 'Episode 6', releaseDate: null, url: 'https://open.spotify.com/episode/e2', embedUrl: 'https://open.spotify.com/embed/episode/e2' },
    ]);
  } finally {
    m.restore();
  }
});

test('episodes default to the 50 newest', async () => {
  const m = mockFetch([signIn(), { url: `${API}/shows/s1/episodes`, reply: { json: {} } }]);
  try {
    assert.deepEqual(await connect({ clientId: 'i', clientSecret: 's', showId: 's1' }).episodes(), []);
    assert.match(m.calls[1].url, /limit=50$/);
  } finally {
    m.restore();
  }
});

test('no show id: a readable error, before any request', async () => {
  const m = mockFetch([]);
  try {
    const d = connect({ clientId: 'i', clientSecret: 's' });
    await assert.rejects(d.show(), /SPOTIFY_SHOW_ID is not set/);
    await assert.rejects(d.episodes(), /SPOTIFY_SHOW_ID is not set/);
    assert.equal(m.calls.length, 0);
  } finally {
    m.restore();
  }
});

test('403 without Premium surfaces Spotify\'s message, without the query string', async () => {
  const m = mockFetch([signIn(), {
    url: `${API}/shows/s1/episodes`,
    reply: { status: 403, json: { error: { status: 403, message: 'Active premium subscription required for the owner of the app.' } } },
  }]);
  try {
    await assert.rejects(
      connect({ clientId: 'i', clientSecret: 's', showId: 's1' }).episodes(),
      (err) => err.message === 'podcast directory GET /shows/s1/episodes -> 403 Active premium subscription required for the owner of the app.',
    );
  } finally {
    m.restore();
  }
});

test('plain-text errors are shown as text', async () => {
  const m = mockFetch([signIn(), { url: `${API}/shows/s1`, reply: { status: 502, text: 'Bad Gateway' } }]);
  try {
    await assert.rejects(connect({ clientId: 'i', clientSecret: 's', showId: 's1' }).show(), /-> 502 Bad Gateway/);
  } finally {
    m.restore();
  }
});

// ---- a person's sign-in (spotify-login) and saving to their library ----

test('authorizeUrl: the code flow back to the loopback address, asking for the library', () => {
  const u = new URL(authorizeUrl({ clientId: 'id', redirectUri: 'http://127.0.0.1:8767/callback', state: 'st' }));
  assert.equal(`${u.origin}${u.pathname}`, 'https://accounts.spotify.com/authorize');
  assert.equal(u.searchParams.get('client_id'), 'id');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:8767/callback');
  assert.equal(u.searchParams.get('state'), 'st');
  assert.equal(u.searchParams.get('scope'), SCOPE);
  assert.match(SCOPE, /user-library-modify/);
});

test('exchangeCode: Basic auth, the code and redirect URI; returns the refresh token', async () => {
  const m = mockFetch([{ method: 'POST', url: TOKEN, reply: { json: { access_token: 'a', refresh_token: 'r1', scope: 'user-library-modify user-library-read', expires_in: 3600 } } }]);
  try {
    const t = await exchangeCode({ clientId: 'id', clientSecret: 'secret', redirectUri: 'http://127.0.0.1:8767/callback', code: 'c1' });
    assert.deepEqual(t, { refreshToken: 'r1', scope: 'user-library-modify user-library-read' });
    assert.equal(Buffer.from(m.calls[0].headers.get('authorization').replace('Basic ', ''), 'base64').toString(), 'id:secret');
    const body = new URLSearchParams(await bodyOf(m.calls[0]));
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code'), 'c1');
    assert.equal(body.get('redirect_uri'), 'http://127.0.0.1:8767/callback');
  } finally {
    m.restore();
  }
});

test('exchangeCode: a refused code and a missing refresh token are readable errors', async () => {
  let m = mockFetch([{ url: TOKEN, reply: { status: 400, json: { error: 'invalid_grant', error_description: 'Invalid authorization code' } } }]);
  try {
    await assert.rejects(exchangeCode({ clientId: 'i', clientSecret: 's', redirectUri: 'r', code: 'x' }), /Spotify sign-in -> 400 Invalid authorization code/);
  } finally {
    m.restore();
  }
  m = mockFetch([{ url: TOKEN, reply: { json: { access_token: 'a', expires_in: 3600 } } }]);
  try {
    await assert.rejects(exchangeCode({ clientId: 'i', clientSecret: 's', redirectUri: 'r', code: 'x' }), /no refresh token — run spotify-login again/);
  } finally {
    m.restore();
  }
});

const userGrant = (n = { count: 0 }, extra = {}) => ({ method: 'POST', url: TOKEN, reply: () => { n.count++; return { json: { access_token: `user${n.count}`, expires_in: 3600, ...extra } }; } });

test('saveEpisode: the person\'s token from the refresh token; checks the library, then saves the episode URI', async () => {
  const n = { count: 0 };
  const m = mockFetch([
    userGrant(n),
    { method: 'GET', url: `${API}/me/library/contains`, reply: { json: [false] } },
    { method: 'PUT', url: `${API}/me/library`, reply: { status: 200, text: '' } },
  ]);
  try {
    const d = connect({ clientId: 'id', clientSecret: 'secret', showId: 's1', refreshToken: 'r1' });
    assert.equal(d.signedIn, true);
    assert.deepEqual(await d.saveEpisode('e7'), { saved: true, already: false });
    const body = new URLSearchParams(await bodyOf(m.calls[0]));
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'r1');
    assert.equal(m.calls[1].url, `${API}/me/library/contains?uris=spotify%3Aepisode%3Ae7`);
    assert.equal(m.calls[2].method, 'PUT');
    assert.equal(m.calls[2].url, `${API}/me/library?uris=spotify%3Aepisode%3Ae7`);
    assert.equal(m.calls[2].headers.get('authorization'), 'Bearer user1');
    assert.equal(d.rotatedRefreshToken(), null, 'no new refresh token issued');
  } finally {
    m.restore();
  }
});

test('saveEpisode: already in the library — nothing is saved again', async () => {
  const m = mockFetch([userGrant(), { method: 'GET', url: `${API}/me/library/contains`, reply: { json: [true] } }]);
  try {
    const d = connect({ clientId: 'i', clientSecret: 's', refreshToken: 'r1' });
    assert.deepEqual(await d.saveEpisode('e7'), { saved: true, already: true });
    assert.ok(!m.calls.some((c) => c.method === 'PUT'));
  } finally {
    m.restore();
  }
});

test('saveEpisode: a new refresh token from Spotify is kept for the caller to store', async () => {
  const m = mockFetch([
    userGrant({ count: 0 }, { refresh_token: 'r2' }),
    { method: 'GET', url: `${API}/me/library/contains`, reply: { json: [true] } },
  ]);
  try {
    const d = connect({ clientId: 'i', clientSecret: 's', refreshToken: 'r1' });
    await d.saveEpisode('e7');
    assert.equal(d.rotatedRefreshToken(), 'r2');
  } finally {
    m.restore();
  }
});

test('saveEpisode: not signed in, refused, or a revoked sign-in — each says what to do', async () => {
  let m = mockFetch([]);
  try {
    const d = connect({ clientId: 'i', clientSecret: 's' });
    assert.equal(d.signedIn, false);
    await assert.rejects(d.saveEpisode('e7'), /no Spotify sign-in: run rollout\.mjs spotify-login/);
    assert.equal(m.calls.length, 0);
  } finally {
    m.restore();
  }
  m = mockFetch([userGrant(), { url: `${API}/me/library/contains`, reply: { status: 403, json: { error: { status: 403, message: 'Insufficient client scope' } } } }]);
  try {
    await assert.rejects(connect({ clientId: 'i', clientSecret: 's', refreshToken: 'r1' }).saveEpisode('e7'), /GET \/me\/library\/contains -> 403 Insufficient client scope — sign in again with rollout\.mjs spotify-login/);
  } finally {
    m.restore();
  }
  m = mockFetch([{ url: TOKEN, reply: { status: 400, json: { error: 'invalid_grant', error_description: 'Refresh token revoked' } } }]);
  try {
    await assert.rejects(connect({ clientId: 'i', clientSecret: 's', refreshToken: 'r1' }).saveEpisode('e7'), /Refresh token revoked — the sign-in expired or was revoked: run rollout\.mjs spotify-login again/);
  } finally {
    m.restore();
  }
});
