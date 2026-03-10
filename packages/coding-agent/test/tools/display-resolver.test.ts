import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
	DefaultDisplayResourceResolver,
	DISPLAY_RESOLVER_MAX_BYTES,
	type ResolvedDisplayResourceResult,
} from "@oh-my-pi/pi-coding-agent/tools/display/index";
import { hookFetch, TempDir } from "@oh-my-pi/pi-utils";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2r8GQAAAAASUVORK5CYII=";

let tempDir: TempDir;

beforeAll(() => {
	tempDir = TempDir.createSync("@omp-display-resolver-test-");
});

afterAll(() => {
	tempDir.removeSync();
});

describe("DefaultDisplayResourceResolver", () => {
	it("resolves supported file/http/https/data schemes in input order", async () => {
		const filePath = path.join(tempDir.path(), "ok.png");
		await Bun.write(filePath, Buffer.from(TINY_PNG_BASE64, "base64"));
		const pngBytes = Buffer.from(TINY_PNG_BASE64, "base64");
		using _hook = hookFetch(input => {
			const url = String(input);
			if (url === "http://example.test/hello.txt" || url === "https://example.test/hello.txt") {
				return new Response("#112233", { headers: { "Content-Type": "text/plain" } });
			}
			return new Response(pngBytes, { headers: { "Content-Type": "image/png" } });
		});

		const resolver = new DefaultDisplayResourceResolver();
		const results = await resolver.resolveResources([
			pathToFileURL(filePath).toString(),
			"http://example.test/hello.txt",
			"https://example.test/hello.txt",
			"data:text/plain,%23AABBCC",
		]);

		expect(results.every(result => result.ok)).toBe(true);
		const resources = results.filter(
			(result): result is Extract<ResolvedDisplayResourceResult, { ok: true }> => result.ok,
		);
		expect(resources.map(result => result.resource.uri)).toEqual([
			pathToFileURL(filePath).toString(),
			"http://example.test/hello.txt",
			"https://example.test/hello.txt",
			"data:text/plain,%23AABBCC",
		]);
		expect(resources[0]?.resource.mimeType).toBe("image/png");
		expect(resources[1]?.resource.text).toBe("#112233");
		expect(resources[3]?.resource.text).toBe("#AABBCC");
	});

	it("reports unsupported schemes per resource", async () => {
		const resolver = new DefaultDisplayResourceResolver();
		const [result] = await resolver.resolveResources(["ftp://example.test/file.txt"]);
		expect(result?.ok).toBe(false);
		if (result && !result.ok) {
			expect(result.error.code).toBe("unsupported_scheme");
		}
	});

	it("reports network timeouts without overriding global fetch", async () => {
		using _timeout = overrideAbortSignalTimeout(() => AbortSignal.abort("timeout"));
		using _hook = hookFetch((_input, init) => {
			if (init?.signal?.aborted) {
				throw new Error("aborted");
			}
			return new Response("late");
		});
		const resolver = new DefaultDisplayResourceResolver();
		const [result] = await resolver.resolveResources(["https://example.test/slow.txt"]);
		expect(result?.ok).toBe(false);
		if (result && !result.ok) {
			expect(result.error.message).toContain("timed out after 30 seconds");
		}
	});

	it("enforces response size limits for network payloads", async () => {
		using _hook = hookFetch(
			() =>
				new Response("ok", {
					headers: { "Content-Length": String(DISPLAY_RESOLVER_MAX_BYTES + 1), "Content-Type": "text/plain" },
				}),
		);
		const resolver = new DefaultDisplayResourceResolver();
		const [result] = await resolver.resolveResources(["https://example.test/too-large.txt"]);
		expect(result?.ok).toBe(false);
		if (result && !result.ok) {
			expect(result.error.message).toContain("20MB");
		}
	});

	it("enforces decoded size limits for data URIs", async () => {
		const oversized = `data:text/plain,${"a".repeat(DISPLAY_RESOLVER_MAX_BYTES + 1)}`;
		const resolver = new DefaultDisplayResourceResolver();
		const [result] = await resolver.resolveResources([oversized]);
		expect(result?.ok).toBe(false);
		if (result && !result.ok) {
			expect(result.error.message).toContain("20MB");
		}
	});
});

function overrideAbortSignalTimeout(factory: typeof AbortSignal.timeout) {
	const original = AbortSignal.timeout;
	Object.defineProperty(AbortSignal, "timeout", { value: factory, configurable: true });
	return {
		[Symbol.dispose]() {
			Object.defineProperty(AbortSignal, "timeout", { value: original, configurable: true });
		},
	};
}
