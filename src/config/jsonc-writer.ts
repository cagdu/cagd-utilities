import { isPlainObject } from "./deep-merge";

function writeNode(value: unknown, schema: unknown, indent: number): string {
	const childPad = "\t".repeat(indent + 1);

	if (Array.isArray(value)) return JSON.stringify(value);
	if (!isPlainObject(value)) return JSON.stringify(value);

	const keys = Object.keys(value);
	if (keys.length === 0) return "{}";

	const lines: string[] = ["{"];

	keys.forEach((key, idx) => {
		const childSchema = (isPlainObject(schema) ? schema : {})[key];

		let comment: string | undefined;
		if (isPlainObject(childSchema)) {
			const self = (childSchema as Record<string, unknown>).__self;
			if (typeof self === "string") comment = self;
		} else if (typeof childSchema === "string") comment = childSchema;

		if (comment) lines.push(`${childPad}/** ${comment} */`);

		lines.push(`${childPad}${JSON.stringify(key)}: ${writeNode((value as Record<string, unknown>)[key], childSchema, indent + 1)}${idx < keys.length - 1 ? "," : ""}`);
	});

	lines.push(`${"\t".repeat(indent)}}`);
	return lines.join("\n");
}

const DEFAULT_HEADER = ["// Bu dosya otomatik olarak oluşturulmuştur.", "// Yorum satırları yalnızca açıklama amaçlıdır, dosya JSONC (JSON + yorum) formatındadır.", "// Alan isimlerini SİLMEYİN; eksik alanlar bir sonraki açılışta varsayılan değerlerle otomatik tamamlanır."];

/** defaultConfig + schema -> yorumlu JSONC metni. */
export function buildConfigJsonc(configObject: unknown, schema?: unknown, header: string[] = DEFAULT_HEADER): string {
	const body = writeNode(configObject, schema ?? {}, 0);
	return header.length ? `${header.join("\n")}\n${body}\n` : `${body}\n`;
}
