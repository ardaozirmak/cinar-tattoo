import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildRouteTable } from '../dev/routes.mjs';
import { dispatch } from '../dev/server.mjs';
import { kvKeys } from '../functions/_lib/media.js';
import { onRequestGet } from '../functions/img/[id]/[variant].js';
import { TINY_JPEG, TINY_PNG } from './admin-helpers.mjs';
import { call, makeEnv } from './helpers.mjs';

const KEY = '0123456789abcdef0123';
const THUMB_BYTES = TINY_JPEG.subarray(0, 100); // not the same bytes as the full image

function freshEnv(t) {
  const { env, cleanup } = makeEnv();
  t.after(cleanup);
  return env;
}

const get = (env, id, variant, { headers = {}, query = '' } = {}) =>
  call(onRequestGet, { url: `https://cinar.test/img/${id}/${variant}${query}`, params: { id, variant }, headers, env });

// Puts an image into KV the way the upload API does.
const store = (env, key, variant, bytes, metadata = { type: 'image/jpeg', width: 16, height: 12 }) =>
  env.IMAGES.put(kvKeys(key)[variant], bytes, { metadata });

// The keys the route reads from KV, in order. It may use get or getWithMetadata.
function recordReads(env) {
  const reads = [];
  const real = env.IMAGES;
  env.IMAGES = {
    ...real,
    get(key, ...rest) {
      reads.push(key);
      return real.get(key, ...rest);
    },
    getWithMetadata(key, ...rest) {
      reads.push(key);
      return real.getWithMetadata(key, ...rest);
    },
  };
  return reads;
}

const bytesOf = async (response) => new Uint8Array(await response.arrayBuffer());

async function assertNotFound(response, label) {
  assert.equal(response.status, 404, label);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8', label);
  assert.equal(response.headers.get('Cache-Control'), 'no-store', `${label}: an error is never cached`);
  assert.deepEqual(await response.json(), { message: 'Fotoğraf bulunamadı.' }, label);
}

