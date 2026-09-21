/**
 * Tüm database servislerinin uyması gereken ortak sözleşme.
 *
 * NOT 1: getInstance() burada YOK. Static metodlar TypeScript interface'lerinde
 * zorunlu kılınamaz (her sınıf singleton'ını kendi static getInstance()'ı ile
 * yönetir, bkz. PostgresService / MssqlService). Yeni bir servis eklerken
 * bu deseni _template.Service.ts referans alarak kopyala.
 *
 * NOT 2: queryWithMeta'nın dönüş tipi generic `TMeta` olarak bırakıldı.
 * Sebep: pg'nin QueryResult<T> ile mssql'in IResult<T> tipleri birbirinden
 * farklı (rowCount, command, recordset vs. alanları uyuşmuyor). Her servis
 * kendi sürücüsünün native meta tipini TMeta olarak sağlar.
 */
export interface IDatabaseService<TMeta = unknown> {
	getPoolConfig(): Object;
	query<T = any>(text: string, params?: any[]): Promise<T[]>;
	queryWithMeta<T extends Record<string, any> = any>(text: string, params?: any[]): Promise<TMeta>;
	healthCheck(): Promise<boolean>;
	close(): Promise<void>;
}

export abstract class BaseService<TMeta = unknown> implements IDatabaseService<TMeta> {
	abstract getPoolConfig(): Object;
	abstract query<T = any>(text: string, params?: any[]): Promise<T[]>;
	abstract queryWithMeta<T extends Record<string, any> = any>(text: string, params?: any[]): Promise<TMeta>;
	abstract healthCheck(): Promise<boolean>;
	abstract close(): Promise<void>;
}

export default BaseService;
