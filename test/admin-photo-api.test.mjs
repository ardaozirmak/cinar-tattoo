import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../dev/server.mjs';
import { getContent, insertPhoto } from '../functions/_lib/db.js';
import { DEFAULT_HERO, SEED_PHOTOS } from '../functions/_lib/defaults.js';
import { kvKeys } from '../functions/_lib/media.js';
import { onRequestGet as serveImage } from '../functions/img/[id]/[variant].js';
import { SITE, TINY_JPEG, TINY_PNG, TINY_WEBP, api, assertError, freshEnv, jpegOfSize, uploadForm } from './admin-helpers.mjs';
import { call, loginCookie, tempTree } from './helpers.mjs';

const REFUSED = 'İstek reddedildi. Sayfayı yenileyip tekrar dene.';
const SIGNED_OUT = 'Oturum kapandı. Tekrar giriş yap.';
const UNREADABLE = 'İstek okunamadı.';
const UNEXPECTED = 'Beklenmeyen bir hata oldu. Tekrar dene.';
const NOT_FOUND = 'Fotoğraf bulunamadı.';
const STALE_ORDER = 'Sıralama güncel değil. Sayfayı yenile.';
const LIMIT = 'Fotoğraf sınırına ulaşıldı (400). Yeni eklemek için eskilerden sil.';
const TOO_BIG = 'Fotoğraf çok büyük. Daha küçük bir fotoğraf seç.';
const NOT_A_PHOTO = 'Bu dosya bir fotoğraf değil ya da desteklenmiyor. JPEG, PNG veya WebP seç.';
const BAD_SIZE = 'Fotoğraf boyutu okunamadı.';
const MISSING = 'Fotoğraf eksik.';
const BAD_CAPTION = 'Açıklama en fazla 120 karakter olabilir.';
const BAD_CATEGORY = 'Tür geçersiz.';

const HEX20 = /^[0-9a-f]{20}$/;
const UNKNOWN_ID = 'a'.repeat(20); // a well-formed id that no photo has
const TEXT_BYTES = new TextEncoder().encode('Bu bir fotoğraf değil.');
const SEED_IDS = SEED_PHOTOS.map(({ id }) => id);

// An env and the cookie of a signed-in owner.
async function signedIn(t) {
  const env = freshEnv(t);
  return { env, cookie: await loginCookie(env) };
}

const upload = (env, cookie, options, path = 'photos') => api(env, 'POST', path, { cookie, body: uploadForm(options) });
const replace = (env, cookie, id, options) => upload(env, cookie, options, `photos/${encodeURIComponent(id)}/replace`);
const heroUpload = (env, cookie, options) => upload(env, cookie, options, 'hero-image');
const edit = (env, cookie, id, json) => api(env, 'PATCH', `photos/${encodeURIComponent(id)}`, { cookie, json });
const remove = (env, cookie, id) => api(env, 'DELETE', `photos/${encodeURIComponent(id)}`, { cookie });
const reorder = (env, cookie, ids) => api(env, 'PUT', 'photos/order', { cookie, json: { ids } });
const stateOf = async (env, cookie) => (await api(env, 'GET', 'state', { cookie })).json();
const orderOf = async (env, cookie) => (await stateOf(env, cookie)).photos.map(({ id }) => id);

// Uploads a photo that must go through, and gives the photo.
async function create(env, cookie, options) {
  const response = await upload(env, cookie, options);
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).photo;
}

// What KV holds, { key: { bytes, metadata } }.
async function stored(env) {
  const { keys } = await env.IMAGES.list();
  const entries = await Promise.all(
    keys.map(async ({ name }) => {
      const { value, metadata } = await env.IMAGES.getWithMetadata(name, 'arrayBuffer');
      return [name, { bytes: new Uint8Array(value), metadata }];
    }),
  );
  return Object.fromEntries(entries);
}

const keysOf = async (env) => Object.keys(await stored(env)).sort();
const imageKeys = (imageKey) => Object.values(kvKeys(imageKey)).sort();

// A photo as D1 holds it: the answer of the API without the two URLs it adds.
const rowOf = ({ full, thumb, ...row }) => row;

// An image that some other photo owns, to see what the code leaves alone.
const DECOY = 'd'.repeat(20);
const putDecoy = async (env) => {
  await env.IMAGES.put(kvKeys(DECOY).full, TINY_JPEG, { metadata: { type: 'image/jpeg', width: 16, height: 12 } });
  await env.IMAGES.put(kvKeys(DECOY).thumb, TINY_JPEG, { metadata: { type: 'image/jpeg', width: 16, height: 12 } });
};

// Wrap env.DB or env.IMAGES in a Proxy that fails on demand. A Proxy, not a copy: batch() and the
// rest keep working, and the schema statements, which have other words, are not touched.
function failD1(env, pattern, message = 'D1 yazamadı') {
  const real = env.DB;
  env.DB = new Proxy(real, {
    get(target, property) {
      if (property !== 'prepare') return target[property];
      return (sql) => {
        if (pattern.test(sql)) throw new Error(message);
        return target.prepare(sql);
      };
    },
  });
}

