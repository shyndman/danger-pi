## Context

User submissions currently flow through a single string pipeline: InputController trims the entire editor content, handles builtin slash/skill/bang prefixes in-place, and finally calls `session.prompt()` with whatever remains. This XOR design makes multi-step workflows (e.g., `/plan` + `!bash` + instructions) impossible without multiple sequential turns. We need a deterministic way to split a single submission into a series of logical blocks while reusing existing handlers and preserving ordering and error semantics.

## Goals / Non-Goals

**Goals:**
- Allow a single submission to contain multiple blocks (slash commands, skill injections, plain text) processed sequentially.
- Keep existing handler contracts intact (no signature changes) by orchestrating from a higher-level splitter.
- Ensure only the final user-text block triggers the LLM turn; earlier context blocks append without prompting.
- Provide clear delimiter syntax + UX hints so operators understand batching rules.

**Non-Goals:**
- Supporting UI/interactive slash commands in batches (they continue to short-circuit as today).
- Changing bash/python behavior (they remain standalone submissions outside this feature).
- Reworking the slash-command discovery/runtime stack beyond batching awareness.

## Decisions

1. **Parser without new delimiters**  
   - Implement `splitSubmissionIntoBlocks(text: string): Block[]` that walks the submission line-by-line. Any line beginning with `/` that matches a builtin slash command, `/skill`, or discovered file command becomes its own command block; everything else is accumulated into plain-text blocks preserving order.  
   - Because there are no special fences, the parser must treat unrecognized `/foo` lines as plain text so existing transcripts remain valid, and it must preserve blank lines/indentation inside text blocks.

2. **Block Execution Loop**  
   - Introduce `processBlocks(blocks)` inside InputController. For each block:  
     a. Run builtin slash handler; if it consumes the block or is UI-type, stop further processing.  
     b. For `/skill` blocks, call `session.sendCustomMessage(..., { triggerTurn: false })` to append content.  
     c. For plain text (the “everything else” accumulation), collect the text for eventual `session.prompt()`.  
   - If multiple plain-text spans occur (e.g., text between command blocks), concatenate them with blank lines in submission order before prompting.

3. **Non-Turn Custom Messages**  
   - Add `triggerTurn?: boolean` (default true) to `promptCustomMessage`, forwarding to `sendCustomMessage`. Splitter passes `false` so batched slash/skill content queues without prompting; standalone `/skill` keeps current behavior.

4. **State & UX Updates**  
   - Editor history stores the original multi-block submission for recall.  
   - Help overlays (`/help`, slash command docs) gain a “Multi-block submissions” section describing delimiters, eligible commands, and safeguards.

## Risks / Trade-offs

- **Delimiter ambiguity** → Mitigate with explicit syntax (`---`) and validation errors if malformed blocks are detected.  
- **Handler side effects**: Some slash commands assume exclusive control; we restrict batching to non-UI commands and bail out if the splitter detects disallowed commands.  
- **Unexpected turn ordering**: Ensuring only the final block triggers the model requires careful testing so queued custom messages flush before `session.prompt()` executes.  
- **Backwards compatibility**: Existing workflows must behave identically when no delimiters are present; regression tests cover single-block submissions.
