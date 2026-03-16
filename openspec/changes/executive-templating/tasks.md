## 1. Shared Shell-Interpolation Helper

- [x] 1.1 Add one helper module dedicated to post-render shell interpolation; keep discovery, frontmatter parsing, and metadata assembly out of this helper
- [x] 1.2 In that helper, scan body text left-to-right for single-line ``!`...` `` matches only
- [x] 1.3 Treat `!` followed by an unclosed backtick sequence on the same line as malformed input and return/throw a source-aware error
- [x] 1.4 Execute matched commands through an existing shell path (`@oh-my-pi/pi-natives` preferred, Bun Shell acceptable) without adding a new third-party dependency
- [x] 1.5 Replace each successful match with stdout after trimming exactly one trailing newline while preserving interior newlines
- [x] 1.6 Ensure multiple matches execute independently in left-to-right order with no memoization or recursive re-scanning of replacement text
- [x] 1.7 Format failure messages so they include the failing source label and command text

## 2. Native Command and Skill Integration

- [x] 2.1 Update the native markdown command path in `src/extensibility/slash-commands.ts` to call the helper after argument substitution and Handlebars rendering
- [x] 2.2 Preserve the existing command expansion order; insert shell interpolation as a new step rather than rewriting the pipeline
- [x] 2.3 Ensure only native OMP command sources use the helper and leave non-native command sources literal
- [x] 2.4 Update `/skill:` handling in `src/modes/controllers/input-controller.ts` to run the helper on the stripped body before appending metadata lines
- [x] 2.5 Keep skill frontmatter literal by ensuring the helper receives body text only
- [x] 2.6 Ensure skill metadata lines (`Skill:`, `Do not read`, `User:`) are appended after shell interpolation and are never scanned for shell expressions

## 3. Verification Coverage

- [x] 3.1 Add helper-level tests for one valid single-line expression and for multiple left-to-right expressions in one body
- [x] 3.2 Add helper-level tests for malformed syntax: missing closing backtick and newline before closing backtick
- [x] 3.3 Add helper-level tests for non-zero exit and confirm the error includes source label plus command text
- [x] 3.4 Add command-path tests proving Handlebars-generated expressions are executed only after render
- [x] 3.5 Add command-path tests proving command frontmatter remains literal
- [x] 3.6 Add skill-path tests proving native skill bodies interpolate shell output before metadata is appended
- [x] 3.7 Add skill-path tests proving skill frontmatter and metadata lines are not scanned for shell expressions
- [x] 3.8 Run the relevant package-local checks for the changed files and record any unrelated failures separately
