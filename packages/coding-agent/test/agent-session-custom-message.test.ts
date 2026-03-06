import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";

import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-ai/models";
import { TempDir } from "@oh-my-pi/pi-utils";

import { ModelRegistry } from "../src/config/model-registry";
import { Settings } from "../src/config/settings";
import type { AgentSessionEvent } from "../src/session/agent-session";
import { AgentSession } from "../src/session/agent-session";
import { AuthStorage } from "../src/session/auth-storage";
import { SessionManager } from "../src/session/session-manager";

describe("AgentSession custom messages", () => {
	let tempDir: TempDir;
	let session: AgentSession;
	let events: AgentSessionEvent[];

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-custom-msg-");
		const authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		const modelRegistry = new ModelRegistry(authStorage);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Expected built-in anthropic model to exist");
		}

		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: "Test",
				tools: [],
				messages: [],
			},
		});

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			modelRegistry,
		});

		events = [];
		session.subscribe(event => {
			events.push(event);
		});
	});

	afterEach(async () => {
		await session.dispose();
		tempDir.removeSync();
	});

	it("emits message events when appending a custom message", async () => {
		await session.sendCustomMessage({
			customType: "skill-prompt",
			content: "hello",
			display: true,
			details: undefined,
		});

		const customEvents = events.filter(event => event.type === "message_start" || event.type === "message_end");
		expect(customEvents).toHaveLength(2);
		expect(customEvents[0]).toMatchObject({
			type: "message_start",
			message: { role: "custom", customType: "skill-prompt" },
		});
		expect(customEvents[1]).toMatchObject({
			type: "message_end",
			message: { role: "custom", customType: "skill-prompt" },
		});
		expect(session.agent.state.messages).toHaveLength(1);
		expect(session.agent.state.messages[0]).toMatchObject({ role: "custom", customType: "skill-prompt" });
	});

	it("persists non-turn custom messages exactly once after event processing", async () => {
		await session.sendCustomMessage({
			customType: "multi-block-text",
			content: "hello",
			display: true,
			details: { suppressTurn: true },
		});

		await Bun.sleep(0);

		const persistedCustomEntries = session.sessionManager
			.getEntries()
			.filter(
				(entry): entry is typeof entry & { type: "custom_message" } =>
					entry.type === "custom_message" && entry.customType === "multi-block-text",
			);

		expect(persistedCustomEntries).toHaveLength(1);
	});
});
