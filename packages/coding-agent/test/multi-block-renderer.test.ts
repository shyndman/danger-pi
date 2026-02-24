import { describe, expect, it, vi } from "bun:test";

vi.mock("../src/modes/theme/theme", () => {
	const passthrough = (value: string) => value;
	return {
		theme: {
			fg: () => passthrough,
			bg: () => passthrough,
			bold: passthrough,
			getSymbolPreset: () => ({}),
			tree: { last: "" },
		},
		getMarkdownTheme: () => ({}),
	};
});

class FakeContainer {
	children: unknown[] = [];

	addChild(child: unknown): void {
		this.children.push(child);
	}

	removeChild(child: unknown): void {
		this.children = this.children.filter(entry => entry !== child);
	}
}

import { CustomMessageComponent } from "../src/modes/components/custom-message";
import { UserMessageComponent } from "../src/modes/components/user-message";
import type { InteractiveModeContext } from "../src/modes/types";
import { UiHelpers } from "../src/modes/utils/ui-helpers";
import {
	type CustomMessage,
	MULTI_BLOCK_COMMAND_MESSAGE_TYPE,
	MULTI_BLOCK_TEXT_MESSAGE_TYPE,
} from "../src/session/messages";

function createFakeContext(): InteractiveModeContext {
	const chatContainer = new FakeContainer();
	const pendingMessagesContainer = new FakeContainer();
	return {
		chatContainer,
		pendingTools: new Map(),
		toolOutputExpanded: false,
		session: {
			extensionRunner: undefined,
		} as InteractiveModeContext["session"],
		ui: { requestRender: vi.fn(), terminal: { rows: 40 } } as InteractiveModeContext["ui"],
		statusLine: {} as InteractiveModeContext["statusLine"],
		editor: {
			addToHistory: vi.fn(),
			setText: vi.fn(),
			getText: () => "",
		} as InteractiveModeContext["editor"],
		pendingImages: [],
		pendingBashComponents: [],
		pendingPythonComponents: [],
		pendingMessagesContainer,
		pendingImagesContainer: pendingMessagesContainer,
		settings: {} as InteractiveModeContext["settings"],
		statusContainer: new FakeContainer() as unknown as InteractiveModeContext["statusContainer"],
		todoContainer: new FakeContainer() as unknown as InteractiveModeContext["todoContainer"],
		skillCommands: new Map(),
		fileSlashCommands: new Set(),
		showTreeSelector: vi.fn(),
		showUserMessageSelector: vi.fn(),
		setToolUIContext: vi.fn(),
		initializeHookRunner: vi.fn(),
		createBackgroundUiContext: vi.fn(),
		setHookWidget: vi.fn(),
		setHookStatus: vi.fn(),
		setTodos: vi.fn(),
		agentStart: vi.fn(),
	} as unknown as InteractiveModeContext;
}

describe("multi-block renderer integration", () => {
	it("renders multi-block text as a user message", () => {
		const ctx = createFakeContext();
		const helpers = new UiHelpers(ctx);
		const message: CustomMessage = {
			role: "custom",
			customType: MULTI_BLOCK_TEXT_MESSAGE_TYPE,
			content: "Intro text",
			display: true,
			timestamp: Date.now(),
		};

		helpers.addMessageToChat(message);
		expect(ctx.chatContainer.children?.[0]).toBeInstanceOf(UserMessageComponent);
	});

	it("uses the custom message renderer for multi-block commands", () => {
		const ctx = createFakeContext();
		const helpers = new UiHelpers(ctx);
		const message: CustomMessage = {
			role: "custom",
			customType: MULTI_BLOCK_COMMAND_MESSAGE_TYPE,
			content: "Ran /plan",
			display: true,
			timestamp: Date.now(),
		};

		helpers.addMessageToChat(message);
		expect(ctx.chatContainer.children?.[0]).toBeInstanceOf(CustomMessageComponent);
	});
});
