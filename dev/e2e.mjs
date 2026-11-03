// The end-to-end smoke test: the real panel in headless Edge against the local emulator, then the
// public page it changes.
//
//   npm run e2e        (Edge from EDGE_PATH, else its default Windows path)
//
// It starts the emulator on a free port with a fresh, temporary database and image store, logs in
// on a 390 px phone screen, uploads a photo, edits the texts, prices and reviews, and checks after
// each step that the page at / shows the change. Review Focus 3: a hero title of 80 W and a caption
// of 120 M must not make the phone page scroll sideways. It saves three screenshots to .dev/shots/
// (e2e-admin-390.png, e2e-site-390.png, e2e-site-1440.png). Then it checks the page when site.js is
// blocked, starts late or throws before its motion (the booking link and the page must still show),
// and that Enter in a one-line panel field does not save the form.
//
// Exits 0 when every step passed. On a failure it prints the step and the reason, saves the page it
// was on as .dev/shots/fail.png and exits 1. Either way it closes Edge and the server and removes
// the temporary folder.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser } from './cdp.mjs';
import { startServer } from './server.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHOTS = join(ROOT, '.dev', 'shots');
const PASSWORD = 'e2e-sifre-123';
const UPLOAD = join(ROOT, 'public', 'seed', 'gecici-02-full.jpg');
const SEED_PHOTO_COUNT = 31; // the owner's picks: 10 geçici, 9 kalıcı, 9 piercing, 3 kulak (2026-11-03)
const TITLE = 'E2E başlık testi';
const LONG_TITLE = 'W'.repeat(80);
const LONG_CAPTION = 'M'.repeat(120);
const PRICE_GROUP = 'Dövme';
const PRICE_ITEM = 'Minimal yazı';
const PRICE_TEXT = 'Teklif al';
const REVIEW_NAME = 'E2E Müşteri';
const REVIEW_TEXT = 'Çok temiz ve özenli bir iş çıktı, herkese tavsiye ederim.';
// The site's opening (the intro curtain) takes about 3.7 s; its fallback ends it at 4 s.
const INTRO_MS = 4500;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const js = (value) => JSON.stringify(value);

// Runs in the page: the input or textarea whose <label> reads `text`, inside `root`.
const FIELD_BY_LABEL = `((root, text) => {
  const label = [...root.querySelectorAll('label')].find((item) => item.textContent.trim() === text);
  return label ? document.getElementById(label.htmlFor) : null;
})`;

let step = 'start';
let current = null; // the page a failure screenshot is taken of

async function main(temp) {
  mkdirSync(SHOTS, { recursive: true });

  step = '1. start the emulator';
  const server = await startServer({
    port: 0,
    root: ROOT,
    dataDir: join(temp, 'data'),
    vars: { ADMIN_PASSWORD: PASSWORD, APP_SECRET: 'e'.repeat(40) },
  });
  const profile = join(temp, 'edge');
  mkdirSync(profile);
  let browser = null;
  try {
    step = '1. start headless Edge';
    browser = await openBrowser({ userDataDir: profile });
    await run(server.url, browser);
  } catch (error) {
    await failShot();
    throw error;
  } finally {
    await browser?.close();
    await server.close();
  }
}