function failKv(env, method, pattern, message = 'KV yazamadı') {
  const real = env.IMAGES;
  env.IMAGES = new Proxy(real, {
    get(target, property) {
      if (property !== method) return target[property];
      return async (key, ...rest) => {
        if (pattern.test(key)) throw new Error(message);
        return target[method](key, ...rest);
      };
    },
  });
}

// The writes and deletes the code makes to KV, as 'put <key>' and 'delete <key>', in order.
function recordKv(env) {
  const calls = [];
  const real = env.IMAGES;
  env.IMAGES = new Proxy(real, {
    get(target, property) {
      if (property !== 'put' && property !== 'delete') return target[property];
      return (key, ...rest) => {
        calls.push(`${property} ${key}`);
        return target[property](key, ...rest);
      };
    },
  });
  return calls;
}

const loggedText = (logged) => logged.mock.calls.map((entry) => entry.arguments.map(String).join(' '));

// ---------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------

test('POST photos stores the two images in KV and the photo in D1, and answers 201 with the photo and the URLs of its images', async (t) => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const { env, cookie } = await signedIn(t);

  const response = await upload(env, cookie, { full: TINY_PNG, thumb: TINY_JPEG, width: 1600, height: 1200, caption: 'Kol dövmesi', category: 'piercing' });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const { photo } = await response.json();
  assert.match(photo.id, HEX20);
  assert.match(photo.image_key, HEX20);
  assert.notEqual(photo.id, photo.image_key, 'the id of the photo stays when its image is replaced; the key does not');
  assert.match(photo.full, /^\/img\/[0-9a-f]{20}\/full$/);
  assert.deepEqual(photo, {
    id: photo.id,
    caption: 'Kol dövmesi',
    category: 'piercing',
    position: -1,
    source: 'kv',
    seed_path: null,
    image_key: photo.image_key,
    width: 1600,
    height: 1200,
    created_at: now,
    full: `/img/${photo.image_key}/full`,
    thumb: `/img/${photo.image_key}/thumb`,
  });

  const kv = await stored(env);
  assert.deepEqual(Object.keys(kv).sort(), imageKeys(photo.image_key), 'exactly the two keys of the new image');
  assert.deepEqual(kv[kvKeys(photo.image_key).full], { bytes: TINY_PNG, metadata: { type: 'image/png', width: 1600, height: 1200 } });
  assert.deepEqual(kv[kvKeys(photo.image_key).thumb], { bytes: TINY_JPEG, metadata: { type: 'image/jpeg', width: 640, height: 480 } });

  assert.deepEqual((await getContent(env.DB)).photos[0], rowOf(photo), 'D1 holds the same row');

  const served = await call(serveImage, { url: `${SITE}${photo.full}`, params: { id: photo.image_key, variant: 'full' }, env });
  assert.equal(served.status, 200, 'and the image route serves what was stored');
  assert.equal(served.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(new Uint8Array(await served.arrayBuffer()), TINY_PNG);
});

test('the new photo is the first of the state, before the seed photos, and the next one goes in front of it', async (t) => {
  const { env, cookie } = await signedIn(t);
  const first = await create(env, cookie);
  const second = await create(env, cookie);
  assert.deepEqual([first.position, second.position], [-1, -2]);
  assert.deepEqual(await orderOf(env, cookie), [second.id, first.id, ...SEED_IDS]);
  const state = await stateOf(env, cookie);
  assert.equal(state.photos.length, SEED_IDS.length + 2);
  assert.equal(state.photos[0].full, second.full);
});

test('without a caption and a category the photo gets no caption and the type Dövme; a caption is cleaned like the validators do', async (t) => {
  const { env, cookie } = await signedIn(t);
  const plain = await create(env, cookie);
  assert.deepEqual([plain.caption, plain.category], ['', 'dovme']);

  const cleaned = await create(env, cookie, { caption: '  Kol\n  dövmesi ', category: 'diger' });
  assert.deepEqual([cleaned.caption, cleaned.category], ['Kol dövmesi', 'diger']);
  assert.equal((await create(env, cookie, { caption: '' })).caption, '', 'an empty caption is fine');
  assert.equal((await create(env, cookie, { caption: 'x'.repeat(120) })).caption.length, 120);
});

test('the type of each image is what its bytes show, and the thumb is not measured by the client but worked out from the size of the full one', async (t) => {
  const { env, cookie } = await signedIn(t);
  const portrait = await create(env, cookie, { full: TINY_WEBP, thumb: TINY_PNG, width: 1200, height: 1600 });
  const kv = await stored(env);
  assert.deepEqual(kv[kvKeys(portrait.image_key).full].metadata, { type: 'image/webp', width: 1200, height: 1600 });
  assert.deepEqual(kv[kvKeys(portrait.image_key).thumb].metadata, { type: 'image/png', width: 480, height: 640 });

  const small = await create(env, cookie, { width: 300, height: 200 });
  assert.deepEqual((await stored(env))[kvKeys(small.image_key).thumb].metadata, { type: 'image/jpeg', width: 300, height: 200 }, 'a small image is not enlarged');

  const square = await create(env, cookie, { width: 4000, height: 4000 });
  assert.deepEqual((await stored(env))[kvKeys(square.image_key).thumb].metadata, { type: 'image/jpeg', width: 640, height: 640 });

  const strip = await create(env, cookie, { width: 4000, height: 1 });
  assert.deepEqual((await stored(env))[kvKeys(strip.image_key).thumb].metadata, { type: 'image/jpeg', width: 640, height: 1 }, 'a side is never 0 pixels');

  const odd = await create(env, cookie, { width: 1000, height: 667 });
  assert.deepEqual((await stored(env))[kvKeys(odd.image_key).thumb].metadata, { type: 'image/jpeg', width: 640, height: 427 }, '667 x 0.64 = 426.88');
});

