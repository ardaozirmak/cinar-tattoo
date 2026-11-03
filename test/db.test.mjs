import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createD1 } from '../dev/d1.mjs';
import { DEFAULT_HERO, DEFAULT_SERVICES, DEFAULT_SETTINGS, SEED_PHOTOS, SEED_REVIEWS } from '../functions/_lib/defaults.js';
import { CLICK_KINDS, listSetting } from '../functions/_lib/fields.js';
import {
  clearFailures,
  countPhotos,
  countRecentFailures,
  defaultContent,
  deletePhoto,
  ensureSchema,
  getAuth,
  getClickStats,
  getContent,
  getHero,
  getPhoto,
  incrementClick,
  insertPhoto,
  recordFailure,
  replacePhotoImage,
  replacePrices,
  replaceReviews,
  replaceServices,
  setHero,
  setPassword,
  setPhotoOrder,
  updatePhotoMeta,
  updateSettings,
} from '../functions/_lib/db.js';

// Every test but one runs on its own ':memory:' database, closed when the test ends.
async function seededDb(t) {
  const db = createD1(':memory:');
  t.after(() => db.close());
  await ensureSchema(db);
  return db;
}

const rows = async (db, sql, ...values) => (await db.prepare(sql).bind(...values).all()).results;
const countRows = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n');
const photoIds = async (db) => (await getContent(db)).photos.map((photo) => photo.id);

const SEED_IDS = SEED_PHOTOS.map((photo) => photo.id);
// The stored row of a seed photo, as a new database holds it.
const seedRow = (id) => {
  const position = SEED_IDS.indexOf(id);
  return { ...SEED_PHOTOS[position], position, source: 'seed', image_key: null, created_at: 0 };
};
const SETTINGS_ROWS = Object.keys(DEFAULT_SETTINGS).length + 1; // the defaults, and hero_image
const SEEDED_SETTINGS = { ...DEFAULT_SETTINGS, hero_image: JSON.stringify(DEFAULT_HERO) };

// Distinct 20-hex-character strings, as the ids and the image keys of stored photos are.
const idOf = (n) => String(n).padStart(20, '0');
const keyOf = (n) => `f${String(n).padStart(19, '0')}`;
const newPhoto = (n, extra = {}) => ({ id: idOf(n), caption: `Foto ${n}`, category: 'diger', image_key: keyOf(n), width: 1600, height: 1200, created_at: 1000 + n, ...extra });

const withoutId = ({ id, ...rest }) => rest;

// ---------------------------------------------------------------------------------------------
// Schema and seeds
// ---------------------------------------------------------------------------------------------

// How PRAGMA table_info describes each column: name, type, NOT NULL, DEFAULT, and pk<position>.
const SCHEMA_V1 = {
  meta: ['key TEXT pk1', 'value TEXT NOT NULL'],
  settings: ['key TEXT pk1', 'value TEXT NOT NULL', 'updated_at INTEGER NOT NULL'],
  services: ['id INTEGER pk1', 'name TEXT NOT NULL', 'description TEXT NOT NULL', 'position INTEGER NOT NULL'],
  photos: [
    'id TEXT pk1',
    "caption TEXT NOT NULL DEFAULT ''",
    "category TEXT NOT NULL DEFAULT 'dovme'",
    'position INTEGER NOT NULL',
    'source TEXT NOT NULL',
    'seed_path TEXT',
    'image_key TEXT',
    'width INTEGER NOT NULL',
    'height INTEGER NOT NULL',
    'created_at INTEGER NOT NULL',
  ],
  admin_auth: ['id INTEGER pk1', 'hash TEXT', 'salt TEXT', 'iterations INTEGER', 'session_version INTEGER NOT NULL DEFAULT 1'],
  login_attempts: ['ip TEXT NOT NULL', 'at INTEGER NOT NULL'],
  price_groups: ['id INTEGER pk1', 'title TEXT NOT NULL', 'position INTEGER NOT NULL'],
  price_items: [
    'id INTEGER pk1',
    'group_id INTEGER NOT NULL',
    'name TEXT NOT NULL',
    "detail TEXT NOT NULL DEFAULT ''",
    "price TEXT NOT NULL DEFAULT ''",
    'position INTEGER NOT NULL',
  ],
  reviews: [
    'id INTEGER pk1',
    'name TEXT NOT NULL',
    'rating INTEGER NOT NULL',
    'text TEXT NOT NULL',
    'source TEXT NOT NULL',
    "date_text TEXT NOT NULL DEFAULT ''",
    'position INTEGER NOT NULL',
    'created_at INTEGER NOT NULL',
  ],
  clicks: ['day TEXT NOT NULL pk1', 'kind TEXT NOT NULL pk2', 'count INTEGER NOT NULL'],
};

const describeColumn = ({ name, type, notnull, dflt_value: fallback, pk }) =>
  [name, type, notnull ? 'NOT NULL' : '', fallback === null ? '' : `DEFAULT ${fallback}`, pk ? `pk${pk}` : ''].filter(Boolean).join(' ');

async function tableCounts(db) {
  const counts = {};
  for (const table of Object.keys(SCHEMA_V1)) counts[table] = await countRows(db, table);
  return counts;
}

const SEEDED_COUNTS = {
  meta: 2,
  settings: SETTINGS_ROWS,
  services: 4,
  photos: 31,
  admin_auth: 1,
  login_attempts: 0,
  price_groups: 0,
  price_items: 0,
  reviews: 13,
  clicks: 0,
};

test('schema v1: the tables, columns, defaults and keys of the plan', async (t) => {
  const db = await seededDb(t);
  const tables = await rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  assert.deepEqual(tables.map((table) => table.name), Object.keys(SCHEMA_V1).sort());
  for (const [table, expected] of Object.entries(SCHEMA_V1)) {
    assert.deepEqual((await rows(db, `PRAGMA table_info(${table})`)).map(describeColumn), expected, table);
  }
  const autoincrement = await rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%AUTOINCREMENT%' ORDER BY name");
  assert.deepEqual(autoincrement.map((table) => table.name), ['price_groups', 'price_items', 'reviews', 'services']);
  const indexed = await rows(db, "SELECT il.name AS name, ii.name AS column_name FROM pragma_index_list('login_attempts') AS il, pragma_index_info(il.name) AS ii ORDER BY il.name, ii.seqno");
  assert.deepEqual(
    indexed.map((index) => `${index.name}: ${index.column_name}`),
    ['login_attempts_at: at', 'login_attempts_ip_at: ip', 'login_attempts_ip_at: at'],
    'the plan’s index on (ip, at), and one on (at) for the prune',
  );
  await assert.rejects(db.prepare('INSERT INTO admin_auth (id) VALUES (2)').run(), /CHECK constraint failed/, 'there is one admin row');
});

