"use strict";
/**
 * Entegrasyon testleri için: TEST_DATABASE_URL=postgres://user:pass@127.0.0.1:5432/db npm test
 * Tanımlı değilse sunucu gerektiren testler atlanır.
 */
const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { dist, captureLogs } = require("./helpers");

captureLogs();
const { config, baseConfig, service, services } = dist("index");
config.manager.setDefaultConfig(baseConfig, { useFile: false, env: false });

const DATABASE_URL = process.env.TEST_DATABASE_URL;

describe("PostgresService", () => {
	afterEach(async () => {
		await service.postgres.stop();
	});

	test("pool config: url varsa connectionString, yoksa host alanları; boş alanlar gönderilmez", () => {
		config.manager.setConfig({ database: { postgres: { url: "postgres://a:b@h:1/d", ssl: { rejectUnauthorized: false } } } });
		const withUrl = services.PostgresService.getPoolConfig();
		assert.equal(withUrl.connectionString, "postgres://a:b@h:1/d");
		assert.deepEqual(withUrl.ssl, { rejectUnauthorized: false });
		assert.equal(withUrl.host, undefined);

		config.manager.setConfig({ database: { postgres: { url: "", ssl: false } } });
		const withHost = services.PostgresService.getPoolConfig();
		assert.equal(withHost.host, "localhost");
		assert.equal(withHost.user, undefined);
		assert.equal(withHost.ssl, undefined);
	});

	test("MSSQL pool config: boş kimlik bilgileri gönderilmez", () => {
		const cfg = services.MssqlService.getPoolConfig();
		assert.equal(cfg.user, undefined);
		assert.equal(cfg.password, undefined);
		assert.equal(cfg.server, "localhost");
	});

	test("getInstance() bağlantı açmaz; close() idempotent", async () => {
		services.PostgresService.getInstance();
		await services.PostgresService.getInstance().close();
		await services.PostgresService.getInstance().close();
	});

	test("sunucu yoksa start() hata verir", async () => {
		config.manager.setConfig({ database: { postgres: { url: "postgres://x:y@127.0.0.1:1/z", connectionTimeoutMillis: 1000 } } });
		await assert.rejects(service.postgres.start());
		assert.equal(service.postgres.started, false);
		assert.equal(await service.postgres.healthCheck(), false);
	});

	test("gerçek sunucu: sorgu, transaction, kapanma", { skip: !DATABASE_URL && "TEST_DATABASE_URL tanımlı değil" }, async () => {
		config.manager.setConfig({ database: { postgres: { url: DATABASE_URL, connectionTimeoutMillis: 5000 } } });
		await service.postgres.start();
		const pg = service.postgres.instance;
		assert.deepEqual(await pg.query("SELECT $1::int AS n", [5]), [{ n: 5 }]);

		await pg.query("CREATE TABLE IF NOT EXISTS cagd_t (id int)");
		try {
			await assert.rejects(
				pg.transaction(async client => {
					await client.query("INSERT INTO cagd_t VALUES (1)");
					throw new Error("geri al");
				}),
				/geri al/,
			);
			assert.deepEqual(await pg.query("SELECT count(*)::int AS c FROM cagd_t"), [{ c: 0 }], "ROLLBACK yapılmalı");
			await pg.transaction(client => client.query("INSERT INTO cagd_t VALUES (2)"));
			assert.deepEqual(await pg.query("SELECT count(*)::int AS c FROM cagd_t"), [{ c: 1 }], "COMMIT yapılmalı");
		} finally {
			await pg.query("DROP TABLE cagd_t");
		}
		const meta = await pg.queryWithMeta("SELECT 1 AS x");
		assert.equal(meta.rowCount, 1);
		assert.equal(await service.postgres.healthCheck(), true);
		assert.deepEqual(await service.healthCheckAll(), { postgres: true });
	});
});
