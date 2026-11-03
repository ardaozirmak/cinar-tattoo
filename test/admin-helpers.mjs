// Helpers for the tests of the admin content and photo API, and of the upload reader.
//
// - freshEnv(t) is a makeEnv() that is removed after the test.
// - api() sends a request to /api/admin/<path> through the Pages entry point.
// - uploadForm() builds the multipart form the panel sends for a photo.
// - TINY_JPEG, TINY_PNG and TINY_WEBP are real image files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/admin/[[path]].js';
import { call, makeEnv } from './helpers.mjs';

export const SITE = 'https://cinar.test';

const fromBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

// A 16 x 12 JPEG of 633 bytes, made once with Pillow (test/fixtures/tiny.jpg), a 1x1 PNG of 69 bytes
// and a 1x1 lossless WebP of 38 bytes.
export const TINY_JPEG = new Uint8Array(readFileSync(new URL('./fixtures/tiny.jpg', import.meta.url)));
export const TINY_PNG = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4uSQLAAQRAdiP17pYAAAAAElFTkSuQmCC');
export const TINY_WEBP = fromBase64('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQ0iZXrf+BiOh/AAA=');

/**
 * A new env for this test (DB, KV and ASSETS over temp folders), removed after it. Every call() comes
 * from the IP 'unknown', so a test that records login failures must not share its env with another.
 */
export function freshEnv(t, options) {
  const { env, cleanup } = makeEnv(options);
  t.after(cleanup);
  return env;
}

/**
 * A request to /api/admin/<path>. One that changes data carries the site's own Origin, as the panel's do,
 * and a GET carries none, as a browser's same-origin GET does; `origin` overrides that (null: no Origin
 * header). `json` is sent as a JSON body, `body` as it is (a FormData, say); `headers` are added.
 */
export function api(env, method, path, { json, body, cookie, origin, ip, base = SITE, headers: extra } = {}) {
  const headers = { ...extra };
  const sentOrigin = origin === undefined ? (method === 'GET' ? null : base) : origin;
  if (sentOrigin !== null) headers.Origin = sentOrigin;
  if (cookie !== undefined) headers.Cookie = cookie;
  if (ip !== undefined) headers['CF-Connecting-IP'] = ip;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  return call(onRequest, { method, url: `${base}/api/admin/${path}`, headers, body: json === undefined ? body : JSON.stringify(json), env });
}

/** `size` bytes that start like a JPEG (and are not one): for the size limits. */
export function jpegOfSize(size) {
  const bytes = new Uint8Array(size);
  bytes.set(TINY_JPEG.subarray(0, 3));
  return bytes;
}

/** The response is the error `{ message }` with this status. */
export async function assertError(response, status, message, label = message) {
  assert.equal(response.status, status, label);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8', label);
  assert.deepEqual(await response.json(), { message }, label);
}

/**
 * The form the panel sends for a photo: the files `full` and `thumb` (bytes), the text fields `width` and
 * `height`, and any other text field that is passed (`caption`, `category`). A part given as null is
 * left out, and a part given as text is sent as a text field, not as a file.
 */
export function uploadForm({ full = TINY_JPEG, thumb = TINY_JPEG, width = 16, height = 12, ...fields } = {}) {
  const form = new FormData();
  for (const [name, value] of Object.entries({ full, thumb, width, height, ...fields })) {
    if (value === null) continue;
    if (value instanceof Uint8Array) form.append(name, new Blob([value], { type: 'image/jpeg' }), `${name}.jpg`);
    else form.append(name, String(value));
  }
  return form;
}
