import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { detectSupportedImageMimeTypeFromBuffer } from "../../utils/mime";
import { DISPLAY_RESOLVER_MAX_BYTES, DISPLAY_RESOLVER_TIMEOUT_MS } from "./constants";
import {
	DisplayResourceError,
	normalizeMimeType,
	type ResolvedDisplayResource,
	type ResolvedDisplayResourceResult,
} from "./contracts";

/**
 * <intent>
 * The display resolver owns transport retrieval only: URI parsing, scheme dispatch, limits,
 * and transport-level MIME normalization. It must stay free of display-type semantics.
 * </intent>
 */
export interface DisplayResourceResolver {
	resolveResources(resources: string[], signal?: AbortSignal): Promise<ResolvedDisplayResourceResult[]>;
}

export class DefaultDisplayResourceResolver implements DisplayResourceResolver {
	async resolveResources(resources: string[], signal?: AbortSignal): Promise<ResolvedDisplayResourceResult[]> {
		const results: ResolvedDisplayResourceResult[] = [];
		for (const [index, uri] of resources.entries()) {
			try {
				results.push({ ok: true, resource: await this.#resolveResource(index, uri, signal) });
			} catch (error) {
				results.push({ ok: false, index, uri, error: asResourceError(error) });
			}
		}
		return results;
	}

	async #resolveResource(index: number, uri: string, signal?: AbortSignal): Promise<ResolvedDisplayResource> {
		let parsed: URL;
		try {
			parsed = new URL(uri);
		} catch {
			throw new DisplayResourceError("invalid_resource_uri", "Resource must be an absolute URI.");
		}

		switch (parsed.protocol) {
			case "file:":
				return this.#resolveFileResource(index, uri, parsed);
			case "http:":
			case "https:":
				return this.#resolveHttpResource(index, uri, signal);
			case "data:":
				return this.#resolveDataResource(index, uri);
			default:
				throw new DisplayResourceError(
					"unsupported_scheme",
					`Unsupported URI scheme: ${parsed.protocol.replace(/:$/, "")}`,
				);
		}
	}

	async #resolveFileResource(index: number, uri: string, parsed: URL): Promise<ResolvedDisplayResource> {
		let filePath: string;
		try {
			filePath = fileURLToPath(parsed);
		} catch {
			throw new DisplayResourceError(
				"invalid_resource_uri",
				"Resource file URI could not be resolved to a local path.",
			);
		}

		let stat: fs.Stats;
		try {
			stat = await fs.promises.stat(filePath);
		} catch {
			throw new DisplayResourceError("resource_not_found", "Resource file was not found.");
		}
		if (!stat.isFile()) {
			throw new DisplayResourceError("resource_not_found", "Resource does not resolve to a file.");
		}
		if (stat.size > DISPLAY_RESOLVER_MAX_BYTES) {
			throw new DisplayResourceError("render_failed", "Resource exceeds the 20MB display limit.");
		}

		const bytes = await fs.promises.readFile(filePath);
		return createResolvedResource(index, uri, "file", bytes);
	}

	async #resolveHttpResource(index: number, uri: string, signal?: AbortSignal): Promise<ResolvedDisplayResource> {
		const timeoutSignal = AbortSignal.timeout(DISPLAY_RESOLVER_TIMEOUT_MS);
		const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
		let response: Response;
		try {
			response = await fetch(uri, { signal: requestSignal });
		} catch (error) {
			if (timeoutSignal.aborted && !signal?.aborted) {
				throw new DisplayResourceError("render_failed", "Resource fetch timed out after 30 seconds.");
			}
			throw new DisplayResourceError(
				"render_failed",
				error instanceof Error ? error.message : "Resource fetch failed.",
			);
		}
		if (!response.ok) {
			throw new DisplayResourceError("render_failed", `Resource fetch failed with HTTP ${response.status}.`);
		}

		const contentLength = response.headers.get("content-length");
		if (contentLength && Number(contentLength) > DISPLAY_RESOLVER_MAX_BYTES) {
			throw new DisplayResourceError("render_failed", "Resource exceeds the 20MB display limit.");
		}

		const bytes = await readResponseBody(response, DISPLAY_RESOLVER_MAX_BYTES);
		return createResolvedResource(
			index,
			uri,
			new URL(uri).protocol === "http:" ? "http" : "https",
			bytes,
			response.headers.get("content-type"),
		);
	}

	#resolveDataResource(index: number, uri: string): ResolvedDisplayResource {
		const payload = uri.slice("data:".length);
		const commaIndex = payload.indexOf(",");
		if (commaIndex === -1) {
			throw new DisplayResourceError("invalid_resource_uri", "Data URI is missing a payload.");
		}

		const metadata = payload.slice(0, commaIndex);
		const rawData = payload.slice(commaIndex + 1);
		const isBase64 = metadata.toLowerCase().endsWith(";base64");
		const mimeType = normalizeMimeType(metadata.replace(/;base64$/i, "")) ?? "text/plain";
		const bytes = isBase64 ? Buffer.from(rawData, "base64") : Buffer.from(decodeURIComponent(rawData), "utf8");
		if (bytes.byteLength > DISPLAY_RESOLVER_MAX_BYTES) {
			throw new DisplayResourceError("render_failed", "Resource exceeds the 20MB display limit.");
		}
		return createResolvedResource(index, uri, "data", bytes, mimeType);
	}
}

function asResourceError(error: unknown): DisplayResourceError {
	if (error instanceof DisplayResourceError) return error;
	if (error instanceof Error) return new DisplayResourceError("render_failed", error.message);
	return new DisplayResourceError("render_failed", String(error));
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Uint8Array> {
	const reader = response.body?.getReader();
	if (!reader) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxBytes) {
			throw new DisplayResourceError("render_failed", "Resource exceeds the 20MB display limit.");
		}
		return bytes;
	}

	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		total += value.byteLength;
		if (total > maxBytes) {
			throw new DisplayResourceError("render_failed", "Resource exceeds the 20MB display limit.");
		}
		chunks.push(value);
	}

	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return merged;
}

function createResolvedResource(
	index: number,
	uri: string,
	scheme: ResolvedDisplayResource["scheme"],
	bytes: Uint8Array,
	contentType?: string | null,
): ResolvedDisplayResource {
	const imageMimeType = detectSupportedImageMimeTypeFromBuffer(bytes);
	const mimeType = imageMimeType ?? normalizeMimeType(contentType) ?? detectPlainTextMimeType(bytes);
	return {
		index,
		uri,
		scheme,
		mimeType,
		bytes,
		text: mimeType === "text/plain" ? decodeUtf8(bytes) : undefined,
	};
}

function detectPlainTextMimeType(bytes: Uint8Array): string | undefined {
	try {
		decodeUtf8(bytes);
		return "text/plain";
	} catch {
		return undefined;
	}
}

function decodeUtf8(bytes: Uint8Array): string {
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
