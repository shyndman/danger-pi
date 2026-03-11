import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { ToolExecutionComponent } from "@oh-my-pi/pi-coding-agent/modes/components/tool-execution";
import { getThemeByName, setThemeInstance } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { DisplayToolDetails } from "@oh-my-pi/pi-coding-agent/tools/display";
import type { TUI } from "@oh-my-pi/pi-tui";
import { getCellDimensions, ImageProtocol, setCellDimensions, TERMINAL } from "@oh-my-pi/pi-tui/terminal-capabilities";

type MutableTerminalInfo = {
	imageProtocol: ImageProtocol | null;
};

const terminal = TERMINAL as unknown as MutableTerminalInfo;
const BASE64_DUMMY = "AA==";

function parseKittyParam(output: string, key: "c" | "r"): number | null {
	const match = output.match(new RegExp(`${key}=(\\d+)`));
	if (!match) return null;
	return Number.parseInt(match[1], 10);
}

function renderDisplayReplayImage(widthPx: number, heightPx: number): string {
	const ui = { requestRender: () => {} } as unknown as TUI;
	const component = new ToolExecutionComponent(
		"display",
		{ type: "image", resources: ["file:///swatch.png"] },
		{},
		undefined,
		ui,
	);
	const details: DisplayToolDetails = {
		drawIntents: [
			{
				kind: "image",
				type: "image",
				uri: "file:///swatch.png",
				image: { data: BASE64_DUMMY, mimeType: "image/png", widthPx, heightPx },
			},
		],
	};

	component.updateResult({ content: [], details }, false);
	return component.render(120).join("\n");
}

describe("ToolExecutionComponent display replay image sizing", () => {
	const originalProtocol = TERMINAL.imageProtocol;
	let originalCellDimensions = { ...getCellDimensions() };

	beforeAll(async () => {
		const theme = await getThemeByName("dark");
		if (!theme) throw new Error("Failed to load dark theme for tests");
		setThemeInstance(theme);
	});

	afterEach(() => {
		terminal.imageProtocol = originalProtocol;
		setCellDimensions({ ...originalCellDimensions });
	});

	it("relies on shared Kitty sizing to avoid upscaling small display replay images", () => {
		originalCellDimensions = { ...getCellDimensions() };
		setCellDimensions({ widthPx: 10, heightPx: 20 });
		terminal.imageProtocol = ImageProtocol.Kitty;

		const output = renderDisplayReplayImage(64, 32);

		expect(parseKittyParam(output, "c")).toBeNull();
		expect(parseKittyParam(output, "r")).toBe(1);
	});

	it("keeps the existing 60-cell cap for larger display replay images via shared sizing", () => {
		originalCellDimensions = { ...getCellDimensions() };
		setCellDimensions({ widthPx: 10, heightPx: 20 });
		terminal.imageProtocol = ImageProtocol.Kitty;

		const output = renderDisplayReplayImage(1200, 600);

		expect(parseKittyParam(output, "c")).toBe(60);
		expect(parseKittyParam(output, "r")).toBeNull();
	});
});
