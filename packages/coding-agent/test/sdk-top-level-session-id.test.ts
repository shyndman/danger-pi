import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { Snowflake } from "@oh-my-pi/pi-utils";

function buildSessionOptions(tempDir: string, sessionManager: SessionManager) {
	return {
		cwd: tempDir,
		agentDir: tempDir,
		sessionManager,
		settings: Settings.isolated(),
		disableExtensionDiscovery: true,
		skills: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		enableMCP: false,
		enableLsp: false,
	};
}

function getTaskToolTopLevelSessionId(session: AgentSession): string | null {
	const taskTool = session.getToolByName("task");
	expect(taskTool).toBeDefined();

	const toolSession = Reflect.get(taskTool!, "session") as { getTopLevelSessionId?: () => string | null } | undefined;
	expect(toolSession?.getTopLevelSessionId).toBeDefined();
	return toolSession?.getTopLevelSessionId?.() ?? null;
}

describe("createAgentSession top-level task session token", () => {
	let tempDir: string;
	const sessions: AgentSession[] = [];

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `pi-sdk-top-level-session-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
	});

	afterEach(async () => {
		for (const session of sessions.splice(0)) {
			await session.dispose();
		}
		if (tempDir) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("uses the persisted session file basename for task hyperlinks", async () => {
		const sessionManager = SessionManager.create(tempDir, path.join(tempDir, "sessions"));
		const sessionFile = sessionManager.getSessionFile();
		expect(sessionFile).toBeDefined();
		const expectedToken = path.basename(sessionFile!, ".jsonl");

		const { session } = await createAgentSession(buildSessionOptions(tempDir, sessionManager));
		sessions.push(session);

		expect(getTaskToolTopLevelSessionId(session)).toBe(expectedToken);
	});

	it("falls back to the bare session id when no session file exists", async () => {
		const sessionManager = SessionManager.inMemory(tempDir);
		const expectedToken = sessionManager.getSessionId();

		const { session } = await createAgentSession(buildSessionOptions(tempDir, sessionManager));
		sessions.push(session);

		expect(getTaskToolTopLevelSessionId(session)).toBe(expectedToken);
	});
});
