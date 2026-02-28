import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { type SettingPath, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { DisplayTool } from "@oh-my-pi/pi-coding-agent/tools/display";
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
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: createSettings(),
		...overrides,
	};
}

async function writeTinyPng(fileName: string): Promise<string> {
	const filePath = path.join(tempDir.path(), fileName);
	await Bun.write(filePath, Buffer.from(TINY_PNG_BASE64, "base64"));
	return filePath;
}

function toFileUri(filePath: string): string {
	return pathToFileURL(filePath).toString();
}

describe("DisplayTool", () => {
	it("valid image file URI produces success and details.images entry", async () => {
		const imagePath = await writeTinyPng("ok.png");
		const tool = new DisplayTool(createSession());

		const result = await tool.execute("call-1", {
			type: "image",
			resources: [toFileUri(imagePath)],
		});

		expect(result.details?.error).toBeUndefined();
		expect(result.details?.images?.length).toBe(1);
		expect(result.details?.images?.[0]?.mimeType).toBe("image/png");
		expect(result.details?.images?.[0]?.data).toBeString();
		expect(result.content[0]?.type).toBe("text");
	});

	it("success image entry includes integer widthPx and heightPx greater than zero", async () => {
		const imagePath = await writeTinyPng("dims.png");
		const tool = new DisplayTool(createSession());

		const result = await tool.execute("call-2", {
			type: "image",
			resources: [toFileUri(imagePath)],
		});

		const image = result.details?.images?.[0];
		expect(image).toBeDefined();
		expect(Number.isInteger(image?.widthPx)).toBe(true);
		expect(Number.isInteger(image?.heightPx)).toBe(true);
		expect((image?.widthPx ?? 0) > 0).toBe(true);
		expect((image?.heightPx ?? 0) > 0).toBe(true);
	});

	it("invalid type returns invalid_type", async () => {
		const tool = new DisplayTool(createSession());

		const result = await tool.execute("call-3", {
			type: "text",
			resources: ["file:///tmp/test.png"],
		} as never);

		expect(result.details?.error?.code).toBe("invalid_type");
	});

	it("malformed resource URI records invalid_resource_uri", async () => {
		const tool = new DisplayTool(createSession());

		const result = await tool.execute("call-4", {
			type: "image",
			resources: ["not-a-uri"],
		});

		expect(result.details?.failures?.[0]?.code).toBe("invalid_resource_uri");
		expect(result.details?.error?.code).toBe("render_failed");
	});

	it("non-file URI records unsupported_scheme", async () => {
		const tool = new DisplayTool(createSession());

		const result = await tool.execute("call-5", {
			type: "image",
			resources: ["https://example.com/img.png"],
		});

		expect(result.details?.failures?.[0]?.code).toBe("unsupported_scheme");
		expect(result.details?.error?.code).toBe("render_failed");
	});

	it("missing file URI records resource_not_found", async () => {
		const missingPath = path.join(tempDir.path(), "missing.png");
		const tool = new DisplayTool(createSession());

		const result = await tool.execute("call-6", {
			type: "image",
			resources: [toFileUri(missingPath)],
		});

		expect(result.details?.failures?.[0]?.code).toBe("resource_not_found");
		expect(result.details?.error?.code).toBe("render_failed");
	});

	it("mixed-success call returns success with success metadata and failure records", async () => {
		const imagePath = await writeTinyPng("mixed-ok.png");
		const tool = new DisplayTool(createSession());

		const result = await tool.execute("call-7", {
			type: "image",
			resources: [toFileUri(imagePath), "https://example.com/bad.png"],
		});

		expect(result.details?.error).toBeUndefined();
		expect(result.details?.images?.length).toBe(1);
		expect(result.details?.failures?.length).toBe(1);
		expect(result.details?.failures?.[0]?.code).toBe("unsupported_scheme");
		expect(result.details?.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
	});

	it("all-failed call returns call-level error", async () => {
		const tool = new DisplayTool(createSession());

		const result = await tool.execute("call-8", {
			type: "image",
			resources: ["https://example.com/nope.png", "not-a-uri"],
		});

		expect(result.details?.error?.code).toBe("render_failed");
		expect(result.details?.summary).toEqual({ total: 2, succeeded: 0, failed: 2 });
	});

	it("capability-disabled call returns capability_disabled and includes setting key", async () => {
		const tool = new DisplayTool(createSession({ settings: createSettings({ "display.enableImage": false }) }));

		const result = await tool.execute("call-9", {
			type: "image",
			resources: ["file:///tmp/test.png"],
		});

		expect(result.details?.error?.code).toBe("capability_disabled");
		expect(result.details?.error?.settingKey).toBe("display.enableImage");
	});

	it("summary text does not include base64 image payload", async () => {
		const imagePath = await writeTinyPng("summary.png");
		const tool = new DisplayTool(createSession());

		const result = await tool.execute("call-10", {
			type: "image",
			resources: [toFileUri(imagePath)],
		});

		const summaryText = result.content.find(block => block.type === "text")?.text ?? "";
		expect(summaryText).toContain("Displayed 1 image(s); 0 failed.");
		expect(summaryText).not.toContain(TINY_PNG_BASE64.slice(0, 16));
		expect(summaryText).not.toContain(result.details?.images?.[0]?.data ?? "");
	});

	it("resource-level failures use approved v0 failure codes only", async () => {
		const tool = new DisplayTool(createSession());

		const result = await tool.execute("call-11", {
			type: "image",
			resources: [
				"https://example.com/nope.png",
				"not-a-uri",
				toFileUri(path.join(tempDir.path(), "missing-2.png")),
			],
		});

		const allowed = new Set(["invalid_resource_uri", "unsupported_scheme", "resource_not_found", "render_failed"]);
		for (const failure of result.details?.failures ?? []) {
			expect(allowed.has(failure.code)).toBe(true);
		}
	});

	it("envelope-level invalid resources returns invalid_args", async () => {
		const tool = new DisplayTool(createSession());
		const result = await tool.execute("call-12", { type: "image", resources: [] } as never);
		expect(result.details?.error?.code).toBe("invalid_args");
	});

	it("runtime display implementation does not import read runtime helpers", async () => {
		const source = await fs.readFile(path.join(import.meta.dir, "../../src/tools/display.ts"), "utf8");
		expect(source).not.toContain('from "./read"');
		expect(source).not.toContain('from "../tools/read"');
		expect(source).not.toContain('from "@oh-my-pi/pi-coding-agent/tools/read"');
	});
});
