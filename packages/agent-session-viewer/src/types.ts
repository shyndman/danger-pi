import type { SessionEntry, SessionHeader } from "@oh-my-pi/pi-coding-agent";

export type PersistedFileEntry = SessionEntry | SessionHeader;

export type ViewerToolArgs = Record<string, unknown>;

export interface ViewerTextContent {
	type: "text";
	text: string;
	variant: "normal" | "thinking" | "dim";
}

export interface ViewerImageContent {
	type: "image";
	data?: string;
	mimeType?: string;
	path?: string;
}

export type ViewerContent = ViewerTextContent | ViewerImageContent;

export interface HeaderState {
	agentLabel: string;
	modeLabel: "follow" | "snapshot";
	cwd?: string;
	sessionLabel?: string;
	model?: string;
	thinking?: string | null;
	serviceTier?: string | null;
}

export interface ToolCallMetadata {
	toolName: string;
	intent?: string;
	displayArgs?: ViewerToolArgs;
}

export interface UserRow {
	kind: "user";
	content: ViewerContent[];
}

export interface AssistantRow {
	kind: "assistant";
	content: ViewerContent[];
}

export interface ToolRow {
	kind: "tool";
	phase: "call" | "result";
	toolCallId?: string;
	toolName: string;
	intent?: string;
	displayArgs?: ViewerToolArgs;
	isError?: boolean;
	content: ViewerContent[];
}

export interface NoticeRow {
	kind: "notice";
	message: string;
}

export type ViewerRow = UserRow | AssistantRow | ToolRow | NoticeRow;

export interface NormalizeState {
	header: HeaderState;
	toolCalls: Map<string, ToolCallMetadata>;
	hasRendered: boolean;
}

export interface NormalizeOptions {
	phase: "initial" | "follow";
}

export interface SessionReadState {
	path: string;
	offset: number;
	processedOffset: number;
	pendingFragment: string;
	fileId: string;
}

export interface SessionReadResult {
	entries: PersistedFileEntry[];
	state: SessionReadState;
}

export interface SessionReadUpdate {
	entries: PersistedFileEntry[];
	state: SessionReadState;
	changed: boolean;
}