async function run(base, browser) {
  // ------------------------------------------------------------------------------------------
  step = '2. log in on a 390 px phone';
  const admin = await openPage(browser, 390, 844, true);
  await admin.goto(`${base}/admin/`);
  await admin.waitFor(`!document.getElementById('login-view').hidden`);
  await typeInto(admin, `document.getElementById('login-password')`, PASSWORD);
  await admin.evaluate(`document.getElementById('login-form').requestSubmit()`);
  await admin.waitFor(`(() => { const app = document.getElementById('app'); return !app.hidden && app.getBoundingClientRect().height > 0; })()`);
  await admin.waitFor(`document.querySelectorAll('.photo-tile').length === ${SEED_PHOTO_COUNT}`);

  // ------------------------------------------------------------------------------------------
  step = '3. upload a photo';
  await admin.setFiles('#photo-input', [UPLOAD]);
  await admin.waitFor(
    `document.querySelectorAll('.photo-tile').length === ${SEED_PHOTO_COUNT + 1} && document.querySelector('.upload-item.is-done') !== null`,
    30000,
  );
  const photoId = await admin.evaluate(
    `[...document.querySelectorAll('.photo-tile')].map((tile) => tile.dataset.id).find((id) => /^[0-9a-f]{20}$/.test(id)) ?? null`,
  );
  check(photoId !== null, 'the uploaded photo has no tile with a 20-hex id');
  // Its picture is served from KV at /img/<image key>/thumb.
  const tileSrc = await admin.evaluate(`new URL(document.querySelector('.photo-tile[data-id="${photoId}"] img').src).pathname`);
  const imagePath = /^\/img\/[^/]+\//.exec(tileSrc)?.[0] ?? null;
  check(imagePath !== null, `the uploaded photo's tile shows ${tileSrc}, not an /img/ picture`);

  // ------------------------------------------------------------------------------------------
  step = '4. save the hero title on the Yazılar tab';
  await openTab(admin, 'texts');
  await typeInto(admin, `document.querySelector('form[data-group="hero"] [name="hero_title"]')`, TITLE);
  await saveForm(admin, 'form[data-group="hero"]');

  // ------------------------------------------------------------------------------------------
  step = '5. the page at / shows the title and the photo, the reviews, and no prices yet';
  let html = await fetchPage(base);
  check(heroLabel(html) === TITLE, `h1#heroTitle aria-label is ${js(heroLabel(html))}, not ${js(TITLE)}`);
  check(html.includes(imagePath), `the page has no ${imagePath} URL for the uploaded photo`);
  check(/\bid="yorumlar"/.test(html), 'the page has no review section (id="yorumlar") with the seeded reviews');
  check(!/\bid="fiyatlar"/.test(html), 'the page has a price section (id="fiyatlar") before any price was saved');

  step = '5. add a price group on the Fiyatlar tab';
  await openTab(admin, 'prices');
  await clickButton(admin, 'form[data-group="prices"]', 'Grup ekle');
  await typeInto(admin, `${FIELD_BY_LABEL}(document.querySelector('form[data-group="prices"] .price-group:last-of-type'), 'Grup adı')`, PRICE_GROUP);
  await clickButton(admin, 'form[data-group="prices"] .price-group:last-of-type', 'Kalem ekle');
  await typeInto(admin, `${FIELD_BY_LABEL}(document.querySelector('form[data-group="prices"] .price-group:last-of-type .row:last-of-type'), 'Ad')`, PRICE_ITEM);
  await typeInto(admin, `${FIELD_BY_LABEL}(document.querySelector('form[data-group="prices"] .price-group:last-of-type .row:last-of-type'), 'Fiyat')`, PRICE_TEXT);
  await saveForm(admin, 'form[data-group="prices"]');

  step = '5. add a review on the Yorumlar tab';
  await openTab(admin, 'reviews');
  const reviewCount = await admin.evaluate(`document.querySelectorAll('form[data-group="reviews"] details.review').length`);
  await clickButton(admin, 'form[data-group="reviews"]', 'Yorum ekle');
  const newReview = `[...document.querySelectorAll('form[data-group="reviews"] details.review')].at(-1)`;
  await typeInto(admin, `${FIELD_BY_LABEL}(${newReview}, 'Ad')`, REVIEW_NAME);
  await typeInto(admin, `${FIELD_BY_LABEL}(${newReview}, 'Yorum')`, REVIEW_TEXT);
  await saveForm(admin, 'form[data-group="reviews"]');
  check(
    (await admin.evaluate(`document.querySelectorAll('form[data-group="reviews"] details.review').length`)) === reviewCount + 1,
    'the review form does not hold one more review after the save',
  );

  step = '5. the page at / shows the prices and the new review';
  html = await fetchPage(base);
  const prices = section(html, 'fiyatlar');
  check(prices !== null, 'the page has no price section (id="fiyatlar") after a price was saved');
  for (const value of [PRICE_GROUP, PRICE_ITEM, PRICE_TEXT]) check(prices.includes(value), `the price section does not show ${js(value)}`);
  const reviews = section(html, 'yorumlar');
  check(reviews !== null, 'the page has no review section (id="yorumlar")');
  check(reviews.includes(REVIEW_NAME), `the review section does not show ${js(REVIEW_NAME)}`);

  // ------------------------------------------------------------------------------------------
  step = '6. Review Focus 3: save an 80 W hero title and a 120 M caption';
  await openTab(admin, 'texts');
  await typeInto(admin, `document.querySelector('form[data-group="hero"] [name="hero_title"]')`, LONG_TITLE);
  await saveForm(admin, 'form[data-group="hero"]');
  await openTab(admin, 'photos');
  await admin.evaluate(`document.querySelector('.photo-tile[data-id="${photoId}"]').click()`);
  await admin.waitFor(`document.getElementById('photo-dialog').open`);
  await typeInto(admin, `document.querySelector('#photo-dialog [name="caption"]')`, LONG_CAPTION);
  await clearToast(admin);
  await admin.evaluate(`document.querySelector('#photo-dialog [data-photo-form]').requestSubmit()`);
  await waitForSave(admin, `#photo-dialog [data-photo-error]`);
  await admin.waitFor(`!document.getElementById('photo-dialog').open`);

  html = await fetchPage(base);
  check(heroLabel(html) === LONG_TITLE, 'the page does not show the 80 W hero title');
  check(html.includes(LONG_CAPTION), 'the page does not show the 120 M caption');

  step = '6. the phone page at 390 px does not scroll sideways';
  const site390 = await openPage(browser, 390, 844, true);
  await site390.goto(`${base}/`);
  await sleep(INTRO_MS);
  await revealAll(site390);
  await assertNoSideScroll(site390);

  // ------------------------------------------------------------------------------------------
  step = '7. screenshots';
  current = admin;
  await admin.send('Page.bringToFront');
  await admin.evaluate(`window.scrollTo(0, 0)`);
  await admin.waitFor(`getComputedStyle(document.getElementById('toast')).opacity === '0'`);
  await admin.waitFor(`[...document.querySelectorAll('.photo-tile img')].slice(0, 9).every((image) => image.complete)`);
  await admin.screenshot(join(SHOTS, 'e2e-admin-390.png'));

  current = site390;
  await site390.screenshot(join(SHOTS, 'e2e-site-390.png'), { fullPage: true });

  const site1440 = await openPage(browser, 1440, 900, false);
  await site1440.goto(`${base}/`);
  await sleep(INTRO_MS);
  await revealAll(site1440);
  await assertNoSideScroll(site1440);
  await site1440.screenshot(join(SHOTS, 'e2e-site-1440.png'), { fullPage: true });

  // Anything the pages reported (console errors, uncaught exceptions, CSP violations, failed
  // requests) fails the run: the smoke test is also the check that the real pages run clean.
  step = '7. the pages ran without errors';
  for (const [name, page] of [['admin', admin], ['site 390', site390], ['site 1440', site1440]]) {
    check(page.problems.length === 0, `the ${name} page reported:\n    ${page.problems.join('\n    ')}`);
  }

  // ------------------------------------------------------------------------------------------
  step = '8. with site.js running, the booking form replaces the plain WhatsApp link';
  check((await formShown(site1440)) === 'form', `the normal page shows ${await formShown(site1440)}, not the booking form`);

  step = '8. without site.js, the plain WhatsApp link stays and the page shows itself';
  const noScript = await openPage(browser, 390, 844, true);
  await noScript.send('Network.setBlockedURLs', { urls: ['*/assets/site.js'] });
  await noScript.goto(`${base}/`);
  check((await formShown(noScript)) === 'link', `without site.js the page shows ${await formShown(noScript)}, not the WhatsApp link`);
  await sleep(INTRO_MS);
  await assertPageShown(noScript);

  step = '8. site.js that starts after 3.5 s shows the page at once, with no intro';
  const late = await openPage(browser, 390, 844, true);
  await late.send('Page.addScriptToEvaluateOnNewDocument', {
    source: '{ const now = performance.now.bind(performance); performance.now = () => now() + 4000; }',
  });
  await late.goto(`${base}/`);
  const lateClasses = await late.evaluate(`document.documentElement.className`);
  check(/\bstill\b/.test(lateClasses) && !/\bm\b/.test(lateClasses), `a late site.js left html.className ${js(lateClasses)}`);
  await assertPageShown(late); // at once, before the 4 s rescue
  check((await formShown(late)) === 'form', 'a late site.js does not show the booking form');
  await sleep(INTRO_MS);
  await assertPageShown(late);
  check(late.problems.length === 0, `the late page reported:\n    ${late.problems.join('\n    ')}`);

  step = '8. an error in site.js before the motion starts never leaves the intro over the page';
  const broken = await openPage(browser, 390, 844, true);
  await broken.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "HTMLDialogElement.prototype.showModal = function () { throw new Error('e2e: showModal broken'); };",
  });
  await broken.goto(`${base}/#is-seed-gecici-10`); // opens the lightbox at load, which now throws
  await sleep(INTRO_MS);
  check(broken.problems.some((problem) => problem.includes('showModal broken')), 'the injected error did not happen');
  await assertPageShown(broken);
  check((await formShown(broken)) === 'link', `site.js stopped before the form, yet the page shows ${await formShown(broken)}`);

  step = '8. Enter in a one-line field of the panel does not save the form';
  current = admin;
  await admin.send('Page.bringToFront');
  await openTab(admin, 'texts');
  await pressEnterIn(admin, `document.querySelector('form[data-group="visit"] [name="instagram_url"]')`, 'form[data-group="visit"]');
  await openTab(admin, 'prices');
  await pressEnterIn(
    admin,
    `${FIELD_BY_LABEL}(document.querySelector('form[data-group="prices"] .price-group:last-of-type .row:last-of-type'), 'Fiyat')`,
    'form[data-group="prices"]',
  );
  // Last: a new, empty review leaves the tab with unsaved changes (the panel asks before leaving).
  await openTab(admin, 'reviews');
  await clickButton(admin, 'form[data-group="reviews"]', 'Yorum ekle');
  await pressEnterIn(admin, `${FIELD_BY_LABEL}(${newReview}, 'Ad')`, 'form[data-group="reviews"]');
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function check(ok, message) {
  if (!ok) throw new Error(message);
}

