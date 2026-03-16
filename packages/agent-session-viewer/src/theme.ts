import { getThemeByName, type Theme } from "@oh-my-pi/pi-coding-agent";

const DEFAULT_VIEWER_THEME = "dark-rose-pine";

export async function loadViewerTheme(): Promise<Theme> {
	const theme = await getThemeByName(DEFAULT_VIEWER_THEME);
	if (!theme) {
		throw new Error(`Theme not found: ${DEFAULT_VIEWER_THEME}`);
	}
	return theme;
}
