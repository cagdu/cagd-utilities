/**
 * ============================================================
 *  service  —  HAZIR SERVİSLER
 * ============================================================
 * `services` ham sınıfları verir; `service` ise kurulmuş, yaşam döngüsü
 * metodları standartlaştırılmış örnekleri verir.
 *
 * Her definer aynı arayüzü sunar:
 *   .start()        -> servisi ayağa kaldırır (bağlantı kurar / dinlemeye başlar), başarısızsa throw
 *   .stop()         -> kapatır (idempotent)
 *   .healthCheck()  -> boolean (asla throw etmez)
 *   .started        -> başarıyla başlatıldı mı
 *
 * Örnek:
 *   import { service, util } from "cagd-utilities";
 *
 *   service.prisma.use(PrismaClient);
 *   service.web.configure({ routers: [["/api", util.http.healthRouter()]] });
 *   await service.bootstrap(["prisma", "redis", "web"]); // sırayla başlatır + SIGTERM/SIGINT'te kapatır
 *
 * TÜM erişimler lazy'dir: sadece import etmek hiçbir bağlantı açmaz.
 */
import { log } from "../util/logger";

// SADECE TİPLER — bunlar derleme zamanında silinir, runtime'da hiçbir
// require() tetiklemez. Gerçek sınıflar aşağıda ilgili getter'larda
// `require()` ile İHTİYAÇ ANINDA yüklenir. Böylece örn. `mssql` paketini
// hiç kurmayan bir proje sadece `import { service } from "cagd-utilities"`
// yazdığında hata almaz; `service.mssql`'e dokunmadıkça mssql hiç aranmaz.
import type MssqlService from "../services/database/Mssql.Service";
import type MailService from "../services/Mail.Service";
import type PostgresService from "../services/database/Postgres.Service";
import type PrismaService from "../services/database/Prisma.Service";
import type { PrismaClientConstructor, PrismaServiceOptions, RegisteredPrismaClient } from "../services/database/Prisma.Service";
import type RedisService from "../services/Redis.Service";
import type WebService from "../services/http/Web.Service";
import type { WebServiceOptions } from "../services/http/Web.Service";
import type { Express } from "../services/http/Express.Service";

/* eslint-disable @typescript-eslint/no-require-imports */
const load = {
	mssql: (): typeof MssqlService => require("../services/database/Mssql.Service").default,
	mail: (): typeof MailService => require("../services/Mail.Service").default,
	postgres: (): typeof PostgresService => require("../services/database/Postgres.Service").default,
	prisma: (): typeof PrismaService => require("../services/database/Prisma.Service").default,
	redis: (): typeof RedisService => require("../services/Redis.Service").default,
	web: (): typeof WebService => require("../services/http/Web.Service").default,
};
/* eslint-enable @typescript-eslint/no-require-imports */

/** Hazır servis adları. */
export type ServiceName = "prisma" | "web" | "redis" | "postgres" | "mssql" | "mail";

/** Her hazır servisin ortak arayüzü. */
export interface ServiceDefiner {
	readonly name: ServiceName;
	start(options?: unknown): Promise<void>;
	stop(): Promise<void>;
	healthCheck(): Promise<boolean>;
	readonly started: boolean;
}

/** Başlatılma sırası. stopAll() bunun TERSİYLE kapatır. */
const startedStack: ServiceDefiner[] = [];

/** Ortak yaşam döngüsü: idempotent start/stop + başlatılma sırasının takibi. */
abstract class Definer implements ServiceDefiner {
	abstract readonly name: ServiceName;
	private running = false;

	protected abstract doStart(options?: unknown): Promise<void>;
	protected abstract doStop(): Promise<void>;
	abstract healthCheck(): Promise<boolean>;

	get started(): boolean {
		return this.running;
	}

	async start(options?: unknown): Promise<void> {
		if (this.running) return;
		await this.doStart(options);
		this.running = true;
		startedStack.push(this);
	}

	/** Kapatır. Başlatılmamış olsa bile (örn. healthCheck ile açılmış) kaynakları serbest bırakır. */
	async stop(): Promise<void> {
		try {
			await this.doStop();
		} finally {
			this.markStopped();
		}
	}

