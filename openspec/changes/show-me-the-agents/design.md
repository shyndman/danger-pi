## Context

We are adding a fork-local session viewer for coding-agent JSONL session files. The motivating UX is already in place outside this change: clicking an agent URI launches a program against a concrete session file path. The missing piece is a fast renderer that strongly resembles OMP without paying the startup and runtime cost of launching the full coding-agent application.

A few repo facts shape the design:

- Session files are append-only JSONL, and persistence happens on completed message boundaries (`message_end` / appended session entries), not on token deltas. A follower can therefore be live, but only at persisted entry boundaries.
- Current session persistence already externalizes some large payloads (for example display details), but `generate_image` still persists large inline image data inside tool details, which directly hurts parse time for this viewer.
- The OMP look mostly comes from semantic Rose Pine theme tokens, status-line formatting, and a handful of `pi-tui` primitives / message widgets. We verified in a temporary experiment that those pieces can render outside the main app.
- The viewer is a normal terminal program writing output into kitty. Kitty documents that its scroll actions operate only in the main screen and are passed through to the child program while the alternate screen is active, so the viewer must stay on normal output rather than inventing its own alternate-screen scroll model.
- Kitty scrollback retention is terminal-config-dependent, not viewer-controlled: `scrollback_lines` defaults to 2000 lines, negative values are effectively infinite, and very large values trade RAM/performance for history. The viewer can preserve kitty-native scrollback behavior, but it cannot promise unbounded retained history after launch.

## Goals / Non-Goals

**Goals:**
- Add a top-level workspace package dedicated to viewing coding-agent session files.
- Render directly from raw JSONL entries instead of booting session runtime or interactive app state.
- Make the output feel unmistakably like OMP by reusing real theme helpers and selected widgets where that reduces drift.
- Keep the transcript grammar intentionally small: header chrome, user rows, assistant rows, generic tool rows, and compact notice rows.
- Support optional live following via `-f` / `--follow`, while keeping static snapshot mode as the default.
- Keep kitty in charge of scrollback by emitting normal terminal output rather than a fullscreen TUI.
- Externalize `generate_image` inline image blobs so large sessions stay cheap to parse.

**Non-Goals:**
- Reproducing every interactive OMP widget or expand/collapse affordance.
- Reusing the full coding-agent runtime, session manager, tool registry, or provider stack.
- Implementing token-by-token streaming that does not exist in persisted session files.
- Improving durability of path-backed `generate_image` inputs beyond today’s behavior.
- Changing the existing kitty launch integration that invokes the viewer.

## Decisions

### 1) Create a dedicated top-level workspace package

**Decision:** Add `packages/agent-session-viewer/` as a new package with its own CLI entrypoint.

**Why:** The viewer is conceptually a separate executable with a separate startup profile. A top-level package gives the fork a clean isolation boundary and keeps the change easy to reason about and easy to merge around.

**Package shape (initial):**
- `package.json`: package name, workspace dependencies, and the CLI `bin` entry for the viewer executable
- `src/cli.ts`: argument parsing and process entry
- `src/session-file.ts`: initial load + append-follow logic
- `src/normalize.ts`: JSONL entry -> viewer row/state mapping
- `src/render.ts`: row/header rendering orchestration
- `src/theme.ts`: viewer-facing theme bootstrap helpers
- `src/types.ts`: viewer row/state types
- `test/*.test.ts`: viewer-focused tests for normalization, follow buffering, and render snapshots

The implementation should stay shallow: `src/cli.ts` wires the file path and follow flag into `src/session-file.ts`; `src/session-file.ts` emits parsed JSON objects plus byte-offset updates; `src/normalize.ts` owns all "what row does this become?" decisions; `src/render.ts` only formats already-normalized rows. Do not let rendering code start reinterpreting raw session entries.

#### Required `<intent>` doc comment

The implementation should add exactly one `<intent>` doc comment in the new viewer package. Do not add multiple `<intent>` comments across helpers or submodules.

**Proposed location:** the top-level orchestration function in `packages/agent-session-viewer/src/cli.ts` that takes the parsed CLI inputs, performs the initial session-file read, normalizes the loaded entries, renders the first snapshot, and optionally starts follow mode. If the implementer wants a concrete provisional name, use `runSessionViewer` for that function.

**Exact doc comment text to add:**

```ts
/**
 * <intent>Read a persisted coding-agent session file, normalize it into viewer state and rows, render the initial transcript once, and optionally append newly persisted rows in follow mode.</intent>
 */
```

