import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import { baseCfg } from "../config/access";
import { log } from "../util/logger";

/**
 * SMTP ayarları `config.services.mail`'den okunur (env: MAIL_HOST, MAIL_PORT, MAIL_SECURE,
 * MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM). Transporter lazy oluşturulur; import edilmesi
 * tek başına bağlantı açmaz.
 */
export class MailService {
	private static instance: MailService | null = null;
	private static _transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;

	private constructor() {}

	public static getInstance(): MailService {
		if (!MailService.instance) MailService.instance = new MailService();
		return MailService.instance;
	}

	public static getOptions(): SMTPTransport.Options & { pool: boolean } {
		const cfg = baseCfg().services.mail;

		return {
			pool: cfg.pool,
			host: cfg.host || undefined,
			port: cfg.port,
			secure: cfg.secure,
			auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
		};
	}

	public get transporter(): Transporter<SMTPTransport.SentMessageInfo> {
		if (!MailService._transporter) MailService._transporter = nodemailer.createTransport(MailService.getOptions());
		return MailService._transporter;
	}

	/** SMTP bağlantısını doğrular. Başarısızsa hata fırlatır. */
	async connect(): Promise<void> {
		await this.transporter.verify();
	}

	async healthCheck(): Promise<boolean> {
		try {
			await this.transporter.verify();
			return true;
		} catch (err) {
			log.warn("MailService: healthCheck başarısız.", err);
			return false;
		}
	}

	async send(message: Parameters<Transporter<SMTPTransport.SentMessageInfo>["sendMail"]>[0]): Promise<SMTPTransport.SentMessageInfo> {
		const from = baseCfg().services.mail.from || undefined;
		return this.transporter.sendMail({ from, ...message });
	}

	/** Transporter'ı kapatır. İdempotent. */
	async close(): Promise<void> {
		const transporter = MailService._transporter;
		MailService._transporter = null;
		MailService.instance = null;
		if (transporter) {
			transporter.close();
			log.info("MailService: transporter kapatıldı.");
		}
	}
}

export default MailService;
