-- PRET W2-005 — role matrix, guards and money arithmetic for M3 claims + month-end HLB disbursement
-- (rls-policies.md §5.5, §5.6, §7, §8, §9, §12; ADR-0004/0006/0015; PRD §7; D12, D16, D23).
-- Runs entirely inside ONE transaction that is rolled back: no data is left behind.
-- Synthetic fixtures only (example.invalid emails, random UUIDs, fake merchants). Dates are relative to today.
--   DATABASE_CA_CERT_FILE=private/supabase-ca.crt node --env-file=.env.local supabase/tests/run.cjs supabase/tests/w2_005_role_matrix.sql

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
create function pg_temp.as_user(p_n text, p_aal text, p_sql text) returns text
language plpgsql as $$
declare v text; s uuid;
begin
  select auth_id into s from fx where n = p_n;
  perform pg_temp.login(s, p_aal);
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
create function pg_temp.cat(p_code text) returns uuid language sql as $$ select id from app.claim_categories where code = p_code $$;
create function pg_temp.aal(p_n text) returns text language sql as $$ select case when p_n in ('sa','adm','adm2','ext') then 'aal2' else 'aal1' end $$;
-- an active receipt file owned by an employee, uploaded by a user
create function pg_temp.file(p_owner text, p_by text) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into app.files (id, bucket, storage_path, subject, owner_employee_id, original_name, mime_type, size_bytes, status, created_by)
  values (v, 'claim-files', 'emp/' || pg_temp.emp(p_owner) || '/claims/w5/' || v || '.jpg', 'claim_receipt', pg_temp.emp(p_owner), 'receipt.jpg', 'image/jpeg', 1000,
          'active', pg_temp.usr(p_by));
  return v;
end $$;
create function pg_temp.line(p_cat text, p_date date, p_amount text, p_extra jsonb default '{}', p_files uuid[] default '{}') returns jsonb
language sql as $$
  select jsonb_build_object('categoryId', pg_temp.cat(p_cat), 'transactionDate', p_date, 'amountInclSst', p_amount, 'fileIds', to_jsonb(p_files)) || p_extra
$$;
-- save a claim as user n; returns the claim id ('' on error, error text kept in ids.v under key 'err')
create function pg_temp.save(p_n text, p_title text, p_lines jsonb, p_extra jsonb default '{}') returns text
language sql as $$
  select pg_temp.as_user(p_n, pg_temp.aal(p_n), format('select app.save_claim(%L::jsonb)::text',
    (jsonb_build_object('title', p_title, 'lines', p_lines, 'idempotencyKey', gen_random_uuid()) || p_extra)::text))
$$;
create function pg_temp.js(p text) returns jsonb language plpgsql as $$ begin return p::jsonb; exception when others then return jsonb_build_object('error', p); end $$;
create function pg_temp.jid(p text) returns uuid language plpgsql as $$ begin return (p::jsonb ->> 'id')::uuid; exception when others then return null; end $$;
create function pg_temp.submit(p_n text, p_claim uuid, p_ack boolean default false) returns text
language sql as $$ select pg_temp.as_user(p_n, pg_temp.aal(p_n), format('select app.submit_claim(%L, %L, null)::text', p_claim, p_ack)) $$;
create function pg_temp.ctask(p_claim uuid) returns uuid language sql as $$ select id from app.approval_tasks where claim_id = p_claim and status = 'open' $$;
create function pg_temp.decide(p_n text, p_task uuid, p_decision text, p_comment text default null) returns text
language sql as $$
  select pg_temp.as_user(p_n, pg_temp.aal(p_n), format('select app.decide_task(%L, %L, %L, (select version from app.approval_tasks where id = %L), false)::text',
                                                        p_task, p_decision, p_comment, p_task))
$$;
create function pg_temp.st(p_claim uuid) returns text language sql as $$ select status::text from app.claims where id = p_claim $$;
-- a claim that is Submitted and then Approved by an approver (helper for batch tests)
create function pg_temp.approved_claim(p_owner text, p_title text, p_amount text, p_approver text default 'adm') returns uuid
language plpgsql as $$
declare v uuid;
begin
  v := pg_temp.jid(pg_temp.save(p_owner, p_title, jsonb_build_array(pg_temp.line('OFFICE', app.today_myt() - 2, p_amount,
         jsonb_build_object('merchant', 'Kedai Contoh TEST Sdn Bhd'), array[pg_temp.file(p_owner, p_owner)]))));
  perform pg_temp.submit(p_owner, v, true);
  perform pg_temp.decide(p_approver, pg_temp.ctask(v), 'approve');
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (system writes)
-- ---------------------------------------------------------------------------
with g as (insert into app.grades (code, name, rank) values ('W5G1', 'W5 TEST grade', 993) returning id) insert into ids select 'grade', id from g;
with p as (insert into app.positions (code, title) values ('W5POS', 'W5 TEST position') returning id) insert into ids select 'pos', id from p;
insert into ids select 'dept', id, null from app.departments where is_active order by code limit 1;
insert into ids select 'loc', id, null from app.work_locations where is_active order by name limit 1;
insert into ids select 'pat', id, null from app.working_patterns where is_active order by name limit 1;
update app.security_settings set max_top_of_org = 5, sa_batch_approval_required = false, mfa_required_privileged = true where id = 1;
update app.claim_policy set submission_deadline_days = 60, limit_refresh_day = 31 where id = 1;

create function pg_temp.mk_emp(p_id uuid, p_no text, p_mgr uuid, p_join date, p_top boolean default false) returns void
language plpgsql as $$
begin
  insert into app.employees (id, employee_no, full_name, gender, work_email, mobile_phone, join_date, probation_months,
                             department_id, position_id, grade_id, manager_employee_id, work_location_id, work_state, working_pattern_id, status)
  values (p_id, p_no, 'Sample Employee ' || regexp_replace(p_no, '[^A-Za-z]', '', 'g'), 'female', lower(p_no) || '@example.invalid', '+60120000000', p_join, 0,
          pg_temp.id('dept'), pg_temp.id('pos'), pg_temp.id('grade'), p_mgr, pg_temp.id('loc'), 'SGR', pg_temp.id('pat'), 'confirmed');
  insert into app.employee_hr_private (employee_id, is_top_of_org) values (p_id, p_top);
  insert into app.employee_personal (employee_id, nric_enc, nric_last4, nric_bidx, date_of_birth, personal_email, res_addr_line1,
                                     res_postcode, res_city, res_state, continuous_service_date)
  values (p_id, extensions.gen_random_bytes(40), '0000', extensions.gen_random_bytes(32), date '1990-01-01',
          lower(p_no) || '.home@example.invalid', '1 Jalan Contoh', '50000', 'Kuala Lumpur', 'KUL', p_join);
  insert into app.employee_sensitive (employee_id, religion) values (p_id, 'none');
  insert into app.employee_statutory_profiles (employee_id) values (p_id);
  insert into app.employee_statutory_employer_flags (employee_id) values (p_id);
  insert into app.employee_marital_history (employee_id, marital_status, effective_date) values (p_id, 'single', p_join);
  insert into app.employee_emergency_contacts (employee_id, priority, name, relationship, mobile_phone) values (p_id, 1, 'Sample Contact', 'parent', '+60120000001');
end $$;

insert into fx (n, auth_id, emp_id) values
  ('sa', gen_random_uuid(), gen_random_uuid()), ('adm', gen_random_uuid(), gen_random_uuid()), ('mgr', gen_random_uuid(), gen_random_uuid()),
  ('emp1', gen_random_uuid(), gen_random_uuid()), ('emp2', gen_random_uuid(), gen_random_uuid()), ('emp3', gen_random_uuid(), gen_random_uuid()),
  ('del', gen_random_uuid(), gen_random_uuid()), ('ext', gen_random_uuid(), null), ('adm2', gen_random_uuid(), gen_random_uuid());
