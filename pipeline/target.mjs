// Targets: which running application a capture logs into, and how.
//
// A capture scene describes *what to show*; a target describes *where the app
// is and how to sign in*. Keeping them apart means the same scenes re-capture
// against staging or production by swapping the target, and credentials never
// land in a scene.
//
// Resolution, later wins:
//   targets/<name>.json          committed, no secrets
//   targets/<name>.local.json    gitignored, secrets or per-machine values
//   .env                         KEY=VALUE for "env:VAR" references
//
// Any string value may be written as "env:VAR_NAME"; a missing variable is
// reported by name when something actually needs it.
//
// Keys:
//   app            https URL of the application
//   startUrl       where captures start (relative to app)
//   viewport       { width, height } CSS pixels of the captured browser
//   pageUrlMatch   extra hosts that still count as the app (SSO, identity provider)
//   blockUrls      URL patterns kept from loading (chat widgets, surveys)
//   hideSelectors  elements hidden with CSS (banners unrelated to any feature)
//   blurSelectors  elements blurred with CSS (names, phone numbers, emails)
//   profile        Chrome profile folder holding the signed-in session
//                  (default profiles/<name>/; sign in once with `rollout.mjs login <name>`)
//   auth           { mode: "none" | "form", username, password, selectors: {
//                    signInLink, username, password, submit, signedIn } }
//                  "none": rely on the profile's session (SSO apps).
//                  "form": fill the login form off camera whenever it appears.
//   secrets        values filled into {name} placeholders in scene URLs

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, env } from './env.mjs';

export const TARGETS_DIR = path.join(ROOT, 'targets');
export const PROFILES_DIR = path.join(ROOT, 'profiles');

const KNOWN = new Set(['name', 'description', 'app', 'startUrl', 'viewport', 'pageUrlMatch', 'blockUrls', 'hideSelectors', 'blurSelectors', 'profile', 'auth', 'secrets']);

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const deepMerge = (a, b) => {
  if (!isPlain(a) || !isPlain(b)) return b === undefined ? a : b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isPlain(v) && isPlain(a[k]) ? deepMerge(a[k], v) : v;
  return out;
};
const readJson = (file) => {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
};

// "env:VAR" -> value; missing ones are recorded so the error can name them.
function resolveEnv(value, missing, trail = []) {
  if (typeof value === 'string') {
    const m = /^env:([A-Za-z_]\w*)$/.exec(value.trim());
    if (!m) return value;
    const found = env(m[1]);
    if (found === undefined) {
      missing.push({ at: trail.join('.'), variable: m[1] });
      return null;
    }
    return found;
  }
  if (Array.isArray(value)) return value.map((v, i) => resolveEnv(v, missing, [...trail, i]));
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveEnv(v, missing, [...trail, k])]));
  return value;
}

// a target may exist only as <name>.local.json (a private app kept out of git)
export const listTargets = () =>
  fs.existsSync(TARGETS_DIR) ? [...new Set(fs.readdirSync(TARGETS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/(.local)?.json$/, '')))] : [];

export function loadTarget(name) {
  if (!name) throw new Error('no target: set "target" in the scene, in input/<slug>/feature.json, or CAPTURE_TARGET in .env');
  const base = readJson(path.join(TARGETS_DIR, `${name}.json`));
  const local = readJson(path.join(TARGETS_DIR, `${name}.local.json`));
  if (!base && !local) {
    const known = listTargets();
    throw new Error(`target "${name}" not found in targets/.${known.length ? ` Known: ${known.join(', ')}` : ''} Copy targets/_template.json.`);
  }
  const raw = deepMerge(base ?? {}, local ?? {});
  for (const k of Object.keys(raw)) if (!k.startsWith('//') && !KNOWN.has(k)) console.warn(`warning: unknown key "${k}" in target ${name} (ignored)`);

  const missingEnv = [];
  const cfg = resolveEnv(raw, missingEnv);
  if (!cfg.app || !/^https?:\/\//i.test(cfg.app)) throw new Error(`target ${name}: "app" must be an http(s) URL${missingEnv.some((m) => m.at === 'app') ? ` (${missingEnv.find((m) => m.at === 'app').variable} is not set)` : ''}`);

  const auth = cfg.auth ?? { mode: 'none' };
  if (!['none', 'form'].includes(auth.mode ?? 'none')) throw new Error(`target ${name}: auth.mode must be "none" or "form"`);

  return {
    name,
    description: cfg.description ?? '',
    app: cfg.app,
    startUrl: cfg.startUrl ?? '/',
    viewport: cfg.viewport ?? { width: 1440, height: 900 },
    pageUrlMatch: cfg.pageUrlMatch ?? [],
    blockUrls: cfg.blockUrls ?? [],
    hideSelectors: cfg.hideSelectors ?? [],
    blurSelectors: cfg.blurSelectors ?? [],
    profile: path.resolve(ROOT, cfg.profile ?? path.join('profiles', name)),
    auth: { mode: auth.mode ?? 'none', username: auth.username ?? null, password: auth.password ?? null, selectors: auth.selectors ?? {} },
    secrets: cfg.secrets ?? {},
    missingEnv,
  };
}

// What about a target changes how its captures look — part of a capture's
// render hash. Never includes credentials or secrets.
export const targetLook = (t) => ({ name: t.name, app: t.app, viewport: t.viewport, hide: t.hideSelectors, blur: t.blurSelectors, block: t.blockUrls });

// `{name}` in a URL is filled from the target's secrets, so internal ids stay in .env.
export function fillSecrets(t, where) {
  return String(where).replace(/\{([A-Za-z_]\w*)\}/g, (_, key) => {
    const v = t.secrets[key];
    if (v == null) throw new Error(`${where}: target ${t.name} has no secret "${key}" (add it under "secrets", e.g. "env:VAR")`);
    return encodeURIComponent(v);
  });
}

export function requireCredentials(t) {
  const missing = t.missingEnv.filter((m) => m.at.startsWith('auth.')).map((m) => m.variable);
  if (!t.auth.username || !t.auth.password) {
    throw new Error(`target ${t.name} signs in with a form but has no ${!t.auth.username ? 'username' : 'password'}${missing.length ? ` (unset: ${missing.join(', ')})` : ''}. Set them in .env or targets/${t.name}.local.json.`);
  }
  return t.auth;
}
