# Velocity Growth: client campaign portal

A multi-tenant campaign portal for three brands on one Supabase database. Each brand's marketing team signs in, sees its own contacts, campaigns and dashboard, sends campaigns through the VG messaging provider, and publishes password-protected result pages for clients without a login.

Brands: Kilele Rides (Kenya, ~81k contacts), Karoo Coaches (South Africa, ~12.5k), Marrakech Express (Morocco, ~930).

> Status: stage 4 (dashboard) built. Hosted Supabase project migrated, seeded and loaded with the full data; Google sign-in configured; app not yet deployed. Sections marked **decision** are settled.

---

## 1. Requirements, as I read them

Eleven business rules from the brief, translated into what has to be true in the code.

| #   | Rule in the brief                                                     | What it means here                                                                                                                                             |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Six logins, owners send, analysts look, strangers get nothing         | Pre-provisioned users only. Google sign-in must resolve to one of the six or be refused at the database, not the UI.                                           |
| 2   | A brand sees only its own data, on every route, including future ones | Row Level Security on every tenant table. The app never filters by brand in JavaScript as the guarantee.                                                       |
| 3   | Data loads, marketer sees what did not, re-import is idempotent       | Import writes rejects with reasons to a table the UI shows. Upsert on `(brand_id, external_id)`.                                                               |
| 4   | Numbers are right, and say how they were counted                      | Every aggregate is computed in SQL and carries a definition string rendered next to it.                                                                        |
| 5   | Usable at 81k as at 930                                               | Server-side pagination, indexes on every filter column, aggregates never computed in the browser.                                                              |
| 6   | Sending is safe and honest                                            | Audience frozen at approval. Idempotency key stored before the provider call. Concurrent confirms collapse to one dispatch via a database state transition.    |
| 7   | Provider talks back while the app is not looking                      | A scheduled job inside Supabase polls the provider. Events deduplicated on provider event id, ordering never assumed.                                          |
| 8   | A test fails if isolation is removed                                  | An automated suite signs in as each user and asserts cross-brand reads return nothing, plus a catalog test asserting RLS is enabled on every `brand_id` table. |
| 9   | Shared link is stranger-safe                                          | 256-bit token, hashed at rest. Password hashed with bcrypt. Attempt lockout. Renders one campaign's aggregates, no contact rows.                               |
| 10  | Bad input rejected, states are explicit                               | Zod allow-list validation at every boundary. Loading, empty and error states on every view.                                                                    |
| 11  | A real app, phone and laptop                                          | Responsive layout, deployed on Vercel.                                                                                                                         |

## 2. What the seed data actually contains

Measured on 13 Sep 2026 from the zip (SHA-256 verified). These shape the import rules.

