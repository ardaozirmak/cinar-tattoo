// The public page (Task 6): renderPage, the / and /sitemap.xml handlers, assetVersion, and the
// static files the page needs (seed images, fonts, the vendored anime.js, the size budgets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zlib } from 'node:zlib';
import { createAssets } from '../dev/static.mjs';
import { renderPage, GREETING } from '../functions/_lib/render.js';
import { assetVersion } from '../functions/_lib/assets.js';
import { onRequestGet, onRequestHead } from '../functions/index.js';
import { onRequestGet as sitemap } from '../functions/sitemap.xml.js';
import { defaultContent, ensureSchema, updateSettings } from '../functions/_lib/db.js';
import { BRAND_NAME, DEFAULT_HERO, SEED_PHOTOS } from '../functions/_lib/defaults.js';
import { CLICK_KINDS } from '../functions/_lib/fields.js';
import { SITE_CSP } from '../functions/_lib/http.js';
import { mapsDirectionsHref, mapsEmbedSrc } from '../functions/_lib/links.js';
import { imageUrls } from '../functions/_lib/media.js';
import { call, makeEnv, tempTree } from './helpers.mjs';

const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const ORIGIN = 'https://cinar.test';

// renderPage over defaultContent(), with `settings` merged into its settings, `content` over the
// rest, and the fixed origin, asset version and year, then `opts`.
function page(settings = {}, content = {}, opts = {}) {
  const base = defaultContent();
  return renderPage({
    content: { ...base, ...content, settings: { ...base.settings, ...settings } },
    origin: ORIGIN,
    assetVersion: 'abc',
    year: 2031,
    ...opts,
  });
}

// A photo uploaded from the panel: its id and image key are one 20-hex string.
function photo(i, category = 'dovme', caption = `İş ${i}`) {
  const id = i.toString(16).padStart(20, '0');
  return { id, caption, category, position: i, source: 'kv', seed_path: null, image_key: id, width: 800, height: 1000, created_at: i };
}

