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
const SEED_LOGO_ALT = 'Çınar Tattoo logosu: Çınar Ink, Tattoo Piercing Studio, 2005 ve çapa';
const ARTIST_NAME = 'Onur Aydoğan';
// public/media/sanatci.jpg: the owner's solo studio photo (2026-11-03), cropped to 4:5.
const ARTIST_PHOTO = { src: '/media/sanatci.jpg', width: 800, height: 1000, alt: 'Çınar Tattoo’nun sanatçısı Onur Aydoğan, Esenler’deki stüdyosunda' };
const HIGHLIGHT_DASH = ' — '; // a highlight is "title — detail"
const UNTITLED_WORK = 'Çınar Tattoo çalışması';
const AREA_SERVED = ['Esenler', 'Bağcılar', 'Güngören', 'Bayrampaşa', 'Gaziosmanpaşa', 'İstanbul'];

// The sections in page order: id, menu label, whether the desktop menu lists it. Each renders only
// when its builder gives HTML.
const SECTIONS = [
  { id: 'sanatci', label: 'Sanatçı', menu: true },
  { id: 'calismalar', label: 'Çalışmalar', menu: true },
  { id: 'reels', label: 'Reels', menu: true },
  { id: 'surec', label: 'Süreç', menu: true },
  { id: 'yorumlar', label: 'Yorumlar', menu: true },
  { id: 'fiyatlar', label: 'Fiyatlar', menu: true },
  { id: 'bakim', label: 'Bakım', menu: false },
  { id: 'randevu', label: 'Randevu', menu: true },
  { id: 'sss', label: 'SSS', menu: true },
];

const REELS = [
  { n: 1, title: 'Orman & kurt', label: 'Orman ve kurt dövmesi videosu' },
  { n: 2, title: 'Çift kurt', label: 'Çift kurt dövmesi videosu' },
  { n: 3, title: 'El üstü gül', label: 'El üstü gül dövmesi videosu' },
  { n: 4, title: 'Renkli tam kol', label: 'Renkli tam kol dövmesi videosu' },
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
    // The banner sits between Reels and Süreç, as in the prototype.
    return section.id === 'surec' ? banner(ctx) + body : body;
  });

  return `<!doctype html>
<html lang="tr"${ctx.waDigits ? ` data-wa="${ctx.waDigits}"` : ''}>
${head(ctx, assetVersion)}
<body id="top"${hasNotice(ctx) ? ' class="has-duyuru"' : ''}>
${intro(year)}
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

function intro(year) {
  const name = [...BRAND_NAME].map((ch) => `<span class="ch">${ch === ' ' ? '&nbsp;' : escapeHtml(ch)}</span>`).join('');
  return `<div class="intro" id="intro" aria-hidden="true">
  <div class="intro-half t"></div><div class="intro-half b"></div>
  <div class="intro-name" id="introName">${name}</div>
  <div class="intro-line" id="introLine"></div>
  <p class="intro-sub lbl" id="introSub">Dövme &amp; piercing · Esenler</p>
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
  return `<header class="bar" id="bar">
  <div class="bar-in">
    <a class="mark" href="#top" aria-label="Çınar Tattoo, başa dön"><b>Çınar Tattoo</b><span>ESENLER · 2005</span></a>
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

  return `<section class="hero" aria-labelledby="heroTitle">
  <div class="hero-top">
    <div class="hero-sign"><img id="heroLogo" src="${escapeHtml(urls.full)}" srcset="${escapeHtml(urls.thumb)} ${thumbWidth}w, ${escapeHtml(urls.full)} ${image.width}w" sizes="(max-width: 900px) 100vw, min(100vw, 120svh)" width="${image.width}" height="${image.height}" alt="${escapeHtml(alt)}" fetchpriority="high"></div>
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
  const items = [`<div class="fact"><b class="num" id="years">${ctx.year - FOUNDED}</b><span>yıldır aynı mahallede</span></div>`];
  if (!blank(ctx.settings.instagram_followers)) items.push(`<div class="fact"><b>${text(String(ctx.settings.instagram_followers).trim())}</b><span>Instagram takipçisi</span></div>`);
  if (ctx.reviews.length > 0) {
    const fives = ctx.reviews.filter((review) => review.rating === 5).length;
    const all = ctx.reviews.length;
    const label = fives === all ? 'Google yorumu, hepsi 5 yıldız' : 'yorum 5 yıldız';
    items.push(`<div class="fact"><b class="num">${fives} / ${all}</b><span>${label}</span></div>`);
  }
  items.push('<div class="fact"><b>Steril</b><span>iğne göz önünde açılır</span></div>');
  return `<div class="facts f${items.length}">${items.join('')}</div>`;
}

