import { baseCfg } from "../../config/access";
import { log } from "../../util/logger";
import { requireFromApp } from "../../util/require";
import type MssqlService from "./Mssql.Service";
import type PostgresService from "./Postgres.Service";

/**
 * `mssql` ve `pg`, sadece o an seçili olan provider için ve sadece adapter
 * gerçekten kurulmaya çalışıldığında require edilir. Böylece postgres
 * kullanan bir proje mssql paketini kurmak zorunda kalmaz (ve tersi).
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const loadMssql = (): typeof MssqlService => require("./Mssql.Service").default;
const loadPostgres = (): typeof PostgresService => require("./Postgres.Service").default;
/* eslint-enable @typescript-eslint/no-require-imports */

export type DatabaseProvider = "postgres" | "mssql";

export interface PrismaClientConstructor<TClient = any> {
	new (options?: any): TClient;
}

export interface PrismaServiceOptions<TClient = any> {
	/** Generated PrismaClient sınıfı. Verilmezse `config.database.prisma.clientPath` üzerinden dinamik yüklenir. */
	client?: PrismaClientConstructor<TClient>;
	/** "postgres" | "mssql". Verilmezse config.database.provider (env: DATABASE_TYPE) kullanılır. */
	provider?: DatabaseProvider;
	/** PrismaClient'a geçilecek ek seçenekler (log, errorFormat, accelerateUrl vs.). */
	clientOptions?: Record<string, any>;
	/**
	 * Driver adapter kullanma. PrismaClient sadece `clientOptions` ile oluşturulur.
	 * - Prisma 6 ve öncesi (engine tabanlı client): bağlantı schema.prisma'daki `url` (örn. env("DATABASE_URL")) ile kurulur.
	 * - Prisma 7: adapter zorunludur; adapter'sız kullanım sadece `clientOptions: { accelerateUrl }` ile mümkündür.
	 */
	disableAdapter?: boolean;
	/**
	 * Driver adapter'ı uygulama oluşturur (paket `requireFromApp` ile aranmaz). Bağlantı ayarları yine config'ten gelir:
	 *
	 *   import { PrismaMssql } from "@prisma/adapter-mssql";
	 *   service.prisma.use(PrismaClient, { adapterFactory: ({ poolConfig }) => new PrismaMssql(poolConfig) });
	 *
	 * Tek dosyalık derlemelerde (`bun build --compile`, pkg vb.) gereklidir: dinamik `require` ile aranan adapter paketi
	 * pakete gömülmez, statik import edilen gömülür.
	 */
	adapterFactory?: (context: { provider: DatabaseProvider; poolConfig: any }) => any;
}

/**
 * `service.prisma` singleton'ının varsayılan client tipi. Boş interface
 * olduğu için `service.prisma.client` varsayılan olarak `{}` (üye yok) verir.
 *
 * Tüketici proje "declaration merging" ile doldurursa, `service.prisma.use(PrismaClient)`
 * çağrıldıktan sonra `.use()` DÖNÜŞÜNÜ ayrı bir değişkende tutmaya gerek kalmadan,
 * doğrudan `service.prisma.client.` üzerinde tam IntelliSense/autocomplete çalışır:
 *
 *   // src/types/cagdu-utilities.d.ts
 *   import type { PrismaClient } from "../prisma/generated/prisma/client";
 *
 *   declare module "cagdu-utilities" {
 *       interface RegisteredPrismaClient extends PrismaClient {}
 *   }
 */
export interface RegisteredPrismaClient {}

