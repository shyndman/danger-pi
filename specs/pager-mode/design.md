## Context

`packages/coding-agent/src/danger-pi/` is the right home for this feature because pager mode is fork-specific and the user does not want a new upstream-style runtime seam for assistant-message rewriting. The current extension system already provides the pieces pager mode needs: assistant-message observation, slash-command registration, custom-message rendering, keyed status updates, and branch-aware session history reads. What it does not provide is a built-in way to keep a workflow cursor stable across rewind, branch changes, and session resume when the workflow state lives only in memory.

The assistant-side protocol is intentionally small. The assistant emits a visible index page containing `<pager-index title="...">` plus an ordered Markdown list of page titles. The user then drives progression with `/pager:next` and `/pager:exit`. Pager mode must keep the transcript readable for the user, keep the LLM aware of page transitions, and keep the TUI synchronized even when the active session leaf moves backward or onto another branch.

The status UI decision is also intentionally narrow. Keyed status is the required surface, because it already fits the single-line state the user wants: `[0/{n}] {title}: Index` and `[{i}/{n}] {page_title}`. Widget support may still be useful for experimentation, but it is not required to make pager mode function. Footer support is not part of this design because the current extension footer APIs are effectively stubs in interactive mode.

### Current APIs and behaviors this design relies on

#### Built-in extension loading

- `ExtensionFactory` is `type ExtensionFactory = (pi: ExtensionAPI) => Promise<void> | void`.
- `createAgentSession()` in `packages/coding-agent/src/sdk.ts` builds `inlineExtensions: ExtensionFactory[]`, appends fork-owned built-ins, and loads each with `loadExtensionFromFactory(...)`.
- Interactive sessions do **not** use `initializeExtensions(...)`; they initialize the runner inside `ExtensionUiController.initHooksAndCustomTools()`, then emit `session_start` there.
- Print and RPC modes use `initializeExtensions(session, options)` from `packages/coding-agent/src/modes/runtime-init.ts`, which wires standard actions, installs the UI context, registers the runtime error hook, and emits `session_start`.

That means pager mode should be wired as an inline extension factory in `sdk.ts`, and its `session_start` assumptions must hold across both initialization paths.

#### Extension events and command surfaces

- Event handlers are `ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void`.
- Pager mode relies on these events:
  - `session_start: { type: "session_start" }`
  - `session_switch: { type: "session_switch"; reason: "new" | "resume" | "fork"; previousSessionFile: string | undefined }`
  - `session_branch: { type: "session_branch"; previousSessionFile: string | undefined }`
  - `session_tree: { type: "session_tree"; newLeafId: string | null; oldLeafId: string | null; summaryEntry?: BranchSummaryEntry }`
  - `message_update: { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }`
  - `message_end: { type: "message_end"; message: AgentMessage }`
- `registerCommand(name, options)` takes `options.handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>`.
- `ExtensionCommandContext` adds the session-control methods pager mode may need for future workflows: `waitForIdle()`, `newSession(...)`, `branch(entryId)`, `navigateTree(targetId, options?)`, `switchSession(sessionPath)`, and `reload()`.

Pager mode only needs to register `/pager:next` and `/pager:exit` today, but session-tree hooks are the exact seam that makes rewind detection work; `session_switch` / `session_branch` alone are not enough for same-file leaf navigation.

#### Session-history inspection

- `ctx.sessionManager` is `ReadonlySessionManager`.
- The relevant read APIs are:
  - `getLeafId(): string | null`
  - `getLeafEntry(): SessionEntry | undefined`
  - `getBranch(fromId?: string): SessionEntry[]`
  - `getEntries(): SessionEntry[]`
  - `getTree(): SessionTreeNode[]`

Pager reconstruction should use `getBranch()` against the active leaf and treat `session_tree` as the authoritative signal that the active leaf changed within the same session file.

#### Custom-message protocol surfaces

- `sendMessage<T>(message, options?)` takes:

```typescript
message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details" | "attribution">
options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" }
```

- `appendEntry<T>(customType: string, data?: T)` persists hidden `custom` entries and does **not** reach LLM context.
- `custom_message` entries do participate in LLM context; `convertToLlm()` turns them into provider-facing user messages.
- `display: true` is required for the transcript-visible `pager-next` / `pager-exit` entries. Hidden custom messages would still reach the model but would not keep user history readable.
- `sendMessage(..., { triggerTurn: true })` can start a new assistant turn; `deliverAs: "nextTurn"` is the only mode that queues hidden next-turn context instead of immediately steering/following up.

