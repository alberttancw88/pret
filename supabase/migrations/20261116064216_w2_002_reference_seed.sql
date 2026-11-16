-- PRET W2-002 · 13 — organisation reference rows every environment needs (no personal data)
-- PRD §9.2 seed (from Kakitangan): departments Management / Development / Administration.
-- PRD §9.3 seed (Q14): working pattern "Standard Mon–Fri" (Mon–Fri full, Sat off, Sun rest).
-- Zakat authorities: one generic row per state (Federal Territories share one) for the CO12 picker;
-- names are generic labels, not gazette names — Admin confirms the employer refs per authority.
-- Work location and public holidays are NOT seeded here (address and gazette dates are entered by HR;
-- dev uses supabase/seed.sql with synthetic values).

insert into app.working_patterns (id, name, is_active)
values ('00000000-0000-4000-8000-00000000a001', 'Standard Mon–Fri', true)
on conflict do nothing;

insert into app.working_pattern_versions (pattern_id, effective_from, mon, tue, wed, thu, fri, sat, sun, hours_per_full_day, month_day_basis)
values ('00000000-0000-4000-8000-00000000a001', date '2026-01-01', 'full', 'full', 'full', 'full', 'full', 'off', 'rest', 8.0, 'fixed_26')
on conflict do nothing;

insert into app.departments (code, name) values
  ('MGT', 'Management'),
  ('DEV', 'Development'),
  ('ADMIN', 'Administration')
on conflict do nothing;

insert into app.zakat_bodies (state, name, code) values
  ('JHR', 'Zakat authority — Johor', 'ZK-JHR'),
  ('KDH', 'Zakat authority — Kedah', 'ZK-KDH'),
  ('KTN', 'Zakat authority — Kelantan', 'ZK-KTN'),
  ('MLK', 'Zakat authority — Melaka', 'ZK-MLK'),
  ('NSN', 'Zakat authority — Negeri Sembilan', 'ZK-NSN'),
  ('PHG', 'Zakat authority — Pahang', 'ZK-PHG'),
  ('PNG', 'Zakat authority — Pulau Pinang', 'ZK-PNG'),
  ('PRK', 'Zakat authority — Perak', 'ZK-PRK'),
  ('PLS', 'Zakat authority — Perlis', 'ZK-PLS'),
  ('SBH', 'Zakat authority — Sabah', 'ZK-SBH'),
  ('SWK', 'Zakat authority — Sarawak', 'ZK-SWK'),
  ('SGR', 'Zakat authority — Selangor', 'ZK-SGR'),
  ('TRG', 'Zakat authority — Terengganu', 'ZK-TRG'),
  ('KUL', 'Zakat authority — Wilayah Persekutuan', 'ZK-WP')
on conflict do nothing;
