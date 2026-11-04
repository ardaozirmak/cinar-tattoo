import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, SITE_CSP, errorJson, htmlHeaders, json, readJson } from '../functions/_lib/http.js';

const ENDPOINT = 'https://cinar.test/api/x';
const encode = (text) => new TextEncoder().encode(text);
const post = (body, headers = {}) => new Request(ENDPOINT, { method: 'POST', headers, body });

// A request whose body is a stream the test controls. It hands out `chunk` over and over, `limit`
// times (Infinity for a body that never ends), and remembers how often it was asked for more and
// whether the reader gave up on it.
function streamingRequest({ chunk, limit = Infinity, headers = {} }) {
  const state = { pulls: 0, cancelled: false };
  const body = new ReadableStream({
    pull(controller) {
      if (state.pulls >= limit) return controller.close();
      state.pulls += 1;
      return controller.enqueue(chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { request: new Request(ENDPOINT, { method: 'POST', headers, body, duplex: 'half' }), state };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected the promise to reject');
}

function assertHttpError(error, status, message) {
  assert.ok(error instanceof HttpError, `expected an HttpError, got ${error}`);
  assert.equal(error.status, status);
  assert.equal(error.message, message);
}

test('HttpError is an Error that carries a status', () => {
  const error = new HttpError(404, 'Bulunamadı.');
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'HttpError');
  assert.equal(error.status, 404);
  assert.equal(error.message, 'Bulunamadı.');
});

test('json answers 200 with a JSON body that is never cached or sniffed', async () => {
  const response = json({ ok: true, ad: 'Çınar' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(await response.json(), { ok: true, ad: 'Çınar' });
});

test('json takes a status and extra headers, which win over the defaults', async () => {
  const response = json({ id: 7 }, { status: 201, headers: { 'X-Extra': 'yes', 'Cache-Control': 'private' } });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('X-Extra'), 'yes');
  assert.equal(response.headers.get('Cache-Control'), 'private');
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.deepEqual(await response.json(), { id: 7 });
});

test('json keeps every Set-Cookie header it is given', () => {
  const headers = new Headers();
  headers.append('Set-Cookie', 'a=1; Path=/');
  headers.append('Set-Cookie', 'b=2; Path=/');
  const response = json({ ok: true }, { headers });
  assert.deepEqual(response.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/']);
});

test('errorJson answers with { message } and the given status', async () => {
  const response = errorJson(403, 'İstek reddedildi.');
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { message: 'İstek reddedildi.' });
});

test('readJson parses the body whatever its Content-Type: navigator.sendBeacon sends text/plain', async () => {
  assert.deepEqual(await readJson(post('{"kind":"whatsapp"}')), { kind: 'whatsapp' }); // string bodies are text/plain
  assert.equal(post('{}').headers.get('content-type'), 'text/plain;charset=UTF-8');
  assert.deepEqual(await readJson(post('{"a":1}', { 'Content-Type': 'application/json' })), { a: 1 });
  assert.deepEqual(await readJson(post(encode('{"a":2}'), { 'Content-Type': 'application/octet-stream' })), { a: 2 });
  assert.deepEqual(await readJson(post(encode('{"a":3}'))), { a: 3 }); // no Content-Type at all
});

test('readJson reads UTF-8 and any JSON value', async () => {
  assert.deepEqual(await readJson(post(JSON.stringify({ ad: 'Çınar Tattoo ş ğ ı 🙏' }))), { ad: 'Çınar Tattoo ş ğ ı 🙏' });
  assert.deepEqual(await readJson(post('[1,2]')), [1, 2]);
  assert.equal(await readJson(post('null')), null);
});

test('readJson answers 400 for an empty body; an endpoint that allows one looks at request.body first', async () => {
  const withoutBody = new Request(ENDPOINT, { method: 'POST' });
  assert.equal(withoutBody.body, null); // what such an endpoint checks
  assertHttpError(await rejection(readJson(withoutBody)), 400, 'İstek okunamadı.');
  assertHttpError(await rejection(readJson(new Request(ENDPOINT))), 400, 'İstek okunamadı.'); // a GET
  assertHttpError(await rejection(readJson(post(''))), 400, 'İstek okunamadı.');
  assertHttpError(await rejection(readJson(post(new Uint8Array(0)))), 400, 'İstek okunamadı.');
});

test('readJson answers 400 İstek okunamadı. for a body that is not JSON', async () => {
  for (const body of ['hello', '{"a":', '{a:1}', "{'a':1}", '   ', '{"a":1} {"b":2}', 'undefined']) {
    assertHttpError(await rejection(readJson(post(body))), 400, 'İstek okunamadı.');
  }
});

test('readJson answers 400 for bytes that are not UTF-8 instead of guessing', async () => {
  // {"a":"<0xFF>"}: JSON that would be fine if the bad byte were silently replaced.
  const bytes = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
  assertHttpError(await rejection(readJson(post(bytes))), 400, 'İstek okunamadı.');
});

test('readJson answers 400 when the body breaks off half way', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encode('{"a"'));
    },
    pull(controller) {
      controller.error(new Error('connection reset'));
    },
  });
  const request = new Request(ENDPOINT, { method: 'POST', body, duplex: 'half' });
  assertHttpError(await rejection(readJson(request)), 400, 'İstek okunamadı.');
});

test('readJson allows a body of exactly maxBytes and answers 413 for one byte more', async () => {
  const exact = '{"a":"xxxxxxxx"}';
  assert.equal(encode(exact).length, 16);
  assert.deepEqual(await readJson(post(exact), 16), { a: 'xxxxxxxx' });
  assertHttpError(await rejection(readJson(post(`${exact} `), 16)), 413, 'İstek çok büyük.');
});

