"use strict";
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { dist, captureLogs } = require("./helpers");

captureLogs();
const { config, baseConfig, services } = dist("index");
config.manager.setDefaultConfig(baseConfig, { useFile: false, env: false });

describe("AxiosService", () => {
	let server;
	let base;
	const seen = [];

	before(async () => {
		server = http.createServer((req, res) => {
			seen.push(req.headers);
			if (req.url === "/fail") {
				res.writeHead(500, { "content-type": "application/json" });
				res.end('{"reason":"x"}');
			} else res.end("ok");
		});
		await new Promise(r => server.listen(0, "127.0.0.1", r));
		base = `http://127.0.0.1:${server.address().port}`;
	});

	after(() => new Promise(r => server.close(r)));

	test("timeout varsayılan olarak config'ten gelir, istemci bazında ezilebilir", () => {
		assert.equal(new services.AxiosService({ name: "a" }).raw.defaults.timeout, baseConfig.services.axios.timeout);
		assert.equal(new services.AxiosService({ name: "b", instance: { timeout: 12345 } }).raw.defaults.timeout, 12345);
	});

	test("HTTP hatası AxiosServiceError (gerçek Error) olarak fırlatılır", async () => {
		const client = new services.AxiosService({ name: "Test", instance: { baseURL: base } });
		const err = await client.request({ url: "/fail" }).catch(e => e);
		assert.ok(err instanceof Error);
		assert.ok(err instanceof services.AxiosServiceError);
		assert.ok(client.isAxiosRequestError(err));
		assert.equal(err.status, 500);
		assert.equal(err.code, "ERR_BAD_RESPONSE");
		assert.equal(err.inResponse, true);
		assert.equal(err.error, true);
		assert.equal(err.service, "Test");
		assert.deepEqual(err.details.response.data, { reason: "x" });
		assert.ok(err.stack);
	});

	test("ağ hatasında inResponse false", async () => {
		const client = new services.AxiosService({ name: "Down", instance: { baseURL: "http://127.0.0.1:1", timeout: 2000 } });
		const err = await client.request({ url: "/" }).catch(e => e);
		assert.ok(err instanceof services.AxiosServiceError);
		assert.equal(err.inResponse, false);
		assert.equal(err.status, null);
	});

	test("normalizeRequestError her şeyi AxiosServiceError'a çevirir", () => {
		const client = new services.AxiosService({ name: "N" });
		const e1 = client.normalizeRequestError(new TypeError("x"));
		assert.equal(e1.code, "UNKNOWN");
		assert.equal(e1.message, "x");
		const e2 = client.normalizeRequestError("string");
		assert.ok(e2 instanceof services.AxiosServiceError);
	});

	test("userAgent: false -> User-Agent gönderilmez, metin -> o değer gönderilir", async () => {
		const client = new services.AxiosService({ name: "UA", instance: { baseURL: base } });
		seen.length = 0;
		await client.request({ url: "/" });
		assert.equal(seen[0]["user-agent"], undefined);

		config.manager.setConfig({ services: { axios: { userAgent: "cagd-test/1.0" } } });
		try {
			seen.length = 0;
			await client.request({ url: "/" });
			assert.equal(seen[0]["user-agent"], "cagd-test/1.0");
			seen.length = 0;
			await client.request({ url: "/", headers: { "User-Agent": "ozel" } });
			assert.equal(seen[0]["user-agent"], "ozel");
		} finally {
			config.manager.setConfig({ services: { axios: { userAgent: false } } });
		}
	});
});
