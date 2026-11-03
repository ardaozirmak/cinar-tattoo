# Hizmet kartlarındaki görseller

Hizmetler bölümündeki beş kartın görselleri **CC0 (kamu malı)** lisanslı stok fotoğraflardır. Çınar Tattoo'nun kendi işleri değildir. Bu yüzden her kartta "Temsili görsel" yazar ve bu görseller Çalışmalar galerisinde yer almaz.

CC0 kaynak göstermeyi şart koşmaz. Kaynaklar yine de burada kayıtlıdır; ileride bir görselin kaynağını doğrulamak gerekirse buradan bakılabilir.

| Dosya | Hizmet | Kaynak | Çeken |
|---|---|---|---|
| `public/media/hizmet-kalici.jpg` | Kalıcı dövme | [rawpixel 3370012](https://www.rawpixel.com/image/3370012/free-photo-image-tattooer-tattoo-artist-arm) | rawpixel (CC0) |
| `public/media/hizmet-gecici.jpg` | Geçici dövme | [WordPress Photos 8146639cbb](https://wordpress.org/photos/photo/8146639cbb/) | Nilo Velez (CC0) |
| `public/media/hizmet-piercing.jpg` | Titanyum & çelik piercing | [Commons: Titanium Piercing.JPG](https://commons.wikimedia.org/wiki/File:Titanium_Piercing.JPG) | Lukas Stavek (CC0) |
| `public/media/hizmet-kulak.jpg` | Ağrısız kulak delme | [rawpixel 6038024](https://www.rawpixel.com/image/6038024/photo-image-public-domain-person-fashion) | rawpixel (CC0) |
| `public/media/hizmet-makyaj.jpg` | Kalıcı makyaj | [StockSnap 2B47ZJBEU3](https://stocksnap.io/photo/eyes-eyelashes-2B47ZJBEU3) | Soroush Karimi (CC0) |

## Görsel ayrıntıları

- **Boyut ve format:** Hepsi 560×700 (4:5) kırpılmış JPEG'dir; her biri 120 KB'tan küçüktür.
- **Kartla eşleşme:** Görsel, hizmetin adına göre seçilir (`render.js` içindeki `SERVICE_PHOTOS`). Eşleşen kelimeler kulak, piercing, makyaj/kaş, geçici/kına ve dövmedir.
- **Hizmetler panelden değiştirildiğinde:** Panelden bir hizmetin adı değiştirilirse görsel de ona göre değişir. Adı hiçbir kelimeyle eşleşmeyen bir hizmet görselsiz gösterilir.

# Galerideki temsili görseller

Çalışmalar galerisinde 24 CC0 görsel daha var. Bunlar stüdyonun henüz az fotoğrafı olan kategorileri doldurur:

- Geçici dövme (kına): 7
- Piercing: 5 (stüdyonun kendi göbek piercing fotoğrafıyla birlikte 6)
- Kulak delme: 5
- Kalıcı makyaj: 7

Kalıcı dövme kategorisinde yalnızca stüdyonun kendi 21 işi vardır.

Galeride her temsili görselin başlığının yanında "Temsili" etiketi görünür; alt metnine de "(temsili görsel)" eklenir. Galeride temsili görsel olduğunda başlık "Stüdyodan işler, hizmetlerden örnekler." olur.

Hangi görselin temsili sayılacağı `seed_path` değerinin `temsili-` ile başlamasına bakılarak belirlenir (`render.js` içindeki `isSample`). Panelden bu görseller silinebilir ya da yerlerine stüdyonun kendi fotoğrafları yüklenebilir.

| Dosya | Başlık | Kaynak | Çeken |
|---|---|---|---|
| `public/seed/temsili-gecici-1-full.jpg` | Kınayla çiçek deseni | [wordpress.org](https://wordpress.org/photos/photo/8146639cbb/) | Nilo Velez |
| `public/seed/temsili-gecici-2-full.jpg` | El üstü kına deseni | [wordpress.org](https://wordpress.org/photos/photo/24465c4f6c/) | Needhi Singh |
| `public/seed/temsili-gecici-3-full.jpg` | İki avuç içi kına | [wordpress.org](https://wordpress.org/photos/photo/509654b177/) | Sharankrishna VP |
| `public/seed/temsili-gecici-4-full.jpg` | Kına, el ve bilek | [wordpress.org](https://wordpress.org/photos/photo/1156777a2c/) | Nishant Kapadiya |
| `public/seed/temsili-gecici-5-full.jpg` | Avuç içi mandala kına | [wordpress.org](https://wordpress.org/photos/photo/41067778ff/) | Priyanka Dholariya |
| `public/seed/temsili-gecici-6-full.jpg` | Bilekten parmağa kına | [wordpress.org](https://wordpress.org/photos/photo/74365c4f58/) | binitagothe |
| `public/seed/temsili-gecici-7-full.jpg` | Avuç içine kına çizimi | [wordpress.org](https://wordpress.org/photos/photo/416a11c7f0/) | Bibek KC |
| `public/seed/temsili-piercing-1-full.jpg` | Kaşta titanyum piercing | [commons.wikimedia.org](https://commons.wikimedia.org/wiki/File:Titanium_Piercing.JPG) | Lukas Stavek |
| `public/seed/temsili-piercing-2-full.jpg` | Burun piercing | [stocksnap.io](https://stocksnap.io/photo/closeup-face-ANPELTKSVL) | Candace McDaniel |
| `public/seed/temsili-piercing-3-full.jpg` | Burun piercing, taş uçlu | [stocksnap.io](https://stocksnap.io/photo/smiling-woman-KXLPITBRGU) | Matt Moloney |
| `public/seed/temsili-piercing-4-full.jpg` | Göbek piercing, taşlı | [commons.wikimedia.org](https://commons.wikimedia.org/wiki/File:My_navel_piercing.png) | Jnagy3 |
| `public/seed/temsili-piercing-5-full.jpg` | Göbek piercing | [commons.wikimedia.org](https://commons.wikimedia.org/wiki/File:White_navel_with_piercing.png) | JillhemBartolio |
| `public/seed/temsili-kulak-1-full.jpg` | Sallantılı küpe | [www.rawpixel.com](https://www.rawpixel.com/image/6038024/photo-image-public-domain-person-fashion) | — |
| `public/seed/temsili-kulak-2-full.jpg` | Kulak memesine küpe | [stocksnap.io](https://stocksnap.io/photo/earring-pierce-FEUMZDZO2A) | Terje Sollie |
| `public/seed/temsili-kulak-3-full.jpg` | Kalp küpe | [stocksnap.io](https://stocksnap.io/photo/ear-earring-GZ8PPR4HDG) | Candace McDaniel |
| `public/seed/temsili-kulak-4-full.jpg` | Taşlı top küpe | [www.flickr.com](https://www.flickr.com/photos/185514373@N06/49063420033) | shop8447 |
| `public/seed/temsili-kulak-5-full.jpg` | Yıldız küpe | [www.flickr.com](https://www.flickr.com/photos/185514373@N06/49062112557) | shop8447 |
| `public/seed/temsili-makyaj-1-full.jpg` | Kaş, yakın çekim | [stocksnap.io](https://stocksnap.io/photo/eyes-eyelashes-2B47ZJBEU3) | Soroush Karimi |
| `public/seed/temsili-makyaj-2-full.jpg` | Kaş ve kirpik | [stocksnap.io](https://stocksnap.io/photo/people-girl-VCRXKU9GLE) | Luca Iaconelli |
| `public/seed/temsili-makyaj-3-full.jpg` | Kaş ve bakış | [stocksnap.io](https://stocksnap.io/photo/people-woman-5SLCOVL7HX) | Alexandru Zdrobău |
| `public/seed/temsili-makyaj-4-full.jpg` | Kalıcı kaş | [www.flickr.com](https://www.flickr.com/photos/200491007@N03/53660888150) | microbladingiran |
| `public/seed/temsili-makyaj-5-full.jpg` | Kalıcı kaş, yakından | [www.flickr.com](https://www.flickr.com/photos/200491007@N03/53660645673) | microbladingiran |
| `public/seed/temsili-makyaj-6-full.jpg` | Belirgin kaş | [www.flickr.com](https://www.flickr.com/photos/135396164@N05/42431188931) | freestocks.org |
| `public/seed/temsili-makyaj-7-full.jpg` | Dudak rengi | [www.flickr.com](https://www.flickr.com/photos/150210070@N05/36430654442) | Smiles7676 |

# Galeriden çıkarılan işler (2026-11-03)

Görüntüsü zayıf olan ya da aynı işin tekrarı olan 15 fotoğraf çıkarıldı:

- w06 Boğa
- w07 Renkli güller (renkli-gul ile aynı iş)
- w10 Çift kurt (kurt ile aynı iş)
- w11 Renkli tam kol
- w16 Jilet ve şapka
- w21 Göğüs yazısı (yazi-gogus ile aynı iş)
- w22 Siyah-gri kol
- w23 Tek gül
- w24 Kalp ritmi
- w25 Dalga
- w26 Tüy
- w27 Ay yıldız
- w28 Zeytin dalı
- w29 Çift kalp
- w30 Gül, bel

## Stüdyonun kendi fotoğrafları ve videoları

Galerinin kategorileri şunlardır:

- Kalıcı dövme
- Geçici dövme
- Piercing
- Kulak delme
- Kalıcı makyaj
- Diğer

Panelden yüklenen her fotoğraf bu kategorilerden birine konur. Bir kategoride fotoğraf yoksa o kategorinin sekmesi gösterilmez.

Instagram'daki videolardan ve fotoğraflardan kare almak için dosyaların bilgisayara indirilmesi gerekir. Bunun yolu Instagram'da **Ayarlar → Hesap Merkezi → Bilgilerini indir** adımlarıdır. İndirilen dosyalar `tattoo` klasörüne konduktan sonra karelere ayrılabilir. Köpükle silinerek gösterilen dövme videoları **Kalıcı dövme** kategorisine girer.
