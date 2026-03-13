import { describe, expect, it } from "bun:test";
import { getThemeByName } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { taskToolRenderer } from "../../src/task/render";
import type { TaskToolDetails } from "../../src/task/types";

describe("taskToolRenderer report_finding safety", () => {
	it("renders progress without crashing when report_finding payload is malformed", async () => {
		const theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;

		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 42,
			progress: [
				{
					index: 0,
					id: "1-Reviewer",
					agent: "reviewer",
					agentSource: "bundled",
					status: "running",
					task: "Review patch",
					recentTools: [],
					recentOutput: [],
					toolCount: 1,
					tokens: 0,
					durationMs: 42,
					extractedToolData: {
						report_finding: [{}],
					},
				},
			],
		};

		const rendered = taskToolRenderer.renderResult(
			{
				content: [{ type: "text", text: "" }],
				details,
			},
			{ expanded: false, isPartial: true },
			uiTheme,
		);

		expect(() => rendered.render(120)).not.toThrow();
	});

	it("renders abort reason inline for aborted subagent results", async () => {
		const theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;

		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [
				{
					index: 0,
					id: "1-Reviewer",
					agent: "reviewer",
					agentSource: "bundled",
					task: "Review patch",
					exitCode: 1,
					output: "",
					stderr: "",
					truncated: false,
					durationMs: 42,
					tokens: 0,
					aborted: true,
					abortReason: "blocked by permissions",
				},
			],
			totalDurationMs: 42,
		};

		const rendered = taskToolRenderer.renderResult(
			{
				content: [{ type: "text", text: "" }],
				details,
			},
			{ expanded: false, isPartial: false },
			uiTheme,
		);

		const lines = rendered.render(120);
		expect(lines.join("\n")).toContain("blocked by permissions");
	});

	it("renders progress agent URI with top-level-session OSC8 target", async () => {
		const theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;

		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [],
			totalDurationMs: 42,
			topLevelSessionId: "2026-03-13T11-16-53-228Z_top-session-123",
			progress: [
				{
					index: 0,
					id: "1-Reviewer",
					agent: "reviewer",
					agentSource: "bundled",
					status: "running",
					task: "Review patch",
					recentTools: [],
					recentOutput: [],
					toolCount: 0,
					tokens: 0,
					durationMs: 42,
				},
			],
		};

		const rendered = taskToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: true },
			uiTheme,
		);

		const output = rendered.render(120).join("\n");
		expect(output).toContain(
			"\x1b]8;;agent://2026-03-13T11-16-53-228Z_top-session-123/1-Reviewer\x07agent://1-Reviewer\x1b]8;;\x07",
		);
	});

	it("renders final-result agent URI with top-level-session OSC8 target", async () => {
		const theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;

		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [
				{
					index: 0,
					id: "1-Reviewer",
					agent: "reviewer",
					agentSource: "bundled",
					task: "Review patch",
					exitCode: 0,
					output: "ok",
					stderr: "",
					truncated: false,
					durationMs: 42,
					tokens: 0,
				},
			],
			totalDurationMs: 42,
			topLevelSessionId: "2026-03-13T11-16-53-228Z_top-session-123",
		};

		const rendered = taskToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: false },
			uiTheme,
		);

		const output = rendered.render(120).join("\n");
		expect(output).toContain(
			"\x1b]8;;agent://2026-03-13T11-16-53-228Z_top-session-123/1-Reviewer\x07agent://1-Reviewer\x1b]8;;\x07",
		);
	});

	it("falls back to plain agent URI when top-level session ID is missing", async () => {
		const theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;

		const details: TaskToolDetails = {
			projectAgentsDir: null,
			results: [
				{
					index: 0,
					id: "1-Reviewer",
					agent: "reviewer",
					agentSource: "bundled",
					task: "Review patch",
					exitCode: 0,
					output: "ok",
					stderr: "",
					truncated: false,
					durationMs: 42,
					tokens: 0,
				},
			],
			totalDurationMs: 42,
		};

		const rendered = taskToolRenderer.renderResult(
			{ content: [{ type: "text", text: "" }], details },
			{ expanded: false, isPartial: false },
			uiTheme,
		);

		const output = rendered.render(120).join("\n");
		expect(output).toContain("agent://1-Reviewer");
		expect(output).not.toContain("\x1b]8;;agent://");
	});
});
