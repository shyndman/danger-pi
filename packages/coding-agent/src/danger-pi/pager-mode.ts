import type { AssistantMessage, TextContent } from "@oh-my-pi/pi-ai";
import { Box, Markdown, Spacer, Text } from "@oh-my-pi/pi-tui";
import { prompt } from "@oh-my-pi/pi-utils";
import type {
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionFactory,
	MessageRenderer,
} from "../extensibility/extensions";
import { getMarkdownTheme, type Theme } from "../modes/theme/theme";
import type { CustomMessageEntry, SessionEntry } from "../session/session-entries";
import type { ReadonlySessionManager } from "../session/session-manager";
import pagerExitTemplate from "./pager-exit.md" with { type: "text" };
import pagerNextTemplate from "./pager-next.md" with { type: "text" };

export const PAGER_STATUS_KEY = "pager";
export const PAGER_NEXT_CUSTOM_TYPE = "pager-next";
export const PAGER_EXIT_CUSTOM_TYPE = "pager-exit";

const PAGER_INDEX_PATTERN = /<pager-index\s+title=(?:"([^"]+)"|'([^']+)')\s*>([\s\S]*?)<\/pager-index>/g;
const ORDERED_LIST_ITEM_PATTERN = /^(\d+)\.\s+(.+)$/;

export interface PagerIndexDefinition {
	workflow: string;
	pages: string[];
}

export interface PagerIndexState extends PagerIndexDefinition {
	mode: "index";
	pageCount: number;
}

export interface PagerPageState extends PagerIndexDefinition {
	mode: "page";
	pageCount: number;
	pageOrdinal: number;
	pageTitle: string;
}

export type PagerState = PagerIndexState | PagerPageState;

export interface PagerNextDetails {
	workflow: string;
	previousTitle: string;
	currentTitle: string;
	nextTitle?: string;
	pageOrdinal: number;
	pageCount: number;
}

export interface PagerExitDetails {
	workflow: string;
}

interface PagerCommandAction {
	type: "next" | "exit";
	messageType: typeof PAGER_NEXT_CUSTOM_TYPE | typeof PAGER_EXIT_CUSTOM_TYPE;
	content: string;
	details: PagerNextDetails | PagerExitDetails;
	status: string | undefined;
	triggerTurn: boolean;
}

export function parsePagerIndexContent(content: string): PagerIndexDefinition | null {
	let match: RegExpExecArray | null;
	let lastMatch: RegExpExecArray | null = null;
	PAGER_INDEX_PATTERN.lastIndex = 0;
	while (true) {
		match = PAGER_INDEX_PATTERN.exec(content);
		if (!match) break;
		lastMatch = match;
	}
	if (!lastMatch) return null;

	const workflow = (lastMatch[1] ?? lastMatch[2] ?? "").trim();
	if (!workflow) return null;

	const body = lastMatch[3]?.replace(/\r\n/g, "\n") ?? "";
	const pages: string[] = [];
	let expectedOrdinal = 1;
	for (const rawLine of body.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const item = ORDERED_LIST_ITEM_PATTERN.exec(line);
		if (!item) return null;
		const ordinal = Number.parseInt(item[1], 10);
		if (ordinal !== expectedOrdinal) return null;
		const title = item[2]?.trim();
		if (!title) return null;
		pages.push(title);
		expectedOrdinal += 1;
	}

	return pages.length > 0 ? { workflow, pages } : null;
}

export function parsePagerIndexMessage(message: AssistantMessage): PagerIndexDefinition | null {
	return parsePagerIndexContent(extractAssistantText(message));
}

export function reconstructPagerState(branch: SessionEntry[]): PagerState | null {
	let advanceCount = 0;

	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (isPagerExitEntry(entry)) {
			return null;
		}
		if (isPagerNextEntry(entry)) {
			advanceCount += 1;
			continue;
		}
		if (entry.type !== "message" || entry.message.role !== "assistant") {
			continue;
		}
		const parsed = parsePagerIndexMessage(entry.message);
		if (!parsed) continue;
		return pagerStateFromAdvanceCount(parsed, advanceCount);
	}

	return null;
}

export function reconstructPagerStateFromSession(sessionManager: ReadonlySessionManager): PagerState | null {
	return reconstructPagerState(sessionManager.getBranch());
}

export function formatPagerStatus(state: PagerState | null): string | undefined {
	if (!state) return undefined;
	if (state.mode === "index") {
		return `[0/${state.pageCount}] ${state.workflow}: Index`;
	}
	return `[${state.pageOrdinal}/${state.pageCount}] ${state.pageTitle}`;
}

