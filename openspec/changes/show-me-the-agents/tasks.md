## 1. Viewer package scaffold

- [ ] 1.1 Create `packages/agent-session-viewer/` with the same minimum shape other workspace CLIs use: package metadata, dependency declarations, and a CLI entrypoint file.
- [ ] 1.2 Add CLI argument parsing for exactly two concerns: a required session-file path and optional `-f` / `--follow`, using `node:util.parseArgs` directly in `packages/agent-session-viewer/src/cli.ts`. Do not add theme flags, filtering flags, alternate launch modes, or a new parser dependency in this change.

- [ ] 1.3 Add exactly one `<intent>` doc comment to the top-level orchestration function in `packages/agent-session-viewer/src/cli.ts` (provisional function name: `runSessionViewer`) using the exact text specified in `design.md`.
- [ ] 1.4 Create viewer-local modules with one owner each: `src/session-file.ts` for byte/line reading, `src/normalize.ts` for entry-to-row mapping, `src/render.ts` for append-only output, `src/theme.ts` for theme bootstrap, and `src/types.ts` for row/state types.
- [ ] 1.5 Add package-local tests for the new modules rather than putting viewer tests under `packages/coding-agent/test/`.

## 2. Session reading and follow behavior

- [ ] 2.1 Implement initial JSONL loading for a session file: read the file once, split into complete lines, parse entries, and derive startup header state from those parsed entries.
- [ ] 2.2 If the file does not exist or cannot be opened at startup, print a truthful error and exit with failure. Do not retry or wait for the file to appear in this change.
- [ ] 2.3 Store the byte offset of the last successfully processed byte after the initial read. This offset becomes the only starting point for follow-mode reads.
- [ ] 2.4 Implement append-only follow logic that reads only bytes after the saved offset, prepends any buffered partial line, parses only newline-terminated JSONL lines, and keeps one incomplete trailing fragment buffered for the next tick.
- [ ] 2.5 If follow mode detects that the file disappeared, shrank, truncated, was replaced, or otherwise stopped behaving like the same append-only stream, print a truthful error and exit with failure. Do not recover automatically.
- [ ] 2.6 If follow mode encounters malformed appended JSONL once a full line is available, print a truthful parse error and exit with failure. Do not skip the bad line and continue.
- [ ] 2.7 Ensure snapshot mode renders once and exits, while follow mode keeps tailing only when `-f` / `--follow` is present. Do not re-render the startup header or previously printed rows during follow updates.

## 3. Transcript normalization

- [ ] 3.1 Normalize persisted entries into exactly four row kinds (`user`, `assistant`, `tool`, `notice`) without booting coding-agent session runtime or `SessionManager`.
- [ ] 3.2 Implement the entry mapping in one place: `session` header seeds header chrome only; `message.role === "user"` becomes a user row; assistant text/thinking stays in assistant rows; assistant `toolCall` blocks create tool rows; unmatched or unsupported persisted content becomes notice rows.
- [ ] 3.3 Keep assistant thinking inside assistant rows and convert assistant `toolCall` content into generic tool-call rows while storing minimal call metadata by tool-call id for later lookup.
- [ ] 3.4 Emit later `toolResult` messages as later generic tool-result rows in append-only order. Reuse stored call metadata when available, but do not mutate or repaint previously printed tool-call rows. If a result arrives without a matching prior call, emit a notice row instead of inventing a fake tool call.
- [ ] 3.5 Handle metadata entries (`model_change`, `thinking_level_change`, `service_tier_change`) in two phases: before first render they update header state silently; after first render in follow mode they produce compact notice rows.

## 4. OMP-like rendering

