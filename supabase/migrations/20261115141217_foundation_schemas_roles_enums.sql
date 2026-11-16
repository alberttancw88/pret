-- PRET W2-001 Foundation · 01 — extensions, schemas, database roles, foundation enums
-- Design: data-model.md §1, §3; rls-policies.md §2; ADR-0001, ADR-0002, ADR-0008.
-- Synthetic / structural only. No personal data.

-- ---------------------------------------------------------------------------
-- Extensions (schema `extensions`, Supabase convention)
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto   with schema extensions;
create extension if not exists citext     with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm    with schema extensions;
-- pg_graphql is deliberately NOT installed (ADR-0002: no GraphQL Data API).

-- ---------------------------------------------------------------------------
-- Schemas
--   app     business tables + RLS helpers
--   audit   append-only audit / access logs
--   private counters, rate limits, internals — no `authenticated` access
--   public  stays empty
-- ---------------------------------------------------------------------------
create schema if not exists app;
create schema if not exists audit;
create schema if not exists private;

revoke all on schema app, audit, private from public;
revoke all on schema app, audit, private from anon;
revoke create on schema public from public;

-- New functions are not executable by PUBLIC unless explicitly granted.
alter default privileges in schema app     revoke execute on functions from public;
alter default privileges in schema audit   revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Database roles (rls-policies.md §2). Created NOLOGIN: passwords are secrets and
-- are set by Albert in the dashboard SQL editor (manual step), never in a migration.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pret_app') then
    create role pret_app nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'pret_jobs') then
    create role pret_jobs nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'audit_writer') then
    create role audit_writer nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'audit_owner') then
    create role audit_owner nologin noinherit;
  end if;
end $$;

-- pret_app: no privileges of its own; must `set local role authenticated` per transaction.
grant authenticated to pret_app;
-- pret_jobs: scheduled jobs; `set local role service_role` per transaction (BYPASSRLS).
grant service_role to pret_jobs;
-- The migration role (postgres) must be able to hand objects to the audit roles,
-- without inheriting their privileges.
grant audit_writer to postgres with inherit false, set true;
grant audit_owner  to postgres with inherit false, set true;

grant usage on schema app to authenticated, service_role, audit_writer, audit_owner;
grant usage on schema audit to authenticated, service_role, audit_writer;
grant all   on schema audit to audit_owner;
grant usage on schema private to service_role;
grant usage on schema extensions to audit_writer, audit_owner;

-- ---------------------------------------------------------------------------
-- Foundation enums (data-model §3 — only those the foundation tables use;
-- module enums arrive with their module migrations).
-- ---------------------------------------------------------------------------
create type app.user_type        as enum ('employee','external');
create type app.user_status      as enum ('invited','active','locked','disabled','expired');
create type app.privileged_role  as enum ('ADM','SA');             -- EMP implicit, MGR derived
create type app.delegation_scope as enum ('leave','claims','both');
create type app.my_state         as enum ('JHR','KDH','KTN','MLK','NSN','PHG','PNG','PRK','PLS','SBH','SWK','SGR','TRG','KUL','LBN','PJY');

create type app.file_status       as enum ('pending_upload','active','superseded','deleted');
create type app.file_subject      as enum ('employee_document','employee_photo','leave_attachment','claim_receipt','change_request_doc','privacy_notice','company_asset','import_source','generated_output','cp38_letter','tp1_doc');
create type app.email_status      as enum ('pending','sending','sent','failed','suppressed');
create type app.data_category     as enum ('identity','contact','family','health','religion','bank','statutory','compensation','payslip');
create type app.audit_action      as enum ('create','update','status_change','approve','reject','return','cancel','delete_draft','login','login_failed','logout','view_sensitive','reveal','download','export','import','config_change','payroll_calculate','payroll_approve','payroll_finalise','payroll_reopen','role_change','record_open');
create type app.job_status        as enum ('running','succeeded','failed');
create type app.login_outcome     as enum ('success','failure','locked','mfa_failure','disabled','expired');

grant usage on type app.user_type, app.user_status, app.privileged_role, app.delegation_scope, app.my_state,
                    app.file_status, app.file_subject, app.email_status, app.data_category, app.audit_action,
                    app.job_status, app.login_outcome
  to authenticated, service_role, audit_writer, audit_owner;
