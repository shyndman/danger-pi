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
		const handleBashShortcut = vi.fn(async () => true);
		const handlePythonShortcut = vi.fn(async () => true);
		const result = await runMultiBlockSubmission({
			ctx,
			text: "good\n\n/skill:demo",
			handleSkillCommand: vi.fn(async () => "handled" as const),
			handleBackgroundCommand: vi.fn(),
			handleBashShortcut,
			handlePythonShortcut,
			handleTextBlock,
		});

		expect(result).toMatchObject({
			processed: true,
			success: true,
			remainingText: null,
			continueFromContext: true,
		});
		expect(handleTextBlock).toHaveBeenCalledWith("good", { suppressTurn: true });
		expect(handleBashShortcut).not.toHaveBeenCalled();
		expect(handlePythonShortcut).not.toHaveBeenCalled();
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
		const handleBashShortcut = vi.fn(async () => true);
		const handlePythonShortcut = vi.fn(async () => true);
		const result = await runMultiBlockSubmission({
			ctx,
			text: "/foo\n\n/skill:omega",
			handleSkillCommand: vi.fn(async () => "handled" as const),
			handleBackgroundCommand: vi.fn(),
			handleBashShortcut,
			handlePythonShortcut,
			handleTextBlock,
		});

		expect(result).toMatchObject({
			processed: true,
			success: true,
			remainingText: null,
			continueFromContext: true,
		});
		expect(handleTextBlock).toHaveBeenCalledWith("generated", { suppressTurn: true });
		expect(handleBashShortcut).not.toHaveBeenCalled();
		expect(handlePythonShortcut).not.toHaveBeenCalled();
	});

	it("runs mixed shortcut blocks in author order and continues from context", async () => {
		const ctx = createContext();
		const handleTextBlock = vi.fn(async () => {});
		const handleBashShortcut = vi.fn(async () => true);
		const handlePythonShortcut = vi.fn(async () => true);
		const result = await runMultiBlockSubmission({
			ctx,
			text: "!ls\nthis is a message\n!ls -al\nthis is another\n$print('hi')",
			handleSkillCommand: vi.fn(async () => "not-handled" as const),
			handleBackgroundCommand: vi.fn(),
			handleBashShortcut,
			handlePythonShortcut,
			handleTextBlock,
		});

		expect(result).toMatchObject({
			processed: true,
			success: true,
			remainingText: null,
			continueFromContext: true,
		});
		expect(handleBashShortcut).toHaveBeenNthCalledWith(1, "ls", false);
		expect(handleBashShortcut).toHaveBeenNthCalledWith(2, "ls -al", false);
		expect(handlePythonShortcut).toHaveBeenCalledWith("print('hi')", false);
		expect(handleTextBlock).toHaveBeenNthCalledWith(1, "this is a message", { suppressTurn: true });
		expect(handleTextBlock).toHaveBeenNthCalledWith(2, "this is another", { suppressTurn: true });
	});

	it("does not prompt when submission contains only shortcut command blocks", async () => {
		const ctx = createContext();
		const handleTextBlock = vi.fn(async () => {});
		const handleBashShortcut = vi.fn(async () => true);
		const handlePythonShortcut = vi.fn(async () => true);
		const result = await runMultiBlockSubmission({
			ctx,
			text: "!ls\n!! pwd\n$print('hi')\n$$ print('hidden')",
			handleSkillCommand: vi.fn(async () => "not-handled" as const),
			handleBackgroundCommand: vi.fn(),
			handleBashShortcut,
			handlePythonShortcut,
			handleTextBlock,
		});

		expect(result).toMatchObject({
			processed: true,
			success: true,
			remainingText: null,
			continueFromContext: false,
		});
		expect(handleBashShortcut).toHaveBeenNthCalledWith(1, "ls", false);
		expect(handleBashShortcut).toHaveBeenNthCalledWith(2, "pwd", true);
		expect(handlePythonShortcut).toHaveBeenNthCalledWith(1, "print('hi')", false);
		expect(handlePythonShortcut).toHaveBeenNthCalledWith(2, "print('hidden')", true);
		expect(handleTextBlock).not.toHaveBeenCalled();
	});

	it("short-circuits remaining blocks when a shortcut execution fails", async () => {
		const ctx = createContext();
		const handleTextBlock = vi.fn(async () => {});
		const handleBashShortcut = vi.fn(async () => false);
		const handlePythonShortcut = vi.fn(async () => true);
		const result = await runMultiBlockSubmission({
			ctx,
			text: "!ls\n$print('hi')",
			handleSkillCommand: vi.fn(async () => "not-handled" as const),
			handleBackgroundCommand: vi.fn(),
			handleBashShortcut,
			handlePythonShortcut,
			handleTextBlock,
		});

		expect(result).toMatchObject({
			processed: true,
			success: false,
			remainingText: null,
			continueFromContext: false,
		});
		expect(handleBashShortcut).toHaveBeenCalledWith("ls", false);
		expect(handlePythonShortcut).not.toHaveBeenCalled();
		expect(handleTextBlock).not.toHaveBeenCalled();
		expect(ctx.editor.setText).toHaveBeenCalledWith("snapshot");
	});

	it("aborts multi-block processing on fenced shortcut parse errors", async () => {
		const ctx = createContext();
		const handleTextBlock = vi.fn(async () => {});
		const handleBashShortcut = vi.fn(async () => true);
		const handlePythonShortcut = vi.fn(async () => true);
		const result = await runMultiBlockSubmission({
			ctx,
			text: "$$```\nprint('oops')",
			handleSkillCommand: vi.fn(async () => "not-handled" as const),
			handleBackgroundCommand: vi.fn(),
			handleBashShortcut,
			handlePythonShortcut,
			handleTextBlock,
		});

		expect(result).toMatchObject({
			processed: true,
			success: false,
			remainingText: null,
			continueFromContext: false,
		});
		expect(ctx.showError).toHaveBeenCalledWith("Unterminated python fenced shortcut block starting at line 1.");
		expect(handleBashShortcut).not.toHaveBeenCalled();
		expect(handlePythonShortcut).not.toHaveBeenCalled();
		expect(handleTextBlock).not.toHaveBeenCalled();
	});

	it("executes a single fenced shortcut block without falling back to legacy path", async () => {
		const ctx = createContext();
		const handleTextBlock = vi.fn(async () => {});
		const handleBashShortcut = vi.fn(async () => true);
		const handlePythonShortcut = vi.fn(async () => true);
		const result = await runMultiBlockSubmission({
			ctx,
			text: "!```\necho 'one'\n```",
			handleSkillCommand: vi.fn(async () => "not-handled" as const),
			handleBackgroundCommand: vi.fn(),
			handleBashShortcut,
			handlePythonShortcut,
			handleTextBlock,
		});

		expect(result).toMatchObject({
			processed: true,
			success: true,
			remainingText: null,
			continueFromContext: false,
		});
		expect(handleBashShortcut).toHaveBeenCalledWith("echo 'one'", false);
		expect(handlePythonShortcut).not.toHaveBeenCalled();
		expect(handleTextBlock).not.toHaveBeenCalled();
	});
});
