/**
 * ============================================================
 *  util.list  —  ORTAK LİSTE / SAYFALAMA SÖZLEŞMESİ
 * ============================================================
 *
 *   İstek: limit (1-100, vars. 20) · cursor XOR page (1'den başlar) · sort · order (asc|desc) · q · + uca özel filtreler
 *   Cevap: { items, nextCursor, hasMore, limit, page?, total?, totalPages? }   // page/total/totalPages yalnızca page modunda
 *
 * Cursor opak bir keyset işaretçisidir (base64url JSON): son satırın sıralama değeri + kimliği, ayrıca sort/order ve
 * filtrelerin özeti. Sıralama, sıra yönü ya da filtreler değişince eski cursor `400 INVALID_INPUT` ile reddedilir.
 *
 * Kütüphane zod'a ve Prisma'ya bağımlı DEĞİLDİR: zod örneği parametre olarak alınır, Prisma yardımcıları düz nesne üretir.
 *
 *   const schema = util.list.createListQuerySchema(z, {
 *       sorts: ["createdAt", "name"], defaultSort: "createdAt", defaultOrder: "desc",
 *       filters: { isEnabled: util.list.booleanQuery(z).optional() },
 *   });
 *   const query = schema.parse(req.query);
 *   const page = await util.list.paginate(query, {
 *       field: { createdAt: "CreatedAt", name: "Name" }[query.sort],
 *       findMany: args => prisma.items.findMany({ ...args, where: { AND: [baseWhere, args.where ?? {}] } }),
 *       count: () => prisma.items.count({ where: baseWhere }),
 *   });
 */
import { createHash } from "node:crypto";

import { ApiError } from "./http/ApiError";

export type SortOrder = "asc" | "desc";
export type ListMode = "cursor" | "page";

/** Ortak liste cevabı. */
export interface Page<T> {
	items: T[];
	/** Bir sonraki sayfa için `?cursor=` değeri; `null` ise liste bitti. (page modunda da döner; mobil istemciler `nextCursor === null` ile bitişi anlar.) */
	nextCursor: string | null;
	hasMore: boolean;
	limit: number;
	/** Yalnızca page modunda. */
	page?: number;
	total?: number;
	totalPages?: number;
}

/** `createListQuerySchema` çıktısının ortak alanları. */
export interface ListQueryBase<S extends string = string> {
	limit: number;
	cursor?: string;
	page?: number;
	sort: S;
	order: SortOrder;
	q?: string;
}

/** zod şeması gibi `parse`/`safeParse` sunan nesne (zod'a tip bağımlılığı olmadan). */
export interface ParseableSchema<T> {
	parse(value: unknown): T;
	safeParse(value: unknown): { success: true; data: T } | { success: false; error: any };
}

/** zod (v3/v4) şema tipinden çıktı tipini çıkarır. */
type ZodOutput<T> = T extends { _zod: { output: infer O } } ? O : T extends { _output: infer O } ? O : unknown;
type FilterShape<F> = F extends { shape: infer S } ? S : F;
type InferFilters<F> = { [K in keyof FilterShape<F>]: ZodOutput<FilterShape<F>[K]> };

export type ListQuery<S extends string, F = Record<never, never>> = ListQueryBase<S> & InferFilters<F>;

export interface ListQuerySchemaOptions<S extends readonly [string, ...string[]], F> {
	/** İzin verilen `sort` değerleri. */
	sorts: S;
	defaultSort: S[number];
	/** Varsayılan: `"desc"`. */
	defaultOrder?: SortOrder;
	/** Varsayılan: 100. */
	maxLimit?: number;
	/** Varsayılan: 20. */
	defaultLimit?: number;
	/** `q` için üst sınır. Varsayılan: 200. */
	qMaxLength?: number;
	/** Uca özel filtreler: zod "raw shape" (`{ status: z.enum([...]).optional() }`) ya da `z.object(...)`. */
	filters?: F;
}

/** Cursor'ın en fazla uzunluğu (bozuk/aşırı büyük girdileri erken reddetmek için). */
const MAX_CURSOR_LENGTH = 1024;

/**
 * Query string boolean'ı: `"true"`/`"false"`/`"1"`/`"0"` → boolean. (`z.coerce.boolean()` `"false"`'u `true` sayar.)
 * Kullanım: `booleanQuery(z).optional()`.
 */
export function booleanQuery(z: any): any {
	return z.enum(["true", "false", "1", "0"]).transform((v: string) => v === "true" || v === "1");
}

