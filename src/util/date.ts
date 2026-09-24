/**
 * TARİH STANDARDI
 *  - Makineler arası (API cevabı, log, veritabanı) zaman damgaları: UTC ISO 8601 (`...Z`),
 *    yani `new Date().toISOString()`. `util.http` cevaplarındaki `transaction.date` böyledir.
 *  - Yerel saat gerekiyorsa ofsetli ISO kullan: `getLocalISO()` -> "2026-09-24T11:30:00.000+03:00".
 *  - `getLocalDate()` ofset içermez; sadece gösterim/dosya adı gibi yerlerde kullan.
 */

const pad = (n: number): string => String(n).padStart(2, "0");

/** Yerel saat diliminde ISO benzeri tarih (sonunda Z ve ofset YOK). Sadece gösterim amaçlı. */
export function getLocalDate(date: Date = new Date()): string {
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

/** Yerel saat, ofsetli ISO 8601: "2026-09-24T11:30:00.000+03:00". */
export function getLocalISO(date: Date = new Date()): string {
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const abs = Math.abs(offset);
	return `${getLocalDate(date)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "YYYY-MM-DD" biçiminde yerel tarih. */
export function getLocalDay(date: Date = new Date()): string {
	return getLocalDate(date).slice(0, 10);
}

/** Unix timestamp (saniye). */
export function unix(date: Date = new Date()): number {
	return Math.floor(date.getTime() / 1000);
}

/** ms cinsinden bekleme. */
export function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export default { getLocalDate, getLocalISO, getLocalDay, unix, sleep };
