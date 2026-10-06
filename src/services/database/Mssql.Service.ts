import type { ConnectionPool, IResult, Request, Transaction, config as MssqlConfig } from "mssql";

import { baseCfg } from "../../config/access";
import { log } from "../../util/logger";
import { requireFromApp } from "../../util/require";
import { BaseService } from "./Base.Service";

// `npm link` / `file:` ile bağlı pakette normal `require("mssql")` tüketici projedeki mssql'i bulamaz.
const sql = requireFromApp<typeof import("mssql")>("mssql");

export class MssqlService extends BaseService<IResult<any>> {
	private static instance: MssqlService | null = null;
	private static pool: ConnectionPool | null = null;
	private static connecting: Promise<ConnectionPool> | null = null;

	private constructor() {
		super();
	}

	public static getInstance(): MssqlService {
		if (!MssqlService.instance) MssqlService.instance = new MssqlService();
		return MssqlService.instance;
	}

	/**
	 * mssql paketinde bağlantı asenkron kurulur (pg'deki gibi senkron
	 * new Pool() yeterli değil), bu yüzden pool'u lazy + tek seferlik kuruyoruz.
	 */
	private async getPool(): Promise<ConnectionPool> {
		if (MssqlService.pool?.connected) return MssqlService.pool;

		if (!MssqlService.connecting) {
			MssqlService.connecting = new sql.ConnectionPool(MssqlService.getPoolConfig())
				.connect()
				.then(pool => {
					pool.on("error", err => log.error("MssqlService: boştaki bağlantıda beklenmeyen hata", err));
					MssqlService.pool = pool;
					return pool;
				})
				.finally(() => {
					MssqlService.connecting = null;
				});
		}

		return MssqlService.connecting;
	}

	/** Bağlantı ayarları. Boş bırakılan user/password/database alanları gönderilmez. */
	public static getPoolConfig(): MssqlConfig {
		const cfg = baseCfg().database.mssql;

		return {
			server: cfg.host,
			port: cfg.port,
			user: cfg.user || undefined,
			password: cfg.password || undefined,
			database: cfg.database || undefined,
			options: {
				encrypt: cfg.encrypt,
				trustServerCertificate: cfg.trustServerCertificate,
			},
			pool: {
				max: cfg.max,
				idleTimeoutMillis: cfg.idleTimeoutMillis,
			},
			connectionTimeout: cfg.connectionTimeoutMillis,
		};
	}

	/** BaseService instance metodu istediği için static getPoolConfig()'e köprü. */
	getPoolConfig(): MssqlConfig {
		return MssqlService.getPoolConfig();
	}

	/** Pool'u kurar ve bağlantıyı doğrular. */
	async connect(): Promise<void> {
		const pool = await this.getPool();
		await pool.request().query("SELECT 1");
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
	async queryWithMeta<T extends Record<string, any> = any>(text: string, params?: any[]): Promise<IResult<T>> {
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
		} catch (err) {
			log.warn("MssqlService: healthCheck başarısız.", err);
			return false;
		}
	}

	/** Uygulama kapanırken (SIGTERM/SIGINT) çağrılmalı. İdempotent; süren bir bağlantı denemesi varsa onu da bekler. */
	async close(): Promise<void> {
		if (MssqlService.connecting) await MssqlService.connecting.catch(() => undefined);

		const pool = MssqlService.pool;
		MssqlService.pool = null;
		MssqlService.instance = null;
		if (pool) {
			await pool.close();
			log.info("MssqlService: pool kapatıldı.");
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

export default MssqlService;
