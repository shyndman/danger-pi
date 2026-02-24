import type { Component } from "@oh-my-pi/pi-tui";
import { Container, Image, ImageProtocol, TERMINAL, Text, visibleWidth } from "@oh-my-pi/pi-tui";
import { theme } from "../../modes/theme/theme";
import { formatBytes, shortenPath } from "../../tools/render-utils";
import { convertToPng } from "../../utils/image-convert";
import type { ToolExecutionHandle } from "./tool-execution";

type ReadRenderArgs = {
	path?: string;
	file_path?: string;
	offset?: number;
	limit?: number;
};

type ReadImagePayload = {
	data: string;
	mimeType: string;
	byteSize?: number;
};

type ReadEntry = {
	toolCallId: string;
	path: string;
	offset?: number;
	limit?: number;
	status: "pending" | "success" | "error";
	image?: ReadImagePayload;
};

type PreviewPair = {
	collapsed: Image;
	expanded: Image;
};

type ReadToolGroupOptions = {
	requestRender?: () => void;
};

export class ReadToolGroupComponent extends Container implements ToolExecutionHandle {
	#entries = new Map<string, ReadEntry>();
	#text: Text;
	#previewContainer: Container;
	#expanded = false;
	#previewComponents = new Map<string, PreviewPair>();
	#kittyConvertedImages = new Map<string, ReadImagePayload>();
	#kittyConversionsInFlight = new Set<string>();
	#requestRender?: () => void;

	constructor(options: ReadToolGroupOptions = {}) {
		super();
		this.#requestRender = options.requestRender;
		this.#text = new Text("", 0, 0);
		this.#previewContainer = new Container();
		this.addChild(this.#text);
		this.addChild(this.#previewContainer);
		this.#updateDisplay();
	}

	updateArgs(args: ReadRenderArgs, toolCallId?: string): void {
		if (!toolCallId) return;
		const rawPath = args.file_path || args.path || "";
		const entry: ReadEntry = this.#entries.get(toolCallId) ?? {
			toolCallId,
			path: rawPath,
			offset: args.offset,
			limit: args.limit,
			status: "pending",
		};
		entry.path = rawPath;
		entry.offset = args.offset;
		entry.limit = args.limit;
		this.#entries.set(toolCallId, entry);
		this.#updateDisplay();
	}

	updateResult(
		result: {
			content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
			details?: unknown;
			isError?: boolean;
		},
		isPartial = false,
		toolCallId?: string,
	): void {
		if (!toolCallId) return;
		const entry = this.#entries.get(toolCallId);
		if (!entry) return;
		if (isPartial) return;
		entry.status = result.isError ? "error" : "success";
		this.#kittyConversionsInFlight.delete(toolCallId);
		this.#kittyConvertedImages.delete(toolCallId);

		const imageBlock = result.content.find(
			(block): block is { type: "image"; data: string; mimeType: string } =>
				block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string",
		);
		if (imageBlock) {
			entry.image = {
				data: imageBlock.data,
				mimeType: imageBlock.mimeType,
				byteSize: this.#extractByteSizeFromDetails(result.details, imageBlock.data),
			};
			this.#previewComponents.delete(toolCallId);
			this.#maybeConvertImageForKitty(entry);
		} else {
			entry.image = undefined;
			this.#previewComponents.delete(toolCallId);
		}

		this.#updateDisplay();
	}

	setArgsComplete(_toolCallId?: string): void {
		this.#updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		if (this.#expanded === expanded) return;
		this.#expanded = expanded;
		this.#updateDisplay();
	}

	getComponent(): Component {
		return this;
	}

	#updateDisplay(): void {
		const entries = [...this.#entries.values()];
		this.#previewContainer.clear();

		if (entries.length === 0) {
			this.#text.setText(` ${theme.format.bullet} ${theme.fg("toolTitle", theme.bold("Read"))}`);
			return;
		}

		if (entries.length === 1) {
			const entry = entries[0];
			const statusSymbol = this.#formatStatus(entry.status);
			const pathDisplay = this.#formatPath(entry);
			const sizeDisplay = this.#formatByteSize(entry);
			const sizeSegment = sizeDisplay ? ` ${sizeDisplay}` : "";
			this.#text.setText(
				` ${theme.format.bullet} ${theme.fg("toolTitle", theme.bold("Read"))} ${pathDisplay}${sizeSegment} ${statusSymbol}`.trimEnd(),
			);
		} else {
			const header = `${theme.fg("toolTitle", theme.bold("Read"))}${theme.fg("dim", ` (${entries.length})`)}`;
			const lines = [` ${theme.format.bullet} ${header}`];
			const total = entries.length;
			for (const [index, entry] of entries.entries()) {
				const connector = index === total - 1 ? theme.tree.last : theme.tree.branch;
				const statusSymbol = this.#formatStatus(entry.status);
				const pathDisplay = this.#formatPath(entry);
				const sizeDisplay = this.#formatByteSize(entry);
				const sizeSegment = sizeDisplay ? ` ${sizeDisplay}` : "";
				lines.push(`   ${theme.fg("dim", connector)} ${statusSymbol} ${pathDisplay}${sizeSegment}`.trimEnd());
			}
			this.#text.setText(lines.join("\n"));
		}

		entries.forEach((entry, index) => {
			const preview = this.#renderPreviewBlock(entry, index, entries.length);
			if (preview) {
				this.#previewContainer.addChild(preview);
			}
		});
	}

