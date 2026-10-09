"use strict";
/**
 * Paketin TÜKETİCİ gözünden testleri:
 *  - Opsiyonel paketler kurulu değilken import edilebilmesi (CJS + ESM)
 *  - ESM'den alt yol named import
 *  - `skipLibCheck: false` olan bir tüketicide tiplerin derlenmesi + örnek projenin tip kontrolü
 */
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { tmpDir } = require("./helpers");

const ROOT = path.join(__dirname, "..");

function run(cwd, file) {
	return execFileSync(process.execPath, [file], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Sadece dist + zorunlu bağımlılık (jsonc-parser) içeren izole bir tüketici projesi. */
function isolatedProject() {
	const dir = tmpDir("cagd-consumer-");
	const pkgDir = path.join(dir, "node_modules", "cagdu-utilities");
	fs.mkdirSync(pkgDir, { recursive: true });
	fs.cpSync(path.join(ROOT, "dist"), path.join(pkgDir, "dist"), { recursive: true });
	fs.copyFileSync(path.join(ROOT, "package.json"), path.join(pkgDir, "package.json"));
	fs.cpSync(path.join(ROOT, "node_modules", "jsonc-parser"), path.join(dir, "node_modules", "jsonc-parser"), { recursive: true });
	fs.writeFileSync(path.join(dir, "package.json"), '{ "name": "consumer", "version": "1.0.0" }');
	return dir;
}

describe("opsiyonel paketler kurulu değilken", () => {
	const dir = isolatedProject();

	test("CommonJS: import ve temel kullanım hata vermez; eksik paket net hata verir", () => {
		fs.writeFileSync(
			path.join(dir, "cjs.js"),
			`
const u = require("cagdu-utilities");
u.util.setLogger({ info() {}, warn() {}, error() {}, debug() {} });
u.config.manager.setDefaultConfig(u.baseConfig, { useFile: false });
if (typeof u.service.bootstrap !== "function") throw new Error("bootstrap yok");
if (u.util.http.errorResponse({ code: "X" }).code !== "X") throw new Error("util.http");
if (!(new u.util.http.ApiError("x", 404) instanceof Error)) throw new Error("ApiError");
if (u.classes !== u.services) throw new Error("classes alias");
let msg = "";
try { u.services.RedisService; } catch (e) { msg = e.message; }
if (!/redis/.test(msg)) throw new Error("beklenen 'redis bulunamadı' hatası gelmedi: " + msg);
console.log("OK");
`,
		);
		assert.equal(run(dir, "cjs.js"), "OK");
	});

	test("ESM: root named import çalışır, servis paketleri yüklenmez", () => {
		fs.writeFileSync(
			path.join(dir, "esm.mjs"),
			`
import { config, service, util, baseConfig, classes } from "cagdu-utilities";
import { BaseService } from "cagdu-utilities/services";
util.setLogger({ info() {}, warn() {}, error() {}, debug() {} });
config.manager.setDefaultConfig(baseConfig, { useFile: false });
if (typeof service.start !== "function" || typeof BaseService !== "function" || typeof classes !== "object") throw new Error("export eksik");
console.log("OK");
`,
		);
		assert.equal(run(dir, "esm.mjs"), "OK");
	});
});

test("ESM: 'cagdu-utilities/services' alt yolundan named import (kurulu paketlerle)", () => {
	// Paket kendi adıyla (self-reference) import edilebilir; bu repoda tüm opsiyonel paketler kurulu.
	const dir = tmpDir();
	const file = path.join(ROOT, "test", `.esm-named-${process.pid}.mjs`);
	fs.writeFileSync(
		file,
		`
import { RedisService, PostgresService, WebService, createExpressApp, AxiosServiceError } from "cagdu-utilities/services";
for (const [k, v] of Object.entries({ RedisService, PostgresService, WebService, createExpressApp, AxiosServiceError })) {
	if (typeof v !== "function") throw new Error(k + " yok");
}
console.log("OK");
`,
	);
	try {
		assert.equal(run(dir, file), "OK");
	} finally {
		fs.rmSync(file, { force: true });
	}
});

test("tipler: skipLibCheck=false tüketici projede ve örnek projede derlenir", () => {
	const dir = tmpDir("cagd-types-");
	fs.mkdirSync(path.join(dir, "src"));
	// Tüketicinin node_modules'ı yerine bu reponun kurulu paketleri (express, @types/* ...) kullanılır.
	fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "junction");
	fs.mkdirSync(path.join(dir, "prisma", "generated", "prisma"), { recursive: true });

	// Örnek proje (examples/) birebir kopyalanır; generated Prisma client'ı taklit eden bir tip dosyası eklenir.
	fs.copyFileSync(path.join(ROOT, "examples", "index.ts"), path.join(dir, "src", "index.ts"));
	fs.copyFileSync(path.join(ROOT, "examples", "cagdu-utilities.d.ts"), path.join(dir, "src", "cagdu-utilities.d.ts"));
	fs.writeFileSync(
		path.join(dir, "prisma", "generated", "prisma", "client.ts"),
		`
export interface User { id: number; name: string }
export class PrismaClient {
	constructor(_options?: unknown) {}
	user = { findUnique: async (_args: { where: { id: number } }): Promise<User | null> => null };
	async $connect(): Promise<void> {}
	async $disconnect(): Promise<void> {}
}
`,
	);
	fs.writeFileSync(
		path.join(dir, "src", "extra.ts"),
		`
import { config, service, services, util, type ServiceName, type AxiosServiceError } from "cagdu-utilities";
import { RedisService } from "cagdu-utilities/services";
import { cfg } from "./index";

const port: number = config.data.services.web.port;
const appName: string = cfg.app.name;
const provider: "postgres" | "mssql" = config.data.database.provider;
const names: ServiceName[] = ["prisma", "web"];
const redis: RedisService = services.RedisService.getInstance();
const handle = (e: unknown) => (e instanceof services.AxiosServiceError ? (e as AxiosServiceError).status : null);
const err = new util.http.ApiError("x", 404);
// @ts-expect-error bilinmeyen servis adı derleme hatası vermeli
void service.start("reddis");
void service.prisma.client.user.findUnique({ where: { id: 1 } });
export { port, appName, provider, names, redis, handle, err };
`,
	);
	fs.writeFileSync(
		path.join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "CommonJS",
				moduleResolution: "node",
				strict: true,
				esModuleInterop: true,
				skipLibCheck: false,
				noEmit: true,
				types: ["node"],
				typeRoots: [path.join(ROOT, "node_modules", "@types")],
				baseUrl: ".",
				paths: {
					"cagdu-utilities": [path.join(ROOT, "dist", "index.d.ts")],
					"cagdu-utilities/*": [path.join(ROOT, "dist", "*", "index.d.ts")],
				},
			},
			include: ["src/**/*.ts", "prisma/**/*.ts"],
		}),
	);

	try {
		execFileSync(process.execPath, [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", dir], { encoding: "utf8", stdio: "pipe" });
	} catch (e) {
		assert.fail(`tsc hataları:\n${e.stdout}${e.stderr}`);
	}
});
