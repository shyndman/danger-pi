#!/usr/bin/env bun
import * as path from "node:path";
import { parseArgs } from "node:util";
import { createNormalizeState, normalizeEntries } from "./normalize";
import { renderHeader, renderRows } from "./render";
import { readAppendedSessionEntries, readInitialSessionFile } from "./session-file";
import { loadViewerTheme } from "./theme";

export interface CliArgs {
	sessionFilePath: string;
	follow: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
	const { values, positionals } = parseArgs({
		args: argv,
		options: {
			follow: {
				type: "boolean",
				short: "f",
				default: false,
			},
		},
		allowPositionals: true,
		strict: true,
	});
	if (positionals.length !== 1) {
		throw new Error("Usage: agent-session-viewer [-f|--follow] <session-file>");
	}
	return {
		sessionFilePath: path.resolve(positionals[0]!),
		follow: values.follow === true,
	};
}

/**
 * <intent>Read a persisted coding-agent session file, normalize it into viewer state and rows, render the initial transcript once, and optionally append newly persisted rows in follow mode.</intent>
 */
export async function runSessionViewer(args: CliArgs): Promise<void> {
	const theme = await loadViewerTheme();
	const initial = await readInitialSessionFile(args.sessionFilePath);
	const state = createNormalizeState(args.sessionFilePath, args.follow);
	const rows = normalizeEntries(initial.entries, state, { phase: "initial" });
	process.stdout.write(`${renderHeader(state.header, theme).join("\n")}\n`);
	const initialLines = await renderRows(rows, theme);
	if (initialLines.length > 0) {
		process.stdout.write(`${initialLines.join("\n")}\n`);
	}
	state.hasRendered = true;
	if (!args.follow) {
		return;
	}
	let readState = initial.state;
	while (true) {
		const update = await readAppendedSessionEntries(readState);
		readState = update.state;
		if (update.entries.length > 0) {
			const appendedRows = normalizeEntries(update.entries, state, { phase: "follow" });
			const appendedLines = await renderRows(appendedRows, theme);
			if (appendedLines.length > 0) {
				process.stdout.write(`\n${appendedLines.join("\n")}\n`);
			}
		}
		await Bun.sleep(250);
	}
}

async function main(): Promise<void> {
	try {
		await runSessionViewer(parseCliArgs(process.argv.slice(2)));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`${message}\n`);
		process.exitCode = 1;
	}
}

if (import.meta.main) {
	await main();
}
