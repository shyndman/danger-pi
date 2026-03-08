## MODIFIED Requirements

### Requirement: Codex OAuth account choice SHALL be sticky per session
For `openai-codex`, the system SHALL treat the most recently successful OAuth credential for a top-level agent as that top-level agent's pinned credential.

Definitions for this capability:
- **Top-level agent**: the root coding-agent execution that owns the operator-facing session and may spawn child/subagents.
- **Agent affinity identifier**: the identifier used to share Codex account selection across the top-level agent and its descendants.
- **Pinned credential**: the last successful `openai-codex` OAuth credential used for that same top-level agent.
- **Usable credential**: a credential that is present, not currently blocked, not usage-exhausted, and not definitively invalid.

#### Scenario: First lookup in a top-level agent establishes the pin
- **WHEN** a top-level agent requests an `openai-codex` API key and has no pinned credential yet
- **THEN** the system uses the existing Codex selection algorithm to choose a usable credential
- **AND THEN** the system records that chosen credential as the pinned credential for that top-level agent

#### Scenario: Descendant lookup reuses top-level agent pin
- **WHEN** a child/subagent requests an `openai-codex` API key for a top-level agent that already has a usable pinned credential
- **THEN** the system attempts that pinned credential before evaluating other Codex credentials
- **AND THEN** the child/subagent uses the same pinned credential when it succeeds

#### Scenario: Missing top-level agent affinity does not create stickiness
- **WHEN** `openai-codex` API key resolution is called without a top-level agent affinity identifier
- **THEN** the system does not attempt top-level-agent pinning
- **AND THEN** the system uses the existing non-pinned selection behavior

### Requirement: Codex account switch SHALL happen only for unusable pinned credentials
The system SHALL switch away from a pinned `openai-codex` credential only when that pinned credential is unusable for the same top-level agent.

Unusable conditions for this capability:
- usage-exhausted or blocked by backoff state
- removed or no longer present in the provider credential list
- definitive auth failure (for example revoked token, invalid token, expired refresh token)

#### Scenario: Usage exhaustion triggers switch
- **WHEN** the pinned Codex credential is marked usage-limited or blocked for a top-level agent
- **THEN** the next Codex API key resolution for that top-level agent skips the pinned credential
- **AND THEN** the system selects another usable credential when one exists

#### Scenario: Definitive auth failure triggers switch
- **WHEN** a pinned Codex credential fails refresh or auth with a definitive failure for a top-level agent
- **THEN** the system excludes that credential from continued use for that top-level agent
- **AND THEN** the system resolves using remaining usable credentials

#### Scenario: Stale pinned index triggers switch
- **WHEN** the top-level agent points at a pinned credential index that no longer exists after credential list updates
- **THEN** the system ignores the stale pin
- **AND THEN** the system resolves with the existing non-pinned Codex selection path

### Requirement: Existing Codex fallback behavior SHALL be preserved
When pinning cannot be honored, the system SHALL preserve current Codex multi-account fallback semantics.

#### Scenario: No usable pin available
- **WHEN** a top-level agent has no pinned credential or its pin is unusable
- **THEN** the system applies the standard Codex ranked selection among available credentials

#### Scenario: All Codex credentials blocked
- **WHEN** every Codex OAuth credential is currently blocked
- **THEN** the system applies the existing blocked-credential fallback behavior rather than failing immediately

#### Scenario: Non-Codex providers unchanged
- **WHEN** API key resolution runs for providers other than `openai-codex`
- **THEN** their existing selection and ranking behavior remains unchanged

### Requirement: Codex account switches SHALL be logged with switch reason
When `openai-codex` selection changes from one credential to another for a top-level agent, the system SHALL emit one structured log entry for that switch.

The switch log entry SHALL include at least:
- provider (`openai-codex`)
- top-level agent affinity identifier
- leaf session identifier when available
- previous credential identity (index and account/email when available)
- new credential identity (index and account/email when available)
- machine-readable switch reason

Allowed switch reasons for this capability:
- `usage_blocked`
- `definitive_auth_failure`
- `pin_missing_or_stale`
- `fallback_all_blocked`

#### Scenario: Switch after usage limit logs reason
- **WHEN** a top-level agent switches Codex credentials because the pinned credential is usage-blocked
- **THEN** the system emits exactly one switch log entry with reason `usage_blocked`
- **AND THEN** the log entry includes the same top-level agent affinity identifier for both the old and new credential context

#### Scenario: No switch emits no switch log
- **WHEN** a top-level agent resolves Codex API keys repeatedly and keeps the same credential
- **THEN** the system does not emit a switch log entry for those lookups
