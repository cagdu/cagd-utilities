"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");

const { dist, captureLogs } = require("./helpers");

captureLogs();
const { util } = dist("index");
const { createListQuerySchema, booleanQuery, encodeCursor, decodeCursor, filtersHash, keysetWhere, orderBy, pageArgs, buildPage, paginate } = util.list;
const { ApiError } = util.http;

const schema = createListQuerySchema(z, {
	sorts: ["createdAt", "name"],
	defaultSort: "createdAt",
	filters: { isEnabled: booleanQuery(z).optional(), status: z.enum(["A", "B"]).optional() },
});

/** Prisma `where`'inin küçük bir alt kümesini (OR/NOT/eşitlik/gt/lt/null) bellekteki satırlar üzerinde değerlendirir. */
function matches(row, where) {
	if (!where) return true;
	return Object.entries(where).every(([key, cond]) => {
		if (key === "OR") return cond.some(c => matches(row, c));
		if (key === "AND") return cond.every(c => matches(row, c));
		if (key === "NOT") return !matches(row, cond);
		const v = row[key];
		if (cond === null) return v === null;
		if (cond instanceof Date || typeof cond !== "object") return cmp(v, cond) === 0 && v !== null;
		if ("gt" in cond) return v !== null && cmp(v, cond.gt) > 0;
		if ("lt" in cond) return v !== null && cmp(v, cond.lt) < 0;
		throw new Error(`desteklenmeyen koşul: ${JSON.stringify(cond)}`);
	});
}

function cmp(a, b) {
	const x = a instanceof Date ? a.getTime() : a;
	const y = b instanceof Date ? b.getTime() : b;
	return x < y ? -1 : x > y ? 1 : 0;
}

/** SQL Server sıralaması: NULL en küçük değer. */
function sortRows(rows, ob) {
	return rows.slice().sort((r1, r2) => {
		for (const o of ob) {
			const [field, dir] = Object.entries(o)[0];
			const a = r1[field];
			const b = r2[field];
			let c;
			if (a === null && b === null) c = 0;
			else if (a === null) c = -1;
			else if (b === null) c = 1;
			else c = cmp(a, b);
			if (c !== 0) return dir === "asc" ? c : -c;
		}
		return 0;
	});
}

function fakeFindMany(rows) {
	return async args => {
		const filtered = rows.filter(r => matches(r, args.where));
		const sorted = sortRows(filtered, args.orderBy);
		return sorted.slice(args.skip ?? 0, (args.skip ?? 0) + args.take);
	};
}

describe("util.list şema", () => {
	test("varsayılanlar", () => {
		const q = schema.parse({});
		assert.deepEqual(q, { limit: 20, sort: "createdAt", order: "desc" });
	});

	test("limit sınırları ve coerce", () => {
		assert.equal(schema.parse({ limit: "100" }).limit, 100);
		assert.equal(schema.safeParse({ limit: "0" }).success, false);
		assert.equal(schema.safeParse({ limit: "101" }).success, false);
		assert.equal(schema.safeParse({ limit: "abc" }).success, false);
	});

	test("cursor ve page birlikte → hata", () => {
		const r = schema.safeParse({ cursor: "abc", page: "1" });
		assert.equal(r.success, false);
		assert.equal(r.error.issues[0].message, "cursor and page cannot be used together");
	});

	test("geçersiz sort/order reddedilir", () => {
		assert.equal(schema.safeParse({ sort: "password" }).success, false);
		assert.equal(schema.safeParse({ order: "up" }).success, false);
	});

	test("q kırpılır, boşsa yok sayılır, 200 karakter sınırı", () => {
		assert.equal(schema.parse({ q: "  ali  " }).q, "ali");
		assert.equal(schema.parse({ q: "   " }).q, undefined);
		assert.equal(schema.safeParse({ q: "x".repeat(201) }).success, false);
	});

	test("boolean filtre dönüşümü ve uca özel filtreler", () => {
		assert.equal(schema.parse({ isEnabled: "false" }).isEnabled, false);
		assert.equal(schema.parse({ isEnabled: "1" }).isEnabled, true);
		assert.equal(schema.safeParse({ isEnabled: "evet" }).success, false);
		assert.equal(schema.parse({ status: "A" }).status, "A");
	});

	test("filters z.object olarak da verilebilir; maxLimit/defaultLimit/defaultOrder", () => {
		const s = createListQuerySchema(z, { sorts: ["id"], defaultSort: "id", defaultOrder: "asc", maxLimit: 5, defaultLimit: 2, filters: z.object({ x: z.string().optional() }) });
		assert.deepEqual(s.parse({ x: "1" }), { limit: 2, sort: "id", order: "asc", x: "1" });
		assert.equal(s.safeParse({ limit: "6" }).success, false);
	});
});

