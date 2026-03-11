import type { ImageDimensions } from "@oh-my-pi/pi-tui";
import { isDisplayToolDetails } from "../../tools/display/index";

export interface ReplayImageBlock {
	data?: string;
	mimeType?: string;
	dimensions?: ImageDimensions;
}

export function getDisplayReplayImages(details: unknown): ReplayImageBlock[] {
	if (!isDisplayToolDetails(details)) return [];
	return (details.drawIntents ?? [])
		.filter(intent => intent.kind === "image")
		.map(intent => ({
			data: intent.image.data,
			mimeType: intent.image.mimeType,
			dimensions:
				Number.isInteger(intent.image.widthPx) &&
				Number.isInteger(intent.image.heightPx) &&
				intent.image.widthPx > 0 &&
				intent.image.heightPx > 0
					? { widthPx: intent.image.widthPx, heightPx: intent.image.heightPx }
					: undefined,
		}));
}
