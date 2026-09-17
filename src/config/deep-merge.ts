export const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function deepMerge<T>(defaults: T, source: unknown): T {
	if (!isPlainObject(defaults) || !isPlainObject(source)) return source === undefined ? defaults : (source as T);

	const result: Record<string, unknown> = {};

	for (const key of Object.keys(defaults as Record<string, unknown>)) {
		const defaultValue = (defaults as Record<string, unknown>)[key];
		const sourceValue = (source as Record<string, unknown>)[key];

		if (sourceValue === undefined) result[key] = isPlainObject(defaultValue) ? deepMerge(defaultValue, {}) : defaultValue;
		else if (isPlainObject(defaultValue) && isPlainObject(sourceValue)) result[key] = deepMerge(defaultValue, sourceValue);
		else result[key] = sourceValue;
	}

	for (const key of Object.keys(source as Record<string, unknown>)) {
		if (!(key in (defaults as Record<string, unknown>))) result[key] = (source as Record<string, unknown>)[key];
	}

	return result as T;
}

export function deepClone<T>(value: T): T {
	if (Array.isArray(value)) return value.map(v => deepClone(v)) as unknown as T;
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value)) out[key] = deepClone(value[key]);
		return out as T;
	}
	return value;
}
