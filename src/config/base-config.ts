import type { ConfigSchema } from "./types";

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
			user: "sa",
			password: "sa",
			database: "",
			encrypt: false,
			trustServerCertificate: true,
			max: 20,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 5000,
		},
		postgres: {
			host: "localhost",
			port: 5432,
			user: "",
			password: "",
			database: "",
			max: 20,
			idleTimeoutMillis: 30000,
			connectionTimeoutMillis: 5000,
		},
	},
	services: {
		axios: {
			timeout: 60000,
		},
		redis: {
			url: "",
			host: "localhost",
			port: 6379,
			password: "",
			db: 0,
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
				path: "/ssl",
				keyFile: "private.key",
				certFile: "origin.key",
			},
			rateLimit: {
				windowMs: 60000,
				limit: 20,
				message: {
					error: "Too many requests, please try again later.",
				},
			},
		},
	},
};

export type BaseConfig = typeof baseConfig;

/** config.jsonc yorum satırlarını üreten açıklama şeması. */
export const baseConfigSchema: ConfigSchema<BaseConfig> = {
	dev: "Uygulamanın geliştirme (development) modunda çalışıp çalışmadığı",
	debug: "Hata ayıklama (debug) etiketleri. Örn: [\"Axios_Service\"] ya da [\"*\"]",
	database: {
		__self: "Veritabanı yapılandırması",
		provider: "Kullanılacak veritabanı: \"postgres\" veya \"mssql\"",
		prisma: {
			__self: "Prisma yapılandırması",
			clientPath: "Generated Prisma client'ın modül yolu",
		},
		mssql: {
			__self: "MSSQL veritabanı yapılandırması",
			host: "Veritabanı sunucusu",
			port: "Veritabanı portu",
			user: "Veritabanı kullanıcısı",
			password: "Veritabanı şifresi",
			database: "Veritabanı adı",
			encrypt: "Bağlantının şifrelenip şifrelenmeyeceği",
			trustServerCertificate: "Sunucu sertifikasına güvenilip güvenilmeyeceği",
			max: "Maksimum bağlantı sayısı",
			idleTimeoutMillis: "Boşta bekleme süresi (milisaniye)",
			connectionTimeoutMillis: "Bağlantı zaman aşımı süresi (milisaniye)",
		},
		postgres: {
			__self: "PostgreSQL veritabanı yapılandırması",
			host: "Veritabanı sunucusu",
			port: "Veritabanı portu",
			user: "Veritabanı kullanıcısı",
			password: "Veritabanı şifresi",
			database: "Veritabanı adı",
			max: "Maksimum bağlantı sayısı",
			idleTimeoutMillis: "Boşta bekleme süresi (milisaniye)",
			connectionTimeoutMillis: "Bağlantı zaman aşımı süresi (milisaniye)",
		},
	},
	services: {
		__self: "Servis yapılandırmaları",
		axios: {
			__self: "Axios HTTP istemci yapılandırması",
			timeout: "İstek zaman aşımı süresi (milisaniye). Genel (global) ayardır",
		},
		redis: {
			__self: "Redis yapılandırması",
			url: "Tam bağlantı adresi (verilirse host/port yok sayılır)",
			host: "Redis sunucusu",
			port: "Redis portu",
			password: "Redis şifresi",
			db: "Kullanılacak veritabanı indeksi",
		},
		mail: {
			__self: "SMTP mail yapılandırması",
			host: "SMTP sunucusu",
			port: "SMTP portu",
			secure: "TLS/SSL kullanılıp kullanılmayacağı",
			user: "SMTP kullanıcısı",
			password: "SMTP şifresi",
			from: "Varsayılan gönderen adresi",
			pool: "Bağlantı havuzu kullanılsın mı",
		},
		web: {
			__self: "Web sunucusu yapılandırması",
			host: "Web sunucusu host adresi",
			port: "Web sunucusu portu",
			trustProxy: "Proxy başlıklarına (headers) güvenilip güvenilmeyeceği",
			cors: {
				__self: "CORS yapılandırması",
				allowedHeaders: "İzin verilen başlıklar (headers)",
				methods: "İzin verilen HTTP metodları",
				origin: "İzin verilen kaynak(lar) (origin)",
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
				path: "SSL sertifika dizininin yolu",
				keyFile: "Özel anahtar dosyasının adı",
				certFile: "Sertifika dosyasının adı",
			},
			rateLimit: {
				__self: "Hız sınırlama (rate limiting) yapılandırması",
				windowMs: "Hız sınırlaması için zaman penceresi (milisaniye)",
				limit: "Zaman penceresi içerisinde izin verilen maksimum istek sayısı",
				message: {
					__self: "Hız sınırı aşıldığında döndürülen hata mesajı",
					error: "Hata mesajı metni",
				},
			},
		},
	},
};

export default baseConfig;
