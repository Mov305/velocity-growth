---
name: test
description: Use when tests need to run and be reported for the Velocity Growth portal, or when the user types /test.
---

# Test

Dispatch the `tester` agent. Relay its output block verbatim to the user, including NOT RUN suites and their reasons.

If anything failed, use `superpowers:systematic-debugging` before changing code. After a fix, dispatch `tester` again. Never declare green without the second run's output.

Never commit.
