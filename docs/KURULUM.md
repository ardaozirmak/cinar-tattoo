# Çınar Tattoo: yayına alma ve kullanım rehberi

Bu rehber siteyi ve yönetim panelini Cloudflare Pages'te ücretsiz olarak yayına almayı adım adım anlatır. Her adımı sırayla yap; bir adım bitmeden sonrakine geçme.

Neler kullanılıyor:

- **GitHub:** kodun durduğu yer. Her `git push` siteyi kendiliğinden yeniden yayınlar.
- **Cloudflare Pages:** siteyi sunar. `public/` klasörü statik dosyalar, `functions/` klasörü sunucu kodudur. Build komutu yoktur.
- **D1 (`cinar-db`):** yazılar, fiyatlar, yorumlar, fotoğraf listesi ve şifre burada durur.
- **KV (`cinar-images`):** panelden yüklenen fotoğrafların kendisi burada durur.

Tablolar ilk istekte kendiliğinden kurulur ve başlangıç içeriğiyle doldurulur. Elle SQL çalıştırman gerekmez.

---

## 1. GitHub deposunu aç ve kodu gönder

1. GitHub'da yeni bir depo aç (ör. `cinar-tattoo`). **Private** (gizli) olabilir. README, .gitignore ya da lisans ekleme: depo boş açılmalı.
2. Bilgisayarda proje klasöründe, yayına çıkacak kodun `main` dalında olduğundan emin ol. Çalışma başka bir dalda yapıldıysa önce onu `main`'e al:

   ```bash
   git checkout main
   git merge site-v1
   ```

