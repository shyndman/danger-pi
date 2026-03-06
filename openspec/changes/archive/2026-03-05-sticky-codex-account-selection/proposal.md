## Why

In `packages/ai/src/auth-storage.ts`, `getApiKey()` resolves OAuth credentials via `#resolveOAuthApiKey()`, and for providers with ranking strategies and multiple OAuth credentials it re-ranks candidates each resolution through `#rankOAuthSelections()`. The same file records session credential history in `#sessionLastCredential`, but that state is currently used by `markUsageLimitReached()` for limit-driven blocking rather than pinned-first selection.

As a result, `openai-codex` sessions can switch accounts across repeated API key resolutions before an explicit usage-limit handoff.

## What Changes

- Add a Codex-specific pinned-first branch in `#resolveOAuthApiKey()` so a session first attempts its last successful `openai-codex` OAuth credential.
- Keep switching conditions aligned with current unusable states already handled by `#tryOAuthCredential()` and related logic: usage exhaustion/blocking, definitive auth failure (revoked/invalid/expired-refresh paths), and missing/stale credential mapping after provider assignment reset.
- Preserve existing ranked multi-account fallback (including blocked-credential fallback behavior) when the pinned credential cannot be used.
- Scope pinning to `openai-codex` only; existing ranking semantics for other providers remain unchanged.
- Emit a structured log entry whenever a Codex session switches from one credential to another, including switch reason and previous/new credential identity.

## Capabilities

### New Capabilities
- `codex-session-sticky-selection`: Ensure Codex OAuth credential choice is sticky per session until exhaustion or definitive credential failure, with deterministic fallback.

### Modified Capabilities
- None.

## Impact

- Affected code: `packages/ai/src/auth-storage.ts` (OAuth resolution, session credential tracking, and limit/block interactions) and `packages/ai/test/auth-storage-codex-selection.test.ts` (behavioral coverage for Codex selection).
- Related integration point (no interface change planned): `packages/coding-agent/src/session/agent-session.ts` calls `authStorage.markUsageLimitReached()` on usage-limit retries.
- Observability impact: Codex account switch events become queryable via structured logs for debugging and cache-churn analysis.
- Public API surface remains unchanged: `AuthStorage` is exported from `packages/ai/src/index.ts`, and this change is internal behavior within existing method signatures.
