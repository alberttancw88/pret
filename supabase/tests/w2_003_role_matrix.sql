-- PRET W2-003 — role matrix and guards for the M1 employee tables (rls-policies.md §5.3, §7, §8, §12).
-- Runs entirely inside ONE transaction that is rolled back: no data is left behind.
-- Synthetic fixtures only (example.invalid emails, random UUIDs, random bytes as "ciphertext"). Run as postgres:
--   node --env-file=.env.local supabase/tests/run.cjs supabase/tests/w2_003_role_matrix.sql
-- Output: one row per test (name, pass, detail) and a summary; every row must have pass = true.

begin;
-- W2-005: pin the security settings the assertions assume (pret-dev runs with MFA off / longer idle timeouts; rolled back)
update app.security_settings set mfa_required_privileged = true, idle_timeout_min_employee = 30, idle_timeout_min_privileged = 15 where id = 1;

create temp table t_results (id serial primary key, test text not null, pass boolean not null, detail text);
create temp table fx (n text primary key, auth_id uuid, app_id uuid, emp_id uuid);
create temp table ids (k text primary key, id uuid);
grant select, insert, update on fx, ids to authenticated;

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

-- Runs one statement and returns the error text ('no error' when it succeeded).
create function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'no error';
exception when others then
  return sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Org fixtures (system): grade + position; first active department / location / pattern
-- ---------------------------------------------------------------------------
with g as (insert into app.grades (code, name, rank) values ('W3G1', 'W3 TEST grade', 991) returning id) insert into ids select 'grade', id from g;
with p as (insert into app.positions (code, title) values ('W3POS', 'W3 TEST position') returning id) insert into ids select 'pos', id from p;
insert into ids select 'dept', id from app.departments where is_active order by code limit 1;
insert into ids select 'loc', id from app.work_locations where is_active order by name limit 1;
insert into ids select 'pat', id from app.working_patterns where is_active order by name limit 1;
with b as (select id from app.banks order by code limit 1) insert into ids select 'bank', id from b;

-- Employee fixture (system write: guards for direct user writes do not apply)
create function pg_temp.mk_emp(p_id uuid, p_no text, p_mgr uuid, p_join date, p_prob int default 3, p_top boolean default false) returns void
language plpgsql as $$
begin
  insert into app.employees (id, employee_no, full_name, gender, work_email, mobile_phone, join_date, probation_months,
                             department_id, position_id, grade_id, manager_employee_id, work_location_id, work_state, working_pattern_id, status)
  values (p_id, p_no, 'Sample Employee ' || regexp_replace(p_no, '[^A-Za-z]', '', 'g'), 'female', lower(p_no) || '@example.invalid', '+60120000000', p_join, p_prob,
          (select id from ids where k = 'dept'), (select id from ids where k = 'pos'), (select id from ids where k = 'grade'), p_mgr,
          (select id from ids where k = 'loc'), 'SGR', (select id from ids where k = 'pat'), 'confirmed');
  insert into app.employee_personal (employee_id, nric_enc, nric_last4, nric_bidx, date_of_birth, personal_email, res_addr_line1,
                                     res_postcode, res_city, res_state, continuous_service_date)
  values (p_id, extensions.gen_random_bytes(40), '0000', extensions.gen_random_bytes(32), date '1990-01-01',
          lower(p_no) || '.home@example.invalid', '1 Jalan Contoh', '50000', 'Kuala Lumpur', 'KUL', p_join);
  insert into app.employee_sensitive (employee_id, religion) values (p_id, 'none');
  insert into app.employee_hr_private (employee_id, is_top_of_org) values (p_id, p_top);
  insert into app.employee_statutory_profiles (employee_id) values (p_id);
  insert into app.employee_statutory_employer_flags (employee_id) values (p_id);
  insert into app.employee_marital_history (employee_id, marital_status, effective_date) values (p_id, 'single', p_join);
  insert into app.employee_emergency_contacts (employee_id, priority, name, relationship, mobile_phone)
  values (p_id, 1, 'Sample Contact', 'parent', '+60120000001');
end $$;

-- Other environments may already have a Top of organisation (e.g. the dev seed): allow a few inside this test.
update app.security_settings set max_top_of_org = 5 where id = 1;

