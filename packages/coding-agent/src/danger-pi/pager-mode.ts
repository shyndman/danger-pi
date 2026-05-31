import type { Component } from "@oh-my-pi/pi-tui";
import { Box, Markdown, Spacer, Text } from "@oh-my-pi/pi-tui";
import { prompt } from "@oh-my-pi/pi-utils";
import * as z from "zod/v4";
import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
	MessageRenderer,
	ToolDefinition,
} from "../extensibility/extensions";
import { getMarkdownTheme, type Theme } from "../modes/theme/theme";
import type { CustomEntry, CustomMessageEntry, SessionEntry } from "../session/session-entries";
import type { ReadonlySessionManager } from "../session/session-manager";
import pagerExitTemplate from "./pager-exit.md" with { type: "text" };
import pagerNextTemplate from "./pager-next.md" with { type: "text" };

export const PAGER_STATUS_KEY = "pager";
export const PAGER_INDEX_TOOL_NAME = "pager_index";
export const PAGER_INDEX_CUSTOM_TYPE = "pager-index-state";
export const PAGER_NEXT_CUSTOM_TYPE = "pager-next";
export const PAGER_EXIT_CUSTOM_TYPE = "pager-exit";

const PAGER_NEXT_SHORTCUT = "ctrl+j";

const pagerIndexSchema = z.object({
	title: z.string().trim().min(1).describe("Short pager title shown in status and controls."),
	pages: z
		.array(z.string().trim().min(1).describe("Ordered title for a future pager page."))
		.min(1)
		.describe("Ordered page titles for the upcoming pager responses."),
});

export type PagerIndexDefinition = z.infer<typeof pagerIndexSchema>;

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
	title: string;
	previousTitle: string;
	currentTitle: string;
	nextTitle?: string;
	pageOrdinal: number;
	pageCount: number;
}

export interface PagerExitDetails {
	title: string;
}

interface PagerCommandAction {
	type: "next" | "exit";
	messageType: typeof PAGER_NEXT_CUSTOM_TYPE | typeof PAGER_EXIT_CUSTOM_TYPE;
	content: string;
	details: PagerNextDetails | PagerExitDetails;
	status: string | undefined;
	triggerTurn: boolean;
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
		if (!isPagerIndexEntry(entry)) {
			continue;
		}
		const definition = readPagerIndexDefinition(entry.data);
		if (!definition) {
			continue;
		}
		return pagerStateFromAdvanceCount(definition, advanceCount);
	}

	return null;
}

export function reconstructPagerStateFromSession(sessionManager: ReadonlySessionManager): PagerState | null {
	return reconstructPagerState(sessionManager.getBranch());
}

export function formatPagerStatus(state: PagerState | null): string | undefined {
	if (!state) return undefined;
	if (state.mode === "index") {
		return `[0/${state.pageCount}] ${state.title}: Index`;
	}
	return `[${state.pageOrdinal}/${state.pageCount}] ${state.pageTitle}`;
}

