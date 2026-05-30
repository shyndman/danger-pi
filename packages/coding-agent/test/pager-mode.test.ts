import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AssistantMessage, Usage } from "@oh-my-pi/pi-ai";
import { Settings } from "../src/config/settings";
import {
	createPagerModeExtension,
	PAGER_EXIT_CUSTOM_TYPE,
	PAGER_NEXT_CUSTOM_TYPE,
	PAGER_STATUS_KEY,
	pagerExitRenderer,
	parsePagerIndexContent,
	reconstructPagerState,
} from "../src/danger-pi/pager-mode";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionUIContext,
	MessageRenderer,
	RegisteredCommand,
} from "../src/extensibility/extensions";
import { theme as activeTheme, getThemeByName, setThemeInstance } from "../src/modes/theme/theme";
import { createAgentSession } from "../src/sdk";
import type { SessionEntry } from "../src/session/session-entries";
import { SessionManager } from "../src/session/session-manager";

const testTheme = await getThemeByName("dark");

function installTestTheme(): void {
	if (!testTheme) {
		throw new Error("Failed to load dark theme for pager tests");
	}
	setThemeInstance(testTheme);
}

const usage = (): Usage => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

function createAssistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "mock",
		provider: "mock",
		model: "mock-model",
		usage: usage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function pagerIndex(workflow: string, pages: string[]): string {
	return [
		`<pager-index title="${workflow}">`,
		...pages.map((page, index) => `${index + 1}. ${page}`),
		`</pager-index>`,
	].join("\n");
}

function appendPagerIndex(sessionManager: SessionManager, workflow: string, pages: string[]): string {
	return sessionManager.appendMessage(createAssistantMessage(pagerIndex(workflow, pages)));
}

interface SentMessageCall {
	message: {
		customType: string;
		content: string | unknown[];
		display: boolean;
		details?: unknown;
		attribution?: string;
	};
	options: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" } | undefined;
}

interface StatusRecord {
	key: string;
	text: string | undefined;
}

interface NotificationRecord {
	message: string;
	type: "info" | "warning" | "error" | undefined;
}

