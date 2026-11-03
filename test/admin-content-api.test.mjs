import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getContent } from '../functions/_lib/db.js';
import { DEFAULT_SETTINGS } from '../functions/_lib/defaults.js';
import { SETTINGS_FIELDS } from '../functions/_lib/fields.js';
import { api, assertError, freshEnv, SITE } from './admin-helpers.mjs';
import { loginCookie } from './helpers.mjs';

const REFUSED = 'İstek reddedildi. Sayfayı yenileyip tekrar dene.';
const SIGNED_OUT = 'Oturum kapandı. Tekrar giriş yap.';
const UNREADABLE = 'İstek okunamadı.';

// An env and the cookie of a signed-in owner.
async function signedIn(t) {
  const env = freshEnv(t);
  return { env, cookie: await loginCookie(env) };
}

const put = (env, cookie, path, json) => api(env, 'PUT', path, { cookie, json });

// The settings as the panel gets them: the defaults, with the two lists as arrays.
const defaultSettings = () => Object.fromEntries(SETTINGS_FIELDS.map(({ key, kind }) => [key, kind === 'list' ? JSON.parse(DEFAULT_SETTINGS[key]) : DEFAULT_SETTINGS[key]]));

const stateOf = async (env, cookie) => (await api(env, 'GET', 'state', { cookie })).json();

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

