"use strict";
/**
 * service.jobs: zamanlama, çakışma önleme, zaman aşımı, kapanış, hata yalıtımı, kilit.
 * Gerçek Redis'li kilit testi için: TEST_REDIS_URL=redis://127.0.0.1:6379 npm test
 */
const { test, describe, mock, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { dist, captureLogs } = require("./helpers");

const logs = captureLogs();
const { config, baseConfig, service, util } = dist("index");
config.manager.setDefaultConfig(baseConfig, { useFile: false, env: false });
const { JobRunner, computeNextRun, scheduleIntervalMs } = dist("service/jobs");

const REDIS_URL = process.env.TEST_REDIS_URL;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const flush = () => new Promise(resolve => setImmediate(resolve));
const uniq = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const runners = [];
function runner() {
	const r = new JobRunner();
	runners.push(r);
	return r;
}

afterEach(async () => {
	for (const r of runners.splice(0)) await r.stop(200);
	mock.timers.reset();
});

describe("computeNextRun / scheduleIntervalMs", () => {
	test("aralıklar", () => {
		const from = new Date("2026-10-03T10:00:00.000Z");
		assert.equal(computeNextRun({ seconds: 10 }, from).toISOString(), "2026-10-03T10:00:10.000Z");
		assert.equal(computeNextRun({ minutes: 15 }, from).toISOString(), "2026-10-03T10:15:00.000Z");
		assert.equal(computeNextRun({ hours: 2 }, from).toISOString(), "2026-10-03T12:00:00.000Z");
		assert.equal(scheduleIntervalMs({ seconds: 0.5 }), 500);
	});

	test("dailyAtUtc: aynı gün ileride / geçmişte / tam saatinde", () => {
		const every = { dailyAtUtc: "03:00" };
		assert.equal(computeNextRun(every, new Date("2026-10-03T02:59:59.000Z")).toISOString(), "2026-10-03T03:00:00.000Z");
		assert.equal(computeNextRun(every, new Date("2026-10-03T03:00:00.000Z")).toISOString(), "2026-10-04T03:00:00.000Z");
		assert.equal(computeNextRun(every, new Date("2026-10-03T23:00:00.000Z")).toISOString(), "2026-10-04T03:00:00.000Z");
		// Ay/yıl sınırı
		assert.equal(computeNextRun({ dailyAtUtc: "00:30" }, new Date("2026-12-31T22:00:00.000Z")).toISOString(), "2027-01-01T00:30:00.000Z");
	});

	test("geçersiz değerler", () => {
		assert.throws(() => scheduleIntervalMs({ seconds: 0 }), /geçersiz aralık/);
		assert.throws(() => scheduleIntervalMs({ minutes: -1 }), /geçersiz aralık/);
		assert.throws(() => scheduleIntervalMs({ dailyAtUtc: "24:00" }), /dailyAtUtc/);
		assert.throws(() => scheduleIntervalMs({ dailyAtUtc: "3:00" }), /dailyAtUtc/);
		assert.throws(() => runner().define({ name: "x", every: { seconds: 1 } }), /run/);
		const r = runner();
		r.define({ name: "dup", every: { seconds: 1 }, run: () => {} });
		assert.throws(() => r.define({ name: "dup", every: { seconds: 1 }, run: () => {} }), /zaten tanımlı/);
	});
});

describe("JobRunner (süreç içi kilit)", () => {
	before(() => util.redis.setRedisClient(null));
	after(() => util.redis.setRedisClient(undefined));

	test("every: periyodik çalışır, status alanları dolar", async () => {
		const r = runner();
		let runs = 0;
		r.define({ name: uniq("tick"), every: { seconds: 0.04 }, run: () => void runs++ });
		await r.start();
		await sleep(230);
		assert.ok(runs >= 3, `runs=${runs}`);
		const [s] = r.status();
		assert.equal(s.runs, runs);
		assert.equal(s.failures, 0);
		assert.equal(s.lastError, null);
		assert.ok(s.lastStartedAt && s.lastFinishedAt && s.nextRunAt);
		assert.equal(typeof s.lastDurationMs, "number");
		assert.equal(s.running, false);
	});

	test("dailyAtUtc: sahte zamanlayıcıyla saatinde çalışır", async () => {
		mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-10-03T02:59:00.000Z") });
		const r = runner();
		let runs = 0;
		r.define({ name: uniq("daily"), every: { dailyAtUtc: "03:00" }, lock: false, run: () => void runs++ });
		await r.start();
		assert.equal(r.status()[0].nextRunAt, "2026-10-03T03:00:00.000Z");
		mock.timers.tick(59_000);
		await flush();
		assert.equal(runs, 0);
		mock.timers.tick(1_000);
		for (let i = 0; i < 5; i++) await flush();
		assert.equal(runs, 1);
		assert.equal(r.status()[0].nextRunAt, "2026-10-04T03:00:00.000Z");
	});

	test("runOnStart: açılıştan sonra bir kez (gecikmeli)", async () => {
		const r = runner();
		let runs = 0;
		r.define({ name: uniq("start"), every: { hours: 1 }, runOnStart: { delayMs: 30 }, run: () => void runs++ });
		await r.start();
		assert.equal(runs, 0);
		await sleep(80);
		assert.equal(runs, 1);
	});

	test("çakışma yok: tur bitmeden aynı iş yeniden başlamaz", async () => {
		const r = runner();
		let concurrent = 0;
		let maxConcurrent = 0;
		let runs = 0;
		const name = uniq("slow");
		r.define({
			name,
			every: { seconds: 0.01 },
			run: async () => {
				concurrent++;
				maxConcurrent = Math.max(maxConcurrent, concurrent);
				runs++;
				await sleep(40);
				concurrent--;
			},
		});
		await r.start();
		const manual = r.runNow(name); // zamanlanmış turla yarışır
		await sleep(200);
		await manual;
		assert.equal(maxConcurrent, 1);
		assert.ok(runs >= 2);
	});

	test("runNow: çalışıyorsa çalıştırmaz; bilinmeyen iş", async () => {
		const r = runner();
		const name = uniq("now");
		let release;
		r.define({ name, every: { hours: 1 }, run: () => new Promise(resolve => (release = resolve)) });
		const first = r.runNow(name);
		await flush();
		await sleep(5);
		assert.deepEqual(await r.runNow(name), { ran: false, reason: "running" });
		release();
		assert.deepEqual(await first, { ran: true, ok: true });
		assert.deepEqual(await r.runNow("yok"), { ran: false, reason: "unknown" });
	});

	test("zaman aşımı: signal.abort, tur hatalı sayılır, iş bitene kadar yeni tur başlamaz", async () => {
		const r = runner();
		const name = uniq("timeout");
		let aborted = false;
		let starts = 0;
		r.define({
			name,
			every: { hours: 1 },
			timeoutMs: 30,
			run: ({ signal }) =>
				new Promise(resolve => {
					starts++;
					signal.addEventListener("abort", () => {
						aborted = true;
						setTimeout(resolve, 40); // iptale geç yanıt veren iş
					});
				}),
		});
		const result = await r.runNow(name);
		assert.equal(result.ran, true);
		assert.equal(result.ok, false);
		assert.match(result.error, /timeout/);
		assert.equal(aborted, true);
		assert.equal(r.status()[0].running, true, "iş iptale henüz yanıt vermedi");
		assert.deepEqual(await r.runNow(name), { ran: false, reason: "running" });
		await sleep(60);
		assert.equal(r.status()[0].running, false);
		assert.equal(starts, 1);
		assert.equal(r.status()[0].failures, 1);
	});

	test("hata yalıtımı: biri hata verir, diğeri çalışmaya devam eder; ardışık hata sayılır", async () => {
		const r = runner();
		let good = 0;
		let fail = true;
		const bad = uniq("bad");
		r.define({
			name: bad,
			every: { seconds: 0.03 },
			run: () => {
				if (fail) throw new Error("patladı");
			},
		});
		r.define({ name: uniq("good"), every: { seconds: 0.03 }, run: () => void good++ });
		await r.start();
		await sleep(120);
		const s = r.status().find(x => x.name === bad);
		assert.ok(s.failures >= 2 && s.consecutiveFailures === s.failures, JSON.stringify(s));
		assert.equal(s.lastError, "patladı");
		assert.ok(good >= 2);
		fail = false;
		await sleep(60);
		const after = r.status().find(x => x.name === bad);
		assert.equal(after.consecutiveFailures, 0);
		assert.equal(after.lastError, null);
		assert.ok(logs.some(l => l.level === "error" && l.text.includes("patladı")));
	});

	test("reschedule: yeni aralık bir sonraki turdan itibaren geçerli", async () => {
		const r = runner();
		const name = uniq("resched");
		let runs = 0;
		r.define({ name, every: { hours: 1 }, run: () => void runs++ });
		await r.start();
		await sleep(50);
		assert.equal(runs, 0);
		r.reschedule(name, { seconds: 0.02 });
		await sleep(120);
		assert.ok(runs >= 2, `runs=${runs}`);
		assert.deepEqual(r.status()[0].every, { seconds: 0.02 });
		assert.throws(() => r.reschedule("yok", { seconds: 1 }), /tanımlı değil/);
	});

	test("stop(): çalışan turu bekler, sonra yeni tur başlamaz", async () => {
		const r = runner();
		let finished = false;
		let runs = 0;
		r.define({
			name: uniq("stop"),
			every: { seconds: 0.01 },
			run: async () => {
				runs++;
				await sleep(50);
				finished = true;
			},
		});
		await r.start();
		await sleep(15);
		await r.stop(1000);
		assert.equal(finished, true);
		const count = runs;
		await sleep(50);
		assert.equal(runs, count);
		assert.equal(r.status()[0].nextRunAt, null);
	});

	test("stop(timeout): süre aşılırsa iptal sinyali gönderilir", async () => {
		const r = runner();
		let aborted = false;
		r.define({
			name: uniq("stop-abort"),
			every: { hours: 1 },
			runOnStart: true,
			run: ({ signal }) => new Promise(resolve => signal.addEventListener("abort", () => ((aborted = true), resolve()))),
		});
		await r.start();
		await sleep(10);
		await r.stop(30);
		assert.equal(aborted, true);
	});

	test("iki kopya (aynı kilit deposu): aynı anda tetiklenen tur tek kez çalışır", async () => {
		const name = uniq("shared");
		let runs = 0;
		const a = runner();
		const b = runner();
		const job = {
			name,
			every: { hours: 1 },
			runOnStart: { delayMs: 20 },
			run: async () => {
				runs++;
				await sleep(30);
			},
		};
		a.define(job);
		b.define(job);
		await Promise.all([a.start(), b.start()]);
		await sleep(120);
		assert.equal(runs, 1);
		const skips = a.status()[0].skips + b.status()[0].skips;
		assert.equal(skips, 1);
	});

	test("lock: false iken kilit alınmaz (iki kopya da çalışır)", async () => {
		const name = uniq("nolock");
		let runs = 0;
		const job = { name, every: { hours: 1 }, lock: false, runOnStart: true, run: () => void runs++ };
		const a = runner();
		const b = runner();
		a.define(job);
		b.define(job);
		await Promise.all([a.start(), b.start()]);
		await sleep(30);
		assert.equal(runs, 2);
	});
});

describe("service.jobs definer", () => {
	before(() => util.redis.setRedisClient(null));
	after(() => util.redis.setRedisClient(undefined));

	test("bootstrap/stopAll yaşam döngüsü ve healthCheck", async () => {
		let runs = 0;
		const name = uniq("svc");
		service.jobs.define({ name, every: { seconds: 0.02 }, run: () => void runs++ });
		assert.equal(await service.jobs.healthCheck(), false);
		await service.start("jobs");
		assert.equal(service.jobs.started, true);
		assert.equal(await service.jobs.healthCheck(), true);
		await sleep(80);
		assert.ok(runs >= 2);
		assert.equal((await service.healthCheckAll()).jobs, true);
		assert.equal(service.jobs.status().find(s => s.name === name).runs, runs);
		await service.stopAll();
		assert.equal(service.jobs.started, false);
		const count = runs;
		await sleep(50);
		assert.equal(runs, count);
		assert.equal(service.jobs.undefine(name), true);
	});

	test("start sonrası define hemen zamanlanır; runNow/reschedule zincirlenebilir", async () => {
		await service.start("jobs");
		const name = uniq("late");
		let runs = 0;
		service.jobs.define({ name, every: { hours: 1 }, run: () => void runs++ }).reschedule(name, { seconds: 0.02 });
		await sleep(70);
		assert.ok(runs >= 2);
		assert.deepEqual(await service.jobs.runNow(name), { ran: true, ok: true });
		await service.stopAll();
		service.jobs.undefine(name);
	});
});

describe("JobRunner (gerçek Redis kilidi)", { skip: !REDIS_URL && "TEST_REDIS_URL tanımlı değil" }, () => {
	before(async () => {
		config.manager.setConfig({ services: { redis: { url: REDIS_URL } } });
		util.redis.setRedisClient(undefined);
		await service.redis.start();
	});
	after(async () => {
		await service.redis.stop();
	});

	test("iki kopya, aynı Redis: tek çalıştırma; soğuma bayrağı hemen arkasından tekrarı önler", async () => {
		const name = uniq("redis-shared");
		let runs = 0;
		const job = {
			name,
			every: { hours: 1 },
			runOnStart: { delayMs: 10 },
			run: async () => {
				runs++;
				await sleep(20);
			},
		};
		const a = runner();
		const b = runner();
		a.define(job);
		// İkinci kopya biraz gecikmeli tetiklenir: kilit çoktan bırakılmış olur, soğuma bayrağı engeller.
		b.define({ ...job, runOnStart: { delayMs: 80 } });
		await Promise.all([a.start(), b.start()]);
		await sleep(200);
		assert.equal(runs, 1);
		assert.ok(await service.redis.client.get(`once:jobs:${name}:cooldown`));
		assert.equal(await service.redis.client.get(`lock:jobs:${name}`), null, "kilit bırakıldı");
	});

	test("runNow soğumaya bakmaz ama kilide uyar", async () => {
		const name = uniq("redis-now");
		let runs = 0;
		let release;
		const a = runner();
		const b = runner();
		const job = {
			name,
			every: { hours: 1 },
			run: () => {
				runs++;
				return new Promise(resolve => (release = resolve));
			},
		};
		a.define(job);
		b.define(job);
		const first = a.runNow(name);
		await sleep(30);
		assert.deepEqual(await b.runNow(name), { ran: false, reason: "locked" });
		release();
		await first;
		const second = b.runNow(name);
		await sleep(10);
		release();
		assert.deepEqual(await second, { ran: true, ok: true });
		assert.equal(runs, 2);
	});
});