const count = (html, needle) => html.split(needle).length - 1;
const between = (html, start, end) => {
  const from = html.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  return html.slice(from, html.indexOf(end, from + start.length) + end.length);
};
const jsonLd = (html) => JSON.parse(between(html, '<script type="application/ld+json">', '</script>').slice('<script type="application/ld+json">'.length, -'</script>'.length));
const anchors = (html) => html.match(/<a\s[^>]*>/g) ?? [];
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const sectionIds = (html) => [...html.matchAll(/<section class="sec" id="([a-z]+)"/g)].map((match) => match[1]);
const secNos = (html) => [...html.matchAll(/<p class="sec-no num[^"]*" aria-hidden="true">(\d+)<\/p>/g)].map((match) => match[1]);

const WA_GENERIC = 'https://wa.me/905372631546?text=Merhaba%20Onur%20Bey%2C%20siteden%20yaz%C4%B1yorum.%20Randevu%20almak%20istiyorum.';

// ---------------------------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------------------------

test('GREETING is the one the owner asked for', () => {
  assert.equal(GREETING, 'Merhaba Onur Bey, siteden yazıyorum.');
});

test('defaults: the WhatsApp number on <html>, the two-line H1, the logo, the links and the year', () => {
  const html = page();
  assert.match(html, /^<!doctype html>\n<html lang="tr" data-wa="905372631546">/);
  assert.ok(html.includes('<h1 id="heroTitle" aria-label="Bir ömür taşıyacağın dövme.">'));
  const h1 = between(html, '<h1 id="heroTitle"', '</h1>');
  assert.equal(count(h1, 'class="ln"'), 2);
  assert.ok(h1.includes('<em>dövme.</em>'));
  assert.ok(html.includes('src="/seed/logo-full.jpg"'));
  assert.ok(html.includes('srcset="/seed/logo-thumb.jpg 640w, /seed/logo-full.jpg 1254w"'));
  assert.ok(html.includes('sizes="(max-width: 900px) 100vw, min(100vw, 120svh)"'));
  assert.ok(html.includes('alt="Çınar Tattoo logosu: Çınar Ink, Tattoo Piercing Studio, 2005 ve çapa"'));
  assert.ok(html.includes('href="tel:+905372631546"'));
  assert.ok(html.includes(`href="${WA_GENERIC}"`));
  assert.ok(html.includes('© 2031 Çınar Tattoo'));
  assert.ok(html.includes('/assets/site.css?v=abc'));
  assert.ok(html.includes('<script type="module" src="/assets/site.js?v=abc"></script>'));
  assert.ok(html.includes('Esenler dövme &amp; piercing</b> · 2005’ten beri'));
});

test('defaults: 37 work cards, the first is seed-w03, 24 shown and 13 behind “Daha fazla göster”', () => {
  const html = page();
  assert.equal(count(html, '<figure class="work"'), 37);
  assert.ok(html.includes('<figure class="work" id="is-seed-w03" data-i="0" data-no="1" data-style="dovme">'));
  const cards = html.match(/<figure class="work"[^>]*>/g);
  assert.equal(cards.filter((card) => card.endsWith(' hidden>')).length, 13);
  assert.ok(cards.slice(0, 24).every((card) => !card.includes('hidden')));
  assert.equal(count(html, 'Daha fazla göster'), 1);
  const first = between(html, '<figure class="work" id="is-seed-w03"', '</figure>');
  assert.ok(first.includes('src="/seed/w03-thumb.jpg" data-full="/seed/w03-full.jpg"'));
  assert.ok(first.includes('width="400" height="711" loading="lazy"'));
  assert.ok(first.includes('alt="Üçgen içinde gül, el üstü"'));
  assert.ok(first.includes('<figcaption><b>Üçgen içinde gül, el üstü</b><span class="num">No. 01</span></figcaption>'));
  assert.ok(html.includes('<figure class="work" id="is-seed-gobek-piercing" data-i="36" data-no="37" data-style="piercing" hidden>'));
});

test('defaults: 13 reviews, the facts 26 years and 13 / 13, and never ÇINAR or the old lacivert', () => {
  const html = page();
  assert.equal(count(html, '<li class="q">'), 13);
  assert.ok(html.includes('<b class="num" id="years">26</b><span>yıldır aynı mahallede</span>'));
  assert.ok(html.includes('<b class="num">13 / 13</b><span>Google yorumu, hepsi 5 yıldız</span>'));
  assert.ok(html.includes('<b>18 bin+</b><span>Instagram takipçisi</span>'));
  assert.ok(html.includes('<b>Steril</b><span>iğne göz önünde açılır</span>'));
  assert.ok(!html.includes('ÇINAR'));
  assert.ok(!html.toLowerCase().includes('#0c1220'));
  assert.ok(html.includes('<b>Çınar Tattoo</b><span>ESENLER · 2005</span>'));
  assert.ok(html.includes('<p class="foot-big">Çınar Tattoo</p>'));
});

test('defaults: the head carries the local SEO, the share tags, the icons and the two font preloads', () => {
  const html = page();
  assert.ok(html.includes('<title>Esenler Dövme ve Piercing | Çınar Tattoo · 2005’ten beri</title>'));
  assert.ok(html.includes('<meta name="description" content="Esenler’de 2005’ten beri kalıcı ve geçici dövme, titanyum piercing ve kalıcı makyaj: Onur Aydoğan’ın stüdyosu. Steril ortam, hijyen ve güler yüz. WhatsApp’tan randevu al.">'));
  assert.ok(html.includes('<link rel="canonical" href="https://cinar.test/">'));
  for (const tag of [
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Çınar Tattoo">',
    '<meta property="og:title" content="Esenler Dövme ve Piercing | Çınar Tattoo · 2005’ten beri">',
    '<meta property="og:url" content="https://cinar.test/">',
    '<meta property="og:image" content="https://cinar.test/assets/og.jpg">',
    '<meta property="og:locale" content="tr_TR">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="theme-color" content="#070604">',
    '<link rel="icon" href="/favicon.png" type="image/png" sizes="48x48">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="preload" href="/assets/fonts/instrument-serif-400-latin.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="preload" href="/assets/fonts/manrope-var-latin.woff2" as="font" type="font/woff2" crossorigin>',
    '<link rel="modulepreload" href="/assets/vendor/anime.esm.min.js">',
  ]) {
    assert.ok(html.includes(tag), tag);
  }
  assert.ok(html.includes('<meta property="og:description" content="Esenler’de 2005’ten beri'));
});

// ---------------------------------------------------------------------------------------------
// Escaping (Review Focus 2)
// ---------------------------------------------------------------------------------------------

test('escaping: a caption, the hero title, the page title and a review cannot break out', () => {
  const caption = page({}, { photos: [photo(1, 'dovme', '" onerror="alert(1)')] });
  assert.ok(caption.includes('alt="&quot; onerror=&quot;alert(1)"'));
  assert.ok(!caption.includes('" onerror="'));

  const title = page({ hero_title: '<script>alert(1)</script>' });
  assert.ok(title.includes('<h1 id="heroTitle" aria-label="&lt;script&gt;alert(1)&lt;/script&gt;">'));
  assert.ok(between(title, '<h1', '</h1>').includes('<span>&lt;script&gt;alert(1)&lt;/script&gt;</span>'));
  assert.ok(!title.includes('<script>alert'));

  const seo = page({ seo_title: '"><b>x' });
  assert.ok(seo.includes('<title>&quot;&gt;&lt;b&gt;x</title>'));
  assert.ok(seo.includes('<meta property="og:title" content="&quot;&gt;&lt;b&gt;x">'));
  assert.ok(!seo.includes('"><b>x'));

  const review = page({}, { reviews: [{ id: 1, name: 'A', rating: 5, text: 'Çok <b>iyi</b>\nteşekkürler', source: 'google', date_text: '' }] });
  assert.ok(review.includes('<blockquote>Çok &lt;b&gt;iyi&lt;/b&gt;<br>teşekkürler</blockquote>'));
});

test('settings, services and captions get typographic apostrophes; review texts stay as written', () => {
  const html = page(
    { hours_note: "Pazar'ları kapalı" },
    {
      photos: [photo(1, 'dovme', "Onur'un işi")],
      reviews: [{ id: 1, name: 'A', rating: 5, text: "Onur Bey'e teşekkürler", source: 'google', date_text: '' }],
    },
  );
  assert.ok(html.includes('Pazar’ları kapalı'));
  assert.ok(html.includes('alt="Onur’un işi"'));
  assert.ok(html.includes('Onur Bey&#39;e teşekkürler'));
});

// ---------------------------------------------------------------------------------------------
// CSP
// ---------------------------------------------------------------------------------------------

test('CSP: no style attribute, no inline script but the JSON-LD, no <style>', () => {
  for (const html of [page(), page({ whatsapp: '', instagram_url: '', address: '' }, { photos: [], reviews: [] })]) {
    assert.doesNotMatch(html, /\sstyle=/);
    assert.ok(!html.includes('<style'));
    for (const tag of html.match(/<script[^>]*>/g)) {
      assert.ok(tag.includes('src="/assets/') || tag.includes('type="application/ld+json"'), tag);
    }
    assert.equal(count(html, 'type="application/ld+json"'), 1);
  }
});

// ---------------------------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------------------------

test('JSON-LD: a TattooParlor with the name, the address in Esenler, the area, the offers and no opening hours', () => {
  const data = jsonLd(page());
  const settings = defaultContent().settings;
  assert.equal(data['@context'], 'https://schema.org');
  assert.equal(data['@type'], 'TattooParlor');
  assert.equal(data.name, BRAND_NAME);
  assert.equal(data.alternateName, 'Çınar Ink Tattoo Piercing Studio');
  assert.equal(data.url, 'https://cinar.test/');
  assert.equal(data.image, 'https://cinar.test/assets/og.jpg');
  assert.equal(data.description, settings.seo_description);
  assert.equal(data.foundingDate, '2005');
  assert.deepEqual(data.founder, { '@type': 'Person', name: 'Onur Aydoğan' });
  assert.equal(data.telephone, '+905372631546');
  assert.deepEqual(data.address, {
    '@type': 'PostalAddress',
    streetAddress: settings.address,
    addressLocality: 'Esenler',
    addressRegion: 'İstanbul',
    addressCountry: 'TR',
  });
  assert.deepEqual(data.areaServed, ['Esenler', 'Bağcılar', 'Güngören', 'Bayrampaşa', 'Gaziosmanpaşa', 'İstanbul']);
  assert.equal(data.hasMap, mapsDirectionsHref('', settings.address));
  assert.deepEqual(data.sameAs, ['https://www.instagram.com/cinartattooesenler']);
  assert.deepEqual(data.makesOffer, defaultContent().services.map(({ name }) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name } })));
  assert.ok(!('openingHours' in data));
  assert.ok(!('openingHoursSpecification' in data));
});

