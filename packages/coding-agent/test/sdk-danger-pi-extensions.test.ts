import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Snowflake } from "@oh-my-pi/pi-utils";
import { Settings } from "../src/config/settings";
import { dangerPiBundledExtensions } from "../src/danger-pi/extensions";
import { createAgentSession } from "../src/sdk";

describe("Danger Pi bundled extensions", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		for (const tempDir of tempDirs.splice(0)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it("loads bundled Danger Pi extensions through the inline extension seam", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pi-sdk-danger-pi-${Snowflake.next()}-`));
		tempDirs.push(tempDir);
		const cwd = path.join(tempDir, `project-${Snowflake.next()}`);
		const agentDir = path.join(tempDir, "agent");
		fs.mkdirSync(cwd, { recursive: true });

		const { extensionsResult, session } = await createAgentSession({
			cwd,
			agentDir,
			settings: Settings.isolated(),
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
		});

		try {
			expect(dangerPiBundledExtensions).toHaveLength(1);
			expect(extensionsResult.errors).toHaveLength(0);
			expect(extensionsResult.extensions).toHaveLength(dangerPiBundledExtensions.length + 1);
			expect(extensionsResult.extensions.filter(ext => ext.commands.has("hello_world"))).toHaveLength(1);
		} finally {
			await session.dispose();
		}
	});
});
