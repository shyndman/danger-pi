import type { Component, Container, TUI } from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import type { AgentSession } from "../session/agent-session";
import type { AgentSessionEvent } from "../session/agent-session-events";
import type {
	ComposerBatchDispatch,
	ComposerBatchDraft,
	ComposerBatchEntry,
	PreparedComposerBatchItem,
} from "../session/composer-batch";
import type { BashExecutionMessage, PythonExecutionMessage } from "../session/messages";
import { executeBuiltinSlashCommand } from "../slash-commands/builtin-registry";
import { parseSlashCommand } from "../slash-commands/helpers/parse";
import { BashExecutionComponent } from "./components/bash-execution";
import { EvalExecutionComponent } from "./components/eval-execution";
import { shiftImageMarkers } from "./composer-attachments";
import { buildSkillCommandPrompt, isKnownSkillCommand } from "./skill-command";
import type { InteractiveModeContext } from "./types";

const activeComposerExecutions = new WeakMap<AgentSession, Component[]>();

type PythonCommandParser = (text: string) => { code: string; isExcluded: boolean } | undefined;
type QueueOutcome = "staged" | "handled" | "failed";

export type ComposerBatchSubmissionResult =
	| { kind: "dispatch"; dispatch: ComposerBatchDispatch }
	| { kind: "handled" }
	| { kind: "failed" };

export interface ComposerBatchSubmission {
	dispatch: ComposerBatchDispatch;
	finish(): void;
}

export function registerActiveComposerExecution(session: AgentSession, component: Component): () => void {
	const components = activeComposerExecutions.get(session) ?? [];
	if (!activeComposerExecutions.has(session)) activeComposerExecutions.set(session, components);
	components.push(component);
	let registered = true;
	return () => {
		if (!registered) return;
		registered = false;
		const index = components.indexOf(component);
		if (index >= 0) components.splice(index, 1);
	};
}

export function detachActiveComposerExecutions(session: AgentSession, container: Container): void {
	for (const component of activeComposerExecutions.get(session) ?? []) container.removeChild(component);
}

function executionComponent(message: BashExecutionMessage | PythonExecutionMessage, ui: TUI): Component {
	if (message.role === "bashExecution") {
		const component = new BashExecutionComponent(message.command, ui, message.excludeFromContext === true);
		component.setComplete(message.exitCode, message.cancelled, {
			output: message.output,
			truncation: message.meta?.truncation,
		});
		return component;
	}
	const component = new EvalExecutionComponent(message.code, ui, message.excludeFromContext === true);
	component.setComplete(message.exitCode, message.cancelled, {
		output: message.output,
		truncation: message.meta?.truncation,
	});
	return component;
}

export function appendComposerBatchExecutions(session: AgentSession, container: Container, ui: TUI): void {
	for (const entry of session.composerBatch.entries) {
		for (const message of entry.prepared.messages) {
			if (message.role === "bashExecution" || message.role === "pythonExecution") {
				container.addChild(executionComponent(message, ui));
			}
		}
	}
	for (const component of activeComposerExecutions.get(session) ?? []) container.addChild(component);
}

export function watchComposerBatchExecutions(target: AgentSession, dispatch: ComposerBatchDispatch): () => void {
	const executions = new Set(
		dispatch.entries.flatMap(entry =>
			entry.prepared.messages.filter(
				(message): message is BashExecutionMessage | PythonExecutionMessage =>
					message.role === "bashExecution" || message.role === "pythonExecution",
			),
		),
	);
	return target.subscribe((event: AgentSessionEvent) => {
		if (
			event.type !== "message_start" ||
			!executions.delete(event.message as BashExecutionMessage | PythonExecutionMessage)
		) {
			return;
		}
	});
}

/** Owns idle composer staging, final preparation, and dispatch restoration. */
export class ComposerBatchController {
	readonly #ctx: InteractiveModeContext;
	readonly #parsePythonCommandInput: PythonCommandParser;

	constructor(ctx: InteractiveModeContext, parsePythonCommandInput: PythonCommandParser) {
		this.#ctx = ctx;
		this.#parsePythonCommandInput = parsePythonCommandInput;
	}

	async queueDraft(target: AgentSession, draft: ComposerBatchDraft): Promise<void> {
		await this.#queueDraft(target, draft);
	}

	async prepareSubmission(
		target: AgentSession,
		finalDraft: ComposerBatchDraft | undefined,
	): Promise<ComposerBatchSubmissionResult> {
		if (finalDraft) {
			const outcome = await this.#queueDraft(target, finalDraft);
			if (outcome !== "staged") return { kind: outcome };
		}
		const dispatch = target.composerBatch.take();
		if (!dispatch) return { kind: "handled" };
		this.#ctx.updatePendingMessagesDisplay();
		return { kind: "dispatch", dispatch };
	}

