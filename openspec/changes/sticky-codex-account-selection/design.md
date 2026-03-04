## Context

`AuthStorage` currently selects OAuth credentials by computing an ordered candidate list and re-ranking by usage pressure for providers with ranking strategies (including `openai-codex`). This improves quota utilization, but it also means repeated key resolution in the same session can move between accounts before a limit event, which hurts backend cache reuse for Codex flows.

The code already tracks `session -> last credential` (`#sessionLastCredential`), but that mapping is presently used for rate-limit blocking handoff (`markUsageLimitReached`) rather than as a first-class pin during selection.

Constraints:
- Keep changes local and merge-friendly (fork preference for surgical hooks).
- Preserve existing safety behavior: usage checks, exhaustion blocking, and fallback when all credentials are blocked.
- Scope behavior to `openai-codex` only; no policy change for other providers.

## Goals / Non-Goals

**Goals:**
- Keep Codex account selection sticky within a session by default.
- Switch only when the pinned credential becomes unusable (usage exhaustion/blocking, missing credential, or definitive refresh/auth failure).
- Preserve current fallback/ranking path when the pinned credential cannot be used.
- Emit structured logs on Codex account switches with explicit switch reason.
- Add tests that prove stickiness and exhaustion-driven switching.

**Non-Goals:**
- Changing ranking heuristics for non-Codex providers.
- Persisting pin state across process restarts.
- Redesigning usage-provider APIs or storage schema.

## Decisions

1. Add a Codex-specific pinned-first branch in `#resolveOAuthApiKey`.
- Decision: before global ranking, attempt the last successful session credential when `provider === "openai-codex"` and `sessionId` exists.
- Why: this is the narrowest integration point with full context (provider/session/credential index/block state) and minimal churn.
- Alternative considered: encode pinning inside `#rankOAuthSelections`; rejected because ranking is generic and this policy is provider-specific.

2. Reuse `#tryOAuthCredential` for pinned attempts.
- Decision: route pinned-first attempts through the same function used by ranked candidates.
- Why: keeps exhaustion checks, token refresh, block marking, and session recording consistent.
- Alternative considered: direct token return path for pinned credential; rejected because it bypasses existing validation and failure handling.

3. Keep ranked fallback unchanged.
- Decision: if pinned attempt fails or is blocked, continue to existing ranked candidate flow.
- Why: preserves current resilience behavior and avoids regressions when account state changes.
- Alternative considered: hard fail when pinned credential is unavailable; rejected because it would reduce availability despite healthy alternatives.

4. Log account switches as first-class events.
- Decision: emit one structured log record each time Codex selection changes credentials for a session.
- Why: enables verification that stickiness is working and gives operational visibility into churn causes.
- Alternative considered: infer switches indirectly from debug traces; rejected because correlation is unreliable and expensive.

## Risks / Trade-offs

- [Risk] A stale pin could briefly bias toward a now-inferior account. → Mitigation: pinned attempt still runs usage checks; exhausted accounts are blocked and skipped quickly.
- [Risk] Session pinning reduces proactive balancing across accounts. → Mitigation: fallback ranking remains active when pin is invalid/exhausted; this is an explicit trade-off for cache locality.
- [Risk] Credential index drift after account changes. → Mitigation: existing `#resetProviderAssignments` already clears session mappings when credentials are replaced/removed.
- [Risk] Switch logging can increase log volume in high-churn periods. → Mitigation: log only on actual credential change and include compact structured fields.

## Migration Plan

- No data migration required.
- Deploy code + tests together.
- Rollback by removing the pinned-first branch; existing ranking behavior remains intact.

## Open Questions

- Should sticky behavior be configurable in settings (future), or remain fixed Codex policy?
- Should we eventually persist session pin state across restarts for long-lived workflows?