3. Depoyu bağla ve ilk gönderimi yap (adresi GitHub'ın verdiği adresle değiştir):

   ```bash
   git remote add origin https://github.com/KULLANICI-ADIN/cinar-tattoo.git
   git push -u origin main
   ```

   İnternet yavaşsa gönderim birkaç dakika sürebilir; kesilirse aynı komutu tekrar çalıştır, kaldığı yerden devam eder.

`.dev/`, `.dev.vars` ve `.superpowers/` klasörleri `.gitignore` içinde; yerel veritabanın ve şifren GitHub'a gitmez.

## 2. Cloudflare Pages projesini oluştur

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** sekmesi → **Connect to Git** (Git'e bağlan).
2. GitHub hesabını bağla ve `cinar-tattoo` deposunu seç.
3. Ayarlar:
   - **Production branch:** `main`
   - **Framework preset:** `None` (yok)
   - **Build command:** boş bırak
   - **Build output directory:** `public`
4. **Save and Deploy**. İlk yayın birkaç dakika sürer. Bittiğinde proje `https://<proje-adı>.pages.dev` adresini alır.

Bu ilk yayında sayfa açılır ama D1 ve KV henüz bağlı olmadığı için panel "Kurulum eksik: …" der. Bu beklenen bir durum; 4. ve 5. adımlar bunu çözer.

## 3. Önizleme yayınlarını kapat

Pages normalde `main` dışındaki her dal için ayrı bir önizleme adresi açar. Bu adresler canlı veritabanına bağlı birer kopya panel olurdu; istemiyoruz. Tek ortam var, o da canlı site.

Pages projesi → **Settings** → **Builds** (Builds & deployments) → **Branch control** → **Preview branch** için **None** seç → **Save**.

## 4. D1 veritabanını ve KV alanını oluştur

1. **Storage & Databases** → **D1 SQL Database** → **Create** → ad: `cinar-db` → **Create**.
2. **Storage & Databases** → **KV** → **Create** (Create a namespace) → ad: `cinar-images` → **Add**.

## 5. Bağlamaları ekle (Production)

Pages projesi → **Settings** → **Bindings** → **Add**:

| Tür | Değişken adı | Seçilecek |
|---|---|---|
| D1 database | `DB` | `cinar-db` |
| KV namespace | `IMAGES` | `cinar-images` |

Değişken adları büyük harfle ve tam olarak böyle yazılmalı. Bağlamaların **Production** ortamına eklendiğini kontrol et.

## 6. Gizli değişkenleri ekle

Önce `APP_SECRET` için rastgele bir değer üret (bilgisayarında, proje klasöründe olman gerekmez):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Çıkan 43 karakterlik satırı kopyala. Sonra Pages projesi → **Settings** → **Variables and Secrets** → **Add** (Production):

| Ad | Tür | Değer |
|---|---|---|
| `ADMIN_PASSWORD` | Secret | Onur Bey'in ilk giriş şifresi (en az 8 karakter). Ona güvenli bir yoldan ilet. |
| `APP_SECRET` | Secret | Az önce ürettiğin değer. |

`APP_SECRET`'i bir yere not etmen gerekmez ama **değiştirme**: değişirse bütün oturumlar kapanır ve panelde değiştirilmiş şifre artık tutmaz (şifre özeti bu değere bağlıdır). O durumda 9. bölümdeki sıfırlamayı yap.

## 7. Yeniden yayınla

Bağlamalar ve değişkenler yalnızca yeni bir yayında devreye girer. Pages projesi → **Deployments** → en üstteki yayının **⋯** menüsü → **Retry deployment**. (Ya da yeni bir `git push` yap.)

## 8. Yayın öncesi kontrol (canlı adreste)

Site henüz duyurulmadığı için `.pages.dev` adresi test ortamı olarak kullanılır. Gerçek Cloudflare ortamında CPU sınırı, harita ve önbellek ancak burada görülür. Telefonda ve bilgisayarda şunları dene:

- [ ] `https://<proje-adı>.pages.dev/` açılıyor: logo, başlık, çalışmalar, yorumlar, iletişim bilgileri görünüyor; telefonda sayfa yana kaymıyor.
- [ ] `/admin` adresinde şifre ekranı çıkıyor ve `ADMIN_PASSWORD` ile giriş yapılıyor. "Kurulum eksik" yazıyorsa 5–7. adımları kontrol et.
- [ ] **Fotoğraf yükleme:** "Fotoğraf ekle" ile bir fotoğraf yükle; panelde ve sitede (sayfayı yenileyince) görünüyor.
- [ ] **Fotoğraf değiştirme:** yüklediğin fotoğrafa dokun → "Fotoğrafı değiştir" → başka bir fotoğraf seç; sitede yenisi görünüyor.
- [ ] **Fotoğraf silme:** aynı fotoğrafı "Sil" ile sil; sitede artık yok.
- [ ] **Yazı değiştirme:** Yazılar → Giriş başlığını değiştir → "Kaydet" → "Kaydedildi" çıkıyor; sitede yeni başlık görünüyor. Sonra eski haline getir.
- [ ] Fiyatlar sekmesinde bir kalem kaydedince sitede "Fiyatlar" bölümü çıkıyor; listeyi boşaltınca kayboluyor.
- [ ] Sitedeki "Haritayı aç" düğmesi haritayı yüklüyor.
- [ ] WhatsApp, Ara ve Yol tarifi düğmeleri doğru numaraya ve adrese gidiyor; birkaç tıklamadan sonra panelin açılış ekranındaki sayım kartında görünüyor.

## 9. Onur Bey'in kendi telefonunda denemesi

Onur Bey paneli kendi telefonunda bir kez dener (yanında olman iyi olur):

- [ ] `/admin` adresinden şifreyle giriş.
- [ ] Galeriden birkaç fotoğraf seçip ekleme.
- [ ] Kamerayla fotoğraf çekip ekleme.
- [ ] Tarayıcı menüsünden **Ana ekrana ekle** (iPhone'da Safari → Paylaş → Ana Ekrana Ekle). Panel artık bir uygulama gibi açılır.
- [ ] Sonra **Ayarlar → Şifreyi değiştir** ile şifresini kendisi değiştirir. Bundan sonra `ADMIN_PASSWORD` artık kabul edilmez; diğer bütün oturumlar kapanır.

## Şifre unutulursa (sıfırlama)

Cloudflare → **Storage & Databases** → **D1 SQL Database** → `cinar-db` → **Console** sekmesi. Şunu yapıştır ve çalıştır:

```sql
UPDATE admin_auth SET hash = NULL, salt = NULL, iterations = NULL, session_version = session_version + 1 WHERE id = 1;
```

Bu, panelde değiştirilmiş şifreyi siler ve açık bütün oturumları kapatır. Artık `ADMIN_PASSWORD` yeniden geçerlidir. `ADMIN_PASSWORD`'ü de değiştirmek istersen 6. adımdaki gibi yeni değeri gir ve 7. adımdaki gibi yeniden yayınla. Girişten sonra Onur Bey şifresini yine panelden değiştirsin.

## İsteğe bağlı: alan adı ve Web Analytics

**Kendi alan adı (ör. `cinartattoo.com`):** Pages projesi → **Custom domains** → **Set up a custom domain** → alan adını yaz ve Cloudflare'in gösterdiği DNS adımlarını izle. Alan adı Cloudflare'de değilse, sağlayıcının panelinde verilen CNAME kaydını ekle. Sertifika kendiliğinden gelir; birkaç dakika ile birkaç saat sürebilir. Alan adı çalışınca Google Search Console'a ekle ve site haritasını gönder: `https://<alan-adın>/sitemap.xml`.

**Cloudflare Web Analytics:** Pages projesi → **Metrics** → **Web Analytics** → **Enable**. Dikkat: Cloudflare bunun için sayfaya `static.cloudflareinsights.com`'dan bir betik ekler, sitenin güvenlik kuralı (CSP) ise dışarıdan betik yüklenmesine izin vermez. Açmak istersen önce `functions/_lib/http.js` içindeki `SITE_CSP`'de `script-src`'ye `https://static.cloudflareinsights.com`, `connect-src`'ye `https://cloudflareinsights.com` ekle ve bu kuralı denetleyen testi güncelle. Gerek olmayabilir: panelin açılış ekranındaki sayım kartı, siteden kaç kişinin WhatsApp'a, aramaya ve yol tarifine geçtiğini zaten gösteriyor.

## Yerel kullanım (geliştirici için)

Gerekenler: Node 22.13 veya üstü. `npm install` yok; projenin hiç bağımlılığı yok.

1. Bir kez: `.dev.vars.example` dosyasını `.dev.vars` olarak kopyala ve içindeki `ADMIN_PASSWORD` ile `APP_SECRET`'i değiştir.
2. Komutlar:

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Yerel sunucuyu `http://127.0.0.1:8788` adresinde açar. D1 yerine `.dev/db.sqlite`, KV yerine `.dev/kv/` kullanılır. `functions/` ya da `dev/` değişince kendini yeniden başlatır. Panel: `http://127.0.0.1:8788/admin/`. |
| `npm run dev:lan` | Aynı sunucuyu yerel ağda açar ve telefonda açılacak adresi yazar (ör. `http://192.168.1.20:8788`). Telefon aynı Wi-Fi'de olmalı; Windows Güvenlik Duvarı sorarsa **Özel ağ** için izin ver. |
| `npm test` | Bütün birim testlerini çalıştırır (`node --test`). |
| `npm run e2e` | Uçtan uca deneme: başsız Edge ile panele 390 px telefon ekranında girer, fotoğraf yükler, yazı, fiyat ve yorum kaydeder, sitede görünüp görünmediğine bakar ve `.dev/shots/` içine `e2e-admin-390.png`, `e2e-site-390.png`, `e2e-site-1440.png` kaydeder. Geçici bir veritabanı kullanır; `.dev/` içindeki verine dokunmaz. Edge başka bir yerdeyse `EDGE_PATH` ile göster. Başarısız olursa hangi adımda kaldığını yazar ve `.dev/shots/fail.png` kaydeder. |

Yerel veritabanını sıfırlamak için sunucuyu durdur ve `.dev/` klasörünü sil; ilk açılışta başlangıç içeriği yeniden kurulur.

## Ücretsiz katman sınırları

Site bu sınırların rahatça altında kalacak şekilde yazıldı; küçük bir dükkânın trafiği için ödeme gerekmez.

| Hizmet | Ücretsiz sınır | Bu sitede |
|---|---|---|
| Pages Functions | Günde 100.000 istek, istek başına yaklaşık 10 ms CPU | Her sayfa açılışı 1 istek; panelden yüklenen fotoğrafların resimleri (`/img/…`) ilk kez istendiğinde birer istek, sonra önbellekten gelir. Statik dosyalar (CSS, JS, fontlar, başlangıç fotoğrafları) bu sayıya girmez. |
| D1 | 5 GB; günde 5 milyon satır okuma, 100.000 satır yazma | Her sayfa açılışı fotoğraf sayısı kadar artı birkaç düzine satır okur (en çok ~500); yazma yalnızca panelden kaydederken ve tıklama sayarken olur. |
| KV | 1 GB; günde 100.000 okuma, 1.000 yazma, 1.000 silme; değer başına en çok 25 MiB | Her yüklenen fotoğraf 2 yazma (büyük ve küçük sürüm). Fotoğraflar 1 yıl önbellekte durur, KV'den nadiren okunur. En fazla 400 fotoğraf. |

R2 kullanılmıyor; etkinleştirmek ödeme yöntemi isteyebildiği için fotoğraflar KV'de tutuluyor.

Sınıra yaklaşılırsa Cloudflare e-postayla haber verir; aşılırsa o gün için istekler hata verir, ertesi gün düzelir. Kullanımı Pages projesi → **Metrics** ve D1/KV sayfalarındaki **Metrics** sekmelerinden izleyebilirsin.
