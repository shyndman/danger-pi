## Context

Interactive sessions currently build slash-command state at startup and refresh it on `/move`, but do not auto-refresh on filesystem changes. Skill command availability is built from startup `session.skills` and similarly does not auto-refresh. This is acceptable upstream behavior, but for this fork it slows local process experiments where `.omp` files are edited frequently.

Verified integration points already exist and should be reused:
- `InteractiveMode.refreshSlashCommandState()` for markdown slash command refresh and autocomplete/session slash-state updates.
- `CommandController.handleMoveCommand()` for directory transitions (`setProjectDir`, `resetCapabilities`, and slash-command refresh).
- Builtin slash command routing in `slash-commands/builtin-registry.ts` (where `/reload` will be added).
- Existing `fs.watch` usage patterns in UI components (proof we can implement without a new dependency).

Verified runtime/dependency constraints:
- `packages/coding-agent` is Bun-first (`engines.bun >= 1.3.7`).
- Bun documents support for `node:fs.watch` and `node:fs/promises.watch`.
- Node docs (v25) document `fs.watch(...)` / `fsPromises.watch(...)` with `recursive`, `signal`, and `ignore` options (platform caveats still apply).
- Current workspace dependencies do not include watcher libraries such as `chokidar` or `@parcel/watcher`.

## Goals / Non-Goals

**Goals:**
- Automatically refresh `.omp` markdown commands and skills while interactive mode is running.
- Support mid-session creation/removal of project-level `.omp` root.
- Surface watcher failures as persistent user-visible state until a successful rebind clears them.
- Provide `/reload` to run a full refresh pass (command/skill rediscovery, watcher rebind attempt, and MCP reload behavior).
- Keep implementation incremental and fork-local with minimal churn.
- Prefer small additive hooks over broad architectural changes.

**Non-Goals:**
- No TypeScript custom-command hot reload in this change.
- No multi-source watch mode (`all`) in this change.
- No broad discovery/provider refactor.
- No broad defensive/fallback strategy beyond requested explicit retry (`/reload`).

## Decisions

1. **Introduce one focused helper for OMP live reload orchestration.**
   - Add a small helper module for watcher bind/unbind, debounce, and error state tracking.
   - Keep it isolated so most upstream-owned files receive only thin integration hooks.
   - Alternative rejected: editing discovery providers directly to add watcher concerns.

2. **Keep source scope native-only (`.omp`) with `omp | none` mode.**
   - This aligns with current fork needs and keeps implementation small.
   - Alternative rejected: implementing `all` mode now.

3. **Hook into existing runtime flows instead of replacing them.**
   - Reuse `refreshSlashCommandState()` for slash commands.
   - Add a sibling skill refresh step that rebuilds `skillCommands` from reloaded skills.
   - Run both through one shared orchestration function used by watchers and `/reload`.
   - Alternative rejected: duplicate refresh logic for each trigger.

4. **Default to built-in watchers; avoid third-party dependency in iteration one.**
   - Primary implementation path is `node:fs.watch`/`node:fs/promises.watch`.
   - Rationale: keeps this fork patch surgical and Bun-compatible without adding install-time native-module risk.
   - Alternative rejected (for now): introducing `chokidar`/`@parcel/watcher` before proving built-in watcher gaps.

5. **Watch parent roots and child content roots together.**
   - Parent root watch is required for mid-session `<cwd>/.omp` creation/removal.
   - Child watches cover `commands/` and `skills/` updates.
   - Alternative rejected: watch children only.

6. **Add top-level `/reload` by extending builtin slash command registry.**
   - `/reload` runs: watcher rebind retry + command/skill refresh + MCP reload call.
   - This avoids introducing a parallel command parser path.
   - Alternative rejected: create ad-hoc command handling outside builtin registry.

7. **Persist watcher failures until healed.**
   - Keep one persistent failure state in interactive runtime.
   - Clear it only after successful watcher setup.
   - Alternative rejected: one-shot error notifications.

8. **File-touch strategy (fork-minimal).**
   - Small edits in: `interactive-mode.ts`, `selector-controller.ts`, `builtin-registry.ts`, `settings-schema.ts`, and relevant settings typing.
   - Add at most one new helper module for watcher orchestration.
   - Do not refactor discovery provider modules in this change.

## Third-Party Watcher Options (researched, 2026)

1. **Built-in `node:fs.watch` / `node:fs/promises.watch` (recommended baseline)**
   - Dependency: none.
   - API shape:
     - `watch(path, options?, listener?) -> FSWatcher`.
     - `fsPromises.watch(path, options?) -> AsyncIterator<{ eventType, filename }>`.
   - Fit: best for this fork's minimal-change objective.

2. **`chokidar` (`^5.0`)**
   - Latest verified version: `5.0.0`.
   - API shape: `chokidar.watch(paths, options)`; events include `add/change/unlink/addDir/unlinkDir/ready/error`; async `close()`.
   - Constraints from package metadata: ESM-only and Node `>=20.19.0`.
   - Use only if built-in watchers prove insufficient in tests.

3. **`@parcel/watcher` (`^2.5`) + optional `@parcel/watcher-wasm` (`^2.5`)**
   - Latest verified version: `2.5.6` for both packages.
   - API shape: `subscribe(dir, callback) -> { unsubscribe() }`, plus `writeSnapshot()` and `getEventsSince()`.
   - Constraints: native module install path and Bun lifecycle-script trust requirements; Bun issue reports show prebuild friction in some setups.
   - Use only if snapshot/history semantics are required and native-module operational overhead is acceptable.

Selection rule for this change: ship built-in watcher path first; only introduce a third-party watcher if failing tests reveal concrete gaps.

## Risks / Trade-offs

- **[Watcher churn from repeated file events]** → Debounce refresh triggers and coalesce overlapping reload runs.
- **[UI noise from persistent watcher failures]** → Use one persistent status surface with deduplicated message updates rather than repeated spam.
- **[State synchronization issues between slash command registry, skill map, and session prompt state]** → Refresh these components in a defined order inside one orchestration function.
- **[Scope creep toward TS command/module reloading]** → Keep explicit boundary: markdown commands + skills only.
- **[Native addon friction in Bun if external watcher is added]** → keep iteration-one implementation dependency-free.

## Migration Plan

- Introduce the new mode setting with explicit values `omp` and `none`.
- Keep legacy behavior when mode resolves to `none`.
- Roll back by switching to `none` or removing the helper wiring.

## Open Questions

- None for this iteration; default is to implement the smallest fork-local path above first.
