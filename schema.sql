


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "app";


ALTER SCHEMA "app" OWNER TO "postgres";


COMMENT ON SCHEMA "app" IS 'Helper functions used by RLS policies and triggers. Not a data schema.';



CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."channel" AS ENUM (
    'email',
    'sms'
);


ALTER TYPE "public"."channel" OWNER TO "postgres";


CREATE TYPE "public"."contact_status" AS ENUM (
    'active',
    'unsubscribed',
    'bounced',
    'pending'
);


ALTER TYPE "public"."contact_status" OWNER TO "postgres";


CREATE TYPE "public"."engagement_event_type" AS ENUM (
    'open',
    'click',
    'bounce',
    'complaint',
    'unsubscribe',
    'delivered',
    'unknown'
);


ALTER TYPE "public"."engagement_event_type" OWNER TO "postgres";


CREATE TYPE "public"."import_kind" AS ENUM (
    'contacts',
    'campaigns',
    'events',
    'send_log'
);


ALTER TYPE "public"."import_kind" OWNER TO "postgres";


CREATE TYPE "public"."import_status" AS ENUM (
    'running',
    'succeeded',
    'failed'
);


ALTER TYPE "public"."import_status" OWNER TO "postgres";


CREATE TYPE "public"."membership_role" AS ENUM (
    'owner',
    'analyst'
);


ALTER TYPE "public"."membership_role" OWNER TO "postgres";


CREATE TYPE "public"."recipient_status" AS ENUM (
    'queued',
    'accepted',
    'rejected',
    'delivered',
    'bounced',
    'opened',
    'clicked',
    'unsubscribed',
    'complained'
);


ALTER TYPE "public"."recipient_status" OWNER TO "postgres";


CREATE TYPE "public"."send_status" AS ENUM (
    'approved',
    'dispatching',
    'dispatched',
    'failed'
);


ALTER TYPE "public"."send_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."create_membership_for_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.memberships (user_id, brand_id, role)
  select new.id, a.brand_id, a.role
  from public.allowed_emails a
  where a.email = lower(new.email)
  on conflict (user_id, brand_id) do nothing;
  return new;
end $$;


ALTER FUNCTION "app"."create_membership_for_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."enforce_allowed_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.email is null or not exists (
    select 1 from public.allowed_emails a where a.email = lower(new.email)
  ) then
    raise exception 'sign-up refused: % is not an allowed login', coalesce(new.email, '<null>')
      using errcode = '42501';
  end if;
  return new;
end $$;


ALTER FUNCTION "app"."enforce_allowed_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."is_owner_of"("p_brand_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = auth.uid() and m.brand_id = p_brand_id and m.role = 'owner'
  )
$$;


ALTER FUNCTION "app"."is_owner_of"("p_brand_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."schedule_provider_poll"("p_url" "text", "p_secret" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_id uuid;
  v_cmd text;
begin
  if p_url !~ '^https://' then
    raise exception 'poll url must be https';
  end if;
  if length(p_secret) < 16 then
    raise exception 'poll secret must be at least 16 characters';
  end if;

  select id into v_id from vault.secrets where name = 'poll_url';
  if v_id is null then perform vault.create_secret(p_url, 'poll_url');
  else perform vault.update_secret(v_id, p_url); end if;

  select id into v_id from vault.secrets where name = 'poll_secret';
  if v_id is null then perform vault.create_secret(p_secret, 'poll_secret');
  else perform vault.update_secret(v_id, p_secret); end if;

  v_cmd := $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'poll_url'),
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-poll-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'poll_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 58000)
  $cmd$;

  perform cron.unschedule(jobid) from cron.job where jobname = 'poll-provider-feedback';
  perform cron.schedule('poll-provider-feedback', '* * * * *', v_cmd);
  return 'poll-provider-feedback scheduled every minute';
end $_$;