function formatPagerNextStatus(details: PagerNextDetails): string {
	return `[${details.pageOrdinal}/${details.pageCount}] ${details.currentTitle}`;
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
		title: state.title,
		previousTitle,
		currentTitle,
		nextTitle,
		pageOrdinal: targetOrdinal,
		pageCount: state.pageCount,
	};
	const content = prompt.render(pagerNextTemplate, {
		title_attr: escapePagerAttribute(state.title),
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
	const details: PagerExitDetails = { title: state.title };
	return {
		type: "exit",
		messageType: PAGER_EXIT_CUSTOM_TYPE,
		content: prompt.render(pagerExitTemplate, {
			title_attr: escapePagerAttribute(state.title),
		}),
		details,
		status: undefined,
		triggerTurn: false,
	};
}

export const pagerNextRenderer: MessageRenderer<PagerNextDetails> = (message, _options, renderTheme) => {
	const details = readPagerNextDetails(message.details);
	if (!details) return undefined;
	return buildPagerMarkdownFrame(renderTheme, `*Page Turn*\nNow viewing **${escapeMarkdown(details.currentTitle)}**`);
};

export const pagerExitRenderer: MessageRenderer<PagerExitDetails> = (message, _options, renderTheme) => {
	const details = readPagerExitDetails(message.details);
	if (!details) return undefined;
	return buildPagerMarkdownFrame(renderTheme, `*Paging Exit*\nNow leaving **${escapeMarkdown(details.title)}**`);
};

function createPagerIndexTool(api: ExtensionAPI): ToolDefinition<typeof pagerIndexSchema, PagerIndexState> {
	return {
		name: PAGER_INDEX_TOOL_NAME,
		label: "Pager Index",
		mergeCallAndResult: true,
		description:
			"Initialize a paged response. Call this once before a multi-page sequence, passing the pager title and ordered page titles only. After calling it, do not write page content in the same turn: the runtime will automatically queue the first page request for the next turn.",
		parameters: pagerIndexSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const definition = readPagerIndexDefinition(params);
			if (!definition) {
				throw new Error("Invalid pager index payload");
			}
			const indexState = buildPagerIndexState(definition);
			const nextAction = buildPagerNextAction(indexState);
			if (nextAction?.type !== "next") {
				throw new Error("Unable to queue the first pager page");
			}

			api.appendEntry(PAGER_INDEX_CUSTOM_TYPE, definition);
			ctx.ui.setStatus(PAGER_STATUS_KEY, nextAction.status);
			api.sendMessage(
				{
					customType: nextAction.messageType,
					content: nextAction.content,
					display: false,
					details: nextAction.details,
					attribution: "user",
				},
				{ deliverAs: "nextTurn", triggerTurn: true },
			);

			return {
				content: [
					{
						type: "text",
						text: "Pager index stored. The runtime already queued the first page request for the next turn. End this response now.",
					},
				],
				details: indexState,
			};
		},
		renderCall(args, _options, renderTheme): Component {
			return buildPagerIndexFrame(renderTheme, buildPagerIndexState(args));
		},
		renderResult(result, _options, renderTheme, args): Component {
			const state = readPagerIndexState(result.details) ?? (args ? buildPagerIndexState(args) : null);
			if (!state) {
				return new Text(renderTheme.fg("muted", "Pager index stored."), 0, 0);
			}
			return buildPagerIndexFrame(renderTheme, state);
		},
	};
}

export const createPagerModeExtension: ExtensionFactory = api => {
	api.registerTool(createPagerIndexTool(api));
	registerPagerNavigation(api);
	api.registerMessageRenderer(PAGER_NEXT_CUSTOM_TYPE, pagerNextRenderer);
	api.registerMessageRenderer(PAGER_EXIT_CUSTOM_TYPE, pagerExitRenderer);
	registerPagerStatusHooks(api);
};

function refreshPagerStatus(ctx: ExtensionContext): void {
	ctx.ui.setStatus(PAGER_STATUS_KEY, formatPagerStatus(reconstructPagerStateFromSession(ctx.sessionManager)));
}

function sendPagerAction(
	api: ExtensionAPI,
	ctx: ExtensionContext,
	action: PagerCommandAction | null,
	options?: { display?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
): void {
	if (!action) {
		ctx.ui.notify("Pager mode is not active", "info");
		return;
	}
	ctx.ui.setStatus(PAGER_STATUS_KEY, action.status);
	api.sendMessage(
		{
			customType: action.messageType,
			content: action.content,
			display: options?.display ?? true,
			details: action.details,
			attribution: "user",
		},
		action.triggerTurn || options?.deliverAs !== undefined
			? {
					triggerTurn: action.triggerTurn,
					deliverAs: options?.deliverAs,
				}
			: undefined,
	);
}

function registerPagerNavigation(api: ExtensionAPI): void {
	api.registerCommand("pager:next", {
		description: "Advance the active pager to the next page.",
		async handler(_args, ctx): Promise<void> {
			await ctx.waitForIdle();
			sendPagerAction(api, ctx, buildPagerNextAction(reconstructPagerStateFromSession(ctx.sessionManager)));
		},
	});

	api.registerCommand("pager:exit", {
		description: "Leave the active pager.",
		async handler(_args, ctx): Promise<void> {
			await ctx.waitForIdle();
			sendPagerAction(api, ctx, buildPagerExitAction(reconstructPagerStateFromSession(ctx.sessionManager)));
		},
	});

	api.registerShortcut(PAGER_NEXT_SHORTCUT, {
		description: "Advance the active pager to the next page.",
		handler(ctx): void {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current response to finish before turning the page", "info");
				return;
			}
			sendPagerAction(api, ctx, buildPagerNextAction(reconstructPagerStateFromSession(ctx.sessionManager)));
		},
	});
}

