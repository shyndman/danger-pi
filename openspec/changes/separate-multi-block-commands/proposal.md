## Why

In `runMultiBlockSubmission` (packages/coding-agent/src/modes/controllers/multi-block-runner.ts) every text block or file-command expansion is appended to a `textParts` array, then the helper emits one trimmed string at the end. The `InputController` submits that single string, so the transcript always shows just the final message even if the user stacked multiple commands. Builtin and file commands run through `executeBuiltinSlashCommand` or `expandSlashCommand`, but their output never becomes a chat entry; only `/skill:` commands surface because `#handleSkillCommand` calls `session.promptCustomMessage`. Junior engineers supporting users cannot replay the exact sequence that ran, which makes debugging multi-step routines difficult. Preserving ordering is also a prerequisite for auditing what files or tools were touched inside a stacked submission.

## What Changes

- During a multi-block submission, treat every block (text, builtin slash command, file slash command, skill command) as a distinct chat entry that appears immediately before moving to the next block.
- Builtin and file-based slash commands must reuse the same renderer logic (tool renderers declared in packages/coding-agent/src/tools/renderers.ts, e.g., `apply_patch`) as when executed alone so users see summaries, diffstats, diagnostics, etc., rather than silent inline replacement.
- When text appears before or after commands, queue it as its own follow-up entry instead of concatenating it into a single blob. The final text block is still what wakes the agent, but earlier text blocks must show up in the transcript for context.

## Capabilities

### New Capabilities
- `multi-block-ordered-output`: Guarantee multi-block submissions replay text and slash command blocks sequentially as distinct chat entries. This capability explicitly covers editor history updates, suppress-turn handling, and renderer parity so an engineer knows to touch the controller, runner helper, and UI components together.

### Modified Capabilities
- `<none>`

## Impact

- `packages/coding-agent/src/modes/controllers/multi-block-runner.ts`: orchestration logic must emit messages per block.
- `packages/coding-agent/src/modes/controllers/input-controller.ts`: needs to route text blocks through session prompt/follow-up APIs and update editor history per block.
- `packages/coding-agent/src/tools/renderers.ts` and the command-specific components it references must be ready to render repeated command entries triggered within a single submission.
- Downstream tests in `packages/coding-agent/test/input-controller-multi-block.test.ts` and any renderer-specific suites require updates to model the new ordering.
