export type SubmissionBlockType = "command" | "text";

export type SubmissionBlock = {
	type: SubmissionBlockType;
	text: string;
};

export type SubmissionBlockDetector = (candidate: string) => boolean;

export interface SplitSubmissionOptions {
	isSupportedSlashCommand: SubmissionBlockDetector;
}

function normalizeNewlines(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

function flushPendingText(pending: string, result: SubmissionBlock[], trimTrailingNewline = false): string {
	if (pending.length > 0) {
		let textValue = pending;
		if (trimTrailingNewline) {
			textValue = textValue.replace(/\n$/, "");
		}
		if (textValue.length > 0) {
			result.push({ type: "text", text: textValue });
		}
		return "";
	}
	return pending;
}

export function splitSubmissionIntoBlocks(submission: string, options: SplitSubmissionOptions): SubmissionBlock[] {
	const normalized = normalizeNewlines(submission);
	const lines = normalized.split("\n");
	const result: SubmissionBlock[] = [];
	let pendingText = "";

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		const suffix = i < lines.length - 1 ? "\n" : "";
		const trimmed = line.trim();
		const candidate = trimmed.startsWith("/") ? trimmed : null;
		const isCommand = Boolean(candidate && options.isSupportedSlashCommand(trimmed));

		if (isCommand && candidate) {
			pendingText = flushPendingText(pendingText, result, true);
			result.push({ type: "command", text: trimmed });
		} else {
			pendingText += line + suffix;
		}
	}

	flushPendingText(pendingText, result);
	return result;
}
