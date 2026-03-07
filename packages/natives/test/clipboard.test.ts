import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { readTextFromClipboard } from "../src/clipboard";
import { native } from "../src/native";

const ORIGINAL_TERMUX_VERSION = process.env.TERMUX_VERSION;
const ORIGINAL_PATH = process.env.PATH;

async function createTermuxHelper(scriptBody: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "natives-termux-"));
	const scriptPath = path.join(dir, "termux-clipboard-get");
	await fs.writeFile(scriptPath, `#!/usr/bin/env sh\n${scriptBody}\n`);
	await fs.chmod(scriptPath, 0o755);
	return dir;
}

afterEach(() => {
	vi.restoreAllMocks();
	if (ORIGINAL_TERMUX_VERSION === undefined) {
		delete process.env.TERMUX_VERSION;
	} else {
		process.env.TERMUX_VERSION = ORIGINAL_TERMUX_VERSION;
	}
	if (ORIGINAL_PATH === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = ORIGINAL_PATH;
	}
});

describe("readTextFromClipboard", () => {
	it("returns native clipboard text when available", async () => {
		vi.spyOn(native, "readTextFromClipboard").mockResolvedValue("hello world");

		await expect(readTextFromClipboard()).resolves.toBe("hello world");
	});

	it("returns null when native clipboard reports unavailable", async () => {
		vi.spyOn(native, "readTextFromClipboard").mockResolvedValue(null);

		await expect(readTextFromClipboard()).resolves.toBeNull();
	});

	it("maps ClipboardOccupied and ClipboardNotSupported errors to null", async () => {
		const nativeSpy = vi.spyOn(native, "readTextFromClipboard");
		nativeSpy.mockRejectedValueOnce(new Error("Failed to read clipboard text: ClipboardOccupied"));
		nativeSpy.mockRejectedValueOnce(new Error("Failed to read clipboard text: ClipboardNotSupported"));

		await expect(readTextFromClipboard()).resolves.toBeNull();
		await expect(readTextFromClipboard()).resolves.toBeNull();
	});

	it("propagates unexpected native clipboard errors", async () => {
		vi.spyOn(native, "readTextFromClipboard").mockRejectedValue(new Error("Failed to read clipboard text: Boom"));

		await expect(readTextFromClipboard()).rejects.toThrow("Boom");
	});

	it("uses termux-clipboard-get without arguments before native fallback", async () => {
		process.env.TERMUX_VERSION = "0.118.0";
		const spawnSpy = vi.spyOn(Bun, "spawn").mockReturnValue({
			stdout: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("termux clipboard text"));
					controller.close();
				},
			}),
			exited: Promise.resolve(0),
		} as unknown as Bun.Subprocess);
		const nativeSpy = vi.spyOn(native, "readTextFromClipboard").mockResolvedValue("native fallback");

		await expect(readTextFromClipboard()).resolves.toBe("termux clipboard text");
		expect(spawnSpy).toHaveBeenCalledWith(
			["termux-clipboard-get"],
			expect.objectContaining({ stdout: "pipe", stderr: "pipe" }),
		);
		expect(nativeSpy).not.toHaveBeenCalled();
	});

	it("treats missing termux helper as non-blocking and falls back to native", async () => {
		const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), "natives-termux-missing-"));
		process.env.TERMUX_VERSION = "0.118.0";
		process.env.PATH = [emptyDir, ORIGINAL_PATH].filter(Boolean).join(":");
		vi.spyOn(native, "readTextFromClipboard").mockResolvedValue(null);

		await expect(readTextFromClipboard()).resolves.toBeNull();
	});

	it("treats missing Termux:API service error as non-blocking and falls back", async () => {
		const helperDir = await createTermuxHelper('echo "cmd: Can\'t find service: activity" >&2\nexit 1');
		process.env.TERMUX_VERSION = "0.118.0";
		process.env.PATH = [helperDir, ORIGINAL_PATH].filter(Boolean).join(":");
		vi.spyOn(native, "readTextFromClipboard").mockResolvedValue(null);

		await expect(readTextFromClipboard()).resolves.toBeNull();
	});

	it("treats foreground clipboard restriction as non-blocking and falls back", async () => {
		const helperDir = await createTermuxHelper(
			'echo "SecurityException: clipboard access denied for background app" >&2\nexit 1',
		);
		process.env.TERMUX_VERSION = "0.118.0";
		process.env.PATH = [helperDir, ORIGINAL_PATH].filter(Boolean).join(":");
		vi.spyOn(native, "readTextFromClipboard").mockResolvedValue(null);

		await expect(readTextFromClipboard()).resolves.toBeNull();
	});
});
