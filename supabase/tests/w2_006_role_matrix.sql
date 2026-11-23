-- PRET W2-006 — role matrix for the M4 portal: own vs other notifications, preferences, data exports and delegations;
-- external administrator has no "My" data; data export generation and download are access-logged; published-only holidays.
-- (rls-policies.md §5.1, §5.2, §5.7, §9; data-model §10; PRD §8, §12; BR-NTF-04; F-PRT-10/13/14/16.)
-- Runs entirely inside ONE transaction that is rolled back: no data is left behind.
-- Synthetic fixtures only (example.invalid emails, random UUIDs). No real employee (INT-001 or any non-sample record) is touched.
--   DATABASE_CA_CERT_FILE=private/supabase-ca.crt node --env-file=.env.local supabase/tests/run.cjs supabase/tests/w2_006_role_matrix.sql

begin;

create temp table t_results (id serial primary key, test text not null, pass boolean not null, detail text);
create temp table fx (n text primary key, auth_id uuid, app_id uuid, emp_id uuid);
create temp table ids (k text primary key, id uuid, v text);
grant select, insert, update on fx, ids to authenticated;

create function pg_temp.r(p_test text, p_pass boolean, p_detail text default null) returns void
language sql as $$ insert into t_results (test, pass, detail) values (p_test, coalesce(p_pass, false), left(p_detail, 600)) $$;
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
with g as (insert into app.grades (code, name, rank) values ('W6G1', 'W6 TEST grade', 994) returning id) insert into ids select 'grade', id from g;
with p as (insert into app.positions (code, title) values ('W6POS', 'W6 TEST position') returning id) insert into ids select 'pos', id from p;
insert into ids select 'dept', id, null from app.departments where is_active order by code limit 1;
insert into ids select 'pat', id, null from app.working_patterns where is_active order by name limit 1;
with l as (insert into app.work_locations (name, state, default_pattern_id, addr_line1, postcode, city)
           values ('W6 TEST location (Perlis)', 'PLS', pg_temp.id('pat'), '1 Jalan Ujian', '01000', 'Kangar') returning id)
insert into ids select 'loc', id from l;
update app.security_settings set max_top_of_org = 5, mfa_required_privileged = true where id = 1;

create function pg_temp.mk_emp(p_id uuid, p_no text, p_mgr uuid, p_join date, p_top boolean default false) returns void
language plpgsql as $$
begin
  insert into app.employees (id, employee_no, full_name, gender, work_email, mobile_phone, join_date, probation_months,
                             department_id, position_id, grade_id, manager_employee_id, work_location_id, work_state, working_pattern_id, status)
  values (p_id, p_no, 'Sample Employee ' || regexp_replace(p_no, '[^A-Za-z]', '', 'g'), 'female', lower(p_no) || '@example.invalid', '+60120000000', p_join, 0,
          pg_temp.id('dept'), pg_temp.id('pos'), pg_temp.id('grade'), p_mgr, pg_temp.id('loc'), 'PLS', pg_temp.id('pat'), 'confirmed');
  insert into app.employee_hr_private (employee_id, is_top_of_org) values (p_id, p_top);
  insert into app.employee_personal (employee_id, nric_enc, nric_last4, nric_bidx, date_of_birth, personal_email, res_addr_line1,
                                     res_postcode, res_city, res_state, continuous_service_date)
  values (p_id, extensions.gen_random_bytes(40), '0000', extensions.gen_random_bytes(32), date '1990-01-01',
          lower(p_no) || '.home@example.invalid', '1 Jalan Contoh', '01000', 'Kangar', 'PLS', p_join);
  insert into app.employee_sensitive (employee_id, religion) values (p_id, 'none');
  insert into app.employee_statutory_profiles (employee_id) values (p_id);
  insert into app.employee_statutory_employer_flags (employee_id) values (p_id);
  insert into app.employee_marital_history (employee_id, marital_status, effective_date) values (p_id, 'single', p_join);
  insert into app.employee_emergency_contacts (employee_id, priority, name, relationship, mobile_phone) values (p_id, 1, 'Sample Contact', 'parent', '+60120000001');
