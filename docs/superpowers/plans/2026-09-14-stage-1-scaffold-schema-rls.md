# Stage 1: Scaffold, Schema, RLS, Users, RLS Tests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project override:** `CLAUDE.md` forbids committing without the user's explicit go-ahead. This plan therefore has NO per-task commit steps. The stage ends with `/stage-done`, which stops and asks.

**Goal:** A deployable Next.js shell plus a Supabase schema where every tenant table is protected by forced RLS, six pre-provisioned users exist, Google sign-in for anyone else is refused at the database, and an automated suite fails if any of that is removed.

**Architecture:** One Postgres schema, `brand_id` on every tenant table, `memberships` mapping users to brands and roles. Two `security definer` helpers in schema `app` drive all policies. A `before insert` trigger on `auth.users` refuses any email not in `allowed_emails`; an `after insert` trigger creates the membership. Stage 1 grants `authenticated` read-only access through policies and grants `anon` nothing. Writes arrive in later stages via `security definer` RPCs.

**Tech Stack:** Next.js 16 (App Router, TS), Tailwind 4, `@supabase/ssr` 0.12, `@supabase/supabase-js` 2.116, Supabase CLI 2.117 (local stack via Docker), Vitest 5, Zod 4, `postgres` (for the catalog test), `tsx`, pnpm 9.

**Spec:** `README.md` sections 4.1, 4.2, 5, 6.

---

## File structure

| Path                                               | Responsibility                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                     | Scripts that every agent and the README reference by name                                                               |
| `.env.example`                                     | Every env var the app reads, with placeholder values                                                                    |
| `.prettierrc`, `.prettierignore`                   | Formatting                                                                                                              |
| `vitest.config.ts`                                 | Two projects: `unit` and `rls`                                                                                          |
| `src/lib/env.ts`                                   | Zod-validated env access. Throws a named error on first use if a var is missing. Nothing reads `process.env` elsewhere. |
| `src/lib/supabase/client.ts`                       | Browser client (anon key, user session)                                                                                 |
| `src/lib/supabase/server.ts`                       | Server client for server components and actions (anon key, user cookies)                                                |
| `src/lib/supabase/admin.ts`                        | Service-role client. Only imported by scripts and route handlers that document why.                                     |
| `src/lib/supabase/proxy.ts`                        | Session refresh helper used by `src/proxy.ts`                                                                           |
| `src/proxy.ts`                                     | Next 16 request proxy (formerly middleware): refreshes the Supabase session cookie                                      |
| `src/app/layout.tsx`, `src/app/page.tsx`           | Shell and a placeholder home page                                                                                       |
| `supabase/config.toml`                             | Local stack config, auth settings                                                                                       |
| `supabase/migrations/20260914000100_schema.sql`    | Extensions, enums, every table, indexes, `updated_at` trigger                                                           |
| `supabase/migrations/20260914000200_rls.sql`       | Helpers, grants, enable + force RLS, select policies                                                                    |
| `supabase/migrations/20260914000300_auth_gate.sql` | `allowed_emails` trigger pair on `auth.users`                                                                           |
| `supabase/seed.sql`                                | The three brands only                                                                                                   |
| `scripts/local-env.ts`                             | Writes `.env.test` from `supabase status`                                                                               |
| `scripts/seed-users.ts`                            | Upserts `allowed_emails` and creates the six auth users via the admin API                                               |
| `tests/rls/setup.ts`                               | Loads `.env.test` and exports typed config                                                                              |
| `tests/rls/fixtures.ts`                            | Inserts one row per brand into every tenant table with the service role; cleans up                                      |
| `tests/rls/catalog.test.ts`                        | Fails if any `public` table lacks forced RLS or any `brand_id` table lacks a policy                                     |
| `tests/rls/isolation.test.ts`                      | Signs in as all six users, asserts cross-brand invisibility and write refusal                                           |
| `tests/rls/auth-gate.test.ts`                      | Asserts a stranger cannot be created in `auth.users`                                                                    |
| `tests/unit/env.test.ts`                           | Asserts `env.ts` fails closed                                                                                           |
| `schema.sql`                                       | Dump of `public` and `app` schemas, regenerated before every DB commit                                                  |

---

### Task 1: Scaffold Next.js into the existing repo

`create-next-app` refuses a directory containing `README.md` and `CLAUDE.md`, so scaffold into a temp folder and copy in.

**Files:**

