import { baseConfig, baseConfigEnv, type BaseConfig } from "./base-config";
import { deepMerge } from "./deep-merge";
import { readEnv } from "./env";
import { configManager } from "./manager";

let cache: { version: number; value: BaseConfig } | null = null;

/**
 * Paket içi servislerin config'i okuduğu TEK nokta. Tam tipli döner.
 *
 * - `setDefaultConfig()` çağrıldıysa: `baseConfig` + güncel config.
 * - Çağrılmadıysa: `baseConfig` + ortam değişkenleri (`baseConfigEnv`) + varsa setConfig() değerleri.
 *
 * Böylece servisler kendi içlerinde varsayılan değer tutmaz; tüm varsayılanlar `baseConfig`'tedir.
 * Dönen obje salt okunur kabul edilmelidir.
 */
export function baseCfg(): BaseConfig {
	// setDefaultConfig() öncesi ortam değişkenleri her okumada yeniden değerlendirilir (önbelleğe alınmaz).
	if (!configManager.isInitialized()) return deepMerge(deepMerge(baseConfig, readEnv(baseConfig, baseConfigEnv)), configManager.peek());

	const version = configManager.getVersion();
	if (cache && cache.version === version) return cache.value;

	const value = deepMerge(baseConfig, configManager.peek());
	cache = { version, value };
	return value;
}

/** `debug` listesinde verilen etiket (ya da "*") var mı? Sadece `dev` modunda true döner. */
export function isDebugEnabled(tag: string): boolean {
	const cfg = baseCfg();
	return Boolean(cfg.dev) && Array.isArray(cfg.debug) && (cfg.debug.includes(tag) || cfg.debug.includes("*"));
}
