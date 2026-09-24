# cagd-utilities — Yapılacaklar

> Kaynak: [INCELEME.md](./INCELEME.md) · İlk liste: 2026-09-24 (`0.0.4`) · **Durum: `0.1.0`'da tamamlandı** (2026-09-24)
>
> Öncelik: **P0** = hatalı davranış · **P1** = tutarlılık / "tek yerden kontrol" · **P2** = paketleme & uyumluluk ·
> **P3** = test, araç, doküman · **P4** = amaca yönelik yeni özellikler
>
> Her maddenin altında **Yapılan** notu ve varsa onu doğrulayan test dosyası yazılıdır.
> Doğrulama: `npm run check` → lint + format + build + **72 test** (Redis/Postgres entegrasyonu dahil);
> ayrıca Node 20 / 22 / 25, Express 4 / 5 ve Redis 4 / 5 ile çalıştırıldı.
> Kullanıcıyı etkileyen değişiklikler: [CHANGELOG.md](../CHANGELOG.md).

---

## P0 — Hatalar

### Yaşam döngüsü (`service/`)

- [x] **`service.start()` argüman sırasına uymuyor**
  **Yapılan:** `start()` adları verilen sırayla başlatıyor. _Test: `test/service.test.js`_

- [x] **`start()` bilinmeyen servis adını sessizce yok sayıyor**
  **Yapılan:** `ServiceName` union tipi eklendi (yanlış ad derleme hatası verir); çalışma anında bilinmeyen ad varsa hiçbir servis başlatılmadan hata fırlatılıyor. _Test: `service.test.js`, `package.test.js` (`@ts-expect-error`)_

- [x] **`stopAll()` sırasız ve paralel kapatıyor, hataları yutuyor**
  **Yapılan:** Servisler başlatılma sırasının tersiyle, sırayla kapatılıyor. Biri hata verse de diğerleri kapatılıyor, sonunda `AggregateError` fırlatılıyor. _Test: `service.test.js`_

- [x] **`service.web.start()` port doluyken asılı kalıyor**
  **Yapılan:** `start()` `error`/`listening` olaylarını bekliyor ve `EADDRINUSE`'da açıklayıcı mesajla reject oluyor. _Test: `web.test.js`_

- [x] **`service.web.stop()` keep-alive bağlantılar yüzünden bitmeyebilir**
  **Yapılan:** Yeni bağlantı kabulü duruyor, boşta kalan bağlantılar hemen ve süren istekler bittikçe kapatılıyor. `services.web.shutdownTimeoutMs` (varsayılan 10 sn) sonra hepsi zorla kapatılıyor. _Test: `web.test.js`_

- [x] **Web çalışırken `configure()` sunucuyu sahipsiz bırakıyor**
  **Yapılan:** Çalışırken `configure()` ve `WebService.reset()` hata fırlatıyor. _Test: `web.test.js`_

- [x] **`service.mail.start()` başarısız olsa da hata fırlatmıyor**
  **Yapılan:** `start()` SMTP doğrulaması (`MailService.connect()`) başarısızsa diğer servisler gibi hata fırlatıyor.

### Prisma

- [x] **`use()` / `register()` / `configure()` eski client'ı kapatmıyor**
  **Yapılan:** Eski client'ın bağlantısı `$disconnect()` ile kapatılıyor, definer "başlatılmamış" durumuna geçiyor. _Test: `prisma.test.js`_

- [x] **`disableAdapter` yolu Prisma 7 ile uyumsuz**
  **Yapılan:** `datasourceUrl` artık eklenmiyor; client sadece `clientOptions` ile oluşturuluyor. Prisma ≤ 6'da schema'daki `url`, Prisma 7'de `clientOptions.accelerateUrl` kullanılıyor (README ve hata mesajında yazıyor). _Test: `prisma.test.js`_

### Redis

- [x] **`close()` bağlı değilken client'ı kapatmıyor**
  **Yapılan:** Client `isReady` ise `quit()`, bağlanmaya/yeniden bağlanmaya çalışıyorsa `disconnect()` çağrılıyor. Ayrıca ilk bağlantı `services.redis.connectRetries` (varsayılan 5) denemeden sonra hata veriyor; önceden sonsuza kadar bekliyordu. _Test: `redis.test.js`_

- [x] **`connect()` iki kez çağrılırsa hata**
  **Yapılan:** Süren bağlantı promise'i paylaşılıyor, bağlıysa hemen dönüyor. _Test: `redis.test.js` (paralel 3 çağrı)_

- [x] **`ready` logu yanlış host basıyor**
  **Yapılan:** Log'a gerçek URL basılıyor, içindeki şifre `***` ile gizleniyor.

### Config

