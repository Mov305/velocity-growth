-- Per-connection throttle on the shared-link unlock, on top of the per-link lock.
-- The server hashes the caller's address and passes it as p_client_key; every unlock call from
-- that key is counted in a fifteen-minute window and the 31st is refused as 'throttled' before
-- any password is compared. Rows older than a day are swept on the way through.

create table public.share_unlock_attempts (
  client_key text not null,
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key (client_key, window_start)
);
alter table public.share_unlock_attempts enable row level security;
alter table public.share_unlock_attempts force row level security;
revoke all on public.share_unlock_attempts from public, anon, authenticated;

drop function if exists public.open_share_link(text, text);
create function public.open_share_link(p_token text, p_password text, p_client_key text default null)
returns table (outcome text, link_id uuid, campaign_id uuid, brand_id uuid, expires_at timestamptz)
language plpgsql security definer
set search_path = public
as $$
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
revoke all on function public.open_share_link(text, text, text) from public, anon, authenticated;
grant execute on function public.open_share_link(text, text, text) to service_role;
