import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRAND_NAME, DEFAULT_HERO, DEFAULT_SERVICES, DEFAULT_SETTINGS, SEED_PHOTOS, SEED_REVIEWS } from '../functions/_lib/defaults.js';
import { CATEGORIES, SETTINGS_FIELDS, validateCaption, validateReviews, validateServices, validateSettingsPatch } from '../functions/_lib/fields.js';
import { telHref, waHref } from '../functions/_lib/links.js';

test('BRAND_NAME', () => {
  assert.equal(BRAND_NAME, 'Çınar Tattoo');
});

test('DEFAULT_SETTINGS holds the texts the site opens with', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    seo_title: 'Esenler Dövme ve Piercing | Çınar Tattoo · 2005’ten beri',
    seo_description: 'Esenler’de 2005’ten beri kalıcı ve geçici dövme, titanyum ve çelik piercing, ağrısız kulak delme: Onur Aydoğan’ın stüdyosu. Steril ortam, güler yüz. Randevu al.',
    hero_title: 'Bir ömür taşıyacağın\ndövme.',
    hero_text: 'Esenler’de Onur Aydoğan’ın dövme ve piercing stüdyosu. Kişiye özel çizim, steril ortam; temiz çizgi, net gölge, kalıcı iş.',
    about_title: 'Onur Aydoğan',
    about_text: '+20 yıllık tecrübe, güler yüz, hijyen ve müşteri memnuniyeti sunar.',
    hours: '10.00–23.00',
    hours_note: 'Duruma göre esneyebilir.',
    address: 'Nine Hatun Mah. İnönü Cd. No:11, Akman Ticaret Merkezi, 34220 Esenler / İstanbul',
    phone: '0537 263 15 46',
    whatsapp: '0537 263 15 46',
    instagram_url: 'https://www.instagram.com/cinartattooesenler',
    maps_url: '',
    announcement_text: '',
    announcement_on: '0',
    highlights: '["+20 yıllık tecrübe — 2005’ten beri Esenler’de, aynı mahallede.","Güler yüz — Her soruna sabırla cevap; acele yok.","Hijyen — Tek kullanımlık iğne, paketi göz önünde açılır.","Müşteri memnuniyeti — Google yorumlarının hepsi 5 yıldız."]',
    hero_points: '["Kişiye özel dövme tasarımı","Profesyonel piercing uygulamaları","Kaliteli dövme malzemeleri"]',
    payment_text: '',
    instagram_followers: '18 bin+',
    google_reviews_url: 'https://www.google.com/maps/search/?api=1&query=%C3%87%C4%B1nar%20Tattoo%20esenler%20d%C3%B6vme%20piercing%20studiosu',
    tiktok_url: '',
    email: '',
  });
});

test('the page title leads with “Esenler Dövme” for local search and has a plain pipe (Task 6 brief, superseding P8)', () => {
  assert.equal(DEFAULT_SETTINGS.seo_title, 'Esenler Dövme ve Piercing | Çınar Tattoo · 2005’ten beri');
  assert.ok(!DEFAULT_SETTINGS.seo_title.includes('\\'));
});

test('the hero title is two lines: its \\n is the line break the page draws', () => {
  assert.deepEqual(DEFAULT_SETTINGS.hero_title.split('\n'), ['Bir ömür taşıyacağın', 'dövme.']);
});

test('the Google description fits its field and makes no review claim (the reviews can change)', () => {
  assert.ok(DEFAULT_SETTINGS.seo_description.length <= 170, `${DEFAULT_SETTINGS.seo_description.length}`);
  assert.ok(!DEFAULT_SETTINGS.seo_description.includes('yıldız'));
});

test('the default highlights are “title — detail”, as the Sanatçımız list splits them', () => {
  for (const item of JSON.parse(DEFAULT_SETTINGS.highlights)) assert.match(item, /^[^—]+ — .+$/, item);
});

test('every default setting is a string, and the lists are stored as JSON strings', () => {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) assert.equal(typeof value, 'string', key);
  assert.equal(JSON.parse(DEFAULT_SETTINGS.highlights).length, 4);
  assert.equal(JSON.parse(DEFAULT_SETTINGS.hero_points).length, 3);
});

test('the default phone numbers make working links', () => {
  assert.equal(telHref(DEFAULT_SETTINGS.phone), 'tel:+905372631546');
  assert.equal(telHref(DEFAULT_SETTINGS.whatsapp), 'tel:+905372631546');
  assert.equal(waHref(DEFAULT_SETTINGS.whatsapp, ''), 'https://wa.me/905372631546');
});

