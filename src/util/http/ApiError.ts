const DEFAULT_CODES: Record<number, string> = {
	400: "BAD_REQUEST",
	401: "UNAUTHORIZED",
	403: "FORBIDDEN",
	404: "NOT_FOUND",
	405: "METHOD_NOT_ALLOWED",
	409: "CONFLICT",
	413: "PAYLOAD_TOO_LARGE",
	415: "UNSUPPORTED_MEDIA_TYPE",
	422: "UNPROCESSABLE_ENTITY",
	429: "RATE_LIMITED",
	500: "INTERNAL_ERROR",
	502: "BAD_GATEWAY",
	503: "SERVICE_UNAVAILABLE",
	504: "GATEWAY_TIMEOUT",
};

/** HTTP durum kodu için standart hata kodu. Örn: 404 -> "NOT_FOUND". */
export function httpErrorCode(status: number): string {
	return DEFAULT_CODES[status] ?? `HTTP_${status}`;
}

/**
 * Router'lardan fırlatılabilen, standart cevap formatına çevrilen hata.
 * `createExpressApp()`'in hata handler'ı bunu tanır ve `res.error()` formatında döner:
 *
 *   throw new ApiError("Kullanıcı bulunamadı", 404);               // code: "NOT_FOUND"
 *   throw new ApiError("Geçersiz e-posta", 422, "INVALID_EMAIL", { field: "email" });
 *   throw ApiError.notFound("Kullanıcı bulunamadı");
 *
 * Express 4'te async handler'lardaki hatalar için `next(err)` çağır; Express 5 bunu kendisi yapar.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string | number;
	readonly data: any;

	constructor(message: string, status = 400, code?: string | number | null, data: any = null) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code ?? httpErrorCode(status);
		this.data = data;
	}

	static badRequest(message = "Bad Request", code?: string | number, data?: any): ApiError {
		return new ApiError(message, 400, code, data);
	}

	static unauthorized(message = "Unauthorized", code?: string | number, data?: any): ApiError {
		return new ApiError(message, 401, code, data);
	}

	static forbidden(message = "Forbidden", code?: string | number, data?: any): ApiError {
		return new ApiError(message, 403, code, data);
	}

	static notFound(message = "Not Found", code?: string | number, data?: any): ApiError {
		return new ApiError(message, 404, code, data);
	}

	static conflict(message = "Conflict", code?: string | number, data?: any): ApiError {
		return new ApiError(message, 409, code, data);
	}

	static internal(message = "Internal Server Error", code?: string | number, data?: any): ApiError {
		return new ApiError(message, 500, code, data);
	}
}

export default ApiError;
