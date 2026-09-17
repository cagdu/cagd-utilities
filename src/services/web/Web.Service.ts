import http, { type Server as HttpServer } from "node:http";
import https, { type Server as HttpsServer } from "node:https";
import fs from "node:fs";
import path from "node:path";
import type { RequestListener } from "node:http";

import { config } from "../../config";
import { log } from "../../utils/logger";
import { createExpressApp, type ExpressAppOptions } from "./Express.Service";

export interface WebServiceOptions extends ExpressAppOptions {
	app?: RequestListener;
	host?: string;
	port?: number;
}

export class WEB_Service {
	private static instance: WEB_Service | null = null;
	private server: HttpServer | HttpsServer;
	private options: WebServiceOptions;

	private constructor(options: WebServiceOptions = {}) {
		this.options = options;
		const web = (config as any)?.services?.web ?? {};
		const app = options.app ?? createExpressApp(options);

		if (web.secure?.enabled) {
			const readSsl = (file: string) => fs.readFileSync(path.join(process.cwd(), web.secure?.path ?? "/ssl", file), "utf-8");
			this.server = https.createServer({ key: readSsl(web.secure?.keyFile ?? "private.key"), cert: readSsl(web.secure?.certFile ?? "origin.key") }, app);
		} else {
			this.server = http.createServer(app);
		}

		this.server.on("error", WebServerErrorHandler);
	}

	public static getInstance(options?: WebServiceOptions): WEB_Service {
		if (!WEB_Service.instance) WEB_Service.instance = new WEB_Service(options);
		return WEB_Service.instance;
	}

	/** Router'ları vs. değiştirip sunucuyu yeniden kurmak için. */
	public static reset(): void {
		WEB_Service.instance = null;
	}

	getServer(): HttpServer | HttpsServer {
		return this.server;
	}

	private get host(): string {
		return this.options.host ?? (config as any)?.services?.web?.host ?? "127.0.0.1";
	}

	private get port(): number {
		return this.options.port ?? (config as any)?.services?.web?.port ?? 31443;
	}

	async Start(): Promise<void> {
		const secure = (config as any)?.services?.web?.secure?.enabled ? "s" : "";
		return new Promise<void>(resolve =>
			this.server.listen({ host: this.host, port: this.port }, () => {
				log.info(`Web Service running at http${secure}://${this.host}:${this.port}/ (${JSON.stringify(this.server.address())})`);
				resolve();
			}),
		);
	}

	async Stop(): Promise<void> {
		return new Promise<void>((resolve, reject) => this.server.close(err => (err ? reject(err) : resolve())));
	}
}

export default WEB_Service;

function WebServerErrorHandler(err: Error) {
	log.error("Web Server Error:", err);
	if ((err as any).code === "EADDRINUSE") log.error("Web Server Error: Address already in use. Please check if another instance of the application is running or if the port is occupied by another process.");
}
