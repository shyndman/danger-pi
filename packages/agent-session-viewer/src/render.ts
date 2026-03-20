import * as path from "node:path";
import { renderStatusLine, type Theme, type ThemeColor } from "@oh-my-pi/pi-coding-agent";
import { Image, replaceTabs, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { HeaderState, ToolRow, ViewerContent, ViewerRow } from "./types";

type ViewerToolStatus = "success" | "error" | "warning" | "info" | "pending" | "running" | "aborted";

const DEFAULT_WIDTH = 100;
const TOOL_ARG_INDENT = "  ";
const AMBIGUOUS_STRING_VALUES = new Set(["true", "false", "null", "undefined"]);
const NUMERIC_STRING_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const LEADING_PUNCTUATION_PATTERN = /^[-?:,[\]{}#&*!|>'"%@`]/;

function wrapStyledText(text: string, width: number): string[] {
	const normalized = replaceTabs(text);
	return normalized.split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(10, width)));
}

function indent(level: number): string {
	return TOOL_ARG_INDENT.repeat(level);
}

function isStructuredObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shouldQuoteString(value: string): boolean {
	return (
		value.length === 0 ||
		/\s/.test(value) ||
		AMBIGUOUS_STRING_VALUES.has(value) ||
		NUMERIC_STRING_PATTERN.test(value) ||
		LEADING_PUNCTUATION_PATTERN.test(value)
	);
}

function formatScalar(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") {
		return String(value);
	}
	if (typeof value === "string") {
		return shouldQuoteString(value) ? JSON.stringify(value) : value;
	}
	return JSON.stringify(value);
}

function renderMultilineString(value: string, prefix: string, indentLevel: number): string[] {
	return [`${prefix}|`, ...value.split("\n").map(line => `${indent(indentLevel + 1)}${line}`)];
}

function renderNamedValue(key: string, value: unknown, indentLevel: number): string[] {
	const prefix = `${indent(indentLevel)}${key}: `;
	if (typeof value === "string" && value.includes("\n")) {
		return renderMultilineString(value, prefix, indentLevel);
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return [`${prefix}[]`];
		return [`${indent(indentLevel)}${key}:`, ...renderArrayItems(value, indentLevel + 1)];
	}
	if (isStructuredObject(value)) {
		const entries = Object.entries(value);
		if (entries.length === 0) return [`${prefix}{}`];
		return [`${indent(indentLevel)}${key}:`, ...renderObjectEntries(value, indentLevel + 1)];
	}
	return [`${prefix}${formatScalar(value)}`];
}

function renderArrayItems(value: unknown[], indentLevel: number): string[] {
	const lines: string[] = [];
	for (const item of value) {
		const prefix = `${indent(indentLevel)}- `;
		if (typeof item === "string" && item.includes("\n")) {
			lines.push(...renderMultilineString(item, prefix, indentLevel));
			continue;
		}
		if (Array.isArray(item)) {
			if (item.length === 0) {
				lines.push(`${prefix}[]`);
				continue;
			}
			lines.push(`${indent(indentLevel)}-`);
			lines.push(...renderArrayItems(item, indentLevel + 1));
			continue;
		}
		if (isStructuredObject(item)) {
			const objectLines = renderObjectEntries(item, indentLevel + 1);
			if (objectLines.length === 0) {
				lines.push(`${prefix}{}`);
				continue;
			}
			lines.push(`${prefix}${objectLines[0].trimStart()}`);
			lines.push(...objectLines.slice(1));
			continue;
		}
		lines.push(`${prefix}${formatScalar(item)}`);
	}
	return lines;
}

function renderObjectEntries(value: Record<string, unknown>, indentLevel: number): string[] {
	const lines: string[] = [];
	for (const [key, child] of Object.entries(value)) {
		lines.push(...renderNamedValue(key, child, indentLevel));
	}
	return lines;
}

function renderToolCallArgs(row: ToolRow, theme: Theme, width: number): string[] {
	if (!row.displayArgs) {
		return [];
	}
	return renderObjectEntries(row.displayArgs, 1).flatMap(line => wrapStyledText(theme.fg("dim", line), width));
}

async function loadPathBackedImage(content: Extract<ViewerContent, { type: "image" }>): Promise<{
	data?: string;
	mimeType?: string;
}> {
	if (!content.path) {
		return { data: content.data, mimeType: content.mimeType };
	}
	try {
		const file = Bun.file(content.path);
		const bytes = await file.bytes();
		return {
			data: Buffer.from(bytes).toString("base64"),
			mimeType: content.mimeType ?? file.type ?? undefined,
		};
	} catch {
		return { data: content.data, mimeType: content.mimeType };
	}
}

