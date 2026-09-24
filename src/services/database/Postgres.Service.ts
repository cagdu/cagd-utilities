import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

import { baseCfg } from "../../config/access";
import { log } from "../../util/logger";
import { BaseService } from "./Base.Service";

export class PostgresService extends BaseService<QueryResult> {
	private static instance: PostgresService | null = null;
	private static pool: Pool | null = null;

	private constructor() {
		super();
	}

	public static getInstance(): PostgresService {
		if (!PostgresService.instance) PostgresService.instance = new PostgresService();
		return PostgresService.instance;
	}

	/** Pool lazy kurulur: ilk sorguda. */
	private getPool(): Pool {
		if (!PostgresService.pool) {
			PostgresService.pool = new Pool(PostgresService.getPoolConfig());
			PostgresService.pool.on("error", err => log.error("PostgresService: boştaki bağlantıda beklenmeyen hata", err));
		}
		return PostgresService.pool;
	}

	/**
	 * Bağlantı ayarları. `database.postgres.url` (env: DATABASE_URL) doluysa o kullanılır.
	 * Boş bırakılan user/password/database alanları pg'nin kendi varsayılanlarına bırakılır.
	 */
	public static getPoolConfig(): PoolConfig {
		const cfg = baseCfg().database.postgres;
		const common: PoolConfig = {
			max: cfg.max,
			idleTimeoutMillis: cfg.idleTimeoutMillis,
			connectionTimeoutMillis: cfg.connectionTimeoutMillis,
			ssl: (cfg.ssl || undefined) as PoolConfig["ssl"],
		};

		if (cfg.url) return { connectionString: cfg.url, ...common };

		return {
			host: cfg.host,
			port: cfg.port,
			user: cfg.user || undefined,
			password: cfg.password || undefined,
			database: cfg.database || undefined,
			...common,
		};
	}

	/** BaseService instance metodu istediği için static getPoolConfig()'e köprü. */
	getPoolConfig(): PoolConfig {
		return PostgresService.getPoolConfig();
	}

	/** Pool'u kurar ve bağlantıyı doğrular. */
	async connect(): Promise<void> {
		await this.getPool().query("SELECT 1");
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
		} catch (err) {
			log.warn("PostgresService: healthCheck başarısız.", err);
			return false;
		}
	}

	/** Uygulama kapanırken (SIGTERM/SIGINT) çağrılmalı. İdempotent. */
	async close(): Promise<void> {
		const pool = PostgresService.pool;
		PostgresService.pool = null;
		PostgresService.instance = null;
		if (pool) {
			await pool.end();
			log.info("PostgresService: pool kapatıldı.");
		}
	}
}

export default PostgresService;
