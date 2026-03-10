import type { Component } from "@oh-my-pi/pi-tui";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import type { Theme } from "../modes/theme/theme";
import { renderStatusLine } from "../tui";
import { type DisplayReportEntry, isDisplayToolDetails } from "./display/index";
import { formatExpandHint, replaceTabs, shortenPath, TRUNCATE_LENGTHS, truncateToWidth } from "./render-utils";

interface DisplayRenderArgs {
	type?: string;
	resources?: string[];
}

/**
 * <intent>
 * Display rendering is replay-only. It reads recorded details and never re-runs resolution or
 * display type execution when the UI expands, collapses, or redraws.
 * </intent>
 */
export const displayToolRenderer = {
	renderCall(args: DisplayRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const count = args.resources?.length ?? 0;
		const description = args.type ? `${args.type} · ${count} resource(s)` : `${count} resource(s)`;
		return simpleLines([renderStatusLine({ icon: "pending", title: "Display", description }, uiTheme)]);
	},
	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: DisplayRenderArgs,
	): Component {
		const details = isDisplayToolDetails(result.details) ? result.details : undefined;
		const summary = result.content.find(block => block.type === "text")?.text ?? "";
		const report = details?.report ?? [];
		const lines = [renderStatusLine({ icon: result.isError ? "error" : "success", title: "Display" }, uiTheme)];
		if (summary.trim()) {
			lines.push(uiTheme.fg("toolOutput", replaceTabs(summary.trim())));
		}
		for (const line of renderReport(report, options, uiTheme)) {
			lines.push(line);
		}
		if (!options.expanded && report.length > 4) {
			lines.push(formatExpandHint(uiTheme, false, true));
		}
		if (details?.drawIntents?.length) {
			const label = args?.type ?? details.drawIntents[0]?.type ?? "display";
			lines.push(uiTheme.fg("muted", `${details.drawIntents.length} ${label} draw intent(s) recorded for replay`));
		}
		return simpleLines(lines);
	},
	mergeCallAndResult: true,
};

function renderReport(report: DisplayReportEntry[], options: RenderResultOptions, uiTheme: Theme): string[] {
	const limit = options.expanded ? report.length : 4;
	return report.slice(0, limit).map(entry => {
		const status = entry.error
			? uiTheme.styledSymbol("status.error", "error")
			: uiTheme.styledSymbol("status.success", "success");
		const uri = truncateToWidth(shortenPath(entry.uri), TRUNCATE_LENGTHS.LINE);
		const base = `${status} ${entry.type} ${uri}`;
		if (!entry.error) return base;
		return `${base} ${uiTheme.fg("error", `(${replaceTabs(entry.error)})`)}`;
	});
}

function simpleLines(lines: string[]): Component {
	return {
		render(width: number) {
			return lines.map(line => truncateToWidth(line, width));
		},
		invalidate() {},
	};
}
