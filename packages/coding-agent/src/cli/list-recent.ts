import * as path from "node:path";
import { truncateToWidth } from "@oh-my-pi/pi-tui";
import chalk from "chalk";
import { formatTimeAgo, type SessionInfo } from "../session/session-listing";
import { SessionManager } from "../session/session-manager";
import { DEFAULT_RECENT_SESSION_LIMIT } from "./flag-tables";

const MAX_TITLE_WIDTH = 60;
const MAX_DIRECTORY_WIDTH = 30;
const LAST_USED_HEADER = "last used";
const COLUMN_GAP = "   ";
const ALTERNATE_ROW_BG = "#16181d";
const LIST_RECENT_TITLE_COLORS = [
	"#ffb7c6",
	"#ffbd98",
	"#e2ce80",
	"#abdea0",
	"#7ae3d6",
	"#8cdaff",
	"#bfcbff",
	"#ebb9f7",
	"#e493a5",
	"#e19b74",
	"#c2ad61",
	"#8cbe81",
	"#58c3b6",
	"#65bae1",
	"#9ba9ed",
	"#ca99d6",
	"#c27487",
	"#c07c56",
	"#a28e41",
	"#6e9e63",
	"#33a397",
	"#449ac0",
	"#7d8acc",
	"#aa7bb5",
] as const;
const untitledTimeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
});

interface RecentSessionRow {
	title: string;
	directory: string;
	id: string;
	lastUsed: string;
	accentHex: string;
}

function writeLine(line = ""): void {
	process.stdout.write(`${line}\n`);
}

function sanitizeInlineText(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const firstLine = value.split(/\r?\n/)[0] ?? "";
	const stripped = firstLine
		.replace(/[\x00-\x1F\x7F]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return stripped.length > 0 ? stripped : undefined;
}

function padCell(text: string, width: number): string {
	return text + " ".repeat(Math.max(0, width - Bun.stringWidth(text)));
}

function getFallbackTitle(session: SessionInfo): string {
	const created = Number.isFinite(session.created.getTime()) ? session.created : session.modified;
	return `Untitled · ${untitledTimeFormatter.format(created)}`;
}

function titleColor(title: string): string {
	let hash = 5381;
	for (let i = 0; i < title.length; i++) {
		hash = ((hash << 5) + hash) ^ title.charCodeAt(i);
		hash >>>= 0;
	}
	return LIST_RECENT_TITLE_COLORS[hash % LIST_RECENT_TITLE_COLORS.length];
}

function getDirectoryName(session: SessionInfo): string {
	const cwd = sanitizeInlineText(session.cwd);
	if (!cwd) return "unknown";
	return path.basename(cwd) || cwd;
}

function buildRecentSessionRow(session: SessionInfo): RecentSessionRow {
	const titleSource =
		sanitizeInlineText(session.title) ?? sanitizeInlineText(session.firstMessage) ?? getFallbackTitle(session);
	const title = truncateToWidth(titleSource, MAX_TITLE_WIDTH);
	const directory = truncateToWidth(getDirectoryName(session), MAX_DIRECTORY_WIDTH);
	return {
		title,
		directory,
		id: session.id,
		lastUsed: formatTimeAgo(session.modified),
		accentHex: titleColor(titleSource),
	};
}

export function listRecentSessions(sessions: SessionInfo[], limit = DEFAULT_RECENT_SESSION_LIMIT): void {
	const recent = [...sessions]
		.sort((left, right) => right.modified.getTime() - left.modified.getTime())
		.slice(0, limit);
	if (recent.length === 0) {
		writeLine("No sessions found.");
		return;
	}

	const rows = recent.map(buildRecentSessionRow);
	const widths = {
		title: Math.max("title".length, ...rows.map(row => Bun.stringWidth(row.title))),
		directory: Math.max("directory".length, ...rows.map(row => Bun.stringWidth(row.directory))),
		lastUsed: Math.max(LAST_USED_HEADER.length, ...rows.map(row => Bun.stringWidth(row.lastUsed))),
	};

	writeLine("Recent sessions (all directories)");
	writeLine();
	writeLine(
		chalk.dim(
			`${padCell("title", widths.title)}${COLUMN_GAP}${padCell("directory", widths.directory)}${COLUMN_GAP}${padCell(LAST_USED_HEADER, widths.lastUsed)}${COLUMN_GAP}id`,
		),
	);
	for (const [index, row] of rows.entries()) {
		const coloredTitle = chalk.hex(row.accentHex)(padCell(row.title, widths.title));
		const line = `${coloredTitle}${COLUMN_GAP}${padCell(row.directory, widths.directory)}${COLUMN_GAP}${padCell(row.lastUsed, widths.lastUsed)}${COLUMN_GAP}${row.id}`;
		writeLine(index % 2 === 1 ? chalk.bgHex(ALTERNATE_ROW_BG)(line) : line);
	}
}

export async function runListRecentCommand(limit = DEFAULT_RECENT_SESSION_LIMIT): Promise<void> {
	const sessions = await SessionManager.listAll();
	listRecentSessions(sessions, limit);
}
