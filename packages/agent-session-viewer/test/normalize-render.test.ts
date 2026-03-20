import { beforeAll, describe, expect, it } from "bun:test";
import type { SessionEntry, SessionHeader, Theme } from "@oh-my-pi/pi-coding-agent";
import { createNormalizeState, normalizeEntries } from "../src/normalize";
import { renderHeader, renderRows } from "../src/render";
import { loadViewerTheme } from "../src/theme";
import type { ToolRow } from "../src/types";

let theme: Theme;

type SessionMessageEntry = Extract<SessionEntry, { type: "message" }>;
type AssistantEntryMessage = Extract<SessionMessageEntry["message"], { role: "assistant" }>;

const sessionHeader: SessionHeader = {
	type: "session",
	id: "session-1",
	timestamp: "2026-03-15T00:00:00Z",
	cwd: "/repo/project",
	title: "agent-123.jsonl",
};

function createAssistantEntry(blocks: AssistantEntryMessage["content"], id: string = "assistant-1"): SessionEntry {
	return {
		type: "message",
		id,
		parentId: "user-1",
		timestamp: "2026-03-15T00:00:02Z",
		message: {
			role: "assistant",
			content: blocks,
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
}

function stripAnsi(text: string): string {
	return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function expectToolCallRow(row: unknown): ToolRow & { phase: "call" } {
	if (!row || typeof row !== "object") {
		throw new Error("expected tool row object");
	}
	const toolRow = row as ToolRow;
	if (toolRow.kind !== "tool" || toolRow.phase !== "call") {
		throw new Error(`expected tool call row, got ${JSON.stringify(toolRow)}`);
	}
	return toolRow as ToolRow & { phase: "call" };
}

beforeAll(async () => {
	theme = await loadViewerTheme();
});

describe("normalizeEntries + render", () => {
	it("normalizes explicit intent once and strips _i from displayed args", () => {
		const assistantEntry = createAssistantEntry([
			{
				type: "toolCall",
				id: "call-1",
				name: "read",
				intent: "Inspecting file",
				arguments: { _i: "legacy intent", path: "src/app.ts", limit: 20 },
			},
		]);
		const state = createNormalizeState("/tmp/agent-123.jsonl", false);
		const rows = normalizeEntries([assistantEntry], state, { phase: "initial" });
		const toolRow = expectToolCallRow(rows[0]);

		expect(toolRow.intent).toBe("Inspecting file");
		expect(toolRow.displayArgs).toEqual({ path: "src/app.ts", limit: 20 });
		expect(state.toolCalls.get("call-1")).toEqual({
			toolName: "read",
			intent: "Inspecting file",
			displayArgs: { path: "src/app.ts", limit: 20 },
		});
	});

	it("falls back to _i for older sessions without explicit intent", () => {
		const assistantEntry = createAssistantEntry([
			{ type: "toolCall", id: "call-1", name: "read", arguments: { _i: "Reading file", path: "src/app.ts" } },
		]);
		const state = createNormalizeState("/tmp/agent-123.jsonl", false);
		const rows = normalizeEntries([assistantEntry], state, { phase: "initial" });
		const toolRow = expectToolCallRow(rows[0]);

		expect(toolRow.intent).toBe("Reading file");
		expect(toolRow.displayArgs).toEqual({ path: "src/app.ts" });
	});

	it("renders header chrome, assistant thinking, and structured tool arguments", async () => {
		const assistantEntry = createAssistantEntry([
			{ type: "thinking", thinking: "considering options" },
			{ type: "text", text: "I will inspect the file." },
			{
				type: "toolCall",
				id: "call-1",
				name: "task",
				intent: "Updating callers",
				arguments: {
					agent: "task",
					config: { follow: true, label: "two words", emptyObject: {}, emptyArray: [] },
					tasks: [{ id: "RenameExport", description: "Rename export" }],
					notes: "first line\nsecond line",
					_i: "legacy intent",
				},
			},
		]);
		const state = createNormalizeState("/tmp/agent-123.jsonl", false);
		const rows = normalizeEntries([sessionHeader, assistantEntry], state, { phase: "initial" });
		const header = stripAnsi(renderHeader(state.header, theme).join("\n"));
		const output = stripAnsi((await renderRows(rows, theme, 120)).join("\n"));

		expect(header).toContain("agent-123");
		expect(header).toContain("snapshot");
		expect(header).toContain("/repo/project");
		expect(output).toContain("considering options");
		expect(output).toContain("I will inspect the file.");
		expect(output).toContain("task: Updating callers");
		expect(output).toContain("  agent: task");
		expect(output).toContain("  config:");
		expect(output).toContain("    follow: true");
		expect(output).toContain('    label: "two words"');
		expect(output).toContain("    emptyObject: {}");
		expect(output).toContain("    emptyArray: []");
		expect(output).toContain("  tasks:");
		expect(output).toContain("    - id: RenameExport");
		expect(output).toContain('      description: "Rename export"');
		expect(output).toContain("  notes: |");
		expect(output).toContain("    first line");
		expect(output).toContain("    second line");
		expect(output).not.toContain("_i");
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
		const output = stripAnsi((await renderRows(rows, theme, 48)).join("\n"));
		expect(output).toContain("thinking changed: high");
		expect(output).toContain("service tier changed: priority");
	});

	it("emits later tool results without rewriting earlier calls", async () => {
		const assistantEntry = createAssistantEntry([
			{
				type: "toolCall",
				id: "call-1",
				name: "read",
				intent: "Inspecting file",
				arguments: { path: "src/app.ts", limit: 20 },
			},
		]);
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
		const combined = stripAnsi(
			[...(await renderRows(initialRows, theme, 80)), ...(await renderRows(resultRows, theme, 80))].join("\n"),
		);
		expect(combined.match(/read/g)?.length).toBeGreaterThanOrEqual(2);
		expect(combined).toContain('"ok": true');
		expect(combined).not.toContain("unmatched tool result");
	});
});
