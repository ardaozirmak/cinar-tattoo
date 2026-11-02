// Helpers shared by the test suites.
//
// - makeEnv() builds a Cloudflare-style `env` (DB, IMAGES, ASSETS and the secrets) over temp folders.
// - call() runs a Pages Function handler directly, with the context object Pages would give it.
// - tempTree() writes a throwaway folder of files, for tests that need their own functions/ or public/.
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createD1 } from '../dev/d1.mjs';
import { createKV } from '../dev/kv.mjs';
import { createAssets } from '../dev/static.mjs';

// The site's real static folder. It may not exist yet; ASSETS then answers 404 to everything.
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

const DEFAULT_VARS = { ADMIN_PASSWORD: 'test-sifre-123', APP_SECRET: 'x'.repeat(40), DEV_INSECURE_COOKIES: '1' };

// An env over a fresh temp folder `dir`: a file D1 (dir/db.sqlite), a folder KV (dir/kv), and
// ASSETS over the real public/. `vars` is merged over the default secrets, and a key set to
// `undefined` removes that default (to test a missing APP_SECRET, say).
//
// Every call makes a new env, so tests that change state or record login failures should not share one.
// cleanup() closes the database first (Windows cannot delete an open SQLite file), then removes
// `dir`. It closes the database makeEnv made, so a test may replace or wrap env.DB. It is
// synchronous, safe to call twice, and works as `t.after(cleanup)`.
export function makeEnv({ vars } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cinar-env-'));
  const merged = { ...DEFAULT_VARS, ...vars };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  const DB = createD1(join(dir, 'db.sqlite'));
  const IMAGES = createKV(join(dir, 'kv'));
  const env = { ...merged, DB, IMAGES, ASSETS: createAssets(PUBLIC_DIR) };

  const cleanup = () => {
    DB.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  };
  return { env, dir, cleanup };
}

// Runs a Pages Function handler such as `onRequestPost` and returns its Response. The context is
// the one Pages builds: `{ request, env, params, data, waitUntil, next }`.
//
// - `params` is what the route would have captured; pass it only for a handler that reads it.
// - `next()` returns env.ASSETS.fetch(request), as a Function that falls through to static files does.
// - Work handed to waitUntil() has finished when call() returns, so a test can look at its effects.
//   A rejected task is logged and does not fail the call, as in production.
// - There is no CF-Connecting-IP unless `headers` has one.
export async function call(handler, { method = 'GET', url = 'https://cinar.test/', params = {}, headers = {}, body, env } = {}) {
  const request = new Request(url, { method, headers, body });
  const pending = [];
  const context = {
    request,
    env,
    params,
    data: {},
    waitUntil: (promise) => {
      const task = Promise.resolve(promise);
      // Handled now, reported below: otherwise a task that fails while the handler is still
      // awaiting something would count as an unhandled rejection and take the test run down.
      task.catch(() => {});
      pending.push(task);
    },
    next: () => env.ASSETS.fetch(request),
  };

  const response = await handler(context);

  // A task may start another, so keep going until none is left.
  while (pending.length > 0) {
    for (const result of await Promise.allSettled(pending.splice(0))) {
      if (result.status === 'rejected') console.error('waitUntil task failed:', result.reason);
    }
  }
  return response;
}

// A temp folder holding `files` (relative path -> text or bytes). Unless `files` has its own, it gets
// a package.json that makes .js files ES modules, because a temp folder is outside the repo's
// "type": "module". Returns { dir, cleanup }; cleanup() removes the folder (async, with a few short
// retries because Windows can hold a just-closed file for a moment).
export async function tempTree(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'cinar-tree-'));
  const all = { 'package.json': '{"type":"module"}\n', ...files };
  for (const [file, content] of Object.entries(all)) {
    const path = join(dir, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }) };
}