| Trap                                    | Where                                                                                                                                                            | Rule adopted                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three column dialects                   | Karoo uses `Full Name`, `Email`, `External Id`; Marrakech uses `e_mail`, `mobile`, `pays` with `;` delimiter and `,` decimals; Kilele uses snake_case with a BOM | One canonical schema. Per-brand header alias map in the import config.                                                                                   |
| Windows-1252 encoding                   | Karoo contacts                                                                                                                                                   | Decode as UTF-8, fall back to cp1252 on failure, record encoding in the import row.                                                                      |
| Repeated header row mid-file            | Kilele contacts, row ~42k                                                                                                                                        | Reject rows whose id equals the header name.                                                                                                             |
| Column-shifted rows                     | 46 in Karoo, 15 in Marrakech (`country = ZZ`)                                                                                                                    | Reject: id fails the `CT-\d+` allow-list pattern.                                                                                                        |
| Rows tagged with another brand          | 312 `KAROO` rows inside the Kilele file (emails `leak.kar.*`), 88 `KILELE` rows inside Karoo                                                                     | The file's brand wins. Rows whose `brand_code` disagrees are rejected with reason `brand_code mismatch`. They never enter the other brand.               |
| Duplicate ids, some conflicting         | Kilele 2,778 ids appear twice, 368 with different values                                                                                                         | Last row in the file wins. Delta file applied after base. Recorded in `contacts.source_import_id`, which links to `imports.file_name`.                   |
| Cross-brand id collisions               | Kilele and Karoo share 12,407 external ids                                                                                                                       | Uniqueness is `(brand_id, external_id)`. Provider recipient id is our UUID, never the external id.                                                       |
| Eleven spellings of a boolean           | `true/1/TRUE/yes/Y` and `0/no/FALSE/false/f` plus empty                                                                                                          | Allow-list normaliser. Empty consent is `false` (no consent recorded). Anything else rejected.                                                           |
| Status variants                         | `active`, `ACTIVE`, `active `, `Active`, `unsubscribe`                                                                                                           | Trim, lowercase, map `unsubscribe` to `unsubscribed`. Allow-list: active, unsubscribed, bounced, pending.                                                |
| Country variants                        | `KE`, `KEN`, `kenya`, `Kenya`, `ke `, `254`, `NULL`, `null`, `none`                                                                                              | Normalise to ISO-2 via allow-list map. `254`, `NULL`, `none` become null country, row kept, `notes` flagged.                                             |
| Three date formats                      | ISO, `YYYY-MM-DD`, `DD/MM/YYYY HH:MM`                                                                                                                            | Parse all three. Day-first for the slash form (Kenya locale). Unparseable dates reject the row.                                                          |
| Phones in scientific notation           | 44 Kilele rows like `2.54E+11`                                                                                                                                   | Kept, phone set null, flagged `phone_corrupted`. Same rule as email: a bad optional field never drops a contact. Rejecting dropped 145 events with them. |
| Invalid emails                          | 389 in Kilele (`john doe@`, `no-tld@vg-eval`, `double@@`)                                                                                                        | Row kept, email set null, flagged `email invalid`. Contact is not contactable by email.                                                                  |
| Duplicate campaigns                     | `CMP-014` and `KIL-0044` twice in Kilele                                                                                                                         | Last row wins on `(brand_id, external_id)`.                                                                                                              |
| Cross-brand campaign parent             | Karoo `CMP-014` has parent `KIL-0007`, a Kilele campaign                                                                                                         | Parent resolved within brand only. Unresolvable parent stored as text, not a foreign key, and flagged.                                                   |
| Orphan events                           | Marrakech has 633 events for 12 campaigns (MAR-0007 to MAR-0018) absent from its campaign file                                                                   | **Decision:** rejected with reason `unknown campaign <id>`, shown in the imports view. No placeholder campaigns are invented.                            |
| Duplicate event ids                     | 8,310 in Kilele, 4,735 in Karoo                                                                                                                                  | Uniqueness `(brand_id, event_id)`. Second occurrence skipped and counted.                                                                                |
| Reported opens exceed delivered         | `KIL-0016`: 12,679 opens, 10,108 delivered                                                                                                                       | Reported figures are total events. Dashboard labels "reported by brand (total)" vs "observed in event log (unique contacts)".                            |
| Event log is a tenth of reported volume | Every brand                                                                                                                                                      | Two sources, both shown, both labelled. Neither is silently preferred.                                                                                   |
| Last 30 days of signups is nearly empty | Only the Kilele delta has August signups; Karoo and Marrakech have none after April                                                                              | Chart renders an explicit "no signups in this window" state with the date range shown.                                                                   |
| Send log retry                          | `BATCH-0003` appears three times                                                                                                                                 | Imported as three attempts of one batch. It is the seed's own idempotency example.                                                                       |

### 2.1 Measured import, local stack, 2026-09-14

`pnpm import:seed --all` twice in a row after `pnpm db:reset`. Pass 2 columns show where the second run differs.

