# cagd-utilities

API, Agent vb. projelerin **ortak** kullandığı yardımcı katman: config, veritabanı, web sunucusu, HTTP istemcisi, mail, redis, API cevap standardı ve uygulama yaşam döngüsü. Tek yerden güncellenir, hepsi `npm update cagd-utilities` ile aynı sürümü alır.

```ts
import { config, service, services, util } from "cagd-utilities";
```

## Hızlı bakış

| Namespace  | Alt yol                   | Ne verir?                                                                          |
| ---------- | ------------------------- | ---------------------------------------------------------------------------------- |
| `config`   | `cagd-utilities/config`   | `config.data` (değerler) + `config.manager` (yönetim)                              |
| `service`  | `cagd-utilities/service`  | **Hazır örnekler**: `service.prisma`, `service.web`, `service.redis`, `service.jobs`, `bootstrap`… |
| `services` | `cagd-utilities/services` | **Ham sınıflar**: `PrismaService`, `WebService`, … (root'ta `classes` adıyla da)   |
| `util`     | `cagd-utilities/util`     | `util.date`, `util.http` (cevap standardı, `ApiError`, `healthRouter`), `util.log` |

**`service` mi `services` (`classes`) mı?**

- `service` -> kurulmuş örnek verir. `start()` / `stop()` / `healthCheck()` hazır.
- `services` / `classes` -> sınıfı verir. Yaşam döngüsü sende. İki ad aynı şeyi gösterir; `classes` karışıklığı önlemek için eklendi.

---

## En kısa kullanım

```ts
// src/index.ts
import { config, baseConfig, baseConfigSchema, service, util } from "cagd-utilities";
import { PrismaClient } from "../prisma/generated/prisma/client";
import { userRouter } from "./routers";

export const cfg = config.manager.setDefaultConfig({ ...baseConfig, app: { name: "api" } }, { schema: baseConfigSchema });

service.prisma.use(PrismaClient);
service.web.configure({ routers: [["/api", userRouter], ["/api", util.http.healthRouter()]] });

// Sırayla başlatır; biri başlamazsa başlatılanları kapatır ve exit(1).
// SIGTERM/SIGINT ve beklenmeyen hatalarda ters sırayla düzgün kapatır.
void service.bootstrap(["prisma", "redis", "web"]);
```

Daha ayrıntılı, kopyalanmaya hazır örnek: [`examples/index.ts`](examples/index.ts) ve [`examples/cagd-utilities.d.ts`](examples/cagd-utilities.d.ts).

---

## Kurulum

```bash
npm i cagd-utilities
```

Gereksinimler: **Node.js ≥ 20**, TypeScript kullanıyorsan **TypeScript ≥ 5.4**.

Sadece **kullandığın** servisin paketini kur. Gerisi opsiyonel:

| Servis            | Kurman gereken paket(ler)                                             |
| ----------------- | --------------------------------------------------------------------- |
| Postgres          | `pg`                                                                  |
| MSSQL             | `mssql`                                                               |
| Prisma + Postgres | `@prisma/client` + `@prisma/adapter-pg` + `pg` (Prisma ≥ 6.10)        |
| Prisma + MSSQL    | `@prisma/client` + `@prisma/adapter-mssql` + `mssql` (Prisma ≥ 6.10)  |
| Redis             | `redis` (v4 ve v5 test edildi)                                        |
| Web               | `express` (v4 ve v5 test edildi) + `cors` + `helmet` + `express-rate-limit` |
| Axios             | `axios`                                                               |
| Mail              | `nodemailer`                                                          |
| Log (opsiyonel)   | `cagd-log` (yoksa `console` kullanılır)                               |

### Paket yoksa ne olur?

- Her sınıf kendi paketini **ihtiyaç anında** yükler. `import { service } from "cagd-utilities"` tek başına hiçbir opsiyonel paketi aramaz.
- `service.mssql`'e dokunmadıysan `mssql` kurulu olmak zorunda değil. Diğerleri de aynı.
- **Prisma** sadece seçili provider'ın adapter paketine bakar. Bulamazsa hangi paketleri kurman gerektiğini söyleyen net bir hata fırlatır. Adapter paketi bulunup constructor'ı başka bir sebeple patlarsa o hata **olduğu gibi** fırlatılır.
- `disableAdapter: true`: adapter aranmaz, client sadece `clientOptions` ile oluşturulur. Prisma ≤ 6'da bağlantı `schema.prisma`'daki `url` ile kurulur; **Prisma 7'de adapter zorunludur**, adapter'sız kullanım sadece `clientOptions: { accelerateUrl }` ile mümkündür.

### TypeScript notları

- Paketin `.d.ts` dosyaları kullandığın servislerin sürücü tiplerine (`pg`, `redis`, `mssql`, `express` …) referans verir. Kurmadığın bir sürücü için tip hatası almamak adına tüketici projede **`"skipLibCheck": true`** önerilir (TypeScript projelerinde zaten varsayılan şablondur).
- `res.success()` / `res.error()` tipleri için `@types/express` gerekir (Express 5 kendi tiplerini getirmez).
- `skipLibCheck: false` ile, gerekli paketler kuruluyken paketin tipleri hatasız derlenir (testlerde doğrulanır).

### ESM kullanımı

Paket CommonJS'tir; ESM'den sorunsuz import edilir:

```js
import { config, service, classes } from "cagd-utilities"; // önerilen: servis paketleri ihtiyaç anında yüklenir
import { RedisService } from "cagd-utilities/services"; // da çalışır
```

> Not: ESM'de `cagd-utilities/services` alt yolundan **named import** yapıldığında Node, o modüldeki tüm export'ları import anında okur; yani kurulu olan tüm servis dosyaları hemen yüklenir (kurulu olmayanlar hata vermez, `undefined` olur). Tembel yükleme istiyorsan root'tan `classes`/`services` kullan.

### Yerel geliştirme (`npm link`)

```bash
# utilities deposunda
npm run build && npm link
# api ve agent projelerinde
npm link cagd-utilities
```

`link` ile bağlıyken Node, paketin içinden yapılan `require()` çağrılarını paketin **gerçek dizininden** yukarı doğru arar. Bu yüzden:

- `@prisma/client`, `@prisma/adapter-*`, `cagd-log` ve `config.database.prisma.clientPath` **önce tüketici projenin dizininden** (`process.cwd()`) aranır; link ile de bulunur.
- `pg`, `mssql`, `redis`, `express` gibi sürücüler paketin kendi dosyalarından import edildiği için link ile geliştirirken bu deponun `devDependencies`'inde kurulu olmaları gerekir (öyleler). Registry'den kurulumda bu sorun yoktur.

---

## Klasör yapısı

```
src/
  config/            config.data + config.manager (config.jsonc + ortam değişkenleri)
  service/           HAZIR örnekler  -> service.prisma, service.web, bootstrap ...
  services/          HAM sınıflar
    database/          BaseService, MssqlService, PostgresService, PrismaService
    http/              AxiosService, WebService, createExpressApp
    Mail.Service.ts    MailService
    Redis.Service.ts   RedisService
  util/              date, logger, http (cevap standardı, ApiError, middleware'ler, healthRouter), list (liste sözleşmesi), redis (önbellek, kilit, onceEvery, rate limit)
examples/            tüketici projeye kopyalanacak örnek giriş noktası
test/                otomatik testler (node:test)
```

Kural: `Xxx.Service.ts` dosyası `XxxService` sınıfını export eder.

---

## 1) Config

### Varsayılanları tanımla (uygulama açılışında, EN BAŞTA)

```ts
// src/config.ts
import { config, baseConfig, baseConfigSchema } from "cagd-utilities";

export const defaultConfig = {
	...baseConfig, // database / services iskeleti ve TÜM varsayılan değerler
	app: { name: "api", version: 1 }, // kendi alanların
};

// Dönen değer TAM TİPLİ, canlı config proxy'sidir.
export const cfg = config.manager.setDefaultConfig(defaultConfig, {
	schema: baseConfigSchema, // config.jsonc yorum satırları
	useFile: true, // config.jsonc oku/oluştur (varsayılan: true)
	writeBack: true, // eksik alanları dosyaya ekle (varsayılan: true)
});

cfg.database.postgres.host; // string, IntelliSense çalışır
```

### Değerler nereden gelir? (öncelik sırası)

```
setConfig()  >  ortam değişkeni  >  config.jsonc  >  varsayılan (baseConfig / defaultConfig)
```

- **Tüm varsayılanlar tek yerde:** `baseConfig`. Servislerin içinde ayrıca varsayılan değer yoktur.
- **Ortam değişkenleri** config.jsonc'deki değeri ezer ve dosyaya **asla yazılmaz**. Şifreleri dosyaya değil env'e koy.
- `setDefaultConfig()` hiç çağrılmasa bile servisler `baseConfig` + ortam değişkenleri ile çalışır.

#### Ortam değişkenleri

| Değişken                                                          | Config alanı                                      |
| ----------------------------------------------------------------- | ------------------------------------------------- |
| `DATABASE_TYPE`                                                   | `database.provider` (`postgres` / `mssql`)        |
| `DATABASE_URL`                                                    | `database.postgres.url`                           |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`          | `database.postgres.*`                             |
| `MSSQL_HOST`, `MSSQL_PORT`, `MSSQL_USER`, `MSSQL_PASSWORD`, `MSSQL_DATABASE` | `database.mssql.*`                     |
| `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` | `services.redis.*`                            |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM` | `services.mail.*`            |
| `WEB_HOST`, `WEB_PORT`                                            | `services.web.host`, `services.web.port`          |

Değerler varsayılanın tipine dönüştürülür (`"8080"` → `8080`, `"true"`/`"1"` → `true`, `"a,b"` → `["a","b"]`). Geçersiz değer uyarıyla yok sayılır.

Kendi alanların için env eklemek ya da env'i kapatmak:

```ts
import { baseConfigEnv } from "cagd-utilities";

config.manager.setDefaultConfig(defaultConfig, { env: { ...baseConfigEnv, "app.name": "APP_NAME" } });
config.manager.setDefaultConfig(defaultConfig, { env: false }); // env okunmaz
```

### config.jsonc davranışı

- Dosya yoksa şemadaki açıklamalarla oluşturulur.
- Eksik alan varsa **sadece o alan** eklenir; senin yorumların, alan sıran ve değerlerin korunur. Alan sırası farklı diye dosyaya dokunulmaz.
- Dosya bozuksa (geçersiz JSONC) o çalıştırmada varsayılanlar kullanılır ve dosya **düzeltilene kadar üzerine yazılmaz**.
- `config.manager.watch()` dosyayı izler; editörlerin "atomic save" yöntemiyle kaydetmesi izlemeyi koparmaz. Dosyadan silinen alan varsayılana döner.

### Okuma / yazma

```ts
import { config } from "cagd-utilities";

config.data.services.web.port; // değerler
config.manager.setConfig({ dev: false }); // runtime güncelleme, reboot yok
config.manager.setConfig({ dev: false }, true); // true => config.jsonc dosyasına da yaz (yorumlar korunur)
```

`config.data` bir Proxy'dir: referansı hiç değişmez, her okumada güncel değeri verir.

> **İç içe nesneler:** `const web = config.data.services.web` gibi alt nesne referansı tutma; `setConfig()` sonrası eski kalır. Her seferinde `config.data.services.web.port` diye oku. Alt nesnelere doğrudan yazma (`config.data.services.web.port = 1`) değişiklik bildirimi (`onChange`) tetiklemez; güncelleme için `setConfig()` kullan.

> **Debug tuzağı:** `console.log(config.data)` Node'da `Proxy({})` gösterir. Gerçek veriyi görmek için `config.manager.getConfig()` ya da `JSON.stringify(config.data)` kullan.

> **Eski kısayol:** `config.services.web.port` hâlâ çalışır ama ileride kalkacak. Yeni kodda `config.data` kullan.

### `config.manager` API'si

| Metod                                  | Ne yapar?                                                               |
| -------------------------------------- | ----------------------------------------------------------------------- |
| `setDefaultConfig(defaults, options?)` | Varsayılanları tanımlar, dosyayı ve env'i okur, tipli proxy döner       |
| `setConfig(partial, persist?)`         | Derin merge ile günceller; `persist` ise dosyaya da yazar               |
| `getConfig()`                          | Anlık config'in düz kopyası                                             |
| `getDefaultConfig()`                   | Varsayılan objenin kopyası                                              |
| `resetConfig()`                        | `setConfig()` değişikliklerini siler (varsayılan + dosya + env'e döner) |
| `onChange(fn)`                         | Değişiklikleri dinler, `unsubscribe` döner                              |
| `path()`                               | `config.jsonc` tam yolu                                                 |
| `write()` / `reload()` / `watch()`     | Dosyaya yaz / yeniden oku / izle                                        |
| `instance`                             | Alt seviye `ConfigManager` örneği                                       |

### `config.data` tiplemesi

Tüketici projede tek `.d.ts` yeterli:

```ts
// src/types/cagd-utilities.d.ts
import type { defaultConfig } from "../config";

type DefaultConfigType = typeof defaultConfig;

declare module "cagd-utilities" {
	interface UtilitiesConfig extends DefaultConfigType {}
}
```

> `interface extends typeof defaultConfig {}` doğrudan yazılamaz (TS kısıtı). Önce type alias tanımla.

---

## 2) service — hazır servisler

Hepsi aynı arayüzü sunar: `start()` (başarısızsa hata fırlatır), `stop()` (idempotent), `healthCheck()` (asla fırlatmaz), `started`.

### Açılış ve kapanış

```ts
await service.bootstrap(["prisma", "redis", "web"]);
```

- Servisleri **verilen sırayla** başlatır. Web'i en sona koy: bağımlılıklar hazır olmadan istek kabul etmez.
- Biri başlamazsa: hatayı loglar, o ana kadar başlatılanları kapatır, `process.exit(1)` (process manager yeniden başlatabilsin). `{ exitOnError: false }` ile hata fırlatır.
- `SIGTERM`/`SIGINT` ve `uncaughtException`/`unhandledRejection`'da servisleri **başlatılma sırasının tersiyle** kapatır; kapanış `timeoutMs` (15 sn) içinde bitmezse süreci zorla sonlandırır.

```ts
await service.bootstrap(["prisma", "web"], {
	signals: { timeoutMs: 20000, onShutdown: reason => queue.stop() },
});
```

Ayrı ayrı da kullanılabilir:

```ts
await service.start("prisma", "redis", "web"); // verilen sırayla; bilinmeyen ad -> hata
await service.healthCheckAll(); // { prisma: true, redis: true, web: true }
await service.stopAll(); // ters sırayla; hata olursa diğerlerini yine kapatır, sonunda AggregateError
service.handleSignals({ timeoutMs: 10000 }); // sadece kapanış yönetimi
```

### Prisma

Generated `PrismaClient` senin projede üretildiği için dışarıdan verilir. Böylece tipler korunur.

```ts
import { service } from "cagd-utilities";
import { PrismaClient } from "../prisma/generated/prisma/client";

const prisma = service.prisma.use(PrismaClient); // tipli definer
await prisma.start();

await prisma.client.user.findMany(); // tam tipli
```

- Provider: `config.data.database.provider` (`"postgres"` | `"mssql"`, env: `DATABASE_TYPE`).
- Adapter otomatik seçilir (`@prisma/adapter-pg` / `@prisma/adapter-mssql`), bağlantı ayarları config'ten okunur.
- `use()` tekrar çağrılırsa eski client'ın bağlantısı kapatılır.
- **Tek dosyalık derleme** (`bun build --compile` vb.): adapter paketi dinamik `require` ile arandığı için pakete gömülmez. Adapter'ı uygulamada
  statik import edip `adapterFactory` ile verin; bağlantı ayarları yine config'ten gelir:
  `service.prisma.use(PrismaClient, { adapterFactory: ({ poolConfig }) => new PrismaMssql(poolConfig) })`. Aynı nedenle `cagd-log` için
  `util.setLogger(log)` çağırın (logger da dinamik yüklenir).
- `use()` çağırmazsan client, `config.data.database.prisma.clientPath` (varsayılan `@prisma/client`, göreli yollar çalışma dizinine göre) üzerinden yüklenir.
- `service.database`, `service.prisma` için alias'tır.

> **Autocomplete:** `service.prisma.use(PrismaClient)`'ın dönüşünü yakalamadan `service.prisma.client` kullanmak istiyorsan bir kere `declare module` ile doldur:
>
> ```ts
> // src/types/cagd-utilities.d.ts
> import type { PrismaClient } from "../prisma/generated/prisma/client";
>
> declare module "cagd-utilities" {
> 	interface RegisteredPrismaClient extends PrismaClient {}
> }
> ```

### Web

```ts
import { service, util } from "cagd-utilities";

service.web.configure({ routers: [["/api", r_main], ["/api", util.http.healthRouter()]] });
await service.web.start();
service.web.app; // Express uygulaması
service.web.server; // http/https Server
await service.web.stop();
```

- Port doluysa `start()` anlaşılır bir hatayla **reject olur** (asılı kalmaz).
- `stop()` yeni bağlantı kabulünü durdurur, boştaki keep-alive bağlantıları kapatır, süren istekleri `services.web.shutdownTimeoutMs` kadar bekler.
- Çalışırken `configure()` çağrılamaz; önce `stop()`.

`createExpressApp()` şunları kurar (sırasıyla): request id → `res.success/res.error` → helmet → cors → (varsa) statik dosyalar → rate limit → body parser'lar (`services.web.bodyLimit`) → router'lar → 404 → hata handler'ı.

**Tüm cevaplar aynı formattadır** — 404, 429, bozuk JSON (400), büyük gövde (413) ve 500 dahil:

```json
{ "error": true, "message": "Not Found", "code": "NOT_FOUND", "data": null, "transaction": { "date": "…Z", "duration_ms": 1, "request_id": "…" } }
```

Router'larda:

```ts
const { ApiError } = util.http;

res.success({ data: user, message: "Kullanıcı bulundu" });
res.error({ message: "Bulunamadı", code: "NOT_FOUND" }, 404);

throw ApiError.notFound("Kullanıcı bulunamadı"); // Express 4'te async handler içinde: next(err)
throw new ApiError("Geçersiz e-posta", 422, "INVALID_EMAIL", { field: "email" });
```

- Beklenmeyen hatalarda (500) iç hata mesajı dışarı sızdırılmaz, loglanır.
- Her cevapta `X-Request-Id` başlığı vardır (istekte güvenli bir değer geldiyse o kullanılır, yoksa UUID üretilir).
- Statik dosya servisi varsayılan olarak **kapalıdır**: `staticDir: "public"` ver (dizin otomatik oluşturulmaz).
- Varsayılan CORS `origin: "*"`'dır; üretimde kendi alan adlarını yaz.

### Diğerleri

```ts
await service.redis.start(); // ilk bağlantıda services.redis.connectRetries denemeden sonra hata verir
await service.redis.instance.setJSON("user:1", { id: 1 }, 60);

await service.postgres.start();
await service.postgres.instance.query("SELECT * FROM users WHERE id = $1", [5]);

await service.mssql.instance.query("SELECT * FROM users WHERE id = @param0", [5]);

await service.mail.start(); // SMTP doğrulaması; başarısızsa hata fırlatır
await service.mail.send({ to: "a@b.com", subject: "Selam", text: "..." });
```

---

## 3) services / classes — ham sınıflar

Singleton'ı kendin yönetmek istediğinde:

```ts
import { classes } from "cagd-utilities"; // = services

const redis = classes.RedisService.getInstance();
const http = new classes.AxiosService({ name: "Gateway", instance: { baseURL: "https://api.example.com", timeout: 5000 } });

try {
	const res = await http.request({ url: "/ping" });
} catch (err) {
	if (err instanceof classes.AxiosServiceError) console.log(err.status, err.code, err.inResponse, err.details.response?.data);
}

await classes.PostgresService.getInstance().transaction(async client => {
	/* BEGIN / COMMIT / ROLLBACK otomatik */
});
```

- `AxiosService`: `timeout` varsayılanı `services.axios.timeout`; istemci bazında `instance.timeout` ile ezilebilir. Hatalar gerçek `Error` olan `AxiosServiceError` olarak fırlatılır. `services.axios.userAgent`: `false` → başlık gönderilmez, metin → o değer.

| Sınıf                                                                  | Klasör               |
| ---------------------------------------------------------------------- | -------------------- |
| `BaseService`, `MssqlService`, `PostgresService`, `PrismaService`      | `services/database/` |
| `AxiosService`, `AxiosServiceError`, `AxiosAgent`, `WebService`, `createExpressApp` | `services/http/` |
| `MailService`, `RedisService`                                          | `services/`          |

### Yeni DB türü eklemek

1. `src/services/database/_template.Service.ts` dosyasını kopyala -> `Xxx.Service.ts`.
2. `BaseService`'i extend et. Zorunlu: `connect`, `query`, `queryWithMeta`, `healthCheck`, `close`, `getPoolConfig`.
3. Varsayılanları `config/base-config.ts`'e ekle; `services/index.ts` ve `service/index.ts` içine kaydet (şablonda adımlar var).

---

## 4) util

```ts
import { util } from "cagd-utilities";

util.date.getLocalISO(); // "2026-09-24T11:30:00.000+03:00" (ofsetli yerel saat)
util.date.getLocalDay(); // "2026-09-24"
util.log.info("mesaj"); // cagd-log varsa onu kullanır
util.setLogger({ info: myLogger.info }); // kendi logger'ın
util.http.successResponse({ data }); // API cevap standardı
util.http.ApiError; // standart hata sınıfı
util.http.healthRouter(); // GET /health
util.http.requestIdMiddleware / errorHandler / notFoundHandler; // kendi Express uygulaman için
util.http.createRequestIdMiddleware({ trustIncoming: req => !!req.gateway }); // gelen X-Request-Id'ye koşullu güven
util.http.validate(schema, value); // safeParse + hata ise 400 INVALID_INPUT ApiError
util.http.getClientIp(req, { trustedForwardHeader: req => !!req.gateway }); // varsayılan: soket adresi
```

**Hata eşlemesi (`errorHandler`):** `ApiError` → kendi status/code'u · `ZodError` (duck typing, zod import edilmez) → `400 INVALID_INPUT`,
mesaj `issues[0].message`, `data: { path }` · Prisma `P2002` → `409 CONFLICT`, `P2025` → `404 NOT_FOUND` · diğer her şey → `500 INTERNAL_ERROR`
(iç mesaj sızdırılmaz, loglanır). Aynı eşleme `util.http.toApiError(err)` ile kendi handler'ında da kullanılabilir.

**İstemci IP (`getClientIp`):** başlıklara varsayılan olarak **güvenilmez**; `X-Forwarded-For`'un ilk değeri yalnızca `trustedForwardHeader(req)`
`true` dönerse kullanılır (ör. kimliği doğrulanmış bir ağ geçidi). `trustProxy: true` Express'in `req.ip`'sini kullanır. `::ffff:` öneki kırpılır.

### Liste sözleşmesi (`util.list`)

Tüm liste uçları aynı sözleşmeyi kullanır:

```
İstek: limit (1-100, vars. 20) · cursor XOR page (1'den başlar) · sort · order (asc|desc) · q (1-200) · + uca özel filtreler
Cevap: { items, nextCursor, hasMore, limit, page?, total?, totalPages? }   // page/total/totalPages yalnızca page modunda
```

- `cursor` opak bir **keyset** işaretçisidir (base64url JSON: son satırın sıralama değeri + kimliği + sort/order + filtre özeti).
  Eşit sıralama değerlerinde `Id` ikincil anahtardır; sayfalar arasında atlama/tekrar olmaz. Sıralama, yön ya da filtreler değişince eski cursor
  `400 INVALID_INPUT` ("Invalid cursor") ile reddedilir. `Date`, `bigint` ve Decimal değerleri kayıpsız taşınır.
- `nextCursor` her iki modda da döner; `null` ise liste bitmiştir.
- Kütüphane zod'a ve Prisma'ya **bağımlı değildir**: zod örneği parametre olarak verilir, Prisma yardımcıları düz nesne üretir.

Express + Prisma örneği:

```ts
import { z } from "zod";
import { util } from "cagd-utilities";

const listSchema = util.list.createListQuerySchema(z, {
	sorts: ["createdAt", "name"],
	defaultSort: "createdAt",
	defaultOrder: "desc",
	filters: { isEnabled: util.list.booleanQuery(z).optional() },
});
const SORT_FIELDS = { createdAt: "CreatedAt", name: "Name" } as const;

router.get("/items", async (req, res) => {
	const query = listSchema.parse(req.query); // ZodError → errorHandler → 400 INVALID_INPUT
	const where = {
		...(query.isEnabled !== undefined && { IsEnabled: query.isEnabled }),
		...(query.q && { OR: [{ Name: { contains: query.q } }] }),
	};
	const page = await util.list.paginate(query, {
		field: SORT_FIELDS[query.sort],
		findMany: args => prisma.items.findMany({ ...args, where: { AND: [where, args.where ?? {}] } }),
		count: () => prisma.items.count({ where }),
		map: row => ({ Id: row.Id, Name: row.Name }),
	});
	res.success({ data: page });
});
```

Daha alt seviye yapı taşları: `encodeCursor` / `decodeCursor(raw, { sort, order, filtersHash })`, `filtersHash(query)`,
`keysetWhere({ field, idField, order, cursor, nullable, nulls })`, `orderBy({ field, idField, order })`, `pageArgs({ page, limit })`,
`buildPage({ rows, limit, mode, sort, order, getCursorValue, total })`. NULL olabilen sıralama alanlarında `nullable: true` verin;
`nulls` NULL'ın sıralamadaki yeridir: `"low"` (vars.; SQL Server/MySQL/SQLite) ya da `"high"` (PostgreSQL).

### Redis ilkel yapıları (`util.redis`)

Ortak ilke: **Redis erişilemezken istek düşmez.** Her yapı süreç içi bir yedeğe geçer ve dakikada en fazla bir kez `log.warn` yazar.
Varsayılan client `service.redis`'tir; yalnızca bağlıysa kullanılır (burada bağlantı açılmaz). Komutlar ham `sendCommand` ile gönderilir,
node-redis v4/v5/v6 ile çalışır. Farklı bir client için `util.redis.setRedisClient(client)` (`null` → her zaman süreç içi).

```ts
import { util } from "cagd-utilities";

// Önbellek: JSON, anahtar `namespace:key`; `null` da önbelleğe alınabilir (yok = undefined).
const perms = util.redis.createCache({ namespace: "perm:global", ttlSec: 60 });
const list = await perms.getOrLoad(userId, () => loadFromDb(userId)); // aynı anahtar için eşzamanlı yükleme tekilleştirilir
await perms.del(userId); // izin değişince geçersiz kıl
await perms.clear(); // namespace'in tamamı (SCAN + DEL; yönetimden "önbelleği boşalt" için)

// Dağıtık kilit: SET NX PX + rastgele jeton; bırakma/uzatma yalnızca jeton eşleşirse (Lua).
const lock = await util.redis.acquireLock("jobs:cleanup", { ttlMs: 30_000, waitMs: 0 });
if (lock) try { await work(); await lock.extend(30_000); } finally { await lock.release(); }
await util.redis.withLock("jobs:cleanup", { ttlMs: 30_000 }, async () => work()); // -> { acquired, result }

// Pencerede bir kez: LastSeenAt'i dakikada bir yaz. Pencere kesirli saniye olabilir (SET NX PX).
if (await util.redis.onceEvery(`gateway:lastseen:${id}`, 60)) await touchLastSeen(id);

// Rate limit (sabit pencere, INCR + PEXPIRE atomik). Aşımda ApiError(429, "RATE_LIMITED") + Retry-After, RateLimit-* başlıkları.
router.post("/login", util.redis.rateLimiter({ name: "auth:login", windowSec: 900, max: 20, key: req => util.http.getClientIp(req), skip: () => isTest }), handler);
const r = await util.redis.consume("carts:create", userId, { windowSec: 3600, max: 10 }); // { allowed, remaining, resetSec, retryAfterSec }
```

- Rate limit hiçbir başlık/gövde loglamaz; kimlik Redis anahtarında da sha256 özeti olarak tutulur. Test ortamında atlamak uygulamanın kararıdır (`skip`).
- Süreç içi yedek yalnızca Redis erişilemezken yazılanları tutar. Kesinti sırasında yapılan `del()` Redis'e ulaşmaz; Redis dönünce eski değer TTL bitene
  kadar görülebilir. Güvenlikle ilgili önbelleklerde (izin, oturum durumu) **kısa TTL** kullanın;
  `memoryTtlSec` süreç içi yedekteki süreyi ayrıca sınırlar (çok kopyalı kurulumda diğer kopyaların `del()`'i bu belleğe ulaşmaz). Süreç içi kilit tek kopya varsayar.

**Tarih standardı:** makineler arası zaman damgaları (API cevabındaki `transaction.date`, loglar) UTC ISO 8601'dir (`…Z`). Yerel saat gerekiyorsa `getLocalISO()` (ofsetli). `getLocalDate()` ofset içermez; sadece gösterim içindir.

---

## Geliştirme

```bash
npm run lint           # ESLint
npm run format         # Prettier
npm test               # build + tüm testler (node:test)
npm run check          # lint + format kontrolü + test

# Redis/Postgres entegrasyon testleri (tanımlı değilse atlanır):
TEST_REDIS_URL=redis://127.0.0.1:6379 TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/db npm test
```

CI (GitHub Actions) her push/PR'da Node 20/22/24 üzerinde Redis ve Postgres servisleriyle birlikte tüm kontrolleri çalıştırır.

## Sürüm akışı

1. Değişiklik yap, [CHANGELOG.md](CHANGELOG.md)'ye yaz.
2. `npm run check`.
3. `npm pack --dry-run` ile pakete ne gireceğine bak.
4. `npm version patch|minor|major` -> `npm publish` (`prepublishOnly` tüm kontrolleri tekrar çalıştırır).
5. `api` ve `agent` projelerinde `npm update cagd-utilities`.

0.x sürümlerinde kırıcı değişiklikler **minor** artışla (0.1 → 0.2) yapılır ve CHANGELOG'da "Kırıcı" başlığı altında belirtilir.

---

## Lisans

MIT
