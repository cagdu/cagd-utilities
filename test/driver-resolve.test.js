"use strict";
/**
 * Sürücüler (pg, mssql) ve adapter'lar ÖNCE tüketici uygulamanın dizininden (`process.cwd()`) yüklenir.
 * `npm link` / `file:` ile bağlı pakette, paketin kendi klasöründe sürücü olmasa da çalışmalıdır.
 */
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { dist, tmpDir, captureLogs } = require("./helpers");

captureLogs();
const { config, baseConfig, service, services } = dist("index");
config.manager.setDefaultConfig(baseConfig, { useFile: false, env: false });

/** cwd'ye sahte bir modül yazar. */
function fakeModule(root, name, source) {
	const dir = path.join(root, "node_modules", ...name.split("/"));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0", main: "index.js" }));
	fs.writeFileSync(path.join(dir, "index.js"), source);
}

describe("sürücü çözümleme (requireFromApp)", () => {
	const cwd = process.cwd();
	let app;

	before(() => {
		app = tmpDir("cagd-app-");
		fakeModule(
			app,
			"pg",
			'exports.Pool = class Pool { constructor(c) { this.config = c; this.fromApp = true; } on() {} async query() { return { rows: [{ from: "app-pg" }] }; } async end() {} };',
		);
		fakeModule(app, "mssql", "exports.ConnectionPool = class ConnectionPool { constructor(c) { this.fromApp = true; } };");
		fakeModule(app, "@prisma/adapter-pg", 'throw new Error("adapter-pg yüklenirken patladı");');
		process.chdir(app);
	});

	after(async () => {
		await service.prisma.stop();
		await services.PostgresService.getInstance().close();
		process.chdir(cwd);
		fs.rmSync(app, { recursive: true, force: true });
	});

	test("pg uygulamanın node_modules'undan yüklenir", async () => {
		const rows = await services.PostgresService.getInstance().query("SELECT 1");
		assert.deepEqual(rows, [{ from: "app-pg" }]);
	});

	test("mssql uygulamanın node_modules'undan yüklenir", () => {
		services.MssqlService.getInstance();
		assert.ok(require.cache[fs.realpathSync(path.join(app, "node_modules", "mssql", "index.js"))]);
	});

	test("Prisma: adapter yüklenemezse hata mesajı asıl hatayı içerir", () => {
		class FakePrismaClient {}
		service.prisma.use(FakePrismaClient, { provider: "postgres" });
		assert.throws(
			() => service.prisma.instance.client,
			err => /bulunamadı\/yüklenemedi/.test(err.message) && /adapter-pg yüklenirken patladı/.test(err.message) && err.cause instanceof Error,
		);
	});
});
