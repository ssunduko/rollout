// Configuration, read from one place.
//
// Everything that varies between deployments of this repo (which brand, which
// folders, which Chrome) comes from .env or the shell, never from code. Every
// key read here is listed in .env.example.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const KIT_DIR = path.join(HERE, 'kit');

// Minimal KEY=VALUE reader. Only fills variables that are not already set, so
// an explicit shell export always wins over the file.
function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

// An empty value in .env means "not set", so a blank override line is harmless.
export const env = (key, fallback = undefined) => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
};

export const envNumber = (key, fallback) => {
  const n = Number(env(key, fallback));
  return Number.isFinite(n) ? n : fallback;
};

const dir = (key, fallback) => path.resolve(ROOT, env(key, fallback));

export const INPUT_DIR = dir('INPUT_DIR', 'input');
export const LIBRARY_DIR = dir('LIBRARY_DIR', 'library');
export const OUTPUT_DIR = dir('OUTPUT_DIR', 'output');
export const BRAND_DIR = dir('BRAND_DIR', 'brand/example');

// Where one feature's files live. The slug is the feature's folder name in
// input/ and is reused for its library and output folders.
export const featurePaths = (slug) => ({
  input: path.join(INPUT_DIR, slug),
  description: path.join(INPUT_DIR, slug, 'feature.md'),
  sidecar: path.join(INPUT_DIR, slug, 'feature.json'),
  inputAssets: path.join(INPUT_DIR, slug, 'assets'),
  library: path.join(LIBRARY_DIR, 'features', slug),
  brief: path.join(LIBRARY_DIR, 'features', slug, 'brief.json'),
  output: path.join(OUTPUT_DIR, slug),
  web: path.join(OUTPUT_DIR, slug, 'web'),
  qa: path.join(OUTPUT_DIR, slug, 'qa'),
});

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertSlug(slug) {
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error(`"${slug ?? ''}" is not a feature slug (lowercase words joined by dashes)`);
  }
  return slug;
}

export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
