// Stand-ins for the external services, as real HTTP servers on a free local
// port: the integration tests point the pipeline at them through the .env keys
// that take an API URL (HELP_CENTER_API_URL, ELEVENLABS_API_URL). Each records
// the requests it got.

import http from 'node:http';
import net from 'node:net';

export const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  }).on('error', reject);
});

// handler(req, body) -> { status?, json?, body?, headers? }
async function fakeServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const r = { method: req.method, url: req.url, headers: req.headers, raw, text: raw.toString('utf8') };
    try { r.json = r.text ? JSON.parse(r.text) : null; } catch { r.json = null; }
    requests.push(r);
    let rep;
    try {
      rep = (await handler(r)) ?? { status: 404, json: { error: `no route ${req.method} ${req.url}` } };
    } catch (err) {
      rep = { status: 500, json: { error: String(err.message ?? err) } };
    }
    const headers = { ...(rep.headers ?? {}) };
    let body = rep.body ?? '';
    if (rep.json !== undefined) {
      body = JSON.stringify(rep.json);
      headers['content-type'] ??= 'application/json';
    }
    res.writeHead(rep.status ?? 200, headers);
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => new Promise((r) => server.close(r)) };
}

// The help center (Intercom's article API): articles kept in memory.
export async function fakeHelpCenter({ token = 'test-token' } = {}) {
  const articles = new Map();
  let next = 1000;
  const now = () => Math.floor(Date.now() / 1000);
  const out = (a) => ({ type: 'article', ...a });
  const srv = await fakeServer((r) => {
    if (r.headers.authorization !== `Bearer ${token}`) return { status: 401, json: { errors: [{ code: 'unauthorized', message: 'bad token' }] } };
    const u = new URL(r.url, 'http://x');
    if (r.method === 'GET' && u.pathname === '/me') return { json: { id: 7, name: 'Test Admin' } };
    if (r.method === 'GET' && u.pathname === '/admins') return { json: { admins: [{ type: 'admin', id: 7, name: 'Test Admin' }, { type: 'team', id: 8, name: 'Team' }] } };
    if (r.method === 'GET' && u.pathname === '/help_center/collections') return { json: { data: [{ id: 55, name: 'Getting started', parent_id: null }] } };
    if (r.method === 'GET' && u.pathname === '/articles/search') {
      const phrase = (u.searchParams.get('phrase') ?? '').toLowerCase();
      return { json: { data: { articles: [...articles.values()].filter((a) => a.title.toLowerCase().includes(phrase)).map(out) } } };
    }
    if (r.method === 'POST' && u.pathname === '/articles') {
      const id = String(next++);
      // the help center hosts its own copy of every image it is sent
      const body = r.json.body.replace(/<img\b([^>]*?)\bsrc="([^"]*)"/g, (m, pre, src) => `<img ${pre}src="https://downloads.help.example/${id}/${encodeURIComponent(src.split('/').pop())}"`);
      const a = { id, title: r.json.title, description: r.json.description, body, state: r.json.state, author_id: r.json.author_id, parent_id: r.json.parent_id ?? null, url: `https://help.example/articles/${id}`, updated_at: now() };
      articles.set(id, a);
      return { json: out(a) };
    }
    const m = u.pathname.match(/^\/articles\/(\w+)$/);
    if (m && r.method === 'GET') return articles.has(m[1]) ? { json: out(articles.get(m[1])) } : { status: 404, json: { errors: [{ code: 'not_found', message: 'no article' }] } };
    if (m && r.method === 'PUT') {
      const a = articles.get(m[1]);
      if (!a) return { status: 404, json: { errors: [{ code: 'not_found', message: 'no article' }] } };
      Object.assign(a, { title: r.json.title, description: r.json.description, body: r.json.body, ...(r.json.state ? { state: r.json.state } : {}), updated_at: now() });
      return { json: out(a) };
    }
    return null;
  });
  return { ...srv, token, articles };
}

// The podcast studio (ElevenLabs): voices, and dialogue answered with the MP3 given.
export async function fakeStudio({ mp3, apiKey = 'test-key' }) {
  let n = 0;
  const srv = await fakeServer((r) => {
    if (r.headers['xi-api-key'] !== apiKey) return { status: 401, json: { detail: { message: 'invalid api key' } } };
    const u = new URL(r.url, 'http://x');
    if (r.method === 'GET' && u.pathname === '/v2/voices') return { json: { voices: [{ voice_id: 'v-host', name: 'Hana', category: 'premade' }, { voice_id: 'v-guest', name: 'Gus', category: 'cloned' }] } };
    if (r.method === 'POST' && u.pathname === '/v1/text-to-dialogue') {
      if (!Array.isArray(r.json?.inputs) || !r.json.inputs.length) return { status: 422, json: { detail: [{ loc: ['body', 'inputs'], msg: 'required' }] } };
      return { body: mp3, headers: { 'content-type': 'audio/mpeg', 'request-id': `req-${++n}` } };
    }
    return null;
  });
  return { ...srv, apiKey };
}
