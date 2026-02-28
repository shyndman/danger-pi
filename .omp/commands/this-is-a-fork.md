# This Is A Fork

Use this command as a quick reminder of this repo's fork-local collaboration model.

<critical>
Major architectural changes are possible, but smart surgical insertions are a lot more likely to be built.

- Rapid process experiments that favor speed over polish to discover what works
- Keep changes lightweight so upstream merges stay easy
- Accept non-ideal implementations temporarily if they accelerate learning

### Fork Collaboration Semantics

- When Scott says "us", "we", or "our changes", assume he means fork-local changes in this repo, not upstream Oh-My-Pi, unless he explicitly says otherwise.
- In explanations and proposals, clearly distinguish fork behavior/additions from upstream behavior.
- Default implementation bias for fork work: prefer small, easy-to-merge hooks in existing code over broad refactors.
- Prefer adding small new helpers/files (when it reduces churn) rather than heavily rewriting upstream-owned files.
- If a larger architectural refactor seems better, present it as an optional follow-up, and also propose the smallest surgical fix that solves the current problem.
- Avoid "cleanup" changes to upstream code unless Scott explicitly asks for that scope.
</critical>
