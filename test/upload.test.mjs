import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../functions/_lib/http.js';
import { IMAGE_LIMITS } from '../functions/_lib/media.js';
import { readImageUpload } from '../functions/_lib/upload.js';
import { TINY_JPEG, TINY_PNG, TINY_WEBP, jpegOfSize, uploadForm } from './admin-helpers.mjs';

const TOO_BIG = 'Fotoğraf çok büyük. Daha küçük bir fotoğraf seç.';
const UNREADABLE = 'Yükleme okunamadı. Tekrar dene.';
const MISSING = 'Fotoğraf eksik.';
const NOT_A_PHOTO = 'Bu dosya bir fotoğraf değil ya da desteklenmiyor. JPEG, PNG veya WebP seç.';
const BAD_SIZE = 'Fotoğraf boyutu okunamadı.';

const post = (body, headers = {}) => new Request('https://cinar.test/api/admin/photos', { method: 'POST', headers, body });
const upload = (options, headers) => readImageUpload(post(uploadForm(options), headers));

async function assertRejects(promise, status, message, label = message) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof HttpError, `${label}: an HttpError, got ${error}`);
    assert.equal(error.status, status, `${label}: ${error.message}`);
    assert.equal(error.message, message, label);
    return true;
  });
}

test('readImageUpload gives both images with the type their bytes show, the size of the full one and the text fields', async () => {
  const result = await upload({ caption: 'Kol dövmesi', category: 'piercing', width: 1600, height: 1200 });
  assert.deepEqual(result, {
    full: { bytes: TINY_JPEG, type: 'image/jpeg' },
    thumb: { bytes: TINY_JPEG, type: 'image/jpeg' },
    width: 1600,
    height: 1200,
    fields: { caption: 'Kol dövmesi', category: 'piercing' },
  });
  assert.ok(result.full.bytes instanceof Uint8Array);
});

test('the text fields are the ones the form has: caption and category, as the client sent them; nothing else comes back', async () => {
  assert.deepEqual((await upload()).fields, {});
  assert.deepEqual((await upload({ caption: '' })).fields, { caption: '' }, 'an empty caption is a caption');
  assert.deepEqual((await upload({ category: 'diger', position: '7', evil: 'y' })).fields, { category: 'diger' });

  const form = uploadForm();
  form.append('caption', new Blob(['a file, not text'], { type: 'text/plain' }), 'caption.txt');
  assert.deepEqual((await readImageUpload(post(form))).fields, {}, 'a file part is not a text field');
});

test('the type comes from the first bytes of each file: JPEG, PNG and WebP, never what the client says it sent', async () => {
  const result = await upload({ full: TINY_PNG, thumb: TINY_WEBP });
  assert.equal(result.full.type, 'image/png');
  assert.equal(result.thumb.type, 'image/webp');
  assert.deepEqual(result.full.bytes, TINY_PNG);
  assert.deepEqual(result.thumb.bytes, TINY_WEBP);

  const form = new FormData();
  form.append('full', new Blob([TINY_PNG], { type: 'image/jpeg' }), 'full.jpg'); // a PNG that claims to be a JPEG
  form.append('thumb', new Blob([TINY_JPEG], { type: 'text/html' }), 'thumb.html'); // a JPEG that claims to be HTML
  form.append('width', '16');
  form.append('height', '12');
  const claimed = await readImageUpload(post(form));
  assert.equal(claimed.full.type, 'image/png');
  assert.equal(claimed.thumb.type, 'image/jpeg');
});

test('a Content-Length above 3670016 is 413 before the body is read; 3670016 itself is let through', async () => {
  let pulled = 0;
  const body = new ReadableStream(
    {
      pull(controller) {
        pulled += 1;
        controller.close();
      },
    },
    { highWaterMark: 0 }, // pull() only runs when someone reads
  );
  const request = new Request('https://cinar.test/api/admin/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=x', 'Content-Length': '3670017' },
    body,
    duplex: 'half',
  });
  await assertRejects(readImageUpload(request), 413, TOO_BIG);
  assert.equal(pulled, 0, 'the body was not read');
  assert.equal(request.bodyUsed, false);

  assert.equal((await upload({}, { 'Content-Length': '3670016' })).width, 16);
});

