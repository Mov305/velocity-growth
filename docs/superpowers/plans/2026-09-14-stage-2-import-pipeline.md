# Stage 2: Import Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline. No per-task commits; `CLAUDE.md` forbids committing without the user's go-ahead. The stage ends with `/stage-done`.

**Goal:** A CLI that loads every seed file into Postgres, rejects every bad row with a reason the marketer can read, records what happened in `imports` and `import_rejects`, and produces the same row counts when run twice.

**Architecture:** Pure functions first. `src/lib/import/normalize/*` turn one messy value into one canonical value or a rejection reason; `src/lib/import/rows/*` turn one raw record into one canonical row or a reject; `src/lib/import/parse.ts` turns bytes into raw records with encoding and delimiter handled; `src/lib/import/run.ts` orchestrates one file inside one transaction using the `postgres` driver with the direct database URL. `scripts/import.ts` is the CLI; `scripts/import-manifest.ts` lists the files in the order they must apply.

**Tech Stack:** `csv-parse` (streaming CSV), Node `TextDecoder` for utf-8 strict and windows-1252 fallback, `postgres` (already a dependency), Zod for the CLI args, Vitest.

**Spec:** `README.md` sections 2 and 4.1.

---

## Decisions locked in this plan

| Question                          | Decision                                                                                                                                                                | Why                                                                                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Where does seed data live         | `data/seed/`, gitignored. `pnpm seed:fetch` downloads the zip, verifies the SHA-256 from the brief, unzips.                                                             | 42 MB of CSV does not belong in git history; the hash makes the fetch trustworthy.                                                       |
| Driver for bulk writes            | `postgres` with `DATABASE_URL`, one transaction per file                                                                                                                | Multi-row upserts and a real transaction. supabase-js would need hundreds of HTTP round trips and cannot wrap a file in one transaction. |
| Duplicate keys inside one file    | Last row wins; earlier ones counted as `rows_skipped_duplicate`                                                                                                         | Postgres refuses to update the same row twice in one statement, and "last wins" matches how exports are regenerated.                     |
| Files for the same brand and kind | Applied in manifest order; a later file overwrites                                                                                                                      | The Kilele delta is dated after the base and marked "corrected in Sept export".                                                          |
| Half-imported file on crash       | Impossible: the file's rows and rejects are one transaction; the `imports` row is written outside it as `running` and updated to `succeeded` or `failed` with the error | Fail closed. The marketer sees a failed import, never a partial one.                                                                     |
| Empty `brand_code`                | Row kept, flagged `brand_code_missing`                                                                                                                                  | Only disagreement is a leak signal.                                                                                                      |
| Empty consent                     | `false`, flagged `consent_missing`                                                                                                                                      | No consent recorded is no consent.                                                                                                       |
| Unrecognised country              | `null`, flagged `country_unrecognised`                                                                                                                                  | Country is descriptive here, not a gate.                                                                                                 |
| Invalid email                     | `null`, flagged `email_invalid`                                                                                                                                         | Contact remains, reachable by phone if present.                                                                                          |
| Phone in scientific notation      | Keep contact, phone null, flag `phone_corrupted`                                                                                                                        | Same rule as email. Rejecting the contact also rejected its 145 events on the first full run.                                            |
| Unknown campaign on an event      | Reject with `unknown campaign <id>`                                                                                                                                     | Decided 2026-09-13.                                                                                                                      |
| Unknown event type                | Reject with `event_type unrecognised: <value>`                                                                                                                          | Allow-list.                                                                                                                              |
| Malformed external id             | Reject with `external_id malformed: <value>`                                                                                                                            | Catches column-shifted rows and the repeated header in one rule.                                                                         |

## Rejection reasons (exact strings, the marketer reads these)

```
external_id malformed: <value>
brand_code mismatch: <value> in <BRAND> file
status missing
status unrecognised: <value>
consent unrecognised: <value>
signup_at unparseable: <value>
deleted_at unparseable: <value>
suppressed_until unparseable: <value>
row has <n> columns, expected <m>
campaign name missing
channel unrecognised: <value>
<field> not a whole number: <value>
spend not a number: <value>
sent_at unparseable: <value>
unknown contact <id>
unknown campaign <id>
event_type unrecognised: <value>
occurred_at unparseable: <value>
event_id missing
batch_key missing
recipient_count not a whole number: <value>
queued_at unparseable: <value>
```

