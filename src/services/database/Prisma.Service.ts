import { config } from "../../config";
import { log } from "../../util/logger";
import type MssqlService from "./Mssql.Service";
import type PostgresService from "./Postgres.Service";

/**
 * `mssql` ve `pg`, sadece o an seçili olan provider için ve sadece adapter
 * gerçekten kurulmaya çalışıldığında require edilir. Böylece postgres
 * kullanan bir proje mssql paketini kurmak zorunda kalmaz (ve tersi).
 */
/* eslint-disable @typescript-eslint/no-var-requires */
const loadMssql = (): typeof MssqlService => require("./Mssql.Service").default;
const loadPostgres = (): typeof PostgresService => require("./Postgres.Service").default;
/* eslint-enable @typescript-eslint/no-var-requires */

export type DatabaseProvider = "postgres" | "mssql";

export interface PrismaClientConstructor<TClient = any> {
	new (options?: any): TClient;
}

export interface PrismaServiceOptions<TClient = any> {
	/** Generated PrismaClient sınıfı. Verilmezse `config.database.prisma.clientPath` üzerinden dinamik yüklenir. */
	client?: PrismaClientConstructor<TClient>;
	/** "postgres" | "mssql". Verilmezse config.database.provider ya da DATABASE_TYPE kullanılır. */
	provider?: DatabaseProvider;
	/** PrismaClient'a geçilecek ek seçenekler (log, errorFormat vs.). */
	clientOptions?: Record<string, any>;
	/** Adapter kullanma, doğrudan DATABASE_URL ile bağlan. */
	disableAdapter?: boolean;
}

/**
 * `service.prisma` singleton'ının varsayılan client tipi. Boş interface
 * olduğu için `service.prisma.client` varsayılan olarak `{}` (üye yok) verir.
 *
 * Tüketici proje "declaration merging" ile doldurursa, `service.prisma.use(PrismaClient)`
 * çağrıldıktan sonra `.use()` DÖNÜŞÜNÜ ayrı bir değişkende tutmaya gerek kalmadan,
 * doğrudan `service.prisma.client.` üzerinde tam IntelliSense/autocomplete çalışır:
 *
 *   // src/types/cagd-utilities.d.ts
 *   import type { PrismaClient } from "../prisma/generated/prisma/client";
 *
 *   declare module "cagd-utilities" {
 *       interface RegisteredPrismaClient extends PrismaClient {}
 *   }
 */
export interface RegisteredPrismaClient {}

/**
 * ============================================================
 *  PRISMA SERVİSİ
 * ============================================================
 * Orijinal PrismaService ile aynı desen (private constructor + static
 * singleton), ancak paket haline gelebilmesi için üç fark var:
 *
 *  1. Generated PrismaClient import EDİLMEZ. O sınıf tüketici projede
 *     üretildiği için dışarıdan `register()` ile verilir; böylece tip
 *     güvenliği kaybolmadan paket tüketiciye bağımlı olmaz.
 *  2. Adapter paketleri (@prisma/adapter-pg / -mssql) lazy require edilir.
 *     Kurulu değillerse DATABASE_URL üzerinden bağlanmaya düşer.
 *  3. Provider seçimi önce config.database.provider, sonra
 *     process.env.DATABASE_TYPE üzerinden yapılır.
 *
 *   import { PrismaClient } from "../prisma/generated/prisma/client";
 *   PrismaService.register(PrismaClient);
 *   const db = PrismaService.getInstance();
 *   await db.client.user.findMany();
 */
export class PrismaService<TClient = any> {
	private static instance: PrismaService<any> | null = null;
	private static client: any = null;
	private static ctor: PrismaClientConstructor<any> | null = null;
	private static options: PrismaServiceOptions<any> = {};

	private constructor() {
		if (!PrismaService.client) PrismaService.client = PrismaService.createClient();
	}

