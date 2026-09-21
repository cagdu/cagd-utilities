import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

import { config } from "../../config";
import { log } from "../../util/logger";
import { BaseService } from "./Base.Service";

export class PostgresService extends BaseService<QueryResult> {
	private static instance: PostgresService | null = null;
	private static pool: Pool | null = null;

	private constructor() {
		super();
		if (!PostgresService.pool) {
			PostgresService.pool = new Pool(PostgresService.getPoolConfig());
			PostgresService.pool.on("error", err => log.error("PostgresService: unexpected error on idle client", err));
		}
	}

	public static getInstance(): PostgresService {
		if (!PostgresService.instance) PostgresService.instance = new PostgresService();
		return PostgresService.instance;
	}

	private getPool(): Pool {
		if (!PostgresService.pool) throw new Error("Postgres pool is not initialized");
		return PostgresService.pool;
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
		return PostgresService.getPoolConfig();
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
		if (PostgresService.pool) {
			await PostgresService.pool.end();
			PostgresService.pool = null;
			PostgresService.instance = null;
			log.info("PostgreSQL pool closed");
		}
	}
}

export default PostgresService;
