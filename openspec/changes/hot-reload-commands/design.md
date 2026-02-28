## Context

Interactive sessions currently build slash-command state at startup and refresh it on `/move`, but do not auto-refresh on filesystem changes. Skill command availability is built from startup `session.skills` and similarly does not auto-refresh. This is acceptable upstream behavior, but for this fork it slows local process experiments where `.omp` files are edited frequently.

Verified integration points already exist and should be reused:
- `InteractiveMode.refreshSlashCommandState()` for markdown slash command refresh and autocomplete/session slash-state updates.
- `CommandController.handleMoveCommand()` for directory transitions (`setProjectDir`, `resetCapabilities`, and slash-command refresh).
- Builtin slash command routing in `slash-commands/builtin-registry.ts` (where `/reload` will be added).
- Existing `fs.watch` usage patterns in UI components (proof we can implement without a new dependency).

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

4. **Watch parent roots and child content roots together.**
   - Parent root watch is required for mid-session `<cwd>/.omp` creation/removal.
   - Child watches cover `commands/` and `skills/` updates.
   - Alternative rejected: watch children only.

5. **Add top-level `/reload` by extending builtin slash command registry.**
   - `/reload` runs: watcher rebind retry + command/skill refresh + MCP reload call.
   - This avoids introducing a parallel command parser path.
   - Alternative rejected: create ad-hoc command handling outside builtin registry.

6. **Persist watcher failures until healed.**
   - Keep one persistent failure state in interactive runtime.
   - Clear it only after successful watcher setup.
   - Alternative rejected: one-shot error notifications.

7. **File-touch strategy (fork-minimal).**
   - Small edits in: `interactive-mode.ts`, `selector-controller.ts`, `builtin-registry.ts`, `settings-schema.ts`, and relevant settings typing.
   - Add at most one new helper module for watcher orchestration.
   - Do not refactor discovery provider modules in this change.

## Risks / Trade-offs

- **[Watcher churn from repeated file events]** → Debounce refresh triggers and coalesce overlapping reload runs.
- **[UI noise from persistent watcher failures]** → Use one persistent status surface with deduplicated message updates rather than repeated spam.
- **[State synchronization issues between slash command registry, skill map, and session prompt state]** → Refresh these components in a defined order inside one orchestration function.
- **[Scope creep toward TS command/module reloading]** → Keep explicit boundary: markdown commands + skills only.

## Migration Plan

- Introduce the new mode setting with explicit values `omp` and `none`.
- Keep legacy behavior when mode resolves to `none`.
- Roll back by switching to `none` or removing the helper wiring.

## Open Questions

- None for this iteration; default is to implement the smallest fork-local path above first.