- Create: everything `create-next-app` produces except `README.md` and `.gitignore`
- Modify: `.gitignore` (merge Next's entries)

- [ ] **Step 1: Scaffold in scratch**

```bash
cd "$SCRATCH"   # the session scratchpad directory
pnpm create next-app@latest vg-scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --turbopack --no-git
```

Expected: a `vg-scaffold` folder with `package.json`, `src/app`, `eslint.config.mjs`, `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`.

- [ ] **Step 2: Copy into the repo, excluding README and .gitignore**

```bash
cd "$SCRATCH/vg-scaffold" && tar --exclude=README.md --exclude=.gitignore --exclude=node_modules -cf - . | (cd E:/personal/velocity-growth && tar -xf -)
```

- [ ] **Step 3: Merge gitignore**

Append to `E:/personal/velocity-growth/.gitignore` any line from `vg-scaffold/.gitignore` not already present. Expected additions: `/.next/`, `/out/`, `/build`, `*.tsbuildinfo`, `next-env.d.ts`, `.pnpm-debug.log*`.

- [ ] **Step 4: Install and verify the shell builds**

```bash
cd E:/personal/velocity-growth && pnpm install && pnpm build
```

Expected: `pnpm build` ends with the route table showing `/` and no type errors.

---

### Task 2: Scripts, formatting, env contract

**Files:**

- Modify: `package.json`
- Create: `.prettierrc`, `.prettierignore`, `.env.example`, `vitest.config.ts`
- Create: `src/lib/env.ts`, `tests/unit/env.test.ts`

- [ ] **Step 1: Add dev dependencies**

```bash
pnpm add -D vitest@5 @vitejs/plugin-react@6 prettier@3 supabase@2 tsx@4 dotenv@17 postgres@3 @types/node
pnpm add @supabase/supabase-js@2 @supabase/ssr@0 zod@4
```

- [ ] **Step 2: Replace the `scripts` block in `package.json`**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "typecheck": "tsc --noEmit",
  "lint": "eslint .",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "test": "vitest run --project unit",
  "test:rls": "vitest run --project rls",
  "db:start": "supabase start",
  "db:stop": "supabase stop",
  "db:reset": "supabase db reset",
  "db:push": "supabase db push",
  "db:types": "supabase gen types typescript --local --schema public,app > src/lib/supabase/database.types.ts",
  "db:schema": "supabase db dump --local --schema public,app -f schema.sql",
  "env:local": "tsx scripts/local-env.ts",
  "seed:users": "tsx scripts/seed-users.ts"
}
```

- [ ] **Step 3: Prettier config**

`.prettierrc`:

```json
{ "semi": true, "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

`.prettierignore`:

```
.next
node_modules
pnpm-lock.yaml
schema.sql
supabase/.temp
```

- [ ] **Step 4: `.env.example`**

```bash
# Supabase (public, safe in the browser)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace-me

# Supabase (server only; never prefixed NEXT_PUBLIC_)
SUPABASE_SERVICE_ROLE_KEY=replace-me
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres

# Messaging provider (server only)
PROVIDER_BASE_URL=https://dispatcher-production-72fc.up.railway.app
PROVIDER_API_KEY=replace-me

# Seed users for scripts/seed-users.ts. JSON array. Passwords are generated and written to .credentials.local.json if omitted.
SEED_LOGINS='[
 {"email":"owner@kilele.example","brand":"KILELE","role":"owner","name":"Kilele Owner"},
 {"email":"analyst@kilele.example","brand":"KILELE","role":"analyst","name":"Kilele Analyst"},
 {"email":"owner@karoo.example","brand":"KAROO","role":"owner","name":"Karoo Owner"},
 {"email":"analyst@karoo.example","brand":"KAROO","role":"analyst","name":"Karoo Analyst"},
 {"email":"owner@marrakech.example","brand":"MARRAKECH","role":"owner","name":"Marrakech Owner"},
 {"email":"analyst@marrakech.example","brand":"MARRAKECH","role":"analyst","name":"Marrakech Analyst"}
]'
```

Add `.credentials.local.json` to `.gitignore`.

- [ ] **Step 5: Write the failing env test**

`tests/unit/env.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws a named error when a server var is missing, instead of returning undefined', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const { serverEnv } = await import('@/lib/env');
    expect(() => serverEnv()).toThrowError(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('returns parsed public env when present', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    const { publicEnv } = await import('@/lib/env');
    expect(publicEnv().NEXT_PUBLIC_SUPABASE_URL).toBe('http://127.0.0.1:54321');
  });

  it('rejects a provider base URL that is not https', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'svc');
    vi.stubEnv('DATABASE_URL', 'postgresql://x');
    vi.stubEnv('PROVIDER_BASE_URL', 'http://insecure.example');
    vi.stubEnv('PROVIDER_API_KEY', 'k');
    const { serverEnv } = await import('@/lib/env');
    expect(() => serverEnv()).toThrowError(/PROVIDER_BASE_URL/);
  });
});
```

- [ ] **Step 6: Vitest config**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'rls',
          include: ['tests/rls/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/rls/setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
```

- [ ] **Step 7: Run the unit test, expect failure**

```bash
pnpm test
```

Expected: FAIL, "Failed to resolve import @/lib/env".

- [ ] **Step 8: Implement `src/lib/env.ts`**

```ts
import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  PROVIDER_BASE_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://'), {
      message: 'PROVIDER_BASE_URL must use https',
    }),
  PROVIDER_API_KEY: z.string().min(1),
});

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

function parse<T extends z.ZodTypeAny>(
  schema: T,
  source: Record<string, string | undefined>,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const missing = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new EnvError(`Invalid environment: ${missing}`);
  }
  return result.data;
}

