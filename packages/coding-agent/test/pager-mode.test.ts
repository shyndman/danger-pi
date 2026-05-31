import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { matchesKey, type TUI } from "@oh-my-pi/pi-tui";
import { Settings } from "../src/config/settings";
import {
	createPagerModeExtension,
	PAGER_EXIT_CUSTOM_TYPE,
	PAGER_INDEX_CUSTOM_TYPE,
	PAGER_INDEX_TOOL_NAME,
	PAGER_NEXT_CUSTOM_TYPE,
	PAGER_STATUS_KEY,
	pagerExitRenderer,
	reconstructPagerState,
} from "../src/danger-pi/pager-mode";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionShortcut,
	ExtensionUIContext,
	MessageRenderer,
	RegisteredCommand,
	ToolDefinition,
	ToolRenderResultOptions,
} from "../src/extensibility/extensions";
import { ToolExecutionComponent } from "../src/modes/components/tool-execution";
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

function appendPagerIndexState(sessionManager: SessionManager, title: string, pages: string[]): string {
	return sessionManager.appendCustomEntry(PAGER_INDEX_CUSTOM_TYPE, { title, pages });
}

interface SentMessageCall {
	message: {
		customType: string;
		content: string | unknown[];
		display: boolean;
		details?: unknown;
		attribution?: string;
	};
	options:
		| {
				triggerTurn?: boolean;
				deliverAs?: "steer" | "followUp" | "nextTurn";
		  }
		| undefined;
}

interface StatusRecord {
	key: string;
	text: string | undefined;
}

interface NotificationRecord {
	message: string;
	type: "info" | "warning" | "error" | undefined;
}

function renderComponent(component: { render(width: number): readonly string[] } | undefined): string {
	return Bun.stripANSI(component?.render(120).join("\n") ?? "");
}

function createPagerHarness(sessionManager: SessionManager = SessionManager.inMemory()) {
	const commands = new Map<string, RegisteredCommand>();
	const renderers = new Map<string, MessageRenderer>();
	const tools = new Map<string, ToolDefinition>();
	const shortcuts = new Map<string, ExtensionShortcut>();
	const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<void> | void>>();
	const sentMessages: SentMessageCall[] = [];
	const statuses: StatusRecord[] = [];
	const notifications: NotificationRecord[] = [];
	let idle = true;

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
		isIdle: () => idle,
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
		registerTool(tool: ToolDefinition): void {
			tools.set(tool.name, tool);
		},
		registerShortcut(
			shortcut: ExtensionShortcut["shortcut"],
			options: Omit<ExtensionShortcut, "shortcut" | "extensionPath">,
		): void {
			shortcuts.set(shortcut, { shortcut, extensionPath: "pager-mode.test", ...options });
		},
		sendMessage(message: SentMessageCall["message"], options?: SentMessageCall["options"]): void {
			sentMessages.push({ message, options });
		},
		appendEntry(customType: string, data?: unknown): void {
			sessionManager.appendCustomEntry(customType, data);
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
		setIdle: (nextIdle: boolean) => {
			idle = nextIdle;
		},
		shortcuts,
		statuses,
		tools,
	};
}

describe("pager-mode reconstruction", () => {
	it("reconstructs the active page from persisted pager state plus pager-next messages", () => {
		const sessionManager = SessionManager.inMemory();
		appendPagerIndexState(sessionManager, "Pebble v3 Tuning", ["High-Pass Filtering", "Equalizer Adjustments"]);
		sessionManager.appendCustomMessageEntry(PAGER_NEXT_CUSTOM_TYPE, "next", true, undefined, "user");

		expect(reconstructPagerState(sessionManager.getBranch())).toEqual({
			mode: "page",
			title: "Pebble v3 Tuning",
			pages: ["High-Pass Filtering", "Equalizer Adjustments"],
			pageCount: 2,
			pageOrdinal: 1,
			pageTitle: "High-Pass Filtering",
		});
	});

	it("ignores stray pager control messages with no reachable pager index state", () => {
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
		appendPagerIndexState(sessionManager, "Solo", ["Only Page"]);
		sessionManager.appendCustomMessageEntry(PAGER_NEXT_CUSTOM_TYPE, "next", true, undefined, "user");
		sessionManager.appendCustomMessageEntry(PAGER_NEXT_CUSTOM_TYPE, "next", true, undefined, "user");

		expect(reconstructPagerState(sessionManager.getBranch())).toBeNull();
	});
});