- [x] **Alan sırası farklıysa config.jsonc yeniden yazılıyor**
  **Yapılan:** Anahtar sırasından bağımsız bir karşılaştırmayla (`findMissingPaths`) sadece gerçekten eksik alan olup olmadığına bakılıyor. _Test: `config.test.js`_

- [x] **`writeBack` dosyayı baştan üretiyor**
  **Yapılan:** Eksik alanlar `jsonc-parser`'ın `modify()`/`applyEdits()` fonksiyonlarıyla ekleniyor. `setConfig(..., true)` da sadece değişen alanları güncelliyor. Kullanıcı yorumları ve alan sırası korunuyor. Bozuk dosyaya hiç yazılmıyor. _Test: `config.test.js`_

- [x] **`reloadFile()` silinen alanları varsayılana döndürmüyor**
  **Yapılan:** Config katmanlara ayrıldı: varsayılan, dosya, env ve runtime. Reload sadece dosya katmanını yeniliyor. _Test: `config.test.js`_

- [x] **`watchFile()` atomic save'de kopuyor**
  **Yapılan:** Dosya yerine dizin izleniyor ve dosya adına göre filtreleniyor. _Test: `config.test.js` (rename ile iki kez değiştirme)_

- [x] **İç içe nesnelere yazma `onChange` tetiklemiyor, alt referanslar bayatlıyor**
  **Yapılan:** README'de belgelendi (listede önerilen asgari çözüm). Tipleri `readonly` yapmak, config dizilerini `string[]` bekleyen kütüphanelere (örn. cors) vermeyi kıracağı için yapılmadı. Üst seviye alanlara yazma runtime katmanına gidiyor ve `onChange` tetikleniyor. _Test: `config.test.js`_

### HTTP

- [x] **Axios: kullanıcının verdiği `timeout` eziliyor**
  **Yapılan:** Önce config değeri, sonra kullanıcının `instance` seçenekleri uygulanıyor. _Test: `axios.test.js`_

- [x] **Axios interceptor'ı `Error` olmayan obje ile reject ediyor**
  **Yapılan:** Hatalar `AxiosServiceError extends Error` olarak fırlatılıyor (`status`, `code`, `inResponse`, `service`, `details` = orijinal `AxiosError`, `cause`). Eski `error`/`inResponse`/`details` alanları korundu. _Test: `axios.test.js`_

- [x] **SSL yolu hep `cwd`'ye ekleniyor**
  **Yapılan:** Mutlak ve var olan yol olduğu gibi kullanılıyor; aksi halde `cwd`'ye göre çözülüyor (eski `"/ssl"` değerleri çalışmaya devam ediyor). Varsayılanlar `path: "ssl"`, `certFile: "origin.pem"`. _Test: `web.test.js` (gerçek sertifikayla HTTPS isteği)_

- [x] **`service.web.app` kendi oluşturduğu uygulamayı döndürmüyor**
  **Yapılan:** `WebService.getApp()` eklendi; `service.web.app` onu döndürüyor. _Test: `web.test.js`_

### Logger

- [x] **cagd-log kaynak dosya bilgisi kayboluyor** — _teşhis düzeltildi_
  **Asıl sebep:** Sorun bu paketteki sarmalayıcı değil. `cagd-log`, log satırındaki dosya adını `module.parent` ile, yani **kendisini ilk `require()` eden modülden** alıyor (`cagd-log/index.js:167`). Bu yüzden hangi modül onu önce yüklerse tüm loglar o dosyadan geliyormuş gibi görünüyor.
  **Bu pakette yapılan:** cagd-log artık import anında değil **ilk log anında** yükleniyor (tüketici proje genelde daha önce yüklemiş oluyor) ve önce tüketicinin dizininde aranıyor. Sarmalayıcı sadeleştirildi.
  **Kalıcı çözüm (bu repo dışı):** Bkz. aşağıdaki "Sonraki adımlar".

---

## P1 — Tutarlılık ("tek yerden kontrol")

- [x] **Varsayılan değerler için tek kaynak**
  **Yapılan:** Tüm varsayılanlar `baseConfig`'te. Servisler `config/access.ts` içindeki `baseCfg()` üzerinden okuyor ve kendi içlerinde hiçbir `?? "..."` varsayılanı tutmuyor. `setDefaultConfig()` çağrılmasa bile aynı değerler kullanılıyor. _Test: `access.test.js`_

- [x] **`(config as any)` kullanımını kaldır**
  **Yapılan:** Servis katmanında hiç kalmadı; `baseCfg()` tam tipli `BaseConfig` döndürüyor.

- [x] **Env ↔ config.jsonc ↔ varsayılan öncelik kuralı**
  **Yapılan:** Öncelik sırası: `setConfig()` > env > config.jsonc > varsayılan. Eşlemeler tek tabloda (`baseConfigEnv`) duruyor ve genişletilebilir (`env` seçeneği). Değerler varsayılanın tipine dönüştürülüyor. Env değerleri dosyaya asla yazılmıyor. Servisler `process.env` okumuyor. README'de tablo var. _Test: `config.test.js`, `access.test.js`_