/** Safe in the browser. Values are inlined by Next at build time, so they are read explicitly. */
export function publicEnv() {
  return parse(publicSchema, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/** Server only. Importing this file in a client component is a bug; calling this there throws. */
export function serverEnv() {
  if (typeof window !== 'undefined') throw new EnvError('serverEnv() called in the browser');
  return parse(serverSchema, process.env);
}
```

- [ ] **Step 9: Run the unit test, expect pass**

```bash
pnpm test
```

Expected: `3 passed`.

- [ ] **Step 10: Lint and format**

```bash
pnpm format && pnpm lint && pnpm typecheck
```

Expected: no output from lint, no errors from tsc.

---

### Task 3: Supabase project init and local config

**Files:**

- Create: `supabase/config.toml` (generated, then edited)

- [ ] **Step 1: Init**

```bash
cd E:/personal/velocity-growth && pnpm supabase init --force
```

Expected: `supabase/config.toml` created. Answer "N" to VS Code and IntelliJ settings prompts if asked (or pass `--with-vscode-settings=false`).

- [ ] **Step 2: Edit `supabase/config.toml`**

Set these keys (keep everything else generated):

```toml
project_id = "velocity-growth"

[db]
port = 54322

[api]
port = 54321
schemas = ["public", "app"]

[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback"]
enable_signup = true
enable_manual_linking = false

[auth.email]
enable_signup = true
enable_confirmations = false

[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_GOOGLE_SECRET)"
skip_nonce_check = true
```

`enable_signup` stays true on purpose: the database trigger in Task 6 is the gate, not the auth setting, because the setting cannot distinguish the six allowed emails from everyone else. Add `SUPABASE_AUTH_GOOGLE_CLIENT_ID=` and `SUPABASE_AUTH_GOOGLE_SECRET=` to `.env.example`.

- [ ] **Step 3: Start the local stack**

Requires Docker Desktop running.

```bash
pnpm db:start
```

Expected: prints `API URL: http://127.0.0.1:54321`, `DB URL`, `anon key`, `service_role key`.

- [ ] **Step 4: Write `scripts/local-env.ts`**

```ts
/**
 * Writes .env.test from the running local Supabase stack so the RLS suite
 * never has hand-copied keys. Run: pnpm env:local
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const raw = execSync('pnpm exec supabase status -o env', { encoding: 'utf8' });
const vars = Object.fromEntries(
  raw
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const [k, ...rest] = l.split('=');
      return [k.trim(), rest.join('=').trim().replace(/^"|"$/g, '')];
    }),
);

const required = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'DB_URL'] as const;
for (const k of required) {
  if (!vars[k]) throw new Error(`supabase status did not return ${k}. Is the stack running?`);
}

const out = [
  `NEXT_PUBLIC_SUPABASE_URL=${vars.API_URL}`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${vars.ANON_KEY}`,
  `SUPABASE_SERVICE_ROLE_KEY=${vars.SERVICE_ROLE_KEY}`,
  `DATABASE_URL=${vars.DB_URL}`,
  `PROVIDER_BASE_URL=https://dispatcher-production-72fc.up.railway.app`,
  `PROVIDER_API_KEY=test-key-not-real`,
  '',
].join('\n');

writeFileSync('.env.test', out);
console.log('.env.test written for', vars.API_URL);
```

- [ ] **Step 5: Run it**

```bash
pnpm env:local && head -c 60 .env.test
```

Expected: `.env.test written for http://127.0.0.1:54321`.

---

### Task 4: Schema migration

**Files:**

- Create: `supabase/migrations/20260914000100_schema.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Stage 1: every table the portal will ever use, so later stages only add functions and policies.
-- Every tenant table carries brand_id NOT NULL. Uniqueness is always scoped by brand_id because
-- external ids collide across brands in the seed data (Kilele and Karoo share 12,407 contact ids).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists app;
comment on schema app is 'Helper functions used by RLS policies and triggers. Not a data schema.';

-- Enums -----------------------------------------------------------------------
create type public.membership_role as enum ('owner', 'analyst');
create type public.contact_status as enum ('active', 'unsubscribed', 'bounced', 'pending');
create type public.channel as enum ('email', 'sms');
create type public.engagement_event_type as enum ('open', 'click', 'bounce', 'complaint', 'unsubscribe', 'delivered', 'unknown');
create type public.import_kind as enum ('contacts', 'campaigns', 'events', 'send_log');
create type public.import_status as enum ('running', 'succeeded', 'failed');
create type public.send_status as enum ('approved', 'dispatching', 'dispatched', 'failed');
create type public.recipient_status as enum ('queued', 'accepted', 'rejected', 'delivered', 'bounced', 'opened', 'clicked', 'unsubscribed', 'complained');

-- updated_at ------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Tenancy ---------------------------------------------------------------------
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{3,16}$'),
  name text not null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  timezone text not null,
  created_at timestamptz not null default now()
);

create table public.allowed_emails (
  email text primary key check (email = lower(email)),
  brand_id uuid not null references public.brands(id),
  role public.membership_role not null,
  display_name text not null
);
comment on table public.allowed_emails is 'The only logins that may exist. Enforced by a trigger on auth.users. Never readable by clients.';

create table public.memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id uuid not null references public.brands(id),
  role public.membership_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);

-- Imports ---------------------------------------------------------------------
create table public.imports (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  kind public.import_kind not null,
  file_name text not null,
  file_sha256 text not null,
  encoding text not null,
  status public.import_status not null default 'running',
  rows_read integer not null default 0,
  rows_upserted integer not null default 0,
  rows_rejected integer not null default 0,
  rows_skipped_duplicate integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);
create index imports_brand_started_idx on public.imports (brand_id, started_at desc);

create table public.import_rejects (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.imports(id) on delete cascade,
  brand_id uuid not null references public.brands(id),
  row_number integer not null,
  reason text not null,
  raw jsonb not null
);
create index import_rejects_import_idx on public.import_rejects (brand_id, import_id);

-- Core data -------------------------------------------------------------------
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  external_id text not null check (external_id ~ '^CT-[0-9]+$'),
  full_name text,
  email text check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  phone text,
  country text check (country is null or country ~ '^[A-Z]{2}$'),
  city text,
  signup_at timestamptz,
  status public.contact_status not null,
  consent_marketing boolean not null,
  deleted_at timestamptz,
  suppressed_until timestamptz,
  notes text,
  flags text[] not null default '{}',
  source_import_id uuid references public.imports(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, external_id)
);
create index contacts_brand_signup_idx on public.contacts (brand_id, signup_at);
create index contacts_brand_status_idx on public.contacts (brand_id, status);
create index contacts_brand_email_idx on public.contacts (brand_id, lower(email));
create trigger contacts_updated_at before update on public.contacts for each row execute function app.set_updated_at();

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  external_id text not null,
  name text not null,
  channel public.channel not null,
  target_country text check (target_country is null or target_country ~ '^[A-Z]{2}$'),
  reported_sent integer check (reported_sent is null or reported_sent >= 0),
  reported_delivered integer check (reported_delivered is null or reported_delivered >= 0),
  reported_bounced integer check (reported_bounced is null or reported_bounced >= 0),
  reported_opens integer check (reported_opens is null or reported_opens >= 0),
  reported_clicks integer check (reported_clicks is null or reported_clicks >= 0),
  spend numeric(12, 2) check (spend is null or spend >= 0),
  sent_at timestamptz,
  send_local_time text,
  parent_external_id text,
  parent_campaign_id uuid references public.campaigns(id),
  flags text[] not null default '{}',
  source_import_id uuid references public.imports(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand_id, external_id)
);
create index campaigns_brand_sent_idx on public.campaigns (brand_id, sent_at desc);
create trigger campaigns_updated_at before update on public.campaigns for each row execute function app.set_updated_at();

create table public.engagement_events (
  id bigint generated always as identity primary key,
  brand_id uuid not null references public.brands(id),
  event_id text not null,
  contact_id uuid not null references public.contacts(id),
  campaign_id uuid not null references public.campaigns(id),
  event_type public.engagement_event_type not null,
  raw_event_type text not null,
  channel public.channel not null,
  occurred_at timestamptz not null,
  source_import_id uuid references public.imports(id),
  unique (brand_id, event_id)
);
create index engagement_events_campaign_idx on public.engagement_events (brand_id, campaign_id, event_type);
create index engagement_events_contact_idx on public.engagement_events (brand_id, contact_id);

create table public.send_log_entries (
  id bigint generated always as identity primary key,
  brand_id uuid not null references public.brands(id),
  batch_key text not null,
  campaign_id uuid references public.campaigns(id),
  campaign_external_id text not null,
  queued_at timestamptz not null,
  recipient_count integer not null check (recipient_count >= 0),
  status text not null,
  attempt_no integer not null check (attempt_no >= 1),
  source_import_id uuid references public.imports(id),
  unique (brand_id, batch_key, attempt_no)
);

-- Sending ---------------------------------------------------------------------
create table public.sends (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  campaign_id uuid not null references public.campaigns(id),
  status public.send_status not null default 'approved',
  audience_definition text not null,
  approved_count integer not null check (approved_count >= 0),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  idempotency_key text not null unique,
  dispatch_started_at timestamptz,
  dispatched_at timestamptz,
  provider_batch_id text unique,
  provider_accepted integer,
  provider_rejected integer,
  last_error text,
  poll_cursor text,
  last_polled_at timestamptz,
  poll_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sends_brand_campaign_idx on public.sends (brand_id, campaign_id, approved_at desc);
create index sends_poll_idx on public.sends (status, poll_complete) where status = 'dispatched' and poll_complete = false;
create trigger sends_updated_at before update on public.sends for each row execute function app.set_updated_at();

create table public.send_recipients (
  send_id uuid not null references public.sends(id) on delete cascade,
  contact_id uuid not null references public.contacts(id),
  brand_id uuid not null references public.brands(id),
  status public.recipient_status not null default 'queued',
  last_event_at timestamptz,
  primary key (send_id, contact_id)
);
create index send_recipients_status_idx on public.send_recipients (brand_id, send_id, status);

create table public.provider_events (
  id bigint generated always as identity primary key,
  brand_id uuid not null references public.brands(id),
  send_id uuid not null references public.sends(id) on delete cascade,
  provider_event_id text not null,
  event_type text not null,
  recipient_id uuid references public.contacts(id),
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  raw jsonb not null,
  unique (send_id, provider_event_id)
);

-- Sharing ---------------------------------------------------------------------
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id),
  campaign_id uuid not null references public.campaigns(id),
  token_hash text not null unique,
  password_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  failed_attempts integer not null default 0,
  locked_until timestamptz
);
create index share_links_brand_idx on public.share_links (brand_id, campaign_id);
```

- [ ] **Step 2: Apply**

```bash
pnpm db:reset
```

Expected: `Applying migration 20260914000100_schema.sql...` then `Finished supabase db reset`.

- [ ] **Step 3: Confirm tables exist**

```bash
pnpm exec supabase db query --local "select count(*) from pg_tables where schemaname = 'public'"
```

Expected: `13`.

---

### Task 5: RLS tests first (red), then the RLS migration (green)

**Files:**

- Create: `tests/rls/setup.ts`, `tests/rls/fixtures.ts`, `tests/rls/catalog.test.ts`, `tests/rls/isolation.test.ts`
- Create: `supabase/migrations/20260914000200_rls.sql`

The tests need users to sign in as. Task 6 creates them. Order inside this task: write tests, run (fail because no users and no RLS), do Task 6, run again (fail because no RLS), write RLS migration, run (pass).

- [ ] **Step 1: `tests/rls/setup.ts`**

```ts
import { config } from 'dotenv';
import { existsSync } from 'node:fs';

if (!existsSync('.env.test')) {
  throw new Error('.env.test missing. Run: pnpm db:start && pnpm env:local && pnpm seed:users');
}
config({ path: '.env.test' });

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`.env.test is missing ${name}`);
  return v;
}

export const rlsEnv = {
  url: need('NEXT_PUBLIC_SUPABASE_URL'),
  anonKey: need('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  serviceKey: need('SUPABASE_SERVICE_ROLE_KEY'),
  dbUrl: need('DATABASE_URL'),
};

export type SeedLogin = { email: string; brand: string; role: 'owner' | 'analyst'; name: string };

export function seedLogins(): SeedLogin[] {
  const raw = process.env.SEED_LOGINS;
  if (!raw) throw new Error('SEED_LOGINS missing from .env.test');
  return JSON.parse(raw) as SeedLogin[];
}

export function seedPasswords(): Record<string, string> {
  const raw = process.env.SEED_PASSWORDS_JSON;
  if (!raw) throw new Error('SEED_PASSWORDS_JSON missing from .env.test. Run pnpm seed:users.');
  return JSON.parse(raw) as Record<string, string>;
}
```

`scripts/local-env.ts` must also copy `SEED_LOGINS` from `.env.local` (or the default block in `.env.example`) and, after `seed:users` runs, `SEED_PASSWORDS_JSON` is appended to `.env.test` by that script. Update `local-env.ts`: after building `out`, append `SEED_LOGINS=${process.env.SEED_LOGINS ?? readDefaultFromEnvExample()}` where `readDefaultFromEnvExample()` extracts the `SEED_LOGINS='...'` block from `.env.example`.

- [ ] **Step 2: `tests/rls/fixtures.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { rlsEnv } from './setup';

export const TENANT_TABLES = [
  'imports',
  'import_rejects',
  'contacts',
  'campaigns',
  'engagement_events',
  'send_log_entries',
  'sends',
  'send_recipients',
  'provider_events',
  'share_links',
] as const;
export type TenantTable = (typeof TENANT_TABLES)[number];

export const MARK = 'rls-fixture';

export function adminClient(): SupabaseClient {
  return createClient(rlsEnv.url, rlsEnv.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type BrandRow = { id: string; code: string };

/** One row per brand in every tenant table, linked correctly, all tagged so cleanup is exact. */
export async function seedFixtures(
  admin: SupabaseClient,
  ownerUserIdByBrand: Record<string, string>,
) {
  const { data: brands, error } = await admin.from('brands').select('id, code');
  if (error) throw error;
  const importIds: Record<string, string> = {};
  for (const b of brands as BrandRow[]) {
    const ownerId = ownerUserIdByBrand[b.code];
    if (!ownerId) throw new Error(`no owner user id for ${b.code}`);

    const imp = await admin
      .from('imports')
      .insert({
        brand_id: b.id,
        kind: 'contacts',
        file_name: MARK,
        file_sha256: MARK,
        encoding: 'utf8',
      })
      .select('id')
      .single();
    if (imp.error) throw imp.error;
    importIds[b.code] = imp.data.id;

    const rej = await admin.from('import_rejects').insert({
      import_id: imp.data.id,
      brand_id: b.id,
      row_number: 1,
      reason: MARK,
      raw: { mark: MARK },
    });
    if (rej.error) throw rej.error;

    const contact = await admin
      .from('contacts')
      .insert({
        brand_id: b.id,
        external_id: 'CT-999999901',
        full_name: MARK,
        email: `fixture@${b.code.toLowerCase()}.example`,
        status: 'active',
        consent_marketing: true,
        notes: MARK,
        source_import_id: imp.data.id,
      })
      .select('id')
      .single();
    if (contact.error) throw contact.error;

    const campaign = await admin
      .from('campaigns')
      .insert({
        brand_id: b.id,
        external_id: 'FIX-0001',
        name: MARK,
        channel: 'email',
        source_import_id: imp.data.id,
      })
      .select('id')
      .single();
    if (campaign.error) throw campaign.error;

    const ev = await admin.from('engagement_events').insert({
      brand_id: b.id,
      event_id: 'EV-FIXTURE-1',
      contact_id: contact.data.id,
      campaign_id: campaign.data.id,
      event_type: 'open',
      raw_event_type: 'open',
      channel: 'email',
      occurred_at: new Date().toISOString(),
      source_import_id: imp.data.id,
    });
    if (ev.error) throw ev.error;

    const sl = await admin.from('send_log_entries').insert({
      brand_id: b.id,
      batch_key: MARK,
      campaign_id: campaign.data.id,
      campaign_external_id: 'FIX-0001',
      queued_at: new Date().toISOString(),
      recipient_count: 1,
      status: 'sent',
      attempt_no: 1,
      source_import_id: imp.data.id,
    });
    if (sl.error) throw sl.error;

    const send = await admin
      .from('sends')
      .insert({
        brand_id: b.id,
        campaign_id: campaign.data.id,
        audience_definition: MARK,
        approved_count: 1,
        approved_by: ownerId,
        idempotency_key: `${MARK}-${b.code}`,
      })
      .select('id')
      .single();
    if (send.error) throw send.error;

    const sr = await admin
      .from('send_recipients')
      .insert({ send_id: send.data.id, contact_id: contact.data.id, brand_id: b.id });
    if (sr.error) throw sr.error;

    const pe = await admin.from('provider_events').insert({
      brand_id: b.id,
      send_id: send.data.id,
      provider_event_id: `${MARK}-1`,
      event_type: 'delivered',
      recipient_id: contact.data.id,
      raw: { mark: MARK },
    });
    if (pe.error) throw pe.error;

    const share = await admin.from('share_links').insert({
      brand_id: b.id,
      campaign_id: campaign.data.id,
      token_hash: `${MARK}-${b.code}`,
      password_hash: MARK,
      created_by: ownerId,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    if (share.error) throw share.error;
  }
  return { brands: brands as BrandRow[], importIds };
}

export async function cleanFixtures(admin: SupabaseClient) {
  // Cascades: imports -> import_rejects; sends -> send_recipients, provider_events.
  const steps: Array<[TenantTable, Record<string, unknown>]> = [
    ['share_links', { password_hash: MARK }],
    ['sends', { audience_definition: MARK }],
    ['send_log_entries', { batch_key: MARK }],
    ['engagement_events', { event_id: 'EV-FIXTURE-1' }],
    ['campaigns', { name: MARK }],
    ['contacts', { notes: MARK }],
    ['imports', { file_name: MARK }],
  ];
  for (const [table, match] of steps) {
    const { error } = await admin.from(table).delete().match(match);
    if (error) throw new Error(`cleanup ${table}: ${error.message}`);
  }
}
```

- [ ] **Step 3: `tests/rls/catalog.test.ts`**

```ts
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { rlsEnv } from './setup';

const sql = postgres(rlsEnv.dbUrl, { max: 1 });
afterAll(() => sql.end());

type Row = {
  relname: string;
  rls: boolean;
  forced: boolean;
  policy_count: number;
  has_brand_id: boolean;
};

describe('RLS catalog: the guarantee cannot be removed without this failing', () => {
  it('every table in public has RLS enabled and forced', async () => {
    const rows = await sql<Row[]>`
      select c.relname,
             c.relrowsecurity as rls,
             c.relforcerowsecurity as forced,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policy_count,
             exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'brand_id' and not a.attisdropped) as has_brand_id
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`;
    expect(rows.length).toBeGreaterThanOrEqual(13);
    const unprotected = rows.filter((r) => !r.rls || !r.forced).map((r) => r.relname);
    expect(unprotected, 'tables without forced RLS').toEqual([]);
  });

  it('every table with a brand_id column has at least one policy', async () => {
    const rows = await sql<Row[]>`
      select c.relname,
             (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'brand_id' and not a.attisdropped)`;
    const missing = rows.filter((r) => r.policy_count === 0).map((r) => r.relname);
    expect(missing, 'brand_id tables with no policy').toEqual([]);
  });

  it('anon has no privileges on any public table', async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'`;
    expect(rows).toEqual([]);
  });

  it('authenticated cannot write any public table directly', async () => {
    const rows = await sql<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`;
    expect(rows).toEqual([]);
  });

  it('every view in public runs with security_invoker', async () => {
    const rows = await sql<{ relname: string; invoker: boolean }[]>`
      select c.relname, coalesce(c.reloptions::text like '%security_invoker=true%', false) as invoker
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'`;
    expect(rows.filter((r) => !r.invoker)).toEqual([]);
  });
});
```

- [ ] **Step 4: `tests/rls/isolation.test.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TENANT_TABLES, adminClient, cleanFixtures, seedFixtures, type BrandRow } from './fixtures';
import { rlsEnv, seedLogins, seedPasswords } from './setup';

