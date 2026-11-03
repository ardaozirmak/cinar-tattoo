# Çınar Tattoo

Esenler'deki Çınar Tattoo dövme ve piercing stüdyosunun web sitesi ve yönetim paneli. Site tek sayfadır ve sunucuda hazırlanır (`functions/index.js`); çalışmalar, yorumlar, fiyatlar, iletişim bilgileri ve bütün yazılar panelden (`/admin`) telefonla değiştirilir. Cloudflare Pages üzerinde ücretsiz katmanda çalışır: sayfa ve API Pages Functions'ta, içerik D1'de (`DB`), panelden yüklenen fotoğraflar KV'de (`IMAGES`). Yayına alma adımları [docs/KURULUM.md](docs/KURULUM.md) içinde; tasarım belgesi `docs/superpowers/specs/`, uygulama planı `docs/superpowers/plans/` altında.

Projenin hiç npm bağımlılığı ve build adımı yok: `public/` olduğu gibi yayınlanır, tek dış kütüphane siteyle birlikte sunulan anime.js'tir (`public/assets/vendor/`). Yerelde Cloudflare yerine Node'un yerleşik modülleriyle yazılmış küçük bir emülatör çalışır (`dev/`): D1 için `node:sqlite`, KV için bir klasör kullanır. Node 22.13 veya üstü gerekir. `public/assets/` altındaki her şey ziyaretçinin tarayıcısında bir yıl saklanır. `site.css` ve `site.js` sayfaya içeriklerinden türetilen bir sürümle (`?v=`) bağlandığı için yayından sonra kendiliğinden yenilenir; fontlar, `vendor/anime.esm.min.js` ve `og.jpg` ise sürümsüzdür, bu yüzden bunlardan biri değişirse dosyaya **yeni bir ad** verilmeli ve adı geçtiği yerler güncellenmelidir.

```bash
cp .dev.vars.example .dev.vars   # bir kez; içindeki şifreyi ve APP_SECRET'i değiştir
npm run dev       # http://127.0.0.1:8788  (panel: /admin/)
npm run dev:lan   # aynı Wi-Fi'deki telefondan denemek için; adresi ekrana yazar
npm test          # birim testleri (node --test)
npm run e2e       # başsız Edge ile uçtan uca deneme; ekran görüntüleri .dev/shots/ içine
```