// A new tab with the viewport set before anything loads, which also reports CSP violations.
async function openPage(browser, width, height, mobile) {
  const page = await browser.page();
  current = page;
  await page.setViewport(width, height, mobile);
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "addEventListener('securitypolicyviolation', (e) => console.error('CSP violation:', e.violatedDirective, e.blockedURI || '(inline)'));",
  });
  return page;
}

// Puts `value` in the field `expression` finds, as typing would: focus, select what is there, then
// insert the text (one input event, as a keyboard's paste or autocomplete gives).
async function typeInto(page, expression, value) {
  const found = await page.evaluate(`(() => {
    const field = ${expression};
    if (!field) return false;
    field.scrollIntoView({ block: 'center' });
    field.focus();
    field.select();
    return document.activeElement === field;
  })()`);
  check(found, `no field to type into: ${expression}`);
  await page.send('Input.insertText', { text: value });
  const now = await page.evaluate(`(${expression}).value`);
  check(now === value, `the field holds ${js(now)} after typing ${js(value)}`);
}

async function clickButton(page, scope, text) {
  const clicked = await page.evaluate(`(() => {
    const button = [...document.querySelector(${js(scope)})?.querySelectorAll('button') ?? []].filter((item) => item.textContent.trim() === ${js(text)}).at(-1);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  check(clicked, `no enabled button ${js(text)} in ${scope}`);
}

async function openTab(page, name) {
  await page.evaluate(`document.querySelector('[data-tab="${name}"]').click()`);
  await page.waitFor(`!document.querySelector('[data-panel="${name}"]').hidden`);
}

async function clearToast(page) {
  await page.evaluate(`document.getElementById('toast').textContent = ''`);
}

// Waits for the "Kaydedildi" toast; an error shown in `errorSelector` meanwhile fails at once.
async function waitForSave(page, errorSelector) {
  const outcome = await page.waitFor(`(() => {
    const error = document.querySelector(${js(errorSelector)})?.textContent.trim();
    if (error) return 'error: ' + error;
    return document.getElementById('toast').textContent.includes('Kaydedildi') ? 'saved' : '';
  })()`);
  check(outcome === 'saved', `the save failed with ${js(outcome)}`);
}

async function saveForm(page, formSelector) {
  await clearToast(page);
  await page.evaluate(`document.querySelector(${js(formSelector)}).requestSubmit()`);
  await waitForSave(page, `${formSelector} > .form-error`);
}

async function fetchPage(base) {
  const response = await fetch(`${base}/`);
  check(response.status === 200, `GET / answered ${response.status}`);
  return response.text();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'" };
const decode = (value) => value.replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, name) => ENTITIES[name]);

function heroLabel(html) {
  const match = /<h1 id="heroTitle" aria-label="([^"]*)"/.exec(html);
  return match ? decode(match[1]) : null;
}

// The HTML of <section id="…"> up to the next </section>, or null.
function section(html, id) {
  const start = html.search(new RegExp(`<section[^>]*\\bid="${id}"`));
  if (start === -1) return null;
  const end = html.indexOf('</section>', start);
  return decode(html.slice(start, end === -1 ? undefined : end));
}

// Scrolls through the whole page, a screen at a time, so that lazy images load and every section's
// entrance animation has played; then back to the top.
async function revealAll(page) {
  const { height, screen } = await page.evaluate(`({ height: document.documentElement.scrollHeight, screen: innerHeight })`);
  for (let y = 0; y < height; y += Math.round(screen * 0.8)) {
    await page.evaluate(`window.scrollTo({ top: ${y}, behavior: 'instant' })`);
    await sleep(350);
  }
  await sleep(1500);
  await page.evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`);
  await sleep(800);
}

