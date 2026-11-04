// The public page, written on the server: the approved "Dergi" prototype filled from the content the
// owner edits (getContent). Everything the visitor reads is in this HTML; public/assets/site.js only
// animates it and wires the buttons, and it creates no element but the map's iframe.
//
// Rules:
// - Every dynamic string goes through escapeHtml. Settings, services, prices and captions go through
//   smartApostrophes first; review texts are shown exactly as their writers typed them.
// - A link whose helper gives null (telHref, waHref) or whose setting is empty is left out, with its
//   button and its data-track. Every booking link carries data-track with a CLICK_KINDS value.
// - The site CSP holds: no style attribute, no inline script but the JSON-LD, no <style>.
// - A section that does not render has no menu entry, and the section numbers close up.
import { BRAND_NAME } from './defaults.js';
import { CATEGORIES, CATEGORY_LABELS, REVIEW_SOURCE_LABELS, listSetting } from './fields.js';
import { escapeHtml, jsonForScript, paragraphs, smartApostrophes } from './html.js';
import { instagramHandle, mapsDirectionsHref, mapsEmbedSrc, telHref, waHref } from './links.js';
import { imageUrls } from './media.js';

export const GREETING = 'Merhaba Onur Bey, siteden yazıyorum.';

const FOUNDED = 2005;
const GENERIC_TEXT = 'Randevu almak istiyorum.';
const WORKS_SHOWN = 24; // cards visible before "Daha fazla göster"
const WORKS_MAX = 48; // cards in the HTML at all (ruling T6-R8)
const STRIP_MAX = 16;
const THUMB_MAX = 640; // the long side of a thumb (T7's resize and dev/seed-images.py)
// The seed hero stands in front of a studio photo (Onur Bey drawing a design), dimmed and with dark edges as on
// nikkohurtado.com: a wide crop for desktops, a tall one for phones. Decorative, so its alt is empty.
export const HERO_BACKDROP = { wide: { src: '/media/hero-arka-genis.jpg', width: 1440, height: 1648 }, tall: { src: '/media/hero-arka-dik.jpg', width: 720, height: 900 } };
const SEED_LOGO_ALT ='Çınar Tattoo logosu: Çınar Ink, Tattoo Piercing Studio, 2005 ve çapa';
const ARTIST_NAME = 'Onur Aydoğan';
// public/media/sanatci.jpg: Onur Bey's portrait (2026-11-03, the user's pick), cropped to 4:5.
const ARTIST_PHOTO = { src: '/media/sanatci.jpg', width: 800, height: 1000, alt: 'Çınar Tattoo’nun sanatçısı Onur Aydoğan, Esenler’deki stüdyosunda' };
// One picture per kind of service, matched on the service's name (the owner can rename and reorder
// them): the studio's own work from the gallery's seed photos, cropped to 4:5 (docs/GORSELLER.md).
// "kulak" goes first, so that an ear piercing gets the ear.
const SERVICE_PHOTOS = [
  { key: 'kulak', words: ['kulak'], src: '/media/hizmet-kulak.jpg', width: 560, height: 700, alt: 'Çınar Tattoo’da delinen kulak: çiçek ve yıldız küpeler' },
  { key: 'piercing', words: ['piercing'], src: '/media/hizmet-piercing.jpg', width: 560, height: 700, alt: 'Çınar Tattoo’da yapılan göbek piercing, sallantılı taşlı uç' },
  { key: 'gecici', words: ['geçici', 'çıkartma'], src: '/media/hizmet-gecici.jpg', width: 560, height: 700, alt: 'Çınar Tattoo’da yapılan renkli güller, ön kol' },
  { key: 'kalici', words: ['dövme'], src: '/media/hizmet-kalici.jpg', width: 560, height: 700, alt: 'Çınar Tattoo’da yapılan kadın portresi ve yapraklar dövmesi' },
];
const HIGHLIGHT_DASH = ' — '; // a highlight is "title — detail"
const UNTITLED_WORK = 'Çınar Tattoo çalışması';
const AREA_SERVED = ['Esenler', 'Bağcılar', 'Güngören', 'Bayrampaşa', 'Gaziosmanpaşa', 'İstanbul'];

// The sections in page order: id, menu label, whether the desktop menu lists it. Each renders only
// when its builder gives HTML.
const SECTIONS = [
  { id: 'sanatci', label: 'Sanatçı', menu: true },
  { id: 'calismalar', label: 'Çalışmalar', menu: true },
  { id: 'surec', label: 'Süreç', menu: true },
  { id: 'yorumlar', label: 'Yorumlar', menu: true },
  { id: 'fiyatlar', label: 'Fiyatlar', menu: true },
  { id: 'bakim', label: 'Bakım', menu: false },
  { id: 'randevu', label: 'Randevu', menu: true },
  { id: 'sss', label: 'SSS', menu: true },
];

const PLACES = ['Kol', 'Bacak', 'Sırt', 'Göğüs', 'Boyun', 'El', 'Diğer'];
const SIZES = [
  ['Mini (5 cm’e kadar)', 'Mini · ≤5 cm'],
  ['Orta (5–15 cm)', 'Orta · 5–15 cm'],
  ['Büyük (15 cm+)', 'Büyük · 15 cm+'],
  ['Tam kol / sırt', 'Tam kol / sırt'],
];

const pad = (n) => String(n).padStart(2, '0');
// A setting, service, price or caption as safe HTML text.
const text = (value) => escapeHtml(smartApostrophes(value ?? ''));
const lines = (value) => text(value).replaceAll('\n', '<br>');
const blank = (value) => String(value ?? '').trim() === '';
const external = 'target="_blank" rel="noopener"';

// A heading whose letters rise one by one: the words and letters are spans the motion moves, the
// whole text is the accessible name. `value` is the plain text; nothing here is markup.
function splitHeading(value) {
  return String(value)
    .trim()
    .split(/\s+/)
    .map((word) => `<span class="wd" aria-hidden="true">${[...word].map((ch) => `<span class="ch">${escapeHtml(ch)}</span>`).join('')}</span>`)
    .join(' ');
}

