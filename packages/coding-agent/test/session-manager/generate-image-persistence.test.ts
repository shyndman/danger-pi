import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AssistantMessage, ToolResultMessage } from "@oh-my-pi/pi-ai";
import { SessionManager, type SessionMessageEntry } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { getBlobsDir, TempDir } from "@oh-my-pi/pi-utils";

const RESULT_IMAGE_DATA = Buffer.alloc(2048, 7).toString("base64");
const INPUT_IMAGE_DATA = Buffer.alloc(2048, 9).toString("base64");

function findMessageEntry(
	session: SessionManager,
	predicate: (entry: SessionMessageEntry) => boolean,
): SessionMessageEntry {
	const entry = session
		.getEntries()
		.find(value => value.type === "message" && predicate(value as SessionMessageEntry)) as
		| SessionMessageEntry
		| undefined;
	if (!entry) {
		throw new Error("Expected session message entry");
	}
	return entry;
}

describe("SessionManager generate_image persistence", () => {
	it("externalizes generate_image input and result bytes while restoring them on reload", async () => {
		using tempDir = TempDir.createSync("@pi-generate-image-persistence-");
		const session = SessionManager.create(tempDir.path(), tempDir.path());
		const preservedPath = path.join(tempDir.path(), "input.png");

		session.appendMessage({ role: "user", content: "show me the agents", timestamp: 1 });
		session.appendMessage({
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call-1",
					name: "generate_image",
					arguments: {
						input: [
							{ data: INPUT_IMAGE_DATA, mime_type: "image/png", path: preservedPath },
							{ path: preservedPath, data: "", mime_type: "image/png" },
						],
					},
				},
			],
			api: "openai-responses",
			provider: "openai",
			model: "gpt-5",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "toolUse",
			timestamp: 2,
		} satisfies AssistantMessage);
		session.appendMessage({
			role: "toolResult",
			toolCallId: "call-1",
			toolName: "generate_image",
			content: [{ type: "text", text: "generated 1 image" }],
			details: {
				provider: "gemini",
				model: "gemini-3-pro-image-preview",
				imageCount: 1,
				imagePaths: [preservedPath],
				images: [{ data: RESULT_IMAGE_DATA, mimeType: "image/png" }],
				responseText: "generated 1 image",
				usage: { promptTokenCount: 1, totalTokenCount: 2 },
			},
			isError: false,
			timestamp: 3,
		} satisfies ToolResultMessage);
		await session.flush();

		const persisted = await Bun.file(session.getSessionFile()!).text();
		expect(persisted).not.toContain(INPUT_IMAGE_DATA);
		expect(persisted).not.toContain(RESULT_IMAGE_DATA);
		expect(persisted).toContain("blob:sha256:");
		expect(persisted).toContain(preservedPath);

		const inputHash = new Bun.CryptoHasher("sha256").update(Buffer.from(INPUT_IMAGE_DATA, "base64")).digest("hex");
		const resultHash = new Bun.CryptoHasher("sha256").update(Buffer.from(RESULT_IMAGE_DATA, "base64")).digest("hex");
		expect(await fs.readFile(path.join(getBlobsDir(), inputHash), "base64")).toBe(INPUT_IMAGE_DATA);
		expect(await fs.readFile(path.join(getBlobsDir(), resultHash), "base64")).toBe(RESULT_IMAGE_DATA);

		const reloaded = await SessionManager.open(session.getSessionFile()!);
		const assistantEntry = findMessageEntry(reloaded, entry => entry.message.role === "assistant");
		const toolCall = (assistantEntry.message as AssistantMessage).content[0];
		expect(toolCall).toMatchObject({ type: "toolCall", name: "generate_image" });
		if (toolCall.type !== "toolCall") {
			throw new Error("Expected tool call content");
		}
		expect(toolCall.arguments.input[0]).toEqual({
			data: INPUT_IMAGE_DATA,
			mime_type: "image/png",
			path: preservedPath,
		});
		expect(toolCall.arguments.input[1]).toEqual({ path: preservedPath, data: "", mime_type: "image/png" });

		const toolResultEntry = findMessageEntry(reloaded, entry => entry.message.role === "toolResult");
		const toolResult = toolResultEntry.message as ToolResultMessage<Record<string, unknown>>;
		expect(toolResult.details).toMatchObject({
			provider: "gemini",
			model: "gemini-3-pro-image-preview",
			imageCount: 1,
			imagePaths: [preservedPath],
			responseText: "generated 1 image",
		});
		expect((toolResult.details as { images: Array<{ data: string; mimeType: string }> }).images[0]).toEqual({
			data: RESULT_IMAGE_DATA,
			mimeType: "image/png",
		});
	});
});
