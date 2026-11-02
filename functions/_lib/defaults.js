// What the site shows before the owner changes anything, and what the first request seeds into D1.
//
// This is shared, module-level data: treat it as read-only and copy before changing anything
// (`{ ...DEFAULT_SETTINGS }`). The rules for each setting live in fields.js.
//
// Every DEFAULT_SETTINGS value is a string. A list (highlights, hero_points) is stored as a JSON
// string, as D1 holds it; listSetting() in fields.js reads it back as an array.

export const BRAND_NAME = 'Çınar Tattoo';

export const DEFAULT_SETTINGS = {
  seo_title: 'Esenler Dövmeci | Çınar Tattoo Piercing',
  seo_description: "Esenler'de dövmeci ve piercing hizmeti mi arıyorsunuz? Kalıcı dövme, geçici dövme, profesyonel piercing uygulamaları ve kaliteli dövme malzemeleri.",
  hero_title: 'Esenler’de 2005’ten beri dövme ve piercing',
  hero_text: 'Onur Aydoğan’ın stüdyosu. Randevu için ara ya da uğra.',
  about_title: 'Onur Aydoğan',
  about_text: 'Onur Aydoğan 20 yılı aşkın süredir dövme yapıyor. Esenler’deki stüdyosunda dövme, piercing ve malzeme için seni bekliyor.',
  hours: '10.00–23.00',
  hours_note: 'Duruma göre esneyebilir.',
  address: 'Nine Hatun Mah. İnönü Cd. No:11, Akman Ticaret Merkezi, 34220 Esenler / İstanbul',
  phone: '0537 263 15 46',
  whatsapp: '0537 263 15 46',
  instagram_url: 'https://www.instagram.com/cinartattooesenler',
  maps_url: '',
  announcement_text: '',
  announcement_on: '0',
  highlights: JSON.stringify(['20 yılı aşkın tecrübe', '2005’ten beri Esenler’de', 'Kişiye özel çizim', 'Kalıcı ve geçici dövme', 'Profesyonel piercing']),
  hero_points: JSON.stringify(['Kişiye özel dövme tasarımı', 'Profesyonel piercing uygulamaları', 'Kaliteli dövme malzemeleri']),
  payment_text: '',
  instagram_followers: '18 bin+',
  // A Google Maps search for the name the shop has on Google, until the owner pastes the real link.
  google_reviews_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Çınar Tattoo esenler dövme piercing studiosu')}`,
  tiktok_url: '',
  email: '',
};

export const DEFAULT_SERVICES = [
  { id: 1, name: 'Kalıcı dövme', description: 'Yazıdan büyük parçalara, sana göre çizilen dövmeler.' },
  { id: 2, name: 'Geçici dövme', description: 'Kalıcıya karar vermeden önce denemek isteyenler için.' },
  { id: 3, name: 'Piercing', description: 'Kulak, burun, göbek ve daha fazlası.' },
  { id: 4, name: 'Dövme malzemeleri', description: 'Boya, iğne ve bakım ürünleri.' },
];

// The owner's own Instagram photos, in position order. The sizes are those of the files in
// public/seed/<seed_path>-full.jpg.
export const SEED_PHOTOS = [
  { id: 'seed-chicano-kol', caption: 'Chicano kol', category: 'dovme', seed_path: 'chicano-kol', width: 475, height: 797 },
  { id: 'seed-renkli-gul', caption: 'Renkli güller', category: 'dovme', seed_path: 'renkli-gul', width: 463, height: 800 },
  { id: 'seed-kurt', caption: 'Kurt ve orman', category: 'dovme', seed_path: 'kurt', width: 487, height: 790 },
  { id: 'seed-yazi-gogus', caption: 'Chicano yazı', category: 'dovme', seed_path: 'yazi-gogus', width: 502, height: 641 },
  { id: 'seed-gobek-piercing', caption: 'Göbek piercing', category: 'piercing', seed_path: 'gobek-piercing', width: 477, height: 811 },
];

// The shop sign shown in the hero until the owner uploads another picture.
export const DEFAULT_HERO = { source: 'seed', seed_path: 'tabela', width: 880, height: 932 };

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