test('JSON-LD: no telephone for a phone that is not one; TikTok joins sameAs and the footer with the e-mail', () => {
  assert.ok(!('telephone' in jsonLd(page({ phone: 'abc' }))));
  const html = page({ tiktok_url: 'https://www.tiktok.com/@cinar', email: 'a@b.co' });
  assert.deepEqual(jsonLd(html).sameAs, ['https://www.instagram.com/cinartattooesenler', 'https://www.tiktok.com/@cinar']);
  const footer = between(html, '<footer', '</footer>');
  assert.ok(footer.includes('>TikTok</a>'));
  assert.ok(footer.includes('href="mailto:a@b.co"'));
  const plain = between(page(), '<footer', '</footer>');
  assert.ok(!plain.includes('TikTok'));
  assert.ok(!plain.includes('mailto:'));
});

test('a hero the owner uploaded is the share image, in og:image and in the JSON-LD', () => {
  const hero = { source: 'kv', image_key: 'f'.repeat(20), width: 1600, height: 1200 };
  const html = page({}, { hero });
  const image = `https://cinar.test/img/${'f'.repeat(20)}/full`;
  assert.ok(html.includes(`<meta property="og:image" content="${image}">`));
  assert.equal(jsonLd(html).image, image);
  assert.ok(html.includes(`srcset="/img/${'f'.repeat(20)}/thumb 640w, /img/${'f'.repeat(20)}/full 1600w"`));
  assert.ok(html.includes('alt="Çınar Tattoo"'));
  assert.ok(html.includes('width="1600" height="1200"'));
});

// ---------------------------------------------------------------------------------------------
// Links that are not there
// ---------------------------------------------------------------------------------------------

test('without WhatsApp: no wa.me, no data-wa, no form or banner button, and Süreç says Telefonla', () => {
  const html = page({ whatsapp: '' });
  assert.ok(!html.includes('wa.me'));
  assert.ok(!html.includes('data-wa'));
  assert.ok(!html.includes('id="bookForm"'));
  assert.ok(!html.includes('Fikrini gönder'));
  assert.ok(between(html, 'id="surec"', '</section>').includes('Telefonla'));
  assert.ok(!html.slice(html.indexOf('<body')).includes('WhatsApp’tan'), 'the page body does not mention WhatsApp');
  assert.ok(between(html, '<section class="banner"', '</section>').includes('>Ara</a>'));
  assert.ok(!between(html, '<header', '</header>').includes('class="btn"'), 'the bar has no WhatsApp button');
});

test('with no phone either, the banner has no button and the dock is gone', () => {
  const html = page({ whatsapp: '', phone: 'abc', address: '', maps_url: '' });
  assert.ok(!between(html, '<section class="banner"', '</section>').includes('class="btn'));
  assert.ok(!html.includes('class="dock"'));
});

test('a phone that is not a number gives no tel: link; an empty Instagram gives no Instagram link', () => {
  const noTel = page({ phone: 'abc' });
  assert.ok(!noTel.includes('tel:'));
  assert.ok(noTel.includes('<dd>abc</dd>'), 'the number is still shown as typed');
  const noInsta = page({ instagram_url: '' });
  assert.ok(!noInsta.includes('instagram.com'));
  assert.ok(!noInsta.includes('data-track="instagram"'));
});

test('without an address there is no map; with one the map button carries the embed address', () => {
  assert.ok(!page({ address: '' }).includes('class="map"'));
  const html = page();
  const settings = defaultContent().settings;
  const escaped = mapsEmbedSrc(settings.address).replaceAll('&', '&amp;');
  assert.ok(html.includes(`<div class="map"><button type="button" data-src="${escaped}">`));
});

// ---------------------------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------------------------

