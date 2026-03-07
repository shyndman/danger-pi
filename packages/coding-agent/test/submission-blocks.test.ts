import { describe, expect, it } from "bun:test";

import {
	type SplitSubmissionResult,
	type SubmissionBlock,
	type SubmissionBlockDetector,
	type SubmissionLineIntentEntry,
	splitSubmissionIntoBlocks,
} from "../src/modes/controllers/submission-blocks";

function createDetector(commandNames: string[]): SubmissionBlockDetector {
	const names = new Set(commandNames);
	return (candidate: string) => {
		if (!candidate.startsWith("/")) return false;
		const [name] = candidate.slice(1).split(/\s+/, 1);
		return names.has(name ?? "");
	};
}

function extractKinds(blocks: SubmissionBlock[]): string[] {
	return blocks.map(block => block.type);
}

function split(
	submission: string,
	detector: SubmissionBlockDetector,
	lineIntents?: SubmissionLineIntentEntry[],
): SplitSubmissionResult {
	return splitSubmissionIntoBlocks(submission, {
		isSupportedSlashCommand: detector,
		lineIntents,
	});
}

describe("splitSubmissionIntoBlocks", () => {
	it("treats sequential commands followed by text as separate blocks", () => {
		const detector = createDetector(["plan", "skill:triage"]);
		const submission = `/plan focus auth
/skill:triage onboarding
Please summarize the diff`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "command", text: "/plan focus auth" },
			{ type: "command", text: "/skill:triage onboarding" },
			{ type: "text", text: "Please summarize the diff" },
		]);
	});

	it("keeps leading plain text before the first command", () => {
		const detector = createDetector(["plan"]);
		const submission = `Initial thoughts here
/plan focus auth`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "text", text: "Initial thoughts here" },
			{ type: "command", text: "/plan focus auth" },
		]);
	});

	it("preserves text spans between command blocks", () => {
		const detector = createDetector(["plan", "notes"]);
		const submission = `/plan
Give me a summary first
/notes remind me about tokens`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "command", text: "/plan" },
			{ type: "text", text: "Give me a summary first" },
			{ type: "command", text: "/notes remind me about tokens" },
		]);
	});

	it("keeps unrecognized slash-prefixed lines inside text blocks", () => {
		const detector = createDetector(["plan"]);
		const submission = `/usr/bin/env node
/plan focus auth`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "text", text: "/usr/bin/env node" },
			{ type: "command", text: "/plan focus auth" },
		]);
	});

	it("preserves blank lines and indentation inside text blocks", () => {
		const detector = createDetector(["plan"]);
		const submission = `/plan focus qa

Line one
	Indented

Final line`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "command", text: "/plan focus qa" },
			{ type: "text", text: "\nLine one\n\tIndented\n\nFinal line" },
		]);

		// Ensure we only produced one command block and one text block
		expect(extractKinds(result.blocks)).toEqual(["command", "text"]);
	});

	it("handles CRLF line endings", () => {
		const detector = createDetector(["plan"]);
		const submission = `/plan focus qa\r\nFirst line\r\nSecond line`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "command", text: "/plan focus qa" },
			{ type: "text", text: "First line\nSecond line" },
		]);
	});

	it("recognizes executable bash and python shortcuts as command blocks", () => {
		const detector = createDetector(["plan"]);
		const submission = `  !ls
	this is a message
  !! ls -al
	this is another
   $print('hi')
	$$ print('hidden')`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "bash-shortcut", text: "!ls" },
			{ type: "text", text: "\tthis is a message" },
			{ type: "bash-shortcut", text: "!! ls -al" },
			{ type: "text", text: "\tthis is another" },
			{ type: "python-shortcut", text: "$print('hi')" },
			{ type: "python-shortcut", text: "$$ print('hidden')" },
		]);
	});

	it("keeps safe pasted executable prefixes as text", () => {
		const detector = createDetector(["plan"]);
		const submission = `!ls -al
!! pwd
$print('hi')
$$ print('hidden')
/plan focus auth`;

		const result = split(submission, detector, [
			{ line: 0, intent: "safe" },
			{ line: 1, intent: "safe" },
			{ line: 2, intent: "safe" },
			{ line: 3, intent: "safe" },
			{ line: 4, intent: "safe" },
		]);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([{ type: "text", text: submission }]);
	});

	it("keeps safe pasted fenced shortcut syntax as text", () => {
		const detector = createDetector(["plan"]);
		const fence = "```";
		const submission = `!${fence}
echo "safe"
${fence}
/plan focus auth`;

		const result = split(submission, detector, [
			{ line: 0, intent: "safe" },
			{ line: 1, intent: "safe" },
			{ line: 2, intent: "safe" },
			{ line: 3, intent: "safe" },
		]);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([{ type: "text", text: submission }]);
	});

	it("classifies execute-intent pasted lines with normal executable rules", () => {
		const detector = createDetector(["plan"]);
		const submission = `!ls -al
$print('hi')
/plan focus auth`;

		const result = split(submission, detector, [
			{ line: 0, intent: "exec" },
			{ line: 1, intent: "exec" },
			{ line: 2, intent: "exec" },
		]);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "bash-shortcut", text: "!ls -al" },
			{ type: "python-shortcut", text: "$print('hi')" },
			{ type: "command", text: "/plan focus auth" },
		]);
	});

	it("preserves ordering and intent for mixed typed, safe, and execute-intent lines", () => {
		const detector = createDetector(["plan"]);
		const submission = `/plan typed
!safe bash
/plan exec
$$ print('run')`;

		const result = split(submission, detector, [
			{ line: 1, intent: "safe" },
			{ line: 2, intent: "exec" },
			{ line: 3, intent: "exec" },
		]);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "command", text: "/plan typed" },
			{ type: "text", text: "!safe bash" },
			{ type: "command", text: "/plan exec" },
			{ type: "python-shortcut", text: "$$ print('run')" },
		]);
	});

	it("keeps markdown image syntax lines as text blocks", () => {
		const detector = createDetector(["plan"]);
		const submission = `![diagram](./foo.png)
![alt][img-ref]
Second line`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([{ type: "text", text: submission }]);
	});

	it("keeps markdown image lines as text while still parsing real bash shortcuts", () => {
		const detector = createDetector(["plan"]);
		const submission = `![diagram](./foo.png)
!ls -al
![alt][img-ref]`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "text", text: "![diagram](./foo.png)" },
			{ type: "bash-shortcut", text: "!ls -al" },
			{ type: "text", text: "![alt][img-ref]" },
		]);
	});

	it("treats empty shortcut lines as plain text", () => {
		const detector = createDetector(["plan"]);
		const submission = `!
!!
$
$$
still text`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([{ type: "text", text: submission }]);
	});

	it("parses fenced bash shortcut blocks", () => {
		const detector = createDetector(["plan"]);
		const fence = "```";
		const submission = `!${fence}
echo "this
is a test"
${fence}`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([{ type: "bash-shortcut", text: '!echo "this\nis a test"', fenced: true }]);
	});

	it("parses fenced python shortcut blocks", () => {
		const detector = createDetector(["plan"]);
		const fence = "```";
		const submission = `$${fence}
print("hello")
print("world")
${fence}`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([
			{ type: "python-shortcut", text: '$print("hello")\nprint("world")', fenced: true },
		]);
	});

	it("supports escaped fence token lines inside fenced shortcut payloads", () => {
		const detector = createDetector(["plan"]);
		const fence = "```";
		const escapedFence = `\\${fence}`;
		const submission = `!${fence}
echo one
${escapedFence}
echo two
${fence}`;

		const result = split(submission, detector);

		expect(result.parseError).toBeUndefined();
		expect(result.blocks).toEqual([{ type: "bash-shortcut", text: "!echo one\n```\necho two", fenced: true }]);
	});

	it("returns parse error for unterminated fenced shortcuts", () => {
		const detector = createDetector(["plan"]);
		const fence = "```";
		const submission = `$$${fence}
print("oops")`;

		const result = split(submission, detector);

		expect(result.blocks).toEqual([]);
		expect(result.parseError).toEqual({
			line: 1,
			message: "Unterminated python fenced shortcut block starting at line 1.",
		});
	});
});
