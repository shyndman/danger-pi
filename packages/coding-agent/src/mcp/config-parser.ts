import { JSONC } from "bun";
import type { MCPConfigFile } from "./types";

export function parseMCPConfigContent(content: string): MCPConfigFile {
	return JSONC.parse(content) as MCPConfigFile;
}

export function tryParseMCPConfigContent(content: string): MCPConfigFile | null {
	try {
		return parseMCPConfigContent(content);
	} catch {
		return null;
	}
}
