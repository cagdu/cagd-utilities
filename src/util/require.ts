import path from "node:path";

/**
 * Bir modülü ÖNCE tüketici uygulamanın dizininden (`process.cwd()`), bulunamazsa
 * bu paketin kendi konumundan yükler.
 *
 * Neden: opsiyonel paketler (`@prisma/client`, `@prisma/adapter-*`, `cagd-log`)
 * tüketici projede kuruludur. Paket `npm link` ile bağlandığında normal `require()`
 * bu paketin gerçek dizininden yukarı arar ve onları bulamaz.
 *
 * Göreli yollar ("./prisma/generated/...") çalışma dizinine göre çözülür.
 */
export function requireFromApp<T = any>(id: string): T {
	const request = id.startsWith(".") ? path.resolve(process.cwd(), id) : id;
	let resolved: string | null = null;
	try {
		resolved = require.resolve(request, { paths: [process.cwd()] });
	} catch {
		/* uygulama dizininde yok, paketin kendi konumundan dene */
	}
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require(resolved ?? request) as T;
}