end $$;

insert into fx (n, auth_id, emp_id) values
  ('sa', gen_random_uuid(), gen_random_uuid()), ('adm', gen_random_uuid(), gen_random_uuid()), ('mgr', gen_random_uuid(), gen_random_uuid()),
  ('emp1', gen_random_uuid(), gen_random_uuid()), ('emp2', gen_random_uuid(), gen_random_uuid()), ('del', gen_random_uuid(), gen_random_uuid()),
  ('ext', gen_random_uuid(), null);
select pg_temp.mk_emp(pg_temp.emp('sa'),   'W6T-SA',   null,               app.today_myt() - 900, true);
select pg_temp.mk_emp(pg_temp.emp('adm'),  'W6T-ADM',  pg_temp.emp('sa'),  app.today_myt() - 800);
select pg_temp.mk_emp(pg_temp.emp('mgr'),  'W6T-MGR',  pg_temp.emp('sa'),  app.today_myt() - 700);
select pg_temp.mk_emp(pg_temp.emp('emp1'), 'W6T-EMPA', pg_temp.emp('mgr'), app.today_myt() - 400);
select pg_temp.mk_emp(pg_temp.emp('emp2'), 'W6T-EMPB', pg_temp.emp('mgr'), app.today_myt() - 600);
select pg_temp.mk_emp(pg_temp.emp('del'),  'W6T-DEL',  pg_temp.emp('sa'),  app.today_myt() - 500);
select app.rebuild_reporting_closure();
insert into auth.users (id, email, aud, role) select auth_id, 'pret-w6-' || n || '@example.invalid', 'authenticated', 'authenticated' from fx;
insert into app.app_users (auth_user_id, user_type, employee_id, login_email, display_name, status, access_start_date, access_end_date, service_provider)
select f.auth_id, case when f.emp_id is null then 'external' else 'employee' end::app.user_type, f.emp_id, 'pret-w6-' || f.n || '@example.invalid',
       'W6 Test ' || upper(f.n), 'active', app.today_myt() - 30, case f.n when 'ext' then app.today_myt() + 90 end,
       case when f.emp_id is null then 'Example Outsourcing (TEST)' end
  from fx f;
update fx set app_id = u.id from app.app_users u where u.login_email = 'pret-w6-' || fx.n || '@example.invalid';
insert into app.user_roles (user_id, role, granted_by) values (pg_temp.usr('sa'), 'SA', '00000000-0000-0000-0000-000000000001');
insert into app.user_roles (user_id, role, granted_by) select app_id, 'ADM', pg_temp.usr('sa') from fx where n in ('adm','ext');

-- notifications (system writes through app.notify, as the database functions do)
insert into ids select 'n_emp1_a', app.notify(pg_temp.usr('emp1'), 'N-02', 'Leave LV-TEST-00001 approved', 'Annual leave (TEST)', '/my/leave/LV-TEST-00001');
insert into ids select 'n_emp1_b', app.notify(pg_temp.usr('emp1'), 'N-25', 'Claim CL-TEST-00001 disbursed', 'RM 10.00 (TEST)', 'https://evil.example.invalid/x');
insert into ids select 'n_emp2', app.notify(pg_temp.usr('emp2'), 'N-22', 'Claim CL-TEST-00002 approved', null, '/my/claims/CL-TEST-00002');
insert into ids select 'n_ext', app.notify(pg_temp.usr('ext'), 'N-55', 'Privacy notice published (TEST)', null, '/privacy-notice');

