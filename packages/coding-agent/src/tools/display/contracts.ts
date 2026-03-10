import type { Static } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import type { OutputMeta } from "../output-meta";

export const displayToolTypeSchema = Type.Union([Type.Literal("image"), Type.Literal("color")], {
	description: 'Display type. Supported values: "image", "color".',
});

export const displaySchema = Type.Object(
	{
		type: displayToolTypeSchema,
		resources: Type.Array(Type.String(), {
			description: "Resource URIs. Supported schemes: absolute file:, http:, https:, and data: URIs.",
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
export type DisplayToolType = DisplayToolInput["type"];
export type DisplayResourceScheme = "file" | "http" | "https" | "data";
export type DisplayErrorCode = "invalid_args" | "invalid_type" | "capability_disabled" | "render_failed";
export type DisplayResourceFailureCode =
	| "invalid_resource_uri"
	| "unsupported_scheme"
	| "resource_not_found"
	| "render_failed";

export interface DisplayErrorDetails {
	code: DisplayErrorCode;
	message: string;
	settingKey?: string;
}

export interface DisplayReportEntry {
	type: string;
	uri: string;
	error?: string;
}

export interface DisplayImagePayload {
	data: string;
	mimeType: string;
	widthPx: number;
	heightPx: number;
}

export interface DisplayImageDrawIntent {
	kind: "image";
	type: string;
	uri: string;
	image: DisplayImagePayload;
}

export type DisplayDrawIntent = DisplayImageDrawIntent;

/**
 * <intent>
 * Display result details are replay metadata for the UI and persistence layers.
 * They are intentionally not model-facing content, so heavy draw payloads stay here
 * instead of in `toolResult.content`.
 * </intent>
 */
export interface DisplayToolDetails {
	meta?: OutputMeta;
	report?: DisplayReportEntry[];
	drawIntents?: DisplayDrawIntent[];
	error?: DisplayErrorDetails;
	summary?: {
		total: number;
		succeeded: number;
		failed: number;
	};
}

/**
 * <intent>
 * Resolver output is transport-only. It normalizes retrieval results so display types can
 * focus on type semantics; it must not encode type-specific parsing rules.
 * </intent>
 */
export interface ResolvedDisplayResource {
	index: number;
	uri: string;
	scheme: DisplayResourceScheme;
	mimeType?: string;
	bytes: Uint8Array;
	text?: string;
}

export type ResolvedDisplayResourceResult =
	| { ok: true; resource: ResolvedDisplayResource }
	| { ok: false; index: number; uri: string; error: DisplayResourceError };

export class DisplayResourceError extends Error {
	readonly code: DisplayResourceFailureCode;

	constructor(code: DisplayResourceFailureCode, message: string) {
		super(message);
		this.name = "DisplayResourceError";
		this.code = code;
	}
}

export class DisplayToolError extends Error {
	readonly code: DisplayErrorCode;
	readonly settingKey?: string;

	constructor(code: DisplayErrorCode, message: string, options?: { settingKey?: string }) {
		super(message);
		this.name = "DisplayToolError";
		this.code = code;
		this.settingKey = options?.settingKey;
	}
}

export function isDisplayToolType(value: string): value is DisplayToolType {
	return value === "image" || value === "color";
}

export function isDisplayToolDetails(value: unknown): value is DisplayToolDetails {
	return typeof value === "object" && value !== null;
}

export function normalizeMimeType(value: string | null | undefined): string | undefined {
	if (!value) return undefined;
	return value.split(";", 1)[0]?.trim().toLowerCase() || undefined;
}

export function formatDisplaySummary(summary: NonNullable<DisplayToolDetails["summary"]>, type: string): string {
	return `Displayed ${summary.succeeded} ${type} resource(s); ${summary.failed} failed.`;
}
