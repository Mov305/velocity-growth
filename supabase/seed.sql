-- The three tenants. Logins are seeded by scripts/seed-users.ts, never by SQL, so no email lives in the repo.
insert into public.brands (code, name, country, timezone) values
  ('KILELE', 'Kilele Rides', 'KE', 'Africa/Nairobi'),
  ('KAROO', 'Karoo Coaches', 'ZA', 'Africa/Johannesburg'),
  ('MARRAKECH', 'Marrakech Express', 'MA', 'Africa/Casablanca')
on conflict (code) do nothing;
