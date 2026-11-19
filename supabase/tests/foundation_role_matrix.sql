-- PRET W2-001 — foundation role-matrix, self-action and append-only tests (rls-policies.md §12).
-- Runs entirely inside ONE transaction that is rolled back: no data is left behind.
-- Synthetic fixtures only (example.invalid addresses, random UUIDs). Run as postgres:
--   psql "$DATABASE_URL" -f supabase/tests/foundation_role_matrix.sql      (or via the Supabase MCP execute_sql)
-- Output: one row per test (name, pass, detail) and a summary; every row must have pass = true.

begin;

create temp table t_results (id serial primary key, test text not null, pass boolean not null, detail text);
create temp table fx (n text primary key, auth_id uuid, app_id uuid, emp_id uuid);

create function pg_temp.r(p_test text, p_pass boolean, p_detail text default null) returns void
language sql as $$ insert into t_results (test, pass, detail) values (p_test, coalesce(p_pass, false), p_detail) $$;

-- Impersonate a signed-in user exactly as withUserTx does.
create function pg_temp.login(p_sub uuid, p_aal text default 'aal1', p_sid uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated', 'aal', p_aal,
                      'session_id', coalesce(p_sid, gen_random_uuid()))::text, true);
  perform set_config('request.jwt.claim.sub', p_sub::text, true);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into fx (n, auth_id, emp_id) values
  ('sa',   gen_random_uuid(), gen_random_uuid()),
  ('adm',  gen_random_uuid(), gen_random_uuid()),
  ('ext',  gen_random_uuid(), null),
  ('mgr',  gen_random_uuid(), gen_random_uuid()),
  ('emp1', gen_random_uuid(), gen_random_uuid()),
  ('emp2', gen_random_uuid(), gen_random_uuid()),
  ('dis',  gen_random_uuid(), gen_random_uuid()),
  ('exp',  gen_random_uuid(), null),
  ('inv',  null,              gen_random_uuid());

insert into auth.users (id, email, aud, role)
select auth_id, 'pret-test-' || n || '@example.invalid', 'authenticated', 'authenticated' from fx where auth_id is not null;

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
select f.auth_id,
       case when f.emp_id is null then 'external' else 'employee' end::app.user_type,
       f.emp_id, 'pret-test-' || f.n || '@example.invalid', 'Test ' || upper(f.n),
       case f.n when 'dis' then 'disabled' when 'inv' then 'invited' else 'active' end::app.user_status,
       case f.n when 'exp' then app.today_myt() - 60 else app.today_myt() - 30 end,
       case f.n when 'ext' then app.today_myt() + 90 when 'exp' then app.today_myt() - 1 end,
       case when f.emp_id is null then 'Example Outsourcing (TEST)' end
  from fx f;
update fx set app_id = u.id from app.app_users u where u.login_email = 'pret-test-' || fx.n || '@example.invalid';

insert into app.user_roles (user_id, role, granted_by)
values ((select app_id from fx where n = 'sa'), 'SA', '00000000-0000-0000-0000-000000000001');
insert into app.user_roles (user_id, role, granted_by)
select app_id, 'ADM', (select app_id from fx where n = 'sa') from fx where n in ('adm','ext');

insert into app.reporting_closure (manager_employee_id, employee_id, depth)
values ((select emp_id from fx where n = 'mgr'), (select emp_id from fx where n = 'emp1'), 1);

select app.notify((select app_id from fx where n = 'emp1'), 'N-01', 'Test notification emp1');
select app.notify((select app_id from fx where n = 'emp2'), 'N-01', 'Test notification emp2');

insert into app.files (bucket, storage_path, subject, owner_employee_id, data_category, original_name, mime_type, size_bytes, status, created_by)
select 'claim-files', 'emp/' || emp_id || '/claims/test/receipt.jpg', 'claim_receipt', emp_id, null, 'receipt.jpg', 'image/jpeg', 1000, 'active', app_id
  from fx where n = 'emp1';

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------
-- A. anon has no access to PRET schemas
do $$ declare e text;
begin
  execute 'set local role anon';
  begin perform 1 from app.app_users limit 1; e := 'no error'; exception when others then e := sqlerrm; end;
  reset role;
  perform pg_temp.r('A1 anon cannot use schema app', e like '%permission denied%', e);