-- ===========================================================================
-- A. anon
-- ===========================================================================
do $$ declare e1 text; e2 text; e3 text; e4 text;
begin
  execute 'set local role anon';
  begin perform 1 from app.notifications limit 1; e1 := 'no error'; exception when others then e1 := sqlerrm; end;
  begin perform 1 from app.export_jobs limit 1; e2 := 'no error'; exception when others then e2 := sqlerrm; end;
  begin perform app.start_my_data_export(); e3 := 'no error'; exception when others then e3 := sqlerrm; end;
  begin perform 1 from app.notification_preferences limit 1; e4 := 'no error'; exception when others then e4 := sqlerrm; end;
  execute 'reset role';
  perform pg_temp.r('A1 anon cannot read notifications', e1 like '%permission denied%', e1);
  perform pg_temp.r('A2 anon cannot read export jobs', e2 like '%permission denied%', e2);
  perform pg_temp.r('A3 anon cannot start a data export', e3 like '%permission denied%', e3);
  perform pg_temp.r('A4 anon cannot read notification preferences', e4 like '%permission denied%', e4);
end $$;

-- ===========================================================================
-- N. Notifications (G5) — own rows only, every role
-- ===========================================================================
do $$ declare v text;
begin
  v := pg_temp.as_user('emp1', 'select count(*)::text from app.notifications');
  perform pg_temp.r('N1 EMP sees only own notifications (2)', v = '2', v);
  v := pg_temp.as_user('emp1', format('select count(*)::text from app.notifications where id = %L', pg_temp.id('n_emp2')));
  perform pg_temp.r('N2 EMP cannot read another user''s notification by id', v = '0', v);
  v := pg_temp.as_user('adm', format('select count(*)::text from app.notifications where id in (%L, %L)', pg_temp.id('n_emp1_a'), pg_temp.id('n_emp2')));
  perform pg_temp.r('N3 ADM (aal2) cannot read employees'' notifications', v = '0', v);
  v := pg_temp.as_user('sa', format('select count(*)::text from app.notifications where id = %L', pg_temp.id('n_emp1_a')));
  perform pg_temp.r('N4 SA cannot read employees'' notifications', v = '0', v);
  v := pg_temp.as_user('ext', format('select (count(*) filter (where id = %L))::text || ''/'' || (count(*) filter (where recipient_user_id <> app.current_app_user_id()))::text
                                       from app.notifications', pg_temp.id('n_ext')));
  perform pg_temp.r('N5 External ADM sees own notifications only (incl. the N-55 one)', v = '1/0', v);
  v := pg_temp.as_user('emp1', format('with u as (update app.notifications set read_at = %L where id = %L returning read_at) select (read_at > now() - interval ''1 minute'')::text from u',
                                     '2000-01-01T00:00:00Z', pg_temp.id('n_emp1_a')));
  perform pg_temp.r('N6 mark read: read time is server-set (client time ignored)', v = 'true', v);
  v := pg_temp.as_user('emp1', format('with u as (update app.notifications set read_at = null where id = %L returning read_at) select coalesce(read_at::text, ''unread'') from u',
                                     pg_temp.id('n_emp1_a')));
  perform pg_temp.r('N7 mark unread (row ⋮ Mark unread) clears read_at', v = 'unread', v);
  v := pg_temp.as_user('emp1', format('with u as (update app.notifications set read_at = now() where id = %L returning 1) select count(*)::text from u', pg_temp.id('n_emp2')));
  perform pg_temp.r('N8 EMP cannot mark another user''s notification', v = '0', v);
  v := pg_temp.as_user('emp1', format('update app.notifications set title = ''x'' where id = %L returning 1', pg_temp.id('n_emp1_a')));
  perform pg_temp.r('N9 only read_at is writable (title update denied)', v like 'ERR:%permission denied%', v);
  v := pg_temp.as_user('emp1', format('insert into app.notifications (recipient_user_id, event_code, title) values (%L, ''N-02'', ''x'') returning id::text', pg_temp.usr('emp2')));
  perform pg_temp.r('N10 users cannot create notifications', v like 'ERR:%permission denied%', v);
  v := pg_temp.as_user('emp1', 'select app.notify(app.current_app_user_id(), ''N-02'', ''x'')::text');
  perform pg_temp.r('N11 users cannot call app.notify', v like 'ERR:%permission denied%', v);
  v := pg_temp.as_user('emp1', 'with u as (update app.notifications set read_at = now() where read_at is null returning 1) select count(*)::text from u');
  perform pg_temp.r('N12 mark all read touches own unread rows only (2)', v = '2' and (select read_at is null from app.notifications where id = pg_temp.id('n_emp2')), v);
end $$;

-- ===========================================================================
-- P. Notification preferences (G6, F-NTF-06, BR-NTF-04)
-- ===========================================================================
do $$ declare v text; n int;
begin
  v := pg_temp.as_user('emp1', 'insert into app.notification_preferences (user_id, event_code, email_enabled) values (app.current_app_user_id(), ''N-02'', false) returning event_code');
  perform pg_temp.r('P1 EMP switches off an FYI email (N-02)', v = 'N-02', v);
  v := pg_temp.as_user('emp1', 'insert into app.notification_preferences (user_id, event_code, email_enabled) values (app.current_app_user_id(), ''N-01'', false) returning event_code');
  perform pg_temp.r('P2 a mandatory (action-required) email cannot be switched off', v like '%PRET-NTF-MANDATORY%', v);
  v := pg_temp.as_user('emp1', 'insert into app.notification_preferences (user_id, event_code, email_enabled) values (app.current_app_user_id(), ''N-41'', true)
                                 on conflict (user_id, event_code) do update set email_enabled = false returning event_code');
  v := pg_temp.as_user('emp1', 'update app.notification_preferences set email_enabled = false where event_code = ''N-41'' returning event_code');
  perform pg_temp.r('P3 a security email (N-41) cannot be switched off by update either', v like '%PRET-NTF-MANDATORY%', v);
  v := pg_temp.as_user('emp2', 'select count(*)::text from app.notification_preferences');
  perform pg_temp.r('P4 another user cannot see EMP preferences', v = '0', v);
  v := pg_temp.as_user('emp2', format('insert into app.notification_preferences (user_id, event_code, email_enabled) values (%L, ''N-13'', false) returning event_code', pg_temp.usr('emp1')));
  perform pg_temp.r('P5 cannot write another user''s preferences', v like 'ERR:%row-level security%', v);
  v := pg_temp.as_user('adm', format('select count(*)::text from app.notification_preferences where user_id = %L', pg_temp.usr('emp1')));
  perform pg_temp.r('P6 ADM cannot read employees'' preferences', v = '0', v);
  -- the opt-out is honoured by app.notify (email suppressed, in-app kept); action-required always emails
  perform app.notify(pg_temp.usr('emp1'), 'N-02', 'Leave LV-TEST-00009 approved', null, '/my/leave', false, 'leave_approved', '{}'::jsonb);
  perform app.notify(pg_temp.usr('emp1'), 'N-01', 'Leave LV-TEST-00010 waiting', null, '/approvals', true, 'leave_submitted', '{}'::jsonb);
  select count(*) into n from app.email_outbox o where o.to_user_id = pg_temp.usr('emp1') and o.template_code in ('leave_approved','leave_submitted');
  perform pg_temp.r('P7 FYI opt-out suppresses the email only; the action-required email is sent', n = 1
    and (select count(*) from app.notifications where recipient_user_id = pg_temp.usr('emp1') and title in ('Leave LV-TEST-00009 approved', 'Leave LV-TEST-00010 waiting')) = 2
    and exists (select 1 from app.email_outbox o where o.to_user_id = pg_temp.usr('emp1') and o.template_code = 'leave_submitted'), n::text);
  perform pg_temp.r('P8 database mandatory list = MANDATORY_EMAIL_EVENT_CODES in contracts/portal.ts',
    (select array_agg(c order by c) from unnest(app.notification_email_mandatory()) c)
      = array['N-01','N-05','N-11','N-14','N-15','N-16','N-20','N-26','N-41','N-43','N-52','N-53','N-54','N-57']::text[]);
end $$;

-- ===========================================================================
-- D. Download my data (P20) — own record only, requester-only file, access-logged
-- ===========================================================================
do $$ declare v text; j uuid; f uuid; f2 uuid; n int;
begin
  v := pg_temp.as_user('ext', 'select app.start_my_data_export()::text');
  perform pg_temp.r('D1 External ADM (no employee record) cannot generate "my data"', v like '%PRET-ACC-403%', v);

  v := pg_temp.as_user('emp1', 'select app.start_my_data_export()::text');
  j := nullif(v, '')::uuid;
  insert into ids values ('job1', j, null);
  perform pg_temp.r('D2 EMP starts an export of own data (status Preparing)', (select status::text from app.export_jobs where id = j) = 'running'
    and (select employee_id from app.export_jobs where id = j) = pg_temp.emp('emp1'), v);
  select count(*) into n from audit.access_log a where a.entity_type = 'my_data_export' and a.entity_id = j and a.action = 'export'
     and a.actor_user_id = pg_temp.usr('emp1') and a.employee_ids = array[pg_temp.emp('emp1')] and 'bank' = any(a.data_categories) and 'identity' = any(a.data_categories);
  perform pg_temp.r('D3 generation is access-logged (export, own employee, identity + bank categories)', n = 1, n::text);
  v := pg_temp.as_user('emp1', 'select app.start_my_data_export()::text');
  perform pg_temp.r('D4 one export at a time (second start refused while Preparing)', v like '%PRET-EXPORT-BUSY%', v);
  v := pg_temp.as_user('emp2', format('select count(*)::text from app.export_jobs where id = %L', j));
  perform pg_temp.r('D5 another employee cannot see the export job', v = '0', v);
  v := pg_temp.as_user('mgr', format('select count(*)::text from app.export_jobs where id = %L', j));
  perform pg_temp.r('D6 the manager cannot see the export job', v = '0', v);
  v := pg_temp.as_user('emp1', format('insert into app.export_jobs (requested_by, kind) values (app.current_app_user_id(), ''my_data_export'') returning id::text'));
  perform pg_temp.r('D7 export jobs are written only through the definer functions', v like 'ERR:%permission denied%', v);

  -- the server stores the zip as the employee (owner = self) — upload rule
  v := pg_temp.as_user('emp1', format('select app.can_upload_for(''generated_output'', %L, ''generated'', ''out/mydata/x/y.zip'')::text', pg_temp.emp('emp1')));
  perform pg_temp.r('D8a EMP may upload a generated output for self', v = 'true', v);
  v := pg_temp.as_user('emp1', format('select app.can_upload_for(''generated_output'', %L, ''generated'', ''out/mydata/x/y.zip'')::text', pg_temp.emp('emp2')));
  perform pg_temp.r('D8b EMP may not upload a generated output for another employee', v = 'false', v);

  f := gen_random_uuid();
  insert into app.files (id, bucket, storage_path, subject, owner_employee_id, data_category, original_name, mime_type, size_bytes, status, created_by)
  values (f, 'generated', 'out/mydata/' || pg_temp.emp('emp1') || '/' || f || '.zip', 'generated_output', pg_temp.emp('emp1'), 'identity',
          'my-data-W6T-EMPA-test.zip', 'application/zip', 2048, 'active', pg_temp.usr('emp1'));
  insert into ids values ('file1', f, null);
  v := pg_temp.as_user('emp2', format('select app.finish_my_data_export(%L, %L, 10, '''')::text', j, f));
  perform pg_temp.r('D9 another employee cannot finish the job', v like '%PRET-ACC-404%', v);
  perform pg_temp.as_user('emp2', format('select app.fail_my_data_export(%L, ''x'')::text', j));
  perform pg_temp.r('D10 another employee cannot fail the job (still Preparing)', (select status::text from app.export_jobs where id = j) = 'running');
  v := pg_temp.as_user('emp1', format('select app.finish_my_data_export(%L, %L, 10, '''')::text', j, f));
  perform pg_temp.r('D11 EMP finishes: export_files my_data_export row, Ready for 7 days',
    (select status::text from app.export_jobs where id = j) = 'succeeded'
    and (select kind::text from app.export_files x where x.file_id = f) = 'my_data_export'
    and (select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' from app.export_jobs where id = j), v);

  v := pg_temp.as_user('emp1', format('select app.can_read_file(%L)::text', f));
  perform pg_temp.r('D12 the requester can read the file', v = 'true', v);
  v := pg_temp.as_user('emp2', format('select app.can_read_file(%L)::text', f));
  perform pg_temp.r('D13 another employee cannot read the file', v = 'false', v);
  v := pg_temp.as_user('mgr', format('select app.can_read_file(%L)::text', f));
  perform pg_temp.r('D14 the manager cannot read the file', v = 'false', v);
  v := pg_temp.as_user('adm', format('select app.can_read_file(%L)::text', f));
  perform pg_temp.r('D15 ADM (aal2) cannot read a my-data export (requester only)', v = 'false', v);
  v := pg_temp.as_user('sa', format('select app.can_read_file(%L)::text', f));
  perform pg_temp.r('D16 SA cannot read a my-data export (requester only)', v = 'false', v);
  v := pg_temp.as_user('adm', format('select count(*)::text from app.export_files where file_id = %L', f));
  perform pg_temp.r('D17 ADM cannot see the export_files row of a my-data export', v = '0', v);

  v := pg_temp.as_user('emp1', format('insert into app.file_access_grants (file_id, user_id, purpose, expires_at) values (%L, app.current_app_user_id(), ''download'', now() + interval ''2 minutes'') returning id::text', f));
  select count(*) into n from audit.access_log a where a.entity_type = 'file' and a.file_id = f and a.action = 'download' and a.actor_user_id = pg_temp.usr('emp1');
  perform pg_temp.r('D18 download grant for the requester succeeds and is access-logged', v !~ '^ERR' and n = 1, v || ' / ' || n);
  v := pg_temp.as_user('adm', format('insert into app.file_access_grants (file_id, user_id, purpose, expires_at) values (%L, app.current_app_user_id(), ''download'', now() + interval ''2 minutes'') returning id::text', f));
  perform pg_temp.r('D19 ADM download grant refused', v like 'ERR:%row-level security%', v);

  update app.export_jobs set expires_at = now() - interval '1 minute' where id = j;
  v := pg_temp.as_user('emp1', format('select app.can_read_file(%L)::text', f));
  perform pg_temp.r('D20 after "Available until" the file can no longer be read (Expired)', v = 'false', v);

  -- regression: other generated outputs stay ADM/SA (W2-005 payment lists etc.)
  f2 := gen_random_uuid();
  insert into app.files (id, bucket, storage_path, subject, owner_employee_id, data_category, original_name, mime_type, size_bytes, status, created_by)
  values (f2, 'generated', 'out/hlb/w6/' || f2 || '.pdf', 'generated_output', null, 'bank', 'payment-list.pdf', 'application/pdf', 2048, 'active', pg_temp.usr('adm'));
  v := pg_temp.as_user('adm', format('select app.can_read_file(%L)::text', f2));
  perform pg_temp.r('D21 other generated outputs remain readable by ADM', v = 'true', v);
  v := pg_temp.as_user('emp1', format('select app.can_read_file(%L)::text', f2));
  perform pg_temp.r('D22 … and not by employees', v = 'false', v);

  -- daily limit (3 per Malaysian day): job1 succeeded; two more (failed) → the 4th is refused
  v := pg_temp.as_user('emp1', 'select app.start_my_data_export()::text');
  perform pg_temp.as_user('emp1', format('select app.fail_my_data_export(%L, ''test failure'')::text', nullif(v, '')::uuid));
  perform pg_temp.r('D23 a failed run shows Failed with its reason', (select status::text || ':' || error from app.export_jobs where id = nullif(v, '')::uuid) = 'failed:test failure', v);
  v := pg_temp.as_user('emp1', 'select app.start_my_data_export()::text');
  perform pg_temp.as_user('emp1', format('select app.fail_my_data_export(%L, null)::text', nullif(v, '')::uuid));
  v := pg_temp.as_user('emp1', 'select app.start_my_data_export()::text');
  perform pg_temp.r('D24 at most 3 generations per day', v like '%PRET-EXPORT-LIMIT%', v);

  -- a stale Preparing run (> 15 min) is closed so the employee is not blocked forever
  v := pg_temp.as_user('emp2', 'select app.start_my_data_export()::text');
  update app.export_jobs set created_at = now() - interval '20 minutes' where id = nullif(v, '')::uuid;
  perform pg_temp.as_user('emp2', 'select app.start_my_data_export()::text');
  perform pg_temp.r('D25 a stale Preparing run is closed as Failed on the next start', (select status::text from app.export_jobs where id = nullif(v, '')::uuid) = 'failed', v);
end $$;

-- ===========================================================================
-- G. Delegations (G6 Delegation tab — own vs other)
-- ===========================================================================
do $$ declare v text; d uuid;
begin
  v := pg_temp.as_user('mgr', format('insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
                                      values (app.current_app_user_id(), %L, app.today_myt(), app.today_myt() + 5, ''both'', app.current_app_user_id()) returning id::text', pg_temp.usr('del')));
  d := nullif(case when v ~ '^ERR' then null else v end, '')::uuid;
  perform pg_temp.r('G1 a manager sets own delegate', d is not null, v);
  v := pg_temp.as_user('emp2', format('select count(*)::text from app.delegations where id = %L', d));
  perform pg_temp.r('G2 an unrelated employee cannot see the delegation', v = '0', v);
  v := pg_temp.as_user('del', format('select count(*)::text from app.delegations where id = %L', d));
  perform pg_temp.r('G3 the delegate can see it', v = '1', v);
  v := pg_temp.as_user('del', format('with u as (update app.delegations set cancelled_at = now(), cancelled_by = app.current_app_user_id() where id = %L returning 1) select count(*)::text from u', d));
  perform pg_temp.r('G4 the delegate cannot end it (delegator or HR only)', v = '0', v);
  v := pg_temp.as_user('emp2', format('insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
                                      values (%L, %L, app.today_myt(), app.today_myt() + 5, ''leave'', app.current_app_user_id()) returning id::text', pg_temp.usr('mgr'), pg_temp.usr('emp2')));
  perform pg_temp.r('G5 nobody sets a delegation for someone else (non-HR)', v like 'ERR:%row-level security%', v);
  v := pg_temp.as_user('mgr', format('with u as (update app.delegations set cancelled_at = now(), cancelled_by = app.current_app_user_id() where id = %L returning 1) select count(*)::text from u', d));
  perform pg_temp.r('G6 the delegator ends own delegation (END NOW)', v = '1', v);
  v := pg_temp.as_user('ext', format('insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
                                      values (%L, app.current_app_user_id(), app.today_myt(), app.today_myt() + 5, ''leave'', app.current_app_user_id()) returning id::text', pg_temp.usr('mgr')));
  perform pg_temp.r('G7 an External ADM cannot be made a delegate', v like 'ERR:%', v);
end $$;

-- ===========================================================================
-- H. Public holidays (P11) — published calendars only; state + pattern replacement rows
-- ===========================================================================
do $$ declare v text; h uuid;
begin
  insert into app.public_holidays (year, holiday_date, name, holiday_type) values (2098, date '2098-02-02', 'W6 TEST state holiday', 'state') returning id into h;
  insert into app.public_holiday_states (holiday_id, state) values (h, 'PLS');
  insert into ids values ('ph', h, null);
  v := pg_temp.as_user('emp1', format('select count(*)::text from app.public_holidays where id = %L', h));
  perform pg_temp.r('H1 a draft (unpublished) calendar is invisible to employees', v = '0', v);
  v := pg_temp.as_user('adm', format('select count(*)::text from app.public_holidays where id = %L', h));
  perform pg_temp.r('H2 … and visible to ADM', v = '1', v);
  insert into app.holiday_calendar_years (year, state, status, published_at) values (2098, 'PLS', 'published', now())
    on conflict (year, state) do update set status = 'published';
  v := pg_temp.as_user('emp1', format('select count(*)::text from app.public_holidays h join app.public_holiday_states s on s.holiday_id = h.id and s.state = ''PLS'' where h.id = %L', h));
  perform pg_temp.r('H3 once published the employee sees the holiday of their state', v = '1', v);
  v := pg_temp.as_user('ext', format('select count(*)::text from app.public_holidays where id = %L', h));
  perform pg_temp.r('H4 External ADM (admin) sees holidays too (organisation screen)', v = '1', v);
  v := pg_temp.as_user('emp1', format('select count(*)::text from app.employees e left join app.work_locations l on l.id = e.work_location_id where e.id = %L and l.state = ''PLS''', pg_temp.emp('emp1')));
  perform pg_temp.r('H5 the employee can resolve their own work-location state', v = '1', v);
end $$;

-- ===========================================================================
-- S. Password change bookkeeping (G6)
-- ===========================================================================
do $$ declare v text;
begin
  perform pg_temp.r('S1 login_events accepts the password_changed security event',
    exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'login_outcome' and e.enumlabel = 'password_changed'));
  insert into app.app_sessions (session_id, user_id, aal) values (gen_random_uuid(), pg_temp.usr('emp1'), 'aal1');
  update app.app_sessions set ended_at = now(), end_reason = 'password_change' where user_id = pg_temp.usr('emp1');
  perform pg_temp.r('S2 sessions can end with reason password_change', exists (select 1 from app.app_sessions where user_id = pg_temp.usr('emp1') and end_reason = 'password_change'));
  v := pg_temp.as_user('emp1', format('insert into app.login_events (login_email, user_id, outcome) values (''x@example.invalid'', %L, ''password_changed'') returning 1', pg_temp.usr('emp1')));
  perform pg_temp.r('S3 users cannot write login events themselves', v like 'ERR:%permission denied%', v);
  v := pg_temp.as_user('emp1', 'select count(*)::text from app.login_events');
  perform pg_temp.r('S4 employees cannot read the login history', v = '0' or v like 'ERR:%', v);
end $$;

-- ===========================================================================
-- L. Lint
-- ===========================================================================
do $$ declare n_unforced int; n_nosel int; n_trig int; n_path int; n_anon int; n_auth int;
begin
  select count(*) into n_unforced from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relname = 'export_jobs' and not (c.relrowsecurity and c.relforcerowsecurity);
  select count(*) into n_nosel from pg_policies p where p.schemaname = 'app' and p.tablename = 'export_jobs' and p.cmd = 'SELECT';
  select count(*) into n_trig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute');
  select count(*) into n_path from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','audit') and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  select count(*) into n_anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname in ('start_my_data_export','finish_my_data_export','fail_my_data_export','is_my_data_export_file','notification_email_mandatory')
     and has_function_privilege('anon', p.oid, 'execute');
  select count(*) into n_auth from information_schema.role_table_grants g
   where g.table_schema = 'app' and g.table_name = 'export_jobs' and g.grantee = 'authenticated' and g.privilege_type <> 'SELECT';
  perform pg_temp.r('L1 RLS enabled and forced on export_jobs', n_unforced = 0, n_unforced::text);
  perform pg_temp.r('L2 export_jobs has a SELECT policy', n_nosel = 1, n_nosel::text);
  perform pg_temp.r('L3 no trigger function is executable by authenticated', n_trig = 0, n_trig::text);
  perform pg_temp.r('L4 every definer function pins search_path', n_path = 0, n_path::text);
  perform pg_temp.r('L5 anon cannot execute any W2-006 function', n_anon = 0, n_anon::text);
  perform pg_temp.r('L6 authenticated has SELECT only on export_jobs', n_auth = 0, n_auth::text);
  perform pg_temp.r('L7 no notification / preference / export rows for INT-001 or other non-sample people were created by this suite',
    not exists (select 1 from app.export_jobs j join app.employees e on e.id = j.employee_id where e.employee_no not like 'W6T-%'
                 and j.created_at = now()));
end $$;

select test, pass, detail from t_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from t_results;

rollback;
