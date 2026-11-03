# Sitedeki görseller

Sitede yalnızca stüdyonun kendi fotoğrafları var. Hazır (stok) görsellerin hepsi kaldırıldı.

## Çalışmalar galerisi

Galerideki 28 fotoğrafı stüdyo sahibi seçti (2026-11-03). Fotoğraflar masaüstündeki üç klasörden alındı; her klasör galeride bir kategoriye karşılık gelir:

| Klasör | Galerideki kategori | Fotoğraf sayısı |
|---|---|---|
| `kalıcı` | Kalıcı dövme | 9 |
| `geçici` | Geçici dövme | 10 |
| `piercing` | Piercing | 9 |

"Tümü" sekmesinde kategoriler karışık sırayla gösterilir.

Bu görseller `dev/seed-images.py` ile üretilir:

```
python -I dev/seed-images.py <klasörlerin bulunduğu dizin> public
```

Betik her fotoğrafın kenarındaki ince arayüz çizgisini kırpar. Göğüs yazısı fotoğrafında müşterinin yüzü de kırpılır.

Üretilen fotoğrafların sırası, başlığı ve boyutu `functions/_lib/defaults.js` dosyasındaki `SEED_PHOTOS` listesinde tutulur.

## Hizmet kartları

| Kart | Görsel |
|---|---|
| Kalıcı dövme | Kadın portresi ve yapraklar (`kalici-07`) |
| Geçici dövme | Renkli güller (`gecici-02`) |
| Titanyum & çelik piercing | Sallantılı göbek piercing (`piercing-08`) |
| Ağrısız kulak delme | Logo (küpe fotoğrafları gelince değişecek) |

Kart görselleri `public/media/hizmet-*.jpg` dosyalarıdır; 560×700 boyutunda kırpılmıştır.

Süreç bölümünde ("Fikirden deriye") yalnızca dövme fotoğrafları kullanılır. Bu bölüm piercing fotoğraflarını göstermez.

Kalıcı makyaj hizmeti yoktur ve sitede hiçbir yerde geçmez. Logonun alt yayındaki "Kalıcı makyaj" yazısı istisnadır; logo stüdyonun kendi tasarımı olduğu için olduğu gibi bırakıldı.

## Yeni fotoğraf ve video eklemek

Instagram'dan otomatik indirme yapılamıyor (bot koruması). Fotoğraf ve videolar şu iki yoldan biriyle alınır:

- **Hesabın tamamı:** Instagram'da **Ayarlar → Hesap Merkezi → Bilgilerini indir**.
- **Tek bir reels:** Reels'in **⋯** menüsünden indirilir.

İndirilen dosyalar `Desktop\tatto\instagram` klasörüne konur. Videolar oradan karelere ayrılıp kategorisine eklenir. Köpükle silinerek gösterilen dövme videoları **Kalıcı dövme** kategorisine girer.
