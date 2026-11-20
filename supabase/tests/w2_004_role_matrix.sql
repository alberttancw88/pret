-- PRET W2-004 — role matrix, guards and ledger arithmetic for M2 leave + the approval engine
-- (rls-policies.md §3, §5.4, §5.5, §7, §9, §12; ADR-0004/0005/0015; PRD §6).
-- Runs entirely inside ONE transaction that is rolled back: no data is left behind.
-- Synthetic fixtures only (example.invalid emails, random UUIDs). Dates are relative to today so the suite runs any day.
--   DATABASE_CA_CERT_FILE=private/supabase-ca.crt node --env-file=.env.local supabase/tests/run.cjs supabase/tests/w2_004_role_matrix.sql

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

-- Runs one statement as a fixture user; returns its single value as text, or 'ERR: <message>'.
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
create function pg_temp.err(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'no error'; exception when others then return sqlerrm; end $$;
create function pg_temp.emp(p_n text) returns uuid language sql as $$ select emp_id from fx where n = p_n $$;
create function pg_temp.usr(p_n text) returns uuid language sql as $$ select app_id from fx where n = p_n $$;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select id from ids where k = p_k $$;
create function pg_temp.d(p_k text) returns date language sql as $$ select v::date from ids where k = p_k $$;
-- application payload
create function pg_temp.app(p_emp uuid, p_type text, p_start date, p_end date, p_ss text default 'full', p_es text default 'full',
                            p_reason text default 'Synthetic test leave', p_extra jsonb default '{}') returns text
language sql as $$
  select format('select app.leave_evaluate(%L::jsonb, true)::text',
    (jsonb_build_object('employee_id', p_emp, 'leave_type_id', (select id from app.leave_types where code = p_type), 'start_date', p_start,
      'end_date', p_end, 'start_session', p_ss, 'end_session', p_es, 'reason', p_reason, 'idempotency_key', gen_random_uuid()) || p_extra)::text)
$$;
create function pg_temp.preview(p_emp uuid, p_type text, p_start date, p_end date, p_ss text default 'full', p_es text default 'full',
                                p_reason text default 'Synthetic test leave', p_extra jsonb default '{}') returns text
language sql as $$
  select format('select app.leave_evaluate(%L::jsonb, false)::text',
    (jsonb_build_object('employee_id', p_emp, 'leave_type_id', (select id from app.leave_types where code = p_type), 'start_date', p_start,
      'end_date', p_end, 'start_session', p_ss, 'end_session', p_es, 'reason', p_reason) || p_extra)::text)
$$;
create function pg_temp.blocks(p jsonb) returns text language sql as $$ select coalesce((select string_agg(b ->> 'code', ',') from jsonb_array_elements(p -> 'blocks') b), '') $$;
create function pg_temp.open_task(p_app uuid, p_type text default 'leave_application') returns uuid
language sql as $$ select id from app.approval_tasks where coalesce(leave_application_id, replacement_credit_id) = p_app and subject_type::text = p_type and status = 'open' $$;
create function pg_temp.decide(p_n text, p_aal text, p_task uuid, p_decision text, p_comment text default null, p_override boolean default false) returns text
language sql as $$
  select pg_temp.as_user(p_n, p_aal, format('select app.decide_task(%L, %L, %L, (select version from app.approval_tasks where id = %L), %L)::text',
                                            p_task, p_decision, p_comment, p_task, p_override))
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (system writes)
-- ---------------------------------------------------------------------------
with g as (insert into app.grades (code, name, rank) values ('W4G1', 'W4 TEST grade', 992) returning id) insert into ids select 'grade', id from g;
with p as (insert into app.positions (code, title) values ('W4POS', 'W4 TEST position') returning id) insert into ids select 'pos', id from p;
insert into ids select 'dept', id, null from app.departments where is_active order by code limit 1;
insert into ids select 'loc', id, null from app.work_locations where is_active order by name limit 1;
insert into ids select 'pat', id, null from app.working_patterns where is_active order by name limit 1;
update app.security_settings set max_top_of_org = 5 where id = 1;
-- deterministic engine settings for relative dates (accrual cases are asserted separately in section B)
update app.leave_policy set entitlement_method = 'full_pro_rated', next_year_from_ddmm = '01/01' where id = 1;

create function pg_temp.mk_emp(p_id uuid, p_no text, p_mgr uuid, p_join date, p_gender app.gender default 'female', p_top boolean default false,
                               p_state app.my_state default 'SGR') returns void
language plpgsql as $$
begin
  insert into app.employees (id, employee_no, full_name, gender, work_email, mobile_phone, join_date, probation_months,
                             department_id, position_id, grade_id, manager_employee_id, work_location_id, work_state, working_pattern_id, status)
  values (p_id, p_no, 'Sample Employee ' || regexp_replace(p_no, '[^A-Za-z]', '', 'g'), p_gender, lower(p_no) || '@example.invalid', '+60120000000', p_join, 0,
          pg_temp.id('dept'), pg_temp.id('pos'), pg_temp.id('grade'), p_mgr, pg_temp.id('loc'), p_state, pg_temp.id('pat'), 'confirmed');
  insert into app.employee_hr_private (employee_id, is_top_of_org, ph_state_override) values (p_id, p_top, p_state);
  insert into app.employee_personal (employee_id, nric_enc, nric_last4, nric_bidx, date_of_birth, personal_email, res_addr_line1,
                                     res_postcode, res_city, res_state, continuous_service_date)
  values (p_id, extensions.gen_random_bytes(40), '0000', extensions.gen_random_bytes(32), date '1990-01-01',
          lower(p_no) || '.home@example.invalid', '1 Jalan Contoh', '50000', 'Kuala Lumpur', 'KUL', p_join);
  insert into app.employee_sensitive (employee_id, religion) values (p_id, 'none');
  insert into app.employee_statutory_profiles (employee_id) values (p_id);
  insert into app.employee_statutory_employer_flags (employee_id) values (p_id);
  insert into app.employee_marital_history (employee_id, marital_status, effective_date) values (p_id, 'married', p_join);
  insert into app.employee_emergency_contacts (employee_id, priority, name, relationship, mobile_phone) values (p_id, 1, 'Sample Contact', 'parent', '+60120000001');
end $$;

insert into fx (n, auth_id, emp_id) values
  ('sa', gen_random_uuid(), gen_random_uuid()), ('adm', gen_random_uuid(), gen_random_uuid()), ('mgr', gen_random_uuid(), gen_random_uuid()),
  ('emp1', gen_random_uuid(), gen_random_uuid()), ('emp2', gen_random_uuid(), gen_random_uuid()), ('emp3', gen_random_uuid(), gen_random_uuid()),
  ('del', gen_random_uuid(), gen_random_uuid()), ('vet', gen_random_uuid(), gen_random_uuid()), ('ext', gen_random_uuid(), null);
select pg_temp.mk_emp(pg_temp.emp('sa'),   'W4T-SA',   null,               app.today_myt() - 900, 'male', true);
select pg_temp.mk_emp(pg_temp.emp('adm'),  'W4T-ADM',  pg_temp.emp('sa'),  app.today_myt() - 800);
select pg_temp.mk_emp(pg_temp.emp('mgr'),  'W4T-MGR',  pg_temp.emp('sa'),  app.today_myt() - 700);
select pg_temp.mk_emp(pg_temp.emp('emp1'), 'W4T-EMP1', pg_temp.emp('mgr'), app.today_myt() - 400);
select pg_temp.mk_emp(pg_temp.emp('emp2'), 'W4T-EMP2', pg_temp.emp('sa'),  app.today_myt() - 600, 'male', false, 'KUL');
select pg_temp.mk_emp(pg_temp.emp('emp3'), 'W4T-EMP3', pg_temp.emp('emp1'), app.today_myt() - 300);
select pg_temp.mk_emp(pg_temp.emp('del'),  'W4T-DEL',  pg_temp.emp('sa'),  app.today_myt() - 500);
select pg_temp.mk_emp(pg_temp.emp('vet'),  'W4T-VET',  pg_temp.emp('sa'),  app.today_myt() - 2300, 'male');
select app.rebuild_reporting_closure();
insert into auth.users (id, email, aud, role) select auth_id, 'pret-w4-' || n || '@example.invalid', 'authenticated', 'authenticated' from fx;
insert into app.app_users (auth_user_id, user_type, employee_id, login_email, display_name, status, access_start_date, access_end_date, service_provider)
select f.auth_id, case when f.emp_id is null then 'external' else 'employee' end::app.user_type, f.emp_id, 'pret-w4-' || f.n || '@example.invalid',
       'W4 Test ' || upper(f.n), 'active', app.today_myt() - 30, case f.n when 'ext' then app.today_myt() + 90 end,
       case when f.emp_id is null then 'Example Outsourcing (TEST)' end
  from fx f;
update fx set app_id = u.id from app.app_users u where u.login_email = 'pret-w4-' || fx.n || '@example.invalid';
insert into app.user_roles (user_id, role, granted_by) values (pg_temp.usr('sa'), 'SA', '00000000-0000-0000-0000-000000000001');
insert into app.user_roles (user_id, role, granted_by) select app_id, 'ADM', pg_temp.usr('sa') from fx where n in ('adm','ext');

-- Calendar: publish this year and next (all states), plus a Selangor-only holiday on Wednesday of week W+1
insert into app.holiday_calendar_years (year, state, status)
select y, 'SGR', 'published' from generate_series(extract(year from app.today_myt())::int, extract(year from app.today_myt())::int + 1) y
on conflict (year, state) do update set status = 'published';
-- W = Monday of the week containing today + 14 (always in the future; weekday arithmetic below)
insert into ids (k, id, v) values ('W', null, (date_trunc('week', (app.today_myt() + 14)::timestamp)::date)::text);
with h as (insert into app.public_holidays (year, holiday_date, name, holiday_type) values
           (extract(year from pg_temp.d('W') + 9)::int, pg_temp.d('W') + 9, 'W4 Selangor Test Day', 'state') returning id)
insert into ids select 'hol', id from h;
insert into app.public_holiday_states (holiday_id, state) values (pg_temp.id('hol'), 'SGR');
-- entitlements for both years (the personal-row trigger generated the current year)
select app.generate_entitlements(extract(year from app.today_myt())::int + 1);

-- ===========================================================================
-- A. anon
-- ===========================================================================
do $$ declare e1 text; e2 text; e3 text;
begin
  execute 'set local role anon';
  begin perform 1 from app.leave_applications limit 1; e1 := 'no error'; exception when others then e1 := sqlerrm; end;
  begin perform app.leave_evaluate('{}'::jsonb, false); e2 := 'no error'; exception when others then e2 := sqlerrm; end;
  begin perform 1 from app.approval_tasks limit 1; e3 := 'no error'; exception when others then e3 := sqlerrm; end;
  execute 'reset role';
  perform pg_temp.r('A1 anon cannot read leave applications', e1 like '%permission denied%', e1);
  perform pg_temp.r('A2 anon cannot call the leave engine', e2 like '%permission denied%', e2);
  perform pg_temp.r('A3 anon cannot read approval tasks', e3 like '%permission denied%', e3);
end $$;

-- ===========================================================================
-- B. Engine arithmetic (SQL engine — same PRD examples as tests/unit/w2-004-leave-engine.test.mjs)
-- ===========================================================================
do $$ declare al uuid := (select id from app.leave_types where code = 'AL'); sl uuid := (select id from app.leave_types where code = 'SL');
  c jsonb; v_w date := pg_temp.d('W'); n numeric;
begin
  perform pg_temp.r('B1 rounding: up to ½ (6.016→6.5, 9.76→10.0, 14.02→14.5)',
    app.round_leave(6.016, 'up_half') = 6.5 and app.round_leave(9.76, 'up_half') = 10.0 and app.round_leave(14.02, 'up_half') = 14.5);
  perform pg_temp.r('B2 rounding: nearest / down / Employment Act rule',
    app.round_leave(6.2, 'nearest_half') = 6.0 and app.round_leave(6.3, 'nearest_half') = 6.5 and app.round_leave(6.9, 'down_half') = 6.5
    and app.round_leave(4.5, 'employment_act') = 5 and app.round_leave(4.49, 'employment_act') = 4);
  update app.leave_policy set entitlement_method = 'accrual_pro_rata' where id = 1;
  c := app.compute_entitlement(null, al, 2027, date '2027-07-02', null, date '2025-01-01', date '2025-01-01', null, 'female');
  perform pg_temp.r('B3 US-LEAVE-005 accrual: 12 × 183/365 → earned to date 6.5', (c ->> 'earned_to_date')::numeric = 6.5 and (c ->> 'entitled')::numeric = 12, c::text);
  c := app.compute_entitlement(null, al, 2027, null, null, date '2027-03-10', date '2027-03-10', null, 'female');
  perform pg_temp.r('B4 US-LEAVE-006 joiner 10/03: 12 × 297/365 = 9.76 → 10.0', (c ->> 'entitled')::numeric = 10.0, c::text);
  c := app.compute_entitlement(null, al, 2027, null, null, date '2022-07-01', date '2022-07-01', null, 'female');
  perform pg_temp.r('B5 US-LEAVE-007 band change on 01/07: 12×181/365 + 16×184/365 → 14.5', (c ->> 'entitled')::numeric = 14.5, c::text);
  c := app.compute_entitlement(null, al, 2027, null, date '2027-06-30', date '2025-01-01', date '2025-01-01', null, 'female');
  perform pg_temp.r('B6 US-LEAVE-035 leaver LWD 30/06: 12 × 181/365 → 6.0', (c ->> 'entitled')::numeric = 6.0, c::text);
  c := app.compute_entitlement(null, sl, 2027, null, null, date '2027-03-10', date '2027-03-10', null, 'female');
  perform pg_temp.r('B7 Sick not pro-rated for joiners (LT9 = No): 14.0', (c ->> 'entitled')::numeric = 14.0, c::text);
  c := app.compute_entitlement(null, sl, 2027, null, null, date '2019-01-01', date '2019-01-01', null, 'female');
  perform pg_temp.r('B8 Sick ≥ 5 years: 22.0 (s60F)', (c ->> 'entitled')::numeric = 22.0, c::text);
  update app.leave_policy set prorate_basis = 'by_month' where id = 1;
  c := app.compute_entitlement(null, al, 2027, null, null, date '2027-03-10', date '2027-03-10', null, 'female');
  perform pg_temp.r('B9 by completed month: joiner 10/03 → 9 months × 12/12 = 9.0', (c ->> 'entitled')::numeric = 9.0, c::text);
  update app.leave_policy set prorate_basis = 'by_day', entitlement_method = 'full_pro_rated' where id = 1;
  -- day count by pattern + state holidays (BR-LV-21/22, US-LEAVE-009, EC-LV-01)
  select sum(weight) into n from app.leave_count(pg_temp.emp('emp1'), v_w + 3, 'full', v_w + 7, 'full', 'working_days');
  perform pg_temp.r('B10 Thu–Mon counts 3 working days (Sat off, Sun rest = 0)', n = 3, n::text);
  select sum(weight) into n from app.leave_count(pg_temp.emp('emp1'), v_w + 8, 'full', v_w + 10, 'full', 'working_days');
  perform pg_temp.r('B11 Selangor employee: Tue–Thu over a Selangor holiday = 2', n = 2, n::text);
  select sum(weight) into n from app.leave_count(pg_temp.emp('emp2'), v_w + 8, 'full', v_w + 10, 'full', 'working_days');
  perform pg_temp.r('B12 WP KL employee: same dates = 3 (EC-LV-01)', n = 3, n::text);
  select sum(weight) into n from app.leave_count(pg_temp.emp('emp1'), v_w + 1, 'pm', v_w + 2, 'am', 'working_days');
  perform pg_temp.r('B13 half days: PM + AM = 1.0', n = 1, n::text);
  select sum(weight) into n from app.leave_count(pg_temp.emp('emp1'), v_w + 5, 'full', v_w + 6, 'full', 'calendar_days');
  perform pg_temp.r('B14 calendar-day basis counts the weekend', n = 2, n::text);
end $$;

-- ===========================================================================
-- C. Employee applies (P2) — validations BR-LV-50–58, idempotency, overlap, split
-- ===========================================================================
do $$ declare v_w date := pg_temp.d('W'); e1 uuid := pg_temp.emp('emp1'); res jsonb; res2 jsonb; t text; key uuid := gen_random_uuid(); n int; c jsonb;
  v_y int := extract(year from app.today_myt())::int;
begin
  -- happy path + idempotency (EC-LV-09)
  t := pg_temp.as_user('emp1', 'aal1', format('select app.leave_evaluate(%L::jsonb, true)::text', jsonb_build_object('leave_type_id',
         (select id from app.leave_types where code = 'AL'), 'start_date', v_w, 'end_date', v_w + 4, 'reason', 'Family trip (test)', 'idempotency_key', key)));
  res := t::jsonb;
  insert into ids values ('a1', (res -> 'applications' -> 0 ->> 'id')::uuid, res -> 'applications' -> 0 ->> 'ref_no');
  t := pg_temp.as_user('emp1', 'aal1', format('select app.leave_evaluate(%L::jsonb, true)::text', jsonb_build_object('leave_type_id',
         (select id from app.leave_types where code = 'AL'), 'start_date', v_w, 'end_date', v_w + 4, 'reason', 'Family trip (test)', 'idempotency_key', key)));
  res2 := t::jsonb;
  select count(*) into n from app.leave_applications where idempotency_key = key;
  perform pg_temp.r('C1 EMP submits AL: 5 days, Pending L1 of 2, LV-yyyy-nnnnn', res ->> 'status' = 'pending' and (res ->> 'level')::int = 1
    and (res ->> 'levels')::int = 2 and (res -> 'applications' -> 0 ->> 'days')::numeric = 5 and (res -> 'applications' -> 0 ->> 'ref_no') ~ '^LV-[0-9]{4}-[0-9]{5}$', res::text);
  perform pg_temp.r('C2 double submit with the same key → one application (EC-LV-09)', (res2 ->> 'duplicate')::boolean and n = 1, res2::text || ' n=' || n);
  perform pg_temp.r('C3 level 1 routed to the direct manager',
    (select assignee_user_id from app.approval_tasks where id = pg_temp.open_task(pg_temp.id('a1'))) = pg_temp.usr('mgr'));
  perform pg_temp.r('C4 N-01 notification to the manager', exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('mgr') and event_code = 'N-01'));
  -- overlap (BR-LV-52) and AM + PM halves
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'AL', v_w + 2, v_w + 2))::jsonb;
  perform pg_temp.r('C5 overlapping application blocked (BR-LV-52)', pg_temp.blocks(res) like '%BR-LV-52%', res -> 'blocks' ->> 0);
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.app(null, 'AL', v_w + 7, v_w + 7, 'am', 'am'))::jsonb;
  res2 := pg_temp.as_user('emp1', 'aal1', pg_temp.app(null, 'AL', v_w + 7, v_w + 7, 'pm', 'pm'))::jsonb;
  insert into ids values ('a_am', (res -> 'applications' -> 0 ->> 'id')::uuid, null), ('a_pm', (res2 -> 'applications' -> 0 ->> 'id')::uuid, null);
  perform pg_temp.r('C6 AM and PM halves on the same date are both allowed (0.5 each)',
    (res -> 'applications' -> 0 ->> 'days')::numeric = 0.5 and (res2 -> 'applications' -> 0 ->> 'days')::numeric = 0.5, res::text || res2::text);
  t := pg_temp.as_user('emp1', 'aal1', pg_temp.app(null, 'AL', v_w + 7, v_w + 7));
  perform pg_temp.r('C7 full day on a date with AM+PM already taken is blocked', t::jsonb ->> 'blocks' like '%BR-LV-52%', t);
  -- balance (BR-LV-53), no working days (BR-LV-24), reason (LA10), eligibility (BR-LV-51), years (BR-LV-58), sessions (BR-LV-22)
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'AL', v_w + 14, v_w + 60))::jsonb;
  perform pg_temp.r('C8 not enough balance blocked (BR-LV-53)', pg_temp.blocks(res) like '%BR-LV-53%', res ->> 'blocks');
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'AL', v_w + 5, v_w + 6))::jsonb;
  perform pg_temp.r('C9 weekend only → "No working days in the selected dates." (BR-LV-24)', pg_temp.blocks(res) like '%BR-LV-24%', res ->> 'blocks');
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'AL', v_w + 15, v_w + 15, 'full', 'full', ''))::jsonb;
  perform pg_temp.r('C10 reason required (LT15)', pg_temp.blocks(res) like '%LA10%', res ->> 'blocks');
  res := pg_temp.as_user('emp2', 'aal1', pg_temp.preview(null, 'ML', v_w + 15, v_w + 15))::jsonb;
  perform pg_temp.r('C11 male employee not eligible for Maternity (BR-LV-51)', pg_temp.blocks(res) like '%BR-LV-51%', res ->> 'blocks');
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'AL', make_date(v_y + 2, 3, 2), make_date(v_y + 2, 3, 2)))::jsonb;
  perform pg_temp.r('C12 dates beyond next leave year blocked (BR-LV-58)', pg_temp.blocks(res) like '%BR-LV-58%', res ->> 'blocks');
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'AL', v_w + 15, v_w + 16, 'am', 'full'))::jsonb;
  perform pg_temp.r('C13 multi-day cannot start with AM (BR-LV-22)', pg_temp.blocks(res) like '%BR-LV-22%', res ->> 'blocks');
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'AL', app.today_myt() + 1, app.today_myt() + 1))::jsonb;
  perform pg_temp.r('C14 AL starting within 3 days is flagged EMERGENCY (LP10)', (res ->> 'is_emergency')::boolean, res ->> 'is_emergency');
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'AL', v_w + 21, v_w + 21))::jsonb;
  perform pg_temp.r('C15 10+ days ahead is not flagged', not (res ->> 'is_emergency')::boolean, res ->> 'is_emergency');
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'SL', v_w + 21, v_w + 21))::jsonb;
  perform pg_temp.r('C16 sick leave without MC blocked: "Medical certificate required." (BR-LV-57)', pg_temp.blocks(res) like '%BR-LV-57%', res ->> 'blocks');
  -- back-dated sick leave beyond the window (BR-LV-54): EMP blocked
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'SL', app.working_days_back(e1, app.today_myt(), 10), app.working_days_back(e1, app.today_myt(), 10),
            'full', 'full', 'Unwell (test)', jsonb_build_object('attachment_count', 1)))::jsonb;
  perform pg_temp.r('C17 sick leave 10 working days back is blocked for the employee (BR-LV-54)', pg_temp.blocks(res) like '%BR-LV-54%', res ->> 'blocks');
  -- maternity end date fixed (BR-LV-23) — female employee
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.preview(null, 'ML', v_w + 30, v_w + 30, 'full', 'full', 'Confinement (test)',
            jsonb_build_object('expected_confinement_date', v_w + 40, 'attachment_count', 1)))::jsonb;
  perform pg_temp.r('C18 maternity: end = start + 97, 98 calendar days, read-only', (res ->> 'end_date')::date = v_w + 30 + 97
    and (res ->> 'days')::numeric = 98 and (res ->> 'end_fixed')::boolean, (res ->> 'end_date') || ' ' || (res ->> 'days'));
  -- cross-year split (BR-LV-25) with Unpaid leave (cap 12 / year, no accrual)
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.app(null, 'UL', make_date(v_y, 12, 28), make_date(v_y + 1, 1, 5)))::jsonb;
  insert into ids values ('split1', (res -> 'applications' -> 0 ->> 'id')::uuid, null), ('split2', (res -> 'applications' -> 1 ->> 'id')::uuid, null);
  perform pg_temp.r('C19 31/12 range split into two linked applications …-1 / …-2 (BR-LV-25)',
    jsonb_array_length(res -> 'applications') = 2 and (res -> 'applications' -> 0 ->> 'ref_no') like '%-1' and (res -> 'applications' -> 1 ->> 'ref_no') like '%-2'
    and (select count(distinct split_group_id) from app.leave_applications where id in (pg_temp.id('split1'), pg_temp.id('split2'))) = 1, res::text);
  -- EMP cannot apply for someone else; cannot insert applications directly
  t := pg_temp.as_user('emp1', 'aal1', pg_temp.app(pg_temp.emp('emp2'), 'AL', v_w + 22, v_w + 22));
  perform pg_temp.r('C20 EMP cannot apply on behalf of another employee', t like 'ERR:%PRET-ACC-403%', t);
  t := pg_temp.as_user('emp1', 'aal1', format('insert into app.leave_applications (ref_no, employee_id, leave_type_id, leave_year, start_date, start_session, end_date, end_session, days, workflow_id) values (''X'', %L, %L, 2026, %L, ''full'', %L, ''full'', 1, %L) returning id::text',
       e1, (select id from app.leave_types where code = 'AL'), v_w + 23, v_w + 23, '00000000-0000-4000-8000-00000000f001'));
  perform pg_temp.r('C21 EMP cannot insert applications directly (definer path only)', t like 'ERR:%permission denied%', t);