This comment belongs on that orchestration function and nowhere else in this change. Keep it singular so there is one obvious place where a reader learns the viewer's end-to-end responsibility.

**CLI argument parsing choice:**
- Existing coding-agent launch arguments are parsed by the custom `parseArgs()` function in `packages/coding-agent/src/cli/args.ts`.
- Elsewhere in the workspace, command/subcommand CLIs use `@oh-my-pi/pi-utils/cli`, which is a thin wrapper over `node:util.parseArgs`.
- For this viewer, do not add an external parser dependency and do not copy the full coding-agent parser. The CLI only needs one positional session-file path plus `-f` / `--follow`, so parse those directly in `packages/agent-session-viewer/src/cli.ts` with `node:util.parseArgs`.

**Dependencies:**
- `@oh-my-pi/pi-tui`
- `@oh-my-pi/pi-utils`
- `@oh-my-pi/pi-coding-agent` (workspace import, but with a deliberately narrow import surface)

**Alternatives considered:**
- Put the viewer under `packages/coding-agent/src/`: rejected because it weakens the isolation the fork wants.

### 2) Render from raw JSONL, not from session runtime

**Decision:** The viewer parses session JSONL lines directly and maintains only minimal local state needed for presentation.

**Why:** This keeps startup fast, avoids pulling in coding-agent runtime behavior, and matches the actual invocation contract: the viewer receives a file path, not a live session object.

**Normalization model:**
- Keep a small current-state object for header metadata (cwd, latest model, latest thinking level, session title/path, running/completed status).
- Normalize persisted entries into feed rows:
  - `user`
  - `assistant`
  - `tool`
  - `notice`
- Assistant `thinking` stays inside assistant presentation.
- Assistant `toolCall` content becomes a generic tool-call row and stores minimal metadata keyed by tool-call id for later lookup.
- Later `toolResult` messages become later generic tool-result rows. They may reuse stored call metadata, but they do not rewrite or mutate previously printed output.


**Concrete mapping rules for `packages/coding-agent/src/session/session-manager.ts` entry shapes:**
- `SessionHeader` (`type: "session"`): never becomes a transcript row. It seeds the initial header chrome only.
- `ModelChangeEntry`, `ThinkingLevelChangeEntry`, and `ServiceTierChangeEntry`:
  - during initial file load, update header state silently before first render
  - during follow mode after the header has already been printed, emit one compact `notice` row per persisted change, in order, instead of trying to redraw the header
- `SessionMessageEntry` with `message.role === "user"`: emit one `user` row using the persisted content blocks in order
- `SessionMessageEntry` with `message.role === "assistant"`:
  - `text` blocks become assistant body content
  - `thinking` blocks stay inside the same assistant row as subcontent
  - `toolCall` blocks emit generic `tool` call rows keyed by `toolCall.id`
  - if one assistant message contains both text and tool calls, emit the assistant row and the tool row(s) in the same persisted order; do not drop either shape
- `SessionMessageEntry` with `message.role === "toolResult"`: look up any stored tool-call metadata by `toolCallId`, then emit a later generic `tool` result row in the order the result was persisted; do not perform cursor movement or in-place row mutation to edit an earlier tool-call row
- If a `toolResult` arrives without a matching prior `toolCall`, emit a `notice` row that truthfully says an unmatched tool result was encountered rather than fabricating a fake call
- Other persisted message roles or non-chat session entries (for example custom/session-maintenance material the viewer does not have a first-class row for): render as `notice` rows, not as fake user/assistant chat

This mapping belongs in one place, ideally `src/normalize.ts`. Do not spread row-classification logic across the CLI, file follower, and renderer.

**Follow-mode boundary:** follow mode updates only when complete JSONL lines are appended. Partial lines remain buffered until newline.

**Alternatives considered:**
- Reconstruct session state through `SessionManager`: rejected because it adds startup weight and viewer/runtime coupling with little benefit.

### 3) Use append-only terminal output; kitty owns scrollback

**Decision:** The viewer writes normal terminal output and does not run in an alternate screen or implement custom scrollback/autoscroll behavior.

**Why:** This matches the launch reality and aligns with kitty's documented screen model: kitty's own scroll controls operate on the main screen, while alternate-screen programs receive those key events themselves. Using ordinary output therefore keeps the viewer compatible with kitty's native scrollback instead of competing with it.