/**
 * Bir liste ucu için query şeması üretir. `zod` örneği parametre olarak verilir (uygulamanın zod sürümü kullanılır).
 * Sonuç: `limit`, `cursor`, `page`, `sort`, `order`, `q` + `filters`. `cursor` ve `page` birlikte verilirse doğrulama hatası.
 */
export function createListQuerySchema<const S extends readonly [string, ...string[]], F = Record<never, never>>(
	z: any,
	options: ListQuerySchemaOptions<S, F>,
): ParseableSchema<ListQuery<S[number], F>> {
	const maxLimit = options.maxLimit ?? 100;
	const defaultLimit = options.defaultLimit ?? 20;
	const qMax = options.qMaxLength ?? 200;
	const filters = options.filters as any;
	const filterShape = filters && typeof filters === "object" && "shape" in filters ? filters.shape : (filters ?? {});
	const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

	return z
		.object({
			limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
			cursor: z.preprocess(emptyToUndefined, z.string().max(MAX_CURSOR_LENGTH).optional()),
			page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).optional()),
			sort: z.enum(options.sorts).default(options.defaultSort),
			order: z.enum(["asc", "desc"]).default(options.defaultOrder ?? "desc"),
			q: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(qMax).optional()),
			...filterShape,
		})
		.superRefine((data: any, ctx: any) => {
			if (data.cursor !== undefined && data.page !== undefined) ctx.addIssue({ code: "custom", path: ["cursor"], message: "cursor and page cannot be used together" });
		});
}

// ------------------------------------------------------------------
// Cursor
// ------------------------------------------------------------------

/** Cursor'da taşınabilen sıralama değeri. `Date`, `bigint` ve Decimal benzeri nesneler kayıpsız taşınır. */
export type CursorValue = string | number | boolean | bigint | Date | null | { toString(): string };

export interface CursorPayload {
	sort: string;
	order: SortOrder;
	value: CursorValue;
	id: string | number;
	/** Filtrelerin özeti (`filtersHash()`); farklıysa cursor reddedilir. */
	filtersHash?: string;
}

type EncodedValue = { t: "s" | "n" | "b" | "d" | "i" | "x" | "z"; v?: string | number | boolean };

function encodeValue(value: CursorValue): EncodedValue {
	if (value === null || value === undefined) return { t: "z" };
	if (value instanceof Date) return { t: "d", v: value.toISOString() };
	if (typeof value === "bigint") return { t: "i", v: value.toString() };
	if (typeof value === "number") return { t: "n", v: value };
	if (typeof value === "boolean") return { t: "b", v: value };
	if (typeof value === "string") return { t: "s", v: value };
	// Decimal (Prisma/decimal.js) vb.: string olarak taşınır, Prisma karşılaştırmada string kabul eder.
	return { t: "x", v: String(value) };
}

function decodeValue(encoded: EncodedValue): CursorValue {
	switch (encoded.t) {
		case "z":
			return null;
		case "d": {
			const d = new Date(String(encoded.v));
			if (Number.isNaN(d.getTime())) throw invalidCursor();
			return d;
		}
		case "i":
			return BigInt(String(encoded.v));
		case "n":
			if (typeof encoded.v !== "number") throw invalidCursor();
			return encoded.v;
		case "b":
			return encoded.v === true;
		case "s":
		case "x":
			if (typeof encoded.v !== "string") throw invalidCursor();
			return encoded.v;
		default:
			throw invalidCursor();
	}
}

function invalidCursor(): ApiError {
	return new ApiError("Invalid cursor", 400, "INVALID_INPUT", { path: ["cursor"] });
}