end $$;

-- ===========================================================================
-- D. Manager / ADM decisions — visibility, levels, ledger, MFA, external ADM
-- ===========================================================================
do $$ declare v_w date := pg_temp.d('W'); a1 uuid := pg_temp.id('a1'); t text; tk uuid; res jsonb; c1 int; c2 int; c3 int; c4 int; c5 int; v_e2 uuid;
begin
  res := pg_temp.as_user('emp2', 'aal1', pg_temp.app(null, 'AL', v_w + 1, v_w + 1))::jsonb;
  v_e2 := (res -> 'applications' -> 0 ->> 'id')::uuid; insert into ids values ('e2app', v_e2, null);
  res := pg_temp.as_user('emp3', 'aal1', pg_temp.app(null, 'AL', v_w + 2, v_w + 2))::jsonb;
  insert into ids values ('e3app', (res -> 'applications' -> 0 ->> 'id')::uuid, null);
  c1 := pg_temp.as_user('mgr', 'aal1', format('select count(*) from app.leave_applications where id = %L', a1))::int;
  c2 := pg_temp.as_user('mgr', 'aal1', format('select count(*) from app.leave_applications where id = %L', v_e2))::int;
  c3 := pg_temp.as_user('mgr', 'aal1', format('select count(*) from app.leave_applications where id = %L', pg_temp.id('e3app')))::int;
  c4 := pg_temp.as_user('emp2', 'aal1', format('select count(*) from app.leave_applications where id = %L', a1))::int;
  perform pg_temp.r('D1 MGR sees direct + indirect reportees'' leave, not others''', c1 = 1 and c3 = 1 and c2 = 0, c1 || '/' || c3 || '/' || c2);
  perform pg_temp.r('D2 EMP cannot see a colleague''s application', c4 = 0, c4::text);
  -- MGR cannot decide emp2's (not routed); decides emp1's level 1 → moves to Admin
  t := pg_temp.decide('mgr', 'aal1', pg_temp.open_task(v_e2), 'approve');
  perform pg_temp.r('D3 MGR cannot decide a non-reportee''s item', t like 'ERR:%', t);
  t := pg_temp.decide('mgr', 'aal1', pg_temp.open_task(a1), 'reject', null);
  perform pg_temp.r('D4 reject without a comment is blocked', t like 'ERR:%PRET-TASK-COMMENT%', t);
  tk := pg_temp.open_task(a1);
  t := pg_temp.decide('mgr', 'aal1', tk, 'approve', 'OK');
  perform pg_temp.r('D5 MGR approves L1 → moved to level 2 (Any Admin)', t::jsonb ->> 'outcome' = 'moved_to_next'
    and (select current_level from app.leave_applications where id = a1) = 2
    and (select source::text from app.approval_tasks where id = pg_temp.open_task(a1)) = 'admin_pool', t);
  t := pg_temp.as_user('mgr', 'aal1', format('select app.decide_task(%L, ''approve'', null, 1, false)::text', tk));
  perform pg_temp.r('D6 a decided task cannot be decided again (first decision wins)', t like 'ERR:%PRET-TASK-DECIDED%', t);
  t := pg_temp.decide('adm', 'aal1', pg_temp.open_task(a1), 'approve');
  perform pg_temp.r('D7 ADM at aal1 is not an Admin (MFA) — cannot decide the Admin level', t like 'ERR:%', t);
  t := pg_temp.decide('adm', 'aal2', pg_temp.open_task(a1), 'approve', 'Approved');
  perform pg_temp.r('D8 ADM (aal2) approves L2 → Approved', t::jsonb ->> 'outcome' = 'approved' and (select status::text from app.leave_applications where id = a1) = 'approved', t);
  perform pg_temp.r('D9 ledger: one "taken −5.0" row; summary taken 5.0',
    (select sum(days) from app.leave_ledger where source_application_id = a1) = -5
    and (select taken from app.leave_balance_summary where employee_id = pg_temp.emp('emp1') and leave_type_id = (select id from app.leave_types where code = 'AL')
          and leave_year = extract(year from v_w)::int) >= 5);
  perform pg_temp.r('D10 N-02 approved notification to the employee', exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp1') and event_code = 'N-02'));
  -- ledger is T2: never MGR (F-LV-28); summary is T1
  c1 := pg_temp.as_user('mgr', 'aal1', format('select count(*) from app.leave_ledger where employee_id = %L', pg_temp.emp('emp1')))::int;
  c2 := pg_temp.as_user('mgr', 'aal1', format('select count(*) from app.leave_balance_summary where employee_id = %L', pg_temp.emp('emp1')))::int;
  c3 := pg_temp.as_user('mgr', 'aal1', format('select count(*) from app.leave_balance_summary where employee_id = %L', pg_temp.emp('emp2')))::int;
  c4 := pg_temp.as_user('emp1', 'aal1', format('select count(*) from app.leave_ledger where employee_id = %L', pg_temp.emp('emp1')))::int;
  c5 := pg_temp.as_user('ext', 'aal2', format('select count(*) from app.leave_ledger where employee_id = %L', pg_temp.emp('emp1')))::int;
  perform pg_temp.r('D11 MGR cannot read a reportee''s ledger (F-LV-28)', c1 = 0, c1::text);
  perform pg_temp.r('D12 MGR reads team balance summary, not others''', c2 > 0 and c3 = 0, c2 || '/' || c3);
  perform pg_temp.r('D13 EMP reads own ledger', c4 > 0, c4::text);
  perform pg_temp.r('D14 external ADM (aal2) reads all ledgers', c5 > 0, c5::text);
  -- employee cancels approved future leave (LT30) → days restored
  t := pg_temp.as_user('emp1', 'aal1', format('select app.cancel_leave(%L, null, false)::text', a1));
  perform pg_temp.r('D15 EMP cancels future approved leave → Cancelled, ledger net 0',
    (select status::text from app.leave_applications where id = a1) = 'cancelled' and (select sum(days) from app.leave_ledger where source_application_id = a1) = 0, t);
  perform pg_temp.r('D16 cancelled days no longer block (is_blocking false)',
    not exists (select 1 from app.leave_application_days where application_id = a1 and is_blocking));
  -- withdraw pending
  t := pg_temp.as_user('emp2', 'aal1', format('select app.withdraw_leave(%L, null, false)::text', v_e2));
  perform pg_temp.r('D17 EMP withdraws pending → Withdrawn, open task closed', (select status::text from app.leave_applications where id = v_e2) = 'withdrawn'
    and pg_temp.open_task(v_e2) is null, t);
  t := pg_temp.as_user('emp1', 'aal1', format('select app.withdraw_leave(%L, null, false)::text', pg_temp.id('e3app')));
  perform pg_temp.r('D18 EMP cannot withdraw a reportee''s leave', t like 'ERR:%', t);
  -- direct writes to tasks are impossible
  t := pg_temp.as_user('mgr', 'aal1', format('update app.approval_tasks set status = ''approved'' where id = %L returning id::text', pg_temp.open_task(pg_temp.id('e3app'))));
  perform pg_temp.r('D19 no direct UPDATE on approval_tasks (definer only)', t like 'ERR:%permission denied%', t);
end $$;

-- ===========================================================================
-- E. No self-approval (rls §7) — ADM own leave, SA top of organisation (Q11), delegate, table CHECK
-- ===========================================================================
do $$ declare v_w date := pg_temp.d('W'); res jsonb; t text; v_app uuid; v_sa uuid; v_e2 uuid; v_first record;
begin
  res := pg_temp.as_user('adm', 'aal2', pg_temp.app(null, 'AL', v_w + 3, v_w + 3))::jsonb;
  v_app := (res -> 'applications' -> 0 ->> 'id')::uuid; insert into ids values ('adm_app', v_app, null);
  perform pg_temp.r('E1 ADM''s own leave L1 goes to their manager (SA)', (select assignee_user_id from app.approval_tasks where id = pg_temp.open_task(v_app)) = pg_temp.usr('sa'));
  t := pg_temp.decide('adm', 'aal2', pg_temp.open_task(v_app), 'approve', 'Self', true);
  perform pg_temp.r('E2 ADM cannot decide own leave even as Admin override', t like 'ERR:%PRET-SELF-001%', t);
  t := pg_temp.decide('sa', 'aal2', pg_temp.open_task(v_app), 'approve');
  t := pg_temp.decide('adm', 'aal2', pg_temp.open_task(v_app), 'approve');
  perform pg_temp.r('E3 at the Admin level the applicant ADM still cannot act (EC-LV-06)', t like 'ERR:%PRET-SELF-001%', t);
  t := pg_temp.decide('ext', 'aal2', pg_temp.open_task(v_app), 'approve');
  perform pg_temp.r('E4 another Admin (external ADM) approves → Approved', (select status::text from app.leave_applications where id = v_app) = 'approved', t);
  -- SA top of organisation (Q11): level 1 auto-approved and recorded, Admin level as normal
  res := pg_temp.as_user('sa', 'aal2', pg_temp.app(null, 'AL', v_w + 4, v_w + 4))::jsonb;
  v_sa := (res -> 'applications' -> 0 ->> 'id')::uuid;
  select * into v_first from app.approval_tasks where leave_application_id = v_sa and level = 1;
  perform pg_temp.r('E5 SA (top of organisation) own leave: L1 recorded as system auto (Q11), L2 open at Admin',
    v_first.status = 'approved' and v_first.acting_as = 'system_auto' and (select source::text from app.approval_tasks where id = pg_temp.open_task(v_sa)) = 'admin_pool', res::text);
  t := pg_temp.decide('sa', 'aal2', pg_temp.open_task(v_sa), 'approve');
  perform pg_temp.r('E6 SA cannot approve own leave at the Admin level', t like 'ERR:%PRET-SELF-001%', t);
  -- delegate cannot approve their own item (BR-LV-60): emp2 delegate of SA; emp2's own leave goes to SA
  insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
  values (pg_temp.usr('sa'), pg_temp.usr('emp2'), app.today_myt(), app.today_myt() + 5, 'leave', pg_temp.usr('sa'));
  res := pg_temp.as_user('emp2', 'aal1', pg_temp.app(null, 'AL', v_w + 8, v_w + 8))::jsonb;
  v_e2 := (res -> 'applications' -> 0 ->> 'id')::uuid;
  t := pg_temp.decide('emp2', 'aal1', pg_temp.open_task(v_e2), 'approve');
  perform pg_temp.r('E7 delegate cannot approve their own leave (FR-G-16)', t like 'ERR:%PRET-SELF-001%', t);
  perform pg_temp.r('E8 can_act_on_task false for the subject in every role', pg_temp.as_user('emp2', 'aal1', format('select app.can_act_on_task(%L)::text', pg_temp.open_task(v_e2))) = 'false');
  -- table CHECK (layer 4)
  t := pg_temp.err(format('insert into app.approval_tasks (subject_type, leave_application_id, subject_employee_id, level, source, status, decided_by_employee_id, acting_as)
                          values (''leave_application'', %L, %L, 3, ''admin_pool'', ''cancelled'', %L, ''system_auto'')', v_e2, pg_temp.emp('emp2'), pg_temp.emp('emp2')));
  perform pg_temp.r('E9 CHECK chk_not_self_decision rejects decider = subject', t like '%chk_not_self_decision%', t);
  -- transition guard (layer 5): a direct status change by the applicant is refused even as postgres-with-session
  perform pg_temp.login((select auth_id from fx where n = 'emp2'));
  execute 'reset role';
  t := pg_temp.err(format('update app.leave_applications set status = ''approved'' where id = %L', v_e2));
  perform pg_temp.logout();
  perform pg_temp.r('E10 transition trigger refuses the applicant''s own approval', t like '%PRET-SELF-001%', t);
end $$;


-- ===========================================================================
-- F. Delegation, re-routing (BR-LV-60/61), HR reassign (L14)
-- ===========================================================================
do $$ declare v_w date := pg_temp.d('W'); res jsonb; t text; v_app uuid; v_task record; v_n int;
begin
  insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
  values (pg_temp.usr('mgr'), pg_temp.usr('del'), app.today_myt(), app.today_myt() + 5, 'both', pg_temp.usr('mgr'));
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.app(null, 'AL', v_w + 15, v_w + 15))::jsonb;
  v_app := (res -> 'applications' -> 0 ->> 'id')::uuid; insert into ids values ('deleg_app', v_app, null);
  v_n := pg_temp.as_user('del', 'aal1', format('select count(*) from app.leave_applications where id = %L', v_app))::int;
  perform pg_temp.r('F1 delegate sees the routed item (is_current_approver_for)', v_n = 1, v_n::text);
  perform pg_temp.r('F2 delegate notified (N-01)', exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('del') and event_code = 'N-01'));
  t := pg_temp.decide('del', 'aal1', pg_temp.open_task(v_app), 'approve', 'As delegate');
  perform pg_temp.r('F3 delegate decides as "Delegate"', (select acting_as::text from app.approval_tasks where leave_application_id = v_app and level = 1) = 'delegate', t);
  -- approver on approved leave today without a delegate → manager's manager (emp1 → mgr)
  insert into app.leave_applications (id, ref_no, employee_id, leave_type_id, leave_year, start_date, start_session, end_date, end_session, days, status, workflow_id, total_levels)
  values ('00000000-0000-4000-8000-0000000004f1', 'LV-TEST-ONLEAVE', pg_temp.emp('emp1'), (select id from app.leave_types where code = 'AL'),
          extract(year from app.today_myt())::int, app.today_myt(), 'full', app.today_myt(), 'full', 1, 'approved', '00000000-0000-4000-8000-00000000f001', 2);
  insert into app.leave_application_days (application_id, employee_id, leave_date, session, weight, day_kind, day_label, leave_year)
  values ('00000000-0000-4000-8000-0000000004f1', pg_temp.emp('emp1'), app.today_myt(), 'full', 1, 'working', 'Working day', extract(year from app.today_myt())::int);
  res := pg_temp.as_user('emp3', 'aal1', pg_temp.app(null, 'AL', v_w + 16, v_w + 16))::jsonb;
  v_app := (res -> 'applications' -> 0 ->> 'id')::uuid;
  select * into v_task from app.approval_tasks where id = pg_temp.open_task(v_app);
  perform pg_temp.r('F4 approver on leave without delegate → routed to their manager, trail "Re-routed: approver on leave" (BR-LV-61)',
    v_task.assignee_user_id = pg_temp.usr('mgr') and v_task.original_assignee_user_id = pg_temp.usr('emp1') and v_task.routing_note like 'Re-routed: approver on leave%',
    coalesce(v_task.routing_note, '') || ' ' || coalesce(v_task.assignee_user_id::text, ''));
  -- HR reassign (L14): from mgr to del; preview then run
  v_n := (select count(*) from pg_temp.as_user('adm', 'aal2', format('select count(*) from app.reassign_tasks(%L, %L, array[''leave_application'']::app.task_subject[], ''Reassigned for the test'', false)',
           pg_temp.usr('mgr'), pg_temp.usr('del'))) x);
  perform pg_temp.r('F5 HR reassigns open items to another approver (trail "Reassigned by HR")',
    (select assignee_user_id from app.approval_tasks where id = pg_temp.open_task(v_app)) = pg_temp.usr('del')
    and (select routing_note from app.approval_tasks where id = pg_temp.open_task(v_app)) like 'Reassigned by HR%');
  t := pg_temp.as_user('mgr', 'aal1', format('select count(*) from app.reassign_tasks(%L, %L, array[''leave_application'']::app.task_subject[], ''Reassigned for the test'', false)',
         pg_temp.usr('del'), pg_temp.usr('mgr')));
  perform pg_temp.r('F6 only ADM/SA can reassign', t like 'ERR:%PRET-ACC-403%', t);
  -- reporting line change re-routes open direct-manager items (BR-LV-61)
  update app.employees set manager_employee_id = pg_temp.emp('sa') where id = pg_temp.emp('emp3');
  perform pg_temp.r('F7 manager change re-routes the open item to the new manager',
    (select assignee_user_id from app.approval_tasks where id = pg_temp.open_task(v_app)) = pg_temp.usr('sa'));
  update app.employees set manager_employee_id = pg_temp.emp('emp1') where id = pg_temp.emp('emp3');
end $$;

-- ===========================================================================
-- G. HR on behalf (L2), back-date window, MC access (Q18), cancellation request flow
-- ===========================================================================
do $$ declare e1 uuid := pg_temp.emp('emp1'); v_day date; v_file uuid := gen_random_uuid(); res jsonb; t text; v_app uuid; c1 text; c2 text; c3 text;
begin
  v_day := app.working_days_back(e1, app.today_myt(), 10);
  insert into app.files (id, bucket, storage_path, subject, owner_employee_id, data_category, original_name, mime_type, size_bytes, status, created_by)
  values (v_file, 'leave-files', 'emp/' || e1 || '/leave/w4/' || v_file || '.pdf', 'leave_attachment', e1, 'health', 'mc.pdf', 'application/pdf', 1000, 'active', pg_temp.usr('adm'));
  t := pg_temp.as_user('adm', 'aal2', pg_temp.app(e1, 'SL', v_day, v_day, 'full', 'full', 'Hospitalised (test)',
         jsonb_build_object('on_behalf_reason', 'Employee was hospitalised (test)', 'attachment_file_ids', jsonb_build_array(v_file))));
  res := t::jsonb; v_app := (res -> 'applications' -> 0 ->> 'id')::uuid; insert into ids values ('onbehalf', v_app, null);
  perform pg_temp.r('G1 HR applies sick leave on behalf beyond the back-date window (recorded, flagged)',
    (select on_behalf_by from app.leave_applications where id = v_app) = pg_temp.usr('adm')
    and (select beyond_backdate_window and is_emergency from app.leave_applications where id = v_app), t);
  perform pg_temp.r('G2 N-09 to the employee for leave applied on behalf', exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp1') and event_code = 'N-09'));
  t := pg_temp.as_user('adm', 'aal2', pg_temp.app(e1, 'SL', v_day, v_day, 'full', 'full', 'x', jsonb_build_object('on_behalf_reason', 'short')));
  perform pg_temp.r('G3 on-behalf reason ≥ 10 characters required', t::jsonb ->> 'blocks' like '%FR-G-17%', t);
  t := pg_temp.as_user('adm', 'aal2', pg_temp.app(pg_temp.emp('adm'), 'AL', pg_temp.d('W') + 18, pg_temp.d('W') + 18, 'full', 'full', 'Own (test)',
         jsonb_build_object('on_behalf_reason', 'Not allowed on own record')));
  perform pg_temp.r('G4 own record is not "on behalf" (normal own application)', (t::jsonb -> 'applications' -> 0 ->> 'id') is not null
    and (select on_behalf_by from app.leave_applications where id = (t::jsonb -> 'applications' -> 0 ->> 'id')::uuid) is null, t);
  -- MC visible to the approving manager only while they can decide (Q18)
  c1 := pg_temp.as_user('mgr', 'aal1', format('select app.can_read_file(%L)::text', v_file));
  c2 := pg_temp.as_user('emp2', 'aal1', format('select app.can_read_file(%L)::text', v_file));
  t := pg_temp.decide('del', 'aal1', pg_temp.open_task(v_app), 'approve');
  if t like 'ERR%' then t := pg_temp.decide('mgr', 'aal1', pg_temp.open_task(v_app), 'approve'); end if;
  c3 := pg_temp.as_user('mgr', 'aal1', format('select app.can_read_file(%L)::text', v_file));
  perform pg_temp.r('G5 approving manager can open the MC while deciding; a peer cannot', c1 = 'true' and c2 = 'false', c1 || '/' || c2);
  perform pg_temp.r('G6 manager loses MC access once their level is decided', c3 = 'false', c3);
  t := pg_temp.decide('ext', 'aal2', pg_temp.open_task(v_app), 'approve');
  perform pg_temp.r('G7 back-dated on-behalf SL approved by Admin', (select status::text from app.leave_applications where id = v_app) = 'approved', t);
  -- MC verification (F-LV-26)
  t := pg_temp.as_user('adm', 'aal2', format('select app.set_leave_mc_status(%L, ''invalid'', ''Unreadable copy'')::text', v_app));
  perform pg_temp.r('G8 HR marks MC invalid → N-14 to the employee', (select mc_status::text from app.leave_applications where id = v_app) = 'invalid'
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp1') and event_code = 'N-14'), t);
  -- leave in the past: employee cannot self-cancel, requests cancellation → approver decides (§6.10)
  t := pg_temp.as_user('emp1', 'aal1', format('select app.cancel_leave(%L, null, false)::text', v_app));
  perform pg_temp.r('G9 started/past leave cannot be self-cancelled', t like 'ERR:%PRET-LV-CANCEL-REQUEST%', t);
  t := pg_temp.as_user('emp1', 'aal1', format('select app.request_leave_cancellation(%L, ''Recovered the same day (test)'')::text', v_app));
  perform pg_temp.r('G10 cancellation request → Cancellation pending, routed (N-05)', (select status::text from app.leave_applications where id = v_app) = 'cancellation_pending'
    and pg_temp.open_task(v_app, 'leave_cancellation') is not null, t);
  t := pg_temp.decide('emp1', 'aal1', pg_temp.open_task(v_app, 'leave_cancellation'), 'approve');
  perform pg_temp.r('G11 the applicant cannot approve their own cancellation', t like 'ERR:%PRET-SELF-001%', t);
  t := pg_temp.decide('ext', 'aal2', pg_temp.open_task(v_app, 'leave_cancellation'), 'approve', 'Approved (test)', true);
  perform pg_temp.r('G12 cancellation approved → Cancelled, ledger net 0', (select status::text from app.leave_applications where id = v_app) = 'cancelled'
    and (select sum(days) from app.leave_ledger where source_application_id = v_app) = 0, t);
end $$;

-- ===========================================================================
-- H. Ledger arithmetic — adjustments (FR-LV-11), pool (BR-LV-31), carry-forward FIFO, credits FIFO (BR-LV-81), recount (BR-LV-27)
-- ===========================================================================
do $$ declare v_y int := extract(year from app.today_myt())::int; al uuid := (select id from app.leave_types where code = 'AL'); t text; b jsonb; b2 jsonb;
  v_w date := pg_temp.d('W'); v_sun date; res jsonb; v_cr uuid; v_app uuid; v_n numeric;
begin
  b := app.leave_balance(pg_temp.emp('emp2'), al, v_y);
  t := pg_temp.as_user('adm', 'aal2', format('insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, reason, created_by) values (%L, %L, %s, ''adjustment'', 1.5, app.today_myt(), ''Correction per policy (test)'', app.current_app_user_id()) returning id::text',
         pg_temp.emp('emp2'), al, v_y));
  b2 := app.leave_balance(pg_temp.emp('emp2'), al, v_y);
  perform pg_temp.r('H1 HR adjustment +1.5 → balance +1.5, N-10 to the employee', (b2 ->> 'balance')::numeric = (b ->> 'balance')::numeric + 1.5
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp2') and event_code = 'N-10'), t);
  t := pg_temp.as_user('adm', 'aal2', format('insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, reason, created_by) values (%L, %L, %s, ''adjustment'', 1, app.today_myt(), ''Own record attempt (test)'', app.current_app_user_id()) returning id::text',
         pg_temp.emp('adm'), al, v_y));
  perform pg_temp.r('H2 HR cannot adjust their own balance (FR-G-16)', t like 'ERR:%', t);
  t := pg_temp.as_user('adm', 'aal2', format('insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, reason, created_by) values (%L, %L, %s, ''adjustment'', 1, app.today_myt(), ''short'', app.current_app_user_id()) returning id::text',
         pg_temp.emp('emp2'), al, v_y));
  perform pg_temp.r('H3 adjustment reason < 10 characters refused', t like 'ERR:%chk_adjust_reason%', t);
  t := pg_temp.as_user('adm', 'aal2', format('insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, reason, created_by) values (%L, %L, %s, ''adjustment'', 0.3, app.today_myt(), ''Odd step (test)'', app.current_app_user_id()) returning id::text',
         pg_temp.emp('emp2'), al, v_y));
  perform pg_temp.r('H4 adjustments are in ½-day steps', t like 'ERR:%chk_half_steps%', t);
  t := pg_temp.as_user('emp1', 'aal1', format('insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, reason, created_by) values (%L, %L, %s, ''adjustment'', 5, app.today_myt(), ''Give myself days'', app.current_app_user_id()) returning id::text',
         pg_temp.emp('emp1'), al, v_y));
  perform pg_temp.r('H5 EMP cannot write the ledger', t like 'ERR:%', t);
  t := pg_temp.as_user('adm', 'aal2', format('update app.leave_ledger set days = 9 where employee_id = %L returning id::text', pg_temp.emp('emp2')));
  perform pg_temp.r('H6 ledger is append-only (no UPDATE)', t like 'ERR:%permission denied%', t);
  -- pool: ≥ 5 years, 22 days SL taken → HL available 38 (EC-LV-08)
  insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, is_opening, reason)
  values (pg_temp.emp('vet'), (select id from app.leave_types where code = 'SL'), v_y, 'taken', -22, make_date(v_y, 1, 2), true, 'Opening balance (test)');
  b := app.leave_balance(pg_temp.emp('vet'), (select id from app.leave_types where code = 'HL'), v_y);
  perform pg_temp.r('H7 HL available = 60 − 22 = 38 (BR-LV-31 pool)', (b ->> 'available')::numeric = 38, b::text);
  b := app.leave_balance(pg_temp.emp('vet'), (select id from app.leave_types where code = 'SL'), v_y);
  perform pg_temp.r('H8 SL ≥ 5 years exhausted: available 0 of 22', (b ->> 'entitled')::numeric = 22 and (b ->> 'available')::numeric = 0, b::text);
  res := pg_temp.as_user('vet', 'aal1', pg_temp.preview(null, 'SL', v_w + 1, v_w + 1, 'full', 'full', 'Unwell (test)', jsonb_build_object('attachment_count', 1)))::jsonb;
  perform pg_temp.r('H9 SL used up → "Sick leave for … is used up" (BR-LV-30)', pg_temp.blocks(res) like '%BR-LV-30%', res ->> 'blocks');
  -- carry-forward FIFO projection: CF 5 expiring tomorrow is unusable for leave dated after it
  insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, expires_on, reason)
  values (pg_temp.emp('emp2'), al, v_y, 'carry_forward', 5, make_date(v_y, 1, 1), app.today_myt() + 1, 'Carried forward (test)');
  b := app.leave_balance(pg_temp.emp('emp2'), al, v_y, app.today_myt());
  b2 := app.leave_balance(pg_temp.emp('emp2'), al, v_y, app.today_myt() + 5);
  perform pg_temp.r('H10 CF usable before its expiry, not after (Q-ARCH-03)', (b ->> 'available')::numeric - (b2 ->> 'available')::numeric = 5, b::text || ' / ' || b2::text);
  -- replacement credit: rest day, approved by the manager (Direct Manager only), FIFO consumption
  v_sun := app.today_myt() - extract(isodow from app.today_myt())::int % 7;          -- most recent Sunday (today if Sunday)
  t := pg_temp.as_user('emp1', 'aal1', format('select app.request_credit(%L, %L, ''full_day'', ''Weekend deployment (test)'', null, %L)::text', pg_temp.emp('emp1'), v_sun, gen_random_uuid()));
  v_cr := (t::jsonb ->> 'id')::uuid;
  perform pg_temp.r('H11 credit for a rest day → RL-yyyy-nnnnn, Pending, routed to the manager',
    (t::jsonb ->> 'credit_no') ~ '^RL-[0-9]{4}-[0-9]{5}$' and (select assignee_user_id from app.approval_tasks where id = pg_temp.open_task(v_cr, 'replacement_credit')) = pg_temp.usr('mgr'), t);
  t := pg_temp.as_user('emp1', 'aal1', format('select app.request_credit(%L, %L, ''full_day'', ''Again (test)'', null, %L)::text', pg_temp.emp('emp1'), v_sun, gen_random_uuid()));
  perform pg_temp.r('H12 one credit per date worked (BR-LV-80)', t like 'ERR:%PRET-RL-DUPLICATE%', t);
  t := pg_temp.as_user('emp1', 'aal1', format('select app.request_credit(%L, %L, ''full_day'', ''Weekday (test)'', null, %L)::text', pg_temp.emp('emp1'), v_sun - 2, gen_random_uuid()));
  perform pg_temp.r('H13 a normal working day is refused', t like 'ERR:%PRET-RL-WORKING-DAY%', t);
  t := pg_temp.decide('mgr', 'aal1', pg_temp.open_task(v_cr, 'replacement_credit'), 'approve');
  perform pg_temp.r('H14 approved credit: +1.0 credit_earned, expiry = date worked + 90 (Q16)',
    (select remaining_days from app.replacement_credits where id = v_cr) = 1 and (select expiry_date from app.replacement_credits where id = v_cr) = v_sun + 90
    and exists (select 1 from app.leave_ledger where source_credit_id = v_cr and entry_type = 'credit_earned' and days = 1), t);
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.app(null, 'RL', v_w + 22, v_w + 22))::jsonb;
  v_app := (res -> 'applications' -> 0 ->> 'id')::uuid;
  t := pg_temp.decide('mgr', 'aal1', pg_temp.open_task(v_app), 'approve');
  if pg_temp.open_task(v_app) is not null then t := pg_temp.decide('ext', 'aal2', pg_temp.open_task(v_app), 'approve'); end if;
  perform pg_temp.r('H15 RL leave consumes the earliest-expiring credit (BR-LV-81)',
    (select remaining_days from app.replacement_credits where id = v_cr) = 0
    and exists (select 1 from app.replacement_credit_consumptions where credit_id = v_cr and application_id = v_app and days = 1), t);
  insert into ids values ('rl_app', v_app, null);
  -- recount when a holiday is declared on approved leave (BR-LV-27, EC-LV-02)
  res := pg_temp.as_user('emp1', 'aal1', pg_temp.app(null, 'AL', v_w + 23, v_w + 23))::jsonb;
  v_app := (res -> 'applications' -> 0 ->> 'id')::uuid;
  t := pg_temp.decide('mgr', 'aal1', pg_temp.open_task(v_app), 'approve');
  t := pg_temp.decide('ext', 'aal2', pg_temp.open_task(v_app), 'approve');
  with h as (insert into app.public_holidays (year, holiday_date, name, holiday_type) values (extract(year from v_w + 23)::int, v_w + 23, 'W4 Declared Day', 'special') returning id)
  insert into app.public_holiday_states (holiday_id, state) select id, 'SGR' from h;
  select coalesce(sum(days), 0) into v_n from app.leave_ledger where source_application_id = v_app;
  perform pg_temp.r('H16 special holiday on approved leave → recounted to 0, day restored, N-06',
    (select days from app.leave_applications where id = v_app) = 0 and v_n = 0
    and exists (select 1 from app.notifications where recipient_user_id = pg_temp.usr('emp1') and event_code = 'N-06' and title like 'Leave recounted%'),
    (select days from app.leave_applications where id = v_app)::text || ' ledger ' || v_n);
  -- team calendar: peer sees "on leave" without type; not the application
  perform pg_temp.r('H17 peer (EMP) sees colleague''s approved leave in the calendar projection, not the application',
    pg_temp.as_user('emp2', 'aal1', format('select count(*) from app.team_calendar_entries where application_id = %L', pg_temp.id('rl_app')))::int = 1
    and pg_temp.as_user('emp2', 'aal1', format('select count(*) from app.leave_applications where id = %L', pg_temp.id('rl_app')))::int = 0);
end $$;

-- ===========================================================================
-- I. Configuration guards — BR-LV-01, BR-LV-02 (SA override), bands, overrides (F-LV-31), opening balances (F-LV-35)
-- ===========================================================================
do $$ declare t text; ml uuid := (select id from app.leave_types where code = 'ML'); sl uuid := (select id from app.leave_types where code = 'SL');
  al uuid := (select id from app.leave_types where code = 'AL'); v_y int := extract(year from app.today_myt())::int; b jsonb;
begin
  t := pg_temp.as_user('adm', 'aal2', format('update app.leave_types set days_per_occurrence = 60 where id = %L returning id::text', ml));
  perform pg_temp.r('I1 Maternity 60 days blocked: below Employment Act minimum (US-LEAVE-002)', t like 'ERR:%PRET-LV-FLOOR%', t);
  t := pg_temp.as_user('emp1', 'aal1', format('update app.leave_types set days_per_occurrence = 99 where id = %L returning id::text', ml));
  perform pg_temp.r('I2 EMP cannot change leave types', t like 'ERR:%' or t = '', t);
  perform pg_temp.login((select auth_id from fx where n = 'sa'), 'aal2');
  insert into app.statutory_floor_overrides (leave_type_id, detail, reason, approved_by) values (ml, 'Maternity 97 days (test)', 'Test override reason', app.current_app_user_id());
  update app.leave_types set days_per_occurrence = 97 where id = ml;
  perform pg_temp.logout();
  perform pg_temp.r('I3 SA saves below the minimum with a logged override reason', (select days_per_occurrence from app.leave_types where id = ml) = 97);
  t := pg_temp.as_user('adm', 'aal2', format('update app.leave_types set is_active = false where id = %L returning id::text', sl));
  perform pg_temp.r('I4 Sick Leave cannot be deactivated while employees are eligible (BR-LV-01)', t like 'ERR:%PRET-LV-STATUTORY-ACTIVE%', t);
  t := pg_temp.as_user('adm', 'aal2', format('set constraints all immediate; insert into app.leave_entitlement_bands (leave_type_id, effective_year, service_from_years, service_to_years, days_per_year) values (%L, 2099, 0, null, 10) returning id::text', sl));
  perform pg_temp.r('I5 band below the statutory minimum (SL 10 < 14) blocked (BR-LV-02)', t like 'ERR:%PRET-LV-FLOOR%', t);
  t := pg_temp.as_user('adm', 'aal2', format('set constraints all immediate; insert into app.leave_entitlement_bands (leave_type_id, effective_year, service_from_years, service_to_years, days_per_year) values (%L, 2098, 1, null, 30) returning id::text', al));
  perform pg_temp.r('I6 bands must start at 0 with no gaps', t like 'ERR:%PRET-LV-BANDS%', t);
  -- F-LV-31 override: 18 days AL for emp2 → entitlement 18, ledger delta; not own
  t := pg_temp.as_user('adm', 'aal2', format('insert into app.leave_entitlement_overrides (employee_id, leave_type_id, leave_year, days, reason, created_by) values (%L, %L, %s, 18, ''Contractual 18 days (test)'', app.current_app_user_id()) returning id::text',
         pg_temp.emp('emp2'), al, v_y));
  perform pg_temp.r('I7 entitlement override 18 → yearly entitlement 18 (US-LEAVE-036)',
    (select entitled_days from app.leave_entitlements where employee_id = pg_temp.emp('emp2') and leave_type_id = al and leave_year = v_y) = 18, t);
  t := pg_temp.as_user('adm', 'aal2', format('insert into app.leave_entitlement_overrides (employee_id, leave_type_id, leave_year, days, reason, created_by) values (%L, %L, %s, 20, ''Own override attempt'', app.current_app_user_id()) returning id::text',
         pg_temp.emp('adm'), al, v_y));
  perform pg_temp.r('I8 override on own record refused', t like 'ERR:%row-level security%', t);
  t := pg_temp.as_user('adm', 'aal2', format('insert into app.leave_entitlement_overrides (employee_id, leave_type_id, leave_year, days, reason, created_by) values (%L, %L, %s, 5, ''Below minimum (test)'', app.current_app_user_id()) returning id::text',
         pg_temp.emp('vet'), sl, v_y));
  perform pg_temp.r('I9 override below the statutory minimum blocked', t like 'ERR:%PRET-LV-FLOOR%', t);
  -- opening balances (F-LV-35)
  t := pg_temp.as_user('adm', 'aal2', format('select app.save_opening_leave(%L, %L::jsonb)::text', pg_temp.emp('emp3'),
         jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('leave_type_id', al, 'taken_this_year', 4, 'carry_forward', 2, 'carry_forward_expiry', make_date(v_y, 3, 31))),
                            'paternity_occurrences_used', 0)));
  b := app.leave_balance(pg_temp.emp('emp3'), al, v_y);
  perform pg_temp.r('I10 opening balances: taken 4.0 + CF 2.0 as "Opening balance" rows (US-LEAVE-040)',
    (select count(*) from app.leave_ledger where employee_id = pg_temp.emp('emp3') and is_opening) = 2 and (b ->> 'carried_forward')::numeric = 2 and (b ->> 'taken')::numeric >= 4, t || ' ' || b::text);
  t := pg_temp.as_user('adm', 'aal2', format('select app.save_opening_leave(%L, ''{}''::jsonb)::text', pg_temp.emp('emp3')));
  perform pg_temp.r('I11 opening balances only once', t like 'ERR:%PRET-LV-OPENING-DONE%', t);
