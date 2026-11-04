import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRoute } from '../functions/_lib/admin/router.js';
import { createSessionToken, hashPassword } from '../functions/_lib/auth.js';
import { countRecentFailures, ensureSchema, getAuth, insertPhoto, recordFailure, replacePrices, updateSettings } from '../functions/_lib/db.js';
import { DEFAULT_SERVICES, DEFAULT_SETTINGS, SEED_REVIEWS } from '../functions/_lib/defaults.js';
import { SETTINGS_FIELDS, SETTINGS_GROUPS } from '../functions/_lib/fields.js';
import { onRequest } from '../functions/api/admin/[[path]].js';
import { call, loginCookie, makeEnv } from './helpers.mjs';

const SITE = 'https://cinar.test';
const PASSWORD = 'test-sifre-123'; // makeEnv's ADMIN_PASSWORD
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const REFUSED = 'İstek reddedildi. Sayfayı yenileyip tekrar dene.';
const SIGNED_OUT = 'Oturum kapandı. Tekrar giriş yap.';
const TOO_MANY = 'Çok fazla deneme yaptın. 15 dakika sonra tekrar dene.';

// A new env for this test, removed after it. Every call() comes from the IP 'unknown', so a test that
// records failed logins must not share its env with another.
function freshEnv(t, options) {
  const { env, cleanup } = makeEnv(options);
  t.after(cleanup);
  return env;
}

// A request to /api/admin/<path> through the Pages entry point. A request that changes data carries
// the site's own Origin, as the panel's do, and a GET carries none, as a browser's same-origin GET
// does; `origin` overrides that (null: no Origin header). `json` is sent as the body.
function api(env, method, path, { json, body, cookie, origin, ip, base = SITE } = {}) {
  const headers = {};
  const sentOrigin = origin === undefined ? (method === 'GET' ? null : base) : origin;
  if (sentOrigin !== null) headers.Origin = sentOrigin;
  if (cookie !== undefined) headers.Cookie = cookie;
  if (ip !== undefined) headers['CF-Connecting-IP'] = ip;
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  return call(onRequest, { method, url: `${base}/api/admin/${path}`, headers, body: json === undefined ? body : JSON.stringify(json), env });
}

const login = (env, password, options) => api(env, 'POST', 'login', { json: { password }, ...options });
const changePassword = (env, cookie, current, next) => api(env, 'POST', 'password', { cookie, json: { current, next } });

// A Set-Cookie header as a browser reads it: { name, value, attributes }, attribute names in lower case.
function parseSetCookie(header) {
  const [pair, ...rest] = header.split(';').map((part) => part.trim());
  const eq = pair.indexOf('=');
  const attributes = {};
  for (const attribute of rest) {
    const [key, ...value] = attribute.split('=');
    attributes[key.toLowerCase()] = value.length === 0 ? true : value.join('=');
  }
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1), attributes };
}

// The one cookie a response sets.
function setCookieOf(response) {
  const cookies = response.headers.getSetCookie();
  assert.equal(cookies.length, 1, `one Set-Cookie, got ${JSON.stringify(cookies)}`);
  return parseSetCookie(cookies[0]);
}

const cookieHeaderOf = (response) => `cinar_admin=${setCookieOf(response).value}`;

async function assertError(response, status, message, label = message) {
  assert.equal(response.status, status, label);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8', label);
  assert.deepEqual(await response.json(), { message }, label);
}

// Sends `count` requests at once (send(i) makes the i-th) and counts the answers by status. Every
// answer must be one of the errors in `expected`, { status: message }.
async function sendAtOnce(count, send, expected) {
  const responses = await Promise.all(Array.from({ length: count }, (_, i) => send(i)));
  const tally = Object.fromEntries(Object.keys(expected).map((status) => [status, 0]));
  for (const response of responses) {
    assert.ok(Object.hasOwn(expected, response.status), `unexpected status ${response.status}`);
    await assertError(response, response.status, expected[response.status]);
    tally[response.status] += 1;
  }
  return tally;
}

// ---------------------------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------------------------

