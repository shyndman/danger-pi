import type { ExtensionFactory } from "../../extensibility/extensions";

import { createHelloWorldExtension } from "./hello-world";
import { createViewerExtension } from "./viewer/viewer";
import { createWakaTimeExtension } from "./wakatime";

/**
 * Fork-local, bundled Danger Pi extensions wired directly into the SDK.
 *
 * Keep this distinct from filesystem-discovered user/project extensions.
 * Add new in-tree Danger Pi extension factories to this array as the fork grows.
 */
export const dangerPiBundledExtensions: ExtensionFactory[] = [
	createHelloWorldExtension(),
	createWakaTimeExtension(),
	createViewerExtension(),
];
