/**
 * ============================================================
 *  service.jobs  —  ZAMANLANMIŞ İŞLER
 * ============================================================
 * Kilitli, çakışmasız ve düzgün kapanan periyodik iş çalıştırıcı.
 *
 *   service.jobs.define({
 *       name: "carts:expire-drafts",
 *       every: { minutes: 15 },            // { seconds } | { minutes } | { hours } | { dailyAtUtc: "03:00" }
 *       lock: true,                        // aynı anda yalnızca bir kopya çalıştırır (varsayılan: true)
 *       runOnStart: { delayMs: 300000 },   // açılıştan sonra bir kez (opsiyonel)
 *       timeoutMs: 600000,                 // aşılırsa AbortSignal tetiklenir, tur hatalı sayılır
 *       run: async ({ signal, log }) => { ... },
 *   });
 *   await service.bootstrap(["prisma", "redis", "web", "jobs"]); // "jobs" en sona: kapanışta ilk o durur
 *
 * - Zamanlama `setTimeout` zinciridir: bir sonraki tur, önceki tur BİTTİKTEN sonra hesaplanır (aynı iş üst üste binmez).
 * - `lock: true` iken tur `util.redis` kilidiyle korunur (çok kopyalı kurulumda tek çalıştırma). Ayrıca kısa bir
 *   "soğuma" bayrağı (aralığın yarısı, en fazla 60 sn) diğer kopyaların aynı turu hemen arkasından tekrar çalıştırmasını önler.
 *   Redis yoksa kütüphanenin süreç içi kilidi kullanılır (tek kopya varsayımı).
 * - Bir işin hatası diğerlerini etkilemez; ardışık hatalar sayılır ve loglanır.
 * - `stop()` yeni turları durdurur, çalışan turları `services.jobs.shutdownTimeoutMs` kadar bekler, sonra `signal.abort()` eder.
 */
import { baseCfg } from "../config/access";
import { log } from "../util/logger";
import type { Logger } from "../util/logger";
import { acquireLock, type Lock } from "../util/redis/lock";
import { onceEvery } from "../util/redis";

/** Çalışma aralığı. `dailyAtUtc` "SS:DD" biçiminde UTC saattir (DST'den etkilenmez). */
export type JobSchedule = { seconds: number } | { minutes: number } | { hours: number } | { dailyAtUtc: string };

export interface JobContext {
	/** İş adı. */
	name: string;
	/** Zaman aşımında veya kapanışta tetiklenir; uzun işler kontrol etmeli. */
	signal: AbortSignal;
	/** İş adıyla önekli logger. */
	log: Logger;
}

export interface JobDefinition {
	/** Benzersiz iş adı (kilit anahtarının da parçası). */
	name: string;
	every: JobSchedule;
	/** Çok kopyalı kurulumda yalnızca bir kopya çalıştırsın mı? Varsayılan: true. */
	lock?: boolean;
	/** Servis başlayınca (zamanlamadan bağımsız) bir kez çalıştır. `true` = hemen. */
	runOnStart?: boolean | { delayMs: number };
	/** Tur zaman aşımı (ms). Varsayılan: 600000 (10 dk). */
	timeoutMs?: number;
	run: (ctx: JobContext) => Promise<unknown> | unknown;
}

export interface JobStatus {
	name: string;
	every: JobSchedule;
	running: boolean;
	runs: number;
	failures: number;
	/** Ardışık hata sayısı (başarılı turda sıfırlanır). */
	consecutiveFailures: number;
	/** Kilit/soğuma nedeniyle atlanan tur sayısı. */
	skips: number;
	lastStartedAt: string | null;
	lastFinishedAt: string | null;
	lastDurationMs: number | null;
	lastError: string | null;
	nextRunAt: string | null;
}

export type RunNowResult = { ran: true; ok: boolean; error?: string } | { ran: false; reason: "running" | "locked" | "unknown" };

