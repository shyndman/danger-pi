## 1. Fork-Minimal Runtime Hooks

- [ ] 1.1 Add one focused helper module for OMP live-reload orchestration (watch bind/unbind, debounce, retry, persistent error state)
- [ ] 1.2 Wire helper lifecycle into interactive mode with small hooks only (init, shutdown, `/move`, and settings-change path)
- [ ] 1.3 Add a shared refresh function that reuses `refreshSlashCommandState()` and refreshes runtime `skillCommands` mapping
- [ ] 1.4 Keep scope native-only and avoid provider/discovery refactors in this step

## 2. Commands, Settings, and Scope

- [ ] 2.1 Add builtin `/reload` command entry and route it through existing builtin slash command execution flow
- [ ] 2.2 Implement `/reload` behavior to run watcher rebind retry + command/skill refresh + MCP reload
- [ ] 2.3 Add new setting with enum values `omp` and `none` and expose it in settings UI

> [!REVIEW]
> I'm just going through these tasks, and we need way more validation immediately alongside each task that requires it

- [ ] 2.4 Ensure `omp` mode watches only native roots (`<cwd>/.omp`, `~/.omp/agent`) and ignores non-native source roots

## 3. Watcher Behavior and Error Visibility

- [ ] 3.1 Watch parent roots so mid-session `<cwd>/.omp` creation/removal triggers rebind and one refresh pass
- [ ] 3.2 Watch child `commands/` and `skills/` paths and trigger debounced refresh on create/update/rename/delete
- [ ] 3.3 Render persistent watcher failure state in interactive UI until successful rebind
- [ ] 3.4 Surface inotify/resource watch failures with actionable recovery text mentioning `/reload`

## 4. Validation and Regression Coverage

- [ ] 4.1 Add/update targeted tests for runtime refresh behavior on `.omp` command and skill changes
- [ ] 4.2 Add/update tests for mid-session `.omp` root creation handling and watcher rebind behavior
- [ ] 4.3 Add/update tests for `/reload` watcher retry and persistent failure clear behavior
- [ ] 4.4 Add/update tests proving non-native source changes do not trigger this `.omp` feature path
- [ ] 4.5 Run relevant package checks and record any unrelated failures separately
