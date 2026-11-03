# Sitedeki görseller

## Hizmet kartları

| Kart | Görsel | Kaynak |
|---|---|---|
| Kalıcı dövme | `public/media/hizmet-kalici.jpg` | Stüdyonun kendi işi (üçgen içinde gül, `seed/w03`) |
| Geçici dövme | `/seed/logo-thumb.jpg` | Logo. Çıkartma dövme fotoğrafı gelince değişecek. |
| Titanyum & çelik piercing | `public/media/hizmet-piercing.jpg` | Stüdyonun kendi işi (göbek piercing) |
| Ağrısız kulak delme | `public/media/hizmet-kulak.jpg` | CC0: [rawpixel 6038024](https://www.rawpixel.com/image/6038024/photo-image-public-domain-person-fashion) |

Kartlardaki fotoğraflar 560×700 (4:5) boyutunda kırpılmıştır. Her kartın görseli hizmetin adına göre seçilir (`render.js` içindeki `SERVICE_PHOTOS`). Eşleşen kelimeler şunlardır:

- "kulak" → kulak delme görseli
- "piercing" → piercing görseli
- "geçici" ya da "çıkartma" → logo
- "dövme" → kalıcı dövme görseli

Adı bu kelimelerden hiçbirini içermeyen bir hizmet kartı görselsiz görünür.

## Çalışmalar galerisi

Galeride yalnızca stüdyonun kendi işleri vardır: 21 kalıcı dövme ve 1 göbek piercing. Stok ya da temsili görsel kullanılmaz; kullanıcının isteğiyle 2026-11-03'te hepsi kaldırıldı.

Galerinin kategorileri şunlardır:

- Kalıcı dövme
- Geçici dövme
- Piercing
- Kulak delme
- Diğer

Bir kategoride fotoğraf yoksa o kategorinin sekmesi gösterilmez.

Kalıcı makyaj hizmeti yoktur; siteden tamamen kaldırıldı. Logonun alt yayında "Kalıcı makyaj" yazısı hâlâ duruyor, çünkü logo stüdyonun kendi tasarımıdır.

### Galeriden çıkarılan işler (2026-11-03)

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

## Yeni fotoğraf ve video eklemek

Instagram'dan otomatik indirme yapılamıyor (bot koruması). Fotoğraf ve videolar şu iki yoldan biriyle alınır:

- **Hesabın tamamı:** Instagram'da **Ayarlar → Hesap Merkezi → Bilgilerini indir**.
- **Tek bir reels:** Reels'in **⋯** menüsünden indirilir.

İndirilen dosyalar `Desktop\tatto\instagram` klasörüne konur. Videolar oradan karelere ayrılıp kategorisine eklenir. Köpükle silinerek gösterilen dövme videoları **Kalıcı dövme** kategorisine girer.
