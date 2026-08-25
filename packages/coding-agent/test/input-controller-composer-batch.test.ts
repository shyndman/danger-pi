import { describe, expect, it } from "bun:test";
import type { ImageContent } from "@oh-my-pi/pi-ai";
import {
	ComposerBatch,
	type ComposerBatchDraft,
	type ComposerBatchEntry,
} from "@oh-my-pi/pi-coding-agent/session/composer-batch";

function entry(
	sessionId: string,
	timestamp: number,
	text: string,
	options?: { visible?: boolean },
): ComposerBatchEntry {
	const draft: ComposerBatchDraft = { sessionId, timestamp, text, images: [], imageLinks: [] };
	return {
		draft,
		prepared: {
			promptText: options?.visible === false ? "" : text,
			images: [],
			messages: [{ role: "user", content: [{ type: "text", text }], timestamp }],
			modelVisible: options?.visible !== false,
		},
	};
}

describe("idle composer batch state", () => {
	it("keeps staged drafts ordered and builds one aggregate dispatch", () => {
		let sessionId = "session-a";
		const batch = new ComposerBatch(() => sessionId);
		batch.stage(entry(sessionId, 1, "one"));
		batch.stage(entry(sessionId, 2, "two"));
		batch.stage(entry(sessionId, 3, "three"));
		batch.stage(entry(sessionId, 4, "four"));

		const dispatch = batch.take();

		expect(dispatch?.entries.map(item => item.draft.text)).toEqual(["one", "two", "three", "four"]);
		expect(dispatch?.turnText).toBe("one\n\ntwo\n\nthree\n\nfour");
		expect(batch.size).toBe(0);
		expect(batch.workCount).toBe(1);
		dispatch?.accept();
		expect(batch.workCount).toBe(0);
		sessionId = "session-a";
	});

	it("restores an unaccepted dispatch before newer drafts", () => {
		const sessionId = "session-a";
		const batch = new ComposerBatch(() => sessionId);
		batch.stage(entry(sessionId, 1, "old one"));
		batch.stage(entry(sessionId, 2, "old two"));
		const dispatch = batch.take();
		batch.stage(entry(sessionId, 3, "newer"));

		expect(dispatch?.restore()).toBe(true);
		expect(batch.entries.map(item => item.draft.text)).toEqual(["old one", "old two", "newer"]);
		expect(dispatch?.restore()).toBe(false);
	});

	it("blocks editing while one preparation remains active", () => {
		const sessionId = "session-a";
		const batch = new ComposerBatch(() => sessionId);
		batch.stage(entry(sessionId, 1, "settled"));
		const release = batch.beginPending();

		expect(batch.workCount).toBe(2);
		expect(batch.size).toBe(1);
		release();
		release();
		expect(batch.workCount).toBe(1);
	});

	it("clears staged and pending work after a session ID change", () => {
		let sessionId = "session-a";
		const batch = new ComposerBatch(() => sessionId);
		batch.stage(entry(sessionId, 1, "stale"));
		const release = batch.beginPending();
		sessionId = "session-b";

		expect(batch.workCount).toBe(0);
		expect(batch.stage(entry("session-a", 2, "also stale"))).toBe(false);
		release();
		expect(batch.workCount).toBe(0);
	});

	it("rejects dispatch restoration after a session ID change", () => {
		let sessionId = "session-a";
		const batch = new ComposerBatch(() => sessionId);
		batch.stage(entry(sessionId, 1, "stale"));
		const dispatch = batch.take();
		sessionId = "session-b";

		expect(dispatch?.restore()).toBe(false);
		expect(batch.entries).toEqual([]);
	});

	it("uses monotonic timestamps for identical execution drafts", () => {
		const batch = new ComposerBatch(() => "session-a");
		expect(batch.nextTimestamp(100)).toBe(100);
		expect(batch.nextTimestamp(100)).toBe(101);
		expect(batch.nextTimestamp(99)).toBe(102);
	});

	it("aggregates images only from model-visible items", () => {
		const sessionId = "session-a";
		const batch = new ComposerBatch(() => sessionId);
		const visibleImage: ImageContent = { type: "image", data: "visible", mimeType: "image/png" };
		const hiddenImage: ImageContent = { type: "image", data: "hidden", mimeType: "image/png" };
		const visible = entry(sessionId, 1, "visible");
		visible.prepared = { ...visible.prepared, images: [visibleImage] };
		const hidden = entry(sessionId, 2, "hidden", { visible: false });
		hidden.prepared = { ...hidden.prepared, images: [hiddenImage] };
		batch.stage(visible);
		batch.stage(hidden);

		const dispatch = batch.take();

		expect(dispatch?.hookImages).toEqual([visibleImage]);
		expect(dispatch?.hasModelVisible).toBe(true);
	});
});
