## Context

OMP-native slash commands already run a two-step expansion path: argument substitution (`$1`, `$@`, `$ARGUMENTS`) followed by Handlebars rendering. OMP-native skills do not share that pipeline; `/skill:<name>` currently reads `SKILL.md`, strips frontmatter, and injects the body verbatim plus metadata. The requested change is to add Claude-style single-line shell interpolation using ``!`...` `` for fork-local OMP sources only.

The feature boundary is intentionally narrow:
- native OMP command bodies and native OMP skill bodies only
- body content only; frontmatter stays static
- single-line expressions only
- execution uses session cwd and inherited environment
- successful output trims one trailing newline; failures surface immediately and abort expansion

Existing code paths already give us two integration points:
- `src/extensibility/slash-commands.ts` and `src/config/prompt-templates.ts` for command/template rendering
- `src/modes/controllers/input-controller.ts` for `/skill:` injection

For a junior engineer, the important existing flow is:
1. Native markdown commands are discovered by the native provider in `src/discovery/builtin.ts`.
2. When a user types `/name ...`, `expandSlashCommand()` in `src/extensibility/slash-commands.ts` parses args, substitutes `$1` / `$@` / `$ARGUMENTS`, then calls `renderPromptTemplate()`.
3. `renderPromptTemplate()` in `src/config/prompt-templates.ts` is the last shared text-render step before the command body is returned.
4. Native skills are discovered by the same provider and later invoked through `#handleSkillCommand()` in `src/modes/controllers/input-controller.ts`.
5. `#handleSkillCommand()` currently reads the skill file, strips frontmatter, appends metadata lines, and sends the final message to the session. It does not currently run Handlebars or any shell interpolation.

That means the implementation is not “find one universal templating pipeline.” It is “add one reusable post-render/body-expansion helper, then call it from the command path and the skill path at the right moment.”

Verified runtime options mean this change does not require a new third-party dependency:
- `@oh-my-pi/pi-natives` is already a workspace dependency of `packages/coding-agent` and exports `executeShell(options, onChunk?)` plus typed shell execution options/results through `packages/natives/src/shell/index.ts`.
- Bun already ships `import { $ } from "bun"` shell execution, documented at `bun.sh/docs/runtime/shell`, including `.cwd(...)`, `.quiet()`, `.text()`, and non-zero-exit handling.
- Because the syntax target is a simple single-line post-render text substitution, no parser package is required.

## Goals / Non-Goals

**Goals:**
- Add Claude-style ``!`...` `` shell interpolation to native OMP command bodies after Handlebars rendering.
- Extend the same interpolation behavior to native OMP skill bodies.
- Keep semantics small and predictable: one pass, left-to-right, no caching, no recursion, no multiline syntax.
- Surface shell failures with actionable visible errors instead of silently degrading prompt content.
- Keep the change fork-local and easy to upstream-merge around by using small shared helpers rather than broad pipeline rewrites.

**Non-Goals:**
- No support for non-native command or skill sources (`.claude`, `.codex`, plugins, etc.).
- No frontmatter expansion.
- No multiline or nested shell-expression syntax.
- No sandboxing or environment filtering beyond current session behavior.
- No general-purpose Handlebars shell helper or shell DSL.

## Decisions

1. **Run shell interpolation as a post-render text pass.**
   - Handlebars remains the primary templating language. It decides which text exists; the shell layer only processes literal ``!`...` `` sequences in the rendered body.
   - This lets conditionals and loops decide whether a shell expression is emitted.
   - Alternative rejected: pre-render interpolation. That would make shell output part of template control flow and invert the intended precedence.

2. **Use one shared helper for command and skill body expansion.**
   - The helper should accept rendered body text plus execution context (`cwd`, env inheritance, source label) and return fully expanded text or a structured error.
   - Commands and skills keep their existing orchestration paths, but both call the same helper for the shell-expression phase.
   - Alternative rejected: duplicate scanners in slash-command/template expansion and `/skill:` injection.

3. **Keep source gating explicit and native-only.**
   - Only OMP-native command and skill bodies opt into this feature. Imported Claude/Codex-compatible sources remain literal even if they contain ``!`...` ``.
   - This preserves the current trust boundary and avoids surprising behavior in imported content.
   - Alternative rejected: enable interpolation across all discovered command/skill sources.

4. **Adopt strict, minimal syntax semantics.**
   - Only single-line ``!`...` `` expressions are recognized.
   - Each occurrence executes independently in left-to-right order.
   - Output replacement trims exactly one trailing newline and preserves interior newlines.
   - Alternative rejected: multiline parsing, escaping schemes, memoization, or recursive expansion.

5. **Fail hard on shell errors and malformed matches.**
   - Non-zero exit, timeout, or malformed expression handling should abort expansion and tell the user which command/skill failed plus the command text and execution failure details.
   - Alternative rejected: replacing failures with empty strings or passing malformed syntax through silently, which would make prompt content untrustworthy.

6. **Stay dependency-free for v1.**
   - Preferred implementation uses the existing `@oh-my-pi/pi-natives` shell API because it already matches the package's current shell-execution path and typed result model.
   - Acceptable fallback is Bun Shell (`$`) if the native API proves awkward for this narrow use case; it also requires no new package.
   - Alternative rejected: adding parser or process-wrapper dependencies such as shell-quote/execa before a concrete limitation appears.

## Implementation Outline

This section is intentionally procedural. A junior engineer should be able to follow it in order.

### 1. Add one small helper module

Create one helper in a narrow, reusable location such as `src/extensibility/` or `src/config/`.

