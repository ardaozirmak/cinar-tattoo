// The admin session (spec §6.1): the password hash, the signed session token and its cookie, the
// CSRF check on the Origin header and the check that the site is set up.
//
// - The password is PBKDF2-SHA256 over HMAC(pepper, password), with a random salt, where the pepper
//   is HMAC(APP_SECRET, 'pepper'). Until the owner sets a password of their own, ADMIN_PASSWORD is
//   the password; it is compared through the same HMAC, in constant time.
// - A session is the token v1.<expiry in seconds>.<session version>.<signature>, signed with
//   HMAC(APP_SECRET, 'session'). A password change raises the session version (see db.js), which
//   signs out every token made for the old one.
//
// Uses only Web APIs (crypto.subtle, TextEncoder, btoa and atob): it runs inside a Pages Function.
import { getAuth } from './db.js';

export const SESSION_COOKIE = 'cinar_admin';
// About as many as the free plan's ~10 ms of CPU per request allows. The rate limit and the pepper
// do most of the protecting.
export const PBKDF2_ITERATIONS = 10000;

const SESSION_SECONDS = 30 * 24 * 60 * 60; // a session lasts 30 days
const MIN_SECRET_LENGTH = 32;
const SALT_BYTES = 16;

// v1.<expiry>.<session version>.<signature: 32 bytes as base64url, 43 characters>
const TOKEN = /^v1\.(\d{1,15})\.(\d{1,15})\.([A-Za-z0-9_-]{43})$/;

// GET and HEAD change nothing, and a browser sends no Origin on a same-origin GET.
const SAFE_METHODS = new Set(['GET', 'HEAD']);

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------

/**
 * What is missing for the admin API to work, in the words the panel shows after "Kurulum eksik: ";
 * empty when nothing is. ADMIN_PASSWORD is not checked here: once the owner has a password of their
 * own it is not needed, so the login checks it.
 */
export function setupProblems(env) {
  const problems = [];
  if (!env.DB) problems.push('DB bağlaması yok');
  if (!env.IMAGES) problems.push('IMAGES bağlaması yok');
  if (!hasSecret(env)) problems.push('APP_SECRET tanımlı değil ya da 32 karakterden kısa');
  return problems;
}

const hasSecret = (env) => typeof env.APP_SECRET === 'string' && env.APP_SECRET.length >= MIN_SECRET_LENGTH;
const hasText = (value) => typeof value === 'string' && value !== '';

// ---------------------------------------------------------------------------------------------
// The password
// ---------------------------------------------------------------------------------------------

/** A new random salt: 16 bytes as base64. */
export function newSalt() {
  return toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

/** The stored form of a password: PBKDF2-SHA256 (256 bits, as base64) of HMAC(pepper, password). */
export async function hashPassword(password, saltB64, secret, iterations) {
  const prehash = await hmac(await pepperOf(secret), password);
  const material = await crypto.subtle.importKey('raw', prehash, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(saltB64), iterations }, material, 256);
  return toBase64(new Uint8Array(bits));
}

/** Whether there is a password to log in with: the owner's own (stored in D1), or ADMIN_PASSWORD. */
export function hasPassword(env, auth) {
  return hasText(auth.hash) || hasText(env.ADMIN_PASSWORD);
}

/**
 * Whether `password` is the admin password. `auth` is the admin row (getAuth). Its stored hash is
 * the password once there is one, and ADMIN_PASSWORD no longer counts then; until then it is
 * ADMIN_PASSWORD. Without a usable APP_SECRET, or with neither password, nothing is accepted.
 */
export async function verifyPassword(env, auth, password) {
  if (!hasSecret(env)) return false;
  if (hasText(auth.hash)) {
    const hash = await hashPassword(password, auth.salt, env.APP_SECRET, auth.iterations);
    return timingSafeEqual(encoder.encode(hash), encoder.encode(auth.hash));
  }
  if (!hasText(env.ADMIN_PASSWORD)) return false;
  const pepper = await pepperOf(env.APP_SECRET);
  const [given, expected] = await Promise.all([hmac(pepper, password), hmac(pepper, env.ADMIN_PASSWORD)]);
  return timingSafeEqual(given, expected);
}

