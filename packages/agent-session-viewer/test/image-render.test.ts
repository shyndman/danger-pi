import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Theme } from "@oh-my-pi/pi-coding-agent";
import { ImageProtocol, setTerminalImageProtocol } from "@oh-my-pi/pi-tui";
import { renderRows } from "../src/render";
import { loadViewerTheme } from "../src/theme";
import type { ViewerRow } from "../src/types";

const PNG_1X1_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xh6kAAAAASUVORK5CYII=";
let theme: Theme;
let tempDir: string;

beforeAll(async () => {
	theme = await loadViewerTheme();
});

afterEach(async () => {
	setTerminalImageProtocol(null);
	if (tempDir) {
		await fs.rm(tempDir, { recursive: true, force: true });
		tempDir = "";
	}
});

describe("image rendering", () => {
	it("renders kitty image sequences when bytes are available", async () => {
		setTerminalImageProtocol(ImageProtocol.Kitty);
		const rows: ViewerRow[] = [
			{
				kind: "tool",
				phase: "result",
				toolName: "generate_image",
				content: [{ type: "image", data: PNG_1X1_BASE64, mimeType: "image/png" }],
			},
		];
		const output = (await renderRows(rows, theme, 40)).join("\n");
		expect(output).toContain("\u001b_G");
	});

	it("falls back truthfully when image data or paths are missing", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-session-viewer-image-"));
		const missingPath = path.join(tempDir, "missing.png");
		const rows: ViewerRow[] = [
			{
				kind: "tool",
				phase: "result",
				toolName: "generate_image",
				content: [{ type: "image", path: missingPath }],
			},
		];
		const output = (await renderRows(rows, theme, 40)).join("\n");
		expect(output).toContain(`[image missing: ${missingPath}]`);
	});

	it("loads path-backed images when files still exist", async () => {
		setTerminalImageProtocol(ImageProtocol.Kitty);
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-session-viewer-image-"));
		const imagePath = path.join(tempDir, "image.png");
		await Bun.write(imagePath, Buffer.from(PNG_1X1_BASE64, "base64"));
		const rows: ViewerRow[] = [
			{
				kind: "tool",
				phase: "result",
				toolName: "generate_image",
				content: [{ type: "image", path: imagePath, mimeType: "image/png" }],
			},
		];
		const output = (await renderRows(rows, theme, 40)).join("\n");
		expect(output).toContain("\u001b_G");
	});
});