test('every booking link says what it is: wa.me whatsapp, tel: call, directions, Instagram', () => {
  const html = page({ tiktok_url: 'https://www.tiktok.com/@cinar' });
  const settings = defaultContent().settings;
  const directions = mapsDirectionsHref(settings.maps_url, settings.address).replaceAll('&', '&amp;');
  const tags = anchors(html);
  const kinds = { whatsapp: 0, call: 0, directions: 0, instagram: 0 };
  for (const tag of tags) {
    const href = attr(tag, 'href') ?? '';
    const track = attr(tag, 'data-track');
    if (href.startsWith('https://wa.me/')) assert.equal(track, 'whatsapp', tag);
    if (href.startsWith('tel:')) assert.equal(track, 'call', tag);
    if (href === directions) assert.equal(track, 'directions', tag);
    if (href.startsWith(settings.instagram_url)) assert.equal(track, 'instagram', tag);
    if (track !== undefined) {
      assert.ok(CLICK_KINDS.includes(track), tag);
      kinds[track] = (kinds[track] ?? 0) + 1;
    }
  }
  for (const [kind, n] of Object.entries(kinds)) assert.ok(n > 0, `${kind} links exist`);
  for (const tag of html.match(/<[a-z]+\s[^>]*data-track="[^"]*"[^>]*>/g)) assert.ok(CLICK_KINDS.includes(attr(tag, 'data-track')), tag);
  assert.ok(html.includes('<button class="btn" type="submit" data-track="form">'));
});

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

test('sections: the defaults render all but the price list, numbered 01 … in order, and the menus follow', () => {
  const html = page();
  assert.deepEqual(sectionIds(html), ['sanatci', 'calismalar', 'reels', 'surec', 'yorumlar', 'bakim', 'randevu', 'sss']);
  assert.deepEqual(secNos(html), ['01', '02', '03', '04', '05', '06', '07', '08']);
  const menu = between(html, '<nav class="menu"', '</nav>');
  assert.deepEqual([...menu.matchAll(/href="#([a-z]+)"><i>(\d+)<\/i>/g)].map((m) => `${m[1]} ${m[2]}`), ['sanatci 01', 'calismalar 02', 'reels 03', 'surec 04', 'yorumlar 05', 'randevu 07', 'sss 08']);
  assert.ok(menu.includes('<a href="#sanatci"><i>01</i>Sanatçı</a>'));
  assert.ok(between(html, '<div class="sheet"', '<div class="sheet-foot">').includes('<a href="#sanatci"><i>01</i>Sanatçı</a>'));
  assert.ok(!html.includes('id="usta"') && !html.includes('usta-'), 'the old Usta section is gone');
  const sheet = between(html, '<div class="sheet"', '<div class="sheet-foot">');
  assert.deepEqual([...sheet.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1]), sectionIds(html));
});

test('without reviews: no review section, no link to it, no review fact; the numbers close up', () => {
  const html = page({}, { reviews: [] });
  assert.ok(!html.includes('id="yorumlar"'));
  assert.ok(!html.includes('href="#yorumlar"'));
  assert.ok(!html.includes('/ 13'));
  assert.ok(!html.includes('Google yorumu'));
  assert.deepEqual(secNos(html), ['01', '02', '03', '04', '05', '06', '07']);
  const none = page({ about_title: '', about_text: '', highlights: '[]' }, { reviews: [] });
  assert.deepEqual(sectionIds(none), ['calismalar', 'reels', 'surec', 'bakim', 'randevu', 'sss']);
  assert.deepEqual(secNos(none), ['01', '02', '03', '04', '05', '06']);
});

test('reviews: every one is in the HTML with its stars, source and date; a 4-star one changes the fact', () => {
  const reviews = [
    { id: 1, name: 'A', rating: 5, text: 'Harika.', source: 'google', date_text: '' },
    { id: 2, name: 'B', rating: 4, text: 'İyi.', source: 'instagram', date_text: 'Ekim 2026' },
  ];
  const html = page({}, { reviews });
  assert.equal(count(html, '<li class="q">'), 2);
  assert.ok(html.includes('<span class="stars" role="img" aria-label="5 üzerinden 4 yıldız">★★★★</span>'));
  assert.ok(html.includes('Instagram'));
  assert.ok(html.includes('Ekim 2026'));
  assert.ok(html.includes('<b class="num">1 / 2</b><span>yorum 5 yıldız</span>'));
  assert.ok(html.includes('Google’da gör ↗'));
  assert.ok(!page({ google_reviews_url: '' }).includes('Google’da gör'));
});

test('prices: none by default; a group with an empty price asks on WhatsApp, a set price is shown', () => {
  const plain = page();
  assert.ok(!plain.includes('id="fiyatlar"'));
  assert.ok(!plain.includes('href="#fiyatlar"'));
  assert.ok(!page({}, { prices: [{ id: 1, title: 'Boş', items: [] }] }).includes('id="fiyatlar"'));

  const prices = [{ id: 1, title: 'Dövme', items: [{ id: 1, name: 'Helix', detail: '', price: '' }, { id: 2, name: 'Minimal yazı', detail: 'tek satır', price: "1.500₺'den" }] }];
  const html = page({}, { prices });
  assert.ok(html.includes('id="fiyatlar"'));
  assert.ok(html.includes('href="#fiyatlar"'));
  assert.ok(html.includes('Fiyat listesi.'));
  const section = between(html, 'id="fiyatlar"', '</section>');
  assert.ok(section.includes('<h3>Dövme</h3>'));
  assert.ok(section.includes('Fiyat için yaz'));
  assert.ok(section.includes('D%C3%B6vme%2C%20Helix%20i%C3%A7in%20fiyat%20%C3%B6%C4%9Frenebilir%20miyim%3F'));
  assert.ok(section.includes('1.500₺&#39;den'));
  assert.ok(section.includes('<small>tek satır</small>'));
  assert.ok(section.includes('Fiyatlar boyuta ve detaya göre değişebilir; net fiyat için yaz.'));
  assert.deepEqual(sectionIds(html), ['sanatci', 'calismalar', 'reels', 'surec', 'yorumlar', 'fiyatlar', 'bakim', 'randevu', 'sss']);
  assert.deepEqual(secNos(html), ['01', '02', '03', '04', '05', '06', '07', '08', '09']);
});

