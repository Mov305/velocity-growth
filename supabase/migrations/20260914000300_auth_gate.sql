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
