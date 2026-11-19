-- PRET W2-002 — role matrix, guards and replacement-holiday tests for the M5/M6 tables (rls-policies.md §12).
-- Runs entirely inside ONE transaction that is rolled back: no data is left behind.
-- Synthetic fixtures only (example.invalid addresses, random UUIDs, holiday year 2098). Run as postgres:
--   node --env-file=.env.local supabase/tests/run.cjs supabase/tests/w2_002_role_matrix.sql
-- Output: one row per test (name, pass, detail) and a summary; every row must have pass = true.

begin;

create temp table t_results (id serial primary key, test text not null, pass boolean not null, detail text);
create temp table fx (n text primary key, auth_id uuid, app_id uuid, emp_id uuid);
create temp table ids (k text primary key, id uuid);
grant select on fx, ids to authenticated;

create function pg_temp.r(p_test text, p_pass boolean, p_detail text default null) returns void
language sql as $$ insert into t_results (test, pass, detail) values (p_test, coalesce(p_pass, false), p_detail) $$;

create function pg_temp.login(p_sub uuid, p_aal text default 'aal1') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', p_aal, 'session_id', gen_random_uuid())::text, true);
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: SA, internal ADM, external ADM, MGR (+ reportee), EMP, invited employee user
-- ---------------------------------------------------------------------------
insert into fx (n, auth_id, emp_id) values
  ('sa',   gen_random_uuid(), gen_random_uuid()),
  ('adm',  gen_random_uuid(), gen_random_uuid()),
  ('ext',  gen_random_uuid(), null),
  ('mgr',  gen_random_uuid(), gen_random_uuid()),
  ('emp1', gen_random_uuid(), gen_random_uuid()),
  ('emp2', gen_random_uuid(), gen_random_uuid()),
  ('inv',  null,              gen_random_uuid());

insert into auth.users (id, email, aud, role)
select auth_id, 'pret-w2-' || n || '@example.invalid', 'authenticated', 'authenticated' from fx where auth_id is not null;

-- W2-003: app_users.employee_id now references app.employees (FK) — minimal synthetic employee rows for the
-- employee-user fixtures (system write; deferred Top-of-organisation checks never fire because the test rolls back).
insert into app.grades (code, name, rank) values ('FXTG', 'FX TEST grade', 993);
insert into app.positions (code, title) values ('FXTP', 'FX TEST position');
insert into app.employees (id, employee_no, full_name, gender, work_email, mobile_phone, join_date, probation_months,
                           department_id, position_id, grade_id, work_location_id, work_state, working_pattern_id, status)
select f.emp_id, 'FXT-' || upper(f.n), 'Sample Fixture', 'female', 'fxt-' || f.n || '@example.invalid', '+60120000000',
       app.today_myt() - 100, 0,
       (select id from app.departments where is_active order by code limit 1), (select id from app.positions where code = 'FXTP'),
       (select id from app.grades where code = 'FXTG'), (select id from app.work_locations where is_active order by name limit 1),
       'SGR', (select id from app.working_patterns where is_active order by name limit 1), 'confirmed'
  from fx f where f.emp_id is not null;

insert into app.app_users (auth_user_id, user_type, employee_id, login_email, display_name, status, access_start_date, access_end_date, service_provider)
select f.auth_id, case when f.emp_id is null then 'external' else 'employee' end::app.user_type, f.emp_id,
       'pret-w2-' || f.n || '@example.invalid', 'W2 Test ' || upper(f.n),
       case f.n when 'inv' then 'invited' else 'active' end::app.user_status,
       app.today_myt() - 30, case f.n when 'ext' then app.today_myt() + 90 end,
       case when f.emp_id is null then 'Example Outsourcing (TEST)' end
  from fx f;
update fx set app_id = u.id from app.app_users u where u.login_email = 'pret-w2-' || fx.n || '@example.invalid';

insert into app.user_roles (user_id, role, granted_by) values ((select app_id from fx where n = 'sa'), 'SA', '00000000-0000-0000-0000-000000000001');
insert into app.user_roles (user_id, role, granted_by) select app_id, 'ADM', (select app_id from fx where n = 'sa') from fx where n in ('adm','ext');
insert into app.reporting_closure (manager_employee_id, employee_id, depth)
values ((select emp_id from fx where n = 'mgr'), (select emp_id from fx where n = 'emp1'), 1);

-- Org fixtures created by the system (postgres): one draft-year holiday (2098) and one published-year holiday (2097).
insert into ids (k, id) values ('std', '00000000-0000-4000-8000-00000000a001');
with h as (insert into app.public_holidays (year, holiday_date, name, holiday_type) values (2097, date '2097-03-03', 'W2 TEST published holiday', 'national') returning id)
insert into ids (k, id) select 'pub_h', id from h;
insert into app.public_holiday_states (holiday_id, state) select id, 'SGR' from ids where k = 'pub_h';
insert into app.holiday_calendar_years (year, state, status, published_at) select 2097, s, 'published', now() from unnest(enum_range(null::app.my_state)) s;
with h as (insert into app.public_holidays (year, holiday_date, name, holiday_type) values (2098, date '2098-01-15', 'W2 TEST draft holiday', 'national') returning id)
insert into ids (k, id) select 'draft_h', id from h;
insert into app.public_holiday_states (holiday_id, state) select id, 'SGR' from ids where k = 'draft_h';
with g as (insert into app.employee_groups (name) values ('W2 TEST group') returning id) insert into ids (k, id) select 'grp', id from g;
insert into app.gl_mappings (purpose, gl_account_code) values ('bank_clearing', 'TEST-0001') on conflict (purpose) do nothing;

