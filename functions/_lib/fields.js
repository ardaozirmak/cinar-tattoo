// What the owner may edit, and the rules every value must pass before it is stored: the settings
// fields, the services, the price list, the reviews and a photo caption.
//
// The validators take what a client sent (anything JSON can hold) and never throw. They answer
// { ok: true, <the cleaned value> } or { ok: false, message }, where message is a Turkish sentence
// for the owner. A value that is not even the right type is "geçersiz" for a setting and
// 'İstek okunamadı.' elsewhere: the panel cannot send those, so that is a broken request.
//
// Lengths are JavaScript's .length (UTF-16 units), which is also what an input's maxlength counts,
// so the panel's counters and these limits agree. An emoji counts twice.
import { DEFAULT_SETTINGS } from './defaults.js';
import { telHref } from './links.js';

export const CATEGORIES = ['dovme', 'gecici', 'piercing', 'kulak', 'makyaj', 'diger'];
export const CATEGORY_LABELS = { dovme: 'Kalıcı dövme', gecici: 'Geçici dövme', piercing: 'Piercing', kulak: 'Kulak delme', makyaj: 'Kalıcı makyaj', diger: 'Diğer' };
export const REVIEW_SOURCES = ['google', 'instagram', 'diger'];
export const REVIEW_SOURCE_LABELS = { google: 'Google', instagram: 'Instagram', diger: 'Diğer' };
// What the site counts when a visitor taps a button (POST /api/track).
export const CLICK_KINDS = ['whatsapp', 'call', 'directions', 'form', 'instagram'];

// The limits of the lists. The admin state hands them to the panel, so nothing else repeats them.
export const MAX_SERVICES = 12;
export const SERVICE_NAME_MAX = 40;
export const SERVICE_DESCRIPTION_MAX = 120;
export const MAX_PRICE_GROUPS = 6;
export const PRICE_GROUP_TITLE_MAX = 30;
export const MAX_PRICE_ITEMS = 12; // per group
export const PRICE_ITEM_NAME_MAX = 40;
export const PRICE_ITEM_DETAIL_MAX = 60;
export const PRICE_ITEM_PRICE_MAX = 24;
export const MAX_REVIEWS = 30;
export const REVIEW_NAME_MAX = 40;
export const REVIEW_TEXT_MAX = 400;
export const REVIEW_DATE_MAX = 20;
export const CAPTION_MAX = 120;

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

// Kinds: text (one line), multiline, phone, url (https only), email, flag ('0' or '1') and list (an
// array of one-line strings, stored as a JSON string). For a list, `max` is the length of one item
// and `maxItems` how many there may be.
const field = (key, label, kind, max, { required = false, maxItems } = {}) => ({
  key,
  label,
  kind,
  max,
  required,
  default: DEFAULT_SETTINGS[key],
  ...(maxItems === undefined ? {} : { maxItems }),
});

export const SETTINGS_FIELDS = [
  field('seo_title', 'Sayfa başlığı', 'text', 70, { required: true }),
  field('seo_description', 'Google açıklaması', 'text', 170, { required: true }),
  // Multiline: each line of the hero title is one line of the H1 (the page uses up to three).
  field('hero_title', 'Giriş başlığı', 'multiline', 80, { required: true }),
  field('hero_text', 'Giriş metni', 'text', 160),
  field('about_title', 'Hakkında başlığı', 'text', 40, { required: true }),
  field('about_text', 'Hakkında metni', 'multiline', 600),
  field('hours', 'Çalışma saati', 'text', 40, { required: true }),
  field('hours_note', 'Saat notu', 'text', 80),
  field('address', 'Adres', 'multiline', 200, { required: true }),
  field('phone', 'Telefon', 'phone', 25, { required: true }),
  field('whatsapp', 'WhatsApp numarası', 'phone', 25),
  field('instagram_url', 'Instagram adresi', 'url', 200),
  field('maps_url', 'Google Haritalar bağlantısı', 'url', 500),
  field('announcement_text', 'Duyuru metni', 'text', 140),
  field('announcement_on', 'Duyuru', 'flag', 1, { required: true }),
  // 80: an item is “title — detail” (the Sanatçımız list splits it at the dash).
  field('highlights', 'Öne çıkanlar', 'list', 80, { maxItems: 8 }),
  field('hero_points', 'Giriş maddeleri', 'list', 60, { maxItems: 4 }),
  field('payment_text', 'Ödeme bilgisi', 'text', 60),
  field('instagram_followers', 'Instagram takipçi sayısı', 'text', 20),
  field('google_reviews_url', 'Google yorumları bağlantısı', 'url', 500),
  field('tiktok_url', 'TikTok adresi', 'url', 200),
  field('email', 'E-posta', 'email', 100),
];

