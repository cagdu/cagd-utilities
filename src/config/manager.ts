import fs from "node:fs";
import path from "node:path";
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser";

import { log } from "../util/logger";
import { baseConfigEnv } from "./base-config";
import { deepClone, deepEqual, deepMerge, findMissingPaths, isPlainObject } from "./deep-merge";
import { readEnv } from "./env";
import { buildConfigJsonc } from "./jsonc-writer";
import type { ConfigChangeListener, ConfigEnvMap, ConfigInitOptions, ConfigSchema, DeepPartial, ResolvedConfig } from "./types";

type ManagerOptions = {
	fileName: string;
	cwd: string;
	useFile: boolean;
	writeBack: boolean;
	header?: string[];
	env: ConfigEnvMap | false;
};

const JSONC_FORMAT = { formattingOptions: { insertSpaces: false, tabSize: 1, eol: "\n" } };

/**
 * ============================================================
 *  CONFIG MANAGER
 * ============================================================
 * Tek bir modül seviyesinde (singleton) config deposu tutar.
 *
 * Config KATMANLAR halinde tutulur (sağdaki soldakini ezer):
 *
 *   varsayılan (defaults)  <  config.jsonc  <  ortam değişkeni  <  setConfig()
 *
 *  - setDefaultConfig(defaults, options?) : varsayılanları tanımlar, dosyayı ve
 *    ortam değişkenlerini okur, TAM TİPLİ canlı proxy döner.
 *  - setConfig(partial, persist?)         : runtime katmanını günceller. Reboot
 *    gerekmez. `persist` ise değer dosya katmanına da yazılır.
 *  - proxy                                : referansı hiç değişmeyen, içeriği
 *    daima güncel olan canlı görünüm.
 *
 * Ortam değişkenlerinden gelen değerler dosyaya ASLA yazılmaz (şifreler sızmaz).
 */
export class ConfigManager {
	private defaults: Record<string, any> = {};
	private fileData: Record<string, any> = {};
	private envData: Record<string, any> = {};
	private runtime: Record<string, any> = {};
	private current: Record<string, any> = {};
	private version = 0;
	private fileBroken = false;
	private schema: Record<string, any> | undefined;
	private options: ManagerOptions = {
		fileName: "config.jsonc",
		cwd: process.cwd(),
		useFile: true,
		writeBack: true,
		env: baseConfigEnv,
	};
	private listeners = new Set<ConfigChangeListener<any>>();
	private initialized = false;

	/** Referansı hiç değişmeyen, içeriği daima güncel olan proxy. */
	public readonly proxy: ResolvedConfig = new Proxy({} as Record<string, any>, {
		get: (_t, prop: string | symbol) => {
			if (prop === "toJSON") return () => deepClone(this.current);
			return this.current[prop as string];
		},
		set: (_t, prop: string | symbol, value) => {
			this.runtime[prop as string] = value;
			this.recompute();
			this.emit();
			return true;
		},
		has: (_t, prop) => prop in this.current,
		ownKeys: () => Reflect.ownKeys(this.current),
		getOwnPropertyDescriptor: (_t, prop) => {
			if (!(prop in this.current)) return undefined;
			return { configurable: true, enumerable: true, writable: true, value: this.current[prop as string] };
		},
		deleteProperty: (_t, prop) => {
			delete this.runtime[prop as string];
			this.recompute();
			this.emit();
			return true;
		},
	}) as ResolvedConfig;

	// ------------------------------------------------------------------
	// Yol (path) hesaplama / durum
	// ------------------------------------------------------------------
	public configPath(): string {
		return path.normalize(path.resolve(this.options.cwd, this.options.fileName));
	}

	public isInitialized(): boolean {
		return this.initialized;
	}

	/** Config her değiştiğinde artan sayaç (önbellek geçersizleştirme için). */
	public getVersion(): number {
		return this.version;
	}

	/** Anlık config'in KENDİSİ (kopya değil). Sadece okuma amaçlı, paket içi kullanım içindir. */
	public peek(): Readonly<Record<string, any>> {
		return this.current;
	}

