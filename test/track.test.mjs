import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildRouteTable } from '../dev/routes.mjs';
import { dispatch } from '../dev/server.mjs';
import { ensureSchema, getClickStats } from '../functions/_lib/db.js';
import { CLICK_KINDS } from '../functions/_lib/fields.js';
import { onRequestPost } from '../functions/api/track.js';
import { call, makeEnv } from './helpers.mjs';

const SITE = 'https://cinar.test';
const REFUSED = 'İstek reddedildi. Sayfayı yenileyip tekrar dene.';
const UNREADABLE = 'İstek okunamadı.';
const MINUTE = 60 * 1000;

// A new env with the schema in place, removed after the test. The rate limit is kept per IP inside the
// module, and a test file shares one module: every test that counts uses an IP of its own.
async function freshEnv(t) {
  const { env, cleanup } = makeEnv();
  t.after(cleanup);
  await ensureSchema(env.DB);
  return env;
}

// Stops the clock at `iso`. The limiter and the Istanbul day both read Date.now().
const freezeClock = (t, iso = '2026-11-03T12:00:00Z') => t.mock.timers.enable({ apis: ['Date'], now: Date.parse(iso) });

const beacon = (kind) => JSON.stringify({ kind });

// A beacon as the site's script sends it: a POST with the site's own Origin. `body` goes out as it is,
// and sendBeacon posts text/plain.
function track(env, body, { ip, origin = SITE, headers = {}, base = SITE } = {}) {
  const sent = { 'Content-Type': 'text/plain;charset=UTF-8', ...headers };
  if (origin !== null) sent.Origin = origin;
  if (ip !== undefined) sent['CF-Connecting-IP'] = ip;
  return call(onRequestPost, { method: 'POST', url: `${base}/api/track`, headers: sent, body, env });
}

async function clicks(env) {
  const { results } = await env.DB.prepare('SELECT day, kind, count FROM clicks ORDER BY day, kind').all();
  return results;
}

const totalOf = async (env) => Object.values(await getClickStats(env.DB, '2000-01-01')).reduce((sum, count) => sum + count, 0);

async function assertError(response, status, message, label = message) {
  assert.equal(response.status, status, label);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8', label);
  assert.deepEqual(await response.json(), { message }, label);
}

test('a beacon is 204 with no body and counts one click for today, whatever Content-Type it is posted with', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const response = await track(env, beacon('whatsapp'), { ip: '198.51.100.1' });
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.deepEqual(await clicks(env), [{ day: '2026-11-03', kind: 'whatsapp', count: 1 }]);

  await track(env, beacon('whatsapp'), { ip: '198.51.100.1', headers: { 'Content-Type': 'application/json' } });
  await track(env, beacon('whatsapp'), { ip: '198.51.100.1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.deepEqual(await clicks(env), [{ day: '2026-11-03', kind: 'whatsapp', count: 3 }]);
});

test('every kind the site counts is counted under its own name', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  for (const kind of CLICK_KINDS) await track(env, beacon(kind), { ip: '198.51.100.2' });
  await track(env, beacon('call'), { ip: '198.51.100.2' });
  assert.deepEqual(await getClickStats(env.DB, '2026-11-03'), { whatsapp: 1, call: 2, directions: 1, form: 1, instagram: 1 });
});

test('the day is the one in Istanbul: it turns at 21:00 UTC', async (t) => {
  freezeClock(t, '2026-11-03T20:59:59Z');
  const env = await freshEnv(t);
  await track(env, beacon('call'), { ip: '198.51.100.3' });
  t.mock.timers.tick(1000);
  await track(env, beacon('call'), { ip: '198.51.100.3' });
  assert.deepEqual(await clicks(env), [
    { day: '2026-11-03', kind: 'call', count: 1 },
    { day: '2026-11-04', kind: 'call', count: 1 },
  ]);
});

// ---------------------------------------------------------------------------------------------
// Who may count: the site's own pages
// ---------------------------------------------------------------------------------------------

test('a foreign Origin, or none and no Referer from the site, is 403 with the admin API’s message, and nothing is counted', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const ip = '198.51.100.4';
  const refused = [
    ['a foreign Origin', { origin: 'https://evil.test' }],
    ['Origin: null', { origin: 'null' }],
    ['http instead of https', { origin: 'http://cinar.test' }],
    ['another port', { origin: 'https://cinar.test:8443' }],
    ['a longer host name', { origin: 'https://cinar.test.evil.test' }],
    ['no Origin and no Referer', { origin: null }],
    ['no Origin, a foreign Referer', { origin: null, headers: { Referer: 'https://evil.test/https://cinar.test/' } }],
    ['no Origin, a Referer with a longer host name', { origin: null, headers: { Referer: 'https://cinar.test.evil.test/' } }],
    ['no Origin, a Referer that is not an address', { origin: null, headers: { Referer: 'not an address' } }],
    ['no Origin, an empty Referer', { origin: null, headers: { Referer: '' } }],
    ['a foreign Origin, whatever the Referer says', { origin: 'https://evil.test', headers: { Referer: `${SITE}/` } }],
  ];
  for (const [label, options] of refused) {
    await assertError(await track(env, beacon('whatsapp'), { ip, ...options }), 403, REFUSED, label);
  }
  assert.deepEqual(await clicks(env), []);
});