test('a file that is not a photo is 415 "Bu dosya bir fotoğraf değil…" and nothing is stored', async (t) => {
  const { env, cookie } = await signedIn(t);
  await assertError(await upload(env, cookie, { full: TEXT_BYTES }), 415, NOT_A_PHOTO, 'as the full image');
  await assertError(await upload(env, cookie, { thumb: TEXT_BYTES }), 415, NOT_A_PHOTO, 'as the thumb');
  assert.deepEqual(await keysOf(env), []);
  assert.deepEqual(await orderOf(env, cookie), SEED_IDS);
});

test('an upload that is too big, unreadable, incomplete or without a size is refused with its message, and nothing is stored', async (t) => {
  const { env, cookie } = await signedIn(t);
  const refused = [
    ['a full image over 2.5 MiB', await upload(env, cookie, { full: jpegOfSize(2621441) }), 413, TOO_BIG],
    ['a thumb over 400 KiB', await upload(env, cookie, { thumb: jpegOfSize(409601) }), 413, TOO_BIG],
    ['a request that says it is over 3.5 MiB', await api(env, 'POST', 'photos', { cookie, body: uploadForm(), headers: { 'Content-Length': '3670017' } }), 413, TOO_BIG],
    ['a body that is JSON', await api(env, 'POST', 'photos', { cookie, json: { full: 'x' } }), 400, 'Yükleme okunamadı. Tekrar dene.'],
    ['no body', await api(env, 'POST', 'photos', { cookie }), 400, 'Yükleme okunamadı. Tekrar dene.'],
    ['no thumb', await upload(env, cookie, { thumb: null }), 400, MISSING],
    ['no full image', await upload(env, cookie, { full: null }), 400, MISSING],
    ['no width', await upload(env, cookie, { width: null }), 400, BAD_SIZE],
    ['a height of 4001', await upload(env, cookie, { height: 4001 }), 400, BAD_SIZE],
  ];
  for (const [label, response, status, message] of refused) await assertError(response, status, message, label);
  assert.deepEqual(await keysOf(env), []);
  assert.equal((await stateOf(env, cookie)).photos.length, SEED_IDS.length);
});

test('a caption over 120 characters or an unknown type is 400 before anything is stored', async (t) => {
  const { env, cookie } = await signedIn(t);
  await assertError(await upload(env, cookie, { caption: 'x'.repeat(121) }), 400, BAD_CAPTION);
  await assertError(await upload(env, cookie, { category: 'tablo' }), 400, BAD_CATEGORY);
  await assertError(await upload(env, cookie, { category: '' }), 400, BAD_CATEGORY);
  await assertError(await upload(env, cookie, { category: 'DOVME' }), 400, BAD_CATEGORY);
  assert.deepEqual(await keysOf(env), []);
  assert.equal((await stateOf(env, cookie)).photos.length, SEED_IDS.length);
});

test('with 400 photos stored an upload is 409 "Fotoğraf sınırına ulaşıldı (400)…"; with 399 one more still goes in', async (t) => {
  const { env, cookie } = await signedIn(t);
  for (let index = 0; index < 399 - SEED_IDS.length; index += 1) {
    const id = String(index).padStart(20, '0');
    await insertPhoto(env.DB, { id, image_key: id, width: 1, height: 1, created_at: 1 });
  }
  assert.equal((await stateOf(env, cookie)).photos.length, 399);
  const last = await create(env, cookie);
  assert.equal((await stateOf(env, cookie)).photos.length, 400);

  await assertError(await upload(env, cookie, {}), 409, LIMIT);
  assert.deepEqual(await keysOf(env), imageKeys(last.image_key), 'the refused upload left nothing in KV');
  assert.equal((await stateOf(env, cookie)).photos.length, 400);
});

// ---------------------------------------------------------------------------------------------
// Review Focus 4: no orphans in KV
// ---------------------------------------------------------------------------------------------

