import { describe, expect, it, vi } from "bun:test";
import type { FileSlashCommand } from "../src/extensibility/slash-commands";
import { InputController } from "../src/modes/controllers/input-controller";
import type { InteractiveModeContext, SubmittedUserInput } from "../src/modes/types";

class StubEditor {
	public text = "";
	public history: string[] = [];
	public onSubmit?: (text: string) => Promise<void>;

	setText(value: string): void {
		this.text = value;
	}

	getText(): string {
		return this.text;
	}

	addToHistory(value: string): void {
		this.history.push(value);
	}
}

function createTestContext() {
	const editor = new StubEditor();
	const showError = vi.fn();
	const showWarning = vi.fn();
	const showStatus = vi.fn();
	const promptMock = vi.fn(async () => {});
	const continueFromContextMock = vi.fn(async () => {});
	const promptCustomMessageMock = vi.fn(async () => {});
	const planMock = vi.fn(async () => {});
	const sendCustomMessageMock = vi.fn(async () => {});
	let fileCommands: ReadonlyArray<FileSlashCommand> = [];
	const startPendingSubmission = vi.fn(
		(input: { text: string; images?: InteractiveModeContext["pendingImages"] }): SubmittedUserInput => ({
			text: input.text,
			images: input.images,
			cancelled: false,
			started: false,
		}),
	);

	const ctx = {
		ui: {} as InteractiveModeContext["ui"],
		chatContainer: {} as InteractiveModeContext["chatContainer"],
		pendingMessagesContainer: {} as InteractiveModeContext["pendingMessagesContainer"],
		statusContainer: {} as InteractiveModeContext["statusContainer"],
		todoContainer: {} as InteractiveModeContext["todoContainer"],
		editor,
		editorContainer: {} as InteractiveModeContext["editorContainer"],
		statusLine: {} as InteractiveModeContext["statusLine"],
		fileSlashCommands: new Set<string>(),
		session: {
			isStreaming: false,
			queuedMessageCount: 0,
			messages: [],
			abort: vi.fn(async () => {}),
			extensionRunner: undefined,
			isCompacting: false,
			prompt: promptMock,
			continueFromContext: continueFromContextMock,
			promptCustomMessage: promptCustomMessageMock,
			sendCustomMessage: sendCustomMessageMock,
			get fileCommands() {
				return fileCommands;
			},
			setSlashCommands(commands: FileSlashCommand[]) {
				fileCommands = commands;
			},
			modelRegistry: {} as InteractiveModeContext["session"]["modelRegistry"],
			sessionId: "test-session",
		} as unknown as InteractiveModeContext["session"],
		sessionManager: {
			getSessionName: () => "existing",
			setSessionName: vi.fn(async () => {}),
			getSessionDir: () => ".",
			getEntries: () => [],
		} as unknown as InteractiveModeContext["sessionManager"],
		settings: {
			get: () => false,
			getModelRole: () => "default",
		} as unknown as InteractiveModeContext["settings"],
		keybindings: {} as InteractiveModeContext["keybindings"],
		agent: {
			state: { messages: [{ role: "user" }] },
		} as InteractiveModeContext["agent"],
		pendingImages: [] as InteractiveModeContext["pendingImages"],
		compactionQueuedMessages: [] as InteractiveModeContext["compactionQueuedMessages"],
		pendingTools: new Map(),
		pendingBashComponents: [],
		pendingPythonComponents: [],
		isPythonMode: false,
		isBashMode: false,
		toolOutputExpanded: false,
		todoExpanded: false,
		planModeEnabled: false,
		planModePlanFilePath: undefined,
		hideThinkingBlock: false,
		pendingImagesQueue: undefined,
		isBackgrounded: false,
		pendingBashMessages: [],
		pendingPythonMessages: [],
		skillCommands: new Map<string, string>(),
		startPendingSubmission,
		showError,
		showWarning,
		showStatus,
		reloadTodos: vi.fn(async () => {}),
		updatePendingMessagesDisplay: vi.fn(),
		updateEditorBorderColor: vi.fn(),
		flushPendingBashComponents: vi.fn(),
		queueCompactionMessage: vi.fn(),
		handlePlanModeCommand: planMock,
		showTreeSelector: vi.fn(),
		showUserMessageSelector: vi.fn(),
		handleBackgroundCommand: vi.fn(),
		pendingImagesContainer: {} as InteractiveModeContext["pendingMessagesContainer"],
		setToolUIContext: vi.fn(),
		initializeHookRunner: vi.fn(),
		createBackgroundUiContext: vi.fn(),
		setHookWidget: vi.fn(),
		setHookStatus: vi.fn(),
		setTodos: vi.fn(),
		agentStart: vi.fn(),
		showWarningMessage: vi.fn(),
	} as unknown as InteractiveModeContext;

	return { ctx, editor, showError, promptMock, continueFromContextMock, planMock, sendCustomMessageMock };
}

