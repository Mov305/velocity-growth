---
name: stage-done
description: Use when a build stage of the Velocity Growth portal is believed complete and the user needs to decide whether to commit it, or when the user types /stage-done.
---

# Stage done

Run in order, stopping on the first that is not clean:

1. `/lint` until typecheck, ESLint and Prettier are clean.
2. `/test` until every suite that should run is green and none is NOT RUN without a reason the user has accepted.
3. `/review` until blocking findings are zero.
4. If the stage changed `supabase/migrations`, regenerate `schema.sql` and confirm it is in the diff.
5. Update `README.md` if the stage changed architecture, a decision, or a definition shown on screen.

Then print a stage summary: files changed, what was verified with which command, what is inferred or unknown, and a proposed Conventional Commit message.

Then STOP. Ask exactly: "Stage verified. Ready to commit with the message above?" Do not run `git add` or `git commit` until the user answers yes in their next message. A yes to a previous stage does not carry over.
