-- PRET W2-002 · 14 — the company profile is entered by the Super Admin at go-live (foundation 07 note),
-- so the singleton needs an SA insert path (rls-policies §5.1 listed "— (seeded)"; production is not seeded).
grant insert on app.company_profile to authenticated;
create policy company_profile_insert on app.company_profile for insert to authenticated
  with check ((select app.is_sa()) and id = 1);
