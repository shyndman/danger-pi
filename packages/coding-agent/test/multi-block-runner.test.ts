import { describe, expect, it, vi } from "bun:test";

import { runMultiBlockSubmission } from "../src/modes/controllers/multi-block-runner";
import type { InteractiveModeContext } from "../src/modes/types";

function createContext(overrides?: Partial<InteractiveModeContext>): InteractiveModeContext {
	const editor = {
		getText: () => "snapshot",
		setText: vi.fn(),
		addToHistory: vi.fn(),
	} as unknown as InteractiveModeContext["editor"];

	return {
		session: {
			isStreaming: false,
			isCompacting: false,
			fileCommands: [],
		} as unknown as InteractiveModeContext["session"],
		fileSlashCommands: new Set<string>(),
		skillCommands: new Map<string, string>(),
		editor,
		showError: vi.fn(),
		...overrides,
	} as InteractiveModeContext;
}

describe("runMultiBlockSubmission", () => {
	it("requests continue-from-context when final command follows rendered text", async () => {
		const ctx = createContext({
			skillCommands: new Map([["skill:demo", "/tmp/skill"]]),
		});
		const handleTextBlock = vi.fn(async () => {});
		const result = await runMultiBlockSubmission({
			ctx,
			text: "good\n\n/skill:demo",
			handleSkillCommand: vi.fn(async () => "handled" as const),
			handleBackgroundCommand: vi.fn(),
			handleTextBlock,
		});

		expect(result).toMatchObject({
			processed: true,
			success: true,
			remainingText: null,
			continueFromContext: true,
		});
		expect(handleTextBlock).toHaveBeenCalledWith("good", { suppressTurn: true });
	});

	it("requests continue-from-context when file command expansion was rendered before final command", async () => {
		const ctx = createContext({
			session: {
				isStreaming: false,
				isCompacting: false,
				fileCommands: [
					{
						name: "foo",
						description: "",
						content: "generated",
						source: "test",
					},
				],
			} as unknown as InteractiveModeContext["session"],
			fileSlashCommands: new Set(["foo"]),
			skillCommands: new Map([["skill:omega", "/tmp/skill"]]),
		});
		const handleTextBlock = vi.fn(async () => {});
		const result = await runMultiBlockSubmission({
			ctx,
			text: "/foo\n\n/skill:omega",
			handleSkillCommand: vi.fn(async () => "handled" as const),
			handleBackgroundCommand: vi.fn(),
			handleTextBlock,
		});

		expect(result).toMatchObject({
			processed: true,
			success: true,
			remainingText: null,
			continueFromContext: true,
		});
		expect(handleTextBlock).toHaveBeenCalledWith("generated", { suppressTurn: true });
	});
});
