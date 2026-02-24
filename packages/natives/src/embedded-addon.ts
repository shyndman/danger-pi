import addonPath0 from "../native/pi_natives.linux-x64-modern.node" with { type: "file" };

export type EmbeddedAddonVariant = "modern" | "baseline" | "default";

export interface EmbeddedAddonFile {
	variant: EmbeddedAddonVariant;
	filename: string;
	filePath: string;
}

export interface EmbeddedAddon {
	platformTag: string;
	version: string;
	files: EmbeddedAddonFile[];
}

export const embeddedAddon: EmbeddedAddon | null = {
	platformTag: "linux-x64",
	version: "13.2.1",
	files: [
	{ variant: "modern", filename: "pi_natives.linux-x64-modern.node", filePath: addonPath0 },
	],
};
