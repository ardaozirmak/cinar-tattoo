import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { call, makeEnv, tempTree } from './helpers.mjs';

// ---- makeEnv ----

test('makeEnv gives DB, IMAGES, ASSETS and the default secrets, with the data in its own temp folder', async (t) => {
  const { env, dir, cleanup } = makeEnv();
  t.after(cleanup);

  assert.deepEqual(Object.keys(env).sort(), ['ADMIN_PASSWORD', 'APP_SECRET', 'ASSETS', 'DB', 'DEV_INSECURE_COOKIES', 'IMAGES']);
  assert.equal(env.ADMIN_PASSWORD, 'test-sifre-123');
  assert.equal(env.APP_SECRET, 'x'.repeat(40));
  assert.equal(env.DEV_INSECURE_COOKIES, '1');

  await env.DB.exec('CREATE TABLE t (v TEXT)');
  await env.IMAGES.put('img/abc/full', 'bytes');
  assert.ok(existsSync(join(dir, 'db.sqlite')));
  assert.ok(existsSync(join(dir, 'kv', 'img%2Fabc%2Ffull.bin')));
});

test('makeEnv merges vars over the defaults, and a key set to undefined is removed', (t) => {
  const { env, cleanup } = makeEnv({ vars: { APP_SECRET: undefined, ADMIN_PASSWORD: 'other', EXTRA: 'e' } });
  t.after(cleanup);
  assert.equal('APP_SECRET' in env, false);
  assert.equal(env.ADMIN_PASSWORD, 'other');
  assert.equal(env.EXTRA, 'e');
  assert.equal(env.DEV_INSECURE_COOKIES, '1');

  // The defaults themselves are not changed for the next env.
  const next = makeEnv();
  t.after(next.cleanup);
  assert.equal(next.env.APP_SECRET, 'x'.repeat(40));
  assert.equal(next.env.ADMIN_PASSWORD, 'test-sifre-123');
});

test('every makeEnv has its own folder and its own database', async (t) => {
  const a = makeEnv();
  const b = makeEnv();
  t.after(a.cleanup);
  t.after(b.cleanup);
  assert.notEqual(a.dir, b.dir);

  await a.env.DB.exec('CREATE TABLE only_in_a (v TEXT)');
  await assert.rejects(b.env.DB.prepare('SELECT * FROM only_in_a').all(), /no such table/);
});

test('cleanup() closes the database and removes the folder; it is synchronous, safe to repeat and independent of env.DB', async () => {
  const { env, dir, cleanup } = makeEnv();
  await env.DB.exec('CREATE TABLE t (v TEXT)');
  await env.IMAGES.put('k', 'v');
  const original = env.DB;
  env.DB = { prepare: () => assert.fail('a wrapper without close()') }; // what a test that wraps env.DB leaves behind

  assert.equal(cleanup(), undefined, 'not a promise');
  assert.equal(existsSync(dir), false, 'the folder is gone even though Windows would not delete an open database');
  await assert.rejects(original.prepare('SELECT 1').all(), /D1_ERROR/);
  assert.doesNotThrow(() => cleanup());
});

test('ASSETS serves the real public/ folder, and answers 404 (no crash) for what is not there', async (t) => {
  const { env, cleanup } = makeEnv();
  t.after(cleanup);
  for (const input of ['http://cinar.test/definitely-not-a-file-3f9a', new Request('https://cinar.test/also/not/here.css')]) {
    assert.equal((await env.ASSETS.fetch(input)).status, 404);
  }
});

// ---- call ----

test('call runs the handler with the Pages context and returns its Response (sync or async)', async () => {
  const env = { marker: true };
  let seen;
  const handler = (context) => {
    seen = context;
    return new Response('hi', { status: 201 });
  };

  const response = await call(handler, { env });
  assert.equal(response.status, 201);
  assert.equal(await response.text(), 'hi');

  assert.deepEqual(Object.keys(seen).sort(), ['data', 'env', 'next', 'params', 'request', 'waitUntil']);
  assert.equal(seen.env, env, 'the same env object, not a copy');
  assert.deepEqual(seen.params, {});
  assert.deepEqual(seen.data, {});
  assert.equal(seen.request.method, 'GET');
  assert.equal(seen.request.url, 'https://cinar.test/');
  assert.equal(seen.request.headers.has('cf-connecting-ip'), false, 'no client IP unless the test sets one');

  const asynchronous = await call(async () => new Response('later'), { env });
  assert.equal(await asynchronous.text(), 'later');
});

