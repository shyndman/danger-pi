## Why

The agent session viewer currently serializes tool-call `arguments` with `JSON.stringify()` in `packages/agent-session-viewer/src/normalize.ts`, stores that display string in `ToolCallMetadata.argsLine`, and renders it under the tool header in `src/render.ts`. That makes traced calls hard to scan and, when the persisted arguments include `_i`, displays harness metadata in the same blob as the real tool inputs.

In practice, this means a very common row in the transcript is doing two jobs badly at once: it is trying to show the human-readable purpose of the tool call and the machine-shaped argument object with the same presentation. A junior engineer implementing this change should think of the feature as splitting one overloaded display into two clearer pieces: a header that says what the tool call is for, and a body that shows the actual arguments in a readable nested form.

## What Changes

- Replace single-line JSON-style tool-call argument previews in the session viewer with a compact structured block that preserves nesting and field order.
- Hoist persisted tool-call intent out of `_i` and render it alongside the tool name with muted secondary styling.
- Hide harness-internal `_i` from displayed argument content while preserving truthful rendering of the remaining persisted inputs.
- Keep tool-result rows unchanged so call rows continue to communicate intent and inputs, while result rows continue to communicate observed output.

Concretely, a row that currently looks like one wrapped JSON blob should instead read more like:

```text
Read: Inspecting file
  path: src/app.ts
  offset: 10
  limit: 20
```

The exact punctuation can follow the existing status-line helper, but the structure should communicate the same idea: tool identity and intent on the first line, arguments on indented lines below it.

## Capabilities

### New Capabilities
- `structured-tool-call-args`: Render persisted tool-call arguments in a compact YAML-like block with two-space indentation, preserved key order, and readable nested objects and arrays.

### Modified Capabilities
- `agent-session-viewer`: Tool-call rows now show persisted intent beside the tool name and display arguments as a structured block instead of a single-line compact blob.

## Impact

- Affects `packages/agent-session-viewer/` normalization and rendering of tool-call rows.
- Changes the viewer's transcript presentation contract for tool-call arguments, but does not change session persistence, tool execution, or tool-result rendering.
- Relies on upstream persisted `ToolCall.intent` metadata, which already exists in `packages/ai/src/types.ts`, and requires widening the viewer-local `PersistedToolCallBlock` interface in `packages/agent-session-viewer/src/normalize.ts` to read that field directly.
- The implementation should stay local to the viewer package. A junior engineer should not need to change upstream persistence or model-provider code for this feature; the work is in how the viewer reads and renders data it already receives.
