## Why

This fork is optimized for rapid local iteration, but `.omp` command/skill edits are not automatically reflected during an active session.

Verified current behavior in code:
- File slash commands refresh at startup and `/move` only (`InteractiveMode.init()` and `CommandController.handleMoveCommand()` calling `refreshSlashCommandState`).
- `refreshSlashCommandState()` updates autocomplete and `session.setSlashCommands(...)` for prompt-time slash expansion.
- `/skill:<name>` command availability is built from `session.skills` during interactive-mode construction and stored in `skillCommands` map.
- `AgentSession` exposes `setSlashCommands(...)` but no equivalent runtime setter for `skills`, so skill command availability is effectively startup-loaded today.


Today, all three of these workflows are unreliable mid-session:
- Add a new command markdown file in `<cwd>/.omp/commands` and use it immediately.
- Add or rename a skill in `<cwd>/.omp/skills` (or `~/.omp/agent/skills`) and have `/skill:<name>` update immediately.
- Create `<cwd>/.omp` after the session has already started and have it become active without restart.

The change is needed now because this repo is actively experimenting with local process ergonomics; fast feedback on `.omp` command/skill edits is a direct productivity blocker. The fork-local objective is to deliver this quickly with a surgical patch that is easy to maintain and easy to merge around upstream changes.

## What Changes

1. Keep scope native and fork-local.
   - Auto-reload covers native OMP roots only: `<cwd>/.omp` and `~/.omp/agent` (from native `SOURCE_PATHS` and builtin provider root resolution).
   - Auto-reload does not include `.claude`, `.codex`, `.gemini`, or TypeScript custom commands.
   - This keeps changes small, avoids broad provider refactors, and matches immediate fork needs.

2. Add one explicit runtime mode setting for this behavior.
   - New setting accepts only `omp` or `none`.
   - `omp` enables watcher-driven refresh for native OMP roots.
   - `none` preserves current static behavior.
   - This is additive: current settings include `skills.enableSkillCommands` and `commands.enableClaude*` toggles, but no command/skill auto-reload mode.

3. Implement watcher behavior using additive hooks, not structural rewrites.
   - Add a focused watcher helper dedicated to this flow.
   - Integrate helper through small call sites in interactive mode lifecycle (init, selector setting-change side effects, stop/shutdown, and `/move` path transitions).
   - Rebind when `<cwd>/.omp` appears, disappears, or reappears during the session.
   - Parent-root watching is required because builtin native discovery only includes non-empty `.omp` roots today.

4. Reuse existing refresh paths where possible.
   - Keep `refreshSlashCommandState()` as the command refresh primitive.
   - Add the missing runtime skill-map refresh step so `/skill:<name>` reflects new/removed skills.
   - Use one orchestration path for watcher-triggered refresh and manual reload.

5. Add top-level `/reload` to force full runtime refresh.
   - `/reload` retries watcher setup and reruns command/skill refresh.
   - `/reload` also invokes existing MCP reload behavior (equivalent outcome to `/mcp reload`).


6. Add persistent watcher error visibility.
   - Watcher setup/runtime failures (including inotify limits) stay visible until a successful rebind clears them.
   - This differs intentionally from existing silent watcher patterns (for example current git branch watcher `fs.watch` failure path).

7. Preserve explicit boundaries for this first fork iteration.
   - Included: markdown slash commands and `SKILL.md` skills under native OMP roots.
   - Deferred: TypeScript custom-command hot reload and any multi-source (`all`) mode.

8. Dependency strategy is explicit and verified.
   - Iteration-one implementation uses built-in watcher APIs (`node:fs.watch` / `node:fs/promises.watch`) and adds no dependency.
   - If built-in watcher behavior proves insufficient, evaluate third-party options in this order:
     1) `chokidar` `^5.0` (latest verified `5.0.0`, ESM-only, Node `>=20.19.0`).
     2) `@parcel/watcher` `^2.5` (latest verified `2.5.6`) with optional `@parcel/watcher-wasm` `^2.5` fallback.
   - Third-party watcher adoption is intentionally deferred unless tests show a concrete gap.

## Capabilities

### New Capabilities
- `omp-command-skill-live-reload`: Native OMP-only runtime watching, refresh orchestration, persistent failure signaling, and manual reload control for markdown commands and skills in interactive mode.

### Modified Capabilities
- None.

## Impact

- Affected package: `packages/coding-agent`.
- Affected runtime surfaces:
  - `interactive-mode` lifecycle and selector-driven setting changes.
  - Builtin slash command registry and runtime command execution (`/reload`).
  - Slash command refresh + skill command map refresh integration.
  - Settings schema/UI entry for `omp | none` mode.
  - Persistent watcher health/error display in interactive UI.
- User-visible behavior contract:
  - In `omp` mode, editing native OMP markdown commands/skills updates runtime behavior without restart.
  - Creating `<cwd>/.omp` mid-session activates it automatically.
  - Watcher failures remain visible until fixed, then clear after successful rebind.
  - `/reload` retries watcher setup and refreshes command/skill + MCP runtime state.
- Non-functional constraints:
  - Linux-first implementation is acceptable for this phase.
  - Keep change surgically scoped and easy to iterate in this fork.
  - Prefer additive helper(s) and narrow call-site hooks over broad refactors.
  - No new external dependency is required for this version; existing code already uses `fs.watch` patterns and current dependencies do not include watcher libraries like `chokidar` or `@parcel/watcher`.
  - If a dependency is later added, keep version ranges minor-friendly (`^5.0` / `^2.5`) rather than pinning exact patch versions.
- Implementation readiness expectations for junior execution:
  - Every behavior above must map to at least one explicit task in `tasks.md`.
  - Final validation must prove: live update, mid-session `.omp` creation handling, persistent error display, and `/reload` recovery.
