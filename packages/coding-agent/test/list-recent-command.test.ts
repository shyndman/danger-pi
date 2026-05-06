import { afterEach, beforeEach, describe, expect, spyOn, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getConfigRootDir, getSessionsDir, setAgentDir } from "@oh-my-pi/pi-utils";
import chalk from "chalk";
import { parseArgs } from "../src/cli/args";
import { runListRecentCommand } from "../src/cli/list-recent";

const fallbackAgentDir = path.join(getConfigRootDir(), "agent");
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalXdgDataHome = process.env.XDG_DATA_HOME;

async function writeSession(dirName: string, title: string, id: string, modified: Date): Promise<void> {
	const dir = path.join(getSessionsDir(), dirName);
	await fs.mkdir(dir, { recursive: true });
	const fileName = `${modified.toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`;
	const filePath = path.join(dir, fileName);
	await fs.writeFile(
		filePath,
		`${[
			JSON.stringify({ type: "session", id, title, timestamp: modified.toISOString(), cwd: `/tmp/${dirName}` }),
			JSON.stringify({
				type: "message",
				id: `${id}-msg-1`,
				parentId: null,
				timestamp: modified.toISOString(),
				message: { role: "user", content: `Prompt ${title}`, timestamp: modified.getTime() },
			}),
		].join("\n")}\n`,
	);
	await fs.utimes(filePath, modified, modified);
}

describe("runListRecentCommand", () => {
	let agentDir: string;

	test("parses --list-recent with default count", () => {
		expect(parseArgs(["--list-recent"]).listRecent).toBe(10);
	});

	test("parses --list-recent with explicit count", () => {
		expect(parseArgs(["--list-recent", "25"]).listRecent).toBe(25);
	});

	test("--list-recent releases a following flag and uses the default", () => {
		const result = parseArgs(["--list-recent", "--print"]);
		expect(result.listRecent).toBe(10);
		expect(result.print).toBe(true);
	});

	test("--list-recent falls back to default on invalid count", () => {
		expect(parseArgs(["--list-recent", "abc"]).listRecent).toBe(10);
		expect(parseArgs(["--list-recent", "0"]).listRecent).toBe(10);
	});

	beforeEach(async () => {
		agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-list-recent-"));
		setAgentDir(agentDir);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		if (originalXdgDataHome) {
			process.env.XDG_DATA_HOME = originalXdgDataHome;
		} else {
			delete process.env.XDG_DATA_HOME;
		}
		if (originalAgentDir) {
			setAgentDir(originalAgentDir);
		} else {
			setAgentDir(fallbackAgentDir);
			delete process.env.PI_CODING_AGENT_DIR;
		}
		await fs.rm(agentDir, { recursive: true, force: true });
	});

	test("lists the 10 most recent sessions across project directories", async () => {
		const base = new Date("2026-05-01T12:00:00.000Z");
		spyOn(Date, "now").mockReturnValue(new Date("2026-05-06T12:10:00.000Z").getTime());
		for (let i = 0; i < 11; i++) {
			const modified = new Date(base.getTime() + i * 60_000);
			await writeSession(`project-${i % 2}`, `Session ${i}`, `session-${i}`, modified);
		}

		const captured: string[] = [];
		const originalChalkLevel = chalk.level;
		chalk.level = 3;
		const originalWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
			return true;
		}) as typeof process.stdout.write;

		try {
			await runListRecentCommand();
		} finally {
			process.stdout.write = originalWrite;
			chalk.level = originalChalkLevel;
		}

		const raw = captured.join("");
		const rawLines = raw.split("\n");
		const session10Color = rawLines.find(line => line.includes("Session 10"))?.match(/\x1b\[38;2;\d+;\d+;\d+m/)?.[0];
		const session9Color = rawLines.find(line => line.includes("Session 9"))?.match(/\x1b\[38;2;\d+;\d+;\d+m/)?.[0];
		expect(session10Color).toBeTruthy();
		expect(session9Color).toBeTruthy();
		expect(session10Color).not.toBe(session9Color);

		const plain = Bun.stripANSI(captured.join(""));
		expect(plain).toContain("Recent sessions (all directories)");
		expect(plain).toContain("title        directory   last used   id");
		expect(plain).toContain("Session 10");
		expect(plain).toContain("project-0");
		expect(plain).toContain("session-10");
		expect(plain).toContain("5d ago");
		expect(plain).not.toContain("Session 0");
		expect(plain).not.toContain("session-0");

		const lines = plain.trimEnd().split("\n");
		const dataLines = lines.slice(3);
		expect(dataLines).toHaveLength(10);
		expect(dataLines[0]).toContain("Session 10");
		expect(dataLines[1]).toContain("Session 9");
		const header = lines[2] ?? "";
		expect(header.trimEnd().endsWith("id")).toBe(true);
		expect(dataLines[0]?.trimEnd().endsWith("session-10")).toBe(true);
	});

	test("reads sessions from the active sessions directory", async () => {
		const xdgRoot = path.join(agentDir, "xdg-data");
		await fs.mkdir(path.join(xdgRoot, "omp"), { recursive: true });
		process.env.XDG_DATA_HOME = xdgRoot;
		setAgentDir(fallbackAgentDir);

		await writeSession("xdg-project", "XDG Session", "xdg-session", new Date("2026-05-01T12:00:00.000Z"));

		const captured: string[] = [];
		const originalWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
			return true;
		}) as typeof process.stdout.write;

		try {
			await runListRecentCommand();
		} finally {
			process.stdout.write = originalWrite;
		}

		const plain = Bun.stripANSI(captured.join(""));
		expect(plain).toContain("XDG Session");
		expect(plain).toContain("xdg-project");
		expect(plain).toContain("xdg-session");
	});

	test("renders last-used values as relative times", async () => {
		spyOn(Date, "now").mockReturnValue(new Date("2026-05-01T12:00:00.000Z").getTime());
		await writeSession("recent-project", "Recent Session", "recent-session", new Date("2026-05-01T10:00:00.000Z"));

		const captured: string[] = [];
		const originalWrite = process.stdout.write.bind(process.stdout);
		process.stdout.write = ((chunk: string | Uint8Array) => {
			captured.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
			return true;
		}) as typeof process.stdout.write;

		try {
			await runListRecentCommand();
		} finally {
			process.stdout.write = originalWrite;
		}

		const plain = Bun.stripANSI(captured.join(""));
		expect(plain).toContain("Recent Session");
		expect(plain).toContain("2h ago");
		expect(plain).not.toContain("May 1");
	});
});
