-- PRET W2-001 Foundation · 07 — reference rows every environment needs (no personal data)
-- The company profile is NOT seeded here: dev uses supabase/seed.sql (synthetic);
-- production gets Interact's real profile entered by the Super Admin at go-live.

-- The "PRET System" actor: grantor of the first Super Admin (nobody may grant themselves —
-- BR-ADM-03, chk_not_self_grant). Disabled external user with a closed window: it can never sign in.
insert into app.app_users (id, user_type, employee_id, login_email, display_name, status,
                           access_start_date, access_end_date, service_provider, disabled_reason)
values ('00000000-0000-0000-0000-000000000001', 'external', null, 'system@pret.invalid', 'PRET System',
        'disabled', date '2026-01-01', date '2026-01-01', 'PRET (system actor)', 'System actor — never signs in')
on conflict (id) do nothing;

-- Control settings singleton with the PRD defaults (security_settings has no insert policy — seeded).
insert into app.security_settings (id, employee_no_next) values (1, 1)
on conflict (id) do nothing;

-- Key metadata only — key material lives in Vercel / .env (ADR-0003), never in the database.
insert into private.key_versions (key_id, purpose, activated_at) values
  (1, 'field_encryption', now()),
  (2, 'blind_index', now())
on conflict (key_id) do nothing;
