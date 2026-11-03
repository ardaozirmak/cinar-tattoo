// POST /api/track: the public beacon behind the site's buttons (spec §5.6). The page's script posts
// {"kind":"whatsapp"} (or call, directions, form, instagram) with navigator.sendBeacon, which sends it
// as text/plain, and this adds one to today's counter. No cookie, nothing about the visitor: only the
// day's totals, which the panel's summary card reads (GET /api/admin/stats).
//
// In this order:
// 1. The Origin must be the site's own or, when the browser sent none, the Referer must be a page of
//    it: 403. It is not a login: it keeps other sites from filling the counters.
// 2. A request without a body counts nothing and is 204 (spec §8). A body that is not JSON, or has no
//    known kind, is 400; one over 1024 bytes is 413.
// 3. At most 30 counts per IP per minute (clicks.js); the rest are ignored, and 204 all the same.
// 4. The count. A count that cannot be written is lost and logged, never an error: the visitor has
//    tapped a button and must not see anything go wrong.
import { ORIGIN_REFUSED } from '../_lib/admin/router.js';
import { clientIp } from '../_lib/auth.js';
import { createRateLimiter, istanbulDay } from '../_lib/clicks.js';
import { ensureSchema, incrementClick } from '../_lib/db.js';
import { CLICK_KINDS } from '../_lib/fields.js';
import { HttpError, errorJson, readJson } from '../_lib/http.js';

// A beacon is a few dozen bytes.
const MAX_BODY_BYTES = 1024;

// The limiter lives as long as the isolate: each one counts for itself, which is enough for a trend figure.
const limiter = createRateLimiter({ limit: 30, windowMs: 60 * 1000 });

export async function onRequestPost({ request, env }) {
  if (!comesFromSite(request)) return errorJson(403, ORIGIN_REFUSED);
  try {
    const kind = await readKind(request);
    const now = Date.now();
    if (kind !== null && limiter.take(clientIp(request), now)) await count(env, kind, now);
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return errorJson(error.status, error.message);
  }
  return new Response(null, { status: 204 });
}

// Whether the request comes from a page of the site: its Origin is the request's own origin or, when
// the browser sent no Origin, its Referer is an address on it. A Referer is only the fallback: where
// there is an Origin, it decides.
function comesFromSite(request) {
  const site = new URL(request.url).origin;
  const origin = request.headers.get('Origin');
  if (origin !== null) return origin === site;
  const referer = request.headers.get('Referer');
  if (referer === null) return false;
  try {
    return new URL(referer).origin === site;
  } catch {
    return false;
  }
}

// The kind of click the beacon reports, or null when the request has no body (nothing to count).
// readJson answers an empty body with 400, so it is looked for first.
async function readKind(request) {
  if (request.body === null || request.headers.get('Content-Length') === '0') return null;
  const body = await readJson(request, MAX_BODY_BYTES);
  if (typeof body !== 'object' || body === null || !CLICK_KINDS.includes(body.kind)) throw new HttpError(400, 'İstek okunamadı.');
  return body.kind;
}

// Adds one to today's counter of `kind` (the day is the one in Istanbul). It never throws: a count
// that is lost is not worth an error, and the reason goes to the log.
async function count(env, kind, now) {
  try {
    if (!env.DB) throw new Error('the DB binding is missing');
    await ensureSchema(env.DB);
    await incrementClick(env.DB, istanbulDay(now), kind);
  } catch (error) {
    console.error(`track: a ${kind} click was not counted`, error);
  }
}
