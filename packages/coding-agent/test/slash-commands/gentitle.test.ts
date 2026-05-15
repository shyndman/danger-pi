import { describe, expect, it } from "bun:test";
import {
	BUILTIN_SLASH_COMMAND_DEFS,
	executeBuiltinSlashCommand,
	isBuiltinSlashCommandName,
} from "../../src/slash-commands/builtin-registry";

describe("/gentitle removal", () => {
	it("is no longer registered as a builtin slash command", async () => {
		expect(isBuiltinSlashCommandName("gentitle")).toBe(false);
		expect(BUILTIN_SLASH_COMMAND_DEFS).not.toContainEqual(
			expect.objectContaining({
				name: "gentitle",
			}),
		);

		const handled = await executeBuiltinSlashCommand("/gentitle", {
			ctx: {} as never,
			handleBackgroundCommand: () => {},
		});
		expect(handled).toBe(false);
	});
});