	#formatPath(entry: ReadEntry): string {
		const filePath = shortenPath(entry.path);
		let pathDisplay = filePath ? theme.fg("accent", filePath) : theme.fg("toolOutput", "…");
		if (entry.offset !== undefined || entry.limit !== undefined) {
			const startLine = entry.offset ?? 1;
			const endLine = entry.limit !== undefined ? startLine + entry.limit - 1 : "";
			pathDisplay += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
		}
		return pathDisplay;
	}

	#formatStatus(status: ReadEntry["status"]): string {
		if (status === "success") {
			return theme.fg("success", theme.status.success);
		}
		if (status === "error") {
			return theme.fg("error", theme.status.error);
		}
		return theme.fg("dim", theme.status.pending);
	}

	#formatByteSize(entry: ReadEntry): string | null {
		if (!entry.image) return null;
		const byteSize = entry.image.byteSize;
		if (typeof byteSize === "number" && Number.isFinite(byteSize)) {
			return theme.fg("muted", `(${formatBytes(byteSize)})`);
		}
		return theme.fg("muted", "(unknown)");
	}

	#renderPreviewBlock(entry: ReadEntry, index: number, total: number): Component | null {
		if (!entry.image) return null;
		const previews = this.#ensurePreviewPair(entry);
		if (!previews) return null;
		const prefix = this.#buildPreviewPrefix(total, index);
		const image = this.#expanded ? previews.expanded : previews.collapsed;
		return new IndentedComponent(prefix, image);
	}

	#buildPreviewPrefix(total: number, index: number): string {
		if (total <= 1) {
			return "     ";
		}
		const isLast = index === total - 1;
		const branchSymbol = isLast ? "  " : `${theme.tree.vertical} `;
		return `   ${theme.fg("dim", branchSymbol)}  `;
	}

	#ensurePreviewPair(entry: ReadEntry): PreviewPair | null {
		const existing = this.#previewComponents.get(entry.toolCallId);
		if (existing) {
			return existing;
		}
		const imagePayload = this.#getRenderableImage(entry);
		if (!imagePayload) return null;
		const fallbackColor = (text: string) => theme.fg("toolOutput", text);
		const filename = entry.path || undefined;
		const collapsed = new Image(
			imagePayload.data,
			imagePayload.mimeType,
			{ fallbackColor },
			{
				maxWidthCells: Number.POSITIVE_INFINITY,
				maxHeightCells: 2,
				filename,
			},
		);
		const expanded = new Image(
			imagePayload.data,
			imagePayload.mimeType,
			{ fallbackColor },
			{
				maxWidthCells: Number.POSITIVE_INFINITY,
				maxHeightCells: 30,
				filename,
			},
		);
		const pair: PreviewPair = { collapsed, expanded };
		this.#previewComponents.set(entry.toolCallId, pair);
		return pair;
	}

	#getRenderableImage(entry: ReadEntry): ReadImagePayload | null {
		if (!entry.image) return null;
		const converted = this.#kittyConvertedImages.get(entry.toolCallId);
		if (converted) {
			return converted;
		}
		if (TERMINAL.imageProtocol === ImageProtocol.Kitty && entry.image.mimeType !== "image/png") {
			return null;
		}
		return entry.image;
	}

	#maybeConvertImageForKitty(entry: ReadEntry): void {
		if (TERMINAL.imageProtocol !== ImageProtocol.Kitty) return;
		if (!entry.image) return;
		if (entry.image.mimeType === "image/png") return;
		if (this.#kittyConvertedImages.has(entry.toolCallId)) return;
		if (this.#kittyConversionsInFlight.has(entry.toolCallId)) return;

		const originalData = entry.image.data;
		const originalMimeType = entry.image.mimeType;
		this.#kittyConversionsInFlight.add(entry.toolCallId);
		void convertToPng(originalData, originalMimeType)
			.then(converted => {
				if (!converted) return;
				const latestEntry = this.#entries.get(entry.toolCallId);
				if (!latestEntry?.image) return;
				if (latestEntry.image.data !== originalData || latestEntry.image.mimeType !== originalMimeType) return;
				this.#kittyConvertedImages.set(entry.toolCallId, {
					data: converted.data,
					mimeType: converted.mimeType,
					byteSize: latestEntry.image.byteSize,
				});
				this.#previewComponents.delete(entry.toolCallId);
				this.#updateDisplay();
				this.#requestRender?.();
			})
			.catch(() => {
				// Ignore conversion failures; preview remains hidden on Kitty for unsupported formats.
			})
			.finally(() => {
				this.#kittyConversionsInFlight.delete(entry.toolCallId);
			});
	}

	#extractByteSizeFromDetails(details: unknown, base64?: string): number | undefined {
		if (details && typeof details === "object" && "imageByteSize" in details) {
			const value = (details as { imageByteSize?: unknown }).imageByteSize;
			if (typeof value === "number" && Number.isFinite(value)) {
				return value;
			}
		}
		if (!base64) return undefined;
		return this.#computeBase64Size(base64);
	}

	#computeBase64Size(base64: string): number {
		const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
		return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
	}
}

/**
 * Adds a tree-style prefix to child components so previews remain aligned with
 * the text summary regardless of viewport width.
 */
class IndentedComponent implements Component {
	constructor(
		private readonly prefix: string,
		private readonly child: Component,
	) {}

	render(width: number): string[] {
		const indentWidth = visibleWidth(this.prefix);
		const childWidth = Math.max(1, width - indentWidth);
		const lines = this.child.render(childWidth);
		return lines.map(line => `${this.prefix}${line}`);
	}

	invalidate(): void {
		this.child.invalidate();
	}
}
