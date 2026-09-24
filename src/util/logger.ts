/**
 * `cagd-log` varsa onu kullanır, yoksa console'a düşer.
 * Böylece paket, cagd-log kurulu olmayan bir projede de çalışır.
 *
 * `cagd-log` İLK LOG ANINDA yüklenir (import anında değil). Sebep: cagd-log, log
 * satırındaki dosya adını kendisini İLK `require()` eden modülden alır. Bu paket
 * onu import anında yüklerse, tüketici projenin kendi loglarında da dosya adı bu
 * paketin logger'ı olarak görünür.
 */
import { requireFromApp } from "./require";

export interface Logger {
	info: (...args: any[]) => void;
	warn: (...args: any[]) => void;
	error: (...args: any[]) => void;
	debug: (...args: any[]) => void;
}

const LEVELS = ["info", "warn", "error", "debug"] as const;

const consoleLogger: Logger = {
	info: (...args) => console.log("[cagd-utilities]", ...args),
	warn: (...args) => console.warn("[cagd-utilities]", ...args),
	error: (...args) => console.error("[cagd-utilities]", ...args),
	debug: (...args) => console.debug("[cagd-utilities]", ...args),
};

function resolveLogger(): Logger {
	try {
		const mod = requireFromApp("cagd-log");
		const candidate = (mod?.default ?? mod) as Partial<Logger>;
		if (candidate && typeof candidate.error === "function") {
			const out = { ...consoleLogger };
			for (const level of LEVELS) {
				const fn = candidate[level];
				if (typeof fn === "function") out[level] = fn.bind(candidate);
			}
			return out;
		}
	} catch {
		/* cagd-log kurulu değil */
	}
	return consoleLogger;
}

let active: Logger | null = null;

const current = (): Logger => (active ??= resolveLogger());

/** Dışarıdan kendi logger'ını enjekte etmek istersen. Verilmeyen seviyeler mevcut logger'da kalır. */
export function setLogger(logger: Partial<Logger>): void {
	active = { ...current(), ...logger };
}

export const log: Logger = {
	info: (...a) => current().info(...a),
	warn: (...a) => current().warn(...a),
	error: (...a) => current().error(...a),
	debug: (...a) => current().debug(...a),
};

export default log;
