/**
 * `util.redis` yapılarının ortak altyapısı: bağlı Redis client'ını bulma, süreç içi yedek depo
 * ve "dakikada en fazla bir kez" uyarı logu.
 *
 * Komutlar `client.sendCommand([...])` ile gönderilir; böylece node-redis v4, v5 ve v6'nın hepsiyle çalışır
 * (komut metodlarının imzaları sürümler arasında değişti, ham komut arayüzü değişmedi).
 */
import { log } from "../logger";

/** `util.redis`'in kullandığı asgari client arayüzü. */
export interface RedisCommandClient {
	readonly isReady?: boolean;
	sendCommand(args: string[]): Promise<unknown>;
}

let override: RedisCommandClient | null | undefined;

/**
 * `util.redis` yapılarının kullanacağı client'ı açıkça belirler (testler ya da kendi client'ını yöneten uygulamalar için).
 * `null` → her zaman süreç içi mod; `undefined` → varsayılana dön (`service.redis`).
 */
export function setRedisClient(client: RedisCommandClient | null | undefined): void {
	override = client;
}

/** Uygulama süreç içi modu açıkça seçti mi (`setRedisClient(null)`)? Bu modda "Redis yok" uyarıları loglanmaz. */
export function isMemoryModeExplicit(): boolean {
	return override === null;
}

/**
 * Kullanılabilir (bağlı ve hazır) Redis client'ı; yoksa `null` (süreç içi moda geçilir).
 * Varsayılan kaynak `service.redis`: yalnızca daha önce oluşturulup bağlanmışsa kullanılır, burada asla bağlantı açılmaz.
 */
export function getRedisClient(): RedisCommandClient | null {
	if (override !== undefined) return override && override.isReady !== false ? override : null;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { RedisService } = require("../../services/Redis.Service") as typeof import("../../services/Redis.Service");
		const svc = RedisService.getInstance();
		if (!svc.connected) return null;
		return svc.client as unknown as RedisCommandClient;
	} catch {
		return null; // `redis` paketi kurulu değil
	}
}

const lastWarn = new Map<string, number>();
const WARN_INTERVAL_MS = 60_000;

/** Aynı kaynak için dakikada en fazla bir kez uyarı loglar. Hata nesnesinin yalnızca mesajı yazılır. */
export function warnThrottled(source: string, message: string, err?: unknown): void {
	const now = Date.now();
	if (now - (lastWarn.get(source) ?? 0) < WARN_INTERVAL_MS) return;
	lastWarn.set(source, now);
	const detail = err instanceof Error ? err.message : err === undefined ? "" : String(err);
	log.warn(`util.redis ${source}: ${message}${detail ? ` (${detail})` : ""}`);
}

/** Testler için: uyarı kısıtlamasını sıfırlar. */
export function resetWarnings(): void {
	lastWarn.clear();
}

type Entry<V> = { value: V; expiresAt: number };

/** TTL'li, boyutu sınırlı (LRU) süreç içi depo. */
export class MemoryStore<V> {
	private readonly map = new Map<string, Entry<V>>();

	constructor(private readonly max = 1000) {}

	get(key: string): V | undefined {
		const entry = this.map.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= Date.now()) {
			this.map.delete(key);
			return undefined;
		}
		// LRU: son kullanılanı sona taşı.
		this.map.delete(key);
		this.map.set(key, entry);
		return entry.value;
	}

	/** Kalan süre (ms); yoksa 0. */
	ttlMs(key: string): number {
		const entry = this.map.get(key);
		if (!entry) return 0;
		return Math.max(0, entry.expiresAt - Date.now());
	}

	set(key: string, value: V, ttlMs: number): void {
		this.map.delete(key);
		this.map.set(key, { value, expiresAt: Date.now() + Math.max(1, ttlMs) });
		while (this.map.size > this.max) {
			const oldest = this.map.keys().next().value as string;
			this.map.delete(oldest);
		}
	}

	delete(key: string): boolean {
		return this.map.delete(key);
	}

	clear(): void {
		this.map.clear();
	}

	get size(): number {
		return this.map.size;
	}
}