const pepperOf = (secret) => hmac(secret, 'pepper');

// ---------------------------------------------------------------------------------------------
// The session token and its cookie
// ---------------------------------------------------------------------------------------------

/** A session token for `sessionVersion`, valid for 30 days from `now` (milliseconds). */
export async function createSessionToken(secret, sessionVersion, now) {
  const payload = `v1.${Math.floor(now / 1000) + SESSION_SECONDS}.${sessionVersion}`;
  return `${payload}.${await signatureOf(secret, payload)}`;
}

/**
 * Whether `token` is one of ours, unchanged, not expired at `now` (milliseconds) and made for the
 * current session version. A value that is not a token at all is just not valid: whatever the
 * cookie held, the answer is true or false.
 */
export async function verifySessionToken(secret, token, currentVersion, now) {
  const match = typeof token === 'string' ? TOKEN.exec(token) : null;
  if (match === null) return false;
  const [, expiry, version, signature] = match;
  const expected = await signatureOf(secret, `v1.${expiry}.${version}`);
  if (!timingSafeEqual(encoder.encode(signature), encoder.encode(expected))) return false;
  return now < Number(expiry) * 1000 && version === String(currentVersion);
}

const signatureOf = async (secret, payload) => toBase64Url(await hmac(await hmac(secret, 'session'), payload));

/** The Set-Cookie value that starts a session. */
export function sessionCookie(token, { secure = true } = {}) {
  return cookie(token, SESSION_SECONDS, secure);
}

/** The Set-Cookie value that ends the session in this browser. */
export function clearSessionCookie({ secure = true } = {}) {
  return cookie('', 0, secure);
}

// Sent only to the API (Path), never readable by scripts (HttpOnly), never on a request another
// site starts (SameSite=Strict), and only over https (Secure) unless cookieSecure says otherwise.
function cookie(value, maxAge, secure) {
  return `${SESSION_COOKIE}=${value}; Path=/api/admin; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

/**
 * Whether the cookie gets `Secure`: always, except over plain http when DEV_INSECURE_COOKIES is
 * '1'. Browsers drop a Secure cookie that arrives over http, which is how the emulator is reached
 * from a phone on the LAN.
 */
export function cookieSecure(request, env) {
  return !(env.DEV_INSECURE_COOKIES === '1' && new URL(request.url).protocol === 'http:');
}

/** The value of the cookie `name` in the request's Cookie header, or null. */
export function readCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (header === null) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------

/**
 * The CSRF check. POST, PUT, PATCH and DELETE (anything but GET and HEAD) need an Origin equal to
 * the request's own origin. A GET or HEAD may come without one, because browsers send none on a
 * same-origin GET, but not with a foreign one.
 */
export function isSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin === null) return SAFE_METHODS.has(request.method);
  return origin === new URL(request.url).origin;
}

/** Whether the request carries a valid session cookie for the current session version. */
export async function requireSession(request, env, db) {
  const token = readCookie(request, SESSION_COOKIE);
  if (token === null || !hasSecret(env)) return false;
  const { session_version: version } = await getAuth(db);
  return verifySessionToken(env.APP_SECRET, token, version, Date.now());
}

/** The client's IP, as Cloudflare reports it, or 'unknown' (in tests, for example). */
export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// ---------------------------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------------------------

// HMAC-SHA256 of `message` under `key`; either may be text (UTF-8) or bytes.
async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey('raw', bytesOf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, bytesOf(message)));
}

const bytesOf = (value) => (typeof value === 'string' ? encoder.encode(value) : value);

// Equal or not, in a time that depends only on the length: a comparison that stops at the first
// difference would tell an attacker how much of a guess was right.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const toBase64Url = (bytes) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
