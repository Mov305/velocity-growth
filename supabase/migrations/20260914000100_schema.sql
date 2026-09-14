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
create trigger contacts_updated_at before update on public.contacts
  for each row execute function app.set_updated_at();

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
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function app.set_updated_at();

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
create index sends_poll_idx on public.sends (status, poll_complete)
  where status = 'dispatched' and poll_complete = false;
create trigger sends_updated_at before update on public.sends
  for each row execute function app.set_updated_at();

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