const DEFAULT_TIMEOUT_MS = 600_000;
/** Kilidin, işin zaman aşımından ne kadar uzun tutulacağı (çöken kopyanın kilidi kendiliğinden düşer). */
const LOCK_MARGIN_MS = 60_000;
const MAX_TIMER_MS = 2_147_483_647;
const DAILY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Aralığın milisaniye karşılığı (`dailyAtUtc` için 24 saat). Geçersiz değerde hata fırlatır. */
export function scheduleIntervalMs(every: JobSchedule): number {
	if ("dailyAtUtc" in every) {
		if (!DAILY_RE.test(every.dailyAtUtc)) throw new Error(`service.jobs: geçersiz dailyAtUtc: "${every.dailyAtUtc}" (beklenen "SS:DD")`);
		return 86_400_000;
	}
	const ms = "seconds" in every ? every.seconds * 1000 : "minutes" in every ? every.minutes * 60_000 : "hours" in every ? every.hours * 3_600_000 : NaN;
	if (!Number.isFinite(ms) || ms <= 0) throw new Error(`service.jobs: geçersiz aralık: ${JSON.stringify(every)}`);
	return ms;
}

/**
 * `from` anından sonraki çalışma zamanı. Aralıklı işlerde `from + aralık`; `dailyAtUtc`'de bir sonraki (kesin büyük) UTC saat.
 */
export function computeNextRun(every: JobSchedule, from: Date): Date {
	if ("dailyAtUtc" in every) {
		const match = DAILY_RE.exec(every.dailyAtUtc);
		if (!match) throw new Error(`service.jobs: geçersiz dailyAtUtc: "${every.dailyAtUtc}" (beklenen "SS:DD")`);
		const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), Number(match[1]), Number(match[2]), 0, 0));
		if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
		return next;
	}
	return new Date(from.getTime() + scheduleIntervalMs(every));
}

type JobState = {
	def: JobDefinition;
	timer: NodeJS.Timeout | null;
	startTimer: NodeJS.Timeout | null;
	running: Promise<void> | null;
	controller: AbortController | null;
	runs: number;
	failures: number;
	consecutiveFailures: number;
	skips: number;
	lastStartedAt: Date | null;
	lastFinishedAt: Date | null;
	lastDurationMs: number | null;
	lastError: string | null;
	nextRunAt: Date | null;
};

const prefixed = (name: string): Logger => ({
	info: (...a) => log.info(`service.jobs:${name}`, ...a),
	warn: (...a) => log.warn(`service.jobs:${name}`, ...a),
	error: (...a) => log.error(`service.jobs:${name}`, ...a),
	debug: (...a) => log.debug(`service.jobs:${name}`, ...a),
});

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * İş çalıştırıcı. `service.jobs` bunun hazır bir örneğidir; testlerde veya ayrı bir zamanlayıcı gerekiyorsa `new JobRunner()`.
 */
export class JobRunner {
	private readonly jobs = new Map<string, JobState>();
	private active = false;

	/** Zamanlayıcı çalışıyor mu (start edildi ve durdurulmadı)? */
	get isActive(): boolean {
		return this.active;
	}

	/** İş tanımlar. Çalıştırıcı zaten başlatılmışsa iş hemen zamanlanır. Aynı adla ikinci tanım hata fırlatır. */
	define(def: JobDefinition): void {
		if (!def || typeof def.name !== "string" || !def.name) throw new Error("service.jobs.define: 'name' zorunlu.");
		if (typeof def.run !== "function") throw new Error(`service.jobs.define(${def.name}): 'run' bir fonksiyon olmalı.`);
		if (this.jobs.has(def.name)) throw new Error(`service.jobs.define: "${def.name}" zaten tanımlı.`);
		scheduleIntervalMs(def.every); // doğrula

		const state: JobState = {
			def: { ...def },
			timer: null,
			startTimer: null,
			running: null,
			controller: null,
			runs: 0,
			failures: 0,
			consecutiveFailures: 0,
			skips: 0,
			lastStartedAt: null,
			lastFinishedAt: null,
			lastDurationMs: null,
			lastError: null,
			nextRunAt: null,
		};
		this.jobs.set(def.name, state);
		if (this.active) this.activate(state);
	}

	/** İşi kaldırır (çalışan tur kesilmez, yalnızca sonraki turlar iptal edilir). */
	undefine(name: string): boolean {
		const state = this.jobs.get(name);
		if (!state) return false;
		this.clearTimers(state);
		this.jobs.delete(name);
		return true;
	}

	/** Tanımlı işlerin adları. */
	names(): string[] {
		return [...this.jobs.keys()];
	}