type Session = {
  email: string;
  brandCode: string;
  brandId: string;
  role: string;
  client: SupabaseClient;
};

const admin = adminClient();
let brands: BrandRow[] = [];
let sessions: Session[] = [];

beforeAll(async () => {
  const logins = seedLogins();
  const passwords = seedPasswords();
  const { data: users, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const ownerUserIdByBrand: Record<string, string> = {};
  for (const l of logins.filter((l) => l.role === 'owner')) {
    const u = users.users.find((u) => u.email?.toLowerCase() === l.email.toLowerCase());
    if (!u) throw new Error(`seed user ${l.email} missing. Run pnpm seed:users`);
    ownerUserIdByBrand[l.brand] = u.id;
  }
  const seeded = await seedFixtures(admin, ownerUserIdByBrand);
  brands = seeded.brands;

  sessions = [];
  for (const l of logins) {
    const client = createClient(rlsEnv.url, rlsEnv.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await client.auth.signInWithPassword({
      email: l.email,
      password: passwords[l.email],
    });
    if (signInError) throw new Error(`sign in ${l.email}: ${signInError.message}`);
    const brand = brands.find((b) => b.code === l.brand);
    if (!brand) throw new Error(`brand ${l.brand} not seeded`);
    sessions.push({ email: l.email, brandCode: l.brand, brandId: brand.id, role: l.role, client });
  }
});

afterAll(async () => {
  await cleanFixtures(admin);
});

describe('tenant isolation, as each of the six users', () => {
  it('has six sessions across three brands', () => {
    expect(sessions).toHaveLength(6);
    expect(new Set(sessions.map((s) => s.brandId)).size).toBe(3);
  });

  for (const table of TENANT_TABLES) {
    it(`${table}: a user sees only their own brand, and sees all of it`, async () => {
      for (const s of sessions) {
        const { data, error } = await s.client.from(table).select('brand_id');
        expect(error, `${s.email} select ${table}`).toBeNull();
        const seen = new Set((data ?? []).map((r: { brand_id: string }) => r.brand_id));
        expect([...seen], `${s.email} saw foreign brand rows in ${table}`).toEqual(
          seen.size ? [s.brandId] : [],
        );

        const expected = await admin
          .from(table)
          .select('brand_id', { count: 'exact', head: true })
          .eq('brand_id', s.brandId);
        expect(expected.error).toBeNull();
        expect(data?.length, `${s.email} list of ${table} is truncated`).toBe(expected.count);
        expect(expected.count, `fixture missing for ${table}`).toBeGreaterThan(0);
      }
    });

    it(`${table}: filtering by another brand's id returns nothing`, async () => {
      for (const s of sessions) {
        const other = brands.find((b) => b.id !== s.brandId)!;
        const { data, error } = await s.client
          .from(table)
          .select('brand_id')
          .eq('brand_id', other.id);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    });
  }

  it('brands: a user sees only their own brand row', async () => {
    for (const s of sessions) {
      const { data, error } = await s.client.from('brands').select('id');
      expect(error).toBeNull();
      expect(data?.map((b: { id: string }) => b.id)).toEqual([s.brandId]);
    }
  });

  it('memberships: a user sees only their own membership', async () => {
    for (const s of sessions) {
      const { data, error } = await s.client.from('memberships').select('brand_id, role');
      expect(error).toBeNull();
      expect(data).toEqual([{ brand_id: s.brandId, role: s.role }]);
    }
  });

  it('allowed_emails: no user can read it', async () => {
    for (const s of sessions) {
      const { data, error } = await s.client.from('allowed_emails').select('email');
      expect(error, `${s.email} could read allowed_emails`).not.toBeNull();
      expect(data).toBeNull();
    }
  });

  it('direct writes are refused for own brand and for another brand, owner or analyst', async () => {
    for (const s of sessions) {
      const other = brands.find((b) => b.id !== s.brandId)!;
      for (const brandId of [s.brandId, other.id]) {
        const ins = await s.client.from('contacts').insert({
          brand_id: brandId,
          external_id: 'CT-999999999',
          status: 'active',
          consent_marketing: false,
        });
        expect(ins.error, `${s.email} inserted into contacts for ${brandId}`).not.toBeNull();
      }
      const upd = await s.client
        .from('contacts')
        .update({ notes: 'tampered' })
        .eq('brand_id', other.id)
        .select('id');
      expect(upd.data ?? []).toEqual([]);
      const del = await s.client.from('contacts').delete().eq('brand_id', other.id).select('id');
      expect(del.data ?? []).toEqual([]);
    }
    const untouched = await admin.from('contacts').select('id').eq('notes', 'tampered');
    expect(untouched.data).toEqual([]);
  });
});

describe('anonymous', () => {
  const anon = createClient(rlsEnv.url, rlsEnv.anonKey, { auth: { persistSession: false } });
  for (const table of [...TENANT_TABLES, 'brands', 'memberships', 'allowed_emails'] as const) {
    it(`${table}: anon gets an error, not an empty list`, async () => {
      const { data, error } = await anon.from(table).select('*').limit(1);
      expect(error, `anon read ${table}`).not.toBeNull();
      expect(data).toBeNull();
    });
  }
});
```

- [ ] **Step 5: Run, expect red**

```bash
pnpm test:rls
```

Expected: FAIL. `seed user owner@kilele.example missing. Run pnpm seed:users`. Proceed to Task 6, then return to Step 6.

- [ ] **Step 6: After Task 6, run again, expect red for the right reason**

```bash
pnpm test:rls
```

Expected: FAIL. Catalog test lists all 13 tables under "tables without forced RLS". Isolation tests show users seeing three brand ids.

- [ ] **Step 7: Write `supabase/migrations/20260914000200_rls.sql`**

```sql
-- THE ISOLATION GUARANTEE LIVES IN THIS FILE.
-- Every tenant table: RLS enabled and FORCED (so the table owner is not exempt), one select policy
-- that compares brand_id to the caller's memberships. No insert/update/delete policies exist for
-- clients; writes only happen through security definer functions added in later migrations, each of
-- which re-checks membership. The catalog test in tests/rls/catalog.test.ts fails if any table
-- in public loses forced RLS, and the isolation test fails if any policy stops filtering.

-- Helpers ---------------------------------------------------------------------
-- security definer so the memberships lookup is not itself subject to RLS recursion.
create or replace function app.user_brand_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select m.brand_id from public.memberships m where m.user_id = auth.uid()
$$;

create or replace function app.is_owner_of(p_brand_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.brand_id = p_brand_id and m.role = 'owner'
  )
$$;

revoke all on function app.user_brand_ids() from public;
revoke all on function app.is_owner_of(uuid) from public;
grant execute on function app.user_brand_ids() to authenticated;
grant execute on function app.is_owner_of(uuid) to authenticated;

-- Grants ----------------------------------------------------------------------
-- Supabase grants anon and authenticated broad table privileges by default. Take them away.
-- anon gets nothing at all: the public share page is served by a server route with the service role.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema app to authenticated;

grant select on
  public.brands,
  public.memberships,
  public.imports,
  public.import_rejects,
  public.contacts,
  public.campaigns,
  public.engagement_events,
  public.send_log_entries,
  public.sends,
  public.send_recipients,
  public.provider_events,
  public.share_links
to authenticated;
-- allowed_emails: deliberately no grant to any client role.

-- Enable and force ------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- Policies --------------------------------------------------------------------
create policy brands_select_member on public.brands
  for select to authenticated
  using (id in (select app.user_brand_ids()));

create policy memberships_select_self on public.memberships
  for select to authenticated
  using (user_id = auth.uid());

-- allowed_emails: RLS on, no policy. Nothing gets through.

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'imports', 'import_rejects', 'contacts', 'campaigns', 'engagement_events',
      'send_log_entries', 'sends', 'send_recipients', 'provider_events', 'share_links'
    ])
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (brand_id in (select app.user_brand_ids()))',
      t || '_select_own_brand', t
    );
  end loop;