test('login: a wrong password is 401 "Şifre yanlış."; the right one is 200 with a 30-day, HttpOnly, SameSite=Strict, Secure cookie for /api/admin', async (t) => {
  const env = freshEnv(t);
  const wrong = await login(env, 'yanlis-sifre');
  await assertError(wrong, 401, 'Şifre yanlış.');
  assert.deepEqual(wrong.headers.getSetCookie(), []);

  const right = await login(env, PASSWORD);
  assert.equal(right.status, 200);
  assert.deepEqual(await right.json(), { ok: true });
  const cookie = setCookieOf(right);
  assert.equal(cookie.name, 'cinar_admin');
  assert.match(cookie.value, /^v1\.\d+\.1\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(cookie.attributes, { path: '/api/admin', httponly: true, samesite: 'Strict', secure: true });
});

test('login over plain http: no Secure with DEV_INSECURE_COOKIES=1 (the emulator), Secure without it (the live site)', async (t) => {
  const dev = await login(freshEnv(t), PASSWORD, { base: 'http://192.168.1.20:8788' });
  assert.equal(dev.status, 200);
  assert.equal(setCookieOf(dev).attributes.secure, undefined);

  const live = await login(freshEnv(t, { vars: { DEV_INSECURE_COOKIES: undefined } }), PASSWORD, { base: 'http://cinar.test' });
  assert.equal(live.status, 200);
  assert.equal(setCookieOf(live).attributes.secure, true);
});

test('login: an empty or missing password is 400 "Şifreyi yaz." and is not a failed attempt', async (t) => {
  const env = freshEnv(t);
  for (const json of [{ password: '' }, {}, { password: null }]) {
    await assertError(await api(env, 'POST', 'login', { json }), 400, 'Şifreyi yaz.', JSON.stringify(json));
  }
  assert.equal(await countRecentFailures(env.DB, 'unknown', 0), 0);
});

test('login: a body that is not a JSON object, or a password that is not text, is 400 "İstek okunamadı."; a huge one is 413', async (t) => {
  const env = freshEnv(t);
  for (const body of ['password=test-sifre-123', '', '["test-sifre-123"]', '"test-sifre-123"', '{"password":123}', '{"password":["x"]}']) {
    await assertError(await api(env, 'POST', 'login', { body }), 400, 'İstek okunamadı.', body);
  }
  await assertError(await login(env, 'x'.repeat(70000)), 413, 'İstek çok büyük.');
  assert.equal(await countRecentFailures(env.DB, 'unknown', 0), 0);
});

test('login: after 5 failed attempts from one IP the 6th is 429, even with the right password; other IPs are not affected', async (t) => {
  const env = freshEnv(t);
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await assertError(await login(env, `yanlis-${attempt}`), 401, 'Şifre yanlış.', `attempt ${attempt}`);
  }
  await assertError(await login(env, PASSWORD), 429, TOO_MANY);
  await assertError(await login(env, 'yanlis-6'), 429, TOO_MANY);
  assert.equal(await countRecentFailures(env.DB, 'unknown', 0), 5, 'a refused attempt is not counted again');

  assert.equal((await login(env, PASSWORD, { ip: '203.0.113.9' })).status, 200, 'another IP');
  await assertError(await login(env, 'yanlis', { ip: '203.0.113.10' }), 401, 'Şifre yanlış.');
  assert.equal(await countRecentFailures(env.DB, '203.0.113.10', 0), 1, 'failures are kept per CF-Connecting-IP');
});

test('login: of 10 wrong passwords sent at once from one IP, at most 5 are checked (401) and the rest are 429; the right password is 429 after them', async (t) => {
  const env = freshEnv(t);
  const tally = await sendAtOnce(10, (i) => login(env, `yanlis-${i}`), { 401: 'Şifre yanlış.', 429: TOO_MANY });
  assert.ok(tally[401] <= 5, `${tally[401]} of 10 were checked`);
  await assertError(await login(env, PASSWORD), 429, TOO_MANY, 'the right password after them');
});