test('call builds the request from method, url, headers and body; Origin and Cookie reach the handler', async () => {
  const handler = async ({ request, params }) =>
    Response.json({
      method: request.method,
      url: request.url,
      params,
      origin: request.headers.get('origin'),
      cookie: request.headers.get('cookie'),
      contentType: request.headers.get('content-type'),
      text: await request.text(),
    });

  const response = await call(handler, {
    method: 'POST',
    url: 'https://cinar.test/api/admin/login?x=1',
    params: { path: ['login'] },
    headers: { Origin: 'https://cinar.test', Cookie: 'cinar_admin=abc', 'Content-Type': 'application/json' },
    body: '{"password":"çınar"}',
    env: {},
  });
  assert.deepEqual(await response.json(), {
    method: 'POST',
    url: 'https://cinar.test/api/admin/login?x=1',
    params: { path: ['login'] },
    origin: 'https://cinar.test',
    cookie: 'cinar_admin=abc',
    contentType: 'application/json',
    text: '{"password":"çınar"}',
  });
});

test('call takes a FormData body, as the photo upload tests will send', async () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
  const form = new FormData();
  form.set('caption', 'çınar');
  form.set('full', new Blob([bytes], { type: 'image/jpeg' }), 'full.jpg');

  const handler = async ({ request }) => {
    const received = await request.formData();
    return Response.json({
      contentType: request.headers.get('content-type').split(';')[0],
      caption: received.get('caption'),
      bytes: [...new Uint8Array(await received.get('full').arrayBuffer())],
    });
  };
  const body = await (await call(handler, { method: 'POST', body: form, env: {} })).json();
  assert.deepEqual(body, { contentType: 'multipart/form-data', caption: 'çınar', bytes: [...bytes] });
});

test('call: next() returns env.ASSETS.fetch(request)', async () => {
  const requests = [];
  const env = {
    ASSETS: {
      fetch: async (request) => {
        requests.push(request);
        return new Response('from assets');
      },
    },
  };
  const response = await call(({ next }) => next(), { url: 'https://cinar.test/a.txt', headers: { 'x-mark': '1' }, env });
  assert.equal(await response.text(), 'from assets');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://cinar.test/a.txt');
  assert.equal(requests[0].headers.get('x-mark'), '1', 'the same request the handler got');
});

test('call waits for waitUntil work, including work started by that work, before it returns', async () => {
  const order = [];
  const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const response = await call(
    ({ waitUntil }) => {
      waitUntil(
        (async () => {
          await later(20);
          order.push('first');
          waitUntil(
            (async () => {
              await later(20);
              order.push('nested');
            })(),
          );
        })(),
      );
      order.push('handler');
      return new Response('x');
    },
    { env: {} },
  );
  assert.equal(await response.text(), 'x');
  assert.deepEqual(order, ['handler', 'first', 'nested']);
});

test('call: a waitUntil task that fails is logged and does not fail the call or the run, even when it fails early', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const response = await call(
    async ({ waitUntil }) => {
      waitUntil(Promise.reject(new Error('background failure')));
      // Still awaiting when the task has already failed: an unhandled rejection in the making.
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response('fine');
    },
    { env: {} },
  );
  assert.equal(await response.text(), 'fine');
  assert.equal(error.mock.callCount(), 1);
  assert.match(error.mock.calls[0].arguments.join(' '), /waitUntil.*background failure/);
});

test('call: a handler that throws rejects the call', async () => {
  await assert.rejects(
    call(
      () => {
        throw new Error('handler failure');
      },
      { env: {} },
    ),
    /handler failure/,
  );
});

// ---- tempTree ----

test('tempTree writes nested text and binary files, adds a package.json that makes .js files modules, and cleans up', async () => {
  const bytes = Uint8Array.of(0, 255, 128);
  const { dir, cleanup } = await tempTree({ 'a/b/c.txt': 'text', 'bytes.bin': bytes, 'mod.js': 'export const answer = 42;\n' });

  assert.equal(await readFile(join(dir, 'a', 'b', 'c.txt'), 'utf8'), 'text');
  assert.deepEqual(new Uint8Array(await readFile(join(dir, 'bytes.bin'))), bytes);
  assert.equal(await readFile(join(dir, 'package.json'), 'utf8'), '{"type":"module"}\n');
  assert.equal((await import(pathToFileURL(join(dir, 'mod.js')).href)).answer, 42, 'a .js file in the folder is an ES module');

  await cleanup();
  assert.equal(existsSync(dir), false);
});

test('tempTree keeps a package.json the files bring, and works with no files at all', async () => {
  const own = await tempTree({ 'package.json': '{"name":"own"}\n' });
  assert.equal(await readFile(join(own.dir, 'package.json'), 'utf8'), '{"name":"own"}\n');
  await own.cleanup();

  const empty = await tempTree();
  assert.ok(existsSync(empty.dir));
  await empty.cleanup();
});