test('readJson lets a Content-Length equal to the limit through and turns away one byte more', async () => {
  const exact = '{"a":"xxxxxxxx"}';
  assert.deepEqual(await readJson(post(exact, { 'Content-Length': '16' }), 16), { a: 'xxxxxxxx' });
  assertHttpError(await rejection(readJson(post(exact, { 'Content-Length': '17' }), 16)), 413, 'İstek çok büyük.');
});

test('readJson counts bytes, not characters', async () => {
  const body = JSON.stringify({ a: 'ş'.repeat(10) });
  assert.ok(encode(body).length > body.length);
  assert.deepEqual(await readJson(post(body), encode(body).length), { a: 'ş'.repeat(10) });
  assertHttpError(await rejection(readJson(post(body), body.length)), 413, 'İstek çok büyük.');
});

test('readJson caps the body at 64 KiB unless told otherwise', async () => {
  const padded = (size) => `{"a":"${'x'.repeat(size - 8)}"}`;
  assert.equal(encode(padded(65536)).length, 65536);
  assert.deepEqual(Object.keys(await readJson(post(padded(65536)))), ['a']);
  assertHttpError(await rejection(readJson(post(padded(65537)))), 413, 'İstek çok büyük.');
});

test('readJson turns a request away on its Content-Length alone, without reading the body', async () => {
  const { request, state } = streamingRequest({ chunk: encode('x'.repeat(100)), headers: { 'Content-Length': '1001' } });
  await new Promise((resolve) => setTimeout(resolve, 0)); // a stream fills its queue by itself, once, right after it is made
  const pullsBefore = state.pulls;
  assertHttpError(await rejection(readJson(request, 1000)), 413, 'İstek çok büyük.');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(state.pulls, pullsBefore, 'the body must not be read');
  assert.equal(request.bodyUsed, false);
});

test('readJson stops reading a body that never ends as soon as it passes the limit', async () => {
  // No Content-Length (chunked upload): only counting the bytes can protect the Function.
  const { request, state } = streamingRequest({ chunk: encode('x'.repeat(100)) });
  assertHttpError(await rejection(readJson(request, 1000)), 413, 'İstek çok büyük.');
  assert.ok(state.pulls < 50, `pulled ${state.pulls} chunks of a body whose limit is 10 chunks`);
  assert.equal(state.cancelled, true, 'the sender is told to stop');
});

test('readJson cannot be fooled by a Content-Length that undersells the body', async () => {
  const { request } = streamingRequest({ chunk: encode('x'.repeat(100)), limit: 5, headers: { 'Content-Length': '10' } });
  assertHttpError(await rejection(readJson(request, 300)), 413, 'İstek çok büyük.');
});

test('readJson counts the stream when the Content-Length is not a number', async () => {
  assert.deepEqual(await readJson(post('{"a":1}', { 'Content-Length': 'abc' })), { a: 1 });
  const { request } = streamingRequest({ chunk: encode('x'.repeat(100)), limit: 20, headers: { 'Content-Length': 'abc' } });
  assertHttpError(await rejection(readJson(request, 1000)), 413, 'İstek çok büyük.');
});

test('readJson joins a body that arrives in many small pieces', async () => {
  const text = JSON.stringify({ ad: 'Çınar', liste: ['ş', 'ğ', 'ı'] });
  const bytes = encode(text);
  const body = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); // also splits multi-byte letters
      controller.close();
    },
  });
  const request = new Request(ENDPOINT, { method: 'POST', body, duplex: 'half' });
  assert.deepEqual(await readJson(request), { ad: 'Çınar', liste: ['ş', 'ğ', 'ı'] });
});

test('SITE_CSP is the policy of the public page, word for word', () => {
  assert.equal(
    SITE_CSP,
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; frame-src https://www.google.com https://maps.google.com; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  );
});

test('htmlHeaders carries the page headers and nothing else', () => {
  const headers = htmlHeaders();
  assert.ok(headers instanceof Headers);
  assert.deepEqual(Object.fromEntries(headers), {
    'cache-control': 'no-cache',
    'content-security-policy': SITE_CSP,
    'content-type': 'text/html; charset=utf-8',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
});

test('htmlHeaders gives a fresh Headers every time, so a caller can add to its own', () => {
  const first = htmlHeaders();
  first.set('X-Mine', '1');
  first.delete('Content-Type');
  assert.equal(htmlHeaders().get('X-Mine'), null);
  assert.equal(htmlHeaders().get('Content-Type'), 'text/html; charset=utf-8');
});

test('siteRedirect sends other hosts to SITE_URL and leaves the site itself alone', async () => {
  const { siteRedirect } = await import('../functions/_lib/http.js');
  const env = { SITE_URL: 'https://cinartattoo.com/' };
  const away = siteRedirect(new Request('https://cinar-tattoo.pages.dev/?a=1'), env);
  assert.equal(away.status, 301);
  assert.equal(away.headers.get('Location'), 'https://cinartattoo.com/?a=1');
  assert.equal(siteRedirect(new Request('https://www.cinartattoo.com/sitemap.xml'), env).headers.get('Location'), 'https://cinartattoo.com/sitemap.xml');
  assert.equal(siteRedirect(new Request('https://cinartattoo.com/'), env), null);
  assert.equal(siteRedirect(new Request('https://cinar-tattoo.pages.dev/'), {}), null);
  assert.equal(siteRedirect(new Request('https://cinar-tattoo.pages.dev/'), { SITE_URL: 'bozuk' }), null);
});