test('login: failures already recorded and attempts sent at once add up: after 4, at most 1 of 2 more is checked', async (t) => {
  const env = freshEnv(t);
  for (let i = 0; i < 4; i += 1) await assertError(await login(env, 'yanlis'), 401, 'Şifre yanlış.');
  const tally = await sendAtOnce(2, (i) => login(env, `yanlis-${i}`), { 401: 'Şifre yanlış.', 429: TOO_MANY });
  assert.ok(tally[401] <= 1, `${tally[401]} of 2 were checked after 4 failures`);
  await assertError(await login(env, PASSWORD), 429, TOO_MANY, 'the right password after them');
});

test('login: only the failures of the last 15 minutes count', async (t) => {
  const old = freshEnv(t);
  await ensureSchema(old.DB);
  for (let i = 0; i < 5; i += 1) await recordFailure(old.DB, 'unknown', Date.now() - 15 * MINUTE - 5000);
  assert.equal((await login(old, PASSWORD)).status, 200, '5 failures older than 15 minutes');

  const recent = freshEnv(t);
  await ensureSchema(recent.DB);
  for (let i = 0; i < 5; i += 1) await recordFailure(recent.DB, 'unknown', Date.now() - 14 * MINUTE);
  await assertError(await login(recent, PASSWORD), 429, TOO_MANY, '5 failures within 15 minutes');
});

test('login: a good login forgets the failures of that IP', async (t) => {
  const env = freshEnv(t);
  for (let i = 0; i < 4; i += 1) await login(env, 'yanlis');
  assert.equal((await login(env, PASSWORD)).status, 200);
  for (let i = 0; i < 4; i += 1) await login(env, 'yanlis');
  assert.equal((await login(env, PASSWORD)).status, 200, '4 failures since the last good login, not 8');
});

test('login without a stored password and without ADMIN_PASSWORD is 503, lets nobody in and is not a failed attempt', async (t) => {
  for (const ADMIN_PASSWORD of [undefined, '']) {
    const env = freshEnv(t, { vars: { ADMIN_PASSWORD } });
    for (const password of ['x', 'undefined']) {
      await assertError(await login(env, password), 503, 'Kurulum eksik: ADMIN_PASSWORD tanımlı değil.', `${ADMIN_PASSWORD} / ${password}`);
    }
    assert.equal(await countRecentFailures(env.DB, 'unknown', 0), 0, `${ADMIN_PASSWORD}: no failure recorded`);
  }
});

test('loginCookie logs in as the panel does and gives the Cookie header value; a failed login throws', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  assert.match(cookie, /^cinar_admin=v1\.\d+\.1\.[A-Za-z0-9_-]{43}$/);
  assert.equal((await api(env, 'GET', 'state', { cookie })).status, 200);
  await assert.rejects(loginCookie(env, 'yanlis'), /401/);
});

// ---------------------------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------------------------

test('logout clears the session cookie, with or without a session, but only from the site itself', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  for (const options of [{ cookie }, {}]) {
    const response = await api(env, 'POST', 'logout', options);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(setCookieOf(response), {
      name: 'cinar_admin',
      value: '',
      attributes: { path: '/api/admin', 'max-age': '0', httponly: true, samesite: 'Strict', secure: true },
    });
  }
  const insecure = await api(env, 'POST', 'logout', { base: 'http://127.0.0.1:8788' });
  assert.equal(setCookieOf(insecure).attributes.secure, undefined, 'the emulator over http');
  await assertError(await api(env, 'POST', 'logout', { origin: null }), 403, REFUSED);
});

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

