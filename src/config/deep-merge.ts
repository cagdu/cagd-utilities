export const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `defaults` iskeletini korur, `source` içindeki değerlerle üzerine yazar.
 * - Diziler değiştirilir (merge edilmez).
 * - `source` içindeki fazladan anahtarlar korunur.
 * - Hiçbir girdiyi mutasyona uğratmaz.
 */
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

/** Basit derin kopya (JSON uyumlu config objeleri için yeterli). */
export function deepClone<T>(value: T): T {
	if (Array.isArray(value)) return value.map(v => deepClone(v)) as unknown as T;
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value)) out[key] = deepClone(value[key]);
		return out as T;
	}
	return value;
}

/** Derin eşitlik (JSON uyumlu değerler için). Anahtar SIRASINA duyarlı değildir. */
export function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
	if (isPlainObject(a) && isPlainObject(b)) {
		const keys = Object.keys(a);
		if (keys.length !== Object.keys(b).length) return false;
		return keys.every(key => key in b && deepEqual(a[key], b[key]));
	}
	return false;
}

/** "a.b.c" yolundaki değeri okur. Yol yoksa `undefined`. */
export function getPath(obj: unknown, path: string[]): unknown {
	let cur: unknown = obj;
	for (const key of path) {
		if (!isPlainObject(cur)) return undefined;
		cur = cur[key];
	}
	return cur;
}

/** "a.b.c" yoluna değer yazar, ara objeleri oluşturur (mutasyon yapar). */
export function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
	let cur = obj;
	path.slice(0, -1).forEach(key => {
		if (!isPlainObject(cur[key])) cur[key] = {};
		cur = cur[key] as Record<string, unknown>;
	});
	cur[path[path.length - 1]] = value;
}

/**
 * `defaults`'ta olup `source`'ta HİÇ bulunmayan anahtarların en üst seviye
 * yollarını döner. İki tarafta da obje olan alanlarda derine iner; tipi farklı
 * olan alanlar kullanıcının bilinçli değişikliği sayılır, eksik sayılmaz.
 * Anahtar sırasına duyarlı değildir.
 */
export function findMissingPaths(defaults: unknown, source: unknown, prefix: string[] = []): string[][] {
	if (!isPlainObject(defaults) || !isPlainObject(source)) return [];

	const missing: string[][] = [];
	for (const key of Object.keys(defaults)) {
		if (!(key in source)) missing.push([...prefix, key]);
		else missing.push(...findMissingPaths(defaults[key], source[key], [...prefix, key]));
	}
	return missing;
}
