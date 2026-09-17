/** Genel yardımcılar. */
import * as date from "./date";

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

export { date, sleep };
export { log, setLogger } from "./logger";
export type { Logger } from "./logger";