test('the Referer of the site counts when the browser sent no Origin; the Origin decides when there is one', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const ip = '198.51.100.5';
  for (const referer of [`${SITE}/`, `${SITE}/index.html?utm=1#iletisim`, `${SITE}/#randevu`]) {
    const response = await track(env, beacon('form'), { ip, origin: null, headers: { Referer: referer } });
    assert.equal(response.status, 204, referer);
  }
  assert.equal((await track(env, beacon('form'), { ip, headers: { Referer: 'https://evil.test/' } })).status, 204, 'the Origin is the site’s, so the Referer is not looked at');
  assert.equal(await totalOf(env), 4);
});

test('the origin is the request’s own: a site on another host counts for itself, and only for itself', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const base = 'http://192.168.1.20:8788';
  assert.equal((await track(env, beacon('call'), { ip: '198.51.100.6', base, origin: base })).status, 204);
  assert.equal((await track(env, beacon('call'), { ip: '198.51.100.6', base, origin: SITE })).status, 403);
  assert.equal(await totalOf(env), 1);
});

// ---------------------------------------------------------------------------------------------
// What a beacon may say
// ---------------------------------------------------------------------------------------------

test('a body that is not JSON, or has no known kind, is 400 "İstek okunamadı." and nothing is counted', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const bad = [
    '{', 'whatsapp', 'kind=whatsapp', '{"kind":"whatsapp"', '{"kind": whatsapp}',
    '{}', '{"kind":""}', '{"kind":"email"}', '{"kind":"WHATSAPP"}', '{"kind":" call"}', '{"kind":"__proto__"}', '{"kind":"constructor"}', '{"kind":"toString"}',
    '{"kind":1}', '{"kind":null}', '{"kind":true}', '{"kind":["call"]}', '{"kind":{"kind":"call"}}',
    '[]', '["call"]', '"call"', '5', 'null', 'true',
  ];
  for (const body of bad) await assertError(await track(env, body, { ip: '198.51.100.7' }), 400, UNREADABLE, body);

  const notUtf8 = await track(env, new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]), { ip: '198.51.100.7' });
  await assertError(notUtf8, 400, UNREADABLE, 'bytes that are not UTF-8');
  assert.deepEqual(await clicks(env), []);
});

test('other keys in the body do no harm; the kind is the only thing that is read', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  assert.equal((await track(env, JSON.stringify({ kind: 'directions', day: '1999-01-01', count: 1000 }), { ip: '198.51.100.8' })).status, 204);
  assert.deepEqual(await clicks(env), [{ day: '2026-11-03', kind: 'directions', count: 1 }]);
});

test('the body may have 1024 bytes; one more is 413 "İstek çok büyük." and nothing is counted', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const padded = (size) => {
    const base = JSON.stringify({ kind: 'instagram', pad: '' });
    return JSON.stringify({ kind: 'instagram', pad: 'x'.repeat(size - base.length) });
  };
  assert.equal(new TextEncoder().encode(padded(1024)).length, 1024);
  assert.equal((await track(env, padded(1024), { ip: '198.51.100.9' })).status, 204);
  await assertError(await track(env, padded(1025), { ip: '198.51.100.9' }), 413, 'İstek çok büyük.');
  await assertError(await track(env, padded(1025), { ip: '198.51.100.9', headers: { 'Content-Length': '1025' } }), 413, 'İstek çok büyük.', 'by Content-Length alone');
  assert.equal(await totalOf(env), 1);
});

test('a request without a body is 204 and counts nothing (spec §8), and so is one that says its body is empty', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const none = await call(onRequestPost, { method: 'POST', url: `${SITE}/api/track`, headers: { Origin: SITE, 'CF-Connecting-IP': '198.51.100.10' }, env });
  assert.equal(none.status, 204);
  assert.equal(await none.text(), '');
  const empty = await track(env, '', { ip: '198.51.100.10', headers: { 'Content-Length': '0' } });
  assert.equal(empty.status, 204);
  assert.deepEqual(await clicks(env), []);
});

test('it still has to come from the site: an empty body from elsewhere is 403, not 204', async (t) => {
  const env = await freshEnv(t);
  const response = await call(onRequestPost, { method: 'POST', url: `${SITE}/api/track`, headers: { Origin: 'https://evil.test' }, env });
  await assertError(response, 403, REFUSED);
});

