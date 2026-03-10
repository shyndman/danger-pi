import { getImageDimensions } from "@oh-my-pi/pi-tui";
import type { ResolvedDisplayResource } from "../contracts";
import type { DisplayRuntime } from "../runtime";
import type { DisplayTypeDefinition } from "../type-registry";

/**
 * Image display type keeps image validation local so future display types do not inherit
 * image-specific rules or payload assumptions.
 */
class ImageDisplayType implements DisplayTypeDefinition {
	readonly type = "image";

	async execute(resources: ResolvedDisplayResource[], runtime: DisplayRuntime): Promise<void> {
		for (const resource of resources) {
			try {
				const prepared = this.prepare(resource);
				runtime.showImage({ type: this.type, uri: resource.uri, index: resource.index, ...prepared });
			} catch (error) {
				runtime.reportFailure(this.type, resource.uri, error, resource.index);
			}
		}
	}

	prepare(resource: ResolvedDisplayResource): { data: string; mimeType: string; widthPx: number; heightPx: number } {
		if (!resource.mimeType?.startsWith("image/")) {
			throw new Error("Resource is not a supported image.");
		}
		const data = Buffer.from(resource.bytes).toString("base64");
		const dimensions = getImageDimensions(data, resource.mimeType);
		if (!dimensions || !Number.isInteger(dimensions.widthPx) || !Number.isInteger(dimensions.heightPx)) {
			throw new Error("Failed to determine image dimensions.");
		}
		if (dimensions.widthPx <= 0 || dimensions.heightPx <= 0) {
			throw new Error("Image dimensions must be greater than zero.");
		}
		return {
			data,
			mimeType: resource.mimeType,
			widthPx: dimensions.widthPx,
			heightPx: dimensions.heightPx,
		};
	}
}

export function createImageDisplayType(): DisplayTypeDefinition {
	return new ImageDisplayType();
}
