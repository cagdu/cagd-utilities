/**
 * ============================================================
 *  YENİ DATABASE SERVİSİ ŞABLONU  (çalışmaz, sadece referans)
 * ============================================================
 * Yeni bir DB (MySQL, SQLite...) eklerken:
 *   1. Bu dosyayı kopyala -> `Xxx.Service.ts` (aynı klasör).
 *   2. Sınıfı `XxxService` diye adlandır.
 *   3. `services/index.ts` (lazy getter + Object.defineProperty satırı) ve
 *      `service/index.ts` (Definer sınıfı + ServiceName + registry) içine ekle.
 *   4. Config alanlarını `config/base-config.ts`'e (baseConfig + baseConfigSchema
 *      + gerekiyorsa baseConfigEnv) ekle. Varsayılan değerler SADECE orada durur.
 *
 * ZORUNLU (BaseService'ten gelir, eksikse derleme hatası verir):
 *   - getPoolConfig()   -> bağlantı ayarları
 *   - connect()         -> bağlantıyı kurar ve doğrular, başarısızsa throw (idempotent)
 *   - query()           -> satır dizisi döner
 *   - queryWithMeta()   -> sürücünün kendi sonuç tipini döner
 *   - healthCheck()     -> boolean
 *   - close()           -> bağlantıyı kapatır
 *
 * ZORUNLU AMA INTERFACE'DE YOK (her sınıf kendi static'inde tanımlar):
 *   - static getInstance()    -> singleton döner
 *   - static getPoolConfig()  -> PrismaService instance oluşturmadan okuyabilsin diye
 *
 * ÖNERİLEN:
 *   - getClient()       -> manuel client erişimi
 *   - transaction()     -> BEGIN / COMMIT / ROLLBACK otomatik
 *   - private constructor + private static pool
 *
 * KURALLAR:
 *   1. Pool lazy kurulur (async bağlantı gerekiyorsa getPool() + promise cache).
 *      Constructor'da bağlantı/pool KURULMAZ.
 *   2. close() idempotent'tir; hem instance'ı hem pool'u null'lar (temiz yeniden başlatma).
 *   3. healthCheck() asla throw etmez; hata olursa `log.warn(...)` ile loglar, false döner.
 *   4. Config `import { baseCfg } from "../../config/access"` ile TİPLİ okunur.
 *      Servis içinde `?? "varsayılan"` yazılmaz; varsayılanlar base-config.ts'tedir.
 *      Ortam değişkenleri servis içinde okunmaz; baseConfigEnv üzerinden gelir.
 *   5. Sürücü paketini (`pg`, `mssql`...) dosyanın en üstünde import etmek OK:
 *      dosya zaten sadece ihtiyaç anında `require()` ile yüklenir.
 *   6. Log mesajları Türkçe ve "XxxService: ..." önekiyle yazılır.
 *
 * ------------------------------------------------------------
 * import { baseCfg } from "../../config/access";
 * import { log } from "../../util/logger";
 * import { BaseService } from "./Base.Service";
 *
 * export class XxxService extends BaseService<SomeMeta> {
 *     private static instance: XxxService | null = null;
 *     private static pool: SomePoolType | null = null;
 *
 *     private constructor() {
 *         super();
 *     }
 *
 *     public static getInstance(): XxxService {
 *         if (!XxxService.instance) XxxService.instance = new XxxService();
 *         return XxxService.instance;
 *     }
 *
 *     public static getPoolConfig(): SomeConfig { ... }
 *
 *     getPoolConfig(): SomeConfig {
 *         return XxxService.getPoolConfig();
 *     }
 *
 *     async connect(): Promise<void> { ... }
 *     async query<T = any>(text: string, params?: any[]): Promise<T[]> { ... }
 *     async queryWithMeta<T = any>(text: string, params?: any[]) { ... }
 *     async healthCheck(): Promise<boolean> { ... }
 *     async close(): Promise<void> { ... }
 * }
 *
 * export default XxxService;
 * ------------------------------------------------------------
 */
export {};
