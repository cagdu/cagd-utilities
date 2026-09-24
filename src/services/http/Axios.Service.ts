import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, CreateAxiosDefaults, InternalAxiosRequestConfig } from "axios";

import axios, { AxiosError } from "axios";
import https from "node:https";

import { baseCfg, isDebugEnabled } from "../../config/access";
import { log } from "../../util/logger";

export interface AxiosServiceOptions {
	name: string;
	agent?: https.AgentOptions;
	/** axios.create() seçenekleri. Buradaki `timeout` config'teki genel `services.axios.timeout`'u ezer. */
	instance?: CreateAxiosDefaults;
}

export type AxiosErrorCode =
	| "ERR_BAD_OPTION_VALUE"
	| "ERR_BAD_OPTION"
	| "ERR_NOT_SUPPORT"
	| "ERR_DEPRECATED"
	| "ERR_INVALID_URL"
	| "ECONNABORTED"
	| "ERR_CANCELED"
	| "ETIMEDOUT"
	| "ERR_NETWORK"
	| "ERR_FR_TOO_MANY_REDIRECTS"
	| "ERR_BAD_RESPONSE"
	| "ERR_BAD_REQUEST";

/**
 * AxiosService'in fırlattığı hata. Gerçek bir `Error`'dur (stack trace korunur).
 *
 *   try { await http.request({ url: "/x" }); }
 *   catch (err) {
 *       if (err instanceof AxiosServiceError) err.status, err.code, err.inResponse, err.details.response?.data;
 *   }
 */
export class AxiosServiceError extends Error {
	/** Geriye dönük uyumluluk: eski `{ error: true, ... }` şekli. */
	readonly error = true as const;
	/** Hata sunucudan gelen bir cevapla mı oluştu (true), yoksa istek hiç cevap alamadan mı (false)? */
	readonly inResponse: boolean;
	readonly code: AxiosErrorCode | string;
	/** HTTP durum kodu (cevap yoksa null). */
	readonly status: number | null;
	/** Servis adı (AxiosServiceOptions.name). */
	readonly service: string;
	/** Orijinal axios hatası. */
	readonly details: AxiosError;

	constructor(service: string, details: AxiosError, inResponse: boolean) {
		super(details.message, { cause: details });
		this.name = "AxiosServiceError";
		this.service = service;
		this.details = details;
		this.inResponse = inResponse;
		this.code = details.code ?? "UNKNOWN";
		this.status = details.response?.status ?? null;
	}
}

/** @deprecated `AxiosServiceError` kullanın. */
export type InterceptorError = AxiosServiceError;

export class AxiosService {
	private agent: https.Agent;
	private instance: AxiosInstance;
	private name: string;

	constructor(opt: AxiosServiceOptions) {
		this.name = opt.name;
		this.agent = new https.Agent({ ...(opt.agent ?? {}) });
		this.instance = axios.create({ httpsAgent: this.agent, timeout: baseCfg().services.axios.timeout, ...(opt.instance ?? {}) });

		this.setupInterceptors();
	}

	private setupInterceptors() {
		this.instance.interceptors.request.use(
			(request: InternalAxiosRequestConfig) => {
				const userAgent = baseCfg().services.axios.userAgent;
				if (userAgent === false) request.headers.set("User-Agent", false);
				else if (userAgent && !request.headers.has("User-Agent")) request.headers.set("User-Agent", userAgent);
				return request;
			},
			(error: unknown) => {
				const err = this.normalizeRequestError(error);
				if (baseCfg().dev) log.error(`AxiosService:${this.name}`, "İstek hazırlanırken hata:", err.message);
				return Promise.reject(err);
			},
		);
		this.instance.interceptors.response.use(
			res => res,
			(error: unknown) => {
				const err = this.normalizeRequestError(error);
				if (baseCfg().dev) log.error(`AxiosService:${this.name}`, `İstek başarısız. Kod: ${err.code}${err.status ? `, HTTP ${err.status}` : ""}`);
				return Promise.reject(err);
			},
		);
	}

	isAxiosRequestError = (error: unknown): error is AxiosServiceError => error instanceof AxiosServiceError;

	/** Herhangi bir hatayı `AxiosServiceError`'a çevirir. */
	normalizeRequestError = (error: unknown, inResponse?: boolean): AxiosServiceError => {
		if (error instanceof AxiosServiceError) return error;

		let details: AxiosError;
		if (axios.isAxiosError(error)) details = error;
		else if (error instanceof Error) {
			details = new AxiosError(error.message, "UNKNOWN");
			details.stack = error.stack;
		} else details = new AxiosError("Beklenmeyen AxiosService hatası", "UNKNOWN");

		return new AxiosServiceError(this.name, details, inResponse ?? Boolean(details.response));
	};

	/** Alt seviye axios instance'ına erişim. */
	get raw(): AxiosInstance {
		return this.instance;
	}

	async request<T = any>(cfg: AxiosRequestConfig): Promise<AxiosResponse<T>> {
		if (isDebugEnabled("AxiosService")) log.debug(`AxiosService:${this.name}`, "İstek gönderiliyor:", cfg);
		return this.instance.request<T>(cfg);
	}
}

export default AxiosService;

const AxiosAgent = https.Agent;

export { AxiosAgent, type AxiosRequestConfig, type AxiosResponse };