/**
 * The whole page as a string.
 * @param {{ content: { settings, hero, services, photos, prices, reviews }, origin: string, assetVersion: string, year: number }} input
 */
export function renderPage({ content, origin, assetVersion, year }) {
  const ctx = context(content, origin, year);
  const built = SECTIONS.filter((section) => SECTION_SHOWN[section.id]?.(ctx) ?? true).map((section, index) => ({ ...section, no: pad(index + 1) }));
  const sectionsHtml = built.map((section) => {
    const body = SECTION_BUILDERS[section.id](ctx, section.no);
    // The banner sits just before Süreç.
    return section.id === 'surec' ? banner(ctx) + body : body;
  });

  return `<!doctype html>
<html lang="tr"${ctx.waDigits ? ` data-wa="${ctx.waDigits}"` : ''}>
${head(ctx, assetVersion)}
<body id="top"${hasNotice(ctx) ? ' class="has-duyuru"' : ''}>
${intro(year, content.services, ctx.handle)}
${bar(ctx, built)}
${sheet(ctx, built)}
<main>
${hero(ctx)}
${sectionsHtml.join('\n')}
</main>
${footer(ctx)}
${dock(ctx)}
</body>
</html>
`;
}

// Everything the parts share: the settings and the links built from them.
function context(content, origin, year) {
  const settings = content.settings ?? {};
  const whatsapp = waHref(settings.whatsapp, '');
  const wa = (message) => (whatsapp === null ? null : waHref(settings.whatsapp, `${GREETING} ${message}`));
  const hasPlace = !blank(settings.maps_url) || !blank(settings.address);
  const instagram = blank(settings.instagram_url) ? null : String(settings.instagram_url).trim();
  return {
    settings,
    origin,
    year,
    hero: content.hero,
    services: content.services ?? [],
    photos: content.photos ?? [],
    prices: (content.prices ?? []).filter((group) => (group.items ?? []).length > 0),
    reviews: content.reviews ?? [],
    waDigits: whatsapp === null ? null : whatsapp.slice('https://wa.me/'.length),
    wa,
    waGeneric: wa(GENERIC_TEXT),
    tel: telHref(settings.phone),
    directions: hasPlace ? mapsDirectionsHref(settings.maps_url, settings.address) : null,
    instagram,
    handle: instagram === null ? null : instagramHandle(instagram),
  };
}

// The links every part draws the same way. Each is '' when its target is not there. `cls` may be ''.
const classOf = (cls) => (cls ? ` class="${cls}"` : '');
const waLink = (ctx, cls, label, href = ctx.waGeneric) =>
  href === null ? '' : `<a${classOf(cls)} href="${escapeHtml(href)}" ${external} data-track="whatsapp">${label}</a>`;
const telLink = (ctx, cls, label) => (ctx.tel === null ? '' : `<a${classOf(cls)} href="${escapeHtml(ctx.tel)}" data-track="call">${label}</a>`);
const dirLink = (ctx, cls, label) =>
  ctx.directions === null ? '' : `<a${classOf(cls)} href="${escapeHtml(ctx.directions)}" ${external} data-track="directions">${label}</a>`;
const instaLink = (ctx, cls, label) =>
  ctx.instagram === null ? '' : `<a${classOf(cls)} href="${escapeHtml(ctx.instagram)}" ${external} data-track="instagram">${label}</a>`;
const arrow = ' <span class="ar">→</span>';

// ---------------------------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------------------------

function shareImage(ctx) {
  if (ctx.hero?.source === 'kv') return ctx.origin + imageUrls(ctx.hero).full;
  return `${ctx.origin}/assets/og.jpg`;
}

function head(ctx, assetVersion) {
  const { settings } = ctx;
  const title = text(settings.seo_title);
  const description = text(settings.seo_description);
  const image = escapeHtml(shareImage(ctx));
  const url = escapeHtml(`${ctx.origin}/`);
  const v = escapeHtml(assetVersion);
  return `<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(BRAND_NAME)}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:locale" content="tr_TR">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#070604">
<link rel="icon" href="/favicon.png" type="image/png" sizes="48x48">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/instrument-serif-400-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/manrope-var-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="modulepreload" href="/assets/vendor/anime.esm.min.js">
<link rel="stylesheet" href="/assets/site.css?v=${v}">
<script type="module" src="/assets/site.js?v=${v}"></script>
<script type="application/ld+json">${jsonForScript(structuredData(ctx))}</script>
</head>`;
}

// schema.org data for Google: the shop as a TattooParlor. No opening hours: the open days are not
// known yet, and a wrong value is worse than none.
function structuredData(ctx) {
  const { settings } = ctx;
  const plain = (value) => smartApostrophes(String(value ?? '').trim());
  const data = {
    '@context': 'https://schema.org',
    '@type': 'TattooParlor',
    name: BRAND_NAME,
    alternateName: 'Çınar Ink Tattoo Piercing Studio',
    url: `${ctx.origin}/`,
    image: shareImage(ctx),
    description: plain(settings.seo_description),
    foundingDate: String(FOUNDED),
  };
  if (!blank(settings.about_title)) data.founder = { '@type': 'Person', name: plain(settings.about_title) };
  if (ctx.tel !== null) data.telephone = ctx.tel.slice('tel:'.length);
  data.address = {
    '@type': 'PostalAddress',
    streetAddress: plain(settings.address).replace(/\s*\n\s*/g, ', '),
    addressLocality: 'Esenler',
    addressRegion: 'İstanbul',
    addressCountry: 'TR',
  };
  data.areaServed = AREA_SERVED;
  if (ctx.directions !== null) data.hasMap = ctx.directions;
  const sameAs = [ctx.instagram, blank(settings.tiktok_url) ? null : String(settings.tiktok_url).trim()].filter((url) => url !== null);
  if (sameAs.length > 0) data.sameAs = sameAs;
  data.makesOffer = ctx.services.map((service) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: plain(service.name) } }));
  return data;
}

// ---------------------------------------------------------------------------------------------
// Intro, bar, menu sheet
// ---------------------------------------------------------------------------------------------

