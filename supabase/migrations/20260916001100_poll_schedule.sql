-- Provider feedback polling runs on a schedule inside Postgres: pg_cron fires every minute and
-- pg_net POSTs to the portal's /api/poll route with the shared secret. The URL and secret are
-- never written into a migration; they live in Vault and are set by scripts/schedule-poll.ts.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function app.schedule_provider_poll(p_url text, p_secret text)
returns text
language plpgsql security definer
set search_path = public
as $$
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
      timeout_milliseconds := 30000)
  $cmd$;

  perform cron.unschedule(jobid) from cron.job where jobname = 'poll-provider-feedback';
  perform cron.schedule('poll-provider-feedback', '* * * * *', v_cmd);
  return 'poll-provider-feedback scheduled every minute';
end $$;
revoke all on function app.schedule_provider_poll(text, text) from public, anon, authenticated, service_role;
