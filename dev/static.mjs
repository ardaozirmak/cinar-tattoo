// Static files for the local emulator: the `env.ASSETS` binding Cloudflare Pages gives a Function,
// plus the site's `_headers` file.
//
// Rules:
// - GET and HEAD are served; any other method is 405.
// - The ETag is the quoted SHA-1 of the content, and a matching If-None-Match gives 304.
// - /x/ serves x/index.html. /x serves the file x, else x.html, else x/index.html.
// - Nothing found serves 404.html with status 404 (plain text when there is no 404.html).
// - The content type comes from the file extension.
// - Every file answers with Accept-Ranges: bytes. A GET with one range, `bytes=a-b` (b is capped at
//   the last byte) or `bytes=a-`, is a 206 with Content-Range; a range that starts at or past the
//   end is a 416 with `Content-Range: bytes */<size>`. Anything else (other units, several ranges,
//   a suffix range `bytes=-n`, a > b) gets the whole file. iOS Safari plays video only from a server
//   that answers ranges (`npm run dev:lan`).
// - `_headers` blocks apply to every response from here (200, 304 and 404 alike) and never to a
//   Function's own responses. Every block whose pattern matches the requested path applies, in file
//   order; `*` is a splat that also matches "/"; a header that is set more than once is joined with
//   ", "; a rule replaces a header of the same name that is set here, such as Content-Type.
// - A path that resolves outside the public folder is a 404: "..", "%2e%2e", "%2f" and "%5c" inside a
//   segment, backslashes, drive letters, and the NTFS stream suffix ("::$DATA") that would otherwise
//   read a file under another name. /_headers is never served, whatever its spelling.
//
// Known limits:
// - No redirects: Pages sends /x.html to /x and /x to /x/, this serves each directly. There is no
//   SPA fallback, no If-Range, no multi-range or suffix ranges, and no compression.
// - Windows file names are case-insensitive, so /A.TXT serves a.txt here; on Cloudflare it is a 404.
// - `_headers` supports exact paths and `*` only: no :placeholders, no host patterns, no "! Name"
//   to detach a header. A line it cannot read is skipped.
// - Files are read on every request, as is `_headers`, so edits show up without a restart.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const TEXT = 'text/plain; charset=utf-8';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.txt': TEXT,
  '.xml': 'application/xml',
  '.ico': 'image/x-icon',
};

