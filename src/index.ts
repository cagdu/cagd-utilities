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
 *   service.web.configure({ routers });
 *   await service.bootstrap(["prisma", "web"]);
 *
 *   services.RedisService.getInstance();   // ham sınıflar (`classes` ile aynı)
 *   util.date.getLocalISO();
 *   util.http.successResponse({ data });
 *
 * Her namespace alt yol (subpath) olarak da import edilebilir:
 *   import { prisma } from "cagd-utilities/service";
 */
import { config } from "./config";
import { baseConfig, baseConfigEnv, baseConfigSchema } from "./config/base-config";

import * as service from "./service";
import * as services from "./services";
import * as util from "./util";

import { log } from "./util/logger";

// ------------------------------------------------------------------
// Namespace export'ları
// ------------------------------------------------------------------
export { config, service, services, util };

/** `services` için ayırt edici alias: ham sınıflar. (`service` = hazır örnekler, `classes` = sınıflar) */
export { services as classes };

/** Config iskeleti — kendi defaultConfig'ini bunun üzerine kur. */
export { baseConfig, baseConfigEnv, baseConfigSchema };

/** cagd-log varsa onu, yoksa console'u kullanan logger (util.log ile aynı). */
export { log };

// ------------------------------------------------------------------
// Tipler
// ------------------------------------------------------------------
export type { BaseConfig } from "./config/base-config";
export type { ConfigFacade, ConfigManagerApi } from "./config";
export type { ConfigChangeListener, ConfigEnvMap, ConfigInitOptions, ConfigSchema, DeepPartial, ResolvedConfig, UtilitiesConfig } from "./config/types";
export type { BootstrapOptions, ServiceDefiner, ServiceName, ShutdownOptions } from "./service";
export type {
	AxiosErrorCode,
	AxiosServiceError,
	AxiosServiceOptions,
	DatabaseProvider,
	ExpressAppOptions,
	IDatabaseService,
	InterceptorError,
	PrismaClientConstructor,
	PrismaServiceOptions,
	RegisteredPrismaClient,
	WebServiceOptions,
} from "./services";
export type { ApiError } from "./util/http";
export type { ApiErrorResponse, ApiResponse, ApiSuccessResponse, ErrorOptions, HealthRouterOptions, SuccessOptions, Transaction } from "./util/http";
export type { Logger } from "./util/logger";

// ------------------------------------------------------------------
// Default export
// ------------------------------------------------------------------
const utilities = { config, service, services, classes: services, util, log, baseConfig, baseConfigEnv, baseConfigSchema };

export default utilities;
