## Why

We want a fast, fork-local way to open a coding-agent session file in kitty and inspect what a running sub-agent is doing without booting the full Oh My Pi application. The current codebase already persists sessions as JSONL through `packages/coding-agent/src/session/session-manager.ts`, and it already has a file-based session reader in `packages/coding-agent/src/export/html/index.ts`. The same codebase also already externalizes message image blocks and `display` tool image payloads through `packages/coding-agent/src/session/blob-store.ts`, but `packages/coding-agent/src/tools/gemini-image.ts` still returns `details.images` as inline base64 data, so image-heavy sessions still carry large persisted payloads.

## What Changes

- Add a standalone top-level package that reads coding-agent session JSONL files directly and renders them as an Oh My Pi-like transcript viewer.
- Render the viewer with strong visual resemblance to existing OMP themes by reusing verified shared surfaces where that meaningfully reduces drift: `packages/coding-agent/src/modes/theme/theme.ts`, `packages/coding-agent/src/tui/*`, and exported components from `packages/coding-agent/src/modes/components/index.ts`.
- Keep transcript rendering intentionally small: session metadata in header chrome, feed rows for user / assistant / generic tool / notice, assistant thinking rendered as assistant content, and one generic tool presentation for all tools.
- Keep viewer behavior unsurprising: opening a file shows a static snapshot by default, with optional tailing enabled only via `-f` / `--follow`.
- Tail appended JSONL entries when follow mode is enabled, updating at persisted message boundaries rather than inventing token-stream behavior that is not present in the session file.
- Render images in the viewer when persisted bytes are available, and fall back cleanly when image bytes or `/tmp` paths are missing.
- Reduce session-file bloat by extending the existing blob externalization / resolution path to `generate_image` input/result image bytes during session persistence and session load.

Implementation should be mechanically separable:
- new viewer package work lives under `packages/agent-session-viewer/`
- viewer normalization/rendering should read raw JSONL entries directly rather than booting coding-agent runtime state
- persistence externalization work stays inside the existing coding-agent session persistence/load seam, not inside the viewer package and not inside the `generate_image` tool implementation itself
- this work should land as its own commit, separate from unrelated cleanup, refactors, or experiments

## Capabilities

### New Capabilities
- `agent-session-viewer`: A standalone viewer package that renders coding-agent session JSONL files with an OMP-like transcript presentation and optional follow mode.
- `generate-image-session-externalization`: Persistence and restore behavior for `generate_image` image bytes so session files stay lightweight while preserving replayable output details.

### Modified Capabilities
- None.

## Impact

- **New package**
  - `packages/agent-session-viewer/`: new standalone CLI/runtime for reading session JSONL and rendering an OMP-like transcript.
  - Likely initial source split: `src/cli.ts`, `src/session-file.ts`, `src/normalize.ts`, `src/render.ts`, `src/theme.ts`, and `src/types.ts`.
- **Existing coding-agent areas likely to change**
  - `packages/coding-agent/src/session/session-manager.ts`: extend the existing persistence/load path that already rewrites JSONL entries and resolves blob references on read.
  - `packages/coding-agent/src/session/blob-store.ts`: reuse the existing content-addressed blob reference flow (`blob:sha256:<hash>`) and helpers for additional image payloads; no blob-store API expansion is planned by this spec.
  - `packages/coding-agent/src/tools/gemini-image.ts`: its current tool details shape includes provider/model metadata, temp `imagePaths`, inline `images`, optional `responseText`, optional `promptFeedback`, and optional `usage`; implementation must preserve that in-memory shape and only change where persisted image bytes live.
  - Existing reusable rendering/theme surfaces live under `packages/coding-agent/src/modes/theme/`, `packages/coding-agent/src/tui/`, and `packages/coding-agent/src/modes/components/`.

- **Boundaries to keep explicit during implementation**
  - Do not move viewer logic into `packages/coding-agent/src/` just because reusable helpers already live there.
  - Do not add tool-specific viewer widgets; every tool row is generic in this change.
  - Do not add viewer-specific blob-resolution code; loaded session messages should already be resolved by coding-agent session loading.
  - Do not change the in-memory `generate_image` tool-result shape just to make persistence easier.
- **Dependencies / systems**
  - The workspace already contains `@oh-my-pi/pi-tui` and `@oh-my-pi/pi-utils`. `@oh-my-pi/pi-coding-agent` currently re-exports theme utilities, session management, and `modes/components` from `packages/coding-agent/src/index.ts`, while additional internal rendering helpers live under `packages/coding-agent/src/tui/`.
  - This change is for kitty only. Supporting other terminals, adding fallback terminal branches, or generalizing image behavior beyond kitty is out of scope for this change.
  - Kitty-specific behavior is grounded in the official docs: kitty's scroll controls act on the main screen and are passed to the child program when the alternate screen is active, so the viewer must rely on ordinary terminal output and must not promise a custom fullscreen scroll model. Retained post-launch history is bounded by the user's kitty `scrollback_lines` setting rather than by the viewer. Docs: https://sw.kovidgoyal.net/kitty/overview/#scrolling and https://sw.kovidgoyal.net/kitty/conf/#scrollback
  - Runtime follow behavior does not require a new watcher dependency. If implementation uses Bun's `node:fs` compatibility layer, `fs.watchFile()` is documented as polling with a configurable interval and `fs.watch()` is the more efficient option when available. This change only requires correct append-follow semantics, not a specific watcher API. Docs: https://bun.com/reference/node/fs/watchFile and https://bun.com/reference/node/fs/watch

  - Existing kitty launch wiring is out of scope for this change; this work starts at the viewer executable and session file.