select pg_temp.mk_emp(pg_temp.emp('sa'),   'W5T-SA',   null,               app.today_myt() - 900, true);
select pg_temp.mk_emp(pg_temp.emp('adm'),  'W5T-ADM',  pg_temp.emp('sa'),  app.today_myt() - 800);
select pg_temp.mk_emp(pg_temp.emp('adm2'), 'W5T-ADMB', pg_temp.emp('sa'),  app.today_myt() - 800);
select pg_temp.mk_emp(pg_temp.emp('mgr'),  'W5T-MGR',  pg_temp.emp('sa'),  app.today_myt() - 700);
select pg_temp.mk_emp(pg_temp.emp('emp1'), 'W5T-EMPA', pg_temp.emp('mgr'), app.today_myt() - 400);
select pg_temp.mk_emp(pg_temp.emp('emp2'), 'W5T-EMPB', pg_temp.emp('sa'),  app.today_myt() - 600);
select pg_temp.mk_emp(pg_temp.emp('emp3'), 'W5T-EMPC', pg_temp.emp('emp1'), app.today_myt() - 300);
select pg_temp.mk_emp(pg_temp.emp('del'),  'W5T-DEL',  pg_temp.emp('sa'),  app.today_myt() - 500);
select app.rebuild_reporting_closure();
insert into auth.users (id, email, aud, role) select auth_id, 'pret-w5-' || n || '@example.invalid', 'authenticated', 'authenticated' from fx;
insert into app.app_users (auth_user_id, user_type, employee_id, login_email, display_name, status, access_start_date, access_end_date, service_provider)
select f.auth_id, case when f.emp_id is null then 'external' else 'employee' end::app.user_type, f.emp_id, 'pret-w5-' || f.n || '@example.invalid',
       'W5 Test ' || upper(f.n), 'active', app.today_myt() - 30, case f.n when 'ext' then app.today_myt() + 90 end,
       case when f.emp_id is null then 'Example Outsourcing (TEST)' end
  from fx f;
update fx set app_id = u.id from app.app_users u where u.login_email = 'pret-w5-' || fx.n || '@example.invalid';
insert into app.user_roles (user_id, role, granted_by) values (pg_temp.usr('sa'), 'SA', '00000000-0000-0000-0000-000000000001');
insert into app.user_roles (user_id, role, granted_by) select app_id, 'ADM', pg_temp.usr('sa') from fx where n in ('adm','adm2','ext');
-- bank details: emp1 bank transfer (complete), emp2 cheque (D23)
do $$ declare pf uuid := gen_random_uuid(); b uuid := (select id from app.banks where is_active order by code limit 1);
begin
  insert into app.files (id, bucket, storage_path, subject, owner_employee_id, data_category, original_name, mime_type, size_bytes, status, created_by)
  values (pf, 'employee-files', 'emp/' || pg_temp.emp('emp1') || '/docs/w5/' || pf || '.pdf', 'employee_document', pg_temp.emp('emp1'), 'bank', 'proof.pdf',
          'application/pdf', 1000, 'active', pg_temp.usr('adm'));
  insert into app.employee_bank_accounts (employee_id, payment_method, bank_id, account_type, account_no_enc, account_no_last4, account_no_bidx,
                                          account_holder_name, proof_file_id, effective_from, verified_by)
  values (pg_temp.emp('emp1'), 'bank_transfer', b, 'savings', extensions.gen_random_bytes(40), '1234', extensions.gen_random_bytes(32), 'Sample Employee EMPA',
          pf, app.today_myt() - 100, pg_temp.usr('adm'));
  insert into app.employee_bank_accounts (employee_id, payment_method, effective_from, verified_by)
  values (pg_temp.emp('emp2'), 'cheque', app.today_myt() - 100, pg_temp.usr('adm'));
end $$;

-- ===========================================================================
-- A. anon
-- ===========================================================================
do $$ declare e1 text; e2 text; e3 text;
begin
  execute 'set local role anon';
  begin perform 1 from app.claims limit 1; e1 := 'no error'; exception when others then e1 := sqlerrm; end;
  begin perform app.save_claim('{}'::jsonb); e2 := 'no error'; exception when others then e2 := sqlerrm; end;
  begin perform 1 from app.disbursement_batches limit 1; e3 := 'no error'; exception when others then e3 := sqlerrm; end;
  execute 'reset role';
  perform pg_temp.r('A1 anon cannot read claims', e1 like '%permission denied%', e1);
  perform pg_temp.r('A2 anon cannot call save_claim', e2 like '%permission denied%', e2);
  perform pg_temp.r('A3 anon cannot read disbursement batches', e3 like '%permission denied%', e3);
end $$;

-- ===========================================================================
-- B. Arithmetic (same examples as tests/unit/w2-005-claims-engine.test.mjs)
-- ===========================================================================
do $$ declare l app.claim_limits; c jsonb;
begin
  perform pg_temp.r('B1 month period, refresh 31: 15/11/2027 → 01/11–30/11',
    app.claim_period(date '2027-11-15', 'month', 31) = daterange(date '2027-11-01', date '2027-11-30', '[]'));
  perform pg_temp.r('B2 month period, refresh 25: 26/11 → 26/11–25/12; 25/11 → 26/10–25/11',
    app.claim_period(date '2027-11-26', 'month', 25) = daterange(date '2027-11-26', date '2027-12-25', '[]')
    and app.claim_period(date '2027-11-25', 'month', 25) = daterange(date '2027-10-26', date '2027-11-25', '[]'));
  perform pg_temp.r('B3 month period, refresh 31 in February clamps to 28/02',
    app.claim_period(date '2027-02-10', 'month', 31) = daterange(date '2027-02-01', date '2027-02-28', '[]')
    and app.claim_period(date '2027-03-01', 'month', 30) = daterange(date '2027-03-01', date '2027-03-30', '[]'));
  perform pg_temp.r('B4 year period: refresh 31 = calendar year; refresh 25: 26/12/2027 → 26/12/2027–25/12/2028',
    app.claim_period(date '2027-06-01', 'year', 31) = daterange(date '2027-01-01', date '2027-12-31', '[]')
    and app.claim_period(date '2027-12-26', 'year', 25) = daterange(date '2027-12-26', date '2028-12-25', '[]'));
  l.id := gen_random_uuid(); l.per_transaction := 300.00; l.behaviour := 'block';
  c := app.claim_limit_eval(l, 350.00, 0, 0);
  perform pg_temp.r('B5 EC-CLM-01: RM 350 vs RM 300/txn (Block) → "Exceeds RM 300.00 per transaction"',
    c ->> 'message' = 'Exceeds RM 300.00 per transaction' and (c ->> 'blocking')::boolean and c ->> 'overBy' = '50.00', c::text);
  c := app.claim_limit_eval(l, 120.00, 0, 0);
  perform pg_temp.r('B6 within: "Within limit (RM 120.00 of RM 300.00)"', c ->> 'message' = 'Within limit (RM 120.00 of RM 300.00)' and c ->> 'status' = 'within', c::text);
  l.behaviour := 'warn';
  c := app.claim_limit_eval(l, 350.00, 0, 0);
  perform pg_temp.r('B7 Warn: "Over limit by RM 50.00 (warning)", not blocking', c ->> 'message' = 'Over limit by RM 50.00 (warning)' and not (c ->> 'blocking')::boolean, c::text);
  l.per_transaction := null; l.per_month := 500.00; l.per_year := 1000.00; l.behaviour := 'block';
  c := app.claim_limit_eval(l, 250.00, 300.00, 300.00);
  perform pg_temp.r('B8 month limit counts earlier usage: 300 + 250 > 500 → over by RM 50.00 per month',
    c ->> 'basis' = 'month' and c ->> 'overBy' = '50.00' and c ->> 'message' = 'Exceeds RM 500.00 per month (over by RM 50.00)', c::text);
  c := app.claim_limit_eval(l, 100.00, 300.00, 850.00);
  perform pg_temp.r('B9 within: tightest headroom (year 950 of 1000) shown', c ->> 'basis' = 'year' and c ->> 'message' = 'Within limit (RM 950.00 of RM 1,000.00 this year)', c::text);
  perform pg_temp.r('B10 money: RM formatting and 2-dp text', app.rm(1234.5) = 'RM 1,234.50' and app.rm(0) = 'RM 0.00' and app.money_text(25.5) = '25.50');
  perform pg_temp.r('B11 mileage at the D31 rate RM 0.500/km: round(42.5 × 0.500, 2) = 21.25; 33.3 × 0.575 = 19.15 (half away)',
    round(42.5 * 0.500, 2) = 21.25 and round(33.3 * 0.575, 2) = 19.15 and app.claim_rate_on(pg_temp.cat('EMP-TRANS'), app.today_myt()) = 0.500);
end $$;

-- ===========================================================================
-- C. Employee: save (New), submit, validations, withdraw, delete, copy
-- ===========================================================================
do $$ declare j text; c1 uuid; c2 uuid; f1 uuid := pg_temp.file('emp1', 'emp1'); f2 uuid := pg_temp.file('emp1', 'emp1'); t uuid; n int; x text; k uuid := gen_random_uuid();
  p jsonb;
