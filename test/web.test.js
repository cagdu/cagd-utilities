"use strict";
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

const { dist, tmpDir, captureLogs, request } = require("./helpers");

captureLogs();
const { config, baseConfig, service, util } = dist("index");
const { ApiError } = util.http;

config.manager.setDefaultConfig(baseConfig, { useFile: false, env: false });
config.manager.setConfig({ services: { web: { rateLimit: { limit: 1000 }, shutdownTimeoutMs: 1000 } } });

const portOf = () => service.web.server.address().port;

function apiRouter() {
	const r = express.Router();
	r.get("/ok", (_req, res) => res.success({ data: { hello: "world" } }));
	r.get("/api-error", () => {
		throw new ApiError("Geçersiz e-posta", 422, "INVALID_EMAIL", { field: "email" });
	});
	r.get("/boom", () => {
		throw new Error("gizli iç detay");
	});
	r.post("/echo", (req, res) => res.success({ data: req.body }));
	r.get("/slow", (_req, res) => setTimeout(() => res.success({ data: "late" }), 300));
	return r;
}

describe("service.web + createExpressApp", () => {
	before(async () => {
		await service.web.start({
			port: 0,
			routers: [
				["/api", apiRouter()],
				["/api", util.http.healthRouter()],
			],
		});
	});

	after(async () => {
		await service.stopAll();
	});

	test("başarılı cevap standart formatta ve X-Request-Id içerir", async () => {
		const res = await request(portOf(), { path: "/api/ok" });
		assert.equal(res.status, 200);
		assert.equal(res.json.error, false);
		assert.deepEqual(res.json.data, { hello: "world" });
		assert.match(res.headers["x-request-id"], /^[0-9a-f-]{36}$/);
		assert.equal(res.json.transaction.request_id, res.headers["x-request-id"]);
		assert.equal(typeof res.json.transaction.duration_ms, "number");
	});

	test("geçerli gelen X-Request-Id korunur, güvensiz olan değiştirilir", async () => {
		const ok = await request(portOf(), { path: "/api/ok", headers: { "x-request-id": "abc-123" } });
		assert.equal(ok.headers["x-request-id"], "abc-123");
		const bad = await request(portOf(), { path: "/api/ok", headers: { "x-request-id": "<script>" } });
		assert.notEqual(bad.headers["x-request-id"], "<script>");
	});

	test("404 standart formatta", async () => {
		const res = await request(portOf(), { path: "/yok" });
		assert.equal(res.status, 404);
		assert.equal(res.json.error, true);
		assert.equal(res.json.code, "NOT_FOUND");
		assert.ok(res.json.transaction.request_id);
	});

	test("ApiError kendi status/code/data'sı ile döner", async () => {
		const res = await request(portOf(), { path: "/api/api-error" });
		assert.equal(res.status, 422);
		assert.equal(res.json.code, "INVALID_EMAIL");
		assert.equal(res.json.message, "Geçersiz e-posta");
		assert.deepEqual(res.json.data, { field: "email" });
	});

	test("beklenmeyen hata 500 döner ve iç detayı sızdırmaz", async () => {
		const res = await request(portOf(), { path: "/api/boom" });
		assert.equal(res.status, 500);
		assert.equal(res.json.code, "INTERNAL_ERROR");
		assert.ok(!res.body.includes("gizli iç detay"));
	});

	test("bozuk JSON 400 döner", async () => {
		const res = await request(portOf(), { method: "POST", path: "/api/echo", headers: { "content-type": "application/json" }, body: "{bozuk" });
		assert.equal(res.status, 400);
		assert.equal(res.json.code, "BAD_REQUEST");
	});

	test("JSON gövdesi işlenir", async () => {
		const res = await request(portOf(), { method: "POST", path: "/api/echo", headers: { "content-type": "application/json" }, body: '{"a":1}' });
		assert.deepEqual(res.json.data, { a: 1 });
	});

	test("healthRouter başlatılmış servislerin durumunu döner", async () => {
		const res = await request(portOf(), { path: "/api/health" });
		assert.equal(res.status, 200);
		assert.deepEqual(res.json.data, { web: true });
	});

	test("service.web.app oluşturulan Express uygulamasını verir", () => {
		assert.equal(typeof service.web.app, "function");
		assert.equal(typeof service.web.app.use, "function");
	});

	test("çalışırken configure() hata fırlatır, sunucu çalışmaya devam eder", async () => {
		assert.throws(() => service.web.configure({ port: 1 }), /çalışırken configure/);
		const res = await request(portOf(), { path: "/api/ok" });
		assert.equal(res.status, 200);
	});
});

