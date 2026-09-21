import { createClient, type RedisClientType } from "redis";

import { config } from "../config";
import { log } from "../util/logger";

export class RedisService {
	private static instance: RedisService | null = null;
	private static client: RedisClientType | null = null;
	private static isConnected = false;

	private constructor() {
		if (!RedisService.client) {
			const cfg = (config as any)?.services?.redis ?? {};

			RedisService.client = createClient({
				url: cfg.url || process.env.REDIS_URL || `redis://${cfg.host || process.env.REDIS_HOST || "localhost"}:${cfg.port || process.env.REDIS_PORT || 6379}`,
				password: cfg.password || process.env.REDIS_PASSWORD || undefined,
				database: cfg.db ?? (process.env.REDIS_DB ? Number(process.env.REDIS_DB) : 0),
				socket: {
					reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000),
				},
			}) as RedisClientType;

			RedisService.client.on("error", err => log.error("RedisService", err));
			RedisService.client.on("ready", () => { log.info(`RedisService: Is connected. (${cfg.host})`); RedisService.isConnected = true; });
			RedisService.client.on("end", () => (RedisService.isConnected = false));
		}
	}

	public static getInstance(): RedisService {
		if (!RedisService.instance) RedisService.instance = new RedisService();
		return RedisService.instance;
	}

	public get client(): RedisClientType {
		if (!RedisService.client) throw new Error("Redis client is not initialized");
		return RedisService.client;
	}

	public get connected(): boolean {
		return RedisService.isConnected;
	}

	async connect(): Promise<void> {
		if (RedisService.client && !RedisService.isConnected) await RedisService.client.connect();
	}

	async healthCheck(): Promise<boolean> {
		try {
			return (await this.client.ping()) === "PONG";
		} catch (err) {
			log.error("RedisService: healthCheck başarısız.", err);
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

	async close(): Promise<void> {
		if (RedisService.client) {
			if (RedisService.isConnected) await RedisService.client.quit();
			RedisService.client = null;
			RedisService.instance = null;
			RedisService.isConnected = false;
			log.info("Redis client closed");
		}
	}
}

export default RedisService;