begin
  p := jsonb_build_object('title', 'KL client visits – TEST', 'idempotencyKey', k, 'lines', jsonb_build_array(
         pg_temp.line('MEDICAL', app.today_myt() - 3, '120.00', jsonb_build_object('sstAmount', '7.20')),
         pg_temp.line('EMP-TRANS', app.today_myt() - 3, '1', jsonb_build_object('distanceKm', '42.5', 'fromPlace', 'Office', 'toPlace', 'Client TEST', 'purpose', 'Visit'))));
  j := pg_temp.as_user('emp1', 'aal1', format('select app.save_claim(%L::jsonb)::text', p::text));
  c1 := pg_temp.jid(j);
  insert into ids values ('c1', c1, null);
  perform pg_temp.r('C1 save → CL-yyyy-nnnnn, status New, totals 141.25 / SST 7.20 (mileage 42.5 km × 0.500 = 21.25 computed)',
    c1 is not null and (pg_temp.js(j) ->> 'claimNo') ~ '^CL-[0-9]{4}-[0-9]{5}$' and pg_temp.st(c1) = 'new'
    and (select total_amount from app.claims where id = c1) = 141.25 and (select total_sst from app.claims where id = c1) = 7.20
    and (select amount_incl_sst from app.claim_lines where claim_id = c1 and line_no = 2) = 21.25, j);
  j := pg_temp.as_user('emp1', 'aal1', format('select app.save_claim(%L::jsonb)::text', p::text));
  perform pg_temp.r('C2 idempotent save (same key) returns the same claim', pg_temp.jid(j) = c1 and (pg_temp.js(j) ->> 'duplicate')::boolean, j);
  perform pg_temp.r('C3 New claim visible to the owner only (MGR 0, ADM 0, peer 0)',
    pg_temp.as_user('emp1', 'aal1', format('select count(*)::text from app.claims where id = %L', c1)) = '1'
    and pg_temp.as_user('mgr', 'aal1', format('select count(*)::text from app.claims where id = %L', c1)) = '0'
    and pg_temp.as_user('adm', 'aal2', format('select count(*)::text from app.claims where id = %L', c1)) = '0'
    and pg_temp.as_user('emp2', 'aal1', format('select count(*)::text from app.claims where id = %L', c1)) = '0');
  j := pg_temp.submit('emp1', c1);
  perform pg_temp.r('C4 submit without receipts → blocked "Attach the receipt." (BR-CLM-12)',
    not (pg_temp.js(j) ->> 'submitted')::boolean and j like '%Attach the receipt.%' and pg_temp.st(c1) = 'new', j);
  perform pg_temp.r('C5 direct writes refused (no grant): update / delete claims',
    pg_temp.as_user('emp1', 'aal1', format('update app.claims set title = %L where id = %L returning 1', 'x', c1)) like 'ERR:%permission denied%'
    and pg_temp.as_user('emp1', 'aal1', format('delete from app.claim_lines where claim_id = %L returning 1', c1)) like 'ERR:%permission denied%');
  -- add receipts and re-save (edit while New)
  p := jsonb_set(p, '{claimId}', to_jsonb(c1)) - 'idempotencyKey';
  p := jsonb_set(p, '{lines,0,id}', to_jsonb((select id from app.claim_lines where claim_id = c1 and line_no = 1)));
  p := jsonb_set(p, '{lines,1,id}', to_jsonb((select id from app.claim_lines where claim_id = c1 and line_no = 2)));
  p := jsonb_set(p, '{lines,0,fileIds}', jsonb_build_array(f1));
  p := jsonb_set(p, '{lines,1,fileIds}', jsonb_build_array(f2));
  j := pg_temp.as_user('emp1', 'aal1', format('select app.save_claim(%L::jsonb)::text', p::text));
  perform pg_temp.r('C6 edit while New (receipts attached, same line ids)', pg_temp.jid(j) = c1
    and (select count(*) from app.claim_line_files lf join app.claim_lines l on l.id = lf.claim_line_id where l.claim_id = c1) = 2, j);
  j := pg_temp.as_user('emp2', 'aal1', format('select app.save_claim(%L::jsonb)::text', p::text));
  perform pg_temp.r('C7 another employee cannot edit it', j like 'ERR:%PRET-ACC-404%', j);
  j := pg_temp.submit('emp1', c1);
  t := pg_temp.ctask(c1);
  perform pg_temp.r('C8 submit → Submitted; ONE claim_pool task assigned to the manager (D12); lines live',
    (pg_temp.js(j) ->> 'submitted')::boolean and pg_temp.st(c1) = 'submitted'
    and (select source::text || ':' || (assignee_user_id = pg_temp.usr('mgr'))::text from app.approval_tasks where id = t) = 'claim_pool:true'
    and (select count(*) from app.approval_tasks where claim_id = c1) = 1
    and (select bool_and(is_live) from app.claim_lines where claim_id = c1) and j like '%waiting for approval by%', j);
  perform pg_temp.r('C9 N-20 to the manager (email) and in-app to every ADM / SA',
    exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('mgr') and event_code = 'N-20')
    and exists (select 1 from app.email_outbox where to_user_id = pg_temp.usr('mgr') and template_code = 'claim_submitted')
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('adm') and event_code = 'N-20')
    and not exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp1') and event_code = 'N-20'));
  j := pg_temp.as_user('emp1', 'aal1', format('select app.save_claim(%L::jsonb)::text', p::text));
  perform pg_temp.r('C10 Submitted claims cannot be edited (BR-CLM-21 / EC-CLM-14)', j like 'ERR:%PRET-CLM-LOCKED%', j);
  -- BR-CLM-10 deadline, EC-CLM-01 per transaction block
  c2 := pg_temp.jid(pg_temp.save('emp1', 'Old receipts TEST', jsonb_build_array(
          pg_temp.line('OFFICE', app.today_myt() - 75, '40.00', '{}', array[pg_temp.file('emp1', 'emp1')]),
          pg_temp.line('MEDICAL', app.today_myt() - 2, '350.00', '{}', array[pg_temp.file('emp1', 'emp1')]))));
  insert into ids values ('c2', c2, null);
  j := pg_temp.submit('emp1', c2);
  perform pg_temp.r('C11 line 75 days old → "Older than 60 days — Admin override required"; RM 350 medical → "Exceeds RM 300.00 per transaction"',
    not (pg_temp.js(j) ->> 'submitted')::boolean and j like '%Older than 60 days — Admin override required%' and j like '%Exceeds RM 300.00 per transaction%', j);
  perform pg_temp.r('C12 the limit result is stored on the line (CLN16)',
    (select limit_check ->> 'status' from app.claim_lines where claim_id = c2 and line_no = 2) = 'over');
  -- SST > amount / mileage arithmetic guarded by CHECKs
  perform pg_temp.r('C13 CHECK: SST cannot exceed the amount; mileage amount must equal round(km × rate, 2)',
    (select pg_temp.save('emp1', 'Bad SST TEST', jsonb_build_array(pg_temp.line('OFFICE', app.today_myt() - 1, '10.00', jsonb_build_object('sstAmount', '11.00'))))) like 'ERR:%SST cannot be more than the amount%');
  begin
    update app.claim_lines set amount_incl_sst = 26.00 where claim_id = c1 and line_no = 2;
    x := 'no error';
  exception when others then x := sqlerrm; end;
  perform pg_temp.r('C14 system cannot change a Submitted line either (guard) / mileage CHECK', x like '%PRET-CLM-LOCKED%' or x like '%chk_mileage%', x);
  -- withdraw
  c2 := pg_temp.jid(pg_temp.save('emp1', 'Withdraw me TEST', jsonb_build_array(pg_temp.line('OFFICE', app.today_myt() - 1, '15.00', '{}', array[pg_temp.file('emp1', 'emp1')]))));
  perform pg_temp.submit('emp1', c2);
  j := pg_temp.as_user('emp1', 'aal1', format('select app.withdraw_claim(%L)::text', c2));
  perform pg_temp.r('C15 withdraw Submitted → Withdrawn, task closed, lines no longer live',
    pg_temp.st(c2) = 'withdrawn' and pg_temp.ctask(c2) is null and not (select bool_or(is_live) from app.claim_lines where claim_id = c2), j);
  j := pg_temp.as_user('emp1', 'aal1', format('select app.withdraw_claim(%L)::text', c2));
  perform pg_temp.r('C16 withdraw twice refused', j like 'ERR:%only Submitted claims can be withdrawn%', j);
  -- delete New only
  c2 := pg_temp.jid(pg_temp.save('emp1', 'Delete me TEST', jsonb_build_array(pg_temp.line('OFFICE', app.today_myt() - 1, '15.00'))));
  j := pg_temp.as_user('emp1', 'aal1', format('select app.delete_claim(%L)::text', c2));
  perform pg_temp.r('C17 owner deletes a New claim (FR-G-08)', not exists (select 1 from app.claims where id = c2), j);
  j := pg_temp.as_user('emp1', 'aal1', format('select app.delete_claim(%L)::text', c1));
  perform pg_temp.r('C18 a Submitted claim cannot be deleted', j like 'ERR:%only New claims can be deleted%', j);