test('ensureSchema seeds the site: settings, 4 services, the 31 seed photos, 13 reviews, the admin row, no prices', async (t) => {
  const db = await seededDb(t);
  assert.deepEqual(await tableCounts(db), SEEDED_COUNTS);
  assert.deepEqual(await rows(db, 'SELECT key, value FROM meta ORDER BY key'), [
    { key: 'schema_version', value: '1' },
    { key: 'seeded', value: '1' },
  ]);
  assert.deepEqual(await rows(db, 'SELECT id, hash, salt, iterations, session_version FROM admin_auth'), [
    { id: 1, hash: null, salt: null, iterations: null, session_version: 1 },
  ]);
  assert.deepEqual(await rows(db, 'SELECT id FROM services ORDER BY id'), [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  assert.deepEqual(await rows(db, 'SELECT id FROM reviews ORDER BY id'), Array.from({ length: 13 }, (_, index) => ({ id: index + 1 })));
});

test('running ensureSchema again, on the same object or on another, seeds nothing twice', async (t) => {
  const db = await seededDb(t);
  await ensureSchema(db);
  assert.deepEqual(await tableCounts(db), SEEDED_COUNTS);
  // A copy is another object, so it has no memory of the first run and does run the batch again.
  await ensureSchema({ ...db });
  assert.deepEqual(await tableCounts(db), SEEDED_COUNTS);
  assert.deepEqual(await getContent(db), defaultContent());
});

test('a failed ensureSchema leaves nothing behind and is tried again by the next call', async (t) => {
  const raw = createD1(':memory:');
  t.after(() => raw.close());
  let failures = 1;
  const flaky = {
    ...raw,
    batch(statements) {
      if (failures-- > 0) return Promise.reject(new Error('D1 is down'));
      return raw.batch(statements);
    },
  };
  await assert.rejects(ensureSchema(flaky), /D1 is down/);
  await assert.rejects(raw.prepare('SELECT 1 FROM meta').first(), /no such table/, 'nothing was created');
  await ensureSchema(flaky); // the failure was not remembered as success
  assert.deepEqual(await getContent(raw), defaultContent());
});

test('a new wrapper over the same file does not seed again after the owner deleted everything', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'cinar-db-'));
  const file = join(dir, 'db.sqlite');
  const first = createD1(file);
  const second = createD1(file);
  t.after(async () => {
    first.close();
    second.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  await ensureSchema(first);
  await first.batch([
    first.prepare('DELETE FROM photos'),
    first.prepare('DELETE FROM services'),
    first.prepare('DELETE FROM reviews'),
    first.prepare('DELETE FROM admin_auth'),
    first.prepare("UPDATE settings SET value = 'Benim başlığım' WHERE key = 'hero_title'"),
  ]);

  await ensureSchema(second); // a new wrapper knows nothing of the first, so this runs the whole batch
  assert.equal(await countRows(second, 'photos'), 0);
  assert.equal(await countRows(second, 'services'), 0);
  assert.equal(await countRows(second, 'reviews'), 0);
  assert.equal(await countRows(second, 'admin_auth'), 0, 'a password reset (the row deleted) must stay a reset');
  const content = await getContent(second);
  assert.deepEqual(content.photos, []);
  assert.equal(content.settings.hero_title, 'Benim başlığım');
});

test('seeding is INSERT OR IGNORE: even if the seeded flag is lost, nothing the owner changed is overwritten', async (t) => {
  const db = await seededDb(t);
  await db.batch([
    db.prepare("UPDATE settings SET value = 'Benim başlığım' WHERE key = 'hero_title'"),
    db.prepare("UPDATE photos SET caption = 'Yeni açıklama' WHERE id = 'seed-gecici-10'"),
    db.prepare("UPDATE services SET name = 'Düzenlendi' WHERE id = 1"),
    db.prepare("UPDATE reviews SET text = 'Düzenlendi' WHERE id = 1"),
    db.prepare("DELETE FROM meta WHERE key = 'seeded'"),
  ]);
  await ensureSchema({ ...db });
  const content = await getContent(db);
  assert.equal(content.settings.hero_title, 'Benim başlığım');
  assert.equal(content.photos.find((photo) => photo.id === 'seed-gecici-10').caption, 'Yeni açıklama');
  assert.equal(content.services[0].name, 'Düzenlendi');
  assert.equal(content.reviews[0].text, 'Düzenlendi');
  assert.deepEqual(await tableCounts(db), SEEDED_COUNTS);
});

// ---------------------------------------------------------------------------------------------
// Reading the content
// ---------------------------------------------------------------------------------------------

test('getContent on a new database: the default texts, 4 services, the 31 seed photos in order, 13 reviews and no prices', async (t) => {
  const db = await seededDb(t);
  const content = await getContent(db);
  assert.deepEqual(content.settings, SEEDED_SETTINGS);
  assert.deepEqual(content.hero, DEFAULT_HERO);
  assert.deepEqual(content.services, DEFAULT_SERVICES);
  assert.equal(content.photos.length, 31);
  assert.deepEqual(content.photos.slice(0, 3).map((photo) => photo.id), ['seed-gecici-06', 'seed-kalici-07', 'seed-piercing-08']);
  assert.deepEqual(content.photos.slice(-2).map((photo) => photo.id), ['seed-piercing-06', 'seed-gecici-01']);
  for (const [index, photo] of content.photos.entries()) {
    assert.deepEqual(photo, { ...SEED_PHOTOS[index], position: index, source: 'seed', image_key: null, created_at: 0 });
  }
  assert.deepEqual(content.prices, []);
  assert.deepEqual(content.reviews.map(({ id }) => id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(content.reviews.map(withoutId), SEED_REVIEWS);
});

test('getContent on a new database is exactly defaultContent()', async (t) => {
  const db = await seededDb(t);
  assert.deepEqual(await getContent(db), defaultContent());
});

test('defaultContent hands out fresh copies: changing one never changes the defaults or the next call', () => {
  const pristine = structuredClone(defaultContent());
  const content = defaultContent();
  content.settings.hero_title = 'değişti';
  content.hero.width = 1;
  content.services[0].name = 'değişti';
  content.photos[0].caption = 'değişti';
  content.photos.pop();
  content.reviews[0].text = 'değişti';
  content.prices.push({ id: 1, title: 'x', items: [] });

  assert.deepEqual(defaultContent(), pristine);
  assert.notEqual(DEFAULT_SETTINGS.hero_title, 'değişti');
  assert.equal(DEFAULT_HERO.width, 1254);
  assert.notEqual(DEFAULT_SERVICES[0].name, 'değişti');
  assert.equal(SEED_PHOTOS.length, 31);
  assert.notEqual(SEED_PHOTOS[0].caption, 'değişti');
  assert.notEqual(SEED_REVIEWS[0].text, 'değişti');
});

test('what is stored in D1 wins over the defaults, a missing row falls back to the default, a cleared field stays cleared', async (t) => {
  const db = await seededDb(t);
  await updateSettings(db, { hero_title: 'Yeni başlık', instagram_followers: '' });
  await db.prepare("DELETE FROM settings WHERE key = 'hero_text'").run();
  await db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('baska_bir_ayar', 'x', 0)").run();
  const { settings } = await getContent(db);
  assert.equal(settings.hero_title, 'Yeni başlık');
  assert.equal(settings.instagram_followers, '', 'the default is "18 bin+", but the owner emptied it');
  assert.equal(settings.hero_text, DEFAULT_SETTINGS.hero_text);
  assert.equal(settings.baska_bir_ayar, 'x', 'every stored row is there, the defaults are only the floor');
});

test('photos come ordered by position, newest first among equal positions, then by id', async (t) => {
  const db = await seededDb(t);
  const insert = (id, position, createdAt) =>
    db.prepare("INSERT INTO photos (id, position, source, seed_path, width, height, created_at) VALUES (?, ?, 'seed', 'x', 10, 10, ?)").bind(id, position, createdAt);
  await db.batch([
    db.prepare('DELETE FROM photos'),
    insert('seed-a', 1, 100),
    insert('seed-b', 0, 100),
    insert('seed-c', 0, 200),
    insert('seed-d', -1, 50),
    insert('seed-f', 5, 10),
    insert('seed-e', 5, 10),
  ]);
  assert.deepEqual(await photoIds(db), ['seed-d', 'seed-c', 'seed-b', 'seed-a', 'seed-e', 'seed-f']);
});

test('services, prices and reviews come ordered by position, not by id; an item without a group is left out', async (t) => {
  const db = await seededDb(t);
  await db.batch([
    db.prepare('DELETE FROM services'),
    db.prepare("INSERT INTO services (id, name, description, position) VALUES (1, 'ikinci', '', 1)"),
    db.prepare("INSERT INTO services (id, name, description, position) VALUES (2, 'birinci', '', 0)"),
    db.prepare("INSERT INTO price_groups (id, title, position) VALUES (1, 'B', 1)"),
    db.prepare("INSERT INTO price_groups (id, title, position) VALUES (2, 'A', 0)"),
    db.prepare("INSERT INTO price_items (group_id, name, position) VALUES (1, 'b2', 1)"),
    db.prepare("INSERT INTO price_items (group_id, name, position) VALUES (1, 'b1', 0)"),
    db.prepare("INSERT INTO price_items (group_id, name, position) VALUES (2, 'a1', 0)"),
    db.prepare("INSERT INTO price_items (group_id, name, position) VALUES (99, 'yetim', 0)"),
    db.prepare('DELETE FROM reviews'),
    db.prepare("INSERT INTO reviews (id, name, rating, text, source, position, created_at) VALUES (1, 'sonra', 5, 't', 'google', 1, 0)"),
    db.prepare("INSERT INTO reviews (id, name, rating, text, source, position, created_at) VALUES (2, 'önce', 5, 't', 'google', 0, 0)"),
  ]);
  const content = await getContent(db);
  assert.deepEqual(content.services.map((service) => service.name), ['birinci', 'ikinci']);
  assert.deepEqual(content.prices.map((group) => [group.title, group.items.map((item) => item.name)]), [['A', ['a1']], ['B', ['b1', 'b2']]]);
  assert.deepEqual(content.reviews.map((review) => review.name), ['önce', 'sonra']);
});

// ---------------------------------------------------------------------------------------------
// The hero image
// ---------------------------------------------------------------------------------------------

const KV_HERO = { source: 'kv', image_key: keyOf(1), width: 1000, height: 900 };

test('hero is read from the hero_image setting', async (t) => {
  const db = await seededDb(t);
  await db.prepare("UPDATE settings SET value = ? WHERE key = 'hero_image'").bind(JSON.stringify(KV_HERO)).run();
  assert.deepEqual((await getContent(db)).hero, KV_HERO);
  assert.deepEqual(await getHero(db), KV_HERO);
});

test('hero falls back to DEFAULT_HERO on bad JSON, a wrong shape or a missing row', async (t) => {
  const db = await seededDb(t);
  const bad = [
    'not json',
    '',
    'null',
    '[]',
    '"seed"',
    '42',
    '{}',
    '{"source":"kv","image_key":"nope","width":10,"height":10}',
    JSON.stringify({ ...KV_HERO, image_key: keyOf(1).toUpperCase() }),
    '{"source":"seed","width":10,"height":10}',
    '{"source":"seed","seed_path":"","width":10,"height":10}',
    '{"source":"seed","seed_path":"logo","width":0,"height":10}',
    '{"source":"seed","seed_path":"logo","width":10,"height":4001}',
    '{"source":"seed","seed_path":"logo","width":"10","height":10}',
    '{"source":"seed","seed_path":"logo","width":1.5,"height":10}',
    '{"source":"other","seed_path":"logo","width":10,"height":10}',
    JSON.stringify({ ...KV_HERO, source: 'other' }), // a good key does not make a hero
    JSON.stringify({ ...KV_HERO, source: 'seed' }), // a seed hero needs a seed_path
  ];
  // The fallback is a copy: changing what a caller got must not change the shared default.
  const checkFallback = async (label) => {
    const fromContent = (await getContent(db)).hero;
    const fromGetHero = await getHero(db);
    assert.deepEqual(fromContent, DEFAULT_HERO, label);
    assert.deepEqual(fromGetHero, DEFAULT_HERO, label);
    assert.notEqual(fromContent, DEFAULT_HERO, `${label}: the shared object itself`);
    assert.notEqual(fromGetHero, DEFAULT_HERO, `${label}: the shared object itself`);
  };
  for (const stored of bad) {
    await db.prepare("UPDATE settings SET value = ? WHERE key = 'hero_image'").bind(stored).run();
    await checkFallback(stored);
  }
  await db.prepare("DELETE FROM settings WHERE key = 'hero_image'").run();
  await checkFallback('no row');
});

test('a stored hero keeps only the four fields of a hero', async (t) => {
  const db = await seededDb(t);
  const stored = JSON.stringify({ ...KV_HERO, evil: '<script>', seed_path: 'logo' });
  await db.prepare("UPDATE settings SET value = ? WHERE key = 'hero_image'").bind(stored).run();
  assert.deepEqual(await getHero(db), KV_HERO);
});

test('setHero stores the new hero and hands back the one it replaced', async (t) => {
  const db = await seededDb(t);
  assert.deepEqual(await setHero(db, KV_HERO), DEFAULT_HERO, 'the seed hero comes first');
  assert.deepEqual(await getHero(db), KV_HERO);
  const content = await getContent(db);
  assert.deepEqual(content.hero, KV_HERO);
  assert.deepEqual(JSON.parse(content.settings.hero_image), KV_HERO);

  const next = { source: 'kv', image_key: keyOf(2), width: 800, height: 800 };
  assert.deepEqual(await setHero(db, next), KV_HERO, 'the kv hero, so the caller can delete its KV keys');
  assert.deepEqual(await getHero(db), next);
  assert.equal(await countRows(db, 'settings'), SETTINGS_ROWS, 'one row, saved over');

  const seed = { ...DEFAULT_HERO };
  assert.deepEqual(await setHero(db, seed), next);
  assert.deepEqual(await getHero(db), seed);
});

test('setHero drops fields that are not part of a hero and refuses a malformed one', async (t) => {
  const db = await seededDb(t);
  await setHero(db, { ...KV_HERO, type: 'image/jpeg', seed_path: 'logo' });
  assert.deepEqual(JSON.parse((await getContent(db)).settings.hero_image), KV_HERO);
  for (const bad of [null, undefined, 'kv', [], {}, { ...KV_HERO, image_key: 'zzz' }, { ...KV_HERO, width: 0 }, { source: 'seed', width: 1, height: 1 }]) {
    await assert.rejects(setHero(db, bad), TypeError, JSON.stringify(bad));
  }
  assert.deepEqual(await getHero(db), KV_HERO, 'the stored hero is as it was');
});

// ---------------------------------------------------------------------------------------------
// Settings and services
// ---------------------------------------------------------------------------------------------

test('updateSettings saves the given values and leaves every other one as it was', async (t) => {
  const db = await seededDb(t);
  await updateSettings(db, { hero_title: 'Yeni başlık', announcement_on: '1', highlights: JSON.stringify(['bir', 'iki']) });
  const { settings } = await getContent(db);
  assert.equal(settings.hero_title, 'Yeni başlık');
  assert.equal(settings.announcement_on, '1');
  assert.deepEqual(listSetting(settings, 'highlights'), ['bir', 'iki']);
  assert.deepEqual(
    { ...settings, hero_title: DEFAULT_SETTINGS.hero_title, announcement_on: '0', highlights: DEFAULT_SETTINGS.highlights },
    SEEDED_SETTINGS,
    'the rest is untouched, hero_image included',
  );

  await updateSettings(db, { hero_title: 'Başka başlık' });
  assert.equal((await getContent(db)).settings.hero_title, 'Başka başlık');
  assert.equal(await countRows(db, 'settings'), SETTINGS_ROWS, 'saving again writes over the row');
  assert.deepEqual(await rows(db, "SELECT updated_at > 0 AS stamped FROM settings WHERE key = 'hero_title'"), [{ stamped: 1 }]);
});

test('replaceServices swaps the whole list and keeps its order', async (t) => {
  const db = await seededDb(t);
  const list = [
    { name: 'Üçüncü', description: 'c' },
    { name: 'Birinci', description: '' },
    { name: 'İkinci', description: 'b' },
  ];
  await replaceServices(db, list);
  const { services } = await getContent(db);
  assert.deepEqual(services.map(withoutId), list);
  assert.ok(services.every((service) => service.id > DEFAULT_SERVICES.length), 'the ids of the seeds are not used again');
  assert.equal(await countRows(db, 'services'), 3);
  assert.deepEqual(await rows(db, 'SELECT position FROM services ORDER BY id'), [{ position: 0 }, { position: 1 }, { position: 2 }], 'numbered from 0');

  const shorter = [{ name: 'Tek', description: 'x' }];
  await replaceServices(db, shorter);
  assert.deepEqual((await getContent(db)).services.map(withoutId), shorter);
});

// ---------------------------------------------------------------------------------------------
// Prices and reviews
// ---------------------------------------------------------------------------------------------

const PRICE_LIST = [
  {
    title: 'Dövme',
    items: [
      { name: 'Minimal yazı', detail: 'Tek kelime', price: "1.500₺'den" },
      { name: 'Küçük çizim', detail: '', price: 'Teklif al' },
    ],
  },
  { title: 'Boş grup', items: [] },
  { title: 'Piercing', items: [{ name: 'Kulak', detail: 'Küpe dahil', price: '' }] },
];

const stripPriceIds = (groups) => groups.map((group) => ({ title: group.title, items: group.items.map(withoutId) }));

test('replacePrices stores groups and items in order, and getContent gives them back with ids', async (t) => {
  const db = await seededDb(t);
  await replacePrices(db, PRICE_LIST);
  const { prices } = await getContent(db);
  assert.deepEqual(stripPriceIds(prices), PRICE_LIST);
  for (const group of prices) {
    assert.deepEqual(Object.keys(group), ['id', 'title', 'items']);
    assert.ok(Number.isInteger(group.id));
    for (const item of group.items) assert.deepEqual(Object.keys(item), ['id', 'name', 'detail', 'price']);
  }
  assert.equal(new Set(prices.map((group) => group.id)).size, 3);
  // Numbered from 0 within the list and within each group, and every item sits under its own group.
  assert.deepEqual(await rows(db, 'SELECT position FROM price_groups ORDER BY id'), [{ position: 0 }, { position: 1 }, { position: 2 }]);
  assert.deepEqual(await rows(db, 'SELECT g.position AS "group", i.position AS item FROM price_items AS i JOIN price_groups AS g ON g.id = i.group_id ORDER BY i.id'), [
    { group: 0, item: 0 },
    { group: 0, item: 1 },
    { group: 2, item: 0 },
  ]);
});

test('replacePrices replaces the old list completely, and an empty list empties the section', async (t) => {
  const db = await seededDb(t);
  await replacePrices(db, PRICE_LIST);
  const firstIds = (await getContent(db)).prices.map((group) => group.id);

  const other = [{ title: 'Geçici dövme', items: [{ name: 'Bilek', detail: '', price: '500₺' }] }];
  await replacePrices(db, other);
  const { prices } = await getContent(db);
  assert.deepEqual(stripPriceIds(prices), other);
  assert.ok(prices[0].id > Math.max(...firstIds), 'AUTOINCREMENT: an id is not used twice');
  assert.equal(await countRows(db, 'price_groups'), 1);
  assert.equal(await countRows(db, 'price_items'), 1);

  await replacePrices(db, []);
  assert.deepEqual((await getContent(db)).prices, []);
  assert.equal(await countRows(db, 'price_groups'), 0);
  assert.equal(await countRows(db, 'price_items'), 0);
});

test('replacePrices keeps the items of each group with that group, also when the groups hold many', async (t) => {
  const db = await seededDb(t);
  const groups = Array.from({ length: 6 }, (_, g) => ({
    title: `Grup ${g}`,
    items: Array.from({ length: g === 2 ? 0 : 12 }, (__, i) => ({ name: `G${g} kalem ${i}`, detail: `d${i}`, price: `${i}₺` })),
  }));
  await replacePrices(db, groups);
  assert.deepEqual(stripPriceIds((await getContent(db)).prices), groups);
});

test('replaceReviews swaps the whole list in order and stamps every review with the given time', async (t) => {
  const db = await seededDb(t);
  const list = [
    { name: 'Zeynep K.', rating: 4, text: 'Güzel\nçok güzel', source: 'instagram', date_text: 'Ekim 2026' },
    { name: 'Ali', rating: 5, text: 'Harika', source: 'google', date_text: '' },
  ];
  await replaceReviews(db, list, 1_700_000_000_000);
  const { reviews } = await getContent(db);
  assert.deepEqual(reviews.map(withoutId), list);
  assert.ok(reviews.every((review) => review.id > SEED_REVIEWS.length), 'the ids of the seeds are not used again');
  assert.deepEqual(await rows(db, 'SELECT DISTINCT created_at FROM reviews'), [{ created_at: 1_700_000_000_000 }]);
  assert.equal(await countRows(db, 'reviews'), 2);
  assert.deepEqual(await rows(db, 'SELECT position FROM reviews ORDER BY id'), [{ position: 0 }, { position: 1 }], 'numbered from 0');

  await replaceReviews(db, [], 1);
  assert.deepEqual((await getContent(db)).reviews, []);
});

test('a list is replaced completely or not at all: one bad row rolls the whole change back', async (t) => {
  const db = await seededDb(t);
  await replacePrices(db, PRICE_LIST);
  const before = await getContent(db);
  const review = { name: 'Ali', rating: 5, text: 'Harika', source: 'google', date_text: '' };

  // A NULL in a NOT NULL column makes the second statement of each batch fail.
  await assert.rejects(replaceServices(db, [{ name: 'iyi', description: '' }, { name: null, description: '' }]), /NOT NULL/);
  await assert.rejects(replacePrices(db, [{ title: 'iyi', items: [{ name: 'a', detail: '', price: '' }] }, { title: null, items: [] }]), /NOT NULL/);
  await assert.rejects(replaceReviews(db, [review, { ...review, rating: null }], 1), /NOT NULL/);
  assert.deepEqual(await getContent(db), before, 'the old lists are all still there');
});

test('replaceReviews takes the largest list the panel allows', async (t) => {
  const db = await seededDb(t);
  const list = Array.from({ length: 30 }, (_, index) => ({ name: `Kişi ${index}`, rating: 1 + (index % 5), text: `Yorum ${index}`, source: 'diger', date_text: '' }));
  await replaceReviews(db, list, 5);
  assert.deepEqual((await getContent(db)).reviews.map(withoutId), list);
});

// ---------------------------------------------------------------------------------------------
// Click counters
// ---------------------------------------------------------------------------------------------

test('incrementClick counts up per day and kind', async (t) => {
  const db = await seededDb(t);
  for (const [day, kind] of [['2026-11-01', 'whatsapp'], ['2026-11-01', 'whatsapp'], ['2026-11-01', 'call'], ['2026-11-02', 'whatsapp']]) {
    await incrementClick(db, day, kind);
  }
  assert.deepEqual(await rows(db, 'SELECT day, kind, count FROM clicks ORDER BY day, kind'), [
    { day: '2026-11-01', kind: 'call', count: 1 },
    { day: '2026-11-01', kind: 'whatsapp', count: 2 },
    { day: '2026-11-02', kind: 'whatsapp', count: 1 },
  ]);
});

test('getClickStats totals the days from sinceDay on, and gives 0 for a kind with no clicks', async (t) => {
  const db = await seededDb(t);
  assert.deepEqual(await getClickStats(db, '2026-01-01'), { whatsapp: 0, call: 0, directions: 0, form: 0, instagram: 0 });

  const clicks = [
    ['2026-10-01', 'whatsapp', 5],
    ['2026-10-31', 'whatsapp', 2],
    ['2026-11-01', 'whatsapp', 3],
    ['2026-11-01', 'call', 4],
    ['2026-11-02', 'whatsapp', 1],
    ['2026-11-02', 'directions', 6],
  ];
  for (const [day, kind, times] of clicks) {
    for (let time = 0; time < times; time += 1) await incrementClick(db, day, kind);
  }
  const stats = await getClickStats(db, '2026-10-31');
  assert.deepEqual(stats, { whatsapp: 6, call: 4, directions: 6, form: 0, instagram: 0 }, 'the day itself is included');
  assert.deepEqual(Object.keys(stats), CLICK_KINDS);
  assert.deepEqual(await getClickStats(db, '2026-11-02'), { whatsapp: 1, call: 0, directions: 6, form: 0, instagram: 0 });
  assert.deepEqual(await getClickStats(db, '2026-11-03'), { whatsapp: 0, call: 0, directions: 0, form: 0, instagram: 0 });

  await db.prepare("INSERT INTO clicks (day, kind, count) VALUES ('2026-11-02', 'bogus', 9)").run();
  assert.deepEqual(Object.keys(await getClickStats(db, '2026-11-02')), CLICK_KINDS, 'a kind the site does not know is left out');
});

// ---------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------

test('countPhotos', async (t) => {
  const db = await seededDb(t);
  assert.equal(await countPhotos(db), 31);
  await insertPhoto(db, newPhoto(1));
  assert.equal(await countPhotos(db), 32);
  await db.prepare('DELETE FROM photos').run();
  assert.equal(await countPhotos(db), 0);
});

test('insertPhoto puts the new photo first and returns its row', async (t) => {
  const db = await seededDb(t);
  const row = await insertPhoto(db, newPhoto(1));
  assert.deepEqual(row, {
    id: idOf(1),
    caption: 'Foto 1',
    category: 'diger',
    position: -1,
    source: 'kv',
    seed_path: null,
    image_key: keyOf(1),
    width: 1600,
    height: 1200,
    created_at: 1001,
  });
  const second = await insertPhoto(db, newPhoto(2));
  assert.equal(second.position, -2, 'one before the current minimum');
  assert.deepEqual(await photoIds(db), [idOf(2), idOf(1), ...SEED_IDS]);
  assert.deepEqual(await getPhoto(db, idOf(1)), row);
});

test('insertPhoto starts at position 0 in an empty gallery, and goes one before the first position it finds', async (t) => {
  const db = await seededDb(t);
  await db.prepare('DELETE FROM photos').run();
  assert.equal((await insertPhoto(db, newPhoto(1))).position, 0);
  await db.prepare('UPDATE photos SET position = 7').run();
  assert.equal((await insertPhoto(db, newPhoto(2))).position, 6);
});

test('insertPhoto without a caption or a type uses the defaults of the table', async (t) => {
  const db = await seededDb(t);
  const { caption, category, ...bare } = newPhoto(1);
  const row = await insertPhoto(db, bare);
  assert.equal(row.caption, '');
  assert.equal(row.category, 'dovme');
});

test('getPhoto gives the row, or null', async (t) => {
  const db = await seededDb(t);
  assert.deepEqual(await getPhoto(db, 'seed-gecici-10'), seedRow('seed-gecici-10'));
  assert.equal(await getPhoto(db, 'seed-yok'), null);
  assert.equal(await getPhoto(db, idOf(9)), null);
});

test('updatePhotoMeta changes only what it is given and returns the new row', async (t) => {
  const db = await seededDb(t);
  const before = await getPhoto(db, 'seed-gecici-10');
  assert.deepEqual(await updatePhotoMeta(db, 'seed-gecici-10', { caption: 'Yeni' }), { ...before, caption: 'Yeni' });
  assert.deepEqual(await updatePhotoMeta(db, 'seed-gecici-10', { category: 'piercing' }), { ...before, caption: 'Yeni', category: 'piercing' });
  assert.deepEqual(await updatePhotoMeta(db, 'seed-gecici-10', { caption: 'Üçüncü', category: 'diger' }), { ...before, caption: 'Üçüncü', category: 'diger' });
  assert.deepEqual(await updatePhotoMeta(db, 'seed-gecici-10', { caption: '' }), { ...before, caption: '', category: 'diger' }, 'an empty caption is a caption');
  assert.deepEqual(await updatePhotoMeta(db, 'seed-gecici-10', {}), { ...before, caption: '', category: 'diger' }, 'nothing to change');
  assert.deepEqual(await getPhoto(db, 'seed-gecici-10'), { ...before, caption: '', category: 'diger' });
  assert.deepEqual(await getPhoto(db, 'seed-gecici-02'), seedRow('seed-gecici-02'), 'the others are untouched');
});

test('updatePhotoMeta on an unknown id is null and writes nothing', async (t) => {
  const db = await seededDb(t);
  assert.equal(await updatePhotoMeta(db, idOf(1), { caption: 'x' }), null);
  assert.equal(await updatePhotoMeta(db, 'seed-yok', { category: 'diger' }), null);
  assert.deepEqual(await getContent(db), defaultContent());
});

test('replacePhotoImage turns a seed photo into a stored one and hands back the row from before and after', async (t) => {
  const db = await seededDb(t);
  const before = await getPhoto(db, 'seed-gecici-10');
  const result = await replacePhotoImage(db, 'seed-gecici-10', { image_key: keyOf(7), width: 1200, height: 1600 });
  assert.deepEqual(result.old, before);
  assert.equal(result.old.source, 'seed');
  assert.equal(result.old.seed_path, 'gecici-10');
  assert.deepEqual(result.updated, { ...before, source: 'kv', seed_path: null, image_key: keyOf(7), width: 1200, height: 1600 });
  assert.deepEqual(await getPhoto(db, 'seed-gecici-10'), result.updated);
  assert.deepEqual(await photoIds(db), SEED_IDS, 'it keeps its place');
});

test('replacePhotoImage on a stored photo gives the old image key back, so its KV keys can be deleted', async (t) => {
  const db = await seededDb(t);
  await insertPhoto(db, newPhoto(1));
  const { old, updated } = await replacePhotoImage(db, idOf(1), { image_key: keyOf(2), width: 640, height: 480 });
  assert.equal(old.source, 'kv');
  assert.equal(old.image_key, keyOf(1));
  assert.equal(updated.image_key, keyOf(2));
  assert.deepEqual([updated.width, updated.height], [640, 480]);
  assert.deepEqual([updated.caption, updated.category, updated.position, updated.created_at], [old.caption, old.category, old.position, old.created_at]);
});

test('replacePhotoImage on an unknown id is null and writes nothing', async (t) => {
  const db = await seededDb(t);
  assert.equal(await replacePhotoImage(db, idOf(1), { image_key: keyOf(2), width: 1, height: 1 }), null);
  assert.equal(await replacePhotoImage(db, 'seed-yok', { image_key: keyOf(2), width: 1, height: 1 }), null);
  assert.deepEqual(await getContent(db), defaultContent());
});

test('setPhotoOrder takes exactly the current ids, renumbers them from 0 and says true', async (t) => {
  const db = await seededDb(t);
  await insertPhoto(db, newPhoto(1));
  const ids = (await photoIds(db)).reverse();
  assert.equal(ids.length, 32);
  assert.equal(await setPhotoOrder(db, ids), true);
  const { photos } = await getContent(db);
  assert.deepEqual(photos.map((photo) => photo.id), ids);
  assert.deepEqual(photos.map((photo) => photo.position), ids.map((_, index) => index));

  const shuffled = [ids[3], ids[0], ids[5], ids[1], ids[4], ids[2], ...ids.slice(6)];
  assert.equal(await setPhotoOrder(db, shuffled), true);
  assert.deepEqual(await photoIds(db), shuffled);
});

test('setPhotoOrder says false, and changes nothing, unless it gets exactly the current ids', async (t) => {
  const db = await seededDb(t);
  const before = (await getContent(db)).photos;
  const ids = before.map((photo) => photo.id);
  const attempts = [
    ids.slice(1), // one missing
    ids.slice(2),
    [...ids, idOf(1)], // one extra
    [...ids.slice(1), idOf(1)], // the right size, one unknown
    [ids[0], ...ids.slice(0, -1)], // the right size, one twice and one missing
    [...ids, ids[0]], // one twice, on top
    [],
    [...ids.slice(1), 5],
    [...ids.slice(1), null],
    [...ids.slice(1), undefined],
    [...ids.slice(1), [ids[0]]],
    null,
    undefined,
    ids.join(','),
    'seed-gecici-10',
    { length: ids.length },
    new Set(ids),
  ];
  for (const attempt of attempts) {
    assert.equal(await setPhotoOrder(db, attempt), false, String(attempt));
    assert.deepEqual((await getContent(db)).photos, before, `changed by ${String(attempt)}`);
  }
});

test('setPhotoOrder with no photos at all: an empty list is the current set, anything else is not', async (t) => {
  const db = await seededDb(t);
  await db.prepare('DELETE FROM photos').run();
  const { db: counting, tally } = counted(db);
  assert.equal(await setPhotoOrder(counting, []), true);
  assert.equal(tally.calls, 1, 'it looks, and finds nothing to write');
  assert.equal(await setPhotoOrder(db, [idOf(1)]), false);
});

test('setPhotoOrder sorts a gallery of 400 photos in one go', async (t) => {
  const db = await seededDb(t);
  const insert = (n) =>
    db.prepare("INSERT INTO photos (id, position, source, image_key, width, height, created_at) VALUES (?, ?, 'kv', ?, 10, 10, 0)").bind(idOf(n), n, keyOf(n));
  await db.batch([db.prepare('DELETE FROM photos'), ...Array.from({ length: 400 }, (_, n) => insert(n))]);
  const ids = Array.from({ length: 400 }, (_, n) => idOf(399 - n));
  assert.equal(await setPhotoOrder(db, ids), true);
  assert.deepEqual(await photoIds(db), ids);
});

test('deletePhoto returns the row it removed, and only that row goes', async (t) => {
  const db = await seededDb(t);
  await insertPhoto(db, newPhoto(1));
  const stored = await getPhoto(db, idOf(1));
  assert.deepEqual(await deletePhoto(db, idOf(1)), stored);
  assert.equal(await getPhoto(db, idOf(1)), null);
  assert.deepEqual(await photoIds(db), SEED_IDS);

  const seed = await getPhoto(db, 'seed-gecici-02');
  assert.deepEqual(await deletePhoto(db, 'seed-gecici-02'), seed);
  assert.deepEqual(await photoIds(db), SEED_IDS.filter((id) => id !== 'seed-gecici-02'));
});

test('deletePhoto of an unknown id, or one that was deleted already, is null', async (t) => {
  const db = await seededDb(t);
  assert.equal(await deletePhoto(db, idOf(1)), null);
  assert.deepEqual(await deletePhoto(db, 'seed-gecici-10'), seedRow('seed-gecici-10'));
  assert.equal(await deletePhoto(db, 'seed-gecici-10'), null);
  assert.equal(await countPhotos(db), 30);
});

// ---------------------------------------------------------------------------------------------
// Admin password and login attempts
// ---------------------------------------------------------------------------------------------

test('getAuth on a new database: no password of its own yet, session version 1', async (t) => {
  const db = await seededDb(t);
  assert.deepEqual(await getAuth(db), { hash: null, salt: null, iterations: null, session_version: 1 });
});

test('setPassword stores the hash and raises the session version by one each time', async (t) => {
  const db = await seededDb(t);
  assert.equal(await setPassword(db, { hash: 'h1', salt: 's1', iterations: 10000 }), 2);
  assert.deepEqual(await getAuth(db), { hash: 'h1', salt: 's1', iterations: 10000, session_version: 2 });
  assert.equal(await setPassword(db, { hash: 'h2', salt: 's2', iterations: 12000 }), 3);
  assert.deepEqual(await getAuth(db), { hash: 'h2', salt: 's2', iterations: 12000, session_version: 3 });
  assert.equal(await countRows(db, 'admin_auth'), 1);
});

test('a deleted admin row (the password reset) comes back with a time-based session version, never 1', async (t) => {
  const db = await seededDb(t);
  await setPassword(db, { hash: 'h', salt: 's', iterations: 10000 }); // version 2: tokens with 1 or 2 exist
  await db.prepare('DELETE FROM admin_auth').run();

  const from = Math.floor(Date.now() / 1000);
  const auth = await getAuth(db);
  const to = Math.floor(Date.now() / 1000);
  assert.deepEqual({ hash: auth.hash, salt: auth.salt, iterations: auth.iterations }, { hash: null, salt: null, iterations: null });
  assert.ok(auth.session_version >= from && auth.session_version <= to, `${auth.session_version} is not between ${from} and ${to}`);
  assert.ok(auth.session_version > 2);
  assert.deepEqual(await getAuth(db), auth, 'the restored row stays');
  assert.equal(await countRows(db, 'admin_auth'), 1);
});

test('setPassword does not lose the password when the admin row is gone', async (t) => {
  const db = await seededDb(t);
  await db.prepare('DELETE FROM admin_auth').run();
  const from = Math.floor(Date.now() / 1000);
  const version = await setPassword(db, { hash: 'h', salt: 's', iterations: 10000 });
  const to = Math.floor(Date.now() / 1000);
  assert.ok(version > from && version <= to + 1, `${version} is not just after ${from}`);
  assert.deepEqual(await getAuth(db), { hash: 'h', salt: 's', iterations: 10000, session_version: version });
});

test('the failure window counts only recent rows of that IP', async (t) => {
  const db = await seededDb(t);
  const minute = 60_000;
  const now = Date.UTC(2026, 10, 2, 12, 0, 0);
  await recordFailure(db, '1.1.1.1', now - 20 * minute);
  await recordFailure(db, '1.1.1.1', now - 10 * minute);
  await recordFailure(db, '1.1.1.1', now - minute);
  await recordFailure(db, '2.2.2.2', now - minute);
  assert.equal(await countRecentFailures(db, '1.1.1.1', now - 15 * minute), 2, 'the one 20 minutes ago is outside the window');
  assert.equal(await countRecentFailures(db, '1.1.1.1', now - 30 * minute), 3);
  assert.equal(await countRecentFailures(db, '1.1.1.1', now), 0);
  assert.equal(await countRecentFailures(db, '2.2.2.2', now - 15 * minute), 1);
  assert.equal(await countRecentFailures(db, '3.3.3.3', now - 15 * minute), 0);
});

test('a failure that is exactly sinceMs old still counts', async (t) => {
  const db = await seededDb(t);
  await recordFailure(db, '1.1.1.1', 1_000_000);
  assert.equal(await countRecentFailures(db, '1.1.1.1', 1_000_000), 1);
  assert.equal(await countRecentFailures(db, '1.1.1.1', 1_000_001), 0);
});

test('recordFailure also deletes the rows older than 24 hours, whoever they belong to', async (t) => {
  const db = await seededDb(t);
  const day = 24 * 60 * 60 * 1000;
  const now = 5 * day;
  await recordFailure(db, '9.9.9.9', now - day - 1);
  await recordFailure(db, '8.8.8.8', now - day);
  assert.equal(await countRows(db, 'login_attempts'), 2, 'both are recent from the point of view of their own time');

  await recordFailure(db, '1.1.1.1', now);
  assert.deepEqual(await rows(db, 'SELECT ip FROM login_attempts ORDER BY ip'), [{ ip: '1.1.1.1' }, { ip: '8.8.8.8' }], 'older than 24 hours is gone, exactly 24 hours stays');
});

test('no login-attempt query scans the table: a failed login must not read every row (D1 counts rows read)', async (t) => {
  const db = await seededDb(t);
  const statements = [];
  const spying = {
    ...db,
    prepare(sql) {
      statements.push(sql);
      return db.prepare(sql);
    },
  };
  await recordFailure(spying, '1.1.1.1', 5000);
  await countRecentFailures(spying, '1.1.1.1', 0);
  await clearFailures(spying, '1.1.1.1');
  assert.equal(statements.length, 4, 'the insert and the prune, the count, the clear');

  for (const sql of statements) {
    const placeholders = sql.split('?').length - 1;
    const plan = (await rows(db, `EXPLAIN QUERY PLAN ${sql}`, ...Array(placeholders).fill(1))).map((step) => step.detail).join(' | ');
    assert.doesNotMatch(plan, /\bSCAN\b/, `${sql} -> ${plan}`);
  }
});

test('clearFailures forgets one IP and leaves the others', async (t) => {
  const db = await seededDb(t);
  await recordFailure(db, '1.1.1.1', 1000);
  await recordFailure(db, '1.1.1.1', 2000);
  await recordFailure(db, '2.2.2.2', 3000);
  await clearFailures(db, '1.1.1.1');
  assert.equal(await countRecentFailures(db, '1.1.1.1', 0), 0);
  assert.equal(await countRecentFailures(db, '2.2.2.2', 0), 1);
  await clearFailures(db, '3.3.3.3'); // nothing to forget is fine
  assert.equal(await countRows(db, 'login_attempts'), 1);
});

// ---------------------------------------------------------------------------------------------
// How it talks to D1
// ---------------------------------------------------------------------------------------------

// Counts the calls an operation makes to D1: one for each first/all/run/raw and one for each batch.
// The shim's statements are plain objects, so they are changed in place, which keeps batch() able
// to recognise them. exec() is not allowed at all: the schema goes through batch().
function counted(db) {
  const tally = { calls: 0 };
  const instrument = (statement) => {
    for (const method of ['first', 'all', 'run', 'raw']) {
      const original = statement[method];
      statement[method] = (...args) => {
        tally.calls += 1;
        return original(...args);
      };
    }
    const { bind } = statement;
    statement.bind = (...values) => instrument(bind(...values));
    return statement;
  };
  const wrapper = {
    prepare: (sql) => instrument(db.prepare(sql)),
    batch: (statements) => {
      tally.calls += 1;
      return db.batch(statements);
    },
    exec: () => {
      throw new Error('exec() must not be used');
    },
  };
  return { db: wrapper, tally };
}

test('every operation is one D1 call, however many rows it writes (setPhotoOrder is two: it looks, then writes)', async (t) => {
  const raw = createD1(':memory:');
  t.after(() => raw.close());
  const { db, tally } = counted(raw);

  const services = Array.from({ length: 12 }, (_, index) => ({ name: `Hizmet ${index}`, description: 'açıklama' }));
  const groups = Array.from({ length: 6 }, (_, group) => ({
    title: `Grup ${group}`,
    items: Array.from({ length: 12 }, (__, item) => ({ name: `Kalem ${item}`, detail: 'ayrıntı', price: "1.500₺'den" })),
  }));
  const reviews = Array.from({ length: 30 }, (_, index) => ({ name: `Kişi ${index}`, rating: 5, text: 'Güzel', source: 'google', date_text: '' }));

  const steps = [
    ['ensureSchema, the first time (schema and seeds)', 1, () => ensureSchema(db)],
    ['ensureSchema, once it is done', 0, () => ensureSchema(db)],
    ['getContent', 1, () => getContent(db)],
    ['updateSettings', 1, () => updateSettings(db, { hero_title: 'a', hero_text: 'b', phone: '0537 263 15 46' })],
    ['updateSettings with nothing to save', 0, () => updateSettings(db, {})],
    ['replaceServices (12)', 1, () => replaceServices(db, services)],
    ['replacePrices (6 groups of 12 items)', 1, () => replacePrices(db, groups)],
    ['replaceReviews (30)', 1, () => replaceReviews(db, reviews, 1)],
    ['incrementClick', 1, () => incrementClick(db, '2026-11-02', 'call')],
    ['getClickStats', 1, () => getClickStats(db, '2026-11-01')],
    ['countPhotos', 1, () => countPhotos(db)],
    ['insertPhoto', 1, () => insertPhoto(db, newPhoto(1))],
    ['getPhoto', 1, () => getPhoto(db, idOf(1))],
    ['updatePhotoMeta', 1, () => updatePhotoMeta(db, idOf(1), { caption: 'x', category: 'dovme' })],
    ['replacePhotoImage', 1, () => replacePhotoImage(db, idOf(1), { image_key: keyOf(2), width: 1, height: 1 })],
    [
      'setPhotoOrder',
      2,
      async () => assert.equal(await setPhotoOrder(db, (await photoIds(raw)).reverse()), true),
    ],
    ['deletePhoto', 1, () => deletePhoto(db, idOf(1))],
    ['getHero', 1, () => getHero(db)],
    ['setHero', 1, () => setHero(db, KV_HERO)],
    ['getAuth', 1, () => getAuth(db)],
    ['setPassword', 1, () => setPassword(db, { hash: 'h', salt: 's', iterations: 10000 })],
    ['countRecentFailures', 1, () => countRecentFailures(db, '1.1.1.1', 0)],
    ['recordFailure', 1, () => recordFailure(db, '1.1.1.1', 5000)],
    ['clearFailures', 1, () => clearFailures(db, '1.1.1.1')],
  ];
  for (const [label, expected, run] of steps) {
    tally.calls = 0;
    await run();
    assert.equal(tally.calls, expected, label);
  }
});

test('only insertPhoto writes a plain INSERT INTO photos: the upload API’s fault-injection test depends on it', async (t) => {
  const raw = createD1(':memory:');
  t.after(() => raw.close());
  const plainInsert = /^\s*INSERT\s+INTO\s+photos\b/i;
  const failing = {
    ...raw,
    prepare(sql) {
      if (plainInsert.test(sql)) throw new Error('disk full');
      return raw.prepare(sql);
    },
  };
  await ensureSchema(failing); // the seed photos go in with INSERT OR IGNORE, so this passes
  assert.equal(await countRows(raw, 'photos'), SEED_PHOTOS.length);
  await assert.rejects(insertPhoto(failing, newPhoto(1)), /disk full/);
  assert.equal(await countRows(raw, 'photos'), SEED_PHOTOS.length, 'nothing was written');
});
