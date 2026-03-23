---
setup: bun install && uv tool run prek install --prepare-hooks
changelog:
  exclude:
    - ./packages/ai/src/models.json 
---

* Prek (a modern pre-commit equivalent) is installed on this project. It runs automatically on each `git rebase --continue`, and will automatically ensure that the code lints.
* If it fails, check the logs, but be aware that a `bun fix:ts` will fix some of the easier issues that you're likely to encounter.

## Fork feature set

This fork adds the following feature areas on top of upstream:

### Agent workflow and submission handling
- Multi-block submissions in interactive mode
- Fenced multi-block shortcut syntax
- Streaming multi-block queue ordering so prompt text and command results stay in authored order
- Execute-intent paste for explicit executable clipboard input
- Agent/session URI exposure for subagents

### Runtime and session behavior
- Native `.omp` live reload for commands and skills
- `/reload` support for refreshing runtime state
- Codex OAuth account stickiness per session / top-level agent
- Codex affinity and cache-observability logging
- Native shell interpolation in rendered command and skill bodies
- Alternate system prompt behavior tailored for the fork
- Fork reminder command and fork-specific prompt text

### Display and rendering
- Introduction of the display tool as an extensible runtime-registered tool
- Display image support for local image resources
- Display color support for simple `#RRGGBB` previews
- Replayable display draw intents so redraws do not re-run type execution
- Inline image rendering improvements for persisted image payloads
- OSC8 agent hyperlinks

### Session viewing and local tooling
- Standalone agent session viewer for persisted JSONL session files
- Local build/install helpers for fork workflows
- Viewer and build scripts for local development

### Supporting platform and tooling changes
- Better extension discovery, including symlinked package dirs
- Package name derivation fixes for discovered extensions
- Session token tracking and related session-link fixes
- Clipboard and native integration improvements
- Nano Banana 2 image-generation pipeline upgrade
- Fork-local bundled Danger Pi extensions now live in `packages/coding-agent/src/danger-pi/extensions/index.ts` and are wired directly into `sdk.ts` inline extensions, separate from filesystem-discovered user/project extensions

### Notes
- The display tool is intentionally extensible; image and color are the current built-in types, not the entire design surface.
- Inline image rendering improvements refer to image handling only, not color previews.
