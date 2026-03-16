import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readAppendedSessionEntries, readInitialSessionFile } from "../src/session-file";

const cleanupDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-session-viewer-"));
	cleanupDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(cleanupDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("session file loading and follow mode", () => {
	it("loads initial complete lines and buffers trailing fragments", async () => {
		const dir = await makeTempDir();
		const filePath = path.join(dir, "session.jsonl");
		await Bun.write(
			filePath,
			`${JSON.stringify({ type: "session", id: "s1", timestamp: "t", cwd: "/repo" })}\n${JSON.stringify({ type: "message", id: "1", parentId: null, timestamp: "t", message: { role: "user", content: "hi", timestamp: 1 } })}\n{"type":"message"`,
		);
		const initial = await readInitialSessionFile(filePath);
		expect(initial.entries).toHaveLength(2);
		expect(initial.state.pendingFragment).toBe('{"type":"message"');
		expect(initial.state.processedOffset).toBeLessThan(initial.state.offset);
	});

	it("parses only completed appended lines and keeps byte offsets stable", async () => {
		const dir = await makeTempDir();
		const filePath = path.join(dir, "session.jsonl");
		await Bun.write(filePath, `${JSON.stringify({ type: "session", id: "s1", timestamp: "t", cwd: "/repo" })}\n`);
		const initial = await readInitialSessionFile(filePath);
		await fs.appendFile(filePath, '{"type":"message","id":"1"');
		const partial = await readAppendedSessionEntries(initial.state);
		expect(partial.entries).toEqual([]);
		expect(partial.state.processedOffset).toBe(initial.state.processedOffset);
		await fs.appendFile(
			filePath,
			',"parentId":null,"timestamp":"t","message":{"role":"user","content":"hi","timestamp":1}}\n',
		);
		const completed = await readAppendedSessionEntries(partial.state);
		expect(completed.entries).toHaveLength(1);
		expect(completed.state.processedOffset).toBe(completed.state.offset);
	});

	it("fails truthfully for startup errors, disappearance, truncation, replacement, and malformed JSONL", async () => {
		const dir = await makeTempDir();
		const missingPath = path.join(dir, "missing.jsonl");
		await expect(readInitialSessionFile(missingPath)).rejects.toThrow(`Session file not found: ${missingPath}`);

		const filePath = path.join(dir, "session.jsonl");
		await Bun.write(filePath, `${JSON.stringify({ type: "session", id: "s1", timestamp: "t", cwd: "/repo" })}\n`);
		const initial = await readInitialSessionFile(filePath);
		await fs.rm(filePath);
		await expect(readAppendedSessionEntries(initial.state)).rejects.toThrow(
			"Session file disappeared while following",
		);

		await Bun.write(filePath, `${JSON.stringify({ type: "session", id: "s1", timestamp: "t", cwd: "/repo" })}\n`);
		const truncationInitial = await readInitialSessionFile(filePath);
		await Bun.write(filePath, "");
		await expect(readAppendedSessionEntries(truncationInitial.state)).rejects.toThrow(
			"Session file shrank while following",
		);

		await Bun.write(filePath, `${JSON.stringify({ type: "session", id: "s1", timestamp: "t", cwd: "/repo" })}\n`);
		const replacementInitial = await readInitialSessionFile(filePath);
		await fs.rm(filePath);
		await Bun.write(filePath, `${JSON.stringify({ type: "session", id: "s2", timestamp: "t", cwd: "/repo" })}\n`);
		await expect(readAppendedSessionEntries(replacementInitial.state)).rejects.toThrow(
			"Session file was replaced while following",
		);

		await Bun.write(filePath, `${JSON.stringify({ type: "session", id: "s1", timestamp: "t", cwd: "/repo" })}\n`);
		const malformedInitial = await readInitialSessionFile(filePath);
		await fs.appendFile(filePath, '{"bad":]\n');
		await expect(readAppendedSessionEntries(malformedInitial.state)).rejects.toThrow("Malformed JSONL");
	});
});
