import * as fs from "node:fs";
import { isEnoent } from "@oh-my-pi/pi-utils";
import type { PersistedFileEntry, SessionReadResult, SessionReadState, SessionReadUpdate } from "./types";

function createFileId(stats: fs.Stats): string {
	return `${stats.dev}:${stats.ino}`;
}

function splitCompleteLines(text: string): { complete: string; fragment: string } {
	const lastNewline = text.lastIndexOf("\n");
	if (lastNewline < 0) {
		return { complete: "", fragment: text };
	}
	return {
		complete: text.slice(0, lastNewline + 1),
		fragment: text.slice(lastNewline + 1),
	};
}

function parseJsonl(text: string, filePath: string): PersistedFileEntry[] {
	if (text.length === 0) return [];
	return text
		.split("\n")
		.filter(line => line.length > 0)
		.map((line, index) => {
			try {
				return JSON.parse(line) as PersistedFileEntry;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Malformed JSONL in ${filePath} at line ${index + 1}: ${message}`);
			}
		});
}

async function readStats(filePath: string): Promise<fs.Stats> {
	try {
		return await fs.promises.stat(filePath);
	} catch (error) {
		if (isEnoent(error)) {
			throw new Error(`Session file not found: ${filePath}`);
		}
		throw new Error(
			`Unable to open session file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function readInitialSessionFile(filePath: string): Promise<SessionReadResult> {
	const stats = await readStats(filePath);
	const file = Bun.file(filePath);
	let text: string;
	try {
		text = await file.text();
	} catch (error) {
		throw new Error(
			`Unable to read session file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const { complete, fragment } = splitCompleteLines(text);
	const processedOffset = Buffer.byteLength(complete, "utf8");
	return {
		entries: parseJsonl(complete, filePath),
		state: {
			path: filePath,
			offset: Buffer.byteLength(text, "utf8"),
			processedOffset,
			pendingFragment: fragment,
			fileId: createFileId(stats),
		},
	};
}

export async function readAppendedSessionEntries(state: SessionReadState): Promise<SessionReadUpdate> {
	let stats: fs.Stats;
	try {
		stats = await fs.promises.stat(state.path);
	} catch (error) {
		if (isEnoent(error)) {
			throw new Error(`Session file disappeared while following: ${state.path}`);
		}
		throw new Error(
			`Unable to stat session file ${state.path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const fileId = createFileId(stats);
	if (fileId !== state.fileId) {
		throw new Error(`Session file was replaced while following: ${state.path}`);
	}
	if (stats.size < state.offset) {
		throw new Error(`Session file shrank while following: ${state.path}`);
	}
	if (stats.size === state.offset) {
		return { entries: [], state, changed: false };
	}
	let appendedText: string;
	try {
		appendedText = await Bun.file(state.path).slice(state.offset, stats.size).text();
	} catch (error) {
		throw new Error(
			`Unable to read appended session data from ${state.path}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const combined = `${state.pendingFragment}${appendedText}`;
	const { complete, fragment } = splitCompleteLines(combined);
	const nextState: SessionReadState = {
		...state,
		offset: stats.size,
		processedOffset: stats.size - Buffer.byteLength(fragment, "utf8"),
		pendingFragment: fragment,
	};
	if (complete.length === 0) {
		return { entries: [], state: nextState, changed: false };
	}
	return {
		entries: parseJsonl(complete, state.path),
		state: nextState,
		changed: true,
	};
}