end $$;

-- B. Employee (EMP) at aal1
do $$ declare s uuid := (select auth_id from fx where n = 'emp1'); emp2_app uuid := (select app_id from fx where n = 'emp2');
  c_users int; c_roles int; c_sec int; c_co int; c_login int; c_audit int; c_notif int; c_upd int; c_jobs int; roles text[]; e1 text; e2 text; e3 text;
begin
  perform pg_temp.login(s);
  select count(*) into c_users from app.app_users;
  select count(*) into c_roles from app.user_roles;
  select count(*) into c_sec from app.security_settings;
  select count(*) into c_co from app.company_profile;
  select count(*) into c_login from app.login_events;
  select count(*) into c_audit from audit.audit_log;
  select count(*) into c_notif from app.notifications;
  update app.notifications set read_at = now() where recipient_user_id = emp2_app; get diagnostics c_upd = row_count;
  select count(*) into c_jobs from app.job_runs;
  roles := app.current_role_codes();
  begin insert into app.user_roles (user_id, role, granted_by) values (app.current_app_user_id(), 'SA', emp2_app); e1 := 'no error'; exception when others then e1 := sqlerrm; end;
  begin insert into app.app_users (user_type, employee_id, login_email, display_name, access_start_date)
        values ('employee', gen_random_uuid(), 'pret-test-x@example.invalid', 'X', app.today_myt()); e2 := 'no error'; exception when others then e2 := sqlerrm; end;
  begin update app.notifications set title = 'changed'; e3 := 'no error'; exception when others then e3 := sqlerrm; end;
  reset role;
  perform pg_temp.r('B1 EMP sees only own app_users row', c_users = 1, c_users::text);
  perform pg_temp.r('B2 EMP sees no user_roles', c_roles = 0, c_roles::text);
  perform pg_temp.r('B3 EMP cannot read security_settings', c_sec = 0, c_sec::text);
  perform pg_temp.r('B4 EMP reads company_profile (P-ACTIVE)', c_co = 1, c_co::text);
  perform pg_temp.r('B5 EMP cannot read login_events', c_login = 0, c_login::text);
  perform pg_temp.r('B6 EMP cannot read audit_log', c_audit = 0, c_audit::text);
  perform pg_temp.r('B7 EMP sees only own notifications', c_notif = 1, c_notif::text);
  perform pg_temp.r('B8 EMP cannot mark another user''s notification', c_upd = 0, c_upd::text);
  perform pg_temp.r('B9 EMP cannot read job_runs', c_jobs = 0, c_jobs::text);
  perform pg_temp.r('B10 EMP role codes = {EMP}', roles = array['EMP'], roles::text);
  perform pg_temp.r('B11 EMP cannot grant a role', e1 <> 'no error', e1);
  perform pg_temp.r('B12 EMP cannot create users', e2 <> 'no error', e2);
  perform pg_temp.r('B13 notifications: only read_at is updatable', e3 like '%permission denied%', e3);
end $$;

-- C. Manager (derived)
do $$ declare s uuid := (select auth_id from fx where n = 'mgr'); e1 uuid := (select emp_id from fx where n = 'emp1'); e2 uuid := (select emp_id from fx where n = 'emp2');
  a boolean; b boolean; roles text[]; c_users int;
begin
  perform pg_temp.login(s);
  a := app.is_manager_of(e1); b := app.is_manager_of(e2); roles := app.current_role_codes();
  select count(*) into c_users from app.app_users;
  reset role;
  perform pg_temp.r('C1 MGR is manager of reportee', a, a::text);
  perform pg_temp.r('C2 MGR is not manager of non-reportee', not b, b::text);
  perform pg_temp.r('C3 MGR role codes = {MGR,EMP}', roles = array['MGR','EMP'], roles::text);
  perform pg_temp.r('C4 MGR sees only own app_users row', c_users = 1, c_users::text);
