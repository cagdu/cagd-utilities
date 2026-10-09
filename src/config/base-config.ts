import type { ConfigEnvMap, ConfigSchema } from "./types";

/**
 * Paketin kendi servislerinin (database, web, axios, redis, mail) ihtiyaç duyduğu
 * TEMEL config iskeleti ve TÜM varsayılan değerlerin TEK kaynağı. Servisler kendi
 * içlerinde ayrıca varsayılan değer tutmaz. Tüketici proje kendi alanlarını ekler:
 *
 *   import { config, baseConfig, baseConfigSchema } from "cagdu-utilities";
 *
 *   const defaultConfig = {
 *       ...baseConfig,
 *       myFeature: { enabled: true },
 *   };
 *
 *   export const cfg = config.manager.setDefaultConfig(defaultConfig, { schema: baseConfigSchema });
 */
export const baseConfig = {
	dev: true,
	debug: [] as string[],
	database: {
		/** "postgres" | "mssql" */
		provider: "postgres" as "postgres" | "mssql",
		prisma: {
			/** Generated prisma client'ın modül yolu. */
			clientPath: "@prisma/client",
		},
		mssql: {
			host: "localhost",
			port: 1433,
			user: "",
			password: "",
			database: "",
			encrypt: false,
			trustServerCertificate: true,
			max: 20,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 5000,
		},
		postgres: {
			url: "",
			host: "localhost",
			port: 5432,
			user: "",
			password: "",
			database: "",
			ssl: false as boolean | Record<string, unknown>,
			max: 20,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 5000,
		},
	},
	services: {
		axios: {
			timeout: 60000,
			userAgent: false as string | false,
		},
		redis: {
			url: "",
			host: "localhost",
			port: 6379,
			password: "",
			db: 0,
			connectRetries: 5,
		},
		jobs: {
			shutdownTimeoutMs: 10000,
		},
		mail: {
			host: "",
			port: 587,
			secure: false,
			user: "",
			password: "",
			from: "",
			pool: true,
		},
		web: {
			host: "127.0.0.1",
			port: 31443,
			trustProxy: false,
			bodyLimit: "100kb",
			shutdownTimeoutMs: 10000,
			cors: {
				allowedHeaders: ["Content-Type", "Authorization"],
				methods: ["GET", "POST"],
				origin: "*",
			},
			helmet: {
				contentSecurityPolicy: false,
				xDownloadOptions: false,
				xPoweredBy: false,
			},
			secure: {
				enabled: false,
				path: "ssl",
				keyFile: "private.key",
				certFile: "origin.pem",
			},
			rateLimit: {
				enabled: true,
				windowMs: 60000,
				limit: 20,
				message: "Too many requests, please try again later.",
			},
		},
	},
};

export type BaseConfig = typeof baseConfig;

/**
 * Paketin tanıdığı ortam değişkenleri. `setDefaultConfig()` varsayılan olarak bunu kullanır.
 * Öncelik: setConfig() > ortam değişkeni > config.jsonc > varsayılan.
 */
export const baseConfigEnv: ConfigEnvMap = {
	"database.provider": "DATABASE_TYPE",
	"database.postgres.url": "DATABASE_URL",
	"database.postgres.host": "PGHOST",
	"database.postgres.port": "PGPORT",
	"database.postgres.user": "PGUSER",
	"database.postgres.password": "PGPASSWORD",
	"database.postgres.database": "PGDATABASE",
	"database.mssql.host": "MSSQL_HOST",
	"database.mssql.port": "MSSQL_PORT",
	"database.mssql.user": "MSSQL_USER",
	"database.mssql.password": "MSSQL_PASSWORD",
	"database.mssql.database": "MSSQL_DATABASE",
	"services.redis.url": "REDIS_URL",
	"services.redis.host": "REDIS_HOST",
	"services.redis.port": "REDIS_PORT",
	"services.redis.password": "REDIS_PASSWORD",
	"services.redis.db": "REDIS_DB",
	"services.mail.host": "MAIL_HOST",
	"services.mail.port": "MAIL_PORT",
	"services.mail.secure": "MAIL_SECURE",
	"services.mail.user": "MAIL_USERNAME",
	"services.mail.password": "MAIL_PASSWORD",
	"services.mail.from": "MAIL_FROM",
	"services.web.host": "WEB_HOST",
	"services.web.port": "WEB_PORT",
};

