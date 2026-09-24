"use strict";
/**
 * Entegrasyon testleri için: TEST_REDIS_URL=redis://127.0.0.1:6379 npm test
 * Tanımlı değilse sunucu gerektiren testler atlanır.
 */
const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { dist, captureLogs } = require("./helpers");

captureLogs();
const { config, baseConfig, service } = dist("index");
config.manager.setDefaultConfig(baseConfig, { useFile: false, env: false });

const REDIS_URL = process.env.TEST_REDIS_URL;

describe("RedisService", () => {
	afterEach(async () => {
		await service.redis.stop();
	});

	test("sunucu yoksa start() connectRetries sonrası hata verir (asılı kalmaz), süreç temiz kapanır", async () => {
		config.manager.setConfig({ services: { redis: { url: "redis://127.0.0.1:1", connectRetries: 2 } } });
		const t0 = Date.now();
		await assert.rejects(service.redis.start(), /bağlanılamadı/);
		assert.ok(Date.now() - t0 < 5000);
		assert.equal(service.redis.started, false);
		assert.equal(service.redis.instance.connected, false);
	});

	test("hiç bağlanmamışken close() güvenli", async () => {
		config.manager.setConfig({ services: { redis: { url: "redis://127.0.0.1:1" } } });
		assert.ok(service.redis.instance.client); // client oluşur ama bağlanmaz
		await service.redis.stop();
		assert.equal(service.redis.started, false);
	});

	test("gerçek sunucu: bağlanma, yardımcılar, idempotent connect, kapanma", { skip: !REDIS_URL && "TEST_REDIS_URL tanımlı değil" }, async () => {
		config.manager.setConfig({ services: { redis: { url: REDIS_URL, connectRetries: 5 } } });
		const redis = service.redis.instance;
		await Promise.all([redis.connect(), redis.connect(), service.redis.start()]);
		assert.equal(redis.connected, true);
		assert.equal(await service.redis.healthCheck(), true);

		await redis.setJSON("cagd:test", { id: 1 }, 60);
		assert.deepEqual(await redis.getJSON("cagd:test"), { id: 1 });
		assert.equal(await redis.exists("cagd:test"), true);
		assert.equal(await redis.incr("cagd:counter"), 1);
		await redis.del("cagd:counter");
		assert.equal(await redis.del("cagd:test"), 1);

		await service.redis.stop();
		assert.equal(service.redis.started, false);
		await service.redis.start();
		assert.equal(await service.redis.healthCheck(), true);
	});
});