describe("InputController multi-block submissions", () => {
	it("rejects non-batchable UI commands", async () => {
		const { ctx, editor, showError, promptMock, planMock } = createTestContext();
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/settings\n/plan focus auth\n`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(showError).toHaveBeenCalledWith(expect.stringContaining("/settings"));
		expect(promptMock).not.toHaveBeenCalled();
		expect(planMock).not.toHaveBeenCalled();
		expect(editor.history).toHaveLength(0);
		expect(editor.getText()).toBe(submission);
	});

	it("runs /plan before final text in one turn", async () => {
		const { ctx, editor, planMock, showError } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/plan\nNeed a summary of changes`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(showError).not.toHaveBeenCalled();
		expect(planMock).toHaveBeenCalledTimes(1);
		expect(onInput).toHaveBeenCalledTimes(1);
		expect(onInput).toHaveBeenCalledWith({
			text: "Need a summary of changes",
			images: undefined,
			cancelled: false,
			started: false,
		});
		expect(editor.history).toEqual([submission]);
	});

	it("emits text blocks before commands as custom messages", async () => {
		const { ctx, editor, planMock, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `Intro step\n\n/plan\nNeed summary`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(planMock).toHaveBeenCalledTimes(1);
		expect(onInput).toHaveBeenCalledWith({
			text: "Need summary",
			images: undefined,
			cancelled: false,
			started: false,
		});
		expect(sendCustomMessageMock).toHaveBeenCalledTimes(2);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ customType: "multi-block-text", content: "Intro step" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ customType: "multi-block-command" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(editor.history).toEqual(["Intro step", submission]);
	});

	it("preserves text-before-final-command order and triggers continue-from-context", async () => {
		const { ctx, editor, planMock, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "good\n\n/plan";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(planMock).toHaveBeenCalledTimes(1);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ customType: "multi-block-text", content: "good" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ customType: "multi-block-command" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledWith({
			text: "",
			continueFromContext: true,
			cancelled: false,
			started: true,
		});
		expect(editor.history).toEqual(["good", submission]);
	});

	it("handles command-only stacks without prompting the agent", async () => {
		const { ctx, editor, planMock, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/plan\n\n/plan focus auth`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(planMock).toHaveBeenCalledTimes(2);
		expect(onInput).not.toHaveBeenCalled();
	});

	it("expands file commands and emits their text before final blocks", async () => {
		const { ctx, editor, sendCustomMessageMock } = createTestContext();
		ctx.session.setSlashCommands([
			{
				name: "test-multi.block",
				description: "",
				content: "Generated block",
				source: "test",
			},
		]);
		ctx.fileSlashCommands = new Set(["test-multi.block"]);
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/test-multi.block\n\nNext text`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(sendCustomMessageMock).toHaveBeenCalledTimes(1);
		expect(sendCustomMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ customType: "multi-block-text", content: "Generated block" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledWith({
			text: "Next text",
			images: undefined,
			cancelled: false,
			started: false,
		});
		expect(editor.history).toEqual(["Generated block", submission]);
	});
});