// The page does not scroll sideways, and no picture card is pushed wider than its own box by its
// caption (a box that clips its overflow, as the sideways strip does, would hide that from the first
// check).
async function assertNoSideScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(`({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`);
  check(scrollWidth <= innerWidth, `the page scrolls sideways: scrollWidth ${scrollWidth} > innerWidth ${innerWidth}`);
  const wide = await page.evaluate(`[...document.querySelectorAll('figure')]
    .filter((figure) => figure.clientWidth > 0 && figure.scrollWidth > figure.clientWidth + 1)
    .map((figure) => (figure.closest('[id]')?.id ?? '?') + ': ' + figure.scrollWidth + ' > ' + figure.clientWidth + ' px')`);
  check(wide.length === 0, `picture cards wider than their box:\n    ${wide.join('\n    ')}`);
}

// Which booking path the page shows: 'form' (site.js wired it), 'link' (the plain WhatsApp link), or
// what shows when that is both or neither.
async function formShown(page) {
  return page.evaluate(`(() => {
    const shown = (selector) => {
      const element = document.querySelector(selector);
      return element !== null && getComputedStyle(element).display !== 'none';
    };
    const form = shown('#bookForm .form-js');
    const link = shown('#bookForm .form-nojs') && document.querySelector('#bookForm .form-nojs a[href^="https://wa.me/"]') !== null;
    return form && !link ? 'form' : link && !form ? 'link' : 'form ' + form + ', link ' + link;
  })()`);
}

