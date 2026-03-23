import * as child_process from "node:child_process";
import * as path from "node:path";
import { WakaTimeCli } from "./wakatime-cli";
import { appendWakaTimeLog } from "./wakatime-log";

const DEBOUNCE_TIME_MS = 2000;
const WAKATIME_PLUGIN = "omp-coding-agent/1.0.0 pi-wakatime/1.0.0";

type HeartbeatParams = {
	isWrite?: boolean;
	lineChanges?: number;
	projectRoot?: string;
	category?: string;
};

export class WakaTimeHeartbeatSender {
	#cli = new WakaTimeCli();
	#lastHeartbeat = 0;
	#lastFile = "";

	async init(): Promise<void> {
		try {
			const location = await this.#cli.checkAndInstall();
			appendWakaTimeLog("heartbeat", `CLI ready: ${location}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			appendWakaTimeLog("heartbeat", `ERROR: CLI init failed - ${message}`);
			throw error;
		}
	}

	send(file: string, params: HeartbeatParams): void {
		const now = Date.now();
		const isSessionFile = file.endsWith(".omp-session");
		if (
			!params.isWrite &&
			!isSessionFile &&
			file === this.#lastFile &&
			now - this.#lastHeartbeat < DEBOUNCE_TIME_MS
		) {
			return;
		}

		const cliPath = this.#cli.getLocation();
		if (!cliPath) {
			appendWakaTimeLog("heartbeat", "ERROR: CLI path not found when attempting to send heartbeat");
			return;
		}

		this.#lastHeartbeat = now;
		this.#lastFile = file;

		const args = [
			"--entity",
			file,
			"--entity-type",
			"file",
			"--category",
			params.category ?? "coding",
			"--plugin",
			WAKATIME_PLUGIN,
		] as string[];

		if (params.projectRoot) {
			args.push("--project-folder", params.projectRoot);
		}

		if (params.isWrite) {
			args.push("--write");
		}

		if (params.lineChanges !== undefined) {
			args.push("--category", "ai coding", "--ai-line-changes", String(params.lineChanges));
		}

		child_process.execFile(cliPath, args, error => {
			if (!error) return;
			appendWakaTimeLog("heartbeat", `ERROR: ${path.basename(file)} - ${error.message}`);
		});
	}
}
