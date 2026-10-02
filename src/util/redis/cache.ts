import { getRedisClient, MemoryStore, warnThrottled } from "./backend";

export interface CacheOptions {
	/** Anahtar öneki: Redis anahtarı `namespace:key` olur. */
	namespace: string;
	/** Varsayılan yaşam süresi (saniye). */
	ttlSec: number;
	/** Redis erişilemezken kullanılan süreç içi önbelleğin en fazla kayıt sayısı. Varsayılan: 1000. */
	memoryMax?: number;
	/**
	 * Süreç içi yedekte bir değerin en fazla tutulacağı süre (saniye). Varsayılan: `ttlSec`.
	 * Çok kopyalı kurulumlarda başka kopyaların geçersiz kılmaları (`del`) bu kopyanın belleğine ulaşmaz;
	 * izin/oturum gibi güvenlikle ilgili önbelleklerde kısa tutun (ör. 5).
	 */
	memoryTtlSec?: number;
}

export interface Cache {
	readonly namespace: string;
	/** Önbellekteki değer; yoksa `undefined`. (`null` geçerli, önbelleğe alınabilir bir değerdir.) */
	get<T = unknown>(key: string): Promise<T | undefined>;
	set<T = unknown>(key: string, value: T, ttlSec?: number): Promise<void>;
	del(key: string): Promise<void>;
	/**
	 * Önbellekte varsa onu, yoksa `loader()`'ın sonucunu döner ve önbelleğe yazar (`undefined` yazılmaz).
	 * Aynı anahtar için eşzamanlı çağrılar tek bir `loader()` çağrısını paylaşır (single-flight).
	 */
	getOrLoad<T>(key: string, loader: () => Promise<T> | T, ttlSec?: number): Promise<T>;
}

/** Değer `{ v }` sarmalayıcısıyla saklanır; böylece `null` da önbelleğe alınabilir ve "yok"tan ayrılır. */
type Wrapped = { v: unknown };

/**
 * Redis tabanlı JSON önbellek. Redis bağlı değilse ya da komut hata verirse süreç içi (TTL'li LRU) önbelleğe düşer
 * ve dakikada en fazla bir kez `log.warn` yazar; istek asla bu yüzden başarısız olmaz.
 *
 * Not: süreç içi yedek yalnızca Redis erişilemezken yazılan/okunan değerleri tutar. Redis geri geldiğinde, kesinti
 * sırasında yapılan `del()` çağrıları Redis'e yansımamış olabilir; bu yüzden güvenlikle ilgili önbelleklerde kısa TTL kullanın.
 */
export function createCache(options: CacheOptions): Cache {
	const { namespace } = options;
	const defaultTtl = Math.max(1, Math.floor(options.ttlSec));
	const memory = new MemoryStore<Wrapped>(options.memoryMax ?? 1000);
	const memoryTtlCap = options.memoryTtlSec === undefined ? Infinity : Math.max(1, Math.floor(options.memoryTtlSec));
	const inflight = new Map<string, Promise<unknown>>();
	const fullKey = (key: string) => `${namespace}:${key}`;

	async function readRaw(key: string): Promise<Wrapped | undefined> {
		const k = fullKey(key);
		const client = getRedisClient();
		if (client) {
			try {
				const raw = await client.sendCommand(["GET", k]);
				if (raw === null || raw === undefined) return undefined;
				const parsed = JSON.parse(String(raw)) as Wrapped;
				return parsed && typeof parsed === "object" && "v" in parsed ? parsed : undefined;
			} catch (err) {
				warnThrottled(`cache:${namespace}`, "Redis okunamadı, süreç içi önbellek kullanılıyor", err);
			}
		}
		return memory.get(k);
	}

	async function write(key: string, value: unknown, ttlSec?: number): Promise<void> {
		const k = fullKey(key);
		const ttl = Math.max(1, Math.floor(ttlSec ?? defaultTtl));
		const wrapped: Wrapped = { v: value };
		const client = getRedisClient();
		if (client) {
			try {
				await client.sendCommand(["SET", k, JSON.stringify(wrapped), "EX", String(ttl)]);
				memory.delete(k);
				return;
			} catch (err) {
				warnThrottled(`cache:${namespace}`, "Redis'e yazılamadı, süreç içi önbellek kullanılıyor", err);
			}
		}
		memory.set(k, wrapped, Math.min(ttl, memoryTtlCap) * 1000);
	}

	return {
		namespace,

		async get<T>(key: string): Promise<T | undefined> {
			const hit = await readRaw(key);
			return hit ? (hit.v as T) : undefined;
		},

		async set<T>(key: string, value: T, ttlSec?: number): Promise<void> {
			await write(key, value, ttlSec);
		},

		async del(key: string): Promise<void> {
			const k = fullKey(key);
			memory.delete(k);
			const client = getRedisClient();
			if (!client) return;
			try {
				await client.sendCommand(["DEL", k]);
			} catch (err) {
				warnThrottled(`cache:${namespace}`, "Redis'ten silinemedi", err);
			}
		},

		async getOrLoad<T>(key: string, loader: () => Promise<T> | T, ttlSec?: number): Promise<T> {
			const hit = await readRaw(key);
			if (hit) return hit.v as T;

			const pending = inflight.get(key);
			if (pending) return pending as Promise<T>;

			const promise = (async () => {
				try {
					const value = await loader();
					if (value !== undefined) await write(key, value, ttlSec);
					return value;
				} finally {
					inflight.delete(key);
				}
			})();
			inflight.set(key, promise);
			return promise;
		},
	};
}
