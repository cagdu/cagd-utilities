import { log } from "../util/logger";
import { getPath, isPlainObject, setPath } from "./deep-merge";
import type { ConfigEnvMap } from "./types";

const TRUE_VALUES = /^(1|true|yes|on)$/i;
const FALSE_VALUES = /^(0|false|no|off)$/i;

/** Ortam değişkeni metnini, varsayılan değerin tipine göre dönüştürür. `undefined` = geçersiz. */
function coerce(raw: string, sample: unknown): unknown {
	if (typeof sample === "number") {
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	}
	if (typeof sample === "boolean") {
		if (TRUE_VALUES.test(raw)) return true;
		if (FALSE_VALUES.test(raw)) return false;
		return undefined;
	}
	if (Array.isArray(sample)) {
		if (raw.trim().startsWith("[")) {
			try {
				const parsed = JSON.parse(raw);
				return Array.isArray(parsed) ? parsed : undefined;
			} catch {
				return undefined;
			}
		}
		return raw
			.split(",")
			.map(s => s.trim())
			.filter(Boolean);
	}
	if (isPlainObject(sample)) {
		try {
			const parsed = JSON.parse(raw);
			return isPlainObject(parsed) ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	return raw;
}

/**
 * `map` içindeki her ortam değişkenini okuyup, `defaults`'taki tipine göre
 * dönüştürür ve kısmi bir config objesi döner. Boş/tanımsız değişkenler atlanır.
 */
export function readEnv(defaults: unknown, map: ConfigEnvMap, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
	const out: Record<string, unknown> = {};

	for (const [configPath, envName] of Object.entries(map)) {
		const raw = env[envName];
		if (raw === undefined || raw === "") continue;

		const path = configPath.split(".");
		const value = coerce(raw, getPath(defaults, path));

		if (value === undefined) {
			log.warn(`Config: ${envName} ortam değişkeni '${configPath}' alanı için geçersiz, yok sayıldı.`);
			continue;
		}
		setPath(out, path, value);
	}

	return out;
}
