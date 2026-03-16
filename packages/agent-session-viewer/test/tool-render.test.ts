import { beforeAll, describe, expect, it } from "bun:test";
import type { Theme } from "@oh-my-pi/pi-coding-agent";
import { renderRows } from "../src/render";
import { loadViewerTheme } from "../src/theme";
import type { ViewerRow } from "../src/types";

let theme: Theme;

beforeAll(async () => {
	theme = await loadViewerTheme();
});

describe("tool row rendering", () => {
	it("keeps args on one logical line and preserves persisted tool names", async () => {
		const rows: ViewerRow[] = [
			{
				kind: "tool",
				phase: "call",
				toolName: "generate_image",
				argsLine: JSON.stringify({ aspect_ratio: "16:9", image_size: "1536x1024" }),
				content: [],
			},
		];
		const output = (await renderRows(rows, theme, 80)).join("\n");
		expect(output).toContain("generate_image");
		expect(output).toContain('"aspect_ratio":"16:9"');
		expect(output).toContain('"image_size":"1536x1024"');
	});

	it("renders multiline structured output and dim no-output markers", async () => {
		const rows: ViewerRow[] = [
			{
				kind: "tool",
				phase: "result",
				toolName: "read",
				content: [{ type: "text", text: '{"items":[1,2],"nested":{"ok":true}}', variant: "normal" }],
			},
			{
				kind: "tool",
				phase: "result",
				toolName: "bash",
				content: [{ type: "text", text: "(no output)", variant: "dim" }],
			},
		];
		const output = (await renderRows(rows, theme, 24)).join("\n");
		expect(output).toContain('"nested": {');
		expect(output).toContain('"ok": true');
		expect(output).toContain("(no output)");
	});

	it("wraps user, assistant, args, and tool result text via shared wrapping", async () => {
		const rows: ViewerRow[] = [
			{
				kind: "user",
				content: [{ type: "text", text: "user content wraps across the terminal width", variant: "normal" }],
			},
			{
				kind: "assistant",
				content: [{ type: "text", text: "assistant thinking content wraps as well", variant: "thinking" }],
			},
			{
				kind: "tool",
				phase: "call",
				toolName: "read",
				argsLine: JSON.stringify({ long_argument_name: "this is a long wrapped argument payload" }),
				content: [],
			},
			{
				kind: "tool",
				phase: "result",
				toolName: "read",
				content: [{ type: "text", text: "tool result content also wraps cleanly here", variant: "normal" }],
			},
		];
		const lines = await renderRows(rows, theme, 18);
		expect(lines.filter(line => line.includes("wraps")).length).toBeGreaterThanOrEqual(3);
	});
});