**Implications:**
- Snapshot mode prints the full current view once.
- Follow mode prints the current snapshot, then only newly normalized rows.
- The header is printed once at startup; later metadata changes in follow mode are emitted as compact `notice` rows instead of trying to rewrite the original header.

**What not to do:**
- Do not re-read the whole file on every follow tick and re-render the entire transcript; that breaks scrollback expectations and makes duplicate output likely.
- Do not switch to alternate-screen APIs to simulate a fullscreen app; this change explicitly relies on ordinary terminal output.

**Alternatives considered:**
- Full interactive TUI with custom scroll model: rejected because it duplicates kitty behavior and raises complexity for little value in this demo-oriented tool.

### 4) Reuse OMP’s visual system narrowly

**Decision:** Reuse OMP theme/bootstrap helpers and selected message widgets, but do not wholesale embed all coding-agent render components.

**Reuse boundary:**
- Reuse:
  - Rose Pine theme bootstrap / semantic tokens
  - status-line formatting helper(s)
  - lightweight message widgets where they render truthfully in a non-interactive context
- Do not reuse:
  - tool registry
  - tool renderer registry
  - interactive expand/collapse components
  - coding-agent session runtime


**Why:** The viewer must strongly resemble OMP, but it should not inherit interactive behaviors that do not exist in this tool. The experiment showed `ToolExecutionComponent` is technically reusable, but it also carries interactive affordances and heavier coupling than we want here.

**Viewer-specific rendering choice:**
- Build one viewer-owned generic tool row using `pi-tui` primitives plus shared theme/status helpers.
- Avoid per-tool widgets entirely.

**What the shared status-line helper is for in this viewer:**
- Use `packages/coding-agent/src/tui/status-line.ts` to render the one-line viewer header and the first line of each generic tool call/result row.
- Do not confuse this with OMP's interactive bottom status bar. In this viewer, the helper is only a formatting function for short titles, icons, and muted metadata on append-only lines.

**Import discipline for a junior implementer:**
- It is acceptable for the new package to import shared theme/components through `@oh-my-pi/pi-coding-agent` exports that already exist in `packages/coding-agent/src/index.ts`.
- It is not acceptable for the viewer to reach into interactive-mode controllers, tool registries, or session-runtime classes just because they already know how to paint something on screen.
- If a needed helper is not exported cleanly, prefer adding one narrow export over importing a large internal subsystem.

**Alternatives considered:**
- Rebuild the look from scratch: rejected because it increases visual drift.
- Reuse `ToolExecutionComponent` directly: rejected for v1 because it brings extra coupling and interactive hints that do not fit an append-only viewer.

### 5) Keep the transcript grammar intentionally small

**Decision:** The viewer recognizes a small number of display shapes and refuses to special-case tools.

**Transcript grammar:**
- **Header chrome:** session file label, cwd, latest model/thinking state known at startup, follow/static indicator
- **User row:** user message content
- **Assistant row:** assistant text + thinking subcontent
- **Tool row:** single generic presentation reused for both tool-call rows and later tool-result rows
- **Notice row:** metadata changes and unusual non-chat events that should still be visible during follow mode

**Render contract by visible element:**

1. **Header chrome**
   - Shows once at startup only.
   - Must show:
     - line 1: the CLI-provided agent label as the primary identity, plus mode/model/thinking when those fields are available
     - line 2: current working directory when available from the session header, plus a concise session/file label derived from the basename when available
   - Must not show:
     - later follow-mode metadata changes by rewriting the header
     - tool content
     - image fallback text
   - Missing header fields are omitted entirely. Do not render placeholders such as `unknown`, `n/a`, or `-`.

2. **User row**
   - Shows persisted user message content in order.
   - Must show:
     - user text content
     - any persisted user image content when bytes are available
     - truthful textual fallback when a referenced user image cannot be loaded
   - Wrapping rules:
     - use proper word wrapping for user text rather than hard clipping or character-by-character truncation
   - Must not show:
     - assistant thinking
     - tool status lines

3. **Assistant row**
   - Shows only assistant-authored content that is not a tool call.
   - Must show:
     - assistant text blocks in persisted order
     - assistant thinking blocks as dimmer assistant subcontent in the same row/block
   - Wrapping rules:
     - use proper word wrapping for assistant text/thinking rather than hard clipping or character-by-character truncation
   - Must not show:
     - tool-call status lines inside the assistant row
     - tool-result output inside the assistant row