	/** Kaynak zaten başka yoldan kapatıldığında durumu "başlatılmamış" olarak işaretler. */
	protected markStopped(): void {
		this.running = false;
		const idx = startedStack.indexOf(this);
		if (idx !== -1) startedStack.splice(idx, 1);
	}
}

// ------------------------------------------------------------------
// Prisma  ->  service.prisma
// ------------------------------------------------------------------
class PrismaDefiner<TClient = RegisteredPrismaClient> extends Definer {
	readonly name = "prisma" as const;

	/**
	 * Generated PrismaClient sınıfını kaydeder ve TİPLİ definer döner.
	 * Daha önce oluşturulmuş bir client varsa bağlantısı kapatılır; çalışıyorsa tekrar start() gerekir.
	 */
	use<T>(client: PrismaClientConstructor<T>, options: Omit<PrismaServiceOptions<T>, "client"> = {}): PrismaDefiner<T> {
		if (this.started) log.warn("service.prisma: çalışırken use() çağrıldı; eski client kapatılıyor, tekrar start() edin.");
		load.prisma().register(client, options); // eski client'ın bağlantısını kapatır
		this.markStopped();
		return this as unknown as PrismaDefiner<T>;
	}

	/** Prisma client. `use()` çağrılmadıysa config.database.prisma.clientPath'ten yüklenir. */
	get client(): TClient {
		return load.prisma().getInstance<TClient>().client;
	}

	/** Alt seviye servis örneği. */
	get instance(): PrismaService<TClient> {
		return load.prisma().getInstance<TClient>();
	}

	get provider() {
		return load.prisma().getProvider();
	}

	protected async doStart(): Promise<void> {
		await this.instance.connect();
		log.info(`service.prisma: bağlandı (provider: ${this.provider}).`);
	}

	protected async doStop(): Promise<void> {
		await this.instance.close();
	}

	async healthCheck(): Promise<boolean> {
		return this.instance.healthCheck();
	}
}

// ------------------------------------------------------------------
// Web  ->  service.web
// ------------------------------------------------------------------
class WebDefiner extends Definer {
	readonly name = "web" as const;
	private options: WebServiceOptions = {};

	/** Router'lar vb. ayarları önceden vermek için (start() içinde de verilebilir). Sunucu çalışırken çağrılamaz. */
	configure(options: WebServiceOptions): this {
		if (this.started) throw new Error("service.web: sunucu çalışırken configure() çağrılamaz; önce stop() edin.");
		this.options = { ...this.options, ...options };
		load.web().reset();
		return this;
	}

	get instance(): WebService {
		return load.web().getInstance(this.options);
	}

	/** Sunucuya bağlı Express uygulaması (createExpressApp() ile oluşturulan ya da `app` ile verilen). */
	get app(): Express {
		return this.instance.getApp() as unknown as Express;
	}

	get server() {
		return this.instance.getServer();
	}

	async start(options?: WebServiceOptions): Promise<void> {
		if (options) this.configure(options);
		await super.start();
	}

	protected async doStart(): Promise<void> {
		await this.instance.start();
	}

	protected async doStop(): Promise<void> {
		const instance = load.web().peek();
		if (instance) await instance.stop();
		load.web().reset();
	}

	async healthCheck(): Promise<boolean> {
		return this.started && this.instance.getServer().listening;
	}
}

// ------------------------------------------------------------------
// Redis / Postgres / MSSQL / Mail
// ------------------------------------------------------------------
class RedisDefiner extends Definer {
	readonly name = "redis" as const;

	get instance(): RedisService {
		return load.redis().getInstance();
	}

	/** Ham redis client. */
	get client() {
		return this.instance.client;
	}

	protected async doStart(): Promise<void> {
		await this.instance.connect();
	}

	protected async doStop(): Promise<void> {
		await this.instance.close();
	}

	async healthCheck(): Promise<boolean> {
		return this.instance.healthCheck();
	}
}

class PostgresDefiner extends Definer {
	readonly name = "postgres" as const;

	get instance(): PostgresService {
		return load.postgres().getInstance();
	}

	protected async doStart(): Promise<void> {
		await this.instance.connect();
	}

	protected async doStop(): Promise<void> {
		await this.instance.close();
	}

	async healthCheck(): Promise<boolean> {
		return this.instance.healthCheck();
	}
}

class MssqlDefiner extends Definer {
	readonly name = "mssql" as const;