describe("util.list cursor", () => {
	test("encode/decode: tarih, sayı, bigint, null, string", () => {
		for (const value of [new Date("2026-10-02T10:00:00.123Z"), 42, 10n ** 20n, null, "abc", true]) {
			const raw = encodeCursor({ sort: "createdAt", order: "desc", value, id: "id-1", filtersHash: "h" });
			assert.match(raw, /^[A-Za-z0-9_-]+$/);
			const out = decodeCursor(raw, { sort: "createdAt", order: "desc", filtersHash: "h" });
			assert.deepEqual(out, { value, id: "id-1" });
		}
	});

	test("Decimal benzeri nesne string olarak taşınır", () => {
		const decimal = { toString: () => "12.50" };
		const raw = encodeCursor({ sort: "price", order: "asc", value: decimal, id: 1 });
		assert.deepEqual(decodeCursor(raw, { sort: "price", order: "asc" }), { value: "12.50", id: 1 });
	});

	test("sort/order/filtre uyuşmazlığı ve bozuk cursor → 400 INVALID_INPUT", () => {
		const raw = encodeCursor({ sort: "createdAt", order: "desc", value: 1, id: "a", filtersHash: "h1" });
		const bad = [
			() => decodeCursor(raw, { sort: "name", order: "desc", filtersHash: "h1" }),
			() => decodeCursor(raw, { sort: "createdAt", order: "asc", filtersHash: "h1" }),
			() => decodeCursor(raw, { sort: "createdAt", order: "desc", filtersHash: "h2" }),
			() => decodeCursor(raw, { sort: "createdAt", order: "desc" }),
			() => decodeCursor("!!!", { sort: "createdAt", order: "desc" }),
			() => decodeCursor(Buffer.from("not json").toString("base64url"), { sort: "createdAt", order: "desc" }),
			() => decodeCursor(Buffer.from(JSON.stringify({ s: "createdAt", o: "desc", v: { t: "d", v: "x" }, i: "a" })).toString("base64url"), { sort: "createdAt", order: "desc" }),
			() => decodeCursor("a".repeat(2000), { sort: "createdAt", order: "desc" }),
		];
		for (const fn of bad) {
			assert.throws(fn, err => err instanceof ApiError && err.status === 400 && err.code === "INVALID_INPUT" && err.message === "Invalid cursor");
		}
	});

	test("filtersHash: sayfalama alanlarını yok sayar, anahtar sırasından bağımsız", () => {
		assert.equal(filtersHash({ limit: 20, sort: "x", order: "asc", cursor: "c" }), "");
		const a = filtersHash({ limit: 20, q: "ali", status: "A" });
		const b = filtersHash({ status: "A", q: "ali", limit: 50, page: 3 });
		assert.equal(a, b);
		assert.notEqual(a, filtersHash({ q: "ali", status: "B" }));
	});
});

