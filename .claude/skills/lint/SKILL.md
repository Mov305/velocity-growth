---
name: lint
description: Use when the Velocity Growth portal needs typecheck, ESLint and Prettier run and lint problems fixed, or when the user types /lint.
---

# Lint

Dispatch the `linter` agent. Relay its output block verbatim. Type errors it reports are yours to fix in the main session, then dispatch `linter` again to confirm clean.

Never commit.
