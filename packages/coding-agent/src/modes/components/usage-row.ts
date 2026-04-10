import type { Usage } from "@oh-my-pi/pi-ai";
import { Container, Spacer, Text } from "@oh-my-pi/pi-tui";
import { formatAssistantUsageMetadata } from "./assistant-usage-format";

export function createUsageRowBlock(usage: Usage, elapsedMs?: number, durationMs?: number, ttftMs?: number): Container {
	const block = new Container();
	block.addChild(new Spacer(1));
	block.addChild(new Text(formatAssistantUsageMetadata(usage, elapsedMs, durationMs, ttftMs), 1, 0));
	return block;
}