test('PUT settings saves what is sent and answers with every setting the way the panel edits it', async (t) => {
  const { env, cookie } = await signedIn(t);
  const response = await put(env, cookie, 'settings', { hero_title: 'Yeni başlık', phone: '0532 111 22 33', announcement_on: '1', announcement_text: 'Bugün açığız' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const expected = { ...defaultSettings(), hero_title: 'Yeni başlık', phone: '0532 111 22 33', announcement_on: '1', announcement_text: 'Bugün açığız' };
  assert.deepEqual(await response.json(), { settings: expected });

  const stored = (await getContent(env.DB)).settings;
  assert.equal(stored.hero_title, 'Yeni başlık');
  assert.equal(stored.phone, '0532 111 22 33');
  assert.equal(stored.about_title, DEFAULT_SETTINGS.about_title, 'what was not sent is untouched');
  assert.deepEqual((await stateOf(env, cookie)).settings, expected, 'the state shows the same');
});

test('PUT settings: a list is an array of strings, kept in order and stored as JSON; an emptied list stays empty', async (t) => {
  const { env, cookie } = await signedIn(t);
  const response = await put(env, cookie, 'settings', { highlights: ['  Bir ', 'İki', ''], hero_points: [] });
  assert.equal(response.status, 200);
  const { settings } = await response.json();
  assert.deepEqual(settings.highlights, ['Bir', 'İki']);
  assert.deepEqual(settings.hero_points, []);

  const stored = (await getContent(env.DB)).settings;
  assert.equal(stored.highlights, '["Bir","İki"]');
  assert.equal(stored.hero_points, '[]');
});

test('PUT settings: a string for a list, or an array for a text, is refused with the field’s name', async (t) => {
  const { env, cookie } = await signedIn(t);
  const before = (await getContent(env.DB)).settings;
  await assertError(await put(env, cookie, 'settings', { highlights: 'Bir, İki' }), 400, 'Öne çıkanlar geçersiz.');
  await assertError(await put(env, cookie, 'settings', { hero_points: ['Bir', 2] }), 400, 'Giriş maddeleri geçersiz.');
  await assertError(await put(env, cookie, 'settings', { hero_title: ['Yeni'] }), 400, 'Giriş başlığı geçersiz.');
  await assertError(await put(env, cookie, 'settings', { hero_title: 5 }), 400, 'Giriş başlığı geçersiz.');
  assert.deepEqual((await getContent(env.DB)).settings, before, 'nothing was saved');
});

test('PUT settings: an invalid value answers with the Turkish message of the field, and nothing is saved, not even the valid fields sent with it', async (t) => {
  const { env, cookie } = await signedIn(t);
  const cases = [
    [{ phone: 'abc' }, 'Telefon geçerli değil.'],
    [{ hero_title: '   ' }, 'Giriş başlığı boş bırakılamaz.'],
    [{ hero_title: 'x'.repeat(81) }, 'Giriş başlığı en fazla 80 karakter olabilir.'],
    [{ instagram_url: 'http://instagram.com/cinar' }, 'Instagram adresi https:// ile başlamalı.'],
    [{ email: 'adres' }, 'E-posta geçerli değil.'],
    [{ announcement_on: '2' }, 'Duyuru geçersiz.'],
    [{ highlights: Array.from({ length: 9 }, (_, index) => `Madde ${index}`) }, 'Öne çıkanlar en fazla 8 madde olabilir.'],
    [{ hero_title: 'Değişti', phone: 'abc' }, 'Telefon geçerli değil.'],
  ];
  for (const [body, message] of cases) await assertError(await put(env, cookie, 'settings', body), 400, message, JSON.stringify(body).slice(0, 60));
  assert.equal((await getContent(env.DB)).settings.hero_title, DEFAULT_SETTINGS.hero_title);
  assert.equal((await getContent(env.DB)).settings.phone, DEFAULT_SETTINGS.phone);
});

test('PUT settings: only the keys of the settings form may be sent; the hero image has its own endpoint', async (t) => {
  const { env, cookie } = await signedIn(t);
  await assertError(await put(env, cookie, 'settings', { hero_image: '{"source":"seed","seed_path":"x","width":1,"height":1}' }), 400, 'Bilinmeyen alan: hero_image');
  await assertError(await put(env, cookie, 'settings', { hero_title: 'Yeni', zzz: 'x' }), 400, 'Bilinmeyen alan: zzz');
  await assertError(await put(env, cookie, 'settings', { constructor: 'x' }), 400, 'Bilinmeyen alan: constructor');
  assert.equal((await getContent(env.DB)).settings.hero_title, DEFAULT_SETTINGS.hero_title);
  assert.deepEqual((await getContent(env.DB)).hero, { source: 'seed', seed_path: 'logo', width: 1254, height: 1254 });
});

test('PUT settings: a text is trimmed and cleaned like the validators do; an empty patch changes nothing', async (t) => {
  const { env, cookie } = await signedIn(t);
  const response = await put(env, cookie, 'settings', { seo_title: '  Esenler’de\n  dövme  ' });
  assert.equal((await response.json()).settings.seo_title, 'Esenler’de dövme');

  const nothing = await put(env, cookie, 'settings', {});
  assert.equal(nothing.status, 200);
  assert.equal((await nothing.json()).settings.seo_title, 'Esenler’de dövme');
});

test('PUT settings: a body that is not an object, not JSON or empty is 400 "İstek okunamadı."', async (t) => {
  const { env, cookie } = await signedIn(t);
  for (const body of ['[]', '"hero_title"', 'null', '5', 'true', '{', '', 'hero_title=Yeni']) {
    await assertError(await api(env, 'PUT', 'settings', { cookie, body }), 400, UNREADABLE, JSON.stringify(body));
  }
  await assertError(await api(env, 'PUT', 'settings', { cookie, body: 'x'.repeat(70000) }), 413, 'İstek çok büyük.');
});

// ---------------------------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------------------------

const SERVICES = [
  { name: 'Piercing', description: 'Kulak, burun, göbek.' },
  { name: 'Kalıcı dövme', description: '' },
  { name: 'Dövme malzemeleri', description: 'Boya, iğne ve bakım ürünleri.' },
];

test('PUT services replaces the whole list and keeps the order it was sent in', async (t) => {
  const { env, cookie } = await signedIn(t);
  const response = await put(env, cookie, 'services', { services: SERVICES });
  assert.equal(response.status, 200);
  const { services } = await response.json();
  assert.deepEqual(services.map(({ name, description }) => ({ name, description })), SERVICES);
  assert.ok(services.every(({ id }) => Number.isInteger(id)), 'as the state has them, with their ids');

  assert.deepEqual((await getContent(env.DB)).services, services, 'what is stored is what was answered');
  assert.deepEqual((await stateOf(env, cookie)).services, services);

  const reversed = await (await put(env, cookie, 'services', { services: [...SERVICES].reverse() })).json();
  assert.deepEqual(reversed.services.map(({ name }) => name), ['Dövme malzemeleri', 'Kalıcı dövme', 'Piercing']);
});

test('PUT services: 1 to 12 services, each with a name; the messages are the validators’', async (t) => {
  const { env, cookie } = await signedIn(t);
  const twelve = Array.from({ length: 12 }, (_, index) => ({ name: `Hizmet ${index}`, description: '' }));
  assert.equal((await put(env, cookie, 'services', { services: twelve })).status, 200);

  await assertError(await put(env, cookie, 'services', { services: [] }), 400, 'En az bir hizmet olmalı.');
  await assertError(await put(env, cookie, 'services', { services: [...twelve, { name: 'On üçüncü', description: '' }] }), 400, 'En fazla 12 hizmet eklenebilir.');
  await assertError(await put(env, cookie, 'services', { services: [{ name: ' ', description: 'x' }] }), 400, 'Hizmet adı boş bırakılamaz.');
  await assertError(await put(env, cookie, 'services', { services: [{ name: 'x'.repeat(41), description: '' }] }), 400, 'Hizmet adı en fazla 40 karakter olabilir.');
  await assertError(await put(env, cookie, 'services', { services: [{ name: 'Ad', description: 'x'.repeat(121) }] }), 400, 'Hizmet açıklaması en fazla 120 karakter olabilir.');
  assert.equal((await getContent(env.DB)).services.length, 12, 'a refused list leaves the stored one alone');
});

test('PUT services: a body without the list, with something else than a list, or with items that are not objects is 400 "İstek okunamadı."', async (t) => {
  const { env, cookie } = await signedIn(t);
  const bad = [{}, { services: 'Piercing' }, { services: { name: 'x' } }, { services: ['Piercing'] }, { services: [{ name: 5, description: '' }] }, { hizmetler: SERVICES }, [], null];
  for (const json of bad) await assertError(await put(env, cookie, 'services', json), 400, UNREADABLE, JSON.stringify(json));
  assert.deepEqual((await stateOf(env, cookie)).services.map(({ name }) => name), ['Kalıcı dövme', 'Geçici dövme', 'Piercing', 'Dövme malzemeleri']);
});

// ---------------------------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------------------------

const GROUPS = [
  { title: 'Dövme', items: [{ name: 'Minimal yazı', detail: 'El bileği', price: '1.500₺’den' }, { name: 'Küçük figür', detail: '', price: 'Teklif al' }] },
  { title: 'Piercing', items: [{ name: 'Kulak', detail: '', price: '500₺' }] },
];

test('PUT prices replaces the groups and their items in the order sent, and answers with them as the state has them', async (t) => {
  const { env, cookie } = await signedIn(t);
  const response = await put(env, cookie, 'prices', { groups: GROUPS });
  assert.equal(response.status, 200);
  const expected = [
    { id: 1, title: 'Dövme', items: [{ id: 1, ...GROUPS[0].items[0] }, { id: 2, ...GROUPS[0].items[1] }] },
    { id: 2, title: 'Piercing', items: [{ id: 3, ...GROUPS[1].items[0] }] },
  ];
  assert.deepEqual(await response.json(), { prices: expected });
  assert.deepEqual((await getContent(env.DB)).prices, expected);

  const swapped = await (await put(env, cookie, 'prices', { groups: [GROUPS[1], GROUPS[0]] })).json();
  assert.deepEqual(swapped.prices.map(({ title }) => title), ['Piercing', 'Dövme']);
  assert.deepEqual(swapped.prices[1].items.map(({ name }) => name), ['Minimal yazı', 'Küçük figür']);
});

test('PUT prices: an empty list empties the section; a group without items is fine', async (t) => {
  const { env, cookie } = await signedIn(t);
  await put(env, cookie, 'prices', { groups: GROUPS });
  assert.deepEqual(await (await put(env, cookie, 'prices', { groups: [] })).json(), { prices: [] });
  assert.deepEqual((await stateOf(env, cookie)).prices, []);

  const bare = await (await put(env, cookie, 'prices', { groups: [{ title: 'Geçici dövme' }] })).json();
  assert.deepEqual(bare.prices.map(({ title, items }) => ({ title, items })), [{ title: 'Geçici dövme', items: [] }]);
});

test('PUT prices: a 7th group, a 13th item and over-long or empty names answer with the exact message, and nothing is replaced', async (t) => {
  const { env, cookie } = await signedIn(t);
  await put(env, cookie, 'prices', { groups: GROUPS });
  const group = (title) => ({ title, items: [] });
  const item = (index) => ({ name: `Kalem ${index}`, detail: '', price: '' });

  assert.equal((await put(env, cookie, 'prices', { groups: Array.from({ length: 6 }, (_, index) => group(`Grup ${index}`)) })).status, 200, 'six groups are allowed');
  await put(env, cookie, 'prices', { groups: GROUPS });
  const cases = [
    [{ groups: Array.from({ length: 7 }, (_, index) => group(`Grup ${index}`)) }, 'En fazla 6 fiyat grubu olabilir.'],
    [{ groups: [{ title: 'Dövme', items: Array.from({ length: 13 }, (_, index) => item(index)) }] }, 'Bir grupta en fazla 12 kalem olabilir.'],
    [{ groups: [{ title: '', items: [] }] }, 'Grup adı boş bırakılamaz.'],
    [{ groups: [{ title: 'x'.repeat(31), items: [] }] }, 'Grup adı en fazla 30 karakter olabilir.'],
    [{ groups: [{ title: 'Dövme', items: [{ name: '', detail: '', price: '' }] }] }, 'Kalem adı boş bırakılamaz.'],
    [{ groups: [{ title: 'Dövme', items: [{ name: 'x'.repeat(41), detail: '', price: '' }] }] }, 'Kalem adı en fazla 40 karakter olabilir.'],
    [{ groups: [{ title: 'Dövme', items: [{ name: 'Ad', detail: 'x'.repeat(61), price: '' }] }] }, 'Açıklama en fazla 60 karakter olabilir.'],
    [{ groups: [{ title: 'Dövme', items: [{ name: 'Ad', detail: '', price: 'x'.repeat(25) }] }] }, 'Fiyat en fazla 24 karakter olabilir.'],
  ];
  for (const [body, message] of cases) await assertError(await put(env, cookie, 'prices', body), 400, message);
  assert.deepEqual((await getContent(env.DB)).prices.map(({ title }) => title), ['Dövme', 'Piercing']);
});

test('PUT prices: the body must have a list called groups', async (t) => {
  const { env, cookie } = await signedIn(t);
  for (const json of [{}, { groups: 'Dövme' }, { groups: {} }, { groups: [null] }, { groups: [{ title: 'Dövme', items: 'x' }] }, { prices: GROUPS }, []]) {
    await assertError(await put(env, cookie, 'prices', json), 400, UNREADABLE, JSON.stringify(json));
  }
});

// ---------------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------------

const REVIEWS = [
  { name: 'Ayşe K.', rating: 5, text: 'Çok memnun kaldım.\nTeşekkürler.', source: 'google', date_text: 'Ekim 2026' },
  { name: 'Mehmet', rating: 4, text: 'Güler yüzlü.', source: 'instagram', date_text: '' },
];

test('PUT reviews replaces the list in the order sent and answers with it as the state has it; the 13 seeded ones are gone', async (t) => {
  const { env, cookie } = await signedIn(t);
  assert.equal((await stateOf(env, cookie)).reviews.length, 13);
  const response = await put(env, cookie, 'reviews', { reviews: REVIEWS });
  assert.equal(response.status, 200);
  const { reviews } = await response.json();
  assert.deepEqual(reviews.map(({ id, ...review }) => review), REVIEWS);
  assert.ok(reviews.every(({ id }) => Number.isInteger(id)));
  assert.deepEqual((await getContent(env.DB)).reviews, reviews);

  const reversed = await (await put(env, cookie, 'reviews', { reviews: [...REVIEWS].reverse() })).json();
  assert.deepEqual(reversed.reviews.map(({ name }) => name), ['Mehmet', 'Ayşe K.']);
});

test('PUT reviews: an empty list empties the section', async (t) => {
  const { env, cookie } = await signedIn(t);
  assert.deepEqual(await (await put(env, cookie, 'reviews', { reviews: [] })).json(), { reviews: [] });
  assert.deepEqual((await stateOf(env, cookie)).reviews, []);
});

test('PUT reviews: a rating of 6, an unknown source, 31 reviews and the like answer with the exact message, and nothing is replaced', async (t) => {
  const { env, cookie } = await signedIn(t);
  const review = (changes) => ({ ...REVIEWS[0], ...changes });
  const cases = [
    [[review({ rating: 6 })], 'Puan 1 ile 5 arasında olmalı.'],
    [[review({ rating: 0 })], 'Puan 1 ile 5 arasında olmalı.'],
    [[review({ rating: 4.5 })], 'Puan 1 ile 5 arasında olmalı.'],
    [[review({ rating: '5' })], 'Puan 1 ile 5 arasında olmalı.'],
    [[review({ source: 'yelp' })], 'Kaynak geçersiz.'],
    [[review({ name: '' })], 'Yorumcu adı boş bırakılamaz.'],
    [[review({ text: ' ' })], 'Yorum metni boş bırakılamaz.'],
    [[review({ text: 'x'.repeat(401) })], 'Yorum metni en fazla 400 karakter olabilir.'],
    [[review({ date_text: 'x'.repeat(21) })], 'Tarih en fazla 20 karakter olabilir.'],
    [Array.from({ length: 31 }, () => REVIEWS[0]), 'En fazla 30 yorum eklenebilir.'],
  ];
  for (const [reviews, message] of cases) await assertError(await put(env, cookie, 'reviews', { reviews }), 400, message);
  assert.equal((await getContent(env.DB)).reviews.length, 13);
  assert.equal((await put(env, cookie, 'reviews', { reviews: Array.from({ length: 30 }, () => REVIEWS[0]) })).status, 200, 'thirty are allowed');
});

test('PUT reviews: the body must have a list called reviews', async (t) => {
  const { env, cookie } = await signedIn(t);
  for (const json of [{}, { reviews: 'iyi' }, { reviews: [null] }, { reviews: [{ name: 5, rating: 5, text: 'x', source: 'google' }] }, { yorumlar: REVIEWS }, []]) {
    await assertError(await put(env, cookie, 'reviews', json), 400, UNREADABLE, JSON.stringify(json));
  }
});

test('PUT reviews gives every review the time of the save as its created_at', async (t) => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const { env, cookie } = await signedIn(t);
  await put(env, cookie, 'reviews', { reviews: REVIEWS });
  const { results } = await env.DB.prepare('SELECT created_at FROM reviews').all();
  assert.deepEqual(results, [{ created_at: now }, { created_at: now }]);
});

// ---------------------------------------------------------------------------------------------
// The summary of the clicks
// ---------------------------------------------------------------------------------------------

const addClicks = (env, day, kind, count) => env.DB.prepare('INSERT INTO clicks (day, kind, count) VALUES (?, ?, ?)').bind(day, kind, count).run();

test('GET stats: the days of the summary and a total per kind, 0 where nothing was counted', async (t) => {
  const { env, cookie } = await signedIn(t);
  const response = await api(env, 'GET', 'stats', { cookie });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { days: 30, totals: { whatsapp: 0, call: 0, directions: 0, form: 0, instagram: 0 } });
});