	createSubmission(target: AgentSession, dispatch: ComposerBatchDispatch): ComposerBatchSubmission {
		const stopWatching = watchComposerBatchExecutions(target, dispatch);
		const removeSignatures: Array<() => void> = [];
		for (const entry of dispatch.entries) {
			for (const message of entry.prepared.messages) {
				if (message.role !== "user") continue;
				const imageCount =
					typeof message.content === "string" ? 0 : message.content.filter(block => block.type === "image").length;
				removeSignatures.push(this.#ctx.recordLocalSubmission(this.#ctx.getUserMessageText(message), imageCount));
			}
		}
		let finished = false;
		return {
			dispatch,
			finish: () => {
				if (finished) return;
				finished = true;
				stopWatching();
				for (const removeSignature of removeSignatures) removeSignature();
				if (!dispatch.accepted) dispatch.restore();
				this.#ctx.updatePendingMessagesDisplay();
				this.#ctx.ui.requestRender();
			},
		};
	}

	async #queueDraft(target: AgentSession, draft: ComposerBatchDraft): Promise<QueueOutcome> {
		const releasePending = target.composerBatch.beginPending();
		try {
			const prepared = await this.#prepareDraft(target, draft);
			if (!prepared) {
				this.#restoreImages(draft);
				return "handled";
			}
			const entry: ComposerBatchEntry = { draft, prepared };
			if (!target.composerBatch.stage(entry)) {
				this.#restoreDraft(draft);
				logger.warn("Composer batch stage skipped after session change", { sessionId: draft.sessionId });
				return "failed";
			}
			this.#ctx.updatePendingMessagesDisplay();
			this.#ctx.ui.requestRender();
			return "staged";
		} catch (error) {
			this.#restoreDraft(draft);
			logger.error("Composer batch preparation failed", {
				sessionId: draft.sessionId,
				error: error instanceof Error ? error.message : String(error),
			});
			this.#ctx.showError(error instanceof Error ? error.message : String(error));
			return "failed";
		} finally {
			releasePending();
		}
	}

	async #prepareDraft(
		target: AgentSession,
		draft: ComposerBatchDraft,
	): Promise<PreparedComposerBatchItem | undefined> {
		if (draft.text.startsWith("!")) return await this.#prepareBashDraft(target, draft);
		const pythonCommand = this.#parsePythonCommandInput(draft.text);
		if (pythonCommand) return await this.#preparePythonDraft(target, draft, pythonCommand);
		return await this.#preparePromptDraft(target, draft);
	}

	async #prepareBashDraft(
		target: AgentSession,
		draft: ComposerBatchDraft,
	): Promise<PreparedComposerBatchItem | undefined> {
		const isExcluded = draft.text.startsWith("!!");
		const command = draft.text.slice(isExcluded ? 2 : 1).trim();
		if (!command) return undefined;
		const execution = await this.#ctx.handleBashCommand(command, isExcluded, { kind: "composerBatch", draft });
		return await target.prepareComposerBatchItem({
			kind: "execution",
			timestamp: draft.timestamp,
			images: [],
			message: execution.message,
		});
	}

	async #preparePythonDraft(
		target: AgentSession,
		draft: ComposerBatchDraft,
		command: { code: string; isExcluded: boolean },
	): Promise<PreparedComposerBatchItem | undefined> {
		if (!command.code) return undefined;
		const execution = await this.#ctx.handlePythonCommand(command.code, command.isExcluded, {
			kind: "composerBatch",
			draft,
		});
		return await target.prepareComposerBatchItem({
			kind: "execution",
			timestamp: draft.timestamp,
			images: [],
			message: execution.message,
		});
	}

	async #preparePromptDraft(
		target: AgentSession,
		draft: ComposerBatchDraft,
	): Promise<PreparedComposerBatchItem | undefined> {
		const parsed = parseSlashCommand(draft.text);
		const draftDetached =
			parsed?.name === "plan" ||
			parsed?.name === "vibe" ||
			parsed?.name === "goal" ||
			parsed?.name === "guided-goal";
		const slashResult = await executeBuiltinSlashCommand(draft.text, {
			ctx: this.#ctx,
			input: draft.images.length > 0 ? { images: [...draft.images], imageLinks: [...draft.imageLinks] } : undefined,
			draftDetached,
		});
		if (slashResult === true) return undefined;
		const promptText = typeof slashResult === "string" ? slashResult : draft.text;
		if (isKnownSkillCommand(this.#ctx, promptText)) {
			const built = await buildSkillCommandPrompt(this.#ctx, promptText, "steer", [...draft.images]);
			if (!built) return undefined;
			return await target.prepareComposerBatchItem({
				kind: "custom",
				timestamp: draft.timestamp,
				promptText,
				images: draft.images,
				message: built.message,
			});
		}
		return await target.prepareComposerBatchItem({
			kind: "prompt",
			timestamp: draft.timestamp,
			text: promptText,
			images: draft.images,
			resolveCommands: target === this.#ctx.session,
		});
	}

	#restoreImages(draft: ComposerBatchDraft): void {
		if (draft.images.length === 0) return;
		this.#ctx.editor.pendingImages.push(...draft.images);
		this.#ctx.editor.pendingImageLinks.push(...draft.imageLinks);
		this.#ctx.editor.imageLinks = this.#ctx.editor.pendingImageLinks;
	}

	#restoreDraft(draft: ComposerBatchDraft): void {
		const imageOffset = this.#ctx.editor.pendingImages.length;
		const restoredText = shiftImageMarkers(draft.text, imageOffset);
		const currentText = this.#ctx.editor.getText();
		this.#restoreImages(draft);
		this.#ctx.editor.setCollapsedText([restoredText, currentText].filter(text => text.trim()).join("\n\n"));
	}
}