test('a stored image is 200 with its bytes, its type, a one-year immutable Cache-Control, an ETag and nosniff', async (t) => {
  const env = freshEnv(t);
  await store(env, KEY, 'full', TINY_JPEG);
  await store(env, KEY, 'thumb', THUMB_BYTES);

  const full = await get(env, KEY, 'full');
  assert.equal(full.status, 200);
  assert.deepEqual(await bytesOf(full), TINY_JPEG);
  assert.equal(full.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(full.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(full.headers.get('ETag'), `"${KEY}-full"`);
  assert.equal(full.headers.get('X-Content-Type-Options'), 'nosniff');

  const thumb = await get(env, KEY, 'thumb');
  assert.equal(thumb.status, 200);
  assert.deepEqual(await bytesOf(thumb), THUMB_BYTES, 'the thumb is its own image');
  assert.equal(thumb.headers.get('ETag'), `"${KEY}-thumb"`, 'and has its own ETag');
});

test('the Content-Type is the type in the metadata (default image/jpeg), and only an image type is ever sent', async (t) => {
  const env = freshEnv(t);
  const other = 'fedcba9876543210fedc';
  await store(env, KEY, 'full', TINY_PNG, { type: 'image/png', width: 1, height: 1 });
  assert.equal((await get(env, KEY, 'full')).headers.get('Content-Type'), 'image/png');

  await store(env, KEY, 'thumb', TINY_JPEG, { type: 'image/webp', width: 1, height: 1 });
  assert.equal((await get(env, KEY, 'thumb')).headers.get('Content-Type'), 'image/webp');

  await env.IMAGES.put(kvKeys(other).full, TINY_JPEG); // no metadata at all
  assert.equal((await get(env, other, 'full')).headers.get('Content-Type'), 'image/jpeg');

  for (const type of ['text/html', 'image/svg+xml', 'application/javascript', '', 42, null]) {
    await store(env, other, 'full', TINY_JPEG, { type, width: 1, height: 1 });
    assert.equal((await get(env, other, 'full')).headers.get('Content-Type'), 'image/jpeg', `metadata type ${JSON.stringify(type)}`);
  }
});

test('If-None-Match with the ETag is 304 without a body and without reading KV; the 304 carries ETag and Cache-Control', async (t) => {
  const env = freshEnv(t);
  await store(env, KEY, 'full', TINY_JPEG);
  const reads = recordReads(env);
  const etag = `"${KEY}-full"`;

  for (const header of [etag, `W/${etag}`, `"other-full", ${etag}`, ` ${etag} `]) {
    const response = await get(env, KEY, 'full', { headers: { 'If-None-Match': header } });
    assert.equal(response.status, 304, header);
    assert.equal(response.body, null, header);
    assert.equal(response.headers.get('ETag'), etag, header);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable', header);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff', header);
  }
  assert.deepEqual(reads, [], 'the ETag names an image that never changes, so KV is not asked');
});

test('another ETag, the ETag of the other variant, or none is a normal 200', async (t) => {
  const env = freshEnv(t);
  await store(env, KEY, 'full', TINY_JPEG);
  for (const header of ['"other-full"', `"${KEY}-thumb"`, `${KEY}-full`, '']) {
    const response = await get(env, KEY, 'full', { headers: { 'If-None-Match': header } });
    assert.equal(response.status, 200, JSON.stringify(header));
    assert.deepEqual(await bytesOf(response), TINY_JPEG);
  }
});

test('an id that is not 20 lower-case hex characters, or a variant other than full and thumb, is 404 and KV is not asked', async (t) => {
  const env = freshEnv(t);
  await store(env, KEY, 'full', TINY_JPEG);
  const reads = recordReads(env);

  const badIds = ['', 'abc', KEY.toUpperCase(), KEY.slice(1), `${KEY}0`, 'zzzzzzzzzzzzzzzzzzzz', `${KEY}\n`, ` ${KEY}`, '../../etc/passwd', `${KEY}/../x`, 'seed-chicano-kol', undefined];
  for (const id of badIds) await assertNotFound(await get(env, id, 'full'), `id ${JSON.stringify(id)}`);

  for (const variant of ['', 'medium', 'FULL', 'Thumb', 'full/', 'full.jpg', 'constructor', '__proto__', 'toString', undefined]) {
    await assertNotFound(await get(env, KEY, variant), `variant ${JSON.stringify(variant)}`);
  }
  await assertNotFound(await get(env, 'abc', 'full', { headers: { 'If-None-Match': '"abc-full"' } }), 'a bad id is 404 even with a matching ETag');
  assert.deepEqual(reads, []);
});

test('a well-formed id that is not in KV is 404, per variant', async (t) => {
  const env = freshEnv(t);
  await assertNotFound(await get(env, KEY, 'full'), 'nothing stored');
  await store(env, KEY, 'thumb', THUMB_BYTES);
  await assertNotFound(await get(env, KEY, 'full'), 'only the thumb is stored');
  assert.equal((await get(env, KEY, 'thumb')).status, 200);
});

test('a KV that fails is a logged 500 in the panel’s JSON, never cached', async (t) => {
  const env = freshEnv(t);
  const failing = () => Promise.reject(new Error('KV kapalı'));
  env.IMAGES = { ...env.IMAGES, get: failing, getWithMetadata: failing };
  const logged = t.mock.method(console, 'error', () => {});

  const response = await get(env, KEY, 'full');
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { message: 'Beklenmeyen bir hata oldu. Tekrar dene.' });
  assert.equal(logged.mock.callCount(), 1);
  assert.match(logged.mock.calls[0].arguments.map(String).join(' '), /KV kapalı/);
});

// ---------------------------------------------------------------------------------------------
// The Cache API: used when the runtime has one (Node has none, so every test above runs without)
// ---------------------------------------------------------------------------------------------

// A stand-in for caches.default that keeps what it is given and records its calls.
function installCache(t, { failPut = false } = {}) {
  const stored = new Map();
  const calls = { match: [], put: [] };
  globalThis.caches = {
    default: {
      async match(request) {
        calls.match.push(request.url);
        return stored.get(request.url)?.clone();
      },
      async put(request, response) {
        calls.put.push(request.url);
        if (failPut) throw new Error('önbellek dolu');
        stored.set(request.url, response);
      },
    },
  };
  t.after(() => {
    delete globalThis.caches;
  });
  return calls;
}