describe("service.web yaşam döngüsü", () => {
	test("port doluysa start() reject olur (asılı kalmaz)", async () => {
		const blocker = net.createServer();
		await new Promise(r => blocker.listen(0, "127.0.0.1", r));
		const port = blocker.address().port;
		try {
			service.web.configure({ port, routers: [] });
			await assert.rejects(service.web.start(), err => err.code === "EADDRINUSE" && /kullanımda/.test(err.message));
			assert.equal(service.web.started, false);
		} finally {
			await new Promise(r => blocker.close(r));
		}
		// Port boşaldıktan sonra aynı ayarlarla tekrar başlatılabilir.
		service.web.configure({ port: 0 });
		await service.web.start();
		assert.equal(service.web.started, true);
		await service.web.stop();
	});

	test("stop() açık keep-alive bağlantısı olsa da hemen biter, süren isteği tamamlar", async () => {
		service.web.configure({ port: 0, routers: [["/api", apiRouter()]] });
		await service.web.start();
		const port = portOf();
		const agent = new http.Agent({ keepAlive: true });
		await request(port, { path: "/api/ok", agent }); // boşta keep-alive bağlantı kalır
		const slow = request(port, { path: "/api/slow", agent: new http.Agent({ keepAlive: true }) });
		await new Promise(r => setTimeout(r, 50));

		const t0 = Date.now();
		await service.web.stop();
		const elapsed = Date.now() - t0;
		assert.ok(elapsed < 900, `stop() ${elapsed}ms sürdü`);
		const slowRes = await slow;
		assert.equal(slowRes.json.data, "late");
		agent.destroy();
	});

	test("rate limit 429 standart formatta döner", async () => {
		config.manager.setConfig({ services: { web: { rateLimit: { limit: 2 } } } });
		service.web.configure({ port: 0, routers: [["/api", apiRouter()]] });
		await service.web.start();
		try {
			const port = portOf();
			await request(port, { path: "/api/ok" });
			await request(port, { path: "/api/ok" });
			const res = await request(port, { path: "/api/ok" });
			assert.equal(res.status, 429);
			assert.equal(res.json.code, "RATE_LIMITED");
			assert.equal(res.json.message, baseConfig.services.web.rateLimit.message);
		} finally {
			await service.web.stop();
			config.manager.setConfig({ services: { web: { rateLimit: { limit: 1000 } } } });
		}
	});

	test("eski config'teki obje şeklindeki rateLimit.message da çalışır", async () => {
		config.manager.setConfig({ services: { web: { rateLimit: { limit: 1, message: { error: "Yavaş!" } } } } });
		service.web.configure({ port: 0, routers: [["/api", apiRouter()]] });
		await service.web.start();
		try {
			await request(portOf(), { path: "/api/ok" });
			const res = await request(portOf(), { path: "/api/ok" });
			assert.equal(res.json.message, "Yavaş!");
		} finally {
			await service.web.stop();
			config.manager.setConfig({ services: { web: { rateLimit: { limit: 1000, message: baseConfig.services.web.rateLimit.message } } } });
		}
	});

	test("statik dizin varsayılan olarak kapalı ve otomatik oluşturulmaz", async () => {
		const cwd = process.cwd();
		const dir = tmpDir();
		process.chdir(dir);
		try {
			service.web.configure({ port: 0, routers: [] });
			await service.web.start();
			assert.equal(fs.existsSync(path.join(dir, "public")), false);
			await service.web.stop();
		} finally {
			process.chdir(cwd);
		}
	});

	test("statik dizin verilirse router'lardan önce ve rate limit dışında sunulur", async () => {
		const dir = tmpDir();
		fs.writeFileSync(path.join(dir, "hello.txt"), "merhaba");
		config.manager.setConfig({ services: { web: { rateLimit: { limit: 1 } } } });
		service.web.configure({ port: 0, staticDir: dir, routers: [["/api", apiRouter()]] });
		await service.web.start();
		try {
			for (let i = 0; i < 3; i++) {
				const res = await request(portOf(), { path: "/hello.txt" });
				assert.equal(res.status, 200);
				assert.equal(res.body, "merhaba");
			}
		} finally {
			await service.web.stop();
			config.manager.setConfig({ services: { web: { rateLimit: { limit: 1000 } } } });
			service.web.configure({ staticDir: false });
		}
	});

	test("body limit config'ten okunur", async () => {
		config.manager.setConfig({ services: { web: { bodyLimit: "10b" } } });
		service.web.configure({ port: 0, routers: [["/api", apiRouter()]] });
		await service.web.start();
		try {
			const res = await request(portOf(), { method: "POST", path: "/api/echo", headers: { "content-type": "application/json" }, body: '{"a":"0123456789"}' });
			assert.equal(res.status, 413);
			assert.equal(res.json.code, "PAYLOAD_TOO_LARGE");
		} finally {
			await service.web.stop();
			config.manager.setConfig({ services: { web: { bodyLimit: baseConfig.services.web.bodyLimit } } });
		}
	});

	test("SSL: mutlak yol olduğu gibi kullanılır", async t => {
		const { execFileSync } = require("node:child_process");
		const dir = tmpDir();
		try {
			execFileSync(
				"openssl",
				["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "private.key"), "-out", path.join(dir, "origin.pem"), "-days", "1", "-subj", "/CN=localhost"],
				{ stdio: "ignore" },
			);
		} catch {
			t.skip("openssl yok");
			return;
		}
		config.manager.setConfig({ services: { web: { secure: { enabled: true, path: dir } } } });
		try {
			service.web.configure({ port: 0, routers: [["/api", apiRouter()]] });
			await service.web.start();
			const https = require("node:https");
			const status = await new Promise((resolve, reject) =>
				https.get({ host: "127.0.0.1", port: portOf(), path: "/api/ok", rejectUnauthorized: false }, res => resolve(res.statusCode)).on("error", reject),
			);
			assert.equal(status, 200);
			await service.web.stop();
		} finally {
			config.manager.setConfig({ services: { web: { secure: { enabled: false, path: "ssl" } } } });
		}
	});
});