// The settings forms of the panel, in the order it shows them. `tab` is the tab a group lives on.
// `hero_points` is in no group: the Dergi hero (T6-R13) shows no points, so the panel does not offer
// a field that would change nothing on the site. The key stays valid for the API and stored values.
export const SETTINGS_GROUPS = [
  { id: 'hero', title: 'Giriş', tab: 'texts', keys: ['hero_title', 'hero_text'] },
  { id: 'highlights', title: 'Öne çıkanlar', tab: 'texts', keys: ['highlights'] },
  { id: 'about', title: 'Hakkında', tab: 'texts', keys: ['about_title', 'about_text'] },
  { id: 'visit', title: 'Ziyaret', tab: 'texts', keys: ['hours', 'hours_note', 'address', 'phone', 'whatsapp', 'instagram_url', 'maps_url'] },
  { id: 'contact', title: 'İletişim ekleri', tab: 'texts', keys: ['payment_text', 'instagram_followers', 'tiktok_url', 'email'] },
  { id: 'announcement', title: 'Duyuru', tab: 'texts', keys: ['announcement_text', 'announcement_on'] },
  { id: 'seo', title: 'Google’da görünüm', tab: 'texts', keys: ['seo_title', 'seo_description'] },
  { id: 'reviews_link', title: 'Google yorumları bağlantısı', tab: 'reviews', keys: ['google_reviews_url'] },
];

// A Map, so that a key such as "constructor" or "__proto__" is simply unknown.
const FIELDS_BY_KEY = new Map(SETTINGS_FIELDS.map((entry) => [entry.key, entry]));

