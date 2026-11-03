import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, pbkdf2Sync } from 'node:crypto';
import { createD1 } from '../dev/d1.mjs';
import {
  clientIp,
  cookieSecure,
  createSessionToken,
  hashPassword,
  isSameOrigin,
  newSalt,
  readCookie,
  requireSession,
  setupProblems,
  verifyPassword,
  verifySessionToken,
} from '../functions/_lib/auth.js';
import { ensureSchema, setPassword } from '../functions/_lib/db.js';

const SECRET = 'k'.repeat(40);
const SITE = 'https://cinar.test';
// A whole second, so that "30 days later" is an exact number of milliseconds.
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const SALT = 'AAECAwQFBgcICQoLDA0ODw=='; // the bytes 0 to 15

// The algorithms of the plan written again with node:crypto, so the Web Crypto code is checked
// against an implementation that shares none of its code.
function referenceHash(password, saltB64, secret, iterations) {
  const pepper = createHmac('sha256', secret).update('pepper').digest();
  const prehash = createHmac('sha256', pepper).update(password).digest();
  return pbkdf2Sync(prehash, Buffer.from(saltB64, 'base64'), iterations, 32, 'sha256').toString('base64');
}

function referenceToken(secret, exp, version) {
  const key = createHmac('sha256', secret).update('session').digest();
  const payload = `v1.${exp}.${version}`;
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

const NO_PASSWORD = { hash: null, salt: null, iterations: null, session_version: 1 };

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

test('setupProblems: none when DB, IMAGES and an APP_SECRET of 32 characters are there (ADMIN_PASSWORD is not needed)', () => {
  assert.deepEqual(setupProblems({ DB: {}, IMAGES: {}, APP_SECRET: 'x'.repeat(32) }), []);
});

test('setupProblems names every missing piece, in order, in the words the panel shows', () => {
  assert.deepEqual(setupProblems({}), ['DB bağlaması yok', 'IMAGES bağlaması yok', 'APP_SECRET tanımlı değil ya da 32 karakterden kısa']);
  assert.deepEqual(setupProblems({ IMAGES: {}, APP_SECRET: SECRET }), ['DB bağlaması yok']);
  assert.deepEqual(setupProblems({ DB: {}, APP_SECRET: SECRET }), ['IMAGES bağlaması yok']);
});

test('setupProblems: an APP_SECRET shorter than 32 characters, or one that is not text, is a problem', () => {
  for (const APP_SECRET of ['x'.repeat(31), '', undefined, 10 ** 40]) {
    assert.deepEqual(setupProblems({ DB: {}, IMAGES: {}, APP_SECRET }), ['APP_SECRET tanımlı değil ya da 32 karakterden kısa'], String(APP_SECRET));
  }
});

// ---------------------------------------------------------------------------------------------
// The password hash
// ---------------------------------------------------------------------------------------------

test('newSalt gives 16 random bytes as base64, different every time', () => {
  const salts = new Set(Array.from({ length: 20 }, () => newSalt()));
  assert.equal(salts.size, 20);
  for (const salt of salts) {
    assert.match(salt, /^[A-Za-z0-9+/]{22}==$/);
    assert.equal(Buffer.from(salt, 'base64').length, 16);
  }
});

test('hashPassword is PBKDF2-SHA256 (256 bits, base64) over HMAC(HMAC(APP_SECRET, "pepper"), password), with the salt decoded from base64', async () => {
  for (const password of ['test-sifre-123', 'Çınar Dövme 2005!', '🔑 şifre']) {
    assert.equal(await hashPassword(password, SALT, SECRET, 10000), referenceHash(password, SALT, SECRET, 10000), password);
  }
  assert.equal(await hashPassword('x', 'DwAAAAAAAAAAAAAAAAAAAA==', 'z'.repeat(40), 3), referenceHash('x', 'DwAAAAAAAAAAAAAAAAAAAA==', 'z'.repeat(40), 3));
});

test('verifyPassword without a stored hash: ADMIN_PASSWORD, exactly as written, and nothing else', async () => {
  const env = { APP_SECRET: SECRET, ADMIN_PASSWORD: 'Gizli-Sifre-1' };
  assert.equal(await verifyPassword(env, NO_PASSWORD, 'Gizli-Sifre-1'), true);
  for (const wrong of ['gizli-sifre-1', 'Gizli-Sifre-', 'Gizli-Sifre-12', ' Gizli-Sifre-1', '']) {
    assert.equal(await verifyPassword(env, NO_PASSWORD, wrong), false, JSON.stringify(wrong));
  }
});

test('verifyPassword with a stored hash: that password, with the stored salt and iterations; ADMIN_PASSWORD no longer counts', async () => {
  const auth = { hash: referenceHash('yeni-sifre-99', SALT, SECRET, 1000), salt: SALT, iterations: 1000, session_version: 2 };
  const env = { APP_SECRET: SECRET, ADMIN_PASSWORD: 'test-sifre-123' };
  assert.equal(await verifyPassword(env, auth, 'yeni-sifre-99'), true);
  assert.equal(await verifyPassword(env, auth, 'test-sifre-123'), false, 'ADMIN_PASSWORD');
  assert.equal(await verifyPassword(env, auth, 'yeni-sifre-9'), false);
  assert.equal(await verifyPassword({ APP_SECRET: SECRET }, auth, 'yeni-sifre-99'), true, 'ADMIN_PASSWORD is not needed any more');
  assert.equal(await verifyPassword({ ...env, APP_SECRET: 'z'.repeat(40) }, auth, 'yeni-sifre-99'), false, 'the pepper comes from APP_SECRET');
});

test('verifyPassword lets nobody in when there is no password to compare with, or no usable APP_SECRET', async () => {
  for (const env of [{ APP_SECRET: SECRET }, { APP_SECRET: SECRET, ADMIN_PASSWORD: '' }]) {
    for (const password of ['', 'undefined', 'anything']) {
      assert.equal(await verifyPassword(env, NO_PASSWORD, password), false, `${JSON.stringify(env)} ${JSON.stringify(password)}`);
    }
  }
  for (const APP_SECRET of [undefined, 'x'.repeat(31)]) {
    assert.equal(await verifyPassword({ APP_SECRET, ADMIN_PASSWORD: 'test-sifre-123' }, NO_PASSWORD, 'test-sifre-123'), false, String(APP_SECRET));
  }
});

// ---------------------------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------------------------

test('a session token is v1.<expiry: 30 days on, in seconds>.<session version>.<base64url HMAC keyed with HMAC(APP_SECRET, "session")>', async () => {
  assert.equal(await createSessionToken(SECRET, 7, NOW), referenceToken(SECRET, NOW / 1000 + 2592000, 7));
  assert.equal(await createSessionToken(SECRET, 1793750400, NOW + 999), referenceToken(SECRET, NOW / 1000 + 2592000, 1793750400), 'whole seconds');
});

test('verifySessionToken: good for 30 days, only for the session version it was made for and only under its APP_SECRET', async () => {
  const token = await createSessionToken(SECRET, 3, NOW);
  assert.equal(await verifySessionToken(SECRET, token, 3, NOW), true);
  assert.equal(await verifySessionToken(SECRET, token, 3, NOW + 30 * DAY - 1), true, 'the last moment');
  assert.equal(await verifySessionToken(SECRET, token, 3, NOW + 30 * DAY), false, 'expired');
  assert.equal(await verifySessionToken(SECRET, token, 4, NOW), false, 'the password was changed since');
  assert.equal(await verifySessionToken(SECRET, token, 2, NOW), false);
  assert.equal(await verifySessionToken('z'.repeat(40), token, 3, NOW), false, 'another APP_SECRET');

  const big = await createSessionToken(SECRET, 1793750400, NOW); // a version from a restored admin row
  assert.equal(await verifySessionToken(SECRET, big, 1793750400, NOW), true);
  assert.equal(await verifySessionToken(SECRET, big, 1793750401, NOW), false);
});

test('verifySessionToken refuses a token that was changed in any part', async () => {
  const token = await createSessionToken(SECRET, 3, NOW);
  const [, exp, version, mac] = token.split('.');
  const flipped = `${mac.slice(0, 20)}${mac[20] === 'A' ? 'B' : 'A'}${mac.slice(21)}`;
  const changed = {
    'the signature': `v1.${exp}.${version}.${flipped}`,
    'a longer life': `v1.${Number(exp) + 30 * 86400}.${version}.${mac}`,
    'the format version': `v2.${exp}.${version}.${mac}`,
    'a character added': `${token}A`,
    'a part added': `${token}.A`,
    'a character missing': token.slice(0, -1),
  };
  for (const [label, candidate] of Object.entries(changed)) {
    assert.equal(await verifySessionToken(SECRET, candidate, 3, NOW), false, label);
  }
  assert.equal(await verifySessionToken(SECRET, `v1.${exp}.4.${mac}`, 4, NOW), false, 'the version changed to the current one');
});

test('verifySessionToken refuses what is not a token at all', async () => {
  for (const value of [undefined, null, 42, '', 'abc', 'v1', 'v1...', 'v1.a.b.c', `v1.1.1.${'A'.repeat(43)}`]) {
    assert.equal(await verifySessionToken(SECRET, value, 1, NOW), false, String(value));
  }
});

// ---------------------------------------------------------------------------------------------
// Requests: cookies, Origin, client IP
// ---------------------------------------------------------------------------------------------

test('cookieSecure: always, except over plain http when DEV_INSECURE_COOKIES is exactly "1" (the emulator)', () => {
  const secure = (url, env) => cookieSecure(new Request(url), env);
  assert.equal(secure('https://cinar.test/api/admin/login', {}), true);
  assert.equal(secure('https://cinar.test/api/admin/login', { DEV_INSECURE_COOKIES: '1' }), true);
  assert.equal(secure('http://192.168.1.20:8788/api/admin/login', { DEV_INSECURE_COOKIES: '1' }), false);
  for (const DEV_INSECURE_COOKIES of [undefined, '0', 'true', 1]) {
    assert.equal(secure('http://127.0.0.1:8788/api/admin/login', { DEV_INSECURE_COOKIES }), true, String(DEV_INSECURE_COOKIES));
  }
});

test('readCookie finds one cookie among several and gives null when it is not there', () => {
  const request = (cookie) => new Request(SITE, cookie === undefined ? {} : { headers: { Cookie: cookie } });
  assert.equal(readCookie(request('cinar_admin=v1.2.3.abc'), 'cinar_admin'), 'v1.2.3.abc');
  assert.equal(readCookie(request('theme=dark; cinar_admin=v1.2.3.abc; lang=tr'), 'cinar_admin'), 'v1.2.3.abc');
  assert.equal(readCookie(request('theme=dark;cinar_admin=tok'), 'cinar_admin'), 'tok');
  assert.equal(readCookie(request('a=b=c'), 'a'), 'b=c', 'the value is everything after the first =');
  assert.equal(readCookie(request('xcinar_admin=1; cinar_admin_old=2; cinar_admin'), 'cinar_admin'), null);
  assert.equal(readCookie(request(undefined), 'cinar_admin'), null);
});

test('isSameOrigin: POST, PUT, PATCH and DELETE need the site’s own Origin', () => {
  const request = (method, origin) => new Request(`${SITE}/api/admin/x`, { method, headers: origin === null ? {} : { Origin: origin } });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(isSameOrigin(request(method, SITE)), true, method);
    assert.equal(isSameOrigin(request(method, null)), false, `${method} without Origin`);
    for (const foreign of ['https://evil.test', 'http://cinar.test', 'https://cinar.test:8443', 'https://www.cinar.test', 'null']) {
      assert.equal(isSameOrigin(request(method, foreign)), false, `${method} from ${foreign}`);
    }
  }
});