export function buildPagerNextAction(state: PagerState | null): PagerCommandAction | null {
	if (!state) return null;
	if (state.mode === "page" && state.pageOrdinal >= state.pageCount) {
		return buildPagerExitAction(state);
	}

	const targetOrdinal = state.mode === "index" ? 1 : state.pageOrdinal + 1;
	const previousTitle = state.mode === "index" ? "Index" : state.pageTitle;
	const currentTitle = state.pages[targetOrdinal - 1];
	if (!currentTitle) return null;
	const nextTitle = state.pages[targetOrdinal];
	const details: PagerNextDetails = {
		workflow: state.workflow,
		previousTitle,
		currentTitle,
		nextTitle,
		pageOrdinal: targetOrdinal,
		pageCount: state.pageCount,
	};
	const content = prompt.render(pagerNextTemplate, {
		workflow_attr: escapePagerAttribute(state.workflow),
		page: String(targetOrdinal),
		page_count: String(state.pageCount),
		previous_title: escapePagerText(previousTitle),
		current_title: escapePagerText(currentTitle),
		next_title: nextTitle ? escapePagerText(nextTitle) : undefined,
	});

	return {
		type: "next",
		messageType: PAGER_NEXT_CUSTOM_TYPE,
		content,
		details,
		status: `[${targetOrdinal}/${state.pageCount}] ${currentTitle}`,
		triggerTurn: true,
	};
}

export function buildPagerExitAction(state: PagerState | null): PagerCommandAction | null {
	if (!state) return null;
	const details: PagerExitDetails = { workflow: state.workflow };
	return {
		type: "exit",
		messageType: PAGER_EXIT_CUSTOM_TYPE,
		content: prompt.render(pagerExitTemplate, {
			workflow_attr: escapePagerAttribute(state.workflow),
		}),
		details,
		status: undefined,
		triggerTurn: false,
	};
}

export const pagerNextRenderer: MessageRenderer<PagerNextDetails> = (message, _options, renderTheme) => {
	const details = readPagerNextDetails(message.details);
	if (!details) return undefined;
	return buildPagerRenderFrame(renderTheme, "Paging Next", `${details.previousTitle} -> ${details.currentTitle}`);
};

export const pagerExitRenderer: MessageRenderer<PagerExitDetails> = (message, _options, renderTheme) => {
	const details = readPagerExitDetails(message.details);
	if (!details) return undefined;
	return buildPagerRenderFrame(renderTheme, "Paging Exit", `Now leaving ${details.workflow}`);
};

export const createPagerModeExtension: ExtensionFactory = api => {
	const refreshStatus = (ctx: ExtensionContext): void => {
		ctx.ui.setStatus(PAGER_STATUS_KEY, formatPagerStatus(reconstructPagerStateFromSession(ctx.sessionManager)));
	};

	const runCommand = async (ctx: ExtensionCommandContext, action: PagerCommandAction | null): Promise<void> => {
		if (!action) {
			ctx.ui.notify("Pager mode is not active", "info");
			return;
		}
		ctx.ui.setStatus(PAGER_STATUS_KEY, action.status);
		api.sendMessage(
			{
				customType: action.messageType,
				content: action.content,
				display: true,
				details: action.details,
				attribution: "user",
			},
			action.triggerTurn ? { triggerTurn: true } : undefined,
		);
	};

	api.registerCommand("pager:next", {
		description: "Advance the active pager workflow to the next page.",
		async handler(_args, ctx): Promise<void> {
			await ctx.waitForIdle();
			await runCommand(ctx, buildPagerNextAction(reconstructPagerStateFromSession(ctx.sessionManager)));
		},
	});

	api.registerCommand("pager:exit", {
		description: "Leave the active pager workflow.",
		async handler(_args, ctx): Promise<void> {
			await ctx.waitForIdle();
			await runCommand(ctx, buildPagerExitAction(reconstructPagerStateFromSession(ctx.sessionManager)));
		},
	});

	api.registerMessageRenderer(PAGER_NEXT_CUSTOM_TYPE, pagerNextRenderer);
	api.registerMessageRenderer(PAGER_EXIT_CUSTOM_TYPE, pagerExitRenderer);

	api.on("session_start", (_event, ctx) => refreshStatus(ctx));
	api.on("session_switch", (_event, ctx) => refreshStatus(ctx));
	api.on("session_branch", (_event, ctx) => refreshStatus(ctx));
	api.on("session_tree", (_event, ctx) => refreshStatus(ctx));
	api.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(PAGER_STATUS_KEY, undefined));
	api.on("message_end", (event, ctx) => {
		if (event.message.role === "assistant") {
			refreshStatus(ctx);
			return;
		}
		if (event.message.role === "custom" && isPagerControlType(event.message.customType)) {
			refreshStatus(ctx);
		}
	});
};

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((part): part is TextContent & { text: string } => {
			return typeof part === "object" && part !== null && "text" in part && typeof part.text === "string";
		})
		.map(part => part.text)
		.join("\n");
}