| File                                 | Read    | Upserted | Rejected | Dup skipped | Encoding     | Pass 2 upserted | Pass 2 already present |
| ------------------------------------ | ------- | -------- | -------- | ----------- | ------------ | --------------- | ---------------------- |
| kilele-contacts.csv                  | 83,993  | 80,829   | 386      | 2,778       | utf-8        | 80,829          | 0                      |
| kilele-contacts-delta-2026-09-01.csv | 4,180   | 4,180    | 0        | 0           | utf-8        | 4,180           | 0                      |
| kilele-campaigns.csv                 | 46      | 44       | 0        | 2           | utf-8        | 44              | 0                      |
| kilele-events.csv                    | 312,000 | 303,588  | 0        | 8,412       | utf-8        | 0               | 303,588                |
| kilele-send-log.csv                  | 9       | 9        | 0        | 0           | utf-8        | 9               | 0                      |
| karoo-contacts.csv                   | 13,042  | 12,406   | 134      | 502         | windows-1252 | 12,406          | 0                      |
| karoo-campaigns.csv                  | 19      | 19       | 0        | 0           | utf-8        | 19              | 0                      |
| karoo-events.csv                     | 74,000  | 69,100   | 0        | 4,900       | utf-8        | 0               | 69,100                 |
| marrakech-contacts.csv               | 957     | 918      | 15       | 24          | utf-8        | 918             | 0                      |
| marrakech-campaigns.csv              | 6       | 6        | 0        | 0           | utf-8        | 6               | 0                      |
| marrakech-events.csv                 | 940     | 307      | 633      | 0           | utf-8        | 0               | 307                    |

"Upserted" is rows written on that pass. On pass 2 contacts, campaigns and send-log rows are rewritten in place; events are immutable facts, so a known event id inserts nothing and is counted as "already present". For every file and pass, read = upserted + rejected + duplicates skipped + already present, and the integration test asserts that arithmetic. Row counts per brand are identical after both passes: Kilele 82,509 contacts (82,114 not deleted), 44 campaigns, 303,588 events; Karoo 12,406 contacts, 19 campaigns, 69,100 events; Marrakech 918 contacts, 6 campaigns, 307 events.

Reject reasons, first pass:

| File                   | Reason                                               | Rows |
| ---------------------- | ---------------------------------------------------- | ---- |
| kilele-contacts.csv    | brand_code mismatch: KAROO in KILELE file            | 312  |
| kilele-contacts.csv    | row has 9 or 7 columns, expected 13                  | 70   |
| kilele-contacts.csv    | full_name contains a NUL byte                        | 3    |
| kilele-contacts.csv    | external_id malformed: external_id (repeated header) | 1    |
| karoo-contacts.csv     | brand_code mismatch: KILELE in KAROO file            | 88   |
| karoo-contacts.csv     | row has 9 or 7 columns, expected 13                  | 46   |
| marrakech-contacts.csv | row has 9 or 7 columns, expected 13                  | 15   |
| marrakech-events.csv   | unknown campaign MAR-0007 to MAR-0018                | 633  |

Flags on kept Kilele contacts: `consent_missing` 9,484, `country_unrecognised` 2,673, `email_invalid` 1,383, `phone_corrupted` 44. The Karoo campaign `CMP-014` keeps `parent_external_id = KIL-0007` and is flagged `parent_unresolved`; it is never linked across brands. `BATCH-0003` in the send log is stored as attempts 1, 2 and 3.

## 3. Provider findings

Base URL `https://dispatcher-production-72fc.up.railway.app`. Verified on 13 Sep 2026: `/healthz` returns 200, `/v1/messages/{id}/events` returns 401 without a key and 404 with a key for an unknown batch. No message has been sent yet.

The docs claim the event stream is "clean and complete: every event is delivered exactly once and in order". The brief says reports will be "deliberately messy and out of order". **Decision:** trust the brief. Dedupe on event id, tolerate any order, treat `since` as a hint not a guarantee.

The docs list event types `delivered, bounced, opened, unsubscribed`. The seed event log uses `bounce, click, open, complaint, unsubscribe`. **Decision:** one internal enum with a mapping table for both vocabularies; unknown types are stored raw and flagged, never dropped.

The docs call `Idempotency-Key` optional. **Decision:** mandatory for every dispatch; the key is the send id, stored before the call.

## 4. Architecture

**Decision:** Next.js App Router (TypeScript) on Vercel for the UI and server actions. Supabase for Postgres, Auth, RLS, Edge Functions and pg_cron. Tailwind and shadcn/ui. Vitest and Playwright.

```
Browser ──► Next.js (Vercel)
              │  server actions / route handlers, user JWT
              ▼
            Supabase Postgres  ◄── RLS on every tenant table (the guarantee)
              │ ▲
              │ └── pg_cron every minute ──► Edge Function poll-provider ──► GET /v1/messages/{batch}/events
              │
              └── Edge Function dispatch-send ──► POST /v1/messages (Idempotency-Key = send id)

/share/[token] ──► Next.js route handler, service role, reads one share_link → one campaign's aggregates
```

