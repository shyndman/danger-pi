import {
	type BlobStore,
	DEFAULT_IMAGE_EXTERNALIZE_THRESHOLD,
	externalizeImageData,
	isBlobRef,
	resolveImageData,
} from "../../session/blob-store";
import { type DisplayImageDrawIntent, type DisplayToolDetails, isDisplayToolDetails } from "./contracts";

/**
 * <intent>
 * Persisted display draw payloads use the same threshold-based inline-vs-blob decision point as
 * other session image payloads so saved sessions stay bounded without changing replay semantics.
 * </intent>
 */
export async function externalizeDisplayDetails(
	blobStore: BlobStore,
	details: DisplayToolDetails | undefined,
): Promise<DisplayToolDetails | undefined> {
	if (!details?.drawIntents?.length) return details;
	let changed = false;
	const drawIntents = await Promise.all(
		details.drawIntents.map(async drawIntent => {
			if (!isImageDrawIntent(drawIntent)) return drawIntent;
			if (isBlobRef(drawIntent.image.data) || drawIntent.image.data.length < DEFAULT_IMAGE_EXTERNALIZE_THRESHOLD) {
				return drawIntent;
			}
			changed = true;
			return {
				...drawIntent,
				image: {
					...drawIntent.image,
					data: await externalizeImageData(blobStore, drawIntent.image.data),
				},
			};
		}),
	);
	return changed ? { ...details, drawIntents } : details;
}

export async function resolveDisplayDetails(blobStore: BlobStore, details: unknown): Promise<void> {
	if (!isDisplayToolDetails(details) || !details.drawIntents?.length) return;
	await Promise.all(
		details.drawIntents.map(async drawIntent => {
			if (!isImageDrawIntent(drawIntent) || !isBlobRef(drawIntent.image.data)) return;
			drawIntent.image.data = await resolveImageData(blobStore, drawIntent.image.data);
		}),
	);
}

function isImageDrawIntent(value: unknown): value is DisplayImageDrawIntent {
	if (typeof value !== "object" || value === null) return false;
	return (value as { kind?: string }).kind === "image";
}
