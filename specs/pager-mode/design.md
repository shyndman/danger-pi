## Context

`packages/coding-agent/src/danger-pi/` remains the right home for pager mode because the feature is fork-specific and should not require a new upstream assistant-message rendering seam. The extension system already provides the pieces pager mode needs: tool registration, slash-command registration, shortcut registration, custom-message rendering, keyed status updates, and branch-aware session history reads.

Pager state starts from a real `pager_index` tool call, which gives the assistant an explicit structured step up front and keeps pager presentation on tool/custom-message surfaces.

Keyed status is still the required live UI surface. It already fits the single-line cursor the user wants: `[0/{n}] {title}: Index` and `[{i}/{n}] {page_title}`.

## Current APIs and behaviors this design relies on

### Built-in extension loading

- `createAgentSession()` appends `createPagerModeExtension` as an inline extension factory in `sdk.ts`.
- Interactive sessions initialize the extension runner and emit `session_start` after wiring runtime actions and UI context.
- Print/RPC modes initialize the same runner through the shared runtime-init path.

Pager mode therefore needs to work as a self-contained inline extension with no special runtime boot path.

### Extension surfaces pager mode uses

- `registerTool(...)` for the `pager_index` tool.
- `registerCommand(...)` for `/pager:next` and `/pager:exit`.
- `registerShortcut(...)` for `Ctrl+J`.
- `registerMessageRenderer(...)` for `pager-next` and `pager-exit` custom messages.
- `sendMessage(..., { triggerTurn?, deliverAs? })` for transcript-visible and hidden pager control messages.
- `appendEntry(...)` for durable pager index state that does not enter LLM context.
- `setStatus(key, text)` for the persistent pager cursor near the status line.

### Session-history inspection

- Pager reconstruction reads `ctx.sessionManager.getBranch()` from the active leaf.
- Hidden pager index state is stored as a `custom` entry.
- Visible `pager-next` / `pager-exit` transitions are stored as `custom_message` entries.
- `session_start`, `session_switch`, `session_branch`, and `session_tree` are the refresh hooks for branch-aware reconstruction.

## Goals / Non-Goals

**Goals:**
- Keep pager mode implemented as a fork-owned built-in extension under `packages/coding-agent/src/danger-pi/`.
- Make `pager_index` the source of truth for the pager title and ordered page titles.
- Render a minimal inline index control through the tool-rendering path.
- Auto-advance silently to page 1 after a successful `pager_index` call.
- Keep `/pager:next` and `/pager:exit` as visible custom-message transcript entries.
- Keep keyed status derived from reconstructed pager state.
- Treat `Ctrl+J` exactly like an idle `/pager:next`.
- Treat `/pager:next` on the final page exactly like `/pager:exit`.

**Non-Goals:**
- Adding Markdown-layer or assistant-message special handling for pager tags.
- Supporting multiple pager index protocols in parallel.
- Introducing a new pager-specific runtime subsystem outside the extension system.
- Replacing the existing keyed status surface.

## Decisions

### 1. The assistant defines pager structure with a real tool

The assistant now starts a pager sequence by calling:

```text
pager_index({ title, pages })
```

The tool is the only source of truth for:
- pager title
- ordered page titles
- initial page count

Why this over parsing assistant text?
- avoids raw tag rendering entirely
- keeps pager structure explicit and typed
- uses the existing tool UI path instead of creating a new assistant-message seam

### 2. Pager state is durable hidden data plus visible transitions

Pager mode stores the index definition in a hidden `custom` entry, then reconstructs the current page by walking backward over the active branch and counting visible `pager-next` / `pager-exit` control messages.

The split is intentional:
- hidden `custom` entry stores durable structure (`title`, `pages`)
- visible `custom_message` entries preserve transcript/LLM-visible transitions

### 3. Successful `pager_index` auto-queues the first page request

After `pager_index` succeeds:
1. pager mode persists the hidden index state
2. pager mode updates keyed status to page 1 immediately
3. pager mode queues a hidden `pager-next` message for the next turn using `deliverAs: "nextTurn"` and `triggerTurn: true`

The queued pager-next stays out of the visible transcript, so the user sees the compact index control and then the first real content page.

### 4. Visible pager controls stay custom-rendered

`pager-next` and `pager-exit` remain transcript-visible custom messages when triggered by explicit user actions.

Renderer policy:
- `pager-next`: show italic `Page Turn`, then `Now viewing {page title}` with `{page title}` bold
- `pager-exit`: keep a compact custom renderer in the same extension-owned surface

These renderers are presentation only. Reconstruction uses entry type/order, not rendered text.

### 5. Pager status is always derived from reconstructed branch state

Required formats stay locked:
- index page: `[0/{n}] {title}: Index`
- active content page: `[{i}/{n}] {page_title}`

Status refresh happens on:
- `session_start`
- `session_switch`
- `session_branch`
- `session_tree`
- `message_end` for visible pager control messages
- immediate explicit pager actions (`pager_index`, `/pager:next`, `/pager:exit`)

### 6. Shortcut behavior is intentionally conservative

`Ctrl+J` is registered through the extension shortcut API.

Behavior:
- when idle: run the same pager-next action path as `/pager:next`
- while a response is still running: do nothing except show an informational notification

This avoids changing page state mid-stream.

## Reconstruction algorithm

```python
advance_count = 0

for entry in walk_backward_from_current_leaf():
    if is_pager_exit(entry):
        return None

    if is_pager_next(entry):
        advance_count += 1
        continue

    if is_pager_index_state(entry):
        title, pages = read_index(entry)
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

Rules:
- nearest `pager-exit` closes pager mode
- nearest pager index-state entry is the only pager-definition node that matters
- stray `pager-next` / `pager-exit` messages with no reachable pager index-state are ignored
- advancing past the final page closes pager mode