test('Review Focus 4: when the D1 write fails after the KV writes, the new images are deleted again, the answer is a 500 and the error is logged', async (t) => {
  const { env, cookie } = await signedIn(t);
  failD1(env, /^\s*INSERT\s+INTO\s+photos\b/i);
  const calls = recordKv(env);
  const logged = t.mock.method(console, 'error', () => {});

  await assertError(await upload(env, cookie, {}), 500, UNEXPECTED);
  assert.deepEqual((await env.IMAGES.list()).keys, [], 'no orphan in KV');
  const puts = calls.filter((entry) => entry.startsWith('put '));
  const deletes = calls.filter((entry) => entry.startsWith('delete '));
  assert.equal(puts.length, 2, 'the images were written before D1 was asked');
  assert.deepEqual(deletes.map((entry) => entry.replace('delete ', '')).sort(), puts.map((entry) => entry.replace('put ', '')).sort(), 'and the same two keys were deleted');
  assert.equal(logged.mock.callCount(), 1);
  assert.match(loggedText(logged)[0], /D1 yazamadı/);

  assert.equal((await stateOf(env, cookie)).photos.length, SEED_IDS.length, 'the gallery is as it was');
});

test('when the KV write of the thumb fails, the full image that was already stored is deleted again', async (t) => {
  const { env, cookie } = await signedIn(t);
  failKv(env, 'put', /\/thumb$/);
  const logged = t.mock.method(console, 'error', () => {});
  await assertError(await upload(env, cookie, {}), 500, UNEXPECTED);
  assert.deepEqual((await env.IMAGES.list()).keys, []);
  assert.match(loggedText(logged)[0], /KV yazamadı/);
  assert.equal((await stateOf(env, cookie)).photos.length, SEED_IDS.length);
});

test('when the cleanup fails too, the answer is still the error that started it, and the cleanup failure is logged', async (t) => {
  const { env, cookie } = await signedIn(t);
  failD1(env, /^\s*INSERT\s+INTO\s+photos\b/i, 'D1 yazamadı');
  failKv(env, 'delete', /./, 'KV silemedi');
  const logged = t.mock.method(console, 'error', () => {});
  await assertError(await upload(env, cookie, {}), 500, UNEXPECTED);
  const text = loggedText(logged).join('\n');
  assert.match(text, /D1 yazamadı/);
  assert.match(text, /KV silemedi/);
});

// ---------------------------------------------------------------------------------------------
// Edit and order
// ---------------------------------------------------------------------------------------------

test('PATCH photos/:id changes the caption and the type, whichever are sent, and answers with the photo and its URLs', async (t) => {
  const { env, cookie } = await signedIn(t);
  const photo = await create(env, cookie, { caption: 'Eski', category: 'dovme' });

  const both = await edit(env, cookie, photo.id, { caption: '  Yeni açıklama ', category: 'piercing' });
  assert.equal(both.status, 200);
  assert.deepEqual((await both.json()).photo, { ...photo, caption: 'Yeni açıklama', category: 'piercing' });

  assert.equal((await (await edit(env, cookie, photo.id, { caption: 'Sadece açıklama' })).json()).photo.category, 'piercing', 'the type stays');
  assert.equal((await (await edit(env, cookie, photo.id, { category: 'diger' })).json()).photo.caption, 'Sadece açıklama', 'the caption stays');
  assert.equal((await (await edit(env, cookie, photo.id, { caption: '' })).json()).photo.caption, '', 'the caption can be emptied');
  assert.deepEqual((await (await edit(env, cookie, photo.id, {})).json()).photo, { ...photo, caption: '', category: 'diger' }, 'an empty patch changes nothing');
  assert.equal((await (await edit(env, cookie, photo.id, { caption: 'Tamam', position: 99, source: 'seed' })).json()).photo.position, -1, 'only the caption and the type can be changed');
  assert.deepEqual((await getContent(env.DB)).photos[0], { ...rowOf(photo), caption: 'Tamam', category: 'diger' }, 'and D1 has what the answer says');
});

test('PATCH works on a seed photo too, and its URLs are the static files', async (t) => {
  const { env, cookie } = await signedIn(t);
  const response = await edit(env, cookie, 'seed-kurt', { caption: 'Kurt', category: 'diger' });
  assert.equal(response.status, 200);
  const { photo } = await response.json();
  assert.deepEqual([photo.id, photo.caption, photo.category, photo.source], ['seed-kurt', 'Kurt', 'diger', 'seed']);
  assert.deepEqual([photo.full, photo.thumb], ['/seed/kurt-full.jpg', '/seed/kurt-thumb.jpg']);
});

test('PATCH: a caption over 120 characters, a type that is not one, or something that is not text is 400, and nothing is changed', async (t) => {
  const { env, cookie } = await signedIn(t);
  const photo = await create(env, cookie, { caption: 'Eski' });
  const cases = [
    [{ caption: 'x'.repeat(121) }, BAD_CAPTION],
    [{ caption: 'Yeni', category: 'tablo' }, BAD_CATEGORY],
    [{ category: '' }, BAD_CATEGORY],
    [{ category: null }, BAD_CATEGORY],
    [{ category: ['piercing'] }, BAD_CATEGORY],
    [{ caption: 5 }, UNREADABLE],
    [{ caption: null }, UNREADABLE],
    [{ caption: ['x'] }, UNREADABLE],
    [[], UNREADABLE],
    [null, UNREADABLE],
    ['Yeni', UNREADABLE],
  ];
  for (const [json, message] of cases) await assertError(await edit(env, cookie, photo.id, json), 400, message, JSON.stringify(json));
  await assertError(await api(env, 'PATCH', `photos/${photo.id}`, { cookie, body: '{' }), 400, UNREADABLE, 'not JSON');
  await assertError(await api(env, 'PATCH', `photos/${photo.id}`, { cookie }), 400, UNREADABLE, 'no body');
  assert.equal((await getContent(env.DB)).photos[0].caption, 'Eski');
});

