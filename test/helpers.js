"use strict";
/**
 * Test yardımcıları. `node --test` her test dosyasını AYRI bir süreçte çalıştırır;
 * bu yüzden paketin singleton durumu dosyalar arasında paylaşılmaz.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const DIST = path.join(__dirname, "..", "dist");

/** dist altındaki bir modülü yükler: dist("config/manager") */
const dist = rel => require(path.join(DIST, rel));

/** Geçici dizin oluşturur. */
const tmpDir = (prefix = "cagd-test-") => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** Paketin loglarını sessize alır, yakalanan satırları döner. */
function captureLogs() {
	const lines = [];
	const { setLogger } = dist("util/logger");
	const push =
		level =>
		(...args) =>
			lines.push({ level, text: args.map(a => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ") });
	setLogger({ info: push("info"), warn: push("warn"), error: push("error"), debug: push("debug") });
	return lines;
}

/** Basit HTTP isteği (keep-alive ajanı opsiyonel). */
function request(port, { method = "GET", path: p = "/", headers = {}, body, agent } = {}) {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: "127.0.0.1", port, method, path: p, headers, agent }, res => {
			let data = "";
			res.setEncoding("utf8");
			res.on("data", c => (data += c));
			res.on("end", () => {
				let json = null;
				try {
					json = JSON.parse(data);
				} catch {
					/* json değil */
				}
				resolve({ status: res.statusCode, headers: res.headers, body: data, json });
			});
		});
		req.on("error", reject);
		if (body !== undefined) req.write(body);
		req.end();
	});
}

module.exports = { DIST, dist, tmpDir, captureLogs, request };
