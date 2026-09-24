"use strict";
const { test, describe, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { dist, captureLogs } = require("./helpers");

captureLogs();
const { config, baseConfig, service } = dist("index");
config.manager.setDefaultConfig(baseConfig, { useFile: false, env: false });

/** Gerçek veritabanı olmadan PrismaClient'ı taklit eder. */
const created = [];
class FakePrismaClient {
	constructor(options) {
		this.options = options;
		this.disconnects = 0;
		this.connects = 0;
		created.push(this);
	}
	async $connect() {
		this.connects++;
	}
	async $disconnect() {
		this.disconnects++;
	}
	async $queryRaw() {
		return [{ "?column?": 1 }];
	}
}

describe("PrismaService / service.prisma", () => {
	afterEach(async () => {
		await service.stopAll();
		await service.prisma.stop();
		created.length = 0;
	});

	test("disableAdapter: client adapter'sız, sadece clientOptions ile oluşturulur", async () => {
		const prisma = service.prisma.use(FakePrismaClient, { disableAdapter: true, clientOptions: { log: ["error"] } });
		await prisma.start();
		assert.equal(created.length, 1);
		assert.deepEqual(created[0].options, { log: ["error"] });
		assert.equal(created[0].connects, 1);
		assert.equal(await prisma.healthCheck(), true);
	});

	test("use() tekrar çağrılınca eski client'ın bağlantısı kapatılır", async () => {
		service.prisma.use(FakePrismaClient, { disableAdapter: true });
		await service.prisma.start();
		const first = created[0];
		service.prisma.use(FakePrismaClient, { disableAdapter: true });
		await new Promise(r => setImmediate(r));
		assert.equal(first.disconnects, 1);
		assert.equal(service.prisma.started, false);
		await service.prisma.start();
		assert.notEqual(service.prisma.client, first);
	});

	test("postgres provider: @prisma/adapter-pg ile config'ten adapter kurulur", () => {
		config.manager.setConfig({ database: { provider: "postgres", postgres: { url: "postgres://u:p@localhost:5432/db" } } });
		service.prisma.use(FakePrismaClient, { disableAdapter: false });
		const client = service.prisma.client;
		assert.ok(client.options.adapter instanceof require("@prisma/adapter-pg").PrismaPg);
		assert.equal(service.prisma.provider, "postgres");
	});

	test("mssql provider: @prisma/adapter-mssql ile adapter kurulur", () => {
		config.manager.setConfig({ database: { provider: "mssql" } });
		try {
			service.prisma.use(FakePrismaClient, { disableAdapter: false });
			const client = service.prisma.client;
			assert.ok(client.options.adapter instanceof require("@prisma/adapter-mssql").PrismaMssql);
			assert.equal(service.prisma.provider, "mssql");
		} finally {
			config.manager.setConfig({ database: { provider: "postgres" } });
		}
	});
});