function createPagerHarness(sessionManager: SessionManager = SessionManager.inMemory()) {
	const commands = new Map<string, RegisteredCommand>();
	const renderers = new Map<string, MessageRenderer>();
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>>();
	const sentMessages: SentMessageCall[] = [];
	const statuses: StatusRecord[] = [];
	const notifications: NotificationRecord[] = [];

	const ui = {
		select: async () => undefined,
		confirm: async () => false,
		input: async () => undefined,
		notify: (message: string, type?: "info" | "warning" | "error") => {
			notifications.push({ message, type });
		},
		onTerminalInput: () => () => {},
		setStatus: (key: string, text: string | undefined) => {
			statuses.push({ key, text });
		},
		setWorkingMessage: () => {},
		setWidget: () => {},
		setFooter: () => {},
		setHeader: () => {},
		setTitle: () => {},
		custom: async () => undefined as never,
		setEditorText: () => {},
		pasteToEditor: () => {},
		getEditorText: () => "",
		editor: async () => undefined,
		setEditorComponent: () => {},
		theme: undefined as never,
		getAllThemes: async () => [],
		getTheme: async () => undefined,
		setTheme: async () => ({ success: false, error: "unsupported" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	} satisfies Partial<ExtensionUIContext>;

	const baseContext = {
		ui,
		getContextUsage: () => undefined,
		compact: async () => {},
		hasUI: true,
		cwd: sessionManager.getCwd(),
		sessionManager,
		modelRegistry: undefined,
		model: undefined,
		isIdle: () => true,
		abort: () => {},
		hasPendingMessages: () => false,
		shutdown: () => {},
		getSystemPrompt: () => [],
		hasQueuedMessages: () => false,
	} as unknown as ExtensionContext;

	const api = {
		on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void): void {
			const current = handlers.get(event) ?? [];
			current.push(handler);
			handlers.set(event, current);
		},
		registerCommand(name: string, options: Omit<RegisteredCommand, "name">): void {
			commands.set(name, { name, ...options });
		},
		registerMessageRenderer<T = unknown>(customType: string, renderer: MessageRenderer<T>): void {
			renderers.set(customType, renderer as MessageRenderer);
		},
		sendMessage(message: SentMessageCall["message"], options?: SentMessageCall["options"]): void {
			sentMessages.push({ message, options });
		},
	} as unknown as ExtensionAPI;

	createPagerModeExtension(api);

	const emit = async (eventType: string, event: unknown, ctx: ExtensionContext = baseContext): Promise<void> => {
		for (const handler of handlers.get(eventType) ?? []) {
			await handler(event, ctx);
		}
	};

	const commandContext = (): ExtensionCommandContext =>
		({
			...baseContext,
			waitForIdle: async () => {},
			newSession: async () => ({ cancelled: false }),
			branch: async () => ({ cancelled: false }),
			navigateTree: async () => ({ cancelled: false }),
			switchSession: async () => ({ cancelled: false }),
			reload: async () => {},
		}) as unknown as ExtensionCommandContext;

	const latestStatus = (): string | undefined => {
		for (let index = statuses.length - 1; index >= 0; index -= 1) {
			if (statuses[index]?.key === PAGER_STATUS_KEY) {
				return statuses[index]?.text;
			}
		}
		return undefined;
	};

	return {
		api,
		baseContext,
		commandContext,
		commands,
		emit,
		handlers,
		latestStatus,
		notifications,
		renderers,
		sentMessages,
		sessionManager,
		statuses,
	};
}

describe("pager-mode parser and reconstruction", () => {
	it("parses a valid pager index block", () => {
		expect(
			parsePagerIndexContent(
				[
					pagerIndex("Pebble v3 Tuning", ["High-Pass Filtering", "Equalizer Adjustments"]),
					"Other trailing text",
				].join("\n\n"),
			),
		).toEqual({
			workflow: "Pebble v3 Tuning",
			pages: ["High-Pass Filtering", "Equalizer Adjustments"],
		});
	});

	it("rejects malformed pager index blocks", () => {
		expect(parsePagerIndexContent(`<pager-index title="Broken">\n1. First\n3. Third\n</pager-index>`)).toBeNull();
		expect(parsePagerIndexContent(`<pager-index title="Broken">\n- First\n- Second\n</pager-index>`)).toBeNull();
	});

	it("reconstructs the active page by walking backward over the branch", () => {
		const sessionManager = SessionManager.inMemory();
		appendPagerIndex(sessionManager, "Pebble v3 Tuning", ["High-Pass Filtering", "Equalizer Adjustments"]);
		sessionManager.appendCustomMessageEntry(PAGER_NEXT_CUSTOM_TYPE, "next", true, undefined, "user");

		expect(reconstructPagerState(sessionManager.getBranch())).toEqual({
			mode: "page",
			workflow: "Pebble v3 Tuning",
			pages: ["High-Pass Filtering", "Equalizer Adjustments"],
			pageCount: 2,
			pageOrdinal: 1,
			pageTitle: "High-Pass Filtering",
		});
	});

	it("ignores stray pager control messages with no reachable index", () => {
		const branch = [
			{
				type: "custom_message",
				customType: PAGER_NEXT_CUSTOM_TYPE,
				content: "next",
				display: true,
				id: "next-1",
				parentId: null,
				timestamp: new Date().toISOString(),
			} as SessionEntry,
		];

		expect(reconstructPagerState(branch)).toBeNull();
	});

	it("treats next beyond the final page as closed pager state", () => {
		const sessionManager = SessionManager.inMemory();
		appendPagerIndex(sessionManager, "Solo", ["Only Page"]);
		sessionManager.appendCustomMessageEntry(PAGER_NEXT_CUSTOM_TYPE, "next", true, undefined, "user");
		sessionManager.appendCustomMessageEntry(PAGER_NEXT_CUSTOM_TYPE, "next", true, undefined, "user");

		expect(reconstructPagerState(sessionManager.getBranch())).toBeNull();
	});
});

describe("pager-mode commands and renderers", () => {
	it("emits a visible pager-next message, renders it compactly, and advances status immediately", async () => {
		installTestTheme();
		const harness = createPagerHarness();
		appendPagerIndex(harness.sessionManager, "Pebble v3 Tuning", ["High-Pass Filtering", "Equalizer Adjustments"]);

		const command = harness.commands.get("pager:next");
		if (!command) throw new Error("Missing pager:next command");
		await command.handler("", harness.commandContext());

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toMatchObject({
			message: {
				customType: PAGER_NEXT_CUSTOM_TYPE,
				display: true,
				attribution: "user",
				details: {
					workflow: "Pebble v3 Tuning",
					previousTitle: "Index",
					currentTitle: "High-Pass Filtering",
					nextTitle: "Equalizer Adjustments",
					pageOrdinal: 1,
					pageCount: 2,
				},
			},
			options: { triggerTurn: true },
		});
		expect(typeof harness.sentMessages[0]?.message.content).toBe("string");
		expect(String(harness.sentMessages[0]?.message.content)).toContain("<system-notice>");
		expect(String(harness.sentMessages[0]?.message.content)).toContain("Write the current page now.");
		expect(harness.latestStatus()).toBe("[1/2] High-Pass Filtering");

		const renderer = harness.renderers.get(PAGER_NEXT_CUSTOM_TYPE);
		if (!renderer) throw new Error("Missing pager-next renderer");
		const component = renderer(
			{
				role: "custom",
				customType: PAGER_NEXT_CUSTOM_TYPE,
				content: "ignored",
				display: true,
				details: harness.sentMessages[0]?.message.details,
				timestamp: Date.now(),
			},
			{ expanded: true },
			activeTheme,
		);
		const rendered = Bun.stripANSI(component?.render(120).join("\n") ?? "");
		expect(rendered).toContain("Paging Next:");
		expect(rendered).toContain("Index -> High-Pass Filtering");
	});

	it("emits a visible pager-exit message without starting another turn", async () => {
		installTestTheme();
		const harness = createPagerHarness();
		appendPagerIndex(harness.sessionManager, "Pebble v3 Tuning", ["High-Pass Filtering", "Equalizer Adjustments"]);

		const command = harness.commands.get("pager:exit");
		if (!command) throw new Error("Missing pager:exit command");
		await command.handler("", harness.commandContext());

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toMatchObject({
			message: {
				customType: PAGER_EXIT_CUSTOM_TYPE,
				display: true,
				attribution: "user",
				details: { workflow: "Pebble v3 Tuning" },
			},
			options: undefined,
		});
		expect(harness.latestStatus()).toBeUndefined();

		const component = pagerExitRenderer(
			{
				role: "custom",
				customType: PAGER_EXIT_CUSTOM_TYPE,
				content: "ignored",
				display: true,
				details: { workflow: "Pebble v3 Tuning" },
				timestamp: Date.now(),
			},
			{ expanded: true },
			activeTheme,
		);
		const rendered = Bun.stripANSI(component?.render(120).join("\n") ?? "");
		expect(rendered).toContain("Paging Exit:");
		expect(rendered).toContain("Now leaving Pebble v3 Tuning");
	});

	it("treats pager:next on the final page as exit", async () => {
		const harness = createPagerHarness();
		appendPagerIndex(harness.sessionManager, "Solo", ["Only Page"]);
		harness.sessionManager.appendCustomMessageEntry(PAGER_NEXT_CUSTOM_TYPE, "next", true, undefined, "user");

		const command = harness.commands.get("pager:next");
		if (!command) throw new Error("Missing pager:next command");
		await command.handler("", harness.commandContext());

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.message.customType).toBe(PAGER_EXIT_CUSTOM_TYPE);
		expect(harness.sentMessages[0]?.options).toBeUndefined();
		expect(harness.latestStatus()).toBeUndefined();
	});
});

