# Değişiklik Günlüğü

Biçim [Keep a Changelog](https://keepachangelog.com/tr/1.1.0/)'a dayanır. 0.x sürümlerinde kırıcı değişiklikler minor artışla yapılır.

## [Unreleased]

### Değişenler

- `util.redis`: `setRedisClient(null)` ile süreç içi mod açıkça seçildiyse kilit "Redis bağlı değil" uyarısı loglanmaz (tek kopyalı kurulumlarda her dakika
  tekrarlanan gürültü). Yeni `isMemoryModeExplicit()`.
- `PostgresService` / `MssqlService`: `pg` ve `mssql` artık Prisma adapter'ları gibi önce tüketici projenin dizininden (`process.cwd()`) yüklenir.
  Paket `npm link` / `file:` ile bağlıyken, proje sürücüyü kurmuş olsa da alınan `Cannot find module 'pg'` hatası giderildi.
- `PrismaService`: adapter yüklenemediğinde fırlatılan hata asıl `require` hatasını mesajda ve `cause` alanında taşır (eskiden yalnızca
  "paketler bulunamadı" deniyordu; paketler kuruluyken yanıltıcıydı).

### Düzeltilenler

- `service.jobs`: tur zaman aşımı sayacı `unref()` edilmiyor. Süreci açık tutan başka bir şey yokken `runNow()`/tur hiç sonuçlanmıyordu (jobs testleri bu
  yüzden kırmızıydı).

## [0.2.0] - 2026-10-03

Kırıcı değişiklik yok: yalnızca eklemeler; `onceEvery` pencereyi artık milisaniye hassasiyetiyle uygular (tam saniyeli çağrılarda davranış aynı).

### Eklenenler

- `service.jobs` (+ `JobRunner`, `computeNextRun`, `scheduleIntervalMs`): kilitli, çakışmasız, düzgün kapanan zamanlanmış işler.
  `define({ name, every: { seconds | minutes | hours | dailyAtUtc }, lock, runOnStart, timeoutMs, run })`, `status()`, `runNow()`, `reschedule()`, `undefine()`.
  `ServiceName`'e `"jobs"` eklendi; `service.bootstrap([..., "jobs"])`. Yeni config alanı: `services.jobs.shutdownTimeoutMs` (10000).
- `PrismaServiceOptions.adapterFactory`: driver adapter'ı uygulama oluşturur (tek dosyalık derlemeler — `bun build --compile` — için; adapter paketi
  dinamik `require` ile aranmaz).
- `util.redis.createCache(...).clear()`: namespace'teki tüm anahtarları siler (Redis'te `SCAN MATCH` + `DEL`).

- `util.list`: ortak liste/sayfalama sözleşmesi. `createListQuerySchema(z, { sorts, defaultSort, defaultOrder, maxLimit, defaultLimit, filters })`
  (zod parametre olarak alınır), `booleanQuery(z)`, keyset cursor (`encodeCursor`/`decodeCursor`, sort/order/filtre uyuşmazlığında
  `400 INVALID_INPUT`), `filtersHash`, Prisma'dan bağımsız `keysetWhere`/`orderBy`/`pageArgs`, `buildPage` ve uçtan uca `paginate`. `Page<T>` tipi.
- `util.http.errorHandler`: `ZodError` → `400 INVALID_INPUT` (`issues[0].message`, `data.path`); Prisma `P2002` → `409 CONFLICT`,
  `P2025` → `404 NOT_FOUND` (duck typing; zod/Prisma import edilmez). Aynı eşleme `util.http.toApiError(err)` olarak da dışa aktarıldı.
- `util.http.validate(schema, value)`: doğrulama hatasında handler ile aynı `ApiError`'u fırlatır.
- `util.http.getClientIp(req, { trustProxy, trustedForwardHeader })`: varsayılan soket adresi; başlığa yalnızca açık güvenle bakılır.
- `util.http.createRequestIdMiddleware({ trustIncoming })` ve `createExpressApp({ requestId: { trustIncoming } })`: gelen `X-Request-Id`'ye koşullu güven.

- `util.redis`: Redis tabanlı ilkel yapılar; Redis erişilemezken süreç içi yedeğe geçer (dakikada bir uyarı).
  `createCache({ namespace, ttlSec, memoryMax, memoryTtlSec })` (`get`/`set`/`del`/`getOrLoad`, single-flight), `acquireLock`/`withLock` (jetonlu, Lua ile güvenli
  bırakma/uzatma), `onceEvery(key, windowSec)`, `rateLimiter({ name, windowSec, max, key, skip })` (Express; `Retry-After` + `RateLimit-*`) ve
  `consume(name, identity, opts)`. `setRedisClient()`/`getRedisClient()`. Komutlar `sendCommand` ile; node-redis v4–v6 uyumlu.

### Değişenler

- `errorHandler` 500 hatalarını loglarken yöntem ve yolu da yazar.
- `util.redis.onceEvery(key, windowSec)`: `SET NX EX` yerine `SET NX PX`; kesirli saniyeler artık yuvarlanmadan uygulanır.

## [0.1.0] - 2026-09-24

[docs/YAPILACAKLAR.md](docs/YAPILACAKLAR.md) listesindeki tüm maddeler uygulandı.

### Kırıcı değişiklikler

