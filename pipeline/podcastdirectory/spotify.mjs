// Spotify adapter for pipeline/podcast.mjs: finds a published episode on the
// show through the Spotify Web API, with the Client Credentials flow (an app
// token; no user signs in).
//
//   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET   the app (developer.spotify.com). Secret
//   SPOTIFY_SHOW_ID    the show, as Spotify lists it (open.spotify.com/show/<id>)
//   SPOTIFY_MARKET     the market episodes are read in (default US)
//
// The Web API only reads: episodes reach Spotify through the podcast host's
// RSS feed, usually within hours of being published there.

const ACCOUNTS = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

export function connect({ clientId, clientSecret, showId, market = 'US' }) {
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
  };
}