end $$;

-- duplicates, UUID, monthly limit, late override
do $$ declare a uuid; b uuid; j text; u text := 'W5UUID-' || substr(md5(random()::text), 1, 8);
begin
  insert into app.claim_limits (category_id, applies_to, per_month, behaviour, effective_from)
  values (pg_temp.cat('POSTAL'), 'everyone', 500.00, 'block', app.today_myt() - 400);
  a := pg_temp.jid(pg_temp.save('emp1', 'Courier A TEST', jsonb_build_array(pg_temp.line('POSTAL', app.today_myt() - 1, '300.00',
         jsonb_build_object('receiptNo', 'TEST-RCPT-0001', 'myinvoisUuid', u), array[pg_temp.file('emp1', 'emp1')]))));
  j := pg_temp.submit('emp1', a);
  perform pg_temp.r('D1 first courier claim (RM 300 of RM 500/month) submits', (pg_temp.js(j) ->> 'submitted')::boolean, j);
  b := pg_temp.jid(pg_temp.save('emp1', 'Courier B TEST', jsonb_build_array(pg_temp.line('POSTAL', app.today_myt() - 1, '250.00', '{}', array[pg_temp.file('emp1', 'emp1')]))));
  j := pg_temp.submit('emp1', b);
  perform pg_temp.r('D2 EC-CLM-02 / BR-CLM-13: second claim re-validated → "Exceeds RM 500.00 per month"',
    not (pg_temp.js(j) ->> 'submitted')::boolean and j like '%Exceeds RM 500.00 per month%', j);
  j := pg_temp.as_user('emp1', 'aal1', format('select app.claim_line_preview(%L::jsonb)::text', jsonb_build_object('categoryId', pg_temp.cat('POSTAL'),
         'transactionDate', app.today_myt() - 1, 'amountInclSst', '150.00', 'receiptNo', 'TEST-RCPT-0001', 'myinvoisUuid', u)::text));
  perform pg_temp.r('D3 while typing: limit chip (RM 450 of RM 500 this month), UUID clash names the claim',
    pg_temp.js(j) -> 'limit' ->> 'message' = 'Within limit (RM 450.00 of RM 500.00 this month)'
    and pg_temp.js(j) ->> 'uuidClash' like 'UUID already claimed on CL-%', j);
  update app.claim_limits set behaviour = 'warn' where category_id = pg_temp.cat('POSTAL');
  b := pg_temp.jid(pg_temp.save('emp2', 'Same receipt TEST', jsonb_build_array(pg_temp.line('POSTAL', app.today_myt() - 1, '300.00',
         jsonb_build_object('receiptNo', 'test-rcpt-0001'), array[pg_temp.file('emp2', 'emp2')]))));
  j := pg_temp.submit('emp2', b);
  perform pg_temp.r('D4 BR-CLM-17 possible duplicate (any employee, same receipt no. + amount) needs acknowledgement',
    not (pg_temp.js(j) ->> 'submitted')::boolean and (pg_temp.js(j) ->> 'needsAcknowledgement')::boolean and j like '%Same receipt no. and amount on CL-%', j);
  j := pg_temp.submit('emp2', b, true);
  perform pg_temp.r('D5 acknowledged → Submitted with "Possible duplicate" flag', pg_temp.st(b) = 'submitted'
    and (select flag_possible_duplicate from app.claims where id = b), j);
  b := pg_temp.jid(pg_temp.save('emp2', 'Same UUID TEST', jsonb_build_array(pg_temp.line('OFFICE', app.today_myt() - 1, '10.00',
         jsonb_build_object('myinvoisUuid', lower(u)), array[pg_temp.file('emp2', 'emp2')]))));
  j := pg_temp.submit('emp2', b, true);
  perform pg_temp.r('D6 EC-CLM-08 same UUID by another employee → blocked', not (pg_temp.js(j) ->> 'submitted')::boolean and j like '%UUID already claimed on CL-%', j);
  -- late override (F-CLM-21): not own; then the line submits with the flag
  b := pg_temp.jid(pg_temp.save('emp2', 'Late TEST', jsonb_build_array(pg_temp.line('OFFICE', app.today_myt() - 70, '20.00', '{}', array[pg_temp.file('emp2', 'emp2')]))));
  j := pg_temp.as_user('emp2', 'aal1', format('select app.apply_late_override(%L, array[%L]::uuid[], %L)::text', pg_temp.emp('emp2'),
         (select id from app.claim_lines where claim_id = b), 'Receipts were lost in transit TEST'));
  perform pg_temp.r('D7 an employee cannot apply a late override', j like 'ERR:%', j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.apply_late_override(%L, array[%L]::uuid[], %L)::text', pg_temp.emp('adm'),
         (select id from app.claim_lines where claim_id = b), 'Receipts were lost in transit TEST'));
  perform pg_temp.r('D8 an Admin cannot override their own claim lines', j like 'ERR:%PRET-SELF-001%', j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.apply_late_override(%L, array[%L]::uuid[], %L)::text', pg_temp.emp('emp2'),
         (select id from app.claim_lines where claim_id = b), 'short'));
  perform pg_temp.r('D9 override reason ≥ 10 characters', j like 'ERR:%PRET-CLM-REASON%', j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.apply_late_override(%L, array[%L]::uuid[], %L)::text', pg_temp.emp('emp2'),
         (select id from app.claim_lines where claim_id = b), 'Receipts were lost in transit TEST'));
  perform pg_temp.submit('emp2', b, true);
  perform pg_temp.r('D10 override applied → submits with "Late (override)" flag; employee notified',
    j = '1' and pg_temp.st(b) = 'submitted' and (select flag_late_override from app.claims where id = b)
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp2') and event_code = 'N-60'), j);
end $$;

-- ===========================================================================
-- E. Approvals (single level, D12): manager / delegate / ADM / SA, first decision wins, no self-approval
-- ===========================================================================
do $$ declare c1 uuid := pg_temp.id('c1'); t uuid; j text; m uuid; s uuid; ob uuid; tt uuid;
begin
  t := pg_temp.ctask(c1);
  perform pg_temp.r('E1 MGR sees the reportee''s Submitted claim and its lines; non-reportee claims hidden',
    pg_temp.as_user('mgr', 'aal1', format('select count(*)::text from app.claims where id = %L', c1)) = '1'
    and pg_temp.as_user('mgr', 'aal1', format('select count(*)::text from app.claim_lines where claim_id = %L', c1)) = '2'
    and pg_temp.as_user('mgr', 'aal1', format('select count(*)::text from app.claims where employee_id = %L', pg_temp.emp('emp2'))) = '0');
  perform pg_temp.r('E2 peers cannot read the claim or its receipts',
    pg_temp.as_user('emp2', 'aal1', format('select count(*)::text from app.claims where id = %L', c1)) = '0'
    and pg_temp.as_user('emp2', 'aal1', format('select app.can_read_file(%L)::text', (select file_id from app.claim_line_files lf join app.claim_lines l on l.id = lf.claim_line_id where l.claim_id = c1 limit 1))) = 'false');
  perform pg_temp.r('E3 MGR may read the receipts (claimant''s manager — rls §9)',
    pg_temp.as_user('mgr', 'aal1', format('select app.can_read_file(%L)::text', (select file_id from app.claim_line_files lf join app.claim_lines l on l.id = lf.claim_line_id where l.claim_id = c1 limit 1))) = 'true');
  perform pg_temp.r('E4 ADM at aal1 (MFA required) is not admin: sees no other employee''s claims',
    pg_temp.as_user('adm', 'aal1', format('select count(*)::text from app.claims where id = %L', c1)) = '0');
  perform pg_temp.r('E5 the claimant cannot decide (no task actionability)', pg_temp.decide('emp1', t, 'approve') like 'ERR:%', pg_temp.decide('emp1', t, 'approve'));
  perform pg_temp.r('E6 a manager who is not the claimant''s manager cannot decide', pg_temp.decide('del', t, 'approve') like 'ERR:%');
  perform pg_temp.r('E7 reject needs a reason (≥ 5)', pg_temp.decide('mgr', t, 'reject', 'no') like 'ERR:%PRET-TASK-COMMENT%');
  j := pg_temp.decide('adm', t, 'approve');
  perform pg_temp.r('E8 any ADM may approve (pool member) → Approved, tax / GL snapshotted (BR-CLM-24), N-22',
    pg_temp.js(j) ->> 'outcome' = 'approved' and pg_temp.st(c1) = 'approved'
    and (select bool_and(gl_account_snapshot is not null and tax_treatment_snapshot is not null) from app.claim_lines where claim_id = c1)
    and (select decided_by from app.claims where id = c1) = pg_temp.usr('adm')
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp1') and event_code = 'N-22'), j);
  j := pg_temp.decide('mgr', t, 'reject', 'Too late TEST');
  perform pg_temp.r('E9 BR-CLM-25 first decision wins: "Already decided by … at dd/mm/yyyy HH:mm"', j ~ 'Already decided by .+ at [0-9]{2}/[0-9]{2}/[0-9]{4} [0-9]{2}:[0-9]{2}', j);
  begin
    update app.claims set status = 'approved' where id = (select id from app.claims where status = 'submitted' and employee_id = pg_temp.emp('emp2') limit 1);
    j := 'no error';
  exception when others then j := sqlerrm; end;
  perform pg_temp.r('E10 a decision exists only through the approval engine (trigger)', j like '%PRET-CLM-DECIDE-VIA-TASK%', j);
  -- manager's own claim → their manager (SA), any ADM; not the manager
  m := pg_temp.jid(pg_temp.save('mgr', 'Manager own TEST', jsonb_build_array(pg_temp.line('OFFICE', app.today_myt() - 1, '30.00', '{}', array[pg_temp.file('mgr', 'mgr')]))));
  perform pg_temp.submit('mgr', m);
  tt := pg_temp.ctask(m);
  perform pg_temp.r('E11 EC-CLM-13 manager''s own claim routes to their manager (SA); not actionable for the claimant',
    (select assignee_user_id from app.approval_tasks where id = tt) = pg_temp.usr('sa')
    and pg_temp.as_user('mgr', 'aal1', format('select app.can_act_on_task(%L)::text', tt)) = 'false');
  j := pg_temp.decide('mgr', tt, 'approve');
  perform pg_temp.r('E12 PRET-SELF-001 for the claimant in any role', j like 'ERR:%PRET-SELF-001%', j);
  -- SA's own claim (top of organisation) → any ADM (Q11)
  s := pg_temp.jid(pg_temp.save('sa', 'SA own TEST', jsonb_build_array(pg_temp.line('OFFICE', app.today_myt() - 1, '30.00', '{}', array[pg_temp.file('sa', 'sa')]))));
  perform pg_temp.submit('sa', s);
  tt := pg_temp.ctask(s);
  perform pg_temp.r('E13 SA''s own claim: no named approver, SA cannot decide, ADM can (Q11)',
    (select assignee_user_id from app.approval_tasks where id = tt) is null
    and pg_temp.decide('sa', tt, 'approve') like 'ERR:%PRET-SELF-001%'
    and pg_temp.js(pg_temp.decide('ext', tt, 'approve')) ->> 'outcome' = 'approved');
  -- ADM on behalf (C2): flagged, preparer cannot decide, another Admin can
  ob := pg_temp.jid(pg_temp.save('adm', 'On behalf TEST', jsonb_build_array(pg_temp.line('OFFICE', app.today_myt() - 1, '45.00', '{}',
          array[pg_temp.file('emp3', 'adm')])), jsonb_build_object('employeeId', pg_temp.emp('emp3'), 'onBehalfNote', 'Paper claim TEST')));
  perform pg_temp.r('E14 on-behalf New claim visible to the employee and ADM (BR-CLM-27); on_behalf_by recorded',
    (select on_behalf_by from app.claims where id = ob) = pg_temp.usr('adm')
    and pg_temp.as_user('emp3', 'aal1', format('select count(*)::text from app.claims where id = %L', ob)) = '1'
    and pg_temp.as_user('adm2', 'aal2', format('select count(*)::text from app.claims where id = %L', ob)) = '1');
  j := pg_temp.submit('adm', ob);
  tt := pg_temp.ctask(ob);
  perform pg_temp.r('E15 on-behalf submit → task prepared by the entering Admin (subject_prepared_by)',
    (pg_temp.js(j) ->> 'submitted')::boolean and (select subject_prepared_by from app.approval_tasks where id = tt) = pg_temp.usr('adm'), j);
  j := pg_temp.decide('adm', tt, 'approve');
  perform pg_temp.r('E16 the entering Admin cannot decide it', j like 'ERR:%PRET-SELF-001%', j);
  j := pg_temp.decide('adm2', tt, 'reject', 'Wrong cost centre TEST');
  perform pg_temp.r('E17 another Admin rejects → Rejected with reason, N-23', pg_temp.st(ob) = 'rejected'
    and (select reject_reason from app.claims where id = ob) = 'Wrong cost centre TEST'
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp3') and event_code = 'N-23'), j);
  -- copy a rejected claim (F-CLM-29)
  j := pg_temp.as_user('emp3', 'aal1', format('select app.copy_claim(%L, %L)::text', ob, gen_random_uuid()));
  perform pg_temp.r('E18 copy a Rejected claim → new New claim "Copied from", attachments kept, original unchanged',
    pg_temp.st(pg_temp.jid(j)) = 'new' and (select copied_from_claim_id from app.claims where id = pg_temp.jid(j)) = ob and pg_temp.st(ob) = 'rejected'
    and (select count(*) from app.claim_line_files lf join app.claim_lines l on l.id = lf.claim_line_id where l.claim_id = pg_temp.jid(j)) = 1, j);
  perform pg_temp.r('E19 only Rejected claims can be copied', pg_temp.as_user('emp1', 'aal1', format('select app.copy_claim(%L, %L)::text', c1, gen_random_uuid())) like 'ERR:%');
end $$;

-- delegate (scope Claims) and re-routing on manager change
do $$ declare c uuid; t uuid; j text;
begin
  insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
  values (pg_temp.usr('mgr'), pg_temp.usr('del'), app.today_myt() - 1, app.today_myt() + 10, 'claims', pg_temp.usr('mgr'));
  c := pg_temp.jid(pg_temp.save('emp1', 'Delegate TEST', jsonb_build_array(pg_temp.line('MEDICAL', app.today_myt() - 1, '50.00',
         jsonb_build_object('claimant', 'self'), array[pg_temp.file('emp1', 'emp1')]))));
  perform pg_temp.submit('emp1', c);
  t := pg_temp.ctask(c);
  perform pg_temp.r('F1 active delegate (Claims) may act; sees the claim but not dependants (T2)',
    pg_temp.as_user('del', 'aal1', format('select app.task_acting_as(%L)::text', t)) = 'delegate'
    and pg_temp.as_user('del', 'aal1', format('select count(*)::text from app.claims where id = %L', c)) = '1'
    and pg_temp.as_user('del', 'aal1', 'select count(*)::text from app.claim_line_dependants') = '0');
  j := pg_temp.decide('del', t, 'approve');
  perform pg_temp.r('F2 delegate approves → Approved (acting as delegate in the trail)', pg_temp.st(c) = 'approved'
    and (select acting_as::text from app.approval_tasks where id = t) = 'delegate', j);
  c := pg_temp.jid(pg_temp.save('emp1', 'Reroute TEST', jsonb_build_array(pg_temp.line('OFFICE', app.today_myt() - 1, '12.00', '{}', array[pg_temp.file('emp1', 'emp1')]))));
  perform pg_temp.submit('emp1', c);
  update app.employees set claim_approver_employee_id = pg_temp.emp('del') where id = pg_temp.emp('emp1');
  perform pg_temp.r('F3 claim approver (F16) change re-routes the open claim task',
    (select assignee_user_id from app.approval_tasks where claim_id = c and status = 'open') = pg_temp.usr('del')
    and exists (select 1 from app.approval_tasks where claim_id = c and status = 'superseded'));
  update app.employees set claim_approver_employee_id = null where id = pg_temp.emp('emp1');
  insert into ids values ('c_open', c, null);
end $$;

-- ===========================================================================
-- G. Cancel an approved claim (F-CLM-30, BR-CLM-26)
-- ===========================================================================
do $$ declare c uuid; j text;
begin
  c := pg_temp.approved_claim('emp1', 'Cancel me TEST', '80.00', 'adm');
  j := pg_temp.as_user('emp1', 'aal1', format('select app.cancel_claim(%L, %L)::text', c, 'No longer needed TEST'));
  perform pg_temp.r('G1 the claimant cannot cancel', j like 'ERR:%PRET-SELF-001%', j);
  j := pg_temp.as_user('emp2', 'aal1', format('select app.cancel_claim(%L, %L)::text', c, 'No longer needed TEST'));
  perform pg_temp.r('G2 a peer cannot cancel', j like 'ERR:%PRET-ACC-404%', j);
  j := pg_temp.as_user('mgr', 'aal1', format('select app.cancel_claim(%L, %L)::text', c, 'no'));
  perform pg_temp.r('G3 reason required (≥ 5)', j like 'ERR:%PRET-CLM-REASON%', j);
  j := pg_temp.as_user('mgr', 'aal1', format('select app.cancel_claim(%L, %L)::text', c, 'Duplicate of a paid claim TEST'));
  perform pg_temp.r('G4 claimant''s manager cancels → Cancelled, not live, N-59', pg_temp.st(c) = 'cancelled'
    and not (select bool_or(is_live) from app.claim_lines where claim_id = c)
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp1') and event_code = 'N-59'), j);
  j := pg_temp.as_user('mgr', 'aal1', format('select app.cancel_claim(%L, %L)::text', c, 'Again TEST'));
  perform pg_temp.r('G5 only Approved claims can be cancelled', j like 'ERR:%PRET-CLM-STATE%', j);
end $$;

-- ===========================================================================
-- H. Month-end disbursement: batch, outputs, totals check, out of date, disbursed, undo, immutability
-- ===========================================================================
do $$ declare a uuid; b uuid; c uuid; bt uuid; bt2 uuid; j text; f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid(); v_month text := to_char(app.today_myt(), 'YYYY-MM');
  v_files jsonb; n int; tot numeric;
begin
  a := pg_temp.approved_claim('emp1', 'Batch A TEST', '100.10', 'adm');
  b := pg_temp.approved_claim('emp2', 'Batch B TEST', '200.25', 'adm');
  c := pg_temp.approved_claim('emp1', 'Batch C TEST', '0.65', 'mgr');
  perform pg_temp.r('H1 MGR has no batch access and no payee (bank) access (rls §8)',
    pg_temp.as_user('mgr', 'aal1', 'select count(*)::text from app.disbursement_batches') = '0'
    and pg_temp.as_user('mgr', 'aal1', format('select count(*)::text from app.batch_payees(%L)', gen_random_uuid())) like 'ERR:%PRET-ACC-403%');
  j := pg_temp.as_user('adm', 'aal2', format('select app.create_batch(%L::jsonb)::text', jsonb_build_object('disbursementMonth', v_month,
         'cutoffDate', (date_trunc('month', app.today_myt()) + interval '1 month - 1 day')::date, 'plannedPaymentDate', app.today_myt(),
         'claimIds', jsonb_build_array(a, b, c, pg_temp.id('c_open')), 'idempotencyKey', gen_random_uuid())::text));
  perform pg_temp.r('H2 only Approved claims enter a batch (Submitted refused)', j like 'ERR:%PRET-BATCH-CLAIM-STATE%', j);
  insert into ids values ('bkey', gen_random_uuid(), null);
  j := pg_temp.as_user('adm', 'aal2', format('select app.create_batch(%L::jsonb)::text', jsonb_build_object('disbursementMonth', v_month,
         'cutoffDate', (date_trunc('month', app.today_myt()) + interval '1 month - 1 day')::date, 'plannedPaymentDate', app.today_myt(),
         'claimIds', jsonb_build_array(a, b, c), 'idempotencyKey', pg_temp.id('bkey'))::text));
  bt := pg_temp.jid(j);
  perform pg_temp.r('H3 create batch → PB-yyyy-nnn Draft; totals 3 claims / 2 employees / RM 301.00 (to the sen); N-29',
    (pg_temp.js(j) ->> 'batchNo') ~ '^PB-[0-9]{4}-[0-9]{3}$' and (select status::text from app.disbursement_batches where id = bt) = 'draft'
    and (select claim_count || '/' || employee_count || '/' || total_amount from app.disbursement_batches where id = bt) = '3/2/301.00'
    and (select disbursement_batch_id from app.claims where id = a) = bt
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp1') and event_code = 'N-29'), j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.create_batch(%L::jsonb)::text', jsonb_build_object('disbursementMonth', v_month,
         'cutoffDate', app.today_myt(), 'plannedPaymentDate', app.today_myt(), 'claimIds', jsonb_build_array(a), 'idempotencyKey', pg_temp.id('bkey'))::text));
  perform pg_temp.r('H4 idempotent create (same key) returns the same batch', pg_temp.jid(j) = bt and (pg_temp.js(j) ->> 'duplicate')::boolean, j);
  j := pg_temp.as_user('adm2', 'aal2', format('select app.create_batch(%L::jsonb)::text', jsonb_build_object('disbursementMonth', v_month,
         'cutoffDate', app.today_myt(), 'plannedPaymentDate', app.today_myt(), 'claimIds', jsonb_build_array(a), 'idempotencyKey', gen_random_uuid())::text));
  perform pg_temp.r('H5 a claim can be in at most one open batch', j like 'ERR:%PRET-BATCH-CLAIM-TAKEN%', j);
  j := pg_temp.as_user('adm', 'aal2', format('select string_agg(coalesce(payment_method::text, ''none'') || '':'' || bank_complete::text || '':'' || amount, '','' order by employee_no) from app.batch_payees(%L)', bt));
  perform pg_temp.r('H6 payees: one line per employee = Σ claims; emp1 bank transfer complete, emp2 cheque (D23 section)',
    j = 'bank_transfer:true:100.75,cheque:false:200.25', j);
  -- D31 (6): full payment list on screen — ADM/SA only, every view access-logged; batch_payees carries no ciphertext
  perform pg_temp.r('H6a MGR and EMP cannot read the full payment list (PRET-ACC-403)',
    pg_temp.as_user('mgr', 'aal1', format('select count(*)::text from app.payment_list_view(%L, ''view'')', bt)) like 'ERR:%PRET-ACC-403%'
    and pg_temp.as_user('emp1', 'aal1', format('select count(*)::text from app.payment_list_view(%L, ''view'')', bt)) like 'ERR:%PRET-ACC-403%'
    and pg_temp.as_user('adm', 'aal1', format('select count(*)::text from app.payment_list_view(%L, ''view'')', bt)) like 'ERR:%PRET-ACC-403%');
  n := (select count(*) from audit.access_log where entity_id = bt and action = 'reveal');
  j := pg_temp.as_user('adm', 'aal2', format('select count(*)::text from app.payment_list_view(%L, ''view'') where account_no_enc is not null', bt));
  perform pg_temp.r('H6b ADM view returns the bank-transfer payee ciphertext only (cheque payee excluded) and writes audit.access_log (reveal, bank)',
    j = '1' and (select count(*) from audit.access_log where entity_id = bt and action = 'reveal' and 'bank' = any(data_categories)) = n + 1, j);
  perform pg_temp.r('H6c batch_payees (masked lists / CSV) never returns account ciphertext',
    pg_temp.as_user('adm', 'aal2', format('select count(*)::text from app.batch_payees(%L) where account_no_enc is not null', bt)) = '0');
  insert into app.files (id, bucket, storage_path, subject, original_name, mime_type, size_bytes, status, created_by) values
    (f1, 'generated', 'out/hlb/' || coalesce(bt, gen_random_uuid()) || '/v1/' || f1 || '.xlsx', 'generated_output', 'list.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1000, 'active', pg_temp.usr('adm')),
    (f2, 'generated', 'out/hlb/' || coalesce(bt, gen_random_uuid()) || '/v1/' || f2 || '.pdf', 'generated_output', 'list.pdf', 'application/pdf', 1000, 'active', pg_temp.usr('adm'));
  v_files := jsonb_build_array(jsonb_build_object('kind', 'hlb_claims_payment_list_xlsx', 'fileId', f1, 'rowCount', 1, 'total', '100.75'),
                               jsonb_build_object('kind', 'hlb_claims_payment_list_pdf', 'fileId', f2, 'rowCount', 1, 'total', '100.75'));
  j := pg_temp.as_user('adm', 'aal2', format('select app.record_batch_outputs(%L, %L::jsonb, 100.75, 200.24)::text', bt, v_files::text));
  perform pg_temp.r('H7 totals check is blocking: HLB + cheque/cash must equal the batch total to the sen', j like 'ERR:%PRET-BATCH-TOTALS%', j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.record_batch_outputs(%L, %L::jsonb, 100.75, 200.25)::text', bt, v_files::text));
  perform pg_temp.r('H8 outputs recorded → Exported, version 1', (select status::text || outputs_version from app.disbursement_batches where id = bt) = 'exported1', j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.mark_batch_disbursed(%L, %L, %L, null, null)::text', bt, app.today_myt() + 1, 'HLB-TEST-0001'));
  perform pg_temp.r('H9 payment date must be today or earlier', j like 'ERR:%payment date must be today or earlier%', j);
  -- EC-CLM-11: cancel a claim in the exported batch → removed + out of date → cannot mark Disbursed
  j := pg_temp.as_user('mgr', 'aal1', format('select app.cancel_claim(%L, %L)::text', c, 'Paid by petty cash TEST'));
  perform pg_temp.r('H10 cancelling a claim in an exported batch removes it and marks the outputs out of date (BR-CLM-26)',
    pg_temp.st(c) = 'cancelled' and (select disbursement_batch_id from app.claims where id = c) is null
    and (select outputs_out_of_date and claim_count = 2 and total_amount = 300.35 from app.disbursement_batches where id = bt)
    and (select out_of_date_reason from app.disbursement_batches where id = bt) like '%was cancelled after export', j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.mark_batch_disbursed(%L, %L, %L, null, null)::text', bt, app.today_myt(), 'HLB-TEST-0001'));
  perform pg_temp.r('H11 out-of-date outputs block MARK DISBURSED', j like 'ERR:%regenerate the outputs first%', j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.record_batch_outputs(%L, %L::jsonb, 100.10, 200.25)::text', bt, v_files::text));
  perform pg_temp.r('H12 regenerate → version 2, previous superseded, not out of date',
    (select outputs_version || ':' || outputs_out_of_date from app.disbursement_batches where id = bt) = '2:false'
    and (select count(*) from app.export_files where subject_id = bt and is_superseded) = 2, j);
  -- EC-CLM-10: bank details change after export
  insert into app.employee_bank_accounts (employee_id, payment_method, effective_from, verified_by) values (pg_temp.emp('emp2'), 'cash', app.today_myt(), pg_temp.usr('adm'));
  perform pg_temp.r('H13 EC-CLM-10 bank details changed after export → warning + outputs out of date',
    (select bank_details_changed_after_export and outputs_out_of_date from app.disbursement_batches where id = bt));
  perform pg_temp.as_user('adm', 'aal2', format('select app.record_batch_outputs(%L, %L::jsonb, 100.10, 200.25)::text', bt, v_files::text));
  j := pg_temp.as_user('emp1', 'aal1', format('select app.mark_batch_disbursed(%L, %L, %L, null, null)::text', bt, app.today_myt(), 'HLB-TEST-0001'));
  perform pg_temp.r('H14 an employee cannot mark a batch Disbursed', j like 'ERR:%PRET-ACC-403%', j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.mark_batch_disbursed(%L, %L, %L, %L, null)::text', bt, app.today_myt(), 'HLB-TEST-0001', 'Keyed TEST'));
  perform pg_temp.r('H15 mark Disbursed → batch + claims Disbursed with date and reference; N-25 per employee',
    (select status::text from app.disbursement_batches where id = bt) = 'disbursed' and pg_temp.st(a) = 'disbursed' and pg_temp.st(b) = 'disbursed'
    and (select payment_reference from app.claims where id = a) = 'HLB-TEST-0001'
    and (select count(*) from app.notifications where event_code = 'N-25' and recipient_user_id in (pg_temp.usr('emp1'), pg_temp.usr('emp2'))) = 2, j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.mark_batch_disbursed(%L, %L, %L, null, null)::text', bt, app.today_myt(), 'HLB-TEST-0001'));
  perform pg_temp.r('H16 idempotent marking (same date + reference)', (pg_temp.js(j) ->> 'duplicate')::boolean, j);
  begin update app.disbursement_batches set total_amount = 1 where id = bt; j := 'no error'; exception when others then j := sqlerrm; end;
  perform pg_temp.r('H17 batch totals immutable once Disbursed', j like '%PRET-BATCH-IMMUTABLE%', j);
  begin update app.claims set disbursement_batch_id = null where id = a; j := 'no error'; exception when others then j := sqlerrm; end;
  perform pg_temp.r('H18 a Disbursed claim leaves its batch only through undo', j like '%PRET-BATCH-DISBURSED%' or j like '%PRET-CLM%', j);
  j := pg_temp.as_user('mgr', 'aal1', format('select app.undo_claim_disbursement(%L, %L)::text', b, 'Rejected by HLB TEST'));
  perform pg_temp.r('H19 MGR cannot undo a disbursement', j like 'ERR:%PRET-ACC-403%', j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.undo_claim_disbursement(%L, %L)::text', b, 'Rejected by HLB — invalid account TEST'));
  perform pg_temp.r('H20 undo → Approved, out of the batch, batch totals unchanged, N-28 to employee and Admins',
    pg_temp.st(b) = 'approved' and (select disbursement_batch_id from app.claims where id = b) is null
    and (select total_amount from app.disbursement_batches where id = bt) = 300.35
    and exists (select 1 from app.disbursement_batch_claims where claim_id = b and undone_at is not null)
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp2') and event_code = 'N-28')
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('adm2') and event_code = 'N-28'), j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.create_batch(%L::jsonb)::text', jsonb_build_object('disbursementMonth', v_month,
         'cutoffDate', app.today_myt(), 'plannedPaymentDate', app.today_myt(), 'claimIds', jsonb_build_array(b), 'idempotencyKey', gen_random_uuid())::text));
  bt2 := pg_temp.jid(j);
  perform pg_temp.r('H21 the undone claim is picked up by the next batch (not the regular one for the month)',
    (select is_regular from app.disbursement_batches where id = bt2) = false and (select disbursement_batch_id from app.claims where id = b) = bt2, j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.cancel_batch(%L, %L)::text', bt2, 'Wrong month TEST'));
  perform pg_temp.r('H22 cancel batch → Cancelled; claims stay Approved and selectable again',
    (select status::text from app.disbursement_batches where id = bt2) = 'cancelled' and pg_temp.st(b) = 'approved'
    and (select disbursement_batch_id from app.claims where id = b) is null, j);
  -- SA approval setting on (PB8): Pending approval → SA (≠ preparer) approves via the engine
  update app.security_settings set sa_batch_approval_required = true where id = 1;
  j := pg_temp.as_user('adm', 'aal2', format('select app.create_batch(%L::jsonb)::text', jsonb_build_object('disbursementMonth', v_month,
         'cutoffDate', app.today_myt(), 'plannedPaymentDate', app.today_myt(), 'claimIds', jsonb_build_array(b), 'idempotencyKey', gen_random_uuid())::text));
  bt2 := pg_temp.jid(j);
  j := pg_temp.as_user('adm', 'aal2', format('select app.record_batch_outputs(%L, %L::jsonb, 0, 200.25)::text', bt2, '[]'));
  perform pg_temp.r('H23 setting on: outputs need SA approval first', j like 'ERR:%PRET-BATCH-STATE%', j);
  perform pg_temp.as_user('adm', 'aal2', format('select app.batch_submit_for_approval(%L)::text', bt2));
  perform pg_temp.r('H24 submit for approval → Pending approval, SA notified (N-26), task in the super-admin pool',
    (select status::text from app.disbursement_batches where id = bt2) = 'pending_approval'
    and exists (select 1 from app.approval_tasks where disbursement_batch_id = bt2 and status = 'open' and source = 'super_admin_pool')
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('sa') and event_code = 'N-26'));
  j := pg_temp.decide('adm2', (select id from app.approval_tasks where disbursement_batch_id = bt2 and status = 'open'), 'approve');
  perform pg_temp.r('H25 an ADM cannot approve a batch (SA only)', j like 'ERR:%', j);
  j := pg_temp.decide('sa', (select id from app.approval_tasks where disbursement_batch_id = bt2 and status = 'open'), 'approve');
  perform pg_temp.r('H26 SA approves → Approved, approved_by = SA ≠ preparer, N-27 to the preparer',
    (select status::text || ':' || (approved_by = pg_temp.usr('sa'))::text from app.disbursement_batches where id = bt2) = 'approved:true'
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('adm') and event_code = 'N-27'), j);
  update app.security_settings set sa_batch_approval_required = false where id = 1;
end $$;

-- ===========================================================================
-- I. Utilisation, hint, configuration guards
-- ===========================================================================
do $$ declare j text; x text;
begin
  j := pg_temp.as_user('emp1', 'aal1', format('select string_agg(basis || '':'' || used || ''/'' || limit_amount, '','') from app.claim_utilisation(%L, null) u join app.claim_categories k on k.id = u.category_id where k.code = ''MEDICAL''', pg_temp.emp('emp1')));
  perform pg_temp.r('I1 F-CLM-20 utilisation: medical per transaction used vs RM 300.00', j like 'transaction:%/300.00', j);
  perform pg_temp.r('I2 a peer cannot read someone else''s utilisation',
    pg_temp.as_user('emp2', 'aal1', format('select count(*)::text from app.claim_utilisation(%L, null)', pg_temp.emp('emp1'))) like 'ERR:%PRET-ACC-404%');
  perform pg_temp.r('I3 approver hint names the manager', pg_temp.as_user('emp1', 'aal1', format('select app.claim_approver_hint(%L)', pg_temp.emp('emp1'))) = 'Goes to W5 Test MGR or any Admin for approval.'
    or pg_temp.as_user('emp1', 'aal1', format('select app.claim_approver_hint(%L)', pg_temp.emp('emp1'))) like 'Goes to Sample Employee%or any Admin for approval.');
  j := pg_temp.as_user('emp1', 'aal1', format('insert into app.claim_limits (category_id, applies_to, per_transaction, effective_from) values (%L, ''everyone'', 1, current_date) returning 1', pg_temp.cat('OFFICE')));
  perform pg_temp.r('I4 employees cannot write limits', j like 'ERR:%', j);
  j := pg_temp.as_user('adm', 'aal2', format('insert into app.claim_limits (category_id, applies_to, per_transaction, per_month, effective_from) values (%L, ''everyone'', 500, 100, current_date) returning 1', pg_temp.cat('OFFICE')));
  perform pg_temp.r('I5 CLM-L5 per month must be ≥ per transaction', j like 'ERR:%chk_limit_order%', j);
  j := pg_temp.as_user('adm', 'aal2', format('insert into app.claim_limits (category_id, applies_to, per_transaction, effective_from) values (%L, ''everyone'', 400, current_date) returning 1', pg_temp.cat('MEDICAL')));
  perform pg_temp.r('I6 overlapping limits for the same target refused', j like 'ERR:%PRET-CLM-LIMIT-OVERLAP%', j);
  j := pg_temp.as_user('adm', 'aal2', format('insert into app.claim_limits (category_id, applies_to, employee_id, per_transaction, effective_from) values (%L, ''employee'', %L, 500, current_date - 30) returning 1', pg_temp.cat('MEDICAL'), pg_temp.emp('emp2')));
  x := pg_temp.as_user('emp2', 'aal1', format('select app.claim_line_preview(%L::jsonb) -> ''limit'' ->> ''status''', jsonb_build_object('categoryId', pg_temp.cat('MEDICAL'), 'transactionDate', app.today_myt() - 1, 'amountInclSst', '450.00')::text));
  perform pg_temp.r('I7 US-CLAIM-003 precedence: employee limit RM 500 → RM 450 within for that employee, blocked for others',
    j = '1' and x = 'within'
    and pg_temp.as_user('emp1', 'aal1', format('select app.claim_line_preview(%L::jsonb) -> ''limit'' ->> ''status''', jsonb_build_object('categoryId', pg_temp.cat('MEDICAL'), 'transactionDate', app.today_myt() - 1, 'amountInclSst', '450.00')::text)) = 'over', x);
  perform pg_temp.r('I8 an employee sees own employee-specific limits only',
    pg_temp.as_user('emp1', 'aal1', 'select count(*)::text from app.claim_limits where applies_to = ''employee''') = '0'
    and pg_temp.as_user('emp2', 'aal1', 'select count(*)::text from app.claim_limits where applies_to = ''employee''') = '1');
  begin
    insert into app.claim_categories (code, name, claim_group, is_mileage, tax_treatment, gl_account_code) values ('W5MILE', 'W5 mileage TEST', 'transport_mileage', true, 'reimbursement', 'TBC');
    set constraints app.tg_rate_required immediate;
    x := 'no error';
  exception when others then x := sqlerrm; end;
  perform pg_temp.r('I9 US-CLAIM-001 mileage-based category without a rate is refused', x like '%PRET-CLM-RATE%', x);
end $$;

-- ===========================================================================
-- L. Lint (rls §12)
-- ===========================================================================
do $$ declare t text[] := array['claim_policy','claim_categories','claim_category_grades','claim_category_rates','claim_limits','claims','claim_lines',
    'claim_line_files','claim_line_dependants','claim_late_overrides','claim_events','disbursement_batches','disbursement_batch_claims','disbursement_batch_events','export_files'];
  n_unforced int; n_nosel int; n_nocheck int; n_mgr int; n_trig int; n_path int; n_all int; n_anon int;
begin
  select count(*) into n_unforced from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relname = any(t) and not (c.relrowsecurity and c.relforcerowsecurity);
  select count(*) into n_nosel from unnest(t) x where not exists (select 1 from pg_policies p where p.schemaname = 'app' and p.tablename = x and p.cmd = 'SELECT');
  select count(*) into n_nocheck from pg_policies where schemaname = 'app' and cmd in ('INSERT','UPDATE') and with_check is null;
  select count(*) into n_mgr from pg_policies p where p.schemaname = 'app'
     and p.tablename in ('claim_line_dependants','disbursement_batches','disbursement_batch_claims','disbursement_batch_events','employee_bank_accounts')
     and (coalesce(p.qual, '') ~ '(is_manager_of|can_see_team_row|is_current_approver_for)' or coalesce(p.with_check, '') ~ '(is_manager_of|can_see_team_row|is_current_approver_for)');
  select count(*) into n_trig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute');
  select count(*) into n_path from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','audit') and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  select count(*) into n_all from pg_policies where schemaname = 'app' and cmd = 'ALL';
  select count(*) into n_anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname like any(array['%claim%','%batch%']) and has_function_privilege('anon', p.oid, 'execute');
  perform pg_temp.r('L1 RLS enabled and forced on every W2-005 table', n_unforced = 0, n_unforced::text);
  perform pg_temp.r('L2 every W2-005 table has a SELECT policy', n_nosel = 0, n_nosel::text);
  perform pg_temp.r('L3 every insert/update policy has WITH CHECK', n_nocheck = 0, n_nocheck::text);
  perform pg_temp.r('L4 no dependant / batch / bank policy references a manager helper (rls §8)', n_mgr = 0, n_mgr::text);
  perform pg_temp.r('L5 no trigger function is executable by authenticated', n_trig = 0, n_trig::text);
  perform pg_temp.r('L6 every definer function pins search_path', n_path = 0, n_path::text);
  perform pg_temp.r('L7 no FOR ALL policies', n_all = 0, n_all::text);
  perform pg_temp.r('L8 anon cannot execute any claims / batch function', n_anon = 0, n_anon::text);
  perform pg_temp.r('L9 seed + D31: 20 categories (GL TBC-…), 2 mileage at RM 0.500/km with receipt required + Google Maps hint, claims-payable TBC-CLAIMS-PAYABLE, Medical RM 300.00 / transaction (Block)',
    (select count(*) from app.claim_categories where gl_account_code like 'TBC-%') = 20
    and (select count(*) from app.claim_category_rates r join app.claim_categories k on k.id = r.category_id where k.code in ('EMP-TRANS','EMP-TRAVEL') and r.rate_per_km = 0.500) = 2
    and (select bool_and(receipt_required and description = 'Attach a Google Maps screenshot showing the start point, end point and distance (km).')
           from app.claim_categories where code in ('EMP-TRANS','EMP-TRAVEL'))
    and (select gl_account_code from app.gl_mappings where purpose = 'claims_payable') like 'TBC-%'
    and exists (select 1 from app.claim_limits l join app.claim_categories k on k.id = l.category_id where k.code = 'MEDICAL' and l.applies_to = 'everyone'
                 and l.per_transaction = 300.00 and l.behaviour = 'block'));
end $$;

select test, pass, detail from t_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from t_results;

rollback;
