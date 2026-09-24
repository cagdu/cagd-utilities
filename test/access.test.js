"use strict";
/**
 * setDefaultConfig() ÇAĞRILMADAN önce servislerin config/env okuması.
 * (Ayrı dosya: global configManager bu süreçte hiç başlatılmıyor.)
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { dist, captureLogs } = require("./helpers");

captureLogs();
const { baseConfig } = dist("config/base-config");
const { baseCfg } = dist("config/access");
const { services } = dist("index");

test("setDefaultConfig olmadan: baseConfig varsayılanları kullanılır", () => {
	const cfg = baseCfg();
	assert.equal(cfg.services.axios.timeout, baseConfig.services.axios.timeout);
	assert.equal(cfg.services.web.rateLimit.limit, baseConfig.services.web.rateLimit.limit);
	assert.equal(services.PrismaService.getProvider(), "postgres");
});

test("setDefaultConfig olmadan: ortam değişkenleri okunur", () => {
	process.env.DATABASE_TYPE = "mssql";
	process.env.DATABASE_URL = "postgres://u:p@db:5432/app";
	process.env.MSSQL_PASSWORD = "gizli";
	try {
		assert.equal(services.PrismaService.getProvider(), "mssql");
		assert.equal(services.PostgresService.getPoolConfig().connectionString, "postgres://u:p@db:5432/app");
		assert.equal(services.MssqlService.getPoolConfig().password, "gizli");
	} finally {
		delete process.env.DATABASE_TYPE;
		delete process.env.DATABASE_URL;
		delete process.env.MSSQL_PASSWORD;
	}
	assert.equal(services.PrismaService.getProvider(), "postgres");
});
