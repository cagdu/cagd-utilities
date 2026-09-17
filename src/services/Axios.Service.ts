import type { AxiosInstance, AxiosRequestConfig, AxiosResponse, CreateAxiosDefaults, InternalAxiosRequestConfig } from "axios";

import axios from "axios";
import https from "node:https";

import { config } from "../config";
import { log } from "../utils/logger";

export interface CreateInstance {
	Name: string;
	Agent?: https.AgentOptions;
	Instance?: CreateAxiosDefaults;
}

export type ErrorDetails_Code = "ERR_BAD_OPTION_VALUE" | "ERR_BAD_OPTION" | "ERR_NOT_SUPPORT" | "ERR_DEPRECATED" | "ERR_INVALID_URL" | "ECONNABORTED" | "ERR_CANCELED" | "ETIMEDOUT" | "ERR_NETWORK" | "ERR_FR_TOO_MANY_REDIRECTS" | "ERR_BAD_RESPONSE" | "ERR_BAD_REQUEST";

export interface Intercepter_Error {
	error: boolean;
	inResponse: boolean;
	details: {
		message: string;
		name: string;
		stack: string;
		config: object;
		code: ErrorDetails_Code | string;
	};
}

export class Axios_Service {
	private agent: https.Agent;
	private instance: AxiosInstance;
	private Name = "Local";

	constructor(opt: CreateInstance) {
		this.agent = this.CreateAgent(opt.Agent);
		this.instance = this.CreateInstance(opt.Instance);
		this.Name = opt.Name;

		this.SetupInterceptors();
	}

	private CreateAgent(opt?: https.AgentOptions): https.Agent {
		return new https.Agent({ ...(typeof opt === "object" ? opt : {}) });
	}

	private CreateInstance(opt?: CreateAxiosDefaults): AxiosInstance {
		return axios.create({ httpsAgent: this.agent, ...(typeof opt === "object" ? opt : {}), timeout: (config as any)?.services?.axios?.timeout ?? 3000 });
	}

	private SetupInterceptors() {
		this.instance.interceptors.request.use(
			(request: InternalAxiosRequestConfig) => {
				request.headers.set("User-Agent", false);
				return request;
			},
			(error: any): Promise<Intercepter_Error> => {
				if ((config as any)?.dev) void log.error("Axios_Service:" + this.Name, "Request Interceptors Error", error);
				return Promise.reject({ error: true, inResponse: false, details: error });
			},
		);
		this.instance.interceptors.response.use(
			res => res,
			(error: any): Promise<Intercepter_Error> => {
				if ((config as any)?.dev) void log.error("Axios_Service:" + this.Name, "Response Interceptors Error.", `Code: ${error?.code}`);
				return Promise.reject({ error: true, inResponse: true, details: error });
			},
		);
	}

	isAxiosRequestError = (error: unknown): error is Intercepter_Error => {
		if (!error || typeof error !== "object") return false;
		if (!("error" in error) || !("details" in error)) return false;

		const details = (error as Intercepter_Error).details;
		return typeof details?.code === "string";
	};

	normalizeRequestError = (error: unknown): Intercepter_Error => {
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

	get raw(): AxiosInstance {
		return this.instance;
	}

	async request<T = any>(cfg: AxiosRequestConfig): Promise<AxiosResponse<T>> {
		if ((config as any)?.dev && ((config as any)?.debug ?? []).find((x: string) => x === "Axios_Service" || x === "*")) void log.debug("Axios_Service:" + this.Name, "Request going with config", cfg);
		return this.instance.request<T>(cfg);
	}
}

export default Axios_Service;

const Axios_Agent = https.Agent;

export { Axios_Agent, type AxiosRequestConfig, type AxiosResponse };
