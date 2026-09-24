import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";

import { baseCfg } from "../../config/access";
import { log } from "../../util/logger";
import { responserMiddleware } from "../../util/http/Response";
import { httpErrorCode } from "../../util/http/ApiError";
import { errorHandler as defaultErrorHandler, notFoundHandler as defaultNotFoundHandler, requestIdMiddleware, sendError } from "../../util/http/middleware";

export interface ExpressAppOptions {
	/** Uygulamaya bağlanacak router(lar). */
	routers?: Array<Router | RequestHandler | [string, Router | RequestHandler]>;
	/** Her şeyden (request id, helmet, cors, rate limit...) ÖNCE çalışacak middleware'ler. */
	beforeMiddlewares?: RequestHandler[];
	/** Router'lardan SONRA, 404 handler'ından ÖNCE çalışacak middleware'ler. */
	afterMiddlewares?: RequestHandler[];
	/**
	 * Statik dosya dizini. Varsayılan: false (kapalı).
	 * Verilirse router'lardan ÖNCE ve rate limit DIŞINDA sunulur. Dizin yoksa oluşturulmaz, uyarı verilir.
	 */
	staticDir?: string | false;
	/** res.success / res.error helper'ları eklensin mi? Varsayılan: true */
	responder?: boolean;
	/** Her isteğe X-Request-Id verilsin mi? Varsayılan: true */
	requestId?: boolean;
	/** Tanımsız endpoint'ler için özel handler. Varsayılan: standart 404 cevabı. */
	notFoundHandler?: RequestHandler;
	/** Özel hata handler'ı. Varsayılan: `util.http.errorHandler` (ApiError'ı tanır). */
	errorHandler?: (err: any, req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Yapılandırılmış bir Express uygulaması üretir.
 * Router'lar dışarıdan verilir; böylece paket tüketici projeye bağımlı olmaz.
 *
 * Middleware sırası:
 *   beforeMiddlewares -> request id -> responder -> helmet -> cors -> static
 *   -> rate limit -> body parser'lar -> routers -> afterMiddlewares -> 404 -> hata handler'ı
 *
 * 404, 429, 4xx ve 500 cevapları `util.http` standart formatındadır.
 */
export function createExpressApp(options: ExpressAppOptions = {}): Express {
	const web = baseCfg().services.web;
	const app = express();

	app.set("x-powered-by", false).set("trust proxy", web.trustProxy).set("etag", false).set("json spaces", 4);

	for (const middleware of options.beforeMiddlewares ?? []) app.use(middleware);

	if (options.requestId !== false) app.use(requestIdMiddleware);
	if (options.responder !== false) app.use(responserMiddleware);

	app.use(helmet(web.helmet as Parameters<typeof helmet>[0])).use(cors(web.cors));

	const staticDir = options.staticDir ?? false;
	if (staticDir !== false) {
		const dir = path.isAbsolute(staticDir) ? staticDir : path.join(process.cwd(), staticDir);
		if (fs.existsSync(dir)) app.use(express.static(dir, { dotfiles: "ignore", index: "index.html" }));
		else log.warn(`createExpressApp: statik dizin bulunamadı, statik servis kapalı (${dir}).`);
	}

	if (web.rateLimit.enabled) {
		const message = typeof web.rateLimit.message === "string" ? web.rateLimit.message : ((web.rateLimit.message as any)?.error ?? "Too many requests, please try again later.");
		app.use(
			rateLimit({
				windowMs: web.rateLimit.windowMs,
				limit: web.rateLimit.limit,
				handler: (req, res) => sendError(req, res, 429, { message, code: httpErrorCode(429) }),
			}),
		);
	}

	app.use(express.urlencoded({ extended: true, limit: web.bodyLimit }))
		.use(express.text({ limit: web.bodyLimit }))
		.use(express.raw({ limit: web.bodyLimit }))
		.use(express.json({ limit: web.bodyLimit }));

	for (const entry of options.routers ?? []) {
		if (Array.isArray(entry)) app.use(entry[0], entry[1] as RequestHandler);
		else app.use(entry as RequestHandler);
	}

	for (const middleware of options.afterMiddlewares ?? []) app.use(middleware);

	app.use(options.notFoundHandler ?? defaultNotFoundHandler);
	app.use(options.errorHandler ?? defaultErrorHandler);

	return app;
}

export default createExpressApp;
export type { Express, Router, RequestHandler };
