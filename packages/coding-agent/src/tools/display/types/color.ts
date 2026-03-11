import * as zlib from "node:zlib";
import {
	DISPLAY_COLOR_SWATCH_GAP_PX,
	DISPLAY_COLOR_SWATCH_MAX_COLUMNS,
	DISPLAY_COLOR_SWATCH_SIZE_PX,
} from "../constants";
import type { ResolvedDisplayResource } from "../contracts";
import type { DisplayRuntime } from "../runtime";
import type { DisplayTypeDefinition } from "../type-registry";

/**
 * Color display type accepts only the narrow v1 grammar so callers have one obvious, canonical
 * input form and mixed batches fail predictably per resource.
 */
class ColorDisplayType implements DisplayTypeDefinition {
	readonly type = "color";

	async execute(resources: ResolvedDisplayResource[], runtime: DisplayRuntime): Promise<void> {
		const validResources: Array<{ resource: ResolvedDisplayResource; color: string }> = [];
		for (const resource of resources) {
			try {
				validResources.push({ resource, color: parseCanonicalColor(resource) });
			} catch (error) {
				runtime.reportFailure(this.type, resource.uri, error, resource.index);
			}
		}

		if (validResources.length === 0) {
			return;
		}

		try {
			const rendered = renderColorSwatches(validResources.map(entry => entry.color));
			const primary = validResources[0]!;
			runtime.showImage({
				index: primary.resource.index,
				type: this.type,
				uri: primary.resource.uri,
				data: rendered.data,
				mimeType: "image/png",
				widthPx: rendered.widthPx,
				heightPx: rendered.heightPx,
			});
			for (let i = 1; i < validResources.length; i += 1) {
				const entry = validResources[i]!;
				runtime.reportSuccess(this.type, entry.resource.uri, entry.resource.index);
			}
		} catch (error) {
			for (const entry of validResources) {
				runtime.reportFailure(this.type, entry.resource.uri, error, entry.resource.index);
			}
		}
	}
}

export function createColorDisplayType(): DisplayTypeDefinition {
	return new ColorDisplayType();
}

function parseCanonicalColor(resource: ResolvedDisplayResource): string {
	if (resource.mimeType !== "text/plain") {
		throw new Error("Color resources must resolve as text/plain.");
	}
	const value = resource.text?.trim() ?? "";
	if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
		throw new Error("Color resources must contain exactly one canonical #RRGGBB value.");
	}
	return value.toUpperCase();
}

function renderColorSwatches(colors: string[]): { data: string; widthPx: number; heightPx: number } {
	const palette = colors.map(parseHexColor);
	const columns = Math.min(DISPLAY_COLOR_SWATCH_MAX_COLUMNS, palette.length);
	const rows = Math.ceil(palette.length / columns);
	const widthPx = columns * DISPLAY_COLOR_SWATCH_SIZE_PX + (columns - 1) * DISPLAY_COLOR_SWATCH_GAP_PX;
	const heightPx = rows * DISPLAY_COLOR_SWATCH_SIZE_PX + (rows - 1) * DISPLAY_COLOR_SWATCH_GAP_PX;
	const pixels = Buffer.alloc(widthPx * heightPx * 4);

	for (const [index, color] of palette.entries()) {
		const column = index % columns;
		const row = Math.floor(index / columns);
		paintSwatch(pixels, widthPx, row, column, color);
	}

	const png = encodeRgbaPng(widthPx, heightPx, pixels);
	return { data: Buffer.from(png).toString("base64"), widthPx, heightPx };
}

function paintSwatch(
	pixels: Buffer,
	canvasWidthPx: number,
	row: number,
	column: number,
	[r, g, b]: [number, number, number],
): void {
	const originY = row * (DISPLAY_COLOR_SWATCH_SIZE_PX + DISPLAY_COLOR_SWATCH_GAP_PX);
	const originX = column * (DISPLAY_COLOR_SWATCH_SIZE_PX + DISPLAY_COLOR_SWATCH_GAP_PX);
	for (let y = 0; y < DISPLAY_COLOR_SWATCH_SIZE_PX; y += 1) {
		const scanlineStart = ((originY + y) * canvasWidthPx + originX) * 4;
		for (let x = 0; x < DISPLAY_COLOR_SWATCH_SIZE_PX; x += 1) {
			const offset = scanlineStart + x * 4;
			pixels[offset] = r;
			pixels[offset + 1] = g;
			pixels[offset + 2] = b;
			pixels[offset + 3] = 255;
		}
	}
}

function parseHexColor(color: string): [number, number, number] {
	return [
		Number.parseInt(color.slice(1, 3), 16),
		Number.parseInt(color.slice(3, 5), 16),
		Number.parseInt(color.slice(5, 7), 16),
	];
}

function encodeRgbaPng(width: number, height: number, pixels: Buffer): Uint8Array {
	const raw = Buffer.alloc(height * (1 + width * 4));
	for (let y = 0; y < height; y += 1) {
		const rowOffset = y * (1 + width * 4);
		raw[rowOffset] = 0;
		pixels.copy(raw, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
	}
	const compressed = zlib.deflateSync(raw);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		makePngChunk("IHDR", makeIhdr(width, height)),
		makePngChunk("IDAT", compressed),
		makePngChunk("IEND", Buffer.alloc(0)),
	]);
}

function makeIhdr(width: number, height: number): Buffer {
	const data = Buffer.alloc(13);
	data.writeUInt32BE(width, 0);
	data.writeUInt32BE(height, 4);
	data[8] = 8;
	data[9] = 6;
	data[10] = 0;
	data[11] = 0;
	data[12] = 0;
	return data;
}

function makePngChunk(type: string, data: Buffer): Buffer {
	const typeBuffer = Buffer.from(type, "ascii");
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
	return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) {
			const mask = -(crc & 1);
			crc = (crc >>> 1) ^ (0xedb88320 & mask);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}
