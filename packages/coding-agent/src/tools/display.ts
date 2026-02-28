import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { getImageDimensions } from "@oh-my-pi/pi-tui";
import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { renderPromptTemplate } from "../config/prompt-templates";
import displayDescription from "../prompts/tools/display.md" with { type: "text" };
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime";
import type { ToolSession } from ".";
import type { OutputMeta } from "./output-meta";
import { formatBytes } from "./render-utils";
import { toolResult } from "./tool-result";

const DISPLAY_IMAGE_CAPABILITY_SETTING = "display.enableImage";
const MAX_DISPLAY_IMAGE_SIZE = 20 * 1024 * 1024;

const displaySchema = Type.Object(
	{
		type: Type.String({ description: "Display type. v0 supports only image." }),
		resources: Type.Array(Type.String(), {
			description: "Resource URIs. v0 supports absolute file: URIs only.",
			minItems: 1,
		}),
		options: Type.Optional(
			Type.Object(
				{
					title: Type.Optional(Type.String()),
					mode: Type.Optional(
						Type.Union([Type.Literal("inline"), Type.Literal("external"), Type.Literal("auto")]),
					),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);

export type DisplayToolInput = Static<typeof displaySchema>;

export type DisplayFailureCode = "invalid_resource_uri" | "unsupported_scheme" | "resource_not_found" | "render_failed";

export type DisplayErrorCode = "invalid_args" | "invalid_type" | "capability_disabled" | "render_failed";

/**
 * Image metadata for a successfully processed resource.
 *
 * Keeps binary payloads in `details` so model-facing summary text stays concise.
 */
export interface DisplayImageEntry {
	index: number;
	resource: string;
	data: string;
	mimeType: string;
	widthPx: number;
	heightPx: number;
}

/**
 * Failure metadata for a resource that could not be processed.
 *
 * Uses a fixed error vocabulary so mixed-success batches are predictable.
 */
export interface DisplayFailureEntry {
	index: number;
	resource: string;
	code: DisplayFailureCode;
	message: string;
}

/**
 * Call-level error metadata for display failures.
 *
 * Includes a machine-readable error code and optional recovery setting key.
 */
export interface DisplayErrorDetails {
	code: DisplayErrorCode;
	message: string;
	settingKey?: string;
}

/**
 * Additional metadata returned by the display tool.
 *
 * Separates UI image payloads (`images`) from concise model-facing text (`content`).
 */
export interface DisplayToolDetails {
	meta?: OutputMeta;
	images?: DisplayImageEntry[];
	failures?: DisplayFailureEntry[];
	error?: DisplayErrorDetails;
	summary?: {
		total: number;
		succeeded: number;
		failed: number;
	};
}

/**
 * Displays local images for the user.
 *
 * Implements an image-only, URI-strict contract that is independent from `read` runtime logic.
 */
export class DisplayTool implements AgentTool<typeof displaySchema, DisplayToolDetails> {
	readonly name = "display";
	readonly label = "Display";
	readonly description: string;
	readonly parameters = displaySchema;
	readonly strict = true;

	constructor(private readonly session: ToolSession) {
		this.description = renderPromptTemplate(displayDescription);
	}

	async execute(
		_toolCallId: string,
		params: DisplayToolInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<DisplayToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<DisplayToolDetails>> {
		if (!this.session.settings.get(DISPLAY_IMAGE_CAPABILITY_SETTING)) {
			return this.#errorResult(
				"capability_disabled",
				`display image capability is disabled; enable ${DISPLAY_IMAGE_CAPABILITY_SETTING}`,
				{ settingKey: DISPLAY_IMAGE_CAPABILITY_SETTING },
			);
		}

		if (params.type !== "image") {
			return this.#errorResult("invalid_type", `Unsupported display type: ${params.type}`);
		}

		if (!Array.isArray(params.resources) || params.resources.length === 0) {
			return this.#errorResult("invalid_args", "resources must be a non-empty array");
		}

		const images: DisplayImageEntry[] = [];
		const failures: DisplayFailureEntry[] = [];

		for (const [index, resource] of params.resources.entries()) {
			const parsed = this.#parseResourceUri(resource, index, failures);
			if (!parsed) continue;

			const filePath = this.#resolveFilePath(parsed, resource, index, failures);
			if (!filePath) continue;

			const imageResult = await this.#processImageResource(filePath, resource, index);
			if ("failure" in imageResult) {
				failures.push(imageResult.failure);
				continue;
			}

			images.push(imageResult.image);
		}

		const summary = {
			total: params.resources.length,
			succeeded: images.length,
			failed: failures.length,
		};
		const summaryText = `Displayed ${summary.succeeded} image(s); ${summary.failed} failed.`;

		if (images.length === 0) {
			return this.#errorResult("render_failed", summaryText, { failures, summary });
		}

		const details: DisplayToolDetails = {
			images,
			failures,
			summary,
		};
		return toolResult(details).text(summaryText).done();
	}

	#parseResourceUri(resource: string, index: number, failures: DisplayFailureEntry[]): URL | null {
		let parsed: URL;
		try {
			parsed = new URL(resource);
		} catch {
			failures.push({
				index,
				resource,
				code: "invalid_resource_uri",
				message: "Resource must be an absolute URI",
			});
			return null;
		}

		if (!parsed.protocol || parsed.protocol === ":") {
			failures.push({
				index,
				resource,
				code: "invalid_resource_uri",
				message: "Resource must be an absolute URI",
			});
			return null;
		}

		if (parsed.protocol !== "file:") {
			failures.push({
				index,
				resource,
				code: "unsupported_scheme",
				message: `Unsupported URI scheme: ${parsed.protocol.replace(/:$/, "")}`,
			});
			return null;
		}

		return parsed;
	}

	#resolveFilePath(parsed: URL, resource: string, index: number, failures: DisplayFailureEntry[]): string | null {
		let filePath: string;
		try {
			filePath = fileURLToPath(parsed);
		} catch {
			failures.push({
				index,
				resource,
				code: "invalid_resource_uri",
				message: "Resource file URI could not be resolved to a local path",
			});
			return null;
		}

		return filePath;
	}

	async #processImageResource(
		filePath: string,
		resource: string,
		index: number,
	): Promise<{ image: DisplayImageEntry } | { failure: DisplayFailureEntry }> {
		let stat: fs.Stats;
		try {
			stat = await fs.promises.stat(filePath);
		} catch {
			return {
				failure: {
					index,
					resource,
					code: "resource_not_found",
					message: "Resource file was not found",
				},
			};
		}

		if (!stat.isFile()) {
			return {
				failure: {
					index,
					resource,
					code: "resource_not_found",
					message: "Resource does not resolve to a file",
				},
			};
		}

		if (stat.size > MAX_DISPLAY_IMAGE_SIZE) {
			return {
				failure: {
					index,
					resource,
					code: "render_failed",
					message: `Image file too large: ${formatBytes(stat.size)} exceeds ${formatBytes(MAX_DISPLAY_IMAGE_SIZE)} limit`,
				},
			};
		}

		const mimeType = await detectSupportedImageMimeTypeFromFile(filePath);
		if (!mimeType) {
			return {
				failure: {
					index,
					resource,
					code: "render_failed",
					message: "Unsupported or unreadable image format",
				},
			};
		}

		let buffer: Buffer;
		try {
			buffer = await fs.promises.readFile(filePath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				failure: {
					index,
					resource,
					code: "render_failed",
					message: `Failed to read image: ${message}`,
				},
			};
		}

		if (buffer.byteLength > MAX_DISPLAY_IMAGE_SIZE) {
			return {
				failure: {
					index,
					resource,
					code: "render_failed",
					message: `Image file too large: ${formatBytes(buffer.byteLength)} exceeds ${formatBytes(MAX_DISPLAY_IMAGE_SIZE)} limit`,
				},
			};
		}

		const data = buffer.toString("base64");
		const dimensions = getImageDimensions(data, mimeType);
		if (!dimensions || !Number.isInteger(dimensions.widthPx) || !Number.isInteger(dimensions.heightPx)) {
			return {
				failure: {
					index,
					resource,
					code: "render_failed",
					message: "Failed to determine image dimensions",
				},
			};
		}

		if (dimensions.widthPx <= 0 || dimensions.heightPx <= 0) {
			return {
				failure: {
					index,
					resource,
					code: "render_failed",
					message: "Image dimensions must be greater than zero",
				},
			};
		}

		return {
			image: {
				index,
				resource,
				data,
				mimeType,
				widthPx: dimensions.widthPx,
				heightPx: dimensions.heightPx,
			},
		};
	}

	#errorResult(
		code: DisplayErrorCode,
		message: string,
		options?: { settingKey?: string; failures?: DisplayFailureEntry[]; summary?: DisplayToolDetails["summary"] },
	): AgentToolResult<DisplayToolDetails> {
		const details: DisplayToolDetails = {
			error: {
				code,
				message,
				settingKey: options?.settingKey,
			},
			failures: options?.failures,
			summary: options?.summary,
		};

		return toolResult(details).text(`${code}: ${message}`).done();
	}
}