async function renderImageContent(
	content: Extract<ViewerContent, { type: "image" }>,
	theme: Theme,
	width: number,
): Promise<string[]> {
	const resolved = await loadPathBackedImage(content);
	if (resolved.data && resolved.mimeType) {
		return new Image(resolved.data, resolved.mimeType, { fallbackColor: value => theme.fg("muted", value) }).render(
			width,
		);
	}
	if (content.data && content.mimeType) {
		return new Image(content.data, content.mimeType, { fallbackColor: value => theme.fg("muted", value) }).render(
			width,
		);
	}
	if (content.path) {
		return [theme.fg("muted", `[image missing: ${content.path}]`)];
	}
	if (content.mimeType) {
		return [theme.fg("muted", `[image unavailable: ${content.mimeType}]`)];
	}
	return [theme.fg("muted", `[image unavailable: blob data missing]`)];
}

function maybeFormatJson(text: string): string {
	const trimmed = text.trim();
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
		return text;
	}
	try {
		return JSON.stringify(JSON.parse(trimmed), null, 2);
	} catch {
		return text;
	}
}

async function renderContentBlock(content: ViewerContent, theme: Theme, width: number): Promise<string[]> {
	if (content.type === "image") {
		return await renderImageContent(content, theme, width);
	}
	const styledText =
		content.variant === "thinking"
			? theme.fg("muted", content.text)
			: content.variant === "dim"
				? theme.fg("dim", content.text)
				: content.text;
	const formatted = content.variant === "normal" ? maybeFormatJson(styledText) : styledText;
	return wrapStyledText(formatted, width);
}

function renderHeaderLineOne(header: HeaderState, theme: Theme): string {
	const meta = [header.modeLabel, header.model, header.thinking ?? undefined, header.serviceTier ?? undefined].filter(
		(value): value is string => Boolean(value),
	);
	return renderStatusLine({ icon: "info", title: header.agentLabel, meta }, theme);
}

function renderHeaderLineTwo(header: HeaderState, theme: Theme): string {
	const parts = [header.cwd, header.sessionLabel ? path.basename(header.sessionLabel) : undefined].filter(
		(value): value is string => Boolean(value),
	);
	return theme.fg("muted", parts.join(theme.sep.dot));
}

async function renderMessageRow(
	prefix: string,
	content: ViewerContent[],
	theme: Theme,
	width: number,
	prefixColor: ThemeColor,
): Promise<string[]> {
	const lines: string[] = [theme.fg(prefixColor, prefix)];
	for (const block of content) {
		lines.push(...(await renderContentBlock(block, theme, width)));
	}
	if (content.length === 0) {
		lines.push(theme.fg("dim", "(no content)"));
	}
	return lines;
}

async function renderToolRow(row: ToolRow, theme: Theme, width: number): Promise<string[]> {
	const icon: ViewerToolStatus = row.phase === "call" ? "pending" : row.isError ? "error" : "success";
	const lines = [
		renderStatusLine(
			{ icon, title: row.toolName, description: row.phase === "call" ? row.intent : undefined },
			theme,
		),
	];
	if (row.phase === "call") {
		lines.push(...renderToolCallArgs(row, theme, width));
	}
	if (row.phase === "result") {
		for (const block of row.content) {
			lines.push(...(await renderContentBlock(block, theme, width)));
		}
	}
	return lines;
}

export function renderHeader(header: HeaderState, theme: Theme): string[] {
	return [renderHeaderLineOne(header, theme), renderHeaderLineTwo(header, theme)].filter(
		line => line.trim().length > 0,
	);
}

export async function renderRows(rows: ViewerRow[], theme: Theme, width: number = DEFAULT_WIDTH): Promise<string[]> {
	const lines: string[] = [];
	for (const row of rows) {
		if (lines.length > 0) {
			lines.push("");
		}
		if (row.kind === "user") {
			lines.push(...(await renderMessageRow("User", row.content, theme, width, "accent")));
			continue;
		}
		if (row.kind === "assistant") {
			lines.push(...(await renderMessageRow("Assistant", row.content, theme, width, "text")));
			continue;
		}
		if (row.kind === "tool") {
			lines.push(...(await renderToolRow(row, theme, width)));
			continue;
		}
		lines.push(theme.fg("warning", row.message));
	}
	return lines;
}
