import { describe, expect, it } from "bun:test";

import {
	type SubmissionBlock,
	type SubmissionBlockDetector,
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

describe("splitSubmissionIntoBlocks", () => {
	it("treats sequential commands followed by text as separate blocks", () => {
		const detector = createDetector(["plan", "skill:triage"]);
		const submission = `/plan focus auth
/skill:triage onboarding
Please summarize the diff`;

		const blocks = splitSubmissionIntoBlocks(submission, {
			isSupportedSlashCommand: detector,
		});

		expect(blocks).toEqual([
			{ type: "command", text: "/plan focus auth" },
			{ type: "command", text: "/skill:triage onboarding" },
			{ type: "text", text: "Please summarize the diff" },
		]);
	});

	it("keeps leading plain text before the first command", () => {
		const detector = createDetector(["plan"]);
		const submission = `Initial thoughts here
/plan focus auth`;

		const blocks = splitSubmissionIntoBlocks(submission, {
			isSupportedSlashCommand: detector,
		});

		expect(blocks).toEqual([
			{ type: "text", text: "Initial thoughts here" },
			{ type: "command", text: "/plan focus auth" },
		]);
	});

	it("preserves text spans between command blocks", () => {
		const detector = createDetector(["plan", "notes"]);
		const submission = `/plan
Give me a summary first
/notes remind me about tokens`;

		const blocks = splitSubmissionIntoBlocks(submission, {
			isSupportedSlashCommand: detector,
		});

		expect(blocks).toEqual([
			{ type: "command", text: "/plan" },
			{ type: "text", text: "Give me a summary first" },
			{ type: "command", text: "/notes remind me about tokens" },
		]);
	});

	it("keeps unrecognized slash-prefixed lines inside text blocks", () => {
		const detector = createDetector(["plan"]);
		const submission = `/usr/bin/env node
/plan focus auth`;

		const blocks = splitSubmissionIntoBlocks(submission, {
			isSupportedSlashCommand: detector,
		});

		expect(blocks).toEqual([
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

		const blocks = splitSubmissionIntoBlocks(submission, {
			isSupportedSlashCommand: detector,
		});

		expect(blocks).toEqual([
			{ type: "command", text: "/plan focus qa" },
			{ type: "text", text: "\nLine one\n\tIndented\n\nFinal line" },
		]);

		// Ensure we only produced one command block and one text block
		expect(extractKinds(blocks)).toEqual(["command", "text"]);
	});

	it("handles CRLF line endings", () => {
		const detector = createDetector(["plan"]);
		const submission = `/plan focus qa\r\nFirst line\r\nSecond line`;

		const blocks = splitSubmissionIntoBlocks(submission, {
			isSupportedSlashCommand: detector,
		});

		expect(blocks).toEqual([
			{ type: "command", text: "/plan focus qa" },
			{ type: "text", text: "First line\nSecond line" },
		]);
	});
});
