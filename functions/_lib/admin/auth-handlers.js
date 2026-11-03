// The admin session and the panel's data: POST login, POST logout, GET state and POST password.
//
// The router (router.js) has already checked the Origin, the setup and, for state and password, the
// session. A handler answers an error by throwing an HttpError.
import {
  PBKDF2_ITERATIONS,
  clearSessionCookie,
  clientIp,
  cookieSecure,
  createSessionToken,
  hasPassword,
  hashPassword,
  newSalt,
  sessionCookie,
  verifyPassword,
} from '../auth.js';
import { clearFailures, countRecentFailures, getAuth, getContent, recordFailure, setPassword } from '../db.js';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  MAX_PRICE_GROUPS,
  MAX_PRICE_ITEMS,
  MAX_REVIEWS,
  MAX_SERVICES,
  PRICE_GROUP_TITLE_MAX,
  PRICE_ITEM_DETAIL_MAX,
  PRICE_ITEM_NAME_MAX,
  PRICE_ITEM_PRICE_MAX,
  REVIEW_DATE_MAX,
  REVIEW_NAME_MAX,
  REVIEW_SOURCES,
  REVIEW_SOURCE_LABELS,
  REVIEW_TEXT_MAX,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_NAME_MAX,
  SETTINGS_FIELDS,
  SETTINGS_GROUPS,
  listSetting,
} from '../fields.js';
import { HttpError, json, readJson } from '../http.js';
import { IMAGE_LIMITS, imageUrls } from '../media.js';

// Spec §6.1: after 5 failed attempts from one IP within 15 minutes, that IP has to wait. The login
// form and the password form share the count.
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

const UNREADABLE = 'İstek okunamadı.';
const NO_ADMIN_PASSWORD = 'Kurulum eksik: ADMIN_PASSWORD tanımlı değil.';
const TOO_MANY = 'Çok fazla deneme yaptın. 15 dakika sonra tekrar dene.';

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

/** POST /api/admin/login {password} → { ok: true } with the session cookie. */
export async function login({ request, env, db, now }) {
  const { password } = await readTexts(request, ['password']);
  if (password === '') throw new HttpError(400, 'Şifreyi yaz.');
  const ip = clientIp(request);
  await refuseWhenLockedOut(db, ip, now);
  const auth = await getAuth(db);
  if (!hasPassword(env, auth)) throw new HttpError(503, NO_ADMIN_PASSWORD);
  if (!(await tryPassword(db, ip, now, env, auth, password))) throw new HttpError(401, 'Şifre yanlış.');
  return sessionResponse(request, env, auth.session_version, now);
}

/** POST /api/admin/logout → { ok: true } with a cookie that ends the session. It needs no session. */
export function logout({ request, env }) {
  return json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie({ secure: cookieSecure(request, env) }) } });
}

/** GET /api/admin/state → everything the panel shows, and what its forms need to know. */
export async function state({ db }) {
  const content = await getContent(db);
  return json({
    settings: adminSettings(content.settings),
    hero: withImageUrls(content.hero),
    services: content.services,
    photos: content.photos.map(withImageUrls),
    prices: content.prices,
    reviews: content.reviews,
    fields: SETTINGS_FIELDS,
    groups: SETTINGS_GROUPS,
    categories: CATEGORY_OPTIONS,
    reviewSources: REVIEW_SOURCE_OPTIONS,
    limits: LIMITS,
  });
}

/**
 * POST /api/admin/password {current, next} → { ok: true } with a cookie for the new session
 * version. Every other session ends.
 */
export async function changePassword({ request, env, db, now }) {
  const { current, next } = await readTexts(request, ['current', 'next']);
  const ip = clientIp(request);
  // Before `current` is looked at: a stolen session cookie must not be a way to try passwords.
  await refuseWhenLockedOut(db, ip, now);
  const auth = await getAuth(db);
  if (!hasPassword(env, auth)) throw new HttpError(503, NO_ADMIN_PASSWORD);
  if (!(await tryPassword(db, ip, now, env, auth, current))) throw new HttpError(400, 'Mevcut şifre yanlış.');
  if (next.length < PASSWORD_MIN) throw new HttpError(400, `Yeni şifre en az ${PASSWORD_MIN} karakter olmalı.`);
  if (next.length > PASSWORD_MAX) throw new HttpError(400, `Yeni şifre en fazla ${PASSWORD_MAX} karakter olabilir.`);

  const salt = newSalt();
  const hash = await hashPassword(next, salt, env.APP_SECRET, PBKDF2_ITERATIONS);
  const version = await setPassword(db, { hash, salt, iterations: PBKDF2_ITERATIONS });
  return sessionResponse(request, env, version, now);
}