### 4.1 Tables

Every tenant table has `brand_id uuid not null references brands`, RLS enabled and forced, and a policy `brand_id in (select brand_id from memberships where user_id = auth.uid())` for select, with `with check` on writes.

| Table               | Purpose                                                                                                                                         | Unique key                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `brands`            | The three tenants                                                                                                                               | `code`                         |
| `memberships`       | user → brand → role (`owner`, `analyst`)                                                                                                        | `(user_id, brand_id)`          |
| `allowed_emails`    | The six pre-provisioned logins. A trigger on `auth.users` refuses any sign-up whose email is not here, which is what makes Google sign-in safe. | `email`                        |
| `contacts`          | Canonical contact                                                                                                                               | `(brand_id, external_id)`      |
| `campaigns`         | Canonical campaign with reported figures                                                                                                        | `(brand_id, external_id)`      |
| `engagement_events` | Seed event log                                                                                                                                  | `(brand_id, event_id)`         |
| `imports`           | One row per file load: counts, status, encoding, started and finished                                                                           |                                |
| `import_rejects`    | Every rejected row: raw JSON, row number, reason                                                                                                |                                |
| `sends`             | Lifecycle of one send: `approved → dispatching → dispatched → failed`, approved count, idempotency key, provider batch id, poll cursor          | `idempotency_key`              |
| `send_recipients`   | The frozen audience and per-recipient provider status                                                                                           | `(send_id, contact_id)`        |
| `provider_events`   | Raw events from the provider                                                                                                                    | `(send_id, provider_event_id)` |
| `share_links`       | Token hash, bcrypt password hash, campaign, expiry, revoked, attempt counter                                                                    | `token_hash`                   |

### 4.2 Isolation

**Where the guarantee lives:** `supabase/migrations/20260914000200_rls.sql`. Every table in `public` has RLS enabled and forced (so the table owner is not exempt). Every tenant table has one `select` policy: `brand_id in (select app.user_brand_ids())`, where `app.user_brand_ids()` is a `security definer` function reading `memberships` for `auth.uid()`. No client role has any insert, update or delete grant on any table; writes only happen through `security definer` functions that re-check membership. `anon` has no grants at all. `allowed_emails` has RLS forced, no policy and no grants, so nothing reads it but the service role.

**Who may log in:** `supabase/migrations/20260914000300_auth_gate.sql`. A `before insert` trigger on `auth.users` raises unless the email is in `allowed_emails`. That covers email sign-up, Google sign-in and the admin API alike. An `after insert` trigger creates the membership. Google sign-in by one of the six links to the existing user by verified email and never inserts, so it passes.

**The test that fails if it is removed:** `tests/rls/catalog.test.ts` reads `pg_class`, `pg_policies` and `information_schema.role_table_grants` and fails if any `public` table lacks forced RLS, any client-reachable `brand_id` table lacks a policy, `anon` holds any grant, or `authenticated` holds any write grant. `tests/rls/isolation.test.ts` signs in as all six users with the anon key and asserts each table returns only their brand, returns all of it (count compared with the service role), returns nothing when filtered by another brand's id, and refuses direct writes.

Demonstrated on 2026-09-14 against the local stack:

```
pnpm test:rls                                   ->  Tests  47 passed (47)
supabase db query 'drop policy contacts_select_own_brand on public.contacts'
pnpm test:rls                                   ->  Tests  2 failed | 45 passed (47)
  AssertionError: brand_id tables reachable by clients with no policy: expected [ 'contacts' ] to deeply equal []
  AssertionError: <kilele owner> list of contacts is truncated: expected +0 to be 1
pnpm db:reset && pnpm seed:users && pnpm test:rls ->  Tests  47 passed (47)
```

Google sign-in has so far been exercised only through the admin API path, which fires the same `auth.users` insert trigger. The OAuth path itself is verified on the hosted project in stage 3. Until then, "Google sign-in by a stranger is refused" is inferred from the trigger, not measured.

`share_links.token_hash` and `share_links.password_hash` are excluded from the client grant (column-level `grant select`), so no signed-in user can read them. The `app` helper schema is not exposed through the API. PostgREST error hints name the table a request was refused on; server actions in later stages return sanitised errors to the browser and never forward raw PostgREST JSON.

