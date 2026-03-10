import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BlobStore } from "@oh-my-pi/pi-coding-agent/session/blob-store";
import {
	type DisplayToolDetails,
	externalizeDisplayDetails,
	resolveDisplayDetails,
} from "@oh-my-pi/pi-coding-agent/tools/display/index";
import { TempDir } from "@oh-my-pi/pi-utils";

let tempDir: TempDir;

beforeAll(() => {
	tempDir = TempDir.createSync("@omp-display-persistence-test-");
});

afterAll(() => {
	tempDir.removeSync();
});

describe("display persistence helpers", () => {
	it("keeps small payloads inline and externalizes larger payloads", async () => {
		const blobStore = new BlobStore(tempDir.path());
		const smallData = Buffer.from("tiny").toString("base64");
		const largeData = Buffer.alloc(2048, 7).toString("base64");
		const details: DisplayToolDetails = {
			drawIntents: [
				{
					kind: "image",
					type: "image",
					uri: "file:///small.png",
					image: { data: smallData, mimeType: "image/png", widthPx: 1, heightPx: 1 },
				},
				{
					kind: "image",
					type: "image",
					uri: "file:///large.png",
					image: { data: largeData, mimeType: "image/png", widthPx: 1, heightPx: 1 },
				},
			],
		};

		const externalized = await externalizeDisplayDetails(blobStore, details);
		expect(externalized?.drawIntents?.[0]?.kind === "image" ? externalized.drawIntents[0].image.data : "").toBe(
			smallData,
		);
		const largePayload = externalized?.drawIntents?.[1];
		expect(largePayload?.kind).toBe("image");
		if (largePayload?.kind === "image") {
			expect(largePayload.image.data.startsWith("blob:sha256:")).toBe(true);
		}
	});

	it("restores blob-backed payloads for replay", async () => {
		const blobStore = new BlobStore(tempDir.path());
		const originalData = Buffer.alloc(2048, 9).toString("base64");
		const details = await externalizeDisplayDetails(blobStore, {
			drawIntents: [
				{
					kind: "image",
					type: "image",
					uri: "file:///restored.png",
					image: { data: originalData, mimeType: "image/png", widthPx: 1, heightPx: 1 },
				},
			],
		} satisfies DisplayToolDetails);
		await resolveDisplayDetails(blobStore, details);
		const restored = details?.drawIntents?.[0];
		expect(restored?.kind).toBe("image");
		if (restored?.kind === "image") {
			expect(restored.image.data).toBe(originalData);
		}
	});
});
