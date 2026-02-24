import { expandSlashCommand, type FileSlashCommand } from "../../extensibility/slash-commands";
import {
	executeBuiltinSlashCommand,
	isBatchableBuiltinSlashCommand,
	isBuiltinSlashCommandName,
} from "../../slash-commands/builtin-registry";
import type { InteractiveModeContext } from "../types";
import { splitSubmissionIntoBlocks, type SubmissionBlock } from "./submission-blocks";

type SkillCommandHandler = (
	text: string,
	options?: { addToHistory?: boolean; suppressTurn?: boolean },
) => Promise<"not-handled" | "handled" | "error">;

interface CommandBlockExecutionResult {
	success: boolean;
	appendedText?: string;
}

interface ExecuteCommandBlockOptions {
	ctx: InteractiveModeContext;
	fileCommands: FileSlashCommand[];
	suppressTurn: boolean;
	handleSkillCommand: SkillCommandHandler;
	handleBackgroundCommand: () => void;
}

export type MultiBlockProcessingResult =
	| { processed: false }
	| { processed: true; success: boolean; remainingText: string | null };

export interface MultiBlockRunnerOptions {
	ctx: InteractiveModeContext;
	text: string;
	handleSkillCommand: SkillCommandHandler;
	handleBackgroundCommand: () => void;
}

export async function runMultiBlockSubmission(options: MultiBlockRunnerOptions): Promise<MultiBlockProcessingResult> {
	const { ctx, text } = options;
	if (!text.includes("\n")) {
		return { processed: false };
	}
	if (ctx.session.isStreaming || ctx.session.isCompacting) {
		return { processed: false };
	}

	const blocks = splitSubmissionIntoBlocks(text, {
		isSupportedSlashCommand: candidate => isRecognizedSlashCommand(ctx, candidate),
	});
	const commandCount = blocks.filter(block => block.type === "command").length;
	if (commandCount === 0 || blocks.length === 1) {
		return { processed: false };
	}

	const editorSnapshot = ctx.editor.getText();
	const textParts: string[] = [];
	const fileCommands = Array.from(ctx.session.fileCommands ?? []);

	for (let i = 0; i < blocks.length; i += 1) {
		const block = blocks[i];
		if (block.type === "command") {
			const result = await executeCommandBlock(block.text, {
				ctx,
				fileCommands,
				suppressTurn: hasFutureTextBlock(blocks, i),
				handleSkillCommand: options.handleSkillCommand,
				handleBackgroundCommand: options.handleBackgroundCommand,
			});
			if (!result.success) {
				ctx.editor.setText(editorSnapshot);
				return { processed: true, success: false, remainingText: null };
			}
			if (result.appendedText) {
				textParts.push(result.appendedText);
			}
		} else {
			textParts.push(block.text);
		}
	}

	const remainingText = textParts.join("").trim();
	return { processed: true, success: true, remainingText: remainingText.length > 0 ? remainingText : null };
}

function parseSlashCommandName(commandText: string): string | null {
	if (!commandText.startsWith("/")) return null;
	const body = commandText.slice(1);
	if (!body) return null;
	const whitespaceIndex = body.search(/\s/);
	return whitespaceIndex === -1 ? body : body.slice(0, whitespaceIndex);
}

function isRecognizedSlashCommand(ctx: InteractiveModeContext, candidate: string): boolean {
	if (!candidate.startsWith("/")) {
		return false;
	}
	const commandName = parseSlashCommandName(candidate);
	if (!commandName) {
		return false;
	}
	if (commandName.startsWith("skill:")) {
		return Boolean(ctx.skillCommands?.has(commandName));
	}
	if (ctx.fileSlashCommands?.has(commandName)) {
		return true;
	}
	return isBuiltinSlashCommandName(commandName);
}

function hasFutureTextBlock(blocks: SubmissionBlock[], startIndex: number): boolean {
	for (let i = startIndex + 1; i < blocks.length; i += 1) {
		const block = blocks[i];
		if (block.type === "text" && block.text.trim().length > 0) {
			return true;
		}
	}
	return false;
}

async function executeCommandBlock(
	commandText: string,
	options: ExecuteCommandBlockOptions,
): Promise<CommandBlockExecutionResult> {
	const commandName = parseSlashCommandName(commandText);
	if (!commandName) {
		options.ctx.showError(`Unsupported slash command in multi-block submission: ${commandText}`);
		return { success: false };
	}

	if (commandName.startsWith("skill:")) {
		const outcome = await options.handleSkillCommand(commandText, {
			addToHistory: false,
			suppressTurn: options.suppressTurn,
		});
		return { success: outcome === "handled" };
	}

	if (isBuiltinSlashCommandName(commandName)) {
		if (!isBatchableBuiltinSlashCommand(commandName)) {
			options.ctx.showError(`The "/${commandName}" command cannot run inside a multi-block submission.`);
			return { success: false };
		}
		const handled = await executeBuiltinSlashCommand(commandText, {
			ctx: options.ctx,
			handleBackgroundCommand: options.handleBackgroundCommand,
		});
		if (!handled) {
			options.ctx.showError(`Failed to execute "/${commandName}" command.`);
		}
		return { success: handled };
	}

	const fileCommand = options.fileCommands.find(cmd => cmd.name === commandName);
	if (fileCommand) {
		const expanded = expandSlashCommand(commandText, options.fileCommands);
		return { success: true, appendedText: expanded };
	}

	options.ctx.showError(`Unsupported slash command in multi-block submission: ${commandText}`);
	return { success: false };
}
