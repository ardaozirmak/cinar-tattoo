// The photo and hero image endpoints of the admin API (spec §6.3 and §8).
//
// The router (router.js) has already checked the Origin, the setup and the session, and it does so
// before a handler reads the body: an upload without a session is 401 without its multipart body being
// read. A handler answers an error by throwing an HttpError.
//
// An image is two objects in KV under a new random key (`img/<key>/full` and `img/<key>/thumb`, with the
// type and size as metadata), and a row in D1 that points at the key. KV and D1 cannot be written
// together, so the order is what keeps them in step:
// - The new objects are written first, then D1. When D1 fails the new objects are deleted again and the
//   error goes on: KV is never left with an image that no row points at.
// - The old objects are deleted last, once D1 has the new key. That is best effort: a failure is logged
//   and the answer is still a success, because the change is saved. An object left behind is garbage,
//   not a wrong page.
// A replaced image gets a new key, so no address ever shows two different images (/img is cached for a year).
import { countPhotos, deletePhoto, getPhoto, insertPhoto, replacePhotoImage, setHero, setPhotoOrder, updatePhotoMeta } from '../db.js';
import { CATEGORIES, validateCaption } from '../fields.js';
import { HttpError, json, readJson } from '../http.js';
import { IMAGE_KEY_RE, IMAGE_LIMITS, PHOTO_ID_RE, kvKeys, newImageKey } from '../media.js';
import { readImageUpload } from '../upload.js';
import { withImageUrls } from './auth-handlers.js';

// The longest side of a thumb, in pixels (spec §6.3). The browser makes the thumb; the server only
// works out its size for the KV metadata.
const THUMB_LONGEST_SIDE = 640;

const NOT_FOUND = 'Fotoğraf bulunamadı.';
const UNREADABLE = 'İstek okunamadı.';
const STALE_ORDER = 'Sıralama güncel değil. Sayfayı yenile.';
const BAD_CATEGORY = 'Tür geçersiz.';

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

/**
 * POST /api/admin/photos (multipart: full, thumb, width, height, and optionally caption and category)
 * → 201 { photo }. The new photo goes in front of all the others.
 */
export async function createPhoto({ request, env, db, now }) {
  const { fields, ...upload } = await readImageUpload(request);
  // A field the form does not have stays undefined, and insertPhoto gives it what the table does.
  const caption = fields.caption === undefined ? undefined : cleanCaption(fields.caption);
  const category = fields.category === undefined ? undefined : knownCategory(fields.category);
  if ((await countPhotos(db)) >= IMAGE_LIMITS.maxPhotos) {
    throw new HttpError(409, `Fotoğraf sınırına ulaşıldı (${IMAGE_LIMITS.maxPhotos}). Yeni eklemek için eskilerden sil.`);
  }

  const { result: photo } = await withNewImage(env, upload, (imageKey) =>
    insertPhoto(db, { id: newImageKey(), caption, category, image_key: imageKey, width: upload.width, height: upload.height, created_at: now }),
  );
  return json({ photo: withImageUrls(photo) }, { status: 201 });
}

/** PATCH /api/admin/photos/:id {caption?, category?} → { photo }. What is not sent stays as it is. */
export async function editPhoto({ request, db, params }) {
  const id = photoId(params);
  const body = await readJson(request);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, UNREADABLE);
  const changes = {};
  if (Object.hasOwn(body, 'caption')) changes.caption = cleanCaption(body.caption);
  if (Object.hasOwn(body, 'category')) changes.category = knownCategory(body.category);

  const photo = await updatePhotoMeta(db, id, changes);
  if (photo === null) throw notFound();
  return json({ photo: withImageUrls(photo) });
}

/** PUT /api/admin/photos/order {ids} → { ok: true }. `ids` must be every photo there is, each once. */
export async function reorderPhotos({ request, db }) {
  const ids = (await readJson(request))?.ids;
  if (!Array.isArray(ids)) throw new HttpError(400, UNREADABLE);
  if (!(await setPhotoOrder(db, ids))) throw new HttpError(400, STALE_ORDER);
  return json({ ok: true });
}

