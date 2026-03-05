import { describe, expect, it } from "bun:test";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { executeBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";

describe("/reload slash command", () => {
	it("routes through interactive reload handler", async () => {
		let invoked = false;
		let editorCleared = false;
		const ctx = {
			handleReloadCommand: async () => {
				invoked = true;
			},
			editor: {
				setText: (value: string) => {
					editorCleared = value === "";
				},
			},
		} as unknown as InteractiveModeContext;

		const handled = await executeBuiltinSlashCommand("/reload", {
			ctx,
			handleBackgroundCommand: () => {},
		});

		expect(handled).toBe(true);
		expect(invoked).toBe(true);
		expect(editorCleared).toBe(true);
	});
});