-- ===========================================================================
-- A. anon
-- ===========================================================================
do $$ declare e1 text; e2 text;
begin
  execute 'set local role anon';
  begin perform 1 from app.departments limit 1; e1 := 'no error'; exception when others then e1 := sqlerrm; end;
  begin perform app.publish_holiday_year(2098, true); e2 := 'no error'; exception when others then e2 := sqlerrm; end;
  reset role;
  perform pg_temp.r('A1 anon cannot read organisation tables', e1 like '%permission denied%', e1);
  perform pg_temp.r('A2 anon cannot call publish functions', e2 like '%permission denied%', e2);
end $$;

-- ===========================================================================
-- B. Employee (EMP) — P-ACTIVE reads, published holidays only, no writes
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'emp1');
  c_dep int; c_pat int; c_ver int; c_grp int; c_zak int; c_sig int; c_gl int; c_pub int; c_draft int; c_years_draft int;
  c_rev int; c_names int; c_zb int; e_ins text; e_pub text; e_ntc text; e_evt text; c_upd int;
begin
  perform pg_temp.login(s);
  select count(*) into c_dep from app.departments;
  select count(*) into c_pat from app.working_patterns;
  select count(*) into c_ver from app.working_pattern_versions;
  select count(*) into c_grp from app.employee_groups;
  select count(*) into c_zak from app.company_zakat_registrations;
  select count(*) into c_sig from app.company_signatories;
  select count(*) into c_gl  from app.gl_mappings;
  select count(*) into c_zb  from app.zakat_bodies;
  select count(*) into c_pub from app.public_holidays where id = (select id from ids where k = 'pub_h');
  select count(*) into c_draft from app.public_holidays where year = 2098;
  select count(*) into c_years_draft from app.holiday_calendar_years where status = 'draft';
  select count(*) into c_rev from app.access_reviews;
  select count(*) into c_names from app.user_display_names(array(select app_id from fx));
  update app.departments set name = name; get diagnostics c_upd = row_count;
  begin insert into app.departments (code, name) values ('W2EMP', 'x'); e_ins := 'no error'; exception when others then e_ins := sqlerrm; end;
  begin perform app.publish_holiday_year(2098, true); e_pub := 'no error'; exception when others then e_pub := sqlerrm; end;
  begin perform app.publish_privacy_notice('x', 'y', null, app.today_myt()); e_ntc := 'no error'; exception when others then e_ntc := sqlerrm; end;
  begin perform audit.write_admin_event('update', 'user_password_reset', null, 'x'); e_evt := 'no error'; exception when others then e_evt := sqlerrm; end;
  reset role;
  perform pg_temp.r('B1 EMP reads departments (P-ACTIVE)', c_dep >= 3, c_dep::text);
  perform pg_temp.r('B2 EMP reads working patterns and versions', c_pat >= 1 and c_ver >= 1, c_pat || '/' || c_ver);
  perform pg_temp.r('B3 EMP cannot read employee groups (P-HR)', c_grp = 0, c_grp::text);
  perform pg_temp.r('B4 EMP cannot read zakat registrations / signatories / GL (P-HR)', c_zak + c_sig + c_gl = 0, c_zak || '/' || c_sig || '/' || c_gl);
  perform pg_temp.r('B5 EMP reads zakat body reference list', c_zb >= 14, c_zb::text);
  perform pg_temp.r('B6 EMP sees holidays of a published year', c_pub = 1, c_pub::text);
  perform pg_temp.r('B7 EMP does not see draft-year holidays (BR-ORG-25)', c_draft = 0, c_draft::text);
  perform pg_temp.r('B8 EMP sees no draft calendar-year rows', c_years_draft = 0, c_years_draft::text);
  perform pg_temp.r('B9 EMP cannot read access reviews', c_rev = 0, c_rev::text);
  perform pg_temp.r('B10 EMP resolves only own display name', c_names = 1, c_names::text);
  perform pg_temp.r('B11 EMP cannot update departments', c_upd = 0, c_upd::text);
  perform pg_temp.r('B12 EMP cannot create departments', e_ins like '%row-level security%', e_ins);
  perform pg_temp.r('B13 EMP cannot publish a holiday year', e_pub like '%PRET-ACC-403%', e_pub);
  perform pg_temp.r('B14 EMP cannot publish a privacy notice', e_ntc like '%PRET-ACC-403%', e_ntc);
  perform pg_temp.r('B15 EMP cannot write admin audit events', e_evt like '%permission denied%' or e_evt like '%PRET-ACC-403%', e_evt);
end $$;

