// Links built from what the owner types: phone numbers, the Instagram address and Google Maps.
// Anything that is not a usable value gives null (or a search link), never a broken link.
import { BRAND_NAME } from './defaults.js';

const DEFAULT_WHATSAPP_TEXT = 'Merhaba, web sitenizden yazıyorum.';

// A phone number as +<country code><number>, or null when it is not one. Everything but the digits
// and a leading "+" is ignored, so "0 (537) 263 15 46" reads like "05372631546".
// - With a "+", the digits are taken as they are, but there must be 10 to 15 of them and the first
//   cannot be 0: more than that is garbage, and garbage must not turn into a link.
// - Without one, the number has to be Turkish: 0 + 10 digits, 90 + 10 digits, or a mobile number
//   (5…) of 10 digits.
function normalizePhone(phone) {
  const text = String(phone ?? '').trim();
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) return /^[1-9]\d{9,14}$/.test(digits) ? `+${digits}` : null;
  if (/^0\d{10}$/.test(digits)) return `+90${digits.slice(1)}`;
  if (/^90\d{10}$/.test(digits)) return `+${digits}`;
  if (/^5\d{9}$/.test(digits)) return `+90${digits}`;
  return null;
}

/** `tel:+905372631546`, or null when the number is not usable. */
export function telHref(phone) {
  const number = normalizePhone(phone);
  return number === null ? null : `tel:${number}`;
}

/**
 * `https://wa.me/905372631546?text=…`, or null when the number is not usable. The message defaults
 * to a greeting; an empty `text` leaves the message out.
 */
export function waHref(phone, text) {
  const number = normalizePhone(phone);
  if (number === null) return null;
  const message = text ?? DEFAULT_WHATSAPP_TEXT;
  const base = `https://wa.me/${number.slice(1)}`;
  return message === '' ? base : `${base}?text=${encodeURIComponent(message)}`;
}

/** `@cinartattooesenler` for an Instagram profile address, or null when there is no handle in it. */
export function instagramHandle(url) {
  let address;
  try {
    address = new URL(String(url ?? '')); // the URL parser ignores white space around the address
  } catch {
    return null;
  }
  const host = address.hostname;
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return null;
  const [handle] = address.pathname.split('/').filter(Boolean);
  return handle !== undefined && /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `@${handle}` : null;
}

const placeQuery = (address) => encodeURIComponent(`${BRAND_NAME}, ${address ?? ''}`);

/** The owner's Google Maps link, or a Maps search for the shop's address when there is none. */
export function mapsDirectionsHref(mapsUrl, address) {
  const url = String(mapsUrl ?? '').trim();
  return url !== '' ? url : `https://www.google.com/maps/search/?api=1&query=${placeQuery(address)}`;
}

/** The address of the map that loads inside the page. */
export function mapsEmbedSrc(address) {
  return `https://www.google.com/maps?q=${placeQuery(address)}&output=embed`;
}
