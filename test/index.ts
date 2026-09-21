/**
 * ============================================================
 *  ÖRNEK GİRİŞ NOKTASI (index.ts)
 * ============================================================
 * Bu dosya cagd-utilities'i KULLANAN bir projenin (api/agent vb.)
 * `src/index.ts` dosyası olarak birebir kopyalanmak üzere yazıldı.
 * Bu repoda (mssql/redis sunucusu ve generated Prisma client
 * olmadığı için) doğrudan çalışmaz — hedefi budur.
 *
 * Kullanılan servisler: Prisma (mssql provider) + Web (Express) + Redis.
 *
 *   1) Config    -> ilk açılışta config.jsonc yoksa oluşturur, hata fırlatmaz
 *   2) Router    -> /api/health, başlatılan servislerin durumunu döner
 *   3) Bootstrap -> servisleri sırayla başlatır, hata varsa süreci kapatır
 *   4) Shutdown  -> SIGTERM/SIGINT ve beklenmeyen hatalarda düzgün kapanış
 *
 * Yanındaki `cagd-utilities.d.ts` dosyasını da kopyala: `config.data`/`cfg`
 * ve `service.prisma.client`'ın (use() dönüşünü ayrı tutmadan, HER YERDE)
 * tam tipli/autocomplete'li olması için gerekli.
 */
import express, { type Router } from "express";
// Gerçek projede: `npx prisma generate` sonrası oluşan generated client.
import { PrismaClient } from "../prisma/generated/prisma/client";

import { baseConfig, baseConfigSchema, config, log, service } from "cagd-utilities";

// ------------------------------------------------------------------
// 1) CONFIG — uygulama açılışında EN BAŞTA, her şeyden önce tanımlanır.
//    config.jsonc yoksa otomatik oluşturulur, eksik alan varsa
//    tamamlanır; bu adım normal şartlarda asla throw etmez.
// ------------------------------------------------------------------
export const defaultConfig = {
	...baseConfig,
	database: {
		...baseConfig.database,
		provider: "mssql" as const,
	},
	app: {
		name: "example-service",
		version: 1,
	},
};

export const cfg = config.manager.setDefaultConfig(defaultConfig, {
	schema: baseConfigSchema, // config.jsonc açıklama satırları
	useFile: true, // config.jsonc oku/oluştur
	writeBack: true, // eksik alanları dosyaya geri yaz
});

// ------------------------------------------------------------------
// 2) ROUTER — başlatılan servislerin sağlık durumunu döner.
// ------------------------------------------------------------------
const healthRouter: Router = express.Router();

healthRouter.get("/health", async (_req, res) => {
	const status = await service.healthCheckAll();
	res.success({ data: status }); // createExpressApp() res.success/res.error ekler
});

// ------------------------------------------------------------------
// 3) SERVİSLERİ TANIMLA — henüz bağlanmaz, sadece kayıt/konfigürasyon.
// ------------------------------------------------------------------
function registerServices(): void {
	// Prisma: generated client'ı kaydet. Provider (mssql) config.database.provider'dan
	// okunur, adapter (@prisma/adapter-mssql) otomatik seçilir.
	service.prisma.use(PrismaClient);

	// Web: router'ları bağla (start() çağrılırken de verilebilir).
	service.web.configure({ routers: [["/api", healthRouter]] });
}

// ------------------------------------------------------------------
// 4) BOOTSTRAP — servisleri SIRAYLA başlatır. Biri hata verirse
//    diğerleri denenmez, hata yukarı fırlatılır (ilk açılışta net hata).
// ------------------------------------------------------------------
async function bootstrap(): Promise<void> {
	registerServices();

	await service.start("prisma", "redis", "web");

	// config.jsonc'i canlı izlemek istersen (opsiyonel):
	// config.manager.watch();

	log.info(`${cfg.app.name} v${cfg.app.version} ayakta -> http://${cfg.services.web.host}:${cfg.services.web.port}`);
}

// ------------------------------------------------------------------
// 5) GRACEFUL SHUTDOWN — SIGTERM/SIGINT (Docker stop, PM2, Ctrl+C) ve
//    beklenmeyen hatalar geldiğinde başlatılmış servisleri sırayla kapatır.
// ------------------------------------------------------------------
let shuttingDown = false;

async function shutdown(reason: string, exitCode: number): Promise<void> {
	if (shuttingDown) return; // aynı sinyal iki kez gelirse tekrar kapatmaya çalışma
	shuttingDown = true;

	log.warn(`${reason} alındı, servisler kapatılıyor...`);

	try {
		await service.stopAll(); // sadece start() edilmiş servisleri (prisma/redis/web) kapatır
		log.info("Tüm servisler düzgün kapatıldı.");
	} catch (err) {
		log.error("Servisler kapatılırken hata oluştu:", err);
	} finally {
		process.exit(exitCode);
	}
}

process.on("SIGTERM", () => void shutdown("SIGTERM", 0)); // örn. Docker stop / PM2 reload
process.on("SIGINT", () => void shutdown("SIGINT", 0)); // örn. terminalde Ctrl+C
process.on("uncaughtException", err => {
	log.error("uncaughtException:", err);
	void shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", reason => {
	log.error("unhandledRejection:", reason);
	void shutdown("unhandledRejection", 1);
});

// ------------------------------------------------------------------
// 6) ÇALIŞTIR — açılışta hata olursa net şekilde loglayıp süreci
//    kapat (process manager'ın restart edebilmesi için exit code 1).
// ------------------------------------------------------------------
bootstrap().catch(err => {
	log.error("Uygulama başlatılamadı:", err);
	process.exit(1);
});