-- ===========================================================================
-- C. Manager (derived) — same organisation access as EMP; no admin helpers
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'mgr'); c_draft int; c_grp int; c_rc int; e_ins text;
begin
  perform pg_temp.login(s);
  select count(*) into c_draft from app.public_holidays where year = 2098;
  select count(*) into c_grp from app.employee_groups;
  select count(*) into c_rc from app.direct_reportee_counts(array[(select emp_id from fx where n = 'mgr')]);
  begin insert into app.grades (code, name, rank) values ('W2MGR', 'x', 990); e_ins := 'no error'; exception when others then e_ins := sqlerrm; end;
  reset role;
  perform pg_temp.r('C1 MGR does not see draft holidays', c_draft = 0, c_draft::text);
  perform pg_temp.r('C2 MGR cannot read employee groups', c_grp = 0, c_grp::text);
  perform pg_temp.r('C3 MGR cannot use the admin reportee-count helper', c_rc = 0, c_rc::text);
  perform pg_temp.r('C4 MGR cannot create grades', e_ins like '%row-level security%', e_ins);
end $$;

-- ===========================================================================
-- D. ADM without MFA (aal1) — admin rights withheld (F-ADM-07)
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'adm'); c_grp int; e_ins text;
begin
  perform pg_temp.login(s, 'aal1');
  select count(*) into c_grp from app.employee_groups;
  begin insert into app.cost_centres (code, name) values ('W2AAL1', 'x'); e_ins := 'no error'; exception when others then e_ins := sqlerrm; end;
  reset role;
  perform pg_temp.r('D1 ADM at aal1 cannot read employee groups', c_grp = 0, c_grp::text);
  perform pg_temp.r('D2 ADM at aal1 cannot create cost centres', e_ins like '%row-level security%', e_ins);
end $$;

-- ===========================================================================
-- E. ADM at aal2 — organisation masters and guards
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'adm');
  cc uuid; d1 uuid; d2 uuid; d3 uuid; g1 uuid; g2 uuid; p1 uuid; e_dup text; e_cyc text; e_par text; e_kids text; e_grade text;
  e_head text; c_draft int; c_grp_upd int; c_names int; e_dup_rank text;
begin
  perform pg_temp.login(s, 'aal2');
  insert into app.cost_centres (code, name, autocount_code) values ('W2CC', 'W2 cost centre', 'AC-1') returning id into cc;
  insert into app.departments (code, name, cost_centre_id) values ('W2D1', 'W2 dept 1', cc) returning id into d1;
  insert into app.departments (code, name, parent_id) values ('W2D2', 'W2 dept 2', d1) returning id into d2;
  insert into app.departments (code, name, parent_id) values ('W2D3', 'W2 dept 3', d2) returning id into d3;
  begin insert into app.departments (code, name) values ('W2D1', 'dup'); e_dup := 'no error'; exception when others then e_dup := sqlerrm; end;
  begin update app.departments set parent_id = d3 where id = d1; e_cyc := 'no error'; exception when others then e_cyc := sqlerrm; end;
  update app.departments set is_active = false where id = d3;
  begin insert into app.departments (code, name, parent_id) values ('W2D4', 'x', d3); e_par := 'no error'; exception when others then e_par := sqlerrm; end;
  begin update app.departments set is_active = false where id = d1; e_kids := 'no error'; exception when others then e_kids := sqlerrm; end;
  begin insert into app.departments (code, name, head_employee_id) values ('W2D5', 'x', gen_random_uuid()); e_head := 'no error'; exception when others then e_head := sqlerrm; end;
  insert into app.grades (code, name, rank) values ('W2G1', 'W2 grade 1', 991) returning id into g1;
  insert into app.grades (code, name, rank, is_active) values ('W2G2', 'W2 grade 2', 992, false) returning id into g2;
  begin insert into app.grades (code, name, rank) values ('W2G3', 'x', 991); e_dup_rank := 'no error'; exception when others then e_dup_rank := sqlerrm; end;
  insert into app.positions (code, title, default_department_id, default_grade_id) values ('W2P1', 'W2 position', d1, g1) returning id into p1;
  begin insert into app.positions (code, title, default_grade_id) values ('W2P2', 'x', g2); e_grade := 'no error'; exception when others then e_grade := sqlerrm; end;
  select count(*) into c_draft from app.public_holidays where year = 2098;
  update app.employee_groups set description = 'changed' where id = (select id from ids where k = 'grp'); get diagnostics c_grp_upd = row_count;
  select count(*) into c_names from app.user_display_names(array(select app_id from fx));
  reset role;
  insert into ids values ('d1', d1), ('cc', cc), ('p1', p1);
  perform pg_temp.r('E1 ADM creates cost centre, departments (with parent), grade and position', d1 is not null and d3 is not null and p1 is not null, coalesce(p1::text, 'null'));
  perform pg_temp.r('E2 department codes are unique', e_dup like '%ux_departments_code%', e_dup);
  perform pg_temp.r('E3 department parent cycle blocked', e_cyc like '%PRET-ORG-CYCLE%', e_cyc);
  perform pg_temp.r('E4 inactive parent refused', e_par like '%PRET-ORG-PARENT-INACTIVE%', e_par);
  perform pg_temp.r('E5 deactivating a department with active sub-departments blocked', e_kids like '%PRET-ORG-ACTIVE-CHILDREN%', e_kids);
  perform pg_temp.r('E6 head of department must be an active employee (W2-003)', e_head like '%PRET-ORG-HEAD-INACTIVE%', e_head);
  perform pg_temp.r('E7 grade rank is unique', e_dup_rank like '%ux_grades_rank%', e_dup_rank);
  perform pg_temp.r('E8 position cannot default to an inactive grade', e_grade like '%PRET-ORG-REF-INACTIVE%', e_grade);
  perform pg_temp.r('E9 ADM sees draft-year holidays (P-HR)', c_draft >= 1, c_draft::text);
  perform pg_temp.r('E10 ADM updates employee groups', c_grp_upd = 1, c_grp_upd::text);
  perform pg_temp.r('E11 ADM resolves display names of all users (incl. SA)', c_names = 7, c_names::text);