ALTER FUNCTION "app"."schedule_provider_poll"("p_url" "text", "p_secret" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;


ALTER FUNCTION "app"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."user_brand_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.brand_id from public.memberships m where m.user_id = auth.uid()
$$;


ALTER FUNCTION "app"."user_brand_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_send"("p_campaign_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_brand uuid;
  v_send uuid;
  v_count integer;
begin
  select brand_id into v_brand from public.campaigns where id = p_campaign_id;
  if v_brand is null or not app.is_owner_of(v_brand) then
    raise exception 'not permitted: only an owner of the campaign''s brand can approve a send'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('approve_send'), hashtext(p_campaign_id::text));

  select id into v_send from public.sends
  where campaign_id = p_campaign_id and brand_id = v_brand
    and provider_batch_id is null
    and status in ('approved', 'dispatching', 'failed')
  order by approved_at desc limit 1;
  if v_send is not null then
    return v_send;
  end if;

  insert into public.sends (brand_id, campaign_id, status, audience_definition, approved_count, approved_by, idempotency_key)
  values (
    v_brand, p_campaign_id, 'approved',
    'status active, consent given, not deleted, not suppressed, has an email or phone, and no bounce, complaint or unsubscribe in the event log or from a send',
    0, auth.uid(), gen_random_uuid()::text
  )
  returning id into v_send;

  insert into public.send_recipients (send_id, contact_id, brand_id, status)
  select v_send, ct.id, v_brand, 'queued'
  from public.contacts ct
  where ct.brand_id = v_brand
    and ct.deleted_at is null
    and ct.status = 'active'
    and ct.consent_marketing
    and (ct.suppressed_until is null or ct.suppressed_until < now())
    and (ct.email is not null or ct.phone is not null)
    and not exists (
      select 1 from public.engagement_events e
      where e.brand_id = v_brand and e.contact_id = ct.id
        and e.event_type in ('bounce', 'complaint', 'unsubscribe'))
    and not exists (
      select 1 from public.send_recipients r
      where r.brand_id = v_brand and r.contact_id = ct.id
        and r.status in ('bounced', 'complained', 'unsubscribed'));

  get diagnostics v_count = row_count;
  update public.sends set approved_count = v_count where id = v_send;
  return v_send;
end $$;


ALTER FUNCTION "public"."approve_send"("p_campaign_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."sends" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "status" "public"."send_status" DEFAULT 'approved'::"public"."send_status" NOT NULL,
    "audience_definition" "text" NOT NULL,
    "approved_count" integer NOT NULL,
    "approved_by" "uuid" NOT NULL,
    "approved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "dispatch_started_at" timestamp with time zone,
    "dispatched_at" timestamp with time zone,
    "provider_batch_id" "text",
    "provider_accepted" integer,
    "provider_rejected" integer,
    "last_error" "text",
    "poll_cursor" "text",
    "last_polled_at" timestamp with time zone,
    "poll_complete" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sends_approved_count_check" CHECK (("approved_count" >= 0))
);

ALTER TABLE ONLY "public"."sends" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."sends" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."begin_dispatch"("p_send_id" "uuid") RETURNS SETOF "public"."sends"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_brand uuid;
begin
  select brand_id into v_brand from public.sends where id = p_send_id;
  if v_brand is null or not app.is_owner_of(v_brand) then
    raise exception 'not permitted: only an owner of the send''s brand can dispatch it'
      using errcode = '42501';
  end if;
  return query
    update public.sends s
    set status = 'dispatching', dispatch_started_at = now(), last_error = null
    where s.id = p_send_id
      and s.provider_batch_id is null
      and (
        s.status = 'approved'
        or s.status = 'failed'
        or (s.status = 'dispatching' and s.dispatch_started_at < now() - interval '5 minutes')
      )
    returning s.*;
end $$;


ALTER FUNCTION "public"."begin_dispatch"("p_send_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."campaign_performance"() RETURNS TABLE("id" "uuid", "external_id" "text", "name" "text", "channel" "public"."channel", "sent_at" timestamp with time zone, "reported_sent" integer, "reported_delivered" integer, "reported_bounced" integer, "reported_opens" integer, "reported_clicks" integer, "spend" numeric, "observed_contacts" integer, "observed_opened" integer, "observed_clicked" integer, "observed_bounced" integer, "observed_complained" integer, "observed_unsubscribed" integer, "observed_events" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select
    c.id, c.external_id, c.name, c.channel, c.sent_at,
    coalesce(c.reported_sent, 0), coalesce(c.reported_delivered, 0), coalesce(c.reported_bounced, 0),
    coalesce(c.reported_opens, 0), coalesce(c.reported_clicks, 0),
    coalesce(c.spend, 0),
    coalesce(o.contacts, 0), coalesce(o.opened, 0), coalesce(o.clicked, 0), coalesce(o.bounced, 0),
    coalesce(o.complained, 0), coalesce(o.unsubscribed, 0), coalesce(o.events, 0)
  from public.campaigns c
  left join lateral (
    select
      count(distinct e.contact_id)::int as contacts,
      count(distinct e.contact_id) filter (where e.event_type = 'open')::int as opened,
      count(distinct e.contact_id) filter (where e.event_type = 'click')::int as clicked,
      count(distinct e.contact_id) filter (where e.event_type = 'bounce')::int as bounced,
      count(distinct e.contact_id) filter (where e.event_type = 'complaint')::int as complained,
      count(distinct e.contact_id) filter (where e.event_type = 'unsubscribe')::int as unsubscribed,
      count(*)::int as events
    from public.engagement_events e
    where e.campaign_id = c.id
  ) o on true
  order by c.sent_at desc nulls last, c.external_id
$$;


ALTER FUNCTION "public"."campaign_performance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_dispatch"("p_send_id" "uuid", "p_expected_batches" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_first text;
  v_accepted integer;
  v_rejected integer;
  v_batches integer;
begin
  select count(*)::int, coalesce(sum(accepted_count), 0)::int, coalesce(sum(rejected_count), 0)::int
  into v_batches, v_accepted, v_rejected
  from public.send_batches where send_id = p_send_id;
  if v_batches = 0 or v_batches <> p_expected_batches then
    raise exception 'expected % batches recorded for send, found %', p_expected_batches, v_batches
      using errcode = 'P0002';
  end if;
  select provider_batch_id into v_first from public.send_batches
  where send_id = p_send_id order by chunk_index limit 1;
  update public.sends
  set status = 'dispatched', dispatched_at = now(), provider_batch_id = v_first,
      provider_accepted = v_accepted, provider_rejected = v_rejected, last_error = null
  where id = p_send_id and status = 'dispatching';
end $$;


ALTER FUNCTION "public"."complete_dispatch"("p_send_id" "uuid", "p_expected_batches" integer) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "external_id" "text" NOT NULL,
    "full_name" "text",
    "email" "text",
    "phone" "text",
    "country" "text",
    "city" "text",
    "signup_at" timestamp with time zone,
    "status" "public"."contact_status" NOT NULL,
    "consent_marketing" boolean NOT NULL,
    "deleted_at" timestamp with time zone,
    "suppressed_until" timestamp with time zone,
    "notes" "text",
    "flags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "source_import_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "contacts_country_check" CHECK ((("country" IS NULL) OR ("country" ~ '^[A-Z]{2}$'::"text"))),
    CONSTRAINT "contacts_email_check" CHECK ((("email" IS NULL) OR ("email" ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::"text"))),
    CONSTRAINT "contacts_external_id_check" CHECK (("external_id" ~ '^CT-[0-9]+$'::"text"))
);

ALTER TABLE ONLY "public"."contacts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."contact_is_contactable"("c" "public"."contacts") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select c.status = 'active'
     and c.consent_marketing
     and c.deleted_at is null
     and (c.suppressed_until is null or c.suppressed_until < now())
     and (c.email is not null or c.phone is not null)
     and not exists (
       select 1 from public.engagement_events e
       where e.contact_id = c.id and e.event_type in ('bounce', 'complaint', 'unsubscribe')
     )
     and not exists (
       select 1 from public.send_recipients r
       where r.contact_id = c.id and r.status in ('bounced', 'complained', 'unsubscribed')
     )
$$;


ALTER FUNCTION "public"."contact_is_contactable"("c" "public"."contacts") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."contactable_contact_ids"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with excluded as (
    select e.contact_id from public.engagement_events e
    where e.event_type in ('bounce', 'complaint', 'unsubscribe')
    union
    select r.contact_id from public.send_recipients r
    where r.status in ('bounced', 'complained', 'unsubscribed')
  )
  select ct.id from public.contacts ct
  where ct.deleted_at is null
    and ct.status = 'active'
    and ct.consent_marketing
    and (ct.suppressed_until is null or ct.suppressed_until < now())
    and (ct.email is not null or ct.phone is not null)
    and not exists (select 1 from excluded x where x.contact_id = ct.id)
$$;


ALTER FUNCTION "public"."contactable_contact_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dashboard_summary"() RETURNS TABLE("total_customers" integer, "deleted_customers" integer, "contactable" integer, "not_contactable" integer, "contactable_definition" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  with excluded as (
    select e.contact_id from public.engagement_events e
    where e.event_type in ('bounce', 'complaint', 'unsubscribe')
    union
    select r.contact_id from public.send_recipients r
    where r.status in ('bounced', 'complained', 'unsubscribed')
  ),
  totals as (
    select
      count(*) filter (where deleted_at is null)::int as total_customers,
      count(*) filter (where deleted_at is not null)::int as deleted_customers
    from public.contacts
  ),
  reachable as (
    select count(*)::int as contactable
    from public.contacts ct
    where ct.deleted_at is null
      and ct.status = 'active'
      and ct.consent_marketing
      and (ct.suppressed_until is null or ct.suppressed_until < now())
      and (ct.email is not null or ct.phone is not null)
      and not exists (select 1 from excluded x where x.contact_id = ct.id)
  )
  select
    t.total_customers,
    t.deleted_customers,
    r.contactable,
    t.total_customers - r.contactable as not_contactable,
    'status active, consent given, not deleted, not suppressed, has an email or phone, and no bounce, complaint or unsubscribe in the event log or from a send' as contactable_definition
  from totals t, reachable r
$$;


ALTER FUNCTION "public"."dashboard_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_dispatch"("p_send_id" "uuid", "p_error" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.sends set status = 'failed', last_error = left(p_error, 500)
  where id = p_send_id and status = 'dispatching' and provider_batch_id is null
$$;


ALTER FUNCTION "public"."fail_dispatch"("p_send_id" "uuid", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_provider_events"("p_send_id" "uuid", "p_events" "jsonb") RETURNS TABLE("inserted" integer, "duplicates" integer, "unknown_recipients" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_brand uuid;
  v_inserted integer := 0;
  v_dups integer := 0;
  v_unknown integer := 0;
  ev jsonb;
  v_event_id text;
  v_type text;
  v_recipient uuid;
  v_occurred timestamptz;
  v_new public.recipient_status;
  forward constant public.recipient_status[] := array['queued','rejected','accepted','delivered','opened','clicked']::public.recipient_status[];
begin
  select brand_id into v_brand from public.sends where id = p_send_id;
  if v_brand is null then
    raise exception 'send not found' using errcode = 'P0002';
  end if;

  for ev in select * from jsonb_array_elements(p_events) loop
    v_event_id := coalesce(ev->>'event_id', ev->>'id');
    v_type := lower(coalesce(ev->>'type', ev->>'event_type', ev->>'event', ''));
    begin
      v_occurred := nullif(coalesce(ev->>'occurred_at', ev->>'timestamp', ev->>'at', ev->>'created_at'), '')::timestamptz;
    exception when others then
      v_occurred := null;
    end;
    begin
      v_recipient := nullif(coalesce(ev->>'recipient_id', ev->>'recipient', ev->>'contact_id', ev->'recipient'->>'id'), '')::uuid;
    exception when others then
      v_recipient := null;
    end;
    if v_event_id is null then
      continue;
    end if;

    if v_recipient is not null and not exists (
      select 1 from public.send_recipients r where r.send_id = p_send_id and r.contact_id = v_recipient
    ) then
      v_recipient := null;
    end if;

    insert into public.provider_events (brand_id, send_id, provider_event_id, event_type, recipient_id, occurred_at, raw)
    values (v_brand, p_send_id, v_event_id, v_type, v_recipient, v_occurred, ev)
    on conflict (send_id, provider_event_id) do nothing;
    if not found then
      v_dups := v_dups + 1;
      continue;
    end if;
    v_inserted := v_inserted + 1;

    if v_recipient is null then
      v_unknown := v_unknown + 1;
      continue;
    end if;

    v_new := case v_type
      when 'delivered' then 'delivered'::public.recipient_status
      when 'opened' then 'opened'
      when 'open' then 'opened'
      when 'clicked' then 'clicked'
      when 'click' then 'clicked'
      when 'bounced' then 'bounced'
      when 'bounce' then 'bounced'
      when 'complained' then 'complained'
      when 'complaint' then 'complained'
      when 'unsubscribed' then 'unsubscribed'
      when 'unsubscribe' then 'unsubscribed'
      else null end;
    if v_new is null then
      continue;
    end if;

    update public.send_recipients r
    set status = v_new, last_event_at = greatest(coalesce(r.last_event_at, v_occurred), v_occurred)
    where r.send_id = p_send_id and r.contact_id = v_recipient
      and r.status not in ('bounced', 'complained', 'unsubscribed')
      and (
        v_new in ('bounced', 'complained', 'unsubscribed')
        or array_position(forward, v_new) > array_position(forward, r.status)
      );
  end loop;

  update public.sends set last_polled_at = now() where id = p_send_id;
  return query select v_inserted, v_dups, v_unknown;
end $$;


ALTER FUNCTION "public"."ingest_provider_events"("p_send_id" "uuid", "p_events" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."open_share_link"("p_token" "text", "p_password" "text", "p_client_key" "text" DEFAULT NULL::"text") RETURNS TABLE("outcome" "text", "link_id" "uuid", "campaign_id" "uuid", "brand_id" "uuid", "expires_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  l public.share_links%rowtype;
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / 900) * 900);
  v_attempts integer;
begin
  if p_client_key is not null then
    delete from public.share_unlock_attempts where window_start < now() - interval '1 day';
    insert into public.share_unlock_attempts as a (client_key, window_start, attempts)
    values (p_client_key, v_window, 1)
    on conflict (client_key, window_start) do update set attempts = a.attempts + 1
    returning attempts into v_attempts;
    if v_attempts > 30 then
      return query select 'throttled'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
      return;
    end if;
  end if;

  -- Outcomes are returned, not raised: a raise would roll back the counts with it.
  -- FOR UPDATE: parallel wrong passwords queue on the row, so the tenth really is the tenth.
  select * into l from public.share_links
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  for update;
  if l.id is null or l.revoked_at is not null or l.expires_at <= now() then
    return query select 'unavailable'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;
  if l.locked_until is not null and l.locked_until > now() then
    return query select 'locked'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  if l.password_hash <> extensions.crypt(coalesce(p_password, ''), l.password_hash) then
    update public.share_links
    set failed_attempts = share_links.failed_attempts + 1,
        locked_until = case when share_links.failed_attempts + 1 >= 10
                            then now() + interval '15 minutes' else null end
    where id = l.id;
    return query select 'unavailable'::text, null::uuid, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  update public.share_links set failed_attempts = 0, locked_until = null where id = l.id;
  return query select 'ok'::text, l.id, l.campaign_id, l.brand_id, l.expires_at;
end $$;


ALTER FUNCTION "public"."open_share_link"("p_token" "text", "p_password" "text", "p_client_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preview_send_audience"("p_campaign_id" "uuid") RETURNS TABLE("audience_count" integer, "audience_definition" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select
    (select count(*)::int from public.contactable_contact_ids()) as audience_count,
    'status active, consent given, not deleted, not suppressed, has an email or phone, and no bounce, complaint or unsubscribe in the event log or from a send' as audience_definition
  from public.campaigns c where c.id = p_campaign_id
$$;


ALTER FUNCTION "public"."preview_send_audience"("p_campaign_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_results"("p_campaign_id" "uuid", "p_password" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_brand uuid;
  v_token text;
begin
  select brand_id into v_brand from public.campaigns where id = p_campaign_id;
  if v_brand is null or not app.is_owner_of(v_brand) then
    raise exception 'not permitted: only an owner of the campaign''s brand can share its results'
      using errcode = '42501';
  end if;
  if p_password is null or length(p_password) < 8 or length(p_password) > 128 then
    raise exception 'password must be 8 to 128 characters' using errcode = '22023';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.share_links (brand_id, campaign_id, token_hash, password_hash, created_by, expires_at)
  values (
    v_brand, p_campaign_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
    auth.uid(),
    now() + interval '30 days'
  );
  return v_token;
end $$;


ALTER FUNCTION "public"."publish_results"("p_campaign_id" "uuid", "p_password" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_send_batch"("p_send_id" "uuid", "p_chunk_index" integer, "p_idempotency_key" "text", "p_batch_id" "text", "p_accepted" "uuid"[], "p_rejected" "uuid"[], "p_reasons" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_brand uuid;
begin
  select brand_id into v_brand from public.sends where id = p_send_id and status = 'dispatching';
  if v_brand is null then
    raise exception 'send is not dispatching' using errcode = 'P0002';
  end if;
  insert into public.send_batches (send_id, brand_id, chunk_index, idempotency_key, provider_batch_id, accepted_count, rejected_count, rejection_reasons)
  values (p_send_id, v_brand, p_chunk_index, p_idempotency_key, p_batch_id,
          coalesce(array_length(p_accepted, 1), 0), coalesce(array_length(p_rejected, 1), 0), coalesce(p_reasons, '{}'::jsonb))
  on conflict (send_id, chunk_index) do nothing;
  update public.send_recipients set status = 'accepted'
  where send_id = p_send_id and contact_id = any(p_accepted) and status = 'queued';
  update public.send_recipients set status = 'rejected'
  where send_id = p_send_id and contact_id = any(p_rejected) and status = 'queued';
end $$;


ALTER FUNCTION "public"."record_send_batch"("p_send_id" "uuid", "p_chunk_index" integer, "p_idempotency_key" "text", "p_batch_id" "text", "p_accepted" "uuid"[], "p_rejected" "uuid"[], "p_reasons" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revoke_share_link"("p_link_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_brand uuid;
begin
  select brand_id into v_brand from public.share_links where id = p_link_id;
  if v_brand is null or not app.is_owner_of(v_brand) then
    raise exception 'not permitted: only an owner of the link''s brand can revoke it'
      using errcode = '42501';
  end if;
  update public.share_links set revoked_at = coalesce(revoked_at, now()) where id = p_link_id;
end $$;


ALTER FUNCTION "public"."revoke_share_link"("p_link_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_outcomes"("p_send_id" "uuid") RETURNS TABLE("queued" integer, "accepted" integer, "rejected" integer, "delivered" integer, "opened" integer, "clicked" integer, "bounced" integer, "complained" integer, "unsubscribed" integer, "total" integer, "events" integer, "batches" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select
    count(*) filter (where status = 'queued')::int,
    count(*) filter (where status = 'accepted')::int,
    count(*) filter (where status = 'rejected')::int,
    count(*) filter (where status = 'delivered')::int,
    count(*) filter (where status = 'opened')::int,
    count(*) filter (where status = 'clicked')::int,
    count(*) filter (where status = 'bounced')::int,
    count(*) filter (where status = 'complained')::int,
    count(*) filter (where status = 'unsubscribed')::int,
    count(*)::int,
    (select count(*)::int from public.provider_events e where e.send_id = p_send_id),
    (select count(*)::int from public.send_batches b where b.send_id = p_send_id)
  from public.send_recipients r where r.send_id = p_send_id
$$;


ALTER FUNCTION "public"."send_outcomes"("p_send_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."share_results"("p_link_id" "uuid") RETURNS TABLE("brand_name" "text", "campaign_external_id" "text", "campaign_name" "text", "channel" "text", "expires_at" timestamp with time zone, "sends" integer, "approved" integer, "delivered" integer, "opened" integer, "clicked" integer, "bounced" integer, "complained" integer, "unsubscribed" integer, "rejected" integer, "pending" integer, "last_dispatched_at" timestamp with time zone, "log_events" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  l public.share_links%rowtype;
begin
  select * into l from public.share_links where id = p_link_id;
  if l.id is null or l.revoked_at is not null or l.expires_at <= now() then
    raise exception 'unavailable' using errcode = 'P0002';
  end if;
  return query
  with s as (
    select id, approved_count, dispatched_at from public.sends
    where campaign_id = l.campaign_id and brand_id = l.brand_id and status = 'dispatched'
  ), r as (
    select r.status from public.send_recipients r join s on s.id = r.send_id
  )
  select
    b.name, c.external_id, c.name, c.channel::text, l.expires_at,
    (select count(*)::int from s),
    (select coalesce(sum(approved_count), 0)::int from s),
    (select count(*)::int from r where status = 'delivered'),
    (select count(*)::int from r where status = 'opened'),
    (select count(*)::int from r where status = 'clicked'),
    (select count(*)::int from r where status = 'bounced'),
    (select count(*)::int from r where status = 'complained'),
    (select count(*)::int from r where status = 'unsubscribed'),
    (select count(*)::int from r where status = 'rejected'),
    (select count(*)::int from r where status in ('queued', 'accepted')),
    (select max(dispatched_at) from s),
    (select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) from (
       select event_type::text as t, count(*)::int as n from public.engagement_events
       where brand_id = l.brand_id and campaign_id = l.campaign_id group by 1) x)
  from public.campaigns c join public.brands b on b.id = c.brand_id
  where c.id = l.campaign_id;
end $$;


ALTER FUNCTION "public"."share_results"("p_link_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."signups_last_30_days"() RETURNS TABLE("day" "date", "signups" integer)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    SET "TimeZone" TO 'UTC'
    AS $$
  with days as (
    select d::date as day
    from generate_series((current_date - 29)::timestamp, current_date::timestamp, interval '1 day') as d
  ),
  counts as (
    select (c.signup_at at time zone 'UTC')::date as day, count(*)::int as signups
    from public.contacts c
    where c.deleted_at is null
      and c.signup_at >= (current_date - 29)::timestamp at time zone 'UTC'
      and c.signup_at < (current_date + 1)::timestamp at time zone 'UTC'
    group by 1
  )
  select days.day, coalesce(counts.signups, 0) as signups
  from days left join counts on counts.day = days.day
  order by days.day
$$;


ALTER FUNCTION "public"."signups_last_30_days"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."allowed_emails" (
    "email" "text" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "role" "public"."membership_role" NOT NULL,
    "display_name" "text" NOT NULL,
    CONSTRAINT "allowed_emails_email_check" CHECK (("email" = "lower"("email")))
);

ALTER TABLE ONLY "public"."allowed_emails" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."allowed_emails" OWNER TO "postgres";


COMMENT ON TABLE "public"."allowed_emails" IS 'The only logins that may exist. Enforced by a trigger on auth.users. Never readable by clients.';



CREATE TABLE IF NOT EXISTS "public"."brands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "country" "text" NOT NULL,
    "timezone" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "brands_code_check" CHECK (("code" ~ '^[A-Z]{3,16}$'::"text")),
    CONSTRAINT "brands_country_check" CHECK (("country" ~ '^[A-Z]{2}$'::"text"))
);

ALTER TABLE ONLY "public"."brands" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "external_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "channel" "public"."channel" NOT NULL,
    "target_country" "text",
    "reported_sent" integer,
    "reported_delivered" integer,
    "reported_bounced" integer,
    "reported_opens" integer,
    "reported_clicks" integer,
    "spend" numeric(12,2),
    "sent_at" timestamp with time zone,
    "send_local_time" "text",
    "parent_external_id" "text",
    "parent_campaign_id" "uuid",
    "flags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "source_import_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "campaigns_external_id_check" CHECK (("external_id" ~ '^[A-Z]{2,5}-[0-9]{3,6}$'::"text")),
    CONSTRAINT "campaigns_reported_bounced_check" CHECK ((("reported_bounced" IS NULL) OR ("reported_bounced" >= 0))),
    CONSTRAINT "campaigns_reported_clicks_check" CHECK ((("reported_clicks" IS NULL) OR ("reported_clicks" >= 0))),
    CONSTRAINT "campaigns_reported_delivered_check" CHECK ((("reported_delivered" IS NULL) OR ("reported_delivered" >= 0))),
    CONSTRAINT "campaigns_reported_opens_check" CHECK ((("reported_opens" IS NULL) OR ("reported_opens" >= 0))),
    CONSTRAINT "campaigns_reported_sent_check" CHECK ((("reported_sent" IS NULL) OR ("reported_sent" >= 0))),
    CONSTRAINT "campaigns_spend_check" CHECK ((("spend" IS NULL) OR ("spend" >= (0)::numeric))),
    CONSTRAINT "campaigns_target_country_check" CHECK ((("target_country" IS NULL) OR ("target_country" ~ '^[A-Z]{2}$'::"text")))
);

ALTER TABLE ONLY "public"."campaigns" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."campaigns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."engagement_events" (
    "id" bigint NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "event_id" "text" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "event_type" "public"."engagement_event_type" NOT NULL,
    "raw_event_type" "text" NOT NULL,
    "channel" "public"."channel" NOT NULL,
    "occurred_at" timestamp with time zone NOT NULL,
    "source_import_id" "uuid",
    CONSTRAINT "engagement_events_event_id_check" CHECK (("event_id" <> ''::"text"))
);

ALTER TABLE ONLY "public"."engagement_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."engagement_events" OWNER TO "postgres";


ALTER TABLE "public"."engagement_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."engagement_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."import_rejects" (
    "id" bigint NOT NULL,
    "import_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "row_number" integer NOT NULL,
    "reason" "text" NOT NULL,
    "raw" "jsonb" NOT NULL
);

ALTER TABLE ONLY "public"."import_rejects" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_rejects" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."import_reject_summary" WITH ("security_invoker"='true') AS
 SELECT "import_id",
    "brand_id",
    "regexp_replace"("reason", '^(unknown campaign|unknown contact) .+$'::"text", '\1 …'::"text") AS "reason",
    ("count"(*))::integer AS "rows"
   FROM "public"."import_rejects" "r"
  GROUP BY "import_id", "brand_id", ("regexp_replace"("reason", '^(unknown campaign|unknown contact) .+$'::"text", '\1 …'::"text"));


ALTER VIEW "public"."import_reject_summary" OWNER TO "postgres";


ALTER TABLE "public"."import_rejects" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."import_rejects_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."imports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "kind" "public"."import_kind" NOT NULL,
    "file_name" "text" NOT NULL,
    "file_sha256" "text" NOT NULL,
    "encoding" "text" NOT NULL,
    "status" "public"."import_status" DEFAULT 'running'::"public"."import_status" NOT NULL,
    "rows_read" integer DEFAULT 0 NOT NULL,
    "rows_upserted" integer DEFAULT 0 NOT NULL,
    "rows_rejected" integer DEFAULT 0 NOT NULL,
    "rows_skipped_duplicate" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "error" "text",
    "rows_already_present" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."imports" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."imports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."memberships" (
    "user_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "role" "public"."membership_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."memberships" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."provider_events" (
    "id" bigint NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "send_id" "uuid" NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "recipient_id" "uuid",
    "occurred_at" timestamp with time zone,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "raw" "jsonb" NOT NULL
);

ALTER TABLE ONLY "public"."provider_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."provider_events" OWNER TO "postgres";


ALTER TABLE "public"."provider_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."provider_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."send_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "send_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "chunk_index" integer NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "provider_batch_id" "text" NOT NULL,
    "accepted_count" integer DEFAULT 0 NOT NULL,
    "rejected_count" integer DEFAULT 0 NOT NULL,
    "rejection_reasons" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "poll_cursor" "text",
    "last_polled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "send_batches_chunk_index_check" CHECK (("chunk_index" >= 0))
);

ALTER TABLE ONLY "public"."send_batches" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."send_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."send_log_entries" (
    "id" bigint NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "batch_key" "text" NOT NULL,
    "campaign_id" "uuid",
    "campaign_external_id" "text" NOT NULL,
    "queued_at" timestamp with time zone NOT NULL,
    "recipient_count" integer NOT NULL,
    "status" "text" NOT NULL,
    "attempt_no" integer NOT NULL,
    "source_import_id" "uuid",
    CONSTRAINT "send_log_entries_attempt_no_check" CHECK (("attempt_no" >= 1)),
    CONSTRAINT "send_log_entries_recipient_count_check" CHECK (("recipient_count" >= 0)),
    CONSTRAINT "send_log_entries_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'queued'::"text", 'failed'::"text", 'cancelled'::"text", 'partial'::"text"])))
);

ALTER TABLE ONLY "public"."send_log_entries" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."send_log_entries" OWNER TO "postgres";


ALTER TABLE "public"."send_log_entries" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."send_log_entries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."send_recipients" (
    "send_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "status" "public"."recipient_status" DEFAULT 'queued'::"public"."recipient_status" NOT NULL,
    "last_event_at" timestamp with time zone
);

ALTER TABLE ONLY "public"."send_recipients" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."send_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."share_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand_id" "uuid" NOT NULL,
    "campaign_id" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    "failed_attempts" integer DEFAULT 0 NOT NULL,
    "locked_until" timestamp with time zone
);

ALTER TABLE ONLY "public"."share_links" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."share_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."share_unlock_attempts" (
    "client_key" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."share_unlock_attempts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."share_unlock_attempts" OWNER TO "postgres";


ALTER TABLE ONLY "public"."allowed_emails"
    ADD CONSTRAINT "allowed_emails_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_brand_id_external_id_key" UNIQUE ("brand_id", "external_id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_brand_id_external_id_key" UNIQUE ("brand_id", "external_id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."engagement_events"
    ADD CONSTRAINT "engagement_events_brand_id_event_id_key" UNIQUE ("brand_id", "event_id");



ALTER TABLE ONLY "public"."engagement_events"
    ADD CONSTRAINT "engagement_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_rejects"
    ADD CONSTRAINT "import_rejects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."imports"
    ADD CONSTRAINT "imports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_pkey" PRIMARY KEY ("user_id", "brand_id");



ALTER TABLE ONLY "public"."provider_events"
    ADD CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."provider_events"
    ADD CONSTRAINT "provider_events_send_id_provider_event_id_key" UNIQUE ("send_id", "provider_event_id");



ALTER TABLE ONLY "public"."send_batches"
    ADD CONSTRAINT "send_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."send_batches"
    ADD CONSTRAINT "send_batches_send_id_chunk_index_key" UNIQUE ("send_id", "chunk_index");



ALTER TABLE ONLY "public"."send_batches"
    ADD CONSTRAINT "send_batches_send_id_provider_batch_id_key" UNIQUE ("send_id", "provider_batch_id");



ALTER TABLE ONLY "public"."send_log_entries"
    ADD CONSTRAINT "send_log_entries_brand_id_batch_key_attempt_no_key" UNIQUE ("brand_id", "batch_key", "attempt_no");



ALTER TABLE ONLY "public"."send_log_entries"
    ADD CONSTRAINT "send_log_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."send_recipients"
    ADD CONSTRAINT "send_recipients_pkey" PRIMARY KEY ("send_id", "contact_id");



ALTER TABLE ONLY "public"."sends"
    ADD CONSTRAINT "sends_idempotency_key_key" UNIQUE ("idempotency_key");



ALTER TABLE ONLY "public"."sends"
    ADD CONSTRAINT "sends_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sends"
    ADD CONSTRAINT "sends_provider_batch_id_key" UNIQUE ("provider_batch_id");



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."share_unlock_attempts"
    ADD CONSTRAINT "share_unlock_attempts_pkey" PRIMARY KEY ("client_key", "window_start");



CREATE INDEX "campaigns_brand_sent_idx" ON "public"."campaigns" USING "btree" ("brand_id", "sent_at" DESC);



CREATE INDEX "contacts_brand_email_idx" ON "public"."contacts" USING "btree" ("brand_id", "lower"("email"));



CREATE INDEX "contacts_brand_signup_idx" ON "public"."contacts" USING "btree" ("brand_id", "signup_at");



CREATE INDEX "contacts_brand_status_idx" ON "public"."contacts" USING "btree" ("brand_id", "status");



CREATE INDEX "engagement_events_campaign_idx" ON "public"."engagement_events" USING "btree" ("brand_id", "campaign_id", "event_type");



CREATE INDEX "engagement_events_contact_idx" ON "public"."engagement_events" USING "btree" ("brand_id", "contact_id");



CREATE INDEX "import_rejects_import_idx" ON "public"."import_rejects" USING "btree" ("brand_id", "import_id");



CREATE INDEX "imports_brand_started_idx" ON "public"."imports" USING "btree" ("brand_id", "started_at" DESC);



CREATE INDEX "send_batches_send_idx" ON "public"."send_batches" USING "btree" ("send_id", "chunk_index");



CREATE INDEX "send_recipients_status_idx" ON "public"."send_recipients" USING "btree" ("brand_id", "send_id", "status");



CREATE INDEX "sends_brand_campaign_idx" ON "public"."sends" USING "btree" ("brand_id", "campaign_id", "approved_at" DESC);



CREATE INDEX "sends_poll_idx" ON "public"."sends" USING "btree" ("status", "poll_complete") WHERE (("status" = 'dispatched'::"public"."send_status") AND ("poll_complete" = false));



CREATE INDEX "share_links_brand_idx" ON "public"."share_links" USING "btree" ("brand_id", "campaign_id");



CREATE OR REPLACE TRIGGER "campaigns_updated_at" BEFORE UPDATE ON "public"."campaigns" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "contacts_updated_at" BEFORE UPDATE ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "sends_updated_at" BEFORE UPDATE ON "public"."sends" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



ALTER TABLE ONLY "public"."allowed_emails"
    ADD CONSTRAINT "allowed_emails_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_parent_campaign_id_fkey" FOREIGN KEY ("parent_campaign_id") REFERENCES "public"."campaigns"("id");



ALTER TABLE ONLY "public"."campaigns"
    ADD CONSTRAINT "campaigns_source_import_id_fkey" FOREIGN KEY ("source_import_id") REFERENCES "public"."imports"("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_source_import_id_fkey" FOREIGN KEY ("source_import_id") REFERENCES "public"."imports"("id");



ALTER TABLE ONLY "public"."engagement_events"
    ADD CONSTRAINT "engagement_events_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."engagement_events"
    ADD CONSTRAINT "engagement_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id");



ALTER TABLE ONLY "public"."engagement_events"
    ADD CONSTRAINT "engagement_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."engagement_events"
    ADD CONSTRAINT "engagement_events_source_import_id_fkey" FOREIGN KEY ("source_import_id") REFERENCES "public"."imports"("id");



ALTER TABLE ONLY "public"."import_rejects"
    ADD CONSTRAINT "import_rejects_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."import_rejects"
    ADD CONSTRAINT "import_rejects_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."imports"
    ADD CONSTRAINT "imports_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."provider_events"
    ADD CONSTRAINT "provider_events_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."provider_events"
    ADD CONSTRAINT "provider_events_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."provider_events"
    ADD CONSTRAINT "provider_events_send_id_fkey" FOREIGN KEY ("send_id") REFERENCES "public"."sends"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."send_batches"
    ADD CONSTRAINT "send_batches_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."send_batches"
    ADD CONSTRAINT "send_batches_send_id_fkey" FOREIGN KEY ("send_id") REFERENCES "public"."sends"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."send_log_entries"
    ADD CONSTRAINT "send_log_entries_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."send_log_entries"
    ADD CONSTRAINT "send_log_entries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id");



ALTER TABLE ONLY "public"."send_log_entries"
    ADD CONSTRAINT "send_log_entries_source_import_id_fkey" FOREIGN KEY ("source_import_id") REFERENCES "public"."imports"("id");



ALTER TABLE ONLY "public"."send_recipients"
    ADD CONSTRAINT "send_recipients_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."send_recipients"
    ADD CONSTRAINT "send_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."send_recipients"
    ADD CONSTRAINT "send_recipients_send_id_fkey" FOREIGN KEY ("send_id") REFERENCES "public"."sends"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sends"
    ADD CONSTRAINT "sends_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."sends"
    ADD CONSTRAINT "sends_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."sends"
    ADD CONSTRAINT "sends_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id");



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id");



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id");



ALTER TABLE ONLY "public"."share_links"
    ADD CONSTRAINT "share_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE "public"."allowed_emails" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brands" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "brands_select_member" ON "public"."brands" FOR SELECT TO "authenticated" USING (("id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "campaigns_select_own_brand" ON "public"."campaigns" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_select_own_brand" ON "public"."contacts" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."engagement_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "engagement_events_select_own_brand" ON "public"."engagement_events" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."import_rejects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "import_rejects_select_own_brand" ON "public"."import_rejects" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."imports" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "imports_select_own_brand" ON "public"."imports" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."memberships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "memberships_select_self" ON "public"."memberships" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."provider_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "provider_events_select_own_brand" ON "public"."provider_events" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."send_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "send_batches_select_own_brand" ON "public"."send_batches" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."send_log_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "send_log_entries_select_own_brand" ON "public"."send_log_entries" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."send_recipients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "send_recipients_select_own_brand" ON "public"."send_recipients" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."sends" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sends_select_own_brand" ON "public"."sends" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."share_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "share_links_select_own_brand" ON "public"."share_links" FOR SELECT TO "authenticated" USING (("brand_id" IN ( SELECT "app"."user_brand_ids"() AS "user_brand_ids")));



ALTER TABLE "public"."share_unlock_attempts" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "app" TO "authenticated";
GRANT USAGE ON SCHEMA "app" TO "supabase_auth_admin";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "app"."create_membership_for_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."create_membership_for_new_user"() TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "app"."enforce_allowed_email"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."enforce_allowed_email"() TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "app"."is_owner_of"("p_brand_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."is_owner_of"("p_brand_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "app"."schedule_provider_poll"("p_url" "text", "p_secret" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."user_brand_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."user_brand_ids"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."approve_send"("p_campaign_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_send"("p_campaign_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."approve_send"("p_campaign_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."sends" TO "service_role";
GRANT SELECT ON TABLE "public"."sends" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."begin_dispatch"("p_send_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."begin_dispatch"("p_send_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."begin_dispatch"("p_send_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."campaign_performance"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."campaign_performance"() TO "service_role";
GRANT ALL ON FUNCTION "public"."campaign_performance"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."complete_dispatch"("p_send_id" "uuid", "p_expected_batches" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_dispatch"("p_send_id" "uuid", "p_expected_batches" integer) TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "service_role";
GRANT SELECT ON TABLE "public"."contacts" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."contact_is_contactable"("c" "public"."contacts") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."contact_is_contactable"("c" "public"."contacts") TO "service_role";



REVOKE ALL ON FUNCTION "public"."contactable_contact_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."contactable_contact_ids"() TO "service_role";
GRANT ALL ON FUNCTION "public"."contactable_contact_ids"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."dashboard_summary"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dashboard_summary"() TO "service_role";
GRANT ALL ON FUNCTION "public"."dashboard_summary"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."fail_dispatch"("p_send_id" "uuid", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_dispatch"("p_send_id" "uuid", "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_provider_events"("p_send_id" "uuid", "p_events" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_provider_events"("p_send_id" "uuid", "p_events" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."open_share_link"("p_token" "text", "p_password" "text", "p_client_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."open_share_link"("p_token" "text", "p_password" "text", "p_client_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."preview_send_audience"("p_campaign_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."preview_send_audience"("p_campaign_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."preview_send_audience"("p_campaign_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."publish_results"("p_campaign_id" "uuid", "p_password" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_results"("p_campaign_id" "uuid", "p_password" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."publish_results"("p_campaign_id" "uuid", "p_password" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_send_batch"("p_send_id" "uuid", "p_chunk_index" integer, "p_idempotency_key" "text", "p_batch_id" "text", "p_accepted" "uuid"[], "p_rejected" "uuid"[], "p_reasons" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_send_batch"("p_send_id" "uuid", "p_chunk_index" integer, "p_idempotency_key" "text", "p_batch_id" "text", "p_accepted" "uuid"[], "p_rejected" "uuid"[], "p_reasons" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."revoke_share_link"("p_link_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_share_link"("p_link_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."revoke_share_link"("p_link_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."send_outcomes"("p_send_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_outcomes"("p_send_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."send_outcomes"("p_send_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."share_results"("p_link_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."share_results"("p_link_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."signups_last_30_days"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."signups_last_30_days"() TO "service_role";
GRANT ALL ON FUNCTION "public"."signups_last_30_days"() TO "authenticated";



GRANT ALL ON TABLE "public"."allowed_emails" TO "service_role";



GRANT ALL ON TABLE "public"."brands" TO "service_role";
GRANT SELECT ON TABLE "public"."brands" TO "authenticated";



GRANT ALL ON TABLE "public"."campaigns" TO "service_role";
GRANT SELECT ON TABLE "public"."campaigns" TO "authenticated";



GRANT ALL ON TABLE "public"."engagement_events" TO "service_role";
GRANT SELECT ON TABLE "public"."engagement_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."engagement_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."import_rejects" TO "service_role";
GRANT SELECT ON TABLE "public"."import_rejects" TO "authenticated";



GRANT ALL ON TABLE "public"."import_reject_summary" TO "service_role";
GRANT SELECT ON TABLE "public"."import_reject_summary" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."import_rejects_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."imports" TO "service_role";
GRANT SELECT ON TABLE "public"."imports" TO "authenticated";



GRANT ALL ON TABLE "public"."memberships" TO "service_role";
GRANT SELECT ON TABLE "public"."memberships" TO "authenticated";



GRANT ALL ON TABLE "public"."provider_events" TO "service_role";
GRANT SELECT ON TABLE "public"."provider_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."provider_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."send_batches" TO "service_role";
GRANT SELECT ON TABLE "public"."send_batches" TO "authenticated";



GRANT ALL ON TABLE "public"."send_log_entries" TO "service_role";
GRANT SELECT ON TABLE "public"."send_log_entries" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."send_log_entries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."send_recipients" TO "service_role";
GRANT SELECT ON TABLE "public"."send_recipients" TO "authenticated";



GRANT ALL ON TABLE "public"."share_links" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."share_links" TO "authenticated";



GRANT SELECT("brand_id") ON TABLE "public"."share_links" TO "authenticated";



GRANT SELECT("campaign_id") ON TABLE "public"."share_links" TO "authenticated";



GRANT SELECT("created_by") ON TABLE "public"."share_links" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."share_links" TO "authenticated";



GRANT SELECT("expires_at") ON TABLE "public"."share_links" TO "authenticated";



GRANT SELECT("revoked_at") ON TABLE "public"."share_links" TO "authenticated";



GRANT SELECT("failed_attempts") ON TABLE "public"."share_links" TO "authenticated";



GRANT SELECT("locked_until") ON TABLE "public"."share_links" TO "authenticated";



GRANT ALL ON TABLE "public"."share_unlock_attempts" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







