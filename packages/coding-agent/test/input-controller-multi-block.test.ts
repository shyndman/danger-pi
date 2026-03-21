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
	const handleBashCommandMock = vi.fn(async () => {});
	const handleBtwCommandMock = vi.fn(async () => {});
	const handlePythonCommandMock = vi.fn(async () => {});
	const slashCommands: FileSlashCommand[] = [];
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
			messages: [{ role: "assistant" }],
			abort: vi.fn(async () => {}),
			extensionRunner: undefined,
			isCompacting: false,
			prompt: promptMock,
			continueFromContext: continueFromContextMock,
			promptCustomMessage: promptCustomMessageMock,
			sendCustomMessage: sendCustomMessageMock,
			setSlashCommands: vi.fn((commands: FileSlashCommand[]) => {
				slashCommands.splice(0, slashCommands.length, ...commands);
			}),
			get fileCommands() {
				return slashCommands;
			},
			modelRegistry: {} as InteractiveModeContext["session"]["modelRegistry"],
			sessionId: "test-session",
		} as unknown as InteractiveModeContext["session"],
		sessionManager: {
			getCwd: () => process.cwd(),
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
		skillCommands: new Map<string, { filePath: string; isNative: boolean }>(),
		startPendingSubmission,
		showError,
		showWarning,
		showStatus,
		reloadTodos: vi.fn(async () => {}),
		updatePendingMessagesDisplay: vi.fn(),
		updateEditorBorderColor: vi.fn(),
		flushPendingBashComponents: vi.fn(),
		queueCompactionMessage: vi.fn(),
		handleBashCommand: handleBashCommandMock,
		handleBtwCommand: handleBtwCommandMock,
		handlePythonCommand: handlePythonCommandMock,
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

	return {
		ctx,
		editor,
		showError,
		promptMock,
		continueFromContextMock,
		planMock,
		sendCustomMessageMock,
		handleBtwCommandMock,
	};
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

	it("runs /btw before trailing text without adding btw prompt content to the main turn", async () => {
		const { ctx, editor, handleBtwCommandMock, sendCustomMessageMock, showError } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/btw why is the cache warm?\nUse the cached path for the main fix`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(showError).not.toHaveBeenCalled();
		expect(handleBtwCommandMock).toHaveBeenCalledTimes(1);
		expect(handleBtwCommandMock).toHaveBeenCalledWith("why is the cache warm?");
		expect(sendCustomMessageMock).toHaveBeenCalledTimes(1);
		expect(sendCustomMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ customType: "multi-block-command", content: "Ran /btw why is the cache warm?" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledTimes(1);
		expect(onInput).toHaveBeenCalledWith({
			text: "Use the cached path for the main fix",
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

	it("emits text before a final /btw and continues from context without a trailing user message", async () => {
		const { ctx, editor, handleBtwCommandMock, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "Keep the current patch small\n\n/btw what evidence justifies this path?";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(handleBtwCommandMock).toHaveBeenCalledTimes(1);
		expect(handleBtwCommandMock).toHaveBeenCalledWith("what evidence justifies this path?");
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ customType: "multi-block-text", content: "Keep the current patch small" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				customType: "multi-block-command",
				content: "Ran /btw what evidence justifies this path?",
			}),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledTimes(1);
		expect(onInput).toHaveBeenCalledWith({
			text: "",
			continueFromContext: true,
			cancelled: false,
			started: true,
		});
		expect(editor.history).toEqual(["Keep the current patch small", submission]);
	});

	it("handles command-only stacks without prompting the agent", async () => {
		const { ctx, editor, planMock } = createTestContext();
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

	it("handles command-only /btw stacks without triggering a main agent turn", async () => {
		const { ctx, editor, handleBtwCommandMock, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/btw first side question\n\n/btw second side question`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(handleBtwCommandMock).toHaveBeenCalledTimes(2);
		expect(handleBtwCommandMock).toHaveBeenNthCalledWith(1, "first side question");
		expect(handleBtwCommandMock).toHaveBeenNthCalledWith(2, "second side question");
		expect(sendCustomMessageMock).toHaveBeenCalledTimes(2);
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.history).toEqual([submission]);
	});

	it("runs stacked /btw blocks in author order", async () => {
		const { ctx, editor, handleBtwCommandMock } = createTestContext();
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = `/btw first replacement\n\n/btw second replacement\n\nFinal user turn`;
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(handleBtwCommandMock).toHaveBeenCalledTimes(2);
		expect(handleBtwCommandMock).toHaveBeenNthCalledWith(1, "first replacement");
		expect(handleBtwCommandMock).toHaveBeenNthCalledWith(2, "second replacement");
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

	it("executes mixed shortcut and text blocks in author order", async () => {
		const { ctx, editor, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "!ls\nthis is a message\n!ls -al\nthis is another\n$print('hi')";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handleBashCommand).toHaveBeenNthCalledWith(1, "ls", false);
		expect(ctx.handleBashCommand).toHaveBeenNthCalledWith(2, "ls -al", false);
		expect(ctx.handlePythonCommand).toHaveBeenNthCalledWith(1, "print('hi')", false);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ customType: "multi-block-text", content: "this is a message" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ customType: "multi-block-text", content: "this is another" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledWith({
			text: "",
			continueFromContext: true,
			cancelled: false,
			started: true,
		});
		expect(editor.history).toEqual(["this is a message", "this is another", submission]);
	});

	it("handles command-only shortcut stacks without triggering an agent turn", async () => {
		const { ctx, editor, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "!ls\n!! pwd\n$print('hi')\n$$ print('hidden')";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handleBashCommand).toHaveBeenNthCalledWith(1, "ls", false);
		expect(ctx.handleBashCommand).toHaveBeenNthCalledWith(2, "pwd", true);
		expect(ctx.handlePythonCommand).toHaveBeenNthCalledWith(1, "print('hi')", false);
		expect(ctx.handlePythonCommand).toHaveBeenNthCalledWith(2, "print('hidden')", true);
		expect(sendCustomMessageMock).not.toHaveBeenCalled();
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.history).toEqual([submission]);
	});

	it("treats multiline empty shortcut lines as plain text", async () => {
		const { ctx, editor } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "!\n$$\nhello";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handleBashCommand).not.toHaveBeenCalled();
		expect(ctx.handlePythonCommand).not.toHaveBeenCalled();
		expect(onInput).toHaveBeenCalledWith({
			text: submission,
			images: undefined,
			cancelled: false,
			started: false,
		});
	});

	it("executes fenced bash shortcuts as one command block", async () => {
		const { ctx, editor } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = '!```\necho "this\nis a test\nboo"\n```';
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handleBashCommand).toHaveBeenCalledTimes(1);
		expect(ctx.handleBashCommand).toHaveBeenCalledWith('echo "this\nis a test\nboo"', false);
		expect(ctx.handlePythonCommand).not.toHaveBeenCalled();
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.history).toEqual([submission]);
	});

	it("executes fenced python shortcuts as one command block", async () => {
		const { ctx, editor } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "$```\ntext = '''hello\nworld'''\nprint(text)\n```";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handlePythonCommand).toHaveBeenCalledTimes(1);
		expect(ctx.handlePythonCommand).toHaveBeenCalledWith("text = '''hello\nworld'''\nprint(text)", false);
		expect(ctx.handleBashCommand).not.toHaveBeenCalled();
		expect(onInput).not.toHaveBeenCalled();
		expect(editor.history).toEqual([submission]);
	});

	it("preserves order when text and fenced shortcuts are mixed", async () => {
		const { ctx, editor, sendCustomMessageMock } = createTestContext();
		const onInput = vi.fn();
		ctx.onInputCallback = onInput;
		const controller = new InputController(ctx);
		controller.setupEditorSubmitHandler();

		const submission = "!```\necho hi\n```\nmessage one\n$```\nprint('hi')\n```\nmessage two";
		editor.setText(submission);
		await ctx.editor.onSubmit?.(submission);

		expect(ctx.handleBashCommand).toHaveBeenCalledWith("echo hi", false);
		expect(ctx.handlePythonCommand).toHaveBeenCalledWith("print('hi')", false);
		expect(sendCustomMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ customType: "multi-block-text", content: "message one" }),
			expect.objectContaining({ triggerTurn: false }),
		);
		expect(onInput).toHaveBeenCalledWith({
			text: "message two",
			images: undefined,
			cancelled: false,
			started: false,
		});
		expect(editor.history).toEqual(["message one", submission]);
	});
});