	/** Tüm işlerin durumu. */
	status(): JobStatus[] {
		return [...this.jobs.values()].map(s => ({
			name: s.def.name,
			every: s.def.every,
			running: s.running !== null,
			runs: s.runs,
			failures: s.failures,
			consecutiveFailures: s.consecutiveFailures,
			skips: s.skips,
			lastStartedAt: s.lastStartedAt?.toISOString() ?? null,
			lastFinishedAt: s.lastFinishedAt?.toISOString() ?? null,
			lastDurationMs: s.lastDurationMs,
			lastError: s.lastError,
			nextRunAt: s.nextRunAt?.toISOString() ?? null,
		}));
	}

	/** Aralığı çalışma zamanında değiştirir (çalışan tur kesilmez; bir sonraki tur yeni aralıkla hesaplanır). */
	reschedule(name: string, every: JobSchedule): void {
		const state = this.jobs.get(name);
		if (!state) throw new Error(`service.jobs.reschedule: "${name}" tanımlı değil.`);
		scheduleIntervalMs(every);
		state.def.every = every;
		if (this.active && !state.running) this.scheduleNext(state, new Date());
	}

	/**
	 * İşi hemen çalıştırır (yönetim/test). Kilit kurallarına uyar: aynı iş bu kopyada veya (kilitliyse) başka kopyada
	 * çalışıyorsa çalışmaz. Soğuma bayrağına bakmaz. Çalıştırıcı başlatılmamış olsa da çalışır.
	 */
	async runNow(name: string): Promise<RunNowResult> {
		const state = this.jobs.get(name);
		if (!state) return { ran: false, reason: "unknown" };
		return this.execute(state, false);
	}

	/** Tanımlı işleri zamanlar. */
	async start(): Promise<void> {
		if (this.active) return;
		this.active = true;
		for (const state of this.jobs.values()) this.activate(state);
		if (this.jobs.size > 0) log.info(`service.jobs: ${this.jobs.size} iş zamanlandı (${this.names().join(", ")}).`);
	}

	/**
	 * Yeni turları durdurur; çalışan turların bitmesini `timeoutMs` (varsayılan `services.jobs.shutdownTimeoutMs`) kadar bekler,
	 * süre aşılırsa `signal.abort()` eder ve kısa bir süre daha bekler.
	 */
	async stop(timeoutMs = baseCfg().services.jobs.shutdownTimeoutMs): Promise<void> {
		this.active = false;
		for (const state of this.jobs.values()) {
			this.clearTimers(state);
			state.nextRunAt = null;
		}

		const running = [...this.jobs.values()].filter(s => s.running);
		if (running.length === 0) return;

		const all = Promise.allSettled(running.map(s => s.running));
		const finished = await waitFor(all, timeoutMs);
		if (finished) return;

		log.warn(`service.jobs: ${running.length} iş ${timeoutMs}ms içinde bitmedi, iptal sinyali gönderiliyor (${running.map(s => s.def.name).join(", ")}).`);
		for (const state of running) state.controller?.abort(new Error("service.jobs: kapanış"));
		await waitFor(all, Math.min(2000, Math.max(100, timeoutMs)));
	}

	// ------------------------------------------------------------------
	private activate(state: JobState): void {
		const { runOnStart } = state.def;
		if (runOnStart) {
			const delay = typeof runOnStart === "object" ? Math.max(0, runOnStart.delayMs) : 0;
			state.startTimer = setTimeout(
				() => {
					state.startTimer = null;
					if (this.active) void this.execute(state, true);
				},
				Math.min(delay, MAX_TIMER_MS),
			);
			state.startTimer.unref?.();
		}
		this.scheduleNext(state, new Date());
	}

	private clearTimers(state: JobState): void {
		if (state.timer) clearTimeout(state.timer);
		if (state.startTimer) clearTimeout(state.startTimer);
		state.timer = null;
		state.startTimer = null;
	}

	private scheduleNext(state: JobState, from: Date): void {
		if (state.timer) clearTimeout(state.timer);
		state.timer = null;
		if (!this.active || !this.jobs.has(state.def.name)) return;

		const next = computeNextRun(state.def.every, from);
		state.nextRunAt = next;
		const delay = Math.max(0, next.getTime() - Date.now());
		state.timer = setTimeout(
			() => {
				state.timer = null;
				// Uzun aralıklar (setTimeout üst sınırı) parça parça beklenir.
				if (Date.now() < next.getTime()) return this.scheduleNext(state, new Date(next.getTime() - scheduleIntervalMs(state.def.every)));
				void this.execute(state, true);
			},
			Math.min(delay, MAX_TIMER_MS),
		);
		state.timer.unref?.();
	}