-- People: sa (top), adm (internal ADM), mgr → emp1 → emp3 (indirect), emp2 (not mgr's), ext (external ADM)
insert into fx (n, auth_id, emp_id) values
  ('sa',   gen_random_uuid(), gen_random_uuid()),
  ('adm',  gen_random_uuid(), gen_random_uuid()),
  ('mgr',  gen_random_uuid(), gen_random_uuid()),
  ('emp1', gen_random_uuid(), gen_random_uuid()),
  ('emp2', gen_random_uuid(), gen_random_uuid()),
  ('emp3', gen_random_uuid(), gen_random_uuid()),
  ('ext',  gen_random_uuid(), null);

select pg_temp.mk_emp((select emp_id from fx where n = 'sa'),   'W3T-SA',   null, app.today_myt() - 900, 0, true);
select pg_temp.mk_emp((select emp_id from fx where n = 'adm'),  'W3T-ADM',  (select emp_id from fx where n = 'sa'),  app.today_myt() - 800, 0);
select pg_temp.mk_emp((select emp_id from fx where n = 'mgr'),  'W3T-MGR',  (select emp_id from fx where n = 'sa'),  app.today_myt() - 700, 0);
select pg_temp.mk_emp((select emp_id from fx where n = 'emp1'), 'W3T-EMP1', (select emp_id from fx where n = 'mgr'), app.today_myt() - 30);
select pg_temp.mk_emp((select emp_id from fx where n = 'emp2'), 'W3T-EMP2', (select emp_id from fx where n = 'sa'),  app.today_myt() - 600, 0);
select pg_temp.mk_emp((select emp_id from fx where n = 'emp3'), 'W3T-EMP3', (select emp_id from fx where n = 'emp1'), app.today_myt() - 20);

insert into auth.users (id, email, aud, role)
select auth_id, 'pret-w3-' || n || '@example.invalid', 'authenticated', 'authenticated' from fx;
insert into app.app_users (auth_user_id, user_type, employee_id, login_email, display_name, status, access_start_date, access_end_date, service_provider)
select f.auth_id, case when f.emp_id is null then 'external' else 'employee' end::app.user_type, f.emp_id,
       'pret-w3-' || f.n || '@example.invalid', 'W3 Test ' || upper(f.n), 'active', app.today_myt() - 30,
       case f.n when 'ext' then app.today_myt() + 90 end, case when f.emp_id is null then 'Example Outsourcing (TEST)' end
  from fx f;
update fx set app_id = u.id from app.app_users u where u.login_email = 'pret-w3-' || fx.n || '@example.invalid';
insert into app.user_roles (user_id, role, granted_by) values ((select app_id from fx where n = 'sa'), 'SA', '00000000-0000-0000-0000-000000000001');
insert into app.user_roles (user_id, role, granted_by) select app_id, 'ADM', (select app_id from fx where n = 'sa') from fx where n in ('adm','ext');

-- Documents for emp1: one visible offer letter, one HR-only
insert into app.files (id, bucket, storage_path, subject, owner_employee_id, original_name, mime_type, size_bytes, status, created_by)
select gen_random_uuid(), 'employee-files', 'emp/' || emp_id || '/docs/w3/' || x || '.pdf', 'employee_document', emp_id, x || '.pdf',
       'application/pdf', 1000, 'active', (select app_id from fx where n = 'adm')
  from fx, unnest(array['offer','memo','proof']) x where n = 'emp1';
insert into app.employee_documents (employee_id, category, title, file_id, visible_to_employee)
select f.owner_employee_id, 'offer_letter', 'W3 offer', f.id, true from app.files f where f.storage_path like '%/docs/w3/offer.pdf';
insert into app.employee_documents (employee_id, category, title, file_id, visible_to_employee)
select f.owner_employee_id, 'other', 'W3 memo', f.id, false from app.files f where f.storage_path like '%/docs/w3/memo.pdf';
insert into app.hr_notes (employee_id, note_date, body) select emp_id, app.today_myt(), 'W3 test note' from fx where n = 'emp1';
insert into ids select 'proof', id from app.files where storage_path like '%/docs/w3/proof.pdf';

-- ===========================================================================
-- A. anon
-- ===========================================================================
do $$ declare e1 text; e2 text;
begin
  execute 'set local role anon';
  begin perform 1 from app.employees limit 1; e1 := 'no error'; exception when others then e1 := sqlerrm; end;
  begin perform app.decide_change_request(gen_random_uuid(), 'approve', null, null); e2 := 'no error'; exception when others then e2 := sqlerrm; end;
  reset role;
  perform pg_temp.r('A1 anon cannot read employees', e1 like '%permission denied%', e1);
  perform pg_temp.r('A2 anon cannot call CR decisions', e2 like '%permission denied%', e2);
end $$;

-- ===========================================================================
-- B. Employee (EMP1) — own record only; E✎ fields only; CR for the rest
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'emp1'); me uuid := (select emp_id from fx where n = 'emp1');
  other uuid := (select emp_id from fx where n = 'emp2');
  c_emp int; c_pers int; c_pers_other int; c_sens int; c_hr int; c_flags int; c_notes int; c_sepd int; c_docs int; c_dir int;
  c_bank_other int; c_trail int; c_compl int; c_names int;
  e_name text; e_mail text; e_bank text; e_spouse text; e_cr_other text; e_dec text; e_read text; e_status text; e_csd text;
  c_upd int; v_cr uuid; v_crno text; e_approve_self text; c_cancel int;