end $$;

-- D. Admin (ADM) without MFA (aal1) — privileged rights withheld (F-ADM-07)
do $$ declare s uuid := (select auth_id from fx where n = 'adm'); a boolean; c_sec int; c_users int; roles text[];
begin
  perform pg_temp.login(s, 'aal1');
  a := app.is_admin(); select count(*) into c_sec from app.security_settings; select count(*) into c_users from app.app_users;
  roles := app.current_role_codes();
  reset role;
  perform pg_temp.r('D1 ADM at aal1: is_admin() false', not a, a::text);
  perform pg_temp.r('D2 ADM at aal1: no security_settings', c_sec = 0, c_sec::text);
  perform pg_temp.r('D3 ADM at aal1: only own app_users row', c_users = 1, c_users::text);
  perform pg_temp.r('D4 ADM role codes still show held ADM (for /mfa redirect)', roles = array['ADM','EMP'], roles::text);
end $$;

-- E. Admin (ADM) at aal2
do $$ declare s uuid := (select auth_id from fx where n = 'adm'); sa_app uuid := (select app_id from fx where n = 'sa');
  emp2_app uuid := (select app_id from fx where n = 'emp2'); me uuid; inv_app uuid := (select app_id from fx where n = 'inv');
  a boolean; c_users int; c_roles int; c_sec int; c_sec_upd int; c_sa_upd int; c_self int; c_dis int; c_audit int;
  e_name text; e_role text; e_inv_sa text; e_tok text; inv uuid; c_phone int;
begin
  perform pg_temp.login(s, 'aal2');
  a := app.is_admin(); me := app.current_app_user_id();
  select count(*) into c_users from app.app_users;
  select count(*) into c_roles from app.user_roles;
  select count(*) into c_sec from app.security_settings;
  update app.security_settings set lockout_threshold = 3; get diagnostics c_sec_upd = row_count;
  update app.app_users set display_name = 'hijack' where id = sa_app; get diagnostics c_sa_upd = row_count;
  update app.app_users set status = 'disabled' where id = me; get diagnostics c_self = row_count;
  update app.app_users set status = 'disabled', disabled_reason = 'test' where id = emp2_app; get diagnostics c_dis = row_count;
  select count(*) into c_audit from audit.audit_log;
  begin update app.company_profile set legal_name = 'Renamed'; e_name := 'no error'; exception when others then e_name := sqlerrm; end;
  update app.company_profile set phone = '+60300000001'; get diagnostics c_phone = row_count;
  begin insert into app.user_roles (user_id, role, granted_by) values (emp2_app, 'ADM', me); e_role := 'no error'; exception when others then e_role := sqlerrm; end;
  inv := app.create_invitation(inv_app, extensions.digest('test-token-1', 'sha256'), now() + interval '72 hours');
  begin perform app.create_invitation(sa_app, extensions.digest('test-token-2', 'sha256'), now() + interval '1 hour'); e_inv_sa := 'no error'; exception when others then e_inv_sa := sqlerrm; end;
  begin perform token_hash from app.user_invitations limit 1; e_tok := 'no error'; exception when others then e_tok := sqlerrm; end;
  reset role;
  perform pg_temp.r('E1 ADM at aal2: is_admin() true', a, a::text);
  -- own row + employee users without privileged roles (mgr, emp1, emp2, dis, inv) = 6; never SA/ext rows
  perform pg_temp.r('E2 ADM sees employee users without privileged roles (+ own)', c_users = 6, c_users::text);
  perform pg_temp.r('E3 ADM sees only own user_roles', c_roles = 1, c_roles::text);
  perform pg_temp.r('E4 ADM reads security_settings', c_sec = 1, c_sec::text);
  perform pg_temp.r('E5 ADM cannot change control settings (SA only)', c_sec_upd = 0, c_sec_upd::text);
  perform pg_temp.r('E6 ADM cannot edit the SA''s user', c_sa_upd = 0, c_sa_upd::text);
  perform pg_temp.r('E7 ADM cannot change own access (not self)', c_self = 0, c_self::text);
  perform pg_temp.r('E8 ADM can disable an employee user', c_dis = 1, c_dis::text);
  perform pg_temp.r('E9 ADM cannot read audit_log (SA only)', c_audit = 0, c_audit::text);
  perform pg_temp.r('E10 ADM cannot change company legal name (SA-only column)', e_name like '%PRET-ORG-SA-ONLY%', e_name);
  perform pg_temp.r('E11 ADM can change non-statutory company fields', c_phone = 1, c_phone::text);
  perform pg_temp.r('E12 ADM cannot grant roles', e_role <> 'no error', e_role);
  perform pg_temp.r('E13 ADM can invite an employee user', inv is not null, inv::text);
  perform pg_temp.r('E14 ADM cannot invite a privileged user', e_inv_sa like '%PRET-ACC-403%', e_inv_sa);
  perform pg_temp.r('E15 token_hash is never readable', e_tok like '%permission denied%', e_tok);
