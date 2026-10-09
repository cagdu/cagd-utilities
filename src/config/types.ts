/**
 * ============================================================
 *  CONFIG TİPLERİ
 * ============================================================
 *
 * `UtilitiesConfig` boş bir interface'tir ve TÜKETİCİ PROJE tarafından
 * "declaration merging" ile doldurulur. Böylece `config.data.` yazdığında
 * IntelliSense senin kendi config objeni gösterir.
 *
 * Tüketici projede (örn. api/src/types/cagdu-utilities.d.ts):
 *
 *   import type { defaultConfig } from "../config";
 *
 *   type DefaultConfigType = typeof defaultConfig;
 *
 *   declare module "cagdu-utilities" {
 *       interface UtilitiesConfig extends DefaultConfigType {}
 *   }
 *
 * Alternatif (daha pratik) yol: `config.manager.setDefaultConfig()` çağrısının
 * DÖNÜŞ değerini kullanmak. O değer zaten tam tipli olduğu için d.ts gerekmez:
 *
 *   export const cfg = config.manager.setDefaultConfig(defaultConfig);
 *   cfg.database.postgres.host; // ✅ tam tipli
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

/**
 * Config yolu -> ortam değişkeni adı eşlemesi.
 *
 *   { "database.postgres.host": "PGHOST", "services.web.port": "WEB_PORT" }
 *
 * Değer, varsayılan değerin tipine göre dönüştürülür (number / boolean / dizi / obje).
 */
export type ConfigEnvMap = Record<string, string>;

export interface ConfigInitOptions<T> {
	/** config dosyasının adı. Varsayılan: "config.jsonc" */
	fileName?: string;
	/** config dosyasının aranacağı dizin. Varsayılan: process.cwd() */
	cwd?: string;
	/** Disk üzerindeki config.jsonc dosyası okunsun/oluşturulsun mu? Varsayılan: true */
	useFile?: boolean;
	/** Eksik alanlar dosyaya geri yazılsın mı? Varsayılan: true */
	writeBack?: boolean;
	/**
	 * JSONC yorum satırlarını üreten açıklama şeması.
	 * `NoInfer`: bu alan T'yi ÇIKARSAMAK için kullanılmasın — sadece
	 * `defaults` argümanından çıkarılan T'ye karşı kontrol edilsin.
	 * Aksi halde örn. `baseConfigSchema` (yalnızca ortak alanları kapsayan,
	 * daha dar bir şema) T'yi daraltıp tüketicinin eklediği kendi alanlarını
	 * (örn. `app`) dönen tipten düşürebilir.
	 */
	schema?: ConfigSchema<NoInfer<T>>;
	/** Dosya oluşturulurken en üste eklenecek yorum satırları. */
	header?: string[];
	/**
	 * Ortam değişkeni eşlemesi. Varsayılan: `baseConfigEnv`.
	 * Kendi alanlarını eklemek için: `{ ...baseConfigEnv, "app.name": "APP_NAME" }`.
	 * `false` verilirse ortam değişkenleri hiç okunmaz.
	 *
	 * Öncelik: setConfig() > ortam değişkeni > config.jsonc > varsayılan.
	 * Ortam değişkeninden gelen değerler config.jsonc dosyasına ASLA yazılmaz.
	 */
	env?: ConfigEnvMap | false;
}
