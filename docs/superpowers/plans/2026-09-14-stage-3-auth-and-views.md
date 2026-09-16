# Stage 3: Sign-in, Brand Shell, Contacts, Campaigns, Imports

> Inline execution. No per-task commits; `/stage-done` closes the stage.

**Goal:** Six people can sign in with email and password or with Google, land in their own brand's portal, browse contacts and campaigns at 82k rows as comfortably as at 900, and see every import with the rows it refused and why. Strangers get nothing. Analysts see the same views as owners without the send controls.

**Architecture:** Next.js App Router. Every data read runs through the user-scoped server client, so RLS is the filter and the pages never pass a brand id around. `src/proxy.ts` redirects signed-out requests to `/login`. A `(portal)` route group holds the authenticated shell; its layout resolves the caller's membership once and renders "no access" if there is none. Lists are server components with URL-driven pagination (`?page=`, `?q=`, `?status=`) validated by Zod; PostgREST `range` plus `count: 'exact'` give real totals. shadcn/ui components on Tailwind 4.

**Spec:** README sections 1 (rules 1, 3, 5, 10, 11), 4, 4.5.

---

## Decisions

| Question                            | Decision                                                                                                                                                                                         | Why                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Where the brand comes from          | The caller's membership row, read in the portal layout. Never from a URL, cookie or form field.                                                                                                  | Rule 2. A brand in the URL is an invitation to change it.                   |
| A signed-in user with no membership | Rendered a "no access" page with a sign-out button; no data queries run. Cannot happen for the six, exists for defence in depth.                                                                 | The auth gate stops strangers at insert; this handles a deleted membership. |
| Google sign-in                      | Supabase OAuth with `redirectTo` to `/auth/callback`, which exchanges the code and redirects to `/`. Provider config lives in the Supabase dashboard.                                            | Standard SSR flow for `@supabase/ssr`.                                      |
| Pagination                          | Server-side, 50 rows per page, `range()` with `count: 'exact'`. Page number and filters in the URL.                                                                                              | Rule 4: totals are real counts; a list is never silently the first 1000.    |
| Search                              | Case-insensitive `ilike` on full name, email and external id, combined with `or()`.                                                                                                              | Enough for a marketer; indexes exist on `lower(email)` and the unique id.   |
| Contacts list columns               | External id, name, email, phone, country, status, consent, signup date, flags as badges. Deleted contacts shown with a strike and a badge, not hidden.                                           | Hiding deleted rows would make the total on the dashboard unexplainable.    |
| Campaigns list columns              | External id, name, channel, sent at, reported sent, delivered, opens, clicks, spend, flags. Header tooltip says "as reported in the brand's campaign file".                                      | Section 4.5 definitions. Observed figures arrive in stage 4.                |
| Imports view                        | Table of imports newest first with status, kind, file, counts and the arithmetic; a detail page listing rejects with line number, reason, and the raw values as a collapsible row.               | Rule 3: the marketer sees what did not load and why.                        |
| Error handling                      | Every page has `loading.tsx` (skeleton) and `error.tsx` (message plus retry). A failed query throws; it never renders zero. Server actions return `{ error }` objects, never raw PostgREST JSON. | Rule 3 and the "swallowed error reported as zero" failure shape.            |
| Tests                               | Vitest for the URL param parser and the query builders. Playwright: signed-out redirect, password sign-in lands on own brand, analyst sees no send control, stranger email cannot sign up.       | Adds `test:e2e`. The send flow tests join in stage 5.                       |

## File structure

| Path                                                         | Responsibility                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `src/app/login/page.tsx`, `src/app/login/actions.ts`         | Email and password form, Google button, error display          |
| `src/app/auth/callback/route.ts`                             | OAuth code exchange                                            |
| `src/app/auth/signout/route.ts`                              | Sign out and redirect                                          |
| `src/app/no-access/page.tsx`                                 | Signed in, no membership                                       |
| `src/app/(portal)/layout.tsx`                                | Resolves membership, renders shell with nav and role badge     |
| `src/app/(portal)/page.tsx`                                  | Placeholder dashboard, replaced in stage 4                     |
| `src/app/(portal)/contacts/page.tsx`                         | List with search, status filter, pagination                    |
| `src/app/(portal)/campaigns/page.tsx`                        | List                                                           |
| `src/app/(portal)/imports/page.tsx`, `imports/[id]/page.tsx` | Import list and reject detail                                  |
| `src/lib/auth/membership.ts`                                 | `getMembership()` returning `{ user, brand, role }` or null    |
| `src/lib/queries/contacts.ts`, `campaigns.ts`, `imports.ts`  | Query builders taking the user-scoped client and parsed params |
| `src/lib/params.ts`                                          | Zod schemas for `page`, `q`, `status` with safe defaults       |
| `src/components/shell/*`                                     | Nav, mobile sheet, role badge, sign-out                        |
| `src/components/data/*`                                      | Pagination control, empty state, error state, flag badges      |
| `src/proxy.ts`                                               | Adds the signed-out redirect to the existing session refresh   |
| `tests/unit/params.test.ts`                                  | Param parsing rejects garbage and defaults sanely              |
| `tests/e2e/*.spec.ts`, `playwright.config.ts`                | Four flows above, against the local stack                      |

## Tasks

1. **shadcn and design tokens.** `pnpm dlx shadcn@latest init` then add button, input, label, table, badge, card, select, sheet, skeleton, alert, tooltip, dropdown-menu. Load the frontend-design skill before touching layout.
2. **Params and query builders, test first.** `parseListParams(searchParams)` returns `{ page, q, status }` with page clamped to 1 or more, q trimmed and capped at 100 chars, status from the enum or undefined. Query builders return `{ rows, total, page, pageSize }` and throw on error.
3. **Auth.** Login page, password action, Google action, callback route, sign-out route, proxy redirect, `getMembership()`, no-access page.
4. **Shell.** Portal layout with brand name, nav (Dashboard, Contacts, Campaigns, Imports), role badge, sign out, mobile sheet.
5. **Contacts, campaigns, imports pages** with loading, empty and error states.
6. **Playwright.** Config pointing at `http://localhost:3000` with the local stack; four specs; `test:e2e` script; the tester agent runs it when the stage touches auth.
7. **README** section 6 and any new definitions; `/stage-done`.