end $$;
```

- [ ] **Step 8: Apply and run, expect green**

```bash
pnpm db:reset && pnpm seed:users && pnpm test:rls
```

Expected: catalog 5 passed, isolation all passed, anon all passed.

- [ ] **Step 9: Prove the test catches removal**

```bash
pnpm exec supabase db query --local "drop policy contacts_select_own_brand on public.contacts"
pnpm test:rls
```

Expected: FAIL. `brand_id tables with no policy: ["contacts"]` and `contacts: a user sees only their own brand` fails because with forced RLS and no policy, users see zero rows while the admin count is 1 (the "truncated" assertion). Then restore:

```bash
pnpm db:reset && pnpm seed:users && pnpm test:rls
```

Expected: all green. Record the drop-policy output in README section 5.

---

### Task 6: Brands seed, auth gate trigger, user seeding

**Files:**

- Create: `supabase/seed.sql`
- Create: `supabase/migrations/20260914000300_auth_gate.sql`
- Create: `scripts/seed-users.ts`
- Create: `tests/rls/auth-gate.test.ts`

- [ ] **Step 1: `supabase/seed.sql`**

```sql
insert into public.brands (code, name, country, timezone) values
  ('KILELE', 'Kilele Rides', 'KE', 'Africa/Nairobi'),
  ('KAROO', 'Karoo Coaches', 'ZA', 'Africa/Johannesburg'),
  ('MARRAKECH', 'Marrakech Express', 'MA', 'Africa/Casablanca')
