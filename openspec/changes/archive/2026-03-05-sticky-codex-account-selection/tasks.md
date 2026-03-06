## 1. Session-sticky Codex selection logic

- [x] 1.1 Update `packages/ai/src/auth-storage.ts` to attempt the last successful `openai-codex` session credential before usage re-ranking.
- [x] 1.2 Ensure pinned-first logic only applies to `openai-codex` and falls through to existing ranked selection when the pin is blocked, exhausted, missing, or unusable.
- [x] 1.3 Keep pinned credential attempts on the shared `#tryOAuthCredential` path so existing usage checks, refresh handling, and block marking remain intact.
- [x] 1.4 Emit a structured log entry when Codex selection switches credentials, including provider, session ID, previous/new credential identity, and switch reason.

## 2. Behavioral test coverage

- [x] 2.1 Extend `packages/ai/test/auth-storage-codex-selection.test.ts` with a same-session stickiness test proving repeated resolution does not switch accounts under changing ranking pressure.
- [x] 2.2 Add a test proving same-session account switches after usage exhaustion/blocking (via existing limit handling path).
- [x] 2.3 Add a test proving fallback ranking is used when no valid pin exists.
- [x] 2.4 Add a test/assertion proving a switch log entry is emitted exactly once per actual Codex account switch and not emitted when no switch occurs.

## 3. Verification

- [x] 3.1 Run targeted ai tests covering Codex auth storage selection behavior.
- [x] 3.2 Confirm no behavioral changes to non-Codex provider selection paths.
- [x] 3.3 Re-run OpenSpec status to verify `tasks` is complete and change is apply-ready.
- [x] 3.4 Validate switch log fields are machine-readable and include the agreed reason enum values.
