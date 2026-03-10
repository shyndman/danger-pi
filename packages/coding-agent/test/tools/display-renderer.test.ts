import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { getThemeByName } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { createDisplayTool, type DisplayToolDetails } from "@oh-my-pi/pi-coding-agent/tools/display/index";
import { displayToolRenderer } from "@oh-my-pi/pi-coding-agent/tools/display-renderer";
import { hookFetch } from "@oh-my-pi/pi-utils";

function createSession(): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({ "display.enabled": true, "display.enableImage": true }),
	};
}

describe("displayToolRenderer", () => {
	it("replays recorded details for collapsed and expanded views without re-fetching resources", async () => {
		const pngBytes = Buffer.from(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2r8GQAAAAASUVORK5CYII=",
			"base64",
		);
		let fetchCalls = 0;
		using _hook = hookFetch(input => {
			fetchCalls += 1;
			expect(String(input)).toBe("https://example.test/preview.png");
			return new Response(pngBytes, { headers: { "Content-Type": "image/png" } });
		});

		const tool = createDisplayTool(createSession());
		expect(tool).toBeDefined();
		const result = await tool!.execute("display-1", {
			type: "image",
			resources: ["https://example.test/preview.png"],
		});
		expect(fetchCalls).toBe(1);

		const theme = await getThemeByName("dark");
		expect(theme).toBeDefined();
		const uiTheme = theme!;
		const details = result.details as DisplayToolDetails;
		const collapsed = displayToolRenderer.renderResult(
			{ content: result.content, details, isError: false },
			{ expanded: false, isPartial: false },
			uiTheme,
			{ type: "image", resources: ["https://example.test/preview.png"] },
		);
		const expanded = displayToolRenderer.renderResult(
			{ content: result.content, details, isError: false },
			{ expanded: true, isPartial: false },
			uiTheme,
			{ type: "image", resources: ["https://example.test/preview.png"] },
		);

		expect(collapsed.render(120).join("\n")).toContain("draw intent");
		expect(expanded.render(120).join("\n")).toContain("draw intent");
		expect(fetchCalls).toBe(1);
	});
});
