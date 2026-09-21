import type { NextFunction, Request, Response as ExpressResponse } from "express";

export interface Transaction {
	date: string;
	duration_ms: number | null;
	request_id: string | null;
}

export interface ApiSuccessResponse<T = any> {
	error: false;
	message: string;
	data: T;
	transaction: Transaction;
}

export interface ApiErrorResponse {
	error: true;
	message: string;
	code: string | number | null;
	data: any;
	transaction: Transaction;
}

export type ApiResponse<T = any> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface BuildTransactionOptions {
	startTime?: number | null;
	requestId?: string | null;
}

function buildTransaction({ startTime = null, requestId = null }: BuildTransactionOptions = {}): Transaction {
	return {
		date: new Date().toISOString(),
		duration_ms: startTime ? Date.now() - startTime : null,
		request_id: requestId,
	};
}

export interface SuccessOptions<T = any> extends BuildTransactionOptions {
	data?: T;
	message?: string;
}

export function successResponse<T = any>({ data = null as unknown as T, message = "Success", startTime = null, requestId = null }: SuccessOptions<T> = {}): ApiSuccessResponse<T> {
	return {
		error: false,
		message,
		data,
		transaction: buildTransaction({ startTime, requestId }),
	};
}

export interface ErrorOptions extends BuildTransactionOptions {
	message?: string;
	data?: any;
	code?: string | number | null;
}

export function errorResponse({ message = "An error occurred", data = null, code = null, startTime = null, requestId = null }: ErrorOptions = {}): ApiErrorResponse {
	return {
		error: true,
		message,
		code,
		data,
		transaction: buildTransaction({ startTime, requestId }),
	};
}

declare global {
	namespace Express {
		interface Response {
			success: <T = any>(options?: SuccessOptions<T>, statusCode?: number) => ExpressResponse;
			error: (options?: ErrorOptions, statusCode?: number) => ExpressResponse;
		}
	}
}

/** res.success() / res.error() helper'larını ekler. */
export function responserMiddleware(req: Request, res: ExpressResponse, next: NextFunction): void {
	const startTime = Date.now();
	const requestId = (req.headers["x-request-id"] as string) || null;

	res.success = <T = any>(options: SuccessOptions<T> = {}, statusCode = 200) => res.status(statusCode).json(successResponse<T>({ ...options, startTime, requestId }));

	res.error = (options: ErrorOptions = {}, statusCode = 400) => res.status(statusCode).json(errorResponse({ ...options, startTime, requestId }));

	next();
}

export default responserMiddleware;
