import { describe, expect, it, vi } from "bun:test";
import * as natives from "@oh-my-pi/pi-natives";

import { InputController } from "../src/modes/controllers/input-controller";
import type { InteractiveModeContext } from "../src/modes/types";

function createContext() {
	const insertPastedText = vi.fn();
	const showStatus = vi.fn();
	const requestRender = vi.fn();
	const ctx = {
		editor: {
			insertPastedText,
		},
		showStatus,
		ui: {
			requestRender,
		},
	} as unknown as InteractiveModeContext;

	return { ctx, insertPastedText, showStatus, requestRender };
}

describe("InputController execute-intent paste", () => {
	it("inserts clipboard text with exec intent when available", async () => {
		const { ctx, insertPastedText, showStatus, requestRender } = createContext();
		vi.spyOn(natives, "readTextFromClipboard").mockResolvedValue("!ls -al");
		const controller = new InputController(ctx);

		await controller.handleExecuteIntentPaste();

		expect(insertPastedText).toHaveBeenCalledWith("!ls -al", "exec");
		expect(requestRender).toHaveBeenCalled();
		expect(showStatus).not.toHaveBeenCalled();
	});

	it("shows non-blocking status and keeps editor unchanged when clipboard is unavailable", async () => {
		const { ctx, insertPastedText, showStatus, requestRender } = createContext();
		vi.spyOn(natives, "readTextFromClipboard").mockResolvedValue(null);
		const controller = new InputController(ctx);

		await controller.handleExecuteIntentPaste();

		expect(showStatus).toHaveBeenCalledWith(
			"Clipboard text unavailable for execute-intent paste (use terminal paste for safe text)",
		);
		expect(insertPastedText).not.toHaveBeenCalled();
		expect(requestRender).not.toHaveBeenCalled();
	});

	it("shows non-blocking status and keeps editor unchanged when clipboard read throws", async () => {
		const { ctx, insertPastedText, showStatus, requestRender } = createContext();
		vi.spyOn(natives, "readTextFromClipboard").mockRejectedValue(new Error("boom"));
		const controller = new InputController(ctx);

		await controller.handleExecuteIntentPaste();

		expect(showStatus).toHaveBeenCalledWith(
			"Clipboard text unavailable for execute-intent paste (use terminal paste for safe text)",
		);
		expect(insertPastedText).not.toHaveBeenCalled();
		expect(requestRender).not.toHaveBeenCalled();
	});
});
