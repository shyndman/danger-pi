import { Container } from "@oh-my-pi/pi-tui";
import { isSettingsInitialized, Settings } from "../../config/settings";

const MESSAGE_HORIZONTAL_PADDING = 2;

function clampMessageRenderWidth(width: number): number {
	const maxContentWidth = isSettingsInitialized() ? Settings.instance.get("display.messageWrapWidth") : 0;
	if (!Number.isFinite(maxContentWidth) || maxContentWidth <= 0) {
		return width;
	}

	return Math.max(1, Math.min(width, Math.trunc(maxContentWidth) + MESSAGE_HORIZONTAL_PADDING));
}

/**
 * Width clamp for chat turns only: user + assistant messages.
 * Deliberately excludes custom, hook, skill, and summary blocks.
 */
export class ChatMessageContainer extends Container {
	override render(width: number): string[] {
		return [...super.render(clampMessageRenderWidth(width))];
	}
}
