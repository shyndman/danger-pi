#!/usr/bin/env bun
/**
 * Print your "tantrum" messages from the local omp session corpus.
 *
 * Reuses `computeUserMessageMetrics` from @oh-my-pi/omp-stats -- the exact
 * scoring behind the stats dashboard's "User Tantrums" chart. A message
 * matches when ANY behavior signal fires (yelling / profanity / anguish /
 * negation / repetition / blame). For each match it prints the message text
 * followed by a small colored table of the signal counts.
 *
 * The behavior tables store only counts (no text), so this walks the session
 * JSONL on disk and re-derives the text + scores -- no DB, no upstream edits.
 *
 * Usage:
 *   bun scripts/session-stats/tantrums.ts
 */

import * as path from "node:path";
import { listAllSessionFiles } from "@oh-my-pi/omp-stats/parser";
import type { SessionEntry, SessionMessageEntry } from "@oh-my-pi/omp-stats/types";
import { computeUserMessageMetrics, type UserMessageMetrics } from "@oh-my-pi/omp-stats/user-metrics";
import { getSessionsDir } from "@oh-my-pi/pi-utils";

const sessionsDir = getSessionsDir();
const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;

const SGR = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	brightRed: "\x1b[91m",
	gray: "\x1b[90m",
} as const;

function paint(text: string, ...codes: string[]): string {
	return useColor ? `${codes.join("")}${text}${SGR.reset}` : text;
}

/** The six behavior signals, in display order, each with a column color. */
const SIGNALS: readonly { key: keyof UserMessageMetrics; label: string; color: string }[] = [
	{ key: "yelling", label: "Yelling", color: SGR.red },
	{ key: "profanity", label: "Profanity", color: SGR.magenta },
	{ key: "anguish", label: "Anguish", color: SGR.yellow },
	{ key: "negation", label: "Negation", color: SGR.cyan },
	{ key: "repetition", label: "Repetition", color: SGR.green },
	{ key: "blame", label: "Blame", color: SGR.brightRed },
];

/** Extract plain text from a user message content payload (mirrors parser). */
function extractUserText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.join("");
}

/** Project path from session file name (e.g. `--work--pi--` -> `/work/pi`). */
function extractFolder(sessionPath: string): string {
	const rel = path.relative(sessionsDir, sessionPath);
	const projectDir = rel.split(path.sep)[0] ?? "";
	return projectDir.replace(/^--/, "/").replace(/--/g, "/");
}

function centerCell(text: string, width: number): string {
	const pad = Math.max(0, width - text.length);
	const left = Math.floor(pad / 2);
	return " ".repeat(left) + text + " ".repeat(pad - left);
}

/** A compact bordered table: one column per signal, value colored when > 0. */
function renderStatsTable(m: UserMessageMetrics): string {
	const widths = SIGNALS.map(s => Math.max(s.label.length, String(m[s.key]).length) + 2);
	const border = (l: string, mid: string, r: string) =>
		paint(l + widths.map(w => "─".repeat(w)).join(mid) + r, SGR.gray);
	const headerCells = SIGNALS.map((s, i) => paint(centerCell(s.label, widths[i]!), s.color, SGR.dim));
	const valueCells = SIGNALS.map((s, i) => {
		const v = m[s.key];
		const cell = centerCell(String(v), widths[i]!);
		return v > 0 ? paint(cell, s.color, SGR.bold) : paint(cell, SGR.dim);
	});
	const bar = paint("│", SGR.gray);
	return [
		border("┌", "┬", "┐"),
		bar + headerCells.join(bar) + bar,
		border("├", "┼", "┤"),
		bar + valueCells.join(bar) + bar,
		border("└", "┴", "┘"),
	].join("\n");
}

/** Parse a session file's entries, tolerating a malformed trailing/partial line. */
function parseEntries(text: string): SessionEntry[] {
	try {
		return Bun.JSONL.parse(text) as SessionEntry[];
	} catch {
		const out: SessionEntry[] = [];
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				out.push(JSON.parse(line) as SessionEntry);
			} catch {
				// skip corrupt line
			}
		}
		return out;
	}
}

interface Tantrum {
	ts: number;
	folder: string;
	text: string;
	metrics: UserMessageMetrics;
}

function isUserEntry(entry: SessionEntry): entry is SessionMessageEntry {
	if (entry.type !== "message") return false;
	const msg = (entry as SessionMessageEntry).message as { role?: unknown; synthetic?: unknown };
	return msg?.role === "user" && msg.synthetic !== true;
}

async function collectFromFile(file: string): Promise<{ matches: Tantrum[]; scanned: number }> {
	let raw: string;
	try {
		raw = await Bun.file(file).text();
	} catch {
		return { matches: [], scanned: 0 };
	}
	const folder = extractFolder(file);
	const matches: Tantrum[] = [];
	let scanned = 0;
	for (const entry of parseEntries(raw)) {
		if (!isUserEntry(entry)) continue;
		const text = extractUserText((entry.message as { content?: unknown }).content).trim();
		if (!text) continue;
		scanned++;
		const metrics = computeUserMessageMetrics(text);
		if (!SIGNALS.some(s => metrics[s.key] > 0)) continue;
		const ts = Date.parse(entry.timestamp);
		matches.push({ ts: Number.isFinite(ts) ? ts : 0, folder, text, metrics });
	}
	return { matches, scanned };
}

/** Map over items with bounded concurrency to avoid exhausting file handles. */
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const out: R[] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
	}
	return out;
}

function formatDate(ts: number): string {
	if (!ts) return "unknown";
	return new Date(ts).toLocaleString("en-CA", { dateStyle: "short", timeStyle: "short" });
}

async function main(): Promise<void> {
	const files = await listAllSessionFiles();
	const results = await mapPool(files, 24, collectFromFile);

	const tantrums: Tantrum[] = [];
	let scanned = 0;
	for (const r of results) {
		tantrums.push(...r.matches);
		scanned += r.scanned;
	}
	tantrums.sort((a, b) => a.ts - b.ts);

	const out = process.stdout;
	for (const t of tantrums) {
		out.write(`${paint(`${t.folder}  ·  ${formatDate(t.ts)}`, SGR.gray)}\n`);
		for (const line of t.text.split("\n")) out.write(`  ${line}\n`);
		out.write(
			`${renderStatsTable(t.metrics)
				.split("\n")
				.map(l => `  ${l}`)
				.join("\n")}\n\n`,
		);
	}

	out.write(
		paint(
			`${tantrums.length} tantrum${tantrums.length === 1 ? "" : "s"} across ${scanned} user message${scanned === 1 ? "" : "s"} in ${files.length} session file${files.length === 1 ? "" : "s"}.\n`,
			SGR.dim,
		),
	);
}

main();