end $$;

-- E-bis. Audit trail written with actor + ref for an ADM change (F-ADM-09)
do $$ declare rec record;
begin
  select * into rec from audit.audit_log where entity_type = 'departments' and entity_id = (select id from ids where k = 'd1') order by id limit 1;
  perform pg_temp.r('E12 department create is audited with actor, ADM role and code ref',
    rec.action = 'create' and rec.actor_user_id = (select app_id from fx where n = 'adm') and 'ADM' = any(rec.actor_roles) and rec.entity_ref = 'W2D1',
    coalesce(rec.entity_ref, 'no row'));
end $$;

-- ===========================================================================
-- F. Working-week patterns and locations
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'adm'); wp uuid; v_fut uuid; loc uuid;
  e_rest text; e_back text; e_lock text; c_fut int; e_inact text; e_inuse text; wp2 uuid;
begin
  perform pg_temp.login(s, 'aal2');
  insert into app.working_patterns (name) values ('W2 TEST pattern') returning id into wp;
  begin insert into app.working_pattern_versions (pattern_id, effective_from, mon, tue, wed, thu, fri, sat, sun)
        values (wp, app.today_myt(), 'full','full','full','full','full','off','off'); e_rest := 'no error'; exception when others then e_rest := sqlerrm; end;
  insert into app.working_pattern_versions (pattern_id, effective_from, mon, tue, wed, thu, fri, sat, sun)
  values (wp, app.today_myt() - 400, 'full','full','full','full','full','half','rest');                    -- initial version may be back-dated
  begin insert into app.working_pattern_versions (pattern_id, effective_from, mon, tue, wed, thu, fri, sat, sun)
        values (wp, app.today_myt() - 1, 'full','full','full','full','full','off','rest'); e_back := 'no error'; exception when others then e_back := sqlerrm; end;
  begin update app.working_pattern_versions set sat = 'off' where pattern_id = wp and effective_from = app.today_myt() - 400; e_lock := 'no error'; exception when others then e_lock := sqlerrm; end;
  insert into app.working_pattern_versions (pattern_id, effective_from, mon, tue, wed, thu, fri, sat, sun)
  values (wp, app.today_myt() + 30, 'full','full','full','full','full','off','rest') returning id into v_fut;
  update app.working_pattern_versions set hours_per_full_day = 7.5 where id = v_fut; get diagnostics c_fut = row_count;
  insert into app.work_locations (name, addr_line1, postcode, city, state, default_pattern_id)
  values ('W2 TEST location', '1 Jalan Ujian', '50000', 'Kuala Lumpur', 'KUL', wp) returning id into loc;
  begin update app.working_patterns set is_active = false where id = wp; e_inuse := 'no error'; exception when others then e_inuse := sqlerrm; end;
  insert into app.working_patterns (name, is_active) values ('W2 TEST inactive', false) returning id into wp2;
  begin insert into app.work_locations (name, addr_line1, postcode, city, state, default_pattern_id)
        values ('W2 TEST location 2', '1 Jalan Ujian', '50000', 'Kuala Lumpur', 'KUL', wp2); e_inact := 'no error'; exception when others then e_inact := sqlerrm; end;
  reset role;
  insert into ids values ('wp', wp), ('loc', loc);
  perform pg_temp.r('F1 a pattern needs at least one rest day (EA s59)', e_rest like '%chk_one_rest_day%', e_rest);
  perform pg_temp.r('F2 new versions cannot be back-dated once a version exists', e_back like '%PRET-WP-BACKDATE%', e_back);
  perform pg_temp.r('F3 a version in force is immutable', e_lock like '%PRET-WP-VERSION-LOCKED%', e_lock);
  perform pg_temp.r('F4 a future version may be edited', c_fut = 1, c_fut::text);
  perform pg_temp.r('F5 cannot deactivate a pattern used by an active location', e_inuse like '%PRET-WP-IN-USE%', e_inuse);
  perform pg_temp.r('F6 location cannot use an inactive pattern', e_inact like '%PRET-ORG-REF-INACTIVE%', e_inact);
end $$;

