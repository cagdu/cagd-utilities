import type { Router } from "express";

import { requireFromApp } from "../require";
import { errorResponse, successResponse } from "./Response";

export interface HealthRouterOptions {
	/** Endpoint yolu. Varsayılan: "/health" */
	path?: string;
}

/**
 * Başlatılmış servislerin sağlık durumunu dönen hazır router.
 *
 *   service.web.configure({ routers: [["/api", util.http.healthRouter()]] });
 *   // GET /api/health -> 200 { error: false, data: { prisma: true, redis: true, web: true } }
 *   //                 -> 503 { error: true, code: "UNHEALTHY", data: { redis: false, ... } }
 */
export function healthRouter(options: HealthRouterOptions = {}): Router {
	// Lazy: express sadece bu fonksiyon çağrılınca, service katmanı da döngüsel import olmasın diye burada yüklenir.
	const express = requireFromApp<typeof import("express")>("express");
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { healthCheckAll } = require("../../service") as typeof import("../../service");

	const router = express.Router();
	router.get(options.path ?? "/health", (req, res, next) => {
		const requestId = (req.headers["x-request-id"] as string) || null;
		healthCheckAll()
			.then(status => {
				const healthy = Object.values(status).every(Boolean);
				if (healthy) res.status(200).json(successResponse({ data: status, requestId }));
				else res.status(503).json(errorResponse({ message: "Service Unavailable", code: "UNHEALTHY", data: status, requestId }));
			})
			.catch(next);
	});
	return router;
}
