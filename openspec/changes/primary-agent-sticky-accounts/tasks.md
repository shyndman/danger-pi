## 1. Thread top-level agent affinity through the Codex call path

- [ ] 1.1 Identify the top-level agent boundary in session creation and define a dedicated Codex affinity identifier with leaf-session fallback behavior.
- [ ] 1.2 Thread the affinity identifier through `createAgentSession`, `AgentSession`, and `ModelRegistry` surfaces used for Codex API key resolution.
- [ ] 1.3 Propagate the same affinity identifier into subagent/task execution so child agents inherit the parent top-level agent affinity.

## 2. Change Codex pinning to use top-level agent affinity

- [ ] 2.1 Update `AuthStorage` Codex pin lookup and recording to key off the top-level agent affinity identifier instead of the leaf session ID.
- [ ] 2.2 Preserve existing ranked fallback, backoff, and definitive-auth-failure switching behavior when the pinned credential becomes unusable.
- [ ] 2.3 Audit and align any Codex account-selection bypass paths so they honor the same affinity-aware selected account behavior.
- [ ] 2.4 Add one doc comment immediately above `AuthStorage.#resolveOAuthApiKey(...)` using the required structural tag:
  ```text
  <intent>
  Keep openai-codex credential selection sticky to the top-level agent affinity identifier so child/subagents reuse the same account by default, while preserving existing unusable-credential fallback and repin behavior.
  </intent>
  ```

## 3. Add observability for account affinity and cache signals

- [ ] 3.1 Emit structured Codex telemetry for `pin_set`, `pin_hit`, and `pin_rotated`, including top-level affinity ID, leaf session ID when available, selected credential identity, and switch reason.
- [ ] 3.2 Capture the Codex prompt cache key used for each request and correlate it with the same affinity/account telemetry.
- [ ] 3.3 Record provider-reported Codex cache-read tokens alongside affinity/account metadata without claiming cache hits when the provider reports none.

## 4. Verify behavior with focused tests

- [ ] 4.1 Extend Codex auth-storage tests to cover first-pin selection, descendant reuse, and forced rotation under a shared top-level affinity identifier.
- [ ] 4.2 Add or extend task/subagent tests proving child agents inherit the parent top-level affinity instead of selecting independently.
- [ ] 4.3 Add telemetry-focused assertions proving pinning events, switch events, prompt cache key correlation, and cache-read reporting are emitted as specified.
