import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import { config } from "../config";
import { log } from "../utils/logger";

export class Mail_Service {
	private static instance: Mail_Service | null = null;
	private static transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;

	private constructor() {}

	public static getInstance(): Mail_Service {
		if (!Mail_Service.instance) Mail_Service.instance = new Mail_Service();
		return Mail_Service.instance;
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
		if (!Mail_Service.transporter) Mail_Service.transporter = nodemailer.createTransport(Mail_Service.getOptions());
		return Mail_Service.transporter;
	}

	async healthCheck(): Promise<boolean> {
		try {
			await this.transporter.verify();
			return true;
		} catch (err) {
			log.error("Mail_Service: verify failed.", err);
			return false;
		}
	}

	async send(message: Parameters<Transporter<SMTPTransport.SentMessageInfo>["sendMail"]>[0]): Promise<SMTPTransport.SentMessageInfo> {
		const cfg = (config as any)?.services?.mail ?? {};
		return this.transporter.sendMail({ from: cfg.from ?? process.env.MAIL_FROM, ...(message as object) } as any);
	}

	async close(): Promise<void> {
		if (Mail_Service.transporter) {
			Mail_Service.transporter.close();
			Mail_Service.transporter = null;
			Mail_Service.instance = null;
			log.info("Mail transporter closed");
		}
	}
}

export default Mail_Service;