describe("pager-mode status synchronization", () => {
	it("activates status from an assistant index message on message_end", async () => {
		const harness = createPagerHarness();
		const message = createAssistantMessage(
			pagerIndex("Pebble v3 Tuning", ["High-Pass Filtering", "Equalizer Adjustments"]),
		);
		harness.sessionManager.appendMessage(message);

		await harness.emit("message_end", { type: "message_end", message });

		expect(harness.latestStatus()).toBe("[0/2] Pebble v3 Tuning: Index");
	});

	it("keeps status aligned with the branch after next, exit, and leaf rewinds", async () => {
		const harness = createPagerHarness();
		const indexId = appendPagerIndex(harness.sessionManager, "Pebble v3 Tuning", [
			"High-Pass Filtering",
			"Equalizer Adjustments",
		]);
		const nextId = harness.sessionManager.appendCustomMessageEntry(
			PAGER_NEXT_CUSTOM_TYPE,
			"next",
			true,
			undefined,
			"user",
		);

		await harness.emit("session_start", { type: "session_start" });
		expect(harness.latestStatus()).toBe("[1/2] High-Pass Filtering");

		harness.sessionManager.branch(indexId);
		const exitId = harness.sessionManager.appendCustomMessageEntry(
			PAGER_EXIT_CUSTOM_TYPE,
			"exit",
			true,
			undefined,
			"user",
		);
		await harness.emit("session_tree", { type: "session_tree", oldLeafId: nextId, newLeafId: exitId });
		expect(harness.latestStatus()).toBeUndefined();

		harness.sessionManager.branch(nextId);
		await harness.emit("session_tree", { type: "session_tree", oldLeafId: exitId, newLeafId: nextId });
		expect(harness.latestStatus()).toBe("[1/2] High-Pass Filtering");
	});
});

