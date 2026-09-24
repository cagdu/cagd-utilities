# cagd-utilities — Kod İncelemesi

> İnceleme tarihi: 2026-09-24 · Sürüm: `0.0.4` (commit `85524a8`)
> Yapılacaklar listesi: [YAPILACAKLAR.md](./YAPILACAKLAR.md)
>
> **Not (0.1.0):** Bu belge `0.0.4` sürümünün anlık incelemesidir; buradaki bulguların tamamı `0.1.0`'da
> giderildi (bkz. YAPILACAKLAR.md ve CHANGELOG.md). Bulgu #7'nin teşhisi sonradan düzeltildi: asıl sebep
> bu paketteki sarmalayıcı değil, `cagd-log`'un dosya adını `module.parent`'tan almasıdır.

Paketin amacı: birden fazla projede (api, agent vb.) tekrar eden **config, veritabanı, web sunucusu,
HTTP istemcisi, mail, redis ve API cevap formatı** kodunu tek yerden yönetmek.

---

## 1. Kod nasıl çalışıyor?

### 1.1 Katmanlar

```
src/index.ts            -> config, service, services, util, log, baseConfig, baseConfigSchema
│
├── config/             TEK bir modül-seviyesi ConfigManager (singleton)
│   ├── manager.ts        current/defaults tutar, config.jsonc okur/yazar, onChange yayar
│   ├── index.ts          `config` facade'i (Proxy): .data, .manager + eski kısayol erişimi
│   ├── base-config.ts    paketin kendi servislerinin ihtiyaç duyduğu iskelet + açıklama şeması
│   ├── deep-merge.ts     defaults iskeletini koruyan derin birleştirme
│   └── jsonc-writer.ts   config + şema -> yorumlu JSONC metni
│
├── services/           HAM sınıflar (her biri kendi static singleton'ını yönetir)
│   ├── index.ts          sınıfları `Object.defineProperty(exports, ...)` ile LAZY getter olarak açar
│   ├── database/         BaseService (soyut sözleşme), Postgres, Mssql, Prisma
│   ├── http/             AxiosService, createExpressApp, WebService
│   └── Mail / Redis
│
├── service/            HAZIR örnekler ("definer"lar): start/stop/healthCheck/started
│   └── index.ts          prisma, web, redis, postgres, mssql, mail + start/stopAll/healthCheckAll
│
└── util/               date, logger (cagd-log varsa o, yoksa console), http (Response standardı)
```

### 1.2 Açılış akışı (tüketici projede)

1. `config.manager.setDefaultConfig(defaultConfig, { schema })`
   → `defaults` klonlanır → `config.jsonc` okunur (yoksa oluşturulur) → `deepMerge` → `current`.
   Dönen değer bir **Proxy**: referans sabit, her okumada `current`'ın güncel halini verir.
2. `service.prisma.use(PrismaClient)` → `PrismaService.register()` generated client sınıfını kaydeder.
3. `service.start("prisma", "redis", "web")` → her definer'ın `start()`'ı çağrılır.
   - Servis dosyaları ancak bu noktada `require()` edilir; böylece kurulu olmayan opsiyonel
     paketler (mssql, pg, redis...) sadece import edildiğinde hata vermez.
   - Her servis ayarlarını `config.services.*` / `config.database.*`'dan, bulamazsa `process.env`'den,
     o da yoksa **kendi içindeki sabit değerlerden** okur.
4. Kapanışta `service.stopAll()` sadece `started === true` olanları kapatır.

### 1.3 Güçlü yanlar

- **Lazy yükleme** fikri doğru: tek paket, her projede sadece kullanılan sürücüler kurulur.
- **Declaration merging** ile (`UtilitiesConfig`, `RegisteredPrismaClient`) tüketici tipleri pakete taşınabiliyor.
- **Config.jsonc + şema yorumları**: sahada config dosyasını okunur kılıyor; bozuk JSONC dosyanın
  üzerine yazılmıyor (sadece o çalıştırma için varsayılana düşülüyor) — iyi karar.
- `service` katmanının ortak arayüzü (`start/stop/healthCheck/started`) doğru soyutlama.
- Prisma adapter hatalarını "paket yok" ile "paket var ama kurulamadı" diye ayırması düşünülmüş.
- Derleme (`tsc`, `strict: true`) hatasız geçiyor.

---

## 2. Doğrulanmış bulgular (çalıştırılarak test edildi)

