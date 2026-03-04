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
 * For Kitty graphics rendering, this component intentionally delegates cursor
 * advancement to Kitty's own placement behavior. Keep manual cursor movement
 * escape sequences out of this file so TUI and terminal don't fight over
 * cursor state.
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
				// Emit only the image sequence and rely on terminal placement cursor policy.
				lines = [result.sequence];
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
