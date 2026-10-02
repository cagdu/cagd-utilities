import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { log } from "../logger";
import { ApiError, httpErrorCode } from "./ApiError";
import { errorResponse, type ErrorOptions } from "./Response";

/** Dışarıdan gelen request id'yi sadece güvenli karakterlerden oluşuyorsa kabul et (log/başlık enjeksiyonuna karşı). */
const SAFE_REQUEST_ID = /^[\w\-.:]{1,128}$/;

export interface RequestIdOptions {
	/**
	 * Gelen `X-Request-Id`'ye güvenilsin mi? Varsayılan: her zaman (güvenli karakterlerden oluşuyorsa).
	 * Örn. yalnızca doğrulanmış bir ağ geçidinden gelen değeri kabul etmek için: `trustIncoming: req => !!req.gateway`.
	 */
	trustIncoming?: (req: Request) => boolean;
}

/**
 * Her isteğe bir request id veren middleware üretir:
 * - İstekte geçerli bir `X-Request-Id` varsa ve `trustIncoming(req)` doğruysa onu kullanır, yoksa UUID üretir.
 * - Değeri `req.headers["x-request-id"]`'e yazar ve cevaba `X-Request-Id` başlığı olarak ekler.
 * Böylece `transaction.request_id` her cevapta dolu olur.
 */
export function createRequestIdMiddleware(options: RequestIdOptions = {}): RequestHandler {
	return (req, res, next) => {
		const incoming = req.headers["x-request-id"];
		const trusted = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) && (options.trustIncoming?.(req) ?? true);
		const id = trusted ? (incoming as string) : randomUUID();
		req.headers["x-request-id"] = id;
		res.setHeader("X-Request-Id", id);
		next();
	};
}

const defaultRequestId = createRequestIdMiddleware();

/** Varsayılan request id middleware'i (gelen güvenli `X-Request-Id`'yi korur). Bkz. `createRequestIdMiddleware`. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
	defaultRequestId(req, res, next);
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

/** `ZodError` (ya da `issues` dizisi taşıyan doğrulama hatası) mı? zod'a import bağımlılığı olmadan (duck typing). */
function isValidationError(err: any): err is { issues: Array<{ message?: string; path?: PropertyKey[] }> } {
	return !!err && (err.name === "ZodError" || err.constructor?.name === "ZodError") && Array.isArray(err.issues);
}

/** Doğrulama hatasını standart `400 INVALID_INPUT` hatasına çevirir: mesaj `issues[0].message`, `data: { path }`. */
function validationApiError(err: { issues: Array<{ message?: string; path?: PropertyKey[] }> }): ApiError {
	const issue = err.issues[0];
	return new ApiError(issue?.message || "Invalid input.", 400, "INVALID_INPUT", issue ? { path: (issue.path ?? []).map(p => (typeof p === "symbol" ? String(p) : p)) } : null);
}

/** Prisma'nın bilinen istek hatalarını (`P2002` benzersizlik, `P2025` kayıt yok) eşler; duck typing ile. */
function prismaApiError(err: any): ApiError | null {
	if (!err || err.name !== "PrismaClientKnownRequestError" || typeof err.code !== "string") return null;
	if (err.code === "P2002") return new ApiError("Resource already exists.", 409, "CONFLICT");
	if (err.code === "P2025") return new ApiError("Resource not found.", 404, "NOT_FOUND");
	return null;
}

/**
 * Bilinen hataları `ApiError`'a çevirir (`errorHandler` ile aynı kurallar); tanınmayan hata için `null`.
 * Kendi hata handler'ını yazan uygulamalar ortak eşlemeyi buradan kullanabilir.
 */
export function toApiError(err: unknown): ApiError | null {
	if (err instanceof ApiError) return err;
	if (isValidationError(err)) return validationApiError(err);
	return prismaApiError(err);
}

/**
 * Bir zod (benzeri) şemayla doğrular; hata varsa `errorHandler`'ın ürettiğiyle aynı `400 INVALID_INPUT` `ApiError`'unu fırlatır.
 * Handler dışında (servis katmanı vb.) kullanım içindir.
 */
export function validate<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: any } }, value: unknown): T {
	const result = schema.safeParse(value);
	if (result.success) return result.data;
	if (isValidationError(result.error)) throw validationApiError(result.error);
	throw new ApiError("Invalid input.", 400, "INVALID_INPUT");
}

/**
 * Standart hata handler'ı.
 * - `ApiError` -> kendi status/code/data'sı ile döner.
 * - `ZodError` (duck typing) -> `400 INVALID_INPUT`, mesaj `issues[0].message`, `data: { path }`.
 * - Prisma `P2002` -> `409 CONFLICT`, `P2025` -> `404 NOT_FOUND` (duck typing).
 * - `status`/`statusCode` alanı 4xx olan hatalar (örn. body-parser'ın bozuk JSON hatası) -> o status ve mesajla döner.
 * - Diğer her şey -> `500 INTERNAL_ERROR`, iç hata mesajı dışarı sızdırılmaz ve loglanır.
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
	if (res.headersSent) {
		next(err);
		return;
	}

	const known = toApiError(err);
	if (known) {
		if (known.status >= 500) log.error(known.stack ?? known);
		sendError(req, res, known.status, { message: known.message, code: known.code, data: known.data });
		return;
	}

	const status = Number(err?.status ?? err?.statusCode);
	if (Number.isInteger(status) && status >= 400 && status < 500) {
		sendError(req, res, status, { message: typeof err?.message === "string" && err.message ? err.message : "Bad Request", code: httpErrorCode(status) });
		return;
	}

	log.error(`${req.method} ${req.originalUrl ?? req.url}`, err?.stack ?? err);
	sendError(req, res, 500, { message: "Internal Server Error", code: httpErrorCode(500) });
}

export interface ClientIpOptions {
	/** Express'in `req.ip`'sine (yani `trust proxy` ayarına) güven. Varsayılan: `false` (soket adresi). */
	trustProxy?: boolean;
	/** `true` dönerse `X-Forwarded-For`'un İLK değeri kullanılır (ör. doğrulanmış bir ağ geçidinden gelen istek). */
	trustedForwardHeader?: (req: Request) => boolean;
}

function stripV4Mapped(ip: string): string {
	return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/**
 * İstemci IP'si. Varsayılan olarak **soket adresi** (`::ffff:` öneki kırpılır); başlıklara yalnızca çağıran
 * açıkça güveniyorsa bakılır. Bulunamazsa `"unknown"`.
 */
export function getClientIp(req: Request, options: ClientIpOptions = {}): string {
	if (options.trustedForwardHeader?.(req)) {
		const header = req.headers["x-forwarded-for"];
		const raw = Array.isArray(header) ? header[0] : header;
		const first = typeof raw === "string" ? raw.split(",")[0]?.trim() : undefined;
		if (first) return stripV4Mapped(first);
	}
	const ip = options.trustProxy ? req.ip : req.socket?.remoteAddress;
	return ip ? stripV4Mapped(ip) : "unknown";
}
