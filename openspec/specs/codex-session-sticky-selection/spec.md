# codex-session-sticky-selection Specification

## Purpose
TBD - created by archiving change sticky-codex-account-selection. Update Purpose after archive.
## Requirements
### Requirement: Codex OAuth account choice SHALL be sticky per session
For `openai-codex`, the system SHALL treat the most recently successful OAuth credential for a session as that session's pinned credential.

Definitions for this capability:
- **Session**: the `sessionId` value passed into API key resolution.
- **Pinned credential**: the last successful `openai-codex` OAuth credential used for that same session.
- **Usable credential**: a credential that is present, not currently blocked, not usage-exhausted, and not definitively invalid.

#### Scenario: First lookup in a session establishes the pin
- **WHEN** a session requests an `openai-codex` API key and has no pinned credential yet
- **THEN** the system uses the existing Codex selection algorithm to choose a usable credential
- **AND THEN** the system records that chosen credential as the session's pinned credential

#### Scenario: Repeated lookup in same session reuses pin
- **WHEN** a session already has a usable pinned Codex credential and requests another Codex API key
- **THEN** the system attempts that pinned credential before evaluating other Codex credentials
- **AND THEN** the system returns the pinned credential's key when it succeeds

#### Scenario: Missing sessionId does not create stickiness
- **WHEN** `openai-codex` API key resolution is called without a session ID
- **THEN** the system does not attempt session pinning and uses the existing non-pinned selection behavior

### Requirement: Codex account switch SHALL happen only for unusable pinned credentials
The system SHALL switch away from a pinned `openai-codex` credential only when that pinned credential is unusable.

Unusable conditions for this capability:
- usage-exhausted or blocked by backoff state
- removed or no longer present in the provider credential list
- definitive auth failure (for example revoked token, invalid token, expired refresh token)

#### Scenario: Usage exhaustion triggers switch
- **WHEN** the pinned Codex credential is marked usage-limited/blocked for the session
- **THEN** the next Codex API key resolution for that session skips the pinned credential
- **AND THEN** the system selects another usable credential when one exists

#### Scenario: Definitive auth failure triggers switch
- **WHEN** a pinned Codex credential fails refresh/auth with a definitive failure
- **THEN** the system excludes that credential from continued use
- **AND THEN** the system resolves using remaining usable credentials

#### Scenario: Stale pinned index triggers switch
- **WHEN** the session points at a pinned credential index that no longer exists after credential list updates
- **THEN** the system ignores the stale pin
- **AND THEN** the system resolves with the existing non-pinned Codex selection path

### Requirement: Existing Codex fallback behavior SHALL be preserved
When pinning cannot be honored, the system SHALL preserve current Codex multi-account fallback semantics.

#### Scenario: No usable pin available
- **WHEN** a session has no pinned credential or its pin is unusable
- **THEN** the system applies the standard Codex ranked selection among available credentials

#### Scenario: All Codex credentials blocked
- **WHEN** every Codex OAuth credential is currently blocked
- **THEN** the system applies the existing blocked-credential fallback behavior rather than failing immediately

#### Scenario: Non-Codex providers unchanged
- **WHEN** API key resolution runs for providers other than `openai-codex`
- **THEN** their existing selection/ranking behavior remains unchanged

### Requirement: Codex account switches SHALL be logged with switch reason
When `openai-codex` selection changes from one credential to another for a session, the system SHALL emit one structured log entry for that switch.

The switch log entry SHALL include at least:
- provider (`openai-codex`)
- session identifier
- previous credential identity (index and account/email when available)
- new credential identity (index and account/email when available)
- machine-readable switch reason

Allowed switch reasons for this capability:
- `usage_blocked`
- `definitive_auth_failure`
- `pin_missing_or_stale`
- `fallback_all_blocked`

#### Scenario: Switch after usage limit logs reason
- **WHEN** a session switches Codex credentials because the pinned credential is usage-blocked
- **THEN** the system emits exactly one switch log entry with reason `usage_blocked`

#### Scenario: No switch emits no switch log
- **WHEN** a session resolves Codex API keys repeatedly and keeps the same credential
- **THEN** the system does not emit a switch log entry for those lookups

