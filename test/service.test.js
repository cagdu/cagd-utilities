"use strict";
const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { dist, captureLogs } = require("./helpers");

captureLogs();
const { config, baseConfig, service } = dist("index");
config.manager.setDefaultConfig(baseConfig, { useFile: false, env: false });

/** Gerçek bağlantı açmadan definer'ların start/stop'unu kaydeder. */
const events = [];
const failures = {};
for (const name of ["prisma", "web", "redis", "postgres", "mssql", "mail"]) {
	const d = service[name];
	d.doStart = async () => {
		if (failures[`start:${name}`]) throw new Error(`${name} başlatılamadı`);
		events.push(`start:${name}`);
	};
	d.doStop = async () => {
		events.push(`stop:${name}`);
		if (failures[`stop:${name}`]) throw new Error(`${name} kapatılamadı`);
	};
	d.healthCheck = async () => {
		if (failures[`health:${name}`]) throw new Error("x");
		return true;
	};
}

describe("service yaşam döngüsü", () => {
	beforeEach(() => {
		events.length = 0;
		for (const key of Object.keys(failures)) delete failures[key];
	});

	afterEach(async () => {
		for (const key of Object.keys(failures)) delete failures[key];
		await service.stopAll();
	});

	test("start() VERİLEN SIRAYLA başlatır", async () => {
		await service.start("redis", "web", "prisma");
		assert.deepEqual(events, ["start:redis", "start:web", "start:prisma"]);
	});

	test("stopAll() başlatılma sırasının TERSİYLE kapatır", async () => {
		await service.start("prisma", "redis", "web");
		events.length = 0;
		await service.stopAll();
		assert.deepEqual(events, ["stop:web", "stop:redis", "stop:prisma"]);
		assert.equal(service.web.started, false);
	});

	test("bilinmeyen servis adı hiçbir şey başlatmadan hata verir", async () => {
		await assert.rejects(service.start("redis", "reddis"), /bilinmeyen servis adı: reddis/);
		assert.deepEqual(events, []);
	});

	test("start() idempotent", async () => {
		await service.start("redis");
		await service.start("redis");
		assert.deepEqual(events, ["start:redis"]);
	});

	test("başarısız servis sonrasını başlatmaz, hatayı fırlatır", async () => {
		failures["start:redis"] = true;
		await assert.rejects(service.start("prisma", "redis", "web"), /redis başlatılamadı/);
		assert.deepEqual(events, ["start:prisma"]);
		assert.equal(service.redis.started, false);
	});

	test("stopAll() bir servis hata verse de diğerlerini kapatır ve AggregateError fırlatır", async () => {
		await service.start("prisma", "redis", "web");
		events.length = 0;
		failures["stop:redis"] = true;
		await assert.rejects(service.stopAll(), err => err instanceof AggregateError && err.errors.length === 1);
		assert.deepEqual(events, ["stop:web", "stop:redis", "stop:prisma"]);
		assert.equal(service.redis.started, false);
	});

	test("healthCheckAll() sadece başlatılanları döner, hata false sayılır", async () => {
		await service.start("prisma", "redis");
		failures["health:redis"] = true;
		assert.deepEqual(await service.healthCheckAll(), { prisma: true, redis: false });
	});

	test("bootstrap(): başarısız açılışta başlatılanları kapatır ve exit(1) çağırır", async () => {
		failures["start:web"] = true;
		const codes = [];
		await service.bootstrap(["prisma", "redis", "web"], { signals: false, exit: code => codes.push(code) });
		assert.deepEqual(codes, [1]);
		assert.deepEqual(events, ["start:prisma", "start:redis", "stop:redis", "stop:prisma"]);
	});

	test("bootstrap(exitOnError: false): hatayı fırlatır", async () => {
		failures["start:redis"] = true;
		await assert.rejects(service.bootstrap(["redis"], { signals: false, exitOnError: false }), /redis başlatılamadı/);
	});

	test("handleSignals(): SIGTERM'de onShutdown + stopAll çalışır, exit(0); ikinci sinyal yok sayılır", async () => {
		await service.start("prisma", "web");
		events.length = 0;
		const codes = [];
		const unregister = service.handleSignals({ exit: code => codes.push(code), onShutdown: reason => events.push(`onShutdown:${reason}`) });
		try {
			process.emit("SIGTERM", "SIGTERM");
			process.emit("SIGTERM", "SIGTERM");
			for (let i = 0; i < 50 && codes.length === 0; i++) await new Promise(r => setTimeout(r, 10));
			assert.deepEqual(codes, [0]);
			assert.deepEqual(events, ["onShutdown:SIGTERM", "stop:web", "stop:prisma"]);
		} finally {
			unregister();
		}
		assert.equal(process.listenerCount("SIGTERM"), 0);
	});

	test("handleSignals(): unhandledRejection'da exit(1)", async () => {
		const codes = [];
		const before = process.listeners("unhandledRejection");
		const unregister = service.handleSignals({ exit: code => codes.push(code) });
		try {
			// process.emit kullanılmıyor: node:test'in kendi unhandledRejection dinleyicisi testi başarısız sayar.
			const ours = process.listeners("unhandledRejection").filter(l => !before.includes(l));
			assert.equal(ours.length, 1);
			ours[0](new Error("test"), Promise.resolve());
			for (let i = 0; i < 50 && codes.length === 0; i++) await new Promise(r => setTimeout(r, 10));
			assert.deepEqual(codes, [1]);
		} finally {
			unregister();
		}
	});

	test("handleSignals(): kapanış zaman aşımına uğrarsa zorla exit", async () => {
		await service.start("redis");
		const original = service.redis.doStop;
		service.redis.doStop = () => new Promise(() => {}); // hiç bitmez
		const codes = [];
		const unregister = service.handleSignals({ exit: code => codes.push(code), timeoutMs: 50 });
		try {
			process.emit("SIGINT", "SIGINT");
			await new Promise(r => setTimeout(r, 150));
			assert.deepEqual(codes, [1]);
		} finally {
			unregister();
			service.redis.doStop = original;
		}
	});
});