The helper's job is only this:
- input: already-rendered body text and execution context
- output: body text with every valid ``!`...` `` occurrence replaced, or an error

The helper should not:
- parse frontmatter
- discover commands or skills
- append skill metadata
- decide whether a source is native or non-native

Recommended input shape:
- `body: string`
- `cwd: string`
- `sourceLabel: string` for error messages, such as `/breakage` or `skill:explore`

Recommended behavior inside the helper:
1. Scan the body text from left to right.
2. Find the next literal `!`` sequence.
3. Read until the next backtick on the same line.
4. If no closing backtick exists before newline/end-of-text, treat it as malformed and throw/return an error.
5. Execute only the text inside the backticks.
6. Replace the matched range with stdout after trimming exactly one trailing newline.
7. Continue scanning after the replacement.

### 2. Keep the parser intentionally dumb

Do not build a general markdown parser or shell parser.

For v1, a match is valid only when all of these are true:
- it starts with the exact two characters `!` followed by backtick
- it ends at the next backtick
- no newline appears before that closing backtick

Everything else is an error or plain text depending on the chosen branch:
- valid closed single-line expression → execute it
- starts with `!`` but never closes before newline/end → hard error
- ordinary backticks without leading `!` → ignore

This keeps the helper small and testable.

### 3. Use the existing shell execution path

Prefer `@oh-my-pi/pi-natives.executeShell(...)`.

The junior engineer should mirror existing patterns from:
- `src/config/resolve-config-value.ts`
- `src/exec/bash-executor.ts`

The minimum required execution settings are:
- `command`: extracted text inside ``!`...` ``
- `cwd`: session cwd from the caller
- inherited environment
- timeout: choose an explicit value during implementation rather than leaving it implicit

The shell helper must treat these outcomes differently:
- exit code `0` and not timed out/cancelled → success
- non-zero exit → visible failure
- timed out → visible failure
- cancelled/exception → visible failure

### 4. Integrate commands after existing render

In `src/extensibility/slash-commands.ts`, do not replace argument substitution or Handlebars rendering.

Keep the current order:
1. parse args
2. substitute `$1` / `$@` / `$ARGUMENTS`
3. render Handlebars
4. run the new shell-expansion helper
5. apply existing inline-args fallback behavior if still appropriate after expansion

The important point for a junior engineer: shell expansion is a new step inserted into the existing command pipeline, not a rewrite of the command pipeline.

### 5. Integrate skills on the body before metadata append

In `#handleSkillCommand()` inside `src/modes/controllers/input-controller.ts`:
1. read `SKILL.md`
2. strip frontmatter as today
3. run the new shell-expansion helper on the body only
4. append the metadata block (`Skill: ...`, `Do not read...`, `User: ...`)
5. send the final message

Do not run shell expansion on the metadata lines.
Do not run shell expansion on frontmatter.

### 6. Gate by source at the call site

The helper itself should not know about provider IDs or native-vs-non-native discovery.

Instead, the caller should decide whether to invoke the helper.

That means:
- native markdown command path invokes helper
- native skill invocation path invokes helper
- other sources keep current literal behavior

This keeps the helper reusable and easy to reason about.

### 7. Make failure messages specific

Do not return vague errors like `Shell command failed for pattern {}`.

A useful failure message should include:
- which source failed (`/breakage`, `skill:foo`, or file path if needed)
- the exact command text that was attempted
- whether the failure was malformed syntax, non-zero exit, timeout, or cancellation

The implementation does not need a complicated error class hierarchy. One small structured error type or one helper that formats consistent `Error` messages is enough.

## Risks / Trade-offs

- **[Post-render scanning may activate text generated by Handlebars unexpectedly]** → This is intentional and documented as the contract; only literal rendered ``!`...` `` sequences run.
- **[Skills and commands currently use different body-preparation paths]** → Use one shared expansion helper and keep call-site integration thin.
- **[Inherited environment makes behavior machine-specific]** → Accept this as an explicit fork-local trade-off for fast local workflows.
- **[Strict single-line syntax may feel limiting]** → Keep v1 narrow; multiline support can be a future change if a real need appears.
- **[Error messaging can leak too little or too much]** → Include source label and command text, plus concrete execution failure details, but avoid vague placeholder-only errors.
- **[Choosing between native shell APIs adds implementation drift risk]** → Prefer `@oh-my-pi/pi-natives.executeShell`, which is already used in coding-agent config resolution and bash execution.

## Migration Plan

- Add the post-render interpolation helper.
- Wire native command rendering through the helper after Handlebars rendering.
- Wire native skill body injection through the same helper before metadata is appended and injected.
- Rollback is straightforward: remove the helper wiring and OMP-native bodies return to current literal behavior.

## Verification Plan

A junior engineer should verify in this order:

1. **Helper unit tests**
   - one valid expression
   - multiple expressions in one body
   - Handlebars-generated expression reaches the helper as literal rendered text
   - malformed `!`` sequence fails
   - non-zero exit fails

2. **Command-path tests**
   - native markdown command executes shell interpolation
   - non-native command source does not

3. **Skill-path tests**
   - native skill body executes shell interpolation
   - skill frontmatter stays literal
   - metadata block is appended after interpolation, not before

4. **Package-level verification**
   - run the smallest relevant `bun` check/test commands for the touched package only

The goal is to catch pipeline-order mistakes early. Most likely bugs here are “helper called too early,” “helper called on frontmatter/metadata,” or “helper accidentally runs for the wrong source type.”

## Open Questions

- None for this change. The desired scope and semantics are pinned down enough to implement directly.
