import { createHash } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";

import { ApiError } from "../http/ApiError";
import { getClientIp } from "../http/middleware";
import { getRedisClient, MemoryStore, warnThrottled } from "./backend";

export interface ConsumeOptions {
	/** Pencere uzunluğu (saniye). */
	windowSec: number;
	/** Pencere başına izin verilen istek sayısı. */
	max: number;
}

export interface ConsumeResult {
	allowed: boolean;
	limit: number;
	/** Bu pencerede kalan hak (en az 0). */
	remaining: number;
	/** Pencerenin sıfırlanmasına kalan süre (saniye, en az 1). */
	resetSec: number;
	/** Reddedildiyse tekrar denemeden önce beklenecek süre (saniye); izin verildiyse 0. */
	retryAfterSec: number;
}

export interface RateLimiterOptions extends ConsumeOptions {
	/** Limitin adı (anahtarın parçası ve log'da görünen tek bilgi). Örn. `"auth:login"`. */
	name: string;
	/** Sayaç kimliği. Varsayılan: `util.http.getClientIp(req)` (soket adresi). */
	key?: (req: Request) => string;
	/** `true` dönerse istek sayılmaz (ör. test ortamı; kütüphane `NODE_ENV`'e bakmaz). */
	skip?: (req: Request) => boolean;
	/** `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` başlıkları eklensin mi? Varsayılan: true. */
	headers?: boolean;
	/** 429 mesajı. */
	message?: string;
}

/** Sabit pencere sayacı: INCR + (ilk istekte) PEXPIRE, atomik. `{ sayaç, kalan ms }` döner. */
const INCR_SCRIPT =
	'local c = redis.call("INCR", KEYS[1]) if c == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end local t = redis.call("PTTL", KEYS[1]) if t < 0 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) t = tonumber(ARGV[1]) end return {c, t}';

const memoryCounters = new MemoryStore<number>(10_000);

/** Kimlik anahtarda ve loglarda açık yazılmaz (IP, kullanıcı adı, anahtar öneki olabilir). */
function identityHash(identity: string): string {
	return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

/**
 * İş kodunda (middleware dışında) bir hakkı tüketir. Redis yoksa süreç içi sayaç kullanılır.
 *
 *   const r = await util.redis.consume("carts:create", userId, { windowSec: 3600, max: 10 });
 *   if (!r.allowed) throw new ApiError("Too many carts", 429, "RATE_LIMITED", { retryAfterSec: r.retryAfterSec });
 */
export async function consume(name: string, identity: string, options: ConsumeOptions): Promise<ConsumeResult> {
	const windowMs = Math.max(1, Math.floor(options.windowSec * 1000));
	const key = `ratelimit:${name}:${identityHash(identity)}`;

	let count: number | null = null;
	let ttlMs = windowMs;
	const client = getRedisClient();
	if (client) {
		try {
			const reply = (await client.sendCommand(["EVAL", INCR_SCRIPT, "1", key, String(windowMs)])) as unknown[];
			count = Number(reply[0]);
			ttlMs = Number(reply[1]);
		} catch (err) {
			warnThrottled(`rateLimit:${name}`, "Redis erişilemedi, süreç içi sayaç kullanılıyor", err);
		}
	}
	if (count === null) {
		const current = memoryCounters.get(key);
		if (current === undefined) {
			count = 1;
			memoryCounters.set(key, count, windowMs);
		} else {
			count = current + 1;
			ttlMs = memoryCounters.ttlMs(key);
			memoryCounters.set(key, count, ttlMs);
		}
	}

	const resetSec = Math.max(1, Math.ceil(ttlMs / 1000));
	const allowed = count <= options.max;
	return { allowed, limit: options.max, remaining: Math.max(0, options.max - count), resetSec, retryAfterSec: allowed ? 0 : resetSec };
}

/**
 * Anahtarlı, sabit pencereli rate limit middleware'i. Aşımda `ApiError(429, "RATE_LIMITED")` (`next(err)` ile) ve `Retry-After`.
 * Hiçbir başlık/gövde loglanmaz; yalnızca `name` görünür. Redis yoksa süreç içi sayaç kullanılır.
 */
export function rateLimiter(options: RateLimiterOptions): RequestHandler {
	const keyFn = options.key ?? ((req: Request) => getClientIp(req));
	const message = options.message ?? "Too many requests. Please try again later.";
	const sendHeaders = options.headers !== false;

	return async (req: Request, res: Response, next: NextFunction) => {
		try {
			if (options.skip?.(req)) return next();
			const result = await consume(options.name, keyFn(req), options);
			if (sendHeaders) {
				res.setHeader("RateLimit-Limit", String(result.limit));
				res.setHeader("RateLimit-Remaining", String(result.remaining));
				res.setHeader("RateLimit-Reset", String(result.resetSec));
			}
			if (!result.allowed) {
				res.setHeader("Retry-After", String(result.retryAfterSec));
				return next(new ApiError(message, 429, "RATE_LIMITED"));
			}
			return next();
		} catch (err) {
			return next(err);
		}
	};
}