/** config.jsonc yorum satırlarını üreten açıklama şeması. */
export const baseConfigSchema: ConfigSchema<BaseConfig> = {
	dev: "Uygulamanın geliştirme (development) modunda çalışıp çalışmadığı",
	debug: 'Hata ayıklama (debug) etiketleri. Örn: ["AxiosService"] ya da ["*"] (hepsi)',
	database: {
		__self: "Veritabanı yapılandırması",
		provider: 'Kullanılacak veritabanı: "postgres" veya "mssql" (env: DATABASE_TYPE)',
		prisma: {
			__self: "Prisma yapılandırması",
			clientPath: "Generated Prisma client'ın modül yolu (göreli yollar çalışma dizinine göre çözülür)",
		},
		mssql: {
			__self: "MSSQL veritabanı yapılandırması (env: MSSQL_HOST, MSSQL_PORT, MSSQL_USER, MSSQL_PASSWORD, MSSQL_DATABASE)",
			host: "Veritabanı sunucusu",
			port: "Veritabanı portu",
			user: "Veritabanı kullanıcısı",
			password: "Veritabanı şifresi (tercihen MSSQL_PASSWORD ortam değişkeniyle verin)",
			database: "Veritabanı adı",
			encrypt: "Bağlantının şifrelenip şifrelenmeyeceği",
			trustServerCertificate: "Sunucu sertifikasına güvenilip güvenilmeyeceği",
			max: "Maksimum bağlantı sayısı",
			idleTimeoutMillis: "Boşta bekleme süresi (milisaniye)",
			connectionTimeoutMillis: "Bağlantı zaman aşımı süresi (milisaniye)",
		},
		postgres: {
			__self: "PostgreSQL veritabanı yapılandırması (env: DATABASE_URL, PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE)",
			url: "Tam bağlantı adresi (verilirse host/port/user/password/database yok sayılır)",
			host: "Veritabanı sunucusu",
			port: "Veritabanı portu",
			user: "Veritabanı kullanıcısı",
			password: "Veritabanı şifresi (tercihen PGPASSWORD ortam değişkeniyle verin)",
			database: "Veritabanı adı",
			ssl: "SSL kullanımı: false, true ya da pg'nin ssl seçenekleri objesi",
			max: "Maksimum bağlantı sayısı",
			idleTimeoutMillis: "Boşta bekleme süresi (milisaniye)",
			connectionTimeoutMillis: "Bağlantı zaman aşımı süresi (milisaniye)",
		},
	},
	services: {
		__self: "Servis yapılandırmaları",
		axios: {
			__self: "Axios HTTP istemci yapılandırması",
			timeout: "İstek zaman aşımı süresi (milisaniye). Genel (global) ayardır, istemci bazında ezilebilir",
			userAgent: "User-Agent başlığı. false: başlık gönderilmez, metin: bu değer gönderilir",
		},
		redis: {
			__self: "Redis yapılandırması (env: REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB)",
			url: "Tam bağlantı adresi (verilirse host/port yok sayılır)",
			host: "Redis sunucusu",
			port: "Redis portu",
			password: "Redis şifresi",
			db: "Kullanılacak veritabanı indeksi",
			connectRetries: "İlk bağlantıda kaç deneme sonrası hata verileceği (bağlandıktan sonra sınırsız yeniden denenir)",
		},
		jobs: {
			__self: "Zamanlanmış işler (service.jobs)",
			shutdownTimeoutMs: "Kapanışta çalışan işlerin bekleneceği süre (milisaniye); sonra iptal sinyali gönderilir",
		},
		mail: {
			__self: "SMTP mail yapılandırması (env: MAIL_HOST, MAIL_PORT, MAIL_SECURE, MAIL_USERNAME, MAIL_PASSWORD, MAIL_FROM)",
			host: "SMTP sunucusu",
			port: "SMTP portu",
			secure: "TLS/SSL kullanılıp kullanılmayacağı",
			user: "SMTP kullanıcısı",
			password: "SMTP şifresi",
			from: "Varsayılan gönderen adresi",
			pool: "Bağlantı havuzu kullanılsın mı",
		},
		web: {
			__self: "Web sunucusu yapılandırması (env: WEB_HOST, WEB_PORT)",
			host: "Web sunucusu host adresi",
			port: "Web sunucusu portu",
			trustProxy: "Proxy başlıklarına (headers) güvenilip güvenilmeyeceği",
			bodyLimit: 'İstek gövdesi (JSON/text/raw/urlencoded) boyut sınırı. Örn: "100kb", "1mb"',
			shutdownTimeoutMs: "Kapanışta açık bağlantıların bekleneceği süre (milisaniye); sonra zorla kapatılır",
			cors: {
				__self: "CORS yapılandırması",
				allowedHeaders: "İzin verilen başlıklar (headers)",
				methods: "İzin verilen HTTP metodları",
				origin: 'İzin verilen kaynak(lar) (origin). "*" herkese açıktır; üretimde kendi alan adlarınızı yazın',
			},
			helmet: {
				__self: "Helmet güvenlik yapılandırması",
				contentSecurityPolicy: "Content-Security-Policy başlığı",
				xDownloadOptions: "X-Download-Options başlığı",
				xPoweredBy: "X-Powered-By başlığı",
			},
			secure: {
				__self: "Güvenlik yapılandırması (SSL/TLS)",
				enabled: "SSL/TLS'in etkin olup olmadığı",
				path: "SSL sertifika dizini. Göreli ise çalışma dizinine göre çözülür; mutlak yol da verilebilir",
				keyFile: "Özel anahtar dosyasının adı",
				certFile: "Sertifika dosyasının adı",
			},
			rateLimit: {
				__self: "Hız sınırlama (rate limiting) yapılandırması",
				enabled: "Hız sınırlama etkin mi",
				windowMs: "Hız sınırlaması için zaman penceresi (milisaniye)",
				limit: "Zaman penceresi içerisinde izin verilen maksimum istek sayısı",
				message: "Hız sınırı aşıldığında döndürülen hata mesajı",
			},
		},
	},
};

export default baseConfig;