begin
  perform pg_temp.login(s);
  select count(*) into c_emp from app.employees;
  select count(*) into c_pers from app.employee_personal where employee_id = me;
  select count(*) into c_pers_other from app.employee_personal where employee_id = other;
  select count(*) into c_sens from app.employee_sensitive;
  select count(*) into c_hr from app.employee_hr_private;
  select count(*) into c_flags from app.employee_statutory_employer_flags;
  select count(*) into c_notes from app.hr_notes;
  select count(*) into c_sepd from app.employee_separation_details;
  select count(*) into c_docs from app.employee_documents;
  select count(*) into c_dir from app.employee_directory where employee_no like 'W3T-%';
  select count(*) into c_trail from audit.employee_trail(me, null, null);
  select count(*) into c_compl from app.employee_completeness(array[me]);
  select count(*) into c_names from app.employee_names(array[other]);
  update app.employees set preferred_name = 'Ems' where id = me; get diagnostics c_upd = row_count;
  e_name := pg_temp.err(format('update app.employees set full_name = %L where id = %L', 'Changed Name', me));
  e_mail := pg_temp.err(format('update app.employees set work_email = %L where id = %L', 'x@example.invalid', me));
  e_csd  := pg_temp.err(format('update app.employee_personal set continuous_service_date = continuous_service_date - 1 where employee_id = %L', me));
  e_status := pg_temp.err(format('update app.employees set status = %L where id = %L', 'separated', me));
  e_bank := pg_temp.err(format('insert into app.employee_bank_accounts (employee_id, payment_method, effective_from, verified_by) values (%L, ''cash'', app.today_myt(), app.current_app_user_id())', me));
  e_spouse := pg_temp.err(format('insert into app.employee_spouses (employee_id, full_name, nric_enc, nric_last4, nric_bidx, working_status) values (%L, ''X'', ''\x00'', ''1234'', ''\x01'', ''working'')', me));
  -- own legal-name change request
  insert into app.change_requests (employee_id, category, effective_date) values (me, 'legal_name', app.today_myt()) returning id, cr_no into v_cr, v_crno;
  insert into app.change_request_items (change_request_id, employee_id, target_table, target_row_id, field_name, new_value)
  values (v_cr, me, 'employees', me, 'full_name', to_jsonb('Sample Employee Renamed'::text));
  insert into ids values ('cr_emp1', v_cr);
  e_cr_other := pg_temp.err(format('insert into app.change_requests (employee_id, category, effective_date) values (%L, ''religion'', app.today_myt())', other));
  e_approve_self := pg_temp.err(format('update app.change_requests set status = ''approved'' where id = %L', v_cr));
  e_dec := pg_temp.err(format('select app.decide_change_request(%L, ''approve'', null, null)', v_cr));
  e_read := pg_temp.err(format('select * from app.read_employee_sensitive(%L, ''test'')', other));
  reset role;
  perform pg_temp.r('B1 EMP sees own row + own reportee only (EMP1 manages EMP3)', c_emp = 2, c_emp::text);
  perform pg_temp.r('B2 EMP reads own personal row, not others''', c_pers = 1 and c_pers_other = 0, c_pers || '/' || c_pers_other);
  perform pg_temp.r('B3 EMP reads own special-category row only', c_sens = 1, c_sens::text);
  perform pg_temp.r('B4 EMP sees no T3 data (HR-private, employer flags, notes, separation details)', c_hr + c_flags + c_notes + c_sepd = 0,
                    c_hr || '/' || c_flags || '/' || c_notes || '/' || c_sepd);
  perform pg_temp.r('B5 EMP sees only visible documents', c_docs = 1, c_docs::text);
  perform pg_temp.r('B6 EMP sees listed directory rows (FR-EMP-14)', c_dir >= 5, c_dir::text);
  perform pg_temp.r('B7 EMP gets no audit trail / completeness rows', c_trail = 0 and c_compl = 0, c_trail || '/' || c_compl);
  perform pg_temp.r('B8 EMP resolves directory-level names', c_names = 1, c_names::text);
  perform pg_temp.r('B9 EMP self-updates preferred name (E✎)', c_upd = 1, c_upd::text);
  perform pg_temp.r('B10 EMP cannot change own legal name directly (E→CR)', e_name like '%PRET-SELF-002%', e_name);
  perform pg_temp.r('B11 EMP cannot change own work email', e_mail like '%permission denied%' or e_mail like '%PRET-SELF-002%', e_mail);
  perform pg_temp.r('B12 EMP cannot change own continuous-service date', e_csd like '%PRET-SELF-002%', e_csd);
  perform pg_temp.r('B13 status is not writable (system-derived)', e_status like '%permission denied%', e_status);
  perform pg_temp.r('B14 EMP cannot write own bank details', e_bank like '%row-level security%' or e_bank like '%PRET-SELF-002%', e_bank);
  perform pg_temp.r('B15 EMP cannot write own family rows', e_spouse like '%row-level security%' or e_spouse like '%PRET-SELF-002%', e_spouse);
  perform pg_temp.r('B16 CR number allocated CR-yyyy-nnnnn', v_crno ~ '^CR-[0-9]{4}-[0-9]{5}$', v_crno);
  perform pg_temp.r('B17 EMP cannot raise a CR for someone else', e_cr_other <> 'no error', e_cr_other);
  perform pg_temp.r('B18 EMP cannot approve own CR by update', e_approve_self like '%PRET-CR-CANCEL-ONLY%', e_approve_self);
  perform pg_temp.r('B19 EMP cannot call the decision function', e_dec like '%PRET-ACC-403%', e_dec);
  perform pg_temp.r('B20 EMP cannot read another employee''s religion/OKU', e_read like '%PRET-ACC-403%', e_read);
end $$;

-- ===========================================================================
-- C. Manager (derived) — T1 of direct + indirect reportees; nothing in T2/T3/T4
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'mgr'); r1 uuid := (select emp_id from fx where n = 'emp1');
  r3 uuid := (select emp_id from fx where n = 'emp3'); o uuid := (select emp_id from fx where n = 'emp2');
  c_emp int; c_other int; c_ind int; c_ec int; c_t2 int; c_sens int; c_docs int; c_upd int; e_rec_other text; c_rec int; e_upd_other text;