// ---------------------------------------------------------------------------------------------
// The limit: 30 counts per IP per minute
// ---------------------------------------------------------------------------------------------

test('the 31st count from one IP within a minute is ignored: still 204, not counted; another IP is not affected', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const ip = '198.51.100.11';
  for (let count = 1; count <= 31; count += 1) assert.equal((await track(env, beacon('whatsapp'), { ip })).status, 204, `request ${count}`);
  assert.equal(await totalOf(env), 30);
  assert.equal((await track(env, beacon('call'), { ip })).status, 204);
  assert.equal(await totalOf(env), 30, 'another kind from the same IP is ignored too');

  assert.equal((await track(env, beacon('whatsapp'), { ip: '198.51.100.12' })).status, 204);
  assert.equal(await totalOf(env), 31);
});

test('a minute after its first count an IP counts again', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const ip = '198.51.100.13';
  for (let count = 0; count < 31; count += 1) await track(env, beacon('form'), { ip });
  t.mock.timers.tick(MINUTE - 1);
  await track(env, beacon('form'), { ip });
  assert.equal(await totalOf(env), 30, 'one millisecond before the minute is over');
  t.mock.timers.tick(1);
  await track(env, beacon('form'), { ip });
  assert.equal(await totalOf(env), 31);
});

test('only the beacons that count use up the limit: a refused, a broken and an empty one do not', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const ip = '198.51.100.14';
  for (let count = 0; count < 29; count += 1) await track(env, beacon('instagram'), { ip });
  for (let count = 0; count < 10; count += 1) {
    await track(env, '{', { ip });
    await track(env, beacon('instagram'), { ip, origin: 'https://evil.test' });
    await track(env, '', { ip, headers: { 'Content-Length': '0' } });
  }
  assert.equal((await track(env, beacon('instagram'), { ip })).status, 204);
  assert.equal(await totalOf(env), 30, 'the 30th still counts');
  await track(env, beacon('instagram'), { ip });
  assert.equal(await totalOf(env), 30, 'the 31st does not');
});

// ---------------------------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------------------------

test('the beacon makes the schema itself when it is the first request there is', async (t) => {
  freezeClock(t);
  const { env, cleanup } = makeEnv();
  t.after(cleanup);
  assert.equal((await track(env, beacon('call'), { ip: '198.51.100.15' })).status, 204);
  assert.deepEqual(await clicks(env), [{ day: '2026-11-03', kind: 'call', count: 1 }]);
});

test('once the schema is in place a beacon is one statement for D1, the count itself', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const real = env.DB;
  const statements = [];
  env.DB = {
    ...real,
    prepare(sql) {
      statements.push(sql);
      return real.prepare(sql);
    },
  };
  await ensureSchema(env.DB); // this wrapper is a new object, so its schema is set up first
  statements.length = 0;

  await track(env, beacon('call'), { ip: '198.51.100.16' });
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^\s*INSERT INTO clicks\b/);
});

test('a missing DB binding, or a D1 that fails, is still 204: the count is lost and the reason is logged', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const logged = t.mock.method(console, 'error', () => {});

  const noDb = await track({ ...env, DB: undefined }, beacon('call'), { ip: '198.51.100.17' });
  assert.equal(noDb.status, 204);
  assert.equal(logged.mock.callCount(), 1);
  assert.match(logged.mock.calls[0].arguments.map(String).join(' '), /DB/);

  const real = env.DB;
  const broken = {
    ...real,
    prepare(sql) {
      if (/^\s*INSERT\s+INTO\s+clicks\b/i.test(sql)) throw new Error('D1 kapalı');
      return real.prepare(sql);
    },
  };
  const failed = await track({ ...env, DB: broken }, beacon('call'), { ip: '198.51.100.17' });
  assert.equal(failed.status, 204);
  assert.equal(await failed.text(), '');
  assert.equal(logged.mock.callCount(), 2);
  assert.match(logged.mock.calls[1].arguments.map(String).join(' '), /D1 kapalı/);
  assert.deepEqual(await clicks(env), []);
});

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

test('functions/api/track.js is POST /api/track in the emulator, and takes no other method', async (t) => {
  freezeClock(t);
  const env = await freshEnv(t);
  const table = await buildRouteTable(fileURLToPath(new URL('../functions', import.meta.url)));
  const send = (method, headers = {}, body) => dispatch(new Request('http://127.0.0.1:8788/api/track', { method, headers, body }), { table, env, assets: env.ASSETS });

  const counted = await send('POST', { Origin: 'http://127.0.0.1:8788', 'CF-Connecting-IP': '198.51.100.18' }, beacon('directions'));
  assert.equal(counted.status, 204);
  assert.deepEqual(await clicks(env), [{ day: '2026-11-03', kind: 'directions', count: 1 }]);

  const get = await send('GET');
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST');
});
