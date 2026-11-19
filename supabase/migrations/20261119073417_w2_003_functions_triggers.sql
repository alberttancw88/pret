-- PRET W2-003 · 02 — M1 helpers, derived data, guards, workflow functions and triggers.
-- Design: data-model.md §15 (trigger catalogue), rls-policies.md §3, §6 (T4 logged read/write), §7 (no
-- self-approval), §10 (definer register); PRD §5.2 business rules, §5.6 status model, §5.8 change requests.
-- Pattern (as W2-001/W2-002): "who may do it" guards are SECURITY INVOKER and test current_user =
-- 'authenticated' (a direct user write); derived data and workflow functions are SECURITY DEFINER, pin
-- search_path = '' and re-check the caller. Trigger functions are not executable by any login role.

-- ===========================================================================
-- Caller helpers
-- ===========================================================================
-- T1 row visibility (rls-policies §3). W2-004 adds app.is_current_approver_for() once approval_tasks exists.
create or replace function app.can_see_team_row(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_self(p_employee_id) or app.is_admin() or app.is_manager_of(p_employee_id)
$$;

-- Profile of the caller (replaces W2-001): employee_no now joins app.employees. A user whose employee
-- record does not exist yet (the first Super Admin) gets employee_no = NULL — nothing else changes.
create or replace function app.current_user_profile()
returns table (app_user_id uuid, display_name text, login_email text, user_type app.user_type,
               employee_id uuid, employee_no text, roles text[], aal text,
               mfa_required boolean, mfa_enrolled boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, u.display_name, u.login_email::text, u.user_type,
         case when u.user_type = 'employee' then u.employee_id end,
         e.employee_no,
         app.current_role_codes(), app.current_aal(),
         app.mfa_required_privileged() and (app.holds_role('SA') or app.holds_role('ADM')),
         u.mfa_enrolled
    from app.app_users u
    left join app.employees e on e.id = u.employee_id and u.user_type = 'employee'
   where u.id = app.current_app_user_id()
$$;

-- Directory-level names for any id (manager / approver / head columns). Active users only.
create or replace function app.employee_names(p_ids uuid[])
returns table (id uuid, employee_no text, full_name text, preferred_name text, status app.employment_status)
language sql stable security definer set search_path = '' as $$
  select e.id, e.employee_no, e.full_name, e.preferred_name, e.status
    from app.employees e
   where e.id = any(p_ids) and coalesce(cardinality(p_ids), 0) <= 2000 and app.is_active_user()
$$;

-- Portal account of employees (E1 column/filter, A6 picker): admins only; returns facts, grants nothing.
create or replace function app.employee_portal_accounts(p_ids uuid[])
returns table (employee_id uuid, user_id uuid, status app.user_status, accepted boolean, invite_scheduled_for date,
               last_login_at timestamptz, access_end_date date, has_open_invitation boolean)
language sql stable security definer set search_path = '' as $$
  select u.employee_id, u.id, u.status, u.auth_user_id is not null, u.invite_scheduled_for, u.last_login_at, u.access_end_date,
         exists (select 1 from app.user_invitations i where i.user_id = u.id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
    from app.app_users u
   where u.employee_id = any(p_ids) and u.user_type = 'employee' and app.is_admin()
$$;

-- ===========================================================================
-- Status model (PRD §5.6, BR-EMP-30): always derived, never chosen
-- ===========================================================================
create or replace function app.derive_employee_status(p_join_date date, p_probation_months int, p_confirmation_date date,
                                                      p_offer_withdrawn_at timestamptz, p_last_working_day date, p_today date)
returns app.employment_status
language sql immutable set search_path = '' as $$
  select (case
    when p_offer_withdrawn_at is not null then 'withdrawn'
    when p_last_working_day is not null and p_last_working_day < p_today then 'separated'
    when p_last_working_day is not null then 'notice_period'
    when p_join_date > p_today then 'pending_join'
    when p_probation_months = 0 or (p_confirmation_date is not null and p_confirmation_date <= p_today) then 'confirmed'
    else 'on_probation' end)::app.employment_status
$$;

-- LWD of the employee's current (not withdrawn, not closed by rehire) separation.
create or replace function app.employee_active_lwd(p_employee_id uuid) returns date
language sql stable security definer set search_path = '' as $$
  select s.last_working_day from app.employee_separations s
   where s.employee_id = p_employee_id and not s.is_withdrawn and not s.superseded_by_rehire
$$;

create or replace function app.refresh_employee_status(p_employee_id uuid) returns app.employment_status
language plpgsql volatile security definer set search_path = '' as $$
declare v_new app.employment_status;
begin
  select app.derive_employee_status(e.join_date, e.probation_months, e.confirmation_date, e.offer_withdrawn_at,
                                    app.employee_active_lwd(e.id), app.today_myt())
    into v_new from app.employees e where e.id = p_employee_id;
  update app.employees e set status = v_new where e.id = p_employee_id and e.status is distinct from v_new;
  return v_new;
end $$;

-- ===========================================================================
-- Reporting lines (BR-EMP-10, EC-EMP-03) and the closure table (ADR-0001)
-- ===========================================================================
create or replace function app.check_reporting_line(p_employee_id uuid, p_manager_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_status app.employment_status; v_loop boolean;
begin
  if p_manager_id is null then return; end if;
  if p_manager_id = p_employee_id then
    raise exception 'PRET-EMP-OWN-MANAGER: an employee cannot be their own manager' using errcode = '23514';
  end if;
  select e.status into v_status from app.employees e where e.id = p_manager_id;
  if v_status is null or v_status not in ('pending_join','on_probation','confirmed','notice_period') then
    raise exception 'PRET-EMP-MANAGER-INACTIVE: the reporting manager must be an active employee' using errcode = '23514';
  end if;
  with recursive up as (
    select e.id, e.manager_employee_id, 1 as depth from app.employees e where e.id = p_manager_id
    union all
    select e.id, e.manager_employee_id, up.depth + 1 from app.employees e join up on e.id = up.manager_employee_id where up.depth < 500)
  select exists (select 1 from up where up.id = p_employee_id) into v_loop;
  if v_loop then
    raise exception 'PRET-EMP-LOOP: reporting line would create a loop' using errcode = '23514';
  end if;
end $$;

create or replace function app.check_approver(p_employee_id uuid, p_approver_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_approver_id is null then return; end if;
  if p_approver_id = p_employee_id then
    raise exception 'PRET-EMP-OWN-APPROVER: an employee cannot approve their own requests' using errcode = '23514';
  end if;
  if not exists (select 1 from app.employees e where e.id = p_approver_id and e.status in ('on_probation','confirmed','notice_period')) then
    raise exception 'PRET-EMP-APPROVER-INACTIVE: the approver must be an active employee' using errcode = '23514';
  end if;
end $$;

-- Full rebuild (≤ 200 employees, NFR-01): direct + indirect reportees of active-chain employees.
create or replace function app.rebuild_reporting_closure() returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from app.reporting_closure where true;
  insert into app.reporting_closure (manager_employee_id, employee_id, depth)
  with recursive chain as (
    select e.manager_employee_id as manager_id, e.id as employee_id, 1 as depth
      from app.employees e
     where e.manager_employee_id is not null and e.status in ('pending_join','on_probation','confirmed','notice_period')
    union all
    select m.manager_employee_id, c.employee_id, c.depth + 1
      from chain c join app.employees m on m.id = c.manager_id
     where m.manager_employee_id is not null and c.depth < 50)
  select c.manager_id, c.employee_id, min(c.depth)
    from chain c join app.employees m on m.id = c.manager_id
   where m.status in ('pending_join','on_probation','confirmed','notice_period') and c.manager_id <> c.employee_id
   group by c.manager_id, c.employee_id;
end $$;

-- ===========================================================================
-- Current job (FR-EMP-07, BR-EMP-22): the latest live row ≤ today (else the earliest row, i.e. the
-- New-hire row of a Pending Join employee) is copied into the employees cache.
-- ===========================================================================
create or replace function app.apply_current_job(p_employee_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := app.today_myt();
  r app.employee_job_history%rowtype;
  v_since date;
  v_state app.my_state;
begin
  select * into r from app.employee_job_history h
   where h.employee_id = p_employee_id and not h.is_deleted and h.effective_date <= v_today
   order by h.effective_date desc limit 1;
  if not found then
    select * into r from app.employee_job_history h
     where h.employee_id = p_employee_id and not h.is_deleted
     order by h.effective_date asc limit 1;
    if not found then return; end if;
  end if;
  select min(h.effective_date) into v_since
    from app.employee_job_history h
   where h.employee_id = p_employee_id and not h.is_deleted and h.effective_date <= greatest(v_today, r.effective_date)
     and h.effective_date > coalesce((select max(x.effective_date) from app.employee_job_history x
                                       where x.employee_id = p_employee_id and not x.is_deleted
                                         and x.effective_date <= greatest(v_today, r.effective_date)
                                         and x.manager_employee_id is distinct from r.manager_employee_id), '-infinity'::date);
  select l.state into v_state from app.work_locations l where l.id = r.work_location_id;
  update app.employees e
     set department_id = r.department_id, position_id = r.position_id, grade_id = r.grade_id,
         manager_employee_id = r.manager_employee_id, work_location_id = r.work_location_id, work_state = v_state,
         working_pattern_id = r.working_pattern_id, employment_type = r.employment_type,
         manager_since = case when r.manager_employee_id is null then null else v_since end
   where e.id = p_employee_id
     and (e.department_id, e.position_id, e.grade_id, e.manager_employee_id, e.work_location_id, e.work_state,
          e.working_pattern_id, e.employment_type, e.manager_since)
         is distinct from
         (r.department_id, r.position_id, r.grade_id, r.manager_employee_id, r.work_location_id, v_state,
          r.working_pattern_id, r.employment_type, case when r.manager_employee_id is null then null else v_since end);
  -- BR-LV-61 re-routing of open approval tasks arrives with approval_tasks (W2-004).
end $$;

-- ===========================================================================
-- Directory projection (T0) — FR-EMP-14 fields only
-- ===========================================================================
create or replace function app.refresh_directory(p_employee_id uuid default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into app.employee_directory as d (employee_id, employee_no, full_name, preferred_name, position_title, department_id,
                                           department_name, location_id, location_name, work_email, work_phone, photo_file_id,
                                           manager_employee_id, is_listed, refreshed_at)
  select e.id, e.employee_no, e.full_name, e.preferred_name, p.title, dp.id, dp.name, l.id, l.name, e.work_email, e.work_phone,
         e.photo_file_id, e.manager_employee_id, e.status in ('on_probation','confirmed','notice_period'), now()
    from app.employees e
    join app.positions p on p.id = e.position_id
    join app.departments dp on dp.id = e.department_id
    join app.work_locations l on l.id = e.work_location_id
   where p_employee_id is null or e.id = p_employee_id
  on conflict (employee_id) do update
     set employee_no = excluded.employee_no, full_name = excluded.full_name, preferred_name = excluded.preferred_name,
         position_title = excluded.position_title, department_id = excluded.department_id, department_name = excluded.department_name,
         location_id = excluded.location_id, location_name = excluded.location_name, work_email = excluded.work_email,
         work_phone = excluded.work_phone, photo_file_id = excluded.photo_file_id,
         manager_employee_id = excluded.manager_employee_id, is_listed = excluded.is_listed, refreshed_at = now();
end $$;

-- ===========================================================================
-- Notifications helpers (ADR-0010) — internal
-- ===========================================================================
create or replace function app.employee_user_id(p_employee_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from app.app_users u
   where u.employee_id = p_employee_id and u.user_type = 'employee' and u.status in ('active','invited','locked')
   limit 1
$$;

create or replace function app.notify_role_holders(p_roles app.privileged_role[], p_event text, p_title text, p_body text,
                                                   p_link text, p_action boolean, p_template text, p_payload jsonb,
                                                   p_exclude_user uuid default null)
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select distinct u.id from app.user_roles ur join app.app_users u on u.id = ur.user_id
            where ur.role = any(p_roles) and ur.revoked_at is null and u.status = 'active'
              and u.id <> '00000000-0000-0000-0000-000000000001'
              and u.id is distinct from p_exclude_user
  loop
    perform app.notify(r.id, p_event, left(p_title, 150), left(p_body, 500), p_link, p_action, p_template, p_payload);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ===========================================================================
-- Employee no. (BR-EMP-11): <prefix><n> zero-padded, never reused
-- ===========================================================================
create or replace function app.allocate_employee_no() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_prefix text; v_pad int; v_next int; v_no text;
begin
  if not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  loop
    update app.security_settings s set employee_no_next = s.employee_no_next + 1 where s.id = 1
      returning s.employee_no_prefix, s.employee_no_padding, s.employee_no_next - 1 into v_prefix, v_pad, v_next;
    v_no := v_prefix || lpad(v_next::text, greatest(v_pad, length(v_next::text)), '0');
    exit when not exists (select 1 from app.employees e where e.employee_no = v_no);
  end loop;
  return v_no;
end $$;

-- ===========================================================================
-- T4 special category — logged read / write (rls-policies §6)
-- ===========================================================================
create or replace function app.read_employee_sensitive(p_employee_id uuid, p_purpose text)
returns table (religion app.religion, is_oku boolean, oku_card_no text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.is_self(p_employee_id) then                      -- own data: no log (US-EMP-018 pattern)
    return query select s.religion, s.is_oku, s.oku_card_no from app.employee_sensitive s where s.employee_id = p_employee_id;
    return;
  end if;
  if not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  perform audit.write_access('view_sensitive', 'employee', p_employee_id, array[p_employee_id],
                             array['religion','is_oku','oku_card_no'], array['religion','health']::app.data_category[],
                             left(p_purpose, 500));
  return query select s.religion, s.is_oku, s.oku_card_no from app.employee_sensitive s where s.employee_id = p_employee_id;
end $$;

create or replace function app.write_employee_sensitive(p_employee_id uuid, p_religion app.religion, p_is_oku boolean, p_oku_card_no text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if p_employee_id is not distinct from app.current_employee_id() then
    raise exception 'PRET-SELF-002: use a change request for your own record' using errcode = '42501';
  end if;
  if not exists (select 1 from app.employees e where e.id = p_employee_id) then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  insert into app.employee_sensitive as s (employee_id, religion, is_oku, oku_card_no)
  values (p_employee_id, p_religion, coalesce(p_is_oku, false), case when coalesce(p_is_oku, false) then p_oku_card_no end)
  on conflict (employee_id) do update
     set religion = excluded.religion, is_oku = excluded.is_oku, oku_card_no = excluded.oku_card_no;
end $$;

-- ===========================================================================
-- Guards and derived data on app.employees
-- ===========================================================================
-- Self-edit guard (FR-EMP-12, EC-EMP-10, US-EMP-027): on the actor's OWN rows only E✎ columns may change;
-- everything else needs a change request decided by someone else. Applies to every role, SA included.
create or replace function app.tg_self_edit_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_emp uuid;
  v_allowed text[];
  v_always text[] := array['version','updated_at','updated_by','created_at','created_by',
                            'probation_end_date','retirement_date'];   -- generated columns are NULL in BEFORE triggers
  v_old jsonb; v_new jsonb; k text;
begin
  v_emp := (to_jsonb(new) ->> case when tg_table_name = 'employees' then 'id' else 'employee_id' end)::uuid;
  if v_emp is null or not coalesce(app.is_self(v_emp), false) then
    return new;
  end if;
  v_allowed := case tg_table_name
    when 'employees' then array['preferred_name','mobile_phone','photo_file_id']
    when 'employee_personal' then array['passport_no','passport_expiry','highest_qualification','personal_email',
         'res_addr_line1','res_addr_line2','res_addr_line3','res_postcode','res_city','res_state','res_country',
         'mailing_same_as_residential','mail_addr_line1','mail_addr_line2','mail_addr_line3','mail_postcode',
         'mail_city','mail_state','mail_country']
    when 'employee_spouses' then array['phone']
    else array[]::text[] end;
  if tg_op <> 'UPDATE' then
    raise exception 'PRET-SELF-002: use a change request for your own record' using errcode = '42501';
  end if;
  v_old := to_jsonb(old); v_new := to_jsonb(new);
  for k in select jsonb_object_keys(v_new) loop
    continue when k = any(v_allowed) or k = any(v_always);
    if (v_old -> k) is distinct from (v_new -> k) then
      raise exception 'PRET-SELF-002: use a change request for your own record (%)', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- Direct-write rules (invoker: current_user tells a user write from a registered definer function / job).
create or replace function app.tg_employees_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.id is not distinct from app.current_employee_id() then
      raise exception 'PRET-SELF-001: you cannot create your own employee record' using errcode = '42501';
    end if;
    if new.confirmation_date is not null or new.extended_probation_end_date is not null or new.offer_withdrawn_at is not null then
      raise exception 'PRET-EMP-SYSTEM-FIELD' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.employee_no is distinct from old.employee_no and not app.is_sa() then
    raise exception 'PRET-EMP-NO-SA: only a Super Admin can change the employee no.' using errcode = '42501';
  end if;
  return new;
end $$;

-- Derived columns (definer): work state from the location (F18), status (§5.6), reference checks.
create or replace function app.tg_employees_derive() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.work_location_id is distinct from old.work_location_id then
    select l.state into new.work_state from app.work_locations l where l.id = new.work_location_id;
  end if;
  new.status := app.derive_employee_status(new.join_date, new.probation_months, new.confirmation_date, new.offer_withdrawn_at,
                  case when tg_op = 'INSERT' then null else app.employee_active_lwd(new.id) end, app.today_myt());
  if tg_op = 'INSERT' and new.join_date > app.today_myt() + interval '12 months' then
    raise exception 'PRET-EMP-JOIN-FUTURE: the join date can be at most 12 months ahead' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.manager_employee_id is distinct from old.manager_employee_id then
    perform app.check_reporting_line(new.id, new.manager_employee_id);
  end if;
  if tg_op = 'INSERT' or new.leave_approver_employee_id is distinct from old.leave_approver_employee_id then
    perform app.check_approver(new.id, new.leave_approver_employee_id);
  end if;
  if tg_op = 'INSERT' or new.claim_approver_employee_id is distinct from old.claim_approver_employee_id then
    perform app.check_approver(new.id, new.claim_approver_employee_id);
  end if;
  if new.photo_file_id is not null and (tg_op = 'INSERT' or new.photo_file_id is distinct from old.photo_file_id)
     and not exists (select 1 from app.files f where f.id = new.photo_file_id and f.subject = 'employee_photo'
                        and f.owner_employee_id = new.id and f.status = 'active') then
    raise exception 'PRET-FILE-MISSING: the photo upload is missing or not confirmed' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    -- the first job-history row must match the initial cache (checked again by the New-hire row below)
    if not exists (select 1 from app.departments d where d.id = new.department_id and d.is_active)
       or not exists (select 1 from app.positions p where p.id = new.position_id and p.is_active)
       or not exists (select 1 from app.grades g where g.id = new.grade_id and g.is_active)
       or not exists (select 1 from app.work_locations l where l.id = new.work_location_id and l.is_active)
       or not exists (select 1 from app.working_patterns w where w.id = new.working_pattern_id and w.is_active) then
      raise exception 'PRET-ORG-REF-INACTIVE: department, position, grade, location and pattern must be active' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- AFTER INSERT: the New-hire job-history row (effective join date) from the initial values.
-- AFTER UPDATE OF join_date: the New-hire / Rehire row moves with it (EC-EMP-05 leave recompute → W2-004).
-- Also keeps an invited (not yet accepted) user's login email equal to the work email (BR-EMP-07).
create or replace function app.tg_employees_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into app.employee_job_history (employee_id, effective_date, change_type, department_id, position_id, grade_id,
                                          manager_employee_id, work_location_id, working_pattern_id, employment_type)
    values (new.id, new.join_date, 'new_hire', new.department_id, new.position_id, new.grade_id, new.manager_employee_id,
            new.work_location_id, new.working_pattern_id, new.employment_type);
  else
    if new.join_date is distinct from old.join_date and coalesce(current_setting('app.rehire', true), '') <> 'on' then
      if exists (select 1 from app.employee_job_history h where h.employee_id = new.id and not h.is_deleted
                    and h.effective_date < new.join_date and h.effective_date > old.join_date) then
        raise exception 'PRET-EMP-JOIN-HISTORY: job changes exist before the new join date — correct them first' using errcode = '23514';
      end if;
      update app.employee_job_history h set effective_date = new.join_date
       where h.employee_id = new.id and not h.is_deleted and h.effective_date = old.join_date
         and h.change_type in ('new_hire','rehire');
    end if;
    if new.work_email is distinct from old.work_email then
      update app.app_users u set login_email = new.work_email
       where u.employee_id = new.id and u.user_type = 'employee' and u.auth_user_id is null;
    end if;
  end if;
  perform app.refresh_directory(new.id);
  return null;
end $$;

create or replace function app.tg_employees_closure() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.rebuild_reporting_closure();
  return null;
end $$;

-- Top of organisation (BR-EMP-10, F14): an active employee without a manager must be Top of
-- organisation; at most security_settings.max_top_of_org of them. Deferred to commit, so the employee
-- and its HR-private row can be written in either order.
create or replace function app.tg_check_top_of_org() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_emp uuid := coalesce(to_jsonb(new) ->> 'employee_id', to_jsonb(new) ->> 'id')::uuid; v_max int; v_count int;
begin
  if exists (select 1 from app.employees e left join app.employee_hr_private h on h.employee_id = e.id
              where e.id = v_emp and e.manager_employee_id is null
                and e.status in ('pending_join','on_probation','confirmed','notice_period')
                and not coalesce(h.is_top_of_org, false)) then
    raise exception 'PRET-EMP-MANAGER-REQUIRED: select the reporting manager (or tick Top of organisation)' using errcode = '23514';
  end if;
  select coalesce(s.max_top_of_org, 1) into v_max from app.security_settings s where s.id = 1;
  select count(*) into v_count from app.employee_hr_private h join app.employees e on e.id = h.employee_id
   where h.is_top_of_org and e.status in ('pending_join','on_probation','confirmed','notice_period');
  if v_count > coalesce(v_max, 1) then
    raise exception 'PRET-EMP-TOP-MAX: at most % employee(s) can be Top of organisation', coalesce(v_max, 1) using errcode = '23514';
  end if;
  return null;
end $$;

-- HR-private: Top of organisation is SA only (F14).
create or replace function app.tg_hr_private_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated'
     and ((tg_op = 'INSERT' and new.is_top_of_org) or (tg_op = 'UPDATE' and new.is_top_of_org is distinct from old.is_top_of_org))
     and not app.is_sa() then
    raise exception 'PRET-EMP-TOP-SA: only a Super Admin can set Top of organisation' using errcode = '42501';
  end if;
  return new;
end $$;

-- employee_personal: DOB ≤ today, personal email ≠ work email (B2), mailing address cleared when "same".
create or replace function app.tg_personal_validate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.date_of_birth > app.today_myt() then
    raise exception 'PRET-EMP-DOB-FUTURE: date of birth cannot be in the future' using errcode = '23514';
  end if;
  if exists (select 1 from app.employees e where e.id = new.employee_id and e.work_email = new.personal_email) then
    raise exception 'PRET-EMP-PERSONAL-EMAIL: personal email must differ from the work email' using errcode = '23514';
  end if;
  if new.continuous_service_date > (select e.join_date from app.employees e where e.id = new.employee_id) then
    raise exception 'PRET-EMP-CSD: continuous-service date must be on or before the join date' using errcode = '23514';
  end if;
  if new.mailing_same_as_residential then
    new.mail_addr_line1 := null; new.mail_addr_line2 := null; new.mail_addr_line3 := null;
    new.mail_postcode := null; new.mail_city := null; new.mail_state := null; new.mail_country := null;
  end if;
  return new;
end $$;

-- Marital history: a non-married status (effective ≤ today) sets current spouses Former (BR-EMP-16, EC-EMP-08).
create or replace function app.tg_marital_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.marital_status <> 'married' and new.effective_date <= app.today_myt()
     and new.effective_date = (select max(m.effective_date) from app.employee_marital_history m
                                where m.employee_id = new.employee_id and m.effective_date <= app.today_myt()) then
    update app.employee_spouses s set record_status = 'former'
     where s.employee_id = new.employee_id and s.record_status = 'current';
  end if;
  return null;
end $$;

-- Spouses: ≤ 4 current (BR-EMP-16), marriage date ≤ today. Children: DOB ≤ today.
create or replace function app.tg_family_validate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'employee_spouses' then
    if new.marriage_date > app.today_myt() then
      raise exception 'PRET-EMP-MARRIAGE-FUTURE: date of marriage cannot be in the future' using errcode = '23514';
    end if;
    if new.record_status = 'current' and (select count(*) from app.employee_spouses s
          where s.employee_id = new.employee_id and s.record_status = 'current' and s.id <> new.id) >= 4 then
      raise exception 'PRET-EMP-SPOUSE-MAX: at most 4 current spouse records' using errcode = '23514';
    end if;
  else
    if new.date_of_birth > app.today_myt() then
      raise exception 'PRET-EMP-CHILD-DOB: date of birth cannot be in the future' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- Emergency contacts: at least one must remain (deferred to commit so a replace-all save works).
create or replace function app.tg_emergency_min_one() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from app.employees e where e.id = old.employee_id)
     and not exists (select 1 from app.employee_emergency_contacts c where c.employee_id = old.employee_id) then
    raise exception 'PRET-EMP-EMERGENCY-MIN: at least one emergency contact is required' using errcode = '23514';
  end if;
  return null;
end $$;

-- Prior employment (L2): "to" ≤ join date (US-EMP-024).
create or replace function app.tg_prior_employment_validate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.date_to > (select e.join_date from app.employees e where e.id = new.employee_id) then
    raise exception 'PRET-EMP-PRIOR-AFTER-JOIN: "to" must be on or before the join date' using errcode = '23514';
  end if;
  return new;
end $$;

-- N-40: an employee's self-update notifies Admins in-app (one per 10 minutes per employee).
create or replace function app.tg_self_update_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; v_no text; v_actor uuid := app.current_app_user_id();
begin
  v_emp := (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
             ->> case when tg_table_name = 'employees' then 'id' else 'employee_id' end)::uuid;
  if v_actor is null or not coalesce(app.is_self(v_emp), false) then return null; end if;
  select e.employee_no into v_no from app.employees e where e.id = v_emp;
  if exists (select 1 from app.notifications n where n.event_code = 'N-40' and n.link_path = '/employees/' || v_no
                and n.created_at > now() - interval '10 minutes') then
    return null;
  end if;
  perform app.notify_role_holders(array['ADM','SA']::app.privileged_role[], 'N-40',
            v_no || ' updated their contact or emergency details', null, '/employees/' || v_no, false, null, null, v_actor);
  return null;
end $$;

-- ===========================================================================
-- Job history (§5.5)
-- ===========================================================================
create or replace function app.tg_job_history_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_today date := app.today_myt();
begin
  if tg_op = 'UPDATE' and old.is_deleted then
    raise exception 'PRET-JOB-DELETED: this job change was deleted' using errcode = '23514';
  end if;
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.change_type in ('new_hire','confirmation','separation','rehire') or new.is_deleted then
      raise exception 'PRET-JOB-SYSTEM-TYPE: this change type is recorded by its own action' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.employee_id is distinct from old.employee_id then
    raise exception 'PRET-JOB-EMPLOYEE' using errcode = '23514';
  end if;
  if new.is_deleted then
    if old.effective_date <= v_today then
      raise exception 'PRET-JOB-DELETE-PAST: only future-dated job changes can be deleted' using errcode = '23514';
    end if;
    return new;
  end if;
  if old.effective_date <= v_today and new.change_type <> 'data_correction' then
    raise exception 'PRET-JOB-PAST-CORRECTION: a past or current row can only be changed as a Data correction with remarks' using errcode = '23514';
  end if;
  if new.change_type in ('new_hire','confirmation','separation','rehire') and new.change_type is distinct from old.change_type then
    raise exception 'PRET-JOB-SYSTEM-TYPE: this change type is recorded by its own action' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function app.tg_job_history_validate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_join date; v_changed boolean;
begin
  if new.is_deleted then return new; end if;
  select e.join_date into v_join from app.employees e where e.id = new.employee_id;
  if new.effective_date < v_join and new.change_type not in ('new_hire','rehire') then
    raise exception 'PRET-JOB-BEFORE-JOIN: the effective date cannot be before the join date' using errcode = '23514';
  end if;
  v_changed := tg_op = 'INSERT' or (new.department_id, new.position_id, new.grade_id, new.work_location_id, new.working_pattern_id)
                                    is distinct from (old.department_id, old.position_id, old.grade_id, old.work_location_id, old.working_pattern_id);
  if v_changed and new.change_type not in ('separation','data_correction') and (
        not exists (select 1 from app.departments d where d.id = new.department_id and d.is_active)
     or not exists (select 1 from app.positions p where p.id = new.position_id and p.is_active)
     or not exists (select 1 from app.grades g where g.id = new.grade_id and g.is_active)
     or not exists (select 1 from app.work_locations l where l.id = new.work_location_id and l.is_active)
     or not exists (select 1 from app.working_patterns w where w.id = new.working_pattern_id and w.is_active)) then
    raise exception 'PRET-ORG-REF-INACTIVE: department, position, grade, location and pattern must be active' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.manager_employee_id is distinct from old.manager_employee_id) and new.change_type <> 'separation' then
    perform app.check_reporting_line(new.employee_id, new.manager_employee_id);
  end if;
  return new;
end $$;

create or replace function app.tg_job_history_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.apply_current_job(new.employee_id);
  return null;
end $$;

-- ===========================================================================
-- Separation (§5.6, F-EMP-12, F-ADM-06)
-- ===========================================================================
create or replace function app.tg_separation_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_status app.employment_status;
begin
  if current_user <> 'authenticated' then return new; end if;
  if app.is_self(new.employee_id) then
    raise exception 'PRET-SELF-001: you cannot record or change your own separation' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    select e.status into v_status from app.employees e where e.id = new.employee_id;
    if v_status not in ('on_probation','confirmed') then
      raise exception 'PRET-SEP-STATE: a separation can be recorded only for an employee On Probation or Confirmed' using errcode = '23514';
    end if;
    if new.is_withdrawn or new.superseded_by_rehire then
      raise exception 'PRET-SEP-SYSTEM-FIELD' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.is_withdrawn or old.superseded_by_rehire then
    raise exception 'PRET-SEP-CLOSED: this separation was withdrawn or closed by a rehire' using errcode = '23514';
  end if;
  if (new.is_withdrawn, new.withdrawn_at, new.withdrawn_by, new.superseded_by_rehire, new.employee_id)
     is distinct from (old.is_withdrawn, old.withdrawn_at, old.withdrawn_by, old.superseded_by_rehire, old.employee_id) then
    raise exception 'PRET-SEP-SYSTEM-FIELD: use WITHDRAW RESIGNATION' using errcode = '42501';
  end if;
  if old.last_working_day < app.today_myt() and new.last_working_day is distinct from old.last_working_day then
    raise exception 'PRET-SEP-PAST: the last working day has passed and can no longer change' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function app.tg_separation_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_emp app.employees%rowtype;
  r app.employee_job_history%rowtype;
  v_mgr_user uuid;
begin
  perform app.refresh_employee_status(new.employee_id);
  if tg_op = 'INSERT' and not new.is_withdrawn then
    select * into r from app.employee_job_history h
     where h.employee_id = new.employee_id and not h.is_deleted and h.effective_date <= new.last_working_day
     order by h.effective_date desc limit 1;
    if found and r.effective_date <> new.last_working_day then
      insert into app.employee_job_history (employee_id, effective_date, change_type, department_id, position_id, grade_id,
                                            manager_employee_id, work_location_id, working_pattern_id, employment_type, remarks)
      values (new.employee_id, new.last_working_day, 'separation', r.department_id, r.position_id, r.grade_id,
              r.manager_employee_id, r.work_location_id, r.working_pattern_id, r.employment_type, null);
    end if;
    select * into v_emp from app.employees e where e.id = new.employee_id;
    -- N-48 to ADM, SA and the manager
    perform app.notify_role_holders(array['ADM','SA']::app.privileged_role[], 'N-48',
              'Separation recorded for ' || v_emp.employee_no, 'Last working day ' || to_char(new.last_working_day, 'DD/MM/YYYY'),
              '/employees/' || v_emp.employee_no, false, 'separation_recorded',
              jsonb_build_object('employee_no', v_emp.employee_no, 'last_working_day', to_char(new.last_working_day, 'DD/MM/YYYY')),
              app.current_app_user_id());
    v_mgr_user := app.employee_user_id(v_emp.manager_employee_id);
    if v_mgr_user is not null then
      perform app.notify(v_mgr_user, 'N-48', left('Separation recorded for ' || coalesce(v_emp.preferred_name, v_emp.full_name), 150),
                         'Last working day ' || to_char(new.last_working_day, 'DD/MM/YYYY'), '/team/' || v_emp.employee_no, false,
                         'separation_recorded', jsonb_build_object('employee_no', v_emp.employee_no,
                         'last_working_day', to_char(new.last_working_day, 'DD/MM/YYYY')));
    end if;
  elsif tg_op = 'UPDATE' and new.last_working_day is distinct from old.last_working_day and not new.is_withdrawn then
    update app.employee_job_history h set effective_date = new.last_working_day
     where h.employee_id = new.employee_id and not h.is_deleted and h.change_type = 'separation' and h.effective_date = old.last_working_day
       and not exists (select 1 from app.employee_job_history x where x.employee_id = new.employee_id and not x.is_deleted
                          and x.effective_date = new.last_working_day);
  end if;
  return null;
end $$;

-- Details (T3): G4 / G6 computed server-side; G7 ≤ LWD + 30 (Q28) and access end applied to the user.
create or replace function app.tg_separation_details_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_sep app.employee_separations%rowtype;
begin
  select * into v_sep from app.employee_separations s where s.id = new.separation_id;
  if not found then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  new.employee_id := v_sep.employee_id;
  if new.portal_access_end_date < v_sep.last_working_day or new.portal_access_end_date > v_sep.last_working_day + 30 then
    raise exception 'PRET-SEP-ACCESS-END: portal access end must be between the last working day and 30 days after it' using errcode = '23514';
  end if;
  if current_user = 'authenticated' and app.is_self(v_sep.employee_id) then
    raise exception 'PRET-SELF-001: you cannot record or change your own separation' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function app.tg_separation_details_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from app.employee_separations s where s.id = new.separation_id and not s.is_withdrawn and not s.superseded_by_rehire) then
    update app.app_users u set access_end_date = new.portal_access_end_date
     where u.employee_id = new.employee_id and u.user_type = 'employee'
       and u.access_end_date is distinct from new.portal_access_end_date;
  end if;
  return null;
end $$;

-- ===========================================================================
-- Workflow functions (definer; re-check caller; no self-action — FR-G-16)
-- ===========================================================================
create or replace function app.confirm_employee(p_employee_id uuid, p_confirmation_date date, p_remarks text)
returns app.employment_status
language plpgsql volatile security definer set search_path = '' as $$
declare v_emp app.employees%rowtype; r app.employee_job_history%rowtype; v_status app.employment_status; v_user uuid;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if app.is_self(p_employee_id) then raise exception 'PRET-SELF-001: you cannot confirm yourself' using errcode = '42501'; end if;
  select * into v_emp from app.employees e where e.id = p_employee_id for update;
  if not found then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if v_emp.status <> 'on_probation' then
    raise exception 'PRET-EMP-NOT-ON-PROBATION: only an employee On Probation can be confirmed' using errcode = '23514';
  end if;
  if p_confirmation_date is null or p_confirmation_date < v_emp.join_date then
    raise exception 'PRET-EMP-CONFIRM-DATE: confirmation date must be on or after the join date' using errcode = '23514';
  end if;
  update app.employees e set confirmation_date = p_confirmation_date where e.id = p_employee_id;
  select * into r from app.employee_job_history h
   where h.employee_id = p_employee_id and not h.is_deleted and h.effective_date <= p_confirmation_date
   order by h.effective_date desc limit 1;
  if found and not exists (select 1 from app.employee_job_history x where x.employee_id = p_employee_id and not x.is_deleted
                              and x.effective_date = p_confirmation_date) then
    insert into app.employee_job_history (employee_id, effective_date, change_type, department_id, position_id, grade_id,
                                          manager_employee_id, work_location_id, working_pattern_id, employment_type, remarks)
    values (p_employee_id, p_confirmation_date, 'confirmation', r.department_id, r.position_id, r.grade_id, r.manager_employee_id,
            r.work_location_id, r.working_pattern_id, r.employment_type, left(nullif(btrim(p_remarks), ''), 500));
  end if;
  v_status := app.refresh_employee_status(p_employee_id);
  -- N-47 to the employee and the manager
  v_user := app.employee_user_id(p_employee_id);
  if v_user is not null then
    perform app.notify(v_user, 'N-47', 'Your employment has been confirmed',
                       'Confirmation date ' || to_char(p_confirmation_date, 'DD/MM/YYYY'), '/my/profile', false,
                       'employee_confirmed', jsonb_build_object('confirmation_date', to_char(p_confirmation_date, 'DD/MM/YYYY')));
  end if;
  v_user := app.employee_user_id(v_emp.manager_employee_id);
  if v_user is not null then
    perform app.notify(v_user, 'N-47', left(coalesce(v_emp.preferred_name, v_emp.full_name) || ' has been confirmed', 150),
                       'Confirmation date ' || to_char(p_confirmation_date, 'DD/MM/YYYY'), '/team/' || v_emp.employee_no, false,
                       'employee_confirmed', jsonb_build_object('confirmation_date', to_char(p_confirmation_date, 'DD/MM/YYYY')));
  end if;
  return v_status;
end $$;

create or replace function app.extend_probation(p_employee_id uuid, p_new_end date, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_emp app.employees%rowtype; v_max int; v_current date;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if app.is_self(p_employee_id) then raise exception 'PRET-SELF-001: you cannot extend your own probation' using errcode = '42501'; end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'PRET-EMP-EXTEND-REASON: a reason is required' using errcode = '23514';
  end if;
  select * into v_emp from app.employees e where e.id = p_employee_id for update;
  if not found then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if v_emp.status <> 'on_probation' then
    raise exception 'PRET-EMP-NOT-ON-PROBATION: only an employee On Probation can have probation extended' using errcode = '23514';
  end if;
  v_current := coalesce(v_emp.extended_probation_end_date, v_emp.probation_end_date);
  if p_new_end is null or p_new_end <= v_current then
    raise exception 'PRET-EMP-EXTEND-DATE: the new probation end must be after the current end (%)', to_char(v_current, 'DD/MM/YYYY') using errcode = '23514';
  end if;
  select coalesce(s.max_probation_months, 12) into v_max from app.security_settings s where s.id = 1;
  if p_new_end > (v_emp.join_date + make_interval(months => v_max) - interval '1 day')::date then
    raise exception 'PRET-EMP-EXTEND-MAX: total probation cannot exceed % months', v_max using errcode = '23514';
  end if;
  update app.employees e set extended_probation_end_date = p_new_end where e.id = p_employee_id;
  update app.employee_personal p set probation_extension_reason = left(btrim(p_reason), 500) where p.employee_id = p_employee_id;
end $$;

create or replace function app.withdraw_resignation(p_employee_id uuid, p_remarks text) returns app.employment_status
language plpgsql volatile security definer set search_path = '' as $$
declare v_sep app.employee_separations%rowtype;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if app.is_self(p_employee_id) then raise exception 'PRET-SELF-001' using errcode = '42501'; end if;
  select * into v_sep from app.employee_separations s
   where s.employee_id = p_employee_id and not s.is_withdrawn and not s.superseded_by_rehire for update;
  if not found then raise exception 'PRET-SEP-NONE: there is no separation to withdraw' using errcode = '23514'; end if;
  if v_sep.last_working_day < app.today_myt() then
    raise exception 'PRET-SEP-PAST: the last working day has passed — the resignation can no longer be withdrawn' using errcode = '23514';
  end if;
  update app.employee_separations s
     set is_withdrawn = true, withdrawn_at = now(), withdrawn_by = app.current_app_user_id(),
         withdraw_remarks = left(nullif(btrim(p_remarks), ''), 500)
   where s.id = v_sep.id;
  update app.employee_job_history h set is_deleted = true, delete_reason = 'Resignation withdrawn'
   where h.employee_id = p_employee_id and h.change_type = 'separation' and not h.is_deleted
     and h.effective_date = v_sep.last_working_day;
  update app.app_users u set access_end_date = null
   where u.employee_id = p_employee_id and u.user_type = 'employee' and u.access_end_date is not null;
  return app.refresh_employee_status(p_employee_id);
end $$;

create or replace function app.withdraw_offer(p_employee_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if not exists (select 1 from app.employees e where e.id = p_employee_id and e.status = 'pending_join') then
    raise exception 'PRET-EMP-NOT-PENDING: only a Pending Join employee can be withdrawn' using errcode = '23514';
  end if;
  update app.employees e set offer_withdrawn_at = now() where e.id = p_employee_id;
  perform app.refresh_employee_status(p_employee_id);
  -- an invited (never accepted) user is disabled; a scheduled invite is cancelled
  update app.app_users u set status = 'disabled', invite_scheduled_for = null, disabled_reason = 'Offer withdrawn'
   where u.employee_id = p_employee_id and u.user_type = 'employee' and u.status <> 'disabled';
end $$;

-- Rehire (F-EMP-13): the same employee record (same person, BR-EMP-05) starts a new employment; prior
-- job history and the closed separation stay as history. p_new_employee_no: null = keep; '' = allocate.
create or replace function app.rehire_employee(p_employee_id uuid, p_new_employee_no text, p_join_date date,
                                               p_continuous_service_date date, p_probation_months int,
                                               p_department_id uuid, p_position_id uuid, p_grade_id uuid, p_manager_id uuid,
                                               p_location_id uuid, p_pattern_id uuid)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_emp app.employees%rowtype; v_no text; v_state app.my_state;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if app.is_self(p_employee_id) then raise exception 'PRET-SELF-001' using errcode = '42501'; end if;
  select * into v_emp from app.employees e where e.id = p_employee_id for update;
  if not found then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if v_emp.status <> 'separated' then
    raise exception 'PRET-EMP-NOT-SEPARATED: only a Separated employee can be rehired' using errcode = '23514';
  end if;
  if p_join_date <= (select max(s.last_working_day) from app.employee_separations s where s.employee_id = p_employee_id and not s.is_withdrawn) then
    raise exception 'PRET-EMP-REHIRE-DATE: the new join date must be after the last working day' using errcode = '23514';
  end if;
  if p_new_employee_no is null then
    v_no := v_emp.employee_no;
  elsif btrim(p_new_employee_no) = '' then
    v_no := app.allocate_employee_no();
  else
    if not app.is_sa() then raise exception 'PRET-EMP-NO-SA: only a Super Admin can type an employee no.' using errcode = '42501'; end if;
    v_no := btrim(p_new_employee_no);
  end if;
  perform set_config('app.rehire', 'on', true);
  update app.employee_separations s set superseded_by_rehire = true
   where s.employee_id = p_employee_id and not s.is_withdrawn and not s.superseded_by_rehire;
  select l.state into v_state from app.work_locations l where l.id = p_location_id;
  update app.employees e
     set employee_no = v_no, join_date = p_join_date, probation_months = p_probation_months, confirmation_date = null,
         extended_probation_end_date = null, offer_withdrawn_at = null
   where e.id = p_employee_id;
  update app.employee_personal p set continuous_service_date = p_continuous_service_date, probation_extension_reason = null
   where p.employee_id = p_employee_id;
  insert into app.employee_job_history (employee_id, effective_date, change_type, department_id, position_id, grade_id,
                                        manager_employee_id, work_location_id, working_pattern_id, remarks)
  values (p_employee_id, p_join_date, 'rehire', p_department_id, p_position_id, p_grade_id, p_manager_id, p_location_id, p_pattern_id,
          'Rehire');
  perform set_config('app.rehire', '', true);
  perform app.refresh_employee_status(p_employee_id);
  -- portal access: a user who had accepted is re-activated from the new join date; others are re-invited by the server
  update app.app_users u
     set access_end_date = null, access_start_date = p_join_date,
         status = case when u.auth_user_id is not null then 'active'::app.user_status else 'invited'::app.user_status end,
         disabled_reason = null
   where u.employee_id = p_employee_id and u.user_type = 'employee';
  return v_no;
end $$;

-- ===========================================================================
-- Bank details (D15, FR-EMP-11): insert-only, N-41 alert, supersede older rows
-- ===========================================================================
create or replace function app.tg_bank_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id();
begin
  if v_actor is not null and new.source_change_request_id is null then
    new.verified_by := v_actor;
  end if;
  new.verified_at := now();
  new.is_superseded := false;
  if new.proof_file_id is not null and not exists (
       select 1 from app.files f where f.id = new.proof_file_id and f.owner_employee_id = new.employee_id and f.status = 'active'
          and f.subject in ('employee_document','change_request_doc')) then
    raise exception 'PRET-FILE-MISSING: the proof upload is missing or not confirmed' using errcode = '23514';
  end if;
  if new.payment_method <> 'bank_transfer' then
    new.bank_id := null; new.account_type := null; new.account_no_enc := null; new.account_no_last4 := null; new.account_no_bidx := null;
  end if;
  return new;
end $$;

create or replace function app.tg_bank_change_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_emp app.employees%rowtype; v_personal text; v_user uuid; v_actor_name text; v_payload jsonb;
begin
  if new.effective_from <= app.today_myt() then
    update app.employee_bank_accounts b set is_superseded = true
     where b.employee_id = new.employee_id and b.id <> new.id and b.effective_from <= new.effective_from and not b.is_superseded;
  end if;
  select * into v_emp from app.employees e where e.id = new.employee_id;
  select p.personal_email::text into v_personal from app.employee_personal p where p.employee_id = new.employee_id;
  select u.display_name into v_actor_name from app.app_users u where u.id = new.verified_by;
  -- PDPA-safe payload: no account numbers, no bank name (BR-NTF-02)
  v_payload := jsonb_build_object('employee_no', v_emp.employee_no, 'changed_on', to_char(now() at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                                  'effective_from', to_char(new.effective_from, 'DD/MM/YYYY'), 'changed_by', coalesce(v_actor_name, 'PRET'),
                                  'source', case when new.source_change_request_id is null then 'direct' else 'change_request' end);
  v_user := app.employee_user_id(new.employee_id);
  if v_user is not null then
    perform app.notify(v_user, 'N-41', 'Your bank details were changed',
                       'If you did not request this change, contact HR immediately.', '/my/profile?tab=bank', false,
                       'bank_details_changed', v_payload);
  end if;
  -- the alert also goes to the personal email (and the work email when there is no active user)
  if v_personal is not null then
    insert into app.email_outbox (to_user_id, to_address, template_code, subject, payload)
    values (null, v_personal, 'bank_details_changed', 'Your bank details in PRET were changed', v_payload);
  end if;
  if v_user is null or not exists (select 1 from app.app_users u where u.id = v_user and u.status = 'active') then
    insert into app.email_outbox (to_user_id, to_address, template_code, subject, payload)
    values (null, v_emp.work_email, 'bank_details_changed', 'Your bank details in PRET were changed', v_payload);
  end if;
  perform app.notify_role_holders(array['SA']::app.privileged_role[], 'N-41', 'Bank details changed for ' || v_emp.employee_no,
            'Changed by ' || coalesce(v_actor_name, 'PRET') || ', effective ' || to_char(new.effective_from, 'DD/MM/YYYY'),
            '/employees/' || v_emp.employee_no || '?tab=bank', false, 'bank_details_changed_sa', v_payload, null);
  return null;
end $$;

-- ===========================================================================
-- Documents, notes, recommendations, group members
-- ===========================================================================
create or replace function app.tg_documents_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.file_id is distinct from old.file_id then
    if not exists (select 1 from app.files f where f.id = new.file_id and f.subject = 'employee_document'
                      and f.owner_employee_id = new.employee_id and f.status = 'active') then
      raise exception 'PRET-FILE-MISSING: the document upload is missing or not confirmed' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.employee_id is distinct from old.employee_id then
    raise exception 'PRET-DOC-EMPLOYEE' using errcode = '23514';
  end if;
  if new.category in ('mykad_copy','medical_report','disciplinary_letter','bank_proof') then
    new.visible_to_employee := false;
  end if;
  update app.files f
     set data_category = case new.category when 'mykad_copy' then 'identity' when 'medical_report' then 'health'
                                           when 'bank_proof' then 'bank' else null end::app.data_category
   where f.id = new.file_id;
  return new;
end $$;

create or replace function app.tg_hr_notes_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.employee_id is distinct from old.employee_id then
    raise exception 'PRET-NOTE-EMPLOYEE' using errcode = '23514';
  end if;
  if (new.body, new.note_date) is distinct from (old.body, old.note_date) then
    insert into app.hr_note_revisions (note_id, employee_id, revision, note_date, body, edited_by, edited_at)
    values (old.id, old.employee_id,
            coalesce((select max(r.revision) from app.hr_note_revisions r where r.note_id = old.id), 0) + 1,
            old.note_date, old.body, coalesce(old.updated_by, old.created_by), coalesce(old.updated_at, old.created_at));
  end if;
  return new;
end $$;

create or replace function app.tg_probation_rec_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.recommended_by := coalesce(app.current_app_user_id(), new.recommended_by);
  new.recommended_at := now();
  if app.is_self(new.employee_id) then
    raise exception 'PRET-SELF-001: you cannot recommend on your own probation' using errcode = '42501';
  end if;
  if not exists (select 1 from app.employees e where e.id = new.employee_id and e.status = 'on_probation') then
    raise exception 'PRET-EMP-NOT-ON-PROBATION: the employee is not On Probation' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function app.tg_group_members_before() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.added_by := coalesce(app.current_app_user_id(), new.added_by);
  new.added_at := now();
  return new;
end $$;

-- ===========================================================================
-- Change requests (F-EMP-19, §5.8, rls-policies §7)
-- ===========================================================================
-- Field whitelist per category (CR3). S1 fields: nric, account_no, asnb_account_no (ciphertext only).
create or replace function app.cr_field_allowed(p_category app.cr_category, p_table text, p_field text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_category
    when 'legal_name' then p_table = 'employees' and p_field = 'full_name'
    when 'mykad' then (p_table = 'employee_personal' and p_field in ('nric','date_of_birth')) or (p_table = 'employees' and p_field = 'gender')
    when 'marital_spouse' then (p_table = 'employee_marital_history' and p_field = 'marital_status')
      or (p_table = 'employee_spouses' and p_field in ('full_name','nric','marriage_date','working_status','is_oku','income_tax_no',
                                                       'relief_claimed_by_employee','record_status'))
    when 'children' then p_table = 'employee_children' and p_field in ('full_name','nric','date_of_birth','gender','relationship',
                                                       'pcb_category','relief_share','institution_level','is_oku','*')
    when 'oku' then p_table = 'employee_sensitive' and p_field in ('is_oku','oku_card_no')
    when 'religion' then p_table = 'employee_sensitive' and p_field = 'religion'
    when 'race' then p_table = 'employee_personal' and p_field in ('race','race_other')
    when 'bank_details' then p_table = 'employee_bank_accounts' and p_field in ('payment_method','bank_id','account_type','account_no',
                                                       'account_holder_name','holder_name_mismatch_ack','asnb_account_no')
    when 'statutory_numbers' then p_table = 'employee_statutory_profiles' and p_field in ('income_tax_no','lhdn_branch_id','epf_no',
                                                       'epf_rate_type','epf_specific_rate','epf_extra_employee_pct','socso_contributed_before',
                                                       'pay_zakat','zakat_monthly_amount','zakat_account_no','zakat_body_id',
                                                       'ptptn_monthly_amount','ptptn_start_date','ptptn_end_date')
    else false end
$$;

create or replace function app.tg_cr_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_today date := app.today_myt(); v_back int;
begin
  if app.current_app_user_id() is not null and not app.is_self(new.employee_id) then
    raise exception 'PRET-ACC-403: change requests are submitted by the employee' using errcode = '42501';
  end if;
  new.cr_no := private.next_doc_no('CR', extract(year from v_today)::int);
  new.status := 'submitted';
  new.decision_remarks := null; new.decided_by := null; new.decided_by_employee_id := null; new.decided_at := null; new.applied_at := null;
  v_back := case when new.category = 'marital_spouse' then 90 else 0 end;
  if new.effective_date > v_today + 90 or new.effective_date < v_today - v_back then
    raise exception 'PRET-CR-EFFECTIVE: the effective date must be from today (marital status: up to 90 days back) to 90 days ahead' using errcode = '23514';
  end if;
  if not exists (select 1 from app.employees e where e.id = new.employee_id and e.status in ('pending_join','on_probation','confirmed','notice_period')) then
    raise exception 'PRET-CR-STATE: change requests are for active employees' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function app.tg_cr_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then return new; end if;
  if not (old.status = 'submitted' and new.status = 'cancelled' and app.is_self(old.employee_id))
     or (new.cr_no, new.employee_id, new.category, new.effective_date, new.employee_remarks, new.decision_remarks,
         new.decided_by, new.decided_by_employee_id, new.decided_at, new.applied_at, new.idempotency_key)
        is distinct from
        (old.cr_no, old.employee_id, old.category, old.effective_date, old.employee_remarks, old.decision_remarks,
         old.decided_by, old.decided_by_employee_id, old.decided_at, old.applied_at, old.idempotency_key) then
    raise exception 'PRET-CR-CANCEL-ONLY: you can only cancel your own submitted request' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function app.tg_cr_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_no text;
begin
  select e.employee_no into v_no from app.employees e where e.id = new.employee_id;
  perform app.notify_role_holders(array['ADM','SA']::app.privileged_role[], 'N-43',
            'Change request ' || new.cr_no || ' submitted', v_no || ' · ' || replace(new.category::text, '_', ' '),
            '/employees/change-requests/' || new.cr_no, true, 'change_request_submitted',
            jsonb_build_object('cr_no', new.cr_no, 'employee_no', v_no, 'category', new.category::text),
            app.current_app_user_id());
  return null;
end $$;

create or replace function app.tg_cr_items_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cr app.change_requests%rowtype; v_ok boolean;
begin
  select * into v_cr from app.change_requests c where c.id = new.change_request_id;
  if not found then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' then raise exception 'PRET-CR-ITEMS-IMMUTABLE' using errcode = '42501'; end if;
  if v_cr.status <> 'submitted' then raise exception 'PRET-CR-STATE' using errcode = '23514'; end if;
  if app.current_app_user_id() is not null and not app.is_self(v_cr.employee_id) then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  new.employee_id := v_cr.employee_id;
  if not app.cr_field_allowed(v_cr.category, new.target_table, new.field_name) then
    raise exception 'PRET-CR-FIELD: % is not part of a % request', new.field_name, v_cr.category using errcode = '23514';
  end if;
  if new.field_name in ('nric','account_no','asnb_account_no') then
    if new.op <> 'remove' and (new.new_value_enc is null or new.new_value_last4 is null) then
      raise exception 'PRET-CR-S1: encrypted value required' using errcode = '23514';
    end if;
    new.new_value := null;                       -- never plaintext
  end if;
  if new.target_row_id is null then raise exception 'PRET-CR-TARGET' using errcode = '23514'; end if;
  v_ok := case
    when new.target_table in ('employees') then new.op = 'update' and new.target_row_id = v_cr.employee_id
    when new.target_table in ('employee_personal','employee_sensitive','employee_statutory_profiles') then new.op = 'update' and new.target_row_id = v_cr.employee_id
    when new.target_table = 'employee_marital_history' then new.op = 'insert'
    when new.target_table = 'employee_bank_accounts' then new.op = 'insert' and not exists (select 1 from app.employee_bank_accounts b where b.id = new.target_row_id)
    when new.target_table = 'employee_spouses' then
      (new.op = 'update' and exists (select 1 from app.employee_spouses s where s.id = new.target_row_id and s.employee_id = v_cr.employee_id))
      or (new.op = 'insert' and not exists (select 1 from app.employee_spouses s where s.id = new.target_row_id))
    when new.target_table = 'employee_children' then
      (new.op in ('update','remove') and exists (select 1 from app.employee_children c where c.id = new.target_row_id and c.employee_id = v_cr.employee_id))
      or (new.op = 'insert' and not exists (select 1 from app.employee_children c where c.id = new.target_row_id))
    else false end;
  if not coalesce(v_ok, false) then
    raise exception 'PRET-CR-TARGET: the item does not belong to this employee' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function app.tg_cr_files_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cr app.change_requests%rowtype;
begin
  select * into v_cr from app.change_requests c where c.id = new.change_request_id;
  if not found or v_cr.status <> 'submitted' then raise exception 'PRET-CR-STATE' using errcode = '23514'; end if;
  if not exists (select 1 from app.files f where f.id = new.file_id and f.subject = 'change_request_doc' and f.status = 'active'
                    and f.owner_employee_id = v_cr.employee_id
                    and (app.current_app_user_id() is null or f.created_by = app.current_app_user_id())) then
    raise exception 'PRET-FILE-MISSING: the attachment is missing or not confirmed' using errcode = '23514';
  end if;
  return new;
end $$;

-- Applies an approved CR's items to the master tables (definer; internal — called by decide / the daily job).
create or replace function app.apply_change_request(p_cr_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cr app.change_requests%rowtype;
  g record;
  v_obj jsonb;
  v_s1 jsonb;
  k text;
  v_cols text; v_sets text; v_pk text;
  v_proof uuid;
begin
  select * into v_cr from app.change_requests c where c.id = p_cr_id for update;
  if not found or v_cr.status <> 'approved' or v_cr.applied_at is not null then return; end if;
  select cf.file_id into v_proof from app.change_request_files cf where cf.change_request_id = p_cr_id order by cf.file_id limit 1;

  for g in
    select i.target_table, i.target_row_id, i.op,
           coalesce(jsonb_object_agg(i.field_name, i.new_value) filter (where i.new_value_enc is null and i.field_name <> '*'), '{}'::jsonb) as vals,
           coalesce(jsonb_object_agg(i.field_name, jsonb_build_object(
                      'enc', '\x' || encode(i.new_value_enc, 'hex'), 'last4', i.new_value_last4,
                      'bidx', case when i.new_value_bidx is null then null else '\x' || encode(i.new_value_bidx, 'hex') end))
                    filter (where i.new_value_enc is not null), '{}'::jsonb) as s1,
           min(case i.target_table when 'employee_marital_history' then 0 else 1 end) as ord
      from app.change_request_items i
     where i.change_request_id = p_cr_id
     group by i.target_table, i.target_row_id, i.op
     order by ord, i.target_table
  loop
    for k in select jsonb_object_keys(g.vals) union all select jsonb_object_keys(g.s1) loop
      if not app.cr_field_allowed(v_cr.category, g.target_table, k) then
        raise exception 'PRET-CR-FIELD: %', k using errcode = '23514';
      end if;
    end loop;
    v_obj := g.vals;
    for k, v_s1 in select * from jsonb_each(g.s1) loop
      if k = 'nric' then
        v_obj := v_obj || jsonb_build_object('nric_enc', v_s1 -> 'enc', 'nric_last4', v_s1 -> 'last4', 'nric_bidx', v_s1 -> 'bidx');
      elsif k = 'account_no' then
        v_obj := v_obj || jsonb_build_object('account_no_enc', v_s1 -> 'enc', 'account_no_last4', v_s1 -> 'last4', 'account_no_bidx', v_s1 -> 'bidx');
      elsif k = 'asnb_account_no' then
        v_obj := v_obj || jsonb_build_object('asnb_account_no_enc', v_s1 -> 'enc', 'asnb_account_no_last4', v_s1 -> 'last4');
      end if;
    end loop;

    if g.op = 'remove' then
      update app.employee_children c set is_active = false where c.id = g.target_row_id and c.employee_id = v_cr.employee_id;
    elsif g.target_table = 'employee_marital_history' then
      insert into app.employee_marital_history (employee_id, marital_status, effective_date)
      values (v_cr.employee_id, (v_obj ->> 'marital_status')::app.marital_status, v_cr.effective_date)
      on conflict (employee_id, effective_date) do update set marital_status = excluded.marital_status;
    elsif g.op = 'insert' then
      v_obj := v_obj || jsonb_build_object('id', g.target_row_id, 'employee_id', v_cr.employee_id);
      if g.target_table = 'employee_bank_accounts' then
        v_obj := v_obj || jsonb_build_object('effective_from', v_cr.effective_date, 'verified_by', v_cr.decided_by,
                                             'source_change_request_id', v_cr.id, 'proof_file_id', v_proof);
      end if;
      select string_agg(format('%I', x), ', ') into v_cols from jsonb_object_keys(v_obj) x;
      execute format('insert into app.%I (%s) select %s from jsonb_populate_record(null::app.%I, $1)',
                     g.target_table, v_cols, v_cols, g.target_table) using v_obj;
    else
      if v_obj = '{}'::jsonb then continue; end if;
      if g.target_table = 'employee_personal' and v_obj ? 'date_of_birth' then
        v_obj := v_obj || jsonb_build_object('dob_overridden', false);
      end if;
      select string_agg(format('%I = r.%I', x, x), ', ') into v_sets from jsonb_object_keys(v_obj) x;
      v_pk := case when g.target_table in ('employees','employee_spouses','employee_children') then 'id' else 'employee_id' end;
      execute format('update app.%I t set %s from jsonb_populate_record(null::app.%I, $1) r where t.%I = $2 and t.%I = $3',
                     g.target_table, v_sets, g.target_table, v_pk,
                     case when g.target_table = 'employees' then 'id' else 'employee_id' end)
        using v_obj, g.target_row_id, v_cr.employee_id;
    end if;
  end loop;
  update app.change_requests c set applied_at = now() where c.id = p_cr_id;
end $$;

create or replace function app.decide_change_request(p_cr_id uuid, p_decision text, p_remarks text, p_expected_version int)
returns app.cr_status
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_cr app.change_requests%rowtype;
  v_status app.cr_status;
  v_user uuid;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  select * into v_cr from app.change_requests c where c.id = p_cr_id for update;
  if not found then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if v_cr.employee_id is not distinct from app.current_employee_id() then
    raise exception 'PRET-SELF-001: you cannot decide your own change request' using errcode = '42501';
  end if;
  if v_cr.status <> 'submitted' then
    raise exception 'PRET-CR-STATE: this request has already been decided or cancelled' using errcode = '23514';
  end if;
  if p_expected_version is not null and v_cr.version <> p_expected_version then
    raise exception 'PRET-STALE: this request changed since you opened it — refresh and try again' using errcode = '40001';
  end if;
  if p_decision not in ('approve','reject') then raise exception 'PRET-CR-DECISION' using errcode = '22023'; end if;
  if p_decision = 'reject' and nullif(btrim(p_remarks), '') is null then
    raise exception 'PRET-CR-REMARKS: remarks are required to reject' using errcode = '23514';
  end if;
  v_status := case p_decision when 'approve' then 'approved' else 'rejected' end::app.cr_status;
  update app.change_requests c
     set status = v_status, decision_remarks = left(nullif(btrim(p_remarks), ''), 500),
         decided_by = app.current_app_user_id(), decided_by_employee_id = app.current_employee_id(), decided_at = now()
   where c.id = p_cr_id;
  if v_status = 'approved' and (v_cr.effective_date <= app.today_myt() or v_cr.category in ('bank_details','marital_spouse')) then
    perform app.apply_change_request(p_cr_id);
  end if;
  v_user := app.employee_user_id(v_cr.employee_id);
  if v_user is not null then
    perform app.notify(v_user, 'N-42', 'Change request ' || v_cr.cr_no || ' ' || v_status::text,
                       case when v_status = 'approved' then 'Applies from ' || to_char(v_cr.effective_date, 'DD/MM/YYYY') else 'See the HR remarks.' end,
                       '/my/profile/change-requests/' || v_cr.cr_no, false, 'change_request_decided',
                       jsonb_build_object('cr_no', v_cr.cr_no, 'status', v_status::text));
  end if;
  return v_status;
end $$;

-- ===========================================================================
-- Completeness (F-EMP-24, FR-EMP-13) and the activity trail (F-EMP-21/28) — admins only
-- ===========================================================================
create or replace function app.employee_completeness(p_ids uuid[])
returns table (employee_id uuid, missing text[], missing_payroll text[], total_checks int)
language sql stable security definer set search_path = '' as $$
  select e.id,
    array_remove(array[
      case when p.employee_id is null then 'personal' end,
      case when not exists (select 1 from app.employee_emergency_contacts c where c.employee_id = e.id) then 'emergency_contact' end,
      case when ms.marital_status is null then 'marital_status' end,
      case when ms.marital_status = 'married' and not exists (select 1 from app.employee_spouses s
              where s.employee_id = e.id and s.record_status = 'current') then 'spouse' end,
      case when e.manager_employee_id is null and not coalesce(h.is_top_of_org, false) then 'manager' end,
      case when b.id is null then 'payment_method' end
    ], null),
    array_remove(array[
      case when coalesce(sp.pay_pcb, true) and sp.income_tax_no is null then 'income_tax_no' end,
      case when coalesce(sp.pay_epf, true) and sp.epf_no is null then 'epf_no' end,
      case when coalesce(sp.pay_socso, true) and sp.socso_no is null then 'socso_no' end,
      case when coalesce(sp.pay_socso, true) and sp.socso_category is null then 'socso_category' end,
      case when coalesce(b.payment_method, 'bank_transfer') = 'bank_transfer' and b.account_no_last4 is null then 'bank_account' end,
      case when exists (select 1 from app.employee_spouses s where s.employee_id = e.id and s.record_status = 'current'
              and s.working_status = 'not_working' and s.relief_claimed_by_employee is null) then 'spouse_relief' end,
      case when exists (select 1 from app.employee_children c where c.employee_id = e.id and c.is_active
              and (c.pcb_category is null or c.relief_share is null)) then 'child_pcb' end
    ], null),
    13
    from app.employees e
    left join app.employee_personal p on p.employee_id = e.id
    left join app.employee_hr_private h on h.employee_id = e.id
    left join app.employee_statutory_profiles sp on sp.employee_id = e.id
    left join lateral (select m.marital_status from app.employee_marital_history m
                        where m.employee_id = e.id and m.effective_date <= app.today_myt()
                        order by m.effective_date desc limit 1) ms on true
    left join lateral (select x.id, x.payment_method, x.account_no_last4 from app.employee_bank_accounts x
                        where x.employee_id = e.id and x.effective_from <= app.today_myt()
                        order by x.effective_from desc limit 1) b on true
   where e.id = any(p_ids) and app.is_admin()
$$;

-- ===========================================================================
-- Organisation guards extended now that employees exist (replace W2-002 versions)
-- ===========================================================================
create or replace function app.tg_departments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cycle boolean; v_n int;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'PRET-ORG-CYCLE: a department cannot be its own parent' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id then
      if not exists (select 1 from app.departments d where d.id = new.parent_id and d.is_active) then
        raise exception 'PRET-ORG-PARENT-INACTIVE: the parent department must be active' using errcode = '23514';
      end if;
      with recursive up as (
        select d.id, d.parent_id, 1 as depth from app.departments d where d.id = new.parent_id
        union all
        select d.id, d.parent_id, up.depth + 1 from app.departments d join up on d.id = up.parent_id where up.depth < 200)
      select exists (select 1 from up where up.id = new.id) into v_cycle;
      if v_cycle then
        raise exception 'PRET-ORG-CYCLE: a department cannot sit under itself or one of its sub-departments' using errcode = '23514';
      end if;
    end if;
  end if;
  if new.cost_centre_id is not null and (tg_op = 'INSERT' or new.cost_centre_id is distinct from old.cost_centre_id)
     and not exists (select 1 from app.cost_centres c where c.id = new.cost_centre_id and c.is_active) then
    raise exception 'PRET-ORG-REF-INACTIVE: the cost centre must be active' using errcode = '23514';
  end if;
  if new.head_employee_id is not null and (tg_op = 'INSERT' or new.head_employee_id is distinct from old.head_employee_id)
     and not exists (select 1 from app.employees e where e.id = new.head_employee_id
                        and e.status in ('on_probation','confirmed','notice_period')) then
    raise exception 'PRET-ORG-HEAD-INACTIVE: the head of department must be an active employee' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.is_active and not new.is_active then
    if exists (select 1 from app.departments c where c.parent_id = new.id and c.is_active) then
      raise exception 'PRET-ORG-ACTIVE-CHILDREN: deactivate or move its active sub-departments first' using errcode = '23514';
    end if;
    select count(*) into v_n from app.employees e
     where e.department_id = new.id and e.status in ('pending_join','on_probation','confirmed','notice_period');
    if v_n > 0 then
      raise exception 'PRET-ORG-IN-USE: move % employee(s) first', v_n using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create or replace function app.tg_work_locations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if tg_op = 'INSERT' or new.default_pattern_id is distinct from old.default_pattern_id then
    if not exists (select 1 from app.working_patterns p where p.id = new.default_pattern_id and p.is_active) then
      raise exception 'PRET-ORG-REF-INACTIVE: the default working-week pattern must be active' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.is_active and not new.is_active then
    select count(*) into v_n from app.employees e
     where e.work_location_id = new.id and e.status in ('pending_join','on_probation','confirmed','notice_period');
    if v_n > 0 then
      raise exception 'PRET-ORG-IN-USE: move % employee(s) first', v_n using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- Location state change: employees' work state follows (F18); the PH calendar follows with it.
create or replace function app.tg_work_locations_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state is distinct from old.state then
    update app.employees e set work_state = new.state where e.work_location_id = new.id;
  end if;
  return null;
end $$;

-- Directory follows renames of the lookups it projects.
create or replace function app.tg_directory_lookup_refresh() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform app.refresh_directory(null);
  return null;
end $$;

-- Publish checks: states of active employees (work state or PH override); active locations until employees exist.
create or replace function app.holiday_year_checks(p_year int)
returns table (state app.my_state, compulsory_present app.compulsory_holiday[], compulsory_missing app.compulsory_holiday[], paid_count int)
language sql stable security definer set search_path = '' as $$
  with emp_states as (
    select distinct coalesce(h.ph_state_override, e.work_state) as state
      from app.employees e left join app.employee_hr_private h on h.employee_id = e.id
     where e.status in ('pending_join','on_probation','confirmed','notice_period')),
  st as (
    select es.state from emp_states es
    union
    select distinct l.state from app.work_locations l where l.is_active and not exists (select 1 from emp_states)),
  hol as (
    select hs.state, h.compulsory, h.holiday_type, h.is_half_day
      from app.public_holidays h join app.public_holiday_states hs on hs.holiday_id = h.id
     where h.year = p_year and h.is_active and h.is_observed)
  select st.state,
         coalesce((select array_agg(distinct hol.compulsory order by hol.compulsory) from hol
                    where hol.state = st.state and hol.compulsory is not null), '{}'),
         coalesce((select array_agg(c order by c) from unnest(enum_range(null::app.compulsory_holiday)) c
                    where not exists (select 1 from hol where hol.state = st.state and hol.compulsory = c)), '{}'),
         (select count(*)::int from hol where hol.state = st.state and hol.holiday_type in ('national','state','special') and not hol.is_half_day)
    from st
   where app.is_admin()
   order by st.state
$$;

-- ===========================================================================
-- Attach triggers (BEFORE triggers fire in name order: tg_00_self_edit first sees only the user's changes)
-- ===========================================================================
create trigger tg_stamp before insert or update on app.banks                              for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.lhdn_branches                      for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employees                          for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_personal                  for each row execute function app.tg_stamp();
create trigger tg_stamp before insert          on app.employee_marital_history            for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_sensitive                 for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_hr_private                for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_emergency_contacts        for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_spouses                   for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_children                  for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_job_history               for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_separations               for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_separation_details         for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_statutory_profiles        for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_statutory_employer_flags   for each row execute function app.tg_stamp();
create trigger tg_stamp before insert          on app.employee_bank_accounts              for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_documents                 for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.hr_notes                           for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.prior_employments                  for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.change_requests                    for each row execute function app.tg_stamp();

-- self-edit guard (US-EMP-027)
create trigger tg_00_self_edit before insert or update on app.employees                   for each row execute function app.tg_self_edit_guard();
create trigger tg_00_self_edit before insert or update on app.employee_personal           for each row execute function app.tg_self_edit_guard();
create trigger tg_00_self_edit before insert or update on app.employee_sensitive          for each row execute function app.tg_self_edit_guard();
create trigger tg_00_self_edit before insert or update on app.employee_spouses            for each row execute function app.tg_self_edit_guard();
create trigger tg_00_self_edit before insert or update on app.employee_children           for each row execute function app.tg_self_edit_guard();
create trigger tg_00_self_edit before insert or update on app.employee_statutory_profiles for each row execute function app.tg_self_edit_guard();
create trigger tg_00_self_edit before insert or update on app.employee_statutory_employer_flags for each row execute function app.tg_self_edit_guard();
create trigger tg_00_self_edit before insert on app.employee_bank_accounts                for each row execute function app.tg_self_edit_guard();
create trigger tg_00_self_edit before insert on app.employee_marital_history              for each row execute function app.tg_self_edit_guard();

create trigger tg_10_guard   before insert or update on app.employees for each row execute function app.tg_employees_guard();
create trigger tg_20_derive  before insert or update on app.employees for each row execute function app.tg_employees_derive();
create trigger tg_after      after insert or update on app.employees for each row execute function app.tg_employees_after();
create trigger tg_closure    after insert or update of manager_employee_id, status on app.employees
  for each statement execute function app.tg_employees_closure();
create constraint trigger tg_top_of_org after insert or update of manager_employee_id, status on app.employees
  deferrable initially deferred for each row execute function app.tg_check_top_of_org();
create constraint trigger tg_top_of_org after insert or update of is_top_of_org on app.employee_hr_private
  deferrable initially deferred for each row execute function app.tg_check_top_of_org();
create trigger tg_guard before insert or update on app.employee_hr_private for each row execute function app.tg_hr_private_guard();
create trigger tg_validate before insert or update on app.employee_personal for each row execute function app.tg_personal_validate();
create trigger tg_after after insert on app.employee_marital_history for each row execute function app.tg_marital_after();
create trigger tg_validate before insert or update on app.employee_spouses for each row execute function app.tg_family_validate();
create trigger tg_validate before insert or update on app.employee_children for each row execute function app.tg_family_validate();
create constraint trigger tg_min_one after delete or update of employee_id on app.employee_emergency_contacts
  deferrable initially deferred for each row execute function app.tg_emergency_min_one();
create trigger tg_validate before insert or update on app.prior_employments for each row execute function app.tg_prior_employment_validate();

create trigger tg_notify_self after update on app.employees for each row
  when (old.preferred_name is distinct from new.preferred_name or old.mobile_phone is distinct from new.mobile_phone)
  execute function app.tg_self_update_notify();
create trigger tg_notify_self after update on app.employee_personal for each row execute function app.tg_self_update_notify();
create trigger tg_notify_self after insert or update or delete on app.employee_emergency_contacts for each row execute function app.tg_self_update_notify();

create trigger tg_10_guard    before insert or update on app.employee_job_history for each row execute function app.tg_job_history_guard();
create trigger tg_20_validate before insert or update on app.employee_job_history for each row execute function app.tg_job_history_validate();
create trigger tg_after       after insert or update on app.employee_job_history for each row execute function app.tg_job_history_after();

create trigger tg_guard before insert or update on app.employee_separations for each row execute function app.tg_separation_guard();
create trigger tg_after after insert or update on app.employee_separations for each row execute function app.tg_separation_after();
create trigger tg_before before insert or update on app.employee_separation_details for each row execute function app.tg_separation_details_before();
create trigger tg_after after insert or update on app.employee_separation_details for each row execute function app.tg_separation_details_after();

create trigger tg_10_before before insert on app.employee_bank_accounts for each row execute function app.tg_bank_before();
create trigger tg_alert after insert on app.employee_bank_accounts for each row execute function app.tg_bank_change_alert();

create trigger tg_before before insert or update on app.employee_documents for each row execute function app.tg_documents_before();
create trigger tg_revision before update on app.hr_notes for each row execute function app.tg_hr_notes_revision();
create trigger tg_before before insert on app.probation_recommendations for each row execute function app.tg_probation_rec_before();
create trigger tg_before before insert on app.employee_group_members for each row execute function app.tg_group_members_before();

create trigger tg_before_insert before insert on app.change_requests for each row execute function app.tg_cr_before_insert();
create trigger tg_guard before update on app.change_requests for each row execute function app.tg_cr_guard();
create trigger tg_after_insert after insert on app.change_requests for each row execute function app.tg_cr_after_insert();
create trigger tg_before before insert or update on app.change_request_items for each row execute function app.tg_cr_items_before();
create trigger tg_before before insert on app.change_request_files for each row execute function app.tg_cr_files_before();

create trigger tg_after after update on app.work_locations for each row execute function app.tg_work_locations_after();
create trigger tg_directory after update of title on app.positions for each statement execute function app.tg_directory_lookup_refresh();
create trigger tg_directory after update of name on app.departments for each statement execute function app.tg_directory_lookup_refresh();
create trigger tg_directory after update of name on app.work_locations for each statement execute function app.tg_directory_lookup_refresh();

-- Data-change audit (F-ADM-09). Args: [0] data categories, [1] reference column. AU6 (employee) is the
-- row's employee_id — app.employees rows are found by entity_type = 'employees' and entity_id.
create trigger tg_audit after insert or update or delete on app.banks                         for each row execute function audit.tg_log_change('', 'code');
create trigger tg_audit after insert or update or delete on app.lhdn_branches                 for each row execute function audit.tg_log_change('', 'code');
create trigger tg_audit after insert or update or delete on app.employees                     for each row execute function audit.tg_log_change('identity,contact', 'employee_no');
create trigger tg_audit after insert or update or delete on app.employee_personal             for each row execute function audit.tg_log_change('identity,contact');
create trigger tg_audit after insert or update or delete on app.employee_marital_history      for each row execute function audit.tg_log_change('family');
create trigger tg_audit after insert or update or delete on app.employee_sensitive            for each row execute function audit.tg_log_change('religion,health');
create trigger tg_audit after insert or update or delete on app.employee_hr_private           for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.employee_group_members        for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.employee_emergency_contacts   for each row execute function audit.tg_log_change('contact');
create trigger tg_audit after insert or update or delete on app.employee_spouses              for each row execute function audit.tg_log_change('family');
create trigger tg_audit after insert or update or delete on app.employee_children             for each row execute function audit.tg_log_change('family');
create trigger tg_audit after insert or update or delete on app.employee_job_history          for each row execute function audit.tg_log_change('', 'change_type');
create trigger tg_audit after insert or update or delete on app.probation_recommendations     for each row execute function audit.tg_log_change('', 'recommendation');
create trigger tg_audit after insert or update or delete on app.employee_separations          for each row execute function audit.tg_log_change('', 'separation_type');
create trigger tg_audit after insert or update or delete on app.employee_separation_details   for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.employee_statutory_profiles   for each row execute function audit.tg_log_change('statutory');
create trigger tg_audit after insert or update or delete on app.employee_statutory_employer_flags for each row execute function audit.tg_log_change('statutory');
create trigger tg_audit after insert or update or delete on app.employee_bank_accounts        for each row execute function audit.tg_log_change('bank');
create trigger tg_audit after insert or update or delete on app.employee_documents            for each row execute function audit.tg_log_change('', 'title');
create trigger tg_audit after insert or update or delete on app.hr_notes                      for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.hr_note_revisions             for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.prior_employments             for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.change_requests               for each row execute function audit.tg_log_change('', 'cr_no');
create trigger tg_audit after insert or update or delete on app.change_request_items          for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.change_request_files          for each row execute function audit.tg_log_change();
-- employee_directory / reporting_closure are derived caches (not audited).