test('GET stats adds up the clicks of today in Istanbul and the 29 days before it, and nothing older', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-15T21:30:00Z') }); // 16 Nov, 00:30 in Istanbul
  const { env, cookie } = await signedIn(t);
  await addClicks(env, '2026-10-17', 'whatsapp', 100); // the day before the first one
  await addClicks(env, '2026-10-18', 'whatsapp', 3);
  await addClicks(env, '2026-10-18', 'call', 2);
  await addClicks(env, '2026-11-01', 'call', 1);
  await addClicks(env, '2026-11-16', 'call', 4);
  await addClicks(env, '2026-11-16', 'form', 1);
  await addClicks(env, '2026-11-16', 'instagram', 7);

  assert.deepEqual(await (await api(env, 'GET', 'stats', { cookie })).json(), {
    days: 30,
    totals: { whatsapp: 3, call: 7, directions: 0, form: 1, instagram: 7 },
  });

  t.mock.timers.tick(24 * 60 * 60 * 1000); // a day later, 17 Nov in Istanbul: the 18th of October drops out
  await addClicks(env, '2026-11-17', 'directions', 5);
  assert.deepEqual((await (await api(env, 'GET', 'stats', { cookie })).json()).totals, { whatsapp: 0, call: 5, directions: 5, form: 1, instagram: 7 });
});

