import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { ImageContent, Message } from "@oh-my-pi/pi-ai";
import type { BashExecutionMessage, CustomMessage, PythonExecutionMessage } from "./messages";

export interface ComposerBatchDraft {
	sessionId: string;
	timestamp: number;
	text: string;
	images: readonly ImageContent[];
	imageLinks: readonly (string | undefined)[];
}

export type ComposerBatchCustomMessage = Pick<
	CustomMessage,
	"customType" | "content" | "display" | "details" | "attribution"
> & {
	display: true;
	attribution: "user";
};

export type ComposerBatchMessage = Message | CustomMessage | BashExecutionMessage | PythonExecutionMessage;

export type ComposerBatchInput =
	| {
			kind: "prompt";
			timestamp: number;
			text: string;
			images: readonly ImageContent[];
			resolveCommands: boolean;
	  }
	| {
			kind: "custom";
			timestamp: number;
			promptText: string;
			images: readonly ImageContent[];
			message: ComposerBatchCustomMessage;
	  }
	| {
			kind: "execution";
			timestamp: number;
			images: readonly ImageContent[];
			message: BashExecutionMessage | PythonExecutionMessage;
	  };

export interface PreparedComposerBatchItem {
	promptText: string;
	images: readonly ImageContent[];
	messages: readonly [ComposerBatchMessage, ...ComposerBatchMessage[]];
	modelVisible: boolean;
}

export interface ComposerBatchEntry {
	draft: ComposerBatchDraft;
	prepared: PreparedComposerBatchItem;
}

export interface ComposerBatchDispatch {
	readonly entries: readonly ComposerBatchEntry[];
	readonly sourceSessionId: string;
	readonly hasModelVisible: boolean;
	readonly turnText: string;
	readonly hookImages: readonly ImageContent[];
	readonly accepted: boolean;
	accept(): void;
	restore(): boolean;
}

class ComposerBatchDispatchImpl implements ComposerBatchDispatch {
	#settled = false;
	#accepted = false;
	readonly #settle: (restore: boolean, entries: readonly ComposerBatchEntry[], sourceSessionId: string) => boolean;

	constructor(
		readonly entries: readonly ComposerBatchEntry[],
		readonly sourceSessionId: string,
		readonly hasModelVisible: boolean,
		readonly turnText: string,
		readonly hookImages: readonly ImageContent[],
		settle: (restore: boolean, entries: readonly ComposerBatchEntry[], sourceSessionId: string) => boolean,
	) {
		this.#settle = settle;
	}

	get accepted(): boolean {
		return this.#accepted;
	}

