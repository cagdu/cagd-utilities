# cagd-utilities

Used AI to create.

API, Agent vb. projelerin **ortak** kullandığı yardımcı katman. Tek yerden güncellenir, hepsi `npm update cagd-utilities` ile aynı sürümü alır.

```ts
import { config, service, services, util } from "cagd-utilities";
```

## Hızlı bakış

| Namespace | Alt yol | Ne verir? |
| --- | --- | --- |
| `config` | `cagd-utilities/config` | `config.data` (değerler) + `config.manager` (yönetim) |
| `service` | `cagd-utilities/service` | **Hazır örnekler**: `service.prisma`, `service.web`, `service.redis`... |
| `services` | `cagd-utilities/services` | **Ham sınıflar**: `PrismaService`, `WebService`, `MssqlService`... |
| `util` | `cagd-utilities/util` | `util.date`, `util.http`, `util.log` |

**`service` mi `services` mi?**
- `service` -> kurulmuş örnek verir. `start()` / `stop()` / `healthCheck()` hazır.
- `services` -> sınıfı verir. Yaşam döngüsü sende.

---

## Kurulum

```bash
npm i cagd-utilities
```

Sadece **kullandığın** servisin paketini kur. Gerisi opsiyonel:

| Servis | Kurman gereken paket(ler) |
| --- | --- |
| Postgres | `pg` |
| MSSQL | `mssql` |
| Prisma + Postgres | `@prisma/adapter-pg` + `pg` |
| Prisma + MSSQL | `@prisma/adapter-mssql` + `mssql` |
| Redis | `redis` |
| Web | `express` + `cors` + `helmet` + `express-rate-limit` |
| Axios | `axios` |
| Mail | `nodemailer` |
| Log (opsiyonel) | `cagd-log` (yoksa `console` kullanılır) |

### Paket yoksa ne olur?