Pager mode should therefore use visible `custom_message` entries for `pager-next` / `pager-exit`, not hidden `custom` entries.

#### Custom-message rendering

- `registerMessageRenderer<T>(customType, renderer)` takes:

```typescript
renderer: (message: CustomMessage<T>, options: { expanded: boolean }, theme: Theme) => Component | undefined
```

- Renderer lookup is exact-string by `customType`.
- Only visible custom messages are run through this pipeline.
- Returning `undefined` falls back to the default framed markdown custom-message renderer.

Pager mode should register exact renderers for `pager-next` and `pager-exit` and treat them as presentation only. Reconstruction must ignore renderer output.

#### UI context actually available to extensions

- `setStatus(key, text)` and `setWidget(key, content, options?)` live on `ctx.ui`, not on the top-level `ExtensionAPI`.
- `setStatus` writes to the separate hook-status line below the editor border. It sorts by key, sanitizes text, joins statuses with spaces, and truncates the final line to width. Clearing requires `undefined`; empty string is still a stored status.
- Hook-status visibility is gated by the global `statusLine.showHookStatus` setting.
- `setWidget` is supported in interactive mode for `string[] | ExtensionUiComponentFactory | undefined`, keyed by widget id, with placement `aboveEditor` or `belowEditor`; string-array widgets are truncated to 10 lines.
- `setFooter` and `setHeader` are no-ops in interactive mode and RPC mode.
- `setWorkingMessage(message?)` works in interactive mode and is a no-op in RPC mode.
- `setTheme(themeArg)` only accepts string theme names in interactive mode; direct `Theme` objects are rejected.

Pager mode requires keyed status only. Widget support can be added later as an optional second view over the same reconstructed state.

#### Tag semantics for LLM-facing pager control text

- Tags are prompt-level structural markers, not runtime-validated enums.
- `system-reminder` is the established tag family in runtime-generated prompt text.
- `system-notice` exists today in the shipped async-result prompt template but is far less established.

Pager mode is intentionally choosing `system-notice` for semantic fit, with the understanding that this is a prompt/text convention rather than a runtime primitive.

## Goals / Non-Goals

**Goals:**
- Implement pager mode as a fork-owned built-in extension under `packages/coding-agent/src/danger-pi/`.
- Parse assistant-emitted `<pager-index>` pages and treat them as the source of truth for workflow title and ordered page titles.
- Add `/pager:next` and `/pager:exit` commands that are visible in transcript history as specially rendered custom messages rather than raw slash-command text.
- Keep the LLM aware of pager state transitions by sending model-visible custom messages for `next` and `exit`.
- Reconstruct pager state from the active branch so rewind, branching, and resume all land on the correct page without hidden duplicate state.
- Update keyed status immediately when `/pager:next` is invoked, before the next assistant page arrives.
- Treat `/pager:next` on the final page exactly like `/pager:exit`.

**Non-Goals:**
- Adding a new assistant-message rewrite, suppression, or replacement seam in the fork.
- Replacing the assistant's index page with a custom-rendered surrogate.
- Introducing hidden parallel pager state entries unless a concrete need appears later.
- Depending on footer APIs for pager UI.
- Defining a richer pager authoring language beyond one index tag with an ordered list.

## Decisions

### 1. Pager mode is a built-in fork extension, not a new runtime subsystem

Implementation should live mostly in a fork-owned extension module under `packages/coding-agent/src/danger-pi/`, loaded as an inline `ExtensionFactory` from `createAgentSession()` in `sdk.ts`. The extension owns command registration, assistant-message observation, pager-state reconstruction, status updates, and custom-message rendering. Shared runtime code should only grow the thin hooks required to let the extension observe session changes and render the right transcript entries.

Exact load/init path to rely on:
- session creation loads the extension factory through `loadExtensionFromFactory(...)`
- interactive mode initializes the runner in `ExtensionUiController.initHooksAndCustomTools()` and emits `session_start`
- print and RPC modes initialize the runner through `initializeExtensions(...)` and also emit `session_start`

