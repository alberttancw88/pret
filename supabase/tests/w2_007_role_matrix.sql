-- PRET W2-007 — role matrix for M7 reports & exports and M8 notifications: report data per role (MGR team-only, no sensitive data),
-- sensitive-report access logging, notification log (A15) access and content, email retry, templates (A16, SA edit, PDPA guard),
-- payroll-input export register, the notification-daily job (N-54, N-58, outbox housekeeping) and preferences respected.
-- (rls-policies.md §5.7, §8, §11; data-model §10/§11; PRD §11, §12; ADR-0010; F-RPT-02/05/08/11/13/21/27; F-NTF-01/04/05/06/07/08.)
-- Runs entirely inside ONE transaction that is rolled back: no data is left behind.
-- Synthetic fixtures only (example.invalid emails, random UUIDs). No notification or email is created for INT-001 or any other
-- non-sample person: before the nightly job runs (inside a savepoint that is rolled back) every non-test user is set inactive
-- within this uncommitted transaction, so the job's recipients are test users only.
--   DATABASE_CA_CERT_FILE=private/supabase-ca.crt node --env-file=.env.local supabase/tests/run.cjs supabase/tests/w2_007_role_matrix.sql

begin;

create temp table t_results (id serial primary key, test text not null, pass boolean not null, detail text);
create temp table t_held (id serial primary key, test text not null, pass boolean not null, detail text);
create temp table fx (n text primary key, auth_id uuid, app_id uuid, emp_id uuid);
create temp table ids (k text primary key, id uuid, v text);
grant select, insert, update on fx, ids to authenticated;

create function pg_temp.r(p_test text, p_pass boolean, p_detail text default null) returns void
language sql as $$ insert into t_results (test, pass, detail) values (p_test, coalesce(p_pass, false), left(p_detail, 600)) $$;
create function pg_temp.j(p_test text, p_pass boolean, p_detail text default null) returns jsonb
language sql as $$ select jsonb_build_array(jsonb_build_object('t', p_test, 'p', coalesce(p_pass, false), 'd', left(p_detail, 600))) $$;
create function pg_temp.login(p_sub uuid, p_aal text default 'aal1') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', p_aal, 'session_id', gen_random_uuid())::text, true);
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.logout() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create function pg_temp.aal(p_n text) returns text language sql as $$ select case when p_n in ('sa','adm','ext') then 'aal2' else 'aal1' end $$;
create function pg_temp.as_user(p_n text, p_sql text) returns text
language plpgsql as $$
declare v text; s uuid;
begin
  select auth_id into s from fx where n = p_n;
  perform pg_temp.login(s, pg_temp.aal(p_n));
  begin
    execute p_sql into v;
  exception when others then v := 'ERR: ' || sqlerrm;
  end;
  perform pg_temp.logout();
  return coalesce(v, '');
end $$;
create function pg_temp.emp(p_n text) returns uuid language sql as $$ select emp_id from fx where n = p_n $$;
create function pg_temp.usr(p_n text) returns uuid language sql as $$ select app_id from fx where n = p_n $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from ids where k = p_k $$;

-- ---------------------------------------------------------------------------
-- Fixtures (system writes)
-- ---------------------------------------------------------------------------
with g as (insert into app.grades (code, name, rank) values ('W7G1', 'W7 TEST grade', 993) returning id) insert into ids select 'grade', id from g;
with p as (insert into app.positions (code, title) values ('W7POS', 'W7 TEST position') returning id) insert into ids select 'pos', id from p;
with d as (insert into app.departments (code, name) values ('W7DEP', 'W7 TEST department') returning id) insert into ids select 'dept', id from d;
insert into ids select 'pat', id, null from app.working_patterns where is_active order by name limit 1;
with l as (insert into app.work_locations (name, state, default_pattern_id, addr_line1, postcode, city)
           values ('W7 TEST location (Perlis)', 'PLS', pg_temp.id('pat'), '1 Jalan Ujian', '01000', 'Kangar') returning id)
insert into ids select 'loc', id from l;
update app.security_settings set max_top_of_org = 5, mfa_required_privileged = true where id = 1;

