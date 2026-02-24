## 1. Revert parser and applicator behaviors

- [x] 1.1 Remove git-diff parsing path and ensure Codex marker parser matches OpenCode
- [x] 1.2 Replace heuristic matching logic with OpenCode `seekSequence` equivalent while preserving BOM/CRLF handling
- [x] 1.3 Drop trailing-newline enforcement, warning aggregation, and diff-summary generation from the applicator

## 2. Align tool orchestration and prompts

- [x] 2.1 Simplify `codex-apply-patch` execution path (single apply pass, no validation loop, no extra warnings)
- [x] 2.2 Update prompts/docs/changelogs to describe the strict Codex-format requirement and parity baseline

## 3. Update and extend regression coverage

- [x] 3.1 Re-baseline core + extension tests to mirror OpenCode fixtures (remove heuristic-only cases)
- [x] 3.2 Add parity tests or references proving BOM/CRLF preservation is the only deviation