Why this over a deeper session/runtime feature?
- The user explicitly wants the first version implemented as an extension.
- Existing extension primitives already cover the behavior.
- Keeping logic in `danger-pi/` minimizes fork surface.

Alternative considered: add a dedicated pager subsystem to session/runtime layers. Rejected because it adds fork-only infrastructure before the extension model has been exhausted.

### 2. The assistant's visible index page is the only data-bearing pager node

The assistant emits a normal assistant message containing the pager index page. Pager mode parses `<pager-index>` from that message, extracts the workflow title plus ordered Markdown list items, and treats that parsed result as the source of truth for page metadata. The assistant message remains a normal transcript entry; pager mode does not replace or suppress it.

Expected assistant-side shape:

```xml
<pager-index title="Pebble v3 Tuning">
1. High-Pass Filtering (Protecting Tiny Drivers)
2. Equalizer Adjustments (Balancing Mids and Treble)
3. Bass Enhancer (Psychoacoustic Harmonics)
4. Limiter & Gain (Preventing Clipping and Normalizing Volume)
</pager-index>
```

The parser should:
- locate the nearest `<pager-index ...>` block in the message content
- read the `title` attribute
- parse the enclosed ordered Markdown list into page titles in order
- ignore malformed or incomplete pager-index payloads instead of activating pager mode

Why this over storing a parallel hidden `pager-index` state entry?
- The user wants the index page itself to remain important, visible transcript content.
- The fork should not duplicate state until a concrete failure requires it.
- The active transcript already provides the durable session-backed source of truth.

Alternative considered: parse the assistant message once and immediately mirror it into hidden `custom` state. Rejected because it duplicates information the transcript already preserves.

### 3. Pager transitions are visible custom messages, not hidden state-only events

`/pager:next` and `/pager:exit` must create visible `custom_message` transcript entries with special rendering. This keeps history legible for the user and keeps the LLM aware of pager transitions, since custom messages participate in LLM context while hidden `custom` entries do not.

The user-facing renderers should present:

```text
Paging Next:

{current title} -> {next title}
```

```text
Paging Exit:

Now leaving {workflow title}
```

The LLM-facing payload should use `system-notice`, not `system-reminder`, because these events are authoritative notices rather than reminders. Canonical payloads:

```xml
<system-notice>
<pager-next workflow="Pebble v3 Tuning" page="1" page-count="4">
Pager state advanced.
Previous: Index
Current: High-Pass Filtering (Protecting Tiny Drivers)
Next: Equalizer Adjustments (Balancing Mids and Treble)

Write the current page now.
</pager-next>
</system-notice>
```

```xml
<system-notice>
<pager-exit workflow="Pebble v3 Tuning">
Pager mode closed.
</pager-exit>
</system-notice>
```

Reconstruction must ignore the text payload and rely only on message type and order. The payload exists for the LLM and user, not as state storage.

Why this over hidden custom entries only?
- The LLM must be able to see pager transitions in order.
- The user wants transcript history to remain understandable without invisible state.
- The existing custom-message system already supports special rendering.

Alternative considered: raw `/pager:next` and `/pager:exit` transcript lines. Rejected because the user asked for a cleaner special representation.

### 4. Pager state is reconstructed by walking backward on the active branch

Pager mode should never trust a long-lived in-memory cursor. Instead, it reconstructs current pager state from the active branch whenever the relevant session position changes.

The exact inspection seam is `ctx.sessionManager.getBranch()` plus the active-leaf notifications exposed by extension events. For same-file rewind/history navigation, pager mode must refresh from `session_tree`; `session_switch` and `session_branch` only cover session-file changes and explicit branching workflows.

Algorithm:

```python
advance_count = 0

for entry in walk_backward_from_current_leaf():
    if is_pager_exit(entry):
        return None

    if is_pager_next(entry):
        advance_count += 1
        continue

    if is_pager_index_assistant_message(entry):
        title, pages = parse_index(entry)
        page_count = len(pages)

        if advance_count == 0:
            return {"mode": "index", "title": title, "pages": pages}

        if 1 <= advance_count <= page_count:
            return {
                "mode": "page",
                "title": title,
                "pages": pages,
                "page_ordinal": advance_count,
                "page_title": pages[advance_count - 1],
            }

        return None

return None
```

