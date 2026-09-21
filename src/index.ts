/**
 * ============================================================
 *  cagd-utilities
 * ============================================================
 * API, Agent vb. servislerin ortak kullandığı yardımcı katman.
 *
 *   import { config, service, services, util } from "cagd-utilities";
 *
 *   config.manager.setDefaultConfig(defaultConfig, { schema });
 *   config.data.services.web.port;          // değerler
 *
 *   service.prisma.use(PrismaClient);       // hazır servisler
 *   await service.web.start({ routers });
 *
 *   services.RedisService.getInstance();   // ham sınıflar
 *   util.date.getLocalDate();
 *   util.http.successResponse({ data });
 *
 * Her namespace alt yol (subpath) olarak da import edilebilir:
 *   import { prisma } from "cagd-utilities/service";
 */
import { config } from "./config";
import { baseConfig, baseConfigSchema } from "./config/base-config";

import * as service from "./service";
import * as services from "./services";
import * as util from "./util";

import { log } from "./util/logger";

// ------------------------------------------------------------------
// Namespace export'ları
// ------------------------------------------------------------------
export { config, service, services, util };

/** Config iskeleti — kendi defaultConfig'ini bunun üzerine kur. */
export { baseConfig, baseConfigSchema };

/** cagd-log varsa onu, yoksa console'u kullanan logger (util.log ile aynı). */
export { log };

// ------------------------------------------------------------------
// Tipler
// ------------------------------------------------------------------
export type { BaseConfig } from "./config/base-config";
export type { ConfigFacade, ConfigManagerApi } from "./config";
export type { ConfigChangeListener, ConfigInitOptions, ConfigSchema, DeepPartial, ResolvedConfig, UtilitiesConfig } from "./config/types";
export type { ServiceDefiner } from "./service";
export type { AxiosErrorCode, AxiosServiceOptions, DatabaseProvider, ExpressAppOptions, IDatabaseService, InterceptorError, PrismaClientConstructor, PrismaServiceOptions, WebServiceOptions } from "./services";
export type { ApiErrorResponse, ApiResponse, ApiSuccessResponse, ErrorOptions, SuccessOptions, Transaction } from "./util/http";
export type { Logger } from "./util/logger";

// ------------------------------------------------------------------
// Default export
// ------------------------------------------------------------------
const utilities = { config, service, services, util, log, baseConfig, baseConfigSchema };

export default utilities;