	get instance(): MssqlService {
		return load.mssql().getInstance();
	}

	protected async doStart(): Promise<void> {
		await this.instance.connect();
	}

	protected async doStop(): Promise<void> {
		await this.instance.close();
	}

	async healthCheck(): Promise<boolean> {
		return this.instance.healthCheck();
	}
}

class MailDefiner extends Definer {
	readonly name = "mail" as const;

	get instance(): MailService {
		return load.mail().getInstance();
	}

	get transporter() {
		return this.instance.transporter;
	}

	/** SMTP bağlantısını doğrular; başarısızsa diğer servisler gibi hata fırlatır. */
	protected async doStart(): Promise<void> {
		await this.instance.connect();
	}

	protected async doStop(): Promise<void> {
		await this.instance.close();
	}

	async healthCheck(): Promise<boolean> {
		return this.instance.healthCheck();
	}

	/** Mail gönderir. */
	send(...args: Parameters<MailService["send"]>) {
		return this.instance.send(...args);
	}
}

// ------------------------------------------------------------------
export const prisma = new PrismaDefiner();
export const web = new WebDefiner();
export const redis = new RedisDefiner();
export const postgres = new PostgresDefiner();
export const mssql = new MssqlDefiner();
export const mail = new MailDefiner();

/** `service.prisma` için okunabilir alias. */
export const database = prisma;

const registry: Record<ServiceName, ServiceDefiner> = { prisma, web, redis, postgres, mssql, mail };

/**
 * Verilen servisleri VERİLEN SIRAYLA başlatır. Bilinmeyen bir ad verilirse hiçbir servis
 * başlatılmadan hata fırlatır. Bir servis başarısız olursa sonrakiler denenmez ve hata fırlatılır
 * (o ana kadar başlatılanlar açık kalır; kapatmak için stopAll() ya da bootstrap() kullan).
 */
export async function start(...names: ServiceName[]): Promise<void> {
	const unknown = names.filter(name => !(name in registry));
	if (unknown.length > 0) throw new Error(`service.start: bilinmeyen servis adı: ${unknown.join(", ")}. Geçerli adlar: ${Object.keys(registry).join(", ")}`);

	for (const name of names) {
		const definer = registry[name];
		try {
			await definer.start();
		} catch (err) {
			log.error(`service.${definer.name}: başlatılamadı.`, err);
			throw err;
		}
	}
}

/**
 * Başlatılmış tüm servisleri başlatılma sırasının TERSİYLE, sırayla kapatır
 * (önce web yeni istek kabulünü durdurur, sonra veritabanları kapanır).
 * Bir servis kapanırken hata verse bile diğerleri kapatılır; sonunda hatalar `AggregateError` olarak fırlatılır.
 */
export async function stopAll(): Promise<void> {
	const errors: unknown[] = [];
	for (const definer of [...startedStack].reverse()) {
		try {
			await definer.stop();
		} catch (err) {
			log.error(`service.${definer.name}: kapatılırken hata.`, err);
			errors.push(err);
		}
	}
	if (errors.length > 0) throw new AggregateError(errors, `service.stopAll: ${errors.length} servis düzgün kapatılamadı.`);
}

/** Başlatılmış servislerin sağlık durumu. */
export async function healthCheckAll(): Promise<Partial<Record<ServiceName, boolean>>> {
	const entries = await Promise.all(startedStack.map(async d => [d.name, await d.healthCheck().catch(() => false)] as const));
	return Object.fromEntries(entries);
}

// ------------------------------------------------------------------
// Kapanış (graceful shutdown) ve açılış (bootstrap)
// ------------------------------------------------------------------
export interface ShutdownOptions {
	/** Dinlenecek sinyaller. Varsayılan: ["SIGTERM", "SIGINT"] */
	signals?: NodeJS.Signals[];
	/** uncaughtException / unhandledRejection'da da (exit code 1 ile) kapatılsın mı? Varsayılan: true */
	handleErrors?: boolean;
	/** Kapanış bu süreyi aşarsa süreç zorla sonlandırılır (ms). Varsayılan: 15000 */
	timeoutMs?: number;
	/** Servisler kapatılmadan ÖNCE çalışacak kendi temizlik işin (örn. kuyruk tüketicisini durdurmak). */
	onShutdown?: (reason: string) => void | Promise<void>;
	/** Süreci sonlandıran fonksiyon. Varsayılan: process.exit (testlerde değiştirilebilir). */
	exit?: (code: number) => void;
}

