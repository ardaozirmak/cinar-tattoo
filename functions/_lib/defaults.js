// What the site shows before the owner changes anything, and what the first request seeds into D1.
//
// This is shared, module-level data: treat it as read-only and copy before changing anything
// (`{ ...DEFAULT_SETTINGS }`). The rules for each setting live in fields.js.
//
// Every DEFAULT_SETTINGS value is a string. A list (highlights, hero_points) is stored as a JSON
// string, as D1 holds it; listSetting() in fields.js reads it back as an array.

export const BRAND_NAME = 'Çınar Tattoo';

export const DEFAULT_SETTINGS = {
  seo_title: 'Esenler Dövme ve Piercing | Çınar Tattoo · 2005’ten beri',
  // No review claim here: the reviews can change, a fixed claim in Google's snippet cannot.
  seo_description: 'Esenler’de 2005’ten beri kalıcı ve geçici dövme, titanyum ve çelik piercing, ağrısız kulak delme: Onur Aydoğan’ın stüdyosu. Steril ortam, güler yüz. Randevu al.',
  // Each line of the hero title is one line of the H1; the last of two or three is set in italics.
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
  // The Sanatçımız list: each item is split at its first ' — ' into a bold title and a detail.
  highlights: JSON.stringify([
    '+20 yıllık tecrübe — 2005’ten beri Esenler’de, aynı mahallede.',
    'Güler yüz — Her soruna sabırla cevap; acele yok.',
    'Hijyen — Tek kullanımlık iğne, paketi göz önünde açılır.',
    'Müşteri memnuniyeti — Google yorumlarının hepsi 5 yıldız.',
  ]),
  hero_points: JSON.stringify(['Kişiye özel dövme tasarımı', 'Profesyonel piercing uygulamaları', 'Kaliteli dövme malzemeleri']),
  payment_text: '',
  instagram_followers: '18 bin+',
  // A Google Maps search for the name the shop has on Google, until the owner pastes the real link.
  google_reviews_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Çınar Tattoo esenler dövme piercing studiosu')}`,
  tiktok_url: '',
  email: '',
};

export const DEFAULT_SERVICES = [
  { id: 1, name: 'Kalıcı dövme', description: 'Yazıdan tam kola, sana göre çizilen dövmeler.' },
  { id: 2, name: 'Geçici dövme', description: 'Yapıştırma (çıkartma) dövme; kalıcıya karar vermeden önce dene.' },
  { id: 3, name: 'Titanyum & çelik piercing', description: 'Kulak, burun, göbek; titanyum ya da çelik takıyla.' },
  { id: 4, name: 'Ağrısız kulak delme', description: 'Ağrısız, acısız kulak delme; steril ortamda.' },
];

// The gallery a new site opens with, in position order: the photos the owner picked on 2026-11-03,
// one folder per category (kalıcı, geçici, piercing, kulak), mixed so that "Tümü" alternates them. They
// are the studio's own work, from its Instagram. The sizes are those of
// public/seed/<seed_path>-full.jpg, which dev/seed-images.py makes.
const photo = (path, caption, category, width, height) => ({ id: `seed-${path}`, caption, category, seed_path: path, width, height });

export const SEED_PHOTOS = [
  photo('gecici-06', 'Chicano kol', 'gecici', 474, 790),
  photo('kalici-07', 'Kadın portresi ve yapraklar', 'dovme', 469, 546),
  photo('piercing-08', 'Sallantılı göbek piercing', 'piercing', 466, 776),
  photo('kulak-04', 'Kulak dizisi, çiçek ve yıldız', 'kulak', 470, 780),
  photo('gecici-02', 'Renkli güller', 'gecici', 466, 791),
  photo('kalici-03', 'Tüy ve kuşlar', 'dovme', 471, 770),
  photo('piercing-04', 'Kaş piercing', 'piercing', 345, 499),
  photo('gecici-08', 'Aslan', 'gecici', 476, 690),
  photo('kalici-08', 'Yıldırım', 'dovme', 471, 695),
  photo('kulak-01', 'Kulak memesi ve kıkırdak, taşlı', 'kulak', 275, 484),
  photo('piercing-01', 'Göbek piercing, kalp uçlu', 'piercing', 466, 574),
  photo('gecici-10', 'Uluyan kurt', 'gecici', 467, 781),
  photo('kalici-09', 'Örümcek', 'dovme', 342, 369),
  photo('piercing-05', 'Göbek piercing, taşlı', 'piercing', 475, 636),
  photo('gecici-03', 'Renkli tam kol', 'gecici', 474, 804),
  photo('kalici-02', 'Kuşlar, köprücük', 'dovme', 470, 772),
  photo('piercing-02', 'Göbek piercing', 'piercing', 464, 789),
  photo('gecici-05', 'Kartlar ve şişe', 'gecici', 481, 776),
  photo('kalici-01', 'Bebek ayak izi', 'dovme', 464, 771),
  photo('piercing-07', 'Göbek piercing, sade', 'piercing', 471, 790),
  photo('kulak-05', 'Industrial ve halkalar', 'kulak', 466, 786),
  photo('gecici-07', 'Maskeli portre', 'gecici', 464, 792),
  photo('kalici-06', 'Kalp ritmi ve kuş', 'dovme', 339, 491),
  photo('piercing-09', 'Göğüs arası piercing', 'piercing', 466, 776),
  photo('gecici-04', 'Yılan', 'gecici', 471, 787),
  photo('kalici-04', 'Ay yıldız ve harf', 'dovme', 475, 731),
  photo('piercing-03', 'Göbek piercing, uygulama', 'piercing', 345, 501),
  photo('gecici-09', 'Kanatlar ve taç, ense', 'gecici', 474, 741),
  photo('kalici-05', 'Roma rakamı', 'dovme', 464, 790),
  photo('piercing-06', 'Göbek piercing, steril uygulama', 'piercing', 469, 780),
  photo('gecici-01', 'Göğüs yazısı', 'gecici', 471, 481),
];