test('state: 401 without a session cookie; 200 with one, with the default texts', async (t) => {
  const env = freshEnv(t);
  await assertError(await api(env, 'GET', 'state'), 401, SIGNED_OUT);
  const response = await api(env, 'GET', 'state', { cookie: await loginCookie(env) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settings.hero_title, DEFAULT_SETTINGS.hero_title);
});

test('state holds everything the panel shows and edits, every photo and the hero with their image URLs', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  const key = 'b'.repeat(20);
  await insertPhoto(env.DB, { id: 'a'.repeat(20), caption: 'Yeni iş', category: 'piercing', image_key: key, width: 1600, height: 1200, created_at: 5 });
  await replacePrices(env.DB, [{ title: 'Dövme', items: [{ name: 'Minimal yazı', detail: '', price: 'Teklif al' }] }]);

  const response = await api(env, 'GET', 'state', { cookie });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const state = await response.json();
  assert.deepEqual(Object.keys(state).sort(), ['categories', 'fields', 'groups', 'hero', 'limits', 'photos', 'prices', 'reviewSources', 'reviews', 'services', 'settings']);
  assert.deepEqual(state.hero, { source: 'seed', seed_path: 'logo', width: 1254, height: 1254, full: '/seed/logo-full.jpg', thumb: '/seed/logo-thumb.jpg' });
  assert.equal(state.photos.length, 32);
  assert.deepEqual(state.photos[0], {
    id: 'a'.repeat(20),
    caption: 'Yeni iş',
    category: 'piercing',
    position: -1,
    source: 'kv',
    seed_path: null,
    image_key: key,
    width: 1600,
    height: 1200,
    created_at: 5,
    full: `/img/${key}/full`,
    thumb: `/img/${key}/thumb`,
  });
  assert.deepEqual(state.photos[1], {
    id: 'seed-gecici-06',
    caption: 'Chicano kol',
    category: 'gecici',
    position: 0,
    source: 'seed',
    seed_path: 'gecici-06',
    image_key: null,
    width: 474,
    height: 790,
    created_at: 0,
    full: '/seed/gecici-06-full.jpg',
    thumb: '/seed/gecici-06-thumb.jpg',
  });
  assert.deepEqual(state.services, DEFAULT_SERVICES);
  assert.deepEqual(state.prices, [{ id: 1, title: 'Dövme', items: [{ id: 1, name: 'Minimal yazı', detail: '', price: 'Teklif al' }] }]);
  assert.equal(state.reviews.length, 13);
  assert.deepEqual(state.reviews[0], { id: 1, ...SEED_REVIEWS[0] });
  assert.deepEqual(state.fields, SETTINGS_FIELDS);
  assert.deepEqual(state.groups, SETTINGS_GROUPS);
  assert.deepEqual(state.categories, [
    { value: 'dovme', label: 'Kalıcı dövme' },
    { value: 'gecici', label: 'Geçici dövme' },
    { value: 'piercing', label: 'Piercing' },
    { value: 'kulak', label: 'Kulak delme' },
    { value: 'diger', label: 'Diğer' },
  ]);
  assert.deepEqual(state.reviewSources, [
    { value: 'google', label: 'Google' },
    { value: 'instagram', label: 'Instagram' },
    { value: 'diger', label: 'Diğer' },
  ]);
  assert.deepEqual(state.limits, {
    maxPhotos: 400,
    captionMax: 120,
    maxServices: 12,
    serviceNameMax: 40,
    serviceDescriptionMax: 120,
    maxPriceGroups: 6,
    priceGroupTitleMax: 30,
    maxPriceItems: 12,
    priceItemNameMax: 40,
    priceItemDetailMax: 60,
    priceItemPriceMax: 24,
    maxReviews: 200,
    reviewNameMax: 40,
    reviewTextMax: 2000,
    reviewDateMax: 20,
  });
});

test('state.settings: the editable keys with what is stored, lists as arrays and the rest as text (no hero_image)', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  await updateSettings(env.DB, { hero_title: 'Yeni başlık', highlights: JSON.stringify(['Bir', 'İki']), hero_points: '[]' });
  const { settings } = await (await api(env, 'GET', 'state', { cookie })).json();

  // DEFAULT_SETTINGS has exactly the SETTINGS_FIELDS keys, every value a string.
  assert.deepEqual(settings, { ...DEFAULT_SETTINGS, hero_title: 'Yeni başlık', highlights: ['Bir', 'İki'], hero_points: [] });
});

// ---------------------------------------------------------------------------------------------
// The CSRF check
// ---------------------------------------------------------------------------------------------

