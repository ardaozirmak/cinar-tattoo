// The photo upload of the admin panel (spec §6.3): a multipart form with the two images the browser
// made, `full` and `thumb`, the size of the full one (`width`, `height`) and, for a new photo, a
// `caption` and a `category`. readImageUpload checks it and gives the values, or throws an HttpError
// that says in Turkish what is wrong and what to do.
//
// The type of an image is what its first bytes show (media.js), never what the client says it is.
// Uses only Web APIs: it runs inside a Pages Function.
import { HttpError } from './http.js';
import { IMAGE_LIMITS, sniffImageType } from './media.js';

// What a request may weigh: the two images at their limits and about 600 KiB for the form around them.
const MAX_REQUEST_BYTES = 3670016;

// A size is written with digits only and has no leading zero. Its range is checked after it is read.
const SIZE = /^[1-9][0-9]{0,3}$/;

// The text fields that may come with a photo. Nothing else of the form is passed on.
const TEXT_FIELDS = ['caption', 'category'];

const TOO_BIG = 'Fotoğraf çok büyük. Daha küçük bir fotoğraf seç.';
const UNREADABLE = 'Yükleme okunamadı. Tekrar dene.';
const MISSING = 'Fotoğraf eksik.';
const NOT_A_PHOTO = 'Bu dosya bir fotoğraf değil ya da desteklenmiyor. JPEG, PNG veya WebP seç.';
const BAD_SIZE = 'Fotoğraf boyutu okunamadı.';

/**
 * Reads the upload: { full: { bytes, type }, thumb: { bytes, type }, width, height, fields }.
 * - `bytes` is a Uint8Array and `type` 'image/jpeg', 'image/png' or 'image/webp'.
 * - `width` and `height` are the size of the full image, whole numbers from 1 to 4000.
 * - `fields` holds the `caption` and `category` the form has, as the client sent them (text); a field
 *   that is not there is not in it.
 *
 * Errors, in the order they are looked for:
 * - 413 for a Content-Length above 3670016 (nothing is read then), and for a part over its limit
 *   (2621440 bytes for `full`, 409600 for `thumb`). A request without a Content-Length is not refused
 *   for that, as the browser's multipart uploads always have one; the limits of the parts apply.
 * - 400 when the body is not a readable form, and when `full` or `thumb` is missing or not a file.
 * - 415 when a file does not start like a JPEG, a PNG or a WebP.
 * - 400 when `width` or `height` is missing or not a whole number from 1 to 4000.
 */
export async function readImageUpload(request) {
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) throw new HttpError(413, TOO_BIG);

  const form = await readForm(request);
  const fullFile = fileOf(form, 'full');
  const thumbFile = fileOf(form, 'thumb');
  if (fullFile.size > IMAGE_LIMITS.fullMaxBytes || thumbFile.size > IMAGE_LIMITS.thumbMaxBytes) throw new HttpError(413, TOO_BIG);

  const full = await imageOf(fullFile);
  const thumb = await imageOf(thumbFile);
  const width = sizeOf(form, 'width');
  const height = sizeOf(form, 'height');

  const fields = {};
  for (const name of TEXT_FIELDS) {
    const value = form.get(name);
    if (typeof value === 'string') fields[name] = value;
  }
  return { full, thumb, width, height, fields };
}

async function readForm(request) {
  try {
    return await request.formData();
  } catch {
    // Not multipart, broken multipart, or a connection that broke off.
    throw new HttpError(400, UNREADABLE);
  }
}

// The file part `name`. A part that is missing, or that arrived as text, is a missing photo.
function fileOf(form, name) {
  const part = form.get(name);
  if (!(part instanceof Blob)) throw new HttpError(400, MISSING);
  return part;
}

async function imageOf(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (type === null) throw new HttpError(415, NOT_A_PHOTO);
  return { bytes, type };
}

// The size `name` as a number from 1 to the largest image side.
function sizeOf(form, name) {
  const text = form.get(name);
  const value = typeof text === 'string' && SIZE.test(text) ? Number(text) : 0;
  if (value < 1 || value > IMAGE_LIMITS.maxDimension) throw new HttpError(400, BAD_SIZE);
  return value;
}