test('a missing Content-Length is fine: the limits of the two parts still apply', async () => {
  const request = post(uploadForm());
  assert.equal(request.headers.get('content-length'), null);
  assert.equal((await readImageUpload(request)).height, 12);
  await assertRejects(upload({ full: jpegOfSize(IMAGE_LIMITS.fullMaxBytes + 1) }), 413, TOO_BIG);
});

test('the full image may have 2621440 bytes and the thumb 409600; one more is 413 "Fotoğraf çok büyük."', async () => {
  const result = await upload({ full: jpegOfSize(IMAGE_LIMITS.fullMaxBytes), thumb: jpegOfSize(IMAGE_LIMITS.thumbMaxBytes) });
  assert.equal(result.full.bytes.length, 2621440);
  assert.equal(result.thumb.bytes.length, 409600);

  await assertRejects(upload({ full: jpegOfSize(2621441) }), 413, TOO_BIG);
  await assertRejects(upload({ thumb: jpegOfSize(409601) }), 413, TOO_BIG);
});

test('the size is checked before the type: a file that is too big and not a photo is 413', async () => {
  await assertRejects(upload({ full: new Uint8Array(2621441) }), 413, TOO_BIG);
});

test('something that is not a readable form is 400 "Yükleme okunamadı. Tekrar dene."', async () => {
  await assertRejects(readImageUpload(post(undefined)), 400, UNREADABLE);
  await assertRejects(readImageUpload(post('{"full":"x"}', { 'Content-Type': 'application/json' })), 400, UNREADABLE);
  await assertRejects(readImageUpload(post('garbage', { 'Content-Type': 'multipart/form-data; boundary=zzz' })), 400, UNREADABLE);
  await assertRejects(readImageUpload(post('--zzz\r\nContent-Disposition: form-data; name="full"\r\n\r\nabc', { 'Content-Type': 'multipart/form-data; boundary=zzz' })), 400, UNREADABLE);
});

test('a missing full or thumb, or one that is text and not a file, is 400 "Fotoğraf eksik."', async () => {
  await assertRejects(upload({ full: null }), 400, MISSING);
  await assertRejects(upload({ thumb: null }), 400, MISSING);
  await assertRejects(upload({ full: null, thumb: null }), 400, MISSING);
  await assertRejects(upload({ full: 'not a file' }), 400, MISSING);
  await assertRejects(upload({ thumb: 'not a file' }), 400, MISSING);
});

test('a file that does not start like a JPEG, PNG or WebP is 415, for the full image and for the thumb', async () => {
  const text = new TextEncoder().encode('Bu bir fotoğraf değil.');
  const gif = new TextEncoder().encode('GIF89a\x01\x00\x01\x00');
  for (const [label, bytes] of [['text', text], ['a GIF', gif], ['an empty file', new Uint8Array(0)], ['too short for PNG', TINY_PNG.subarray(0, 7)]]) {
    await assertRejects(upload({ full: bytes }), 415, NOT_A_PHOTO, `${label} as the full image`);
    await assertRejects(upload({ thumb: bytes }), 415, NOT_A_PHOTO, `${label} as the thumb`);
  }
});

test('width and height are whole numbers from 1 to 4000, written with digits only; anything else is 400 "Fotoğraf boyutu okunamadı."', async () => {
  const smallest = await upload({ width: 1, height: 1 });
  assert.deepEqual([smallest.width, smallest.height], [1, 1]);
  const largest = await upload({ width: 4000, height: 4000 });
  assert.deepEqual([largest.width, largest.height], [4000, 4000]);

  for (const bad of [null, '', '0', '-5', '4001', '9999', '10000', '16.5', '1e3', '0x10', ' 16', '16 ', '+16', '0016', 'abc', 'NaN', 'Infinity']) {
    await assertRejects(upload({ width: bad }), 400, BAD_SIZE, `width ${JSON.stringify(bad)}`);
    await assertRejects(upload({ height: bad }), 400, BAD_SIZE, `height ${JSON.stringify(bad)}`);
  }
  const form = uploadForm({ width: null });
  form.append('width', new Blob(['16']), 'width.txt'); // a file where the number should be
  await assertRejects(readImageUpload(post(form)), 400, BAD_SIZE);
});