/** Cursor'ı opak base64url metne çevirir. */
export function encodeCursor(payload: CursorPayload): string {
	const body = { s: payload.sort, o: payload.order, v: encodeValue(payload.value), i: payload.id, f: payload.filtersHash ?? "" };
	return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

/**
 * Cursor'ı çözer ve beklenen sıralama/filtrelerle eşleştiğini doğrular.
 * Bozuk ya da uyuşmayan cursor → `ApiError(400, "INVALID_INPUT", "Invalid cursor")`.
 */
export function decodeCursor(raw: string, expected: { sort: string; order: SortOrder; filtersHash?: string }): { value: CursorValue; id: string | number } {
	let body: any;
	try {
		if (typeof raw !== "string" || !raw || raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) throw invalidCursor();
		body = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
	} catch {
		throw invalidCursor();
	}
	if (!body || typeof body !== "object" || typeof body.v !== "object" || body.v === null) throw invalidCursor();
	if (typeof body.i !== "string" && typeof body.i !== "number") throw invalidCursor();
	if (body.s !== expected.sort || body.o !== expected.order || (body.f ?? "") !== (expected.filtersHash ?? "")) throw invalidCursor();
	return { value: decodeValue(body.v), id: body.i };
}

/** Değeri anahtar sırasından bağımsız, kararlı JSON'a çevirir. */
function stableStringify(value: unknown): string {
	if (value === undefined) return "null";
	if (value === null || typeof value !== "object") return typeof value === "bigint" ? JSON.stringify(value.toString()) : JSON.stringify(value);
	if (value instanceof Date) return JSON.stringify(value.toISOString());
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const keys = Object.keys(value as object)
		.filter(k => (value as any)[k] !== undefined)
		.sort();
	return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify((value as any)[k])}`).join(",")}}`;
}

/** Sayfalamayla ilgisi olmayan query alanları (filtre özeti dışında tutulur). */
const NON_FILTER_KEYS = new Set(["limit", "cursor", "page", "sort", "order"]);

/**
 * Filtrelerin (ve `q`'nun) kısa, kararlı özeti. `query` doğrudan verilebilir: `limit`/`cursor`/`page`/`sort`/`order` yok sayılır.
 * Filtre yoksa `""`.
 */
export function filtersHash(query: Record<string, unknown>): string {
	const filters: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(query)) if (!NON_FILTER_KEYS.has(k) && v !== undefined) filters[k] = v;
	if (Object.keys(filters).length === 0) return "";
	return createHash("sha256").update(stableStringify(filters)).digest("base64url").slice(0, 16);
}

// ------------------------------------------------------------------
// Prisma yardımcıları (düz nesne üretir)
// ------------------------------------------------------------------

/**
 * NULL'ların sıralamadaki yeri: `"low"` → NULL en küçük değer (SQL Server, MySQL, SQLite);
 * `"high"` → NULL en büyük değer (PostgreSQL varsayılanı).
 */
export type NullsPosition = "low" | "high";

export interface KeysetOptions {
	field: string;
	idField?: string;
	order: SortOrder;
	cursor: { value: CursorValue; id: string | number };
	/** Alan NULL olabiliyorsa `true`. Varsayılan: `false` (cursor değeri `null` ise otomatik `true`). */
	nullable?: boolean;
	/** Varsayılan: `"low"`. */
	nulls?: NullsPosition;
}

/**
 * Cursor'dan SONRA gelen satırların `where` koşulu (keyset / seek pagination).
 * Eşit sıralama değerlerinde `idField` ikincil anahtardır; böylece sayfalar arasında atlama/tekrar olmaz.
 */
export function keysetWhere(options: KeysetOptions): Record<string, unknown> {
	const { field, order } = options;
	const idField = options.idField ?? "Id";
	const { value, id } = options.cursor;
	const op = order === "asc" ? "gt" : "lt";
	const nullable = options.nullable || value === null;
	const nullsLow = (options.nulls ?? "low") === "low";
	// NULL'lar sıralamada nerede? asc + low → başta; desc + low → sonda; high için tersi.
	const nullsFirst = order === "asc" ? nullsLow : !nullsLow;

	if (field === idField) return { [idField]: { [op]: id } };

	if (value === null) {
		const sameNullGroup = { [field]: null, [idField]: { [op]: id } };
		// NULL'lar baştaysa ardından tüm NULL olmayanlar gelir; sondaysa yalnızca kalan NULL'lar.
		return nullsFirst ? { OR: [sameNullGroup, { NOT: { [field]: null } }] } : sameNullGroup;
	}

	const or: Record<string, unknown>[] = [{ [field]: { [op]: value } }, { [field]: value, [idField]: { [op]: id } }];
	if (nullable && !nullsFirst) or.push({ [field]: null });
	return { OR: or };
}

/** `[{ [field]: order }, { [idField]: order }]` (alan zaten `idField` ise tek eleman). */
export function orderBy(options: { field: string; idField?: string; order: SortOrder }): Array<Record<string, SortOrder>> {
	const idField = options.idField ?? "Id";
	return options.field === idField ? [{ [idField]: options.order }] : [{ [options.field]: options.order }, { [idField]: options.order }];
}

/** Page modu için `{ skip, take }`. `take` = `limit + 1` (fazladan satır `hasMore`'u belirler; bkz. `buildPage`). */
export function pageArgs(options: { page: number; limit: number }): { skip: number; take: number } {
	return { skip: (options.page - 1) * options.limit, take: options.limit + 1 };
}