begin
  perform pg_temp.login(s);
  select count(*) into c_emp from app.employees;
  select count(*) into c_other from app.employees where id = o;
  select count(*) into c_ind from app.employees where id = r3;
  select count(*) into c_ec from app.employee_emergency_contacts where employee_id = r1;
  select (select count(*) from app.employee_personal where employee_id = r1) + (select count(*) from app.employee_spouses where employee_id = r1)
       + (select count(*) from app.employee_children where employee_id = r1) + (select count(*) from app.employee_statutory_profiles where employee_id = r1)
       + (select count(*) from app.employee_bank_accounts where employee_id = r1) + (select count(*) from app.employee_marital_history where employee_id = r1)
       + (select count(*) from app.change_requests where employee_id = r1)
    into c_t2;
  select count(*) into c_sens from app.employee_sensitive where employee_id = r1;
  select count(*) into c_docs from app.employee_documents where employee_id = r1;
  update app.employees set preferred_name = 'Hacked' where id = r1; get diagnostics c_upd = row_count;
  insert into app.probation_recommendations (employee_id, recommendation, remarks, recommended_by)
  values (r1, 'confirm', 'Good progress', app.current_app_user_id());
  select count(*) into c_rec from app.probation_recommendations where employee_id = r1;
  e_rec_other := pg_temp.err(format('insert into app.probation_recommendations (employee_id, recommendation, remarks, recommended_by) values (%L, ''confirm'', ''x'', app.current_app_user_id())', o));
  reset role;
  perform pg_temp.r('C1 MGR sees self + direct + indirect reportees (3)', c_emp = 3, c_emp::text);
  perform pg_temp.r('C2 MGR does not see a non-reportee', c_other = 0, c_other::text);
  perform pg_temp.r('C3 MGR sees an indirect reportee', c_ind = 1, c_ind::text);
  perform pg_temp.r('C4 MGR sees reportee emergency contacts (Q26)', c_ec = 1, c_ec::text);
  perform pg_temp.r('C5 MGR sees no reportee T2 data (MyKad, family, statutory, bank, CRs)', c_t2 = 0, c_t2::text);
  perform pg_temp.r('C6 MGR sees no religion/OKU', c_sens = 0, c_sens::text);
  perform pg_temp.r('C7 MGR sees no reportee documents', c_docs = 0, c_docs::text);
  perform pg_temp.r('C8 MGR cannot update a reportee record', c_upd = 0, c_upd::text);
  perform pg_temp.r('C9 MGR records a probation recommendation for a reportee', c_rec = 1, c_rec::text);
  perform pg_temp.r('C10 MGR cannot recommend for a non-reportee', e_rec_other like '%row-level security%' or e_rec_other like '%PRET-EMP-NOT-ON-PROBATION%', e_rec_other);
end $$;

-- ===========================================================================
-- D. Admin at aal1 (MFA required) — only own (EMP) view
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'adm'); c_emp int; e_ins text;
begin
  perform pg_temp.login(s, 'aal1');
  select count(*) into c_emp from app.employees;
  e_ins := pg_temp.err(format('insert into app.employee_hr_private (employee_id) values (%L)', gen_random_uuid()));
  reset role;
  perform pg_temp.r('D1 ADM at aal1 sees only own employee row', c_emp = 1, c_emp::text);
  perform pg_temp.r('D2 ADM at aal1 cannot write HR data', e_ins like '%row-level security%', e_ins);
end $$;

-- ===========================================================================
-- E. Admin at aal2 — all records; not own sensitive fields; no self-decision
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'adm'); me uuid := (select emp_id from fx where n = 'adm');
  e1 uuid := (select emp_id from fx where n = 'emp1'); e2 uuid := (select emp_id from fx where n = 'emp2');
  c_emp int; c_t3 int; e_sp_self text; e_name_self text; c_pref int; e_bank_self text; e_sens_self text; c_access_before int; c_access_after int;
  v_bank uuid; e_no text; v_status app.employment_status; e_conf_self text; c_jobrow int; v_cr uuid; e_dec_self text; v_name text;
  v_crst app.cr_status; e_loop text; e_own_mgr text; v_future uuid; e_del_past text; c_del int; e_past_upd text; v_doc_vis boolean;
  c_rev int; c_trail int; c_compl int; v_sep uuid; v_st2 app.employment_status; v_end date; v_st3 app.employment_status; e_top text;
  c_sp int; e_dup text; v_prop uuid;