4. **Tool-call row**
   - Uses the generic tool presentation.
   - Must show:
     - a status/title line using the shared status-line visual language
     - tool name
     - call-state icon/styling appropriate for a call that has been observed but whose result has not yet been rendered in that row
     - a compact args preview derived from persisted tool-call arguments
   - Layout guidance:
     - line 1: status icon + tool name
     - line 2: one dim args line when arguments exist
     - no additional body lines in v1 unless the shared status-line helper itself adds muted metadata inline
   - Args preview rules:
     - preserve argument field names
     - keep the args rendering as one logical line of content rather than an expanded argument tree
     - do not truncate argument content in this change; if the terminal wraps, that is acceptable
     - if there are no arguments, omit the args-preview line entirely
     - use the same ANSI-aware word-wrapping path already used by OMP text/markdown components (`wrapTextWithAnsi` via `@oh-my-pi/pi-tui` / `@oh-my-pi/pi-natives`) instead of introducing a new wrapping dependency or custom wrapper
   - Must not show:
     - result body text
     - later result images
     - per-tool custom widget layouts
     - expanded argument trees in this change

5. **Tool-result row**
   - Uses the same generic tool presentation family as the tool-call row, but appears later in append-only order.
   - Must show:
     - the tool name again, using the generic status/title treatment
     - final success/error styling derived from the persisted tool result
     - result body text when text output exists
     - JSON/tree-like output formatting when the persisted text output is structured JSON
     - result images when bytes are available after session-load resolution
     - truthful textual fallback when result images cannot be loaded
   - Layout guidance:
     - line 1: success/error icon + tool name
     - following lines: result body
     - trailing content: rendered images or textual image fallback when present
   - Result body rules:
     - plain-text output should render in full rather than as a collapsed preview
     - structured JSON text should render structurally rather than raw minified JSON
     - do not truncate result content in this change
     - if the tool produced no text output, render a dim `(no output)` marker
     - wrap long result text with the existing ANSI-aware word-wrapping path already used in OMP (`wrapTextWithAnsi`)
   - May show:
     - a compact call-summary hint reused from stored call metadata
   - Must not:
     - mutate the earlier tool-call row
     - depend on cursor movement or repaint
      - repeat the full original args preview by default

**Shared constraints for tool-call and tool-result rows:**
- They must look like the same visual family as OMP's generic tool blocks even though the viewer emits them as separate append-only rows.
- Tool names must use the persisted tool name as-is; do not prettify or alias them.
- The viewer must not create per-tool layouts for `read`, `generate_image`, or any other tool in this change.
- Images belong in result rows (or ordinary message rows), not in tool-call rows.
- Result rows are allowed to be multiline. Call rows should stay compact.
- Do not truncate tool-call arguments or tool-result content in this change. Ordinary terminal wrapping is acceptable.
- Do not add a new wrapping dependency for this viewer. Reuse the existing workspace wrapping path.

6. **Notice row**
   - Shows truthful fallback information for persisted events that do not fit the main row shapes.
   - Must show things like:
     - follow-mode model/thinking/service-tier changes after the header has already been printed
     - unmatched tool results
     - unsupported persisted entry/message shapes
   - Must be visibly distinct from ordinary user/assistant rows so it is clear this is system/viewer fallback material.

7. **Image fallback text**
   - This is not its own transcript row kind. It is content rendered inside a user row, tool-result row, or notice row, depending on where the missing image was referenced.
   - "Truthful textual fallback" means the text must say that the image is missing, unavailable, or could not be loaded.
   - The fallback should include the most useful real identifier that still exists, such as a surviving file path or mime type.
   - Example acceptable fallbacks:
     - `[image missing: /tmp/omp-image-123.png]`
     - `[image unavailable: blob data missing]`
     - `[image could not be loaded: image/png]`
   - Example unacceptable fallbacks:
     - `[image]`
     - blank space
     - fake placeholder art
     - wording that implies the image rendered successfully when it did not
   - Must not throw, abort follow mode, or hide the surrounding transcript content.

**Why:** The user explicitly wants a generic tool presentation, and a small row taxonomy keeps the viewer honest and maintainable.

**Alternatives considered:**
- Separate thinking rows or per-tool widgets: rejected as unnecessary complexity.

### 6) Follow mode is opt-in and simple

**Decision:** The CLI defaults to static snapshot mode. `-f` / `--follow` enables tailing.

**Why:** Principle of least surprise. Opening a file normally should behave like inspecting a file; continuous follow is an explicit choice.

**Follow implementation:**
- Record the byte offset after initial load.
- Poll for file growth and read appended bytes.
- Split completed lines, buffer any incomplete trailing fragment, and parse only new JSONL entries.
- Emit only newly normalized rows.

