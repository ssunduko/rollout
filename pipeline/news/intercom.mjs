// Intercom adapter for pipeline/news.mjs: the News API (news items and
// newsfeeds).
//
//   NEWS_API_URL      https://api.intercom.io (EU: https://api.eu.intercom.io,
//                     AU: https://api.au.intercom.io)
//   NEWS_API_VERSION  the Intercom-Version header
//   NEWS_TOKEN        an access token with read and write access to news
//                     (read_write_news_scope)
//
// The API's update rules, which update() follows: labels and
// newsfeed_assignments are cleared when left out, and reactions are disabled
// when left out — so every update sends the full lists; sender_id is required
// on every update. A draft is not shown to users until it is set live.

const DEFAULT_URL = 'https://api.intercom.io';
const DEFAULT_VERSION = '2.14';

// newsfeed names come back HTML-escaped
const unescape = (s) => String(s ?? '').replace(/&(amp|lt|gt|quot|#39);/g, (_, x) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[x]);

// The API's news item as the adapter contract's shape.
const item = (x) => ({
  id: String(x.id),
  title: x.title ?? '',
  body: x.body ?? '',
  text: String(x.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  state: x.state ?? null,
  senderId: x.sender_id != null ? String(x.sender_id) : null,
  labels: x.labels ?? [],
  newsfeedIds: (x.newsfeed_assignments ?? []).map((a) => String(a.newsfeed_id)),
  coverImageUrl: x.cover_image_url ?? null,
  reactions: (x.reactions ?? []).map((r) => (typeof r === 'string' ? r : r?.reaction)).filter(Boolean),
  silent: x.deliver_silently ?? null,
  publishedAt: x.published_at ?? null,
  updatedAt: x.updated_at ?? null,
  url: null,
});

export function connect({ token, baseUrl = DEFAULT_URL, version = DEFAULT_VERSION }) {
  const base = (baseUrl ?? DEFAULT_URL).replace(/\/$/, '');
  const call = async (method, route, body) => {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Intercom-Version': version ?? DEFAULT_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    if (!res.ok) {
      const why = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || text.slice(0, 300) || '(no body: is News enabled on the workspace?)';
      const hint = res.status === 401 ? ' (the token needs read and write access to news)' : '';
      throw new Error(`news ${method} ${route} -> ${res.status} ${why}${hint}`);
    }
    return json;
  };

  // The fields a create or update sends. Lists are always sent whole.
  const payload = ({ title, body, senderId, state, silent, labels = [], newsfeedIds = [], coverImageUrl, reactions = [] }) => ({
    title,
    body,
    sender_id: Number(senderId),
    ...(state ? { state } : {}),
    ...(silent !== undefined ? { deliver_silently: Boolean(silent) } : {}),
    labels,
    newsfeed_assignments: newsfeedIds.map((id) => ({ newsfeed_id: Number(id) })),
    ...(coverImageUrl ? { cover_image_url: coverImageUrl } : {}),
    reactions,
  });

  return {
    // every news item, newest created first (the API pages 20 at a time)
    async all({ max = 1000 } = {}) {
      const out = [];
      for (let page = 1; out.length < max; page += 1) {
        const r = await call('GET', `/news/news_items?page=${page}&per_page=20`);
        out.push(...(r.data ?? []).map(item));
        if (!(r.data ?? []).length || page >= (r.pages?.total_pages ?? page)) break;
      }
      return out.slice(0, max);
    },
    async get(id) {
      return item(await call('GET', `/news/news_items/${encodeURIComponent(id)}`));
    },
    async create(fields) {
      return item(await call('POST', '/news/news_items', payload({ ...fields, state: fields.state ?? 'draft' })));
    },
    async update(id, fields) {
      return item(await call('PUT', `/news/news_items/${encodeURIComponent(id)}`, payload(fields)));
    },
    async newsfeeds() {
      const r = await call('GET', '/news/newsfeeds');
      return (r.data ?? []).map((f) => ({ id: String(f.id), name: unescape(f.name) }));
    },
    // teammates who can send a news item
    async senders() {
      const r = await call('GET', '/admins');
      return (r.admins ?? []).filter((a) => a.type === 'admin').map((a) => ({ id: String(a.id), name: a.name }));
    },
  };
}
