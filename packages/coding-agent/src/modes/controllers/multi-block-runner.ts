import { expandSlashCommand, type FileSlashCommand } from "../../extensibility/slash-commands";
import { MULTI_BLOCK_COMMAND_MESSAGE_TYPE } from "../../session/messages";
import {
	executeBuiltinSlashCommand,
	isBatchableBuiltinSlashCommand,
	isBuiltinSlashCommandName,
} from "../../slash-commands/builtin-registry";
import type { InteractiveModeContext } from "../types";
import { type SubmissionBlock, type SubmissionLineIntentEntry, splitSubmissionIntoBlocks } from "./submission-blocks";

type SkillCommandHandler = (
	text: string,
	options?: { addToHistory?: boolean; suppressTurn?: boolean },
) => Promise<"not-handled" | "handled" | "error">;

interface CommandBlockExecutionResult {
	success: boolean;
	appendedText?: string;
	contributesPromptContent?: boolean;
}

type ShortcutBlockHandler = (commandOrCode: string, excludeFromContext: boolean) => Promise<boolean>;

type TextBlockDispatcher = (text: string, options: { suppressTurn: boolean }) => Promise<void>;

interface ExecuteCommandBlockOptions {
	ctx: InteractiveModeContext;
	fileCommands: FileSlashCommand[];
	suppressTurn: boolean;
	handleSkillCommand: SkillCommandHandler;
	handleBackgroundCommand: () => void;
}

export type MultiBlockProcessingResult =
	| { processed: false }
	| {
			processed: true;
			success: boolean;
			remainingText: string | null;
			continueFromContext: boolean;
			fallbackPromptText: string | null;
	  };

export interface MultiBlockRunnerOptions {
	ctx: InteractiveModeContext;
	text: string;
	lineIntents?: SubmissionLineIntentEntry[];
	handleSkillCommand: SkillCommandHandler;
	handleBackgroundCommand: () => void;
	handleBashShortcut: ShortcutBlockHandler;
	handlePythonShortcut: ShortcutBlockHandler;
	handleTextBlock: TextBlockDispatcher;
}

/**
 * Expands a stacked submission into per-block chat entries while ensuring downstream code still
 * triggers exactly one agent turn. Intermediate text is rendered immediately for ordering; when
 * the final renderable block is a command, callers can continue from the already-persisted context
 * instead of emitting a duplicate trailing user message.
 */
