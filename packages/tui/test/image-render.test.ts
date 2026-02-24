import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Image } from "@oh-my-pi/pi-tui/components/image";
import {
	type CellDimensions,
	getCellDimensions,
	ImageProtocol,
	isWindowsTerminalPreviewSixelSupported,
	renderImage,
	setCellDimensions,
	TERMINAL,
} from "@oh-my-pi/pi-tui/terminal-capabilities";

type MutableTerminalInfo = {
	imageProtocol: ImageProtocol | null;
};

const terminal = TERMINAL as unknown as MutableTerminalInfo;
const BASE64_DUMMY = "AA==";
const SQUARE_DIMENSIONS = { widthPx: 100, heightPx: 100 };
const BASE64_ONE_PIXEL_PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==";
const BASE64_STUB = "R0lGODdhAQABAIAAAP///////ywAAAAAAQABAAACAkQBADs="; // 1x1 gif

function parseKittyParam(sequence: string, key: "c" | "r"): number | null {
	const match = sequence.match(new RegExp(`${key}=(\\d+)`));
	if (!match) return null;
	return Number.parseInt(match[1], 10);
}

function parseITermParam(sequence: string, key: "width" | "height"): string | null {
	const match = sequence.match(new RegExp(`${key}=([^;:]+)`));
	return match?.[1] ?? null;
}

describe("terminal image rendering", () => {
	let previousProtocol: ImageProtocol | null;
	let previousCellDims: CellDimensions;

	beforeEach(() => {
		previousProtocol = terminal.imageProtocol;
		previousCellDims = { ...getCellDimensions() };
		setCellDimensions({ widthPx: 10, heightPx: 10 });
		terminal.imageProtocol = null;
	});

	afterEach(() => {
		terminal.imageProtocol = previousProtocol;
		setCellDimensions(previousCellDims);
	});

	it("fits Kitty images within max width and max height while preserving aspect ratio", () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		const result = renderImage(BASE64_DUMMY, SQUARE_DIMENSIONS, {
			maxWidthCells: 10,
			maxHeightCells: 2,
		});

		expect(result).not.toBeNull();
		expect(result?.rows).toBe(2);
		expect(parseKittyParam(result?.sequence ?? "", "c")).toBe(2);
		expect(parseKittyParam(result?.sequence ?? "", "r")).toBe(2);
	});

	it("uses intrinsic image size when no bounds are provided", () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		const result = renderImage(BASE64_DUMMY, SQUARE_DIMENSIONS);

		expect(result).not.toBeNull();
		expect(result?.rows).toBe(10);
		expect(parseKittyParam(result?.sequence ?? "", "c")).toBe(10);
		expect(parseKittyParam(result?.sequence ?? "", "r")).toBe(10);
	});

	it("respects maxHeightCells for Kitty", () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		setCellDimensions({ widthPx: 1, heightPx: 1 });
		const result = renderImage(BASE64_STUB, { widthPx: 10, heightPx: 500 }, { maxWidthCells: 5, maxHeightCells: 2 });

		expect(result).not.toBeNull();
		expect(result?.rows).toBe(2);
		expect(parseKittyParam(result?.sequence ?? "", "r")).toBe(2);
	});

	it("encodes iTerm2 pixel bounds when height is limiting", () => {
		terminal.imageProtocol = ImageProtocol.Iterm2;
		const result = renderImage(BASE64_DUMMY, SQUARE_DIMENSIONS, {
			maxWidthCells: 10,
			maxHeightCells: 2,
		});

		expect(result).not.toBeNull();
		expect(result?.rows).toBe(2);
		expect(parseITermParam(result?.sequence ?? "", "width")).toBe("20px");
		expect(parseITermParam(result?.sequence ?? "", "height")).toBe("20px");
	});

	it("respects maxHeightCells for iTerm2", () => {
		terminal.imageProtocol = ImageProtocol.Iterm2;
		setCellDimensions({ widthPx: 2, heightPx: 2 });
		const result = renderImage(BASE64_STUB, { widthPx: 20, heightPx: 1200 }, { maxWidthCells: 4, maxHeightCells: 3 });

		expect(result).not.toBeNull();
		expect(result?.rows).toBe(3);
		expect(parseITermParam(result?.sequence ?? "", "height")).toBe("6px");
	});

	it("encodes SIXEL output when protocol is SIXEL", () => {
		terminal.imageProtocol = ImageProtocol.Sixel;
		const result = renderImage(BASE64_ONE_PIXEL_PNG, SQUARE_DIMENSIONS, {
			maxWidthCells: 10,
			maxHeightCells: 2,
		});

		expect(result).not.toBeNull();
		expect(result?.rows).toBe(2);
		expect(result?.sequence.startsWith("\x1bP")).toBe(true);
	});

	it("Image component forwards maxHeightCells to terminal rendering", () => {
		terminal.imageProtocol = ImageProtocol.Kitty;
		const image = new Image(
			BASE64_DUMMY,
			"image/png",
			{ fallbackColor: text => text },
			{ maxWidthCells: 10, maxHeightCells: 2 },
			SQUARE_DIMENSIONS,
		);

		const lines = image.render(20);

		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain("\x1b[1A");
		expect(lines[1]).toContain("c=2");
		expect(lines[1]).toContain("r=2");
	});

	it("falls back to text when no image protocol is available", () => {
		terminal.imageProtocol = null;
		const theme = { fallbackColor: (text: string) => text };
		const image = new Image(BASE64_STUB, "image/gif", theme, {
			filename: "stub.gif",
		});
		const rendered = image.render(40);

		expect(rendered.join("\n")).toContain("[Image: stub.gif [image/gif]");
	});
});

describe("Windows Terminal Preview SIXEL detection", () => {
	it("requires Windows platform, WT session, and known version 1.22+", () => {
		expect(
			isWindowsTerminalPreviewSixelSupported(
				{
					WT_SESSION: "1",
					TERM_PROGRAM: "Windows_Terminal",
					TERM_PROGRAM_VERSION: "1.22.2362.0",
				},
				"win32",
			),
		).toBe(true);
		expect(
			isWindowsTerminalPreviewSixelSupported(
				{
					WT_SESSION: "1",
					TERM_PROGRAM: "Windows_Terminal",
					TERM_PROGRAM_VERSION: "1.21.0.0",
				},
				"win32",
			),
		).toBe(false);
		expect(
			isWindowsTerminalPreviewSixelSupported({ WT_SESSION: "1", TERM_PROGRAM: "Windows_Terminal" }, "win32"),
		).toBe(false);
		expect(
			isWindowsTerminalPreviewSixelSupported(
				{
					WT_SESSION: "1",
					TERM_PROGRAM: "Windows_Terminal",
					TERM_PROGRAM_VERSION: "1.22.2362.0",
				},
				"linux",
			),
		).toBe(false);
	});
});
