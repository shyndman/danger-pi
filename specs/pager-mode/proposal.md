## Why

Complex assistant-authored topics are currently delivered as a flat chat stream, which makes multi-page workflow-style explanations inconsistent and hard to resume. The fork needs a built-in pager workflow that can keep the assistant, the transcript, and the TUI aligned on which page is active while still letting the user chat normally between page transitions. This is worth doing now because the user already has a concrete paging protocol in mind and wants to evaluate it using existing extension-controlled UI surfaces instead of adding new fork-only runtime seams. The feature also needs to survive rewind, branching, and resume cleanly, so the first version must treat transcript history as the source of truth rather than relying on in-memory extension state.

## What Changes

- Add a fork-owned `pager-mode` extension under `packages/coding-agent/src/danger-pi/` that recognizes assistant-emitted `<pager-index ...>...</pager-index>` index pages and activates pager state for the current branch.
- Keep the assistant's index page as a normal assistant message in the transcript; parse it for pager metadata instead of replacing it with a fork-only rewritten message path.
- Show pager state through extension-controlled UI, with keyed status as the required surface and widget support kept optional for later exploration.
- Add `/pager:next` and `/pager:exit` extension commands.
- Make `/pager:next` and `/pager:exit` append visible custom messages with special rendering and model-visible `<system-notice>` payloads so both users and the LLM can follow pager state transitions in history.
- Reconstruct pager state by walking the active session branch backward from the current leaf, using assistant index pages plus `pager-next` / `pager-exit` custom messages as the full protocol.
- Update pager status immediately when `/pager:next` is invoked; advancing from the last page closes pager mode just like `/pager:exit`.
- Explicitly avoid adding a new assistant-message rewrite/suppression seam in the fork.

## Scope

### New Capabilities
- `pager-mode`: A built-in extension workflow that turns assistant-authored `<pager-index>` pages into branch-local paging state, shows the active page in TUI status UI, and provides `/pager:next` and `/pager:exit` commands for advancing or leaving the workflow.
- `pager-history-protocol`: A transcript-visible paging protocol made of assistant index pages plus rendered `pager-next` / `pager-exit` custom messages, allowing the current branch to reconstruct pager state after rewind, branching, and resume without hidden duplicate state.

### Modified Capabilities
- `extension-command-registration`: Built-in fork extensions now register pager commands that trigger model-visible custom messages, status updates, and next-turn prompting without showing raw slash-command text in history.
- `extension-status-ui`: Extension-driven keyed status now carries live paging state using the fixed display forms `[0/{n}] {title}: Index` and `[{i}/{n}] {page_title}`.
- `session-history-navigation`: Moving around the session tree now needs pager UI to follow the active branch's reconstructed paging state instead of a per-process in-memory cursor.

## Impact

- Affected code is centered in `packages/coding-agent/src/danger-pi/`, with smaller hooks in extension loading, custom-message rendering, slash-command execution, and session-change/UI refresh paths.
- The feature depends on existing extension primitives only: assistant message observation, custom message rendering, keyed status updates, slash-command registration, and branch-aware session history reads.
- No new runtime seam, message-rewrite path, or external dependency is required.
- User-visible behavior changes in interactive sessions: pager control events become explicit custom-message transcript entries, and the TUI shows branch-aware paging status while a pager workflow is active.