test('PATCH, DELETE and replace answer 404 "Fotoğraf bulunamadı." for an id nothing has and for anything that is not an id', async (t) => {
  const { env, cookie } = await signedIn(t);
  const kvCalls = recordKv(env);
  for (const id of [UNKNOWN_ID, 'seed-yok', 'seed-chicano-kol-yok']) {
    await assertError(await edit(env, cookie, id, { caption: 'x' }), 404, NOT_FOUND, `PATCH ${id}`);
    await assertError(await remove(env, cookie, id), 404, NOT_FOUND, `DELETE ${id}`);
    await assertError(await replace(env, cookie, id, {}), 404, NOT_FOUND, `replace ${id}`);
  }
  for (const id of ['order', 'abc', 'A'.repeat(20), 'a'.repeat(19), 'a'.repeat(21), 'seed-', 'SEED-kurt', 'seed-kurt-', ' ', 'a b', "x'--", '%00', 'a%2Fb']) {
    await assertError(await edit(env, cookie, id, { caption: 'x' }), 404, NOT_FOUND, `PATCH ${id}`);
    await assertError(await remove(env, cookie, id), 404, NOT_FOUND, `DELETE ${id}`);
    await assertError(await replace(env, cookie, id, {}), 404, NOT_FOUND, `replace ${id}`);
  }
  assert.deepEqual(kvCalls, [], 'nothing was written to KV, not even for a moment: the photo is looked for before the images are stored');
  assert.deepEqual(await orderOf(env, cookie), SEED_IDS);
});

test('PUT photos/order puts the photos in the order of the list and numbers them from 0', async (t) => {
  const { env, cookie } = await signedIn(t);
  const mine = await create(env, cookie);
  const reversed = [...(await orderOf(env, cookie))].reverse();
  const response = await reorder(env, cookie, reversed);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(await orderOf(env, cookie), reversed);
  assert.deepEqual((await getContent(env.DB)).photos.map(({ position }) => position), reversed.map((_, index) => index));
  assert.equal((await stateOf(env, cookie)).photos.at(-1).id, mine.id);

  const toFront = [mine.id, ...reversed.filter((id) => id !== mine.id)];
  await reorder(env, cookie, toFront);
  assert.deepEqual(await orderOf(env, cookie), toFront);
});

test('PUT photos/order with a list that is not the photos there are is 400 "Sıralama güncel değil. Sayfayı yenile." and changes nothing', async (t) => {
  const { env, cookie } = await signedIn(t);
  const mine = await create(env, cookie);
  const current = await orderOf(env, cookie);
  const stale = [
    ['a missing id', current.slice(1)],
    ['an id more', [...current, UNKNOWN_ID]],
    ['an id twice', [...current.slice(1), current[1]]],
    ['an id that is not one', [...current.slice(1), 'zzz']],
    ['ids that are not text', [...current.slice(1), 7]],
    ['no ids', []],
    ['one id', [mine.id]],
  ];
  for (const [label, ids] of stale) await assertError(await reorder(env, cookie, ids), 400, STALE_ORDER, label);
  assert.deepEqual(await orderOf(env, cookie), current);
});

test('PUT photos/order needs a list called ids: anything else is 400 "İstek okunamadı."', async (t) => {
  const { env, cookie } = await signedIn(t);
  for (const json of [{}, { ids: 'a,b' }, { ids: { 0: 'a' } }, { ids: null }, { order: SEED_IDS }, [], null, 'x']) {
    await assertError(await api(env, 'PUT', 'photos/order', { cookie, json }), 400, UNREADABLE, JSON.stringify(json));
  }
  await assertError(await api(env, 'PUT', 'photos/order', { cookie, body: '{' }), 400, UNREADABLE, 'not JSON');
  assert.deepEqual(await orderOf(env, cookie), SEED_IDS);
});

// ---------------------------------------------------------------------------------------------
// Replace and delete
// ---------------------------------------------------------------------------------------------

test('replacing a photo gives it a new image key, deletes the old KV keys and keeps its id, place, caption and type', async (t) => {
  const { env, cookie } = await signedIn(t);
  const before = await create(env, cookie, { caption: 'Kol', category: 'piercing' });
  await putDecoy(env);

  const response = await replace(env, cookie, before.id, { full: TINY_PNG, thumb: TINY_WEBP, width: 100, height: 200, caption: 'ignored' });
  assert.equal(response.status, 200);
  const { photo } = await response.json();
  assert.notEqual(photo.image_key, before.image_key, 'a new key, so that nothing stale can be cached under the old address');
  assert.match(photo.image_key, HEX20);
  assert.deepEqual(photo, {
    ...before,
    image_key: photo.image_key,
    width: 100,
    height: 200,
    full: `/img/${photo.image_key}/full`,
    thumb: `/img/${photo.image_key}/thumb`,
  });

  const kv = await stored(env);
  assert.deepEqual(Object.keys(kv).sort(), [...imageKeys(photo.image_key), ...imageKeys(DECOY)].sort(), 'the old keys are gone, the new ones and a stranger’s are there');
  assert.deepEqual(kv[kvKeys(photo.image_key).full], { bytes: TINY_PNG, metadata: { type: 'image/png', width: 100, height: 200 } });
  assert.deepEqual(kv[kvKeys(photo.image_key).thumb], { bytes: TINY_WEBP, metadata: { type: 'image/webp', width: 100, height: 200 } });

  assert.deepEqual((await getContent(env.DB)).photos[0], rowOf(photo));
});