// The hero title is in place and nothing covers the page: no intro over its middle.
async function assertPageShown(page) {
  const state = await page.evaluate(`(() => {
    const intro = document.getElementById('intro');
    const line = document.querySelector('.hero h1 .ln > span');
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return {
      intro: intro !== null && getComputedStyle(intro).visibility !== 'hidden' && getComputedStyle(intro).display !== 'none',
      covered: hit !== null && hit.closest('#intro') !== null,
      title: line ? getComputedStyle(line).transform : 'no title',
      bar: getComputedStyle(document.querySelector('.bar')).opacity,
    };
  })()`);
  check(!state.intro && !state.covered, `the intro still covers the page: ${js(state)}`);
  // `kurtar` ends at transform:none, which Edge reports as the identity matrix.
  check(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(state.title) && state.bar === '1', `the page is still hidden: ${js(state)}`);
}

// Presses Enter (a phone's Go key) in the field `expression` finds: the form must neither save nor
// show a check error.
async function pressEnterIn(page, expression, formSelector) {
  const found = await page.evaluate(`(() => {
    const field = ${expression};
    if (!field) return false;
    field.scrollIntoView({ block: 'center' });
    field.focus();
    return document.activeElement === field;
  })()`);
  check(found, `no field to press Enter in: ${expression}`);
  await clearToast(page);
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', ...key });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await sleep(1200);
  const outcome = await page.evaluate(`({
    toast: document.getElementById('toast').textContent,
    error: document.querySelector(${js(`${formSelector} > .form-error`)})?.textContent.trim() ?? '',
  })`);
  check(!outcome.toast.includes('Kaydedildi') && outcome.error === '', `Enter in ${expression} submitted the form: ${js(outcome)}`);
}

// The page the failing step was on, as .dev/shots/fail.png (while Edge is still open).
let failShotPath = null;
async function failShot() {
  if (current === null) return;
  try {
    await current.screenshot(join(SHOTS, 'fail.png'));
    failShotPath = join(SHOTS, 'fail.png');
  } catch (error) {
    console.error(`e2e: no fail.png: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------------------------

const temp = mkdtempSync(join(tmpdir(), 'cinar-e2e-'));
let failed = false;
try {
  await main(temp);
} catch (error) {
  failed = true;
  console.error(`e2e FAILED at step "${step}":\n  ${error.message}`);
  if (failShotPath !== null) console.error(`  screenshot: ${failShotPath}`);
} finally {
  try {
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.error(`e2e: could not remove ${temp}: ${error.message}`);
  }
}
if (!failed) console.log(`e2e passed. Screenshots in ${SHOTS}`);
process.exit(failed ? 1 : 0);