-- ===========================================================================
-- G. Holidays: replacement generation (F-ORG-08), publish checks (BR-ORG-20/25), draft-only delete
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'adm'); std uuid := (select id from ids where k = 'std');
  h_sun uuid; h_sat uuid; h_wa uuid; h_wb uuid; h_nat uuid; r_sun date; r_sat int; r_wa int; r_wb date; r_nat date;
  e_comp text; e_warn text; warn text[]; c_pub int; c_del int; e_del text; c_state_del int; e_type text; c_tmp uuid; c_gone int;
begin
  perform pg_temp.login(s, 'aal2');
  insert into app.public_holidays (year, holiday_date, name, holiday_type) values (2098, date '2098-03-02', 'W2 Sunday', 'national') returning id into h_sun;
  insert into app.public_holidays (year, holiday_date, name, holiday_type) values (2098, date '2098-03-01', 'W2 Saturday', 'national') returning id into h_sat;
  insert into app.public_holidays (year, holiday_date, name, holiday_type) values (2098, date '2098-03-12', 'W2 Wed A', 'national') returning id into h_wa;
  insert into app.public_holidays (year, holiday_date, name, holiday_type) values (2098, date '2098-03-12', 'W2 Wed B', 'national') returning id into h_wb;
  insert into app.public_holiday_states (holiday_id, state)
    select h, st from unnest(array[h_sun, h_sat, h_wa, h_wb]) h, unnest(enum_range(null::app.my_state)) st;
  select replacement_date into r_sun from app.replacement_holidays where source_holiday_id = h_sun and state = 'SGR' and pattern_id = std and is_active;
  select count(*) into r_sat from app.replacement_holidays where source_holiday_id = h_sat and is_active;
  select count(*) into r_wa from app.replacement_holidays where source_holiday_id = h_wa and is_active;
  select replacement_date into r_wb from app.replacement_holidays where source_holiday_id = h_wb and state = 'SGR' and pattern_id = std and is_active;
  begin insert into app.public_holidays (year, holiday_date, name, holiday_type) values (2098, date '2098-04-01', 'x', 'replacement'); e_type := 'no error'; exception when others then e_type := sqlerrm; end;

  begin perform app.publish_holiday_year(2098, true); e_comp := 'no error'; exception when others then e_comp := sqlerrm; end;
  insert into app.public_holidays (year, holiday_date, name, holiday_type, compulsory) values
    (2098, date '2098-05-01', 'W2 Workers', 'national', 'workers_day'),
    (2098, date '2098-06-02', 'W2 Agong', 'national', 'agong_birthday'),
    (2098, date '2098-08-31', 'W2 National', 'national', 'national_day'),
    (2098, date '2098-09-16', 'W2 Malaysia', 'national', 'malaysia_day'),
    (2098, date '2098-12-01', 'W2 Ruler/FT', 'state', 'ruler_birthday_or_ft_day');
  insert into app.public_holiday_states (holiday_id, state)
    select h.id, st from app.public_holidays h, unnest(enum_range(null::app.my_state)) st where h.year = 2098 and h.compulsory is not null;
  select id into h_nat from app.public_holidays where year = 2098 and compulsory = 'national_day';
  select replacement_date into r_nat from app.replacement_holidays where source_holiday_id = h_nat and state = 'KUL' and pattern_id = std and is_active;
  -- a deletable draft holiday (with its replacement) before publishing
  insert into app.public_holidays (year, holiday_date, name, holiday_type) values (2098, date '2098-06-01', 'W2 temp Sunday', 'company') returning id into c_tmp;
  insert into app.public_holiday_states (holiday_id, state) values (c_tmp, 'SGR');
  delete from app.public_holidays where id = c_tmp; get diagnostics c_del = row_count;
  select count(*) into c_gone from app.public_holiday_states where holiday_id = c_tmp;

  begin perform app.publish_holiday_year(2098, false); e_warn := 'no error'; exception when others then e_warn := sqlerrm; end;
  warn := app.publish_holiday_year(2098, true);
  select count(*) into c_pub from app.holiday_calendar_years where year = 2098 and status = 'published';
  delete from app.public_holidays where id = h_sat; get diagnostics c_state_del = row_count;
  begin delete from app.public_holiday_states where holiday_id = h_sun and state = 'SGR'; e_del := 'rows=0'; exception when others then e_del := sqlerrm; end;
  reset role;
  perform pg_temp.r('G1 holiday on a rest day (Sunday) → replacement next working day', r_sun = date '2098-03-03', coalesce(r_sun::text, 'none'));
  perform pg_temp.r('G2 holiday on an off day (Saturday) → no replacement (LP18 default No)', r_sat = 0, r_sat::text);
  perform pg_temp.r('G3 two holidays on one working day → first absorbed, second replaced next day (BR-ORG-22)',
                    r_wa = 0 and r_wb = date '2098-03-13', r_wa || '/' || coalesce(r_wb::text, 'none'));
  perform pg_temp.r('G4 replacement skips existing holidays/replacements (Sunday 31/08 → Monday 01/09)', r_nat = date '2098-09-01', coalesce(r_nat::text, 'none'));
  perform pg_temp.r('G5 replacement type cannot be entered', e_type like '%check%', e_type);
  perform pg_temp.r('G6 publish blocked when compulsory holidays are missing (BR-ORG-20)', e_comp like '%PRET-PH-COMPULSORY%', e_comp);
  perform pg_temp.r('G7 draft holiday delete cascades states/replacements', c_del = 1 and c_gone = 0, c_del || '/' || c_gone);
  perform pg_temp.r('G8 fewer than 11 paid holidays needs acknowledgement', e_warn like '%PRET-PH-WARN-ACK%', e_warn);
  perform pg_temp.r('G9 publish with acknowledgement publishes every state-year', c_pub = 16 and cardinality(warn) >= 1, c_pub || ' / ' || array_to_string(warn, '; '));
  perform pg_temp.r('G10 published-year holidays cannot be deleted (RLS: 0 rows)', c_state_del = 0, c_state_del::text);
  perform pg_temp.r('G11 states of a published holiday cannot be removed', e_del = 'rows=0' or e_del like '%PRET-PH-PUBLISHED-STATES%', e_del);