begin
  perform pg_temp.login(s, 'aal2');
  select count(*) into c_emp from app.employees where employee_no like 'W3T-%';
  select count(*) into c_t3 from app.employee_hr_private where employee_id in (select emp_id from fx);
  insert into app.employee_spouses (employee_id, full_name, nric_enc, nric_last4, nric_bidx, working_status)
  values (e1, 'Sample Spouse', extensions.gen_random_bytes(40), '1111', extensions.gen_random_bytes(32), 'not_working');
  select count(*) into c_sp from app.employee_spouses where employee_id = e1;
  e_sp_self := pg_temp.err(format('insert into app.employee_spouses (employee_id, full_name, nric_enc, nric_last4, nric_bidx, working_status) values (%L, ''X'', ''\x00'', ''1234'', ''\x01'', ''working'')', me));
  e_name_self := pg_temp.err(format('update app.employees set full_name = %L where id = %L', 'Admin Renamed', me));
  update app.employees set preferred_name = 'Admy' where id = me; get diagnostics c_pref = row_count;
  -- bank for another employee (D15: no confirmation; N-41 fires)
  insert into app.employee_bank_accounts (employee_id, payment_method, bank_id, account_type, account_no_enc, account_no_last4, account_no_bidx,
                                          account_holder_name, proof_file_id, effective_from, verified_by)
  values (e1, 'bank_transfer', (select id from ids where k = 'bank'), 'savings', extensions.gen_random_bytes(40), '4321',
          extensions.gen_random_bytes(32), 'Sample Employee W3T-EMP1', (select id from ids where k = 'proof'), app.today_myt(), app.current_app_user_id())
  returning id into v_bank;
  e_bank_self := pg_temp.err(format('insert into app.employee_bank_accounts (employee_id, payment_method, effective_from, verified_by) values (%L, ''cash'', app.today_myt(), app.current_app_user_id())', me));
  e_sens_self := pg_temp.err(format('select app.write_employee_sensitive(%L, ''islam'', false, null)', me));
  perform * from app.read_employee_sensitive(e1, 'E3 personal tab');
  e_no := pg_temp.err(format('update app.employees set employee_no = %L where id = %L', 'W3T-NEW', e2));
  v_status := app.confirm_employee(e1, app.today_myt(), 'Confirmed after review');
  select count(*) into c_jobrow from app.employee_job_history where employee_id = e1 and change_type = 'confirmation';
  e_conf_self := pg_temp.err(format('select app.extend_probation(%L, app.today_myt() + 200, ''x'')', me));
  -- decide EMP1's CR (approve → applied now)
  v_crst := app.decide_change_request((select id from ids where k = 'cr_emp1'), 'approve', null, null);
  select full_name into v_name from app.employees where id = e1;
  -- reporting lines: loop and own manager
  e_loop := pg_temp.err(format('insert into app.employee_job_history (employee_id, effective_date, change_type, department_id, position_id, grade_id, manager_employee_id, work_location_id, working_pattern_id) select %L, app.today_myt() + 10, ''manager_change'', department_id, position_id, grade_id, %L, work_location_id, working_pattern_id from app.employees where id = %L',
              (select emp_id from fx where n = 'mgr'), (select emp_id from fx where n = 'emp3'), (select emp_id from fx where n = 'mgr')));
  e_own_mgr := pg_temp.err(format('insert into app.employee_job_history (employee_id, effective_date, change_type, department_id, position_id, grade_id, manager_employee_id, work_location_id, working_pattern_id) select %L, app.today_myt() + 11, ''manager_change'', department_id, position_id, grade_id, %L, work_location_id, working_pattern_id from app.employees where id = %L', e2, e2, e2));
  -- future-dated promotion (Scheduled) then delete it; past rows cannot be deleted or edited except as data correction
  insert into app.employee_job_history (employee_id, effective_date, change_type, department_id, position_id, grade_id, manager_employee_id,
                                        work_location_id, working_pattern_id, remarks)
  select e2, app.today_myt() + 30, 'promotion', department_id, position_id, grade_id, manager_employee_id, work_location_id, working_pattern_id, 'W3 test'
    from app.employees where id = e2 returning id into v_future;
  update app.employee_job_history set is_deleted = true, delete_reason = 'Plans changed' where id = v_future; get diagnostics c_del = row_count;
  e_del_past := pg_temp.err(format('update app.employee_job_history set is_deleted = true, delete_reason = ''x'' where employee_id = %L and change_type = ''new_hire''', e2));
  e_past_upd := pg_temp.err(format('update app.employee_job_history set remarks = ''edit'' where employee_id = %L and change_type = ''new_hire''', e2));
  -- documents: HR-only category forced invisible
  update app.employee_documents set category = 'mykad_copy', visible_to_employee = true where title = 'W3 memo';
  select visible_to_employee into v_doc_vis from app.employee_documents where title = 'W3 memo';
  update app.hr_notes set body = 'W3 test note (edited)' where employee_id = e1;
  select count(*) into c_rev from app.hr_note_revisions where employee_id = e1;
  select count(*) into c_trail from audit.employee_trail(e1, null, null);
  select count(*) into c_compl from app.employee_completeness(array[e1, e2]);
  -- separation with a future LWD → Notice Period; access end follows G7; withdraw → Confirmed again
  insert into app.employee_separations (employee_id, notice_date, separation_type, last_working_day)
  values (e2, app.today_myt(), 'resignation', app.today_myt() + 40) returning id into v_sep;
  insert into app.employee_separation_details (separation_id, employee_id, reason_category, notice_required_days, notice_outcome, portal_access_end_date)
  values (v_sep, e2, 'personal', 42, 'served', app.today_myt() + 45);
  select status into v_st2 from app.employees where id = e2;
  select access_end_date into v_end from app.app_users where employee_id = e2;
  v_st3 := app.withdraw_resignation(e2, 'Stays with us');
  e_top := pg_temp.err(format('update app.employee_hr_private set is_top_of_org = true where employee_id = %L', e2));
  -- MyKad uniqueness (blind index)
  e_dup := pg_temp.err(format('update app.employee_personal set nric_bidx = (select nric_bidx from app.employee_personal where employee_id = %L) where employee_id = %L', e1, e2));
  reset role;
  perform pg_temp.r('E1 ADM (aal2) sees every employee', c_emp = 6, c_emp::text);
  perform pg_temp.r('E2 ADM reads T3 HR-private rows', c_t3 = 6, c_t3::text);
  perform pg_temp.r('E3 ADM adds a spouse for another employee', c_sp = 1, c_sp::text);
  perform pg_temp.r('E4 ADM cannot add family rows to own record (P-HR-NOT-OWN)', e_sp_self like '%row-level security%' or e_sp_self like '%PRET-SELF-002%', e_sp_self);
  perform pg_temp.r('E5 ADM cannot edit own legal name (US-EMP-027)', e_name_self like '%PRET-SELF-002%', e_name_self);
  perform pg_temp.r('E6 ADM may self-update own E✎ fields', c_pref = 1, c_pref::text);
  perform pg_temp.r('E7 ADM saves bank details for another employee (no confirmation, D15)', v_bank is not null, coalesce(v_bank::text, 'null'));
  perform pg_temp.r('E8 ADM cannot write own bank details', e_bank_self like '%row-level security%' or e_bank_self like '%PRET-SELF-002%', e_bank_self);
  perform pg_temp.r('E9 ADM cannot write own religion/OKU', e_sens_self like '%PRET-SELF-002%', e_sens_self);
  perform pg_temp.r('E11 ADM cannot change the employee no. (SA only)', e_no like '%PRET-EMP-NO-SA%', e_no);
  perform pg_temp.r('E12 confirm → Confirmed + Confirmation job row', v_status = 'confirmed' and c_jobrow = 1, v_status || '/' || c_jobrow);
  perform pg_temp.r('E13 ADM cannot extend own probation', e_conf_self like '%PRET-SELF-001%', e_conf_self);
  perform pg_temp.r('E14 approved legal-name CR is applied', v_crst = 'approved' and v_name = 'Sample Employee Renamed', v_crst || '/' || v_name);
  perform pg_temp.r('E15 reporting loop blocked (EC-EMP-03)', e_loop like '%PRET-EMP-LOOP%', e_loop);
  perform pg_temp.r('E16 own manager blocked', e_own_mgr like '%PRET-EMP-OWN-MANAGER%' or e_own_mgr like '%chk_job_not_own_manager%', e_own_mgr);
  perform pg_temp.r('E17 future-dated job change can be deleted (EC-EMP-06)', c_del = 1, c_del::text);
  perform pg_temp.r('E18 past job row cannot be deleted', e_del_past like '%PRET-JOB%', e_del_past);
  perform pg_temp.r('E19 past job row edit needs Data correction', e_past_upd like '%PRET-JOB-PAST-CORRECTION%', e_past_upd);
  perform pg_temp.r('E20 HR-only document category is never visible', v_doc_vis = false, coalesce(v_doc_vis::text, 'null'));
  perform pg_temp.r('E21 HR note edits keep a revision', c_rev = 1, c_rev::text);
  perform pg_temp.r('E22 ADM reads the activity trail', c_trail >= 3, c_trail::text);
  perform pg_temp.r('E23 ADM reads completeness', c_compl = 2, c_compl::text);
  perform pg_temp.r('E24 separation with future LWD → Notice Period; access end = G7', v_st2 = 'notice_period' and v_end = app.today_myt() + 45,
                    v_st2 || '/' || coalesce(v_end::text, 'null'));
  perform pg_temp.r('E25 resignation withdrawn → Confirmed', v_st3 = 'confirmed', v_st3::text);
  perform pg_temp.r('E26 ADM cannot set Top of organisation (SA only)', e_top like '%PRET-EMP-TOP-SA%', e_top);
  perform pg_temp.r('E27 MyKad unique across employees (blind index)', e_dup like '%ux_employee_personal_nric_bidx%', e_dup);
