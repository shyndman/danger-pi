import type { ResolvedDisplayResource } from "./contracts";
import type { DisplayRuntime } from "./runtime";

/**
 * <intent>
 * One display type owns one presentation path. Type execution is effect-oriented: it consumes
 * resolved resources and emits runtime sink calls, without reading UI state.
 * </intent>
 */
export interface DisplayTypeDefinition {
	readonly type: string;
	execute(resources: ResolvedDisplayResource[], runtime: DisplayRuntime, signal?: AbortSignal): Promise<void>;
}

export class DisplayTypeRegistry {
	#definitions = new Map<string, DisplayTypeDefinition>();

	register(definition: DisplayTypeDefinition): void {
		if (this.#definitions.has(definition.type)) {
			throw new Error(`Display type already registered: ${definition.type}`);
		}
		this.#definitions.set(definition.type, definition);
	}

	get(type: string): DisplayTypeDefinition | undefined {
		return this.#definitions.get(type);
	}
}