export async function runMultiBlockSubmission(options: MultiBlockRunnerOptions): Promise<MultiBlockProcessingResult> {
	const { ctx, text } = options;
	if (!text.includes("\n")) {
		return { processed: false };
	}
	if (ctx.session.isStreaming || ctx.session.isCompacting) {
		return { processed: false };
	}

	const splitResult = splitSubmissionIntoBlocks(text, {
		isSupportedSlashCommand: candidate => isRecognizedSlashCommand(ctx, candidate),
		lineIntents: options.lineIntents,
	});
	if (splitResult.parseError) {
		ctx.showError(splitResult.parseError.message);
		return {
			processed: true,
			success: false,
			remainingText: null,
			continueFromContext: false,
			fallbackPromptText: null,
		};
	}

	const blocks = splitResult.blocks;
	const executableBlockCount = blocks.filter(block => block.type !== "text").length;
	const isSingleFencedShortcut =
		blocks.length === 1 &&
		(blocks[0]?.type === "bash-shortcut" || blocks[0]?.type === "python-shortcut") &&
		blocks[0].fenced === true;
	if (executableBlockCount === 0 || (blocks.length === 1 && !isSingleFencedShortcut)) {
		return { processed: false };
	}

	const editorSnapshot = ctx.editor.getText();
	const fileCommands = Array.from(ctx.session.fileCommands ?? []);
	let remainingText: string | null = null;
	let hasPromptableContent = false;
	let fallbackPromptText: string | null = null;

	for (let i = 0; i < blocks.length; i += 1) {
		const block = blocks[i];
		if (block.type === "command") {
			const result = await executeCommandBlock(block.text, {
				ctx,
				fileCommands,
				suppressTurn: true,
				handleSkillCommand: options.handleSkillCommand,
				handleBackgroundCommand: options.handleBackgroundCommand,
			});
			if (!result.success) {
				ctx.editor.setText(editorSnapshot);
				return {
					processed: true,
					success: false,
					remainingText: null,
					continueFromContext: false,
					fallbackPromptText: null,
				};
			}
			const appended = result.appendedText?.trim();
			if (result.contributesPromptContent) {
				hasPromptableContent = true;
			}
			if (appended) {
				fallbackPromptText = appended;
				const shouldDispatchImmediately = hasFutureRenderableBlock(blocks, i);
				if (shouldDispatchImmediately) {
					await options.handleTextBlock(appended, { suppressTurn: true });
				} else {
					remainingText = appended;
				}
			}
			continue;
		}

		if (block.type === "bash-shortcut") {
			const result = await executeShortcutBlock(block.text, {
				ctx,
				handleShortcut: options.handleBashShortcut,
				prefix: "!",
				excludedPrefix: "!!",
				description: "bash",
			});
			if (!result.success) {
				ctx.editor.setText(editorSnapshot);
				return {
					processed: true,
					success: false,
					remainingText: null,
					continueFromContext: false,
					fallbackPromptText: null,
				};
			}
			continue;
		}

		if (block.type === "python-shortcut") {
			const result = await executeShortcutBlock(block.text, {
				ctx,
				handleShortcut: options.handlePythonShortcut,
				prefix: "$",
				excludedPrefix: "$$",
				description: "python",
			});
			if (!result.success) {
				ctx.editor.setText(editorSnapshot);
				return {
					processed: true,
					success: false,
					remainingText: null,
					continueFromContext: false,
					fallbackPromptText: null,
				};
			}
			continue;
		}

		const trimmed = block.text.trim();
		if (!trimmed) {
			continue;
		}
		hasPromptableContent = true;
		fallbackPromptText = trimmed;
		const shouldDispatchImmediately = hasFutureRenderableBlock(blocks, i);
		if (shouldDispatchImmediately) {
			await options.handleTextBlock(trimmed, { suppressTurn: true });
		} else {
			remainingText = trimmed;
		}
	}

	const finalRenderableBlockKind = getLastRenderableBlockKind(blocks);
	const continueFromContext = remainingText === null && finalRenderableBlockKind === "command" && hasPromptableContent;

	return { processed: true, success: true, remainingText, continueFromContext, fallbackPromptText };
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

function hasFutureRenderableBlock(blocks: SubmissionBlock[], startIndex: number): boolean {
	for (let i = startIndex + 1; i < blocks.length; i += 1) {
		const block = blocks[i];
		if (block.type === "command" || block.type === "bash-shortcut" || block.type === "python-shortcut") {
			return true;
		}
		if (block.type === "text" && block.text.trim().length > 0) {
			return true;
		}
	}
	return false;
}

function getLastRenderableBlockKind(blocks: SubmissionBlock[]): "command" | "text" | null {
	for (let i = blocks.length - 1; i >= 0; i -= 1) {
		const block = blocks[i];
		if (block.type === "command" || block.type === "bash-shortcut" || block.type === "python-shortcut") {
			return "command";
		}
		if (block.type === "text" && block.text.trim().length > 0) {
			return "text";
		}
	}
	return null;
}

interface ExecuteShortcutBlockOptions {
	ctx: InteractiveModeContext;
	handleShortcut: ShortcutBlockHandler;
	prefix: string;
	excludedPrefix: string;
	description: "bash" | "python";
}

async function executeShortcutBlock(
	shortcutText: string,
	options: ExecuteShortcutBlockOptions,
): Promise<CommandBlockExecutionResult> {
	const isExcluded = shortcutText.startsWith(options.excludedPrefix);
	const payload = isExcluded
		? shortcutText.slice(options.excludedPrefix.length).trim()
		: shortcutText.slice(options.prefix.length).trim();

	if (!payload) {
		options.ctx.showError(`Unsupported ${options.description} shortcut in multi-block submission: ${shortcutText}`);
		return { success: false };
	}

	const handled = await options.handleShortcut(payload, isExcluded);
	return { success: handled, contributesPromptContent: false };
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
		return { success: outcome === "handled", contributesPromptContent: outcome === "handled" };
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
		if (handled) {
			await emitBuiltinCommandMessage(options.ctx, commandText);
		}
		return { success: handled, contributesPromptContent: false };
	}

	const fileCommand = options.fileCommands.find(cmd => cmd.name === commandName);
	if (fileCommand) {
		const expanded = expandSlashCommand(commandText, options.fileCommands);
		return { success: true, appendedText: expanded, contributesPromptContent: expanded.trim().length > 0 };
	}

	options.ctx.showError(`Unsupported slash command in multi-block submission: ${commandText}`);
	return { success: false };
}

/**
 * Emit a lightweight custom message that records builtin slash command execution during a multi-block run.
 */
async function emitBuiltinCommandMessage(ctx: InteractiveModeContext, commandText: string): Promise<void> {
	await ctx.session.sendCustomMessage(
		{
			customType: MULTI_BLOCK_COMMAND_MESSAGE_TYPE,
			content: `Ran ${commandText}`,
			display: true,
			details: { command: commandText, kind: "builtin" },
		},
		{ triggerTurn: false },
	);
}