The service role is used in exactly three places, each commented: `scripts/seed-users.ts`, the import CLI (stage 2), and the `/share` route handler (stage 6). `src/lib/supabase/admin.ts` documents the rule.

### 4.3 Send path

1. Owner opens a campaign and clicks Send. Server action calls `approve_send(campaign_id)` in SQL. The function checks role = owner inside the function, snapshots the contactable audience into `send_recipients`, writes `approved_count`, sets `idempotency_key = send.id`. Returns the send. Screen shows the count and the definition of contactable.
2. Owner confirms. Server action calls Edge Function `dispatch-send` with the user's JWT. The function runs `update sends set status = 'dispatching' where id = $1 and status = 'approved' returning *`. Zero rows means another session got there first; the function returns the current state and makes no provider call. One row means this caller owns the dispatch.
3. Provider is called with `Idempotency-Key: <send id>`. Response `batch_id` stored, status `dispatched`, `accepted` and `rejected` arrays written to `send_recipients`.
4. If the function dies between step 2 and 3, the send is stuck in `dispatching` with no batch id. A retry from the UI re-runs the provider call with the same key, which the provider contract makes safe. This behaviour is verified against the live API before the feature is marked done, and the result is written here.
5. `poll-provider` runs every minute via pg_cron. For each send in `dispatched` with `has_more` or recent activity, it pages `/events` from the stored cursor, inserts into `provider_events` ignoring duplicates, and updates `send_recipients` and `contacts` (an `unsubscribed` or `bounced` makes the contact not contactable; no later event reverts that).

### 4.4 Shared link

`publish_results(campaign_id, password)` (owner only, in SQL) creates a `share_links` row with a 32-byte random token, stores `sha256(token)` and `bcrypt(password)`, and returns the plain token once. The URL is `/share/<token>`. The route handler hashes the token, finds the link, checks not revoked or expired, compares the password with bcrypt, increments attempts, locks after 10 failures, and on success sets a signed HttpOnly cookie scoped to that path for one hour. The page renders the campaign's aggregates only. Nothing on that page accepts an id from the request.

### 4.5 Definitions shown on screen

| Number                                        | Definition                                                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total customers                               | Contacts with `deleted_at` null. Deleted contacts excluded and the count of them shown alongside.                                                                                   |
| Contactable                                   | Status `active`, consent true, not deleted, `suppressed_until` null or past, a valid email or phone, and no unsubscribe, bounce or complaint in the event log or provider feedback. |
| Signups per day, last 30 days                 | By `signup_at` date in UTC, for the 30 days ending today.                                                                                                                           |
| Campaign delivered / bounced / opens / clicks | Two columns: "reported by brand" from the campaign file (totals), and "observed" from the event log (unique contacts).                                                              |
| Send delivery                                 | From `provider_events`, unique recipients per event type.                                                                                                                           |

## 5. Testing

- Unit (Vitest): every normaliser and parser, driven by the real quirks in section 2.
- RLS (Vitest against the linked Supabase project): signs in as all six users with the anon key, runs select, insert and update against every tenant table and every RPC with another brand's ids, asserts zero rows or a permission error. A catalog test reads `pg_tables` and `pg_policies` and fails if any table with a `brand_id` column lacks RLS or a policy. Dropping a policy fails the suite.
- Send concurrency (Vitest, provider base URL pointed at a local mock): two concurrent dispatches produce one provider request.
- End to end (Playwright): owner sends, analyst cannot, stranger gets nothing from the share link without the password.

## 6. Stages

Each stage is one commit, made only when asked.

| Stage | Scope                                                                                                                            |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Claude harness: rules, agents, skills, settings. Done.                                                                           |
| 1     | Scaffold app, Supabase project, migration with all tables, RLS, six users, RLS test suite. Done locally; hosted push in stage 7. |
| 2     | Import pipeline: parsers, normalisers, rejects, run against the seed. Done locally.                                              |
| 3     | Auth (email and Google), layout, contacts and campaigns views, imports view. Done.                                               |
| 4     | Dashboard with definitions. Built.                                                                                               |
| 5     | Send flow, Edge Functions, polling, live provider verification                                                                   |
| 6     | Shared results link                                                                                                              |
| 7     | Mobile pass, states, `schema.sql`, deploy, submission note                                                                       |

