import { createClient, type RedisClientType } from "redis";

import { config } from "../config";
import { log } from "../utils/logger";

export class Redis_Service {
	private static instance: Redis_Service | null = null;
	private static client: RedisClientType | null = null;
	private static isConnected = false;

	private constructor() {
		if (!Redis_Service.client) {
			const cfg = (config as any)?.services?.redis ?? {};

			Redis_Service.client = createClient({
				url: cfg.url || process.env.REDIS_URL || `redis://${cfg.host || process.env.REDIS_HOST || "localhost"}:${cfg.port || process.env.REDIS_PORT || 6379}`,
				password: cfg.password || process.env.REDIS_PASSWORD || undefined,
				database: cfg.db ?? (process.env.REDIS_DB ? Number(process.env.REDIS_DB) : 0),
				socket: {
					reconnectStrategy: (retries: number) => Math.min(retries * 100, 3000),
				},
			}) as RedisClientType;

			Redis_Service.client.on("error", err => log.error("Redis_Service", err));
			Redis_Service.client.on("ready", () => (Redis_Service.isConnected = true));
			Redis_Service.client.on("end", () => (Redis_Service.isConnected = false));
		}
	}

	public static getInstance(): Redis_Service {
		if (!Redis_Service.instance) Redis_Service.instance = new Redis_Service();
		return Redis_Service.instance;
	}

	public get client(): RedisClientType {
		if (!Redis_Service.client) throw new Error("Redis client is not initialized");
		return Redis_Service.client;
	}

	public get connected(): boolean {
		return Redis_Service.isConnected;
	}

	async connect(): Promise<void> {
		if (Redis_Service.client && !Redis_Service.isConnected) await Redis_Service.client.connect();
	}

	async healthCheck(): Promise<boolean> {
		try {
			return (await this.client.ping()) === "PONG";
		} catch (err) {
			log.error("Redis_Service: healthCheck failed.", err);
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
		if (Redis_Service.client) {
			if (Redis_Service.isConnected) await Redis_Service.client.quit();
			Redis_Service.client = null;
			Redis_Service.instance = null;
			Redis_Service.isConnected = false;
			log.info("Redis client closed");
		}
	}
}

export default Redis_Service;