// The opening: "Çınar Tattoo" and under it "ESENLER · 2005", big, over the line; under the line the service
// names flash past one by one, and under them the Instagram address types itself in.
const INTRO_PLACE = 'ESENLER · 2005';

// Instagram's glyph, drawn in the text colour (the palette stays as it is).
const IG_ICON = '<svg class="ig-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.4" cy="6.6" r="1.3" fill="currentColor"/></svg>';

function intro(year, services = [], handle = null) {
  const letters = (word) => [...word].map((ch) => `<span class="ch">${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}</span>`).join('');
  const name = `<span class="in-row in-brand">${letters(BRAND_NAME)}</span><span class="in-row in-place">${letters(INTRO_PLACE)}</span>`;
  const names = services.map((service) => String(service.name ?? '').trim()).filter(Boolean);
  const ticker = names.length
    ? `\n  <p class="intro-svc" id="introSvc">${names.map((name) => `<span>${text(name)}</span>`).join('')}</p>`
    : '';
  const ig = handle === null ? '' : `\n  <p class="intro-ig" id="introIg">${IG_ICON}<span class="in-ig-t">${letters(handle)}</span></p>`;
  return `<div class="intro" id="intro" aria-hidden="true">
  <div class="intro-half t"></div><div class="intro-half b"></div>
  <div class="intro-name" id="introName">${name}</div>
  <div class="intro-line" id="introLine"></div>${ticker}${ig}
  <p class="intro-year num" id="introYear" data-to="${escapeHtml(year)}">${FOUNDED}</p>
  <button class="intro-skip" id="introSkip" type="button">Atla</button>
</div>`;
}

// The announcement shows when it is on and has a text. The page then moves the logo down under it.
const hasNotice = (ctx) => ctx.settings.announcement_on === '1' && !blank(ctx.settings.announcement_text);

function bar(ctx, sections) {
  const menu = sections
    .filter((section) => section.menu)
    .map((section) => `<a href="#${section.id}"><i>${section.no}</i>${section.label}</a>`)
    .join('');
  const { settings } = ctx;
  const notice = hasNotice(ctx)
      ? `\n  <div class="duyuru" role="note"><p>${text(String(settings.announcement_text).trim())}</p><button type="button" class="duyuru-kapat" aria-label="Duyuruyu kapat">✕</button></div>`
      : '';
  // Under the name: the Instagram address, so it is the first thing seen after the opening.
  const igMark = instaLink(ctx, 'mark-ig', `${IG_ICON}<span class="mark-ig-t">${escapeHtml(ctx.handle ?? 'Instagram')}</span>`);
  const igMarkHtml = igMark === '' ? '' : `\n      ${igMark}`;
  return `<header class="bar" id="bar">
  <div class="bar-in">
    <div class="brand">
      <a class="mark" href="#top" aria-label="Çınar Tattoo, başa dön"><b>Çınar Tattoo</b><span>ESENLER · 2005</span></a>${igMarkHtml}
    </div>
    <nav class="menu" aria-label="Ana menü">${menu}</nav>
    ${waLink(ctx, 'btn', `WhatsApp${arrow}`)}
    <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="sheet">Menü</button>
  </div>${notice}
</header>`;
}

function sheet(ctx, sections) {
  const links = sections.map((section) => `  <a href="#${section.id}"><i>${section.no}</i>${section.label}</a>`).join('\n');
  return `<div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-label="Menü">
  <button class="sheet-close" id="sheetClose" type="button">Kapat</button>
${links}
  <div class="sheet-foot">${waLink(ctx, 'btn', 'WhatsApp')}${telLink(ctx, 'btn ghost', 'Ara')}</div>
</div>`;
}

// ---------------------------------------------------------------------------------------------
// Hero, facts, strip
// ---------------------------------------------------------------------------------------------