	accept(): void {
		if (this.#settled) return;
		this.#settled = true;
		this.#accepted = true;
		this.#settle(false, this.entries, this.sourceSessionId);
	}

	restore(): boolean {
		if (this.#settled) return false;
		this.#settled = true;
		return this.#settle(true, this.entries, this.sourceSessionId);
	}
}

/** Transient ordered composer work for one live session ID. */
export class ComposerBatch {
	readonly #getSessionId: () => string;
	#sessionId: string;
	#entries: ComposerBatchEntry[] = [];
	#pendingCount = 0;
	#previousTimestamp = 0;

	constructor(getSessionId: () => string) {
		this.#getSessionId = getSessionId;
		this.#sessionId = getSessionId();
	}

	get entries(): readonly ComposerBatchEntry[] {
		this.#syncSession();
		return this.#entries;
	}

	get size(): number {
		this.#syncSession();
		return this.#entries.length;
	}

	get workCount(): number {
		this.#syncSession();
		return this.#entries.length + this.#pendingCount;
	}

	stage(entry: ComposerBatchEntry): boolean {
		this.#syncSession();
		if (entry.draft.sessionId !== this.#sessionId) return false;
		this.#entries.push(entry);
		return true;
	}

	pop(): ComposerBatchEntry | undefined {
		this.#syncSession();
		return this.#entries.pop();
	}

	take(): ComposerBatchDispatch | undefined {
		this.#syncSession();
		if (this.#entries.length === 0) return undefined;
		const entries = this.#entries;
		this.#entries = [];
		this.#pendingCount++;
		const sourceSessionId = this.#sessionId;
		const visibleEntries = entries.filter(entry => entry.prepared.modelVisible);
		const turnText = visibleEntries
			.map(entry => entry.prepared.promptText)
			.filter(text => text.length > 0)
			.join("\n\n");
		const hookImages = visibleEntries.flatMap(entry => entry.prepared.images);
		return new ComposerBatchDispatchImpl(
			entries,
			sourceSessionId,
			visibleEntries.length > 0,
			turnText,
			hookImages,
			(restore, takenEntries, takenSessionId) => this.#settleDispatch(restore, takenEntries, takenSessionId),
		);
	}

	beginPending(): () => void {
		this.#syncSession();
		const sourceSessionId = this.#sessionId;
		this.#pendingCount++;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#syncSession();
			if (this.#sessionId !== sourceSessionId) return;
			this.#pendingCount--;
		};
	}

	nextTimestamp(now = Date.now()): number {
		this.#syncSession();
		this.#previousTimestamp = Math.max(now, this.#previousTimestamp + 1);
		return this.#previousTimestamp;
	}

	#settleDispatch(restore: boolean, entries: readonly ComposerBatchEntry[], sourceSessionId: string): boolean {
		this.#syncSession();
		if (this.#sessionId !== sourceSessionId) return false;
		this.#pendingCount--;
		if (restore) this.#entries = [...entries, ...this.#entries];
		return true;
	}

	#syncSession(): void {
		const sessionId = this.#getSessionId();
		if (sessionId === this.#sessionId) return;
		this.#sessionId = sessionId;
		this.#entries = [];
		this.#pendingCount = 0;
		this.#previousTimestamp = 0;
	}
}

export interface ComposerBatchCoordinatorHost {
	readonly agentMessages: {
		appendMessage(message: AgentMessage): void;
	};
	sessionId(): string;
	prepare(input: ComposerBatchInput): Promise<PreparedComposerBatchItem | undefined>;
	prompt(
		message: AgentMessage,
		turnText: string,
		options: {
			images: readonly ImageContent[];
			prependMessages: ComposerBatchMessage[] | undefined;
			userAuthoredTurn: boolean;
			canStart: () => boolean;
			onAccepted: () => void;
		},
	): Promise<boolean>;
	persist(message: ComposerBatchMessage): void;
	emitMessage(message: ComposerBatchMessage, phase: "start" | "end"): Promise<void>;
	waitForSubscribers(): Promise<void>;
}

/** Prepares composer inputs and owns their aggregate acceptance and persistence. */
export class ComposerBatchCoordinator {
	readonly #host: ComposerBatchCoordinatorHost;
	readonly #prePersisted = new WeakSet<AgentMessage>();
	#pending:
		| { dispatch: ComposerBatchDispatch; messages: readonly [ComposerBatchMessage, ...ComposerBatchMessage[]] }
		| undefined;

	constructor(host: ComposerBatchCoordinatorHost) {
		this.#host = host;
	}

	prepare(input: ComposerBatchInput): Promise<PreparedComposerBatchItem | undefined> {
		return this.#host.prepare(input);
	}

	async prompt(dispatch: ComposerBatchDispatch): Promise<void> {
		if (dispatch.sourceSessionId !== this.#host.sessionId()) {
			throw new Error("Composer batch source session changed before submission");
		}
		const messages = dispatch.entries.flatMap(entry => entry.prepared.messages);
		const finalMessage = messages[messages.length - 1];
		if (!finalMessage) throw new Error("Composer batch dispatch contains no messages");
		const batchMessages = messages as [ComposerBatchMessage, ...ComposerBatchMessage[]];
		if (!dispatch.hasModelVisible) {
			dispatch.accept();
			for (const message of batchMessages) {
				this.#host.persist(message);
				this.#host.agentMessages.appendMessage(message);
				await this.#host.emitMessage(message, "start");
				await this.#host.emitMessage(message, "end");
			}
			await this.#host.waitForSubscribers();
			return;
		}

		this.#pending = { dispatch, messages: batchMessages };
		try {
			const prompted = await this.#host.prompt(finalMessage, dispatch.turnText, {
				images: dispatch.hookImages,
				prependMessages: batchMessages.length > 1 ? batchMessages.slice(0, -1) : undefined,
				userAuthoredTurn: true,
				canStart: () => dispatch.sourceSessionId === this.#host.sessionId(),
				onAccepted: () => dispatch.accept(),
			});
			if (!prompted) this.#pending = undefined;
		} catch (error) {
			if (!dispatch.accepted) this.#pending = undefined;
			throw error;
		}
	}

	onMessageStart(message: AgentMessage): void {
		const pending = this.#pending;
		if (!pending?.messages.some(input => input === message)) return;
		this.#pending = undefined;
		for (const input of pending.messages) {
			this.#host.persist(input);
			this.#prePersisted.add(input);
		}
	}

	consumePrePersisted(message: AgentMessage): boolean {
		if (!this.#prePersisted.has(message)) return false;
		this.#prePersisted.delete(message);
		return true;
	}
}
