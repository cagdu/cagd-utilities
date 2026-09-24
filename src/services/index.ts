/**
 * ============================================================
 *  services  —  HAM SINIFLAR   (root'ta `classes` adıyla da erişilebilir)
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
 * ÖNEMLİ: Her sınıfın dosyası (ve dolayısıyla kendi paketi: mssql, pg, redis,
 * nodemailer, axios, express...) sınıfa İLK ERİŞİLDİĞİNDE yüklenir.
 * Sadece bu dosyayı import etmek, kurmadığın bir paket için hata vermez.
 */
import { BaseService } from "./database/Base.Service";
import type { IDatabaseService } from "./database/Base.Service";
import type MssqlServiceClass from "./database/Mssql.Service";
import type PostgresServiceClass from "./database/Postgres.Service";
import type PrismaServiceClass from "./database/Prisma.Service";
import type { DatabaseProvider, PrismaClientConstructor, PrismaServiceOptions, RegisteredPrismaClient } from "./database/Prisma.Service";
import type AxiosServiceClass from "./http/Axios.Service";
import type { AxiosAgent as AxiosAgentClass, AxiosErrorCode, AxiosServiceError as AxiosServiceErrorClass, AxiosServiceOptions, InterceptorError } from "./http/Axios.Service";
import type { createExpressApp as createExpressAppFn, ExpressAppOptions } from "./http/Express.Service";
import type WebServiceClass from "./http/Web.Service";
import type { WebServiceOptions } from "./http/Web.Service";
import type MailServiceClass from "./Mail.Service";
import type RedisServiceClass from "./Redis.Service";

export { BaseService };
export type {
	AxiosErrorCode,
	AxiosServiceOptions,
	DatabaseProvider,
	ExpressAppOptions,
	IDatabaseService,
	InterceptorError,
	PrismaClientConstructor,
	PrismaServiceOptions,
	RegisteredPrismaClient,
	WebServiceOptions,
};

// --------------------------------------------------------------------
// `declare const` satırları JS üretmez, sadece tip verir (IntelliSense).
// Gerçek değerler aşağıda `exports`e getter olarak eklenir.
// --------------------------------------------------------------------
export declare const AxiosService: typeof AxiosServiceClass;
export declare const AxiosServiceError: typeof AxiosServiceErrorClass;
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
export type AxiosServiceError = AxiosServiceErrorClass;
export type AxiosAgent = import("node:https").Agent;
export type MailService = MailServiceClass;
export type MssqlService = MssqlServiceClass;
export type PostgresService = PostgresServiceClass;
export type PrismaService<TClient = any> = PrismaServiceClass<TClient>;
export type RedisService = RedisServiceClass;
export type WebService = WebServiceClass;

/* eslint-disable @typescript-eslint/no-require-imports */
/** Her getter ilgili dosyayı ilk erişimde yükler; `require` önbelleği sayesinde sonrası ücretsizdir. */
const lazy = {
	get AxiosService() {
		return require("./http/Axios.Service").default;
	},
	get AxiosServiceError() {
		return require("./http/Axios.Service").AxiosServiceError;
	},
	get AxiosAgent() {
		return require("./http/Axios.Service").AxiosAgent;
	},
	get MailService() {
		return require("./Mail.Service").default;
	},
	get MssqlService() {
		return require("./database/Mssql.Service").default;
	},
	get PostgresService() {
		return require("./database/Postgres.Service").default;
	},
	get PrismaService() {
		return require("./database/Prisma.Service").default;
	},
	get RedisService() {
		return require("./Redis.Service").default;
	},
	get WebService() {
		return require("./http/Web.Service").default;
	},
	get createExpressApp() {
		return require("./http/Express.Service").createExpressApp;
	},
};
/* eslint-enable @typescript-eslint/no-require-imports */

// NOT: Aşağıdaki satırlar BİLEREK bu kalıpta yazıldı (sabit isim + `get: function () { return lazy.X; }`).
// Node, ESM'den `import { RedisService } from "cagd-utilities/services"` yapıldığında CommonJS
// export isimlerini statik analizle (cjs-module-lexer) bulur ve yalnızca bu kalıbı tanır.
Object.defineProperty(exports, "AxiosService", {
	enumerable: true,
	get: function () {
		return lazy.AxiosService;
	},
});
Object.defineProperty(exports, "AxiosServiceError", {
	enumerable: true,
	get: function () {
		return lazy.AxiosServiceError;
	},
});
Object.defineProperty(exports, "AxiosAgent", {
	enumerable: true,
	get: function () {
		return lazy.AxiosAgent;
	},
});
Object.defineProperty(exports, "MailService", {
	enumerable: true,
	get: function () {
		return lazy.MailService;
	},
});
Object.defineProperty(exports, "MssqlService", {
	enumerable: true,
	get: function () {
		return lazy.MssqlService;
	},
});
Object.defineProperty(exports, "PostgresService", {
	enumerable: true,
	get: function () {
		return lazy.PostgresService;
	},
});
Object.defineProperty(exports, "PrismaService", {
	enumerable: true,
	get: function () {
		return lazy.PrismaService;
	},
});
Object.defineProperty(exports, "RedisService", {
	enumerable: true,
	get: function () {
		return lazy.RedisService;
	},
});
Object.defineProperty(exports, "WebService", {
	enumerable: true,
	get: function () {
		return lazy.WebService;
	},
});
Object.defineProperty(exports, "createExpressApp", {
	enumerable: true,
	get: function () {
		return lazy.createExpressApp;
	},
});
