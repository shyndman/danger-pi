import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const WAKATIME_DIR = path.join(os.homedir(), ".wakatime");
export const WAKATIME_LOG_FILE = path.join(WAKATIME_DIR, "pi-wakatime.log");

export function appendWakaTimeLog(scope: string, message: string): void {
	const time = new Date().toISOString();
	const prefix = scope.length > 0 ? `[${scope}] ` : "";

	try {
		fs.mkdirSync(WAKATIME_DIR, { recursive: true });
		fs.appendFileSync(WAKATIME_LOG_FILE, `[${time}] ${prefix}${message}\n`);
	} catch {
		// Best-effort logging only.
	}
}
