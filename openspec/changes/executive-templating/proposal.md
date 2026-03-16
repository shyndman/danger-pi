## Why

OMP-native markdown commands already run argument substitution (`$1`, `$@`, `$ARGUMENTS`) and Handlebars rendering through the shared prompt-template renderer, while `/skill:<name>` currently reads a discovered `SKILL.md`, strips frontmatter, and injects the body plus metadata literally. Adding a narrow `!`-backtick execution primitive gives fork-local OMP command and skill bodies a lightweight way to pull live repo context into prompt content without changing imported command sources.

## What Changes

- Add post-render shell-expression expansion for OMP-native markdown command bodies loaded from `.omp/commands/*.md` and `~/.omp/agent/commands/*.md`, using Claude-style single-line ``!`...` `` syntax.
- Extend the same post-render shell-expression expansion to OMP-native skill bodies loaded from `.omp/skills/*/SKILL.md` (including ancestor `.omp` roots) and `~/.omp/agent/skills/*/SKILL.md`, when invoked through OMP skill loading/injection paths.
- Restrict the feature to body content only; frontmatter remains static.
- Run each embedded command in the session working directory with inherited environment, replace the expression with stdout trimmed of one trailing newline, and fail visibly on non-zero exit.
- Leave non-native command and skill sources (`.claude`, `.codex`, plugins, etc.) unchanged.

## Capabilities

### New Capabilities
- `executive-templating`: Dynamic shell-context expansion for native OMP command and skill bodies after Handlebars rendering.

### Modified Capabilities

## Impact

- Affected code: `src/extensibility/slash-commands.ts`, the shared renderer in `src/config/prompt-templates.ts`, native slash-command discovery in `src/discovery/builtin.ts`, native skill loading in `src/extensibility/skills.ts` / `src/discovery/builtin.ts`, and `/skill:` injection in `src/modes/controllers/input-controller.ts`.
- Affected UX: native OMP command bodies and native OMP skill bodies gain a new inline dynamic-context primitive.
- Dependencies: no new third-party package is required; the existing workspace shell APIs (`@oh-my-pi/pi-natives`, or Bun shell if preferred) are sufficient for v1.
- Non-goals: imported Claude/Codex-compatible command sources, frontmatter expansion, multiline shell blocks, and silent failure behavior remain unchanged.