// ---------------------------------------------------------------------------------------------
// Who may use them
// ---------------------------------------------------------------------------------------------

const ROUTES = [
  ['PUT', 'settings', { hero_title: 'Yeni başlık' }],
  ['PUT', 'services', { services: SERVICES }],
  ['PUT', 'prices', { groups: GROUPS }],
  ['PUT', 'reviews', { reviews: REVIEWS }],
  ['GET', 'stats', undefined],
];

test('every content route needs the session: without a cookie it is 401 and nothing is saved', async (t) => {
  const env = freshEnv(t);
  for (const [method, path, json] of ROUTES) await assertError(await api(env, method, path, { json }), 401, SIGNED_OUT, `${method} ${path}`);
  await assertError(await api(env, 'PUT', 'settings', { json: { hero_title: 'x' }, cookie: 'cinar_admin=abc' }), 401, SIGNED_OUT, 'a cookie that is not a token');
  const content = await getContent(env.DB);
  assert.equal(content.settings.hero_title, DEFAULT_SETTINGS.hero_title);
  assert.equal(content.reviews.length, 13);
  assert.deepEqual(content.prices, []);
});

test('a PUT without the site’s Origin, or with a foreign one, is 403 before the session is looked at; a GET with a foreign Origin too', async (t) => {
  const { env, cookie } = await signedIn(t);
  for (const [method, path, json] of ROUTES) {
    for (const origin of method === 'GET' ? ['https://evil.test'] : [null, 'https://evil.test', 'null']) {
      await assertError(await api(env, method, path, { json, cookie, origin }), 403, REFUSED, `${method} ${path} from ${origin}`);
      await assertError(await api(env, method, path, { json, origin }), 403, REFUSED, `${method} ${path} from ${origin}, without a cookie`);
    }
  }
  assert.equal((await getContent(env.DB)).settings.hero_title, DEFAULT_SETTINGS.hero_title);
});

test('another method on a content route is 405 with an Allow header', async (t) => {
  const { env, cookie } = await signedIn(t);
  const wrong = [['GET', 'settings', 'PUT'], ['POST', 'settings', 'PUT'], ['DELETE', 'services', 'PUT'], ['PATCH', 'prices', 'PUT'], ['GET', 'reviews', 'PUT'], ['POST', 'stats', 'GET'], ['PUT', 'stats', 'GET']];
  for (const [method, path, allow] of wrong) {
    const response = await api(env, method, path, { cookie, origin: SITE });
    await assertError(response, 405, 'Bu istek desteklenmiyor.', `${method} ${path}`);
    assert.equal(response.headers.get('Allow'), allow, `${method} ${path}`);
  }
});
