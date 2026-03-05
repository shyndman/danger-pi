## ADDED Requirements

### Requirement: `.omp` live-reload mode is configurable
The interactive runtime MUST expose a setting for command/skill live reload with exactly two valid modes: `omp` and `none`.

#### Scenario: User enables `.omp` live reload
- **WHEN** the setting is set to `omp`
- **THEN** `.omp` watcher-based live reload behavior SHALL be active for the current interactive session

#### Scenario: User disables live reload
- **WHEN** the setting is set to `none`
- **THEN** watcher-based command/skill auto-reload SHALL be inactive for the current interactive session

### Requirement: Auto-reload scope is native `.omp` sources only
When live reload mode is `omp`, watcher-triggered refresh MUST apply only to native OMP roots used by runtime discovery (`<cwd>/.omp` and `~/.omp/agent`).

#### Scenario: Non-native source changes do not trigger this feature
- **WHEN** files under non-native source roots (for example `.claude`, `.codex`, or `.gemini`) change
- **THEN** this `.omp` live-reload feature SHALL NOT treat those changes as watcher-triggered refresh inputs

### Requirement: `.omp` command and skill files refresh from watcher events
When live reload mode is `omp`, the interactive runtime MUST watch native `.omp` command and skill source paths and refresh markdown slash commands and skills after detected filesystem changes.

#### Scenario: `.omp` markdown command is created or updated
- **WHEN** a watched `.omp/commands` markdown file is created, modified, renamed, or deleted
- **THEN** runtime slash command state SHALL be refreshed to reflect the new command set

#### Scenario: `.omp` skill file is created or updated
- **WHEN** a watched `.omp/skills/*/SKILL.md` file is created, modified, renamed, or deleted
- **THEN** runtime skill command availability SHALL be refreshed to reflect the new skill set

### Requirement: Mid-session project `.omp` root appearance is detected
When live reload mode is `omp`, the runtime MUST detect project-level `.omp` root creation/removal during an active session and adjust watcher bindings accordingly.

#### Scenario: Project `.omp` root is created after session start
- **WHEN** the session started without a project `.omp` root and a project `.omp` directory is later created
- **THEN** the runtime SHALL bind required `.omp` child watches and perform a refresh pass

#### Scenario: Project `.omp` root is removed and re-created
- **WHEN** an existing project `.omp` root disappears and later reappears
- **THEN** the runtime SHALL rebind watchers to the recreated root and continue live refresh behavior

### Requirement: Watcher setup and runtime failures are persistent
Watcher errors MUST be shown persistently to the user until a successful watcher rebind clears the failure state.

#### Scenario: inotify limit prevents watcher setup
- **WHEN** watcher setup fails due to resource limits or filesystem watch errors
- **THEN** the interactive UI SHALL present a persistent watcher failure message

#### Scenario: Successful rebind clears persistent failure
- **WHEN** a later watcher setup attempt succeeds
- **THEN** the persistent watcher failure message SHALL be cleared

### Requirement: `/reload` performs a full runtime reload and watcher retry
The `/reload` command MUST run a full reload pass that retries watcher setup and refreshes runtime systems, including MCP runtime tool reload behavior.

#### Scenario: `/reload` is invoked after watcher failure
- **WHEN** persistent watcher failure exists and the user runs `/reload`
- **THEN** the runtime SHALL retry watcher setup and update persistent watcher status from the retry result

#### Scenario: `/reload` runs full reload scope
- **WHEN** the user runs `/reload`
- **THEN** slash commands, skills, and MCP runtime tools SHALL be reloaded in one command flow

### Requirement: Initial implementation is dependency-free
The first implementation SHALL use built-in watcher APIs (`node:fs.watch` or `node:fs/promises.watch`) and SHALL NOT add third-party watcher dependencies unless tests demonstrate a concrete blocker.

#### Scenario: built-in watcher path succeeds
- **WHEN** runtime behavior and tests pass with built-in watcher APIs
- **THEN** no third-party watcher dependency SHALL be added

#### Scenario: built-in watcher path fails with concrete evidence
- **WHEN** tests or reproducible runtime behavior demonstrate a concrete blocker in built-in watcher APIs
- **THEN** dependency evaluation SHALL compare `chokidar ^5.0` and `@parcel/watcher ^2.5` (optionally `@parcel/watcher-wasm ^2.5`) before adoption