test('a POST without Origin, or with a foreign one, is 403 before anything else happens', async (t) => {
  const env = freshEnv(t);
  await ensureSchema(env.DB);
  for (const origin of [null, 'https://evil.test', 'http://cinar.test', 'https://cinar.test:8443', 'null']) {
    const response = await login(env, PASSWORD, { origin });
    await assertError(response, 403, REFUSED, String(origin));
    assert.deepEqual(response.headers.getSetCookie(), [], 'no session');
  }
  await login(env, 'yanlis', { origin: 'https://evil.test' });
  assert.equal(await countRecentFailures(env.DB, 'unknown', 0), 0, 'a refused request is not a login attempt');
});

test('PUT, PATCH and DELETE need the site’s Origin too', async (t) => {
  const env = freshEnv(t);
  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    await assertError(await api(env, method, 'state', { origin: null }), 403, REFUSED, `${method} without Origin`);
    await assertError(await api(env, method, 'state', { origin: 'https://evil.test' }), 403, REFUSED, `${method} from elsewhere`);
    assert.equal((await api(env, method, 'state')).status, 405, `${method} with the site’s Origin gets past the check`);
  }
});

test('a GET may come without Origin, as a browser sends it, but not with a foreign one', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  assert.equal((await api(env, 'GET', 'state', { cookie })).status, 200);
  assert.equal((await api(env, 'GET', 'state', { cookie, origin: SITE })).status, 200);
  await assertError(await api(env, 'GET', 'state', { cookie, origin: 'https://evil.test' }), 403, REFUSED);
});

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

test('without APP_SECRET every route is 503 "Kurulum eksik: …" and nobody can log in; a foreign Origin is still 403 first', async (t) => {
  const env = freshEnv(t, { vars: { APP_SECRET: undefined } });
  const message = 'Kurulum eksik: APP_SECRET tanımlı değil ya da 32 karakterden kısa.';
  await assertError(await login(env, PASSWORD), 503, message, 'login');
  await assertError(await api(env, 'GET', 'state'), 503, message, 'state');
  await assertError(await api(env, 'POST', 'logout'), 503, message, 'logout');
  await assertError(await api(env, 'GET', 'nope'), 503, message, 'an unknown path');
  await assertError(await login(env, PASSWORD, { origin: 'https://evil.test' }), 403, REFUSED);
});

test('the setup check names a short APP_SECRET and every missing binding', async (t) => {
  const cases = [
    [{ APP_SECRET: 'x'.repeat(31) }, 'Kurulum eksik: APP_SECRET tanımlı değil ya da 32 karakterden kısa.'],
    [{ DB: undefined }, 'Kurulum eksik: DB bağlaması yok.'],
    [{ IMAGES: undefined }, 'Kurulum eksik: IMAGES bağlaması yok.'],
    [{ DB: undefined, IMAGES: undefined, APP_SECRET: undefined }, 'Kurulum eksik: DB bağlaması yok, IMAGES bağlaması yok, APP_SECRET tanımlı değil ya da 32 karakterden kısa.'],
  ];
  for (const [overrides, message] of cases) {
    await assertError(await login({ ...freshEnv(t), ...overrides }, PASSWORD), 503, message);
  }
});

// ---------------------------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------------------------

test('a path the API does not have is 404 "Bulunamadı.", a broken %-escape included; segments are %-decoded', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  for (const path of ['', 'nope', 'state/extra', 'STATE', 'state/', 'state%', '%E0%A4%A']) {
    await assertError(await api(env, 'GET', path, { cookie }), 404, 'Bulunamadı.', path);
  }
  await assertError(await call(onRequest, { url: `${SITE}/api/admin`, env }), 404, 'Bulunamadı.', '/api/admin itself');
  assert.equal((await api(env, 'GET', 'st%61te', { cookie })).status, 200, '%61 is "a"');
});

test('a known path with another method is 405 with an Allow header, before the session is looked at', async (t) => {
  const env = freshEnv(t);
  for (const [method, path, allow] of [['GET', 'login', 'POST'], ['GET', 'logout', 'POST'], ['POST', 'state', 'GET'], ['GET', 'password', 'POST'], ['DELETE', 'login', 'POST']]) {
    const response = await api(env, method, path);
    await assertError(response, 405, 'Bu istek desteklenmiyor.', `${method} ${path}`);
    assert.equal(response.headers.get('Allow'), allow, `${method} ${path}`);
  }
});

