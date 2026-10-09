/**
 * ============================================================
 *  ÖRNEK GİRİŞ NOKTASI (index.ts)
 * ============================================================
 * Bu dosya cagdu-utilities'i KULLANAN bir projenin (api/agent vb.)
 * `src/index.ts` dosyası olarak birebir kopyalanmak üzere yazıldı.
 * Bu repoda (veritabanı/redis sunucusu ve generated Prisma client
 * olmadığı için) doğrudan çalışmaz — hedefi budur. Tip kontrolü
 * `test/package.test.js` içinde yapılır.
 *
 * Kullanılan servisler: Prisma (mssql provider) + Web (Express) + Redis.
 *
 *   1) Config    -> ilk açılışta config.jsonc yoksa oluşturur, hata fırlatmaz
 *   2) Router    -> kendi endpoint'lerin + hazır /api/health
 *   3) Bootstrap -> servisleri sırayla başlatır; hata varsa başlatılanları
 *                   kapatıp süreci exit code 1 ile sonlandırır. SIGTERM/SIGINT
 *                   ve beklenmeyen hatalarda düzgün kapanışı da kurar.
 *
 * Yanındaki `cagdu-utilities.d.ts` dosyasını da kopyala: `config.data`/`cfg`
 * ve `service.prisma.client`'ın (use() dönüşünü ayrı tutmadan, HER YERDE)
 * tam tipli/autocomplete'li olması için gerekli.
 */
import express, { type Router } from "express";
// Gerçek projede: `npx prisma generate` sonrası oluşan generated client.
import { PrismaClient } from "../prisma/generated/prisma/client";

import { baseConfig, baseConfigSchema, config, log, service, util } from "cagdu-utilities";

const { ApiError } = util.http;

// ------------------------------------------------------------------
// 1) CONFIG — uygulama açılışında EN BAŞTA, her şeyden önce tanımlanır.
//    config.jsonc yoksa otomatik oluşturulur, eksik alan varsa
//    SADECE o alan eklenir (yorumların korunur); bu adım normal
//    şartlarda asla throw etmez. Şifreleri dosyaya yazmak yerine
//    ortam değişkeniyle ver (örn. MSSQL_PASSWORD, REDIS_PASSWORD).
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
	writeBack: true, // eksik alanları dosyaya ekle
});

// ------------------------------------------------------------------
// 2) ROUTER — kendi endpoint'lerin. Hatalar standart formatta döner.
// ------------------------------------------------------------------
const userRouter: Router = express.Router();

userRouter.get("/users/:id", async (req, res, next) => {
	try {
		const id = Number(req.params.id);
		if (!Number.isInteger(id)) throw ApiError.badRequest("Geçersiz id", "INVALID_ID");

		const user = await service.prisma.client.user.findUnique({ where: { id } });
		if (!user) throw ApiError.notFound("Kullanıcı bulunamadı");

		res.success({ data: user });
	} catch (err) {
		next(err); // createExpressApp'in hata handler'ı standart cevaba çevirir
	}
});

// ------------------------------------------------------------------
// 3) SERVİSLERİ TANIMLA ve BAŞLAT
// ------------------------------------------------------------------
// Prisma: generated client'ı kaydet. Provider (mssql) config.database.provider'dan
// okunur, adapter (@prisma/adapter-mssql) otomatik seçilir.
service.prisma.use(PrismaClient);

// Web: router'ları bağla. /api/health -> başlatılan servislerin durumu (hepsi sağlıklı değilse 503).
service.web.configure({
	routers: [
		["/api", userRouter],
		["/api", util.http.healthRouter()],
	],
});

// Sırayla başlatır (web en son: bağımlılıklar hazır olmadan istek kabul etmez),
// SIGTERM/SIGINT/uncaughtException/unhandledRejection'da tersi sırayla kapatır.
void service
	.bootstrap(["prisma", "redis", "web"], {
		signals: {
			onShutdown: reason => log.info(`${cfg.app.name}: kapanıyor (${reason})`),
		},
	})
	.then(() => {
		if (service.web.started) log.info(`${cfg.app.name} v${cfg.app.version} ayakta -> http://${cfg.services.web.host}:${cfg.services.web.port}`);
	});

// config.jsonc'i canlı izlemek istersen (opsiyonel):
// config.manager.watch();
