---
setup: bun install && uv tool run prek install --prepare-hooks && bun run build:native
changelog:
  exclude:
    - ./packages/catalog/src/models.json
rebase:
  continue_check: bun fix
---

This is a fork. When writing new features you should endeavor to alter upstream-owned files as little as possible, to minimize future conflict.

You can determine which files are unique to the fork (and thus free to edit), by calling invoking `forklift files` from bash.

When making changes, you **MUST** update this file to reflect anything new, updated, or removed.

## Auto-fixing Lints

`bun fix` will

* If it fails, check the logs, but be aware that a `bun fix:ts` will fix some of the easier issues that you're likely to encounter.

## Fork feature set

This fork adds the following feature areas on top of upstream:

### Agent workflow and submission handling
- Multi-block submissions in interactive mode
- Fenced multi-block shortcut syntax
- Streaming multi-block queue ordering so prompt text and command results stay in authored order
- Execute-intent paste for explicit executable clipboard input

### Runtime and session behavior
- Native `.omp` live reload for commands and skills
- Native `.cmd.yaml` prompt-chain command files in `.omp/commands` and `~/.omp/agent/commands`: `foo.cmd.yaml` registers `/foo`, same-directory `.md` siblings win on name collisions, and invalid YAML/schema files surface as non-fatal interactive warning blocks during startup and reload
- Native and standalone fallback MCP config files accept JSONC syntax in the existing `mcp.json` / `.mcp.json` paths while OMP continues to write normalized strict JSON
- Fork-local pager mode: assistant-emitted `<pager-index title="...">` workflows can be advanced with `/pager:next` and exited with `/pager:exit`; transcript history keeps visible `Paging Next` / `Paging Exit` custom messages, and the hook-status line reconstructs `[0/n] workflow: Index` or `[i/n] page title` from the active branch plus in-flight pager control messages so the first page does not regress to `Index`
- Fork-local `--list-recent [count]` CLI flag: lists the most recently modified sessions across all project scopes (default 10; pass any positive integer to change the count, invalid values silently fall back to 10) with title, directory name, session id, and relative last-used time; rows use a stable title-hash color from the fork-local fixed palette
- `/reload` support for refreshing runtime state
- Codex OAuth account stickiness per session / top-level agent
- Fork-local Codex account selection: keep reusing a still-usable sticky pin to avoid cache churn; when a new pin is needed, prefer Spark/Pro accounts first, then choose the non-exhausted account whose long window renews soonest; fail fast if Codex ranking data is missing so regressions surface immediately.
- Codex affinity and cache-observability logging
- Fork-local assistant token line in interactive mode: when `display.showTokenUsage` is enabled, assistant messages show dim input/output counts, then a `\uf49b` cache segment with explicit cached-token count including `0` and hit/miss tinting, then a trailing `` elapsed segment derived from assistant-message timestamps in compact `d/h/m/s` form; zero-cache responses tint both cache and elapsed segments as misses so the line stays visually consistent
- Native shell interpolation in rendered command and skill bodies

### Supporting platform and tooling changes
- Pre-commit blocks staged `CHANGELOG.md` files with `This is a fork. We do not modify CHANGELOG.md`
- Better extension discovery, including symlinked package dirs
- Package name derivation fixes for discovered extensions
- Session token tracking and related session-link fixes
- Clipboard and native integration improvements
- Nano Banana 2 image-generation pipeline upgrade
- OpenRouter image generation defaults to `openai/gpt-5.4-image-2` and can be overridden with `providers.imageOpenRouterModel` when `providers.image=openrouter`; requests always send `modalities: ["image", "text"]` and forward `image_config` (`aspect_ratio`, `image_size`) when provided
- Fork-local bundled Danger Pi extensions now live in `packages/coding-agent/src/danger-pi/extensions/index.ts` and are wired directly into `sdk.ts` inline extensions, separate from filesystem-discovered user/project extensions
- Added fork-local `meta` bundled extension slash command for UI/autocomplete experimentation with `foo`, `bar`, and `baz` argument suggestions