function heroLines(title) {
  const parts = String(title ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (parts.length > 3) parts.splice(2, parts.length - 2, parts.slice(2).join(' '));
  return parts;
}

// What the visitor reads on arrival: the services (the service names) and where the shop is (address,
// hours, directions). Desktops show them left and right of the logo, over the photo; phones in a small
// card under it. Each part is left out when it has nothing to show, and the whole when both are empty.
function heroInfo(ctx) {
  const { settings, services } = ctx;
  const names = services.map((service) => String(service.name ?? '').trim()).filter(Boolean);
  const what = names.length
    ? `<div class="hi-what"><p class="hi-label">Hizmetler</p><ul>${names.map((name) => `<li>${text(name)}</li>`).join('')}</ul></div>`
    : '';
  const parts = [
    blank(settings.address) ? '' : `<span class="hi-addr">${text(String(settings.address).trim())}</span>`,
    blank(settings.hours) ? '' : `<span class="hi-hours">${text(String(settings.hours).trim())}</span>`,
    dirLink(ctx, 'hi-route', `Yol tarifi${arrow}`),
  ].filter(Boolean).join('');
  const where = parts
    ? `<div class="hi-where"><p class="hi-label"><span class="dot" aria-hidden="true"></span>Adres</p><p class="hi-place">${parts}</p></div>`
    : '';
  return what || where ? `<div class="hero-info">${what}${where}</div>` : '';
}

function hero(ctx) {
  const { settings } = ctx;
  const image = ctx.hero;
  const urls = imageUrls(image);
  const scale = Math.min(1, THUMB_MAX / Math.max(image.width, image.height));
  const thumbWidth = Math.round(image.width * scale);
  const alt = image.source === 'seed' ? SEED_LOGO_ALT : BRAND_NAME;
  const parts = heroLines(settings.hero_title);
  const h1Lines = parts
    .map((line, index) => {
      const inner = parts.length > 1 && index === parts.length - 1 ? `<em>${text(line)}</em>` : text(line);
      return `\n          <span class="ln" aria-hidden="true"><span>${inner}</span></span>`;
    })
    .join('');
  const sub = blank(settings.hero_text) ? '' : `\n        <p class="hero-sub">${text(String(settings.hero_text).trim())}</p>`;
  const actions = [waLink(ctx, 'btn', `WhatsApp’tan yaz${arrow}`), telLink(ctx, 'btn ghost', 'Ara'), dirLink(ctx, 'link link-gap', 'Yol tarifi')].join('');
  const img = `<img id="heroLogo" src="${escapeHtml(urls.full)}" srcset="${escapeHtml(urls.thumb)} ${thumbWidth}w, ${escapeHtml(urls.full)} ${image.width}w" sizes="(max-width: 900px) 100vw, min(100vw, 120svh)" width="${image.width}" height="${image.height}" alt="${escapeHtml(alt)}" fetchpriority="high">`;
  // The seed hero is the shop's square logo in front of the dimmed studio photo. A picture the owner
  // uploaded in the panel is shown as it is.
  const { wide, tall } = HERO_BACKDROP;
  const backdrop = `<div class="hero-bg" aria-hidden="true"><picture><source media="(min-width: 901px)" srcset="${wide.src}" width="${wide.width}" height="${wide.height}"><img src="${tall.src}" width="${tall.width}" height="${tall.height}" alt="" decoding="async"></picture></div>`;
  const info = heroInfo(ctx);
  const sign = image.source === 'seed'
    ? `<div class="hero-sign stage">${backdrop}${img}${info}</div>`
    : `<div class="hero-sign">${img}${info}</div>`;

  return `<section class="hero" aria-labelledby="heroTitle">
  <div class="hero-top">
    ${sign}
    <div class="page hero-grid">
      <div class="hero-copy">
        <p class="lbl"><span class="dot" aria-hidden="true"></span><b>Esenler dövme &amp; piercing</b> · 2005’ten beri</p>
        <h1 id="heroTitle" aria-label="${text(parts.join(' '))}">${h1Lines}
        </h1>
      </div>
      <div class="hero-side">${sub}
        ${actions === '' ? '' : `<div class="hero-act">${actions}</div>`}
      </div>
    </div>
  </div>
  <div class="page">
    ${facts(ctx)}
  </div>${strip(ctx)}
</section>`;
}

function facts(ctx) {
  const items = ['<div class="fact"><b class="num">+20</b><span>yıllık tecrübe</span></div>'];
  if (!blank(ctx.settings.instagram_followers)) items.push(`<div class="fact"><b>${text(String(ctx.settings.instagram_followers).trim())}</b><span>Instagram takipçisi</span></div>`);
  const google = googleSummary(ctx);
  if (ctx.reviews.length > 0 && google?.typed) {
    items.push(`<div class="fact"><b class="num">${text(google.score)} ★</b><span>${text(google.count)} Google yorumu</span></div>`);
  } else if (ctx.reviews.length > 0) {
    const fives = ctx.reviews.filter((review) => review.rating === 5).length;
    const all = ctx.reviews.length;
    const label = fives === all ? 'Google yorumu, hepsi 5 yıldız' : 'yorum 5 yıldız';
    items.push(`<div class="fact"><b class="num">${fives} / ${all}</b><span>${label}</span></div>`);
  }
  items.push('<div class="fact"><b>Steril</b><span>iğne göz önünde açılır</span></div>');
  return `<div class="facts f${items.length}">${items.join('')}</div>`;
}

const caption = (photo) => (blank(photo.caption) ? '' : text(String(photo.caption).trim()));
// A seeded CC0 stock photo (defaults.js, "sample"), not the studio's own work: marked "Temsili".
const altOf = (photo) => caption(photo) || UNTITLED_WORK;

function strip(ctx) {
  const photos = ctx.photos.slice(0, STRIP_MAX);
  if (photos.length === 0) return '';
  const figures = photos
    .map((photo, index) => {
      const { thumb } = imageUrls(photo);
      return `<figure><div class="ph"><img src="${escapeHtml(thumb)}" alt="" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async"></div><figcaption><b>${caption(photo)}</b><span class="num">${pad(index + 1)}</span></figcaption></figure>`;
    })
    .join('\n      ');
  return `
  <div class="strip" id="strip" aria-label="Çalışmalardan seçki">
    <div class="strip-track" id="stripTrack">
      ${figures}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

function sectionTop(id, no, label, heading, side = '') {
  return `<div class="sec-top">
      <p class="sec-no num" aria-hidden="true">${no}</p>
      <div class="sec-head"><p class="lbl">${label}</p><h2 id="h-${id}" aria-label="${escapeHtml(heading)}">${splitHeading(heading)}</h2></div>${side === '' ? '' : `\n      <p class="sec-side">${side}</p>`}
    </div>`;
}

const section = (id, no, inner) => `<section class="sec" id="${id}" aria-labelledby="h-${id}">
  <div class="page">
    ${inner}
  </div>
</section>`;

const SECTION_BUILDERS = { sanatci: artist, calismalar: works, surec: process, yorumlar: reviews, fiyatlar: prices, bakim: care, randevu: booking, sss: faq };
// The sections that render only with their content; the others always do.
const SECTION_SHOWN = {
  sanatci: (ctx) => !blank(ctx.settings.about_title) || !blank(ctx.settings.about_text) || listSetting(ctx.settings, 'highlights').length > 0,
  yorumlar: (ctx) => ctx.reviews.length > 0,
  fiyatlar: (ctx) => ctx.prices.length > 0,
};

function works(ctx, no) {
  const photos = ctx.photos.slice(0, WORKS_MAX);
  const counts = new Map(CATEGORIES.map((category) => [category, ctx.photos.filter((photo) => photo.category === category).length]));
  const used = CATEGORIES.filter((category) => counts.get(category) > 0);
  const hasTabs = used.length >= 2;
  const side = `Esenler’deki stüdyoda yapılan dövmeler: siyah-gri, ince çizgi, renkli ve yazı. ${hasTabs ? 'Türe göre süz, büyütmek için dokun.' : 'Büyütmek için dokun.'}`;
  const top = sectionTop('calismalar', no, 'Çalışmalar', 'Stüdyodan, gerçek işler.', side);

  if (photos.length === 0) {
    const more = instaLink(ctx, 'link', 'Instagram’da işlere bak ↗');
    return section('calismalar', no, `${top}
    <div class="empty"><p>Yeni işler yakında burada.</p>${more}</div>`);
  }

  const tabs = hasTabs
    ? `
    <div class="tabs" id="tabs" role="group" aria-label="Türe göre süz">
      <button class="tab" type="button" data-f="all" aria-pressed="true">Tümü <sup>${ctx.photos.length}</sup></button>${used
        .map((category) => `<button class="tab" type="button" data-f="${category}" aria-pressed="false">${CATEGORY_LABELS[category]} <sup>${counts.get(category)}</sup></button>`)
        .join('')}
    </div>`
    : '';
  const cards = photos
    .map((photo, index) => {
      const { full, thumb } = imageUrls(photo);
      const label = altOf(photo);
      return `<figure class="work" id="is-${escapeHtml(photo.id)}" data-i="${index}" data-no="${index + 1}" data-style="${escapeHtml(photo.category)}"${index >= WORKS_SHOWN ? ' hidden' : ''}>
        <button type="button" class="wipe" aria-label="${label}, büyüt"><img src="${escapeHtml(thumb)}" data-full="${escapeHtml(full)}" alt="${label}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async"></button>
        <figcaption><b>${caption(photo)}</b><span class="num">No. ${pad(index + 1)}</span></figcaption>
      </figure>`;
    })
    .join('\n      ');
  const more = photos.length > WORKS_SHOWN ? '<button type="button" class="btn ghost daha" id="daha">Daha fazla göster</button>' : '';
  const rest = ctx.photos.length > WORKS_MAX ? instaLink(ctx, 'link', 'Tüm işler Instagram’da ↗') : '';
  const after = more + rest === '' ? '' : `\n    <div class="works-more">${more}${rest}</div>`;
  return `${section('calismalar', no, `${top}${tabs}
    <div class="works" id="works">
      ${cards}
    </div>${after}`)}
${lightbox(ctx)}`;
}

function lightbox(ctx) {
  const ask = waLink(ctx, 'btn lb-wa', `Buna benzer istiyorum${arrow}`);
  return `<dialog class="lb" id="lb" aria-label="Çalışma görüntüleyici">
  <div class="lb-in">
    <button class="lb-btn lb-prev" id="lbPrev" type="button" aria-label="Önceki">←</button>
    <figure><img id="lbImg" alt=""><figcaption class="lbl" id="lbCap"></figcaption>${ask === '' ? '' : `${ask.replace('<a ', '<a id="lbWa" ')}`}</figure>
    <button class="lb-btn lb-next" id="lbNext" type="button" aria-label="Sonraki">→</button>
  </div>
  <button class="lb-btn lb-close" id="lbClose" type="button" aria-label="Kapat">✕</button>
</dialog>`;
}

function banner(ctx) {
  const wall = ctx.photos.slice(0, STRIP_MAX);
  const wallHtml =
    wall.length === 0
      ? ''
      : `\n  <div class="wall" id="wall" aria-hidden="true">${wall.map((photo) => `<img src="${escapeHtml(imageUrls(photo).thumb)}" alt="" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async">`).join('')}</div>`;
  const action = ctx.waGeneric !== null ? waLink(ctx, 'btn', `Fikrini gönder${arrow}`) : telLink(ctx, 'btn', 'Ara');
  return `<section class="banner${wall.length === 0 ? ' bare' : ''}" aria-labelledby="h-banner">${wallHtml}
  <div class="banner-in" data-rise>
    <p class="lbl"><b>Kişiye özel çizim</b></p>
    <h2 id="h-banner">Fikrin sende, çizgisi bizde.</h2>
    <p>Referansını gönder, tasarım sana göre çizilsin. Şablonu deriye koymadan önce son halini birlikte veririz.</p>${action === '' ? '' : `\n    ${action}`}
  </div>
</section>
`;
}

function process(ctx, no) {
  const heroFull = imageUrls(ctx.hero).full;
  // The steps are a tattoo's, so they show tattoos when the gallery has four; else any photos.
  const tattoos = ctx.photos.filter((photo) => photo.category === 'dovme' || photo.category === 'gecici');
  const pool = tattoos.length >= 4 ? tattoos : ctx.photos;
  const pictures = [0, 1, 2, 3].map((index) => {
    const photo = pool[index];
    return photo === undefined ? { src: heroFull, width: ctx.hero.width, height: ctx.hero.height } : { src: imageUrls(photo).full, width: photo.width, height: photo.height };
  });
  const steps = [
    ['Fikir', ctx.waGeneric !== null ? 'WhatsApp’tan fikrini, referanslarını ve dövmenin yerleşeceği bölgeyi gönder.' : 'Telefonla fikrini, referanslarını ve dövmenin yerleşeceği bölgeyi anlat.'],
    ['Çizim', 'Tasarım sana göre çizilir; şablonu deriye koymadan önce birlikte son halini veririz.'],
    ['Seans', 'Steril ortam, tek kullanımlık iğne ve mürekkep kapları. Sen rahat et.'],
    ['İyileşme', 'Bakım listesiyle eve gidersin. Takıldığın bir şey olursa yaz.'],
  ];
  const img = (picture, cls) => `<img${cls} src="${escapeHtml(picture.src)}" alt="" width="${picture.width}" height="${picture.height}" loading="lazy" decoding="async">`;
  const list = steps
    .map(([title, body], index) => `<li class="pstep"><span class="n num" aria-hidden="true">${pad(index + 1)}</span><div><h3>${title}</h3><p>${body}</p></div>${img(pictures[index], ' class="m-img"')}</li>`)
    .join('\n        ');
  return section(
    'surec',
    no,
    `${sectionTop('surec', no, 'Süreç', 'Fikirden deriye.', 'Dört adım. Acele yok, sürpriz yok.')}
    <div class="proc">
      <ol class="proc-list" id="procList">
        ${list}
      </ol>
      <figure class="proc-fig" aria-hidden="true">
        <div class="stack" id="procStack">${pictures.map((picture) => img(picture, '')).join('')}</div>
        <figcaption class="lbl"><span id="procNo" class="num">01 / 04</span><span id="procName">Fikir</span></figcaption>
      </figure>
    </div>`,
  );
}

// Sanatçımız: his photo, the about title and text, the highlights as a numbered list, then the
// services. Each highlight is "title — detail", split at its first dash; without one it is a title.
function artist(ctx, no) {
  const { settings } = ctx;
  const title = blank(settings.about_title) ? ARTIST_NAME : String(settings.about_title).trim();
  const lede = paragraphs(smartApostrophes(settings.about_text ?? ''));
  const highlights = listSetting(settings, 'highlights').map((item) => {
    const at = item.indexOf(HIGHLIGHT_DASH);
    if (at === -1) return `<b>${text(item.trim())}</b>`;
    const detail = item.slice(at + HIGHLIGHT_DASH.length).trim();
    return `<b>${text(item.slice(0, at).trim())}</b>${detail === '' ? '' : `<span>${text(detail)}</span>`}`;
  });
  const list = highlights.length === 0 ? '' : `\n        <ol class="artist-list">${highlights.map((item, index) => `<li><i class="num">${pad(index + 1)}</i>${item}</li>`).join('')}</ol>`;
  const ask = waLink(ctx, 'btn', `Onur Bey’e yaz${arrow}`);
  return section(
    'sanatci',
    no,
    `<div class="artist">
      <figure class="artist-ph">
        <div class="artist-frame wipe"><img src="${ARTIST_PHOTO.src}" alt="${escapeHtml(ARTIST_PHOTO.alt)}" width="${ARTIST_PHOTO.width}" height="${ARTIST_PHOTO.height}" loading="lazy" decoding="async"></div>
        <figcaption class="lbl"><span>${escapeHtml(ARTIST_NAME)}</span><span>Çınar Tattoo · Esenler</span></figcaption>
      </figure>
      <div class="artist-copy" data-rise>
        <p class="sec-no num artist-no" aria-hidden="true">${no}</p>
        <p class="lbl">Sanatçımız</p>
        <h2 id="h-sanatci">${text(title)}</h2>${lede === '' ? '' : `\n        <div class="artist-lede">${lede}</div>`}${list}${ask === '' ? '' : `\n        ${ask}`}
      </div>
    </div>${services(ctx)}`,
  );
}

function services(ctx) {
  if (ctx.services.length === 0) return '';
  const used = new Set();
  const items = ctx.services
    .map((service, index) => {
      const name = String(service.name ?? '').trim();
      const description = blank(service.description) ? '' : `<p>${text(String(service.description).trim())}</p>`;
      const photo = servicePhoto(name, used);
      const figure = photo === null
        ? ''
        : `<figure class="svc-ph${photo.logo ? ' logo' : ''}"><img src="${photo.src}" alt="${escapeHtml(photo.alt)}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async"></figure>`;
      return `<li>${figure}<i class="num">${pad(index + 1)}</i><h3>${text(name)}</h3>${description}</li>`;
    })
    .join('\n        ');
  return `
    <div class="services" data-rise>
      <p class="lbl">Hizmetler</p>
      <ul class="svc-list">
        ${items}
      </ul>
    </div>`;
}

// The first unused picture whose words appear in the name, or null.
function servicePhoto(name, used) {
  const lower = name.toLocaleLowerCase('tr-TR');
  const photo = SERVICE_PHOTOS.find((candidate) => !used.has(candidate.key) && candidate.words.some((word) => lower.includes(word)));
  if (photo === undefined) return null;
  used.add(photo.key);
  return photo;
}

// Google's "G", in its own colours, so the reviews read as Google reviews at a glance.
const GOOGLE_G = `<svg class="g-logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

// Google's score and review count: as typed in the panel (google_rating and google_review_count),
// else worked out from the Google reviews on the site. null when there is neither.
function googleSummary(ctx) {
  const score = String(ctx.settings.google_rating ?? '').trim();
  const count = String(ctx.settings.google_review_count ?? '').trim();
  if (score !== '' && count !== '') return { score, count, typed: true };
  const fromGoogle = ctx.reviews.filter((review) => review.source === 'google');
  if (fromGoogle.length === 0) return null;
  const average = fromGoogle.reduce((sum, review) => sum + Math.max(1, Math.min(5, Number(review.rating) || 5)), 0) / fromGoogle.length;
  return { score: average.toFixed(1).replace('.', ','), count: String(fromGoogle.length), typed: false };
}

function reviews(ctx, no) {
  // Every review is on the page at once, as a wall of Google-style cards: no slider, nothing to click.
  const items = ctx.reviews
    .map((review) => {
      const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
      const source = REVIEW_SOURCE_LABELS[review.source] ?? REVIEW_SOURCE_LABELS.diger;
      const mark = review.source === 'google' ? GOOGLE_G : '';
      const date = blank(review.date_text) ? '' : ` · ${escapeHtml(review.date_text)}`;
      const initial = escapeHtml([...String(review.name ?? '').trim()][0]?.toLocaleUpperCase('tr') ?? '?');
      return `<li class="rv"><p class="rv-by"><span class="rv-av" aria-hidden="true">${initial}</span><span class="rv-who"><b>${escapeHtml(review.name)}</b><span class="q-src">${mark}${source}${date}</span></span></p><span class="stars" role="img" aria-label="5 üzerinden ${rating} yıldız">${'★'.repeat(rating)}</span><blockquote>${escapeHtml(review.text).replaceAll('\n', '<br>')}</blockquote></li>`;
    })
    .join('\n        ');
  const reviewsUrl = blank(ctx.settings.google_reviews_url) ? '' : escapeHtml(String(ctx.settings.google_reviews_url).trim());
  const google = reviewsUrl === '' ? '' : `<a class="link" href="${reviewsUrl}" ${external}>Tüm yorumlar Google’da ↗</a>`;
  // The summary over the wall: Google's G, the score and how many Google reviews there are.
  const summary = googleSummary(ctx);
  let badge = '';
  if (summary !== null) {
    const inner = `${GOOGLE_G}<span class="g-name">Google</span><b class="g-score num">${escapeHtml(summary.score)}</b><span class="stars" aria-hidden="true">★★★★★</span><span class="g-count">${escapeHtml(summary.count)} Google yorumu</span>`;
    badge =
      reviewsUrl === ''
        ? `<p class="g-badge">${inner}</p>`
        : `<a class="g-badge" href="${reviewsUrl}" ${external}>${inner}</a>`;
  }
  const head = badge === '' && google === '' ? '' : `\n      <div class="quote-head">${badge}${google}</div>`;
  return section(
    'yorumlar',
    no,
    `${sectionTop('yorumlar', no, 'Yorumlar', 'Gidenler anlatıyor.', 'Google’daki yorumlar, yazıldığı gibi; tek harfine dokunmadan.')}
    <div class="quote" id="quote">${head}
      <ul class="rv-wall">
        ${items}
      </ul>
    </div>`,
  );
}

function prices(ctx, no) {
  const columns = ctx.prices
    .map((group) => {
      const rows = group.items
        .map((item) => {
          const detail = blank(item.detail) ? '' : `<small>${text(item.detail)}</small>`;
          let price;
          if (!blank(item.price)) price = `<b class="num">${text(item.price)}</b>`;
          else if (ctx.waGeneric !== null) price = waLink(ctx, 'link', 'Fiyat için yaz', ctx.wa(`${smartApostrophes(group.title)}, ${smartApostrophes(item.name)} için fiyat öğrenebilir miyim?`));
          else if (ctx.tel !== null) price = telLink(ctx, 'link', 'Fiyat için ara');
          else price = '<span>Dükkânda sor</span>';
          return `<li><span class="pr-name">${text(item.name)}${detail}</span><span class="pr-price">${price}</span></li>`;
        })
        .join('');
      return `<div data-rise><h3>${text(group.title)}</h3><ol>${rows}</ol></div>`;
    })
    .join('\n      ');
  return section(
    'fiyatlar',
    no,
    `${sectionTop('fiyatlar', no, 'Fiyatlar', 'Fiyat listesi.')}
    <div class="ledger prices">
      ${columns}
    </div>
    <p class="note">Fiyatlar boyuta ve detaya göre değişebilir; net fiyat için yaz.</p>`,
  );
}

function care(ctx, no) {
  const ask = ctx.waGeneric !== null ? 'Onur Bey’e WhatsApp’tan sor' : 'Onur Bey’e sor';
  const list = (items) => items.map((item, index) => `<li><i class="num">${pad(index + 1)}</i>${item}</li>`).join('\n          ');
  return section(
    'bakim',
    no,
    `${sectionTop('bakim', no, 'Bakım · ilk 2–4 hafta', 'İyi dövme, iyi iyileşir.')}
    <div class="ledger">
      <div data-rise>
        <h3>Yap</h3>
        <ol>
          ${list([
            'Koruyucu filmi, seansta söylenen süre kadar üzerinde tut.',
            'Ilık su ve parfümsüz sabunla elle nazikçe yıka, kağıt havluyla bastırarak kurula.',
            'İnce bir kat bakım kremi sür; fazlası cildin nefes almasını engeller.',
            'İyileştikten sonra güneşte yüksek faktörlü krem kullan.',
          ])}
        </ol>
      </div>
      <div class="no" data-rise>
        <h3><span class="dot" aria-hidden="true"></span>Yapma</h3>
        <ol>
          ${list(['Kabukları koparma, kaşıma.', '2–3 hafta havuz, deniz, sauna ve küvet yok.', 'Dar, sürtünen kıyafetlerle bölgeyi tahriş etme.', 'İlk günlerde bölgeyi doğrudan güneşe çıkarma.'])}
        </ol>
      </div>
    </div>
    <p class="note">Emin olmadığın bir şey olursa ${ask}. Kızarıklık günler içinde artıyorsa, ateşin çıkarsa ya da akıntı olursa bir doktora başvur.</p>`,
  );
}

function booking(ctx, no) {
  const { settings } = ctx;
  const rows = [];
  if (!blank(settings.phone)) {
    const shown = text(String(settings.phone).trim());
    rows.push(['Telefon', ctx.tel === null ? shown : `<a href="${escapeHtml(ctx.tel)}" data-track="call">${shown}</a>`]);
  }
  if (!blank(settings.hours)) rows.push(['Saat', `${text(String(settings.hours).trim())}${blank(settings.hours_note) ? '' : `<small>${text(String(settings.hours_note).trim())}</small>`}`]);
  if (!blank(settings.address)) rows.push(['Adres', lines(String(settings.address).trim())]);
  if (!blank(settings.payment_text)) rows.push(['Ödeme', text(String(settings.payment_text).trim())]);
  if (ctx.handle !== null) rows.push(['Instagram', instaLink(ctx, '', escapeHtml(ctx.handle))]);
  const dl = rows.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('\n          ');
  const actions = [waLink(ctx, 'btn', `WhatsApp${arrow}`), telLink(ctx, 'btn ghost', 'Ara'), dirLink(ctx, 'btn ghost', 'Yol tarifi')].join('');
  const map = blank(settings.address)
    ? ''
    : `\n        <div class="map"><button type="button" data-src="${escapeHtml(mapsEmbedSrc(String(settings.address).trim()))}"><b>Haritayı aç</b>Google Haritalar’dan yüklenir</button></div>`;
  const side = ctx.waGeneric !== null ? 'Formu doldur, WhatsApp’ta mesajın hazır açılsın. Referans görsellerini de oradan atarsın.' : 'Ara ya da uğra; adres ve saat burada.';
  return section(
    'randevu',
    no,
    `${sectionTop('randevu', no, 'Randevu', 'Sıra sende.', side)}
    <div class="book">
      <div class="book-info">
        <dl>
          ${dl}
        </dl>${actions === '' ? '' : `\n        <div class="hero-act">${actions}</div>`}${map}
      </div>${bookingForm(ctx)}
    </div>`,
  );
}

function bookingForm(ctx) {
  if (ctx.waGeneric === null) return '';
  const chips = (name, options, checkFirst) =>
    options
      .map(([value, label], index) => `<label class="opt"><input type="radio" name="${name}" value="${escapeHtml(value)}"${checkFirst && index === 0 ? ' checked' : ''}><span>${label}</span></label>`)
      .join('\n          ');
  const services = ctx.services.map((service) => {
    const name = text(service.name);
    return [smartApostrophes(service.name), name];
  });
  const kinds = services.length > 0 ? `
        <fieldset class="opts"><legend>Ne için?</legend>
          ${chips('kind', services, true)}
        </fieldset>` : '';
  return `

      <form class="form" id="bookForm" novalidate>
        <h3>Randevu mesajı</h3>
        <div class="form-js">
        <div class="f-row">
          <div class="fld"><label for="fName">Adın</label><input id="fName" name="name" autocomplete="name" maxlength="60" required></div>
          <div class="fld"><label for="fWhen">Ne zaman?</label><input id="fWhen" name="when" maxlength="60" placeholder="Örn. hafta sonu"></div>
        </div>
        <div class="fld"><label for="fIdea">Fikrin</label><textarea id="fIdea" name="idea" rows="3" maxlength="600" required placeholder="Ne yaptırmak istiyorsun?"></textarea></div>${kinds}
        <fieldset class="opts"><legend>Bölge</legend>
          ${chips('place', PLACES.map((place) => [place, place]), false)}
        </fieldset>
        <fieldset class="opts"><legend>Boyut</legend>
          ${chips('size', SIZES, false)}
        </fieldset>
        <p class="err" id="formErr" role="alert" hidden></p>
        <div><button class="btn" type="submit" data-track="form">WhatsApp’ta mesajı aç${arrow}</button></div>
        <p class="fine">Mesaj hiçbir yere kaydedilmez; yalnızca WhatsApp’ta hazır yazılmış olarak açılır.</p>
        </div>
        <p class="form-nojs">${waLink(ctx, 'btn', `WhatsApp’tan yaz${arrow}`)}</p>
      </form>`;
}

function faq(ctx, no) {
  const via = ctx.waGeneric !== null ? 'WhatsApp’tan' : 'bize';
  const items = [
    ['Fiyat ne kadar?', `Boyuta, detaya ve bölgeye göre değişir. Fikrini ve yaklaşık boyutu ${via} gönder, net fiyatı birlikte konuşalım.`],
    ['Yaş sınırı var mı?', 'Evet. 18 yaşından küçüklere dövme yapılmaz; seans günü kimliğini yanında getir.'],
    ['Seanstan önce ne yapmalıyım?', 'İyi uyu, doyurucu bir öğün ye, bol su iç. Seanstan önceki 24 saat alkol alma. Dövülecek bölgeye rahat erişilen kıyafetler giy.'],
    ['Piercing de yapıyor musunuz?', `Evet, titanyum ya da çelik takıyla; kulak delme de ağrısız yapılır. Hangi bölge için düşündüğünü ${via} yaz, uygun takı ve randevu için bilgi verelim.`],
    ['Geçici dövme var mı?', `Evet, yapıştırma (çıkartma) geçici dövme var; kalıcıya karar vermeden önce deneyebilirsin. Ne istediğini ${via} yaz.`],
  ];
  return section(
    'sss',
    no,
    `${sectionTop('sss', no, 'SSS', 'Merak edilenler.')}
    <div class="faq">
      <div class="faq-list">
        ${items.map(([question, answer], index) => `<details><summary><i class="num">${pad(index + 1)}</i>${question}</summary><p class="ans">${answer}</p></details>`).join('\n        ')}
      </div>
    </div>`,
  );
}

// ---------------------------------------------------------------------------------------------
// Footer and dock
// ---------------------------------------------------------------------------------------------

function footer(ctx) {
  const { settings } = ctx;
  const cols = [];
  if (!blank(settings.address)) cols.push(`<div><span class="lbl">Adres</span><span>${lines(String(settings.address).trim())}</span></div>`);
  const contact = [];
  if (!blank(settings.phone)) contact.push(ctx.tel === null ? `<span>${text(String(settings.phone).trim())}</span>` : `<a href="${escapeHtml(ctx.tel)}" data-track="call">${text(String(settings.phone).trim())}</a>`);
  contact.push(waLink(ctx, '', 'WhatsApp'));
  if (!blank(settings.email)) contact.push(`<a href="mailto:${escapeHtml(String(settings.email).trim())}">${text(String(settings.email).trim())}</a>`);
  cols.push(`<div><span class="lbl">İletişim</span>${contact.join('')}</div>`);
  if (!blank(settings.hours)) cols.push(`<div><span class="lbl">Saat</span><span>${text(String(settings.hours).trim())}</span></div>`);
  const follow = [instaLink(ctx, '', 'Instagram ↗')];
  if (!blank(settings.tiktok_url)) follow.push(`<a href="${escapeHtml(String(settings.tiktok_url).trim())}" ${external}>TikTok</a>`);
  follow.push('<a href="#top">Başa dön ↑</a>');
  cols.push(`<div><span class="lbl">Takip</span>${follow.join('')}</div>`);
  return `<footer class="foot">
  <div class="page">
    <div class="foot-cols">
      ${cols.join('\n      ')}
    </div>
    <p class="foot-big">Çınar Tattoo</p>
    <div class="foot-bar"><span>© ${escapeHtml(ctx.year)} Çınar Tattoo · Esenler / İstanbul</span><span>2005’ten beri</span></div>
  </div>
</footer>`;
}

function dock(ctx) {
  const links = [telLink(ctx, 'dock-a', 'Ara'), waLink(ctx, 'dock-a main', 'WhatsApp'), dirLink(ctx, 'dock-a', 'Yol tarifi')].filter((link) => link !== '');
  if (links.length === 0) return '';
  return `<nav class="dock d${links.length}" id="dock" aria-label="Hızlı iletişim">
  ${links.join('\n  ')}
</nav>`;
}
