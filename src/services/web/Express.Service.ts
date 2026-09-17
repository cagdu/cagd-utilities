import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response, type Router } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";

import { config } from "../../config";
import { log } from "../../utils/logger";
import { responserMiddleware } from "../../http/Response";

export interface ExpressAppOptions {
	/** Uygulamaya bağlanacak router(lar). */
	routers?: Array<Router | RequestHandler | [string, Router | RequestHandler]>;
	/** helmet/cors/rateLimit'ten ÖNCE çalışacak middleware'ler. */
	beforeMiddlewares?: RequestHandler[];
	/** Router'lardan SONRA, catch-all'dan ÖNCE çalışacak middleware'ler. */
	afterMiddlewares?: RequestHandler[];
	/** Statik dosya dizini. false ise statik servis kapatılır. Varsayılan: "public" */
	staticDir?: string | false;
	/** res.success / res.error helper'ları eklensin mi? Varsayılan: true */
	responder?: boolean;
	/** Tanımsız endpoint'ler için özel handler. */
	notFoundHandler?: RequestHandler;
	/** Özel hata handler'ı. */
	errorHandler?: (err: any, req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Yapılandırılmış bir Express uygulaması üretir.
 * Router'lar dışarıdan verilir; böylece paket tüketici projeye bağımlı olmaz.
 */
export function createExpressApp(options: ExpressAppOptions = {}): Express {
	const web = (config as any)?.services?.web ?? {};
	const app = express();

	app.set("x-powered-by", false)
		.set("trust proxy", web.trustProxy ?? false)
		.set("etag", false)
		.set("json spaces", 4);

	for (const middleware of options.beforeMiddlewares ?? []) app.use(middleware);

	app.use(helmet(web.helmet ?? {}))
		.use(cors(web.cors ?? {}))
		.use(rateLimit({ windowMs: web.rateLimit?.windowMs ?? 60000, limit: web.rateLimit?.limit ?? 100, message: web.rateLimit?.message ?? { error: "Too many requests, please try again later." } }))
		.use(express.urlencoded({ extended: true }))
		.use(express.text())
		.use(express.raw())
		.use(express.json());

	if (options.responder !== false) app.use(responserMiddleware);

	for (const entry of options.routers ?? []) {
		if (Array.isArray(entry)) app.use(entry[0], entry[1] as RequestHandler);
		else app.use(entry as RequestHandler);
	}

	const staticDir = options.staticDir === undefined ? "public" : options.staticDir;
	if (staticDir !== false) {
		const dir = path.isAbsolute(staticDir) ? staticDir : path.join(process.cwd(), staticDir);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		app.use(express.static(dir, { dotfiles: "ignore", index: "index.html" }));
	}

	for (const middleware of options.afterMiddlewares ?? []) app.use(middleware);

	app.use(options.notFoundHandler ?? ((_req: Request, res: Response) => res.status(404).json({ error: true, message: "Not Found" })));

	app.use(
		options.errorHandler ??
			((err: any, _req: Request, res: Response, _next: NextFunction) => {
				log.error(err?.stack ?? err);
				res.status(500).json({ error: true, message: "Internal Server Error" });
			}),
	);

	return app;
}

export default createExpressApp;
export type { Express, Router, RequestHandler };