end $$;

do $$ declare s uuid := (select auth_id from fx where n = 'emp1'); c int; c_rep int;
begin
  perform pg_temp.login(s);
  select count(*) into c from app.public_holidays where year = 2098;
  select count(*) into c_rep from app.replacement_holidays r join app.public_holidays h on h.id = r.source_holiday_id where h.year = 2098;
  reset role;
  perform pg_temp.r('G12 EMP sees the year once published', c >= 9, c::text);
  perform pg_temp.r('G13 EMP sees replacement holidays of a published year', c_rep >= 1, c_rep::text);
end $$;

-- ===========================================================================
-- H. Company profile, statutory, GL, settings, privacy notice — ADM vs SA
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'adm'); c_ct int; e_addr text; e_zak text; c_sec_upd int; c_gl int;
  e_stat text; c_rev int; e_rev text; n1 uuid; n2 uuid; c_cur int; c_ntf int; e_evt_ok text; e_evt_bad text; c_sig int;
begin
  perform pg_temp.login(s, 'aal2');
  update app.company_profile set phone = '+60300000099' where id = 1; get diagnostics c_ct = row_count;
  begin update app.company_profile set biz_city = 'Elsewhere' where id = 1; e_addr := 'no error'; exception when others then e_addr := sqlerrm; end;
  begin insert into app.company_zakat_registrations (zakat_body_id, employer_ref) select id, 'X1' from app.zakat_bodies limit 1; e_zak := 'no error'; exception when others then e_zak := sqlerrm; end;
  begin update app.company_statutory set epf_employer_no = '1' where id = 1; e_stat := 'ok'; exception when others then e_stat := sqlerrm; end;
  update app.security_settings set idle_timeout_min_employee = 20 where id = 1; get diagnostics c_sec_upd = row_count;
  insert into app.gl_mappings (purpose, gl_account_code) values ('claims_payable', 'TEST-2000')
    on conflict (purpose) do update set gl_account_code = excluded.gl_account_code;
  delete from app.gl_mappings where purpose = 'bank_clearing'; get diagnostics c_gl = row_count;
  select count(*) into c_sig from app.company_signatories;
  select count(*) into c_rev from app.access_reviews;
  begin insert into app.access_reviews (review_month, reviewed_by) values (date '2098-01-01', app.current_app_user_id()); e_rev := 'no error'; exception when others then e_rev := sqlerrm; end;
  n1 := app.publish_privacy_notice('W2 TEST notice 1', 'Synthetic body', null, app.today_myt());
  n2 := app.publish_privacy_notice('W2 TEST notice 2', 'Synthetic body 2', null, app.today_myt());
  select count(*) into c_cur from app.privacy_notices where is_current;
  begin perform audit.write_admin_event('update', 'user_password_reset', (select app_id from fx where n = 'emp1'), 'x'); e_evt_ok := 'ok'; exception when others then e_evt_ok := sqlerrm; end;
  begin perform audit.write_admin_event('update', 'employees', null, 'x'); e_evt_bad := 'no error'; exception when others then e_evt_bad := sqlerrm; end;
  reset role;
  select count(*) into c_ntf from app.notifications where event_code = 'N-55' and recipient_user_id = (select app_id from fx where n = 'emp1');
  perform pg_temp.r('H1 ADM edits company contact (CO5)', c_ct = 1, c_ct::text);
  perform pg_temp.r('H2 ADM cannot change the business address (SA-only, CO4)', e_addr like '%PRET-ORG-SA-ONLY%', e_addr);
  perform pg_temp.r('H3 ADM cannot add zakat registrations (P-SA)', e_zak like '%row-level security%', e_zak);
  perform pg_temp.r('H4 ADM cannot change statutory numbers (0 rows / denied)', e_stat = 'ok' and not exists (select 1 from app.company_statutory where epf_employer_no = '1'), e_stat);
  perform pg_temp.r('H5 ADM cannot change control settings', c_sec_upd = 0, c_sec_upd::text);
  perform pg_temp.r('H6 ADM maintains AutoCount GL mapping incl. clearing a mapping', c_gl = 1, c_gl::text);
  perform pg_temp.r('H7 ADM reads signatories (P-HR)', c_sig >= 0, c_sig::text);
  perform pg_temp.r('H8 ADM cannot read or write access reviews (SA only)', c_rev = 0 and e_rev like '%row-level security%', e_rev);
  perform pg_temp.r('H9 publishing a notice keeps exactly one current (history kept)', c_cur = 1 and n1 <> n2
                    and exists (select 1 from app.privacy_notices where id = n1 and not is_current and superseded_at is not null), c_cur::text);
  perform pg_temp.r('H10 N-55 in-app notification to every active user (no email)', c_ntf = 2
                    and not exists (select 1 from app.email_outbox o join app.notifications n on n.id = o.notification_id where n.event_code = 'N-55'), c_ntf::text);
  perform pg_temp.r('H11 ADM writes allowed admin audit events', e_evt_ok = 'ok', e_evt_ok);
  perform pg_temp.r('H12 admin audit events limited to an allow-list', e_evt_bad like '%PRET-AUDIT-ENTITY%', e_evt_bad);
