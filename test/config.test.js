"use strict";
const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("jsonc-parser");

const { dist, tmpDir, captureLogs } = require("./helpers");

const logs = captureLogs();
const { deepMerge, deepEqual, findMissingPaths, getPath, setPath } = dist("config/deep-merge");
const { buildConfigJsonc } = dist("config/jsonc-writer");
const { readEnv } = dist("config/env");
const { ConfigManager } = dist("config/manager");

describe("deep-merge", () => {
	test("deepMerge iskeleti korur, dizileri değiştirir, fazlalıkları tutar, girdiyi bozmaz", () => {
		const defaults = { a: 1, b: { c: 2, d: [1, 2] }, e: "x" };
		const source = { b: { d: [9] }, extra: true };
		const out = deepMerge(defaults, source);
		assert.deepEqual(out, { a: 1, b: { c: 2, d: [9] }, e: "x", extra: true });
		assert.deepEqual(defaults, { a: 1, b: { c: 2, d: [1, 2] }, e: "x" });
	});

	test("deepEqual anahtar sırasına duyarsızdır", () => {
		assert.equal(deepEqual({ a: 1, b: { c: [1, { d: 2 }] } }, { b: { c: [1, { d: 2 }] }, a: 1 }), true);
		assert.equal(deepEqual({ a: 1 }, { a: 1, b: undefined }), false);
		assert.equal(deepEqual([1, 2], [2, 1]), false);
	});

	test("findMissingPaths sadece gerçekten eksik en üst yolları döner", () => {
		const defaults = { a: 1, b: { c: 2, d: { e: 3 } }, f: { g: 1 } };
		assert.deepEqual(findMissingPaths(defaults, { b: { c: 5 }, a: 1, f: "custom" }), [["b", "d"]]);
		assert.deepEqual(findMissingPaths(defaults, { f: {}, b: { d: { e: 1 }, c: 1 }, a: 2 }), [["f", "g"]]);
		assert.deepEqual(findMissingPaths(defaults, {}), [["a"], ["b"], ["f"]]);
	});

	test("getPath / setPath", () => {
		const obj = {};
		setPath(obj, ["a", "b", "c"], 1);
		assert.deepEqual(obj, { a: { b: { c: 1 } } });
		assert.equal(getPath(obj, ["a", "b", "c"]), 1);
		assert.equal(getPath(obj, ["a", "x", "c"]), undefined);
	});
});