describe("pager_index tool flow", () => {
	it("stores pager state, queues a hidden next-turn request, and updates status immediately", async () => {
		const harness = createPagerHarness();
		const tool = harness.tools.get(PAGER_INDEX_TOOL_NAME);
		if (!tool) throw new Error("Missing pager_index tool");

		const result = await tool.execute(
			"tool-1",
			{ title: "Pager Tool Flow", pages: ["Proposed flow", "Visuals", "Implementation"] },
			undefined,
			undefined,
			harness.baseContext,
		);

		expect(result.content).toEqual([
			{
				type: "text",
				text: "Pager index stored. The runtime already queued the first page request for the next turn. End this response now.",
			},
		]);
		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toMatchObject({
			message: {
				customType: PAGER_NEXT_CUSTOM_TYPE,
				display: false,
				attribution: "user",
				details: {
					title: "Pager Tool Flow",
					previousTitle: "Index",
					currentTitle: "Proposed flow",
					nextTitle: "Visuals",
					pageOrdinal: 1,
					pageCount: 3,
				},
			},
			options: { triggerTurn: true, deliverAs: "nextTurn" },
		});
		expect(harness.latestStatus()).toBe("[1/3] Proposed flow");

		expect(reconstructPagerState(harness.sessionManager.getBranch())).toEqual({
			mode: "index",
			title: "Pager Tool Flow",
			pages: ["Proposed flow", "Visuals", "Implementation"],
			pageCount: 3,
		});
	});

	it("renders a compact index control for pager_index results", async () => {
		installTestTheme();
		const harness = createPagerHarness();
		const tool = harness.tools.get(PAGER_INDEX_TOOL_NAME);
		if (!tool) throw new Error("Missing pager_index tool");

		const result = await tool.execute(
			"tool-1",
			{ title: "Pager Tool Flow", pages: ["Proposed flow", "Visuals"] },
			undefined,
			undefined,
			harness.baseContext,
		);
		const renderOptions: ToolRenderResultOptions = { expanded: true, isPartial: false };
		const rendered = renderComponent(
			tool.renderResult?.(result, renderOptions, activeTheme, {
				title: "Pager Tool Flow",
				pages: ["Proposed flow", "Visuals"],
			}),
		);

		expect(rendered).toContain("Pager Tool Flow");
		expect(rendered).toContain("2 pages");
		expect(rendered).toContain("1. Proposed flow");
		expect(rendered).toContain("2. Visuals");
	});

	it("renders a single pager index component after the tool result lands", async () => {
		installTestTheme();
		const harness = createPagerHarness();
		const tool = harness.tools.get(PAGER_INDEX_TOOL_NAME);
		if (!tool) throw new Error("Missing pager_index tool");
		const renderableTool = tool as unknown as AgentTool;

		const component = new ToolExecutionComponent(
			PAGER_INDEX_TOOL_NAME,
			{ title: "Pager Tool Flow", pages: ["Proposed flow", "Visuals"] },
			{},
			renderableTool,
			{ requestRender() {} } as TUI,
			harness.sessionManager.getCwd(),
		);
		const before = renderComponent(component);
		expect(before.match(/Pager Tool Flow/g)?.length ?? 0).toBe(1);

		const result = await tool.execute(
			"tool-1",
			{ title: "Pager Tool Flow", pages: ["Proposed flow", "Visuals"] },
			undefined,
			undefined,
			harness.baseContext,
		);
		component.updateResult(result, false);

		const after = renderComponent(component);
		expect(after.match(/Pager Tool Flow/g)?.length ?? 0).toBe(1);
	});
});

