import * as path from "node:path";
import { renderStatusLine, type Theme, type ThemeColor } from "@oh-my-pi/pi-coding-agent";
import { Image, replaceTabs, wrapTextWithAnsi } from "@oh-my-pi/pi-tui";
import type { HeaderState, ViewerContent, ViewerRow } from "./types";

type ViewerToolStatus = "success" | "error" | "warning" | "info" | "pending" | "running" | "aborted";

const DEFAULT_WIDTH = 100;

function wrapStyledText(text: string, width: number): string[] {
	const normalized = replaceTabs(text);
	return normalized.split("\n").flatMap(line => wrapTextWithAnsi(line, Math.max(10, width)));
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

async function renderToolRow(
	row: Extract<ViewerRow, { kind: "tool" }>,
	theme: Theme,
	width: number,
): Promise<string[]> {
	const icon: ViewerToolStatus = row.phase === "call" ? "pending" : row.isError ? "error" : "success";
	const lines = [renderStatusLine({ icon, title: row.toolName }, theme)];
	if (row.phase === "call" && row.argsLine) {
		for (const line of wrapStyledText(theme.fg("dim", row.argsLine), width)) {
			lines.push(line);
		}
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