end $$;

-- N-41 bank-change alert (DB-enforced fraud control)
select pg_temp.r('E28 bank change notifies the employee (in-app) and every SA',
  (select count(*) from app.notifications where event_code = 'N-41' and recipient_user_id in ((select app_id from fx where n = 'emp1'), (select app_id from fx where n = 'sa'))) = 2,
  (select count(*)::text from app.notifications where event_code = 'N-41'));
select pg_temp.r('E29 bank change emails the personal address',
  exists (select 1 from app.email_outbox where template_code = 'bank_details_changed' and to_address = 'w3t-emp1.home@example.invalid'), null);
select pg_temp.r('E30 approved CR notifies the employee (N-42)',
  exists (select 1 from app.notifications where event_code = 'N-42' and recipient_user_id = (select app_id from fx where n = 'emp1')), null);
select pg_temp.r('E31 submitted CR notified Admins (N-43)',
  exists (select 1 from app.notifications where event_code = 'N-43' and recipient_user_id = (select app_id from fx where n = 'adm')), null);

-- ===========================================================================
-- F. External administrator (ADM, aal2) — HR access, never an employee
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'ext'); c_emp int; v_emp uuid; e_rec text;
begin
  perform pg_temp.login(s, 'aal2');
  select count(*) into c_emp from app.employees where employee_no like 'W3T-%';
  v_emp := app.current_employee_id();
  e_rec := pg_temp.err(format('insert into app.change_requests (employee_id, category, effective_date) values (%L, ''race'', app.today_myt())', (select emp_id from fx where n = 'emp2')));
  reset role;
  perform pg_temp.r('F1 external ADM sees employee records', c_emp = 6, c_emp::text);
  perform pg_temp.r('F2 external ADM has no employee identity', v_emp is null, coalesce(v_emp::text, 'null'));
  perform pg_temp.r('F3 external ADM cannot raise CRs for employees', e_rec <> 'no error', e_rec);
