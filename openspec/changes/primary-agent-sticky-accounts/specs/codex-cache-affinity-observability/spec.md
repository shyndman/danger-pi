## ADDED Requirements

### Requirement: Codex affinity telemetry SHALL identify how an account was selected
The system SHALL emit machine-readable telemetry for `openai-codex` account selection so operators can distinguish first-time pinning, inherited pin reuse, and forced rotation.

The telemetry record SHALL include at least:
- provider (`openai-codex`)
- top-level agent affinity identifier
- leaf session identifier when available
- selected credential identity (index and account/email when available)
- selection outcome (`pin_set`, `pin_hit`, or `pin_rotated`)
- selection reason when the outcome is `pin_rotated`

#### Scenario: First Codex request sets a pin
- **WHEN** a top-level agent selects a Codex account for the first time
- **THEN** the system emits a telemetry record with outcome `pin_set`
- **AND THEN** the record identifies the selected credential and top-level agent affinity identifier

#### Scenario: Child request reuses inherited pin
- **WHEN** a child or subagent reuses the top-level agent's pinned Codex credential
- **THEN** the system emits a telemetry record with outcome `pin_hit`
- **AND THEN** the record includes both the top-level agent affinity identifier and the child leaf session identifier when available

#### Scenario: Forced account change records rotation
- **WHEN** Codex selection rotates to a different credential for the same top-level agent
- **THEN** the system emits a telemetry record with outcome `pin_rotated`
- **AND THEN** the record includes the machine-readable switch reason

### Requirement: Codex cache-reuse signals SHALL be correlated with account affinity
The system SHALL make Codex cache-reuse signals observable alongside account-affinity metadata so operators can evaluate whether pinned account reuse is improving cache behavior.

This capability is observability-only: it SHALL NOT change provider caching policy, provider retention settings, or prompt-cache-key generation rules.

The correlated record SHALL include at least:
- top-level agent affinity identifier
- selected credential identity
- prompt cache key when one is sent to the provider
- provider-reported cached tokens from OpenAI response usage (`usage.prompt_tokens_details.cached_tokens`), mapped into internal usage fields (for example `usage.cacheRead`) where applicable

The implementation SHALL treat cache reuse as best-effort provider behavior and SHALL NOT interpret a zero cached-token value as an automatic affinity failure.

#### Scenario: Provider reports cache-read tokens
- **WHEN** a Codex response includes cached token usage
- **THEN** the system records the reported cache-read tokens together with the top-level agent affinity identifier and selected credential identity

#### Scenario: Prompt below cache-eligibility threshold
- **WHEN** a Codex response corresponds to prompt content below OpenAI prompt-caching eligibility thresholds
- **THEN** the system may record zero cached-token usage
- **AND THEN** the system does not classify that response as an affinity regression based on cached-token count alone

#### Scenario: Provider does not report cache-read tokens
- **WHEN** a Codex response completes without provider cache-read metadata
- **THEN** the system still records the top-level agent affinity identifier and selected credential identity
- **AND THEN** the system does not claim a cache hit or miss that was not reported by the provider

### Requirement: Codex cache telemetry SHALL preserve provider scope semantics
The system SHALL represent provider cache semantics without overstating guarantees.

#### Scenario: Provider cache is best-effort
- **WHEN** Codex responses for identical affinity and prompt cache key show varying cached-token values
- **THEN** telemetry and operator messaging treat cache behavior as best-effort rather than deterministic

#### Scenario: Cross-organization cache assumptions are avoided
- **WHEN** operators analyze cache reuse data
- **THEN** system documentation and telemetry interpretation do not assume cache sharing across organizations
