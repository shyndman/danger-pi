import * as zlib from "node:zlib";
import { DISPLAY_COLOR_SWATCH_SIZE_PX } from "../constants";
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
		for (const resource of resources) {
			try {
				const color = parseCanonicalColor(resource);
				runtime.showImage({
					index: resource.index,
					type: this.type,
					uri: resource.uri,
					data: renderColorSwatch(color),
					mimeType: "image/png",
					widthPx: DISPLAY_COLOR_SWATCH_SIZE_PX,
					heightPx: DISPLAY_COLOR_SWATCH_SIZE_PX,
				});
			} catch (error) {
				runtime.reportFailure(this.type, resource.uri, error, resource.index);
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

function renderColorSwatch(color: string): string {
	const rgb = parseHexColor(color);
	const png = encodeSolidPng(DISPLAY_COLOR_SWATCH_SIZE_PX, DISPLAY_COLOR_SWATCH_SIZE_PX, rgb);
	return Buffer.from(png).toString("base64");
}

function parseHexColor(color: string): [number, number, number] {
	return [
		Number.parseInt(color.slice(1, 3), 16),
		Number.parseInt(color.slice(3, 5), 16),
		Number.parseInt(color.slice(5, 7), 16),
	];
}

function encodeSolidPng(width: number, height: number, [r, g, b]: [number, number, number]): Uint8Array {
	const row = Buffer.alloc(1 + width * 4);
	row[0] = 0;
	for (let x = 0; x < width; x++) {
		const offset = 1 + x * 4;
		row[offset] = r;
		row[offset + 1] = g;
		row[offset + 2] = b;
		row[offset + 3] = 255;
	}
	const raw = Buffer.concat(Array.from({ length: height }, () => row));
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
