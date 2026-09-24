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
 *
 * ORTAK KURALLAR (tüm servisler):
 *  - Bağlantı/pool LAZY kurulur; sadece getInstance() bağlantı açmaz.
 *  - connect() ve close() idempotent'tir (tekrar çağrılabilir).
 *  - close() hem kaynağı hem singleton örneğini null'lar (temiz yeniden başlatma).
 *  - healthCheck() asla throw etmez; hata olursa `log.warn` ile loglar ve false döner.
 */
export interface IDatabaseService<TMeta = unknown> {
	getPoolConfig(): object;
	connect(): Promise<void>;
	query<T = any>(text: string, params?: any[]): Promise<T[]>;
	// T, alt sınıfların kendi meta tiplerini generic yapabilmesi için imzada tutuluyor.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	queryWithMeta<T extends Record<string, any> = any>(text: string, params?: any[]): Promise<TMeta>;
	healthCheck(): Promise<boolean>;
	close(): Promise<void>;
}

export abstract class BaseService<TMeta = unknown> implements IDatabaseService<TMeta> {
	abstract getPoolConfig(): object;
	/** Bağlantıyı kurar ve doğrular. Başarısızsa hata fırlatır. */
	abstract connect(): Promise<void>;
	abstract query<T = any>(text: string, params?: any[]): Promise<T[]>;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	abstract queryWithMeta<T extends Record<string, any> = any>(text: string, params?: any[]): Promise<TMeta>;
	abstract healthCheck(): Promise<boolean>;
	abstract close(): Promise<void>;
}

export default BaseService;