function pagerStateFromAdvanceCount(definition: PagerIndexDefinition, advanceCount: number): PagerState | null {
	const pageCount = definition.pages.length;
	if (pageCount === 0) return null;
	if (advanceCount === 0) {
		return {
			mode: "index",
			workflow: definition.workflow,
			pages: definition.pages,
			pageCount,
		};
	}
	if (advanceCount > pageCount) {
		return null;
	}
	return {
		mode: "page",
		workflow: definition.workflow,
		pages: definition.pages,
		pageCount,
		pageOrdinal: advanceCount,
		pageTitle: definition.pages[advanceCount - 1]!,
	};
}

function isPagerNextEntry(entry: SessionEntry): entry is CustomMessageEntry<unknown> {
	return entry.type === "custom_message" && entry.customType === PAGER_NEXT_CUSTOM_TYPE;
}

function isPagerExitEntry(entry: SessionEntry): entry is CustomMessageEntry<unknown> {
	return entry.type === "custom_message" && entry.customType === PAGER_EXIT_CUSTOM_TYPE;
}

function isPagerControlType(customType: string): boolean {
	return customType === PAGER_NEXT_CUSTOM_TYPE || customType === PAGER_EXIT_CUSTOM_TYPE;
}

function buildPagerRenderFrame(renderTheme: Theme, label: string, content: string): Box {
	const box = new Box(1, 1, text => renderTheme.bg("customMessageBg", text));
	box.addChild(new Text(renderTheme.fg("customMessageLabel", renderTheme.bold(`${label}:`)), 0, 0));
	box.addChild(new Spacer(1));
	box.addChild(
		new Markdown(content, 0, 0, getMarkdownTheme(), {
			color: value => renderTheme.fg("customMessageText", value),
		}),
	);
	return box;
}

function readPagerNextDetails(details: unknown): PagerNextDetails | null {
	if (typeof details !== "object" || details === null) return null;
	const candidate = details as Partial<PagerNextDetails>;
	if (
		typeof candidate.workflow !== "string" ||
		typeof candidate.previousTitle !== "string" ||
		typeof candidate.currentTitle !== "string" ||
		typeof candidate.pageOrdinal !== "number" ||
		typeof candidate.pageCount !== "number"
	) {
		return null;
	}
	if (candidate.nextTitle !== undefined && typeof candidate.nextTitle !== "string") {
		return null;
	}
	return {
		workflow: candidate.workflow,
		previousTitle: candidate.previousTitle,
		currentTitle: candidate.currentTitle,
		nextTitle: candidate.nextTitle,
		pageOrdinal: candidate.pageOrdinal,
		pageCount: candidate.pageCount,
	};
}

function readPagerExitDetails(details: unknown): PagerExitDetails | null {
	if (typeof details !== "object" || details === null) return null;
	const candidate = details as Partial<PagerExitDetails>;
	return typeof candidate.workflow === "string" ? { workflow: candidate.workflow } : null;
}

function escapePagerText(input: string): string {
	let firstEscapable = -1;
	for (let index = 0; index < input.length; index += 1) {
		const char = input.charCodeAt(index);
		if (char === 38 || char === 60 || char === 62) {
			firstEscapable = index;
			break;
		}
	}
	if (firstEscapable === -1) return input;

	let output = input.slice(0, firstEscapable);
	for (let index = firstEscapable; index < input.length; index += 1) {
		const char = input[index]!;
		if (char === "&") output += "&amp;";
		else if (char === "<") output += "&lt;";
		else if (char === ">") output += "&gt;";
		else output += char;
	}
	return output;
}

function escapePagerAttribute(input: string): string {
	let firstEscapable = -1;
	for (let index = 0; index < input.length; index += 1) {
		const char = input.charCodeAt(index);
		if (char === 34 || char === 38 || char === 39 || char === 60 || char === 62) {
			firstEscapable = index;
			break;
		}
	}
	if (firstEscapable === -1) return input;

	let output = input.slice(0, firstEscapable);
	for (let index = firstEscapable; index < input.length; index += 1) {
		const char = input[index]!;
		if (char === "&") output += "&amp;";
		else if (char === "<") output += "&lt;";
		else if (char === ">") output += "&gt;";
		else if (char === '"') output += "&quot;";
		else if (char === "'") output += "&apos;";
		else output += char;
	}
	return output;
}
