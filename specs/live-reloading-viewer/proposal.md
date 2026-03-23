## Why

Danger Pi currently asks the user to read long assistant replies in the terminal. That works, but it is a poor fit for dense, verbose model output: terminal fonts are optimized for editing, not comfortable long-form reading, and once a reply gets large it becomes harder to scan, re-read, or mentally compress.

This feature adds a very small browser-based reader for the latest completed assistant reply. The point is not to build a transcript UI or a second chat client. The point is to give the user a better reading surface for the one thing they most often want after a large response lands: the latest assistant text, rendered as markdown, with a one-click way to ask a cheaper model to condense what is currently being shown.

The timing matters because the user has already identified this as an active friction point in normal use. The desired behavior is now well-defined and locked: a `/viewer` command, a localhost browser page, automatic overwrite on the next completed reply, and summarization that affects only the browser buffer rather than the session transcript.

## What Changes

- Add a fork-local bundled Danger Pi extension under `packages/coding-agent/src/danger-pi/extensions/` that registers a new `/viewer` command.
- Add a lazy localhost web server owned by that extension. The server is started only when `/viewer` is run, binds to `127.0.0.1` on an OS-assigned ephemeral port, serves the viewer page, and hosts a WebSocket endpoint.
- Add a browser viewer page that always opens when `/viewer` runs. The page renders markdown for the latest completed assistant reply and replaces its contents whenever a newer completed assistant reply arrives.
- Add extension-owned viewer state consisting of one authoritative markdown buffer plus revision metadata. This state is separate from the session transcript and does not mutate transcript history.
- Source the buffer only from completed assistant `text` blocks. Thinking blocks, tool-call scaffolding, tool results, and non-assistant messages are out of scope.
- Add a summarize action in the browser. When invoked, it sends a request to the extension, which summarizes the current authoritative buffer using the user's configured `smol` model and replaces the browser buffer with the returned markdown on success.
- Preserve the existing browser buffer when summarization fails, and surface the failure to the browser instead of silently changing state.
- Use a single-client interaction model: the newest socket connection wins, the current state is sent immediately on connect, repeated summarize clicks are ignored while one summarize request is already running, and stale summarize completions are discarded.
- Add browser-side markdown rendering dependencies for the served client asset. Those dependencies are distributed with `omp`, but they are kept behind a client build boundary so the server-side extension does not import or execute them directly.

## Capabilities

### New Capabilities
- `live-reloading-viewer`: Opens a browser page for the latest completed assistant reply, keeps that page synchronized with later completed replies, and supports repeated summarization of the currently displayed markdown buffer.

### Modified Capabilities
- `danger-pi-bundled-extensions`: The fork-local bundled extension set now includes a viewer extension and exposes a `/viewer` command from the Danger Pi extension bundle.
- `assistant-message-observation`: Completed assistant replies are now consumed by an additional extension-owned observer that extracts final assistant text for browser display, without changing existing transcript or TUI behavior.
- `helper-model-usage`: Danger Pi gains a new in-process helper-model use case that resolves the configured `smol` role and uses it for iterative summarization of viewer content.

## Impact

- **Primary code area:** `packages/coding-agent/src/danger-pi/extensions/`, including the bundled extension registry and new viewer extension files.
- **New browser asset boundary:** the feature introduces a browser-only client entrypoint and a built asset that the extension serves locally.
- **Dependencies:** `packages/coding-agent` gains browser-rendering dependencies for the client asset, specifically `marked@^17.0.5` for markdown parsing and `dompurify@^3.3.3` for sanitization, based on the current upstream releases and docs reviewed for this spec. No extra sanitization/runtime bridge such as `jsdom` or `isomorphic-dompurify` is needed because sanitization happens in the browser, not on the server.
- **Model usage:** the extension will perform an in-process summarization call that explicitly resolves the configured `smol` model and calls `completeSimple(...)` with that resolved model.
- **Operational surface:** the feature introduces a localhost HTTP + WebSocket service bound only to `127.0.0.1` and only started on demand.
- **Unaffected behavior:** transcript persistence, message history semantics, normal CLI startup, TUI rendering, and the main agent conversation flow remain unchanged. The viewer is an additional reading surface, not a replacement for existing session behavior.