end $$;

do $$ declare s uuid := (select auth_id from fx where n = 'sa'); zb uuid; c_zak int; c_del int; c_addr int; e_rng text; c_rev int; who uuid; me uuid;
  c_sig int; c_set int; c_evt int; c_aud int;
begin
  perform pg_temp.login(s, 'aal2'); me := app.current_app_user_id();
  select id into zb from app.zakat_bodies where code = 'ZK-SGR';
  insert into app.company_zakat_registrations (zakat_body_id, employer_ref) values (zb, 'W2-TEST-1'); get diagnostics c_zak = row_count;
  delete from app.company_zakat_registrations where zakat_body_id = zb; get diagnostics c_del = row_count;
  insert into app.company_signatories (name, designation) values ('W2 Test Signatory', 'Director'); get diagnostics c_sig = row_count;
  update app.company_profile set biz_city = 'Kuala Lumpur' where id = 1; get diagnostics c_addr = row_count;
  update app.security_settings set rehire_keep_employee_no = false, directory_show_birthdays = true where id = 1; get diagnostics c_set = row_count;
  begin update app.security_settings set idle_timeout_min_employee = 500 where id = 1; e_rng := 'no error'; exception when others then e_rng := sqlerrm; end;
  insert into app.access_reviews (review_month, reviewed_by, remarks) values (date '2098-01-01', gen_random_uuid(), 'W2 test');
  select reviewed_by into who from app.access_reviews where review_month = date '2098-01-01';
  select count(*) into c_rev from app.access_reviews;
  perform audit.write_admin_event('update', 'user_mfa_reset', (select app_id from fx where n = 'emp1'), 'pret-w2-emp1@example.invalid');
  select count(*) into c_evt from audit.audit_log where entity_type = 'user_mfa_reset' and actor_user_id = me;
  select count(*) into c_aud from audit.audit_log where entity_type = 'holiday_calendar_years' and entity_ref = '2098';
  reset role;
  perform pg_temp.r('I1 SA adds and removes zakat registrations (CO12)', c_zak = 1 and c_del = 1, c_zak || '/' || c_del);
  perform pg_temp.r('I2 SA maintains signatories (CO14)', c_sig = 1, c_sig::text);
  perform pg_temp.r('I3 SA changes the business address', c_addr = 1, c_addr::text);
  perform pg_temp.r('I4 SA edits control settings incl. new rehire / birthday settings', c_set = 1, c_set::text);
  perform pg_temp.r('I5 settings ranges enforced in the database', e_rng like '%chk_settings_ranges%', e_rng);
  perform pg_temp.r('I6 SA marks the access review; reviewer taken from the session', who = me and c_rev >= 1, coalesce(who::text, 'null'));
  perform pg_temp.r('I7 SA reads admin audit events', c_evt = 1, c_evt::text);
  perform pg_temp.r('I8 publishing a year is audited (holiday_calendar_years)', c_aud = 16, c_aud::text);
end $$;

-- ===========================================================================
-- J. Users & roles (M6) — ADM scope, status transitions, external ADM
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'adm'); emp2 uuid := (select app_id from fx where n = 'emp2');
  inv uuid := (select app_id from fx where n = 'inv'); c_dis int; c_en int; e_inv_act text; c_inv_dis int; c_inv_back int;
  e_email text; c_unlock int; c_ext int;
begin
  perform pg_temp.login(s, 'aal2');
  update app.app_users set status = 'disabled', disabled_reason = 'W2 test' where id = emp2; get diagnostics c_dis = row_count;
  update app.app_users set status = 'active', disabled_reason = null where id = emp2; get diagnostics c_en = row_count;
  update app.app_users set status = 'disabled' where id = inv; get diagnostics c_inv_dis = row_count;
  begin update app.app_users set status = 'active' where id = inv; e_inv_act := 'no error'; exception when others then e_inv_act := sqlerrm; end;
  update app.app_users set status = 'invited' where id = inv; get diagnostics c_inv_back = row_count;
  begin update app.app_users set login_email = 'pret-w2-changed@example.invalid' where id = emp2; e_email := 'no error'; exception when others then e_email := sqlerrm; end;
  update app.app_users set failed_login_count = 0, locked_until = null where id = emp2; get diagnostics c_unlock = row_count;
  select count(*) into c_ext from app.app_users where user_type = 'external';
  reset role;
  perform pg_temp.r('J1 ADM disables and re-enables an employee user', c_dis = 1 and c_en = 1, c_dis || '/' || c_en);
  perform pg_temp.r('J2 a never-accepted user cannot become Active directly', e_inv_act like '%PRET-USR-STATUS%', e_inv_act);
  perform pg_temp.r('J3 a disabled never-accepted user can return to Invited (to re-send)', c_inv_dis = 1 and c_inv_back = 1, c_inv_dis || '/' || c_inv_back);
  perform pg_temp.r('J4 login email locked after acceptance', e_email like '%PRET-USR-EMAIL-LOCKED%', e_email);
  perform pg_temp.r('J5 ADM unlocks an employee user', c_unlock = 1, c_unlock::text);
  perform pg_temp.r('J6 ADM cannot see external administrators', c_ext = 0, c_ext::text);
