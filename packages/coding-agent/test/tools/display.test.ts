import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { type SettingPath, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import {
	DISPLAY_COLOR_SWATCH_GAP_PX,
	DISPLAY_COLOR_SWATCH_MAX_COLUMNS,
	DISPLAY_COLOR_SWATCH_SIZE_PX,
} from "@oh-my-pi/pi-coding-agent/tools/display/constants";
import { createDisplayTool } from "@oh-my-pi/pi-coding-agent/tools/display/index";
import { PhotonImage } from "@oh-my-pi/pi-natives";
import { TempDir } from "@oh-my-pi/pi-utils";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2r8GQAAAAASUVORK5CYII=";

let tempDir: TempDir;

beforeAll(() => {
	tempDir = TempDir.createSync("@omp-display-test-");
});

afterAll(() => {
	tempDir.removeSync();
});

function createSettings(overrides: Partial<Record<SettingPath, unknown>> = {}): Settings {
	return Settings.isolated({
		"display.enabled": true,
		"display.enableImage": true,
		...overrides,
	});
}

function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
	return {
		cwd: tempDir.path(),
		hasUI: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: createSettings(),
		...overrides,
	};
}

function createTool(overrides: Partial<ToolSession> = {}) {
	const tool = createDisplayTool(createSession(overrides));
	expect(tool).toBeDefined();
	return tool!;
}

async function writeTinyPng(fileName: string): Promise<string> {
	const filePath = path.join(tempDir.path(), fileName);
	await Bun.write(filePath, Buffer.from(TINY_PNG_BASE64, "base64"));
	return filePath;
}

function toFileUri(filePath: string): string {
	return pathToFileURL(filePath).toString();
}

