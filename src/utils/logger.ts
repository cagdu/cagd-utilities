/**
 * Uses `cagd-log` if available; otherwise, falls back to the console.
 * This ensures the package works even in projects where `cagd-log` is not installed.
 */
export interface Logger {
	info: (...args: any[]) => void;
	warn: (...args: any[]) => void;
	error: (...args: any[]) => void;
	debug: (...args: any[]) => void;
}

const consoleLogger: Logger = {
	info: (...args) => console.log("[cagd-utilities]", ...args),
	warn: (...args) => console.warn("[cagd-utilities]", ...args),
	error: (...args) => console.error("[cagd-utilities]", ...args),
	debug: (...args) => console.debug("[cagd-utilities]", ...args),
};

function resolveLogger(): Logger {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const mod = require("cagd-log");
		const candidate = (mod?.default ?? mod) as Partial<Logger>;
		if (candidate && typeof candidate.error === "function") {
			return {
				info: (...a) => (candidate.info ?? consoleLogger.info)(...a),
				warn: (...a) => (candidate.warn ?? consoleLogger.warn)(...a),
				error: (...a) => (candidate.error ?? consoleLogger.error)(...a),
				debug: (...a) => (candidate.debug ?? consoleLogger.debug)(...a),
			};
		}
	} catch {
		/* cagd-log not found */
	}
	return consoleLogger;
}

let active: Logger = resolveLogger();

/** Dışarıdan kendi logger'ını enjekte etmek istersen. */
export function setLogger(logger: Partial<Logger>): void {
	active = { ...active, ...logger } as Logger;
}

export const log: Logger = {
	info: (...a) => active.info(...a),
	warn: (...a) => active.warn(...a),
	error: (...a) => active.error(...a),
	debug: (...a) => active.debug(...a),
};

export default log;
