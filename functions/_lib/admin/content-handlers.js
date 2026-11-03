// The content endpoints of the admin API (spec §8): the settings, the services, the prices, the
// reviews and the summary of the clicks.
//
// The router (router.js) has already checked the Origin, the setup and the session. What a client
// sends is checked by the validators of fields.js: the first problem is answered as 400 with its
// Turkish message and nothing is written. A list is replaced as a whole, in the order it came in
// (db.js does it in one batch). The answer is what is stored now, in the shape of GET state, so that
// the panel can take it as it is.
import { STATS_DAYS, statsSinceDay } from '../clicks.js';
import { getClickStats, getContent, replacePrices, replaceReviews, replaceServices, updateSettings } from '../db.js';
import { validatePrices, validateReviews, validateServices, validateSettingsPatch } from '../fields.js';
import { HttpError, json, readJson } from '../http.js';
import { adminSettings } from './auth-handlers.js';

// Up to 200 reviews of up to 2000 characters do not fit in readJson's default 64 KiB.
const REVIEWS_BODY_MAX = 1048576;

/** PUT /api/admin/settings {key: value, ...} → { settings }: every setting. A list setting is an array of strings. */
export async function saveSettings({ request, db }) {
  const { values } = valid(validateSettingsPatch(await readJson(request)));
  await updateSettings(db, values);
  return json({ settings: adminSettings((await getContent(db)).settings) });
}

/** PUT /api/admin/services {services: [{name, description}]} → { services }: with their ids. */
export async function saveServices({ request, db }) {
  const { services } = valid(validateServices((await readJson(request))?.services));
  await replaceServices(db, services);
  return json({ services: (await getContent(db)).services });
}

/** PUT /api/admin/prices {groups: [{title, items: [{name, detail, price}]}]} → { prices }: with their ids. */
export async function savePrices({ request, db }) {
  const { groups } = valid(validatePrices((await readJson(request))?.groups));
  await replacePrices(db, groups);
  return json({ prices: (await getContent(db)).prices });
}

/** PUT /api/admin/reviews {reviews: [{name, rating, text, source, date_text}]} → { reviews }: with their ids. */
export async function saveReviews({ request, db, now }) {
  const { reviews } = valid(validateReviews((await readJson(request, REVIEWS_BODY_MAX))?.reviews));
  await replaceReviews(db, reviews, now);
  return json({ reviews: (await getContent(db)).reviews });
}

/** GET /api/admin/stats → { days: 30, totals: { whatsapp, call, directions, form, instagram } }, the last 30 days. */
export async function stats({ db, now }) {
  return json({ days: STATS_DAYS, totals: await getClickStats(db, statsSinceDay(now)) });
}

// The result of a validator when it is ok; otherwise the HttpError 400 with its message. A body that
// is not JSON, or has no list where it should, reaches the validator as undefined and is "unreadable".
function valid(result) {
  if (!result.ok) throw new HttpError(400, result.message);
  return result;
}
