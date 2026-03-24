import { completeSimple } from "@oh-my-pi/pi-ai";
import { logger } from "@oh-my-pi/pi-utils";
import { resolveModelRoleValue } from "../../../config/model-resolver";
import { settings } from "../../../config/settings";
import type { ExtensionCommandContext, ExtensionContext, ExtensionFactory } from "../../../extensibility/extensions";
import { openPath } from "../../../utils/open";
import { VIEWER_CLIENT_JS } from "./viewer-client.generated";
import { VIEWER_SHELL_HTML } from "./viewer-shell.generated";
import summarizerPrompt from "./viewer-summary.md" with { type: "text" };

export function createViewerExtension(): ExtensionFactory {
	let server: any = null;
	let viewerUrl: string | null = null;
	let activeSocket: any = null;
	let buffer = "# Viewer\n\nNo assistant reply captured yet.";
	let revision = 0;
	let summarizeInFlight = false;
	let modelRegistry: ExtensionContext["modelRegistry"] | undefined;
	let sessionId: string | undefined;

	return api => {
		api.registerCommand("viewer", {
			description: "Open the live-reloading viewer in the browser",
			handler: async (_args, ctx) => {
				rememberContext(ctx);
				if (!server) {
					server = Bun.serve({
						port: 0,
						hostname: "127.0.0.1",
						fetch(req, server) {
							const url = new URL(req.url);
							if (url.pathname === "/") {
								return new Response(VIEWER_SHELL_HTML, {
									headers: { "Content-Type": "text/html" },
								});
							}
							if (url.pathname === "/viewer.js") {
								return new Response(VIEWER_CLIENT_JS, {
									headers: { "Content-Type": "application/javascript" },
								});
							}
							if (url.pathname === "/ws") {
								if (server.upgrade(req)) {
									return;
								}
								return new Response("WebSocket upgrade failed", { status: 400 });
							}
							return new Response("Not found", { status: 404 });
						},
						websocket: {
							open(ws) {
								if (activeSocket) {
									activeSocket.close();
								}
								activeSocket = ws;
								ws.send(JSON.stringify({ type: "buffer", buffer, revision }));
								if (summarizeInFlight) {
									ws.send(JSON.stringify({ type: "status", busy: true }));
								}
							},
							message(_ws, message) {
								if (typeof message !== "string") return;
								try {
									const data = JSON.parse(message);
									if (data.type === "summarize") {
										void handleSummarize();
									}
								} catch (err) {
									logger.error("Failed to parse viewer websocket message", { err });
								}
							},
							close(ws) {
								if (activeSocket === ws) {
									activeSocket = null;
								}
							},
						},
					});
					viewerUrl = `http://127.0.0.1:${server.port}/`;
					logger.debug("Viewer server started", { url: viewerUrl });
				}

				if (viewerUrl) {
					openPath(viewerUrl);
				}
			},
		});

		api.on("message_end", (event, ctx) => {
			rememberContext(ctx);
			if (event.message.role !== "assistant") return;

			const textBlocks = event.message.content.flatMap(block => (block.type === "text" ? [block.text] : []));

			if (textBlocks.length > 0) {
				buffer = textBlocks.join("");
				revision++;
				if (activeSocket) {
					activeSocket.send(JSON.stringify({ type: "buffer", buffer, revision }));
				}
			}
		});

		function rememberContext(ctx: ExtensionContext | ExtensionCommandContext): void {
			modelRegistry = ctx.modelRegistry;
			sessionId = ctx.sessionManager.getSessionId();
		}

		async function handleSummarize() {
			if (summarizeInFlight) return;
			summarizeInFlight = true;
			if (activeSocket) {
				activeSocket.send(JSON.stringify({ type: "status", busy: true }));
			}

			const snapshotRevision = revision;
			const snapshotBuffer = buffer;

			try {
				if (!modelRegistry || !sessionId) {
					throw new Error("Viewer session context is not initialized");
				}

				const resolvedSmol = resolveModelRoleValue(settings.getModelRole("smol"), modelRegistry.getAvailable(), {
					settings,
					matchPreferences: { usageOrder: settings.getStorage()?.getModelUsageOrder() },
				});

				const smolModel = resolvedSmol.model;
				if (!smolModel) {
					throw new Error("Could not resolve 'smol' model");
				}

				const apiKey = await modelRegistry.getApiKey(smolModel, sessionId);
				if (!apiKey) {
					throw new Error(`No API key for provider: ${smolModel.provider}`);
				}

				const response = await completeSimple(
					smolModel,
					{
						systemPrompt: summarizerPrompt,
						messages: [{ role: "user", content: snapshotBuffer, timestamp: Date.now() }],
					},
					{ apiKey },
				);

				const summarizedText = response.content.flatMap(block => (block.type === "text" ? [block.text] : []));

				if (revision === snapshotRevision) {
					buffer = summarizedText.join("");
					revision++;
					if (activeSocket) {
						activeSocket.send(JSON.stringify({ type: "buffer", buffer, revision }));
					}
				} else {
					logger.warn("Summarize result discarded: buffer advanced during generation", {
						oldRevision: snapshotRevision,
						newRevision: revision,
					});
				}
			} catch (err) {
				logger.error("Viewer summarize failed", { err });
				if (activeSocket) {
					activeSocket.send(
						JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "Summarize failed" }),
					);
				}
			} finally {
				summarizeInFlight = false;
				if (activeSocket) {
					activeSocket.send(JSON.stringify({ type: "status", busy: false }));
				}
			}
		}
	};
}
