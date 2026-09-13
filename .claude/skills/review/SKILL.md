---
name: review
description: Use when a stage of the Velocity Growth portal is implemented and needs review before the user decides whether to commit, or when the user types /review.
---

# Review

Dispatch the `reviewer` agent on the uncommitted diff. If the diff touches `supabase/`, `app/api/`, `app/share/`, Edge Functions, auth, or anything reading `SUPABASE_SERVICE_ROLE_KEY` or `PROVIDER_API_KEY`, also dispatch `security-reviewer`. Run both in parallel.

Relay every finding to the user unchanged, most severe first, keeping the CONFIRMED and INFERRED markers. Then fix CONFIRMED blocking findings, re-run the agent that raised them, and report the second pass.

Never commit. End with: "Review done. Blocking findings remaining: N."
