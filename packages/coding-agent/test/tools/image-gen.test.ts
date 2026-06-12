import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AuthStorage, Model, Tool, ToolCall } from "@oh-my-pi/pi-ai";
import { validateToolArguments } from "@oh-my-pi/pi-ai/utils/validation";
import {
	type ApiKeyResolverModel,
	type ApiKeyResolverOptions,
	createApiKeyResolver,
} from "@oh-my-pi/pi-coding-agent/config/api-key-resolver";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import type { CustomToolContext } from "@oh-my-pi/pi-coding-agent/extensibility/custom-tools";
import type { ReadonlySessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import {
	getImageGenTools,
	getImageGenToolsWithRegistry,
	imageGenSchema,
	imageGenTool,
	setPreferredImageProvider,
} from "@oh-my-pi/pi-coding-agent/tools/image-gen";
import { removeWithRetries } from "@oh-my-pi/pi-utils";

const originalOpenRouterKey = Bun.env.OPENROUTER_API_KEY;
const generatedImagePaths: string[] = [];

const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

type model_registry_mock = Pick<
	ModelRegistry,
	"authStorage" | "getAll" | "getApiKey" | "getApiKeyForProvider" | "getProviderBaseUrl" | "resolver"
>;

function make_model_registry_mock(overrides: Partial<model_registry_mock> = {}): ModelRegistry {
	const auth_storage: Pick<AuthStorage, "hasNonEnvCredential" | "rotateSessionCredential"> = {
		hasNonEnvCredential: () => false,
		rotateSessionCredential: async () => false,
		...(overrides.authStorage ?? {}),
	};

	const registry: model_registry_mock = {
		authStorage: auth_storage as ModelRegistry["authStorage"],
		getAll: () => [],
		getApiKey: async () => undefined,
		getApiKeyForProvider: async () => undefined,
		getProviderBaseUrl: () => undefined,
		resolver: () => async () => undefined,
		...overrides,
	};

	const defaultResolver: ModelRegistry["resolver"] = ((
		provider: string | ApiKeyResolverModel,
		options?: ApiKeyResolverOptions | string,
	) => {
		if (typeof provider === "string") {
			return createApiKeyResolver(registry, provider, typeof options === "object" ? options : undefined);
		}
		return createApiKeyResolver(registry, provider.provider, {
			sessionId: typeof options === "string" ? options : undefined,
			baseUrl: provider.baseUrl,
			modelId: provider.id,
		});
	}) as ModelRegistry["resolver"];

	registry.resolver = overrides.resolver ?? defaultResolver;

	return registry as ModelRegistry;
}

function getHeaderValue(headers: RequestInit["headers"], name: string): string | null | undefined {
	if (!headers) return undefined;
	if (headers instanceof Headers) return headers.get(name);
	if (Array.isArray(headers)) {
		const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
		const value = match?.[1];
		if (value === undefined) return undefined;
		return typeof value === "string" ? value : value[0];
	}
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name.toLowerCase()) {
			return typeof value === "string" ? value : value[0];
		}
	}
	return undefined;
}

afterEach(async () => {
	await Promise.all(generatedImagePaths.splice(0).map(imagePath => removeWithRetries(imagePath)));
	if (originalOpenRouterKey === undefined) {
		delete Bun.env.OPENROUTER_API_KEY;
	} else {
		Bun.env.OPENROUTER_API_KEY = originalOpenRouterKey;
	}
	delete Bun.env.GEMINI_API_KEY;
	setPreferredImageProvider("auto");
	vi.restoreAllMocks();
});