// The shop's logo, shown whole and sharp as the hero until the owner uploads another picture. (The
// earlier AI-drawn sign is retired: it spelled "Tatoo".)
export const DEFAULT_HERO = { source: 'seed', seed_path: 'logo', width: 1254, height: 1254 };

const googleReview = (name, text) => ({ name, rating: 5, text, source: 'google', date_text: '' });

// Real reviews from the owner's Google listing, seeded once and in this order. The texts are word
// for word, spelling mistakes included: do not correct them. A line break inside a text shows as
// <br>. A review that praises a woman artist was left out on purpose: the shop has none, so it
// would promise something the visitor will not find.
export const SEED_REVIEWS = [
  googleReview('Humeyra K.', 'Çok memnun kaldım fiyatlarda gayet uygun el işçiliği desen harika dövmemi yaparken çok özenerek yaptılar en ince detayına kadar ilgilendiler sorduğum sorularda cevapsız kalmadı çok sakin çok profosyonelceydi burdan tekrardan teşekkürlerimi iletmek istiyorum başarılarınızın devamını dilerim çınar tattoo'),
  googleReview('Hulya A.', 'İlk dövme deneyimimdi. Hijyenik konusunda kaygılıydım..Ortamı gördükten sonra yaptırmaya karar verdim. Onur bey işinin ehli, sabırla istediğim şekilde özenle yapıldı. Çok beğendim ellerine emeğine sağlık.'),
  googleReview('Yunus A.', 'Esenlerin en iyi dövmesini ben çok beğendim muhakkak gelin her çeşit dövme yapıyorlar fiyatlarıda çok uygun iyi karşılıyorlar güler yüzlüler'),
  googleReview('Ömer D.', 'Profesyonel ve hijyenik bakımından mükemmel ve çok mütevazi insanlar gönül rahatlığıyla gidebilirsiniz fiyat konusunda yardımcı oluyorlar kullanılan malzemeler en üst seviyede olup profosyonel makinaları kullanılıyo Mükemmel tesekkurler çınar tatto…'),
  googleReview('Google kullanıcısı', 'Güler yüzü samimi sohbeti ile gidebileceğiniz en güzel yerlerden diyebilirim işine özen göstermesi ve el işçiliği mükemmel 3 dövme yaptırdım üçüde aşırı içime sindi ve mükemmel oldu teşekkür ederim çınartattooesenler 🙏'),
  googleReview('Sila', 'İlk dövmem için geldim gerçekten çok iyi bir dükkan temiz hijyenik malzemelerini yeni ve göz önümüzde açtı çok tatlı ve şirin bir dükkan gerçekten çok harikaydı'),
  googleReview('Kader D.', 'Burun piercingi için gittim gerçekten güler yüzlü insanlardı, çok temiz ve titizlik ile işi yaptı, çok memnun kaldım, tavsiye ederimm'),
  googleReview('Buse P.', 'Çok iyi bir dövme güler yüz ve ilgi çok iyi gayet mutlu girdim gayet mutlu çıktım dövmenin içildiğini beğendim ve atrı göbek piercing kuzenimle beraber yaptık acı yok çok hafif eli var teşekkürler çınar tattoo'),
  googleReview('Güneş', 'İşini bilen biri olduğu kesin, hijyen konusunda çok iyi, kulak piercing yaptırdım çok memnun kaldım, çevreme tavsiye edeceğim kesin.…'),
  googleReview('Defne G.', 'Göbek piercing’i yaptırmak için gittim çok güzel bir yer tavsiye ederim korktuğum için onları çok beklettim ama beni çok anlayışla karşıladılar teşekkür ederim sevgi ve saygı dolu bir insan başarılarının devamını dilerim…'),
  googleReview('Efee', 'Gayet kaliteli bir işletme dövme piercing vesaire tüm imkanlar mevcut onur beyde gayet kibar memnun kaldık'),
  googleReview('Sude Ü.', 'Burnuma nostril piercing yaptırdım hijyen konusunda çok dikkatli güler yüzlü ve ilgiliydi çok memnun kaldım😊…'),
  googleReview('Oyku', 'Çok güzel bir dövmeci herkese öneririm\nPiercingi steril 🫶🏻 😍…'),
];
