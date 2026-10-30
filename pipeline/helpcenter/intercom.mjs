// Intercom adapter for pipeline/helpcenter.mjs: the Articles REST API.
//
//   HELP_CENTER_API_URL      https://api.intercom.io (EU: https://api.eu.intercom.io,
//                            AU: https://api.au.intercom.io)
//   HELP_CENTER_API_VERSION  the Intercom-Version header
//   HELP_CENTER_TOKEN        an access token with read and write access to articles
//
// Note the API's update rule: an edit to a published article goes live at
// once, and state "draft" unpublishes it. helpcenter.mjs guards both.

const DEFAULT_URL = 'https://api.intercom.io';
const DEFAULT_VERSION = '2.14';

// collection names come back HTML-escaped ("Billing &amp; Plans")
const unescape = (s) => String(s ?? '').replace(/&(amp|lt|gt|quot|#39);/g, (_, x) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[x]);

// The API's article as the adapter contract's shape.
const article = (a) => ({
  id: String(a.id),
  title: a.title,
  description: a.description ?? '',
  body: a.body ?? '',
  state: a.state,
  url: a.url ?? null,
  authorId: a.author_id ?? null,
  parentIds: a.parent_ids ?? (a.parent_id != null ? [a.parent_id] : []),
  updatedAt: a.updated_at,
});

export function connect({ token, baseUrl = DEFAULT_URL, version = DEFAULT_VERSION }) {
  const call = async (method, route, body) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Intercom-Version': version,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const why = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('; ') || text.slice(0, 300);
      throw new Error(`help center ${method} ${route} -> ${res.status} ${why}`);
    }
    return json;
  };

  return {
    async find(phrase, { state = 'all' } = {}) {
      const q = new URLSearchParams({ phrase, state, per_page: '20' });
      const r = await call('GET', `/articles/search?${q}`);
      return (r.data?.articles ?? []).map(article);
    },
    async get(id) {
      return article(await call('GET', `/articles/${encodeURIComponent(id)}`));
    },
    async create({ title, description, body, authorId, state, parentId }) {
      return article(await call('POST', '/articles', {
        title, description, body, state,
        author_id: Number(authorId),
        ...(parentId ? { parent_id: Number(parentId) } : {}),
      }));
    },
    async update(id, { title, description, body, state }) {
      return article(await call('PUT', `/articles/${encodeURIComponent(id)}`, {
        title, description, body, ...(state ? { state } : {}),
      }));
    },
    // the teammate the token belongs to
    async me() {
      const r = await call('GET', '/me');
      return { id: String(r.id), name: r.name };
    },
    async authors() {
      const r = await call('GET', '/admins');
      return (r.admins ?? []).filter((a) => a.type === 'admin').map((a) => ({ id: String(a.id), name: a.name }));
    },
    async collections() {
      const r = await call('GET', '/help_center/collections?per_page=150');
      return (r.data ?? []).map((c) => ({ id: String(c.id), name: unescape(c.name), parentId: c.parent_id ?? null }));
    },
  };
}