test('replacing a seed photo makes it a KV photo, and no KV key is deleted', async (t) => {
  const { env, cookie } = await signedIn(t);
  await putDecoy(env);
  const response = await replace(env, cookie, 'seed-kurt', { width: 20, height: 30 });
  assert.equal(response.status, 200);
  const { photo } = await response.json();
  assert.deepEqual(
    [photo.id, photo.source, photo.seed_path, photo.caption, photo.width, photo.height],
    ['seed-kurt', 'kv', null, 'Kurt ve orman', 20, 30],
  );
  assert.match(photo.full, /^\/img\/[0-9a-f]{20}\/full$/);
  assert.deepEqual(await keysOf(env), [...imageKeys(photo.image_key), ...imageKeys(DECOY)].sort());
  assert.deepEqual(await orderOf(env, cookie), SEED_IDS, 'it keeps its place');
});

test('a replacement that is refused leaves the photo, and KV, as they were', async (t) => {
  const { env, cookie } = await signedIn(t);
  const before = await create(env, cookie);
  const keys = await keysOf(env);
  await assertError(await replace(env, cookie, before.id, { full: TEXT_BYTES }), 415, NOT_A_PHOTO);
  await assertError(await replace(env, cookie, before.id, { thumb: null }), 400, MISSING);
  await assertError(await replace(env, cookie, before.id, { width: 'x' }), 400, BAD_SIZE);
  await assertError(await replace(env, cookie, before.id, { full: jpegOfSize(2621441) }), 413, TOO_BIG);
  assert.deepEqual(await keysOf(env), keys);
  assert.deepEqual((await stateOf(env, cookie)).photos[0], before);
});

test('when the D1 write of a replacement fails, the new images are deleted and the old ones stay', async (t) => {
  const { env, cookie } = await signedIn(t);
  const before = await create(env, cookie);
  const keys = await keysOf(env);
  failD1(env, /^\s*UPDATE\s+photos\s+SET\s+source\b/i);
  const logged = t.mock.method(console, 'error', () => {});
  await assertError(await replace(env, cookie, before.id, {}), 500, UNEXPECTED);
  assert.deepEqual(await keysOf(env), keys, 'only the old image is in KV');
  assert.match(loggedText(logged)[0], /D1 yazamadı/);
  assert.deepEqual((await stateOf(env, cookie)).photos[0], before);
});

test('when the old images cannot be deleted after a replacement, the replacement still counts, and the failure is logged', async (t) => {
  const { env, cookie } = await signedIn(t);
  const before = await create(env, cookie);
  failKv(env, 'delete', /./, 'KV silemedi');
  const logged = t.mock.method(console, 'error', () => {});

  const response = await replace(env, cookie, before.id, { width: 40, height: 30 });
  assert.equal(response.status, 200, 'the change is saved: that it left two old objects behind is not the owner’s problem');
  const { photo } = await response.json();
  assert.notEqual(photo.image_key, before.image_key);
  assert.equal((await getContent(env.DB)).photos[0].image_key, photo.image_key);
  assert.equal(logged.mock.callCount(), 2, 'one line for each old object');
  assert.match(loggedText(logged).join('\n'), /KV silemedi/);
});

test('replacing a photo that was deleted while the upload was on its way is 404 and leaves no new image behind', async (t) => {
  const { env, cookie } = await signedIn(t);
  const before = await create(env, cookie);
  // The photo is there when the handler looks for it and gone when its row is to be changed: the wrapper
  // deletes it as that statement is made. (The D1 shim runs a statement as soon as run() is called.)
  const real = env.DB;
  env.DB = new Proxy(real, {
    get(target, property) {
      if (property !== 'prepare') return target[property];
      return (sql) => {
        if (/^\s*UPDATE\s+photos\s+SET\s+source\b/i.test(sql)) target.prepare('DELETE FROM photos WHERE id = ?').bind(before.id).run();
        return target.prepare(sql);
      };
    },
  });

  await assertError(await replace(env, cookie, before.id, {}), 404, NOT_FOUND);
  assert.deepEqual(await keysOf(env), imageKeys(before.image_key), 'the new images were deleted again; the old ones belong to the photo that someone else deleted');
});

test('deleting a photo removes its row and, as it is a KV photo, its two KV objects; other images are left alone', async (t) => {
  const { env, cookie } = await signedIn(t);
  const photo = await create(env, cookie);
  await putDecoy(env);
  const response = await remove(env, cookie, photo.id);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(await orderOf(env, cookie), SEED_IDS);
  assert.deepEqual(await keysOf(env), imageKeys(DECOY));
  assert.equal((await getContent(env.DB)).photos.some(({ id }) => id === photo.id), false);
});

