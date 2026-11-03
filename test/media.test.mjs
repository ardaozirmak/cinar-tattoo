import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_HERO, SEED_PHOTOS } from '../functions/_lib/defaults.js';
import { CAPTION_MAX } from '../functions/_lib/fields.js';
import { IMAGE_KEY_RE, IMAGE_LIMITS, PHOTO_ID_RE, imageUrls, kvKeys, newImageKey, sniffImageType } from '../functions/_lib/media.js';

const bytes = (...values) => Uint8Array.from(values);
const ascii = (text) => new TextEncoder().encode(text);
const fromBase64 = (text) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

// Real files, made once with Pillow: a 1x1 PNG (69 bytes) and a 1x1 lossless WebP (38 bytes).
const PNG_FILE = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4uSQLAAQRAdiP17pYAAAAAElFTkSuQmCC');
const WEBP_FILE = fromBase64('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQ0iZXrf+BiOh/AAA=');
const JPEG_FILE = new Uint8Array(readFileSync(new URL('./fixtures/tiny.jpg', import.meta.url)));

const KEY = '0123456789abcdef0123';

test('IMAGE_LIMITS: the numbers of the spec, and the caption limit has one source', () => {
  assert.deepEqual(IMAGE_LIMITS, { fullMaxBytes: 2621440, thumbMaxBytes: 409600, maxDimension: 4000, maxPhotos: 400, captionMax: 120 });
  assert.equal(IMAGE_LIMITS.captionMax, CAPTION_MAX);
  assert.ok(Object.isFrozen(IMAGE_LIMITS), 'shared module data: nobody may change it by accident');
});

// ---------------------------------------------------------------------------------------------
// Ids and keys
// ---------------------------------------------------------------------------------------------

test('PHOTO_ID_RE accepts every seed photo id (P14’s pattern rejected seed-w01) and 20 hex characters', () => {
  for (const { id } of SEED_PHOTOS) assert.match(id, PHOTO_ID_RE, id);
  assert.match('seed-kol', PHOTO_ID_RE);
  assert.match('seed-w01', PHOTO_ID_RE);
  assert.match('seed-kol2', PHOTO_ID_RE);
  assert.match(KEY, PHOTO_ID_RE);
  assert.match('ffffffffffffffffffff', PHOTO_ID_RE);
});

test('PHOTO_ID_RE rejects everything else', () => {
  const bad = [
    '', 'seed', 'seed-', 'seed--kol', 'seed-kol-', '-seed-kol', 'Seed-kol', 'seed-Kol', 'seed-kol_x', 'seed-ko l',
    'seed-kol\n', ' seed-kol', 'seed-kol/../x', '../seed-kol',
    '0123456789abcdef012', '0123456789abcdef01234', '0123456789ABCDEF0123', '0123456789abcdef012g', `${KEY}\n`, ` ${KEY}`,
  ];
  for (const id of bad) assert.doesNotMatch(id, PHOTO_ID_RE, JSON.stringify(id));
});

test('IMAGE_KEY_RE is 20 lowercase hex characters and nothing else', () => {
  assert.match(KEY, IMAGE_KEY_RE);
  for (const bad of ['', 'seed-kol', '0123456789abcdef012', '0123456789abcdef01234', '0123456789ABCDEF0123', '0123456789abcdef012g', `${KEY}\n`, `img/${KEY}`, `${KEY}/full`]) {
    assert.doesNotMatch(bad, IMAGE_KEY_RE, JSON.stringify(bad));
  }
});

test('newImageKey: 20 lowercase hex characters, never the same twice, and every position and digit is used', () => {
  const keys = Array.from({ length: 500 }, () => newImageKey());
  for (const key of keys) {
    assert.match(key, IMAGE_KEY_RE);
    assert.match(key, PHOTO_ID_RE, 'a key also works as a photo id');
  }
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(keys.join('')).size, 16, 'all sixteen hex digits turn up');
  for (let position = 0; position < 20; position += 1) {
    assert.ok(new Set(keys.map((key) => key[position])).size > 1, `position ${position} never changes`);
  }
});

test('kvKeys: where the two sizes of an image live in KV', () => {
  assert.deepEqual(kvKeys(KEY), { full: `img/${KEY}/full`, thumb: `img/${KEY}/thumb` });
});

// ---------------------------------------------------------------------------------------------
// Where an image is served from
// ---------------------------------------------------------------------------------------------

test('imageUrls: a seed photo is a static file under /seed', () => {
  assert.deepEqual(imageUrls({ source: 'seed', seed_path: 'chicano-kol', image_key: null }), {
    full: '/seed/chicano-kol-full.jpg',
    thumb: '/seed/chicano-kol-thumb.jpg',
  });
});

test('imageUrls: a stored photo is served by /img from KV', () => {
  assert.deepEqual(imageUrls({ source: 'kv', seed_path: null, image_key: KEY }), { full: `/img/${KEY}/full`, thumb: `/img/${KEY}/thumb` });
});