- [ ] 4.1 Reuse shared Rose Pine theme/bootstrap helpers and status-line formatting from `@oh-my-pi/pi-coding-agent` inside the viewer package.
- [ ] 4.2 Implement the header chrome and make it show exactly: session identity, cwd when available, startup model when available, startup thinking level when available, and whether the viewer is in snapshot or follow mode.
- [ ] 4.3 Render user rows so they contain only user-authored content plus any image/fallback content that belongs to that user message.
- [ ] 4.4 Render assistant rows so they contain assistant text plus thinking subcontent, but never embedded tool execution chrome.
- [ ] 4.5 Reuse lightweight shared message widgets only when they are truthful for those user/assistant rows in a non-interactive append-only transcript. If a component assumes expansion, focus, or controller state, do not import it into the viewer.
- [ ] 4.6 Implement one viewer-owned generic tool-call row that shows tool name, generic status/title treatment, and compact args preview only.
- [ ] 4.7 Implement one viewer-owned generic tool-result row in the same visual family that shows tool name again, final result styling, result body content, and result images/fallbacks when available. Do not mutate the earlier tool-call row.
- [ ] 4.8 Render notice rows for metadata changes, unsupported content, and unmatched tool results, and make them visually distinct from ordinary chat rows.
- [ ] 4.9 Render images in the viewer when usable image bytes are available, using the kitty-capable shared image path already present in `pi-tui` / shared components.
- [ ] 4.10 Make image rendering fully tolerant to missing image data or missing `/tmp` files by showing a truthful textual fallback inside the surrounding row/block instead of throwing or aborting transcript rendering. The fallback text must say the image is missing, unavailable, or could not be loaded, and should include a real surviving identifier such as the file path or mime type when available.
- [ ] 4.11 Render snapshot and follow output as normal terminal text without alternate-screen scroll handling, per-tool widgets, or header repaint logic. Keep this viewer kitty-only; do not add cross-terminal support branches in this change.

## 5. generate_image session externalization

- [ ] 5.1 Update the existing write-side persistence seam in `packages/coding-agent/src/session/session-manager.ts` so `generate_image` result image bytes in `toolResult.details.images[*].data` are externalized before the JSONL line is written.
- [ ] 5.2 In that same persistence seam, externalize non-empty inline `generate_image` input bytes from assistant `toolCall.arguments.input[*].data` while leaving `input[*].path` untouched.
- [ ] 5.3 Update the existing read-side blob-resolution seam in `packages/coding-agent/src/session/session-manager.ts` so those persisted `generate_image` blob references are resolved back into the existing in-memory message shape before consumers read entries.
- [ ] 5.4 Reuse helpers in `packages/coding-agent/src/session/blob-store.ts`; do not duplicate blob-ref parsing or resolution logic in the new viewer package or in `packages/coding-agent/src/tools/gemini-image.ts`.

## 6. Verification

- [ ] 6.1 Add viewer CLI tests covering required path parsing plus `-f` / `--follow`, and assert that unsupported extra flags are not introduced by this change.
- [ ] 6.2 Add viewer normalization/render tests covering header chrome fields, user rows, assistant thinking, tool-call rows, later tool-result rows without repaint, metadata-to-notice mapping, and default Rose Pine theming.
- [ ] 6.3 Add viewer image tests covering successful image rendering when bytes are present and truthful textual fallback when image data or `/tmp` paths are missing.
- [ ] 6.4 Add follow-mode tests covering append-only updates, stable byte-offset tracking, completed-line parsing, and incomplete-line buffering.
- [ ] 6.5 Add follow-mode failure tests covering startup file-open failure, file disappearance, truncation/replacement, and malformed appended JSONL.
- [ ] 6.6 Add coding-agent session persistence tests covering `generate_image` result/input externalization, preservation of non-byte metadata, path-backed input preservation, and restore-time blob resolution.
- [ ] 6.7 Treat the viewer as requiring a full package-local test suite, not just smoke coverage. Do not hand off implementation with only ad hoc manual checks.
- [ ] 6.8 Implement and pass tasks in order: finish sections 1-3 before 4, finish 4 before 6.1-6.5, and finish 5 before 6.6. This sequencing avoids debugging rendering and persistence changes simultaneously.
- [ ] 6.9 Keep the implementation isolated so it can land as its own commit without unrelated cleanup or refactors.
- [ ] 6.10 Run targeted package tests plus `bun check:ts` before handing off implementation.