let unregisterSignals: (() => void) | null = null;

/**
 * SIGTERM/SIGINT (Docker stop, PM2, Ctrl+C) ve beklenmeyen hatalarda başlatılmış servisleri
 * sırayla kapatıp süreci sonlandırır. Aynı sinyal iki kez gelirse ikinci kez kapatmaya çalışmaz.
 * Tekrar çağrılırsa önceki kayıt kaldırılır. Kaydı kaldırmak için dönen fonksiyonu çağır.
 */
export function handleSignals(options: ShutdownOptions = {}): () => void {
	unregisterSignals?.();

	const signals = options.signals ?? ["SIGTERM", "SIGINT"];
	const timeoutMs = options.timeoutMs ?? 15000;
	const exit = options.exit ?? ((code: number) => process.exit(code));
	let shuttingDown = false;

	const shutdown = async (reason: string, exitCode: number): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		log.warn(`${reason} alındı, servisler kapatılıyor...`);

		const timer = setTimeout(() => {
			log.error(`Kapanış ${timeoutMs}ms içinde tamamlanmadı, süreç zorla sonlandırılıyor.`);
			exit(exitCode || 1);
		}, timeoutMs);
		timer.unref();

		try {
			await options.onShutdown?.(reason);
			await stopAll();
			log.info("Tüm servisler düzgün kapatıldı.");
		} catch (err) {
			log.error("Servisler kapatılırken hata oluştu:", err);
			exitCode = exitCode || 1;
		} finally {
			clearTimeout(timer);
			exit(exitCode);
		}
	};

	const onSignal = (signal: NodeJS.Signals) => void shutdown(signal, 0);
	const onException = (err: unknown) => {
		log.error("uncaughtException:", err);
		void shutdown("uncaughtException", 1);
	};
	const onRejection = (reason: unknown) => {
		log.error("unhandledRejection:", reason);
		void shutdown("unhandledRejection", 1);
	};

	for (const signal of signals) process.on(signal, onSignal);
	if (options.handleErrors !== false) {
		process.on("uncaughtException", onException);
		process.on("unhandledRejection", onRejection);
	}

	const unregister = () => {
		for (const signal of signals) process.off(signal, onSignal);
		process.off("uncaughtException", onException);
		process.off("unhandledRejection", onRejection);
		if (unregisterSignals === unregister) unregisterSignals = null;
	};
	unregisterSignals = unregister;
	return unregister;
}

export interface BootstrapOptions {
	/** Kapanış sinyalleri dinlensin mi (handleSignals)? Nesne verilirse seçenek olarak kullanılır. Varsayılan: true */
	signals?: boolean | ShutdownOptions;
	/** Başlatma başarısız olursa süreç exit code 1 ile sonlandırılsın mı? false ise hata fırlatılır. Varsayılan: true */
	exitOnError?: boolean;
	/** Süreci sonlandıran fonksiyon. Varsayılan: process.exit (testlerde değiştirilebilir). */
	exit?: (code: number) => void;
}

/**
 * Uygulama açılışı: servisleri verilen sırayla başlatır ve kapanış sinyallerini dinler.
 * Bir servis başlatılamazsa hatayı loglar, o ana kadar başlatılanları kapatır ve
 * (process manager'ın yeniden başlatabilmesi için) süreci exit code 1 ile sonlandırır.
 *
 *   await service.bootstrap(["prisma", "redis", "web"]);
 */
export async function bootstrap(names: ServiceName[], options: BootstrapOptions = {}): Promise<void> {
	const exit = options.exit ?? ((code: number) => process.exit(code));

	if (options.signals !== false) handleSignals({ exit, ...(typeof options.signals === "object" ? options.signals : {}) });

	try {
		await start(...names);
	} catch (err) {
		log.error("service.bootstrap: uygulama başlatılamadı, başlatılan servisler kapatılıyor.", err);
		await stopAll().catch(stopErr => log.error("service.bootstrap: kapatma sırasında hata.", stopErr));
		if (options.exitOnError === false) throw err;
		exit(1);
	}
}

export default { prisma, database, web, redis, postgres, mssql, mail, start, stopAll, healthCheckAll, handleSignals, bootstrap };