describe("imageGenTool", () => {
	it("registers without resolving image provider credentials", async () => {
		const modelRegistry = {
			getApiKey: async () => {
				throw new Error("active model credentials should not be resolved during registration");
			},
			getApiKeyForProvider: async () => {
				throw new Error("provider credentials should not be resolved during registration");
			},
		} as unknown as ModelRegistry;

		expect(await getImageGenTools(modelRegistry, undefined)).toEqual([imageGenTool]);
		expect(await getImageGenToolsWithRegistry(modelRegistry, undefined)).toEqual([imageGenTool]);
	});

	it("resolves image provider credentials on execution", async () => {
		setPreferredImageProvider("antigravity");
		const ctx: CustomToolContext = {
			fetch: async () => new Response(null),
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKey: async () => undefined,
				getApiKeyForProvider: async () => {
					throw new Error("provider credentials resolved during execution");
				},
			} as unknown as ModelRegistry,
			model: undefined,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		await expect(imageGenTool.execute("call-registration", { subject: "a cat" }, undefined, ctx)).rejects.toThrow(
			"provider credentials resolved during execution",
		);
	});

	it("sets X-OpenRouter-Title when routing image generation through OpenRouter", async () => {
		let requestHeaders: RequestInit["headers"] | undefined;
		Bun.env.OPENROUTER_API_KEY = "test-openrouter-key";
		setPreferredImageProvider("openrouter");

		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestHeaders = init?.headers;
			return new Response(
				JSON.stringify({
					choices: [{ message: { role: "assistant", content: "" } }],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const ctx: CustomToolContext = {
			fetch: fetchMock,
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: make_model_registry_mock({
				getApiKeyForProvider: async (provider: string) =>
					provider === "openrouter" ? "test-openrouter-key" : undefined,
				resolver: () => async () => "test-openrouter-key",
			}),
			model: undefined,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute("call-1", { subject: "a cat" }, undefined, ctx);
		expect(result.content[0].type).toBe("text");
		expect(getHeaderValue(requestHeaders, "X-OpenRouter-Title")).toBe("Oh-My-Pi");
	});

	it("uses the configured OpenRouter image model and forwards image request settings", async () => {
		let requestBody: Record<string, unknown> | undefined;
		Bun.env.OPENROUTER_API_KEY = "test-openrouter-key";

		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								role: "assistant",
								content: "",
								images: [
									{
										image_url: {
											url: `data:image/png;base64,${TINY_PNG_BASE64}`,
										},
									},
								],
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;
		const ctx: CustomToolContext = {
			fetch: fetchMock,
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: make_model_registry_mock({
				getApiKeyForProvider: async (provider: string) =>
					provider === "openrouter" ? "test-openrouter-key" : undefined,
				resolver: () => async () => "test-openrouter-key",
			}),
			model: undefined,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
			settings: {
				get: (key: string) => (key === "providers.imageOpenRouterModel" ? "openai/gpt-5.4-image-2" : undefined),
			} as unknown as NonNullable<CustomToolContext["settings"]>,
		};

		const result = await imageGenTool.execute(
			"call-1",
			{ subject: "a cat", aspect_ratio: "16:9", image_size: "2K" },
			undefined,
			ctx,
		);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestBody).toMatchObject({
			model: "openai/gpt-5.4-image-2",
			modalities: ["image", "text"],
			image_config: {
				aspect_ratio: "16:9",
				image_size: "2K",
			},
		});
		expect(result.details?.provider).toBe("openrouter");
		expect(result.details?.model).toBe("openai/gpt-5.4-image-2");
		expect(result.details?.imageCount).toBe(1);
		expect(result.details?.imagePaths).toHaveLength(1);
		const savedPath = result.details?.imagePaths[0];
		if (!savedPath) throw new Error("Expected generated image path");
		expect(savedPath.endsWith(".png")).toBe(true);
		expect(await Bun.file(savedPath).bytes()).toEqual(Buffer.from(TINY_PNG_BASE64, "base64"));
	});

	it("defaults OpenRouter image generation to ChatGPT Images 2 when not configured", async () => {
		let requestBody: Record<string, unknown> | undefined;
		Bun.env.OPENROUTER_API_KEY = "test-openrouter-key";

		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								role: "assistant",
								content: "",
								images: [
									{
										image_url: {
											url: `data:image/png;base64,${TINY_PNG_BASE64}`,
										},
									},
								],
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;
		const ctx: CustomToolContext = {
			fetch: fetchMock,
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: make_model_registry_mock({
				getApiKeyForProvider: async (provider: string) =>
					provider === "openrouter" ? "test-openrouter-key" : undefined,
				resolver: () => async () => "test-openrouter-key",
			}),
			model: undefined,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute("call-1", { subject: "a cat" }, undefined, ctx);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestBody).toMatchObject({
			model: "openai/gpt-5.4-image-2",
			modalities: ["image", "text"],
		});
		expect(result.details?.model).toBe("openai/gpt-5.4-image-2");
	});

	it("e2e writes OpenAI Responses image_generation WebP output to a temp file", async () => {
		let requestUrl: string | undefined;
		let requestBody: unknown;

		const fetchMock: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			requestUrl = input.toString();
			requestBody = JSON.parse(String(init?.body));
			return new Response(
				JSON.stringify({
					output: [
						{
							type: "image_generation_call",
							result: Buffer.from("fake-webp").toString("base64"),
							revised_prompt: "A crisp tabby cat portrait.",
							status: "completed",
						},
					],
					usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const model = {
			api: "openai-responses",
			provider: "openai",
			id: "gpt-5.5",
			name: "GPT 5.5",
			baseUrl: "https://api.openai.com/v1",
		} as Model;
		const ctx: CustomToolContext = {
			fetch: fetchMock,
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKey: async () => "test-openai-key",
				getApiKeyForProvider: async () => undefined,
				authStorage: { rotateSessionCredential: async () => false },
				resolver: () => async () => "test-openai-key",
			} as unknown as ModelRegistry,
			model,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute("call-1", { subject: "a cat", aspect_ratio: "16:9" }, undefined, ctx);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestUrl).toBe("https://api.openai.com/v1/responses");
		expect(requestBody).toMatchObject({
			model: "gpt-5.5",
			tools: [
				{
					type: "image_generation",
					output_format: "webp",
					size: "1280x720",
					action: "generate",
				},
			],
			tool_choice: { type: "image_generation" },
			store: false,
		});
		expect(result.details?.provider).toBe("openai");
		expect(result.details?.imageCount).toBe(1);
		expect(result.details?.images[0]?.mimeType).toBe("image/webp");
		expect(result.details?.revisedPrompt).toBe("A crisp tabby cat portrait.");
		expect(result.details?.imagePaths).toHaveLength(1);
		const savedPath = result.details?.imagePaths[0];
		if (!savedPath) throw new Error("Expected generated image path");
		expect(savedPath.endsWith(".webp")).toBe(true);
		expect(await Bun.file(savedPath).bytes()).toEqual(Buffer.from("fake-webp"));
	});

	it("sends Codex hosted image requests with opaque proxy bearer keys", async () => {
		let requestUrl: string | undefined;
		let requestHeaders: Headers | undefined;

		const fetchMock: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			requestUrl = input.toString();
			requestHeaders = new Headers(init?.headers);
			return new Response(
				[
					"event: response.output_item.done",
					`data: ${JSON.stringify({
						type: "response.output_item.done",
						item: {
							type: "image_generation_call",
							result: Buffer.from("fake-codex-webp").toString("base64"),
							status: "completed",
						},
					})}`,
					"",
					"event: response.completed",
					`data: ${JSON.stringify({
						type: "response.completed",
						response: { output: [], status: "completed", error: null },
					})}`,
					"",
				].join("\n"),
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			);
		}) as unknown as typeof fetch;

		const model = {
			api: "openai-codex-responses",
			provider: "openai-codex",
			id: "gpt-5.5-codex",
			name: "GPT Codex",
			baseUrl: "https://example-proxy.invalid/backend-api",
		} as Model;
		const ctx: CustomToolContext = {
			fetch: fetchMock,
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKey: async () => "opaque-proxy-key",
				getApiKeyForProvider: async () => undefined,
				authStorage: { rotateSessionCredential: async () => false },
				resolver: () => async () => "opaque-proxy-key",
			} as unknown as ModelRegistry,
			model,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute("call-codex-opaque", { subject: "a cat" }, undefined, ctx);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestUrl).toBe("https://example-proxy.invalid/backend-api/codex/responses");
		expect(requestHeaders?.get("authorization")).toBe("Bearer opaque-proxy-key");
		expect(requestHeaders?.has("chatgpt-account-id")).toBe(false);
		expect(requestHeaders?.get("OpenAI-Beta")).toBe("responses=experimental");
		expect(requestHeaders?.get("originator")).toBe("pi");
		expect(result.details?.provider).toBe("openai-codex");
		expect(result.details?.imageCount).toBe(1);
	});

	it("adds Codex account headers when the bearer token exposes an account id", async () => {
		let requestHeaders: Headers | undefined;
		const tokenPayload = Buffer.from(
			JSON.stringify({
				"https://api.openai.com/auth": { chatgpt_account_id: "acc_test" },
			}),
		).toString("base64");
		const codexJwt = `header.${tokenPayload}.signature`;

		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestHeaders = new Headers(init?.headers);
			return new Response(
				[
					"event: response.output_item.done",
					`data: ${JSON.stringify({
						type: "response.output_item.done",
						item: {
							type: "image_generation_call",
							result: Buffer.from("fake-codex-jwt-webp").toString("base64"),
							status: "completed",
						},
					})}`,
					"",
					"event: response.completed",
					`data: ${JSON.stringify({
						type: "response.completed",
						response: { output: [], status: "completed", error: null },
					})}`,
					"",
				].join("\n"),
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			);
		}) as unknown as typeof fetch;

		const model = {
			api: "openai-codex-responses",
			provider: "openai-codex",
			id: "gpt-5.5-codex",
			name: "GPT Codex",
			baseUrl: "https://example-proxy.invalid/backend-api",
		} as Model;
		const ctx: CustomToolContext = {
			fetch: fetchMock,
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKey: async () => codexJwt,
				getApiKeyForProvider: async () => undefined,
				authStorage: { rotateSessionCredential: async () => false },
				resolver: () => async () => codexJwt,
			} as unknown as ModelRegistry,
			model,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute("call-codex-jwt", { subject: "a cat" }, undefined, ctx);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestHeaders?.get("authorization")).toBe(`Bearer ${codexJwt}`);
		expect(requestHeaders?.get("chatgpt-account-id")).toBe("acc_test");
		expect(result.details?.imageCount).toBe(1);
	});

	it("routes xAI image generation with xAI-only aspect ratios", async () => {
		setPreferredImageProvider("xai");
		let requestUrl: string | undefined;
		let requestBody: Record<string, unknown> | undefined;
		const captured: { authorization: string | null; userAgent: string | null } = {
			authorization: null,
			userAgent: null,
		};

		const fetchMock: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			requestUrl = input.toString();
			requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			const headers = new Headers(init?.headers);
			captured.authorization = headers.get("authorization");
			captured.userAgent = headers.get("user-agent");
			return new Response(
				JSON.stringify({
					data: [{ b64_json: Buffer.from("fake-xai-image").toString("base64") }],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const ctx: CustomToolContext = {
			fetch: fetchMock,
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: {
				getApiKeyForProvider: async (provider: string) => (provider === "xai-oauth" ? "test-xai-token" : undefined),
				getProviderBaseUrl: () => undefined,
				getAll: () => [],
				authStorage: {
					hasNonEnvCredential: (provider: string) => provider === "xai-oauth",
					rotateSessionCredential: async () => false,
				},
				resolver: () => async () => "test-xai-token",
			} as unknown as ModelRegistry,
			model: undefined,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute("call-xai", { subject: "a cat", aspect_ratio: "3:2" }, undefined, ctx);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestUrl).toBe("https://api.x.ai/v1/images/generations");
		expect(captured.authorization).toBe("Bearer test-xai-token");
		expect(captured.userAgent).toBe("oh-my-pi/xai");
		expect(requestBody).toMatchObject({
			model: "grok-imagine-image",
			prompt: "a cat.",
			aspect_ratio: "3:2",
			resolution: "1k",
			n: 1,
			response_format: "b64_json",
		});
		expect(result.details?.provider).toBe("xai");
		expect(result.details?.model).toBe("grok-imagine-image");
		expect(result.details?.imageCount).toBe(1);
		const savedPath = result.details?.imagePaths[0];
		if (!savedPath) throw new Error("Expected generated image path");
		expect(await Bun.file(savedPath).bytes()).toEqual(Buffer.from("fake-xai-image"));
	});

	it("derives OpenAI image_generation sizes from aliases and aspect ratios before sending the request", async () => {
		let requestBody: unknown;

		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body));
			return new Response(
				JSON.stringify({
					output: [
						{
							type: "image_generation_call",
							result: Buffer.from("fake-webp").toString("base64"),
							status: "completed",
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const model = {
			api: "openai-responses",
			provider: "openai",
			id: "gpt-5.5",
			name: "GPT 5.5",
			baseUrl: "https://api.openai.com/v1",
		} as Model;
		const ctx: CustomToolContext = {
			fetch: fetchMock,
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: make_model_registry_mock({
				getApiKey: async () => "test-openai-key",
				resolver: () => async () => "test-openai-key",
			}),
			model,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute(
			"call-1",
			{ subject: "a cat", aspect_ratio: "4:3", image_size: "4K" },
			undefined,
			ctx,
		);
		generatedImagePaths.push(...(result.details?.imagePaths ?? []));

		expect(requestBody).toMatchObject({
			tools: [
				{
					type: "image_generation",
					size: "3264x2448",
				},
			],
		});
	});

	it("rejects the unsupported 512 OpenAI image_size alias", async () => {
		const model = {
			api: "openai-responses",
			provider: "openai",
			id: "gpt-5.5",
			name: "GPT 5.5",
			baseUrl: "https://api.openai.com/v1",
		} as Model;
		const ctx: CustomToolContext = {
			sessionManager: {
				getCwd: () => "/tmp",
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: make_model_registry_mock({
				getApiKey: async () => "test-openai-key",
				resolver: () => async () => "test-openai-key",
			}),
			model,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		await expect(
			imageGenTool.execute("call-1", { subject: "a cat", image_size: "512" }, undefined, ctx),
		).rejects.toThrow('OpenAI-hosted image generation does not support image_size "512". Use "1K" or larger.');
	});

	it("accepts only backend-valid aspect ratios and image sizes", () => {
		const tool: Tool = {
			name: imageGenTool.name,
			description: imageGenTool.description,
			parameters: imageGenSchema,
		};

		const validWide: ToolCall = {
			type: "toolCall",
			id: "call-valid-wide",
			name: imageGenTool.name,
			arguments: { subject: "Poster", aspect_ratio: "21:9", image_size: "4K" },
		};
		const validTall: ToolCall = {
			type: "toolCall",
			id: "call-valid-tall",
			name: imageGenTool.name,
			arguments: { subject: "Poster", aspect_ratio: "1:4", image_size: "512" },
		};
		const invalidRatio: ToolCall = {
			type: "toolCall",
			id: "call-invalid-ratio",
			name: imageGenTool.name,
			arguments: { subject: "Poster", aspect_ratio: "1:2", image_size: "4K" },
		};
		const invalidSize: ToolCall = {
			type: "toolCall",
			id: "call-invalid-size",
			name: imageGenTool.name,
			arguments: {
				subject: "Poster",
				aspect_ratio: "21:9",
				image_size: "1024x1024",
			},
		};

		expect(validateToolArguments(tool, validWide)).toEqual(validWide.arguments);
		expect(validateToolArguments(tool, validTall)).toEqual(validTall.arguments);
		expect(() => validateToolArguments(tool, invalidRatio)).toThrow("Validation failed");
		expect(() => validateToolArguments(tool, invalidSize)).toThrow("Validation failed");
	});

	it("sends corrected image config values to the gemini request body", async () => {
		const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gemini-image-"));
		Bun.env.GEMINI_API_KEY = "test-key";
		setPreferredImageProvider("gemini");

		let requestBody: Record<string, unknown> | undefined;
		const fetchMock: typeof fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
			requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					candidates: [
						{
							content: {
								parts: [
									{
										inlineData: {
											mimeType: "image/png",
											data: TINY_PNG_BASE64,
										},
									},
								],
							},
						},
					],
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const ctx: CustomToolContext = {
			fetch: fetchMock,
			sessionManager: {
				getCwd: () => testDir,
				getSessionId: () => "test-session",
			} as unknown as ReadonlySessionManager,
			modelRegistry: make_model_registry_mock({
				getApiKeyForProvider: async (provider: string) => (provider === "google" ? "test-key" : undefined),
				resolver: () => async () => "test-key",
			}),
			model: undefined,
			isIdle: () => true,
			hasQueuedMessages: () => false,
			abort: () => {},
		};

		const result = await imageGenTool.execute(
			"call-1",
			{ subject: "Wide panorama", aspect_ratio: "21:9", image_size: "4K" },
			undefined,
			ctx,
		);

		expect(result.details?.imageCount).toBe(1);
		expect(requestBody).toBeDefined();
		expect(requestBody?.generationConfig).toEqual({
			responseModalities: ["IMAGE"],
			imageConfig: {
				aspectRatio: "21:9",
				imageSize: "4K",
			},
		});

		await fs.rm(testDir, { recursive: true, force: true });
	});
});
