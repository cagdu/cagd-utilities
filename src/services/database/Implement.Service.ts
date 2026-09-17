/**
 * ============================================================
 *  YENİ BİR DATABASE SERVİSİ EKLEME ŞABLONU
 * ============================================================
 * Bu dosya çalıştırılmaz, sadece referanstır. Yeni bir DB türü
 * (örn. MySQL, SQLite, MongoDB) eklerken bu şablonu kopyala ve
 * XXX.Service.ts olarak kaydet.
 *
 * ZORUNLU (BaseService'ten miras alınır, implement edilmezse derleme hatası verir):
 *   - getPoolConfig(): Object
 *   - query<T>(text, params?): Promise<T[]>
 *   - queryWithMeta<T>(text, params?): Promise<TMeta>
 *   - healthCheck(): Promise<boolean>
 *   - close(): Promise<void>
 *
 * ZORUNLU AMA INTERFACE'DE YOK (her sınıf kendi static'inde tanımlar):
 *   - static getInstance(): XXX_Service         → singleton döner
 *   - static getPoolConfig(): XXXConfig         → static context'te de erişilebilir olmalı
 *                                                 (Database.Manager gibi başka servisler bunu
 *                                                 instance oluşturmadan okuyabilmeli)
 *
 * ÖNERİLEN (mecburi değil ama diğer servislerle tutarlılık için):
 *   - getClient(): Promise<RawClient>           → manuel transaction/client erişimi
 *   - transaction<T>(callback): Promise<T>      → BEGIN/COMMIT/ROLLBACK'i otomatik yönetir
 *   - private constructor + private static pool → dışarıdan `new` ile oluşturulamasın
 *
 * ÖNEMLİ KURALLAR:
 *   1. Pool, constructor içinde lazy oluşturulur (ya da mssql gibi async bağlantı
 *      gerekiyorsa getPool() içinde lazy + promise cache ile).
 *   2. close() çağrıldığında instance VE pool null'lanmalı ki yeniden getInstance()
 *      çağrıldığında temiz bir pool kurulsun (graceful restart senaryoları için).
 *   3. healthCheck() asla exception fırlatmamalı, try/catch ile boolean dönmeli.
 *   4. Config `import { config } from "../../config"` üzerinden okunmalı;
 *      process.env.DATABASE_URL varsa öncelik ona verilmeli.
 *
 * ------------------------------------------------------------
 * import { config } from "../../config";
 * import { BaseService } from "./Base.Service";
 *
 * export class XXX_Service extends BaseService<SomeMeta> {
 *     private static instance: XXX_Service | null = null;
 *     private static pool: SomePoolType | null = null;
 *
 *     private constructor() {
 *         super();
 *         // pool init
 *     }
 *
 *     public static getInstance(): XXX_Service {
 *         if (!XXX_Service.instance) XXX_Service.instance = new XXX_Service();
 *         return XXX_Service.instance;
 *     }
 *
 *     public static getPoolConfig(): SomeConfig { ... }
 *
 *     getPoolConfig(): SomeConfig {
 *         return XXX_Service.getPoolConfig();
 *     }
 *
 *     async query<T = any>(text: string, params?: any[]): Promise<T[]> { ... }
 *     async queryWithMeta<T = any>(text: string, params?: any[]) { ... }
 *     async healthCheck(): Promise<boolean> { ... }
 *     async close(): Promise<void> { ... }
 * }
 *
 * export default XXX_Service;
 * ------------------------------------------------------------
 */
export {};