test('sanatçı: the first section (01), the photo, the about title and text, and the highlights split into title and detail', () => {
  const html = page();
  const section = between(html, '<section class="sec" id="sanatci"', '</section>');
  assert.ok(section.includes('aria-labelledby="h-sanatci"'));
  assert.ok(section.includes('<p class="sec-no num artist-no" aria-hidden="true">01</p>'));
  assert.ok(section.includes('<p class="lbl">Sanatçımız</p>'));
  assert.ok(section.includes('<h2 id="h-sanatci">Onur Aydoğan</h2>'));
  assert.ok(section.includes('<div class="artist-lede"><p>+20 yıllık tecrübe, güler yüz, hijyen ve müşteri memnuniyeti sunar.</p></div>'));
  assert.ok(
    section.includes(
      '<figure class="artist-ph">\n        <div class="artist-frame wipe"><img src="/media/sanatci.jpg" alt="Çınar Tattoo’nun sanatçısı Onur Aydoğan, Esenler’deki stüdyosunda" width="540" height="1170" loading="lazy" decoding="async"></div>',
    ),
  );
  assert.ok(section.includes('<figcaption class="lbl"><span>Onur Aydoğan</span><span>Çınar Tattoo · Esenler</span></figcaption>'));
  const list = between(section, '<ol class="artist-list">', '</ol>');
  assert.equal(count(list, '<li>'), 4);
  assert.ok(list.includes('<li><i class="num">01</i><b>+20 yıllık tecrübe</b><span>2005’ten beri Esenler’de, aynı mahallede.</span></li>'));
  assert.ok(list.includes('<li><i class="num">02</i><b>Güler yüz</b><span>Her soruna sabırla cevap; acele yok.</span></li>'));
  assert.ok(list.includes('<li><i class="num">03</i><b>Hijyen</b><span>Tek kullanımlık iğne, paketi göz önünde açılır.</span></li>'));
  assert.ok(list.includes('<li><i class="num">04</i><b>Müşteri memnuniyeti</b><span>Google yorumlarının hepsi 5 yıldız.</span></li>'));
  const ask = anchors(section).find((tag) => tag.includes('wa.me'));
  assert.equal(attr(ask, 'data-track'), 'whatsapp');
  assert.ok(section.includes('Onur Bey’e yaz <span class="ar">→</span></a>'));
  assert.ok(html.indexOf('id="sanatci"') < html.indexOf('id="calismalar"'), 'before the works');
  assert.ok(existsSync(join(PUBLIC, 'media/sanatci.jpg')));
});

test('sanatçı: a highlight without a dash is a title only; edited texts are escaped; no WhatsApp, no button', () => {
  const html = page({ highlights: JSON.stringify(["Onur'un <b>işi", 'Hijyen — Tek — iki']), about_title: 'Usta <x>', about_text: 'Bir.\n\nİki.' });
  const section = between(html, '<section class="sec" id="sanatci"', '</section>');
  assert.ok(section.includes('<li><i class="num">01</i><b>Onur’un &lt;b&gt;işi</b></li>'));
  assert.ok(section.includes('<li><i class="num">02</i><b>Hijyen</b><span>Tek — iki</span></li>'), 'split at the first dash only');
  assert.ok(section.includes('<h2 id="h-sanatci">Usta &lt;x&gt;</h2>'));
  assert.ok(section.includes('<div class="artist-lede"><p>Bir.</p><p>İki.</p></div>'));
  assert.ok(!between(page({ whatsapp: '' }), 'id="sanatci"', '</section>').includes('Onur Bey’e yaz'));
});

test('sanatçı: shown while any of the title, the text and the highlights is set; gone with all three empty', () => {
  const gone = page({ about_title: '', about_text: '', highlights: '[]' });
  assert.ok(!gone.includes('id="sanatci"'));
  assert.ok(!gone.includes('href="#sanatci"'));
  assert.ok(!gone.includes('class="services"'));
  const onlyList = between(page({ about_title: '', about_text: '' }), 'id="sanatci"', '</section>');
  assert.ok(onlyList.includes('<h2 id="h-sanatci">Onur Aydoğan</h2>'), 'the name stands in for an empty title');
  assert.ok(!onlyList.includes('artist-lede'));
  assert.ok(between(page({ about_text: '', highlights: '[]' }), 'id="sanatci"', '</section>').includes('<h2 id="h-sanatci">Onur Aydoğan</h2>'));
  const noList = between(page({ highlights: '[]' }), 'id="sanatci"', '</section>');
  assert.ok(!noList.includes('artist-list'));
  assert.ok(noList.includes('artist-lede'));
});