end $$;

-- F. Disabling ended the user's sessions (BR-ADM-06)
do $$ declare c int;
begin
  select count(*) into c from app.app_users where id = (select app_id from fx where n = 'emp2') and status = 'disabled';
  perform pg_temp.r('F1 disabled user status persisted', c = 1, c::text);
end $$;

-- G. External administrator, expired external, disabled user — live checks (ADR-0001)
do $$ declare x uuid := (select auth_id from fx where n = 'ext'); y uuid := (select auth_id from fx where n = 'exp'); z uuid := (select auth_id from fx where n = 'dis');
  e2 uuid := (select auth_id from fx where n = 'emp2');
  a boolean; emp uuid; roles text[]; ux uuid; uz uuid; u2 uuid;
begin
  perform pg_temp.login(x, 'aal2'); a := app.is_admin(); emp := app.current_employee_id(); roles := app.current_role_codes(); reset role;
  perform pg_temp.login(y, 'aal2'); ux := app.current_app_user_id(); reset role;
  perform pg_temp.login(z, 'aal2'); uz := app.current_app_user_id(); reset role;
  perform pg_temp.login(e2, 'aal1'); u2 := app.current_app_user_id(); reset role;
  perform pg_temp.r('G1 external ADM is admin at aal2', a, a::text);
  perform pg_temp.r('G2 external ADM is never an employee (no EMP/MGR)', emp is null and roles = array['ADM'], coalesce(roles::text, 'null'));
  perform pg_temp.r('G3 external past access end date has no identity', ux is null, coalesce(ux::text, 'null'));
  perform pg_temp.r('G4 disabled user has no identity', uz is null, coalesce(uz::text, 'null'));
  perform pg_temp.r('G5 user disabled mid-session loses access on the next statement', u2 is null, coalesce(u2::text, 'null'));
end $$;

-- H. Super Admin at aal2: role management, self-action guards
do $$ declare s uuid := (select auth_id from fx where n = 'sa'); me uuid; adm_role uuid; emp1_app uuid := (select app_id from fx where n = 'emp1');
  c_audit int; c_login int; c_grant int; c_revoke int; c_self_rev int; e_self text; e_status text; e_type text; e_ext text;
  ext_app uuid := (select app_id from fx where n = 'ext'); adm_app uuid := (select app_id from fx where n = 'adm');