/**
 * ============================================================
 *  PRISMA SERVİSİ
 * ============================================================
 *  1. Generated PrismaClient import EDİLMEZ. O sınıf tüketici projede
 *     üretildiği için dışarıdan `register()` ile verilir; böylece tip
 *     güvenliği kaybolmadan paket tüketiciye bağımlı olmaz.
 *  2. Adapter paketleri (@prisma/adapter-pg / -mssql) lazy require edilir.
 *     Kurulu değillerse ne yapılması gerektiğini söyleyen net bir hata fırlatılır.
 *  3. Provider seçimi: register() seçeneği > config.database.provider (env: DATABASE_TYPE).
 *  4. Client LAZY oluşturulur: ilk `client` erişiminde.
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

	private constructor() {}

	/**
	 * Generated PrismaClient sınıfını (ve isteğe bağlı seçenekleri) kaydeder.
	 * Önceden oluşturulmuş bir client varsa bağlantısı kapatılır. Tipli servisi geri döner.
	 */
	public static register<T>(client: PrismaClientConstructor<T>, options: Omit<PrismaServiceOptions<T>, "client"> = {}): typeof PrismaService & { getInstance(): PrismaService<T> } {
		PrismaService.ctor = client;
		PrismaService.options = { ...PrismaService.options, ...options };
		PrismaService.disposeClient();
		return PrismaService as typeof PrismaService & { getInstance(): PrismaService<T> };
	}

	/** Sadece seçenekleri güncellemek için. Önceden oluşturulmuş bir client varsa bağlantısı kapatılır. */
	public static configure(options: PrismaServiceOptions<any>): void {
		if (options.client) PrismaService.ctor = options.client;
		PrismaService.options = { ...PrismaService.options, ...options };
		PrismaService.disposeClient();
	}

	public static getInstance<T = any>(): PrismaService<T> {
		if (!PrismaService.instance) PrismaService.instance = new PrismaService<T>();
		return PrismaService.instance as PrismaService<T>;
	}

	/** Aktif provider. */
	public static getProvider(): DatabaseProvider {
		const value = PrismaService.options.provider ?? baseCfg().database.provider;
		return value === "mssql" ? "mssql" : "postgres";
	}

	public get provider(): DatabaseProvider {
		return PrismaService.getProvider();
	}

	/** Prisma client. İlk erişimde oluşturulur. */
	public get client(): TClient {
		if (!PrismaService.client) PrismaService.client = PrismaService.createClient();
		return PrismaService.client as TClient;
	}

	/** Mevcut client'ı bırakır ve bağlantısını arka planda kapatır (register/configure sonrası sızıntıyı önler). */
	private static disposeClient(): void {
		const old = PrismaService.client;
		PrismaService.client = null;
		PrismaService.instance = null;
		if (old && typeof old.$disconnect === "function") {
			Promise.resolve(old.$disconnect()).catch((err: unknown) => log.warn("PrismaService: eski client kapatılırken hata.", err));
		}
	}

	// ------------------------------------------------------------------
	private static createClient(): any {
		const Ctor = PrismaService.ctor ?? PrismaService.resolveCtor();
		if (!Ctor) throw new Error("PrismaService: PrismaClient bulunamadı. `service.prisma.use(PrismaClient)` ile kaydet ya da `config.database.prisma.clientPath` alanını ayarla.");

		const clientOptions: Record<string, any> = { ...(PrismaService.options.clientOptions ?? {}) };

		if (!PrismaService.options.disableAdapter) {
			const provider = PrismaService.getProvider();
			const { adapter, loadError } = PrismaService.createAdapter();

			if (!adapter) {
				const pkg = provider === "mssql" ? "@prisma/adapter-mssql" : "@prisma/adapter-pg";
				const driverPkg = provider === "mssql" ? "mssql" : "pg";
				// NOT: driver adapter kullanan generated client'lar SADECE `adapter` seçeneğini kabul eder;
				// adapter'sız sessizce devam etmek Prisma runtime'ında anlaşılması zor bir hatayla çöker.
				throw new Error(
					`PrismaService: '${pkg}' (ve '${driverPkg}') paketleri bulunamadı/yüklenemedi. ` +
						`Kur: npm i ${pkg} ${driverPkg}. Adapter kullanmak istemiyorsan ` +
						`service.prisma.use(PrismaClient, { disableAdapter: true }) ver ` +
						`(Prisma 6 ve öncesinde schema.prisma'daki url kullanılır; Prisma 7'de clientOptions.accelerateUrl gerekir). ` +
						`Asıl hata: ${loadError?.message.split("\n")[0]}`,
					{ cause: loadError },
				);
			}

			clientOptions.adapter = adapter;
		}

		log.debug(`PrismaService: client oluşturuluyor (provider: ${PrismaService.getProvider()}, adapter: ${PrismaService.options.disableAdapter ? "pasif" : "aktif"})`);
		return new Ctor(clientOptions);
	}

	private static resolveCtor(): PrismaClientConstructor<any> | null {
		const candidates = [...new Set([baseCfg().database.prisma.clientPath, "@prisma/client"].filter(Boolean))];

		for (const candidate of candidates) {
			try {
				const mod = requireFromApp(candidate);
				const Ctor = mod?.PrismaClient ?? mod?.default?.PrismaClient;
				if (typeof Ctor === "function") return Ctor as PrismaClientConstructor<any>;
			} catch {
				/* sıradaki adaya geç */
			}
		}
		return null;
	}

	/**
	 * `adapter: null` dönüşü SADECE "paket yüklenemedi" (require başarısız) anlamına gelir; `loadError` asıl require hatasıdır.
	 * Paket yüklenip adapter KURULURKEN (constructor) fırlayan hata BİLEREK
	 * yutulmuyor/`null`a çevrilmiyor — aksi halde "paketler kurulu ama yine de
	 * 'bulunamadı' hatası alıyorum" gibi yanıltıcı bir teşhise yol açar. O hata,
	 * gerçek sebebiyle (yanlış config şekli, sürüm uyuşmazlığı vs.) olduğu gibi
	 * yukarı fırlatılır.
	 */
	private static createAdapter(): { adapter: any; loadError?: Error } {
		const provider = PrismaService.getProvider();
		const factory = PrismaService.options.adapterFactory;
		if (factory) return { adapter: factory({ provider, poolConfig: provider === "mssql" ? loadMssql().getPoolConfig() : loadPostgres().getPoolConfig() }) };

		let AdapterCtor: new (poolConfig: any) => any;
		let poolConfig: any;

		try {
			if (provider === "mssql") {
				AdapterCtor = requireFromApp("@prisma/adapter-mssql").PrismaMssql;
				poolConfig = loadMssql().getPoolConfig();
			} else {
				AdapterCtor = requireFromApp("@prisma/adapter-pg").PrismaPg;
				poolConfig = loadPostgres().getPoolConfig();
			}
		} catch (err) {
			log.debug("PrismaService: adapter paketi yüklenemedi.", (err as Error)?.message);
			return { adapter: null, loadError: err instanceof Error ? err : new Error(String(err)) };
		}

		return { adapter: new AdapterCtor(poolConfig) };
	}

	// ------------------------------------------------------------------
	async healthCheck(): Promise<boolean> {
		try {
			await (this.client as any).$queryRaw`SELECT 1`;
			return true;
		} catch (err) {
			log.warn("PrismaService: healthCheck başarısız.", err);
			return false;
		}
	}

	/** Bağlantıyı önden kurar (lazy connect beklemek istemiyorsan). */
	async connect(): Promise<void> {
		await (this.client as any).$connect?.();
	}

	/** Bağlantıyı kapatır. İdempotent. */
	async close(): Promise<void> {
		const client = PrismaService.client;
		PrismaService.client = null;
		PrismaService.instance = null;
		if (client) {
			await client.$disconnect?.();
			log.info("PrismaService: client bağlantısı kapatıldı.");
		}
	}
}

export default PrismaService;
