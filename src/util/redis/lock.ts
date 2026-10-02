import { randomBytes } from "node:crypto";

import { getRedisClient, MemoryStore, warnThrottled } from "./backend";

export interface LockOptions {
	/** Kilidin kendiliğinden düşeceği süre (ms). İş bundan uzun sürecekse `extend()` çağırın. */
	ttlMs: number;
	/** Kilit doluysa en fazla bu kadar bekle (ms). Varsayılan: 0 (beklemeden `null`). */
	waitMs?: number;
	/** Bekleme sırasında yeniden deneme aralığı (ms). Varsayılan: 50. */
	retryMs?: number;
}

export interface Lock {
	readonly name: string;
	/** Kilidi bırakır; kilit hâlâ bu sahibe aitse `true`. */
	release(): Promise<boolean>;
	/** Süreyi şimdiden itibaren `ms` olarak yeniler; kilit hâlâ bu sahibe aitse `true`. */
	extend(ms: number): Promise<boolean>;
}

const RELEASE_SCRIPT = 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';
const EXTEND_SCRIPT = 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("PEXPIRE", KEYS[1], ARGV[2]) else return 0 end';

/** Redis yokken kullanılan süreç içi kilitler (tek kopya varsayımı). */
const memoryLocks = new MemoryStore<string>(10_000);

const lockKey = (name: string) => `lock:${name}`;

async function tryAcquire(name: string, token: string, ttlMs: number): Promise<"redis" | "memory" | null> {
	const key = lockKey(name);
	const client = getRedisClient();
	if (client) {
		try {
			const ok = await client.sendCommand(["SET", key, token, "PX", String(Math.max(1, Math.floor(ttlMs))), "NX"]);
			return ok === "OK" ? "redis" : null;
		} catch (err) {
			warnThrottled("lock", "Redis erişilemedi, süreç içi kilit kullanılıyor (tek kopya varsayımı)", err);
		}
	} else {
		warnThrottled("lock", "Redis bağlı değil, süreç içi kilit kullanılıyor (tek kopya varsayımı)");
	}
	if (memoryLocks.get(key) !== undefined) return null;
	memoryLocks.set(key, token, ttlMs);
	return "memory";
}

/**
 * Dağıtık kilit (`SET NX PX` + rastgele jeton). Bırakma/uzatma yalnızca jeton eşleşirse yapılır (Lua betiği);
 * böylece süresi dolup başkasına geçmiş bir kilit yanlışlıkla bırakılmaz. Alınamazsa `null`.
 * Redis yoksa süreç içi kilit kullanılır (tek kopya varsayımı) ve uyarı loglanır.
 */
export async function acquireLock(name: string, options: LockOptions): Promise<Lock | null> {
	const token = randomBytes(16).toString("hex");
	const deadline = Date.now() + Math.max(0, options.waitMs ?? 0);
	const retryMs = Math.max(1, options.retryMs ?? 50);

	let backend = await tryAcquire(name, token, options.ttlMs);
	while (!backend && Date.now() < deadline) {
		await new Promise(resolve => setTimeout(resolve, Math.min(retryMs, Math.max(1, deadline - Date.now()))));
		backend = await tryAcquire(name, token, options.ttlMs);
	}
	if (!backend) return null;

	const key = lockKey(name);
	const via = backend;

	async function runScript(script: string, args: string[]): Promise<boolean> {
		if (via === "memory") return false;
		const client = getRedisClient();
		if (!client) return false;
		try {
			return Number(await client.sendCommand(["EVAL", script, "1", key, ...args])) === 1;
		} catch (err) {
			warnThrottled("lock", "Redis'te kilit işlemi yapılamadı", err);
			return false;
		}
	}

	return {
		name,
		async release() {
			if (via === "memory") {
				if (memoryLocks.get(key) !== token) return false;
				memoryLocks.delete(key);
				return true;
			}
			return runScript(RELEASE_SCRIPT, [token]);
		},
		async extend(ms: number) {
			if (via === "memory") {
				if (memoryLocks.get(key) !== token) return false;
				memoryLocks.set(key, token, ms);
				return true;
			}
			return runScript(EXTEND_SCRIPT, [token, String(Math.max(1, Math.floor(ms)))]);
		},
	};
}

/**
 * Kilidi alıp `fn`'i çalıştırır ve her durumda bırakır. Kilit alınamazsa `fn` çalışmaz: `{ acquired: false }`.
 */
export async function withLock<T>(name: string, options: LockOptions, fn: (lock: Lock) => Promise<T> | T): Promise<{ acquired: true; result: T } | { acquired: false }> {
	const lock = await acquireLock(name, options);
	if (!lock) return { acquired: false };
	try {
		return { acquired: true, result: await fn(lock) };
	} finally {
		await lock.release();
	}
}
