import { beforeAll, describe, expect, it } from "bun:test";
import type { SessionEntry, SessionHeader, Theme } from "@oh-my-pi/pi-coding-agent";
import { createNormalizeState, normalizeEntries } from "../src/normalize";
import { renderHeader, renderRows } from "../src/render";
import { loadViewerTheme } from "../src/theme";

let theme: Theme;

const sessionHeader: SessionHeader = {
	type: "session",
	id: "session-1",
	timestamp: "2026-03-15T00:00:00Z",
	cwd: "/repo/project",
	title: "agent-123.jsonl",
};

const assistantEntry: SessionEntry = {
	type: "message",
	id: "assistant-1",
	parentId: "user-1",
	timestamp: "2026-03-15T00:00:02Z",
	message: {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "considering options" },
			{ type: "text", text: "I will inspect the file." },
			{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/app.ts", limit: 20 } },
		],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp: 2,
	},
};

beforeAll(async () => {
	theme = await loadViewerTheme();
});

describe("normalizeEntries + render", () => {
	it("renders header chrome, assistant thinking, and tool rows", async () => {
		const state = createNormalizeState("/tmp/agent-123.jsonl", false);
		const rows = normalizeEntries([sessionHeader, assistantEntry], state, { phase: "initial" });
		const header = renderHeader(state.header, theme).join("\n");
		const output = (await renderRows(rows, theme, 48)).join("\n");

		expect(header).toContain("agent-123");
		expect(header).toContain("snapshot");
		expect(header).toContain("/repo/project");
		expect(output).toContain("considering options");
		expect(output).toContain("I will inspect the file.");
		expect(output).toContain("read");
		expect(output).toContain('"path":"src/app.ts"');
		expect(output).toContain("\u001b[");
	});

	it("emits follow-mode metadata changes as notice rows", async () => {
		const state = createNormalizeState("/tmp/agent-123.jsonl", true);
		normalizeEntries(
			[sessionHeader, { type: "model_change", id: "m1", parentId: null, timestamp: "t", model: "openai/gpt-5" }],
			state,
			{ phase: "initial" },
		);
		state.hasRendered = true;
		const rows = normalizeEntries(
			[
				{ type: "thinking_level_change", id: "t1", parentId: "m1", timestamp: "t", thinkingLevel: "high" },
				{ type: "service_tier_change", id: "s1", parentId: "t1", timestamp: "t", serviceTier: "priority" },
			],
			state,
			{ phase: "follow" },
		);
		const output = (await renderRows(rows, theme, 48)).join("\n");
		expect(output).toContain("thinking changed: high");
		expect(output).toContain("service tier changed: priority");
	});

	it("emits later tool results without rewriting earlier calls", async () => {
		const state = createNormalizeState("/tmp/agent-123.jsonl", true);
		const initialRows = normalizeEntries([assistantEntry], state, { phase: "initial" });
		state.hasRendered = true;
		const resultRows = normalizeEntries(
			[
				{
					type: "message",
					id: "tool-1",
					parentId: "assistant-1",
					timestamp: "2026-03-15T00:00:03Z",
					message: {
						role: "toolResult",
						toolCallId: "call-1",
						toolName: "read",
						content: [{ type: "text", text: '{"ok":true,"items":[1,2]}' }],
						isError: false,
						timestamp: 3,
					},
				},
			],
			state,
			{ phase: "follow" },
		);
		const combined = [
			...(await renderRows(initialRows, theme, 48)),
			...(await renderRows(resultRows, theme, 48)),
		].join("\n");
		expect(combined.match(/read/g)?.length).toBeGreaterThanOrEqual(2);
		expect(combined).toContain('"ok": true');
		expect(combined).not.toContain("unmatched tool result");
	});
});
