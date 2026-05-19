/**
 * Constants for OpenAI Codex (ChatGPT OAuth) backend
 */

export const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

/**
 * Pinned OpenAI Codex client version (corresponds to @openai/codex package version).
 */
export const CODEX_CLIENT_VERSION = "0.144.1";

export const OPENAI_HEADERS = {
	BETA: "OpenAI-Beta",
	ACCOUNT_ID: "chatgpt-account-id",
	ORIGINATOR: "originator",
	VERSION: "version",
	SESSION_ID: "session_id",
	CONVERSATION_ID: "conversation_id",
	SCOPED_SESSION_ID: "session-id",
	THREAD_ID: "thread-id",
	INSTALLATION_ID: "x-codex-installation-id",
	WINDOW_ID: "x-codex-window-id",
	TURN_METADATA: "x-codex-turn-metadata",
	PARENT_THREAD_ID: "x-codex-parent-thread-id",
	SUBAGENT: "x-openai-subagent",
	/** Responses Lite transport marker (codex-rs `add_responses_lite_header`); value is always `"true"`. */
	RESPONSES_LITE: "x-openai-internal-codex-responses-lite",
} as const;

export const OPENAI_HEADER_VALUES = {
	BETA_RESPONSES: "responses=experimental",
	BETA_RESPONSES_WEBSOCKETS_V2: "responses_websockets=2026-02-06",
	ORIGINATOR_CODEX: "pi",
} as const;

export const URL_PATHS = {
	RESPONSES: "/responses",
	CODEX_RESPONSES: "/codex/responses",
} as const;

export const JWT_CLAIM_PATH = "https://api.openai.com/auth" as const;

interface CodexCredentialPayload {
	token?: unknown;
	accessToken?: unknown;
	access?: unknown;
	accountId?: unknown;
	account_id?: unknown;
}

export interface ParsedCodexCredential {
	accessToken: string;
	accountId?: string;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized.length > 0 ? normalized : undefined;
}

export function parseCodexCredential(rawCredential: string): ParsedCodexCredential {
	const trimmed = rawCredential.trim();
	if (!trimmed) {
		return { accessToken: rawCredential };
	}

	try {
		const parsed = JSON.parse(trimmed) as CodexCredentialPayload;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const accessToken =
				normalizeNonEmptyString(parsed.token) ??
				normalizeNonEmptyString(parsed.accessToken) ??
				normalizeNonEmptyString(parsed.access);
			if (accessToken) {
				return {
					accessToken,
					accountId: normalizeNonEmptyString(parsed.accountId) ?? normalizeNonEmptyString(parsed.account_id),
				};
			}
		}
	} catch {}

	return { accessToken: rawCredential };
}

/**
 * Extract account ID from a Codex JWT access token.
 * Returns undefined if the token is not a valid Codex JWT.
 */
export function getCodexAccountId(accessToken: string): string | undefined {
	try {
		const parsedCredential = parseCodexCredential(accessToken);
		if (parsedCredential.accountId) return parsedCredential.accountId;
		const parts = parsedCredential.accessToken.split(".");
		if (parts.length !== 3) return undefined;
		const decoded = Buffer.from(parts[1] ?? "", "base64").toString("utf-8");
		const payload = JSON.parse(decoded) as Record<string, unknown>;
		const auth = payload[JWT_CLAIM_PATH] as { chatgpt_account_id?: string } | undefined;
		return auth?.chatgpt_account_id ?? undefined;
	} catch {
		return undefined;
	}
}
