// The data layer: the D1 schema, the seed the first request plants, and every query the public page
// and the admin panel make. No other file writes SQL.
//
// D1 budget. The free plan limits the values bound to one statement (100) and the queries one Worker
// invocation may make (50). So every function here makes ONE call to D1 (setPhotoOrder makes two: it
// looks, then writes). A bulk write is a batch of single-row statements: never one statement with
// many VALUES, and never a loop that awaits a call per row. A batch is also one transaction, so a
// list is replaced completely or not at all. Everything goes through prepare() and batch(), never
// exec(), which D1 handles differently.
//
// Shapes. A photo is a whole row of `photos`. A hero is { source: 'seed', seed_path, width, height }
// or { source: 'kv', image_key, width, height }. Timestamps are milliseconds. The functions trust
// the values they are given: the validators in fields.js check what a client sent. The one thing
// they do not trust is the stored hero, because a bad value there would take the page down.
//
// Uses only Web APIs: it runs inside a Pages Function.
import { DEFAULT_HERO, DEFAULT_SERVICES, DEFAULT_SETTINGS, SEED_PHOTOS, SEED_REVIEWS } from './defaults.js';
import { CLICK_KINDS } from './fields.js';
import { IMAGE_KEY_RE, IMAGE_LIMITS } from './media.js';

// ---------------------------------------------------------------------------------------------
// Schema and seed
// ---------------------------------------------------------------------------------------------

const SCHEMA_VERSION = '1';

