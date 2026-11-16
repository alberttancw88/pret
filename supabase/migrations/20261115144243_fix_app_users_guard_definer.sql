-- PRET W2-001 Foundation · 08 — fix found by supabase/tests/foundation_role_matrix.sql (E8):
-- app.tg_app_users_guard ends the sessions of a user being disabled (BR-ADM-06), but ran as
-- the invoker, and `authenticated` has no UPDATE on app.app_sessions. Run it as definer
-- (trigger-only: EXECUTE is revoked from every login role; search_path already pinned).
alter function app.tg_app_users_guard() security definer;
