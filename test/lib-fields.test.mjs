import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../functions/_lib/defaults.js';
import {
  CAPTION_MAX,
  CATEGORIES,
  CATEGORY_LABELS,
  CLICK_KINDS,
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
  validateCaption,
  validatePrices,
  validateReviews,
  validateServices,
  validateSettingsPatch,
} from '../functions/_lib/fields.js';

const UNREADABLE = 'İstek okunamadı.';

// The result of a validator that must have accepted its input.
function accepted(result) {
  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
  return result;
}

// The message of a validator that must have turned its input down.
function rejected(result) {
  assert.equal(result.ok, false, `expected a rejection, got ${JSON.stringify(result)}`);
  assert.deepEqual(Object.keys(result).sort(), ['message', 'ok']);
  return result.message;
}

const patchOf = validateSettingsPatch; // a short name for the many calls below
const chars = (length) => 'x'.repeat(length);

// ---------------------------------------------------------------------------------------------
// The tables
// ---------------------------------------------------------------------------------------------

const EXPECTED_FIELDS = [
  // key, label, kind, max, required
  ['seo_title', 'Sayfa başlığı', 'text', 70, true],
  ['seo_description', 'Google açıklaması', 'text', 170, true],
  ['hero_title', 'Giriş başlığı', 'multiline', 80, true], // multiline since Task 6: its line breaks are the H1's lines
  ['hero_text', 'Giriş metni', 'text', 160, false],
  ['about_title', 'Hakkında başlığı', 'text', 40, true],
  ['about_text', 'Hakkında metni', 'multiline', 600, false],
  ['hours', 'Çalışma saati', 'text', 40, true],
  ['hours_note', 'Saat notu', 'text', 80, false],
  ['address', 'Adres', 'multiline', 200, true],
  ['phone', 'Telefon', 'phone', 25, true],
  ['whatsapp', 'WhatsApp numarası', 'phone', 25, false],
  ['instagram_url', 'Instagram adresi', 'url', 200, false],
  ['maps_url', 'Google Haritalar bağlantısı', 'url', 500, false],
  ['announcement_text', 'Duyuru metni', 'text', 140, false],
  ['announcement_on', 'Duyuru', 'flag', 1, true],
  ['highlights', 'Öne çıkanlar', 'list', 80, false],
  ['hero_points', 'Giriş maddeleri', 'list', 60, false],
  ['payment_text', 'Ödeme bilgisi', 'text', 60, false],
  ['instagram_followers', 'Instagram takipçi sayısı', 'text', 20, false],
  ['google_reviews_url', 'Google yorumları bağlantısı', 'url', 500, false],
  ['tiktok_url', 'TikTok adresi', 'url', 200, false],
  ['email', 'E-posta', 'email', 100, false],
];

test('SETTINGS_FIELDS lists every setting with its label, kind, limit and required flag', () => {
  assert.deepEqual(
    SETTINGS_FIELDS.map((field) => [field.key, field.label, field.kind, field.max, field.required]),
    EXPECTED_FIELDS,
  );
});

test('every field carries its default, and only the list kinds carry an item limit', () => {
  for (const field of SETTINGS_FIELDS) {
    assert.equal(typeof field.default, 'string', field.key);
    assert.equal(field.default, DEFAULT_SETTINGS[field.key], field.key);
    const keys = Object.keys(field).sort();
    assert.deepEqual(keys, field.kind === 'list' ? ['default', 'key', 'kind', 'label', 'max', 'maxItems', 'required'] : ['default', 'key', 'kind', 'label', 'max', 'required']);
  }
  assert.deepEqual(
    SETTINGS_FIELDS.filter((field) => field.kind === 'list').map((field) => [field.key, field.maxItems, field.max]),
    [['highlights', 8, 80], ['hero_points', 4, 60]],
  );
});