// Schema v1. A later version adds statements after these (a new table, a new column) and raises
// schema_version. It never drops or renames anything, so that an older deployment, which Cloudflare
// can roll back to, still works against a newer schema.
const SCHEMA_V1 = [
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    position INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS photos (
    id TEXT PRIMARY KEY,
    caption TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'dovme',
    position INTEGER NOT NULL,
    source TEXT NOT NULL,
    seed_path TEXT,
    image_key TEXT,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS admin_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    hash TEXT,
    salt TEXT,
    iterations INTEGER,
    session_version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    ip TEXT NOT NULL,
    at INTEGER NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS login_attempts_ip_at ON login_attempts (ip, at)',
  // The 24-hour prune in recordFailure filters on `at` alone, which (ip, at) cannot serve: without
  // this index every failed login would read the whole table (D1 counts rows read, 5 million a day).
  'CREATE INDEX IF NOT EXISTS login_attempts_at ON login_attempts (at)',
  `CREATE TABLE IF NOT EXISTS price_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    position INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS price_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    price TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL,
    date_text TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS clicks (
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (day, kind)
  )`,
];

// Seeded rows carry the timestamp 0: they were not created at any moment, and a fixed value gives
// every database the same rows.
const SEED_TIME = 0;

// The columns of a photo row, as every photo query returns them.
const PHOTO_SELECT = 'id, caption, category, position, source, seed_path, image_key, width, height, created_at';

// What a new database holds, which defaultContent() also hands out, so that the two cannot differ.
const seededSettings = () => ({ ...DEFAULT_SETTINGS, hero_image: JSON.stringify(DEFAULT_HERO) });
const seededPhotos = () =>
  SEED_PHOTOS.map((photo, position) => ({
    id: photo.id,
    caption: photo.caption,
    category: photo.category,
    position,
    source: 'seed',
    seed_path: photo.seed_path,
    image_key: null,
    width: photo.width,
    height: photo.height,
    created_at: SEED_TIME,
  }));
const seededReviews = () => SEED_REVIEWS.map((review, index) => ({ id: index + 1, ...review }));

// Every seed statement is guarded by `meta.seeded`, which the last statement of the batch sets. That
// is what makes the seed run once: whatever the owner deletes (every photo, the reviews, a service)
// must not come back with the next cold start, and neither may the admin row, because deleting it is
// how a forgotten password is reset (see getAuth). INSERT OR IGNORE with fixed ids makes each
// statement harmless should it run again, and it never overwrites what the owner changed.
const NOT_SEEDED = "NOT EXISTS (SELECT 1 FROM meta WHERE key = 'seeded')";

// One seed row: the keys of `row` are the columns, its values what goes in them.
function seed(db, table, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  return db.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(', ')}) SELECT ${placeholders} WHERE ${NOT_SEEDED}`).bind(...Object.values(row));
}

function seedStatements(db) {
  return [
    ...Object.entries(seededSettings()).map(([key, value]) => seed(db, 'settings', { key, value, updated_at: SEED_TIME })),
    ...DEFAULT_SERVICES.map(({ id, name, description }, position) => seed(db, 'services', { id, name, description, position })),
    ...seededPhotos().map((photo) => seed(db, 'photos', photo)),
    ...seededReviews().map((review, position) => seed(db, 'reviews', { ...review, position, created_at: SEED_TIME })),
    // The first session version. getAuth makes a row that was deleted again at a later one.
    seed(db, 'admin_auth', { id: 1, session_version: 1 }),
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded', '1')"),
  ];
}

// The `db` objects that are set up. An isolate keeps this between requests, so D1 hears from
// ensureSchema once per isolate; a `db` object it has not seen (a test's wrapper) runs the batch
// again, which is harmless.
const ready = new WeakSet();

/**
 * Makes sure the tables exist and the first-run seed is in. One batch: the schema, the schema
 * version, the seed. It is safe to call on every request; it only talks to D1 once per `db` object.
 */
export async function ensureSchema(db) {
  if (ready.has(db)) return;
  await db.batch([
    ...SCHEMA_V1.map((sql) => db.prepare(sql)),
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)").bind(SCHEMA_VERSION),
    ...seedStatements(db),
  ]);
  ready.add(db);
}

// ---------------------------------------------------------------------------------------------
// Reading the content
// ---------------------------------------------------------------------------------------------

/**
 * Everything the public page and the admin panel show, in one call: { settings, hero, services,
 * photos, prices, reviews }.
 *
 * - `settings` is every stored row over the defaults, so a missing row falls back to its default.
 *   It also holds the `hero_image` row, a JSON string; the hero is that, read with care.
 * - Services, prices and reviews come in position order. Photos come by position, newest first among
 *   equals. A price group is { id, title, items: [{ id, name, detail, price }] }.
 */
export async function getContent(db) {
  const [settingRows, serviceRows, photoRows, groupRows, itemRows, reviewRows] = await db.batch([
    db.prepare('SELECT key, value FROM settings'),
    db.prepare('SELECT id, name, description FROM services ORDER BY position ASC, id ASC'),
    db.prepare(`SELECT ${PHOTO_SELECT} FROM photos ORDER BY position ASC, created_at DESC, id ASC`),
    db.prepare('SELECT id, title FROM price_groups ORDER BY position ASC, id ASC'),
    db.prepare('SELECT id, group_id, name, detail, price FROM price_items ORDER BY position ASC, id ASC'),
    db.prepare('SELECT id, name, rating, text, source, date_text FROM reviews ORDER BY position ASC, id ASC'),
  ]);

  const settings = { ...DEFAULT_SETTINGS, ...Object.fromEntries(settingRows.results.map(({ key, value }) => [key, value])) };

  const prices = groupRows.results.map((group) => ({ ...group, items: [] }));
  const groupsById = new Map(prices.map((group) => [group.id, group]));
  for (const { group_id: groupId, ...item } of itemRows.results) groupsById.get(groupId)?.items.push(item);

  return {
    settings,
    hero: parseHero(settings.hero_image),
    services: serviceRows.results,
    photos: photoRows.results,
    prices,
    reviews: reviewRows.results,
  };
}

/**
 * What getContent() gives for a new database, built from the defaults and without D1: the page's
 * fallback when D1 cannot be reached. Every call gives fresh copies, so changing the result changes
 * no default.
 */
export function defaultContent() {
  return {
    settings: seededSettings(),
    hero: { ...DEFAULT_HERO },
    services: DEFAULT_SERVICES.map((service) => ({ ...service })),
    photos: seededPhotos(),
    prices: [],
    reviews: seededReviews(),
  };
}

// ---------------------------------------------------------------------------------------------
// Settings and services
// ---------------------------------------------------------------------------------------------

const UPSERT_SETTING = 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at';

/** Saves settings: an object of key -> string, as validateSettingsPatch gives it (a list as JSON). */
export async function updateSettings(db, values) {
  const now = Date.now();
  const statements = Object.entries(values).map(([key, value]) => db.prepare(UPSERT_SETTING).bind(key, value, now));
  if (statements.length > 0) await db.batch(statements);
}

/** Replaces the whole list of services: [{ name, description }], in the order they are given. */
export async function replaceServices(db, services) {
  await db.batch([
    db.prepare('DELETE FROM services'),
    ...services.map((service, position) =>
      db.prepare('INSERT INTO services (name, description, position) VALUES (?, ?, ?)').bind(service.name, service.description, position),
    ),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Prices and reviews
// ---------------------------------------------------------------------------------------------

/** Replaces the whole price list: [{ title, items: [{ name, detail, price }] }], in order. */
export async function replacePrices(db, groups) {
  // An item names its group by position, which is unique: every group was deleted a moment ago in
  // the same batch, and the new ones are numbered from 0.
  const groupOfItem = '(SELECT id FROM price_groups WHERE position = ?)';
  await db.batch([
    db.prepare('DELETE FROM price_items'),
    db.prepare('DELETE FROM price_groups'),
    ...groups.flatMap((group, groupPosition) => [
      db.prepare('INSERT INTO price_groups (title, position) VALUES (?, ?)').bind(group.title, groupPosition),
      ...group.items.map((item, position) =>
        db.prepare(`INSERT INTO price_items (group_id, name, detail, price, position) VALUES (${groupOfItem}, ?, ?, ?, ?)`).bind(groupPosition, item.name, item.detail, item.price, position),
      ),
    ]),
  ]);
}

/** Replaces the whole list of reviews: [{ name, rating, text, source, date_text }]. `now` is their created_at. */
export async function replaceReviews(db, reviews, now) {
  await db.batch([
    db.prepare('DELETE FROM reviews'),
    ...reviews.map((review, position) =>
      db
        .prepare('INSERT INTO reviews (name, rating, text, source, date_text, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(review.name, review.rating, review.text, review.source, review.date_text, position, now),
    ),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Click counters
// ---------------------------------------------------------------------------------------------

/** Counts one click. `day` is YYYY-MM-DD in Europe/Istanbul, `kind` one of CLICK_KINDS. */
export async function incrementClick(db, day, kind) {
  await db
    .prepare('INSERT INTO clicks (day, kind, count) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET count = clicks.count + 1')
    .bind(day, kind)
    .run();
}

/** The clicks from `sinceDay` (YYYY-MM-DD, included) on, by kind: { whatsapp, call, ... }, 0 where there are none. */
export async function getClickStats(db, sinceDay) {
  const { results } = await db.prepare('SELECT kind, SUM(count) AS total FROM clicks WHERE day >= ? GROUP BY kind').bind(sinceDay).all();
  const stats = Object.fromEntries(CLICK_KINDS.map((kind) => [kind, 0]));
  for (const { kind, total } of results) {
    if (Object.hasOwn(stats, kind)) stats[kind] = total;
  }
  return stats;
}

// ---------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------

/** How many photos there are. */
export async function countPhotos(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM photos').first('n');
}

/**
 * Adds a photo that is stored in KV, in front of all the others (one position before the lowest, 0
 * in an empty gallery), and returns its row. The caption and the type default to what the table does.
 */
export async function insertPhoto(db, { id, caption = '', category = 'dovme', image_key, width, height, created_at }) {
  return db
    .prepare(
      `INSERT INTO photos (id, caption, category, position, source, seed_path, image_key, width, height, created_at)
       VALUES (?, ?, ?, (SELECT COALESCE(MIN(position), 1) - 1 FROM photos), 'kv', NULL, ?, ?, ?, ?)
       RETURNING ${PHOTO_SELECT}`,
    )
    .bind(id, caption, category, image_key, width, height, created_at)
    .first();
}

/** The photo's row, or null. */
export async function getPhoto(db, id) {
  return db.prepare(`SELECT ${PHOTO_SELECT} FROM photos WHERE id = ?`).bind(id).first();
}

/** Changes the caption and/or the type, whichever is given, and returns the new row (null: no such photo). */
export async function updatePhotoMeta(db, id, { caption, category } = {}) {
  return db
    .prepare(`UPDATE photos SET caption = COALESCE(?, caption), category = COALESCE(?, category) WHERE id = ? RETURNING ${PHOTO_SELECT}`)
    .bind(caption ?? null, category ?? null, id)
    .first();
}

/**
 * Points a photo at a new image in KV, whatever it was before. Returns the row from before and the
 * row after, so the caller can delete the old KV keys when `old.source` is 'kv'; null if there is no
 * such photo.
 */
export async function replacePhotoImage(db, id, { image_key, width, height }) {
  const [before, after] = await db.batch([
    db.prepare(`SELECT ${PHOTO_SELECT} FROM photos WHERE id = ?`).bind(id),
    db
      .prepare(`UPDATE photos SET source = 'kv', seed_path = NULL, image_key = ?, width = ?, height = ? WHERE id = ? RETURNING ${PHOTO_SELECT}`)
      .bind(image_key, width, height, id),
  ]);
  const old = before.results[0];
  return old === undefined ? null : { old, updated: after.results[0] };
}

/**
 * Puts the photos in the order of `ids` and numbers them from 0. `ids` must be exactly the ids of
 * all the photos, each once; otherwise the page the owner is looking at is out of date, nothing is
 * written and the answer is false.
 */
export async function setPhotoOrder(db, ids) {
  if (!Array.isArray(ids)) return false;
  const { results } = await db.prepare('SELECT id FROM photos').all();
  const current = new Set(results.map((row) => row.id));
  if (ids.length !== current.size || new Set(ids).size !== ids.length || ids.some((id) => !current.has(id))) return false;
  if (ids.length === 0) return true;

  // json_each numbers an array's elements from 0, so one statement writes every position.
  const list = JSON.stringify(ids);
  await db
    .prepare('UPDATE photos SET position = (SELECT key FROM json_each(?) WHERE value = photos.id) WHERE id IN (SELECT value FROM json_each(?))')
    .bind(list, list)
    .run();
  return true;
}

/** Deletes a photo's row and returns it (null: no such photo). The KV images are the caller's to delete. */
export async function deletePhoto(db, id) {
  return db.prepare(`DELETE FROM photos WHERE id = ? RETURNING ${PHOTO_SELECT}`).bind(id).first();
}

// ---------------------------------------------------------------------------------------------
// The hero image
// ---------------------------------------------------------------------------------------------

const isSize = (value) => Number.isInteger(value) && value >= 1 && value <= IMAGE_LIMITS.maxDimension;

// A hero with exactly its four fields, or null if `value` is not one.
function normalizeHero(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { source, seed_path: seedPath, image_key: imageKey, width, height } = value;
  if (!isSize(width) || !isSize(height)) return null;
  if (source === 'seed' && typeof seedPath === 'string' && seedPath !== '') return { source, seed_path: seedPath, width, height };
  if (source === 'kv' && typeof imageKey === 'string' && IMAGE_KEY_RE.test(imageKey)) return { source, image_key: imageKey, width, height };
  return null;
}

// The hero stored as `text`; a copy of the default hero when there is none, or when it is not JSON or
// not a hero, so that bad data in D1 cannot take the page down.
function parseHero(text) {
  try {
    return normalizeHero(JSON.parse(text)) ?? { ...DEFAULT_HERO };
  } catch {
    return { ...DEFAULT_HERO };
  }
}

const HERO_SQL = "SELECT value FROM settings WHERE key = 'hero_image'";

/** The hero image: the sign of the shop until the owner uploads another. */
export async function getHero(db) {
  return parseHero(await db.prepare(HERO_SQL).first('value'));
}

/**
 * Makes `hero` the hero image and returns the one it replaced, so the caller can delete its KV keys
 * when that was a 'kv' hero. Throws a TypeError for something that is not a hero, because a hero
 * that cannot be read back would silently bring the default sign back.
 */
export async function setHero(db, hero) {
  const next = normalizeHero(hero);
  if (next === null) throw new TypeError('setHero needs a hero: { source, seed_path or image_key, width, height }.');
  const [before] = await db.batch([db.prepare(HERO_SQL), db.prepare(UPSERT_SETTING).bind('hero_image', JSON.stringify(next), Date.now())]);
  return parseHero(before.results[0]?.value);
}

// ---------------------------------------------------------------------------------------------
// The admin password and the login attempts
// ---------------------------------------------------------------------------------------------

const AUTH_SQL = 'SELECT hash, salt, iterations, session_version FROM admin_auth WHERE id = 1';
const MAKE_AUTH_ROW_SQL = 'INSERT OR IGNORE INTO admin_auth (id, session_version) VALUES (1, ?)';

// The session version of an admin row that has to be made again: the time in seconds. Spec 6.1
// resets a forgotten password by deleting the row. A row that started again at 1 would make a
// session token issued long ago, with version 1, valid again; the time is above any version the
// earlier row can have reached (it grows by one with each password change).
const newRowVersion = () => Math.floor(Date.now() / 1000);

/**
 * The stored admin password: { hash, salt, iterations, session_version }. hash, salt and iterations
 * are null until the owner sets a password of their own (until then ADMIN_PASSWORD is the password).
 * A missing row is made again, with no password.
 */
export async function getAuth(db) {
  const auth = await db.prepare(AUTH_SQL).first();
  if (auth !== null) return auth;
  const [, made] = await db.batch([db.prepare(MAKE_AUTH_ROW_SQL).bind(newRowVersion()), db.prepare(AUTH_SQL)]);
  return made.results[0];
}

/** Stores a new password hash and raises the session version, which signs out every session. Returns the new version. */
export async function setPassword(db, { hash, salt, iterations }) {
  const [, updated] = await db.batch([
    db.prepare(MAKE_AUTH_ROW_SQL).bind(newRowVersion()),
    db
      .prepare('UPDATE admin_auth SET hash = ?, salt = ?, iterations = ?, session_version = session_version + 1 WHERE id = 1 RETURNING session_version')
      .bind(hash, salt, iterations),
  ]);
  return updated.results[0].session_version;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many failed logins this IP has had since `sinceMs` (that moment included). */
export async function countRecentFailures(db, ip, sinceMs) {
  return db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at >= ?').bind(ip, sinceMs).first('n');
}

/** Records a failed login at `now`, and forgets every failure older than 24 hours. */
export async function recordFailure(db, ip, now) {
  await db.batch([
    db.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, now),
    db.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now - DAY_MS),
  ]);
}

/** Forgets the failed logins of this IP (after a good login). */
export async function clearFailures(db, ip) {
  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}