- [x] **Express varsayılan cevaplarını `util/http` standardına bağla**
  **Yapılan:** 404, 429, 4xx (bozuk JSON, büyük gövde) ve 500 cevapları `errorResponse` formatında dönüyor; `code` alanı dolu, `request_id` dahil. _Test: `web.test.js`_

- [x] **Singleton / kaynak yönetimi desenini standartlaştır**
  **Yapılan:** Tüm servislerde kaynaklar lazy kuruluyor. `connect()` ve `close()` idempotent; `close()` hem kaynağı hem instance'ı null'luyor. `BaseService`'e `connect()` eklendi. Definer'lar ortak bir `Definer` taban sınıfından türüyor. Kurallar `_template.Service.ts`'te yazıyor.

- [x] **`healthCheck` loglaması tutarsız**
  **Yapılan:** Tüm servisler asla hata fırlatmıyor, hata durumunda `log.warn("XxxService: healthCheck başarısız.", err)` yazıp `false` dönüyor.

- [x] **Log/hata mesajlarında tek dil**
  **Yapılan:** Paketin tüm log ve hata mesajları Türkçe, `XxxService:` / `service.xxx:` önekli. HTTP cevap mesajları (`Not Found`, `Internal Server Error` …) API istemcilerine döndüğü için İngilizce bırakıldı.

- [x] **Tarih formatı tutarlılığı**
  **Yapılan:** Standart belirlendi: makineler arası zaman damgaları UTC ISO (`…Z`, API cevaplarında olduğu gibi); yerel saat için ofsetli `util.date.getLocalISO()` eklendi. `getLocalDate()` "sadece gösterim" olarak belgelendi (geriye dönük uyumluluk için duruyor).

- [x] **Güncel olmayan doküman yorumları**
  **Yapılan:** `types.ts`, `base-config.ts`, `services/index.ts`, `service/index.ts`, `_template.Service.ts` güncellendi.

- [x] **Paket kendi içinde "eski kısayol"u kullanıyor**
  **Yapılan:** İç kullanımın tamamı `baseCfg()` üzerinden. `config.services...` kısayolu sadece tüketiciler için (deprecated) duruyor.

- [x] **`service` / `services` isimleri çok benzer**
  **Yapılan:** Kırıcı olmayan `classes` alias'ı eklendi (`import { classes } from "cagd-utilities"`); README'de önerilen ad bu. `services` kaldırılmadı.

---

## P2 — Paketleme ve uyumluluk

- [x] **`.d.ts` dosyaları opsiyonel paketlerin tiplerini import ediyor**
  **Yapılan:** Listede önerilen (a) seçeneği uygulandı: README'de `skipLibCheck: true` önerisi ve `@types/express` şartı yazılı. Gerekli paketler kuruluyken `skipLibCheck: false` ile tiplerin ve `examples/`'ın hatasız derlendiği testle doğrulanıyor (Express 4 ve 5 tipleriyle). (b) seçeneği için bkz. "Sonraki adımlar". _Test: `package.test.js`_