	/** Bir tur: yerel bayrak → kilit → (zamanlanmış turda) soğuma → çalıştır → bir sonraki turu zamanla. */
	private async execute(state: JobState, scheduled: boolean): Promise<RunNowResult> {
		const { def } = state;
		if (state.running) {
			state.skips++;
			if (scheduled) this.scheduleNext(state, new Date());
			return { ran: false, reason: "running" };
		}

		const timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const intervalMs = scheduleIntervalMs(def.every);
		let lock: Lock | null = null;
		let timedOut = false;
		let task: Promise<unknown> | null = null;
		let release: () => void = () => {};
		const gate = new Promise<void>(resolve => (release = resolve));
		state.running = gate; // kilit beklenirken de "çalışıyor" say (aynı kopyada çift tur olmasın)

		try {
			if (def.lock !== false) {
				lock = await acquireLock(`jobs:${def.name}`, { ttlMs: timeoutMs + LOCK_MARGIN_MS });
				if (!lock) {
					state.skips++;
					return { ran: false, reason: "locked" };
				}
				if (scheduled && !(await onceEvery(`jobs:${def.name}:cooldown`, Math.min(intervalMs / 2, 60_000) / 1000))) {
					state.skips++;
					return { ran: false, reason: "locked" };
				}
			}

			const controller = new AbortController();
			state.controller = controller;
			const started = new Date();
			state.lastStartedAt = started;
			state.runs++;

			let timer: NodeJS.Timeout | null = null;
			task = Promise.resolve().then(() => def.run({ name: def.name, signal: controller.signal, log: prefixed(def.name) }));
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					timedOut = true;
					controller.abort(new Error(`service.jobs: "${def.name}" ${timeoutMs}ms içinde bitmedi`));
					reject(new Error(`timeout after ${timeoutMs}ms`));
				}, timeoutMs);
				// unref() EDİLMEZ: süren bir tur bitene (ya da zaman aşımına uğrayana) kadar süreç açık kalmalı.
			});

			let error: unknown = null;
			try {
				await Promise.race([task, timeout]);
			} catch (err) {
				error = err;
			} finally {
				if (timer) clearTimeout(timer);
			}
			const finishedAt = new Date();
			state.lastFinishedAt = finishedAt;
			state.lastDurationMs = finishedAt.getTime() - started.getTime();
			if (error) {
				state.failures++;
				state.consecutiveFailures++;
				state.lastError = errorText(error);
				log.error(`service.jobs:${def.name}`, `tur başarısız (ardışık ${state.consecutiveFailures}):`, state.lastError);
				return { ran: true, ok: false, error: state.lastError };
			}
			state.consecutiveFailures = 0;
			state.lastError = null;
			return { ran: true, ok: true };
		} catch (err) {
			// Kilit/soğuma altyapısında beklenmeyen hata: tur atlanır.
			state.failures++;
			state.consecutiveFailures++;
			state.lastError = errorText(err);
			log.error(`service.jobs:${def.name}`, "tur başlatılamadı:", state.lastError);
			return { ran: true, ok: false, error: state.lastError };
		} finally {
			// Zaman aşımında iş hâlâ sürüyor olabilir: bitene kadar "çalışıyor" kalır (üst üste binmez), kilit de o zaman bırakılır.
			const held = lock;
			if (timedOut && task) void task.catch(() => undefined).finally(() => this.finish(state, held, release));
			else await this.finish(state, lock, release);
			if (scheduled) this.scheduleNext(state, new Date());
		}
	}

	private async finish(state: JobState, lock: Lock | null, release: () => void): Promise<void> {
		if (lock) await lock.release().catch(() => false);
		state.controller = null;
		state.running = null;
		release();
	}
}

async function waitFor(promise: Promise<unknown>, ms: number): Promise<boolean> {
	let timer: NodeJS.Timeout | null = null;
	const timeout = new Promise<false>(resolve => {
		timer = setTimeout(() => resolve(false), ms);
		timer.unref?.();
	});
	const result = await Promise.race([promise.then(() => true as const), timeout]);
	if (timer) clearTimeout(timer);
	return result;
}
