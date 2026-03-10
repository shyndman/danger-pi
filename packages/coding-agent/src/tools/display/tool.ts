import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { renderPromptTemplate } from "../../config/prompt-templates";
import displayDescription from "../../prompts/tools/display.md" with { type: "text" };
import type { ToolSession } from "..";
import { toolResult } from "../tool-result";
import {
	type DisplayToolDetails,
	DisplayToolError,
	type DisplayToolInput,
	displaySchema,
	formatDisplaySummary,
	isDisplayToolType,
} from "./contracts";
import type { DisplayResourceResolver } from "./resource-resolver";
import { createDisplayRuntime } from "./runtime";
import type { DisplayTypeRegistry } from "./type-registry";

const DISPLAY_IMAGE_CAPABILITY_SETTING = "display.enableImage";

/**
 * DisplayTool coordinates shared resource resolution and delegates type-specific semantics to
 * runtime-registered display types. The goal is to keep transport logic and presentation logic separate.
 */
export class DisplayTool implements AgentTool<typeof displaySchema, DisplayToolDetails> {
	readonly name = "display";
	readonly label = "Display";
	readonly description: string;
	readonly parameters = displaySchema;
	readonly strict = true;

	constructor(
		private readonly session: ToolSession,
		private readonly resolver: DisplayResourceResolver,
		private readonly registry: DisplayTypeRegistry,
	) {
		this.description = renderPromptTemplate(displayDescription);
	}

	async execute(
		_toolCallId: string,
		params: DisplayToolInput,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<DisplayToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<DisplayToolDetails>> {
		if (!Array.isArray(params.resources) || params.resources.length === 0) {
			return this.#errorResult(new DisplayToolError("invalid_args", "resources must be a non-empty array"));
		}
		if (!isDisplayToolType(params.type)) {
			return this.#errorResult(new DisplayToolError("invalid_type", `Unsupported display type: ${params.type}`));
		}
		if (params.type === "image" && !this.session.settings.get(DISPLAY_IMAGE_CAPABILITY_SETTING)) {
			return this.#errorResult(
				new DisplayToolError(
					"capability_disabled",
					`display image capability is disabled; enable ${DISPLAY_IMAGE_CAPABILITY_SETTING}`,
					{ settingKey: DISPLAY_IMAGE_CAPABILITY_SETTING },
				),
			);
		}

		const definition = this.registry.get(params.type);
		if (!definition) {
			return this.#errorResult(new DisplayToolError("invalid_type", `Unsupported display type: ${params.type}`));
		}

		const resolvedResults = await this.resolver.resolveResources(params.resources, signal);
		const runtime = createDisplayRuntime(params.resources.length);
		const resolvedResources = [];
		for (const result of resolvedResults) {
			if (!result.ok) {
				runtime.reportFailure(params.type, result.uri, result.error, result.index);
				continue;
			}
			resolvedResources.push(result.resource);
		}

		let callError: DisplayToolError | undefined;
		try {
			await definition.execute(resolvedResources, runtime, signal);
			runtime.throwIfAllFailed();
		} catch (error) {
			callError =
				error instanceof DisplayToolError ? error : new DisplayToolError("render_failed", errorMessage(error));
		}

		const summary = runtime.getSummary();
		const details: DisplayToolDetails = {
			report: runtime.getReportEntries(),
			drawIntents: runtime.getDrawIntents(),
			summary,
			error: callError
				? {
						code: callError.code,
						message: callError.message,
						settingKey: callError.settingKey,
					}
				: undefined,
		};
		const summaryText = formatDisplaySummary(summary, params.type);
		return toolResult(details)
			.text(callError ? `${callError.code}: ${summaryText}` : summaryText)
			.done();
	}

	#errorResult(error: DisplayToolError): AgentToolResult<DisplayToolDetails> {
		return toolResult<DisplayToolDetails>({
			error: {
				code: error.code,
				message: error.message,
				settingKey: error.settingKey,
			},
		})
			.text(`${error.code}: ${error.message}`)
			.done();
	}
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return String(error);
}