test('deleting a seed photo removes the row only; KV is not touched', async (t) => {
  const { env, cookie } = await signedIn(t);
  await putDecoy(env);
  const before = await stored(env);
  const response = await remove(env, cookie, 'seed-renkli-gul');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(await orderOf(env, cookie), SEED_IDS.filter((id) => id !== 'seed-renkli-gul'));
  assert.deepEqual(await stored(env), before, 'row removed, IMAGES untouched');
  assert.equal((await getContent(env.DB)).photos.length, SEED_IDS.length - 1, 'and it does not come back with the next request');
});

test('a photo can be deleted once: the second time it is 404', async (t) => {
  const { env, cookie } = await signedIn(t);
  const photo = await create(env, cookie);
  assert.equal((await remove(env, cookie, photo.id)).status, 200);
  await assertError(await remove(env, cookie, photo.id), 404, NOT_FOUND);
});

test('when the KV objects of a deleted photo cannot be deleted, the photo is still deleted and the failure is logged', async (t) => {
  const { env, cookie } = await signedIn(t);
  const photo = await create(env, cookie);
  failKv(env, 'delete', /./, 'KV silemedi');
  const logged = t.mock.method(console, 'error', () => {});
  const response = await remove(env, cookie, photo.id);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(await orderOf(env, cookie), SEED_IDS);
  assert.equal(logged.mock.callCount(), 2);
});

// ---------------------------------------------------------------------------------------------
// The hero image
// ---------------------------------------------------------------------------------------------