end $$;

-- ===========================================================================
-- G. Super Admin — SA-only fields; still no self-decision
-- ===========================================================================
do $$ declare s uuid := (select auth_id from fx where n = 'sa'); me uuid := (select emp_id from fx where n = 'sa');
  e2 uuid := (select emp_id from fx where n = 'emp2'); c_no int; v_cr uuid; e_self text; e_top text;
begin
  perform pg_temp.login(s, 'aal2');
  update app.employees set employee_no = 'W3T-EMP2B' where id = e2; get diagnostics c_no = row_count;
  e_top := pg_temp.err(format('update app.employee_hr_private set is_top_of_org = false where employee_id = %L', e2));
  insert into app.change_requests (employee_id, category, effective_date) values (me, 'race', app.today_myt()) returning id into v_cr;
  insert into app.change_request_items (change_request_id, employee_id, target_table, target_row_id, field_name, new_value)
  values (v_cr, me, 'employee_personal', me, 'race', to_jsonb('chinese'::text));
  e_self := pg_temp.err(format('select app.decide_change_request(%L, ''approve'', null, null)', v_cr));
  reset role;
  perform pg_temp.r('G1 SA changes an employee no. (BR-EMP-11)', c_no = 1, c_no::text);
  perform pg_temp.r('G2 SA may set Top of organisation', e_top = 'no error', e_top);
  perform pg_temp.r('G3 SA cannot decide own CR (FR-G-16)', e_self like '%PRET-SELF-001%', e_self);
  perform pg_temp.login(s, 'aal2');
  select count(*) into c_no from audit.access_log where action = 'view_sensitive' and entity_id = (select emp_id from fx where n = 'emp1')
     and reason = 'E3 personal tab';
  reset role;
  perform pg_temp.r('G5 HR read of religion/OKU was access-logged (E10 / BR-ADM-21)', c_no = 1, c_no::text);
end $$;
select pg_temp.r('G4 decided_by_employee ≠ requester enforced by CHECK',
  pg_temp.err(format('update app.change_requests set status = ''approved'', decided_by_employee_id = employee_id where id = %L', (select id from ids where k = 'cr_emp1'))) like '%chk_cr_not_self%', null);

-- ===========================================================================
-- H. Guards
-- ===========================================================================
do $$ declare e1 uuid := (select emp_id from fx where n = 'emp1'); e3 uuid := (select emp_id from fx where n = 'emp3');
  v_cr uuid; e_open text; e_tgt text; e_fld text; v_pj app.employment_status; v_new uuid := gen_random_uuid(); e_mgr text; e_ec text; e_ext text;
  v_job jsonb; e_spmax text; i int;
begin
  -- CR whitelists (as EMP1)
  perform pg_temp.login((select auth_id from fx where n = 'emp1'));
  insert into app.change_requests (employee_id, category, effective_date) values (e1, 'children', app.today_myt()) returning id into v_cr;
  e_open := pg_temp.err(format('insert into app.change_requests (employee_id, category, effective_date) values (%L, ''children'', app.today_myt())', e1));
  e_tgt := pg_temp.err(format('insert into app.change_request_items (change_request_id, employee_id, target_table, target_row_id, field_name, op, new_value) values (%L, %L, ''employee_spouses'', (select id from app.employee_spouses limit 1), ''full_name'', ''update'', ''"x"'')', v_cr, e1));
  e_fld := pg_temp.err(format('insert into app.change_request_items (change_request_id, employee_id, target_table, target_row_id, field_name, new_value) values (%L, %L, ''employees'', %L, ''work_email'', ''"x@example.invalid"'')', v_cr, e1, e1));
  reset role;
  perform pg_temp.r('H1 one open CR per category (EC-EMP-07)', e_open like '%ux_cr_one_open_per_category%', e_open);
  perform pg_temp.r('H2 CR item outside its category refused', e_tgt like '%PRET-CR-FIELD%' or e_tgt like '%PRET-CR-TARGET%', e_tgt);
  perform pg_temp.r('H3 CR item for a non-CR field refused', e_fld like '%PRET-CR-FIELD%', e_fld);

  -- status is derived: future join → Pending Join
  perform pg_temp.mk_emp(v_new, 'W3T-NEW1', (select emp_id from fx where n = 'sa'), app.today_myt() + 20);
  select status into v_pj from app.employees where id = v_new;
  perform pg_temp.r('H4 future join date → Pending Join (BR-EMP-30)', v_pj = 'pending_join', v_pj::text);

  -- deferred checks fire at commit — force them now
  begin
    update app.employees set manager_employee_id = null where id = e3;
    set constraints all immediate;
    e_mgr := 'no error';
  exception when others then e_mgr := sqlerrm;
  end;
  set constraints all deferred;
  perform pg_temp.r('H5 manager required unless Top of organisation', e_mgr like '%PRET-EMP-MANAGER-REQUIRED%', e_mgr);
end $$;