	/**
	 * Generated PrismaClient sınıfını (ve isteğe bağlı seçenekleri) kaydeder.
	 * getInstance()'tan ÖNCE çağrılmalıdır. Tipli servisi geri döner.
	 */
	public static register<T>(client: PrismaClientConstructor<T>, options: Omit<PrismaServiceOptions<T>, "client"> = {}): typeof PrismaService & { getInstance(): PrismaService<T> } {
		PrismaService.ctor = client;
		PrismaService.options = { ...PrismaService.options, ...options };
		PrismaService.client = null;
		PrismaService.instance = null;
		return PrismaService as typeof PrismaService & { getInstance(): PrismaService<T> };
	}

	/** Sadece seçenekleri güncellemek için. */
	public static configure(options: PrismaServiceOptions<any>): void {
		if (options.client) PrismaService.ctor = options.client;
		PrismaService.options = { ...PrismaService.options, ...options };
		PrismaService.client = null;
		PrismaService.instance = null;
	}

	public static getInstance<T = any>(): PrismaService<T> {
		if (!PrismaService.instance) PrismaService.instance = new PrismaService<T>();
		return PrismaService.instance as PrismaService<T>;
	}

	/** Aktif provider. */
	public static getProvider(): DatabaseProvider {
		const value = PrismaService.options.provider ?? (config as any)?.database?.provider ?? process.env.DATABASE_TYPE ?? "postgres";
		return value === "mssql" ? "mssql" : "postgres";
	}

	public get provider(): DatabaseProvider {
		return PrismaService.getProvider();
	}

	public get client(): TClient {
		if (!PrismaService.client) throw new Error("Prisma client is not initialized");
		return PrismaService.client as TClient;
	}

	// ------------------------------------------------------------------
	private static createClient(): any {
		const Ctor = PrismaService.ctor ?? PrismaService.resolveCtor();
		if (!Ctor) throw new Error("PrismaService: PrismaClient bulunamadı. `PrismaService.register(PrismaClient)` ile kaydet ya da `config.database.prisma.clientPath` alanını ayarla.");

		const clientOptions: Record<string, any> = { ...(PrismaService.options.clientOptions ?? {}) };
		const adapter = PrismaService.options.disableAdapter ? null : PrismaService.createAdapter();

		if (adapter) clientOptions.adapter = adapter;
		else if (process.env.DATABASE_URL) clientOptions.datasources = { db: { url: process.env.DATABASE_URL } };

		log.debug(`PrismaService: client oluşturuluyor (provider: ${PrismaService.getProvider()}, adapter: ${adapter ? "aktif" : "pasif"})`);
		return new Ctor(clientOptions);
	}

	private static resolveCtor(): PrismaClientConstructor<any> | null {
		const candidates = [(config as any)?.database?.prisma?.clientPath, "@prisma/client"].filter(Boolean) as string[];

		for (const candidate of candidates) {
			try {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const mod = require(candidate);
				const Ctor = mod?.PrismaClient ?? mod?.default?.PrismaClient;
				if (typeof Ctor === "function") return Ctor as PrismaClientConstructor<any>;
			} catch {
				/* sıradaki adaya geç */
			}
		}
		return null;
	}

	private static createAdapter(): any | null {
		try {
			if (PrismaService.getProvider() === "mssql") {
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const { PrismaMssql } = require("@prisma/adapter-mssql");
				return new PrismaMssql(loadMssql().getPoolConfig());
			}
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { PrismaPg } = require("@prisma/adapter-pg");
			return new PrismaPg(loadPostgres().getPoolConfig());
		} catch (err) {
			log.warn("PrismaService: adapter yüklenemedi, DATABASE_URL üzerinden bağlanılacak.", (err as Error)?.message);
			return null;
		}
	}

	// ------------------------------------------------------------------
	async healthCheck(): Promise<boolean> {
		try {
			await (this.client as any).$queryRaw`SELECT 1`;
			return true;
		} catch (err) {
			log.error("PrismaService: healthCheck başarısız.", err);
			return false;
		}
	}

	/** Bağlantıyı önden kurar (lazy connect beklemek istemiyorsan). */
	async connect(): Promise<void> {
		await (this.client as any).$connect?.();
	}

	async close(): Promise<void> {
		if (PrismaService.client) {
			await PrismaService.client.$disconnect?.();
			PrismaService.client = null;
			PrismaService.instance = null;
			log.info("Prisma client disconnected");
		}
	}
}

export default PrismaService;
