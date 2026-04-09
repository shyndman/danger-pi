import type { InteractiveModeContext } from "../../types";

interface LiveChatSyncOptions {
	wasStreaming: boolean;
	display: boolean;
}

export function syncMultiBlockLiveChat(
	ctx: Pick<InteractiveModeContext, "rebuildChatFromMessages">,
	options: LiveChatSyncOptions,
): void {
	if (options.wasStreaming || !options.display) {
		return;
	}

	ctx.rebuildChatFromMessages();
}