begin
  perform pg_temp.login(s, 'aal2'); me := app.current_app_user_id();
  select count(*) into c_audit from audit.audit_log;
  select count(*) into c_login from app.login_events;
  insert into app.user_roles (user_id, role, granted_by) values (emp1_app, 'ADM', me); get diagnostics c_grant = row_count;
  begin insert into app.user_roles (user_id, role, granted_by) values (me, 'ADM', me); e_self := 'no error'; exception when others then e_self := sqlerrm; end;
  begin insert into app.user_roles (user_id, role, granted_by) values (ext_app, 'SA', me); e_ext := 'no error'; exception when others then e_ext := sqlerrm; end;
  select id into adm_role from app.user_roles where user_id = adm_app and revoked_at is null;
  update app.user_roles set revoked_at = now() where id = adm_role; get diagnostics c_revoke = row_count;
  update app.user_roles set revoked_at = now() where user_id = me and role = 'SA'; get diagnostics c_self_rev = row_count;
  begin update app.app_users set status = 'disabled' where id = me; e_status := 'no error'; exception when others then e_status := sqlerrm; end;
  begin update app.app_users set user_type = 'external' where id = emp1_app; e_type := 'no error'; exception when others then e_type := sqlerrm; end;
  reset role;
  perform pg_temp.r('H1 SA reads audit_log', c_audit > 0, c_audit::text);
  perform pg_temp.r('H2 SA reads login_events (0 rows is fine — query allowed)', c_login >= 0, c_login::text);
  perform pg_temp.r('H3 SA grants ADM to another user', c_grant = 1, c_grant::text);
  perform pg_temp.r('H4 SA cannot grant a role to self', e_self <> 'no error', e_self);
  perform pg_temp.r('H5 external user cannot hold SA', e_ext like '%PRET-ROLE-EXTERNAL%', e_ext);
  perform pg_temp.r('H6 SA revokes ADM from another user', c_revoke = 1, c_revoke::text);
  perform pg_temp.r('H7 SA cannot revoke own role', c_self_rev = 0, c_self_rev::text);
  perform pg_temp.r('H8 SA cannot disable self', e_status <> 'no error', e_status);
  perform pg_temp.r('H9 user type is immutable (no column grant; trigger as backstop)', e_type like '%permission denied%' or e_type like '%PRET-USR-TYPE%', e_type);
end $$;