describe("jsonc-writer", () => {
	test("şema yorumlarıyla geçerli JSONC üretir", () => {
		const text = buildConfigJsonc({ a: 1, b: { c: "x" }, d: [1] }, { a: "A alanı", b: { __self: "B grubu", c: "C alanı" } });
		assert.match(text, /\/\*\* A alanı \*\//);
		assert.match(text, /\/\*\* B grubu \*\//);
		assert.match(text, /\/\*\* C alanı \*\//);
		assert.deepEqual(parse(text), { a: 1, b: { c: "x" }, d: [1] });
	});
});

describe("env", () => {
	test("değerleri varsayılanın tipine göre dönüştürür", () => {
		const defaults = { n: 1, b: false, arr: ["x"], obj: { k: 1 }, s: "a", nested: { port: 1 } };
		const env = { N: "42", B: "true", ARR: "a, b ,c", OBJ: '{"k":2}', S: "hello", P: "8080", EMPTY: "" };
		const out = readEnv(defaults, { n: "N", b: "B", arr: "ARR", obj: "OBJ", s: "S", "nested.port": "P", missing: "NOPE", s2: "EMPTY" }, env);
		assert.deepEqual(out, { n: 42, b: true, arr: ["a", "b", "c"], obj: { k: 2 }, s: "hello", nested: { port: 8080 } });
	});

	test("JSON dizi ve geçersiz değerler", () => {
		const out = readEnv({ n: 1, b: true, arr: [] }, { n: "N", b: "B", arr: "A" }, { N: "abc", B: "maybe", A: '["x","y"]' });
		assert.deepEqual(out, { arr: ["x", "y"] });
		assert.ok(logs.some(l => l.level === "warn" && l.text.includes("N ortam değişkeni")));
	});
});

describe("ConfigManager", () => {
	const defaults = { dev: true, db: { host: "localhost", port: 5432, password: "" }, list: [1, 2] };
	const schema = { dev: "Geliştirme modu", db: { __self: "Veritabanı", host: "Sunucu" } };
	let dir;
	let file;

	beforeEach(() => {
		dir = tmpDir();
		file = path.join(dir, "config.jsonc");
	});

	test("dosya yoksa şema yorumlarıyla oluşturur", () => {
		const m = new ConfigManager();
		const cfg = m.setDefaultConfig(defaults, { cwd: dir, schema, env: false });
		assert.equal(cfg.db.port, 5432);
		const text = fs.readFileSync(file, "utf8");
		assert.match(text, /\/\*\* Veritabanı \*\//);
		assert.deepEqual(parse(text), defaults);
	});

	test("alan SIRASI farklıysa dosyaya dokunmaz", () => {
		const content = '// kullanıcı yorumu\n{ "list": [1, 2], "db": { "port": 5432, "password": "", "host": "db" }, "dev": false }\n';
		fs.writeFileSync(file, content);
		const before = logs.length;
		const m = new ConfigManager();
		const cfg = m.setDefaultConfig(defaults, { cwd: dir, env: false });
		assert.equal(fs.readFileSync(file, "utf8"), content);
		assert.equal(cfg.db.host, "db");
		assert.equal(cfg.dev, false);
		assert.ok(!logs.slice(before).some(l => l.text.includes("eksik alanlar")));
	});

	test("eksik alanları ekler, kullanıcı yorumlarını ve değerlerini korur", () => {
		fs.writeFileSync(file, '// benim notum\n{\n\t// host notu\n\t"db": { "host": "prod-db" }\n}\n');
		const m = new ConfigManager();
		m.setDefaultConfig(defaults, { cwd: dir, env: false });
		const text = fs.readFileSync(file, "utf8");
		assert.match(text, /\/\/ benim notum/);
		assert.match(text, /\/\/ host notu/);
		assert.deepEqual(parse(text), { db: { host: "prod-db", port: 5432, password: "" }, dev: true, list: [1, 2] });
	});

	test("bozuk dosyada varsayılanları kullanır ve dosyanın üzerine yazmaz", () => {
		const broken = '{ "db": { "host": "x", }, oops }';
		fs.writeFileSync(file, broken);
		const m = new ConfigManager();
		const cfg = m.setDefaultConfig(defaults, { cwd: dir, env: false });
		assert.equal(cfg.db.host, "localhost");
		m.setConfig({ dev: false }, true);
		assert.equal(fs.readFileSync(file, "utf8"), broken);
		assert.equal(cfg.dev, false);
	});

	test("öncelik: setConfig > env > dosya > varsayılan; env değerleri dosyaya yazılmaz", () => {
		fs.writeFileSync(file, '{ "db": { "host": "file-host", "port": 1111 } }');
		process.env.CAGD_TEST_DB_HOST = "env-host";
		process.env.CAGD_TEST_DB_PASSWORD = "gizli";
		try {
			const m = new ConfigManager();
			const cfg = m.setDefaultConfig(defaults, { cwd: dir, env: { "db.host": "CAGD_TEST_DB_HOST", "db.password": "CAGD_TEST_DB_PASSWORD" } });
			assert.equal(cfg.db.host, "env-host");
			assert.equal(cfg.db.port, 1111);
			assert.equal(cfg.db.password, "gizli");

			m.setConfig({ db: { host: "runtime-host" } });
			assert.equal(cfg.db.host, "runtime-host");

			m.setConfig({ db: { port: 2222 } }, true);
			m.writeFile();
			const onDisk = parse(fs.readFileSync(file, "utf8"));
			assert.equal(onDisk.db.port, 2222);
			assert.equal(onDisk.db.password, "", "env'den gelen şifre dosyaya yazılmamalı");
			assert.notEqual(onDisk.db.host, "env-host");

			m.resetConfig();
			assert.equal(cfg.db.host, "env-host");
		} finally {
			delete process.env.CAGD_TEST_DB_HOST;
			delete process.env.CAGD_TEST_DB_PASSWORD;
		}
	});

	test("setConfig(persist) yorumları koruyarak sadece değişen alanı yazar", () => {
		fs.writeFileSync(file, '// üst not\n{\n\t"dev": true, // dev notu\n\t"db": { "host": "localhost", "port": 5432, "password": "" },\n\t"list": [1, 2]\n}\n');
		const m = new ConfigManager();
		m.setDefaultConfig(defaults, { cwd: dir, env: false });
		m.setConfig({ db: { port: 6000 } }, true);
		const text = fs.readFileSync(file, "utf8");
		assert.match(text, /\/\/ üst not/);
		assert.match(text, /\/\/ dev notu/);
		assert.equal(parse(text).db.port, 6000);
	});

	test("reload: dosyadan silinen alan varsayılana döner", () => {
		fs.writeFileSync(file, '{ "db": { "host": "a", "port": 1 }, "dev": false, "list": [] }');
		const m = new ConfigManager();
		const cfg = m.setDefaultConfig(defaults, { cwd: dir, env: false, writeBack: false });
		assert.equal(cfg.db.port, 1);
		fs.writeFileSync(file, '{ "db": { "host": "a" }, "dev": false, "list": [] }');
		m.reloadFile();
		assert.equal(cfg.db.port, 5432);
	});

	test("setDefaultConfig öncesi yapılan setConfig korunur", () => {
		const m = new ConfigManager();
		m.setConfig({ dev: false });
		const cfg = m.setDefaultConfig(defaults, { useFile: false, env: false });
		assert.equal(cfg.dev, false);
		assert.equal(cfg.db.port, 5432);
	});

	test("proxy'ye yazma onChange tetikler; JSON.stringify gerçek veriyi verir", () => {
		const m = new ConfigManager();
		const cfg = m.setDefaultConfig(defaults, { useFile: false, env: false });
		let calls = 0;
		const off = m.onChange(() => calls++);
		cfg.dev = false;
		off();
		cfg.dev = true;
		assert.equal(calls, 1);
		assert.deepEqual(JSON.parse(JSON.stringify(cfg)), defaults);
	});

	test("watch: dosya atomik olarak (rename ile) değiştirilse de izlemeye devam eder", async () => {
		fs.writeFileSync(file, JSON.stringify(defaults));
		const m = new ConfigManager();
		const cfg = m.setDefaultConfig(defaults, { cwd: dir, env: false });
		const stop = m.watchFile();
		try {
			const swap = async port => {
				const tmp = path.join(dir, "config.jsonc.tmp");
				fs.writeFileSync(tmp, JSON.stringify({ ...defaults, db: { ...defaults.db, port } }));
				fs.renameSync(tmp, file);
				for (let i = 0; i < 40 && cfg.db.port !== port; i++) await new Promise(r => setTimeout(r, 50));
			};
			await swap(7001);
			assert.equal(cfg.db.port, 7001);
			await swap(7002);
			assert.equal(cfg.db.port, 7002);
		} finally {
			stop();
		}
	});
});
