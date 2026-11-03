// GET /img/:id/:variant: a photo the owner uploaded, from KV (spec §6.3). `id` is the random part of
// the KV key (`img/<id>/full` and `img/<id>/thumb`; the metadata holds the type) and `variant` is
// `full` or `thumb`.
//
// Nothing about an image changes under its address: a replaced photo gets a new key. So the answer
// may be kept for a year, and the ETag is just the address.
//
// In this order:
// 1. A bad id or variant is 404, and nothing is read.
// 2. An If-None-Match with the ETag is 304 at once: neither the cache nor KV is asked.
// 3. The Cache API (caches.default), when the runtime has one, then KV. What KV gives is stored in
//    the cache for the next visitor.
import { errorJson } from '../../_lib/http.js';
import { IMAGE_KEY_RE, kvKeys } from '../../_lib/media.js';

// The types an upload can have (media.js sniffImageType). Anything else in the metadata is not sent.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DEFAULT_TYPE = 'image/jpeg';

export async function onRequestGet({ request, env, params, waitUntil }) {
  const { id, variant } = params;
  if (!IMAGE_KEY_RE.test(id) || (variant !== 'full' && variant !== 'thumb')) return notFound();

  const etag = `"${id}-${variant}"`;
  if (matchesETag(request.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers: cacheHeaders(etag) });

  try {
    // Keyed by the image's own address, so that a query string cannot make one image many entries.
    const cache = globalThis.caches?.default;
    const cacheKey = cache === undefined ? undefined : new Request(`${new URL(request.url).origin}/img/${id}/${variant}`);
    const cached = cache === undefined ? undefined : await cache.match(cacheKey);
    if (cached !== undefined) return cached;

    const { value, metadata } = await env.IMAGES.getWithMetadata(kvKeys(id)[variant], 'arrayBuffer');
    if (value === null) return notFound();

    const type = IMAGE_TYPES.has(metadata?.type) ? metadata.type : DEFAULT_TYPE;
    const response = new Response(value, { headers: { ...cacheHeaders(etag), 'Content-Type': type } });
    if (cache !== undefined) waitUntil(cache.put(cacheKey, response.clone()).catch((error) => console.error(`img: ${id}/${variant} was not stored in the cache`, error)));
    return response;
  } catch (error) {
    console.error(`img: ${id}/${variant} failed`, error);
    return errorJson(500, 'Beklenmeyen bir hata oldu. Tekrar dene.');
  }
}

// What a 200 and a 304 both carry.
const cacheHeaders = (etag) => ({
  'Cache-Control': 'public, max-age=31536000, immutable',
  ETag: etag,
  'X-Content-Type-Options': 'nosniff',
});

const notFound = () => errorJson(404, 'Fotoğraf bulunamadı.');

// Whether an If-None-Match header lists `etag`. A weak tag (W/"x") counts, as it may for a 304. `*`
// is not looked at: it asks whether any copy exists, which the ETag alone cannot tell.
function matchesETag(header, etag) {
  return header !== null && header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
}
