import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionFactory } from "../../extensibility/extensions";
import { WakaTimeHeartbeatSender } from "./wakatime-heartbeat";
import { appendWakaTimeLog, WAKATIME_LOG_FILE } from "./wakatime-log";

const MAX_LOG_LINES = 5000;

type ExtensionInput = Record<string, unknown> & {
	path?: unknown;
	content?: unknown;
	old_text?: unknown;
	new_text?: unknown;
	oldText?: unknown;
	newText?: unknown;
};

export function createWakaTimeExtension(): ExtensionFactory {
	return api => {
		rotateWakaTimeLog();

		const sender = new WakaTimeHeartbeatSender();
		let initialized = false;
		const initPromise = sender
			.init()
			.then(() => {
				initialized = true;
			})
			.catch(error => {
				appendWakaTimeLog(
					"index",
					`Failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
				);
			});

		api.on("tool_result", async (event, ctx) => {
			if (event.isError || !isTrackedToolName(event.toolName)) return;
			if (!initialized) await initPromise;

			const filePath = resolveInputPath(event.input, ctx.cwd);
			if (!filePath) return;

			if (event.toolName === "read") {
				sender.send(filePath, {
					projectRoot: ctx.cwd,
					category: "ai coding",
				});
				return;
			}

			if (event.toolName === "write") {
				sender.send(filePath, {
					projectRoot: ctx.cwd,
					isWrite: true,
					lineChanges: countStringLines((event.input as ExtensionInput).content),
					category: "ai coding",
				});
				return;
			}

			const lineChanges = calculateEditLineChanges(event.input as ExtensionInput);
			sender.send(filePath, {
				projectRoot: ctx.cwd,
				isWrite: true,
				lineChanges,
				category: "ai coding",
			});
		});

		api.on("turn_start", async (_event, ctx) => {
			if (!initialized) await initPromise;
			sender.send(path.join(ctx.cwd, ".omp-session"), {
				projectRoot: ctx.cwd,
				category: "ai coding",
			});
		});
	};
}

function rotateWakaTimeLog(): void {
	try {
		if (!fs.existsSync(WAKATIME_LOG_FILE)) return;

		const stats = fs.statSync(WAKATIME_LOG_FILE);
		if (stats.size < 500 * 1024) return;

		const lines = fs.readFileSync(WAKATIME_LOG_FILE, "utf-8").split("\n");
		if (lines.length <= MAX_LOG_LINES) return;

		fs.writeFileSync(WAKATIME_LOG_FILE, lines.slice(-MAX_LOG_LINES).join("\n"));
	} catch {
		// Best-effort log rotation only.
	}
}

function isTrackedToolName(toolName: string): toolName is "read" | "write" | "edit" {
	return toolName === "read" || toolName === "write" || toolName === "edit";
}

function resolveInputPath(input: Record<string, unknown>, cwd: string): string | undefined {
	const filePath = typeof input.path === "string" ? input.path : undefined;
	if (!filePath) return undefined;
	return path.resolve(cwd, filePath);
}

function countStringLines(value: unknown): number {
	return typeof value === "string" ? value.split("\n").length : 0;
}

function calculateEditLineChanges(input: ExtensionInput): number {
	const newLines = countStringLines(input.new_text ?? input.newText);
	const oldLines = countStringLines(input.old_text ?? input.oldText);
	return Math.abs(newLines - oldLines);
}