test('every default passes the rule of its own field', () => {
  const patch = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, SETTINGS_FIELDS.find((field) => field.key === key).kind === 'list' ? JSON.parse(value) : value]),
  );
  const result = validateSettingsPatch(patch);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.values, DEFAULT_SETTINGS); // nothing about a default changes when it is saved as it is
});

test('DEFAULT_SERVICES: ids 1 to 4, in order', () => {
  assert.deepEqual(DEFAULT_SERVICES, [
    { id: 1, name: 'Kalıcı dövme', description: 'Yazıdan tam kola, sana göre çizilen dövmeler.' },
    { id: 2, name: 'Geçici dövme', description: 'Yapıştırma (çıkartma) dövme; kalıcıya karar vermeden önce dene.' },
    { id: 3, name: 'Titanyum & çelik piercing', description: 'Kulak, burun, göbek; titanyum ya da çelik takıyla.' },
    { id: 4, name: 'Ağrısız kulak delme', description: 'Ağrısız, acısız kulak delme; steril ortamda.' },
  ]);
  const result = validateServices(DEFAULT_SERVICES.map(({ name, description }) => ({ name, description })));
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.services, DEFAULT_SERVICES.map(({ name, description }) => ({ name, description })));
});

// The owner's picks (2026-11-03), one folder per category, mixed: [seed_path, caption].
const PICKS = [
  ['gecici-06', 'Chicano kol'], ['kalici-07', 'Kadın portresi ve yapraklar'], ['piercing-08', 'Sallantılı göbek piercing'],
  ['kulak-04', 'Kulak dizisi, çiçek ve yıldız'], ['gecici-02', 'Renkli güller'], ['kalici-03', 'Tüy ve kuşlar'],
];

test('SEED_PHOTOS: the owner’s 31 picks, 10 geçici, 9 kalıcı, 9 piercing and 3 kulak, mixed', () => {
  assert.equal(SEED_PHOTOS.length, 31);
  assert.deepEqual(SEED_PHOTOS.slice(0, 6).map(({ seed_path, caption }) => [seed_path, caption]), PICKS);
  const per = (category) => SEED_PHOTOS.filter((photo) => photo.category === category).length;
  assert.deepEqual([per('gecici'), per('dovme'), per('piercing'), per('kulak')], [10, 9, 9, 3]);
  for (const photo of SEED_PHOTOS) {
    const folder = photo.seed_path.split('-')[0];
    assert.equal(photo.category, { gecici: 'gecici', kalici: 'dovme', piercing: 'piercing', kulak: 'kulak' }[folder], photo.id);
  }
  assert.deepEqual(SEED_PHOTOS[0], { id: 'seed-gecici-06', caption: 'Chicano kol', category: 'gecici', seed_path: 'gecici-06', width: 474, height: 790 });
});

