/**
 * ============================================================
 *  util.redis  —  REDIS TABANLI İLKEL YAPILAR
 * ============================================================
 *   util.redis.createCache({ namespace, ttlSec })   -> get / set / del / getOrLoad (single-flight)
 *   util.redis.acquireLock(name, { ttlMs })          -> { release, extend } | null ; withLock(name, opts, fn)
 *   util.redis.onceEvery(key, windowSec)             -> pencerede ilk çağrıda true
 *   util.redis.rateLimiter({ name, windowSec, max }) -> Express middleware ; consume(name, identity, opts)
 *
 * Ortak ilke: Redis erişilemezken istek DÜŞMEZ. Her yapı süreç içi bir yedeğe geçer ve dakikada en fazla bir kez uyarı loglar.
 * Varsayılan client `service.redis`'tir (yalnızca bağlıysa kullanılır; burada bağlantı açılmaz). `setRedisClient()` ile değiştirilebilir.
 */
import { getRedisClient, MemoryStore, warnThrottled } from "./backend";

export { createCache } from "./cache";
export { acquireLock, withLock } from "./lock";
export { consume, rateLimiter } from "./rateLimit";
export { getRedisClient, resetWarnings, setRedisClient } from "./backend";

export type { Cache, CacheOptions } from "./cache";
export type { Lock, LockOptions } from "./lock";
export type { ConsumeOptions, ConsumeResult, RateLimiterOptions } from "./rateLimit";
export type { RedisCommandClient } from "./backend";

const memoryFlags = new MemoryStore<true>(10_000);

/**
 * Bir anahtar için pencere başına yalnızca ilk çağrıda `true` döner (`SET NX PX`).
 * Örn. `LastSeenAt`'i dakikada bir yazmak: `if (await util.redis.onceEvery(\`gw:lastseen:${id}\`, 60)) await update();`
 * `windowSec` kesirli olabilir (en az 1 ms).
 */
export async function onceEvery(key: string, windowSec: number): Promise<boolean> {
	const k = `once:${key}`;
	const ttlMs = Math.max(1, Math.round(windowSec * 1000));
	const client = getRedisClient();
	if (client) {
		try {
			return (await client.sendCommand(["SET", k, "1", "PX", String(ttlMs), "NX"])) === "OK";
		} catch (err) {
			warnThrottled("onceEvery", "Redis erişilemedi, süreç içi bayrak kullanılıyor", err);
		}
	}
	if (memoryFlags.get(k)) return false;
	memoryFlags.set(k, true, ttlMs);
	return true;
}
