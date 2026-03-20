## Context

`packages/agent-session-viewer/` currently treats tool-call arguments as a single display string. In `normalize.ts`, `formatArgsLine()` serializes the persisted arguments object with `JSON.stringify()`, stores that text in `ToolCallMetadata.argsLine`, and `render.ts` later wraps the same single blob under a status line that only shows the tool name. This produces two readability problems in traced sessions: `_i` shows up as if it were a normal tool parameter, and nested inputs become hard to scan once they collapse into one line.

Upstream persisted session data already gives the viewer a better seam. `packages/ai/src/types.ts` defines `ToolCall` with both `arguments` and an optional sibling `intent` field, but the viewer-local `PersistedToolCallBlock` interface in `packages/agent-session-viewer/src/normalize.ts` currently models only `type`, `id`, `name`, and `arguments`. The result side already has a distinct presentation path and should remain untouched so the transcript continues to distinguish between requested inputs and observed outputs.

For a junior engineer, the important mental model is:

1. `normalize.ts` turns persisted session entries into simpler viewer rows.
2. `render.ts` turns those viewer rows into terminal lines.
3. This feature should move tool-call-specific interpretation into those two steps without changing the persisted file format.

That means the implementation should first improve the normalized data shape, then improve how that shape is rendered. Avoid trying to solve everything inside one giant render function.

## Goals / Non-Goals

**Goals:**
- Render tool-call rows with clearer separation between tool identity, user-visible intent, and structured parameters.
- Preserve the persisted call shape by keeping original argument key order and by rendering nested objects and arrays in order.
- Hide harness-internal `_i` from displayed parameters while still using it as a compatibility fallback for older sessions that lack a persisted `intent` field.
- Keep the change localized to the agent session viewer so tool execution, session persistence, and result rendering semantics stay unchanged.

**Non-Goals:**
- Changing how session files persist tool calls or introducing a new persisted message schema.
- Reworking tool-result rows, JSON result formatting, or image rendering.
- Turning the viewer into a fully interactive object inspector with expand/collapse controls or per-tool widgets.
- Normalizing or sorting argument keys; the viewer should reflect persisted order rather than inventing a canonical order.

Another way to read the scope:

- `normalize.ts` may change its internal viewer-facing types.
- `render.ts` may gain helper functions for formatting structured args.
- tests should expand.
- nothing outside the viewer package should need feature work.

## Decisions

### 1. Treat intent as first-class tool-row metadata
Tool-call normalization should store an explicit intent field alongside the tool name rather than burying intent inside the rendered argument block.

The viewer should prefer the persisted `toolCall.intent` field when present. If that field is absent, it should fall back to `arguments._i` for backward compatibility with older saved sessions. The rendered tool header should use the existing `renderStatusLine()` helper from `packages/coding-agent/src/tui/status-line.ts` with the tool name as `title` and the intent as `description`, because that helper already renders description text in muted styling on the same line.

Implementation guidance:

- Add `intent?: string` to the viewer-local persisted tool-call interface.
- Add an `intent?: string` field to the viewer metadata or row type that represents tool calls.
- Compute the chosen intent once during normalization. Do not make the renderer decide between `toolCall.intent` and `arguments._i`; by the time rendering runs, the row should already know its display intent.
- After the intent is chosen, `_i` should not remain in the display-arguments object.

This keeps normalization responsible for “what data should the row show?” and rendering responsible for “how should that data look?”

**Why this over keeping `_i` inline?** Hoisting intent makes the transcript read like a tool invocation rather than a serialized object dump, and it removes a high-frequency internal field from the main parameter surface.

**Alternatives considered:**
- Keep `_i` in the args block: rejected because it duplicates intent and visually competes with real inputs.
- Show intent on a second line: rejected because the shared status-line description already provides the desired side-by-side treatment with less vertical noise.

### 2. Replace single-line arg blobs with a structured parameter block
Tool-call rows should no longer store one `argsLine` string. Instead, normalization should preserve a display-ready argument object with `_i` removed, and rendering should format that object as a compact YAML-like block using two-space indentation.

A good implementation shape for a junior engineer is:

1. Normalize tool-call rows into an object like `displayArgs?: Record<string, unknown>` rather than a formatted string.
2. Add one small renderer helper that takes `unknown` plus current indentation depth and returns `string[]`.
3. Have `renderToolRow()` call that helper only for `phase === "call"`.

Do not jump straight to recursive rendering inside `renderToolRow()`. A small helper will be easier to test and reason about.

The formatting rules should be intentionally simple and transcript-focused:
- object fields render as `key: value`
- nested objects render `key:` followed by indented children
- arrays render as `- value` items
- arrays of objects render `-` items with nested indented fields
- empty objects and arrays render compactly on one line when possible (`{}` / `[]`)
- strings are quoted only when needed to avoid ambiguity (for example empty strings, multiline strings, or values whose unquoted form would be misleading)
- multiline strings remain indented under their key so wrapping does not destroy structure

Use two spaces per indent level exactly. That means:

- top-level argument lines start with two spaces
- children of a nested object start with four spaces
- children nested again start with six spaces

Recommended concrete output shapes:

