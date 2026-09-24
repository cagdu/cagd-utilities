import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { log } from "../logger";
import { ApiError, httpErrorCode } from "./ApiError";
import { errorResponse, type ErrorOptions } from "./Response";

/** Dışarıdan gelen request id'yi sadece güvenli karakterlerden oluşuyorsa kabul et (log/başlık enjeksiyonuna karşı). */
const SAFE_REQUEST_ID = /^[\w\-.:]{1,128}$/;

/**
 * Her isteğe bir request id verir:
 * - İstekte geçerli bir `X-Request-Id` varsa onu kullanır, yoksa UUID üretir.
 * - Değeri `req.headers["x-request-id"]`'e yazar ve cevaba `X-Request-Id` başlığı olarak ekler.
 * Böylece `transaction.request_id` her cevapta dolu olur.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
	const incoming = req.headers["x-request-id"];
	const id = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
	req.headers["x-request-id"] = id;
	res.setHeader("X-Request-Id", id);
	next();
}

/**
 * Standart formatta hata cevabı gönderir. `responserMiddleware` kuruluysa `res.error()`
 * kullanılır (süre bilgisi dahil), değilse aynı format elle üretilir.
 */
export function sendError(req: Request, res: Response, statusCode: number, options: ErrorOptions = {}): void {
	if (typeof res.error === "function") {
		res.error(options, statusCode);
		return;
	}
	const requestId = (req.headers["x-request-id"] as string) || null;
	res.status(statusCode).json(errorResponse({ requestId, ...options }));
}

/** Tanımsız endpoint'ler için standart 404 cevabı. */
export const notFoundHandler: RequestHandler = (req, res) => {
	sendError(req, res, 404, { message: "Not Found", code: httpErrorCode(404) });
};

/**
 * Standart hata handler'ı.
 * - `ApiError` -> kendi status/code/data'sı ile döner.
 * - `status`/`statusCode` alanı 4xx olan hatalar (örn. body-parser'ın bozuk JSON hatası) -> o status ve mesajla döner.
 * - Diğer her şey -> 500, iç hata mesajı dışarı sızdırılmaz ve loglanır.
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
	if (res.headersSent) {
		next(err);
		return;
	}

	if (err instanceof ApiError) {
		if (err.status >= 500) log.error(err.stack ?? err);
		sendError(req, res, err.status, { message: err.message, code: err.code, data: err.data });
		return;
	}

	const status = Number(err?.status ?? err?.statusCode);
	if (Number.isInteger(status) && status >= 400 && status < 500) {
		sendError(req, res, status, { message: typeof err?.message === "string" && err.message ? err.message : "Bad Request", code: httpErrorCode(status) });
		return;
	}

	log.error(err?.stack ?? err);
	sendError(req, res, 500, { message: "Internal Server Error", code: httpErrorCode(500) });
}