do $$ declare e3 uuid := (select emp_id from fx where n = 'emp3'); e_ec text; e_spmax text; i int; e_ext text; v_sum jsonb; v_cnt int;
begin
  -- restore e3's manager (H5 rolled back only the statement) and test emergency contacts min one
  begin
    delete from app.employee_emergency_contacts where employee_id = e3;
    set constraints all immediate;
    e_ec := 'no error';
  exception when others then e_ec := sqlerrm;
  end;
  set constraints all deferred;
  perform pg_temp.r('H6 at least one emergency contact remains', e_ec like '%PRET-EMP-EMERGENCY-MIN%', e_ec);
  -- max 4 current spouses
  begin
    for i in 1..5 loop
      insert into app.employee_spouses (employee_id, full_name, nric_enc, nric_last4, nric_bidx, working_status)
      values (e3, 'Sample Spouse ' || i, extensions.gen_random_bytes(40), '000' || i, extensions.gen_random_bytes(32), 'working');
    end loop;
    e_spmax := 'no error';
  exception when others then e_spmax := sqlerrm;
  end;
  perform pg_temp.r('H7 at most 4 current spouses', e_spmax like '%PRET-EMP-SPOUSE-MAX%', e_spmax);
  -- probation extension beyond the maximum (as ADM)
  perform pg_temp.login((select auth_id from fx where n = 'adm'), 'aal2');
  e_ext := pg_temp.err(format('select app.extend_probation(%L, app.today_myt() + 500, ''needs more time'')', e3));
  reset role;
  perform pg_temp.r('H8 total probation capped by the setting', e_ext like '%PRET-EMP-EXTEND-MAX%', e_ext);
  -- the daily job runs (system)
  perform set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);   -- system context (pg_cron)
  v_sum := app.run_employee_daily_job(true);
  select count(*) into v_cnt from app.job_runs where job_name = 'employee-daily' and status = 'succeeded' and business_date = app.today_myt();
  perform pg_temp.r('H9 daily job runs cleanly', v_cnt >= 1 and jsonb_array_length(v_sum -> 'errors') = 0, v_sum::text);
  perform pg_temp.r('H10 daily job is scheduled in pg_cron', exists (select 1 from cron.job where jobname = 'pret-employee-daily'), null);
  perform pg_temp.r('H11 closure has indirect reportee (depth 2)',
    exists (select 1 from app.reporting_closure where manager_employee_id = (select emp_id from fx where n = 'mgr') and employee_id = e3 and depth = 2), null);
end $$;

-- ===========================================================================
-- L. Catalogue lint for the W2-003 objects (rls-policies §12)
-- ===========================================================================
do $$ declare t text[] := array['banks','lhdn_branches','employees','employee_directory','employee_personal','employee_marital_history',
    'employee_sensitive','employee_hr_private','employee_group_members','employee_emergency_contacts','employee_spouses',
    'employee_children','employee_job_history','probation_recommendations','employee_separations','employee_separation_details',
    'employee_statutory_profiles','employee_statutory_employer_flags','employee_bank_accounts','employee_documents','hr_notes',
    'hr_note_revisions','prior_employments','change_requests','change_request_items','change_request_files'];
  tier23 text[] := array['employee_personal','employee_marital_history','employee_sensitive','employee_hr_private','employee_group_members',
    'employee_spouses','employee_children','employee_separation_details','employee_statutory_profiles','employee_statutory_employer_flags',
    'employee_bank_accounts','employee_documents','hr_notes','hr_note_revisions','prior_employments','change_requests',
    'change_request_items','change_request_files'];
  n_unforced int; n_nosel int; n_nocheck int; n_mgr int; n_trig int; n_path int; n_all int;
begin
  select count(*) into n_unforced from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'app' and c.relname = any(t) and not (c.relrowsecurity and c.relforcerowsecurity);
  select count(*) into n_nosel from unnest(t) x where not exists (select 1 from pg_policies p where p.schemaname = 'app' and p.tablename = x and p.cmd = 'SELECT');
  select count(*) into n_nocheck from pg_policies where schemaname = 'app' and cmd in ('INSERT','UPDATE') and with_check is null;
  select count(*) into n_mgr from pg_policies p where p.schemaname = 'app' and p.tablename = any(tier23)
     and (coalesce(p.qual, '') ~ '(is_manager_of|can_see_team_row|is_current_approver_for)'
          or coalesce(p.with_check, '') ~ '(is_manager_of|can_see_team_row|is_current_approver_for)');
  select count(*) into n_trig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute');
  select count(*) into n_path from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','audit') and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  select count(*) into n_all from pg_policies where schemaname = 'app' and cmd = 'ALL';
  perform pg_temp.r('L1 RLS enabled and forced on every W2-003 table', n_unforced = 0, n_unforced::text);
  perform pg_temp.r('L2 every W2-003 table has a SELECT policy', n_nosel = 0, n_nosel::text);
  perform pg_temp.r('L3 every insert/update policy has WITH CHECK', n_nocheck = 0, n_nocheck::text);
  perform pg_temp.r('L4 no T2/T3/T4 policy references a manager helper (§8)', n_mgr = 0, n_mgr::text);
  perform pg_temp.r('L5 no trigger function is executable by authenticated', n_trig = 0, n_trig::text);
  perform pg_temp.r('L6 every definer function pins search_path', n_path = 0, n_path::text);
  perform pg_temp.r('L7 no FOR ALL policies', n_all = 0, n_all::text);
end $$;

select test, pass, detail from t_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from t_results;

rollback;