describe("pager-mode commands, shortcuts, and renderers", () => {
	it("emits a visible pager-next message, renders the page-turn copy, and advances status immediately", async () => {
		installTestTheme();
		const harness = createPagerHarness();
		appendPagerIndexState(harness.sessionManager, "Pebble v3 Tuning", [
			"High-Pass Filtering",
			"Equalizer Adjustments",
		]);

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
					title: "Pebble v3 Tuning",
					previousTitle: "Index",
					currentTitle: "High-Pass Filtering",
					nextTitle: "Equalizer Adjustments",
					pageOrdinal: 1,
					pageCount: 2,
				},
			},
			options: { triggerTurn: true },
		});
		expect(harness.latestStatus()).toBe("[1/2] High-Pass Filtering");

		const renderer = harness.renderers.get(PAGER_NEXT_CUSTOM_TYPE);
		if (!renderer) throw new Error("Missing pager-next renderer");
		const rendered = renderComponent(
			renderer(
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
			),
		);
		expect(rendered).toContain("Page Turn");
		expect(rendered).toContain("Now viewing High-Pass Filtering");
		expect(rendered).not.toContain("Paging Next:");
	});

	it("uses Ctrl+J to trigger the same visible pager-next action when idle", () => {
		const harness = createPagerHarness();
		appendPagerIndexState(harness.sessionManager, "Pebble v3 Tuning", [
			"High-Pass Filtering",
			"Equalizer Adjustments",
		]);
		const shortcut = harness.shortcuts.get("ctrl+j");
		if (!shortcut) throw new Error("Missing Ctrl+J pager shortcut");

		shortcut.handler(harness.baseContext);

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]?.message.customType).toBe(PAGER_NEXT_CUSTOM_TYPE);
		expect(harness.sentMessages[0]?.message.display).toBe(true);
		expect(harness.latestStatus()).toBe("[1/2] High-Pass Filtering");
	});

	it("uses a Ctrl+J key sequence that stays distinct from Enter", () => {
		expect(matchesKey("\u001b[106;5u", "ctrl+j")).toBe(true);
		expect(matchesKey("\u001b[106;5u", "enter")).toBe(false);
	});

	it("does not page forward from Ctrl+J while a response is still running", () => {
		const harness = createPagerHarness();
		appendPagerIndexState(harness.sessionManager, "Pebble v3 Tuning", [
			"High-Pass Filtering",
			"Equalizer Adjustments",
		]);
		harness.setIdle(false);
		const shortcut = harness.shortcuts.get("ctrl+j");
		if (!shortcut) throw new Error("Missing Ctrl+J pager shortcut");

		shortcut.handler(harness.baseContext);

		expect(harness.sentMessages).toHaveLength(0);
		expect(harness.notifications).toContainEqual({
			message: "Wait for the current response to finish before turning the page",
			type: "info",
		});
	});

	it("emits a visible pager-exit message without starting another turn", async () => {
		installTestTheme();
		const harness = createPagerHarness();
		appendPagerIndexState(harness.sessionManager, "Pebble v3 Tuning", [
			"High-Pass Filtering",
			"Equalizer Adjustments",
		]);

		const command = harness.commands.get("pager:exit");
		if (!command) throw new Error("Missing pager:exit command");
		await command.handler("", harness.commandContext());

		expect(harness.sentMessages).toHaveLength(1);
		expect(harness.sentMessages[0]).toMatchObject({
			message: {
				customType: PAGER_EXIT_CUSTOM_TYPE,
				display: true,
				attribution: "user",
				details: { title: "Pebble v3 Tuning" },
			},
			options: undefined,
		});
		expect(harness.latestStatus()).toBeUndefined();

		const rendered = renderComponent(
			pagerExitRenderer(
				{
					role: "custom",
					customType: PAGER_EXIT_CUSTOM_TYPE,
					content: "ignored",
					display: true,
					details: { title: "Pebble v3 Tuning" },
					timestamp: Date.now(),
				},
				{ expanded: true },
				activeTheme,
			),
		);
		expect(rendered).toContain("Paging Exit");
		expect(rendered).toContain("Now leaving Pebble v3 Tuning");
	});

	it("treats pager:next on the final page as exit", async () => {
		const harness = createPagerHarness();
		appendPagerIndexState(harness.sessionManager, "Solo", ["Only Page"]);
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
	it("activates status from persisted pager state on session_start", async () => {
		const harness = createPagerHarness();
		appendPagerIndexState(harness.sessionManager, "Pebble v3 Tuning", [
			"High-Pass Filtering",
			"Equalizer Adjustments",
		]);

		await harness.emit("session_start", { type: "session_start" });

		expect(harness.latestStatus()).toBe("[0/2] Pebble v3 Tuning: Index");
	});

	it("keeps status aligned with the branch after next, exit, and leaf rewinds", async () => {
		const harness = createPagerHarness();
		const indexId = appendPagerIndexState(harness.sessionManager, "Pebble v3 Tuning", [
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

	it("keeps the active page status when pager-next ends before branch persistence catches up", async () => {
		const harness = createPagerHarness();
		const tool = harness.tools.get(PAGER_INDEX_TOOL_NAME);
		if (!tool) throw new Error("Missing pager_index tool");

		await tool.execute(
			"tool-1",
			{ title: "Three Dog Concepts", pages: ["Working Dog", "Companion Dog", "Mythic Dog"] },
			undefined,
			undefined,
			harness.baseContext,
		);

		const nextMessage = harness.sentMessages[0]?.message;
		if (!nextMessage) throw new Error("Missing queued pager-next message");

		await harness.emit("message_end", {
			type: "message_end",
			message: {
				role: "custom",
				customType: PAGER_NEXT_CUSTOM_TYPE,
				content: nextMessage.content,
				display: nextMessage.display,
				details: nextMessage.details,
				timestamp: Date.now(),
			},
		});

		expect(harness.latestStatus()).toBe("[1/3] Working Dog");
		expect(reconstructPagerState(harness.sessionManager.getBranch())).toEqual({
			mode: "index",
			title: "Three Dog Concepts",
			pages: ["Working Dog", "Companion Dog", "Mythic Dog"],
			pageCount: 3,
		});
	});
});

describe("pager-mode built-in loading", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads pager mode into createAgentSession with tool, shortcut, renderers, commands, and status refresh", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pager-mode-"));
		tempDirs.push(tempDir);
		const cwd = path.join(tempDir, "project");
		const agentDir = path.join(tempDir, "agent");
		fs.mkdirSync(cwd, { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });

		const sessionManager = SessionManager.inMemory(cwd);
		appendPagerIndexState(sessionManager, "Pebble v3 Tuning", ["High-Pass Filtering", "Equalizer Adjustments"]);
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
			expect(runner.getAllRegisteredTools().some(tool => tool.definition.name === PAGER_INDEX_TOOL_NAME)).toBe(true);
			expect(runner.getShortcuts().has("ctrl+j")).toBe(true);
			expect(runner.getMessageRenderer(PAGER_NEXT_CUSTOM_TYPE)).toBeDefined();
			expect(runner.getMessageRenderer(PAGER_EXIT_CUSTOM_TYPE)).toBeDefined();

			await runner.emit({ type: "session_start" });
			expect(statuses).toContainEqual({ key: PAGER_STATUS_KEY, text: "[0/2] Pebble v3 Tuning: Index" });
		} finally {
			await session.dispose();
		}
	});
});
