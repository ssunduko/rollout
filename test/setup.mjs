// Imported first by every test file, before any pipeline module: the pipeline
// reads .env.example (never the real .env, so no real brand or secret) and
// works on a throwaway copy of the committed example feature.
//
// node:test runs each test file in its own process, so each file gets its own
// sandbox, removed when the process exits.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(ROOT, 'test', 'fixtures');
export const SLUG = 'smart-scheduling';

// Every key .env.example lists comes from the file, not from the shell.
for (const line of fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=/);
  if (m) delete process.env[m[1]];
}
process.env.ENV_FILE = '.env.example';

export const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-test-'));
process.env.INPUT_DIR = path.join(SANDBOX, 'input');
process.env.LIBRARY_DIR = path.join(SANDBOX, 'library');
process.env.OUTPUT_DIR = path.join(SANDBOX, 'output');

const copy = (from, to = from) => fs.cpSync(path.join(ROOT, from), path.join(SANDBOX, to), { recursive: true });
copy('input/_template');
copy(`input/${SLUG}`);
copy(`library/features/${SLUG}`);
for (const d of fs.readdirSync(path.join(ROOT, 'library', 'scenes'))) {
  if (d.startsWith(`${SLUG}--`)) copy(`library/scenes/${d}`);
}
fs.mkdirSync(process.env.OUTPUT_DIR, { recursive: true });

process.on('exit', () => fs.rmSync(SANDBOX, { recursive: true, force: true }));
