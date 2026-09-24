import { config as configValues, configManager, ConfigManager } from "./manager";
import type { ConfigChangeListener, ConfigEnvMap, ConfigInitOptions, ConfigSchema, DeepPartial, ResolvedConfig, UtilitiesConfig } from "./types";

/**
 * Varsayılan config'i tanımlar. Dönen değer TAM TİPLİ canlı config proxy'sidir.
 *
 *   export const cfg = config.manager.setDefaultConfig(defaultConfig, { schema });
 *   cfg.database.postgres.host; // ✅ tip güvenli
 */
export function setDefaultConfig<T extends Record<string, any>>(defaults: T, options?: ConfigInitOptions<T>): T {
	return configManager.setDefaultConfig(defaults, options);
}

/** Runtime'da config'i günceller. Reboot gerekmez. `persist = true` dosyaya da yazar. */
export function setConfig<T extends Record<string, any> = ResolvedConfig>(partial: DeepPartial<T>, persist = false): T {
	return configManager.setConfig<T>(partial, persist);
}

/** setConfig() ile yapılan runtime değişikliklerini siler (varsayılan + dosya + ortam değişkenlerine döner). */
export function resetConfig(reloadFile = true): ResolvedConfig {
	return configManager.resetConfig(reloadFile);
}

/** Varsayılan config objesinin kopyası. */
export function getDefaultConfig<T = ResolvedConfig>(): T {
	return configManager.getDefaultConfig<T>();
}

/** Anlık config'in düz (proxy olmayan) kopyası. */
export function getConfig<T = ResolvedConfig>(): T {
	return configManager.snapshot<T>();
}

/** Config her değiştiğinde çağrılır; abonelikten çıkmak için dönen fonksiyonu kullan. */
export function onConfigChange<T = ResolvedConfig>(listener: ConfigChangeListener<T>): () => void {
	return configManager.onChange<T>(listener);
}

/** config.jsonc dosyasının tam yolu. */
export function configPath(): string {
	return configManager.configPath();
}

/**
 * config.jsonc dosyasını yazar. Değer verilmezse dosyadaki değerler + runtime değişiklikleri yazılır.
 * Ortam değişkenlerinden gelen değerler dosyaya yazılmaz. Mevcut yorumlar korunur.
 */
export function writeConfig(value?: Record<string, any>): void {
	configManager.writeFile(value);
}

/** config.jsonc dosyasını yeniden okur. */
export function reloadConfig(): ResolvedConfig {
	return configManager.reloadFile();
}

/** config.jsonc dosyasını izler, değiştiğinde config'i otomatik günceller. */
export function watchConfig(): () => void {
	return configManager.watchFile();
}

/** `config.manager` altındaki yönetim API'si. */
export const manager = {
	setDefaultConfig,
	setConfig,
	getConfig,
	getDefaultConfig,
	resetConfig,
	onChange: onConfigChange,
	path: configPath,
	write: writeConfig,
	reload: reloadConfig,
	watch: watchConfig,
	/** Alt seviye ConfigManager örneği. */
	instance: configManager,
};

export type ConfigManagerApi = typeof manager;

/** `config` facade'inin tipi: değerler + `.data` + `.manager`. */
export type ConfigFacade = ResolvedConfig & {
	/** Config değerleri. `config.data.database.postgres.host` */
	readonly data: ResolvedConfig;
	/** Yönetim API'si. `config.manager.setConfig({ ... })` */
	readonly manager: ConfigManagerApi;
};

/**
 * ============================================================
 *  config
 * ============================================================
 *   config.data.services.web.port      -> değerler
 *   config.manager.setConfig({ ... })  -> yönetim
 *
 * GERİYE DÖNÜK UYUMLULUK: alanlara doğrudan da erişilebilir
 * (`config.services.web.port`). Bu kısayol ileriki sürümlerde
 * kaldırılacak; yeni kodda `config.data` kullan.
 */
export const config: ConfigFacade = new Proxy({} as Record<string, any>, {
	get: (_t, prop: string | symbol) => {
		if (prop === "data") return configValues;
		if (prop === "manager") return manager;
		return (configValues as Record<string, any>)[prop as string];
	},
	set: (_t, prop: string | symbol, value) => {
		if (prop === "data" || prop === "manager") return false;
		(configValues as Record<string, any>)[prop as string] = value;
		return true;
	},
	has: (_t, prop) => prop === "data" || prop === "manager" || prop in (configValues as object),
	ownKeys: () => Reflect.ownKeys(configValues as object),
	getOwnPropertyDescriptor: (_t, prop) => Reflect.getOwnPropertyDescriptor(configValues as object, prop),
}) as ConfigFacade;

/** Ham config proxy'si (facade'siz). `config.data` ile aynı referans. */
export const data: ResolvedConfig = configValues;

export { configManager, ConfigManager };
export type { ConfigChangeListener, ConfigEnvMap, ConfigInitOptions, ConfigSchema, DeepPartial, ResolvedConfig, UtilitiesConfig };
export default config;