describe("pager-mode built-in loading", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads pager mode into createAgentSession and refreshes status on session_start", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pager-mode-"));
		tempDirs.push(tempDir);
		const cwd = path.join(tempDir, "project");
		const agentDir = path.join(tempDir, "agent");
		fs.mkdirSync(cwd, { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });

		const sessionManager = SessionManager.inMemory(cwd);
		appendPagerIndex(sessionManager, "Pebble v3 Tuning", ["High-Pass Filtering", "Equalizer Adjustments"]);
		const statuses: StatusRecord[] = [];

		const { session } = await createAgentSession({
			cwd,
			agentDir,
			sessionManager,
			settings: Settings.isolated(),
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});

		try {
			const runner = session.extensionRunner;
			if (!runner) throw new Error("Missing extension runner");

			runner.initialize(
				{
					sendMessage: () => {},
					sendUserMessage: () => {},
					appendEntry: () => {},
					setLabel: () => {},
					getActiveTools: () => [],
					getAllTools: () => [],
					setActiveTools: async () => {},
					getCommands: () => [],
					setModel: async () => false,
					getThinkingLevel: () => undefined,
					setThinkingLevel: () => {},
					getSessionName: () => undefined,
					setSessionName: async () => {},
				},
				{
					getModel: () => undefined,
					isIdle: () => true,
					abort: () => {},
					hasPendingMessages: () => false,
					shutdown: () => {},
					getContextUsage: () => undefined,
					compact: async () => {},
					getSystemPrompt: () => [],
				},
				undefined,
				{
					select: async () => undefined,
					confirm: async () => false,
					input: async () => undefined,
					notify: () => {},
					onTerminalInput: () => () => {},
					setStatus: (key, text) => statuses.push({ key, text }),
					setWorkingMessage: () => {},
					setWidget: () => {},
					setFooter: () => {},
					setHeader: () => {},
					setTitle: () => {},
					custom: async () => undefined as never,
					setEditorText: () => {},
					pasteToEditor: () => {},
					getEditorText: () => "",
					editor: async () => undefined,
					addAutocompleteProvider: () => {},
					setEditorComponent: () => {},
					theme: undefined as never,
					getAllThemes: async () => [],
					getTheme: async () => undefined,
					setTheme: async () => ({ success: false, error: "unsupported" }),
					getToolsExpanded: () => false,
					setToolsExpanded: () => {},
				} satisfies ExtensionUIContext,
			);

			const commandNames = runner.getRegisteredCommands().map(command => command.name);
			expect(commandNames).toContain("pager:next");
			expect(commandNames).toContain("pager:exit");
			expect(runner.getMessageRenderer(PAGER_NEXT_CUSTOM_TYPE)).toBeDefined();
			expect(runner.getMessageRenderer(PAGER_EXIT_CUSTOM_TYPE)).toBeDefined();

			await runner.emit({ type: "session_start" });
			expect(statuses).toContainEqual({ key: PAGER_STATUS_KEY, text: "[0/2] Pebble v3 Tuning: Index" });
		} finally {
			await session.dispose();
		}
	});
});