- **Node.js ≥ 20** gerekir (Node 18 destek dışı; Prisma 7 de Node 20 ister).
- **Hata cevapları standart formatta:** `createExpressApp()`'in 404, 429 ve 500 cevapları artık `{ error, message, code, data, transaction }` biçiminde (`code`: `NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`). Eskiden `{ error: true, message }` / `{ error: "Too many requests..." }` idi.
- **Statik dosya servisi varsayılan olarak kapalı** (`staticDir` varsayılanı `"public"` idi, artık `false`). Dizin artık otomatik oluşturulmuyor. Açıksa router'lardan önce ve rate limit dışında sunulur.
- **Ortam değişkenleri config.jsonc'yi ezer.** Öncelik: `setConfig()` > env > config.jsonc > varsayılan. Env değerleri dosyaya yazılmaz. Postgres env adları artık standart `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`; tam liste README'de.
- `service.start()` servisleri **verilen sırayla** başlatır (eskiden iç sırayla) ve bilinmeyen adda hata fırlatır.
- `service.stopAll()` başlatılma sırasının **tersiyle, sırayla** kapatır ve hata olursa sonunda `AggregateError` fırlatır (eskiden paralel ve hataları yutuyordu).
- `service.mail.start()` SMTP doğrulaması başarısızsa hata fırlatır (eskiden sadece uyarıydı).
- `service.web.configure()` sunucu çalışırken çağrılırsa hata fırlatır.
- `AxiosService` hataları artık `Error`'dan türeyen `AxiosServiceError`. Eski alanlar (`error`, `inResponse`, `details`) korunuyor; `inResponse` artık gerçekten cevap gelip gelmediğini gösteriyor (ağ hatalarında `false`).
- `baseConfig` değişiklikleri: `database.mssql.user/password` varsayılanı `""` (eskiden `"sa"`/`"sa"`); `services.web.rateLimit.message` artık metin (eski obje biçimi hâlâ okunur); `services.web.secure.path` `"ssl"`, `certFile` `"origin.pem"`. Mevcut config.jsonc dosyalarındaki değerler etkilenmez.
- `PrismaService`: `disableAdapter: true` artık `datasourceUrl` eklemiyor (Prisma 7'de kaldırıldı); Prisma ≤ 6'da schema'daki `url` kullanılır.

### Eklenenler

- `service.bootstrap(names, options)`: sıralı açılış + hata durumunda temiz kapanış + `exit(1)`.
- `service.handleSignals(options)`: SIGTERM/SIGINT/uncaughtException/unhandledRejection'da zaman aşımlı düzgün kapanış.
- `util.http.ApiError`, `httpErrorCode`, `errorHandler`, `notFoundHandler`, `requestIdMiddleware`, `sendError`, `healthRouter()`.
- Her cevapta `X-Request-Id` başlığı; `transaction.request_id` her zaman dolu.
- `baseConfigEnv` ve `setDefaultConfig({ env })` seçeneği; `ConfigEnvMap` tipi.
- Yeni config alanları: `database.postgres.url`, `database.postgres.ssl`, `services.axios.userAgent`, `services.redis.connectRetries`, `services.web.bodyLimit`, `services.web.shutdownTimeoutMs`, `services.web.rateLimit.enabled`.
- `classes` (root'ta `services` alias'ı), `ServiceName`, `BootstrapOptions`, `ShutdownOptions` tipleri.
- `util.date.getLocalISO()` (ofsetli yerel ISO tarih).
- `BaseService.connect()`: tüm veritabanı servislerinde ortak bağlanma metodu.
- Otomatik testler (72 test; Redis/Postgres entegrasyonu dahil), ESLint, Prettier, GitHub Actions CI.

### Düzeltilenler

- Port doluyken `service.web.start()` sonsuza kadar asılı kalıyordu; artık reject oluyor.
- `service.web.stop()` keep-alive bağlantılar yüzünden bitmeyebiliyordu.
- `AxiosService`'e verilen `timeout` her zaman eziliyordu.
- `baseConfig` kullanılınca `DATABASE_TYPE`, `DATABASE_URL`, `MAIL_*` gibi ortam değişkenleri hiç okunmuyordu.
- config.jsonc'deki alanların sadece sırası farklıysa dosya yeniden yazılıp kullanıcı yorumları siliniyordu; eksik alan eklerken de tüm yorumlar gidiyordu. Artık sadece eksik alan ekleniyor.
- `setConfig(..., true)` env'den gelen şifreleri dosyaya yazabiliyordu; bozuk config dosyasının üzerine yazabiliyordu.
- `reload()` dosyadan silinen alanları varsayılana döndürmüyordu; `watch()` editörlerin atomic save'inde kopuyordu.
- Prisma `use()`/`register()` eski client'ı kapatmıyordu (bağlantı sızıntısı).
- Redis: bağlanamazken `start()` sonsuza kadar bekliyordu; `close()` yeniden bağlanmaya çalışan client'ı durdurmuyordu; paralel `connect()` hata veriyordu; log'da yanlış host (ve URL'deki şifre) görünüyordu.
- SSL dizini için mutlak yol verilemiyordu.
- `service.web.app` kendi oluşturduğu Express uygulamasını döndürmüyordu.
- ESM'de `import { RedisService } from "cagd-utilities/services"` çalışmıyordu.
- `clientPath` göreli yolları paketin dizinine göre çözülüyordu; artık çalışma dizinine göre.
- `cagd-log` artık import anında değil ilk log anında (ve önce tüketici projenin dizininden) yükleniyor. Not: cagd-log log satırındaki dosya adını kendisini ilk `require` eden modülden aldığı için bu, tüketicinin loglarında yanlış dosya adı görünme ihtimalini azaltır ama tamamen gidermez; kalıcı çözüm cagd-log tarafında (bkz. docs/YAPILACAKLAR.md).

### Kaldırılanlar

- `bun.lock` (paket yöneticisi: npm) ve `.npmignore` (`files` alanı yeterli).
