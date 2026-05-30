import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { resetSettingsForTest, Settings, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AssistantMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/assistant-message";
import { CustomMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/custom-message";
import { UserMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/user-message";
import { getMarkdownTheme, initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { CustomMessage } from "@oh-my-pi/pi-coding-agent/session/messages";
import { Markdown, visibleWidth } from "@oh-my-pi/pi-tui";

const OSC133_REGEX = /\x1b\]133;[ABC]\x07/g;

function createAssistantMessage(markdown: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: markdown }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createCustomMessage(markdown: string): CustomMessage {
	return {
		role: "custom",
		customType: "test",
		content: markdown,
		display: true,
		timestamp: Date.now(),
	};
}

function stripShellIntegration(lines: readonly string[]): string[] {
	return lines.map(line => line.replaceAll(OSC133_REGEX, ""));
}

function nonEmptyLines(lines: readonly string[]): string[] {
	return stripShellIntegration(lines)
		.map(line => line.trimEnd())
		.filter(line => line.trim().length > 0);
}

function maxRenderedWidth(lines: readonly string[]): number {
	return Math.max(...stripShellIntegration(lines).map(visibleWidth), 0);
}

beforeAll(async () => {
	await initTheme(false);
});

beforeEach(async () => {
	resetSettingsForTest();
	await Settings.init({ inMemory: true });
});

afterEach(() => {
	resetSettingsForTest();
});

describe("message wrap width", () => {
	it("defaults to 100 columns for chat wrapping while keeping user backgrounds full width", () => {
		const text = Array.from({ length: 18 }, (_, i) => `token${i}`).join(" ");

		const assistantLines = new AssistantMessageComponent(createAssistantMessage(text)).render(140);
		const userLines = new UserMessageComponent(text).render(140);
		const customLines = new CustomMessageComponent(createCustomMessage(text)).render(140);

		expect(settings.get("display.messageWrapWidth")).toBe(100);
		expect(nonEmptyLines(assistantLines).length).toBeGreaterThan(1);
		expect(nonEmptyLines(userLines).length).toBeGreaterThan(1);
		expect(maxRenderedWidth(assistantLines)).toBe(102);
		expect(maxRenderedWidth(userLines)).toBe(140);
		expect(maxRenderedWidth(customLines)).toBe(140);
	});

	it("caps chat wrapping without shrinking the user background fill", () => {
		const text = "alpha beta gamma delta";
		settings.override("display.messageWrapWidth", 12);

		const assistantLines = new AssistantMessageComponent(createAssistantMessage(text)).render(80);
		const userLines = new UserMessageComponent(text).render(80);
		const customLines = new CustomMessageComponent(createCustomMessage(text)).render(80);
		const standaloneMarkdown = nonEmptyLines(new Markdown(text, 1, 0, getMarkdownTheme()).render(80));

		expect(nonEmptyLines(assistantLines).length).toBeGreaterThan(1);
		expect(nonEmptyLines(userLines).length).toBeGreaterThan(1);
		expect(maxRenderedWidth(assistantLines)).toBe(14);
		expect(maxRenderedWidth(userLines)).toBe(80);
		expect(maxRenderedWidth(customLines)).toBe(80);
		expect(standaloneMarkdown.length).toBe(1);
	});
});