describe("util.list Prisma yardımcıları", () => {
	test("orderBy ve pageArgs", () => {
		assert.deepEqual(orderBy({ field: "CreatedAt", order: "desc" }), [{ CreatedAt: "desc" }, { Id: "desc" }]);
		assert.deepEqual(orderBy({ field: "Id", order: "asc" }), [{ Id: "asc" }]);
		assert.deepEqual(pageArgs({ page: 3, limit: 20 }), { skip: 40, take: 21 });
	});

	test("keysetWhere şekli", () => {
		assert.deepEqual(keysetWhere({ field: "Name", order: "asc", cursor: { value: "b", id: "2" } }), { OR: [{ Name: { gt: "b" } }, { Name: "b", Id: { gt: "2" } }] });
		assert.deepEqual(keysetWhere({ field: "Id", order: "desc", cursor: { value: "x", id: "9" } }), { Id: { lt: "9" } });
	});

	test("buildPage: cursor modu son sayfa ve devam", () => {
		const rows = [
			{ Id: "1", N: 1 },
			{ Id: "2", N: 2 },
			{ Id: "3", N: 3 },
		];
		const more = buildPage({ rows, limit: 2, mode: "cursor", sort: "n", order: "asc", getCursorValue: r => r.N });
		assert.equal(more.items.length, 2);
		assert.equal(more.hasMore, true);
		assert.deepEqual(decodeCursor(more.nextCursor, { sort: "n", order: "asc" }), { value: 2, id: "2" });
		assert.equal(more.page, undefined);
		assert.equal(more.total, undefined);

		const last = buildPage({ rows: rows.slice(0, 2), limit: 2, mode: "cursor", sort: "n", order: "asc", getCursorValue: r => r.N, map: r => r.Id });
		assert.deepEqual(last, { items: ["1", "2"], nextCursor: null, hasMore: false, limit: 2 });
	});

	test("buildPage: page modu total/totalPages", () => {
		const p = buildPage({ rows: [{ Id: "1" }], limit: 20, mode: "page", page: 2, total: 21, sort: "x", order: "asc", getCursorValue: () => 1 });
		assert.deepEqual(
			{ page: p.page, total: p.total, totalPages: p.totalPages, hasMore: p.hasMore, nextCursor: p.nextCursor },
			{ page: 2, total: 21, totalPages: 2, hasMore: false, nextCursor: null },
		);
	});
});

describe("util.list paginate (bellek içi keyset)", () => {
	// Eşit sıralama değerleri ve NULL'lar bilerek var.
	const rows = [];
	for (let i = 0; i < 23; i++) rows.push({ Id: `id-${String(i).padStart(2, "0")}`, CreatedAt: new Date(Date.UTC(2026, 0, 1 + (i % 4))), Name: i % 5 === 0 ? null : `n${i % 3}` });

	async function walk(field, order, opts = {}) {
		const seen = [];
		let cursor;
		for (let guard = 0; guard < 50; guard++) {
			const query = schema.parse({ limit: "4", sort: field === "Name" ? "name" : "createdAt", order, ...(cursor ? { cursor } : {}) });
			const page = await paginate(query, { field, findMany: fakeFindMany(rows), ...opts });
			seen.push(...page.items.map(r => r.Id));
			if (!page.nextCursor) {
				assert.equal(page.hasMore, false);
				break;
			}
			cursor = page.nextCursor;
		}
		return seen;
	}

	for (const order of ["asc", "desc"]) {
		test(`eşit değerlerde atlamasız/tekrarsız gezinme (CreatedAt ${order})`, async () => {
			const seen = await walk("CreatedAt", order);
			assert.equal(seen.length, rows.length);
			assert.equal(new Set(seen).size, rows.length);
			assert.deepEqual(
				seen,
				sortRows(rows, orderBy({ field: "CreatedAt", order })).map(r => r.Id),
			);
		});

		test(`NULL içeren alanda gezinme (Name ${order}, nulls low)`, async () => {
			const seen = await walk("Name", order, { nullable: true });
			assert.equal(new Set(seen).size, rows.length);
			assert.deepEqual(
				seen,
				sortRows(rows, orderBy({ field: "Name", order })).map(r => r.Id),
			);
		});
	}

	test("page modu: skip/take ve total", async () => {
		const query = schema.parse({ page: "2", limit: "10" });
		const page = await paginate(query, { field: "CreatedAt", findMany: fakeFindMany(rows), count: async () => rows.length });
		assert.equal(page.items.length, 10);
		assert.equal(page.page, 2);
		assert.equal(page.total, 23);
		assert.equal(page.totalPages, 3);
		assert.equal(page.hasMore, true);
	});

	test("filtre değişince eski cursor reddedilir", async () => {
		const first = await paginate(schema.parse({ limit: "2", status: "A" }), { field: "CreatedAt", findMany: fakeFindMany(rows) });
		await assert.rejects(paginate(schema.parse({ limit: "2", status: "B", cursor: first.nextCursor }), { field: "CreatedAt", findMany: fakeFindMany(rows) }), err => err.code === "INVALID_INPUT");
		await assert.rejects(
			paginate(schema.parse({ limit: "2", status: "A", order: "asc", cursor: first.nextCursor }), { field: "CreatedAt", findMany: fakeFindMany(rows) }),
			err => err.code === "INVALID_INPUT",
		);
	});
});