function registerPagerStatusHooks(api: ExtensionAPI): void {
	api.on("session_start", (_event, ctx) => refreshPagerStatus(ctx));
	api.on("session_switch", (_event, ctx) => refreshPagerStatus(ctx));
	api.on("session_branch", (_event, ctx) => refreshPagerStatus(ctx));
	api.on("session_tree", (_event, ctx) => refreshPagerStatus(ctx));
	api.on("session_shutdown", (_event, ctx) => ctx.ui.setStatus(PAGER_STATUS_KEY, undefined));
	api.on("message_end", (event, ctx) => {
		if (event.message.role !== "custom" || !isPagerControlType(event.message.customType)) {
			return;
		}
		if (event.message.customType === PAGER_NEXT_CUSTOM_TYPE) {
			const details = readPagerNextDetails(event.message.details);
			if (details) {
				ctx.ui.setStatus(PAGER_STATUS_KEY, formatPagerNextStatus(details));
				return;
			}
		}
		if (event.message.customType === PAGER_EXIT_CUSTOM_TYPE) {
			ctx.ui.setStatus(PAGER_STATUS_KEY, undefined);
			return;
		}
		refreshPagerStatus(ctx);
	});
}

function buildPagerIndexState(definition: PagerIndexDefinition): PagerIndexState {
	return {
		mode: "index",
		title: definition.title,
		pages: definition.pages,
		pageCount: definition.pages.length,
	};
}

function readPagerIndexDefinition(value: unknown): PagerIndexDefinition | null {
	const parsed = pagerIndexSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

function readPagerIndexState(value: unknown): PagerIndexState | null {
	const definition = readPagerIndexDefinition(value);
	return definition ? buildPagerIndexState(definition) : null;
}

function pagerStateFromAdvanceCount(definition: PagerIndexDefinition, advanceCount: number): PagerState | null {
	const pageCount = definition.pages.length;
	if (pageCount === 0) return null;
	if (advanceCount === 0) {
		return buildPagerIndexState(definition);
	}
	if (advanceCount > pageCount) {
		return null;
	}
	return {
		mode: "page",
		title: definition.title,
		pages: definition.pages,
		pageCount,
		pageOrdinal: advanceCount,
		pageTitle: definition.pages[advanceCount - 1]!,
	};
}

function isPagerIndexEntry(entry: SessionEntry): entry is CustomEntry<PagerIndexDefinition> {
	return entry.type === "custom" && entry.customType === PAGER_INDEX_CUSTOM_TYPE;
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

function buildPagerIndexFrame(renderTheme: Theme, state: PagerIndexState): Box {
	const box = new Box(1, 1, text => renderTheme.bg("customMessageBg", text));
	const pageCountLabel = `${state.pageCount} ${state.pageCount === 1 ? "page" : "pages"}`;
	box.addChild(new Text(renderTheme.fg("customMessageLabel", renderTheme.bold(state.title)), 0, 0));
	box.addChild(new Text(renderTheme.fg("muted", pageCountLabel), 0, 0));
	box.addChild(new Spacer(1));
	for (let index = 0; index < state.pages.length; index += 1) {
		const page = state.pages[index]!;
		box.addChild(new Text(renderTheme.fg("customMessageText", `${index + 1}. ${page}`), 0, 0));
	}
	return box;
}

function buildPagerMarkdownFrame(renderTheme: Theme, content: string): Box {
	const box = new Box(1, 1, text => renderTheme.bg("customMessageBg", text));
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
		typeof candidate.title !== "string" ||
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
		title: candidate.title,
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
	return typeof candidate.title === "string" ? { title: candidate.title } : null;
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

function escapeMarkdown(input: string): string {
	let output = "";
	for (let index = 0; index < input.length; index += 1) {
		const char = input[index]!;
		if (
			char === "\\" ||
			char === "*" ||
			char === "_" ||
			char === "`" ||
			char === "[" ||
			char === "]" ||
			char === "#"
		) {
			output += `\\${char}`;
			continue;
		}
		output += char;
	}
	return output;
}
