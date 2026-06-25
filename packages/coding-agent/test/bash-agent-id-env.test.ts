import { describe, expect, it } from "bun:test";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BashTool } from "@oh-my-pi/pi-coding-agent/tools/bash";

function makeSession(agentId?: string): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		skills: [],
		getSessionFile: () => null,
		getAgentId: agentId === undefined ? undefined : () => agentId,
		settings: {
			get(key: string) {
				if (key === "async.enabled") return false;
				if (key === "bash.autoBackground.enabled") return false;
				if (key === "bash.autoBackground.thresholdMs") return 60_000;
				if (key === "bashInterceptor.enabled") return false;
				if (key === "bash.stripTrailingHeadTail") return false;
				if (key === "astGrep.enabled") return false;
				if (key === "astEdit.enabled") return false;
				if (key === "search.enabled") return false;
				if (key === "find.enabled") return false;
				return undefined;
			},
			getBashInterceptorRules() {
				return [];
			},
		},
		getClientBridge: () => undefined,
	} as unknown as ToolSession;
}

describe("BashTool OMP_AGENT_ID env", () => {
	it("exposes a nested subagent's tree-path id to the shell", async () => {
		const tool = new BashTool(makeSession("Main.Anna.Worker"));
		const result = await tool.execute("call-1", { command: 'printf "%s\\n" "$OMP_AGENT_ID"' });
		expect(result.content.find(c => c.type === "text")?.text ?? "").toContain("Main.Anna.Worker");
	});

	it("falls back to the root agent id when the session has no agent id", async () => {
		const tool = new BashTool(makeSession(undefined));
		const result = await tool.execute("call-2", { command: 'printf "%s\\n" "$OMP_AGENT_ID"' });
		expect(result.content.find(c => c.type === "text")?.text ?? "").toContain("Main");
	});

	it("overrides a model-supplied OMP_AGENT_ID so identity cannot be spoofed", async () => {
		const tool = new BashTool(makeSession("Main.Bob"));
		const result = await tool.execute("call-3", {
			command: 'printf "%s\\n" "$OMP_AGENT_ID"',
			env: { OMP_AGENT_ID: "spoofed" },
		});
		const text = result.content.find(c => c.type === "text")?.text ?? "";
		expect(text).toContain("Main.Bob");
		expect(text).not.toContain("spoofed");
	});
});
