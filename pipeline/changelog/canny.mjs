// Canny adapter for pipeline/changelog.mjs: the changelog Entries API.
//
//   CHANGELOG_API_URL  https://canny.io/api/v1 (the default)
//   CHANGELOG_API_KEY  the company's secret API key (Canny: Settings → API)
//
// Every call is a POST with a JSON body that carries the key; the key goes
// only to Canny and is never logged. Canny has no "read one entry" call, so
// get() pages through the list. Entries are created unpublished (a draft);
// publishing is a separate change_status call, which emails subscribers when
// the entry has notify set.

const DEFAULT_URL = 'https://canny.io/api/v1';

// The API's entry as the adapter contract's shape.
const entry = (x) => ({
  id: String(x.id),
  title: x.title ?? '',
  status: x.status ?? null,
  types: x.types ?? [],
  labels: (x.labels ?? []).map((l) => ({ id: String(l.id), name: l.name })),
  markdown: x.markdownDetails ?? '',
  text: x.plaintextDetails ?? '',
  url: x.url ?? null,
  lastSaved: x.lastSaved ?? null,
  publishedAt: x.publishedAt ?? null,
  scheduledFor: x.scheduledFor ?? null,
  created: x.created ?? null,
});

export function connect({ apiKey, baseUrl = DEFAULT_URL }) {
  const base = (baseUrl ?? DEFAULT_URL).replace(/\/$/, '');
  const call = async (route, params = {}) => {
    const res = await fetch(`${base}/entries/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apiKey, ...params }),
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!res.ok) {
      const why = (json && typeof json === 'object' ? json.error : null) ?? String(text).slice(0, 300);
      const hint = res.status === 401 || res.status === 403 || /invalid api ?key/i.test(why) ? ' (check CHANGELOG_API_KEY)'
        : res.status === 429 ? ` (rate limited; retry after ${res.headers.get('retry-after') ?? '?'}s)` : '';
      throw new Error(`changelog POST /entries/${route} -> ${res.status} ${why}${hint}`);
    }
    return json;
  };

  const list = async ({ limit = 100, skip = 0, sort = 'lastSaved', status, labelIds } = {}) => {
    const r = await call('list', { limit, skip, sort, ...(status ? { status } : {}), ...(labelIds?.length ? { labelIDs: labelIds } : {}) });
    return { hasMore: Boolean(r?.hasMore), entries: (r?.entries ?? []).map(entry) };
  };

  // Every entry up to max, newest saved first.
  const all = async ({ max = 1000, ...opts } = {}) => {
    const out = [];
    for (let skip = 0; out.length < max; skip += 100) {
      const page = await list({ ...opts, limit: Math.min(100, max - out.length), skip });
      out.push(...page.entries);
      if (!page.hasMore || !page.entries.length || skip + 100 > 1000) break;
    }
    return out;
  };

  return {
    list,
    all,
    async get(id) {
      const found = (await all()).find((x) => x.id === String(id));
      if (!found) throw new Error(`changelog entry ${id} not found (deleted, or older than the newest 1,000)`);
      return found;
    },
    // A new entry, unpublished. Canny's create takes one type; any others are
    // set by an update right after, which takes the full list.
    async create({ title, details, types = [], labelIds = [], notify = false }) {
      const r = await call('create', {
        title, details, notify, published: false,
        ...(types[0] ? { type: types[0] } : {}),
        ...(labelIds.length ? { labelIDs: labelIds } : {}),
      });
      if (!r?.id) throw new Error('changelog create returned no id');
      const id = String(r.id);
      if (types.length > 1) await call('update', { entryID: id, types });
      return { id };
    },
    // Fields left out are unchanged; the status is never changed here.
    async update(id, { title, details, types, labelIds, notify }) {
      await call('update', {
        entryID: String(id),
        ...(title !== undefined ? { title } : {}),
        ...(details !== undefined ? { details } : {}),
        ...(types !== undefined ? { types } : {}),
        ...(labelIds !== undefined ? { labelIDs: labelIds } : {}),
        ...(notify !== undefined ? { notify } : {}),
      });
    },
    async changeStatus(id, status, { publishedOn, scheduledFor } = {}) {
      await call('change_status', { entryID: String(id), status, ...(publishedOn ? { publishedOn } : {}), ...(scheduledFor ? { scheduledFor } : {}) });
    },
  };
}
