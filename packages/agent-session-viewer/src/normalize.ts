import * as path from "node:path";
import type {
	HeaderState,
	NormalizeOptions,
	NormalizeState,
	PersistedFileEntry,
	ToolCallMetadata,
	ViewerContent,
	ViewerRow,
	ViewerTextContent,
} from "./types";

interface PersistedMessage {
	role?: string;
	content?: string | unknown[];
	provider?: string;
	model?: string;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	details?: unknown;
}

interface PersistedToolCallBlock {
	type?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

interface PersistedImageBlock {
	type?: string;
	data?: string;
	mimeType?: string;
}

interface PersistedTextBlock {
	type?: string;
	text?: string;
}

interface PersistedThinkingBlock {
	type?: string;
	thinking?: string;
}

interface GenerateImageDetails {
	imagePaths?: string[];
	images?: Array<{ data?: string; mimeType?: string }>;
}

function asMessage(entry: PersistedFileEntry): PersistedMessage | undefined {
	if (entry.type !== "message") return undefined;
	return entry.message as PersistedMessage;
}

function isToolCallBlock(value: unknown): value is PersistedToolCallBlock {
	return typeof value === "object" && value !== null && (value as { type?: string }).type === "toolCall";
}

function isTextBlock(value: unknown): value is PersistedTextBlock {
	return typeof value === "object" && value !== null && (value as { type?: string }).type === "text";
}

function isThinkingBlock(value: unknown): value is PersistedThinkingBlock {
	return typeof value === "object" && value !== null && (value as { type?: string }).type === "thinking";
}

function isImageBlock(value: unknown): value is PersistedImageBlock {
	return typeof value === "object" && value !== null && (value as { type?: string }).type === "image";
}

function formatArgsLine(argumentsValue: Record<string, unknown> | undefined): string | undefined {
	if (!argumentsValue) return undefined;
	const keys = Object.keys(argumentsValue);
	if (keys.length === 0) return undefined;
	return JSON.stringify(argumentsValue);
}

function buildNotice(message: string): ViewerRow {
	return { kind: "notice", message };
}

function pushMessageText(
	target: ViewerContent[],
	text: string | undefined,
	variant: ViewerTextContent["variant"],
): void {
	if (!text || text.trim().length === 0) return;
	target.push({ type: "text", text, variant });
}

function pushMessageImage(target: ViewerContent[], block: PersistedImageBlock): void {
	target.push({ type: "image", data: block.data, mimeType: block.mimeType });
}

function buildToolResultContent(message: PersistedMessage): ViewerContent[] {
	const content: ViewerContent[] = [];
	if (Array.isArray(message.content)) {
		for (const block of message.content) {
			if (isTextBlock(block)) pushMessageText(content, block.text, "normal");
			if (isImageBlock(block)) pushMessageImage(content, block);
		}
	}
	const details = message.details as GenerateImageDetails | undefined;
	const detailImages = details?.images ?? [];
	for (let index = 0; index < detailImages.length; index++) {
		const image = detailImages[index];
		const imagePath = details?.imagePaths?.[index];
		content.push({ type: "image", data: image?.data, mimeType: image?.mimeType, path: imagePath });
	}
	if (detailImages.length === 0) {
		for (const imagePath of details?.imagePaths ?? []) {
			content.push({ type: "image", path: imagePath });
		}
	}
	if (content.length === 0) {
		content.push({ type: "text", text: "(no output)", variant: "dim" });
	}
	return content;
}

function handleMetadataChange(
	state: NormalizeState,
	entry: PersistedFileEntry,
	phase: NormalizeOptions["phase"],
): ViewerRow[] {
	if (entry.type === "model_change") {
		state.header.model = entry.model;
		if (phase === "follow" && state.hasRendered) {
			return [buildNotice(`model changed: ${entry.model}`)];
		}
		return [];
	}
	if (entry.type === "thinking_level_change") {
		state.header.thinking = entry.thinkingLevel ?? "off";
		if (phase === "follow" && state.hasRendered) {
			return [buildNotice(`thinking changed: ${entry.thinkingLevel ?? "off"}`)];
		}
		return [];
	}
	if (entry.type === "service_tier_change") {
		state.header.serviceTier = entry.serviceTier;
		if (phase === "follow" && state.hasRendered) {
			return [buildNotice(`service tier changed: ${entry.serviceTier ?? "default"}`)];
		}
	}
	return [];
}

function normalizeUserMessage(message: PersistedMessage): ViewerRow {
	const content: ViewerContent[] = [];
	if (typeof message.content === "string") {
		pushMessageText(content, message.content, "normal");
	} else if (Array.isArray(message.content)) {
		for (const block of message.content) {
			if (isTextBlock(block)) pushMessageText(content, block.text, "normal");
			if (isImageBlock(block)) pushMessageImage(content, block);
		}
	}
	return { kind: "user", content };
}

function normalizeAssistantMessage(message: PersistedMessage, state: NormalizeState): ViewerRow[] {
	const rows: ViewerRow[] = [];
	const blocks = Array.isArray(message.content) ? message.content : [];
	let assistantContent: ViewerContent[] = [];
	for (const block of blocks) {
		if (isTextBlock(block)) {
			pushMessageText(assistantContent, block.text, "normal");
			continue;
		}
		if (isThinkingBlock(block)) {
			pushMessageText(assistantContent, block.thinking, "thinking");
			continue;
		}
		if (isToolCallBlock(block)) {
			if (assistantContent.length > 0) {
				rows.push({ kind: "assistant", content: assistantContent });
				assistantContent = [];
			}
			const toolName = block.name ?? "unknown_tool";
			const metadata: ToolCallMetadata = {
				toolName,
				argsLine: formatArgsLine(block.arguments),
			};
			if (block.id) {
				state.toolCalls.set(block.id, metadata);
			}
			rows.push({
				kind: "tool",
				phase: "call",
				toolCallId: block.id,
				toolName,
				argsLine: metadata.argsLine,
				content: [],
			});
			continue;
		}
		rows.push(buildNotice(`unsupported assistant content encountered`));
	}
	if (assistantContent.length > 0) {
		rows.push({ kind: "assistant", content: assistantContent });
	}
	if (!state.header.model && message.provider && message.model) {
		state.header.model = `${message.provider}/${message.model}`;
	}
	return rows;
}

function normalizeToolResultMessage(message: PersistedMessage, state: NormalizeState): ViewerRow {
	const callMetadata = message.toolCallId ? state.toolCalls.get(message.toolCallId) : undefined;
	const toolName = message.toolName ?? callMetadata?.toolName;
	if (!toolName) {
		return buildNotice(`unmatched tool result encountered: ${message.toolCallId ?? "unknown call id"}`);
	}
	return {
		kind: "tool",
		phase: "result",
		toolCallId: message.toolCallId,
		toolName,
		argsLine: callMetadata?.argsLine,
		isError: message.isError === true,
		content: buildToolResultContent(message),
	};
}

function unsupportedEntryNotice(entry: PersistedFileEntry): ViewerRow {
	if (entry.type === "custom_message") {
		return buildNotice(`custom message encountered: ${entry.customType}`);
	}
	return buildNotice(`unsupported session entry encountered: ${entry.type}`);
}

export function createNormalizeState(sessionFilePath: string, follow: boolean): NormalizeState {
	const basename = path.basename(sessionFilePath, path.extname(sessionFilePath));
	const header: HeaderState = {
		agentLabel: basename,
		modeLabel: follow ? "follow" : "snapshot",
		sessionLabel: path.basename(sessionFilePath),
	};
	return { header, toolCalls: new Map(), hasRendered: false };
}

export function normalizeEntries(
	entries: PersistedFileEntry[],
	state: NormalizeState,
	options: NormalizeOptions,
): ViewerRow[] {
	const rows: ViewerRow[] = [];
	for (const entry of entries) {
		if (entry.type === "session") {
			state.header.cwd = entry.cwd;
			if (entry.title && entry.title.trim().length > 0) {
				state.header.sessionLabel = entry.title;
			}
			continue;
		}
		if (
			entry.type === "model_change" ||
			entry.type === "thinking_level_change" ||
			entry.type === "service_tier_change"
		) {
			rows.push(...handleMetadataChange(state, entry, options.phase));
			continue;
		}
		const message = asMessage(entry);
		if (!message) {
			rows.push(unsupportedEntryNotice(entry));
			continue;
		}
		if (message.role === "user") {
			rows.push(normalizeUserMessage(message));
			continue;
		}
		if (message.role === "assistant") {
			rows.push(...normalizeAssistantMessage(message, state));
			continue;
		}
		if (message.role === "toolResult") {
			rows.push(normalizeToolResultMessage(message, state));
			continue;
		}
		rows.push(buildNotice(`unsupported message role encountered: ${message.role ?? "unknown"}`));
	}
	return rows;
}