test('the route comes from the URL, whatever context.params says', async (t) => {
  const env = freshEnv(t);
  const response = await call(onRequest, { method: 'POST', url: `${SITE}/api/admin/logout`, params: { path: ['login'] }, headers: { Origin: SITE }, env });
  assert.equal(response.status, 200);
  assert.equal(setCookieOf(response).attributes['max-age'], '0', 'logged out, not a login attempt');
});

test('matchRoute: among the routes with this path the method decides, and a static segment beats a parameter', () => {
  const route = (method, path) => ({ method, path, auth: true, handler: () => new Response() });
  const create = route('POST', ['photos']);
  const anyPut = route('PUT', ['photos', ':id']); // listed before the static route on purpose
  const order = route('PUT', ['photos', 'order']);
  const edit = route('PATCH', ['photos', ':id']);
  const remove = route('DELETE', ['photos', ':id']);
  const replace = route('POST', ['photos', ':id', 'replace']);
  const table = [create, anyPut, order, edit, remove, replace];

  assert.deepEqual(matchRoute(table, 'POST', ['photos']), { route: create, params: [] });
  assert.deepEqual(matchRoute(table, 'PUT', ['photos', 'order']), { route: order, params: [] });
  assert.deepEqual(matchRoute(table, 'PUT', ['photos', 'abc']), { route: anyPut, params: ['abc'] });
  assert.deepEqual(matchRoute(table, 'PATCH', ['photos', 'order']), { route: edit, params: ['order'] });
  assert.deepEqual(matchRoute(table, 'DELETE', ['photos', 'a/b']), { route: remove, params: ['a/b'] });
  assert.deepEqual(matchRoute(table, 'POST', ['photos', 'seed-gecici-10', 'replace']), { route: replace, params: ['seed-gecici-10'] });
  assert.deepEqual(matchRoute(table, 'GET', ['photos', 'abc']), { route: null, allowed: ['PUT', 'PATCH', 'DELETE'] });
  assert.deepEqual(matchRoute(table, 'GET', ['photos']), { route: null, allowed: ['POST'] });
  assert.equal(matchRoute(table, 'GET', ['photos', 'abc', 'other']), null);
  assert.equal(matchRoute(table, 'PATCH', ['photos', '']), null, 'an empty segment is no parameter');
  assert.equal(matchRoute(table, 'POST', []), null);
});

test('an unexpected error is logged and answered 500 with a message the owner can act on', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  const real = env.DB;
  env.DB = {
    ...real,
    prepare(sql) {
      if (sql.startsWith('SELECT key, value FROM settings')) throw new Error('D1 kapalı');
      return real.prepare(sql);
    },
  };
  const logged = t.mock.method(console, 'error', () => {});
  await assertError(await api(env, 'GET', 'state', { cookie }), 500, 'Beklenmeyen bir hata oldu. Tekrar dene.');
  assert.equal(logged.mock.callCount(), 1);
  assert.match(logged.mock.calls[0].arguments.map(String).join(' '), /D1 kapalı/);
});

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

test('a changed, expired or foreign session token is 401; one that is 11 hours old still works', async (t) => {
  const env = freshEnv(t);
  const token = (await loginCookie(env)).slice('cinar_admin='.length);
  const [, exp, version, mac] = token.split('.');
  const now = Date.now();
  const bad = {
    'a changed signature': `v1.${exp}.${version}.${mac.slice(0, 20)}${mac[20] === 'A' ? 'B' : 'A'}${mac.slice(21)}`,
    'a longer life': `v1.${Number(exp) + 30 * 86400}.${version}.${mac}`,
    'another session version': `v1.${exp}.2.${mac}`,
    'expired a second ago': await createSessionToken(env.APP_SECRET, 1, now - DAY / 2 - 1000),
    'signed with another APP_SECRET': await createSessionToken('z'.repeat(40), 1, now),
    'not a token': 'abc',
  };
  for (const [label, value] of Object.entries(bad)) {
    await assertError(await api(env, 'GET', 'state', { cookie: `cinar_admin=${value}` }), 401, SIGNED_OUT, label);
  }
  const old = await createSessionToken(env.APP_SECRET, 1, now - 11 * DAY / 24);
  assert.equal((await api(env, 'GET', 'state', { cookie: `cinar_admin=${old}` })).status, 200);
});

