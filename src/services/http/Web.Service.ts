import http, { type Server as HttpServer } from "node:http";
import https, { type Server as HttpsServer } from "node:https";
import fs from "node:fs";
import path from "node:path";
import type { RequestListener } from "node:http";

import { baseCfg } from "../../config/access";
import { log } from "../../util/logger";
import { createExpressApp, type ExpressAppOptions } from "./Express.Service";

export interface WebServiceOptions extends ExpressAppOptions {
	/** Hazır bir Express (veya herhangi bir RequestListener) uygulaması. Verilmezse createExpressApp() kullanılır. */
	app?: RequestListener;
	host?: string;
	port?: number;
}

/**
 * SSL dizinini çözer. Mutlak ve var olan bir yol verildiyse olduğu gibi kullanılır;
 * aksi halde çalışma dizinine göre çözülür (eski "/ssl" değerleri `<cwd>/ssl` olarak çalışmaya devam eder).
 */
function resolveSslDir(dir: string): string {
	if (path.isAbsolute(dir) && fs.existsSync(dir)) return dir;
	return path.join(process.cwd(), dir);
}

export class WebService {
	private static instance: WebService | null = null;
	private server: HttpServer | HttpsServer;
	private app: RequestListener;
	private options: WebServiceOptions;
	private secure: boolean;

	private constructor(options: WebServiceOptions = {}) {
		this.options = options;
		const web = baseCfg().services.web;
		this.app = options.app ?? (createExpressApp(options) as unknown as RequestListener);
		this.secure = web.secure.enabled;

		if (this.secure) {
			const dir = resolveSslDir(web.secure.path);
			const readSsl = (file: string) => fs.readFileSync(path.join(dir, file), "utf-8");
			this.server = https.createServer({ key: readSsl(web.secure.keyFile), cert: readSsl(web.secure.certFile) }, this.app);
		} else {
			this.server = http.createServer(this.app);
		}
	}

	public static getInstance(options?: WebServiceOptions): WebService {
		if (!WebService.instance) WebService.instance = new WebService(options);
		return WebService.instance;
	}

	/** Mevcut örnek (yoksa null). Örnek OLUŞTURMAZ. */
	public static peek(): WebService | null {
		return WebService.instance;
	}

	/** Router'ları vs. değiştirip sunucuyu yeniden kurmak için. Çalışan bir sunucu varsa önce stop() edilmelidir. */
	public static reset(): void {
		if (WebService.instance?.server.listening) throw new Error("WebService: sunucu çalışırken reset() çağrılamaz; önce stop() edin.");
		WebService.instance = null;
	}

	getServer(): HttpServer | HttpsServer {
		return this.server;
	}

	/** Sunucuya bağlı uygulama (createExpressApp() ile oluşturulan ya da dışarıdan verilen). */
	getApp(): RequestListener {
		return this.app;
	}

	private get host(): string {
		return this.options.host ?? baseCfg().services.web.host;
	}

	private get port(): number {
		return this.options.port ?? baseCfg().services.web.port;
	}

	/** Dinlemeye başlar. Port doluysa (EADDRINUSE) vb. durumlarda hata ile reject olur. */
	async start(): Promise<void> {
		if (this.server.listening) return;

		await new Promise<void>((resolve, reject) => {
			const onError = (err: Error) => {
				this.server.off("listening", onListening);
				if ((err as NodeJS.ErrnoException).code === "EADDRINUSE")
					err.message = `WebService: ${this.host}:${this.port} adresi kullanımda. Uygulamanın başka bir örneği çalışıyor ya da port başka bir süreç tarafından kullanılıyor olabilir. (${err.message})`;
				reject(err);
			};
			const onListening = () => {
				this.server.off("error", onError);
				resolve();
			};
			this.server.once("error", onError);
			this.server.once("listening", onListening);
			this.server.listen({ host: this.host, port: this.port });
		});

		// Dinlemeye başladıktan sonraki hatalar sadece loglanır.
		this.server.on("error", WebServerErrorHandler);
		const address = this.server.address();
		const port = typeof address === "object" && address ? address.port : this.port;
		log.info(`WebService: http${this.secure ? "s" : ""}://${this.host}:${port}/ adresinde çalışıyor.`);
	}

	/**
	 * Sunucuyu kapatır. Yeni bağlantı kabulü hemen durur, boştaki keep-alive bağlantılar
	 * kapatılır; süren istekler `services.web.shutdownTimeoutMs` kadar beklenir, sonra zorla kapatılır.
	 */
	async stop(): Promise<void> {
		if (!this.server.listening) return;

		const timeoutMs = baseCfg().services.web.shutdownTimeoutMs;
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				log.warn(`WebService: açık bağlantılar ${timeoutMs}ms içinde kapanmadı, zorla kapatılıyor.`);
				this.server.closeAllConnections();
			}, timeoutMs);
			timer.unref();
			// Süren istekler bittikçe boşa düşen keep-alive bağlantıları da kapat.
			const idleSweep = setInterval(() => this.server.closeIdleConnections(), 50);
			idleSweep.unref();

			this.server.close(err => {
				clearTimeout(timer);
				clearInterval(idleSweep);
				if (err) reject(err);
				else resolve();
			});
			this.server.closeIdleConnections();
		});

		this.server.off("error", WebServerErrorHandler);
		log.info("WebService: sunucu kapatıldı.");
	}
}

export default WebService;

function WebServerErrorHandler(err: Error) {
	log.error("WebService: sunucu hatası:", err);
}
