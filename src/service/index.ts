/**
 * ============================================================
 *  service  —  HAZIR SERVİSLER
 * ============================================================
 * `services` ham sınıfları verir; `service` ise kurulmuş, yaşam döngüsü
 * metodları standartlaştırılmış örnekleri verir.
 *
 * Her definer aynı arayüzü sunar:
 *   .start()        -> servisi ayağa kaldırır (bağlantı kurar / dinlemeye başlar)
 *   .stop()         -> kapatır
 *   .healthCheck()  -> boolean
 *
 * Örnek:
 *   import { service } from "cagd-utilities";
 *
 *   service.prisma.use(PrismaClient);
 *   await service.prisma.start();
 *   await service.prisma.client.user.findMany();
 *
 *   await service.web.start({ routers: [r_main] });
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

/* eslint-disable @typescript-eslint/no-var-requires */
const load = {
	mssql: (): typeof MssqlService => require("../services/database/Mssql.Service").default,
	mail: (): typeof MailService => require("../services/Mail.Service").default,
	postgres: (): typeof PostgresService => require("../services/database/Postgres.Service").default,
	prisma: (): typeof PrismaService => require("../services/database/Prisma.Service").default,
	redis: (): typeof RedisService => require("../services/Redis.Service").default,
	web: (): typeof WebService => require("../services/http/Web.Service").default,
};
/* eslint-enable @typescript-eslint/no-var-requires */

/** Her hazır servisin ortak arayüzü. */
export interface ServiceDefiner {
	readonly name: string;
	start(options?: unknown): Promise<void>;
	stop(): Promise<void>;
	healthCheck(): Promise<boolean>;
	readonly started: boolean;
}

// ------------------------------------------------------------------
// Prisma  ->  service.prisma
// ------------------------------------------------------------------
class PrismaDefiner<TClient = RegisteredPrismaClient> implements ServiceDefiner {
	readonly name = "prisma";
	private connected = false;

	/** Generated PrismaClient sınıfını kaydeder ve TİPLİ definer döner. */
	use<T>(client: PrismaClientConstructor<T>, options: Omit<PrismaServiceOptions<T>, "client"> = {}): PrismaDefiner<T> {
		load.prisma().register(client, options);
		this.connected = false;
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

	get started(): boolean {
		return this.connected;
	}

	async start(): Promise<void> {
		await this.instance.connect();
		this.connected = true;
		log.info(`Prisma connected (provider: ${this.provider})`);
	}

	async stop(): Promise<void> {
		await this.instance.close();
		this.connected = false;
	}

	async healthCheck(): Promise<boolean> {
		return this.instance.healthCheck();
	}
}

// ------------------------------------------------------------------
// Web  ->  service.web
// ------------------------------------------------------------------
class WebDefiner implements ServiceDefiner {
	readonly name = "web";
	private running = false;
	private options: WebServiceOptions = {};

	/** Router'lar vb. ayarları önceden vermek için (start() içinde de verilebilir). */
	configure(options: WebServiceOptions): this {
		this.options = { ...this.options, ...options };
		load.web().reset();
		return this;
	}

	get instance(): WebService {
		return load.web().getInstance(this.options);
	}

	/** Alttaki Express uygulaması (router eklemek vb. için). */
	get app(): Express | undefined {
		return this.options.app as Express | undefined;
	}

	get server() {
		return this.instance.getServer();
	}

	get started(): boolean {
		return this.running;
	}

	async start(options?: WebServiceOptions): Promise<void> {
		if (options) this.configure(options);
		await this.instance.start();
		this.running = true;
	}

	async stop(): Promise<void> {
		if (!this.running) return;
		await this.instance.stop();
		this.running = false;
		load.web().reset();
	}

	async healthCheck(): Promise<boolean> {
		return this.running && this.instance.getServer().listening;
	}
}

// ------------------------------------------------------------------
// Redis / Postgres / MSSQL / Mail
// ------------------------------------------------------------------
class RedisDefiner implements ServiceDefiner {
	readonly name = "redis";
	private connected = false;

	get instance(): RedisService {
		return load.redis().getInstance();
	}

	/** Ham redis client. */
	get client() {
		return this.instance.client;
	}

	get started(): boolean {
		return this.connected;
	}

	async start(): Promise<void> {
		await this.instance.connect();
		this.connected = true;
	}

	async stop(): Promise<void> {
		await this.instance.close();
		this.connected = false;
	}

	async healthCheck(): Promise<boolean> {
		return this.instance.healthCheck();
	}
}

class PostgresDefiner implements ServiceDefiner {
	readonly name = "postgres";
	private connected = false;

	get instance(): PostgresService {
		return load.postgres().getInstance();
	}

	get started(): boolean {
		return this.connected;
	}

	async start(): Promise<void> {
		await this.instance.query("SELECT 1");
		this.connected = true;
	}

	async stop(): Promise<void> {
		await this.instance.close();
		this.connected = false;
	}

	async healthCheck(): Promise<boolean> {
		return this.instance.healthCheck();
	}
}

class MssqlDefiner implements ServiceDefiner {
	readonly name = "mssql";
	private connected = false;

	get instance(): MssqlService {
		return load.mssql().getInstance();
	}

	get started(): boolean {
		return this.connected;
	}

	async start(): Promise<void> {
		await this.instance.query("SELECT 1");
		this.connected = true;
	}

	async stop(): Promise<void> {
		await this.instance.close();
		this.connected = false;
	}

	async healthCheck(): Promise<boolean> {
		return this.instance.healthCheck();
	}
}

class MailDefiner implements ServiceDefiner {
	readonly name = "mail";
	private ready = false;

	get instance(): MailService {
		return load.mail().getInstance();
	}

	get transporter() {
		return this.instance.transporter;
	}

	get started(): boolean {
		return this.ready;
	}

	async start(): Promise<void> {
		this.ready = await this.instance.healthCheck();
		if (!this.ready) log.warn("MailService: SMTP doğrulaması başarısız.");
	}

	async stop(): Promise<void> {
		await this.instance.close();
		this.ready = false;
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

const all: ServiceDefiner[] = [prisma, web, redis, postgres, mssql, mail];

/** Verilen servisleri sırayla başlatır. Hiçbiri verilmezse hiçbir şey yapmaz. */
export async function start(...names: Array<ServiceDefiner["name"]>): Promise<void> {
	for (const definer of all.filter(d => names.includes(d.name))) {
		try {
			await definer.start();
		} catch (err) {
			log.error(`service.${definer.name}: başlatılamadı.`, err);
			throw err;
		}
	}
}

/** Başlatılmış tüm servisleri kapatır (SIGTERM/SIGINT için). */
export async function stopAll(): Promise<void> {
	await Promise.allSettled(all.filter(d => d.started).map(d => d.stop()));
}

/** Başlatılmış servislerin sağlık durumu. */
export async function healthCheckAll(): Promise<Record<string, boolean>> {
	const entries = await Promise.all(all.filter(d => d.started).map(async d => [d.name, await d.healthCheck().catch(() => false)] as const));
	return Object.fromEntries(entries);
}

export default { prisma, database, web, redis, postgres, mssql, mail, start, stopAll, healthCheckAll };