// ---------------------------------------------------------------------------------------------
// The shapes the panel gets (the other admin handlers answer with them too)
// ---------------------------------------------------------------------------------------------

/**
 * The settings as the panel edits them, from getContent().settings: exactly the SETTINGS_FIELDS
 * keys (the hero_image row is left out), a list as an array of strings and every other value as the
 * stored string.
 */
export function adminSettings(settings) {
  return Object.fromEntries(SETTINGS_FIELDS.map(({ key, kind }) => [key, kind === 'list' ? listSetting(settings, key) : settings[key]]));
}

/** A photo row or the hero with the URLs of its two images: { ...item, full, thumb }. */
export function withImageUrls(item) {
  return { ...item, ...imageUrls(item) };
}

const options = (values, labels) => values.map((value) => ({ value, label: labels[value] }));
const CATEGORY_OPTIONS = options(CATEGORIES, CATEGORY_LABELS);
const REVIEW_SOURCE_OPTIONS = options(REVIEW_SOURCES, REVIEW_SOURCE_LABELS);

// The limits the panel's forms show and enforce, taken from the modules whose rules they are.
const LIMITS = {
  maxPhotos: IMAGE_LIMITS.maxPhotos,
  captionMax: IMAGE_LIMITS.captionMax,
  maxServices: MAX_SERVICES,
  serviceNameMax: SERVICE_NAME_MAX,
  serviceDescriptionMax: SERVICE_DESCRIPTION_MAX,
  maxPriceGroups: MAX_PRICE_GROUPS,
  priceGroupTitleMax: PRICE_GROUP_TITLE_MAX,
  maxPriceItems: MAX_PRICE_ITEMS,
  priceItemNameMax: PRICE_ITEM_NAME_MAX,
  priceItemDetailMax: PRICE_ITEM_DETAIL_MAX,
  priceItemPriceMax: PRICE_ITEM_PRICE_MAX,
  maxReviews: MAX_REVIEWS,
  reviewNameMax: REVIEW_NAME_MAX,
  reviewTextMax: REVIEW_TEXT_MAX,
  reviewDateMax: REVIEW_DATE_MAX,
};

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

// The named fields of a JSON body, as strings; a missing or null field is ''. A body that is not an
// object, or a field that is not text, is a broken request.
async function readTexts(request, names) {
  const body = await readJson(request);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, UNREADABLE);
  const texts = {};
  for (const name of names) {
    const value = body[name] ?? '';
    if (typeof value !== 'string') throw new HttpError(400, UNREADABLE);
    texts[name] = value;
  }
  return texts;
}

// The quick check: an IP with 5 failures in the last 15 minutes is refused before anything is
// recorded, so trying again while locked out does not make the wait longer.
async function refuseWhenLockedOut(db, ip, now) {
  if ((await recentFailures(db, ip, now)) >= MAX_FAILURES) throw new HttpError(429, TOO_MANY);
}

// Whether `password` is the admin password, checked as one of the IP's 5 attempts. The attempt is
// recorded as a failure first and the failures are counted again; only then is the password
// checked, and a right one forgets the IP's failures, this attempt's included.
//
// Recording only after a wrong password would let attempts sent at once all pass
// refuseWhenLockedOut on the same old count, so one burst of any size would get through. D1 runs
// the inserts one at a time, so the attempt that adds the k-th row of the window counts at least k
// rows, and only the attempts that add rows 1 to 5 can reach verifyPassword, however many arrive
// together. An attempt refused here, or one whose check ends in an error, stays recorded.
async function tryPassword(db, ip, now, env, auth, password) {
  await recordFailure(db, ip, now);
  if ((await recentFailures(db, ip, now)) > MAX_FAILURES) throw new HttpError(429, TOO_MANY);
  if (!(await verifyPassword(env, auth, password))) return false;
  await clearFailures(db, ip);
  return true;
}

// The failures of this IP in the last 15 minutes.
function recentFailures(db, ip, now) {
  return countRecentFailures(db, ip, now - FAILURE_WINDOW_MS);
}

// { ok: true } with a new session cookie for `sessionVersion`.
async function sessionResponse(request, env, sessionVersion, now) {
  const token = await createSessionToken(env.APP_SECRET, sessionVersion, now);
  return json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie(token, { secure: cookieSecure(request, env) }) } });
}
