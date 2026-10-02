"use strict";
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { z } = require("zod");

const { dist, captureLogs, request } = require("./helpers");

const logs = captureLogs();
const { util } = dist("index");
const { ApiError, errorHandler, getClientIp, validate, createRequestIdMiddleware, responserMiddleware, toApiError } = util.http;

class PrismaClientKnownRequestError extends Error {
	constructor(code) {
		super(`prisma ${code}`);
		this.name = "PrismaClientKnownRequestError";
		this.code = code;
	}
}

describe("util.http errorHandler eşlemeleri", () => {
	let server;
	const port = () => server.address().port;

	before(async () => {
		const app = express();
		app.use(responserMiddleware);
		app.get("/zod", () => {
			z.object({ name: z.string().min(3, "İsim en az 3 karakter") }).parse({ name: "a" });
		});
		app.get("/p2002", () => {
			throw new PrismaClientKnownRequestError("P2002");
		});
		app.get("/p2025", () => {
			throw new PrismaClientKnownRequestError("P2025");
		});
		app.get("/p9999", () => {
			throw new PrismaClientKnownRequestError("P9999");
		});
		app.get("/api", () => {
			throw new ApiError("Yok", 404, "NOT_FOUND", { id: 1 });
		});
		app.get("/boom", () => {
			throw new Error("gizli iç detay");
		});
		app.use(errorHandler);
		await new Promise(resolve => (server = app.listen(0, "127.0.0.1", resolve)));
	});

	after(() => new Promise(resolve => server.close(resolve)));

	test("ZodError → 400 INVALID_INPUT, ilk issue mesajı ve path", async () => {
		const res = await request(port(), { path: "/zod" });
		assert.equal(res.status, 400);
		assert.equal(res.json.code, "INVALID_INPUT");
		assert.equal(res.json.message, "İsim en az 3 karakter");
		assert.deepEqual(res.json.data, { path: ["name"] });
	});

	test("Prisma P2002 → 409 CONFLICT, P2025 → 404 NOT_FOUND, diğerleri 500", async () => {
		const a = await request(port(), { path: "/p2002" });
		assert.equal(a.status, 409);
		assert.equal(a.json.code, "CONFLICT");
		const b = await request(port(), { path: "/p2025" });
		assert.equal(b.status, 404);
		assert.equal(b.json.code, "NOT_FOUND");
		const c = await request(port(), { path: "/p9999" });
		assert.equal(c.status, 500);
		assert.equal(c.json.code, "INTERNAL_ERROR");
	});

	test("ApiError davranışı değişmedi; 500 iç detayı sızdırmaz", async () => {
		const a = await request(port(), { path: "/api" });
		assert.equal(a.status, 404);
		assert.deepEqual(a.json.data, { id: 1 });
		const b = await request(port(), { path: "/boom" });
		assert.equal(b.status, 500);
		assert.equal(b.json.code, "INTERNAL_ERROR");
		assert.doesNotMatch(b.body, /gizli iç detay/);
		assert.ok(logs.some(l => l.level === "error" && /gizli iç detay/.test(l.text)));
	});

	test("toApiError tanınmayan hatada null", () => {
		assert.equal(toApiError(new Error("x")), null);
		assert.equal(toApiError(new PrismaClientKnownRequestError("P2002")).status, 409);
	});
});

describe("util.http validate", () => {
	test("başarıda veri döner, hatada 400 INVALID_INPUT fırlatır", () => {
		const schema = z.object({ a: z.coerce.number() });
		assert.deepEqual(validate(schema, { a: "5" }), { a: 5 });
		assert.throws(
			() => validate(schema, { a: "x" }),
			err => err instanceof ApiError && err.status === 400 && err.code === "INVALID_INPUT" && Array.isArray(err.data.path),
		);
	});
});

describe("util.http getClientIp", () => {
	const fakeReq = (remoteAddress, xff, ip) => ({ socket: { remoteAddress }, headers: xff === undefined ? {} : { "x-forwarded-for": xff }, ip });

	test("varsayılan: soket adresi, ::ffff: kırpılır, başlığa güvenilmez", () => {
		assert.equal(getClientIp(fakeReq("::ffff:10.0.0.5", "1.2.3.4")), "10.0.0.5");
		assert.equal(getClientIp(fakeReq(undefined)), "unknown");
	});

	test("trustedForwardHeader true ise X-Forwarded-For'un ilk değeri", () => {
		const req = fakeReq("10.0.0.5", " 1.2.3.4 , 5.6.7.8");
		assert.equal(getClientIp(req, { trustedForwardHeader: () => true }), "1.2.3.4");
		assert.equal(getClientIp(req, { trustedForwardHeader: () => false }), "10.0.0.5");
		assert.equal(getClientIp(fakeReq("10.0.0.5", ["9.9.9.9", "8.8.8.8"]), { trustedForwardHeader: () => true }), "9.9.9.9");
		assert.equal(getClientIp(fakeReq("10.0.0.5", ""), { trustedForwardHeader: () => true }), "10.0.0.5");
	});

	test("trustProxy: req.ip kullanılır", () => {
		assert.equal(getClientIp(fakeReq("10.0.0.5", undefined, "::ffff:7.7.7.7"), { trustProxy: true }), "7.7.7.7");
	});
});

describe("util.http createRequestIdMiddleware", () => {
	function run(mw, headers) {
		const req = { headers: { ...headers } };
		const set = {};
		const res = { setHeader: (k, v) => (set[k] = v) };
		let called = false;
		mw(req, res, () => (called = true));
		assert.equal(called, true);
		return { header: set["X-Request-Id"], reqHeader: req.headers["x-request-id"] };
	}

	test("trustIncoming false ise gelen değer yerine UUID üretilir", () => {
		const mw = createRequestIdMiddleware({ trustIncoming: req => req.trusted === true });
		const out = run(mw, { "x-request-id": "abc-123" });
		assert.notEqual(out.header, "abc-123");
		assert.match(out.header, /^[0-9a-f-]{36}$/);
		assert.equal(out.reqHeader, out.header);
	});

	test("trustIncoming true ise güvenli değer korunur, güvensiz olan değiştirilir", () => {
		const mw = createRequestIdMiddleware({ trustIncoming: () => true });
		assert.equal(run(mw, { "x-request-id": "abc-123" }).header, "abc-123");
		assert.notEqual(run(mw, { "x-request-id": "kötü\nbaşlık" }).header, "kötü\nbaşlık");
	});
});
