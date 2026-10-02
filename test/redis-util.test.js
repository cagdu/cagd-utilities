"use strict";
/**
 * util.redis: önbellek, kilit, onceEvery, rate limit.
 * Redis'siz (süreç içi) testler her zaman çalışır; gerçek sunucu testleri için: TEST_REDIS_URL=redis://127.0.0.1:6379 npm test
 */
const { test, describe, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { dist, captureLogs, request } = require("./helpers");

const logs = captureLogs();
const { config, baseConfig, service, util } = dist("index");
config.manager.setDefaultConfig(baseConfig, { useFile: false, env: false });

const REDIS_URL = process.env.TEST_REDIS_URL;
const R = util.redis;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uniq = prefix => `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;

/** Her komutta hata veren sahte client: "bağlı görünüp komutta kopan" Redis. */
const brokenClient = {
	isReady: true,
	sendCommand: async () => {
		throw new Error("ECONNRESET");
	},
};

async function startApp(router) {
	const app = express();
	app.use(util.http.responserMiddleware);
	app.use(router);
	app.use(util.http.errorHandler);
	return new Promise(resolve => {
		const server = app.listen(0, "127.0.0.1", () => resolve(server));
	});
}

function suite(label, setup) {
	describe(`util.redis (${label})`, () => {
		before(setup.before);
		after(setup.after);

		test("cache: get/set/del, null önbelleğe alınabilir, TTL", async () => {
			const cache = R.createCache({ namespace: uniq("t:cache"), ttlSec: 1 });
			assert.equal(await cache.get("a"), undefined);
			await cache.set("a", { x: 1 });
			assert.deepEqual(await cache.get("a"), { x: 1 });
			await cache.set("n", null);
			assert.equal(await cache.get("n"), null);
			await cache.del("a");
			assert.equal(await cache.get("a"), undefined);
			await cache.set("short", 1);
			await sleep(1100);
			assert.equal(await cache.get("short"), undefined);
		});

		test("cache.getOrLoad: tekilleştirme (single-flight) ve undefined önbelleğe alınmaz", async () => {
			const cache = R.createCache({ namespace: uniq("t:load"), ttlSec: 30 });
			let calls = 0;
			const loader = async () => {
				calls++;
				await sleep(30);
				return ["P1"];
			};
			const results = await Promise.all([cache.getOrLoad("k", loader), cache.getOrLoad("k", loader), cache.getOrLoad("k", loader)]);
			assert.equal(calls, 1);
			for (const r of results) assert.deepEqual(r, ["P1"]);
			assert.deepEqual(await cache.getOrLoad("k", loader), ["P1"]);
			assert.equal(calls, 1);

			let u = 0;
			await cache.getOrLoad("u", () => (u++, undefined));
			await cache.getOrLoad("u", () => (u++, undefined));
			assert.equal(u, 2);
		});

		// Süreler uzak (yüksek gecikmeli) Redis'te de kararlı olacak şekilde seçildi.
		test("lock: ikinci alıcı null, bırakınca alınabilir, TTL dolunca alınabilir, başkasının kilidi bırakılamaz", async () => {
			const name = uniq("t:lock");
			const a = await R.acquireLock(name, { ttlMs: 5000 });
			assert.ok(a);
			assert.equal(await R.acquireLock(name, { ttlMs: 5000 }), null);
			assert.equal(await a.release(), true);
			assert.equal(await a.release(), false, "zaten bırakılmış");

			const b = await R.acquireLock(name, { ttlMs: 600 });
			assert.ok(b);
			await sleep(900);
			const c = await R.acquireLock(name, { ttlMs: 5000 });
			assert.ok(c, "TTL dolunca alınabilmeli");
			assert.equal(await b.release(), false, "süresi dolmuş sahip yeni sahibin kilidini bırakamaz");
			assert.equal(await b.extend(5000), false);
			assert.equal(await c.extend(5000), true);
			assert.equal(await R.acquireLock(name, { ttlMs: 5000 }), null);
			assert.equal(await c.release(), true);
		});

		test("lock: waitMs ile bekleme ve withLock", async () => {
			const name = uniq("t:wait");
			const a = await R.acquireLock(name, { ttlMs: 10000 });
			setTimeout(() => a.release(), 80);
			const b = await R.acquireLock(name, { ttlMs: 10000, waitMs: 5000, retryMs: 20 });
			assert.ok(b);
			assert.deepEqual(await R.withLock(name, { ttlMs: 5000 }, () => 1), { acquired: false });
			await b.release();
			assert.deepEqual(await R.withLock(name, { ttlMs: 5000 }, () => 42), { acquired: true, result: 42 });
			const d = await R.acquireLock(name, { ttlMs: 5000 });
			assert.ok(d, "withLock sonunda bırakmalı");
			await d.release();
		});

		test("onceEvery: pencerede yalnızca ilk çağrı true", async () => {
			const key = uniq("t:once");
			assert.equal(await R.onceEvery(key, 1), true);
			assert.equal(await R.onceEvery(key, 1), false);
			await sleep(1100);
			assert.equal(await R.onceEvery(key, 1), true);
		});

		test("consume: sınır, remaining, retryAfterSec", async () => {
			const name = uniq("t:consume");
			const opts = { windowSec: 30, max: 2 };
			const r1 = await R.consume(name, "user-1", opts);
			assert.deepEqual({ allowed: r1.allowed, remaining: r1.remaining, retry: r1.retryAfterSec }, { allowed: true, remaining: 1, retry: 0 });
			const r2 = await R.consume(name, "user-1", opts);
			assert.equal(r2.allowed, true);
			const r3 = await R.consume(name, "user-1", opts);
			assert.equal(r3.allowed, false);
			assert.equal(r3.remaining, 0);
			assert.ok(r3.retryAfterSec >= 1 && r3.retryAfterSec <= 30);
			assert.equal((await R.consume(name, "user-2", opts)).allowed, true, "kimlikler ayrı sayılır");
		});

		test("rateLimiter: sınırda 429 RATE_LIMITED + Retry-After + RateLimit-* ; skip", async () => {
			const name = uniq("t:mw");
			const router = express.Router();
			router.get("/x", R.rateLimiter({ name, windowSec: 60, max: 2, key: req => req.headers["x-id"] ?? "anon", skip: req => req.headers["x-skip"] === "1" }), (_req, res) =>
				res.success({ data: "ok" }),
			);
			const server = await startApp(router);
			const port = server.address().port;
			try {
				const h = { "x-id": "secret-identity", authorization: "Bearer should-not-be-logged" };
				const a = await request(port, { path: "/x", headers: h });
				assert.equal(a.status, 200);
				assert.equal(a.headers["ratelimit-limit"], "2");
				assert.equal(a.headers["ratelimit-remaining"], "1");
				await request(port, { path: "/x", headers: h });
				const c = await request(port, { path: "/x", headers: h });
				assert.equal(c.status, 429);
				assert.equal(c.json.code, "RATE_LIMITED");
				const retry = Number(c.headers["retry-after"]);
				assert.ok(retry >= 1 && retry <= 60, `Retry-After: ${retry}`);
				assert.equal((await request(port, { path: "/x", headers: { ...h, "x-skip": "1" } })).status, 200);
				assert.equal((await request(port, { path: "/x", headers: { "x-id": "other" } })).status, 200);
			} finally {
				await new Promise(resolve => server.close(resolve));
			}
			const text = logs.map(l => l.text).join("\n");
			assert.doesNotMatch(text, /secret-identity|should-not-be-logged|Bearer /);
		});
	});
}

suite("Redis'siz, süreç içi", {
	before: () => R.setRedisClient(null),
	after: () => R.setRedisClient(undefined),
});

suite("komutta kopan Redis → süreç içi yedek", {
	before: () => {
		R.resetWarnings();
		R.setRedisClient(brokenClient);
	},
	after: () => {
		R.setRedisClient(undefined);
		assert.ok(
			logs.some(l => l.level === "warn" && /util\.redis/.test(l.text)),
			"yedeğe geçişte uyarı loglanmalı",
		);
	},
});

describe("util.redis cache memoryTtlSec", () => {
	afterEach(() => R.setRedisClient(undefined));

	test("süreç içi yedekte değer memoryTtlSec'ten uzun tutulmaz", async () => {
		R.setRedisClient(null);
		const cache = R.createCache({ namespace: uniq("t:memttl"), ttlSec: 60, memoryTtlSec: 1 });
		await cache.set("k", 1);
		assert.equal(await cache.get("k"), 1);
		await sleep(1100);
		assert.equal(await cache.get("k"), undefined);
	});
});

describe("util.redis uyarı kısıtlaması", () => {
	afterEach(() => R.setRedisClient(undefined));

	test("aynı kaynak için dakikada en fazla bir uyarı", async () => {
		R.resetWarnings();
		R.setRedisClient(brokenClient);
		const before = logs.filter(l => l.level === "warn").length;
		const cache = R.createCache({ namespace: uniq("t:warn"), ttlSec: 5 });
		for (let i = 0; i < 5; i++) await cache.get("x");
		assert.equal(logs.filter(l => l.level === "warn").length - before, 1);
	});
});

describe("util.redis (gerçek sunucu)", { skip: !REDIS_URL && "TEST_REDIS_URL tanımlı değil" }, () => {
	before(async () => {
		R.setRedisClient(undefined);
		config.manager.setConfig({ services: { redis: { url: REDIS_URL, connectRetries: 5 } } });
		await service.redis.start();
	});
	after(async () => {
		await service.redis.stop();
	});

	test("service.redis bağlıyken yapılar Redis'i kullanır", async () => {
		assert.ok(R.getRedisClient(), "bağlı client bulunmalı");
		const ns = uniq("t:real");
		const cache = R.createCache({ namespace: ns, ttlSec: 30 });
		await cache.set("k", { a: 1 });
		assert.equal(await service.redis.client.get(`${ns}:k`), JSON.stringify({ v: { a: 1 } }));
		await cache.del("k");

		const name = uniq("t:real-lock");
		const lock = await R.acquireLock(name, { ttlMs: 5000 });
		assert.ok(await service.redis.client.get(`lock:${name}`));
		await lock.release();
		assert.equal(await service.redis.client.get(`lock:${name}`), null);
	});

	// Gerçek sunucu altında da aynı davranış sözleşmesi.
	suite("Redis'li", { before: () => {}, after: () => {} });

	test("bağlantı koparsa (servis durursa) yedeğe geçilir, istek düşmez", async () => {
		const cache = R.createCache({ namespace: uniq("t:drop"), ttlSec: 30 });
		await cache.set("k", 1);
		await service.redis.stop();
		assert.equal(R.getRedisClient(), null);
		assert.equal(await cache.get("k"), undefined, "Redis'teki değer görünmez; süreç içi önbellek boş");
		await cache.set("k", 2);
		assert.equal(await cache.get("k"), 2);
		assert.equal(await R.onceEvery(uniq("t:drop-once"), 10), true);
		assert.equal((await R.consume(uniq("t:drop-rl"), "x", { windowSec: 10, max: 1 })).allowed, true);
		await service.redis.start();
	});
});
