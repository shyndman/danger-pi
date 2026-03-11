import {
	type DisplayDrawIntent,
	type DisplayImagePayload,
	type DisplayReportEntry,
	type DisplayToolDetails,
	DisplayToolError,
} from "./contracts";

export interface ShowImageInput extends DisplayImagePayload {
	index: number;
	type: string;
	uri: string;
}

/**
 * <intent>
 * DisplayRuntime is a per-call recorder. It captures draw intents and failures exactly once
 * during tool execution, and it does not hold or consult UI state.
 * </intent>
 */
export interface DisplayRuntime {
	showImage(input: ShowImageInput): void;
	reportSuccess(type: string, uri: string, index?: number): void;
	reportFailure(type: string, uri: string, error: unknown, index?: number): void;
	throwIfAllFailed(): void;
	getDrawIntents(): DisplayDrawIntent[];
	getReportEntries(): DisplayReportEntry[];
	getSummary(): NonNullable<DisplayToolDetails["summary"]>;
}

class RecordingDisplayRuntime implements DisplayRuntime {
	#drawIntents = new Map<number, DisplayDrawIntent>();
	#reportEntries = new Map<number, DisplayReportEntry>();

	constructor(readonly resourceCount: number) {}

	showImage(input: ShowImageInput): void {
		this.#drawIntents.set(input.index, {
			kind: "image",
			type: input.type,
			uri: input.uri,
			image: {
				data: input.data,
				mimeType: input.mimeType,
				widthPx: input.widthPx,
				heightPx: input.heightPx,
			},
		});
		this.reportSuccess(input.type, input.uri, input.index);
	}

	reportSuccess(type: string, uri: string, index = this.#reportEntries.size): void {
		this.#reportEntries.set(index, { type, uri });
	}

	reportFailure(type: string, uri: string, error: unknown, index = this.#reportEntries.size): void {
		this.#reportEntries.set(index, {
			type,
			uri,
			error: errorToMessage(error),
		});
	}

	throwIfAllFailed(): void {
		if (this.resourceCount > 0 && this.#drawIntents.size === 0 && this.#reportEntries.size === this.resourceCount) {
			throw new DisplayToolError("render_failed", "All display resources failed.");
		}
	}

	getDrawIntents(): DisplayDrawIntent[] {
		return [...this.#drawIntents.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
	}

	getReportEntries(): DisplayReportEntry[] {
		return [...this.#reportEntries.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
	}

	getSummary(): NonNullable<DisplayToolDetails["summary"]> {
		let succeeded = 0;
		let failed = 0;
		for (const entry of this.#reportEntries.values()) {
			if (entry.error) {
				failed += 1;
			} else {
				succeeded += 1;
			}
		}
		return {
			total: this.resourceCount,
			succeeded,
			failed,
		};
	}
}

export function createDisplayRuntime(resourceCount: number): DisplayRuntime {
	return new RecordingDisplayRuntime(resourceCount);
}

function errorToMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return String(error);
}
