import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, CreateAxiosDefaults, InternalAxiosRequestConfig } from "axios";

import axios from "axios";
import https from "node:https";

import { config } from "../../config";
import { log } from "../../util/logger";

export interface AxiosServiceOptions {
	name: string;
	agent?: https.AgentOptions;
	instance?: CreateAxiosDefaults;
}

export type AxiosErrorCode = "ERR_BAD_OPTION_VALUE" | "ERR_BAD_OPTION" | "ERR_NOT_SUPPORT" | "ERR_DEPRECATED" | "ERR_INVALID_URL" | "ECONNABORTED" | "ERR_CANCELED" | "ETIMEDOUT" | "ERR_NETWORK" | "ERR_FR_TOO_MANY_REDIRECTS" | "ERR_BAD_RESPONSE" | "ERR_BAD_REQUEST";

export interface InterceptorError {
	error: boolean;
	inResponse: boolean;
	details: {
		message: string;
		name: string;
		stack: string;
		config: object;
		code: AxiosErrorCode | string;
	};
}

export class AxiosService {
	private agent: https.Agent;
	private instance: AxiosInstance;
	private name = "Local";

	constructor(opt: AxiosServiceOptions) {
		this.agent = this.createAgent(opt.agent);
		this.instance = this.createInstance(opt.instance);
		this.name = opt.name;

		this.setupInterceptors();
	}

	private createAgent(opt?: https.AgentOptions): https.Agent {
		return new https.Agent({ ...(typeof opt === "object" ? opt : {}) });
	}

	private createInstance(opt?: CreateAxiosDefaults): AxiosInstance {
		return axios.create({ httpsAgent: this.agent, ...(typeof opt === "object" ? opt : {}), timeout: (config as any)?.services?.axios?.timeout ?? 3000 });
	}

	private setupInterceptors() {
		this.instance.interceptors.request.use(
			(request: InternalAxiosRequestConfig) => {
				request.headers.set("User-Agent", false);
				return request;
			},
			(error: any): Promise<InterceptorError> => {
				if ((config as any)?.dev) void log.error("AxiosService:" + this.name, "Request Interceptors Error", error);
				return Promise.reject({ error: true, inResponse: false, details: error });
			},
		);
		this.instance.interceptors.response.use(
			res => res,
			(error: any): Promise<InterceptorError> => {
				if ((config as any)?.dev) void log.error("AxiosService:" + this.name, "Response Interceptors Error.", `Code: ${error?.code}`);
				return Promise.reject({ error: true, inResponse: true, details: error });
			},
		);
	}

	isAxiosRequestError = (error: unknown): error is InterceptorError => {
		if (!error || typeof error !== "object") return false;
		if (!("error" in error) || !("details" in error)) return false;

		const details = (error as InterceptorError).details;
		return typeof details?.code === "string";
	};

	normalizeRequestError = (error: unknown): InterceptorError => {
		if (this.isAxiosRequestError(error)) return error;

		return {
			error: true,
			inResponse: false,
			details: {
				message: error instanceof Error ? error.message : "Unexpected Axios Service Error",
				name: error instanceof Error ? error.name : "UnknownError",
				stack: error instanceof Error ? (error.stack ?? "") : "",
				config: {},
				code: "UNKNOWN",
			},
		};
	};

	/** Alt seviye axios instance'ına erişim. */
	get raw(): AxiosInstance {
		return this.instance;
	}

	async request<T = any>(cfg: AxiosRequestConfig): Promise<AxiosResponse<T>> {
		if ((config as any)?.dev && ((config as any)?.debug ?? []).find((x: string) => x === "AxiosService" || x === "*")) void log.debug("AxiosService:" + this.name, "Request going with config", cfg);
		return this.instance.request<T>(cfg);
	}
}

export default AxiosService;

const AxiosAgent = https.Agent;

export { AxiosAgent, type AxiosRequestConfig, type AxiosResponse };