```text
Read: Inspecting file
  path: src/app.ts
  limit: 20
```

```text
Task: Updating callers
  agent: task
  tasks:
    - id: RenameExport
      description: Rename the export
```

```text
Write: Creating note
  content: |
    first line
    second line
```

The multiline-string marker does not need to be literal YAML if a simpler representation is easier, but the output must stay visually structured and readable.

This should look authored and readable, not like a generic debug tree. The viewer should avoid tree glyphs such as `├` and `└` for call arguments, because those work well for arbitrary inspectors but add unnecessary ceremony to a transcript row.

Keep the formatter intentionally conservative. If a value is awkward to render perfectly, prefer a simple truthful representation over clever formatting.

**Why this over reusing the existing JSON tree renderer directly?** The existing tree renderer is close in spirit, but its tree-glyph presentation is heavier than what tool-call rows need. A viewer-local formatter can stay smaller, preserve the desired YAML-like tone, and avoid importing inspector-oriented rendering choices.

**Alternatives considered:**
- Keep a single-line compact preview: rejected because it is the core readability problem.
- Reuse the shared JSON tree glyph renderer unchanged: rejected because the output reads like an inspector, not a transcript.
- Render actual YAML via serialization: rejected because the viewer is not writing a data interchange format, only presenting persisted arguments; a dedicated formatter can better control quoting and compact empty values.

### 3. Preserve original key order and keep result rows unchanged
Normalization should keep argument objects in their persisted order and pass that order through to rendering. No alphabetical sorting or semantic regrouping should happen.

This is important because JavaScript object iteration order already preserves insertion order for normal string keys. The implementation should take advantage of that and avoid rebuilding objects in ways that accidentally reorder keys.

Tool-result rows should continue to use the existing rendering path. The design intentionally improves only the call side so the transcript preserves an asymmetry that is useful to readers: calls communicate requested action and inputs; results communicate observed output.

**Why this over harmonizing call/result formatting?** Using the same structured style on both sides would blur the difference between the invocation and the output, especially when result text already contains JSON or free-form logs.

**Alternatives considered:**
- Sort keys for consistency: rejected because it is less faithful to the persisted call and can separate related fields that the agent produced together.
- Apply the same structured formatter to results: rejected because it widens scope and weakens the distinction between inputs and outputs.

### 4. Keep wrapping and styling inside existing viewer conventions
The structured parameter block should still flow through the viewer’s existing text sanitization and ANSI-aware wrapping path. In `packages/agent-session-viewer/src/render.ts`, `wrapStyledText()` already applies `replaceTabs()` and `wrapTextWithAnsi()` before rendering lines, so structured parameter lines should be routed through that same helper instead of introducing a second wrapping path.

Parameter lines should use dim/muted treatment, but the header line should continue to anchor the row with the standard status icon and tool-name styling.

In practice, this means the formatter should produce plain strings first, and the existing wrapping/styling path should be applied afterward. Avoid building a second wrapping system inside the formatter itself.

**Why this over adding a custom layout engine?** The viewer already has a wrapping and styling path that matches the rest of OMP-like rendering. Reusing it reduces drift and keeps the change surgical.

## Risks / Trade-offs

- **Quoted-string edge cases** → Keep quoting rules narrow and deterministic, and cover representative cases in viewer tests instead of trying to perfectly emulate YAML.
- **Older sessions without persisted `intent`** → Fall back to `_i` only when explicit `intent` is missing, then still strip `_i` from displayed arguments.
- **Large nested inputs becoming vertically noisy** → Keep the formatter compact for empty and scalar-only structures, and rely on wrapping rather than introducing inspector chrome.
- **Duplicate formatting logic versus shared utilities** → Accept a small viewer-local formatter if it keeps the transcript presentation simpler than the generic JSON-tree renderer; revisit sharing only if the same pattern appears again.

Additional junior-engineer guidance:

- Do not try to support every possible JavaScript value perfectly. The viewer mostly needs to handle strings, numbers, booleans, null, arrays, and plain objects well.
- If an unexpected value appears, render something truthful and stable rather than throwing.
- Prefer several focused test cases over one giant snapshot-style assertion.

## Migration Plan

1. Update the viewer-local persisted tool-call interface and row metadata so normalization can read `intent`, stop depending on `argsLine`, and carry structured arguments separately from result content.
2. Replace the call-side string formatting path with a viewer-local structured formatter that strips `_i`, preserves key order, and renders through the existing `wrapStyledText()` helper.
3. Update `packages/agent-session-viewer/test/normalize-render.test.ts` to assert the new header-plus-structured-args presentation, including nested objects, arrays, and intent fallback behavior.
4. No data migration is required. Existing sessions remain readable because the viewer can derive intent from `_i` when explicit persisted intent is absent.

Suggested implementation order inside one coding session:

1. Change types first so the new row shape is explicit.
2. Update normalization next until tests can inspect the new row data.
3. Add the formatter helper and wire rendering.
4. Finish by updating render tests and running the package test command.

## Open Questions

None. The presentation decisions are locked for this feature: same-line muted intent, two-space indented structured args, preserved key order, no `args:` label, and unchanged result rows.
