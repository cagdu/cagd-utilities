import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

import { config } from "../../config";
import { log } from "../../utils/logger";
import { BaseService } from "./Base.Service";

export class Postgres_Service extends BaseService<QueryResult> {
	private static instance: Postgres_Service | null = null;
	private static pool: Pool | null = null;

	private constructor() {
		super();
		if (!Postgres_Service.pool) {
			Postgres_Service.pool = new Pool(Postgres_Service.getPoolConfig());
			Postgres_Service.pool.on("error", err => log.error("Postgres_Service: unexpected error on idle client", err));
		}
	}

	public static getInstance(): Postgres_Service {
		if (!Postgres_Service.instance) Postgres_Service.instance = new Postgres_Service();
		return Postgres_Service.instance;
	}

	private getPool(): Pool {
		if (!Postgres_Service.pool) throw new Error("Postgres pool is not initialized");
		return Postgres_Service.pool;
	}

	public static getPoolConfig(): PoolConfig {
		const cfg = (config as any)?.database?.postgres ?? {};

		if (process.env.DATABASE_URL && !cfg.host) return { connectionString: process.env.DATABASE_URL } as PoolConfig;

		// prettier-ignore
		return {
			host: cfg.host ?? "localhost",
			port: cfg.port ?? 5432,
			user: cfg.user ?? "postgres",
			password: cfg.password ?? "postgres",
			database: cfg.database ?? "postgres",
			max: cfg.max ?? 20,
			idleTimeoutMillis: cfg.idleTimeoutMillis ?? 30000,
			connectionTimeoutMillis: cfg.connectionTimeoutMillis ?? 5000,
			ssl: cfg.ssl ?? undefined,
		} as PoolConfig;
	}

	/** BaseService instance metodu istediği için static getPoolConfig()'e köprü. */
	getPoolConfig(): PoolConfig {
		return Postgres_Service.getPoolConfig();
	}

	/** Tek seferlik sorgular için. Bağlantıyı otomatik alır ve bırakır. */
	async query<T = any>(text: string, params?: any[]): Promise<T[]> {
		const res = await this.getPool().query(text, params);
		return res.rows as T[];
	}

	/** Meta bilgiye (rowCount, command...) de ihtiyaç varsa. */
	async queryWithMeta<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
		return this.getPool().query<T>(text, params);
	}

	/** Manuel client. release() sorumluluğu çağırandadır. */
	async getClient(): Promise<PoolClient> {
		return this.getPool().connect();
	}

	/** BEGIN/COMMIT/ROLLBACK + release işlemlerini otomatik yönetir. */
	async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
		const client = await this.getPool().connect();
		try {
			await client.query("BEGIN");
			const result = await callback(client);
			await client.query("COMMIT");
			return result;
		} catch (err) {
			await client.query("ROLLBACK").catch(() => undefined);
			throw err;
		} finally {
			client.release();
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			await this.getPool().query("SELECT 1");
			return true;
		} catch {
			return false;
		}
	}

	/** Uygulama kapanırken (SIGTERM/SIGINT) çağrılmalı. */
	async close(): Promise<void> {
		if (Postgres_Service.pool) {
			await Postgres_Service.pool.end();
			Postgres_Service.pool = null;
			Postgres_Service.instance = null;
			log.info("PostgreSQL pool closed");
		}
	}
}

export default Postgres_Service;
