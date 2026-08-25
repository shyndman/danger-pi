import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Agent, type AgentMessage } from "@oh-my-pi/pi-agent-core";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import type { ComposerBatchDraft, ComposerBatchMessage } from "@oh-my-pi/pi-coding-agent/session/composer-batch";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

function draft(sessionId: string, timestamp: number, text: string): ComposerBatchDraft {
	return { sessionId, timestamp, text, images: [], imageLinks: [] };
}

function textFor(message: AgentMessage): string {
	if (message.role === "bashExecution") return message.command;
	if (message.role === "pythonExecution") return message.code;
	if ((message.role === "user" || message.role === "developer") && typeof message.content !== "string") {
		return message.content.find(block => block.type === "text")?.text ?? "";
	}
	return "";
}

describe("AgentSession composer batches", () => {
	let authStorage: AuthStorage;
	let session: AgentSession;
	let sessionManager: SessionManager;
	let providerCallCount: number;

	beforeEach(async () => {
		authStorage = await AuthStorage.create(":memory:");
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected the bundled Anthropic test model");
		providerCallCount = 0;
		const mock = createMockModel({
			handler: () => {
				providerCallCount++;
				return { content: ["Done"] };
			},
		});
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			streamFn: mock.stream,
		});
		sessionManager = SessionManager.inMemory();
		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({ "compaction.enabled": false, "todo.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage),
		});
	});

	afterEach(async () => {
		await session.dispose();
		authStorage.close();
	});

	it("submits ordered user and execution inputs in one model turn", async () => {
		const sessionId = session.sessionId;
		const inputs: Array<{ text: string; message: ComposerBatchMessage; visible: boolean }> = [
			{
				text: "first",
				message: { role: "user", content: [{ type: "text", text: "first" }], timestamp: 1 },
				visible: true,
			},
			{
				text: "! printf one",
				message: {
					role: "bashExecution",
					command: "printf one",
					output: "one",
					exitCode: 0,
					cancelled: false,
					truncated: false,
					timestamp: 2,
				},
				visible: true,
			},
			{
				text: "use it",
				message: { role: "user", content: [{ type: "text", text: "use it" }], timestamp: 3 },
				visible: true,
			},
			{
				text: "$ print('two')",
				message: {
					role: "pythonExecution",
					code: "print('two')",
					output: "two\n",
					exitCode: 0,
					cancelled: false,
					truncated: false,
					timestamp: 4,
				},
				visible: true,
			},
		];
		for (const [index, input] of inputs.entries()) {
			session.composerBatch.stage({
				draft: draft(sessionId, index + 1, input.text),
				prepared: {
					promptText: input.message.role === "user" ? input.text : "",
					images: [],
					messages: [input.message],
					modelVisible: input.visible,
				},
			});
		}
		const dispatch = session.composerBatch.take();
		if (!dispatch) throw new Error("Expected a composer batch dispatch");

		await session.promptComposerBatch(dispatch);

		expect(providerCallCount).toBe(1);
		expect(session.messages.slice(0, 4).map(textFor)).toEqual(["first", "printf one", "use it", "print('two')"]);
		const branchRoles = sessionManager
			.getBranch()
			.filter(entry => entry.type === "message")
			.map(entry => entry.message.role);
		expect(branchRoles.slice(0, 5)).toEqual(["user", "bashExecution", "user", "pythonExecution", "assistant"]);
		expect(dispatch.accepted).toBe(true);
	});

	it("persists excluded executions without a model call or assistant reply", async () => {
		const sessionId = session.sessionId;
		const messages: ComposerBatchMessage[] = [
			{
				role: "bashExecution",
				command: "printf hidden",
				output: "hidden",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: 10,
				excludeFromContext: true,
			},
			{
				role: "pythonExecution",
				code: "print('hidden')",
				output: "hidden\n",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: 11,
				excludeFromContext: true,
			},
		];
		for (const [index, message] of messages.entries()) {
			session.composerBatch.stage({
				draft: draft(sessionId, 10 + index, index === 0 ? "!! printf hidden" : "$$ print('hidden')"),
				prepared: { promptText: "", images: [], messages: [message], modelVisible: false },
			});
		}
		const dispatch = session.composerBatch.take();
		if (!dispatch) throw new Error("Expected an excluded composer batch dispatch");

		await session.promptComposerBatch(dispatch);

		expect(providerCallCount).toBe(0);
		expect(session.messages.map(message => message.role)).toEqual(["bashExecution", "pythonExecution"]);
		expect(
			sessionManager
				.getBranch()
				.filter(entry => entry.type === "message")
				.map(entry => entry.message.role),
		).toEqual(["bashExecution", "pythonExecution"]);
	});
});
