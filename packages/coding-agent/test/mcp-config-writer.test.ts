import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	readDisabledServers,
	readMCPConfigFile,
	writeMCPConfigFile,
} from "@oh-my-pi/pi-coding-agent/mcp/config-writer";

describe("MCP config file parser", () => {
	let tempDir = "";
	let configPath = "";

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-config-writer-"));
		configPath = path.join(tempDir, "mcp.json");
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("reads JSONC syntax from canonical mcp.json files", async () => {
		await fs.writeFile(
			configPath,
			`{
				// Comments and trailing commas are accepted on read.
				"mcpServers": {
					"jsonc-server": {
						"command": "echo",
						"args": ["hello"],
					},
				},
			}`,
		);

		const config = await readMCPConfigFile(configPath);

		expect(config.mcpServers?.["jsonc-server"]).toEqual({
			command: "echo",
			args: ["hello"],
		});
	});

	test("reads disabledServers from JSONC syntax", async () => {
		await fs.writeFile(
			configPath,
			`{
				"mcpServers": {},
				"disabledServers": [
					"disabled-jsonc",
				],
			}`,
		);

		await expect(readDisabledServers(configPath)).resolves.toEqual(["disabled-jsonc"]);
	});

	test("writes strict JSON after reading JSONC syntax", async () => {
		await writeMCPConfigFile(configPath, {
			mcpServers: {
				strict: {
					command: "echo",
					args: ["strict"],
				},
			},
		});

		const content = await fs.readFile(configPath, "utf-8");
		const parsed = JSON.parse(content);

		expect(parsed.mcpServers.strict).toEqual({
			command: "echo",
			args: ["strict"],
		});
	});
});