**Mechanical sequence:**
1. Open the file and read the current contents once.
2. Parse complete JSONL lines into entries.
3. Normalize those entries into initial header state plus initial rows.
4. Render the header once, then render the initial rows once.
5. If follow mode is off, exit here.
6. If follow mode is on, remember the byte offset at the end of the successfully processed bytes.
7. On each follow tick/watch event, read only bytes after that offset.
8. Prepend any buffered partial line from the previous tick.
9. Parse only newline-terminated lines; keep a non-terminated tail in the buffer.
10. Normalize only those newly completed entries and append only their newly derived rows.


The key invariant is "one persisted line is processed at most once." Design around that invariant so duplicate rows are impossible unless the file itself contains duplicate entries.

**Failure model for follow mode:**
- This viewer assumes the followed file remains the same append-only JSONL file for the lifetime of the process.
- This change does not attempt to be robust to operator interference, file rotation, truncation, replacement, or malformed appended data.
- When any of the conditions below occur, the correct behavior is to stop following, print a truthful failure message, and exit non-zero rather than trying to recover:
  - the file does not exist or cannot be opened at startup
  - the file disappears while follow mode is active
  - the file shrinks or truncates after the initial offset has been established
  - the file at the path is replaced or otherwise stops behaving like the same append-only stream
  - appended content is malformed JSONL
- Do not restart from byte 0 automatically.
- Do not silently skip malformed appended entries.
- Do not add path-reopen or rotation-recovery behavior similar to hardened log-tail tools in this change.

**Runtime note:** If implementation uses Bun's `node:fs` compatibility layer for file watching, Bun documents `fs.watchFile()` as polling with a configurable interval and recommends `fs.watch()` when possible. This proposal therefore specifies append-follow semantics only, not any stronger guarantee about the underlying watcher primitive or instant delivery. Docs: https://bun.com/reference/node/fs/watchFile and https://bun.com/reference/node/fs/watch

**Alternatives considered:**
- Follow by default: rejected by explicit product decision.
- Complex filesystem watch graph: rejected for v1 in favor of simple local-file polling.

### 7) Externalize `generate_image` payloads at the persistence seam

**Decision:** Extend coding-agent session persistence so persisted `generate_image` image bytes are always moved out of the JSONL file and replaced with blob references.

**Write-side behavior:**
- Externalize `toolResult.details.images[*].data` when present.
- Externalize `assistant.content[].toolCall.arguments.input[*].data` when present and non-empty.
- Leave `input[*].path` untouched.

**Read-side behavior:**
- Resolve those blob references back into the in-memory message shape when loading/restoring session entries.

**Concrete hook points already present in repo:**
- Write side: `prepareEntryForPersistence()` in `packages/coding-agent/src/session/session-manager.ts` is the existing seam that already externalizes display payloads before JSONL write.
- Read side: `resolveBlobRefsInEntries()` in that same file already walks loaded entries and resolves blob-backed payloads before callers consume them.
- Blob utilities: `packages/coding-agent/src/session/blob-store.ts` already provides `externalizeImageData()`, `resolveImageData()`, and blob-ref detection.
- Existing general threshold behavior: `packages/coding-agent/src/session/session-manager.ts` currently uses `BLOB_EXTERNALIZE_THRESHOLD = DEFAULT_IMAGE_EXTERNALIZE_THRESHOLD`, and `packages/coding-agent/src/tools/display/persistence.ts` uses the same thresholded pattern for display draw intents.

**Boundary to preserve:**
- Do not move this logic into `packages/coding-agent/src/tools/gemini-image.ts`; that tool should keep returning its current in-memory details shape.
- Do not add viewer-only blob resolution code. Session loading should continue to hand consumers resolved in-memory messages.
- Do not broaden this into a generic "externalize every large string everywhere" refactor. This change is specifically about `generate_image` input/result image bytes.

**Why:** This solves the actual viewer performance problem without expanding the persistence contract into a temp-file archival system.

**Alternatives considered:**
- Archive path-backed input files into session storage: rejected by explicit product priority.
- Keep the existing thresholded behavior (`DEFAULT_IMAGE_EXTERNALIZE_THRESHOLD`, currently 1024 base64 characters) for `generate_image` bytes: rejected because the agreed behavior for this change is simpler and stricter — always externalize `generate_image` image bytes instead of making them threshold-dependent.
- Leave `generate_image` inline blobs untouched: rejected because it keeps large session files slow to parse.