	// ------------------------------------------------------------------
	// Varsayılanları tanımla
	// ------------------------------------------------------------------
	public setDefaultConfig<T extends Record<string, any>>(defaults: T, options: ConfigInitOptions<T> = {}): T {
		if (!isPlainObject(defaults)) throw new TypeError("setDefaultConfig(): 'defaults' bir obje olmalıdır.");

		this.defaults = deepClone(defaults);
		this.schema = (options.schema as Record<string, any>) ?? this.schema;

		if (options.fileName !== undefined) this.options.fileName = options.fileName;
		if (options.cwd !== undefined) this.options.cwd = options.cwd;
		if (options.useFile !== undefined) this.options.useFile = options.useFile;
		if (options.writeBack !== undefined) this.options.writeBack = options.writeBack;
		if (options.header !== undefined) this.options.header = options.header;
		if (options.env !== undefined) this.options.env = options.env;

		// Daha önce setConfig ile verilmiş (runtime) değerler korunur.
		this.fileData = this.options.useFile ? this.readFile() : {};
		this.envData = this.options.env ? readEnv(this.defaults, this.options.env) : {};

		this.initialized = true;
		this.recompute();
		this.emit();

		return this.proxy as unknown as T;
	}

	/** Sadece varsayılan objeyi döner (kopya). */
	public getDefaultConfig<T = ResolvedConfig>(): T {
		return deepClone(this.defaults) as T;
	}

	// ------------------------------------------------------------------
	// Runtime güncelleme
	// ------------------------------------------------------------------
	public setConfig<T extends Record<string, any> = ResolvedConfig>(partial: DeepPartial<T> | Record<string, any>, persist = false): T {
		if (!isPlainObject(partial)) throw new TypeError("setConfig(): 'partial' bir obje olmalıdır.");

		this.runtime = deepMerge(this.runtime, partial);
		if (persist) {
			this.fileData = deepMerge(this.fileData, partial);
			this.persistFileData();
		}

		this.recompute();
		this.emit();
		return this.proxy as unknown as T;
	}

	/** Runtime değişikliklerini siler; config'i varsayılan + dosya + ortam değişkenlerine döndürür. */
	public resetConfig(reloadFile = true): ResolvedConfig {
		this.runtime = {};
		if (reloadFile && this.options.useFile) this.fileData = this.readFile();
		this.recompute();
		this.emit();
		return this.proxy;
	}

	/** Anlık config'in düz (proxy olmayan) kopyası. */
	public snapshot<T = ResolvedConfig>(): T {
		return deepClone(this.current) as T;
	}

	/** Config her değiştiğinde tetiklenir. Abonelikten çıkmak için dönen fonksiyonu çağır. */
	public onChange<T = ResolvedConfig>(listener: ConfigChangeListener<T>): () => void {
		this.listeners.add(listener as ConfigChangeListener<any>);
		return () => this.listeners.delete(listener as ConfigChangeListener<any>);
	}

	private recompute(): void {
		this.current = deepMerge(deepMerge(deepMerge(this.defaults, this.fileData), this.envData), this.runtime);
		this.version++;
	}