create function pg_temp.mk_emp(p_id uuid, p_no text, p_mgr uuid, p_join date, p_top boolean default false, p_status app.employment_status default 'confirmed') returns void
language plpgsql as $$
begin
  insert into app.employees (id, employee_no, full_name, gender, work_email, mobile_phone, join_date, probation_months,
                             department_id, position_id, grade_id, manager_employee_id, work_location_id, work_state, working_pattern_id, status)
  values (p_id, p_no, 'Sample Employee ' || regexp_replace(p_no, '[^A-Za-z]', '', 'g'), 'female', lower(p_no) || '@example.invalid', '+60120000000', p_join,
          case when p_status = 'on_probation' then 3 else 0 end,
          pg_temp.id('dept'), pg_temp.id('pos'), pg_temp.id('grade'), p_mgr, pg_temp.id('loc'), 'PLS', pg_temp.id('pat'), p_status);
  insert into app.employee_hr_private (employee_id, is_top_of_org) values (p_id, p_top);
  insert into app.employee_personal (employee_id, nric_enc, nric_last4, nric_bidx, date_of_birth, personal_email, res_addr_line1,
                                     res_postcode, res_city, res_state, continuous_service_date)
  values (p_id, extensions.gen_random_bytes(40), '0000', extensions.gen_random_bytes(32), date '1990-01-01',
          lower(p_no) || '.home@example.invalid', '1 Jalan Contoh', '01000', 'Kangar', 'PLS', p_join);
  insert into app.employee_sensitive (employee_id, religion, is_oku) values (p_id, 'none', false);
  insert into app.employee_statutory_profiles (employee_id) values (p_id);
  insert into app.employee_statutory_employer_flags (employee_id) values (p_id);
  insert into app.employee_marital_history (employee_id, marital_status, effective_date) values (p_id, 'single', p_join);
  insert into app.employee_emergency_contacts (employee_id, priority, name, relationship, mobile_phone) values (p_id, 1, 'Sample Contact', 'parent', '+60120000001');
end $$;

-- Isolation (brief rule 7): inside this uncommitted transaction every real user is set to 'invited' first, so no trigger or job
-- of this suite can create a notification or email for INT-001 or any other non-sample person (role-holder notifications and
-- emails go to ACTIVE users only). 'invited' still counts for the last-Super-Admin guard. Rolled back at the end.
create temp table real_users as select id from app.app_users where status = 'active' and id <> '00000000-0000-0000-0000-000000000001';
update app.app_users set status = 'invited' where id in (select id from real_users);

insert into fx (n, auth_id, emp_id) values
  ('sa', gen_random_uuid(), gen_random_uuid()), ('adm', gen_random_uuid(), gen_random_uuid()), ('mgr', gen_random_uuid(), gen_random_uuid()),
  ('emp1', gen_random_uuid(), gen_random_uuid()), ('emp2', gen_random_uuid(), gen_random_uuid()), ('other', gen_random_uuid(), gen_random_uuid()),
  ('ext', gen_random_uuid(), null);
select pg_temp.mk_emp(pg_temp.emp('sa'),    'W7T-SA',   null,               app.today_myt() - 900, true);
select pg_temp.mk_emp(pg_temp.emp('adm'),   'W7T-ADM',  pg_temp.emp('sa'),  app.today_myt() - 800);
select pg_temp.mk_emp(pg_temp.emp('mgr'),   'W7T-MGR',  pg_temp.emp('sa'),  app.today_myt() - 700);
select pg_temp.mk_emp(pg_temp.emp('emp1'),  'W7T-EMPA', pg_temp.emp('mgr'), app.today_myt() - 60, false, 'on_probation');
select pg_temp.mk_emp(pg_temp.emp('emp2'),  'W7T-EMPB', pg_temp.emp('mgr'), app.today_myt() - 600);
select pg_temp.mk_emp(pg_temp.emp('other'), 'W7T-OTH',  pg_temp.emp('sa'),  app.today_myt() - 50, false, 'on_probation');
select app.rebuild_reporting_closure();
insert into auth.users (id, email, aud, role) select auth_id, 'pret-w7-' || n || '@example.invalid', 'authenticated', 'authenticated' from fx;
insert into app.app_users (auth_user_id, user_type, employee_id, login_email, display_name, status, access_start_date, access_end_date, service_provider)
select f.auth_id, case when f.emp_id is null then 'external' else 'employee' end::app.user_type, f.emp_id, 'pret-w7-' || f.n || '@example.invalid',
       'W7 Test ' || upper(f.n), 'active', app.today_myt() - 30, case f.n when 'ext' then app.today_myt() + 7 end,
       case when f.emp_id is null then 'Example Outsourcing (TEST)' end
  from fx f;
update fx set app_id = u.id from app.app_users u where u.login_email = 'pret-w7-' || fx.n || '@example.invalid';
insert into app.user_roles (user_id, role, granted_by) values (pg_temp.usr('sa'), 'SA', '00000000-0000-0000-0000-000000000001');
insert into app.user_roles (user_id, role, granted_by) select app_id, 'ADM', pg_temp.usr('sa') from fx where n in ('adm','ext');

-- notifications and outbox rows (system writes, as the database functions do)
insert into ids select 'n_emp1', app.notify(pg_temp.usr('emp1'), 'N-02', 'Leave approved: LV-TEST-00001', 'Annual Leave (TEST)', '/my/leave/LV-TEST-00001', false,
                                           'leave_approved', jsonb_build_object('reference', 'LV-TEST-00001', 'type', 'Annual Leave'));
