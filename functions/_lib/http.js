// HTTP helpers shared by the Functions: an error with a status, JSON responses, a size-capped JSON
// body reader and the headers of the public page.

const TOO_LARGE = 'İstek çok büyük.';
const UNREADABLE = 'İstek okunamadı.';

/** An error a handler throws to answer with a status and a Turkish message. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * A JSON response that is never cached or sniffed. Headers given in `headers` are added to the
 * defaults and win over them; every Set-Cookie among them is kept.
 */
export function json(data, { status = 200, headers } = {}) {
  const merged = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const [name, value] of new Headers(headers ?? {})) {
    if (name === 'set-cookie') merged.append(name, value);
    else merged.set(name, value);
  }
  return new Response(JSON.stringify(data), { status, headers: merged });
}

/** An error response in the shape the admin panel expects: `{ message }`. */
export function errorJson(status, message) {
  return json({ message }, { status });
}

/**
 * Reads the request body as JSON and returns whatever it holds.
 *
 * The size is enforced as the body arrives: a Content-Length above `maxBytes` is turned away
 * without reading anything, and a body without one (or one that undersells it) is counted byte by
 * byte and abandoned the moment it passes the limit, so a client cannot make a Function buffer
 * more than `maxBytes`. Some endpoints need no login, so this matters.
 *
 * The Content-Type is ignored: navigator.sendBeacon posts JSON as text/plain.
 *
 * - Too large: HttpError(413, 'İstek çok büyük.').
 * - Empty, not UTF-8, not JSON, or the connection broke off: HttpError(400, 'İstek okunamadı.').
 *   An endpoint that accepts a request without a body checks `request.body === null` first.
 */
export async function readJson(request, maxBytes = 65536) {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, TOO_LARGE);
  const bytes = await readBytes(request.body, maxBytes);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new HttpError(400, UNREADABLE);
  }
}

async function readBytes(stream, maxBytes) {
  if (stream === null) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel().catch(() => {}); // tell the sender to stop; nothing here waits for it
        throw new HttpError(413, TOO_LARGE);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, UNREADABLE); // the connection broke off half way
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// The public page loads nothing from outside, except a Google Maps frame the visitor asks for.
export const SITE_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "font-src 'self'",
  'frame-src https://www.google.com https://maps.google.com',
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

/** The headers of the HTML page, as a new Headers each time. The page is always fetched fresh. */
export function htmlHeaders() {
  return new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': SITE_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
}

// SITE_URL (a Pages variable, e.g. https://cinartattoo.com) names the one address the public page
// lives at. A request for the page on any other host (the .pages.dev address, www.) is sent there
// with a permanent redirect, so Google indexes one address only. Unset: no redirect.
export function siteRedirect(request, env) {
  const site = typeof env?.SITE_URL === 'string' ? env.SITE_URL.trim() : '';
  if (!site) return null;
  let target;
  try {
    target = new URL(site);
  } catch {
    return null;
  }
  const url = new URL(request.url);
  if (url.origin === target.origin) return null;
  return new Response(null, { status: 301, headers: { Location: `${target.origin}${url.pathname}${url.search}` } });
}
