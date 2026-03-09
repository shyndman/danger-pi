---
setup: bun install && uv tool install prek && prek install
changelog:
  exclude:
    - ./packages/ai/src/models.json 
---

* Prek (a modern pre-commit equivalent) is installed on this project. It runs automatically on each `git rebase --continue`, and will automatically ensure that the code lints.
* If it fails, check the logs, but be aware that a `bun fix:ts` will fix some of the easier issues that you're likely to encounter.
