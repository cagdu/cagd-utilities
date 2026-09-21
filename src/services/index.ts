/**
 * ============================================================
 *  services  —  HAM SINIFLAR
 * ============================================================
 * Sınıfların kendisi. Örnek oluşturma / yaşam döngüsü sende.
 * Hazır (kurulmuş) örnekler için `service` namespace'ini kullan.
 *
 *   import { services } from "cagd-utilities";
 *   const redis = services.RedisService.getInstance();
 *
 * KLASÖR YAPISI:
 *   database/  -> BaseService, MssqlService, PostgresService, PrismaService
 *   http/      -> AxiosService, WebService, createExpressApp
 *   (kök)      -> MailService, RedisService
 *
 * ÖNEMLİ: Her sınıf kendi paketini (mssql, pg, redis, nodemailer,
 * axios, express...) İHTİYAÇ ANINDA, yani property'e İLK erişimde yükler.
 * Sadece bu dosyayı import etmek, kurmadığın bir paket için hata vermez.
 */
import { BaseService } from "./database/Base.Service";
import type { IDatabaseService } from "./database/Base.Service";
import type MssqlServiceClass from "./database/Mssql.Service";
import type PostgresServiceClass from "./database/Postgres.Service";
import type PrismaServiceClass from "./database/Prisma.Service";
import type { DatabaseProvider, PrismaClientConstructor, PrismaServiceOptions, RegisteredPrismaClient } from "./database/Prisma.Service";
import type AxiosServiceClass from "./http/Axios.Service";
import type { AxiosAgent as AxiosAgentClass, AxiosErrorCode, AxiosServiceOptions, InterceptorError } from "./http/Axios.Service";
import type { createExpressApp as createExpressAppFn, ExpressAppOptions } from "./http/Express.Service";
import type WebServiceClass from "./http/Web.Service";
import type { WebServiceOptions } from "./http/Web.Service";
import type MailServiceClass from "./Mail.Service";
import type RedisServiceClass from "./Redis.Service";

export { BaseService };
export type { AxiosErrorCode, AxiosServiceOptions, DatabaseProvider, ExpressAppOptions, IDatabaseService, InterceptorError, PrismaClientConstructor, PrismaServiceOptions, RegisteredPrismaClient, WebServiceOptions };

// --------------------------------------------------------------------
// `declare const` satırları JS üretmez, sadece tip verir (IntelliSense).
// Gerçek değerler aşağıdaki `defineLazy(...)` ile `exports`e getter
// olarak eklenir.
// --------------------------------------------------------------------
export declare const AxiosService: typeof AxiosServiceClass;
export declare const AxiosAgent: typeof AxiosAgentClass;
export declare const MailService: typeof MailServiceClass;
export declare const MssqlService: typeof MssqlServiceClass;
export declare const PostgresService: typeof PostgresServiceClass;
export declare const PrismaService: typeof PrismaServiceClass;
export declare const RedisService: typeof RedisServiceClass;
export declare const WebService: typeof WebServiceClass;
export declare const createExpressApp: typeof createExpressAppFn;

// Aynı isimler TİP olarak da kullanılabilsin diye: `const db: PostgresService = ...`
export type AxiosService = AxiosServiceClass;
export type AxiosAgent = import("node:https").Agent;
export type MailService = MailServiceClass;
export type MssqlService = MssqlServiceClass;
export type PostgresService = PostgresServiceClass;
export type PrismaService<TClient = any> = PrismaServiceClass<TClient>;
export type RedisService = RedisServiceClass;
export type WebService = WebServiceClass;

/* eslint-disable @typescript-eslint/no-var-requires */
const lazy = <T>(path: string, member = "default"): (() => T) => {
	let cached: T | undefined;
	let loaded = false;
	return () => {
		if (!loaded) {
			cached = require(path)[member];
			loaded = true;
		}
		return cached as T;
	};
};

/** `exports`e getter ekler: ilk erişimde yükler, sonra cache'ler. */
function defineLazy<T>(name: string, loader: () => T): void {
	Object.defineProperty(exports, name, { enumerable: true, configurable: true, get: loader });
}

defineLazy("AxiosService", lazy("./http/Axios.Service"));
defineLazy("AxiosAgent", lazy("./http/Axios.Service", "AxiosAgent"));
defineLazy("MailService", lazy("./Mail.Service"));
defineLazy("MssqlService", lazy("./database/Mssql.Service"));
defineLazy("PostgresService", lazy("./database/Postgres.Service"));
defineLazy("PrismaService", lazy("./database/Prisma.Service"));
defineLazy("RedisService", lazy("./Redis.Service"));
defineLazy("WebService", lazy("./http/Web.Service"));
defineLazy("createExpressApp", lazy("./http/Express.Service", "createExpressApp"));
/* eslint-enable @typescript-eslint/no-var-requires */
