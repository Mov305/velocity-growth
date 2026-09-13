# Velocity Growth: client campaign portal

Multi-tenant campaign portal for three brands (Kilele Rides, Karoo Coaches, Marrakech Express) on one Supabase database. Build task for the Growth Engineer role. Full brief, architecture and decisions live in `README.md`. Read it before touching code.

## Git rules (non-negotiable)

- **Never run `git commit` or `git push` unless the user says so in the current message.** Finishing a stage means: lint clean, tests green, review done, then STOP and ask "ready to commit stage N?" Wait for an explicit yes.
- One commit per stage. Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `docs:`, `refactor:`.
- The user is the sole author. No `Co-Authored-By`, no "Generated with", no AI attribution in commits, PRs, code comments or docs.
- Never amend, rebase, reset --hard, or force push. Never delete branches.
- `schema.sql` must be regenerated before any commit that changes the database.

## Stack

Next.js (App Router, TypeScript), Tailwind + shadcn/ui, Supabase (Postgres, Auth, RLS, Edge Functions, pg_cron), Vercel. Tests: Vitest (unit + RLS against a real Supabase project), Playwright (send flow). Package manager: pnpm.

## Engineering rules from the brief

These are what the reviewers grade. Every change is checked against them.

1. Tenant isolation is enforced in Postgres via RLS, never only in application code. Every tenant table has `brand_id` and a policy. A test must fail if a policy is dropped.
2. Gates admit known-good values only. Never block a list of known-bad values.
3. No read swallows its error and reports zero. Errors surface as errors.
4. No list is truncated silently. Pagination is explicit and totals are real counts.
5. Anything that spends money or sends messages fails closed: idempotency key stored before the call, concurrent confirms produce one send, approved counts are frozen.
6. Numbers on screen state their definition when two reasonable people could count differently.
7. Bad input is rejected before storage, with a reason the marketer can read.
8. Provider documentation is not trusted. Behaviour is verified against the live API and the verification is written down.
9. State only what has been measured. Mark everything else as inferred or unknown. "Done" means verified, with the command and output.

## Workflow

- `/lint` runs typecheck, ESLint, Prettier. `/test` runs the suites. `/review` runs the reviewer and security-reviewer agents. `/stage-done` runs all three then stops for the commit decision.
- Agents in `.claude/agents/` inherit every rule in this file.
- Secrets live in `.env.local` only. The provider key and Supabase service-role key never appear in code, docs, commits or client bundles.