- Her sınıf kendi paketini **ihtiyaç anında** yükler.
- `import { service } from "cagd-utilities"` tek başına hiçbir opsiyonel paketi aramaz.
- `service.mssql`'e dokunmadıysan `mssql` kurulu olmak zorunda değil. Diğerleri de aynı.
- **Prisma** sadece seçili provider'ın paketine bakar:
  - `provider: "mssql"` -> `pg` hiç aranmaz.
  - `provider: "postgres"` -> `mssql` hiç aranmaz.
  - Adapter paketi (`disableAdapter: true` verilmediyse) `require()` ile bulunamazsa, hangi paketleri (`@prisma/adapter-mssql`/`@prisma/adapter-pg` + `mssql`/`pg`) kurman gerektiğini söyleyen net bir hata fırlatır — Prisma'nın derin ve okunması zor "Unknown property" hatasına düşmeden.
  - Bu hatayı paketler KURULU olmasına rağmen görüyorsan sebep "paket eksik" değildir: `require()` başka bir yerde (yanlış path, monorepo hoisting, bun/pnpm çözümleme farkı vb.) başarısız oluyordur. Adapter paketi bulunup da constructor'ı başka bir sebeple patlarsa (örn. yanlış config şekli) o hata OLDUĞU GİBİ fırlatılır, "paket bulunamadı" mesajıyla ÖRTÜLMEZ.
  - `disableAdapter: true` verirsen adapter hiç aranmaz, `DATABASE_URL` üzerinden (klasik/engine tabanlı generated client'larda) bağlanılır.

### Yerel geliştirme

```bash
# utilities deposunda
npm run build && npm link
# api ve agent projelerinde
npm link cagd-utilities
```

> **`npm link`/`bun link` + opsiyonel paket tuzağı:** `link` bir symlink oluşturur; Node/Bun
> `require()` çağrısını, requiring dosyanın **gerçek (symlink çözülmüş) yolundan** yukarı doğru
> arar — tüketici projenin `node_modules`'ına DEĞİL. Yani `service.prisma` (mssql/postgres adapter'ı
> lazy require eden kod) tüketici projede `link` ile bağlıysa, `@prisma/adapter-mssql` tüketici
> projede kurulu olsa bile "Cannot find module" hatası alırsın — çünkü arama bu deponun
> (`cagd-utilities`) kendi dizininden yukarı doğru yapılır, tüketicinin `node_modules`'ından değil.
> Bu yüzden bu depo, `mssql`/`pg`/`redis`/`express` gibi opsiyonel paketleri (ve artık
> `@prisma/client` + `@prisma/adapter-mssql` + `@prisma/adapter-pg`'yi) **kendi `devDependencies`'inde**
> de tutuyor — `link` ile geliştirirken bu hatayı yaşamamak için. Gerçek (registry) `npm install`
> ile kurulumda bu sorun hiç yaşanmaz (paket tüketicinin `node_modules`'ının içinde yer aldığı için
> yukarı arama zaten oraya çıkar).

---

## Klasör yapısı

```
src/
  config/            config.data + config.manager (config.jsonc yönetimi)
  service/           HAZIR örnekler  -> service.prisma, service.web ...
  services/          HAM sınıflar
    database/          BaseService, MssqlService, PostgresService, PrismaService
    http/              AxiosService, WebService, createExpressApp
    Mail.Service.ts    MailService
    Redis.Service.ts   RedisService
  util/              date, logger, http (API cevap standardı)
```

Kural: `Xxx.Service.ts` dosyası `XxxService` sınıfını export eder.

---

## 1) Config

### Varsayılanları tanımla (uygulama açılışında, EN BAŞTA)

```ts
// src/config.ts
import { config, baseConfig, baseConfigSchema } from "cagd-utilities";

export const defaultConfig = {
    ...baseConfig,                    // database / services iskeleti
    app: { name: "api", version: 1 }, // kendi alanların
};

// Dönen değer TAM TİPLİ, canlı config proxy'sidir.
export const cfg = config.manager.setDefaultConfig(defaultConfig, {
    schema: baseConfigSchema, // config.jsonc yorum satırları
    useFile: true,            // config.jsonc oku/oluştur (varsayılan: true)
    writeBack: true,          // eksik alanları dosyaya geri yaz
});

cfg.database.postgres.host; // string, IntelliSense çalışır
```

### Okuma / yazma

```ts
import { config } from "cagd-utilities";

config.data.services.web.port;                  // değerler
config.manager.setConfig({ dev: false });       // runtime güncelleme, reboot yok
config.manager.setConfig({ dev: false }, true); // true => config.jsonc dosyasına da yaz
```

`config.data` bir Proxy'dir: referansı hiç değişmez, her okumada güncel değeri verir.

> **Debug tuzağı:** `console.log(config.data)` / `console.dir(config.data)` her zaman `Proxy({})` gösterir — Node, Proxy'leri basarken varsayılan olarak (`showProxy: false`) trap'leri hiç çalıştırmadan iç `target`'ı basar, bu kütüphaneden bağımsız bir Node davranışıdır. Gerçek veriyi görmek için `config.manager.getConfig()`, `JSON.stringify(config.data)` veya `console.log(config.data.somePath)` kullan.

> **Eski kısayol:** `config.services.web.port` hâlâ çalışır ama ileride kalkacak. Yeni kodda `config.data` kullan.

### `config.manager` API'si

| Metod | Ne yapar? |
| --- | --- |
| `setDefaultConfig(defaults, options?)` | Varsayılanları tanımlar, tipli proxy döner |
| `setConfig(partial, persist?)` | Derin merge ile günceller |
| `getConfig()` | Anlık config'in düz kopyası |
| `getDefaultConfig()` | Varsayılan objenin kopyası |
| `resetConfig()` | Varsayılanlara (ve dosyaya) döner |
| `onChange(fn)` | Değişiklikleri dinler, `unsubscribe` döner |
| `path()` | `config.jsonc` tam yolu |
| `write()` / `reload()` / `watch()` | Dosyaya yaz / yeniden oku / izle |
| `instance` | Alt seviye `ConfigManager` örneği |

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

Hepsi aynı arayüzü sunar: `start()`, `stop()`, `healthCheck()`, `started`.

### Prisma

Generated `PrismaClient` senin projede üretildiği için dışarıdan verilir. Böylece tipler korunur.

```ts
import { service } from "cagd-utilities";
import { PrismaClient } from "../prisma/generated/prisma/client";

const prisma = service.prisma.use(PrismaClient); // tipli definer
await prisma.start();

await prisma.client.user.findMany();   // tam tipli
await prisma.healthCheck();
await prisma.stop();
```

- Provider: `config.data.database.provider` (`"postgres"` | `"mssql"`) ya da `process.env.DATABASE_TYPE`.
- Adapter otomatik seçilir (`@prisma/adapter-pg` / `@prisma/adapter-mssql`), bağlantı ayarları config'ten okunur.
- `use()` çağırmazsan client, `config.data.database.prisma.clientPath` (varsayılan `@prisma/client`) üzerinden yüklenir.
- `service.database`, `service.prisma` için alias'tır.

> **Autocomplete tuzağı:** `service.prisma.use(PrismaClient)` çağrısının dönüşünü yakalamadan
> (`service.prisma.use(PrismaClient);` gibi tek satır bırakırsan) `service.prisma.client` varsayılan
> olarak boş bir tip (`RegisteredPrismaClient`) verir ve VS Code'da `.client.` sonrası autocomplete
> gelmez — `use<T>()` her çağrıda YENİ bir `PrismaDefiner<T>` döner ama `service.prisma` export'unun
> statik tipi bundan etkilenmez (TypeScript'in çalışma zamanı yan etkileriyle tip değiştirememesi).
> İki çözüm var:
>
> ```ts
> // 1) .use() dönüşünü yakala (yerelde tipli definer)
> const prisma = service.prisma.use(PrismaClient);
> await prisma.client.user.findMany();
> ```
>
> ```ts
> // 2) declare module ile bir kere doldur, sonrasında service.prisma.client
> //    HER YERDE (yakalamadan) tam tipli olur — UtilitiesConfig ile aynı desen.
> // src/types/cagd-utilities.d.ts
> import type { PrismaClient } from "../prisma/generated/prisma/client";
>
> declare module "cagd-utilities" {
>     interface RegisteredPrismaClient extends PrismaClient {}
> }
> ```

### Web

```ts
import { service } from "cagd-utilities";
import r_main from "./routers";

await service.web.start({ routers: [r_main] });
service.web.server;   // http/https Server
await service.web.stop();
```

`createExpressApp()` helmet, cors, rate limit ve body parser'ları config'ten kurar. Ayrıca `res.success()` / `res.error()` ekler:

```ts
res.success({ data: user, message: "Kullanıcı bulundu" });
res.error({ message: "Bulunamadı", code: "NOT_FOUND" }, 404);
```

### Diğerleri

```ts
await service.redis.start();
await service.redis.instance.setJSON("user:1", { id: 1 }, 60);

await service.postgres.start();
await service.postgres.instance.query("SELECT * FROM users WHERE id = $1", [5]);

await service.mssql.instance.query("SELECT * FROM users WHERE id = @param0", [5]);

await service.mail.send({ to: "a@b.com", subject: "Selam", text: "..." });
```

### Toplu yaşam döngüsü

```ts
await service.start("prisma", "redis", "web"); // sırayla başlatır
await service.healthCheckAll();                // { prisma: true, redis: true, web: true }

process.on("SIGTERM", () => service.stopAll());
```

---

## 3) services — ham sınıflar

Singleton'ı kendin yönetmek istediğinde:

```ts
import { services } from "cagd-utilities";

const redis = services.RedisService.getInstance();
const http  = new services.AxiosService({ name: "Gateway", instance: { baseURL: "https://api.example.com" } });
const res   = await http.request({ url: "/ping" });

await services.PostgresService.getInstance().transaction(async client => {
    /* BEGIN / COMMIT / ROLLBACK otomatik */
});
```

| Sınıf | Klasör |
| --- | --- |
| `BaseService`, `MssqlService`, `PostgresService`, `PrismaService` | `services/database/` |
| `AxiosService`, `AxiosAgent`, `WebService`, `createExpressApp` | `services/http/` |
| `MailService`, `RedisService` | `services/` |

### Yeni DB türü eklemek

1. `src/services/database/_template.Service.ts` dosyasını kopyala -> `Xxx.Service.ts`.
2. `BaseService`'i extend et. Zorunlu: `query`, `queryWithMeta`, `healthCheck`, `close`, `getPoolConfig`.
3. `services/index.ts` ve `service/index.ts` içine lazy olarak ekle.

---

## 4) util

```ts
import { util } from "cagd-utilities";

util.date.getLocalDate();            // yerel ISO (Z yok)
util.date.getLocalDay();             // "2026-09-17"
util.log.info("mesaj");              // cagd-log varsa onu kullanır
util.http.successResponse({ data }); // API cevap standardı
```

---

## Sürüm akışı

1. Değişiklik yap -> `npm run build`.
2. `npm pack --dry-run` ile pakete ne gireceğine bak.
3. `npm version patch` -> `npm publish`.
4. `api` ve `agent` projelerinde `npm update cagd-utilities`.

`npm publish` ve `npm pack` zaten `prepack` ile taze build alır.

---

## Lisans

MIT