const caption = (photo) => (blank(photo.caption) ? '' : text(String(photo.caption).trim()));
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

const SECTION_BUILDERS = { sanatci: artist, calismalar: works, reels, surec: process, yorumlar: reviews, fiyatlar: prices, bakim: care, randevu: booking, sss: faq };
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

function reels(ctx, no) {
  const more = instaLink(ctx, 'link', 'Instagram’da daha fazlası ↗');
  const clips = REELS.map(
    (reel) =>
      `<figure class="clip"><div class="vid wipe"><video src="/media/r${reel.n}.mp4" poster="/media/r${reel.n}.jpg" muted loop playsinline controls preload="none" width="400" height="711" aria-label="${escapeHtml(reel.label)}"></video></div><figcaption><b>${escapeHtml(reel.title)}</b><span class="num">R/${pad(reel.n)}</span></figcaption></figure>`,
  ).join('\n        ');
  return section(
    'reels',
    no,
    `${sectionTop('reels', no, 'Reels', 'Hareket halinde.')}
    <div class="reels">
      <div class="reels-note">
        <p>Bir dövmenin ışıkta, açıda, deride nasıl durduğunu en iyi video gösterir.</p>${more === '' ? '' : `\n        ${more}`}
      </div>
      <div class="clips">
        ${clips}
      </div>
    </div>`,
  );
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
  const pictures = [0, 1, 2, 3].map((index) => {
    const photo = ctx.photos[index];
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
  const items = ctx.services
    .map((service, index) => {
      const description = blank(service.description) ? '' : `<p>${text(String(service.description).trim())}</p>`;
      return `<li><i class="num">${pad(index + 1)}</i><h3>${text(String(service.name ?? '').trim())}</h3>${description}</li>`;
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

function reviews(ctx, no) {
  const items = ctx.reviews
    .map((review) => {
      const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
      const source = REVIEW_SOURCE_LABELS[review.source] ?? REVIEW_SOURCE_LABELS.diger;
      const date = blank(review.date_text) ? '' : ` · ${escapeHtml(review.date_text)}`;
      return `<li class="q"><blockquote>${escapeHtml(review.text).replaceAll('\n', '<br>')}</blockquote><p class="quote-by"><b>${escapeHtml(review.name)}</b><span><span class="stars" role="img" aria-label="5 üzerinden ${rating} yıldız">${'★'.repeat(rating)}</span> · ${source}${date}</span></p></li>`;
    })
    .join('\n          ');
  const google = blank(ctx.settings.google_reviews_url)
    ? ''
    : `<a class="link" href="${escapeHtml(String(ctx.settings.google_reviews_url).trim())}" ${external}>Google’da gör ↗</a>`;
  const nav =
    ctx.reviews.length > 1
      ? `<button type="button" id="qPrev" aria-label="Önceki yorum">←</button>
        <button type="button" id="qNext" aria-label="Sonraki yorum">→</button>
        <div class="quote-prog" aria-hidden="true"><i id="qProg"></i></div>
        <span class="quote-count num" id="qCount">01 / ${pad(ctx.reviews.length)}</span>
        `
      : '';
  return section(
    'yorumlar',
    no,
    `${sectionTop('yorumlar', no, 'Yorumlar', 'Gidenler anlatıyor.', 'Google’daki yorumlar, yazıldığı gibi; tek harfine dokunmadan.')}
    <div class="quote" id="quote" aria-roledescription="yorum gösterici">
      <div class="quote-body" aria-live="polite">
        <ol class="quotes" id="quotes">
          ${items}
        </ol>
      </div>
      <div class="quote-nav">
        ${nav}${google}
      </div>
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
    ['Piercing de yapıyor musunuz?', `Evet, titanyum takıyla. Hangi bölge için düşündüğünü ${via} yaz, uygun takı ve randevu için bilgi verelim.`],
    ['Kalıcı makyaj ve geçici dövme var mı?', `Evet, ikisi de var. Ne istediğini ${via} yaz, ayrıntıları ve randevuyu birlikte konuşalım.`],
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
