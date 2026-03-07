import { describe, expect, it } from "bun:test";

import { DEFAULT_APP_KEYBINDINGS, KeybindingsManager } from "../src/config/keybindings";

describe("keybindings execute-intent paste action", () => {
	it("includes pasteExec default binding", () => {
		expect(DEFAULT_APP_KEYBINDINGS.pasteExec).toBe("ctrl+shift+alt+v");

		const manager = KeybindingsManager.inMemory();
		expect(manager.getKeys("pasteExec")).toEqual(["ctrl+shift+alt+v"]);
	});

	it("supports overriding pasteExec via keybindings config", () => {
		const manager = KeybindingsManager.inMemory({
			pasteExec: "alt+v",
		});

		expect(manager.getKeys("pasteExec")).toEqual(["alt+v"]);
	});
});
