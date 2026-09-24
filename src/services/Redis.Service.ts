import { createClient, type RedisClientType } from "redis";

import { baseCfg } from "../config/access";
import { log } from "../util/logger";

/** Log'a basılacak adresten şifreyi çıkarır. */
function safeUrl(url: string): string {
	try {
		const u = new URL(url);
		if (u.password) u.password = "***";
		return u.toString();
	} catch {
		return url;
	}
}

export class RedisService {
	private static instance: RedisService | null = null;
	private static _client: RedisClientType | null = null;
	private static connecting: Promise<void> | null = null;

	private constructor() {}

	public static getInstance(): RedisService {
		if (!RedisService.instance) RedisService.instance = new RedisService();
		return RedisService.instance;
	}

	private static createClient(): RedisClientType {
		const cfg = baseCfg().services.redis;
		const url = cfg.url || `redis://${cfg.host}:${cfg.port}`;
		let everReady = false;

		const client = createClient({
			url,
			password: cfg.password || undefined,
			database: cfg.db,
			socket: {
				// İlk bağlantıda `connectRetries` denemeden sonra vazgeç (connect() hata ile döner);
				// bir kez bağlandıktan sonra kopmalarda sınırsız yeniden dene.
				reconnectStrategy: (retries: number) => {
					if (!everReady && retries >= cfg.connectRetries) return new Error(`RedisService: ${safeUrl(url)} adresine ${retries} denemede bağlanılamadı.`);
					return Math.min(retries * 100, 3000);
				},
			},
		}) as RedisClientType;

		client.on("error", err => log.error("RedisService:", err?.message ?? err));
		client.on("ready", () => {
			everReady = true;
			log.info(`RedisService: bağlandı (${safeUrl(url)}).`);
		});

		return client;
	}

	/** Ham redis client. İlk erişimde oluşturulur (bağlanmaz; bağlanmak için connect()). */
	public get client(): RedisClientType {
		if (!RedisService._client) RedisService._client = RedisService.createClient();
		return RedisService._client;
	}

	public get connected(): boolean {
		return RedisService._client?.isReady ?? false;
	}

	/** Bağlanır. İdempotent: bağlıysa ya da bağlanıyorsa aynı işlemi bekler. */
	async connect(): Promise<void> {
		const client = this.client;
		if (client.isOpen && !RedisService.connecting) return;

		if (!RedisService.connecting) {
			RedisService.connecting = client
				.connect()
				.then(() => undefined)
				.catch(async err => {
					// Başarısız client'ı tamamen bırak; bir sonraki connect() temiz bir client ile başlasın.
					if (RedisService._client === client) RedisService._client = null;
					if (client.isOpen) await client.disconnect().catch(() => undefined);
					throw err;
				})
				.finally(() => {
					RedisService.connecting = null;
				});
		}
		return RedisService.connecting;
	}

	async healthCheck(): Promise<boolean> {
		try {
			return (await this.client.ping()) === "PONG";
		} catch (err) {
			log.warn("RedisService: healthCheck başarısız.", err);
			return false;
		}
	}

	// --- Yardımcı (helper) metodlar ---

	async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
		if (ttlSeconds) await this.client.set(key, value, { EX: ttlSeconds });
		else await this.client.set(key, value);
	}

	async get(key: string): Promise<string | null> {
		return this.client.get(key);
	}

	async setJSON<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
		await this.set(key, JSON.stringify(value), ttlSeconds);
	}

	async getJSON<T>(key: string): Promise<T | null> {
		const raw = await this.get(key);
		if (raw === null) return null;
		try {
			return JSON.parse(raw) as T;
		} catch {
			return null;
		}
	}

	async del(key: string): Promise<number> {
		return this.client.del(key);
	}

	async exists(key: string): Promise<boolean> {
		return (await this.client.exists(key)) === 1;
	}

	async expire(key: string, ttlSeconds: number): Promise<void> {
		await this.client.expire(key, ttlSeconds);
	}

	async incr(key: string): Promise<number> {
		return this.client.incr(key);
	}

	/**
	 * Bağlantıyı kapatır. İdempotent. Bağlıysa bekleyen komutlar tamamlanır (quit);
	 * bağlanmaya/yeniden bağlanmaya çalışıyorsa bu denemeler durdurulur (disconnect).
	 */
	async close(): Promise<void> {
		const client = RedisService._client;
		RedisService._client = null;
		RedisService.instance = null;
		if (!client) return;

		if (client.isReady) await client.quit();
		else if (client.isOpen) await client.disconnect();
		log.info("RedisService: bağlantı kapatıldı.");
	}
}

export default RedisService;
