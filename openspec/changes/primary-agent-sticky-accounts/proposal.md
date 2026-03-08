## Why

Codex account stickiness is currently keyed to the leaf `sessionId` used during API-key resolution. `AgentSession` always calls `ModelRegistry.getApiKey(this.model, this.sessionId)`, `ModelRegistry` forwards that same `sessionId` into `AuthStorage.getApiKey(...)`, and `AuthStorage` stores the last-used credential in `#sessionLastCredential` keyed by provider + session (`packages/coding-agent/src/session/agent-session.ts`, `packages/coding-agent/src/config/model-registry.ts`, `packages/ai/src/auth-storage.ts`).

Subagents do not currently share that leaf session identity. The task runner derives an artifacts directory from the parent session, creates a per-subtask session file (`<id>.jsonl`), opens that file with `SessionManager.open(...)`, and then creates the subagent session on top of it (`packages/coding-agent/src/task/index.ts`, `packages/coding-agent/src/task/executor.ts`). That means related work can resolve Codex credentials under different session IDs, reducing the chance that it stays on one account and benefits from account-local cache reuse. We need stickiness at the top-level agent boundary instead, plus enough observability to tell whether the new behavior is actually improving cache reuse.

## What Changes

- Change Codex sticky-account behavior from per-session to per-top-level-agent.
- Ensure child/subagents inherit the top-level agent's selected Codex account by default.
- Preserve the existing ability to switch accounts mid-run when the pinned account becomes unusable (for example rate limits or definitive auth failure), then re-pin to the replacement for the same top-level agent.
- Allow fresh top-level agents to select a different account so load can still spread naturally over time.
- Add observability for Codex account pinning, account switches, and cache-reuse signals so operators can confirm whether affinity is working. Existing Codex responses already surface provider-reported cached tokens as `usage.cacheRead`, and stats ingestion already persists assistant-message usage data, so this change can build on current logging/usage paths rather than inventing a new metrics stack (`packages/ai/src/providers/openai-codex-responses.ts`, `packages/stats/src/parser.ts`, `packages/stats/src/db.ts`).
- Use OpenAI prompt-caching fields only for interpretation of observability (`prompt_cache_key`, provider-reported cached-token usage); this proposal does not change provider cache policy, prompt-cache retention, or cache-key generation rules.
- Add no new npm package dependencies for this change; use existing `openai`/`@oh-my-pi/pi-ai` integration and existing stats ingestion surfaces.

## Capabilities

### New Capabilities
- `codex-cache-affinity-observability`: Defines the telemetry and operator-visible signals needed to verify pinned-account reuse, account switches, and cache-read behavior for Codex requests.

### Modified Capabilities
- `codex-session-sticky-selection`: Change Codex stickiness scope from session-based pinning to top-level-agent-based pinning, including child inheritance and replacement-account repinning behavior.

## Impact

- `packages/ai/src/auth-storage.ts`
  - Adjust Codex pinning semantics so the current `#sessionLastCredential`/Codex switch-log flow keys off top-level-agent affinity rather than leaf session identity.
  - Preserve the existing ranked fallback, backoff, and failure-triggered switching behavior already implemented in `#resolveOAuthApiKey()` / `#tryOAuthCredential()`.
- `packages/coding-agent/src/session/agent-session.ts`
  - Propagate the correct top-level-agent affinity through the existing `ModelRegistry.getApiKey(..., this.sessionId)` and retry/switch flows.
- `packages/coding-agent/src/task/index.ts`
  - Carry parent top-level-agent affinity into task launches instead of letting task orchestration rely only on the parent session file/artifacts directory.
- `packages/coding-agent/src/task/executor.ts`
  - Ensure subagents inherit the top-level agent affinity even though they currently create and open per-subtask session files.
- `packages/coding-agent/src/config/model-registry.ts`
  - Carry the affinity identifier through the existing `getApiKey(model, sessionId)` / `getApiKeyForProvider(provider, sessionId, baseUrl)` surfaces used by Codex.
- `packages/coding-agent/src/web/search/providers/codex.ts`
  - Align the current bypass path, which reads `AgentStorage.listAuthCredentials("openai-codex")` and returns the first non-expired OAuth credential, so it honors the same selected-account behavior.
- `packages/ai/src/providers/openai-codex-responses.ts`
  - Correlate Codex request metadata with account-affinity telemetry around the current `prompt_cache_key: options?.sessionId` request field and provider-reported cached-token usage.
- `packages/stats/src/parser.ts` and `packages/stats/src/db.ts`
  - Reuse the existing assistant-message usage ingestion path if cache-affinity observability needs to surface beyond debug logs.

Out of scope for this proposal:
- General user-configurable account-selection strategies across all providers.
- Non-Codex provider behavior changes unless required to support shared infrastructure.
- Cache-hit optimization that depends on provider-side behavior outside OMP’s control.
- Any change to OpenAI caching behavior controls (for example `prompt_cache_retention`) or a broader prompt-cache-key strategy rollout.