describe("display tool", () => {
	it("valid image file URI produces success report and draw intent", async () => {
		const imagePath = await writeTinyPng("ok.png");
		const tool = createTool();

		const result = await tool.execute("call-1", {
			type: "image",
			resources: [toFileUri(imagePath)],
		});

		expect(result.details?.error).toBeUndefined();
		expect(result.details?.report).toEqual([{ type: "image", uri: toFileUri(imagePath) }]);
		expect(result.details?.drawIntents?.length).toBe(1);
		expect(result.details?.drawIntents?.[0]?.kind).toBe("image");
		expect(result.details?.drawIntents?.[0]?.image.mimeType).toBe("image/png");
		expect(result.content[0]?.type).toBe("text");
	});

	it("success draw intent includes integer widthPx and heightPx greater than zero", async () => {
		const imagePath = await writeTinyPng("dims.png");
		const tool = createTool();

		const result = await tool.execute("call-2", {
			type: "image",
			resources: [toFileUri(imagePath)],
		});

		const image =
			result.details?.drawIntents?.[0]?.kind === "image" ? result.details.drawIntents[0].image : undefined;
		expect(image).toBeDefined();
		expect(Number.isInteger(image?.widthPx)).toBe(true);
		expect(Number.isInteger(image?.heightPx)).toBe(true);
		expect((image?.widthPx ?? 0) > 0).toBe(true);
		expect((image?.heightPx ?? 0) > 0).toBe(true);
	});

	it("invalid type returns invalid_type", async () => {
		const tool = createTool();
		const result = await tool.execute("call-3", { type: "text", resources: ["file:///tmp/test.png"] } as never);
		expect(result.details?.error?.code).toBe("invalid_type");
	});

	it("malformed resource URI records failure entry and call-level error", async () => {
		const tool = createTool();
		const result = await tool.execute("call-4", {
			type: "image",
			resources: ["not-a-uri"],
		});
		expect(result.details?.report?.[0]?.error).toContain("absolute URI");
		expect(result.details?.error?.code).toBe("render_failed");
	});

	it("unsupported URI scheme records per-resource failure", async () => {
		const tool = createTool();
		const result = await tool.execute("call-5", {
			type: "image",
			resources: ["ftp://example.com/img.png"],
		});
		expect(result.details?.report?.[0]?.error).toContain("Unsupported URI scheme: ftp");
		expect(result.details?.error?.code).toBe("render_failed");
	});

	it("missing file URI records resource_not_found-style failure message", async () => {
		const missingPath = path.join(tempDir.path(), "missing.png");
		const tool = createTool();
		const result = await tool.execute("call-6", {
			type: "image",
			resources: [toFileUri(missingPath)],
		});
		expect(result.details?.report?.[0]?.error).toContain("Resource file was not found");
		expect(result.details?.error?.code).toBe("render_failed");
	});

	it("mixed-success image batch keeps success and failure entries in input order", async () => {
		const imagePath = await writeTinyPng("mixed-ok.png");
		const okUri = toFileUri(imagePath);
		const badUri = "ftp://example.com/bad.png";
		const tool = createTool();

		const result = await tool.execute("call-7", {
			type: "image",
			resources: [okUri, badUri],
		});

		expect(result.details?.error).toBeUndefined();
		expect(result.details?.report).toEqual([
			{ type: "image", uri: okUri },
			{ type: "image", uri: badUri, error: "Unsupported URI scheme: ftp" },
		]);
		expect(result.details?.drawIntents?.length).toBe(1);
		expect(result.details?.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
	});

	it("all-failed call returns call-level error after full batch processing", async () => {
		const tool = createTool();
		const result = await tool.execute("call-8", {
			type: "image",
			resources: ["ftp://example.com/nope.png", "not-a-uri"],
		});
		expect(result.details?.error?.code).toBe("render_failed");
		expect(result.details?.summary).toEqual({ total: 2, succeeded: 0, failed: 2 });
		expect(result.details?.report?.length).toBe(2);
	});

	it("capability-disabled image call returns capability_disabled and setting key", async () => {
		const tool = createTool({ settings: createSettings({ "display.enableImage": false }) });
		const result = await tool.execute("call-9", {
			type: "image",
			resources: ["file:///tmp/test.png"],
		});
		expect(result.details?.error?.code).toBe("capability_disabled");
		expect(result.details?.error?.settingKey).toBe("display.enableImage");
	});

	it("summary text does not include base64 display payloads", async () => {
		const imagePath = await writeTinyPng("summary.png");
		const tool = createTool();
		const result = await tool.execute("call-10", {
			type: "image",
			resources: [toFileUri(imagePath)],
		});
		const textBlock = result.content.find(block => block.type === "text");
		const summaryText = textBlock?.type === "text" ? textBlock.text : "";
		expect(summaryText).toContain("Displayed 1 image resource(s); 0 failed.");
		expect(summaryText).not.toContain(TINY_PNG_BASE64.slice(0, 16));
		expect(summaryText).not.toContain(
			result.details?.drawIntents?.[0]?.kind === "image" ? result.details.drawIntents[0].image.data : "",
		);
	});

	it("duplicate resources produce independent report entries", async () => {
		const imagePath = await writeTinyPng("duplicate.png");
		const uri = toFileUri(imagePath);
		const tool = createTool();
		const result = await tool.execute("call-11", { type: "image", resources: [uri, uri] });
		expect(result.details?.report).toEqual([
			{ type: "image", uri },
			{ type: "image", uri },
		]);
		expect(result.details?.drawIntents?.length).toBe(2);
	});

	it("valid color resources render swatch draw intents while invalid ones report failures", async () => {
		const tool = createTool();
		const good = "data:text/plain,%20%23FF0000%20";
		const bad = "data:text/plain,%23ABC";
		const result = await tool.execute("call-12", { type: "color", resources: [good, bad] });
		expect(result.details?.error).toBeUndefined();
		expect(result.details?.report).toEqual([
			{ type: "color", uri: good },
			{ type: "color", uri: bad, error: "Color resources must contain exactly one canonical #RRGGBB value." },
		]);
		expect(result.details?.drawIntents?.length).toBe(1);
		const drawIntent = result.details?.drawIntents?.[0];
		expect(drawIntent?.kind).toBe("image");
		if (drawIntent?.kind === "image") {
			expect(drawIntent.image.mimeType).toBe("image/png");
			expect(drawIntent.image.widthPx).toBe(DISPLAY_COLOR_SWATCH_SIZE_PX);
			expect(drawIntent.image.heightPx).toBe(DISPLAY_COLOR_SWATCH_SIZE_PX);
			await expect(
				PhotonImage.parse(new Uint8Array(Buffer.from(drawIntent.image.data, "base64"))),
			).resolves.toBeDefined();
		}
	});

	it("multiple valid color resources render as one grid image with max 8 columns and 16px gaps", async () => {
		const tool = createTool();
		const resources = [
			"data:text/plain,%23FF0000",
			"data:text/plain,%2300FF00",
			"data:text/plain,%230000FF",
			"data:text/plain,%23FFFF00",
			"data:text/plain,%23FF00FF",
			"data:text/plain,%2300FFFF",
			"data:text/plain,%23ABCDEF",
			"data:text/plain,%23123456",
			"data:text/plain,%23654321",
			"data:text/plain,%230A0B0C",
		];
		const result = await tool.execute("call-12b", { type: "color", resources });
		expect(result.details?.error).toBeUndefined();
		expect(result.details?.report).toEqual(resources.map(uri => ({ type: "color", uri })));
		expect(result.details?.drawIntents?.length).toBe(1);
		expect(result.details?.summary).toEqual({ total: resources.length, succeeded: resources.length, failed: 0 });

		const drawIntent = result.details?.drawIntents?.[0];
		expect(drawIntent?.kind).toBe("image");
		if (drawIntent?.kind === "image") {
			const expectedColumns = DISPLAY_COLOR_SWATCH_MAX_COLUMNS;
			const expectedRows = Math.ceil(resources.length / expectedColumns);
			expect(drawIntent.image.widthPx).toBe(
				expectedColumns * DISPLAY_COLOR_SWATCH_SIZE_PX + (expectedColumns - 1) * DISPLAY_COLOR_SWATCH_GAP_PX,
			);
			expect(drawIntent.image.heightPx).toBe(
				expectedRows * DISPLAY_COLOR_SWATCH_SIZE_PX + (expectedRows - 1) * DISPLAY_COLOR_SWATCH_GAP_PX,
			);
			await expect(
				PhotonImage.parse(new Uint8Array(Buffer.from(drawIntent.image.data, "base64"))),
			).resolves.toBeDefined();
		}
	});

	it("all-invalid color resources return a call-level error after processing all resources", async () => {
		const tool = createTool();
		const result = await tool.execute("call-13", {
			type: "color",
			resources: ["data:text/plain,%23ABC", "data:text/plain,nope"],
		});
		expect(result.details?.error?.code).toBe("render_failed");
		expect(result.details?.report?.length).toBe(2);
		expect(result.details?.drawIntents?.length ?? 0).toBe(0);
	});

	it("display implementation stays isolated from read runtime helpers", async () => {
		const source = await fs.readFile(path.join(import.meta.dir, "../../src/tools/display/tool.ts"), "utf8");
		expect(source).not.toContain('from "./read"');
		expect(source).not.toContain('from "../tools/read"');
		expect(source).not.toContain('from "@oh-my-pi/pi-coding-agent/tools/read"');
	});
});