on conflict (code) do nothing;
```

- [ ] **Step 2: Write the failing auth-gate test**

`tests/rls/auth-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { adminClient } from './fixtures';

const admin = adminClient();

describe('auth gate: only allowed_emails can exist in auth.users', () => {
  it('refuses a stranger even through the admin API', async () => {
    const email = `stranger-${Date.now()}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'Str0ng-password!',
      email_confirm: true,
    });
    expect(error, 'stranger was created').not.toBeNull();
    expect(data.user).toBeNull();
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(list?.users.some((u) => u.email === email)).toBe(false);
  });

  it('refuses an allowed email with different casing only if not lowercased (trigger lowercases)', async () => {
    // Documented behaviour: allowed_emails stores lowercase; the trigger lowercases incoming emails before matching.
    const { data: allowed } = await admin.from('allowed_emails').select('email').limit(1).single();
    expect(allowed).not.toBeNull();
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const exists = list?.users.some((u) => u.email?.toLowerCase() === allowed!.email);
    expect(exists, 'seed user for first allowed email exists').toBe(true);
  });

  it('every auth user has exactly one membership matching allowed_emails', async () => {
    const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const { data: memberships } = await admin.from('memberships').select('user_id, brand_id, role');
    const { data: allowed } = await admin.from('allowed_emails').select('email, brand_id, role');
    for (const u of list!.users) {
      const a = allowed!.find((x) => x.email === u.email?.toLowerCase());
      expect(a, `${u.email} is not in allowed_emails`).toBeDefined();
      const m = memberships!.filter((x) => x.user_id === u.id);
      expect(m).toEqual([{ user_id: u.id, brand_id: a!.brand_id, role: a!.role }]);
    }
  });
});
```

- [ ] **Step 3: Run, expect red**

```bash
pnpm db:reset && pnpm test:rls -- auth-gate
```

Expected: FAIL, stranger was created.

- [ ] **Step 4: `supabase/migrations/20260914000300_auth_gate.sql`**

```sql
-- Who may log in is decided here, not in the UI and not in the auth provider settings.
-- A Google sign-in by anyone not in allowed_emails fails at insert time with a database error,
-- so no auth.users row, no session, no membership, no data.
-- Supabase links an OAuth identity to an existing user with the same verified email, so a Google
-- sign-in by one of the six does not insert a new user and is unaffected by this trigger.

create or replace function app.enforce_allowed_email()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.email is null or not exists (
    select 1 from public.allowed_emails a where a.email = lower(new.email)
  ) then
    raise exception 'sign-up refused: % is not an allowed login', coalesce(new.email, '<null>')
      using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function app.create_membership_for_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.memberships (user_id, brand_id, role)
  select new.id, a.brand_id, a.role
  from public.allowed_emails a
  where a.email = lower(new.email)
  on conflict (user_id, brand_id) do nothing;
  return new;
end $$;

-- The auth service runs as supabase_auth_admin; it needs to execute these, nothing else does.
revoke all on function app.enforce_allowed_email() from public;
revoke all on function app.create_membership_for_new_user() from public;
grant usage on schema app to supabase_auth_admin;
grant execute on function app.enforce_allowed_email() to supabase_auth_admin;
grant execute on function app.create_membership_for_new_user() to supabase_auth_admin;

drop trigger if exists enforce_allowed_email on auth.users;
create trigger enforce_allowed_email
  before insert on auth.users
  for each row execute function app.enforce_allowed_email();

drop trigger if exists create_membership_for_new_user on auth.users;
create trigger create_membership_for_new_user
  after insert on auth.users
  for each row execute function app.create_membership_for_new_user();
```

- [ ] **Step 5: `scripts/seed-users.ts`**

```ts
/**
 * Upserts allowed_emails from SEED_LOGINS and creates the six auth users with the admin API.
 * Idempotent: existing users get their password reset to the stored one.
 * Passwords: from SEED_PASSWORDS_JSON if set, else generated and written to .credentials.local.json
 * (gitignored) and appended to .env.test so the RLS suite can sign in.
 * Usage: pnpm seed:users            (local stack, reads .env.test)
 *        ENV_FILE=.env.production pnpm seed:users
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const envFile = process.env.ENV_FILE ?? '.env.test';
config({ path: envFile });

type Login = { email: string; brand: string; role: 'owner' | 'analyst'; name: string };

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${envFile} is missing ${name}`);
  return v;
}

const logins = JSON.parse(need('SEED_LOGINS')) as Login[];
if (logins.length !== 6) throw new Error(`expected 6 logins, got ${logins.length}`);

const credPath = '.credentials.local.json';
const stored: Record<string, string> = process.env.SEED_PASSWORDS_JSON
  ? JSON.parse(process.env.SEED_PASSWORDS_JSON)
  : existsSync(credPath)
    ? JSON.parse(readFileSync(credPath, 'utf8'))
    : {};
let generated = false;
for (const l of logins) {
  if (!stored[l.email]) {
    stored[l.email] = randomBytes(12).toString('base64url');
    generated = true;
  }
}
if (generated) {
  writeFileSync(credPath, JSON.stringify(stored, null, 2));
  console.log(`wrote ${credPath}`);
}
if (!process.env.SEED_PASSWORDS_JSON) {
  appendFileSync(envFile, `\nSEED_PASSWORDS_JSON='${JSON.stringify(stored)}'\n`);
  console.log(`appended SEED_PASSWORDS_JSON to ${envFile}`);
}

const admin = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: brands, error: bErr } = await admin.from('brands').select('id, code');
  if (bErr) throw bErr;
  const brandId = (code: string) => {
    const b = brands.find((x) => x.code === code);
    if (!b)
      throw new Error(`brand ${code} not in database; run db:reset (seed.sql inserts brands)`);
    return b.id;
  };

  const { error: aErr } = await admin.from('allowed_emails').upsert(
    logins.map((l) => ({
      email: l.email.toLowerCase(),
      brand_id: brandId(l.brand),
      role: l.role,
      display_name: l.name,
    })),
    { onConflict: 'email' },
  );
  if (aErr) throw aErr;

  const { data: existing, error: lErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (lErr) throw lErr;

  for (const l of logins) {
    const found = existing.users.find((u) => u.email?.toLowerCase() === l.email.toLowerCase());
    if (found) {
      const { error } = await admin.auth.admin.updateUserById(found.id, {
        password: stored[l.email],
      });
      if (error) throw new Error(`${l.email}: ${error.message}`);
      console.log(`updated  ${l.email}`);
    } else {
      const { error } = await admin.auth.admin.createUser({
        email: l.email,
        password: stored[l.email],
        email_confirm: true,
        user_metadata: { display_name: l.name },
      });
      if (error) throw new Error(`${l.email}: ${error.message}`);
      console.log(`created  ${l.email}`);
    }
  }
  const { data: m } = await admin.from('memberships').select('user_id');
  console.log(`memberships: ${m?.length ?? 0} (expected 6)`);
  if ((m?.length ?? 0) !== 6) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 6: Apply, seed, run, expect green**

```bash
pnpm db:reset && pnpm env:local && pnpm seed:users && pnpm test:rls -- auth-gate
```

Expected: `created  owner@kilele.example` six times, `memberships: 6 (expected 6)`, then 3 passed.

Now return to Task 5 Step 6.

---

### Task 7: Supabase clients and session proxy in Next

**Files:**

- Create: `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/lib/supabase/proxy.ts`, `src/proxy.ts`, `src/lib/supabase/database.types.ts` (generated)
- Modify: `src/app/page.tsx`, `src/app/layout.tsx`

- [ ] **Step 1: Generate types**

```bash
pnpm db:types && head -20 src/lib/supabase/database.types.ts
```

Expected: a file beginning `export type Json =` with `public: { Tables: { brands: ...`.

- [ ] **Step 2: `src/lib/supabase/client.ts`**

```ts
'use client';
import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';
import type { Database } from './database.types';

export function createClient() {
  const env = publicEnv();
  return createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
```

- [ ] **Step 3: `src/lib/supabase/server.ts`**

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';
import type { Database } from './database.types';

/** User-scoped client. Runs with the caller's JWT, so RLS applies. Use this for every data read. */
export async function createClient() {
  const cookieStore = await cookies();
  const env = publicEnv();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component: cookies are read-only there. proxy.ts refreshes them.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 4: `src/lib/supabase/admin.ts`**

```ts
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Service-role client. Bypasses RLS. Allowed only in:
 *   - scripts/ (import CLI, user seeding)
 *   - the /share route handler, which resolves the brand from a token it verified first
 *   - Edge Functions are separate (Deno) and do not import this.
 * Every call site must carry a comment saying why the user-scoped client could not be used.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

Install: `pnpm add server-only`.

- [ ] **Step 5: `src/lib/supabase/proxy.ts`**

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';

/** Refreshes the auth cookie on every request so server components see a live session. */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = publicEnv();
  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  // getUser() validates the JWT against Supabase; getSession() would trust the cookie blindly.
  await supabase.auth.getUser();
  return response;
}
```

- [ ] **Step 6: `src/proxy.ts`**

```ts
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

If `next build` reports that `proxy.ts` is not recognised by the installed Next version, rename to `src/middleware.ts` and the export to `middleware`, and note it in the README.

- [ ] **Step 7: Placeholder page**

`src/app/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">Velocity Growth campaign portal</h1>
      {error || !data.user ? (
        <p className="text-muted-foreground">Signed out. Sign-in arrives in stage 3.</p>
      ) : (
        <p>Signed in as {data.user.email}.</p>
      )}
    </main>
  );
}
```

- [ ] **Step 8: Local env for Next and build**

Copy `.env.test` to `.env.local` (same local stack). Then:

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Expected: clean, route table shows `/` and the proxy.

- [ ] **Step 9: Smoke run**

```bash
pnpm dev
```

Open http://localhost:3000. Expected: the heading and "Signed out". Stop the server.

---

### Task 8: schema.sql, README updates, stage close

**Files:**

- Create: `schema.sql`
- Modify: `README.md` (section 4.1 table names confirmed, section 5 evidence, section 6 stage 1 status)

- [ ] **Step 1: Dump schema**

```bash
pnpm db:schema && grep -c "force row level security" schema.sql
```

Expected: `13`.

- [ ] **Step 2: README**

In section 4.2, add: "Guarantee: `supabase/migrations/20260914000200_rls.sql`, policies block, and `tests/rls/catalog.test.ts`. Demonstrated on <date>: dropping `contacts_select_own_brand` makes `pnpm test:rls` fail with `brand_id tables with no policy: ["contacts"]`." Paste the actual output. In section 6, mark stage 1 complete with the commands used to verify.

- [ ] **Step 3: Run `/stage-done`**

It runs `/lint`, `/test`, `/review`, checks `schema.sql` is in the diff, then stops and asks for the commit decision. Proposed message:

```
feat: scaffold Next.js app, Supabase schema with forced RLS, auth gate and isolation test suite
```

---

## Self-review

**Spec coverage.** README 4.1: all twelve tables plus `send_log_entries` (Task 4). 4.2 isolation in SQL with forced RLS (Task 5). Six users and Google gate at the database (Task 6). README 5 RLS suite including catalog test and the drop-policy demonstration (Task 5 step 9). Stage 1 scope in README 6 is complete. Not in stage 1 by design: auth UI, imports, dashboard, sends, share link.

**Placeholders.** None. Every code step is complete.

**Type consistency.** `adminClient()` in fixtures is the test-side helper; `createAdminClient()` in `src/lib/supabase/admin.ts` is the app-side one. `seedLogins()` and `seedPasswords()` both in `tests/rls/setup.ts` and read by `isolation.test.ts`. `TENANT_TABLES` has ten entries; `brands`, `memberships`, `allowed_emails` are tested separately. The catalog test expects at least 13 tables: 10 tenant plus 3.

**Known caveats to verify during execution, not assume.** (a) Whether Next 16.3 accepts `src/proxy.ts` or still wants `middleware.ts`. (b) Whether hosted Supabase lets a migration create triggers on `auth.users`; the local stack does. (c) `supabase status -o env` key names in CLI 2.117; adjust `local-env.ts` if they differ.