## 7. Decisions log

| Date       | Decision                                                                                                                                                                  | Why                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-13 | Marrakech orphan events are rejected and reported, not given placeholder campaigns                                                                                        | The brief asks that the marketer sees what did not load and why. Inventing campaign rows the client never supplied would be a quietly wrong number.                                                               |
| 2026-09-14 | Next.js App Router on Vercel, not Vite plus a separate Node API                                                                                                           | One deploy, one URL, secret-key code in the same repo as the UI. Matches the job's "modern React framework plus Node".                                                                                            |
| 2026-09-14 | Import is a CLI run by the engineer, results stored in `imports` and `import_rejects` and shown in the UI                                                                 | The brief supplies the files. An upload screen is scope the brief does not ask for.                                                                                                                               |
| 2026-09-14 | Provider dispatch and polling run in Supabase Edge Functions, scheduled by pg_cron                                                                                        | The provider key stays inside Supabase. The graders asked for function names and can inspect them with the project URL.                                                                                           |
| 2026-09-14 | Seed data lives in `data/seed/`, gitignored, fetched by `pnpm seed:fetch` which verifies the SHA-256 from the brief                                                       | 42 MB of CSV does not belong in git history; the hash makes the fetch trustworthy.                                                                                                                                |
| 2026-09-14 | Import writes through the `postgres` driver with `DATABASE_URL`, one transaction per file                                                                                 | Multi-row upserts and a real transaction. A crash leaves the `imports` row `failed` and nothing half-loaded.                                                                                                      |
| 2026-09-14 | Inside one file the last row for a key wins; across files the later file in the manifest wins                                                                             | Exports are regenerated top to bottom; the Kilele delta is marked "corrected in Sept export".                                                                                                                     |
| 2026-09-14 | A row containing a NUL byte is rejected naming the column, with the byte shown as `<NUL>` in the stored raw copy                                                          | Postgres cannot store NUL in text or jsonb. Three Kilele names carry one. Altering silently would hide it.                                                                                                        |
| 2026-09-14 | A bad optional field (email, phone, country) nulls the field and flags the contact; only a broken id, wrong brand, missing status or unparseable date drops the row       | Rejecting 44 contacts for a mangled phone also rejected their 145 events. Consistency beats severity.                                                                                                             |
| 2026-09-14 | Import library lives in `scripts/import/`, not `src/`, and its packages are dev dependencies                                                                              | It uses `node:fs` and `csv-parse`. Keeping it out of the Next.js source tree makes it impossible for a page or server action to pull it into a runtime that cannot run it.                                        |
| 2026-09-14 | ISO timestamps are validated by component and stored exactly as given, not through `Date`                                                                                 | `Date` truncates microseconds to milliseconds, which could reorder two events from the same millisecond. Postgres parses the string in full.                                                                      |
| 2026-09-14 | The import parse is whole-file and synchronous                                                                                                                            | Measured 16 s and a few hundred MB for 312,000 rows. Adequate for these exports; a streaming path is the next step past roughly a million rows.                                                                   |
| 2026-09-14 | The brand a page shows comes only from the caller's membership row, resolved once in the portal layout                                                                    | A brand in a URL, cookie or form field is an invitation to change it. Pages query through the user-scoped client and RLS filters.                                                                                 |
| 2026-09-14 | Lists paginate server-side, 50 rows, with `count: 'exact'`; the total on screen is the database count                                                                     | PostgREST caps a response at 1,000 rows; a list that shows "the first 1,000" and looks complete is the failure shape the job describes.                                                                           |
| 2026-09-14 | Deleted contacts are shown struck through in the list, not hidden; the dashboard total excludes them and says so                                                          | Hiding them would make the list count and the dashboard count disagree with no explanation.                                                                                                                       |
| 2026-09-14 | Visual direction: an editorial ledger. Paper and ink, Fraunces headings, IBM Plex for text and figures, and a footnote marker on every headline number                    | The footnote is the "say how you counted" rule made visible, and it is what a reader remembers.                                                                                                                   |
| 2026-09-14 | Sign-in errors are one generic sentence; PostgREST and Supabase errors never reach the browser verbatim                                                                   | Do not reveal whether an email exists. Table names in raw errors leak schema.                                                                                                                                     |
| 2026-09-15 | Reject reasons are grouped by a `security_invoker` view in the database, not in the app                                                                                   | PostgREST returns at most 1,000 rows per response; an app-side group-by would have summarised the first 1,000 of a large import and looked complete. The catalog test fails if any view lacks `security_invoker`. |
| 2026-09-15 | The imports list carries a real count and says "showing the latest 500 of N" when capped                                                                                  | A capped list that looks complete is the failure shape the job describes.                                                                                                                                         |
| 2026-09-15 | A missing session is the only auth result treated as "no user"; any other auth error throws                                                                               | A Supabase outage must not read as "your login has no brand".                                                                                                                                                     |
| 2026-09-15 | The error boundary shows a retry and a digest reference, never the raw database message                                                                                   | Raw PostgREST text names tables. The full message stays in the server log.                                                                                                                                        |
| 2026-09-15 | Security headers on every response: CSP with `frame-ancestors 'none'`, nosniff, strict referrer; the sign-out route refuses a foreign Origin                              | Defence in depth around a page that renders values copied from client CSV files.                                                                                                                                  |
| 2026-09-15 | The Google redirect origin comes from the browser's Origin header or `NEXT_PUBLIC_SITE_URL`, never from `x-forwarded-host`; `%` and `_` in search are escaped as literals | A proxy can forge forwarded headers; a wildcard in a search box is a typo, not a pattern.                                                                                                                         |
| 2026-09-16 | Dashboard numbers come from four `security invoker` SQL functions; the page computes nothing                                                                              | One definition per number, computed once in the database under the caller's RLS, tested against an independent superuser count per brand.                                                                         |
| 2026-09-16 | `dashboard_summary` is set-based with the contactable exclusion as a `not exists` in a `where` clause, never inside a `filter`                                            | Measured as the authenticated role on Kilele: per-row function 8 s timeout, `not exists` inside `count(*) filter` 44 s, anti-join form 139 ms. Same numbers each time: 82,114 / 395 / 35,502.                     |
| 2026-09-16 | Contactable has one definition in SQL, exposed as a count for the dashboard and as `contactable_contact_ids()` for the send audience                                      | The number a marketer approves on the send screen must be the number the dashboard shows.                                                                                                                         |
| 2026-09-16 | The 30-day signups chart is one series, one hue, inline SVG with a per-day tooltip and a table view; thirty zeros render as an explicit empty state                       | Karoo and Marrakech have no signups in the window. A blank chart would look broken; the message says why.                                                                                                         |
| 2026-09-16 | Campaign performance shows reported totals and observed distinct contacts side by side and does not reconcile them                                                        | They differ by an order of magnitude in the seed data. Choosing one silently would be a quietly wrong number.                                                                                                     |
| 2026-09-16 | `contact_is_contactable(row)` is not callable as an RPC; only `contactable_contact_ids()` and `dashboard_summary()` are                                                   | Called with a crafted row for a contact the caller cannot see, the row function answered vacuously. Nothing leaked, but a function that can answer wrongly is not exposed.                                        |

## 8. Running it

```
pnpm db:start          # local Supabase (Docker)
pnpm db:reset          # apply migrations and brands seed
pnpm env:local         # write .env.test from the running stack
pnpm seed:users        # six logins from SEED_LOGINS; passwords to .credentials.local.json
pnpm seed:fetch        # download and verify the seed zip into data/seed/
pnpm import:seed --all # load every file in scripts/import-manifest.ts, in order
pnpm test              # unit
pnpm test:rls          # isolation, auth gate and import suites against the local database
pnpm db:schema         # regenerate schema.sql
```

One file at a time: `pnpm import:seed --brand KAROO --kind contacts --file data/seed/karoo-contacts.csv`. Every run writes an `imports` row and one `import_rejects` row per refused line, with the line number, the reason, and the raw values.

## 9. AI tools

Claude Code (Fable 5.1) with project-scoped agents for review, security review, testing and linting. Every generated change is run through those agents before the user decides whether to commit. All commits are authored by the engineer alone.