test('SETTINGS_FIELDS has a field for every default and nothing else, and goes through JSON unchanged', () => {
  assert.deepEqual(SETTINGS_FIELDS.map((field) => field.key).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  assert.deepEqual(JSON.parse(JSON.stringify(SETTINGS_FIELDS)), SETTINGS_FIELDS);
});

test('SETTINGS_GROUPS are in admin order, and the Google reviews link sits on the reviews tab', () => {
  assert.deepEqual(SETTINGS_GROUPS, [
    { id: 'hero', title: 'Giriş', tab: 'texts', keys: ['hero_title', 'hero_text'] },
    { id: 'highlights', title: 'Öne çıkanlar', tab: 'texts', keys: ['highlights'] },
    { id: 'about', title: 'Hakkında', tab: 'texts', keys: ['about_title', 'about_text'] },
    { id: 'visit', title: 'Ziyaret', tab: 'texts', keys: ['hours', 'hours_note', 'address', 'phone', 'whatsapp', 'instagram_url', 'maps_url'] },
    { id: 'contact', title: 'İletişim ekleri', tab: 'texts', keys: ['payment_text', 'instagram_followers', 'tiktok_url', 'email'] },
    { id: 'announcement', title: 'Duyuru', tab: 'texts', keys: ['announcement_text', 'announcement_on'] },
    { id: 'seo', title: 'Google’da görünüm', tab: 'texts', keys: ['seo_title', 'seo_description'] },
    { id: 'reviews_link', title: 'Google yorumları bağlantısı', tab: 'reviews', keys: ['google_reviews_url'] },
  ]);
});

test('every setting the page shows belongs to exactly one group', () => {
  const grouped = SETTINGS_GROUPS.flatMap((group) => group.keys);
  assert.equal(new Set(grouped).size, grouped.length, 'a key is in two groups');
  assert.deepEqual([...grouped].sort(), SETTINGS_FIELDS.map((field) => field.key).filter((key) => key !== 'hero_points').sort());
});

test('the panel does not offer hero_points: the Dergi hero shows no points, so editing them would change nothing', () => {
  assert.equal(SETTINGS_GROUPS.some((group) => group.keys.includes('hero_points')), false);
  // The key stays a valid setting (old saves and API calls keep working); only the form is gone.
  assert.ok(SETTINGS_FIELDS.some((field) => field.key === 'hero_points'));
});

test('categories, review sources and click kinds', () => {
  assert.deepEqual(CATEGORIES, ['dovme', 'gecici', 'piercing', 'kulak', 'diger']);
  assert.deepEqual(CATEGORY_LABELS, { dovme: 'Kalıcı dövme', gecici: 'Geçici dövme', piercing: 'Piercing', kulak: 'Kulak delme', diger: 'Diğer' });
  assert.deepEqual(REVIEW_SOURCES, ['google', 'instagram', 'diger']);
  assert.deepEqual(REVIEW_SOURCE_LABELS, { google: 'Google', instagram: 'Instagram', diger: 'Diğer' });
  assert.deepEqual(CLICK_KINDS, ['whatsapp', 'call', 'directions', 'form', 'instagram']);
  for (const [values, labels] of [[CATEGORIES, CATEGORY_LABELS], [REVIEW_SOURCES, REVIEW_SOURCE_LABELS]]) {
    assert.deepEqual(Object.keys(labels), values, 'every value has a label, in the same order');
  }
});

test('the exported limits are the numbers the rules use', () => {
  assert.deepEqual(
    {
      MAX_SERVICES, SERVICE_NAME_MAX, SERVICE_DESCRIPTION_MAX,
      MAX_PRICE_GROUPS, PRICE_GROUP_TITLE_MAX, MAX_PRICE_ITEMS, PRICE_ITEM_NAME_MAX, PRICE_ITEM_DETAIL_MAX, PRICE_ITEM_PRICE_MAX,
      MAX_REVIEWS, REVIEW_NAME_MAX, REVIEW_TEXT_MAX, REVIEW_DATE_MAX,
      CAPTION_MAX,
    },
    {
      MAX_SERVICES: 12, SERVICE_NAME_MAX: 40, SERVICE_DESCRIPTION_MAX: 120,
      MAX_PRICE_GROUPS: 6, PRICE_GROUP_TITLE_MAX: 30, MAX_PRICE_ITEMS: 12, PRICE_ITEM_NAME_MAX: 40, PRICE_ITEM_DETAIL_MAX: 60, PRICE_ITEM_PRICE_MAX: 24,
      MAX_REVIEWS: 30, REVIEW_NAME_MAX: 40, REVIEW_TEXT_MAX: 400, REVIEW_DATE_MAX: 20,
      CAPTION_MAX: 120,
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

test('validateSettingsPatch: unknown key, too long, required, phone, url, flag messages', () => {
  assert.equal(rejected(patchOf({ nope: 'x' })), 'Bilinmeyen alan: nope');
  assert.equal(rejected(patchOf({ hero_title: chars(81) })), 'Giriş başlığı en fazla 80 karakter olabilir.');
  assert.equal(rejected(patchOf({ hero_title: '' })), 'Giriş başlığı boş bırakılamaz.');
  assert.equal(rejected(patchOf({ phone: 'abc' })), 'Telefon geçerli değil.');
  assert.equal(rejected(patchOf({ instagram_url: 'http://instagram.com/x' })), 'Instagram adresi https:// ile başlamalı.');
  assert.equal(rejected(patchOf({ announcement_on: '2' })), 'Duyuru geçersiz.');
  assert.equal(rejected(patchOf({ email: 'onur' })), 'E-posta geçerli değil.');
});

test('validateSettingsPatch accepts a patch of valid values and returns only the keys it was given', () => {
  const { values } = accepted(
    patchOf({ hero_title: 'Yeni başlık', phone: '0 (537) 263 15 46', announcement_on: '1', highlights: ['a', 'b'], email: 'onur@example.com' }),
  );
  assert.deepEqual(values, {
    hero_title: 'Yeni başlık',
    phone: '0 (537) 263 15 46', // kept as typed: only the links normalise it
    announcement_on: '1',
    highlights: '["a","b"]',
    email: 'onur@example.com',
  });
  assert.deepEqual(accepted(patchOf({})).values, {});
});

test('validateSettingsPatch turns a whole patch down for one bad value or one unknown key', () => {
  assert.equal(rejected(patchOf({ hero_title: 'ok', hero_text: chars(161) })), 'Giriş metni en fazla 160 karakter olabilir.');
  assert.equal(rejected(patchOf({ hero_title: 'ok', nope: 'x' })), 'Bilinmeyen alan: nope');
  // The unknown key is reported first, even when a field before it is wrong too.
  assert.equal(rejected(patchOf({ hero_title: '', nope: 'x' })), 'Bilinmeyen alan: nope');
});

test('validateSettingsPatch knows only the editable settings, not hero_image or anything inherited', () => {
  assert.equal(rejected(patchOf({ hero_image: '{}' })), 'Bilinmeyen alan: hero_image');
  assert.equal(rejected(patchOf(JSON.parse('{"__proto__":{"hero_title":"x"}}'))), 'Bilinmeyen alan: __proto__');
  for (const key of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
    assert.equal(rejected(patchOf({ [key]: 'x' })), `Bilinmeyen alan: ${key}`);
  }
});

test('validateSettingsPatch: every text and multiline field takes exactly its limit and not a character more', () => {
  const fields = SETTINGS_FIELDS.filter((field) => field.kind === 'text' || field.kind === 'multiline');
  assert.ok(fields.length >= 10);
  for (const field of fields) {
    assert.equal(accepted(patchOf({ [field.key]: chars(field.max) })).values[field.key], chars(field.max), field.key);
    assert.equal(rejected(patchOf({ [field.key]: chars(field.max + 1) })), `${field.label} en fazla ${field.max} karakter olabilir.`, field.key);
  }
});

test('validateSettingsPatch: the limits of the phone, url and email fields', () => {
  assert.equal(rejected(patchOf({ phone: `0537-263-15-46${'-'.repeat(12)}` })), 'Telefon en fazla 25 karakter olabilir.');
  accepted(patchOf({ phone: `0537-263-15-46${'-'.repeat(11)}` }));
  assert.equal(rejected(patchOf({ whatsapp: `0537-263-15-46${'-'.repeat(12)}` })), 'WhatsApp numarası en fazla 25 karakter olabilir.');
  accepted(patchOf({ instagram_url: `https://${chars(200 - 8)}` }));
  assert.equal(rejected(patchOf({ instagram_url: `https://${chars(200 - 7)}` })), 'Instagram adresi en fazla 200 karakter olabilir.');
  accepted(patchOf({ maps_url: `https://${chars(500 - 8)}` }));
  assert.equal(rejected(patchOf({ maps_url: `https://${chars(500 - 7)}` })), 'Google Haritalar bağlantısı en fazla 500 karakter olabilir.');
  accepted(patchOf({ email: `${chars(100 - 5)}@b.co` }));
  assert.equal(rejected(patchOf({ email: `${chars(100 - 4)}@b.co` })), 'E-posta en fazla 100 karakter olabilir.');
});

test('validateSettingsPatch: a required field cannot be empty or blank, an optional one can', () => {
  for (const field of SETTINGS_FIELDS.filter((candidate) => candidate.required)) {
    for (const blank of ['', '   ', '\n', ' \r\n\t ']) {
      assert.equal(rejected(patchOf({ [field.key]: blank })), `${field.label} boş bırakılamaz.`, field.key);
    }
  }
  const optional = SETTINGS_FIELDS.filter((field) => !field.required && field.kind !== 'list').map((field) => field.key);
  const { values } = accepted(patchOf(Object.fromEntries(optional.map((key) => [key, '  ']))));
  assert.deepEqual(values, Object.fromEntries(optional.map((key) => [key, ''])));
  assert.deepEqual(accepted(patchOf({ highlights: [], hero_points: ['', ' '] })).values, { highlights: '[]', hero_points: '[]' });
});

test('validateSettingsPatch: values are trimmed and lose \\r and control characters', () => {
  assert.equal(accepted(patchOf({ hero_title: '  Merhaba  ' })).values.hero_title, 'Merhaba');
  assert.equal(accepted(patchOf({ hero_title: 'a\u0000b\u0007c\u001bd\u007fe\u0085f\u009fg\u000bh\u000ci\u001fj' })).values.hero_title, 'abcdefghij');
  assert.equal(accepted(patchOf({ hero_title: 'a\rb\tc' })).values.hero_title, 'abc'); // \r and a tab are control characters too
  assert.equal(accepted(patchOf({ phone: '0537 263\u000015 46' })).values.phone, '0537 26315 46');
  assert.equal(accepted(patchOf({ hero_title: 'Çınar 🙏 Tattoo’s' })).values.hero_title, 'Çınar 🙏 Tattoo’s');
});

test('validateSettingsPatch: a text field turns newlines into single spaces, a multiline field keeps them', () => {
  assert.equal(accepted(patchOf({ seo_title: 'a\nb' })).values.seo_title, 'a b');
  assert.equal(accepted(patchOf({ seo_title: 'a\r\nb' })).values.seo_title, 'a b');
  assert.equal(accepted(patchOf({ seo_title: 'a \n\n  b\n' })).values.seo_title, 'a b');
  // Since Task 6 the hero title is multiline: its line breaks are the lines of the H1.
  assert.equal(accepted(patchOf({ hero_title: ' Bir ömür\r\ndövme. ' })).values.hero_title, 'Bir ömür\ndövme.');
  assert.equal(accepted(patchOf({ about_text: '  a\r\nb\n\nc \u0007 \n' })).values.about_text, 'a\nb\n\nc');
  assert.equal(accepted(patchOf({ address: 'Nine Hatun Mah.\nİnönü Cd. No:11' })).values.address, 'Nine Hatun Mah.\nİnönü Cd. No:11');
});

test('validateSettingsPatch cleans a very long run of white space in no time (nothing that backtracks)', () => {
  const started = performance.now();
  const spaces = ' '.repeat(60000);
  assert.equal(accepted(patchOf({ hero_text: `${spaces}x${spaces}` })).values.hero_text, 'x');
  assert.equal(accepted(patchOf({ hero_text: `x${spaces}\n${spaces}y` })).values.hero_text, 'x y');
  assert.equal(accepted(patchOf({ about_text: `${spaces}\n${spaces}x` })).values.about_text, 'x');
  assert.equal(accepted(validateCaption(spaces)).value, '');
  // This takes about a millisecond; a quadratic regular expression takes more than a second.
  assert.ok(performance.now() - started < 250, 'cleaning white space took too long');
});

test('validateSettingsPatch: the length is measured as JavaScript counts it, like the maxlength of an input', () => {
  const emoji = '🙏'; // two UTF-16 units, one character to the eye
  assert.equal(emoji.length, 2);
  assert.equal(accepted(patchOf({ hero_title: emoji.repeat(40) })).ok, true); // 80
  assert.equal(rejected(patchOf({ hero_title: emoji.repeat(41) })), 'Giriş başlığı en fazla 80 karakter olabilir.'); // 82
});

test('validateSettingsPatch: a value that is not a string is "geçersiz", never an exception', () => {
  for (const value of [5, 0, null, undefined, true, false, [], ['a'], {}, { a: 1 }]) {
    assert.equal(rejected(patchOf({ hero_title: value })), 'Giriş başlığı geçersiz.', JSON.stringify(value));
    assert.equal(rejected(patchOf({ announcement_on: value })), 'Duyuru geçersiz.', JSON.stringify(value));
    assert.equal(rejected(patchOf({ phone: value })), 'Telefon geçersiz.', JSON.stringify(value));
  }
});

test('validateSettingsPatch: a patch that is not an object cannot be read', () => {
  for (const patch of [null, undefined, [], ['hero_title'], 'x', 5, true]) {
    assert.equal(rejected(patchOf(patch)), UNREADABLE, JSON.stringify(patch));
  }
});

test('validateSettingsPatch: phone numbers in every common format pass, garbage does not', () => {
  for (const phone of ['0537 263 15 46', '0 (537) 263 15 46', '+90 537 263 15 46', '5372631546', '905372631546', '0212 123 45 67', '+49 30 1234567']) {
    assert.equal(accepted(patchOf({ phone })).values.phone, phone);
    assert.equal(accepted(patchOf({ whatsapp: phone })).values.whatsapp, phone);
  }
  for (const phone of ['abc', '12345', '0537 263 15', '+12', '+90 537 263 15 46 9999', 'ara bizi', '0537 263 15 46 ext 5']) {
    assert.equal(rejected(patchOf({ phone })), 'Telefon geçerli değil.', phone);
    assert.equal(rejected(patchOf({ whatsapp: phone })), 'WhatsApp numarası geçerli değil.', phone);
  }
  accepted(patchOf({ whatsapp: '' })); // empty turns the WhatsApp buttons off
});

test('validateSettingsPatch: an address must be https:// and free of spaces, quotes and angle brackets', () => {
  for (const url of [
    'https://www.instagram.com/cinartattooesenler',
    'https://maps.app.goo.gl/abc123?x=1&y=2#z',
    'https://www.google.com/maps/search/?api=1&query=%C3%87%C4%B1nar%20Tattoo',
    'HTTPS://WWW.TIKTOK.COM/@x',
    'https://örnek.com/çınar',
  ]) {
    assert.equal(accepted(patchOf({ instagram_url: url, maps_url: url, google_reviews_url: url, tiktok_url: url })).values.tiktok_url, url);
  }
  for (const url of [
    'http://www.instagram.com/x',
    'www.instagram.com/x',
    'instagram.com/x',
    'ftp://x.com',
    'javascript:alert(1)',
    'data:text/html,<b>',
    '//example.com',
    'https://',
    'https:// example.com',
    'https://exa mple.com',
    'https://example.com/"onmouseover="x',
    "https://example.com/'x",
    'https://example.com/<x>',
    'https://example.com/a>b',
  ]) {
    assert.equal(rejected(patchOf({ instagram_url: url })), 'Instagram adresi https:// ile başlamalı.', url);
    assert.equal(rejected(patchOf({ maps_url: url })), 'Google Haritalar bağlantısı https:// ile başlamalı.', url);
    assert.equal(rejected(patchOf({ google_reviews_url: url })), 'Google yorumları bağlantısı https:// ile başlamalı.', url);
    assert.equal(rejected(patchOf({ tiktok_url: url })), 'TikTok adresi https:// ile başlamalı.', url);
  }
});

test('validateSettingsPatch: an e-mail address is empty or has the shape name@host.tld', () => {
  for (const email of ['onur@example.com', 'a.b+c@sub.example.co.uk', 'çınar@örnek.com']) {
    assert.equal(accepted(patchOf({ email })).values.email, email);
  }
  assert.equal(accepted(patchOf({ email: '' })).values.email, '');
  for (const email of ['onur', 'onur@', '@example.com', 'onur@example', 'onur@example.', 'on ur@example.com', 'a@@b.co', "o'nur@example.com", 'o"nur@example.com', 'on<ur>@example.com', 'a@b.c d']) {
    assert.equal(rejected(patchOf({ email })), 'E-posta geçerli değil.', email);
  }
});

test('validateSettingsPatch: the announcement flag is "0" or "1"', () => {
  assert.equal(accepted(patchOf({ announcement_on: '0' })).values.announcement_on, '0');
  assert.equal(accepted(patchOf({ announcement_on: '1' })).values.announcement_on, '1');
  assert.equal(accepted(patchOf({ announcement_on: ' 1 ' })).values.announcement_on, '1');
  for (const value of ['2', 'x', 'yes', 'true', 'on', '01', '10', '-1']) {
    assert.equal(rejected(patchOf({ announcement_on: value })), 'Duyuru geçersiz.', value);
  }
  assert.equal(rejected(patchOf({ announcement_on: '' })), 'Duyuru boş bırakılamaz.');
});

test('list settings: array in, JSON string out, empties dropped, item and count limits', () => {
  assert.deepEqual(accepted(patchOf({ highlights: ['Bir', 'İki'] })).values, { highlights: '["Bir","İki"]' });
  assert.deepEqual(accepted(patchOf({ highlights: ['  Bir  ', '', '   ', 'İki\nüç', '\u0007'] })).values, { highlights: '["Bir","İki üç"]' });
  assert.deepEqual(accepted(patchOf({ highlights: [] })).values, { highlights: '[]' });
  assert.deepEqual(accepted(patchOf({ hero_points: ['2005’ten beri'] })).values, { hero_points: '["2005’ten beri"]' });

  // The count: at most 8 and 4, counted after the empties are dropped.
  assert.equal(accepted(patchOf({ highlights: Array(8).fill('a') })).ok, true);
  assert.equal(rejected(patchOf({ highlights: Array(9).fill('a') })), 'Öne çıkanlar en fazla 8 madde olabilir.');
  assert.equal(accepted(patchOf({ highlights: [...Array(8).fill('a'), '', ' '] })).ok, true);
  assert.equal(accepted(patchOf({ hero_points: Array(4).fill('a') })).ok, true);
  assert.equal(rejected(patchOf({ hero_points: Array(5).fill('a') })), 'Giriş maddeleri en fazla 4 madde olabilir.');

  // The length of an item: at most 80 (a “title — detail” highlight) and 60.
  assert.equal(accepted(patchOf({ highlights: [chars(80)] })).ok, true);
  assert.equal(rejected(patchOf({ highlights: ['kısa', chars(81)] })), 'Öne çıkanlar maddeleri en fazla 80 karakter olabilir.');
  assert.equal(accepted(patchOf({ hero_points: [chars(60)] })).ok, true);
  assert.equal(rejected(patchOf({ hero_points: [chars(61)] })), 'Giriş maddeleri maddeleri en fazla 60 karakter olabilir.');
  assert.equal(accepted(patchOf({ highlights: [` ${chars(80)} `] })).ok, true); // measured after trimming
});

test('list settings: the count is checked before the length of the items', () => {
  assert.equal(rejected(patchOf({ highlights: [chars(81), ...Array(8).fill('a')] })), 'Öne çıkanlar en fazla 8 madde olabilir.');
});

test('list settings: only an array of strings will do', () => {
  for (const value of ['a', '["a"]', null, undefined, 5, {}, { 0: 'a' }, [1], ['a', 2], ['a', null], [['a']], [{}], true]) {
    assert.equal(rejected(patchOf({ highlights: value })), 'Öne çıkanlar geçersiz.', JSON.stringify(value));
    assert.equal(rejected(patchOf({ hero_points: value })), 'Giriş maddeleri geçersiz.', JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------------------------
// Caption
// ---------------------------------------------------------------------------------------------

test('validateCaption trims, turns newlines into spaces and allows 120 characters', () => {
  assert.deepEqual(validateCaption('Chicano kol'), { ok: true, value: 'Chicano kol' });
  assert.deepEqual(validateCaption('  Chicano\r\nkol \n\n yazı\u0007 '), { ok: true, value: 'Chicano kol yazı' });
  assert.deepEqual(validateCaption(''), { ok: true, value: '' });
  assert.deepEqual(validateCaption('   '), { ok: true, value: '' });
  assert.equal(accepted(validateCaption(chars(CAPTION_MAX))).value, chars(120));
  assert.equal(rejected(validateCaption(chars(121))), 'Açıklama en fazla 120 karakter olabilir.');
});

test('validateCaption cannot read what is not text, so a missing caption is never silently blanked', () => {
  for (const value of [undefined, null, 5, true, [], ['a'], {}]) {
    assert.equal(rejected(validateCaption(value)), UNREADABLE, JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------------------------

const service = (name = 'Piercing', description = 'Kulak, burun, göbek ve daha fazlası.') => ({ name, description });

test('validateServices bounds and messages', () => {
  assert.equal(rejected(validateServices([])), 'En az bir hizmet olmalı.');
  assert.equal(accepted(validateServices(Array.from({ length: 12 }, () => service()))).services.length, 12);
  assert.equal(rejected(validateServices(Array.from({ length: 13 }, () => service()))), 'En fazla 12 hizmet eklenebilir.');

  assert.equal(rejected(validateServices([service('')])), 'Hizmet adı boş bırakılamaz.');
  assert.equal(rejected(validateServices([service('  \n ')])), 'Hizmet adı boş bırakılamaz.');
  assert.equal(rejected(validateServices([{ description: 'açıklama' }])), 'Hizmet adı boş bırakılamaz.');
  assert.equal(rejected(validateServices([{ name: null, description: 'açıklama' }])), 'Hizmet adı boş bırakılamaz.');
  assert.equal(accepted(validateServices([service(chars(40))])).ok, true);
  assert.equal(rejected(validateServices([service(chars(41))])), 'Hizmet adı en fazla 40 karakter olabilir.');

  assert.equal(accepted(validateServices([service('Piercing', chars(120))])).ok, true);
  assert.equal(rejected(validateServices([service('Piercing', chars(121))])), 'Hizmet açıklaması en fazla 120 karakter olabilir.');
});

test('validateServices keeps the order, cleans the text and drops what it does not know', () => {
  const { services } = accepted(
    validateServices([
      { id: 9, name: '  Kalıcı\ndövme ', description: 'Sana göre\r\nçizilir. ', extra: '<script>' },
      { name: 'Piercing' }, // no description counts as empty
      { name: 'Malzeme', description: null },
    ]),
  );
  assert.deepEqual(services, [
    { name: 'Kalıcı dövme', description: 'Sana göre çizilir.' },
    { name: 'Piercing', description: '' },
    { name: 'Malzeme', description: '' },
  ]);
});

test('validateServices cannot read a list that is not made of { name, description } objects', () => {
  for (const list of ['x', {}, null, undefined, 5, true]) assert.equal(rejected(validateServices(list)), UNREADABLE, JSON.stringify(list));
  for (const item of [null, 'x', 5, [], [service()], true]) assert.equal(rejected(validateServices([item])), UNREADABLE, JSON.stringify(item));
  for (const value of [5, true, [], {}, ['a']]) {
    assert.equal(rejected(validateServices([{ name: value, description: '' }])), UNREADABLE, JSON.stringify(value));
    assert.equal(rejected(validateServices([{ name: 'Piercing', description: value }])), UNREADABLE, JSON.stringify(value));
  }
});

// ---------------------------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------------------------

const item = (name = 'Küçük dövme', detail = 'Tek seans', price = '1.500₺\'den') => ({ name, detail, price });
const group = (title = 'Dövme', items = [item()]) => ({ title, items });

test('validatePrices and validateReviews bounds and exact messages (prices)', () => {
  assert.deepEqual(validatePrices([]), { ok: true, groups: [] }); // an empty list hides the section
  assert.equal(accepted(validatePrices(Array.from({ length: 6 }, () => group()))).groups.length, 6);
  assert.equal(rejected(validatePrices(Array.from({ length: 7 }, () => group()))), 'En fazla 6 fiyat grubu olabilir.');

  assert.equal(rejected(validatePrices([group('')])), 'Grup adı boş bırakılamaz.');
  assert.equal(rejected(validatePrices([group(' \n ')])), 'Grup adı boş bırakılamaz.');
  assert.equal(rejected(validatePrices([{ items: [] }])), 'Grup adı boş bırakılamaz.');
  assert.equal(accepted(validatePrices([group(chars(30))])).ok, true);
  assert.equal(rejected(validatePrices([group(chars(31))])), 'Grup adı en fazla 30 karakter olabilir.');

  assert.equal(accepted(validatePrices([group('Dövme', Array.from({ length: 12 }, () => item()))])).ok, true);
  assert.equal(rejected(validatePrices([group('Dövme', Array.from({ length: 13 }, () => item()))])), 'Bir grupta en fazla 12 kalem olabilir.');

  assert.equal(rejected(validatePrices([group('Dövme', [item('')])])), 'Kalem adı boş bırakılamaz.');
  assert.equal(rejected(validatePrices([group('Dövme', [{ detail: 'x', price: 'y' }])])), 'Kalem adı boş bırakılamaz.');
  assert.equal(accepted(validatePrices([group('Dövme', [item(chars(40))])])).ok, true);
  assert.equal(rejected(validatePrices([group('Dövme', [item(chars(41))])])), 'Kalem adı en fazla 40 karakter olabilir.');

  assert.equal(accepted(validatePrices([group('Dövme', [item('Ad', chars(60))])])).ok, true);
  assert.equal(rejected(validatePrices([group('Dövme', [item('Ad', chars(61))])])), 'Açıklama en fazla 60 karakter olabilir.');
  assert.equal(accepted(validatePrices([group('Dövme', [item('Ad', '', chars(24))])])).ok, true);
  assert.equal(rejected(validatePrices([group('Dövme', [item('Ad', '', chars(25))])])), 'Fiyat en fazla 24 karakter olabilir.');
});

test('validatePrices keeps the order and cleans the text; detail and price are optional', () => {
  const { groups } = accepted(
    validatePrices([
      { title: ' Piercing ', items: [{ name: 'Kulak\nmemesi', detail: ' 1 küpe ', price: ' Teklif al ' }, { name: 'Burun' }] },
      { title: 'Geçici dövme' }, // no items yet is fine
      { title: 'Boş', items: null, extra: 1 },
    ]),
  );
  assert.deepEqual(groups, [
    { title: 'Piercing', items: [{ name: 'Kulak memesi', detail: '1 küpe', price: 'Teklif al' }, { name: 'Burun', detail: '', price: '' }] },
    { title: 'Geçici dövme', items: [] },
    { title: 'Boş', items: [] },
  ]);
});

test('validatePrices names the first problem in reading order', () => {
  assert.equal(rejected(validatePrices([group(chars(31), [item('')])])), 'Grup adı en fazla 30 karakter olabilir.');
  assert.equal(rejected(validatePrices([group('A', [item('ok')]), group('B', [item('')])])), 'Kalem adı boş bırakılamaz.');
  assert.equal(rejected(validatePrices([group('Dövme', [item(chars(41), chars(61), chars(25))])])), 'Kalem adı en fazla 40 karakter olabilir.');
});

test('validatePrices cannot read what is not a list of { title, items } groups', () => {
  for (const groups of ['x', {}, null, undefined, 5]) assert.equal(rejected(validatePrices(groups)), UNREADABLE, JSON.stringify(groups));
  for (const bad of [null, 'x', 5, [], [group()]]) assert.equal(rejected(validatePrices([bad])), UNREADABLE, JSON.stringify(bad));
  for (const items of ['x', {}, 5, true]) assert.equal(rejected(validatePrices([{ title: 'Dövme', items }])), UNREADABLE, JSON.stringify(items));
  for (const bad of [null, 'x', 5, [], [item()]]) assert.equal(rejected(validatePrices([group('Dövme', [bad])])), UNREADABLE, JSON.stringify(bad));
  assert.equal(rejected(validatePrices([{ title: 5, items: [] }])), UNREADABLE);
  for (const value of [5, true, [], {}]) {
    for (const key of ['name', 'detail', 'price']) {
      assert.equal(rejected(validatePrices([group('Dövme', [{ ...item(), [key]: value }])])), UNREADABLE, `${key} ${JSON.stringify(value)}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------------

const review = (overrides = {}) => ({ name: 'Defne G.', rating: 5, text: 'Çok güzel bir yer.', source: 'google', date_text: 'Ekim 2026', ...overrides });

test('validatePrices and validateReviews bounds and exact messages (reviews)', () => {
  assert.deepEqual(validateReviews([]), { ok: true, reviews: [] });
  assert.equal(accepted(validateReviews(Array.from({ length: 30 }, () => review()))).reviews.length, 30);
  assert.equal(rejected(validateReviews(Array.from({ length: 31 }, () => review()))), 'En fazla 30 yorum eklenebilir.');

  assert.equal(rejected(validateReviews([review({ name: '' })])), 'Yorumcu adı boş bırakılamaz.');
  assert.equal(rejected(validateReviews([review({ name: '  ' })])), 'Yorumcu adı boş bırakılamaz.');
  assert.equal(rejected(validateReviews([{ rating: 5, text: 'x', source: 'google' }])), 'Yorumcu adı boş bırakılamaz.');
  assert.equal(accepted(validateReviews([review({ name: chars(40) })])).ok, true);
  assert.equal(rejected(validateReviews([review({ name: chars(41) })])), 'Yorumcu adı en fazla 40 karakter olabilir.');

  for (const rating of [1, 2, 3, 4, 5]) assert.equal(accepted(validateReviews([review({ rating })])).reviews[0].rating, rating);
  for (const rating of [0, 6, -1, 3.5, 5.0001, NaN, Infinity, '5', '', null, undefined, true, [5], {}]) {
    assert.equal(rejected(validateReviews([review({ rating })])), 'Puan 1 ile 5 arasında olmalı.', String(rating));
  }
  assert.equal(rejected(validateReviews([{ name: 'A', text: 'x', source: 'google' }])), 'Puan 1 ile 5 arasında olmalı.');

  assert.equal(rejected(validateReviews([review({ text: '' })])), 'Yorum metni boş bırakılamaz.');
  assert.equal(rejected(validateReviews([review({ text: ' \n ' })])), 'Yorum metni boş bırakılamaz.');
  assert.equal(accepted(validateReviews([review({ text: chars(400) })])).ok, true);
  assert.equal(rejected(validateReviews([review({ text: chars(401) })])), 'Yorum metni en fazla 400 karakter olabilir.');

  for (const source of REVIEW_SOURCES) assert.equal(accepted(validateReviews([review({ source })])).reviews[0].source, source);
  for (const source of ['facebook', 'Google', 'GOOGLE', '', ' google', 'toString', '__proto__']) {
    assert.equal(rejected(validateReviews([review({ source })])), 'Kaynak geçersiz.', source);
  }
  assert.equal(rejected(validateReviews([{ name: 'A', rating: 5, text: 'x' }])), 'Kaynak geçersiz.');
  assert.equal(rejected(validateReviews([review({ source: null })])), 'Kaynak geçersiz.');

  assert.equal(accepted(validateReviews([review({ date_text: chars(20) })])).ok, true);
  assert.equal(rejected(validateReviews([review({ date_text: chars(21) })])), 'Tarih en fazla 20 karakter olabilir.');
  assert.equal(accepted(validateReviews([{ name: 'A', rating: 5, text: 'x', source: 'google' }])).reviews[0].date_text, '');
});

test('validateReviews keeps the order and a review’s own line breaks, and cleans the rest', () => {
  const { reviews } = accepted(
    validateReviews([
      { name: ' Oyku ', rating: 4, text: ' Çok güzel bir dövmeci\r\nPiercingi steril\n\nTeşekkürler\u0007 ', source: 'instagram', date_text: ' Ekim\n2026 ', extra: 1 },
      review({ name: 'İkinci' }),
    ]),
  );
  assert.deepEqual(reviews, [
    { name: 'Oyku', rating: 4, text: 'Çok güzel bir dövmeci\nPiercingi steril\n\nTeşekkürler', source: 'instagram', date_text: 'Ekim 2026' },
    { name: 'İkinci', rating: 5, text: 'Çok güzel bir yer.', source: 'google', date_text: 'Ekim 2026' },
  ]);
});

test('validateReviews measures a review the way the browser does, so emoji count twice', () => {
  const emoji = '🙏';
  assert.equal(accepted(validateReviews([review({ text: emoji.repeat(200) })])).ok, true); // 400 units
  assert.equal(rejected(validateReviews([review({ text: emoji.repeat(201) })])), 'Yorum metni en fazla 400 karakter olabilir.'); // 402
});

test('validateReviews names the first problem in the order name, rating, text, source, date', () => {
  const bad = { name: '', rating: 9, text: '', source: 'x', date_text: chars(21) };
  assert.equal(rejected(validateReviews([bad])), 'Yorumcu adı boş bırakılamaz.');
  assert.equal(rejected(validateReviews([{ ...bad, name: 'A' }])), 'Puan 1 ile 5 arasında olmalı.');
  assert.equal(rejected(validateReviews([{ ...bad, name: 'A', rating: 5 }])), 'Yorum metni boş bırakılamaz.');
  assert.equal(rejected(validateReviews([{ ...bad, name: 'A', rating: 5, text: 'x' }])), 'Kaynak geçersiz.');
  assert.equal(rejected(validateReviews([{ ...bad, name: 'A', rating: 5, text: 'x', source: 'google' }])), 'Tarih en fazla 20 karakter olabilir.');
});

test('validateReviews cannot read what is not a list of review objects', () => {
  for (const list of ['x', {}, null, undefined, 5]) assert.equal(rejected(validateReviews(list)), UNREADABLE, JSON.stringify(list));
  for (const bad of [null, 'x', 5, [], [review()], true]) assert.equal(rejected(validateReviews([bad])), UNREADABLE, JSON.stringify(bad));
  for (const key of ['name', 'text', 'source', 'date_text']) {
    for (const value of [5, true, [], {}, ['a']]) {
      assert.equal(rejected(validateReviews([review({ [key]: value })])), UNREADABLE, `${key} ${JSON.stringify(value)}`);
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Nothing throws
// ---------------------------------------------------------------------------------------------

test('no validator throws, whatever it is given', () => {
  const junk = [
    undefined, null, 0, 1, -1, NaN, Infinity, true, false, '', 'x', '[]', '{}', [], {}, Object.create(null),
    [null], [[]], [1], ['x'], [{}], [[{}]], [{ name: 5 }], [{ name: {} }], [{ name: 'a', description: [] }],
    [{ title: 5 }], [{ title: 'a', items: 'x' }], [{ title: 'a', items: [null] }], [{ title: 'a', items: [{ name: 'b', detail: 1 }] }],
    [{ name: 'a', rating: '5' }], [{ name: 'a', rating: 5, text: 'b', source: {} }],
    { hero_title: {} }, { highlights: {} }, { highlights: [null] }, { highlights: [[]] }, { announcement_on: [] }, { phone: [] }, { email: {} },
    { __proto__: { hero_title: 'x' } }, JSON.parse('{"__proto__":1,"constructor":{"prototype":{}}}'),
  ];
  for (const value of junk) {
    for (const validate of [validateSettingsPatch, validateServices, validateCaption, validatePrices, validateReviews]) {
      const result = validate(value);
      assert.equal(typeof result.ok, 'boolean');
      if (!result.ok) assert.equal(typeof result.message, 'string');
    }
  }
});

test('a rejected value comes back with a message and nothing else', () => {
  for (const result of [validateServices([]), validatePrices(null), validateReviews('x'), validateCaption(5), validateSettingsPatch(null)]) {
    assert.equal(result.ok, false);
    assert.deepEqual(Object.keys(result).sort(), ['message', 'ok']);
  }
});

// ---------------------------------------------------------------------------------------------
// listSetting
// ---------------------------------------------------------------------------------------------

const DEFAULT_HIGHLIGHTS = ['+20 yıllık tecrübe — 2005’ten beri Esenler’de, aynı mahallede.', 'Güler yüz — Her soruna sabırla cevap; acele yok.', 'Hijyen — Tek kullanımlık iğne, paketi göz önünde açılır.', 'Müşteri memnuniyeti — Google yorumlarının hepsi 5 yıldız.'];
const DEFAULT_HERO_POINTS = ['Kişiye özel dövme tasarımı', 'Profesyonel piercing uygulamaları', 'Kaliteli dövme malzemeleri'];

test('listSetting reads a stored list', () => {
  assert.deepEqual(listSetting({ highlights: '["Bir","İki"]' }, 'highlights'), ['Bir', 'İki']);
  assert.deepEqual(listSetting({ hero_points: '["Kişiye özel"]', highlights: '[]' }, 'hero_points'), ['Kişiye özel']);
});

test('an emptied list stays empty: the owner turned the strip off, so the default must not come back', () => {
  assert.deepEqual(listSetting({ highlights: '[]' }, 'highlights'), []);
});

test('listSetting falls back to the default on broken JSON', () => {
  assert.deepEqual(listSetting({ highlights: '{not json' }, 'highlights'), DEFAULT_HIGHLIGHTS);
  assert.deepEqual(listSetting({ hero_points: '' }, 'hero_points'), DEFAULT_HERO_POINTS);
  assert.deepEqual(listSetting({ hero_points: '["açık' }, 'hero_points'), DEFAULT_HERO_POINTS);
});

test('listSetting falls back to the default when the JSON is not a list of strings, or the setting is missing', () => {
  for (const stored of ['{"a":1}', '"x"', '5', 'null', 'true', '["a",5]', '[null]', '[["a"]]', '[{"a":1}]']) {
    assert.deepEqual(listSetting({ highlights: stored }, 'highlights'), DEFAULT_HIGHLIGHTS, stored);
  }
  // Only a string is parsed: an array that happens to print as JSON (['["a"]']) is not a stored list.
  for (const settings of [{}, undefined, null, { highlights: undefined }, { highlights: null }, { highlights: ['a'] }, { highlights: ['["a"]'] }, { highlights: 5 }]) {
    assert.deepEqual(listSetting(settings, 'highlights'), DEFAULT_HIGHLIGHTS, JSON.stringify(settings));
  }
});

test('listSetting gives a fresh array each time and an empty one for a key that is not a list', () => {
  const first = listSetting({}, 'hero_points');
  first.push('değişti');
  assert.deepEqual(listSetting({}, 'hero_points'), DEFAULT_HERO_POINTS);
  assert.deepEqual(listSetting({ hero_title: 'Merhaba' }, 'hero_title'), []);
  assert.deepEqual(listSetting({}, 'yok'), []);
  assert.deepEqual(listSetting({}, 'constructor'), []);
});

test('listSetting reads back what validateSettingsPatch stored', () => {
  const { values } = accepted(patchOf({ highlights: [' a ', '', 'İ’ş'] }));
  assert.deepEqual(listSetting(values, 'highlights'), ['a', 'İ’ş']);
});
