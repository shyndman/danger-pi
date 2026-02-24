## ADDED Requirements

### Requirement: apply_patch accepts only codex markers
The system SHALL parse patches exclusively via Codex marker blocks (*** Begin Patch / *** End Patch) using the same grammar as OpenCode. Git-style diffs, bare hunks, or hybrid formats SHALL be rejected with a clear validation error.

#### Scenario: Patch with unsupported format is rejected
- **WHEN** the user submits `apply_patch` content that contains `diff --git` headers without Codex markers
- **THEN** the tool SHALL reject the patch and surface the exact OpenCode error message explaining the unsupported format

### Requirement: Matching follows OpenCode seek sequence
The system SHALL match hunks using only the OpenCode seek sequence (exact → rstrip → trim → unicode-normalized) without any fuzzy heuristics, indentation adjustment, or repeated-line collapsing.

#### Scenario: Hunk fails to match after four passes
- **WHEN** none of the four OpenCode comparisons locate the target lines
- **THEN** the tool SHALL abort the patch with the same failure message OpenCode would emit ("Failed to find expected lines"), without attempting additional heuristics

### Requirement: Encoding preservation limited to BOM/CRLF
The system SHALL preserve original BOM prefixes and CRLF line endings when rewriting files but SHALL NOT append trailing newlines or otherwise alter content beyond the OpenCode diff results.

#### Scenario: File without newline remains newline-free
- **WHEN** a patch updates a file that previously lacked a trailing newline
- **THEN** the resulting file SHALL continue to lack a trailing newline even after BOM/CRLF restoration