/** POST /api/admin/photos/:id/replace (multipart: full, thumb, width, height) → { photo }: the same photo with a new image. */
export async function replacePhoto({ request, env, db, params }) {
  const id = photoId(params);
  const upload = await readImageUpload(request);
  if ((await getPhoto(db, id)) === null) throw notFound();

  const { result } = await withNewImage(env, upload, async (imageKey) => {
    const change = await replacePhotoImage(db, id, { image_key: imageKey, width: upload.width, height: upload.height });
    if (change === null) throw notFound(); // deleted while the upload was on its way
    return change;
  });
  if (result.old.source === 'kv') await deleteImage(env, result.old.image_key);
  return json({ photo: withImageUrls(result.updated) });
}

/** DELETE /api/admin/photos/:id → { ok: true }. A seed photo is only a row: its picture is a static file. */
export async function removePhoto({ env, db, params }) {
  const photo = await deletePhoto(db, photoId(params));
  if (photo === null) throw notFound();
  if (photo.source === 'kv') await deleteImage(env, photo.image_key);
  return json({ ok: true });
}

/** POST /api/admin/hero-image (multipart: full, thumb, width, height) → { hero }: the picture of the shop sign. */
export async function replaceHero({ request, env, db }) {
  const upload = await readImageUpload(request);
  const { imageKey, result: previous } = await withNewImage(env, upload, (key) =>
    setHero(db, { source: 'kv', image_key: key, width: upload.width, height: upload.height }),
  );
  if (previous.source === 'kv') await deleteImage(env, previous.image_key);
  return json({ hero: withImageUrls({ source: 'kv', image_key: imageKey, width: upload.width, height: upload.height }) });
}

// ---------------------------------------------------------------------------------------------
// What the client sent
// ---------------------------------------------------------------------------------------------

const notFound = () => new HttpError(404, NOT_FOUND);

// The photo id in the path. An id that no photo can have (media.js PHOTO_ID_RE) is simply not found.
function photoId(params) {
  const [id] = params;
  if (!PHOTO_ID_RE.test(id)) throw notFound();
  return id;
}

// A caption, cleaned; what the validator objects to is a 400 with its message.
function cleanCaption(value) {
  const checked = validateCaption(value);
  if (!checked.ok) throw new HttpError(400, checked.message);
  return checked.value;
}

function knownCategory(value) {
  if (!CATEGORIES.includes(value)) throw new HttpError(400, BAD_CATEGORY);
  return value;
}

// ---------------------------------------------------------------------------------------------
// KV
// ---------------------------------------------------------------------------------------------

// Stores `upload` (from readImageUpload) in KV under a new key, then runs `write(imageKey)`, the D1
// write that points at it, and gives { imageKey, result }. When either fails the new objects are
// deleted again, and the error goes on.
async function withNewImage(env, upload, write) {
  const imageKey = newImageKey();
  try {
    await putImage(env, imageKey, upload);
    return { imageKey, result: await write(imageKey) };
  } catch (error) {
    await deleteImage(env, imageKey);
    throw error;
  }
}

// The two objects of an image, one after the other, so that a failure of the first writes nothing
// more. The metadata holds the type (from the bytes, never from the client) and the size.
async function putImage(env, imageKey, { full, thumb, width, height }) {
  const keys = kvKeys(imageKey);
  await env.IMAGES.put(keys.full, full.bytes, { metadata: { type: full.type, width, height } });
  await env.IMAGES.put(keys.thumb, thumb.bytes, { metadata: { type: thumb.type, ...thumbSize(width, height) } });
}

// The size of the thumb of a full image of width x height: its longest side is 640 pixels, and a
// smaller image is not enlarged. It is worked out and not measured, because it is only metadata. A side
// is never 0.
function thumbSize(width, height) {
  const scale = Math.min(1, THUMB_LONGEST_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Deletes the two objects of an image. It never throws: it runs after the change it belongs to is
// saved, which must not be reported as failed, or while another error is on its way, which is the one
// to report. A failure is logged.
async function deleteImage(env, imageKey) {
  if (!IMAGE_KEY_RE.test(imageKey)) return;
  const keys = Object.values(kvKeys(imageKey));
  const results = await Promise.allSettled(keys.map(async (key) => env.IMAGES.delete(key)));
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') console.error(`admin API: the KV object ${keys[index]} was not deleted`, result.reason);
  }
}
