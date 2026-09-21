/** Yerel saat diliminde ISO benzeri tarih (sonunda Z yok). */
export function getLocalDate(date: Date = new Date()): string {
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
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

export default { getLocalDate, getLocalDay, unix, sleep };