-- I. Last Super Admin cannot be removed (EC-ADM-01) — even by the system role
do $$ declare e text;
begin
  perform set_config('request.jwt.claims', '', true);         -- act as the system, not as a signed-in user
  perform set_config('request.jwt.claim.sub', '', true);
  -- Revoke EVERY active SA in one statement (other environments' real SA rows included): the AFTER
  -- trigger must refuse the whole statement, so nothing changes — and the test transaction rolls back.
  begin
    update app.user_roles set revoked_at = now() where role = 'SA' and revoked_at is null;
    e := 'no error';
  exception when others then e := sqlerrm; end;
  perform pg_temp.r('I1 last active SA cannot be revoked', e like '%PRET-ADM-LAST-SA%', e);
end $$;

-- J. Delegations (Q-ARCH-01) and derived MGR via delegation
do $$ declare s uuid := (select auth_id from fx where n = 'emp1'); s2 uuid := (select auth_id from fx where n = 'mgr');
  me uuid; mgr_app uuid := (select app_id from fx where n = 'mgr'); ext_app uuid := (select app_id from fx where n = 'ext');
  c_ok int; e_other text; e_ext text; e_self text; roles text[];
begin
  perform pg_temp.login(s); me := app.current_app_user_id();
  insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
  values (me, mgr_app, app.today_myt(), app.today_myt() + 7, 'both', me); get diagnostics c_ok = row_count;
  begin insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
        values (mgr_app, me, app.today_myt(), app.today_myt() + 7, 'both', me); e_other := 'no error'; exception when others then e_other := sqlerrm; end;
  begin insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
        values (me, ext_app, app.today_myt(), app.today_myt() + 7, 'leave', me); e_ext := 'no error'; exception when others then e_ext := sqlerrm; end;
  begin insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
        values (me, me, app.today_myt(), app.today_myt() + 7, 'leave', me); e_self := 'no error'; exception when others then e_self := sqlerrm; end;
  reset role;
  perform pg_temp.login(s2); roles := app.current_role_codes(); reset role;
  perform pg_temp.r('J1 EMP delegates own approvals', c_ok = 1, c_ok::text);
  perform pg_temp.r('J2 EMP cannot create a delegation for someone else', e_other <> 'no error', e_other);
  perform pg_temp.r('J3 external user cannot be a delegate', e_ext like '%PRET-DLG-DELEGATE%', e_ext);
  perform pg_temp.r('J4 cannot delegate to self', e_self like '%chk_delegate_not_self%', e_self);
  perform pg_temp.r('J5 delegate/manager has MGR role code', roles = array['MGR','EMP'], roles::text);
end $$;

-- K. Files: registry-gated reads, logged grants, path-scoped upload intents (ADR-0007)
do $$ declare f uuid := (select id from app.files where storage_path like 'emp/%/claims/test/receipt.jpg');
  e1 uuid := (select emp_id from fx where n = 'emp1'); e2 uuid := (select emp_id from fx where n = 'emp2');
  s1 uuid := (select auth_id from fx where n = 'emp1'); sm uuid := (select auth_id from fx where n = 'mgr');
  sx uuid := (select auth_id from fx where n = 'ext');
  r_own boolean; r_mgr boolean; r_adm boolean; c_grant int; e_other_grant text; e_long text; c_intent int; e_path text; e_doc text;
  logs_before int; logs_after int;
begin
  select count(*) into logs_before from audit.access_log;
  perform pg_temp.login(s1);
  r_own := app.can_read_file(f);
  insert into app.file_access_grants (file_id, user_id, purpose, expires_at)
  values (f, app.current_app_user_id(), 'download', now() + interval '2 minutes'); get diagnostics c_grant = row_count;
  begin insert into app.file_access_grants (file_id, user_id, purpose, expires_at)
        values (f, app.current_app_user_id(), 'download', now() + interval '1 day'); e_long := 'no error'; exception when others then e_long := sqlerrm; end;
  insert into app.files (bucket, storage_path, subject, owner_employee_id, original_name, mime_type, size_bytes, created_by)
  values ('claim-files', 'emp/' || e1 || '/claims/c1/l1/a.jpg', 'claim_receipt', e1, 'a.jpg', 'image/jpeg', 10, app.current_app_user_id());
  get diagnostics c_intent = row_count;
  begin insert into app.files (bucket, storage_path, subject, owner_employee_id, original_name, mime_type, size_bytes, created_by)
        values ('claim-files', 'emp/' || e2 || '/claims/c1/l1/b.jpg', 'claim_receipt', e2, 'b.jpg', 'image/jpeg', 10, app.current_app_user_id());
        e_path := 'no error'; exception when others then e_path := sqlerrm; end;
  begin insert into app.files (bucket, storage_path, subject, owner_employee_id, original_name, mime_type, size_bytes, created_by)
        values ('employee-files', 'emp/' || e1 || '/docs/x/c.pdf', 'employee_document', e1, 'c.pdf', 'application/pdf', 10, app.current_app_user_id());
        e_doc := 'no error'; exception when others then e_doc := sqlerrm; end;
  reset role;
  perform pg_temp.login(sm); r_mgr := app.can_read_file(f);
  begin insert into app.file_access_grants (file_id, user_id, purpose, expires_at)
        values (f, app.current_app_user_id(), 'download', now() + interval '2 minutes'); e_other_grant := 'no error'; exception when others then e_other_grant := sqlerrm; end;
  reset role;
  perform pg_temp.login(sx, 'aal2'); r_adm := app.can_read_file(f); reset role;
  select count(*) into logs_after from audit.access_log;
  perform pg_temp.r('K1 owner can read own receipt', r_own, r_own::text);
  perform pg_temp.r('K2 grant insert by owner succeeds', c_grant = 1, c_grant::text);
  perform pg_temp.r('K3 every grant writes an access-log row', logs_after = logs_before + 1, (logs_after - logs_before)::text);
  perform pg_temp.r('K4 grants longer than 5 minutes are refused', e_long <> 'no error', e_long);
  perform pg_temp.r('K5 non-owner (no task rule yet) cannot read the receipt', not r_mgr, r_mgr::text);
  perform pg_temp.r('K6 non-owner cannot obtain a grant', e_other_grant <> 'no error', e_other_grant);
  perform pg_temp.r('K7 ADM (external, aal2) can read', r_adm, r_adm::text);
  perform pg_temp.r('K8 upload intent to own path allowed', c_intent = 1, c_intent::text);
  perform pg_temp.r('K9 upload intent to another employee''s path refused', e_path <> 'no error', e_path);
  perform pg_temp.r('K10 employee cannot upload HR documents', e_doc <> 'no error', e_doc);
end $$;

-- L. Idle timeout per role (F-ADM-14). Uses mgr (no privileged role; emp1 was granted ADM in H3).
do $$ declare s1 uuid := (select auth_id from fx where n = 'mgr'); sa uuid := (select auth_id from fx where n = 'sa');
  sid1 uuid := gen_random_uuid(); sid2 uuid := gen_random_uuid(); st1 text; st2 text; st3 text; st4 text; t1 int; t2 int;
begin
  perform pg_temp.login(s1, 'aal1', sid1); select status, idle_timeout_min into st1, t1 from app.touch_session(); reset role;
  update app.app_sessions set last_seen_at = now() - interval '29 minutes' where session_id = sid1;
  perform pg_temp.login(s1, 'aal1', sid1); select status into st2 from app.touch_session(); reset role;
  update app.app_sessions set last_seen_at = now() - interval '31 minutes' where session_id = sid1;
  perform pg_temp.login(s1, 'aal1', sid1); select status into st3 from app.touch_session(); reset role;
  perform pg_temp.login(sa, 'aal2', sid2); select status, idle_timeout_min into st4, t2 from app.touch_session(); reset role;
  update app.app_sessions set last_seen_at = now() - interval '16 minutes' where session_id = sid2;
  perform pg_temp.login(sa, 'aal2', sid2); select status into st4 from app.touch_session(); reset role;
  perform pg_temp.r('L1 new session registered (employee timeout 30)', st1 = 'ok' and t1 = 30, st1 || '/' || t1);
  perform pg_temp.r('L2 employee active at 29 min', st2 = 'ok', st2);
  perform pg_temp.r('L3 employee timed out after 30 min', st3 = 'idle_timeout', st3);
  perform pg_temp.r('L4 privileged timeout is 15 min and enforced', t2 = 15 and st4 = 'idle_timeout', t2 || '/' || st4);
end $$;

-- M. Audit trail: change rows written; append-only for every role
do $$ declare c int; e_upd text; e_del text; e_svc text; e_trunc text;
begin
  select count(*) into c from audit.audit_log where entity_type = 'app_users' and action = 'create';
  begin update audit.audit_log set reason = 'x' where id = (select max(id) from audit.audit_log); e_upd := 'no error'; exception when others then e_upd := sqlerrm; end;
  begin delete from audit.audit_log where id = (select max(id) from audit.audit_log); e_del := 'no error'; exception when others then e_del := sqlerrm; end;
  begin truncate audit.access_log; e_trunc := 'no error'; exception when others then e_trunc := sqlerrm; end;
  execute 'set local role service_role';
  begin update audit.audit_log set reason = 'x' where id = 1; e_svc := 'no error'; exception when others then e_svc := sqlerrm; end;
  reset role;
  perform pg_temp.r('M1 data-change trigger logged user creation', c >= 9, c::text);
  perform pg_temp.r('M2 postgres cannot UPDATE audit_log', e_upd like '%permission denied%', e_upd);
  perform pg_temp.r('M3 postgres cannot DELETE audit_log', e_del like '%permission denied%', e_del);
  perform pg_temp.r('M4 TRUNCATE refused', e_trunc like '%permission denied%' or e_trunc like '%APPEND-ONLY%', e_trunc);
  perform pg_temp.r('M5 service_role cannot UPDATE audit_log', e_svc like '%permission denied%', e_svc);
end $$;

-- N. Audit row carries actor, roles and request context
do $$ declare s uuid := (select auth_id from fx where n = 'sa'); rec record;
begin
  perform pg_temp.login(s, 'aal2');
  perform set_config('app.request_id', '11111111-1111-4111-8111-111111111111', true);
  perform set_config('app.client_ip', '203.0.113.7', true);
  perform set_config('app.reason', 'test reason', true);
  update app.company_profile set website = 'https://example.invalid/test';
  reset role;
  select * into rec from audit.audit_log where entity_type = 'company_profile' order by id desc limit 1;
  perform pg_temp.r('N1 audit row has actor, SA role, ip, request id, reason and diff',
    rec.actor_user_id = (select app_id from fx where n = 'sa') and 'SA' = any(rec.actor_roles) and rec.ip = '203.0.113.7'::inet
    and rec.request_id = '11111111-1111-4111-8111-111111111111' and rec.reason = 'test reason' and rec.changes ? 'website',
    rec.changes::text);
end $$;

-- O. Reference numbers (ADR-0015): sequential, never reused; not callable by users
do $$ declare a text; b text; e text; s uuid := (select auth_id from fx where n = 'emp1');
begin
  execute 'set local role service_role';
  a := private.next_doc_no('CL', 2099); b := private.next_doc_no('CL', 2099);
  reset role;
  perform pg_temp.login(s);
  begin perform private.next_doc_no('CL', 2099); e := 'no error'; exception when others then e := sqlerrm; end;
  reset role;
  perform pg_temp.r('O1 CL-yyyy-nnnnn sequence', a = 'CL-2099-00001' and b = 'CL-2099-00002', a || ', ' || b);
  perform pg_temp.r('O2 users cannot call private functions', e like '%permission denied%', e);
end $$;

-- P. Catalogue lint (rls-policies §12): RLS forced everywhere, WITH CHECK present, no FOR ALL,
--    definer functions pinned, nothing executable by anon, no manager helper on T5 tables.
do $$ declare n_unforced int; n_nocheck int; n_all int; n_nopath int; n_anon int; n_mgr int;
begin
  select count(*) into n_unforced from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('app','audit','private') and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity);
  select count(*) into n_nocheck from pg_policies where schemaname in ('app','audit') and cmd in ('INSERT','UPDATE') and with_check is null;
  select count(*) into n_all from pg_policies where schemaname in ('app','audit') and cmd = 'ALL';
  select count(*) into n_nopath from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','audit','private') and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  select count(*) into n_anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app','audit','private') and has_function_privilege('anon', p.oid, 'execute');
  select count(*) into n_mgr from pg_policies
   where (schemaname = 'audit' or tablename in ('login_events','user_roles','security_settings','company_statutory'))
     and (coalesce(qual,'') ~ 'is_manager|can_see_team_row|is_current_approver_for' or coalesce(with_check,'') ~ 'is_manager|can_see_team_row|is_current_approver_for');
  perform pg_temp.r('P1 RLS enabled and forced on every table', n_unforced = 0, n_unforced::text);
  perform pg_temp.r('P2 every insert/update policy has WITH CHECK', n_nocheck = 0, n_nocheck::text);
  perform pg_temp.r('P3 no FOR ALL policies', n_all = 0, n_all::text);
  perform pg_temp.r('P4 every definer function pins search_path', n_nopath = 0, n_nopath::text);
  perform pg_temp.r('P5 nothing executable by anon', n_anon = 0, n_anon::text);
  perform pg_temp.r('P6 no manager helper in security-tier policies', n_mgr = 0, n_mgr::text);
end $$;

select test, pass, detail from t_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from t_results;

rollback;
