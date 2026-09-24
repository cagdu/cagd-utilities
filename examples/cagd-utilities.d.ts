/**
 * ============================================================
 *  cagd-utilities İÇİN TİP GENİŞLETME (declaration merging)
 * ============================================================
 * Bu dosya, `index.ts`'in yanına KOPYALANMAK üzere yazıldı. Amacı:
 *
 *   1) `config.data` / `cfg` -> senin defaultConfig'ini (app dahil) göstersin.
 *   2) `service.prisma.client` -> `.use()` dönüşünü ayrı bir değişkende
 *      tutmadan, HER YERDE generated PrismaClient'ın tam tipini göstersin.
 *
 * Olmadan da çalışır (o zaman `service.prisma.use(PrismaClient)`'in dönüşünü
 * `const prisma = service.prisma.use(PrismaClient)` şeklinde yakalayıp
 * `prisma.client...` kullanman gerekir) — ama bu dosya global autocomplete verir.
 */
import type { PrismaClient } from "../prisma/generated/prisma/client";
import type { defaultConfig } from "./index";

type DefaultConfigType = typeof defaultConfig;

declare module "cagd-utilities" {
	interface UtilitiesConfig extends DefaultConfigType {}
	interface RegisteredPrismaClient extends PrismaClient {}
}
