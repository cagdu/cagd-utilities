import { config } from "../../config";
import { log } from "../../utils/logger";
import MSSQL_Service from "./MsSQL.Service";
import Postgres_Service from "./PostgreSQL.Service";

export type DatabaseProvider = "postgres" | "mssql";

export interface PrismaClientConstructor<TClient = any> {
	new (options?: any): TClient;
}

export interface DatabaseInitOptions<TClient = any> {
	/** PrismaClient sınıfı. Verilmezse `config.database.prisma.clientPath` üzerinden dinamik yüklenir. */
	client?: PrismaClientConstructor<TClient>;
	/** "postgres" | "mssql". Verilmezse config.database.provider ya da DATABASE_TYPE kullanılır. */
	provider?: DatabaseProvider;
	/** PrismaClient'a ek olarak geçilecek seçenekler (log, errorFormat vs.). */
	clientOptions?: Record<string, any>;
	/** Adapter kullanma, doğrudan connection string ile bağlan. */
	disableAdapter?: boolean;
}

/**
 * ============================================================
 *  DATABASE MANAGER  (utilities.database)
 * ============================================================
 * Prisma client'ı config'ten okuduğu bağlantı bilgileriyle (adapter üzerinden)
 * kurar ve singleton olarak tutar. Ham SQL gerekirse `.postgres` / `.mssql`
 * servisleri de buradan erişilebilir.
 *
 * Tip güvenliği için kendi generated PrismaClient'ını kaydet:
 *
 *   import { PrismaClient } from "../prisma/generated/prisma/client";
 *   export const db = utilities.database.use(PrismaClient);
 *   await db.client.user.findMany(); // ✅ tam tipli
 */
export class DatabaseManager<TClient = any> {
	private clientCtor: PrismaClientConstructor<TClient> | null = null;
	private clientInstance: TClient | null = null;
	private options: DatabaseInitOptions<TClient> = {};

	/** PrismaClient sınıfını kaydeder ve TİPLİ bir manager döner. */
	public use<T>(client: PrismaClientConstructor<T>, options: Omit<DatabaseInitOptions<T>, "client"> = {}): DatabaseManager<T> {
		const self = this as unknown as DatabaseManager<T>;
		(self as any).clientCtor = client;
		(self as any).options = { ...options };
		(self as any).clientInstance = null;
		return self;
	}

	/** use()'un alias'ı; seçenekleri de tek seferde vermek istersen. */
	public init<T = TClient>(options: DatabaseInitOptions<T> = {}): DatabaseManager<T> {
		const self = this as unknown as DatabaseManager<T>;
		if (options.client) (self as any).clientCtor = options.client;
		(self as any).options = { ...(self as any).options, ...options };
		(self as any).clientInstance = null;
		return self;
	}

	/** Aktif provider. */
	public get provider(): DatabaseProvider {
		const fromConfig = (config as any)?.database?.provider;
		const value = this.options.provider ?? fromConfig ?? process.env.DATABASE_TYPE ?? "postgres";
		return value === "mssql" ? "mssql" : "postgres";
	}

	/** Lazy oluşturulan PrismaClient. */
	public get client(): TClient {
		if (!this.clientInstance) this.clientInstance = this.createClient();
		return this.clientInstance;
	}

	/** `client` için kısa alias. */
	public get prisma(): TClient {
		return this.client;
	}

	/** Ham SQL için PostgreSQL servisi. */
	public get postgres(): Postgres_Service {
		return Postgres_Service.getInstance();
	}

	/** Ham SQL için MSSQL servisi. */
	public get mssql(): MSSQL_Service {
		return MSSQL_Service.getInstance();
	}

	/** Provider'a göre ham SQL servisi. */
	public get sql(): Postgres_Service | MSSQL_Service {
		return this.provider === "mssql" ? this.mssql : this.postgres;
	}

	// ------------------------------------------------------------------
	private createClient(): TClient {
		const Ctor = this.clientCtor ?? this.resolveClientCtor();
		if (!Ctor) throw new Error("DatabaseManager: PrismaClient bulunamadı. `utilities.database.use(PrismaClient)` ile kaydet ya da `config.database.prisma.clientPath` alanını ayarla.");

		const clientOptions: Record<string, any> = { ...(this.options.clientOptions ?? {}) };
		const adapter = this.options.disableAdapter ? null : this.createAdapter();

		if (adapter) clientOptions.adapter = adapter;
		else if (process.env.DATABASE_URL) clientOptions.datasources = { db: { url: process.env.DATABASE_URL } };

		log.debug(`DatabaseManager: Prisma client oluşturuluyor (provider: ${this.provider}, adapter: ${adapter ? "aktif" : "pasif"})`);
		return new Ctor(clientOptions);
	}

	private resolveClientCtor(): PrismaClientConstructor<TClient> | null {
		const candidates = [(config as any)?.database?.prisma?.clientPath, "@prisma/client"].filter(Boolean) as string[];

		for (const candidate of candidates) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const mod = require(candidate);
				const Ctor = mod?.PrismaClient ?? mod?.default?.PrismaClient;
				if (typeof Ctor === "function") return Ctor as PrismaClientConstructor<TClient>;
			} catch {
				/* sıradaki adaya geç */
			}
		}
		return null;
	}

	private createAdapter(): any | null {
		try {
			if (this.provider === "mssql") {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const { PrismaMssql } = require("@prisma/adapter-mssql");
				return new PrismaMssql(MSSQL_Service.getPoolConfig());
			}
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { PrismaPg } = require("@prisma/adapter-pg");
			return new PrismaPg(Postgres_Service.getPoolConfig());
		} catch (err) {
			log.warn("DatabaseManager: Prisma adapter yüklenemedi, DATABASE_URL üzerinden bağlanılacak.", (err as Error)?.message);
			return null;
		}
	}

	// ------------------------------------------------------------------
	/** Ham SQL sorgusu (provider'a göre doğru servise yönlendirir). */
	public async query<T = any>(text: string, params?: any[]): Promise<T[]> {
		return this.sql.query<T>(text, params);
	}

	public async healthCheck(): Promise<boolean> {
		try {
			await (this.client as any).$queryRaw`SELECT 1`;
			return true;
		} catch (err) {
			log.error("DatabaseManager: healthCheck başarısız.", err);
			return false;
		}
	}

	/** Prisma client'ı ve açık pool'ları kapatır. */
	public async close(): Promise<void> {
		if (this.clientInstance) {
			try {
				await (this.clientInstance as any).$disconnect?.();
			} catch (err) {
				log.error("DatabaseManager: Prisma disconnect hatası.", err);
			}
			this.clientInstance = null;
			log.info("Prisma client disconnected");
		}

		await Promise.allSettled([Postgres_Service.getInstance().close(), MSSQL_Service.getInstance().close()]);
	}

	/** Config değiştiğinde client'ı yeniden kurmak için. */
	public async reconnect(): Promise<TClient> {
		await this.close();
		return this.client;
	}
}

export const database = new DatabaseManager();
export default database;