end $$;

-- ===========================================================================
-- J. Year-end roll-over (idempotent per year), daily job, leaver position
-- ===========================================================================
do $$ declare v_y int := extract(year from app.today_myt())::int; al uuid := (select id from app.leave_types where code = 'AL'); t text; v_run uuid; l record; n1 int; n2 int; j jsonb;
begin
  t := pg_temp.as_user('adm', 'aal2', format('select app.rollover_preview(%s)::text', v_y));
  v_run := t::uuid;
  select * into l from app.rollover_lines where run_id = v_run and employee_id = pg_temp.emp('vet') and leave_type_id = al;
  perform pg_temp.r('J1 preview: ≥5-year employee closes with 16.0 → carry 10.0 (cap), forfeit 6.0, expiry 31/03 (US-LEAVE-026)',
    l.closing_balance = 16 and l.carry_forward = 10 and l.forfeited = 6 and l.cf_expiry_date = make_date(v_y + 1, 3, 31), row_to_json(l)::text);
  -- run outside the window is blocked; inside the window it is idempotent
  t := pg_temp.as_user('adm', 'aal2', format('select app.rollover_commit(%L)::text', v_run));
  perform pg_temp.r('J2 roll-over refused outside 01/12–31/01 or before next year''s calendar', case when cardinality(app.rollover_blockers(v_y)) > 0 then t like 'ERR:%PRET-ROLLOVER-BLOCKED%' else true end, t);
  create or replace function app.rollover_blockers(p_closing_year int) returns text[] language sql stable set search_path = '' as $f$ select '{}'::text[] $f$;
  t := pg_temp.as_user('adm', 'aal2', format('select app.rollover_commit(%L)::text', v_run));
  select count(*) into n1 from app.leave_ledger where source_rollover_id = v_run;
  t := pg_temp.as_user('adm', 'aal2', format('select app.rollover_commit(%L)::text', v_run));
  select count(*) into n2 from app.leave_ledger where source_rollover_id = v_run;
  perform pg_temp.r('J3 roll-over committed: CF row in the new year with expiry; re-run changes nothing (BR-LV-70)',
    exists (select 1 from app.leave_ledger where source_rollover_id = v_run and employee_id = pg_temp.emp('vet') and leave_year = v_y + 1 and entry_type = 'carry_forward'
              and days = 10 and expires_on = make_date(v_y + 1, 3, 31))
    and n1 = n2 and (t::jsonb ->> 'already_run')::boolean, n1 || '/' || n2 || ' ' || t);
  perform pg_temp.r('J4 N-18 roll-over completed to ADM', exists (select 1 from app.notifications where event_code = 'N-18'));
  -- daily job: carry-forward expiry (expired yesterday, unused → expired row)
  insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, expires_on, reason)
  values (pg_temp.emp('del'), al, v_y, 'carry_forward', 3, make_date(v_y, 1, 1), app.today_myt() - 1, 'Carried forward (test)');
  j := app.run_leave_daily_job(true);
  perform pg_temp.r('J5 daily job runs without errors', jsonb_array_length(j -> 'errors') = 0, j::text);
  perform pg_temp.r('J6 unused carry-forward expired by the job (F-LV-20)',
    exists (select 1 from app.leave_ledger where employee_id = pg_temp.emp('del') and entry_type = 'expired' and days = -3));
  -- leaver (F-LV-27): position at LWD
  j := (pg_temp.as_user('adm', 'aal2', format('select app.leaver_position(%L, %L)::text', pg_temp.emp('emp2'), make_date(v_y, 6, 30))))::jsonb;
  perform pg_temp.r('J7 leaver position computed to the LWD (encashable / recoverable)', jsonb_array_length(j -> 'rows') >= 1 and j ->> 'summary' is not null, j::text);
  t := pg_temp.as_user('emp1', 'aal1', format('select app.leaver_position(%L, %L)::text', pg_temp.emp('emp2'), make_date(v_y, 6, 30)));
  perform pg_temp.r('J8 EMP cannot read another employee''s leaver position', t like 'ERR:%PRET-ACC-403%', t);