test('with a Cache API the first request reads KV and stores the response, and the next one comes from the cache', async (t) => {
  const env = freshEnv(t);
  await store(env, KEY, 'full', TINY_JPEG);
  const reads = recordReads(env);
  const calls = installCache(t);

  const first = await get(env, KEY, 'full');
  assert.equal(first.status, 200);
  assert.deepEqual(await bytesOf(first), TINY_JPEG);
  assert.deepEqual(reads, [kvKeys(KEY).full]);
  assert.deepEqual(calls.put, [`https://cinar.test/img/${KEY}/full`]);

  const second = await get(env, KEY, 'full');
  assert.equal(second.status, 200);
  assert.deepEqual(await bytesOf(second), TINY_JPEG);
  assert.equal(second.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(second.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(second.headers.get('ETag'), `"${KEY}-full"`);
  assert.equal(second.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(reads, [kvKeys(KEY).full], 'KV was not asked again');
  assert.equal(calls.put.length, 1, 'and nothing was stored again');
});

test('the cache key leaves out the query string, so ?x=1, ?x=2 and no query share one entry', async (t) => {
  const env = freshEnv(t);
  await store(env, KEY, 'full', TINY_JPEG);
  const reads = recordReads(env);
  const calls = installCache(t);

  await get(env, KEY, 'full', { query: '?x=1' });
  await get(env, KEY, 'full', { query: '?x=2' });
  await get(env, KEY, 'full');
  assert.equal(reads.length, 1);
  assert.deepEqual(calls.match, new Array(3).fill(`https://cinar.test/img/${KEY}/full`));
});

test('a 304, a 404 and a bad id never touch the cache; a missing image is not stored in it', async (t) => {
  const env = freshEnv(t);
  const calls = installCache(t);

  assert.equal((await get(env, KEY, 'full', { headers: { 'If-None-Match': `"${KEY}-full"` } })).status, 304);
  assert.equal((await get(env, 'abc', 'full')).status, 404);
  assert.equal((await get(env, KEY, 'medium')).status, 404);
  assert.deepEqual(calls.match, [], 'answered before the cache is asked');

  assert.equal((await get(env, KEY, 'thumb')).status, 404, 'well-formed but not stored');
  assert.deepEqual(calls.put, [], 'a miss is not worth keeping');
});

test('a cache that cannot store is logged and does not change the answer', async (t) => {
  const env = freshEnv(t);
  await store(env, KEY, 'full', TINY_JPEG);
  installCache(t, { failPut: true });
  const logged = t.mock.method(console, 'error', () => {});

  const response = await get(env, KEY, 'full');
  assert.equal(response.status, 200);
  assert.deepEqual(await bytesOf(response), TINY_JPEG);
  assert.equal(logged.mock.callCount(), 1);
  assert.match(logged.mock.calls[0].arguments.map(String).join(' '), /önbellek dolu/);
});

// ---------------------------------------------------------------------------------------------
// Routing: the file name is the route
// ---------------------------------------------------------------------------------------------

test('functions/img/[id]/[variant].js serves GET /img/<id>/<variant> in the emulator, and nothing else of that shape', async (t) => {
  const env = freshEnv(t);
  await store(env, KEY, 'full', TINY_JPEG);
  const table = await buildRouteTable(fileURLToPath(new URL('../functions', import.meta.url)));
  const send = (path, method = 'GET') => dispatch(new Request(`http://127.0.0.1:8788${path}`, { method }), { table, env, assets: env.ASSETS });

  const ok = await send(`/img/${KEY}/full`);
  assert.equal(ok.status, 200);
  assert.deepEqual(await bytesOf(ok), TINY_JPEG);
  assert.equal((await send(`/img/${KEY}/thumb`)).status, 404);
  assert.equal((await send(`/img/${KEY}/medium`)).status, 404);
  assert.equal((await send(`/img/${KEY}`)).status, 404, 'no variant: no such file either');
  assert.equal((await send(`/img/${KEY}/full/extra`)).status, 404);
  const post = await send(`/img/${KEY}/full`, 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
});
