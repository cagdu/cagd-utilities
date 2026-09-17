import sql, { type ConnectionPool, type Request, type Transaction, type config as MssqlConfig } from "mssql";

import { config } from "../../config";
import { log } from "../../utils/logger";
import { BaseService } from "./Base.Service";

export class MSSQL_Service extends BaseService<sql.IResult<any>> {
	private static instance: MSSQL_Service | null = null;
	private static pool: ConnectionPool | null = null;
	private static connecting: Promise<ConnectionPool> | null = null;

	private constructor() {
		super();
	}

	public static getInstance(): MSSQL_Service {
		if (!MSSQL_Service.instance) MSSQL_Service.instance = new MSSQL_Service();
		return MSSQL_Service.instance;
	}

	/**
	 * mssql paketinde bağlantı asenkron kurulur (pg'deki gibi senkron
	 * new Pool() yeterli değil), bu yüzden pool'u lazy + tek seferlik kuruyoruz.
	 */
	private async getPool(): Promise<ConnectionPool> {
		if (MSSQL_Service.pool?.connected) return MSSQL_Service.pool;

		if (!MSSQL_Service.connecting) {
			MSSQL_Service.connecting = new sql.ConnectionPool(MSSQL_Service.getPoolConfig())
				.connect()
				.then(pool => {
					pool.on("error", err => log.error("MSSQL_Service: unexpected error on idle client", err));
					MSSQL_Service.pool = pool;
					return pool;
				})
				.finally(() => {
					MSSQL_Service.connecting = null;
				});
		}

		return MSSQL_Service.connecting;
	}

	public static getPoolConfig(): MssqlConfig {
		const cfg = (config as any)?.database?.mssql ?? {};

		// prettier-ignore
		return {
			server: cfg.host ?? "localhost",
			port: cfg.port ?? 1433,
			user: cfg.user ?? "sa",
			password: cfg.password ?? "sa",
			database: cfg.database ?? "master",
			options: {
				encrypt: cfg.encrypt ?? false,
				trustServerCertificate: cfg.trustServerCertificate ?? true,
			},
			pool: {
				max: cfg.max ?? 20,
				idleTimeoutMillis: cfg.idleTimeoutMillis ?? 30000,
			},
			connectionTimeout: cfg.connectionTimeoutMillis ?? 5000,
		} as MssqlConfig;
	}

	/** BaseService instance metodu istediği için static getPoolConfig()'e köprü. */
	getPoolConfig(): MssqlConfig {
		return MSSQL_Service.getPoolConfig();
	}

	/**
	 * Tek seferlik sorgular için. mssql'de $1 yerine @param0 kullanılır;
	 * bu metod pg tarzı dizi parametreleri @param0, @param1... olarak bağlar.
	 *
	 * await mssql.query("SELECT * FROM users WHERE id = @param0", [5]);
	 */
	async query<T = any>(text: string, params?: any[]): Promise<T[]> {
		const pool = await this.getPool();
		const request = pool.request();
		this.bindParams(request, params);
		const res = await request.query(text);
		return res.recordset as T[];
	}

	/** rowsAffected gibi meta bilgi de gerekiyorsa. */
	async queryWithMeta<T extends Record<string, any> = any>(text: string, params?: any[]): Promise<sql.IResult<T>> {
		const pool = await this.getPool();
		const request = pool.request();
		this.bindParams(request, params);
		return request.query<T>(text);
	}

	/** Manuel request. commit/rollback sorumluluğu çağırandadır. */
	async getClient(): Promise<Request> {
		const pool = await this.getPool();
		return pool.request();
	}

	/** BEGIN/COMMIT/ROLLBACK işlemlerini otomatik yönetir. */
	async transaction<T>(callback: (request: Request, transaction: Transaction) => Promise<T>): Promise<T> {
		const pool = await this.getPool();
		const transaction = pool.transaction();

		await transaction.begin();
		try {
			const request = transaction.request();
			const result = await callback(request, transaction);
			await transaction.commit();
			return result;
		} catch (err) {
			await transaction.rollback().catch(() => undefined);
			throw err;
		}
	}

	async healthCheck(): Promise<boolean> {
		try {
			const pool = await this.getPool();
			await pool.request().query("SELECT 1");
			return true;
		} catch {
			return false;
		}
	}

	/** Uygulama kapanırken (SIGTERM/SIGINT) çağrılmalı. */
	async close(): Promise<void> {
		if (MSSQL_Service.pool) {
			await MSSQL_Service.pool.close();
			MSSQL_Service.pool = null;
			MSSQL_Service.instance = null;
			log.info("MSSQL pool closed");
		}
	}

	/** pg tarzı pozisyonel params dizisini mssql'in named parameter API'sine çevirir. */
	private bindParams(request: Request, params?: any[]): void {
		if (!params?.length) return;
		params.forEach((value, index) => {
			request.input(`param${index}`, value);
		});
	}
}

export default MSSQL_Service;