end $$;

-- ===========================================================================
-- L. Catalogue lint (rls-policies §12) for the W2-004 tables and functions
-- ===========================================================================
do $$
declare
  t text[] := array['leave_policy','approval_workflows','approval_workflow_levels','leave_types','statutory_leave_minimums','statutory_floor_overrides',
    'leave_entitlement_bands','leave_entitlement_overrides','leave_entitlements','leave_applications','leave_application_days','leave_application_files',
    'leave_application_events','replacement_credits','leave_ledger','leave_balance_summary','replacement_credit_consumptions','employee_leave_counters',
    'rollover_runs','rollover_lines','team_calendar_entries','approval_tasks'];
  tier2 text[] := array['leave_ledger','leave_entitlements','leave_entitlement_overrides','replacement_credit_consumptions','employee_leave_counters','rollover_lines'];
  n_unforced int; n_nosel int; n_nocheck int; n_mgr int; n_trig int; n_path int; n_all int;
begin
  select count(*) into n_unforced from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relname = any(t) and not (c.relrowsecurity and c.relforcerowsecurity);
  select count(*) into n_nosel from unnest(t) x where not exists (select 1 from pg_policies p where p.schemaname = 'app' and p.tablename = x and p.cmd = 'SELECT');
  select count(*) into n_nocheck from pg_policies where schemaname = 'app' and cmd in ('INSERT','UPDATE') and with_check is null;
  select count(*) into n_mgr from pg_policies p where p.schemaname = 'app' and p.tablename = any(tier2)
     and (coalesce(p.qual, '') ~ '(is_manager_of|can_see_team_row|is_current_approver_for)' or coalesce(p.with_check, '') ~ '(is_manager_of|can_see_team_row|is_current_approver_for)');
  select count(*) into n_trig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute');
  select count(*) into n_path from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','audit') and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  select count(*) into n_all from pg_policies where schemaname = 'app' and cmd = 'ALL';
  perform pg_temp.r('L1 RLS enabled and forced on every W2-004 table', n_unforced = 0, n_unforced::text);
  perform pg_temp.r('L2 every W2-004 table has a SELECT policy', n_nosel = 0, n_nosel::text);
  perform pg_temp.r('L3 every insert/update policy has WITH CHECK', n_nocheck = 0, n_nocheck::text);
  perform pg_temp.r('L4 no T2 leave policy references a manager helper (ledger never MGR)', n_mgr = 0, n_mgr::text);
  perform pg_temp.r('L5 no trigger function is executable by authenticated', n_trig = 0, n_trig::text);
  perform pg_temp.r('L6 every definer function pins search_path', n_path = 0, n_path::text);
  perform pg_temp.r('L7 no FOR ALL policies', n_all = 0, n_all::text);
  perform pg_temp.r('L8 seeded D13 leave types: SL 14/18/22, HL pool 60, ML 98, PL 7 ×5, AL 12/12/16; MRL/EXL inactive',
    (select array_agg(days_per_year order by service_from_years) from app.leave_entitlement_bands where leave_type_id = (select id from app.leave_types where code = 'SL') and effective_year = 2026) = array[14,18,22]::numeric[]
    and (select array_agg(days_per_year order by service_from_years) from app.leave_entitlement_bands where leave_type_id = (select id from app.leave_types where code = 'AL') and effective_year = 2026) = array[12,12,16]::numeric[]
    and (select pool_cap_days from app.leave_types where code = 'HL') = 60 and (select max_occurrences from app.leave_types where code = 'PL') = 5
    and (select days_per_occurrence from app.leave_types where code = 'PL') = 7
    and not (select is_active from app.leave_types where code = 'MRL') and not (select is_active from app.leave_types where code = 'EXL'));
end $$;

select test, pass, detail from t_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from t_results;

rollback;
