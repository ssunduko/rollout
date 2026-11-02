// Shared test helpers. Import ./setup.mjs before this (and before any
// pipeline module) so the environment is the test one.

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, SANDBOX, FIXTURES } from './setup.mjs';

export { ROOT, SANDBOX, FIXTURES };

// The CLI in a child process with the test environment.
export function cli(args, { env = {}, timeout = 120_000 } = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'pipeline', 'rollout.mjs'), ...args], {
    cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', timeout,
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// The same, without blocking this process: needed when the CLI talks to a fake
// server running in the test process (spawnSync would stop it answering).
export function cliAsync(args, { env = {}, timeout = 120_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'pipeline', 'rollout.mjs'), ...args], {
      cwd: ROOT, env: { ...process.env, ...env }, stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill(), timeout);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, out: stdout + stderr });
    });
  });
}

// A fixture file into the sandbox (relative paths on both sides).
export function putFixture(name, to) {
  const dest = path.join(SANDBOX, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, name), dest);
  return dest;
}

export const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

// Replace global fetch with routes: [{ method?, url: RegExp|string, reply }],
// reply a function (req) => ({ status?, json?, text?, body?, headers? }) or an
// object of that shape. Unmatched requests fail the test loudly. Returns the
// recorded calls and restore().
export function mockFetch(routes) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const req = { url, method, headers: new Headers(init.headers ?? {}), body: init.body };
    calls.push(req);
    const route = routes.find((r) => (!r.method || r.method === method) && (typeof r.url === 'string' ? url.startsWith(r.url) : r.url.test(url)));
    if (!route) throw new Error(`unexpected fetch ${method} ${url}`);
    const rep = typeof route.reply === 'function' ? await route.reply(req) : route.reply;
    const headers = new Headers(rep.headers ?? {});
    let body = rep.body ?? rep.text ?? null;
    if (rep.json !== undefined) {
      body = JSON.stringify(rep.json);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
    return new Response(body, { status: rep.status ?? 200, headers });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

// A request body as text or JSON (fetch bodies may be strings, buffers or FormData).
export async function bodyOf(req) {
  if (req.body == null) return null;
  if (typeof req.body === 'string') return req.body;
  return new Response(req.body).text();
}

// Whether the tools the rendering stages shell out to exist here.
export async function haveChrome() {
  try {
    (await import('../pipeline/chrome.mjs')).resolveChrome();
    return true;
  } catch {
    return false;
  }
}
export function haveFfmpeg() {
  const r = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version'], { encoding: 'utf8' });
  return r.status === 0;
}
// In CI a missing tool is a failure, not a skip.
export const required = (have, what) => (have || process.env.CI ? false : `${what} not installed`);

// Start a node script as a server; resolves once it answers on url.
export async function startServer(script, { env = {}, url, timeout = 15_000 } = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'pipe' });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const until = Date.now() + timeout;
  for (;;) {
    try {
      await fetch(url);
      break;
    } catch {
      if (child.exitCode !== null || Date.now() > until) {
        child.kill();
        throw new Error(`${script} did not start:\n${log}`);
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return { child, log: () => log, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