test('hizmetler: one item per service under the artist, the empty description left out; no block without services', () => {
  const section = between(page(), '<section class="sec" id="sanatci"', '</section>');
  const block = between(section, '<div class="services" data-rise>', '</ul>');
  assert.ok(block.includes('<p class="lbl">Hizmetler</p>'));
  assert.equal(count(block, '<li>'), 4);
  assert.ok(block.includes('<li><i class="num">01</i><h3>Kalıcı dövme</h3><p>Yazıdan tam kola, sana göre çizilen dövmeler.</p></li>'));
  assert.ok(block.includes('<li><i class="num">02</i><h3>Geçici dövme</h3><p>Kalıcıya karar vermeden önce denemek isteyenlere.</p></li>'));
  assert.ok(block.includes('<li><i class="num">03</i><h3>Titanyum piercing</h3><p>Kulak, burun, göbek; titanyum takıyla.</p></li>'));
  assert.ok(block.includes('<li><i class="num">04</i><h3>Kalıcı makyaj</h3><p>Kalıcı makyaj uygulamaları; ayrıntı için yaz.</p></li>'));
  const one = page({}, { services: [{ id: 9, name: "Onur'un <i>", description: '' }] });
  assert.ok(one.includes('<li><i class="num">01</i><h3>Onur’un &lt;i&gt;</h3></li>'));
  const none = page({}, { services: [] });
  assert.ok(none.includes('id="sanatci"'));
  assert.ok(!none.includes('class="services"'));
  assert.ok(!none.includes('svc-list'));
});