const HTTPS_URL = /^https:\/\/[^\s"'<>]+$/i;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/**
 * Checks a patch of settings: an object of key -> new value, where a list setting is an array of
 * strings. Gives { ok: true, values } with every value as the string to store (a list as JSON),
 * or the message for the first problem. An unknown key rejects the whole patch before any value
 * is looked at.
 */
export function validateSettingsPatch(patch) {
  if (!isObject(patch)) return unreadable();
  const keys = Object.keys(patch);
  const unknown = keys.find((key) => !FIELDS_BY_KEY.has(key));
  if (unknown !== undefined) return fail(`Bilinmeyen alan: ${unknown}`);

  const values = {};
  for (const key of keys) {
    const checked = checkSetting(FIELDS_BY_KEY.get(key), patch[key]);
    if (!checked.ok) return checked;
    values[key] = checked.value;
  }
  return { ok: true, values };
}

// The order of the checks is: type, trimming, required, length, then the kind's own format.
function checkSetting(entry, raw) {
  const { label, kind, max } = entry;
  if (kind === 'list') return checkList(entry, raw);
  if (typeof raw !== 'string') return fail(`${label} geçersiz.`);
  const value = cleanText(raw, { multiline: kind === 'multiline' });
  if (value === '') return entry.required ? fail(`${label} boş bırakılamaz.`) : pass(value);
  // A flag is one character by definition, so being '0' or '1' is the only rule it has.
  if (kind === 'flag') return value === '0' || value === '1' ? pass(value) : fail(`${label} geçersiz.`);
  if (value.length > max) return fail(`${label} en fazla ${max} karakter olabilir.`);
  if (kind === 'phone' && telHref(value) === null) return fail(`${label} geçerli değil.`);
  if (kind === 'url' && !HTTPS_URL.test(value)) return fail(`${label} https:// ile başlamalı.`);
  if (kind === 'email' && !EMAIL.test(value)) return fail(`${label} geçerli değil.`);
  return pass(value);
}

// Items are trimmed and the empty ones dropped before they are counted.
function checkList({ label, max, maxItems }, raw) {
  if (!Array.isArray(raw) || raw.some((item) => typeof item !== 'string')) return fail(`${label} geçersiz.`);
  const items = raw.map((item) => cleanText(item)).filter((item) => item !== '');
  if (items.length > maxItems) return fail(`${label} en fazla ${maxItems} madde olabilir.`);
  if (items.some((item) => item.length > max)) return fail(`${label} maddeleri en fazla ${max} karakter olabilir.`);
  return pass(JSON.stringify(items));
}

/**
 * A list setting as an array of strings. A list that is missing, is not JSON or is not an array of
 * strings gives the default list; an emptied list ('[]') stays empty. Anything that is not a list
 * setting gives [].
 */
export function listSetting(settings, key) {
  return parseStringList(settings?.[key]) ?? parseStringList(DEFAULT_SETTINGS[key]) ?? [];
}

function parseStringList(stored) {
  if (typeof stored !== 'string') return null;
  try {
    const list = JSON.parse(stored);
    return Array.isArray(list) && list.every((item) => typeof item === 'string') ? list : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Photo captions
// ---------------------------------------------------------------------------------------------

/** A caption: one line of at most 120 characters. Gives { ok: true, value }. */
export function validateCaption(caption) {
  // A missing caption is not an empty one: the caller must say which it means.
  if (typeof caption !== 'string') return unreadable();
  const value = cleanText(caption);
  if (value.length > CAPTION_MAX) return fail(`Açıklama en fazla ${CAPTION_MAX} karakter olabilir.`);
  return pass(value);
}

// ---------------------------------------------------------------------------------------------
// Services, prices and reviews
// ---------------------------------------------------------------------------------------------

/** The services: 1 to 12 of { name, description }. Gives { ok: true, services }. */
export function validateServices(list) {
  if (!Array.isArray(list)) return unreadable();
  if (list.length === 0) return fail('En az bir hizmet olmalı.');
  if (list.length > MAX_SERVICES) return fail(`En fazla ${MAX_SERVICES} hizmet eklenebilir.`);
  const services = [];
  for (const item of list) {
    const checked = checkService(item);
    if (!checked.ok) return checked;
    services.push(checked.value);
  }
  return { ok: true, services };
}

function checkService(item) {
  if (!isObject(item)) return unreadable();
  const name = stringOf(item, 'name');
  const description = stringOf(item, 'description');
  if (name === undefined || description === undefined) return unreadable();
  if (name === '') return fail('Hizmet adı boş bırakılamaz.');
  if (name.length > SERVICE_NAME_MAX) return fail(`Hizmet adı en fazla ${SERVICE_NAME_MAX} karakter olabilir.`);
  if (description.length > SERVICE_DESCRIPTION_MAX) return fail(`Hizmet açıklaması en fazla ${SERVICE_DESCRIPTION_MAX} karakter olabilir.`);
  return pass({ name, description });
}

/**
 * The price list: up to 6 groups of { title, items: [{ name, detail, price }] }. An empty list is
 * fine (the section is hidden then). Gives { ok: true, groups }.
 */
export function validatePrices(groups) {
  if (!Array.isArray(groups)) return unreadable();
  if (groups.length > MAX_PRICE_GROUPS) return fail(`En fazla ${MAX_PRICE_GROUPS} fiyat grubu olabilir.`);
  const checkedGroups = [];
  for (const group of groups) {
    const checked = checkPriceGroup(group);
    if (!checked.ok) return checked;
    checkedGroups.push(checked.value);
  }
  return { ok: true, groups: checkedGroups };
}

function checkPriceGroup(group) {
  if (!isObject(group)) return unreadable();
  const title = stringOf(group, 'title');
  const rawItems = group.items ?? []; // a group without items yet is fine
  if (title === undefined || !Array.isArray(rawItems)) return unreadable();
  if (title === '') return fail('Grup adı boş bırakılamaz.');
  if (title.length > PRICE_GROUP_TITLE_MAX) return fail(`Grup adı en fazla ${PRICE_GROUP_TITLE_MAX} karakter olabilir.`);
  if (rawItems.length > MAX_PRICE_ITEMS) return fail(`Bir grupta en fazla ${MAX_PRICE_ITEMS} kalem olabilir.`);
  const items = [];
  for (const rawItem of rawItems) {
    const checked = checkPriceItem(rawItem);
    if (!checked.ok) return checked;
    items.push(checked.value);
  }
  return pass({ title, items });
}

function checkPriceItem(item) {
  if (!isObject(item)) return unreadable();
  const name = stringOf(item, 'name');
  const detail = stringOf(item, 'detail');
  const price = stringOf(item, 'price');
  if (name === undefined || detail === undefined || price === undefined) return unreadable();
  if (name === '') return fail('Kalem adı boş bırakılamaz.');
  if (name.length > PRICE_ITEM_NAME_MAX) return fail(`Kalem adı en fazla ${PRICE_ITEM_NAME_MAX} karakter olabilir.`);
  if (detail.length > PRICE_ITEM_DETAIL_MAX) return fail(`Açıklama en fazla ${PRICE_ITEM_DETAIL_MAX} karakter olabilir.`);
  if (price.length > PRICE_ITEM_PRICE_MAX) return fail(`Fiyat en fazla ${PRICE_ITEM_PRICE_MAX} karakter olabilir.`);
  return pass({ name, detail, price });
}

/**
 * The reviews: up to 30 of { name, rating (an integer, 1 to 5), text, source, date_text }. The
 * text may hold line breaks. Gives { ok: true, reviews }.
 */
export function validateReviews(list) {
  if (!Array.isArray(list)) return unreadable();
  if (list.length > MAX_REVIEWS) return fail(`En fazla ${MAX_REVIEWS} yorum eklenebilir.`);
  const reviews = [];
  for (const item of list) {
    const checked = checkReview(item);
    if (!checked.ok) return checked;
    reviews.push(checked.value);
  }
  return { ok: true, reviews };
}

function checkReview(item) {
  if (!isObject(item)) return unreadable();
  const name = stringOf(item, 'name');
  const text = stringOf(item, 'text', { multiline: true });
  const source = item.source ?? ''; // an exact value, not text to clean
  const dateText = stringOf(item, 'date_text');
  if (name === undefined || text === undefined || typeof source !== 'string' || dateText === undefined) return unreadable();
  if (name === '') return fail('Yorumcu adı boş bırakılamaz.');
  if (name.length > REVIEW_NAME_MAX) return fail(`Yorumcu adı en fazla ${REVIEW_NAME_MAX} karakter olabilir.`);
  const { rating } = item;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail('Puan 1 ile 5 arasında olmalı.');
  if (text === '') return fail('Yorum metni boş bırakılamaz.');
  if (text.length > REVIEW_TEXT_MAX) return fail(`Yorum metni en fazla ${REVIEW_TEXT_MAX} karakter olabilir.`);
  if (!REVIEW_SOURCES.includes(source)) return fail('Kaynak geçersiz.');
  if (dateText.length > REVIEW_DATE_MAX) return fail(`Tarih en fazla ${REVIEW_DATE_MAX} karakter olabilir.`);
  return pass({ name, rating, text, source, date_text: dateText });
}

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// The checkers return { ok: true, value } or { ok: false, message }; the validators above turn the
// value into the key their callers expect (values, services, groups, reviews).
const pass = (value) => ({ ok: true, value });
const fail = (message) => ({ ok: false, message });
const unreadable = () => fail('İstek okunamadı.');

// \r and every other control character (C0, DEL, C1) go, except \n. A multiline text keeps its
// newlines; anywhere else a newline, with the white space around it, becomes one space.
const CONTROL_CHARACTERS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

function cleanText(text, { multiline = false } = {}) {
  const withoutControls = text.replace(CONTROL_CHARACTERS, '');
  if (multiline) return withoutControls.trim();
  // By lines, not with a regular expression like /\s*\n\s*/: that one takes quadratic time on a long
  // run of white space, and a Function has about 10 ms of CPU.
  return withoutControls
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
}

// object[key] as clean text: a missing or null field counts as '', and a field that is not text
// at all gives undefined.
function stringOf(object, key, { multiline = false } = {}) {
  const value = object[key];
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? cleanText(value, { multiline }) : undefined;
}