// ---------------------------------------------------------------------------------------------
// Password change
// ---------------------------------------------------------------------------------------------

test('password change: the old cookie becomes 401, the new cookie works, ADMIN_PASSWORD no longer logs in and the new password does', async (t) => {
  const env = freshEnv(t);
  const oldCookie = await loginCookie(env);
  const response = await changePassword(env, oldCookie, PASSWORD, 'yeni-sifre-2026');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const fresh = setCookieOf(response);
  assert.equal(fresh.name, 'cinar_admin');
  assert.match(fresh.value, /^v1\.\d+\.2\.[A-Za-z0-9_-]{43}$/, 'it carries the new session version');
  assert.deepEqual(fresh.attributes, { path: '/api/admin', httponly: true, samesite: 'Strict', secure: true });

  await assertError(await api(env, 'GET', 'state', { cookie: oldCookie }), 401, SIGNED_OUT, 'the old cookie');
  assert.equal((await api(env, 'GET', 'state', { cookie: cookieHeaderOf(response) })).status, 200, 'the new cookie');
  await assertError(await login(env, PASSWORD), 401, 'Şifre yanlış.', 'ADMIN_PASSWORD');
  assert.equal((await login(env, 'yeni-sifre-2026')).status, 200, 'the new password');
});

test('password change stores a PBKDF2 hash with a new random salt and 10000 iterations, never the password itself', async (t) => {
  const env = freshEnv(t);
  const first = await changePassword(env, await loginCookie(env), PASSWORD, 'yeni-sifre-2026');
  const auth = await getAuth(env.DB);
  assert.equal(auth.iterations, 10000);
  assert.equal(Buffer.from(auth.salt, 'base64').length, 16);
  assert.equal(auth.hash, await hashPassword('yeni-sifre-2026', auth.salt, env.APP_SECRET, 10000));
  assert.equal(auth.session_version, 2);

  await changePassword(env, cookieHeaderOf(first), 'yeni-sifre-2026', 'yeni-sifre-2026');
  assert.notEqual((await getAuth(env.DB)).salt, auth.salt, 'every change has its own salt');
});

test('password change needs a session', async (t) => {
  const env = freshEnv(t);
  await assertError(await changePassword(env, undefined, PASSWORD, 'yeni-sifre-2026'), 401, SIGNED_OUT);
  assert.equal((await getAuth(env.DB)).hash, null);
});

test('password change: a wrong current password is 400 "Mevcut şifre yanlış." and counts as a failed attempt', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  await assertError(await changePassword(env, cookie, 'yanlis', 'yeni-sifre-2026'), 400, 'Mevcut şifre yanlış.');
  assert.equal(await countRecentFailures(env.DB, 'unknown', 0), 1);
  assert.equal((await getAuth(env.DB)).hash, null, 'nothing was changed');
});

test('password change: after 5 failures from the IP (password form and login together) it is 429, even with the right current password', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  for (let i = 0; i < 4; i += 1) await assertError(await changePassword(env, cookie, 'yanlis', 'yeni-sifre-2026'), 400, 'Mevcut şifre yanlış.');
  await login(env, 'yanlis');
  await assertError(await changePassword(env, cookie, PASSWORD, 'yeni-sifre-2026'), 429, TOO_MANY);
  assert.equal((await getAuth(env.DB)).hash, null, 'nothing was changed');
  assert.equal(await countRecentFailures(env.DB, 'unknown', 0), 5, 'a refused attempt is not counted again');
});