Flags on kept rows (`contacts.flags`, `campaigns.flags`): `brand_code_missing`, `consent_missing`, `country_unrecognised`, `email_invalid`, `no_channel`, `signup_missing`, `parent_unresolved`, `name_missing`.

---

## File structure

| Path                                  | Responsibility                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `scripts/fetch-seed.ts`               | Download zip, verify SHA-256, unzip into `data/seed/`                                   |
| `scripts/import-manifest.ts`          | Ordered list of `{ brand, kind, file }` for the seed                                    |
| `scripts/import.ts`                   | CLI: `--brand --kind --file` for one file, or `--all` for the manifest                  |
| `src/lib/import/types.ts`             | `RawRecord`, `Reject`, `Canonical*` row types, `ImportSummary`                          |
| `src/lib/import/brand-config.ts`      | Per-brand: delimiter, decimal separator, header aliases                                 |
| `src/lib/import/parse.ts`             | bytes to `RawRecord[]` with line numbers, encoding used, column-count errors            |
| `src/lib/import/normalize/boolean.ts` | 11 spellings to boolean                                                                 |
| `src/lib/import/normalize/status.ts`  | status allow-list                                                                       |
| `src/lib/import/normalize/country.ts` | ISO-2 allow-list with alias map                                                         |
| `src/lib/import/normalize/date.ts`    | three formats to ISO string                                                             |
| `src/lib/import/normalize/phone.ts`   | digit normalisation, scientific-notation detection                                      |
| `src/lib/import/normalize/email.ts`   | trim, lowercase, validate                                                               |
| `src/lib/import/normalize/number.ts`  | integer and decimal with `,` separator                                                  |
| `src/lib/import/normalize/enum.ts`    | channel and event type allow-lists                                                      |
| `src/lib/import/rows/contact.ts`      | raw to `CanonicalContact` or `Reject`                                                   |
| `src/lib/import/rows/campaign.ts`     | raw to `CanonicalCampaign` or `Reject`                                                  |
| `src/lib/import/rows/event.ts`        | raw to `CanonicalEvent` or `Reject`, needs id maps                                      |
| `src/lib/import/rows/send-log.ts`     | raw to `CanonicalSendLog` or `Reject`                                                   |
| `src/lib/import/dedupe.ts`            | last-wins by key, counts skipped                                                        |
| `src/lib/import/run.ts`               | one file: imports row, parse, map, dedupe, transaction, upsert, rejects, counts         |
| `tests/unit/import/normalize.test.ts` | every normaliser against the real quirk values                                          |
| `tests/unit/import/parse.test.ts`     | BOM, cp1252, semicolons, short rows, repeated header                                    |
| `tests/unit/import/rows.test.ts`      | each mapper's reject reasons and flags                                                  |
| `tests/unit/import/dedupe.test.ts`    | last-wins                                                                               |
| `tests/fixtures/import/*.csv`         | hand-made files with every trap, one per brand and kind                                 |
| `tests/rls/import.test.ts`            | runs the fixtures against the local DB twice, asserts counts equal and rejects recorded |

---

## Tasks

### Task 1: Seed fetch script and manifest

- `pnpm add -D csv-parse adm-zip @types/adm-zip`
- `scripts/fetch-seed.ts`: fetch the URL from the brief, sha256 the bytes, compare to `4961a25b151ca13ac56089ca46b94def6074c315445ec193c7bf87060683d35c`, throw on mismatch, unzip to `data/seed/`. Script `seed:fetch`.
- `scripts/import-manifest.ts` in this order: KILELE contacts base, KILELE contacts delta, KILELE campaigns, KILELE events, KILELE send_log, KAROO contacts, KAROO campaigns, KAROO events, MARRAKECH contacts, MARRAKECH campaigns, MARRAKECH events.
- Verify: `pnpm seed:fetch` prints the hash and 11 files.

### Task 2: Normalisers, test first

Write `tests/unit/import/normalize.test.ts` covering, per the profiling in README section 2:

- boolean: `true 1 TRUE yes Y` to true; `0 no FALSE false f` to false; `''` to `{ value: false, flag: 'consent_missing' }`; `maybe` to reject.
- status: `active ACTIVE 'active ' Active` to active; `unsubscribe` to unsubscribed; `''` to reject `status missing`; `paused` to reject.
- country: `KE KEN kenya Kenya 'ke '` to KE; `ZA MA SS UG RW ET TZ` pass; `254 NULL null none ''` to `{ value: null, flag: 'country_unrecognised' }` (empty gives null without flag).
- date: `2026-02-19T23:47:04Z` unchanged; `2026-04-03` to `2026-04-03T00:00:00.000Z`; `01/02/2026 00:10` to `2026-02-01T00:10:00.000Z` (day first); `active` to reject; `''` to null.
- phone: `254-731-694774` to `254731694774`; `+254 721 913 662` to `+254721913662`; `0704279001` unchanged; `2.54E+11` to reject; `''` to null.
- email: `Foo@VG-Eval.test ` to `foo@vg-eval.test`; `john doe@vg-eval.test`, `missing-at-sign.test`, `no-tld@vg-eval`, `double@@vg-eval.test` to invalid; `''` to null.
- number: `6585` to 6585; `221,09` with decimal `,` to 221.09; `365.56` with `.` to 365.56; `12.5` as integer to reject; `''` to null.
- enum: channel `email sms` pass, `EMAIL` passes after lowercase, `push` rejects; event type `open click bounce complaint unsubscribe delivered` pass, `opened` maps to open, `bounced` to bounce, `unsubscribed` to unsubscribe, `spam` rejects.

Run red, implement each normaliser as a small pure function returning a discriminated union `{ ok: true, value, flag? } | { ok: false, reason }`, run green.

### Task 3: Parser, test first

Fixture bytes built in the test: UTF-8 with BOM, a cp1252 file containing byte 0x96, a `;` file, a file with a short row, a file with the header repeated mid-file. Assertions: encoding reported, BOM stripped from the first header, records keyed by canonical column names via the alias map, short row surfaced as `{ line, error: 'row has 12 columns, expected 13' }` not silently padded, repeated header comes through as a record (the row mapper rejects it by id).

Implementation: read the whole file as bytes (largest is 22 MB), `TextDecoder('utf-8', { fatal: true })`, on failure `TextDecoder('windows-1252')`, strip `﻿`, `csv-parse` sync with `columns: true`, `relax_column_count: true`, `raw: false`, `info: true` to get line numbers and column counts, `delimiter` from brand config. Map headers through the alias table; unknown headers are an error for the whole file (fail closed).

### Task 4: Row mappers, test first

For each mapper, one happy-path row and one row per reject reason and per flag. Contact mapper takes `{ brandCode }`; event mapper takes `{ contactIds: Map<string, string>, campaignIds: Map<string, string> }`; campaign mapper returns `parent_external_id` untouched; send-log mapper receives `attemptNo` from the caller.

### Task 5: Dedupe and run, then integration test

`dedupe(rows, keyFn)` returns `{ kept, skipped }` with last-wins. `run.ts`:

```
runImport({ brandCode, kind, filePath, sql }) -> ImportSummary
  1. read bytes, sha256
  2. insert imports row (status running) and commit it
  3. parse -> map -> dedupe (outside the transaction, pure)
  4. sql.begin(async tx => {
       upsert in batches of 2000 (contacts, campaigns, send_log) or 5000 (events)
       campaigns: second statement resolves parent_campaign_id within brand, flags the rest
       insert import_rejects in batches of 2000
     })
  5. update imports row: succeeded, counts, finished_at
  on any throw: update imports row failed with error message, rethrow
```

Upserts use `insert ... on conflict (brand_id, external_id) do update set <every column> = excluded.<column>, source_import_id = excluded.source_import_id`. Events use `on conflict (brand_id, event_id) do nothing` and count the skipped via `xmax = 0` trick or by comparing affected rows.

`tests/rls/import.test.ts`: runs `runImport` for each fixture file against the local DB, asserts the summary counts match the traps planted in the fixture, runs the whole set again and asserts every table's row count for that brand is unchanged and a new `imports` row exists. Cleans up by deleting the fixture brand rows (fixtures use the real three brands, so cleanup deletes by `source_import_id in (fixture import ids)`).

### Task 6: CLI and full seed run

`scripts/import.ts` parses args with Zod, runs one file or the manifest, prints one line per file: `KILELE contacts kilele-contacts.csv: read 83993, upserted 78xxx, rejected xxx, dup-skipped 2xxx, 12.3s`. Exit code 1 if any file failed. Run `pnpm import:seed --all` against the local stack. Run it a second time. Record both outputs in README section 2 as measured numbers. Then run `pnpm test:rls` to confirm isolation still holds with real data volume.

### Task 7: README and stage close

README: section 2 gets the measured import table; section 6 marks stage 2; section 7 logs the decisions above. `/stage-done`.
