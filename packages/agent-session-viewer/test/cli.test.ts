import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { parseCliArgs } from "../src/cli";

describe("agent-session-viewer CLI", () => {
	it("parses a required session file path", () => {
		const parsed = parseCliArgs(["relative/session.jsonl"]);
		expect(parsed).toEqual({
			sessionFilePath: path.resolve("relative/session.jsonl"),
			follow: false,
		});
	});

	it("parses follow mode with short and long flags", () => {
		expect(parseCliArgs(["-f", "session.jsonl"]).follow).toBe(true);
		expect(parseCliArgs(["--follow", "session.jsonl"]).follow).toBe(true);
	});

	it("rejects missing paths and unsupported flags", () => {
		expect(() => parseCliArgs([])).toThrow("Usage: agent-session-viewer [-f|--follow] <session-file>");
		expect(() => parseCliArgs(["--theme", "dark", "session.jsonl"])).toThrow();
	});
});