Aşağıdakiler `dist/` üzerinde küçük betiklerle **gerçekten çalıştırılıp** doğrulandı:

| # | Bulgu | Gözlenen |
|---|---|---|
| 1 | `service.start("redis","web","prisma")` argüman sırasını değil, iç `all` dizisinin sırasını kullanıyor | Çalışma sırası: `prisma, web, redis`. Örnek projedeki `start("prisma","redis","web")` çağrısında **web, redis'ten önce** trafik almaya başlıyor. |
| 2 | Port doluyken `service.web.start()` hiç dönmüyor | `EADDRINUSE` loglanıyor ama Promise ne resolve ne reject oluyor → açılış sonsuza kadar asılı kalıyor, process manager restart edemiyor. |
| 3 | `new AxiosService({ instance: { timeout: 12345 } })` | Gerçek timeout `3000` (config yüklüyse `60000`). Kullanıcının verdiği timeout **her zaman ezilir**. |
| 4 | `DATABASE_TYPE=mssql` + `baseConfig` | `PrismaService.getProvider()` → `"postgres"`. baseConfig her alanı doldurduğu için env fallback'leri ölü kod. |
| 5 | `DATABASE_URL` tanımlı + `baseConfig` | Postgres pool config'i `host: "localhost", user: ""` — `DATABASE_URL` yok sayılıyor. |
| 6 | `config.jsonc` içinde alanlar sadece **farklı sırada** | "missing some fields" uyarısı veriliyor ve dosya **yeniden yazılıyor**; kullanıcının kendi yorumları siliniyor. |
| 7 | `cagd-log` kurulu iken her log satırı | Kaynak dosya hep `dist/util/logger.js` görünüyor → cagd-log'un "hangi dosyadan loglandı" bilgisi kayboluyor. _(Sonradan düzeltilen teşhis: cagd-log dosya adını kendisini ilk `require` eden modülden alıyor.)_ |
| 8 | Native ESM: `import { RedisService } from "cagd-utilities/services"` | `SyntaxError: Named export 'RedisService' not found`. Lazy getter'lar cjs-module-lexer tarafından görülmüyor. (`import { services } from "cagd-utilities"` çalışıyor.) |
| 9 | `dist/**/*.d.ts` | `mssql`, `redis`, `express`, `pg`, `nodemailer`, `axios` tiplerini import ediyor → bu paketleri kurmamış ve `skipLibCheck: false` olan tüketicide tip hatası. |

---

## 3. Genel değerlendirme

**Mimari doğru yönde**, ancak paketin asıl vaadi olan *"tek yerden kontrol"* şu an üç yerde zayıflıyor:

1. **Varsayılan değerler üç yerde tekrar ediyor ve birbirini tutmuyor.**
   `base-config.ts`, her servisin içindeki `?? "..."` fallback'leri ve README. Örnek:

   | Ayar | baseConfig | Servis içi fallback |
   |---|---|---|
   | `services.axios.timeout` | 60000 | 3000 |
   | `services.web.rateLimit.limit` | 20 | 100 |
   | `database.postgres.user` | `""` | `"postgres"` |
   | `database.mssql.database` | `""` | `"master"` |

   Hangi değerin geçerli olduğu `setDefaultConfig`'in çağrılıp çağrılmadığına bağlı.

2. **Öncelik kuralı (env ↔ config.jsonc ↔ varsayılan) tanımsız.** Her servis farklı operatör
   (`??` / `||`) ve farklı sıra kullanıyor; baseConfig kullanılınca env değişkenleri hiç devreye girmiyor.
   Docker/CI ortamlarında gizli bilgileri env ile vermek şu an mümkün değil.

3. **Cevap formatı standardı paketin kendi içinde uygulanmıyor.** `util/http/Response.ts`
   `{ error, message, code, data, transaction }` standardını tanımlıyor ama `createExpressApp`'in
   404, 500 ve rate-limit cevapları farklı şekilde dönüyor. Her proje bunu tekrar düzeltmek zorunda kalır.

Bunlara ek olarak: **hiç otomatik test yok** (`test/` klasörü aslında bir örnek), yaşam döngüsü
(start/stop sırası, yeniden yapılandırma, kapanış) kenar durumlarında hatalı, ve tip güvenliği
servis katmanında `(config as any)` ile kapatılmış.

Detaylı, öncelikli ve dosya/satır referanslı liste: **[YAPILACAKLAR.md](./YAPILACAKLAR.md)**