test('isSameOrigin: a GET or HEAD may come without Origin (browsers send none on a same-origin GET), but not with a foreign one', () => {
  const request = (method, origin) => new Request(`${SITE}/api/admin/state`, { method, headers: origin === null ? {} : { Origin: origin } });
  for (const method of ['GET', 'HEAD']) {
    assert.equal(isSameOrigin(request(method, null)), true, method);
    assert.equal(isSameOrigin(request(method, SITE)), true, method);
    assert.equal(isSameOrigin(request(method, 'https://evil.test')), false, method);
  }
});

test('isSameOrigin compares with the origin of the request URL, port included (a phone on the LAN)', () => {
  const lan = (origin) => new Request('http://192.168.1.20:8788/api/admin/login', { method: 'POST', headers: { Origin: origin } });
  assert.equal(isSameOrigin(lan('http://192.168.1.20:8788')), true);
  assert.equal(isSameOrigin(lan('http://192.168.1.20')), false);
});

test('clientIp is CF-Connecting-IP, or "unknown" without one', () => {
  assert.equal(clientIp(new Request(SITE, { headers: { 'CF-Connecting-IP': '203.0.113.7' } })), '203.0.113.7');
  assert.equal(clientIp(new Request(SITE)), 'unknown');
});

test('requireSession: a valid session cookie for the current session version, and nothing else', async (t) => {
  const db = createD1(':memory:');
  t.after(() => db.close());
  await ensureSchema(db); // session version 1
  const env = { APP_SECRET: SECRET };
  const withCookie = (cookie) => new Request(`${SITE}/api/admin/state`, { headers: { Cookie: cookie } });
  const token = await createSessionToken(SECRET, 1, Date.now());

  assert.equal(await requireSession(withCookie(`theme=dark; cinar_admin=${token}`), env, db), true);
  assert.equal(await requireSession(new Request(`${SITE}/api/admin/state`), env, db), false, 'no cookie');
  assert.equal(await requireSession(withCookie(`other=${token}`), env, db), false, 'not the session cookie');
  assert.equal(await requireSession(withCookie(`cinar_admin=${token}`), { APP_SECRET: 'z'.repeat(40) }, db), false, 'another APP_SECRET');
  assert.equal(await requireSession(withCookie(`cinar_admin=${token}`), {}, db), false, 'no APP_SECRET');
  await setPassword(db, { hash: 'h', salt: 's', iterations: 10000 }); // session version 2
  assert.equal(await requireSession(withCookie(`cinar_admin=${token}`), env, db), false, 'signed out by the password change');
});
