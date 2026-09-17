export function getLocalDate(date: Date = new Date()): string {
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, -1);
}

export function getLocalDay(date: Date = new Date()): string {
	return getLocalDate(date).slice(0, 10);
}

export function unix(date: Date = new Date()): number {
	return Math.floor(date.getTime() / 1000);
}

export default { getLocalDate, getLocalDay, unix };