test('SEED_PHOTOS are consistent: ids, paths, categories, captions and sizes', () => {
  assert.equal(new Set(SEED_PHOTOS.map((photo) => photo.id)).size, SEED_PHOTOS.length);
  for (const photo of SEED_PHOTOS) {
    assert.match(photo.id, /^seed-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(photo.seed_path, photo.id.slice('seed-'.length));
    assert.ok(CATEGORIES.includes(photo.category), photo.id);
    assert.deepEqual(validateCaption(photo.caption), { ok: true, value: photo.caption }, photo.id);
    for (const size of [photo.width, photo.height]) assert.ok(Number.isInteger(size) && size >= 1 && size <= 4000, photo.id);
  }
});

test('DEFAULT_HERO is the shop’s logo (the old AI sign with its “Tatoo” typo is retired)', () => {
  assert.deepEqual(DEFAULT_HERO, { source: 'seed', seed_path: 'logo', width: 1254, height: 1254 });
});

// The owner's real Google reviews, word for word. The spelling is theirs: do not correct it.
const REVIEWS = [
  ['Humeyra K.', 'Çok memnun kaldım fiyatlarda gayet uygun el işçiliği desen harika dövmemi yaparken çok özenerek yaptılar en ince detayına kadar ilgilendiler sorduğum sorularda cevapsız kalmadı çok sakin çok profosyonelceydi burdan tekrardan teşekkürlerimi iletmek istiyorum başarılarınızın devamını dilerim çınar tattoo'],
  ['Hulya A.', 'İlk dövme deneyimimdi. Hijyenik konusunda kaygılıydım..Ortamı gördükten sonra yaptırmaya karar verdim. Onur bey işinin ehli, sabırla istediğim şekilde özenle yapıldı. Çok beğendim ellerine emeğine sağlık.'],
  ['Yunus A.', 'Esenlerin en iyi dövmesini ben çok beğendim muhakkak gelin her çeşit dövme yapıyorlar fiyatlarıda çok uygun iyi karşılıyorlar güler yüzlüler'],
  ['Ömer D.', 'Profesyonel ve hijyenik bakımından mükemmel ve çok mütevazi insanlar gönül rahatlığıyla gidebilirsiniz fiyat konusunda yardımcı oluyorlar kullanılan malzemeler en üst seviyede olup profosyonel makinaları kullanılıyo Mükemmel tesekkurler çınar tatto…'],
  ['Google kullanıcısı', 'Güler yüzü samimi sohbeti ile gidebileceğiniz en güzel yerlerden diyebilirim işine özen göstermesi ve el işçiliği mükemmel 3 dövme yaptırdım üçüde aşırı içime sindi ve mükemmel oldu teşekkür ederim çınartattooesenler 🙏'],
  ['Sila', 'İlk dövmem için geldim gerçekten çok iyi bir dükkan temiz hijyenik malzemelerini yeni ve göz önümüzde açtı çok tatlı ve şirin bir dükkan gerçekten çok harikaydı'],
  ['Kader D.', 'Burun piercingi için gittim gerçekten güler yüzlü insanlardı, çok temiz ve titizlik ile işi yaptı, çok memnun kaldım, tavsiye ederimm'],
  ['Buse P.', 'Çok iyi bir dövme güler yüz ve ilgi çok iyi gayet mutlu girdim gayet mutlu çıktım dövmenin içildiğini beğendim ve atrı göbek piercing kuzenimle beraber yaptık acı yok çok hafif eli var teşekkürler çınar tattoo'],
  ['Güneş', 'İşini bilen biri olduğu kesin, hijyen konusunda çok iyi, kulak piercing yaptırdım çok memnun kaldım, çevreme tavsiye edeceğim kesin.…'],
  ['Defne G.', 'Göbek piercing’i yaptırmak için gittim çok güzel bir yer tavsiye ederim korktuğum için onları çok beklettim ama beni çok anlayışla karşıladılar teşekkür ederim sevgi ve saygı dolu bir insan başarılarının devamını dilerim…'],
  ['Efee', 'Gayet kaliteli bir işletme dövme piercing vesaire tüm imkanlar mevcut onur beyde gayet kibar memnun kaldık'],
  ['Sude Ü.', 'Burnuma nostril piercing yaptırdım hijyen konusunda çok dikkatli güler yüzlü ve ilgiliydi çok memnun kaldım😊…'],
  ['Oyku', 'Çok güzel bir dövmeci herkese öneririm\nPiercingi steril 🫶🏻 😍…'],
];

test('SEED_REVIEWS: thirteen real reviews, verbatim and in order', () => {
  assert.deepEqual(SEED_REVIEWS.map((review) => [review.name, review.text]), REVIEWS);
});

test('every seeded review is 5 stars from Google, with no date', () => {
  for (const review of SEED_REVIEWS) {
    assert.deepEqual(Object.keys(review).sort(), ['date_text', 'name', 'rating', 'source', 'text']);
    assert.equal(review.rating, 5, review.name);
    assert.equal(review.source, 'google', review.name);
    assert.equal(review.date_text, '', review.name);
  }
});

test('the review that praises a woman artist stays out: the shop has none', () => {
  assert.ok(!SEED_REVIEWS.some((review) => review.name.startsWith('Gülçek')));
  assert.ok(!SEED_REVIEWS.some((review) => /kadın sanatçı/i.test(review.text)));
});

test('the last review keeps its single line break, which the page shows as <br>', () => {
  assert.equal(SEED_REVIEWS[12].text.split('\n').length, 2);
  assert.ok(SEED_REVIEWS.slice(0, 12).every((review) => !review.text.includes('\n')));
});

test('the seeded reviews pass the review rules unchanged, so saving the list in the panel alters none of them', () => {
  const result = validateReviews(SEED_REVIEWS);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.reviews, SEED_REVIEWS);
});
