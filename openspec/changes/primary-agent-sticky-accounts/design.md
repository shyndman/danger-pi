## Context

Current Codex account pinning lives in `packages/ai/src/auth-storage.ts` and is keyed by the `sessionId` passed into API-key resolution. That works for a single agent session, but subagents get separate session files and session IDs (`packages/coding-agent/src/task/index.ts`, `packages/coding-agent/src/task/executor.ts`), so related work can spread across multiple Codex accounts. That weakens account-level cache locality.

At the same time, Codex prompt-cache routing is also currently keyed by `options?.sessionId` in `packages/ai/src/providers/openai-codex-responses.ts`. Account affinity alone may improve reuse opportunities, but it will not prove or guarantee cache wins by itself. We need observability that lets us see account pinning, account switches, and reported cache-read tokens together.

Constraints:
- Keep the first implementation narrow and fork-friendly.
- Preserve current multi-account ranking, backoff, and failure-driven switching behavior.
- Avoid introducing a general cross-provider strategy framework in this change.
- Leave default non-Codex behavior unchanged.
- Follow OpenAI Prompt Caching contract details rather than inferred behavior: `prompt_cache_key` is a routing hint (not a cache guarantee), cache hits are reported as `usage.prompt_tokens_details.cached_tokens` (mapped to internal `usage.cacheRead`), and caches are best-effort.
- Use existing dependencies only (current `openai` + `@oh-my-pi/pi-ai` + existing stats pipeline); no new package dependency is required for this scope.

Third-party dependency assumptions (verified):
- OpenAI Responses API accepts `prompt_cache_key` on request payloads.
- OpenAI prompt caching is eligible for prompts with >=1024 tokens and can overflow routing effectiveness around ~15 requests/minute per prefix+key pair.
- In-memory cache retention is typically 5–10 minutes (up to ~1 hour); extended 24h retention exists for supported models with privacy/compliance tradeoffs.
- Prompt caches are private to an organization; cache reuse is not shared across organizations.

## Goals / Non-Goals

**Goals:**
- Pin Codex account selection to a top-level agent boundary instead of a leaf session boundary.
- Ensure child/subagents inherit that same Codex account affinity.
- Preserve existing fallback behavior when the pinned credential becomes unusable.
- Add operator-visible telemetry that correlates top-level agent affinity, selected account, switch reason, prompt cache key, and reported cache-read tokens.
- Keep the implementation surgically scoped so it can be validated before any broader upstreaming story.

**Non-Goals:**
- Building a generic user-configurable account-selection strategy system.
- Changing non-Codex provider selection behavior.
- Guaranteeing provider-side cache hits.
- Redesigning stats storage or building a new UI dashboard in this change.
- Changing OpenAI cache policy controls (for example `prompt_cache_retention`) or doing a prompt-cache-key strategy migration.

## Decisions

1. Introduce a Codex-specific affinity identifier that is separate from leaf `sessionId`.
- Decision: thread an optional top-level-agent affinity identifier through Codex account selection paths instead of reusing the leaf session identifier.
- Why: this isolates the behavior change to the affinity problem. `sessionId` still means the current leaf session for all existing consumers, while Codex pinning can use a shared root identifier.
- Alternative considered: redefine all session-based selection to mean top-level agent. Rejected because it changes the meaning of an existing parameter across the stack and risks broader regressions.

2. Establish affinity once in the top-level agent and pass it explicitly to descendants.
- Decision: top-level agent creation owns the affinity identifier, and task/subagent creation passes that identifier downward.
- Why: this matches the desired behavior exactly: one top-level agent picks an account, descendants inherit it, and `/new` naturally creates a fresh affinity domain.
- Alternative considered: process-global memory or OS-process stickiness. Rejected because subagents are separate processes and because process scope is broader than the desired operator workflow.