	private emit(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.proxy);
			} catch (err) {
				log.error("ConfigManager: onChange dinleyicisi hata verdi:", err);
			}
		}
	}

	// ------------------------------------------------------------------
	// Dosya işlemleri (config.jsonc)
	// ------------------------------------------------------------------
	private readFile(): Record<string, any> {
		const cnfPath = this.configPath();

		if (!fs.existsSync(cnfPath)) {
			log.warn(`Config dosyası bulunamadı (${cnfPath}), varsayılan değerlerle oluşturuluyor.`);
			this.fileBroken = false;
			this.writeText(cnfPath, buildConfigJsonc(this.defaults, this.schema, this.options.header), true);
			return {};
		}

		try {
			const raw = fs.readFileSync(cnfPath, { encoding: "utf8" });
			const parseErrors: ParseError[] = [];
			const parsed = parseJsonc(raw, parseErrors, { allowTrailingComma: true, disallowComments: false });

			if (parseErrors.length > 0 || !isPlainObject(parsed)) {
				this.fileBroken = true;
				log.error(`Config dosyası okunamadı (${cnfPath}). Bu çalıştırmada varsayılanlar kullanılıyor; dosya düzeltilene kadar dosyaya yazılmayacak.`, parseErrors);
				return {};
			}
			this.fileBroken = false;

			// Gerçekten eksik alan varsa SADECE onları ekle; mevcut içerik ve yorumlar korunur.
			if (this.options.writeBack) {
				const missing = findMissingPaths(this.defaults, parsed);
				if (missing.length > 0) {
					let text = raw;
					for (const keyPath of missing) {
						let value: unknown = this.defaults;
						for (const key of keyPath) value = (value as Record<string, unknown>)[key];
						text = applyEdits(text, modify(text, keyPath, value, JSONC_FORMAT));
					}
					this.writeText(cnfPath, text, true);
					log.warn(`Config dosyasına eksik alanlar varsayılan değerleriyle eklendi (${cnfPath}): ${missing.map(p => p.join(".")).join(", ")}`);
				}
			}

			return parsed;
		} catch (err: any) {
			this.logFsError("okunurken", cnfPath, err);
			return {};
		}
	}

	/** Dosya katmanını diske yazar. Dosya varsa sadece değişen alanlar güncellenir (yorumlar korunur). */
	private persistFileData(): void {
		const cnfPath = this.configPath();
		if (this.fileBroken) {
			log.error(`Config dosyası bozuk olduğu için yazılmadı (${cnfPath}). Önce dosyayı düzeltin.`);
			return;
		}

		const target = deepMerge(this.defaults, this.fileData);
		let raw: string | null = null;
		try {
			if (fs.existsSync(cnfPath)) raw = fs.readFileSync(cnfPath, { encoding: "utf8" });
		} catch (err) {
			this.logFsError("okunurken", cnfPath, err);
			return;
		}

		if (raw === null) {
			this.writeText(cnfPath, buildConfigJsonc(target, this.schema, this.options.header));
			return;
		}

		const errors: ParseError[] = [];
		const parsed = parseJsonc(raw, errors, { allowTrailingComma: true });
		if (errors.length > 0 || !isPlainObject(parsed)) {
			log.error(`Config dosyası bozuk olduğu için yazılmadı (${cnfPath}). Önce dosyayı düzeltin.`);
			return;
		}

		let text = raw;
		const patch = (want: unknown, have: unknown, keyPath: string[]): void => {
			if (isPlainObject(want) && isPlainObject(have)) {
				for (const key of Object.keys(want)) patch(want[key], have[key], [...keyPath, key]);
				return;
			}
			if (!deepEqual(want, have)) text = applyEdits(text, modify(text, keyPath, want, JSONC_FORMAT));
		};
		patch(target, parsed, []);

		if (text !== raw) this.writeText(cnfPath, text);
	}

	/**
	 * config.jsonc dosyasını yazar.
	 * - `value` verilmezse: dosyadaki değerler + setConfig() ile yapılan runtime değişiklikleri yazılır.
	 * - `value` verilirse: dosya katmanı bu değerle değiştirilir.
	 * Ortam değişkenlerinden gelen değerler yazılmaz.
	 */
	public writeFile(value?: Record<string, any>): void {
		this.fileData = value ? deepClone(value) : deepMerge(this.fileData, this.runtime);
		this.persistFileData();
		this.recompute();
		this.emit();
	}

	private writeText(cnfPath: string, text: string, silent = false): void {
		try {
			fs.mkdirSync(path.dirname(cnfPath), { recursive: true });
			fs.writeFileSync(cnfPath, text, { encoding: "utf8" });
			if (!silent) log.info(`Config dosyaya yazıldı: ${cnfPath}`);
		} catch (err: any) {
			this.logFsError("yazılırken", cnfPath, err);
		}
	}

	/** Dosyayı yeniden okuyup config'i günceller (hot reload). Dosyadan silinen alanlar varsayılana döner. */
	public reloadFile(): ResolvedConfig {
		if (!this.options.useFile) return this.proxy;
		this.fileData = this.readFile();
		this.recompute();
		this.emit();
		return this.proxy;
	}

	/**
	 * config.jsonc dosyasını izler; değiştiğinde config otomatik güncellenir.
	 * Dosya yerine DİZİN izlenir; böylece editörlerin "atomic save" (yeni dosya
	 * yazıp eskisinin yerine taşıma) yöntemiyle kaydetmesi izlemeyi koparmaz.
	 */
	public watchFile(): () => void {
		const cnfPath = this.configPath();
		const dir = path.dirname(cnfPath);
		const base = path.basename(cnfPath);
		if (!fs.existsSync(dir)) return () => {};

		let timer: NodeJS.Timeout | null = null;
		const watcher = fs.watch(dir, (_event, filename) => {
			if (filename && filename.toString() !== base) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => this.reloadFile(), 150);
		});
		watcher.on("error", err => log.error(`Config dizini izlenirken hata (${dir}):`, err));

		return () => {
			if (timer) clearTimeout(timer);
			watcher.close();
		};
	}

	private logFsError(action: string, cnfPath: string, err: any): void {
		switch (err?.code) {
			case "EACCES":
				log.error(`Config dosyası ${action} izin hatası (${cnfPath}):`, err);
				break;
			case "EISDIR":
				log.error(`Config dosyası bekleniyordu ama dizin bulundu (${cnfPath}):`, err);
				break;
			default:
				log.error(`Config dosyası ${action} hata (${cnfPath}):`, err);
				break;
		}
	}
}

export const configManager = new ConfigManager();

/** Canlı config proxy'si. Referansı değişmez, içeriği daima günceldir. */
export const config: ResolvedConfig = configManager.proxy;

export type { ConfigInitOptions, ConfigSchema, DeepPartial };
