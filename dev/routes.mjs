// Pages Functions routing for the local emulator: maps the files under functions/ to URL
// patterns the way Cloudflare Pages does, and picks the handler a request should run.
//
// The rules:
// - A file or folder whose name starts with "_" is not a route (functions/_lib holds shared code).
// - index.js maps to its folder, and name.ext.js to /name.ext. Only .js and .mjs files are routes.
// - [x] matches exactly one segment (params.x is a string). [[x]] matches zero or more segments
//   (params.x is an array) and must be the last segment.
// - Static segments outrank [x], which outranks [[x]]. Segments are compared from left to right, so
//   a static first segment beats a static last one.
// - Handler lookup: onRequest<Method> (onRequestPost), then onRequest. With neither, the caller
//   answers 405. A request whose path has no route goes to the static assets.
//
// Known limits of this emulator:
// - _middleware.js is not run (it is just a file starting with "_").
// - A matched route whose file has no handler for the method answers 405. Real Pages registers each
//   handler as its own route, so there the request could fall through to a less specific route.
// - A request path must match exactly: /api/static/extra does not reach api/static.js.
// - Path segments are percent-decoded here before they are compared and handed over as params
//   (one segment at a time, so %2F stays inside its segment).
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROUTE_FILE = /\.m?js$/;

// How specific a segment is: lower wins. The end of a pattern counts as static (rank 0): the only
// patterns that can both match one path while one of them ends first are an exact one and a
// catch-all, and the exact one is the better match.
const RANK = { static: 0, param: 1, catchall: 2 };

/**
 * @typedef {object} Route
 * @property {string} file      path inside functions/ with "/" separators, e.g. 'api/[name].js'
 * @property {string} pattern   the URL pattern it serves, e.g. '/api/[name]'
 * @property {Array<{type: 'static', value: string} | {type: 'param' | 'catchall', name: string}>} segments
 * @property {object} module    the imported module namespace, holding the onRequest* handlers
 */

/**
 * Reads functions/ and imports every route file. The table comes back sorted from the most to the
 * least specific route, so the first route that matches a path is the right one. A functions folder
 * that does not exist gives an empty table.
 * @returns {Promise<Route[]>}
 */
export async function buildRouteTable(functionsDir) {
  const routes = [];
  for (const file of await listRouteFiles(functionsDir)) {
    const segments = segmentsOf(file);
    let module;
    try {
      module = await import(pathToFileURL(join(functionsDir, file)).href);
    } catch (error) {
      throw new Error(`Cannot load ${file}: ${error.message}`, { cause: error });
    }
    routes.push({ file, pattern: patternOf(segments), segments, module });
  }
  return routes.sort(compareRoutes);
}

/**
 * The first route whose pattern matches `pathname`, with the params it captures, or null.
 * The method plays no part here; see findHandler.
 * @returns {{route: Route, params: Record<string, string | string[]>} | null}
 */
export function matchRoute(table, pathname) {
  const parts = splitPathname(pathname);
  if (parts === null) return null;
  for (const route of table) {
    const params = matchSegments(route.segments, parts);
    if (params !== null) return { route, params };
  }
  return null;
}

/**
 * The handler of `route` for an HTTP method: onRequest<Method> first, then onRequest, else null.
 * @returns {Function | null}
 */
export function findHandler(route, method) {
  const normalized = method.toUpperCase();
  const specific = route.module[`onRequest${normalized[0]}${normalized.slice(1).toLowerCase()}`];
  if (typeof specific === 'function') return specific;
  return typeof route.module.onRequest === 'function' ? route.module.onRequest : null;
}

/** The methods that have an onRequest<Method> handler in the route's file, for an Allow header. */
export function allowedMethods(route) {
  return Object.keys(route.module)
    .filter((name) => /^onRequest[A-Z][a-z]+$/.test(name) && typeof route.module[name] === 'function')
    .map((name) => name.slice('onRequest'.length).toUpperCase());
}

// Every route file under functions/, as sorted relative paths with "/" separators.
async function listRouteFiles(root, relativeDir = '') {
  let entries;
  try {
    entries = await readdir(join(root, relativeDir), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' && relativeDir === '') return [];
    throw error;
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('_')) continue;
    const relative = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listRouteFiles(root, relative)));
    else if (entry.isFile() && ROUTE_FILE.test(entry.name)) files.push(relative);
  }
  return files;
}

function segmentsOf(file) {
  const parts = file.replace(ROUTE_FILE, '').split('/');
  if (parts.at(-1) === 'index') parts.pop();
  return parts.map((part, position) => {
    const catchAll = /^\[\[([^[\]]+)\]\]$/.exec(part);
    if (catchAll) {
      if (position !== parts.length - 1) {
        throw new Error(`${file}: the catch-all segment ${part} must be the last one in the path.`);
      }
      return { type: 'catchall', name: catchAll[1] };
    }
    const param = /^\[([^[\]]+)\]$/.exec(part);
    if (param) return { type: 'param', name: param[1] };
    return { type: 'static', value: part };
  });
}

function patternOf(segments) {
  const shown = segments.map((segment) => {
    if (segment.type === 'static') return segment.value;
    return segment.type === 'param' ? `[${segment.name}]` : `[[${segment.name}]]`;
  });
  return `/${shown.join('/')}`;
}

function compareRoutes(a, b) {
  const length = Math.max(a.segments.length, b.segments.length);
  for (let position = 0; position < length; position += 1) {
    const rankA = RANK[a.segments[position]?.type] ?? 0;
    const rankB = RANK[b.segments[position]?.type] ?? 0;
    if (rankA !== rankB) return rankA - rankB;
  }
  // Two files with the same shape: keep the order stable.
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
}

// "/a/b/" -> ["a", "b"], "/" -> []. An empty segment ("//") is not routable, so null.
function splitPathname(pathname) {
  if (pathname.includes('//')) return null;
  let rest = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  if (rest.endsWith('/')) rest = rest.slice(0, -1);
  return rest === '' ? [] : rest.split('/').map(decodeSegment);
}

// A malformed escape such as "%zz" stays as typed; the function then decides what to do with it.
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function matchSegments(patternSegments, parts) {
  const params = {};
  for (let position = 0; position < patternSegments.length; position += 1) {
    const segment = patternSegments[position];
    if (segment.type === 'catchall') {
      // It is the last pattern segment (checked in segmentsOf), so it takes whatever is left.
      params[segment.name] = parts.slice(position);
      return params;
    }
    if (position >= parts.length) return null;
    if (segment.type === 'static') {
      if (segment.value !== parts[position]) return null;
    } else {
      params[segment.name] = parts[position];
    }
  }
  return parts.length === patternSegments.length ? params : null;
}
