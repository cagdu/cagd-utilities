"use strict";
/** register() hiç çağrılmadan clientPath ile yükleme (ayrı süreç: temiz PrismaService durumu). */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { dist, tmpDir, captureLogs } = require("./helpers");

captureLogs();
const { config, baseConfig, service } = dist("index");

test("clientPath göreli yolu çalışma dizinine göre çözülür", async () => {
	const dir = tmpDir();
	fs.mkdirSync(path.join(dir, "generated"));
	fs.writeFileSync(path.join(dir, "generated", "client.js"), "class PrismaClient { constructor(o) { this.o = o; this.local = true; } async $disconnect() {} }\nmodule.exports = { PrismaClient };\n");

	const cwd = process.cwd();
	process.chdir(dir);
	try {
		config.manager.setDefaultConfig({ ...baseConfig, database: { ...baseConfig.database, prisma: { clientPath: "./generated/client" } } }, { useFile: false, env: false });
		service.prisma.instance.constructor.configure({ disableAdapter: true });
		assert.equal(service.prisma.client.local, true);
		await service.prisma.stop();
	} finally {
		process.chdir(cwd);
	}
});