// What reading a path that is not a readable file looks like: missing, a directory, or a name the
// platform refuses. All of them mean "no such file" to a visitor.
const NOT_A_FILE = new Set(['ENOENT', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG', 'EINVAL']);

// A header name (RFC 9110 "token"), and a value Headers accepts: tab, printable ASCII and Latin-1.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;

/**
 * The `env.ASSETS` binding over a folder. The folder may be missing or empty: every request is
 * then a 404.
 * @returns {{ fetch(input: Request | URL | string): Promise<Response> }}
 */
export function createAssets(publicDir) {
  const root = resolve(publicDir);

  // An own function that does not use `this`, like the D1 and KV shims, so a test may detach it.
  async function fetch(input) {
    const { method, url, ifNoneMatch, range } = requestInfo(input);
    const response = await serve(root, method, url.pathname, ifNoneMatch, range);
    const extra = headersFor(await readRules(root), url.pathname);
    for (const [name, value] of extra) response.headers.set(name, value);
    return response;
  }

  return { fetch };
}

/**
 * Parses the text of a `_headers` file: an unindented line is a URL pattern, and the indented
 * `Name: value` lines under it are its headers. Blank lines and `#` comments are skipped, and so
 * is whatever cannot be read (a header line before any pattern, a line without a colon, a name
 * that is not a header name, a value Headers would refuse).
 * @returns {Array<{pattern: string, headers: [string, string][]}>}
 */
export function parseHeadersFile(text) {
  const blocks = [];
  let current = null;
  // Some Windows editors start a UTF-8 file with a byte order mark, which would make the first
  // line look indented. It is dropped by its code, not written out, so that no editor or tool can
  // turn it into an invisible character in this source.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const line of body.split('\n')) {
    const trimmed = line.trim(); // also drops the "\r" of a CRLF line end
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    if (!/^\s/.test(line)) {
      current = { pattern: trimmed, headers: [] };
      blocks.push(current);
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (current === null || colon < 1) continue;
    const name = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (HEADER_NAME.test(name) && HEADER_VALUE.test(value)) current.headers.push([name, value]);
  }
  return blocks;
}

// What ASSETS.fetch needs from its argument: a Request, a URL, or a string that is either absolute
// or just a path (the host never matters).
function requestInfo(input) {
  if (input instanceof Request) {
    return { method: input.method, url: new URL(input.url), ifNoneMatch: input.headers.get('if-none-match'), range: input.headers.get('range') };
  }
  return { method: 'GET', url: new URL(input, 'http://assets.invalid'), ifNoneMatch: null, range: null };
}

async function serve(root, method, pathname, ifNoneMatch, range) {
  if (method !== 'GET' && method !== 'HEAD') return textResponse(405, 'Method Not Allowed', false, { allow: 'GET, HEAD' });
  const head = method === 'HEAD';

  const found = await findFile(root, pathname);
  if (found === null) return notFound(root, head);

  const etag = `"${createHash('sha1').update(found.bytes).digest('hex')}"`;
  if (matchesETag(ifNoneMatch, etag)) return new Response(null, { status: 304, headers: { etag } });
  const type = contentType(found.path);
  const size = found.bytes.length;
  const span = head ? null : byteRange(range, size);
  if (span === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}`, 'accept-ranges': 'bytes', etag } });
  }
  if (span !== null) {
    const part = found.bytes.subarray(span.start, span.end + 1);
    return new Response(part, {
      status: 206,
      headers: { 'content-type': type, 'content-length': String(part.length), 'content-range': `bytes ${span.start}-${span.end}/${size}`, 'accept-ranges': 'bytes', etag },
    });
  }
  return new Response(head ? null : found.bytes, {
    status: 200,
    headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes', etag },
  });
}

// One `bytes=a-b` or `bytes=a-` range as { start, end } (end capped at the last byte), the string
// 'unsatisfiable' when it starts at or past the end, or null for anything this server does not do,
// which then gets the whole file.
function byteRange(header, size) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(String(header ?? '').trim());
  if (match === null) return null;
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size) return 'unsatisfiable';
  if (start > end) return null;
  return { start, end };
}

async function notFound(root, head) {
  const page = await readOrNull(join(root, '404.html'));
  if (page === null) return textResponse(404, 'Not found', head);
  return new Response(head ? null : page, {
    status: 404,
    headers: { 'content-type': TYPES['.html'], 'content-length': String(page.length) },
  });
}

function textResponse(status, text, head, extra = {}) {
  const bytes = Buffer.from(text);
  return new Response(head ? null : bytes, {
    status,
    headers: { 'content-type': TEXT, 'content-length': String(bytes.length), ...extra },
  });
}

// The file a path stands for, as { path, bytes }, or null.
async function findFile(root, pathname) {
  const segments = requestedSegments(pathname);
  if (segments === null) return null;
  // `_headers` configures the site; it is not content. NTFS ignores case, so compare lower-cased.
  if (segments.length === 1 && segments[0].toLowerCase() === '_headers') return null;

  const base = join(root, ...segments);
  const candidates = pathname.endsWith('/') ? [join(base, 'index.html')] : [base, `${base}.html`, join(base, 'index.html')];
  for (const path of candidates) {
    if (!isInside(root, path)) continue;
    const bytes = await readOrNull(path);
    if (bytes !== null) return { path, bytes };
  }
  return null;
}

// "/a/b.txt" -> ["a", "b.txt"], "/dir/" -> ["dir"], "/" -> []. Every segment is percent-decoded on
// its own, so an encoded "/" or "\" is caught as a character in the segment instead of becoming a
// separator. Null for a path no file can have: an empty segment, ".", "..", a malformed escape, or
// a character that separates paths or opens an NTFS stream (a drive letter has the colon).
function requestedSegments(pathname) {
  const parts = pathname.slice(1).split('/');
  if (parts.at(-1) === '') parts.pop();
  const segments = [];
  for (const part of parts) {
    let segment;
    try {
      segment = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (segment === '' || segment === '.' || segment === '..' || /[\\/:\x00-\x1f]/.test(segment)) return null;
    segments.push(segment);
  }
  return segments;
}

// A second line of defence for the check that matters most, on the finished path: it must be a
// place inside `root`. (URL parsing already removes "." and ".." segments, and requestedSegments
// refuses what is left, so this only fires if one of those two ever changes.)
function isInside(root, path) {
  const fromRoot = relative(root, path);
  return fromRoot !== '' && fromRoot.split(sep)[0] !== '..' && !isAbsolute(fromRoot);
}

async function readOrNull(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (NOT_A_FILE.has(error.code)) return null;
    throw error;
  }
}

function contentType(path) {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

// If-None-Match: a list of entity tags, any of which may be weak (W/"..."), or "*".
function matchesETag(header, etag) {
  if (header === null) return false;
  return header.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === '*' || value.replace(/^W\//, '') === etag;
  });
}

async function readRules(root) {
  const bytes = await readOrNull(join(root, '_headers'));
  return bytes === null ? [] : parseHeadersFile(bytes.toString('utf8'));
}

// The headers of every block whose pattern matches, repeated names joined with ", " (that is what
// Headers.append does).
function headersFor(rules, pathname) {
  const joined = new Headers();
  for (const { pattern, headers } of rules) {
    if (!patternToRegExp(pattern).test(pathname)) continue;
    for (const [name, value] of headers) joined.append(name, value);
  }
  return joined;
}

// "*" matches anything, "/" included; every other character stands for itself.
function patternToRegExp(pattern) {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`);
}
