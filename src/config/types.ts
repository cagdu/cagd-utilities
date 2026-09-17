/**
 * ============================================================
 *  CONFIG TİPLERİ
 * ============================================================
 *
 * `UtilitiesConfig` boş bir interface'tir ve TÜKETİCİ PROJE tarafından
 * "declaration merging" ile doldurulur. Böylece `utilities.config.` yazdığında
 * IntelliSense senin kendi config objeni gösterir.
 *
 * Tüketici projede (örn. api/src/types/cagd-utilities.d.ts):
 *
 *   import { defaultConfig } from "../config/default-config";
 *
 *   declare module "cagd-utilities" {
 *       interface UtilitiesConfig extends       typeof defaultConfig {}
 *   }
 *
 * Alternatif (daha pratik) yol: `setDefaultConfig()` çağrısının DÖNÜŞ değerini
 * kullanmak. O dönüş değeri zaten tam tipli olduğu için d.ts yazmana gerek kalmaz:
 *
 *   export const utils = utilities.setDefaultConfig(defaultConfig);
 *   utils.config.database.postgres.host; // ✅ tam tipli
 */
export interface UtilitiesConfig {}

/** Interface hiç augment edilmemişse `any` sözlüğe düşer, edilmişse tam tipli olur. */
export type ResolvedConfig = keyof UtilitiesConfig extends never ? Record<string, any> : UtilitiesConfig;

/** Derin (nested) kısmi tip - setConfig() için. */
export type DeepPartial<T> = T extends (infer U)[] ? U[] : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** `configSchema` için: defaultConfig ile aynı şekilde, ama yaprakları açıklama string'i. */
export type ConfigSchema<T> = {
	[K in keyof T]?: T[K] extends object ? (T[K] extends any[] ? string : ConfigSchema<T[K]> & { __self?: string }) : string;
};

export type ConfigChangeListener<T = ResolvedConfig> = (config: T) => void;

export interface ConfigInitOptions<T> {
	/** config dosyasının adı. Varsayılan: "config.jsonc" */
	fileName?: string;
	/** config dosyasının aranacağı dizin. Varsayılan: process.cwd() */
	cwd?: string;
	/** Disk üzerindeki config.jsonc dosyası okunsun/oluşturulsun mu? Varsayılan: true */
	useFile?: boolean;
	/** Eksik alanlar dosyaya geri yazılsın mı? Varsayılan: true */
	writeBack?: boolean;
	/** JSONC yorum satırlarını üreten açıklama şeması. */
	schema?: ConfigSchema<T>;
	/** Dosya oluşturulurken en üste eklenecek yorum satırları. */
	header?: string[];
}