test('imageUrls takes a whole photo row, a seed photo of the defaults and a hero alike', () => {
  const row = { id: 'seed-kurt', caption: 'Kurt ve orman', category: 'dovme', position: 2, source: 'seed', seed_path: 'kurt', image_key: null, width: 487, height: 790, created_at: 0 };
  assert.deepEqual(imageUrls(row), { full: '/seed/kurt-full.jpg', thumb: '/seed/kurt-thumb.jpg' });
  assert.deepEqual(imageUrls(DEFAULT_HERO), { full: '/seed/logo-full.jpg', thumb: '/seed/logo-thumb.jpg' });
  assert.deepEqual(imageUrls({ source: 'kv', image_key: KEY, width: 800, height: 600 }), { full: `/img/${KEY}/full`, thumb: `/img/${KEY}/thumb` });
});

test('imageUrls: every seed photo gets its own pair of files', () => {
  const urls = SEED_PHOTOS.map((photo) => imageUrls({ source: 'seed', ...photo }));
  assert.equal(new Set(urls.map((url) => url.full)).size, SEED_PHOTOS.length);
  assert.equal(new Set(urls.map((url) => url.thumb)).size, SEED_PHOTOS.length);
});

// ---------------------------------------------------------------------------------------------
// What a file really is
// ---------------------------------------------------------------------------------------------

test('sniffImageType recognises real JPEG, PNG and WebP files', () => {
  assert.equal(sniffImageType(JPEG_FILE), 'image/jpeg');
  assert.equal(sniffImageType(PNG_FILE), 'image/png');
  assert.equal(sniffImageType(WEBP_FILE), 'image/webp');
});

test('sniffImageType needs only the magic bytes, and a Buffer is a Uint8Array too', () => {
  assert.equal(sniffImageType(bytes(0xff, 0xd8, 0xff)), 'image/jpeg');
  for (const marker of [0xe0, 0xe1, 0xdb, 0xee]) assert.equal(sniffImageType(bytes(0xff, 0xd8, 0xff, marker, 0, 0)), 'image/jpeg');
  assert.equal(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png');
  assert.equal(sniffImageType(ascii('RIFF....WEBP')), 'image/webp');
  assert.equal(sniffImageType(Buffer.from(PNG_FILE)), 'image/png');
});

test('sniffImageType rejects GIF, text, HTML and other formats', () => {
  const notImages = {
    GIF89a: ascii('GIF89a\u0001\u0000\u0001\u0000'),
    GIF87a: ascii('GIF87a\u0001\u0000\u0001\u0000'),
    text: ascii('merhaba, bu bir fotoğraf değil'),
    html: ascii('<!doctype html><title>x</title>'),
    svg: ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    bmp: ascii('BM......'),
    pdf: ascii('%PDF-1.7'),
    wave: ascii('RIFF....WAVEfmt '),
    avi: ascii('RIFF....AVI LIST'),
    heic: bytes(0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63),
  };
  for (const [name, content] of Object.entries(notImages)) assert.equal(sniffImageType(content), null, name);
});

test('sniffImageType rejects a file that stops inside the signature, and nothing at all', () => {
  assert.equal(sniffImageType(new Uint8Array(0)), null);
  assert.equal(sniffImageType(bytes(0xff)), null);
  assert.equal(sniffImageType(bytes(0xff, 0xd8)), null);
  assert.equal(sniffImageType(PNG_FILE.subarray(0, 7)), null);
  assert.equal(sniffImageType(WEBP_FILE.subarray(0, 11)), null);
  assert.equal(sniffImageType(ascii('RIFF')), null);
});

test('sniffImageType rejects a signature that is almost right', () => {
  assert.equal(sniffImageType(bytes(0xff, 0xd8, 0xfe)), null);
  assert.equal(sniffImageType(bytes(0xfe, 0xd8, 0xff)), null);
  const png = Uint8Array.from(PNG_FILE);
  png[7] = 0x0b; // the last byte of the signature
  assert.equal(sniffImageType(png), null);
  const webp = Uint8Array.from(WEBP_FILE);
  webp[11] = 0x51; // "WEBQ"
  assert.equal(sniffImageType(webp), null);
  const riff = Uint8Array.from(WEBP_FILE);
  riff[0] = 0x72; // "riff" in lower case
  assert.equal(sniffImageType(riff), null);
});

test('sniffImageType reads the view it is given, not the buffer behind it', () => {
  const buffer = Uint8Array.from([0, 0, 0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(sniffImageType(buffer), null);
  assert.equal(sniffImageType(buffer.subarray(2)), 'image/jpeg');
  const padded = new Uint8Array(8 + PNG_FILE.length);
  padded.set(PNG_FILE, 8);
  assert.equal(sniffImageType(padded.subarray(8)), 'image/png');
});

test('sniffImageType answers null, and never throws, for something that is not a Uint8Array', () => {
  for (const value of [null, undefined, '', 'GIF89a', 'ÿØÿà', 0, {}, [0xff, 0xd8, 0xff], new ArrayBuffer(16), new Blob([JPEG_FILE])]) {
    assert.equal(sniffImageType(value), null);
  }
});
