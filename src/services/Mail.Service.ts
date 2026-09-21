import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import { config } from "../config";
import { log } from "../util/logger";

/**
 * SMTP ayarları önce `config.services.mail`, yoksa process.env üzerinden okunur.
 * Transporter lazy oluşturulur; import edilmesi tek başına bağlantı açmaz.
 */
export class MailService {
	private static instance: MailService | null = null;
	private static transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;

	private constructor() {}

	public static getInstance(): MailService {
		if (!MailService.instance) MailService.instance = new MailService();
		return MailService.instance;
	}

	public static getOptions(): SMTPTransport.Options & { pool: boolean } {
		const cfg = (config as any)?.services?.mail ?? {};
		const env = process.env;

		return {
			pool: cfg.pool ?? true,
			host: cfg.host ?? env.MAIL_HOST,
			port: Number(cfg.port ?? env.MAIL_PORT ?? 587),
			secure: cfg.secure ?? env.MAIL_SECURE === "1",
			auth: {
				user: cfg.user ?? env.MAIL_USERNAME,
				pass: cfg.password ?? env.MAIL_PASSWORD,
			},
		};
	}

	public get transporter(): Transporter<SMTPTransport.SentMessageInfo> {
		if (!MailService.transporter) MailService.transporter = nodemailer.createTransport(MailService.getOptions());
		return MailService.transporter;
	}

	async healthCheck(): Promise<boolean> {
		try {
			await this.transporter.verify();
			return true;
		} catch (err) {
			log.error("MailService: verify başarısız.", err);
			return false;
		}
	}

	async send(message: Parameters<Transporter<SMTPTransport.SentMessageInfo>["sendMail"]>[0]): Promise<SMTPTransport.SentMessageInfo> {
		const cfg = (config as any)?.services?.mail ?? {};
		return this.transporter.sendMail({ from: cfg.from ?? process.env.MAIL_FROM, ...(message as object) } as any);
	}

	async close(): Promise<void> {
		if (MailService.transporter) {
			MailService.transporter.close();
			MailService.transporter = null;
			MailService.instance = null;
			log.info("Mail transporter closed");
		}
	}
}

export default MailService;
