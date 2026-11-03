// The admin API, /api/admin/*: the table of routes and the checks every request passes first.
//
// In this order:
// 1. The Origin, the CSRF check (auth.js): 403.
// 2. The setup: DB, IMAGES and APP_SECRET. 503, naming what is missing.
// 3. The schema: ensureSchema creates and seeds it on the first request.
// 4. The route: a path no route has is 404; a path that routes have, but not with this method, is
//    405 with an Allow header.
// 5. The session, for the routes that need one: 401.
// 6. The handler. An HttpError it throws becomes its status and message; anything else is logged
//    and answered with a 500.
// Every answer is JSON, and an error is { message } in Turkish (spec §8).
import { isSameOrigin, requireSession, setupProblems } from '../auth.js';
import { ensureSchema } from '../db.js';
import { HttpError, errorJson, json } from '../http.js';
import { changePassword, login, logout, state } from './auth-handlers.js';

const PREFIX = '/api/admin/';

/**
 * The routes. A path is a list of segments; one that starts with ':' is a parameter, whose value the
 * handler finds in ctx.params (in the order of the path). A handler takes
 * ctx = { request, env, db, params, now } and returns a Response, or throws an HttpError.
 */
const ROUTES = [
  { method: 'POST', path: ['login'], auth: false, handler: login },
  { method: 'POST', path: ['logout'], auth: false, handler: logout },
  { method: 'GET', path: ['state'], auth: true, handler: state },
  { method: 'POST', path: ['password'], auth: true, handler: changePassword },
];

/** Answers a request to /api/admin/*. The route comes from the URL: context.params is not used. */
export async function handleAdmin({ request, env }) {
  try {
    if (!isSameOrigin(request)) return errorJson(403, 'İstek reddedildi. Sayfayı yenileyip tekrar dene.');
    const problems = setupProblems(env);
    if (problems.length > 0) return errorJson(503, `Kurulum eksik: ${problems.join(', ')}.`);
    const db = env.DB;
    await ensureSchema(db);

    const segments = pathSegments(request.url);
    const match = segments === null ? null : matchRoute(ROUTES, request.method, segments);
    if (match === null) return errorJson(404, 'Bulunamadı.');
    if (match.route === null) {
      return json({ message: 'Bu istek desteklenmiyor.' }, { status: 405, headers: { Allow: match.allowed.join(', ') } });
    }
    const { route, params } = match;
    if (route.auth && !(await requireSession(request, env, db))) return errorJson(401, 'Oturum kapandı. Tekrar giriş yap.');
    return await route.handler({ request, env, db, params, now: Date.now() });
  } catch (error) {
    if (error instanceof HttpError) return errorJson(error.status, error.message);
    console.error(`admin API: ${request.method} ${new URL(request.url).pathname} failed`, error);
    return errorJson(500, 'Beklenmeyen bir hata oldu. Tekrar dene.');
  }
}

/**
 * The route for `method` and the path `segments`:
 * - { route, params } when a route fits;
 * - { route: null, allowed } when routes have this path but none has this method (405);
 * - null when no route has this path (404).
 * Where several routes fit, a static segment beats a parameter, compared from the left, whatever
 * their order in the table: PUT photos/order wins over PUT photos/:id.
 */
export function matchRoute(routes, method, segments) {
  const fits = routes
    .map((route) => ({ route, params: paramsOf(route.path, segments) }))
    .filter(({ params }) => params !== null)
    .sort((a, b) => compareSpecificity(a.route.path, b.route.path));
  if (fits.length === 0) return null;
  return fits.find(({ route }) => route.method === method) ?? { route: null, allowed: [...new Set(fits.map(({ route }) => route.method))] };
}

// The parameters that `pattern` takes from `segments`, or null when it does not fit. A parameter is
// never empty.
function paramsOf(pattern, segments) {
  if (pattern.length !== segments.length) return null;
  const params = [];
  for (const [index, part] of pattern.entries()) {
    const segment = segments[index];
    if (part.startsWith(':')) {
      if (segment === '') return null;
      params.push(segment);
    } else if (part !== segment) {
      return null;
    }
  }
  return params;
}

// Below 0 when pattern `a` is the more specific. Both fit the same path, so they are equally long.
function compareSpecificity(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    const difference = Number(a[index].startsWith(':')) - Number(b[index].startsWith(':'));
    if (difference !== 0) return difference;
  }
  return 0;
}

// The decoded segments of the path after /api/admin/ ('/api/admin/photos/a%20b' gives ['photos',
// 'a b']), or null for a path outside it or with a broken %-escape. Each segment is decoded on its
// own, so an escaped '/' stays inside its segment, as in the params.path Pages would give.
function pathSegments(url) {
  const { pathname } = new URL(url);
  if (!pathname.startsWith(PREFIX)) return null;
  try {
    return pathname.slice(PREFIX.length).split('/').map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}