insert into ids select 'n_emp2', app.notify(pg_temp.usr('emp2'), 'N-22', 'Claim approved: CL-TEST-00002', 'RM 10.00 (TEST)', '/my/claims/CL-TEST-00002', false,
                                           'claim_approved', jsonb_build_object('reference', 'CL-TEST-00002', 'total', 'RM 10.00'));
insert into ids select 'o_emp1', o.id from app.email_outbox o where o.notification_id = pg_temp.id('n_emp1');
insert into ids select 'o_emp2', o.id from app.email_outbox o where o.notification_id = pg_temp.id('n_emp2');
update app.email_outbox set status = 'failed', attempts = 5, last_error = 'Provider error: test' where id = pg_temp.id('o_emp2');
with o as (insert into app.email_outbox (to_user_id, to_address, template_code, subject, payload, status, attempts)
           values (pg_temp.usr('emp1'), 'pret-w7-emp1@example.invalid', 'leave_rejected', 'Leave rejected: LV-TEST-00009', '{}'::jsonb, 'failed', 2) returning id)
insert into ids select 'o_retrying', id from o;
with o as (insert into app.email_outbox (to_user_id, to_address, template_code, subject, payload, status, attempts, sent_at)
           values (pg_temp.usr('emp1'), 'pret-w7-emp1@example.invalid', 'leave_approved', 'Leave approved: LV-TEST-00010', '{}'::jsonb, 'sent', 1, now()) returning id)
insert into ids select 'o_sent', id from o;