- [x] **Native ESM'de alt yol named import çalışmıyor**
  **Yapılan:** Lazy export'lar Node'un statik analiz aracının (cjs-module-lexer) tanıdığı kalıpta yazıldı; `import { RedisService } from "cagd-utilities/services"` artık çalışıyor. Bunun yan etkisi (ESM'de bu alt yoldan named import yapınca kurulu servislerin hemen yüklenmesi) README'de belgelendi. _Test: `package.test.js` (opsiyonel paketler kurulu değilken ve kuruluyken)_

- [x] **Minimum TypeScript sürümünü belirt** — README: TypeScript ≥ 5.4.

- [x] **Peer dependency aralıkları**
  **Yapılan:** `@prisma/client` `>=5 <8`, `@prisma/adapter-*` `>=6.10.0 <8` (mssql adapter 6.10'da çıktı), `cagd-log` `>=1.1.0 <2`. Express 5 ve Redis 5 ile tüm test paketi çalıştırıldı ve geçti; bu yüzden `>=4` aralıkları korundu.

- [x] **Tek paket yöneticisi** — `bun.lock` silindi; npm (`package-lock.json`).

- [x] **`.npmignore` gereksiz** — Silindi; `files` alanı (`dist`, `README.md`, `CHANGELOG.md`, `LICENSE`).

- [x] **Yan etkili varsayılanlar**
  **Yapılan:** `staticDir` varsayılanı `false`; dizin otomatik oluşturulmuyor. Statik servis açıksa rate limit dışında kalıyor. Gövde limiti `services.web.bodyLimit` ile ayarlanabiliyor, rate limit `services.web.rateLimit.enabled` ile kapatılabiliyor. _Test: `web.test.js`_

- [x] **Güvenlik varsayılanları**
  **Yapılan:** MSSQL varsayılan kimlik bilgileri boş; boş alanlar sürücüye hiç gönderilmiyor. `cors.origin: "*"` için şema açıklamasında ve README'de uyarı var. Gizli bilgiler env ile verilebiliyor ve dosyaya yazılmıyor. `X-Request-Id` girdisi doğrulanıyor. 500 cevaplarında iç hata mesajı sızdırılmıyor. Axios `User-Agent` davranışı `services.axios.userAgent` ile ayarlanabiliyor (varsayılan eskisi gibi: gönderilmez).

---

## P3 — Test, araç, doküman

- [x] **Otomatik test** — `node:test` ile 72 test, 10 test dosyası (`test/`): deep-merge, jsonc-writer, env, ConfigManager, config erişimi, servis yaşam döngüsü, bootstrap/sinyaller, web/Express, axios, prisma, redis, postgres, paketleme/ESM/tipler. Redis/Postgres entegrasyon testleri `TEST_REDIS_URL` / `TEST_DATABASE_URL` tanımlıysa çalışıyor.
- [x] **`test/` → `examples/`** — Örnek, bootstrap/healthRouter/ApiError ile güncellendi ve testte tip kontrolünden geçiyor.
- [x] **Lint/format** — ESLint 9 (typescript-eslint) + Prettier; `npm run lint`, `npm run format`, `npm run format:check`.
- [x] **CI** — `.github/workflows/ci.yml`: Node 20/22/24 matrisi, Redis + Postgres servisleri, lint → format → build + test → `npm pack --dry-run`.
- [x] **CHANGELOG.md + semver** — `CHANGELOG.md` eklendi, sürüm `0.1.0` (kırıcı değişiklikler minor artışla). `prepublishOnly` artık tüm kontrolleri çalıştırıyor.
- [x] **README** — env tablosu, öncelik kuralı, TS/ESM/link notları, yeni API'ler; "Used AI to create." satırı kaldırıldı.

---

## P4 — Amaca yönelik öneriler

- [x] **Graceful shutdown helper** — `service.handleSignals({ signals, timeoutMs, onShutdown, handleErrors, exit })`. _Test: `service.test.js`_
- [x] **Bootstrap helper** — `service.bootstrap(names, { signals, exitOnError, exit })`. _Test: `service.test.js`_
- [x] **Hazır health router** — `util.http.healthRouter({ path })`: hepsi sağlıklıysa 200, değilse 503 + `UNHEALTHY`. _Test: `web.test.js`_
- [x] **Request-ID middleware** — `util.http.requestIdMiddleware`, `createExpressApp`'te varsayılan açık. _Test: `web.test.js`_
- [x] **Hata sınıfı** — `util.http.ApiError` (+ `badRequest`, `notFound` …), `errorHandler` tanıyor. _Test: `web.test.js`_

---

## Sonraki adımlar (bu sürümün kapsamı dışında)

- [ ] **cagd-log'da dosya adı tespiti** (ayrı repo: `cagdu/cagd-log`): `module.parent` yerine her log çağrısında stack trace'ten çağıran dosyayı bul (`new Error().stack` veya `Error.captureStackTrace`). `module.parent` ayrıca Node'da deprecated.
- [ ] **cagd-log'da performans**: her log çağrısında tüm log dosyası senkron okunup yeniden yazılıyor (`_saveIt` → `readFileSync` + `writeFileSync`). Dosya büyüdükçe her log yavaşlar ve event loop'u bloklar; `fs.appendFile` / stream ile satır ekleme (JSON Lines) önerilir.
- [ ] **Tiplerin opsiyonel paketlerden ayrılması** (P2 (b) seçeneği): servis sınıf tiplerini kök `index.d.ts`'ten çıkarıp sadece alt yollarda (`cagd-utilities/services/redis` gibi) açmak. `skipLibCheck: false` + eksik sürücü senaryosunu da çözer ama kırıcı bir değişiklik; bir sonraki minor sürümde değerlendir.
- [ ] **Dual CJS/ESM build** (tsup vb.): şu an CJS paket ESM'den sorunsuz kullanılabiliyor; gerçek bir ESM build ancak ESM'e özgü bir ihtiyaç doğarsa gerekli.
- [ ] **MSSQL entegrasyon testi**: SQL Server'ın ARM64 imajı olmadığı için yerelde çalıştırılmadı (config/adapter kurulumu test ediliyor). CI'a (x64) `mcr.microsoft.com/mssql/server` servisi eklenebilir.