test('POST hero-image makes the uploaded image the hero: getContent().hero is a KV hero, and the answer has the URLs', async (t) => {
  const { env, cookie } = await signedIn(t);
  await putDecoy(env);
  assert.deepEqual((await getContent(env.DB)).hero, DEFAULT_HERO);

  const response = await heroUpload(env, cookie, { full: TINY_PNG, width: 800, height: 600 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const { hero } = await response.json();
  assert.match(hero.image_key, HEX20);
  assert.deepEqual(hero, {
    source: 'kv',
    image_key: hero.image_key,
    width: 800,
    height: 600,
    full: `/img/${hero.image_key}/full`,
    thumb: `/img/${hero.image_key}/thumb`,
  });

  assert.deepEqual((await getContent(env.DB)).hero, rowOf(hero));
  assert.deepEqual((await stateOf(env, cookie)).hero, hero, 'the state has the same hero');

  const kv = await stored(env);
  assert.deepEqual(Object.keys(kv).sort(), [...imageKeys(hero.image_key), ...imageKeys(DECOY)].sort(), 'the seed hero has no KV keys to delete, and nothing else was touched');
  assert.deepEqual(kv[kvKeys(hero.image_key).full], { bytes: TINY_PNG, metadata: { type: 'image/png', width: 800, height: 600 } });
  assert.deepEqual(kv[kvKeys(hero.image_key).thumb].metadata, { type: 'image/jpeg', width: 640, height: 480 });
  assert.equal((await getContent(env.DB)).photos.length, SEED_IDS.length, 'it is not a photo of the gallery');
});

test('a second hero image deletes the KV keys of the first', async (t) => {
  const { env, cookie } = await signedIn(t);
  const first = (await (await heroUpload(env, cookie, {})).json()).hero;
  const second = (await (await heroUpload(env, cookie, { width: 50, height: 40 })).json()).hero;
  assert.notEqual(first.image_key, second.image_key);
  assert.deepEqual(await keysOf(env), imageKeys(second.image_key));
  assert.deepEqual((await getContent(env.DB)).hero, { source: 'kv', image_key: second.image_key, width: 50, height: 40 });
});

test('a hero upload that is refused leaves the hero and KV as they were', async (t) => {
  const { env, cookie } = await signedIn(t);
  const first = (await (await heroUpload(env, cookie, {})).json()).hero;
  const keys = await keysOf(env);
  await assertError(await heroUpload(env, cookie, { full: TEXT_BYTES }), 415, NOT_A_PHOTO);
  await assertError(await heroUpload(env, cookie, { thumb: null }), 400, MISSING);
  await assertError(await heroUpload(env, cookie, { height: 0 }), 400, BAD_SIZE);
  await assertError(await heroUpload(env, cookie, { full: jpegOfSize(2621441) }), 413, TOO_BIG);
  assert.deepEqual(await keysOf(env), keys);
  assert.equal((await getContent(env.DB)).hero.image_key, first.image_key);
});

test('when the D1 write of a hero image fails, the new images are deleted and the old hero, with its KV keys, stays', async (t) => {
  const { env, cookie } = await signedIn(t);
  const first = (await (await heroUpload(env, cookie, {})).json()).hero;
  failD1(env, /^\s*INSERT\s+INTO\s+settings\b/i);
  const logged = t.mock.method(console, 'error', () => {});
  await assertError(await heroUpload(env, cookie, {}), 500, UNEXPECTED);
  assert.deepEqual(await keysOf(env), imageKeys(first.image_key));
  assert.equal((await getContent(env.DB)).hero.image_key, first.image_key);
  assert.match(loggedText(logged)[0], /D1 yazamadı/);
});

// ---------------------------------------------------------------------------------------------
// Who may use them
// ---------------------------------------------------------------------------------------------

const ROUTES = [
  ['POST', 'photos', () => ({ body: uploadForm() })],
  ['PATCH', `photos/${UNKNOWN_ID}`, () => ({ json: { caption: 'x' } })],
  ['PUT', 'photos/order', () => ({ json: { ids: [] } })],
  ['POST', `photos/${UNKNOWN_ID}/replace`, () => ({ body: uploadForm() })],
  ['DELETE', `photos/${UNKNOWN_ID}`, () => ({})],
  ['POST', 'hero-image', () => ({ body: uploadForm() })],
];

test('every photo route needs the session: without a cookie it is 401, and nothing is stored or changed', async (t) => {
  const env = freshEnv(t);
  for (const [method, path, options] of ROUTES) await assertError(await api(env, method, path, options()), 401, SIGNED_OUT, `${method} ${path}`);
  assert.deepEqual(await keysOf(env), []);
  const content = await getContent(env.DB);
  assert.deepEqual(content.photos.map(({ id }) => id), SEED_IDS);
  assert.deepEqual(content.hero, DEFAULT_HERO);
});

test('every photo route needs the site’s Origin: a POST, PUT, PATCH or DELETE without it, or from another site, is 403', async (t) => {
  const { env, cookie } = await signedIn(t);
  for (const [method, path, options] of ROUTES) {
    for (const origin of [null, 'https://evil.test', 'null']) {
      await assertError(await api(env, method, path, { ...options(), cookie, origin }), 403, REFUSED, `${method} ${path} from ${origin}`);
    }
  }
  assert.deepEqual(await keysOf(env), []);
  assert.deepEqual(await orderOf(env, cookie), SEED_IDS);
});

test('another method on a photo route is 405 with an Allow header; PUT photos/order does not shadow PATCH and DELETE photos/:id', async (t) => {
  const { env, cookie } = await signedIn(t);
  const wrong = [
    ['GET', 'photos', ['POST']],
    ['PUT', 'photos', ['POST']],
    ['DELETE', 'photos', ['POST']],
    ['GET', `photos/${UNKNOWN_ID}`, ['DELETE', 'PATCH']],
    ['PUT', `photos/${UNKNOWN_ID}`, ['DELETE', 'PATCH']],
    ['POST', 'photos/order', ['DELETE', 'PATCH', 'PUT']],
    ['GET', `photos/${UNKNOWN_ID}/replace`, ['POST']],
    ['PUT', `photos/${UNKNOWN_ID}/replace`, ['POST']],
    ['GET', 'hero-image', ['POST']],
    ['PUT', 'hero-image', ['POST']],
  ];
  for (const [method, path, allowed] of wrong) {
    const response = await api(env, method, path, { cookie, origin: SITE });
    await assertError(response, 405, 'Bu istek desteklenmiyor.', `${method} ${path}`);
    assert.deepEqual(response.headers.get('Allow').split(', ').sort(), allowed, `${method} ${path}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Through the real server
// ---------------------------------------------------------------------------------------------

test('through the real dev server: log in, upload a photo, fetch its image (and a 304), delete it; a body over 3.5 MiB is 413', async (t) => {
  const data = await tempTree();
  const server = await startServer({
    port: 0,
    root: fileURLToPath(new URL('..', import.meta.url)),
    dataDir: join(data.dir, 'data'),
    vars: { ADMIN_PASSWORD: 'test-sifre-123', APP_SECRET: 'x'.repeat(40) },
  });
  t.after(async () => {
    await server.close();
    await data.cleanup();
  });
  const origin = server.url;

  const login = await fetch(`${origin}/api/admin/login`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-sifre-123' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0].split(';')[0];
  const headers = { Origin: origin, Cookie: cookie };

  const created = await fetch(`${origin}/api/admin/photos`, { method: 'POST', headers, body: uploadForm({ caption: 'Gerçek sunucu' }) });
  assert.equal(created.status, 201);
  const { photo } = await created.json();
  assert.equal(photo.caption, 'Gerçek sunucu');

  const image = await fetch(`${origin}${photo.full}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal(image.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), TINY_JPEG);
  const etag = image.headers.get('etag');
  assert.equal((await fetch(`${origin}${photo.full}`, { headers: { 'If-None-Match': etag } })).status, 304);

  const tooBig = await fetch(`${origin}/api/admin/photos`, {
    method: 'POST',
    headers,
    body: uploadForm({ full: jpegOfSize(2621440), thumb: jpegOfSize(409600), caption: 'x'.repeat(700000) }),
  });
  assert.equal(tooBig.status, 413);
  assert.deepEqual(await tooBig.json(), { message: TOO_BIG });

  assert.equal((await fetch(`${origin}/api/admin/photos/${photo.id}`, { method: 'DELETE', headers })).status, 200);
  assert.equal((await fetch(`${origin}${photo.full}`)).status, 404, 'the image is gone from KV too');
});