### 8) Render images when available and degrade safely when missing

**Decision:** The viewer should render images in kitty when the session entry already contains usable image bytes, and it should degrade truthfully when those bytes or referenced files are missing.

**Why:** This is a kitty-only viewer, and images are part of the transcript truth. At the same time, missing images are expected because many paths point into `/tmp` and may disappear before the viewer opens them.

**Image rendering rules:**
- Use the kitty-capable image path already provided by `@oh-my-pi/pi-tui` / shared image components; do not add separate terminal backends for other terminals in this change.
- Render persisted message image blocks when loaded session entries already include image bytes.
- Render `generate_image` result images from `details.images` when those bytes are available after session-load blob resolution.
- For path-backed image references such as `/tmp/...` paths, implementation should attempt to load and render the file if it still exists, but missing files are an expected condition, not an error path.
- When an image cannot be loaded or resolved, keep the transcript truthful by rendering a textual fallback (for example the file path or an image placeholder line) instead of throwing, aborting follow mode, or printing a stack trace.

**Boundary to preserve:**
- This remains kitty-only. Do not add cross-terminal image support branches, alternate terminal protocols, or a generalized compatibility layer.

### 9) Full test coverage is required

**Decision:** Treat this as a fully tested feature, not a smoke-tested demo.

**Minimum test surface:**
- CLI argument parsing for file path + `-f` / `--follow`
- Initial snapshot normalization and rendering
- Tool-call rows and later tool-result rows without in-place rewrite
- Metadata change handling before first render vs after first render
- Follow-mode byte-offset tracking and incomplete-line buffering
- Image rendering when bytes are available
- Truthful fallback behavior when image bytes or referenced files are missing
- `generate_image` persistence externalization and restore behavior

**Why:** This change crosses package boundaries, persistence seams, and kitty-specific rendering behavior. Partial test coverage would make regressions very easy to ship.


## Risks / Trade-offs

- **[Workspace dependency breadth]** Depending on `@oh-my-pi/pi-coding-agent` may pull in more transitive surface than ideal.  
  **Mitigation:** keep imports intentionally narrow (theme/status/simple widgets only) and avoid runtime/session/provider modules.

- **[Append-only output limits live chrome updates]** A normal terminal app cannot rewrite an earlier header without changing the output model.  
  **Mitigation:** print initial chrome once and surface later metadata changes as notice rows.

- **[Polling follow mode is less elegant than watch-based updates]** Polling can be slightly noisier or less immediate.  
  **Mitigation:** keep the interval short and implementation simple; use `fs.watch()` when it is sufficient, and fall back to polling semantics only when needed.

- **[Viewer/tool visual drift over time]** Reused theme helpers may stay aligned while viewer-owned generic tool rows drift.  
  **Mitigation:** build the tool row from shared semantic theme tokens and status-line helpers, not copied literal colors.

- **[Blob externalization touches coding-agent persistence]** A viewer-motivated change still modifies core session persistence code.  
  **Mitigation:** keep the hook narrowly scoped to `generate_image` and implement it as a small dedicated persistence path instead of a generic session-wide abstraction.

- **[Missing /tmp image paths are normal]** Some image references, especially generated temp files, may be gone by the time the viewer opens.  
  **Mitigation:** treat missing images as an expected fallback case and keep rendering the rest of the transcript.


## Migration Plan

1. Scaffold `packages/agent-session-viewer/` with package metadata, CLI entrypoint, and narrow workspace dependencies.
2. Add viewer-local row/state types plus normalization from parsed JSONL entries to header state + transcript rows. Get snapshot-mode tests passing before any follow logic.
3. Add rendering on ordinary terminal output using shared theme/status helpers and a viewer-owned generic tool row. Keep this append-only from the start so follow mode can reuse it.
4. Add append-follow support behind `-f` / `--follow`, reusing the same normalization and rendering path as snapshot mode for newly appended entries only.
5. Add image rendering in the viewer for available image bytes plus truthful textual fallback for missing image data or missing `/tmp` files.
6. Add `generate_image` persistence externalization and restore hooks in coding-agent session handling.
7. Build the full test suite before handoff, then verify with real session files: one ordinary sub-agent session for transcript/follow behavior and one `generate_image` session for blob externalization/resolution.

This order matters: if the team implements follow mode before normalization is stable, they will debug duplicate/missing rows in two places at once.

## Open Questions

- None blocking implementation.
