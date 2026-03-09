import {
	getImageDimensions,
	type ImageDimensions,
	imageFallback,
	renderImage,
	TERMINAL,
} from "../terminal-capabilities";
import type { Component } from "../tui";

/**
 * <intent>
 * For Kitty graphics rendering, this component intentionally keeps cursor
 * placement under TUI control. We reserve rows in rendered output and move the
 * cursor back up before emitting the Kitty sequence, while Kitty is configured
 * with no-move policy (C=1). Keep these two behaviors aligned.
 * </intent>
 */

export interface ImageTheme {
	fallbackColor: (str: string) => string;
}

export interface ImageOptions {
	maxWidthCells?: number;
	maxHeightCells?: number;
	filename?: string;
}

export class Image implements Component {
	#base64Data: string;
	#mimeType: string;
	#dimensions: ImageDimensions;
	#theme: ImageTheme;
	#options: ImageOptions;

	#cachedLines?: string[];
	#cachedWidth?: number;

	constructor(
		base64Data: string,
		mimeType: string,
		theme: ImageTheme,
		options: ImageOptions = {},
		dimensions?: ImageDimensions,
	) {
		this.#base64Data = base64Data;
		this.#mimeType = mimeType;
		this.#theme = theme;
		this.#options = options;
		this.#dimensions = dimensions || getImageDimensions(base64Data, mimeType) || { widthPx: 800, heightPx: 600 };
	}

	invalidate(): void {
		this.#cachedLines = undefined;
		this.#cachedWidth = undefined;
	}

	render(width: number): string[] {
		if (this.#cachedLines && this.#cachedWidth === width) {
			return this.#cachedLines;
		}

		const cap = this.#options.maxWidthCells;
		const maxWidth = cap != null && cap > 0 ? Math.min(width - 2, cap) : width - 2;

		let lines: string[];

		if (TERMINAL.imageProtocol) {
			const result = renderImage(this.#base64Data, this.#dimensions, {
				maxWidthCells: maxWidth,
				maxHeightCells: this.#options.maxHeightCells,
			});

			if (result) {
				// Return `rows` lines so TUI accounts for image height.
				// First (rows-1) lines are empty; last line emits move-up + image sequence.
				lines = [];
				for (let i = 0; i < result.rows - 1; i++) {
					lines.push("");
				}
				const moveUp = result.rows > 1 ? `\x1b[${result.rows - 1}A` : "";
				lines.push(moveUp + result.sequence);
			} else {
				const fallback = imageFallback(this.#mimeType, this.#dimensions, this.#options.filename);
				lines = [this.#theme.fallbackColor(fallback)];
			}
		} else {
			const fallback = imageFallback(this.#mimeType, this.#dimensions, this.#options.filename);
			lines = [this.#theme.fallbackColor(fallback)];
		}

		this.#cachedLines = lines;
		this.#cachedWidth = width;

		return lines;
	}
}