export interface BuildPageOptions<Row, Out> {
	/** `limit + 1` satırla yapılmış sorgunun sonucu. */
	rows: Row[];
	limit: number;
	mode: ListMode;
	sort: string;
	order: SortOrder;
	/** Satırın sıralama alanındaki değeri. */
	getCursorValue: (row: Row) => CursorValue;
	/** Satırın kimliği. Varsayılan: `row.Id`. */
	getId?: (row: Row) => string | number;
	filtersHash?: string;
	/** Page modunda sayfa numarası ve toplam kayıt. */
	page?: number;
	total?: number;
	map?: (row: Row) => Out;
}

/** Sorgu sonucundan ortak liste cevabını üretir. */
export function buildPage<Row, Out = Row>(options: BuildPageOptions<Row, Out>): Page<Out> {
	const rows = options.rows.slice();
	const hasMore = rows.length > options.limit;
	if (hasMore) rows.length = options.limit;

	const getId = options.getId ?? ((row: Row) => (row as any).Id);
	const last = rows[rows.length - 1];
	const nextCursor =
		hasMore && last !== undefined ? encodeCursor({ sort: options.sort, order: options.order, value: options.getCursorValue(last), id: getId(last), filtersHash: options.filtersHash }) : null;

	const items = options.map ? rows.map(options.map) : (rows as unknown as Out[]);
	const result: Page<Out> = { items, nextCursor, hasMore, limit: options.limit };
	if (options.mode === "page") {
		const total = options.total ?? 0;
		result.page = options.page ?? 1;
		result.total = total;
		result.totalPages = Math.ceil(total / options.limit);
	}
	return result;
}

export interface FindManyArgs {
	/** Cursor modunda keyset koşulu; uygulama kendi `where`'i ile `AND` içinde birleştirmeli. */
	where?: Record<string, unknown>;
	orderBy: Array<Record<string, SortOrder>>;
	take: number;
	skip?: number;
}

export interface PaginateOptions<Row, Out> {
	/** `query.sort`'un karşılığı olan veritabanı alanı (ör. `"createdAt"` → `"CreatedAt"`). */
	field: string;
	/** Varsayılan: `"Id"`. */
	idField?: string;
	nullable?: boolean;
	nulls?: NullsPosition;
	findMany: (args: FindManyArgs) => Promise<Row[]>;
	/** Page modunda toplam kayıt sayısı (filtrelerle aynı `where`). */
	count?: () => Promise<number>;
	/** Satırın sıralama değeri. Varsayılan: `row[field]`. */
	getCursorValue?: (row: Row) => CursorValue;
	getId?: (row: Row) => string | number;
	map?: (row: Row) => Out;
}

/**
 * `createListQuerySchema` çıktısıyla uçtan uca sayfalama: cursor'ı doğrular (sort/order/filtre),
 * keyset `where` + `orderBy` + `take`/`skip` üretir, sonucu `Page<T>`'ye çevirir.
 */
export async function paginate<Row, Out = Row>(query: ListQueryBase<string> & Record<string, unknown>, options: PaginateOptions<Row, Out>): Promise<Page<Out>> {
	const idField = options.idField ?? "Id";
	const hash = filtersHash(query);
	const mode: ListMode = query.page !== undefined ? "page" : "cursor";
	const order = orderBy({ field: options.field, idField, order: query.order });

	let args: FindManyArgs;
	if (mode === "page") {
		args = { orderBy: order, ...pageArgs({ page: query.page!, limit: query.limit }) };
	} else {
		args = { orderBy: order, take: query.limit + 1 };
		if (query.cursor) {
			const cursor = decodeCursor(query.cursor, { sort: query.sort, order: query.order, filtersHash: hash });
			args.where = keysetWhere({ field: options.field, idField, order: query.order, cursor, nullable: options.nullable, nulls: options.nulls });
		}
	}

	const [rows, total] = await Promise.all([options.findMany(args), mode === "page" && options.count ? options.count() : Promise.resolve(undefined)]);

	return buildPage({
		rows,
		limit: query.limit,
		mode,
		sort: query.sort,
		order: query.order,
		filtersHash: hash,
		page: query.page,
		total,
		getCursorValue: options.getCursorValue ?? ((row: Row) => (row as any)[options.field]),
		getId: options.getId ?? ((row: Row) => (row as any)[idField]),
		map: options.map,
	});
}