test('hero: the logo is sized for the larger desktop sign, and stays whole under an announcement', () => {
  const img = between(page(), '<img id="heroLogo"', '>');
  assert.equal(attr(img, 'sizes'), '(max-width: 900px) 100vw, min(100vw, 120svh)');
  const css = readFileSync(join(PUBLIC, 'assets/site.css'), 'utf8');
  assert.ok(css.includes('.hero-sign{position:relative;height:100svh;overflow:hidden;padding-top:4rem}'));
  assert.ok(css.includes('.hero-sign img{display:block;margin:0 auto;width:min(100%,calc((100svh - 4rem) * 1.2));height:auto}'));
  assert.match(css, /\.hero-sign::after\{content:"";position:absolute;left:0;right:0;bottom:0;height:4svh;background:linear-gradient\(transparent,var\(--logo-ground\)\)/);
  assert.ok(css.includes('.has-duyuru .hero-sign{padding-top:7rem}'));
  assert.ok(css.includes('.has-duyuru .hero-sign img{width:min(100%,calc((100svh - 7rem) * 1.2))}'));
  assert.ok(css.includes('.hero-sign::after{display:none}'), 'no fade on phones');
});

test('announcement: shown only when it is on and has a text', () => {
  assert.ok(!page().includes('class="duyuru"'));
  assert.ok(page().includes('<body id="top">'));
  assert.ok(page({ announcement_on: '1', announcement_text: 'Bayramda kapalıyız' }).includes('<body id="top" class="has-duyuru">'), 'the logo moves down under it');
  assert.ok(!page({ announcement_on: '1', announcement_text: '' }).includes('class="duyuru"'));
  assert.ok(!page({ announcement_on: '0', announcement_text: 'Bayramda kapalıyız' }).includes('class="duyuru"'));
  const html = page({ announcement_on: '1', announcement_text: 'Bayramda kapalıyız' });
  assert.ok(between(html, '<header', '</header>').includes('<div class="duyuru" role="note"><p>Bayramda kapalıyız</p><button type="button" class="duyuru-kapat" aria-label="Duyuruyu kapat">✕</button></div>'));
});

test('visit details: hours with the note, the payment row only when set, and the Instagram handle', () => {
  const html = page();
  const info = between(html, '<div class="book-info">', '</dl>');
  assert.ok(info.includes('<dd>10.00–23.00<small>Duruma göre esneyebilir.</small></dd>'));
  assert.ok(info.includes('>@cinartattooesenler</a>'));
  assert.ok(!info.includes('Ödeme'));
  assert.ok(between(page({ payment_text: 'Nakit ve kredi kartı' }), '<div class="book-info">', '</dl>').includes('<dt>Ödeme</dt><dd>Nakit ve kredi kartı</dd>'));
});

test('the booking form offers the services as chips, the first one checked, and a link for visitors without JS', () => {
  const html = page();
  const form = between(html, '<form class="form" id="bookForm"', '</form>');
  assert.doesNotMatch(form, /\s(method|action)=/);
  assert.ok(form.includes('<input type="radio" name="kind" value="Kalıcı dövme" checked><span>Kalıcı dövme</span>'));
  assert.ok(form.includes('<input type="radio" name="kind" value="Titanyum piercing"><span>Titanyum piercing</span>'));
  assert.ok(form.includes('<input type="radio" name="kind" value="Kalıcı makyaj"><span>Kalıcı makyaj</span>'));
  assert.ok(form.includes('value="Tam kol / sırt"'));
  assert.ok(form.includes(`<a class="btn" href="${WA_GENERIC}" target="_blank" rel="noopener" data-track="whatsapp">WhatsApp’tan yaz`));
});

test('SSS: five questions; piercing is with titanium, and permanent make-up and temporary tattoos are answered', () => {
  const faq = between(page(), '<section class="sec" id="sss"', '</section>');
  assert.equal(count(faq, '<details>'), 5);
  assert.ok(faq.includes('Piercing de yapıyor musunuz?</summary><p class="ans">Evet, titanyum takıyla. '));
  assert.ok(faq.includes('<i class="num">05</i>Kalıcı makyaj ve geçici dövme var mı?</summary><p class="ans">Evet, ikisi de var. Ne istediğini WhatsApp’tan yaz, ayrıntıları ve randevuyu birlikte konuşalım.</p>'));
  const bare = between(page({ whatsapp: '' }), '<section class="sec" id="sss"', '</section>');
  assert.ok(!bare.includes('WhatsApp'));
  assert.ok(bare.includes('Evet, ikisi de var. Ne istediğini bize yaz, ayrıntıları ve randevuyu birlikte konuşalım.'));
});

test('the reels: four clips from /media with their posters', () => {
  const html = page();
  for (const n of [1, 2, 3, 4]) assert.ok(html.includes(`src="/media/r${n}.mp4" poster="/media/r${n}.jpg"`), `r${n}`);
});

// ---------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------

test('tabs: none with one category; the defaults count every category that has photos', () => {
  const one = page({}, { photos: [photo(1), photo(2)] });
  assert.ok(!one.includes('class="tabs"'));
  const html = page();
  assert.ok(html.includes('Tümü <sup>37</sup>'));
  assert.ok(html.includes('Dövme <sup>36</sup>'));
  assert.ok(html.includes('Piercing <sup>1</sup>'));
  assert.ok(!html.includes('data-f="diger"'));
});

test('49 photos: 48 cards and a link to the rest on Instagram; 24 photos: no hidden card and no button', () => {
  const many = page({}, { photos: Array.from({ length: 49 }, (_, i) => photo(i + 1)) });
  assert.equal(count(many, '<figure class="work"'), 48);
  assert.ok(many.includes('Tüm işler Instagram’da'));
  const few = page({}, { photos: Array.from({ length: 24 }, (_, i) => photo(i + 1)) });
  assert.equal(count(few, '<figure class="work"'), 24);
  assert.ok(!few.match(/<figure class="work"[^>]*>/g).some((card) => card.includes('hidden')));
  assert.ok(!few.includes('Daha fazla göster'));
  assert.ok(!few.includes('Tüm işler Instagram’da'));
});

test('a photo without a caption is “Çınar Tattoo çalışması”', () => {
  const html = page({}, { photos: [photo(1, 'dovme', '')] });
  assert.ok(html.includes('alt="Çınar Tattoo çalışması"'));
  assert.ok(html.includes('aria-label="Çınar Tattoo çalışması, büyüt"'));
});

test('no photos: “Yeni işler yakında burada.”, no strip, no wall, and the hero fills the process pictures', () => {
  const html = page({}, { photos: [] });
  assert.ok(html.includes('Yeni işler yakında burada.'));
  assert.ok(!html.includes('class="strip"'));
  assert.ok(!html.includes('class="wall"'));
  assert.ok(!html.includes('class="works"'));
  assert.ok(between(html, 'id="calismalar"', '</section>').includes('href="https://www.instagram.com/cinartattooesenler"'));
  assert.equal(count(between(html, 'id="surec"', '</section>'), 'src="/seed/logo-full.jpg"'), 8);
});

test('the strip and the wall show the first 16 thumbs; the process uses photos 1–4 at full size', () => {
  const html = page();
  const strip = between(html, '<div class="strip"', '</section>');
  assert.equal(count(strip, '<figure>'), 16);
  assert.ok(strip.includes('<span class="num">16</span>'));
  const wall = between(html, '<div class="wall"', '</div>');
  assert.equal(count(wall, '<img'), 16);
  const proc = between(html, 'id="surec"', '</section>');
  for (const id of ['w03', 'k01', 'w01', 'w04']) assert.equal(count(proc, `src="/seed/${id}-full.jpg"`), 2, id);
});

// ---------------------------------------------------------------------------------------------
// The H1
// ---------------------------------------------------------------------------------------------

test('H1: three lines with the last in italics; one line has no italics; a fourth line joins the third', () => {
  const three = between(page({ hero_title: 'A\nB\nC' }), '<h1', '</h1>');
  assert.equal(count(three, 'class="ln"'), 3);
  assert.ok(three.includes('<em>C</em>'));
  assert.ok(three.includes('aria-label="A B C"'));
  const one = between(page({ hero_title: 'Tek satır' }), '<h1', '</h1>');
  assert.equal(count(one, 'class="ln"'), 1);
  assert.ok(!one.includes('<em>'));
  const four = between(page({ hero_title: 'A\nB\nC\nD' }), '<h1', '</h1>');
  assert.equal(count(four, 'class="ln"'), 3);
  assert.ok(four.includes('<em>C D</em>'));
});

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

test('GET / without a database still answers 200 with the default page and the site CSP', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { env, cleanup } = makeEnv();
  t.after(cleanup);
  const response = await call(onRequestGet, { env: { ...env, DB: undefined } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Security-Policy'), SITE_CSP);
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.ok((await response.text()).includes('aria-label="Bir ömür taşıyacağın dövme."'));
  assert.equal(logged.mock.callCount(), 1, 'the failure is logged');
});

test('GET / shows what the owner saved, and HEAD answers 200', async (t) => {
  const { env, cleanup } = makeEnv();
  t.after(cleanup);
  await ensureSchema(env.DB);
  await updateSettings(env.DB, { hero_title: 'Yeni başlık' });
  const response = await call(onRequestGet, { env });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('aria-label="Yeni başlık"'));
  assert.match(html, /\/assets\/site\.css\?v=[0-9a-f]{10}"/);
  assert.match(html, /© \d{4} Çınar Tattoo/);
  const head = await call(onRequestHead, { method: 'HEAD', env });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), 'text/html; charset=utf-8');
});

