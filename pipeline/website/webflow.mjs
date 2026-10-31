// Webflow adapter for pipeline/website.mjs: the Data API v2.
//
//   WEBFLOW_API_URL    https://api.webflow.com/v2
//   WEBFLOW_API_TOKEN  a site token with sites:read, pages:read, components:read,
//                      assets:read/write and cms:read
//   WEBFLOW_SITE_ID    the site feature pages are published to
//
// The Data API reads pages and components and uploads assets. Building a page
// from components, and creating components, happens in the Designer — the
// rollout-web-publisher agent does that through the Webflow MCP server.

import crypto from 'node:crypto';

const DEFAULT_URL = 'https://api.webflow.com/v2';

// The API's page as the adapter contract's shape.
const page = (p) => ({
  id: p.id,
  title: p.title ?? '',
  slug: p.slug ?? '',
  path: p.publishedPath ?? (p.slug ? `/${p.slug}` : null),
  folderId: p.parentId ?? null,
  collectionId: p.collectionId ?? null,
  draft: Boolean(p.draft),
  archived: Boolean(p.archived),
  updatedAt: p.lastUpdated ?? null,
  seo: p.seo ?? null,
  openGraph: p.openGraph ?? null,
});

// The API's CMS item as the adapter contract's shape.
const item = (i) => ({
  id: i.id,
  name: i.fieldData?.name ?? '',
  slug: i.fieldData?.slug ?? '',
  draft: Boolean(i.isDraft),
  archived: Boolean(i.isArchived),
  updatedAt: i.lastUpdated ?? null,
  publishedAt: i.lastPublished ?? null,
  fields: i.fieldData ?? {},
});

export function connect({ token, siteId, baseUrl = DEFAULT_URL }) {
  const call = async (method, route, body) => {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const why = [json.code, json.message, ...(json.details ?? []).map((d) => (typeof d === 'string' ? d : JSON.stringify(d)))].filter(Boolean).join(': ') || text.slice(0, 300);
      throw new Error(`website ${method} ${route} -> ${res.status} ${why}`);
    }
    return json;
  };
  // every page of a paginated list (limit 100)
  const all = async (route, key) => {
    const out = [];
    for (let offset = 0; ; offset += 100) {
      const r = await call('GET', `${route}${route.includes('?') ? '&' : '?'}limit=100&offset=${offset}`);
      out.push(...(r[key] ?? []));
      if (!r.pagination || out.length >= r.pagination.total || !(r[key] ?? []).length) return out;
    }
  };
  const site = encodeURIComponent(siteId);

  return {
    // every site the token can reach
    async sites() {
      return ((await call('GET', '/sites')).sites ?? []).map((s) => ({ id: s.id, name: s.displayName, domains: (s.customDomains ?? []).map((d) => d.url) }));
    },
    async site() {
      const s = await call('GET', `/sites/${site}`);
      return { id: s.id, name: s.displayName, domains: (s.customDomains ?? []).map((d) => d.url), previewUrl: s.previewUrl ?? null };
    },
    async pages() {
      return (await all(`/sites/${site}/pages`, 'pages')).map(page);
    },
    async page(id) {
      return page(await call('GET', `/pages/${encodeURIComponent(id)}`));
    },
    async components() {
      return (await all(`/sites/${site}/components`, 'components')).map((c) => ({
        id: c.id, name: c.name, group: c.group ?? null, description: c.description ?? null, readonly: Boolean(c.readonly),
      }));
    },
    // a CMS collection and its fields (needs cms:read)
    async collection(id) {
      const c = await call('GET', `/collections/${encodeURIComponent(id)}`);
      return {
        id: c.id, name: c.displayName, slug: c.slug,
        fields: (c.fields ?? []).map((f) => ({ slug: f.slug, name: f.displayName, type: f.type, required: Boolean(f.isRequired) })),
      };
    },
    async items(collectionId) {
      return (await all(`/collections/${encodeURIComponent(collectionId)}/items`, 'items')).map(item);
    },
    async item(collectionId, itemId) {
      return item(await call('GET', `/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`));
    },
    // Two steps: register the file (name + MD5), then send it to the storage
    // URL that returns, with the form fields it lists before the file itself.
    async uploadAsset({ name, data, type }) {
      const fileHash = crypto.createHash('md5').update(data).digest('hex');
      const a = await call('POST', `/sites/${site}/assets`, { fileName: name, fileHash });
      const form = new FormData();
      for (const [k, v] of Object.entries(a.uploadDetails ?? {})) form.append(k, v);
      form.append('file', new Blob([data], { type }), name);
      const up = await fetch(a.uploadUrl, { method: 'POST', body: form });
      if (!up.ok) throw new Error(`website asset upload ${name} -> ${up.status} ${(await up.text()).slice(0, 300)}`);
      return { id: a.id, url: a.hostedUrl ?? a.assetUrl ?? null };
    },
  };
}