test('password change: of 10 wrong current passwords sent at once, at most 5 are checked and the rest are 429; nothing is changed', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  const tally = await sendAtOnce(10, (i) => changePassword(env, cookie, `yanlis-${i}`, 'yeni-sifre-2026'), { 400: 'Mevcut şifre yanlış.', 429: TOO_MANY });
  assert.ok(tally[400] <= 5, `${tally[400]} of 10 were checked`);
  await assertError(await changePassword(env, cookie, PASSWORD, 'yeni-sifre-2026'), 429, TOO_MANY, 'the right current password after them');
  assert.equal((await getAuth(env.DB)).hash, null, 'nothing was changed');
});

test('password change: a right current password forgets the failures of the IP, as a good login does, also when the new password is refused', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  for (let i = 0; i < 4; i += 1) await assertError(await changePassword(env, cookie, 'yanlis', 'yeni-sifre-2026'), 400, 'Mevcut şifre yanlış.');
  await assertError(await changePassword(env, cookie, PASSWORD, 'kisa'), 400, 'Yeni şifre en az 8 karakter olmalı.');
  assert.equal(await countRecentFailures(env.DB, 'unknown', 0), 0, 'after a refused new password');

  for (let i = 0; i < 4; i += 1) await assertError(await login(env, 'yanlis'), 401, 'Şifre yanlış.');
  assert.equal((await changePassword(env, cookie, PASSWORD, 'yeni-sifre-2026')).status, 200);
  assert.equal(await countRecentFailures(env.DB, 'unknown', 0), 0, 'after a changed password');
});

test('password change: the new password must have 8 to 128 characters', async (t) => {
  const env = freshEnv(t);
  let cookie = await loginCookie(env);
  await assertError(await changePassword(env, cookie, PASSWORD, 'x'.repeat(7)), 400, 'Yeni şifre en az 8 karakter olmalı.');
  await assertError(await changePassword(env, cookie, PASSWORD, ''), 400, 'Yeni şifre en az 8 karakter olmalı.');
  await assertError(await changePassword(env, cookie, PASSWORD, 'x'.repeat(129)), 400, 'Yeni şifre en fazla 128 karakter olabilir.');
  assert.equal((await getAuth(env.DB)).hash, null, 'nothing was changed');

  let current = PASSWORD;
  for (const next of ['a'.repeat(8), 'b'.repeat(128)]) {
    const response = await changePassword(env, cookie, current, next);
    assert.equal(response.status, 200, `${next.length} characters`);
    cookie = cookieHeaderOf(response);
    current = next;
  }
  assert.equal((await login(env, 'b'.repeat(128))).status, 200);
});

test('password change: a current or next password that is not text is 400 "İstek okunamadı."', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  for (const json of [{ current: 123, next: 'yeni-sifre-2026' }, { current: PASSWORD, next: ['yeni-sifre-2026'] }, [PASSWORD]]) {
    await assertError(await api(env, 'POST', 'password', { cookie, json }), 400, 'İstek okunamadı.', JSON.stringify(json));
  }
});

test('a second password change checks the current password against the stored hash', async (t) => {
  const env = freshEnv(t);
  const first = await changePassword(env, await loginCookie(env), PASSWORD, 'ikinci-sifre-1');
  const cookie = cookieHeaderOf(first);
  await assertError(await changePassword(env, cookie, PASSWORD, 'ucuncu-sifre-1'), 400, 'Mevcut şifre yanlış.', 'ADMIN_PASSWORD');
  assert.equal((await changePassword(env, cookie, 'ikinci-sifre-1', 'ucuncu-sifre-1')).status, 200);
  assert.equal((await getAuth(env.DB)).session_version, 3);
});

test('password change with no stored password and ADMIN_PASSWORD gone is 503, not a wrong password', async (t) => {
  const env = freshEnv(t);
  const cookie = await loginCookie(env);
  delete env.ADMIN_PASSWORD;
  await assertError(await changePassword(env, cookie, PASSWORD, 'yeni-sifre-2026'), 503, 'Kurulum eksik: ADMIN_PASSWORD tanımlı değil.');
  assert.equal(await countRecentFailures(env.DB, 'unknown', 0), 0);
});