test('the sitemap lists the home page', async () => {
  const response = await call(sitemap, { url: 'https://cinar.test/sitemap.xml' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/xml; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=3600');
  const xml = await response.text();
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://cinar.test/</loc></url></urlset>'));
});

// ---------------------------------------------------------------------------------------------
// assetVersion
// ---------------------------------------------------------------------------------------------

test('assetVersion: 10 hex characters over the real files, 1 without ASSETS', async (t) => {
  const { env, cleanup } = makeEnv();
  t.after(cleanup);
  assert.match(await assetVersion(env, ORIGIN), /^[0-9a-f]{10}$/);
  assert.equal(await assetVersion({}, ORIGIN), '1');
});

test('assetVersion changes when site.css changes, and is 1 when a file is missing', async (t) => {
  const versionOf = async (files) => {
    const tree = await tempTree(files);
    t.after(tree.cleanup);
    return assetVersion({ ASSETS: createAssets(join(tree.dir, 'public')), DEV_INSECURE_COOKIES: '1' }, ORIGIN);
  };
  const a = await versionOf({ 'public/assets/site.css': 'a{}', 'public/assets/site.js': 'x' });
  const b = await versionOf({ 'public/assets/site.css': 'b{}', 'public/assets/site.js': 'x' });
  assert.match(a, /^[0-9a-f]{10}$/);
  assert.notEqual(a, b);
  assert.equal(await versionOf({ 'public/assets/site.css': 'a{}' }), '1');
});

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

// The size in a JPEG's SOF0 or SOF2 marker.
function jpegSize(bytes) {
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc2) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return null;
}

test('every seed photo and the logo have a full and a thumb file, and the full one has the recorded size', () => {
  for (const item of [...SEED_PHOTOS, DEFAULT_HERO]) {
    const { full, thumb } = imageUrls({ source: 'seed', ...item });
    assert.ok(existsSync(join(PUBLIC, thumb)), thumb);
    assert.deepEqual(jpegSize(readFileSync(join(PUBLIC, full))), { width: item.width, height: item.height }, full);
  }
  assert.ok(statSync(join(PUBLIC, 'seed/logo-full.jpg')).size <= 337920, 'the logo is at most 330 KiB');
});

test('the vendored anime.js is v4.5.0', () => {
  assert.match(readFileSync(join(PUBLIC, 'assets/vendor/anime.esm.min.js'), 'utf8'), /^\/\*\*\r?\n \* Anime\.js - ESM minified bundle\r?\n \* @version v4\.5\.0/);
});

const FONTS = [
  'instrument-serif-400-latin.woff2',
  'instrument-serif-400-latin-ext.woff2',
  'instrument-serif-400-italic-latin.woff2',
  'instrument-serif-400-italic-latin-ext.woff2',
  'manrope-var-latin.woff2',
  'manrope-var-latin-ext.woff2',
];

test('every font the stylesheets name exists, and all six are there', () => {
  for (const font of FONTS) assert.ok(existsSync(join(PUBLIC, 'assets/fonts', font)), font);
  for (const css of ['assets/site.css', 'admin/admin.css', '404.css']) {
    const text = readFileSync(join(PUBLIC, css), 'utf8');
    const urls = [...text.matchAll(/\/assets\/fonts\/([^)"']+)/g)].map((match) => match[1]);
    assert.ok(urls.length > 0, css);
    for (const name of urls) assert.ok(FONTS.includes(name), `${css}: ${name}`);
    assert.doesNotMatch(text, /bodoni|figtree/i, css);
  }
});

test('site.css uses the palette tokens: no prototype paths and no hex colour but the logo black', () => {
  const css = readFileSync(join(PUBLIC, 'assets/site.css'), 'utf8');
  assert.ok(!css.includes('/files/'));
  const hexes = new Set(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []);
  assert.deepEqual([...hexes], ['#070604']);
});

test('site.js: no prototype paths, no innerHTML, no phone number, no style attribute, no console; it beacons clicks', () => {
  const js = readFileSync(join(PUBLIC, 'assets/site.js'), 'utf8');
  for (const banned of ['/files/', 'innerHTML', '905372631546', "setAttribute('style'", 'console.']) assert.ok(!js.includes(banned), banned);
  assert.ok(js.includes("navigator.sendBeacon('/api/track'"));
  assert.ok(js.includes(`'${GREETING}'`), 'the same greeting as the server');
});

// ---------------------------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------------------------

const brotli = (bytes) => brotliCompressSync(bytes, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } }).length;
const file = (path) => readFileSync(join(PUBLIC, path));

test('budget: site.js is at most 30 KiB with brotli', (t) => {
  const size = brotli(file('assets/site.js'));
  t.diagnostic(`site.js: ${size} bytes brotli`);
  assert.ok(size <= 30720, `${size}`);
});

test('budget: the first load is at most 350 KiB (without the hero image, the gallery and the videos)', (t) => {
  const parts = {
    html: brotli(Buffer.from(page())),
    'site.css': brotli(file('assets/site.css')),
    'site.js': brotli(file('assets/site.js')),
    anime: brotli(file('assets/vendor/anime.esm.min.js')),
    fonts: ['instrument-serif-400-latin.woff2', 'manrope-var-latin.woff2', 'instrument-serif-400-italic-latin.woff2'].reduce((sum, name) => sum + file(`assets/fonts/${name}`).length, 0),
    'favicon.png': file('favicon.png').length,
  };
  const total = Object.values(parts).reduce((sum, size) => sum + size, 0);
  t.diagnostic(`first load: ${total} bytes (${Object.entries(parts).map(([name, size]) => `${name} ${size}`).join(', ')})`);
  assert.ok(total <= 358400, `${total}`);
  t.diagnostic(`hero image: ${file('seed/logo-full.jpg').length} bytes`);
});
