import fs from "node:fs";
import path from "node:path";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import { log } from "../utils/logger";
import { deepClone, deepMerge, isPlainObject } from "./deep-merge";
import { buildConfigJsonc } from "./jsonc-writer";
import type { ConfigChangeListener, ConfigInitOptions, ConfigSchema, DeepPartial, ResolvedConfig } from "./types";

export class ConfigManager {
	private defaults: Record<string, any> = {};
	private current: Record<string, any> = {};
	private schema: Record<string, any> | undefined;
	private options: Required<Omit<ConfigInitOptions<any>, "schema" | "header">> & { header?: string[] } = {
		fileName: "config.jsonc",
		cwd: process.cwd(),
		useFile: true,
		writeBack: true,
	};
	private listeners = new Set<ConfigChangeListener<any>>();
	private initialized = false;

	public readonly proxy: ResolvedConfig = new Proxy({} as Record<string, any>, {
		get: (_t, prop: string | symbol) => {
			if (prop === "toJSON") return () => deepClone(this.current);
			return this.current[prop as string];
		},
		set: (_t, prop: string | symbol, value) => {
			this.current[prop as string] = value;
			this.emit();
			return true;
		},
		has: (_t, prop) => prop in this.current,
		ownKeys: () => Reflect.ownKeys(this.current),
		getOwnPropertyDescriptor: (_t, prop) => {
			if (!(prop in this.current)) return undefined;
			return {
				configurable: true,
				enumerable: true,
				value: this.current[prop as string],
			};
		},
		deleteProperty: (_t, prop) => {
			delete this.current[prop as string];
			this.emit();
			return true;
		},
	}) as ResolvedConfig;

	public configPath(): string {
		return path.normalize(path.join(this.options.cwd, this.options.fileName));
	}

	public isInitialized(): boolean {
		return this.initialized;
	}

	public setDefaultConfig<T extends Record<string, any>>(defaults: T, options: ConfigInitOptions<T> = {}): T {
		if (!isPlainObject(defaults)) throw new TypeError("setDefaultConfig(): 'defaults' must be object.");

		this.defaults = deepClone(defaults);
		this.schema = (options.schema as Record<string, any>) ?? this.schema;

		if (options.fileName !== undefined) this.options.fileName = options.fileName;
		if (options.cwd !== undefined) this.options.cwd = options.cwd;
		if (options.useFile !== undefined) this.options.useFile = options.useFile;
		if (options.writeBack !== undefined) this.options.writeBack = options.writeBack;
		if (options.header !== undefined) this.options.header = options.header;

		const previous = this.initialized ? this.current : {};
		this.current = deepMerge(this.defaults, previous);

		if (this.options.useFile) this.current = deepMerge(this.current, this.readFile());

		this.initialized = true;
		this.emit();

		return this.proxy as unknown as T;
	}

	public getDefaultConfig<T = ResolvedConfig>(): T {
		return deepClone(this.defaults) as T;
	}

	public setConfig<T extends Record<string, any> = ResolvedConfig>(partial: DeepPartial<T> | Record<string, any>, persist = false): T {
		if (!isPlainObject(partial)) throw new TypeError("setConfig(): 'partial' must be object.");

		this.current = deepMerge(this.current, partial);
		this.emit();

		if (persist) this.writeFile(this.current);

		return this.proxy as unknown as T;
	}

	public resetConfig(reloadFile = true): ResolvedConfig {
		this.current = deepClone(this.defaults);
		if (reloadFile && this.options.useFile) this.current = deepMerge(this.current, this.readFile());
		this.emit();
		return this.proxy;
	}

	public snapshot<T = ResolvedConfig>(): T {
		return deepClone(this.current) as T;
	}

	public onChange<T = ResolvedConfig>(listener: ConfigChangeListener<T>): () => void {
		this.listeners.add(listener as ConfigChangeListener<any>);
		return () => this.listeners.delete(listener as ConfigChangeListener<any>);
	}

	private emit(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.proxy);
			} catch (err) {
				log.error("ConfigManager: onChange listener error:", err);
			}
		}
	}

	private readFile(): Record<string, any> {
		const cnfPath = this.configPath();

		if (!fs.existsSync(cnfPath)) {
			log.warn(`Config file not found at ${cnfPath}. Creating with default values.`);
			this.writeFile(this.defaults, true);
			return {};
		}

		try {
			const raw = fs.readFileSync(cnfPath, { encoding: "utf8" });
			const parseErrors: ParseError[] = [];
			const parsed = parseJsonc(raw, parseErrors, {
				allowTrailingComma: true,
				disallowComments: false,
			});

			if (parseErrors.length > 0) {
				log.error(`Error(s) parsing ${cnfPath}. Falling back to default config for this run:`, parseErrors);
				return {};
			}

			if (!isPlainObject(parsed)) return {};

			if (this.options.writeBack) {
				const merged = deepMerge(this.defaults, parsed);
				if (JSON.stringify(parsed) !== JSON.stringify(merged)) {
					this.writeFile(merged, true);
					log.warn(`Config file at ${cnfPath} was missing some fields. Filled with defaults.`);
				}
			}

			return parsed;
		} catch (err: any) {
			this.logFsError("reading", cnfPath, err);
			return {};
		}
	}

	/** config.jsonc dosyasını (açıklama yorumlarıyla birlikte) yazar. */
	public writeFile(value?: Record<string, any>, silent = false): void {
		const cnfPath = this.configPath();
		try {
			const merged = deepMerge(this.defaults, value ?? this.current);
			fs.mkdirSync(path.dirname(cnfPath), { recursive: true });
			fs.writeFileSync(cnfPath, buildConfigJsonc(merged, this.schema, this.options.header), { encoding: "utf8" });
			if (!silent) log.info(`Config written to ${cnfPath}`);
		} catch (err: any) {
			this.logFsError("writing", cnfPath, err);
		}
	}

	public reloadFile(): ResolvedConfig {
		if (!this.options.useFile) return this.proxy;
		this.current = deepMerge(this.current, this.readFile());
		this.emit();
		return this.proxy;
	}

	public watchFile(): () => void {
		const cnfPath = this.configPath();
		if (!fs.existsSync(cnfPath)) return () => {};

		let timer: NodeJS.Timeout | null = null;
		const watcher = fs.watch(cnfPath, () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => this.reloadFile(), 150);
		});

		return () => {
			if (timer) clearTimeout(timer);
			watcher.close();
		};
	}

	private logFsError(action: string, cnfPath: string, err: any): void {
		switch (err?.code) {
			case "EACCES":
				log.error(`Permission denied ${action} config file at ${cnfPath}:`, err);
				break;
			case "EISDIR":
				log.error(`Expected a file but found a directory at ${cnfPath}:`, err);
				break;
			default:
				log.error(`Error ${action} config file at ${cnfPath}:`, err);
				break;
		}
	}
}

export const configManager = new ConfigManager();
export const config: ResolvedConfig = configManager.proxy;

export type { ConfigInitOptions, ConfigSchema, DeepPartial };