3. Keep existing Codex ranking and switching logic; change only the pinning key.
- Decision: continue using the existing ranking, backoff, and definitive-failure handling in `AuthStorage`, but store and look up the preferred Codex credential by affinity identifier rather than leaf session ID.
- Why: this is the smallest change that solves the immediate problem and preserves the existing safety behavior around unusable accounts.
- Alternative considered: replace the Codex selector with a new strategy object. Rejected for now because it adds abstraction without helping the immediate fork goal.

4. Align non-mainline Codex consumers with the same affinity path.
- Decision: any Codex consumer that currently bypasses `AuthStorage` account selection should be brought under the same affinity-aware path or made to consume the same selected credential state.
- Why: partial adoption would create split-brain selection, making observability hard to trust.
- Alternative considered: fix only the main prompt path first. Rejected because the resulting telemetry would be ambiguous whenever bypass paths are active.

5. Start observability with structured logs and existing usage fields.
- Decision: emit machine-readable events for `pin_set`, `pin_hit`, and `pin_rotated`, and correlate them with the prompt cache key sent to Codex plus reported `cacheRead` tokens already available in provider usage handling.
- Why: this is the fastest path to proving or disproving the hypothesis without inventing a new analytics pipeline.
- Alternative considered: build a new stats table or dedicated UI first. Rejected because it adds a lot of surface area before we know whether the affinity change helps.

6. Keep caching policy unchanged in this proposal; observe only.
- Decision: this change captures prompt-cache and cached-token signals for telemetry but does not change prompt-cache-key generation or retention policy.
- Why: account-affinity correctness and cache-policy tuning are separable, and changing both at once would blur causality.
- Alternative considered: combine account pinning with cache policy changes now. Rejected; defer to a separate proposal.

7. Capture design intent in code with a single structural doc comment.
- Decision: add exactly one intent doc comment at the implementation center of Codex account selection.
- Proposed location: `packages/ai/src/auth-storage.ts`, immediately above `#resolveOAuthApiKey(provider, sessionId, options)`.
- Required text:

```text
<intent>
Keep openai-codex credential selection sticky to the top-level agent affinity identifier so child/subagents reuse the same account by default, while preserving existing unusable-credential fallback and repin behavior.
</intent>
```

- Why: this records the core behavior contract where future maintainers will edit logic, reducing drift between proposal intent and runtime code.

## Risks / Trade-offs

- [Risk] Account affinity alone may not materially improve cache reuse because Codex still sends leaf-session `prompt_cache_key` values. → Mitigation: explicitly log the prompt cache key and `cacheRead` tokens so the effect is measurable.
- [Risk] Descendant propagation may miss one or more task-launching paths. → Mitigation: thread the affinity identifier through all top-level-agent and subagent creation surfaces and add tests that cover descendant inheritance.
- [Risk] A pinned account can become suboptimal versus the current ranked best account. → Mitigation: keep the existing unusable-account switch rules and fallback ranking unchanged.
- [Risk] Logging can become noisy in subagent-heavy runs. → Mitigation: emit compact structured events only for pin establishment, inherited reuse, rotation, and request/result correlation points.
- [Risk] Codex bypass paths can undermine trust in the telemetry. → Mitigation: explicitly inventory and align bypass consumers as part of implementation.
- [Risk] OpenAI prompt cache effectiveness may drop due to documented routing overflow (~15 requests/min per prefix+key) or normal retention expiry. → Mitigation: treat `cacheRead=0` as expected in those windows and correlate misses with request volume/timing before concluding affinity failed.

## Migration Plan

- No data migration required.
- Introduce the affinity identifier as an additive internal parameter with fallback behavior when absent.
- Ship telemetry with the behavior change so validation is immediate.
- Roll back by removing affinity propagation and returning Codex pinning to leaf-session scope; existing ranking behavior remains available.

## Open Questions

- Should the top-level-agent affinity identifier simply be the root session ID, or should it be a new explicitly named field carried alongside session metadata?
- Which observability sink is most useful for first validation: structured logs only, session custom entries, or both?
- Should a separate follow-up proposal change prompt-cache-key scope and/or retention policy once affinity telemetry is validated?