end $$;

do $$ declare s uuid := (select auth_id from fx where n = 'ext'); c_dep int; c_aud int; c_sa int; a boolean;
begin
  perform pg_temp.login(s, 'aal2');
  a := app.is_admin();
  insert into app.departments (code, name) values ('W2EXT', 'W2 ext dept'); get diagnostics c_dep = row_count;
  select count(*) into c_aud from audit.audit_log;
  select count(*) into c_sa from app.app_users where id = (select app_id from fx where n = 'sa');
  reset role;
  perform pg_temp.r('K1 external ADM (aal2) maintains organisation masters', a and c_dep = 1, c_dep::text);
  perform pg_temp.r('K2 external ADM cannot read audit logs', c_aud = 0, c_aud::text);
  perform pg_temp.r('K3 external ADM cannot see Super Admin users', c_sa = 0, c_sa::text);
end $$;

do $$ declare s uuid := (select auth_id from fx where n = 'sa'); me uuid; emp1 uuid := (select app_id from fx where n = 'emp1');
  c_grant int; c_ntf_sa int; e_self_dis text; c_end int;
begin
  perform pg_temp.login(s, 'aal2'); me := app.current_app_user_id();
  insert into app.user_roles (user_id, role, granted_by) values (emp1, 'SA', me); get diagnostics c_grant = row_count;
  begin update app.app_users set status = 'disabled' where id = me; e_self_dis := 'no error'; exception when others then e_self_dis := sqlerrm; end;
  update app.app_users set access_end_date = app.today_myt() + 10 where id = (select app_id from fx where n = 'ext'); get diagnostics c_end = row_count;
  reset role;
  select count(*) into c_ntf_sa from app.notifications where event_code = 'N-53' and recipient_user_id = emp1;
  perform pg_temp.r('L1 SA grants SA to another user; N-53 to the user', c_grant = 1 and c_ntf_sa >= 1, c_grant || '/' || c_ntf_sa);
  perform pg_temp.r('L2 SA cannot disable self (BR-ADM-03)', e_self_dis like '%PRET-SELF-001%' or e_self_dis like '%row-level%', e_self_dis);
  perform pg_temp.r('L3 SA extends an external user''s access window', c_end = 1, c_end::text);
end $$;

-- ===========================================================================
-- M. Catalogue lint for the W2-002 objects
-- ===========================================================================
do $$ declare n_unforced int; n_nosel int; n_nocheck int; n_trig_exec int; n_def_nopath int;
begin
  select count(*) into n_unforced from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relkind = 'r' and c.relname in ('zakat_bodies','company_zakat_registrations','company_signatories','gl_mappings',
     'cost_centres','departments','grades','positions','employee_groups','working_patterns','working_pattern_versions','work_locations',
     'holiday_calendar_years','public_holidays','public_holiday_states','replacement_holidays','privacy_notices','access_reviews')
     and not (c.relrowsecurity and c.relforcerowsecurity);
  select count(*) into n_nosel from unnest(array['zakat_bodies','company_zakat_registrations','company_signatories','gl_mappings',
     'cost_centres','departments','grades','positions','employee_groups','working_patterns','working_pattern_versions','work_locations',
     'holiday_calendar_years','public_holidays','public_holiday_states','replacement_holidays','privacy_notices','access_reviews']) t
   where not exists (select 1 from pg_policies p where p.schemaname = 'app' and p.tablename = t and p.cmd = 'SELECT');
  select count(*) into n_nocheck from pg_policies where schemaname = 'app' and cmd in ('INSERT','UPDATE') and with_check is null;
  select count(*) into n_trig_exec from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute');
  select count(*) into n_def_nopath from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','audit') and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  perform pg_temp.r('M1 RLS enabled and forced on every W2-002 table', n_unforced = 0, n_unforced::text);
  perform pg_temp.r('M2 every W2-002 table has a SELECT policy', n_nosel = 0, n_nosel::text);
  perform pg_temp.r('M3 every insert/update policy has WITH CHECK', n_nocheck = 0, n_nocheck::text);
  perform pg_temp.r('M4 no trigger function is executable by authenticated', n_trig_exec = 0, n_trig_exec::text);
  perform pg_temp.r('M5 every definer function pins search_path', n_def_nopath = 0, n_def_nopath::text);
end $$;

select test, pass, detail from t_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from t_results;

rollback;