Rules locked during discussion:
- walk backward from the current session leaf on the active branch
- the nearest `pager-exit` closes pager mode immediately
- the nearest assistant index page is the terminal source-of-truth node for any open pager
- reconstruction depends on `pager-next` / `pager-exit` type order only, not their stored titles
- `pager-next` on the final page behaves exactly like exit
- stray `pager-next` or `pager-exit` messages outside an active pager are ignored

Why this over forward replay from root or persisting explicit current-page state?
- Backward walk is smaller and naturally branch-local.
- The nearest index page makes older pager history irrelevant.
- It avoids duplicate state and keeps branch rewinds honest.

Alternative considered: mirror current pager state into hidden extension-owned state and refresh it incrementally. Rejected because it breaks on history navigation and branching.

### 5. Keyed status is the required live UI, updated from reconstructed state

Pager mode should always derive its keyed status string from the reconstructed pager state. Required formats:
- index page: `[0/{n}] {title}: Index`
- active content page: `[{i}/{n}] {page_title}`

Status updates should happen:
- after parsing a newly seen assistant index page
- immediately when `/pager:next` succeeds, before the assistant writes the next page
- when `/pager:exit` succeeds
- whenever the active branch/leaf changes in a way that alters reconstructed pager state, including `session_tree` rewinds inside the current session file

When no active pager state exists, pager mode clears its keyed status.

Widget support is explicitly optional. If later added, it should remain a view over the same reconstructed pager state, not a separate state carrier.

Why this over widget-first UI?
- The user's minimum viable experience is a single-line paging cursor.
- Keyed status already fits the desired text exactly.
- Widget semantics are useful for exploration but not required for pager correctness.

Alternative considered: relying on footer UI. Rejected because the current footer extension APIs are not reliable enough in interactive mode.

### 6. `/pager:next` both records the transition and triggers the next page turn

When the user runs `/pager:next`, the extension should:
1. reconstruct current pager state
2. if there is no active pager, do nothing user-visible beyond a normal command error/notice path
3. if the current page is the last page, emit `pager-exit` instead and clear status
4. otherwise emit the visible `pager-next` custom message with `display: true`
5. update keyed status immediately to the target page
6. trigger the assistant turn that writes the current page by calling `sendMessage(..., { triggerTurn: true })`, using the `pager-next` custom message payload as the model-visible control text

`/pager:exit` should:
1. reconstruct current pager state
2. if no pager is active, no-op or surface a lightweight notice
3. emit the visible `pager-exit` custom message with `display: true`
4. clear keyed status
5. not trigger a follow-up assistant turn

Why this ordering?
- The UI should reflect the user's action immediately.
- The transcript should record the page advance even if the next assistant turn is interrupted.
- Reconstruction should land on the advanced page because the event is already present.

Alternative considered: wait to update status until the assistant writes the next page. Rejected because it makes the UI lag the user's explicit action.

## Risks / Trade-offs

- [Assistant emits malformed index markup] → Ignore the malformed block, leave pager inactive, and surface no fork-only recovery magic in the first version.
- [The assistant ignores `pager-next` instructions and writes the wrong page] → Keep the protocol messages explicit and inspect real-world behavior before adding stronger guidance.
- [Session navigation hooks are incomplete, leaving stale status after branch changes] → Centralize reconstruction + render into one refresh helper and invoke it from `session_start`, `session_switch`, `session_branch`, `session_tree`, `message_end`, and command-driven updates.
- [Visible pager control messages add transcript noise] → Keep the renderer compact and purpose-built so the history remains legible rather than noisy.
- [Index parsing from assistant text becomes brittle if authoring drifts] → Keep the accepted format narrow and make the assistant skill responsible for emitting consistent ordered-list index pages.
- [Status-only UI may feel too minimal once users start using the workflow heavily] → Treat widget support as an additive follow-up that reads the same reconstructed state.

## Migration Plan

- Add the pager extension as a built-in fork-loaded extension in the same inline-extension path already used by other fork-owned features.
- Keep the feature self-contained under `packages/coding-agent/src/danger-pi/`, with only thin hooks in shared loading/rendering paths.
- Rollback is straightforward: remove the built-in extension wiring and pager-specific renderers/commands. Because pager mode does not introduce a new persisted hidden state format, historical sessions remain readable even after rollback.

## Open Questions

- None. The current feature shape, pager protocol, reconstruction algorithm, and control-message semantics were locked during discussion.