-- leave: one approved Annual Leave day today for emp1 (team), one for "other" (not in the MGR's team)
insert into ids select 'lt_al', id, null from app.leave_types where code = 'AL';
create function pg_temp.mk_leave(p_emp uuid, p_ref text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into app.leave_applications (id, ref_no, employee_id, leave_type_id, leave_year, start_date, start_session, end_date, end_session, days, status, submitted_at, decided_at)
  values (v, p_ref, p_emp, pg_temp.id('lt_al'), extract(year from app.today_myt())::int, app.today_myt(), 'full', app.today_myt(), 'full', 1, 'approved', now(), now());
  insert into app.leave_application_days (application_id, employee_id, leave_date, session, slot, weight, day_kind, day_label, leave_year, is_blocking)
  values (v, p_emp, app.today_myt(), 'full', int4range(0, 2), 1, 'working', 'Working day', extract(year from app.today_myt())::int, true);
  return v;
end $$;
do $$ begin
  begin
    insert into ids values ('lv_emp1', pg_temp.mk_leave(pg_temp.emp('emp1'), 'LV-W7T-00001'));
    insert into ids values ('lv_other', pg_temp.mk_leave(pg_temp.emp('other'), 'LV-W7T-00002'));
  exception when others then insert into ids values ('lv_error', null, left(sqlerrm, 300));
  end;
end $$;

-- ===========================================================================
-- A. anon
-- ===========================================================================
do $$ declare e1 text; e2 text; e3 text; e4 text;
begin
  execute 'set local role anon';
  begin perform 1 from app.notification_templates limit 1; e1 := 'no error'; exception when others then e1 := sqlerrm; end;
  begin perform 1 from app.payroll_input_exports limit 1; e2 := 'no error'; exception when others then e2 := sqlerrm; end;
  begin perform * from app.notification_log(null, null, null, null, null, null, 'at', 'desc', 10, 0); e3 := 'no error'; exception when others then e3 := sqlerrm; end;
  begin perform * from app.report_sensitive_rows(array[gen_random_uuid()], 'x'); e4 := 'no error'; exception when others then e4 := sqlerrm; end;
  execute 'reset role';
  perform pg_temp.r('A1 anon cannot read notification templates', e1 like '%permission denied%', e1);
  perform pg_temp.r('A2 anon cannot read the payroll-input export register', e2 like '%permission denied%', e2);
  perform pg_temp.r('A3 anon cannot read the notification log', e3 like '%permission denied%', e3);
  perform pg_temp.r('A4 anon cannot read sensitive report rows', e4 like '%permission denied%', e4);
end $$;

-- ===========================================================================
-- R. Report data per role (the report queries read through RLS / these definer functions)
-- ===========================================================================
do $$ declare v text;
begin
  -- F-RPT-11 who's on leave: MGR sees team only (emp1), not "other"; ADM sees both
  v := pg_temp.as_user('mgr', format('select count(distinct d.employee_id)::text from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
      join app.employees e on e.id = d.employee_id where d.leave_date = app.today_myt() and app.is_manager_of(e.id) and d.employee_id in (%L, %L)', pg_temp.emp('emp1'), pg_temp.emp('other')));
  perform pg_temp.r('R1 MGR who''s-on-leave (team filter) = own reportee only', v = '1' or exists (select 1 from ids where k = 'lv_error'), v || ' ' || coalesce((select i.v from ids i where i.k = 'lv_error'), ''));
  v := pg_temp.as_user('mgr', format('select count(*)::text from app.leave_applications a where a.employee_id = %L', pg_temp.emp('other')));
  perform pg_temp.r('R2 MGR cannot read leave of an employee outside the team (RLS)', v = '0', v);
  v := pg_temp.as_user('adm', format('select count(*)::text from app.leave_applications a where a.id in (%L, %L)', pg_temp.id('lv_emp1'), pg_temp.id('lv_other')));
  perform pg_temp.r('R3 ADM reads leave of every employee', v = '2' or exists (select 1 from ids where k = 'lv_error'), v);
  -- F-RPT-05 probation due: MGR sees emp1 (team, on probation), never "other"
  v := pg_temp.as_user('mgr', format('select string_agg(e.employee_no, '','' order by e.employee_no) from app.employees e where e.status = ''on_probation''
      and app.is_manager_of(e.id) and e.id in (%L, %L)', pg_temp.emp('emp1'), pg_temp.emp('other')));
  perform pg_temp.r('R4 MGR probation-due = team only', v = 'W7T-EMPA', v);
  -- rls §8: managers never read NRIC / bank / religion / statutory rows of reportees
  v := pg_temp.as_user('mgr', format('select (select count(*) from app.employee_personal where employee_id = %1$L)::text || ''/'' ||
      (select count(*) from app.employee_sensitive where employee_id = %1$L)::text || ''/'' || (select count(*) from app.employee_statutory_profiles where employee_id = %1$L)::text || ''/'' ||
      (select count(*) from app.employee_bank_accounts where employee_id = %1$L)::text', pg_temp.emp('emp1')));
  perform pg_temp.r('R5 MGR cannot read personal / sensitive / statutory / bank rows of a reportee', v = '0/0/0/0', v);
  -- leave_balance_view: MGR for team only; EMP for self only (F-RPT-08 / F-RPT-27)
  v := pg_temp.as_user('mgr', format('select (app.leave_balance_view(%L, %L, extract(year from app.today_myt())::int, app.today_myt()) ? ''available'')::text', pg_temp.emp('emp1'), pg_temp.id('lt_al')));
  perform pg_temp.r('R6 MGR can read a reportee''s balance (leave balances / P7)', v = 'true', v);
  v := pg_temp.as_user('mgr', format('select app.leave_balance_view(%L, %L, extract(year from app.today_myt())::int, app.today_myt())::text', pg_temp.emp('other'), pg_temp.id('lt_al')));
  perform pg_temp.r('R7 MGR cannot read the balance of an employee outside the team', v like 'ERR:%', v);
  v := pg_temp.as_user('emp1', format('select app.leave_balance_view(%L, %L, extract(year from app.today_myt())::int, app.today_myt())::text', pg_temp.emp('emp2'), pg_temp.id('lt_al')));
  perform pg_temp.r('R8 EMP cannot read another employee''s balance (P7 own only)', v like 'ERR:%', v);
  -- F-RPT-07 completeness definer is admin-only
  v := pg_temp.as_user('mgr', format('select count(*)::text from app.employee_completeness(array[%L]::uuid[])', pg_temp.emp('emp1')));
  perform pg_temp.r('R9 MGR gets nothing from the completeness function', v = '0', v);
  v := pg_temp.as_user('adm', format('select count(*)::text from app.employee_completeness(array[%L]::uuid[])', pg_temp.emp('emp1')));
  perform pg_temp.r('R10 ADM gets the completeness row (same function as the Employees list)', v = '1', v);
  -- claims and batches (F-RPT-16…20): ADM only
  v := pg_temp.as_user('emp1', 'select count(*)::text from app.disbursement_batches');
  perform pg_temp.r('R11 EMP cannot read disbursement batches', v = '0', v);
end $$;

-- ===========================================================================
-- S. Sensitive report columns (F-RPT-02 religion / OKU) — ADM / SA only, access-logged first
-- ===========================================================================
do $$ declare v text; n_before int; n_after int;
begin
  select count(*) into n_before from audit.access_log where entity_type = 'employee_sensitive' and actor_user_id = pg_temp.usr('adm');
  v := pg_temp.as_user('adm', format('select string_agg(religion || '':'' || is_oku::text, '','') from app.report_sensitive_rows(array[%L, %L]::uuid[], ''Employee master report'')',
       pg_temp.emp('emp1'), pg_temp.emp('emp2')));
  select count(*) into n_after from audit.access_log where entity_type = 'employee_sensitive' and actor_user_id = pg_temp.usr('adm')
     and 'religion' = any(data_categories::text[]) and cardinality(employee_ids) = 2;
  perform pg_temp.r('S1 ADM reads religion / OKU for the employee-master report', v = 'none:false,none:false', v);
  perform pg_temp.r('S2 the read wrote ONE access-log row with both employees and the religion + health categories', n_after = n_before + 1, n_before || '→' || n_after);
  v := pg_temp.as_user('mgr', format('select count(*)::text from app.report_sensitive_rows(array[%L]::uuid[], ''x'')', pg_temp.emp('emp1')));
  perform pg_temp.r('S3 MGR cannot read sensitive report rows', v like 'ERR:%', v);
  v := pg_temp.as_user('emp1', format('select count(*)::text from app.report_sensitive_rows(array[%L]::uuid[], ''x'')', pg_temp.emp('emp1')));
  perform pg_temp.r('S4 EMP cannot use the report sensitive function (even for self)', v like 'ERR:%', v);
  -- exports are logged by the server through audit.write_access (any signed-in user can write its own row; actor taken from the session)
  v := pg_temp.as_user('mgr', 'select audit.write_access(''export''::app.audit_action, ''report:probation-due'', null, ''{}''::uuid[], ''{}''::text[], ''{}''::app.data_category[], null, ''csv'', 1, null, null)::text');
  perform pg_temp.r('S5 a manager''s report export is access-logged with the manager as actor',
    exists (select 1 from audit.access_log a where a.id = v::bigint and a.actor_user_id = pg_temp.usr('mgr') and a.action = 'export' and a.entity_type = 'report:probation-due'), v);
end $$;

-- ===========================================================================
-- L. A15 notification log — ADM / SA (incl. External ADM); summary only; statuses; filters
-- ===========================================================================
do $$ declare v text;
begin
  v := pg_temp.as_user('adm', format('select string_agg(channel || ''='' || status, '','' order by channel) from app.notification_log(null, null, null, null, null, null, ''at'', ''desc'', 1000, 0)
      where id in (%L, %L)', pg_temp.id('n_emp1'), pg_temp.id('o_emp1')));
  perform pg_temp.r('L1 ADM sees the email (Queued) and the in-app row (Delivered) of another user', v = 'email=queued,in_app=delivered', v);
  v := pg_temp.as_user('sa', format('select status from app.notification_log(null, null, array[''email''], null, null, null, ''at'', ''desc'', 1000, 0) where id = %L', pg_temp.id('o_emp2')));
  perform pg_temp.r('L2 failed after 5 attempts = Failed', v = 'failed', v);
  v := pg_temp.as_user('sa', format('select status from app.notification_log(null, null, array[''email''], null, null, null, ''at'', ''desc'', 1000, 0) where id = %L', pg_temp.id('o_retrying')));
  perform pg_temp.r('L3 failed with attempts left = Retrying', v = 'retrying', v);
  v := pg_temp.as_user('ext', format('select count(*)::text from app.notification_log(null, null, null, null, null, null, ''at'', ''desc'', 1000, 0) where id = %L', pg_temp.id('o_emp1')));
  perform pg_temp.r('L4 External ADM can read the log (ADM role)', v = '1', v);
  v := pg_temp.as_user('mgr', 'select count(*)::text from app.notification_log(null, null, null, null, null, null, ''at'', ''desc'', 10, 0)');
  perform pg_temp.r('L5 MGR cannot read the notification log', v like 'ERR:%PRET-ACC-403%', v);
  v := pg_temp.as_user('emp1', 'select count(*)::text from app.notification_log(null, null, null, null, null, null, ''at'', ''desc'', 10, 0)');
  perform pg_temp.r('L6 EMP cannot read the notification log', v like 'ERR:%PRET-ACC-403%', v);
  v := pg_temp.as_user('adm', 'select count(*)::text from app.notification_log(''LV-TEST-00001'', array[''N-02''], array[''email''], array[''queued''], app.today_myt(), app.today_myt(), ''at'', ''desc'', 100, 0)');
  perform pg_temp.r('L7 search + event + channel + status + date filters narrow to the one email', v = '1', v);
  v := pg_temp.as_user('adm', format('select recipient_email || ''|'' || summary from app.notification_log(null, null, array[''email''], null, null, null, ''at'', ''desc'', 1000, 0) where id = %L', pg_temp.id('o_emp1')));
  perform pg_temp.r('L8 the log shows the recipient address (ADM) and the content summary only', v = 'pret-w7-emp1@example.invalid|Leave approved: LV-TEST-00001', v);
  v := pg_temp.as_user('adm', 'select (count(*) filter (where total_count is null))::text from app.notification_log(null, null, null, null, null, null, ''recipient'', ''asc'', 5, 0)');
  perform pg_temp.r('L9 paging returns the total count on every row', v = '0', v);
  v := pg_temp.as_user('adm', 'select (queued >= 1 and failed >= 1 and retrying >= 1)::text from app.email_delivery_counts()');
  perform pg_temp.r('L10 delivery counts (queued / retrying / failed) for the A15 banner', v = 'true', v);
  v := pg_temp.as_user('emp1', 'select queued::text from app.email_delivery_counts()');
  perform pg_temp.r('L11 EMP cannot read delivery counts', v like 'ERR:%', v);
  v := pg_temp.as_user('adm', format('select count(*)::text from app.email_outbox where id = %L', pg_temp.id('o_emp1')));
  perform pg_temp.r('L12 ADM can read outbox rows directly (rls §5.7 P-HR)', v = '1', v);
  v := pg_temp.as_user('mgr', 'select count(*)::text from app.email_outbox');
  perform pg_temp.r('L13 MGR cannot read the outbox', v = '0', v);
end $$;

-- ===========================================================================
-- E. A15 RETRY
-- ===========================================================================
do $$ declare v text;
begin
  v := pg_temp.as_user('emp1', format('select app.retry_email(%L)::text', pg_temp.id('o_emp2')));
  perform pg_temp.r('E1 EMP cannot retry an email', v like 'ERR:%PRET-ACC-403%', v);
  v := pg_temp.as_user('adm', format('select app.retry_email(%L)::text', pg_temp.id('o_emp2')));
  perform pg_temp.r('E2 ADM retries a failed email', v not like 'ERR:%', v);
  select status::text || '/' || attempts || '/' || (last_error like 'Retry requested by %')::text into v from app.email_outbox where id = pg_temp.id('o_emp2');
  perform pg_temp.r('E3 retried email is Queued again with attempts reset and who asked', v = 'pending/0/true', v);
  v := pg_temp.as_user('adm', format('select app.retry_email(%L)::text', pg_temp.id('o_sent')));
  perform pg_temp.r('E4 a sent email cannot be retried', v like 'ERR:%PRET-NTF-RETRY%', v);
  v := pg_temp.as_user('adm', format('update app.email_outbox set status = ''pending'' where id = %L returning id::text', pg_temp.id('o_sent')));
  perform pg_temp.r('E5 ADM cannot update the outbox directly', v like 'ERR:%' or v = '', v);
end $$;

-- ===========================================================================
-- T. A16 templates — read ADM / SA; write SA only; no sensitive placeholders
-- ===========================================================================
do $$ declare v text;
begin
  v := pg_temp.as_user('sa', 'insert into app.notification_templates (template_code, subject_override, body_override) values (''leave_approved'', ''Approved: {reference}'', ''Your {type} leave {reference} is approved.'') returning (updated_by = app.current_app_user_id())::text');
  perform pg_temp.r('T1 SA saves a template override (stamped with the SA)', v = 'true', v);
  v := pg_temp.as_user('adm', 'select subject_override from app.notification_templates where template_code = ''leave_approved''');
  perform pg_temp.r('T2 ADM can read overrides', v = 'Approved: {reference}', v);
  v := pg_temp.as_user('adm', 'update app.notification_templates set subject_override = ''Hacked {reference}'' where template_code = ''leave_approved'' returning template_code');
  perform pg_temp.r('T3 ADM cannot edit a template', v = '' or v like 'ERR:%', v);
  v := pg_temp.as_user('adm', 'insert into app.notification_templates (template_code, subject_override) values (''claim_approved'', ''ADM {reference}'') returning template_code');
  perform pg_temp.r('T4 ADM cannot add an override', v like 'ERR:%', v);
  v := pg_temp.as_user('emp1', 'select count(*)::text from app.notification_templates');
  perform pg_temp.r('T5 EMP cannot read templates', v = '0', v);
  v := pg_temp.as_user('sa', 'update app.notification_templates set body_override = ''Your NRIC is {nric}'' where template_code = ''leave_approved'' returning template_code');
  perform pg_temp.r('T6 a {nric} placeholder is refused by the database (F-NTF-08)', v like 'ERR:%chk_template_no_sensitive_placeholder%', v);
  v := pg_temp.as_user('sa', 'update app.notification_templates set subject_override = ''Pay { salary }'' where template_code = ''leave_approved'' returning template_code');
  perform pg_temp.r('T7 a { salary } placeholder is refused too', v like 'ERR:%chk_template_no_sensitive_placeholder%', v);
  v := pg_temp.as_user('sa', 'delete from app.notification_templates where template_code = ''leave_approved'' returning template_code');
  perform pg_temp.r('T8 SA resets a template to the default (delete override)', v = 'leave_approved', v);
end $$;

-- ===========================================================================
-- P. F-RPT-21 payroll-input export register — ADM / SA only; versions; no direct writes
-- ===========================================================================
do $$ declare v text;
begin
  v := pg_temp.as_user('adm', 'select version::text from app.record_payroll_input_export(date ''2026-01-15'', ''xlsx'', null, ''{"joiners":1}''::jsonb, ''[{"applicationId":"00000000-0000-4000-8000-000000000001","refNo":"LV-TEST-1","month":"2026-01","days":"1.0"}]''::jsonb)');
  perform pg_temp.r('P1 ADM records the first export of a month (version 1)', v = '1', v);
  v := pg_temp.as_user('sa', 'select version::text from app.record_payroll_input_export(date ''2026-01-01'', ''csv'', ''joiners'', ''{}''::jsonb, ''[{"x":1}]''::jsonb)');
  perform pg_temp.r('P2 a second export of the same month is version 2', v = '2', v);
  select (unpaid_lines = '[]'::jsonb)::text into v from app.payroll_input_exports where payroll_month = date '2026-01-01' and version = 2;
  perform pg_temp.r('P3 a CSV of another sheet does not record unpaid lines (Reversal source = xlsx / unpaid sheet only)', v = 'true', v);
  v := pg_temp.as_user('mgr', 'select version::text from app.record_payroll_input_export(date ''2026-01-01'', ''xlsx'', null, ''{}''::jsonb, ''[]''::jsonb)');
  perform pg_temp.r('P4 MGR cannot record a payroll-input export', v like 'ERR:%PRET-ACC-403%', v);
  v := pg_temp.as_user('emp1', 'select count(*)::text from app.payroll_input_exports');
  perform pg_temp.r('P5 EMP cannot read the export register', v = '0', v);
  v := pg_temp.as_user('adm', 'select count(*)::text from app.payroll_input_exports where payroll_month = date ''2026-01-01''');
  perform pg_temp.r('P6 ADM reads the register ("Last exported …")', v = '2', v);
  v := pg_temp.as_user('adm', 'insert into app.payroll_input_exports (payroll_month, version, format, exported_by) values (date ''2026-02-01'', 1, ''xlsx'', app.current_app_user_id()) returning id::text');
  perform pg_temp.r('P7 ADM cannot insert into the register directly', v like 'ERR:%', v);
end $$;

-- ===========================================================================
-- J. Nightly notification job (F-NTF-04): N-54, N-58, outbox housekeeping; preferences respected
-- ===========================================================================
do $$ declare v text; e text; jr jsonb; acc jsonb := '[]'::jsonb; x jsonb; y int := extract(year from app.today_myt())::int; n_real int;
begin
  v := pg_temp.as_user('adm', 'select app.run_notification_daily_job(true)::text');
  perform pg_temp.r('J1 ADM cannot run the notification job', v like 'ERR:%PRET-ACC-403%', v);

  -- housekeeping fixtures: a 4-day-old queued email and a stuck "sending" row
  with o as (insert into app.email_outbox (to_user_id, to_address, template_code, subject, payload, created_at)
             values (pg_temp.usr('emp1'), 'pret-w7-emp1@example.invalid', 'leave_approved', 'Old (TEST)', '{}'::jsonb, now() - interval '4 days') returning id)
  insert into ids select 'o_stale', id from o;
  with o as (insert into app.email_outbox (to_user_id, to_address, template_code, subject, payload, status, attempts, next_attempt_at)
             values (pg_temp.usr('emp1'), 'pret-w7-emp1@example.invalid', 'leave_approved', 'Stuck (TEST)', '{}'::jsonb, 'sending', 1, now() - interval '1 minute') returning id)
  insert into ids select 'o_stuck', id from o;
  -- F-NTF-06: the test ADM opts out of the FYI N-58 email (in-app stays)
  insert into app.notification_preferences (user_id, event_code, email_enabled) values (pg_temp.usr('adm'), 'N-58', false);
  -- next year's calendar unpublished in this transaction (deterministic N-58 when today ≥ 01/11)
  update app.holiday_calendar_years set status = 'draft' where year = y + 1 and status = 'published';

  begin  -- savepoint: everything the job does is undone after the assertions (results are kept in a variable)
    delete from app.job_runs where job_name = 'notification-daily' and business_date = app.today_myt() and status <> 'succeeded';
    jr := app.run_notification_daily_job(true);
    acc := acc || pg_temp.j('J2 job ran and reports its counts', jr ? 'n54' and jr ? 'outbox_expired', jr::text);
    select count(*)::text into v from app.notifications n where n.recipient_user_id = pg_temp.usr('sa') and n.event_code = 'N-54' and n.link_path = '/users/' || pg_temp.usr('ext')::text;
    acc := acc || pg_temp.j('J3 N-54: SA notified that the external user''s access ends in 7 days', v = '1', v);
    select count(*)::text into v from app.email_outbox o join app.notifications n on n.id = o.notification_id
     where n.recipient_user_id = pg_temp.usr('sa') and n.event_code = 'N-54' and o.template_code = 'external_access_ending' and not (o.payload ? 'user_name');
    acc := acc || pg_temp.j('J4 N-54 email queued (mandatory) with a PDPA-safe payload (date + days only)', v = '1', v);
    if app.today_myt() >= make_date(y, 11, 1) then
      select count(*)::text into v from app.notifications n where n.recipient_user_id = pg_temp.usr('adm') and n.event_code = 'N-58';
      acc := acc || pg_temp.j('J5 N-58: ADM told next year''s holiday calendar is not published (from 01/11)', v = '1', v);
      select count(*)::text into v from app.email_outbox o join app.notifications n on n.id = o.notification_id where n.recipient_user_id = pg_temp.usr('adm') and n.event_code = 'N-58';
      acc := acc || pg_temp.j('J6 N-58 email NOT queued for the ADM who opted out (FYI preference respected)', v = '0', v);
      select count(*)::text into v from app.email_outbox o join app.notifications n on n.id = o.notification_id where n.recipient_user_id = pg_temp.usr('ext') and n.event_code = 'N-58';
      acc := acc || pg_temp.j('J7 N-58 email queued for the other ADM (no opt-out)', v = '1', v);
      perform app.run_notification_daily_job(true);
      select count(*)::text into v from app.notifications n where n.recipient_user_id = pg_temp.usr('adm') and n.event_code = 'N-58';
      acc := acc || pg_temp.j('J8 N-58 is not repeated within a week (re-run the same day)', v = '1', v);
    else
      acc := acc || pg_temp.j('J5 N-58 only from 01/11 (not due today)', not exists (select 1 from app.notifications n where n.event_code = 'N-58' and n.recipient_user_id = pg_temp.usr('adm')), null);
    end if;
    select status::text || '|' || coalesce(last_error, '') into v from app.email_outbox where id = pg_temp.id('o_stale');
    acc := acc || pg_temp.j('J9 a never-sent email older than 72 h is Suppressed (Expired before delivery)', v like 'suppressed|Expired before delivery%', v);
    select status::text into v from app.email_outbox where id = pg_temp.id('o_stuck');
    acc := acc || pg_temp.j('J10 a stuck "sending" row goes back to retry', v = 'failed', v);
    select count(*) into n_real from app.notifications n where n.created_at = now() and n.recipient_user_id not in (select app_id from fx);
    acc := acc || pg_temp.j('J11 the job created no notification for anyone outside the test users (INT-001 untouched)', n_real = 0, n_real::text);
    raise exception 'W7-ROLLBACK-JOB';
  exception when others then
    e := sqlerrm;
  end;
  for x in select * from jsonb_array_elements(acc) loop
    perform pg_temp.r(x ->> 't', (x ->> 'p')::boolean, x ->> 'd');
  end loop;
  perform pg_temp.r('J12 the job''s writes were rolled back', e = 'W7-ROLLBACK-JOB' and not exists (select 1 from app.notifications n where n.event_code = 'N-54' and n.created_at = now()), e);
  perform pg_temp.r('J13 notification-daily is scheduled nightly at 00:20 MYT',
    exists (select 1 from cron.job where jobname = 'pret-notification-daily' and schedule = '20 16 * * *'), null);
  -- the mandatory list is unchanged: N-54 cannot be switched off
  v := pg_temp.as_user('sa', 'insert into app.notification_preferences (user_id, event_code, email_enabled) values (app.current_app_user_id(), ''N-54'', false) returning event_code');
  perform pg_temp.r('J14 N-54 (SA alert) email cannot be switched off', v like 'ERR:%PRET-NTF-MANDATORY%', v);
end $$;

-- ===========================================================================
-- Z. Lint
-- ===========================================================================
do $$ declare n_unforced int; n_trig int; n_path int; n_anon int; n_auth int;
begin
  select count(*) into n_unforced from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relname in ('notification_templates','payroll_input_exports') and not (c.relrowsecurity and c.relforcerowsecurity);
  select count(*) into n_trig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute');
  select count(*) into n_path from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','audit') and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  select count(*) into n_anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname in ('notification_log','email_delivery_counts','retry_email','report_sensitive_rows','record_payroll_input_export','run_notification_daily_job')
     and has_function_privilege('anon', p.oid, 'execute');
  select count(*) into n_auth from information_schema.role_table_grants g
   where g.table_schema = 'app' and g.table_name = 'payroll_input_exports' and g.grantee = 'authenticated' and g.privilege_type <> 'SELECT';
  perform pg_temp.r('Z1 RLS enabled and forced on the new tables', n_unforced = 0, n_unforced::text);
  perform pg_temp.r('Z2 no trigger function is executable by authenticated', n_trig = 0, n_trig::text);
  perform pg_temp.r('Z3 every definer function pins search_path', n_path = 0, n_path::text);
  perform pg_temp.r('Z4 anon cannot execute any W2-007 function', n_anon = 0, n_anon::text);
  perform pg_temp.r('Z5 authenticated has SELECT only on payroll_input_exports', n_auth = 0, n_auth::text);
  perform pg_temp.r('Z6 no notification or email for INT-001 / non-sample people was created by this suite',
    not exists (select 1 from app.notifications n where n.created_at = now() and n.recipient_user_id not in (select app_id from fx))
    and not exists (select 1 from app.email_outbox o where o.created_at = now() and o.to_address::text not like '%@example.invalid'));
end $$;

select test, pass, detail from t_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from t_results;

rollback;
