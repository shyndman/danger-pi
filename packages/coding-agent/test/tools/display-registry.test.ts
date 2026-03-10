import { describe, expect, it } from "bun:test";
import { type DisplayTypeDefinition, DisplayTypeRegistry } from "@oh-my-pi/pi-coding-agent/tools/display/index";

const noopType: DisplayTypeDefinition = {
	type: "image",
	async execute() {},
};

describe("DisplayTypeRegistry", () => {
	it("throws on duplicate type registration", () => {
		const registry = new DisplayTypeRegistry();
		registry.register(noopType);
		expect(() => registry.register(noopType)).toThrow("Display type already registered: image");
	});
});
