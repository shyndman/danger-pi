## Context

`packages/coding-agent/src/patch` evolved away from the OpenCode reference while we were experimenting with heuristics (dual-format parsing, fuzzy alignment, newline enforcement, enriched summaries). This drift means the agent can apply a patch that OpenCode would reject, which undermines cross-tool expectations. We only want one sanctioned behavior: exactly the OpenCode semantics plus BOM/CRLF preservation.

Key modules involved:
- `src/patch/codex-patch.ts` (parser entrypoint) and `src/patch/parser.ts` (legacy diff normalization)
- `src/patch/applicator.ts` (core matching + filesystem writes)
- `src/extensions/codex-apply-patch.ts` (tool orchestration and summaries)
- Test suites mirroring those behaviors.

## Goals / Non-Goals

**Goals:**
- Make coding-agent's patch handling identical to OpenCode except for BOM/CRLF restoration.
- Remove every additive behavior we introduced (fuzzy matching, heuristics, diff aggregation, warnings, newline padding, etc.).
- Ensure prompts/docs describe only the sanctioned behavior.

**Non-Goals:**
- Invent a new shared patch engine or reconcile codebases at the repo level.
- Improve UX beyond parity (e.g., no new summaries or diagnostics).
- Alter BOM/CRLF handling—we purposely keep that preservation.

## Decisions

1. **Parser Source of Truth**
   - Decision: Delete the git-diff support in `codex-patch.ts` and rely solely on the Codex marker parser that mirrors OpenCode.
   - Rationale: OpenCode doesn't parse arbitrary git diffs; keeping two formats invites divergence.

2. **Matching Logic**
   - Decision: Remove fuzzy/heuristic matching pipeline (`computeReplacements` variants, indentation rewriters, repeated-line trim) and reuse the simple `seekSequence` implementation from OpenCode (exact → rstrip → trim → unicode-normalized).
   - Rationale: We only want behavior that is demonstrably consistent with OpenCode. Simpler algorithm also reduces maintenance.

3. **Newline and EOF Handling**
   - Decision: Drop our automatic trailing-newline enforcement while preserving BOM + CRLF restoration (read using Bun APIs, reapply the original line ending, but do not append a newline if OpenCode wouldn't).
   - Rationale: BOM/CRLF is the single change the user kept; everything else must match OpenCode's output exactly.

4. **Tool Orchestration**
   - Decision: Remove the dry-run validation pass and warning aggregation from `codex-apply-patch.ts`; adopt the OpenCode flow of parse → ask permission (if needed) → apply once.
   - Rationale: The validation/warning pipeline is unique to coding-agent and introduces states OpenCode can't reproduce.

5. **Testing Strategy**
   - Decision: Re-baseline tests to reuse the OpenCode fixtures where possible, confirming parity, and delete tests that only cover removed heuristics.
   - Rationale: Ensures we keep observing the shared behavior while shrinking maintenance surface.

## Risks / Trade-offs

- **Regression Surface:** Removing fuzzy matching may break patches that previously "worked" despite being malformed.
  - Mitigation: Communicate in docs/prompts that strict Codex-format patches are required; rely on OpenCode parity as justification.
- **Shared-code Drift:** Copying logic manually risks future drift if OpenCode evolves.
  - Mitigation: Document the linkage in the new spec and add comments referencing the upstream commit hash used for parity.
- **User Expectation Reset:** Some teams may rely on summaries/diffs we remove.
  - Mitigation: Update release notes and prompts to clarify the exact UX going forward.

## Migration Plan

1. Snapshot OpenCode's current `apply_patch` implementation to use as reference (tests + source hashes).
2. Incrementally remove coding-agent-only behaviors (parser, applicator, tool) while running the OpenCode test fixture copies.
3. Update documentation/prompt references to reflect the strict format requirements.
4. Release and monitor error logs for unexpected patch failures; provide guidance pointing back to OpenCode limitations if needed.

## Open Questions

- Should we add integration tests that run both coding-agent and OpenCode patchers side-by-side to detect future drift? (Not required now, but could prevent regressions.)
- Do we need telemetry or logging to confirm that BOM/CRLF preservation is still working after simplifying other paths?
