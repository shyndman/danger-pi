import type { ToolSession } from "..";
import { DefaultDisplayResourceResolver } from "./resource-resolver";
import { DisplayTool } from "./tool";
import { DisplayTypeRegistry } from "./type-registry";
import { createColorDisplayType, createImageDisplayType } from "./types";

export function createDisplayTool(session: ToolSession): DisplayTool | null {
	if (!session.hasUI) {
		return null;
	}

	const resolver = new DefaultDisplayResourceResolver();
	const registry = new DisplayTypeRegistry();
	registry.register(createImageDisplayType());
	registry.register(createColorDisplayType());
	return new DisplayTool(session, resolver, registry);
}
