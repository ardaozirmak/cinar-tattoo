// Photo rules shared by the upload API, the image route and the stored rows: the limits, the shape
// of ids and keys, where each image is served from, and a check of what a file really is.
//
// An image lives in one of two places. A seed photo (the first gallery pictures and the shop.s
// logo) is a static file under public/seed/. Every picture uploaded from the panel is in KV,
// under a random key, in two sizes: `full` for the viewer and `thumb` for the gallery.
import { CAPTION_MAX } from './fields.js';

// Shared module data: frozen, so that nobody changes it by accident.
export const IMAGE_LIMITS = Object.freeze({
  fullMaxBytes: 2621440, // 2.5 MiB
  thumbMaxBytes: 409600, // 400 KiB
  maxDimension: 4000, // pixels, for width and for height
  maxPhotos: 400,
  captionMax: CAPTION_MAX,
});

// A seed photo's id is "seed-" and its name: words of lower-case letters and digits joined by dashes
// (seed-w01, seed-chicano-kol). Any other photo's id is 20 hex characters. Nothing else is a photo
// id, so an id from a URL is safe to look up.
export const PHOTO_ID_RE = /^(seed-[a-z0-9]+(?:-[a-z0-9]+)*|[0-9a-f]{20})$/;
// The random part of a KV key.
export const IMAGE_KEY_RE = /^[0-9a-f]{20}$/;

/** A new random image key: 20 lower-case hex characters (80 bits). It also works as a photo id. */
export function newImageKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The two KV keys of an image. The caller has checked `imageKey` against IMAGE_KEY_RE. */
export function kvKeys(imageKey) {
  return { full: `img/${imageKey}/full`, thumb: `img/${imageKey}/thumb` };
}

/**
 * The two URLs of an image, for a photo row or a hero ({ source, seed_path, image_key }). A seed
 * image is the static file /seed/<seed_path>-full.jpg (and -thumb.jpg); any other is served from KV
 * by /img/<image_key>/full (and /thumb).
 */
export function imageUrls(item) {
  if (item.source === 'kv') return { full: `/img/${item.image_key}/full`, thumb: `/img/${item.image_key}/thumb` };
  return { full: `/seed/${item.seed_path}-full.jpg`, thumb: `/seed/${item.seed_path}-thumb.jpg` };
}

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP", after RIFF and a 4-byte size

const hasBytes = (bytes, expected, offset = 0) => expected.every((byte, index) => bytes[offset + index] === byte);

/**
 * What a file is, from its first bytes alone: 'image/jpeg', 'image/png', 'image/webp', or null for
 * anything else (a GIF, text, an empty file, a value that is not a Uint8Array). This is the only
 * word on the type: what the client says it uploaded is never used.
 */
export function sniffImageType(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  if (hasBytes(bytes, JPEG)) return 'image/jpeg';
  if (hasBytes(bytes, PNG)) return 'image/png';
  if (hasBytes(bytes, RIFF) && hasBytes(bytes, WEBP, 8)) return 'image/webp';
  return null;
}
