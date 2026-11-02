import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKV } from '../dev/kv.mjs';

// A KV over a fresh folder, removed when the test ends. The folder sits inside a sandbox
// (`base`) so a test can also check that nothing is written next to it.
async function tempKv(t) {
  const base = await mkdtemp(join(tmpdir(), 'cinar-kv-'));
  t.after(() => rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const dir = join(base, 'kv');
  return { kv: createKV(dir), dir, base };
}

const everyByte = Uint8Array.from({ length: 256 }, (_, i) => i);
const bytesOf = (arrayBuffer) => new Uint8Array(arrayBuffer);

test('get on a missing key returns null; getWithMetadata returns {value:null, metadata:null}', async (t) => {
  const { kv } = await tempKv(t);
  assert.equal(await kv.get('nope'), null);
  assert.equal(await kv.get('nope', 'json'), null);
  assert.equal(await kv.get('nope', 'arrayBuffer'), null);
  assert.deepEqual(await kv.getWithMetadata('nope'), { value: null, metadata: null });
});

test('put/get roundtrip for text, json, arrayBuffer and stream', async (t) => {
  const { kv } = await tempKv(t);

  await kv.put('text', 'merhaba çınar');
  assert.equal(await kv.get('text'), 'merhaba çınar');
  assert.equal(await kv.get('text', 'text'), 'merhaba çınar');
  assert.equal(await kv.get('text', { type: 'text' }), 'merhaba çınar');

  await kv.put('json', JSON.stringify({ a: [1, 2], b: 'ç' }));
  assert.deepEqual(await kv.get('json', 'json'), { a: [1, 2], b: 'ç' });
  assert.deepEqual(await kv.get('json', { type: 'json', cacheTtl: 60 }), { a: [1, 2], b: 'ç' });

  // Every byte value, so any accidental text re-encoding would show.
  await kv.put('bin', everyByte);
  const buffer = await kv.get('bin', 'arrayBuffer');
  assert.ok(buffer instanceof ArrayBuffer);
  assert.deepEqual(bytesOf(buffer), everyByte);

  const stream = await kv.get('bin', 'stream');
  assert.ok(stream instanceof ReadableStream);
  assert.deepEqual(bytesOf(await new Response(stream).arrayBuffer()), everyByte);

  // An empty value is a value, not a missing key.
  await kv.put('empty', '');
  assert.equal(await kv.get('empty'), '');
  assert.equal((await kv.get('empty', 'arrayBuffer')).byteLength, 0);
});

test('put() accepts strings, ArrayBuffers, typed-array views and ReadableStreams', async (t) => {
  const { kv } = await tempKv(t);

  await kv.put('arraybuffer', everyByte.buffer.slice(0));
  assert.deepEqual(bytesOf(await kv.get('arraybuffer', 'arrayBuffer')), everyByte);

  // A view into a bigger buffer stores only the view's bytes.
  await kv.put('view', everyByte.subarray(10, 20));
  assert.deepEqual(bytesOf(await kv.get('view', 'arrayBuffer')), everyByte.subarray(10, 20));

  await kv.put('dataview', new DataView(everyByte.buffer, 5, 3));
  assert.deepEqual(bytesOf(await kv.get('dataview', 'arrayBuffer')), Uint8Array.of(5, 6, 7));

  await kv.put('stream', new Response(everyByte).body);
  assert.deepEqual(bytesOf(await kv.get('stream', 'arrayBuffer')), everyByte);
});

test('put() rejects other value types, and get() rejects an unknown type', async (t) => {
  const { kv } = await tempKv(t);
  for (const bad of [{}, [1, 2], 42, true, null, undefined]) {
    await assert.rejects(kv.put('k', bad), /accepts only strings, ArrayBuffers, ArrayBufferViews, and ReadableStreams/);
  }
  assert.equal(await kv.get('k'), null);

  await kv.put('k', 'v');
  await assert.rejects(kv.get('k', 'blob'), /type/);
  await assert.rejects(kv.getWithMetadata('k', { type: 'blob' }), /type/);
});

test('metadata roundtrips and >1024 bytes of metadata throws', async (t) => {
  const { kv } = await tempKv(t);
  const metadata = { type: 'image/jpeg', w: 800, h: 600, name: 'çınar' };

  await kv.put('m', 'v', { metadata });
  assert.deepEqual(await kv.getWithMetadata('m'), { value: 'v', metadata });
  assert.deepEqual(await kv.getWithMetadata('m', 'text'), { value: 'v', metadata });

  await kv.put('j', '{"a":1}', { metadata: { n: 1 } });
  assert.deepEqual(await kv.getWithMetadata('j', 'json'), { value: { a: 1 }, metadata: { n: 1 } });

  await kv.put('plain', 'v');
  assert.deepEqual(await kv.getWithMetadata('plain'), { value: 'v', metadata: null });

  // The limit is on the serialised JSON, in bytes: {"x":"…"} is 8 bytes plus the string.
  const sized = (n, ch = 'a') => ({ x: ch.repeat(n) });
  await kv.put('edge', 'v', { metadata: sized(1016) });
  await assert.rejects(kv.put('over', 'v', { metadata: sized(1017) }), /1024/);
  await assert.rejects(kv.put('over', 'v', { metadata: sized(509, 'ç') }), /1024/); // 509 chars, 1018 bytes
  assert.equal(await kv.get('over'), null, 'a rejected put writes nothing');
});

test('a rejected put leaves the old value alone, and a put without metadata clears the old metadata', async (t) => {
  const { kv, dir } = await tempKv(t);

  await kv.put('k', 'one', { metadata: { v: 1 } });
  await assert.rejects(kv.put('k', 'two', { metadata: { x: 'a'.repeat(2000) } }));
  assert.deepEqual(await kv.getWithMetadata('k'), { value: 'one', metadata: { v: 1 } });

  await kv.put('k', 'three');
  assert.deepEqual(await kv.getWithMetadata('k'), { value: 'three', metadata: null });
  assert.deepEqual(await readdir(dir), ['k.bin']);
});

test('keys containing "/" work; empty key throws', async (t) => {
  const { kv } = await tempKv(t);

  // "*" is the one character encodeURIComponent leaves alone that Windows refuses in a file name;
  // the rest cover reserved characters, spaces, non-ASCII and look-alikes of the encoding itself.
  const keys = [
    'img/abc123/full',
    'img/abc123/thumb',
    'a/b',
    'a%2Fb',
    'a*b',
    'a b',
    'ç/ı',
    'a:b?c"d<e>f|g\\h',
    '100%',
    'dot.',
    '..',
    "it's (1)!~",
  ];
  for (const key of keys) await kv.put(key, `value of ${key}`);
  for (const key of keys) assert.equal(await kv.get(key), `value of ${key}`, key);
  assert.deepEqual((await kv.list()).keys.map((k) => k.name), [...keys].sort());

  for (const bad of ['', undefined, null, 42]) {
    await assert.rejects(kv.put(bad, 'x'), /key/i);
    await assert.rejects(kv.get(bad), /key/i);
    await assert.rejects(kv.getWithMetadata(bad), /key/i);
    await assert.rejects(kv.delete(bad), /key/i);
  }
});

test('no key can reach outside the folder', async (t) => {
  const { kv, dir, base } = await tempKv(t);
  const keys = ['.', '..', '../escape', '..\\escape', '/absolute', 'C:\\drive', 'a/../../b'];
  for (const key of keys) await kv.put(key, `value of ${key}`, { metadata: { key } });
  for (const key of keys) assert.deepEqual(await kv.getWithMetadata(key), { value: `value of ${key}`, metadata: { key } });

  assert.deepEqual(await readdir(base), ['kv'], 'nothing was written beside the KV folder');
  assert.equal((await readdir(dir)).length, keys.length * 2);
});

test('stores <encodeURIComponent(key)>.bin plus .meta.json, with "*" escaped as %2A', async (t) => {
  const { kv, dir } = await tempKv(t);
  await kv.put('img/abc/full', 'x', { metadata: { type: 'image/png' } });
  await kv.put('a*b', 'x');
  assert.deepEqual((await readdir(dir)).sort(), ['a%2Ab.bin', 'img%2Fabc%2Ffull.bin', 'img%2Fabc%2Ffull.meta.json']);
});

test('delete removes; list({prefix}) returns {keys:[{name, metadata}], list_complete:true}', async (t) => {
  const { kv, dir } = await tempKv(t);
  await kv.put('img/a/full', 'x', { metadata: { type: 'image/jpeg' } });
  await kv.put('img/a/thumb', 'x');
  await kv.put('img/b/full', 'x', { metadata: { type: 'image/png' } });
  await kv.put('other', 'x');

  assert.deepEqual(await kv.list({ prefix: 'img/a/' }), {
    keys: [{ name: 'img/a/full', metadata: { type: 'image/jpeg' } }, { name: 'img/a/thumb' }],
    list_complete: true,
  });
  assert.deepEqual((await kv.list()).keys.map((k) => k.name), ['img/a/full', 'img/a/thumb', 'img/b/full', 'other']);
  assert.deepEqual(await kv.list({ prefix: 'nothing/' }), { keys: [], list_complete: true });

  await kv.delete('img/a/full');
  assert.equal(await kv.get('img/a/full'), null);
  assert.deepEqual(await kv.getWithMetadata('img/a/full'), { value: null, metadata: null });
  assert.deepEqual((await kv.list({ prefix: 'img/a/' })).keys, [{ name: 'img/a/thumb' }]);
  assert.ok(!(await readdir(dir)).includes('img%2Fa%2Ffull.meta.json'), 'the metadata file goes too');

  await kv.delete('img/a/full'); // deleting a missing key is not an error
  await kv.delete('never-existed');
});

test('list() refuses limit and cursor instead of silently ignoring them', async (t) => {
  const { kv } = await tempKv(t);
  await kv.put('a', 'x');
  await assert.rejects(kv.list({ limit: 1 }), /limit|cursor/);
  await assert.rejects(kv.list({ cursor: 'abc' }), /limit|cursor/);
});

test('createKV creates its folder, and the data outlives the instance', async (t) => {
  const { dir } = await tempKv(t);
  const nested = join(dir, 'not', 'yet', 'there');
  await createKV(nested).put('k', 'v');
  assert.equal(await createKV(nested).get('k'), 'v');
});
