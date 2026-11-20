-- PRET W2-004 · 03 — generic approval engine (ADR-0004, data-model §8, rls-policies §3, §7, §10).
-- route: app.route_approval / app.open_approval_level · decide: app.decide_task (row locks, first decision wins) ·
-- eligibility: app.can_act_on_task · trail identity: trigger app.tg_task_decision · re-routing (BR-LV-61), HR reassign (L14).
-- Subject handlers (leave, cancellation, replacement credit) live in migration 04; claims join in W2-005.

-- ===========================================================================
-- Facts used by routing (definer, read-only)
-- ===========================================================================
-- The ACTIVE portal user of an employee (assignment needs someone who can sign in).
create or replace function app.active_user_of(p_employee_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from app.app_users u
   where u.employee_id = p_employee_id and u.user_type = 'employee' and u.status = 'active'
     and u.access_start_date <= app.today_myt() and (u.access_end_date is null or u.access_end_date >= app.today_myt())
   limit 1
$$;

create or replace function app.user_name(p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(e.preferred_name, e.full_name) from app.app_users u join app.employees e on e.id = u.employee_id where u.id = p_user_id),
                  (select u.display_name from app.app_users u where u.id = p_user_id))
$$;

create or replace function app.employee_display(p_employee_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(e.preferred_name, e.full_name) from app.employees e where e.id = p_employee_id
$$;

-- Employee is on approved (or cancellation-pending) leave on a date (BR-LV-61).
create or replace function app.is_on_leave(p_employee_id uuid, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
                  where d.employee_id = p_employee_id and d.leave_date = p_date and d.weight > 0 and d.is_blocking
                    and a.status in ('approved','cancellation_pending'))
$$;

-- Active delegate of a user for a scope on a date (latest set wins).
create or replace function app.active_delegate(p_user_id uuid, p_on date, p_scope text) returns uuid
language sql stable security definer set search_path = '' as $$
  select d.delegate_user_id from app.delegations d
   where d.delegator_user_id = p_user_id and d.cancelled_at is null and p_on between d.valid_from and d.valid_to
     and (d.scope::text = p_scope or d.scope = 'both')
   order by d.created_at desc limit 1
$$;

create or replace function app.task_scope(p_subject app.task_subject) returns text
language sql immutable set search_path = '' as $$
  select case when p_subject = 'claim' then 'claims' else 'leave' end
$$;

create or replace function app.task_subject_id(p_task app.approval_tasks) returns uuid
language sql immutable set search_path = '' as $$
  select coalesce(p_task.leave_application_id, p_task.replacement_credit_id, p_task.claim_id, p_task.change_request_id,
                  p_task.disbursement_batch_id, p_task.payroll_run_id, p_task.stat_table_version_id)
$$;

-- ===========================================================================
-- RLS helpers (rls-policies §3) — replaces the W2-003 can_see_team_row with the approver clause
-- ===========================================================================
create or replace function app.is_current_approver_for(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.approval_tasks t
                  where t.subject_employee_id = p_employee_id and t.status = 'open'
                    and (app.current_app_user_id() in (t.assignee_user_id, t.original_assignee_user_id)
                         or (t.assignee_user_id is not null
                             and app.active_delegate(t.assignee_user_id, app.today_myt(), app.task_scope(t.subject_type)) = app.current_app_user_id())))
$$;

create or replace function app.can_see_team_row(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_self(p_employee_id) or app.is_admin() or app.is_manager_of(p_employee_id) or app.is_current_approver_for(p_employee_id)
$$;

-- Approver eligibility for one open task (rls-policies §3). Never true for the subject employee or the preparer.
create or replace function app.can_act_on_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.approval_tasks t
     where t.id = p_task_id and t.status = 'open'
       and app.current_app_user_id() is not null
       and t.subject_employee_id is distinct from app.current_employee_id()
       and t.subject_prepared_by is distinct from app.current_app_user_id()
       and (   (t.source = 'admin_pool' and app.is_admin())
            or (t.source = 'super_admin_pool' and app.is_sa())
            or (t.source = 'claim_pool' and (app.is_admin()
                   or app.current_app_user_id() in (t.assignee_user_id, t.original_assignee_user_id)
                   or app.active_delegate(t.assignee_user_id, app.today_myt(), 'claims') = app.current_app_user_id()))
            or (t.source in ('direct_manager','leave_approver_override','managers_manager','specific_employee')
                and (   app.current_app_user_id() in (t.assignee_user_id, t.original_assignee_user_id)
                     or app.active_delegate(t.assignee_user_id, app.today_myt(), app.task_scope(t.subject_type)) = app.current_app_user_id()
                     or app.is_admin()))))
$$;

-- How the caller would act on an open task (for the UI and the trail).
create or replace function app.task_acting_as(p_task_id uuid) returns app.acting_as
language sql stable security definer set search_path = '' as $$
  select (case
    when not app.can_act_on_task(t.id) then null
    when app.current_app_user_id() = t.assignee_user_id then case when t.original_assignee_user_id is not null and t.original_assignee_user_id <> t.assignee_user_id then 'rerouted' else 'assignee' end
    when app.current_app_user_id() = t.original_assignee_user_id then 'assignee'
    when t.source in ('admin_pool','super_admin_pool') then 'pool_member'
    when t.source = 'claim_pool' and app.is_admin() then 'pool_member'
    when app.active_delegate(t.assignee_user_id, app.today_myt(), app.task_scope(t.subject_type)) = app.current_app_user_id() then 'delegate'
    else 'admin_override' end)::app.acting_as
    from app.approval_tasks t where t.id = p_task_id
$$;

-- ===========================================================================
-- Subject facts (dispatch per subject type)
-- ===========================================================================
create or replace function app.task_subject_facts(p_type app.task_subject, p_id uuid,
  out employee_id uuid, out workflow_id uuid, out total_levels int, out reference text, out label text, out is_emergency boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_type in ('leave_application','leave_cancellation') then
    select a.employee_id, a.workflow_id, a.total_levels, a.ref_no, t.name, a.is_emergency
      into employee_id, workflow_id, total_levels, reference, label, is_emergency
      from app.leave_applications a join app.leave_types t on t.id = a.leave_type_id where a.id = p_id;
    if p_type = 'leave_cancellation' then total_levels := 1; end if;
  elsif p_type = 'replacement_credit' then
    select c.employee_id, c.workflow_id, c.total_levels, c.credit_no, 'Replacement credit', false
      into employee_id, workflow_id, total_levels, reference, label, is_emergency
      from app.replacement_credits c where c.id = p_id;
  else
    raise exception 'PRET-TASK-SUBJECT: % is not handled by this engine yet', p_type using errcode = '22023';
  end if;
end $$;

-- ===========================================================================
-- Routing: resolve one workflow level to (source, assignee, original assignee, note, outcome)
-- outcome: 'open' | 'skip' (approver = applicant, FR-G-16) | 'auto' (top of organisation SA — Q11; merged identical approver)
-- ===========================================================================
create or replace function app.resolve_level(p_workflow_id uuid, p_level int, p_subject_employee uuid, p_prev_decider uuid,
  p_scope text, p_on date,
  out source app.approver_source, out assignee uuid, out original uuid, out note text, out outcome text)
language plpgsql stable security definer set search_path = '' as $$
declare
  w app.approval_workflows%rowtype; l app.approval_workflow_levels%rowtype;
  v_emp record; v_person uuid; v_user uuid; v_mgr uuid; v_hops int := 0; v_subject_user uuid;
begin
  select * into w from app.approval_workflows where id = p_workflow_id;
  select * into l from app.approval_workflow_levels where workflow_id = p_workflow_id and level = p_level;
  if l.workflow_id is null then outcome := 'none'; return; end if;
  source := l.source; outcome := 'open';
  select e.id, e.manager_employee_id, e.leave_approver_employee_id into v_emp from app.employees e where e.id = p_subject_employee;
  v_subject_user := app.active_user_of(p_subject_employee);
  if l.source in ('admin_pool','super_admin_pool') then return; end if;
  v_person := case l.source
                when 'direct_manager' then v_emp.manager_employee_id
                when 'leave_approver_override' then coalesce(v_emp.leave_approver_employee_id, v_emp.manager_employee_id)
                when 'managers_manager' then (select m.manager_employee_id from app.employees m where m.id = v_emp.manager_employee_id)
                when 'specific_employee' then l.specific_employee_id end;
  if v_person is null then
    if l.source = 'managers_manager' then
      source := 'admin_pool'; note := 'No manager''s manager — routed to Admin'; return;
    end if;
    -- BR-LV-63 / Q11: top of organisation → Super Admin; a Super Admin's own item is auto-approved at this level
    if exists (select 1 from app.user_roles r where r.user_id = v_subject_user and r.role = 'SA' and r.revoked_at is null) then
      outcome := 'auto'; note := 'Top of organisation — auto-approved at this level (Q11)'; return;
    end if;
    source := 'super_admin_pool'; note := 'Top of organisation — routed to Super Admin (BR-LV-63)'; return;
  end if;
  if v_person = p_subject_employee then
    if w.skip_if_approver_is_applicant then outcome := 'skip'; note := 'Skipped: the approver is the applicant (FR-G-16)'; return; end if;
    source := 'admin_pool'; note := 'Approver is the applicant — routed to Admin (FR-G-16)'; return;
  end if;
  -- unavailable approver (no active portal user / separated) or on approved leave without a delegate → their manager, else Admin (BR-LV-61)
  loop
    v_user := app.active_user_of(v_person);
    exit when v_user is not null
          and not (app.is_on_leave(v_person, p_on) and app.active_delegate(v_user, p_on, p_scope) is null);
    if original is null then original := v_user; end if;
    note := case when v_user is null then 'Re-routed: approver unavailable' else 'Re-routed: approver on leave' end;
    v_hops := v_hops + 1;
    select m.manager_employee_id into v_mgr from app.employees m where m.id = v_person;
    if v_mgr is null or v_mgr = p_subject_employee or v_hops > 5 then
      source := 'admin_pool'; assignee := null; note := note || ' — routed to Admin'; return;
    end if;
    v_person := v_mgr;
  end loop;
  assignee := v_user;
  if original is not null then note := note || ' (' || app.employee_display(v_person) || ')'; end if;
  if app.active_delegate(v_user, p_on, p_scope) is not null then
    note := coalesce(note || '; ', '') || 'Delegate: ' || app.user_name(app.active_delegate(v_user, p_on, p_scope));
  end if;
  if w.merge_consecutive_identical and p_prev_decider is not null and p_prev_decider = v_user then
    outcome := 'auto'; note := 'Merged with the previous level (same approver)';
  end if;
end $$;

-- Notify whoever must act on a new open task (N-01 / N-05 / N-11), with [EMERGENCY] for flagged leave (F-LV-16).
create or replace function app.notify_task(p_task_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  t app.approval_tasks%rowtype; f record; v_code text; v_title text; v_link text; v_tpl text; v_del uuid; v_subject_user uuid; v_payload jsonb;
begin
  select * into t from app.approval_tasks where id = p_task_id;
  if t.id is null or t.status <> 'open' then return; end if;
  select * into f from app.task_subject_facts(t.subject_type, app.task_subject_id(t));
  v_subject_user := app.active_user_of(t.subject_employee_id);
  v_code := case t.subject_type when 'leave_cancellation' then 'N-05' when 'replacement_credit' then 'N-11' else 'N-01' end;
  v_tpl := case t.subject_type when 'leave_cancellation' then 'leave_cancellation_requested' when 'replacement_credit' then 'credit_submitted' else 'leave_submitted' end;
  v_title := left(case when f.is_emergency and t.subject_type = 'leave_application' then '[EMERGENCY] ' else '' end ||
             case t.subject_type when 'leave_cancellation' then 'Cancellation requested: ' when 'replacement_credit' then 'Replacement credit to approve: '
                                 else 'Leave to approve: ' end || f.reference || ' · ' || coalesce(app.employee_display(t.subject_employee_id), ''), 150);
  v_link := case t.subject_type when 'replacement_credit' then '/approvals/credits/' || f.reference else '/approvals/leave/' || f.reference end;
  v_payload := jsonb_build_object('reference', f.reference, 'employee', app.employee_display(t.subject_employee_id), 'type', f.label,
                                  'level', t.level, 'emergency', coalesce(f.is_emergency, false));
  if t.source = 'admin_pool' then
    perform app.notify_role_holders(array['ADM','SA']::app.privileged_role[], v_code, v_title, f.label || ' — level ' || t.level, v_link, true, v_tpl, v_payload, v_subject_user);
  elsif t.source = 'super_admin_pool' then
    perform app.notify_role_holders(array['SA']::app.privileged_role[], v_code, v_title, f.label || ' — level ' || t.level, v_link, true, v_tpl, v_payload, v_subject_user);
  elsif t.assignee_user_id is not null then
    perform app.notify(t.assignee_user_id, v_code, v_title, f.label || ' — level ' || t.level, v_link, true, v_tpl, v_payload);
    v_del := app.active_delegate(t.assignee_user_id, app.today_myt(), app.task_scope(t.subject_type));
    if v_del is not null and v_del is distinct from v_subject_user then
      perform app.notify(v_del, v_code, v_title, f.label || ' — as delegate of ' || app.user_name(t.assignee_user_id), v_link, true, v_tpl, v_payload);
    end if;
  end if;
end $$;

-- Open the first open-able level ≥ p_level. Skipped / auto levels are recorded (trail) and the loop moves on.
-- Returns the level left open, or 0 when every level is done (subject fully approved).
create or replace function app.open_approval_level(p_type app.task_subject, p_id uuid, p_level int, p_prev_decider uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare f record; r record; v_level int := p_level; v_prev uuid := p_prev_decider; v_task uuid; v_wf uuid; v_status app.task_status;
begin
  select * into f from app.task_subject_facts(p_type, p_id);
  loop
    if v_level > f.total_levels then return 0; end if;
    if p_type = 'leave_cancellation' then
      -- §6.10: cancellation decided by the level-1 approver of the leave's workflow (setting), Admin may act
      v_wf := f.workflow_id;
    else v_wf := f.workflow_id; end if;
    select * into r from app.resolve_level(v_wf, case when p_type = 'leave_cancellation' then 1 else v_level end, f.employee_id, v_prev,
                                           app.task_scope(p_type), app.today_myt());
    if r.outcome = 'none' then return 0; end if;
    v_status := case r.outcome when 'open' then 'open' when 'skip' then 'skipped' else 'approved' end;
    insert into app.approval_tasks (subject_type, leave_application_id, replacement_credit_id, subject_employee_id, level, source,
                                    assignee_user_id, original_assignee_user_id, routing_note, status, acting_as, decided_at, decided_by_name)
    values (p_type,
            case when p_type in ('leave_application','leave_cancellation') then p_id end,
            case when p_type = 'replacement_credit' then p_id end,
            f.employee_id, v_level, r.source, r.assignee, r.original, r.note, v_status,
            case when v_status <> 'open' then 'system_auto'::app.acting_as end,
            case when v_status <> 'open' then now() end,
            case when v_status <> 'open' then 'System' end)
    returning id into v_task;
    if v_status = 'open' then
      perform app.notify_task(v_task);
      return v_level;
    end if;
    v_prev := coalesce(r.assignee, v_prev);
    v_level := v_level + 1;
  end loop;
end $$;

-- ===========================================================================
-- Decision trigger (layer 3): decider identity from the session; first decision wins; eligibility.
-- ===========================================================================
create or replace function app.tg_task_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id();
begin
  if tg_op = 'INSERT' then
    if new.status in ('approved','rejected') and new.acting_as is distinct from 'system_auto' then
      raise exception 'PRET-TASK-INSERT: tasks start open' using errcode = '23514';
    end if;
    return new;
  end if;
  if (new.subject_type, app.task_subject_id(new), new.subject_employee_id, new.level, new.created_at)
     is distinct from (old.subject_type, app.task_subject_id(old), old.subject_employee_id, old.level, old.created_at) then
    raise exception 'PRET-TASK-IMMUTABLE' using errcode = '23514';
  end if;
  if old.status <> 'open' then
    if new.status is distinct from old.status or new.decided_by is distinct from old.decided_by then
      raise exception 'PRET-TASK-DECIDED: already decided' using errcode = '40001';
    end if;
    return new;
  end if;
  new.version := old.version + 1;
  if new.status in ('approved','rejected') then
    if v_actor is null then
      raise exception 'PRET-TASK-ACTOR: decisions need a signed-in approver' using errcode = '42501';
    end if;
    if not app.can_act_on_task(old.id) then
      raise exception 'PRET-SELF-001: you cannot decide this item' using errcode = '42501';
    end if;
    new.decided_by := v_actor;
    new.decided_by_employee_id := app.current_employee_id();
    new.decided_by_name := app.user_name(v_actor);
    new.decided_at := now();
  elsif new.status in ('cancelled','superseded') then
    new.decided_at := coalesce(new.decided_at, now());
    new.decided_by := null; new.decided_by_employee_id := null;
  end if;
  return new;
end $$;

-- ===========================================================================
-- Public entry points
-- ===========================================================================
-- Start routing for a subject (called by the submit functions; re-checks the caller owns or acts on behalf).
create or replace function app.route_approval(p_type app.task_subject, p_id uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare f record;
begin
  select * into f from app.task_subject_facts(p_type, p_id);
  if f.employee_id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if app.current_app_user_id() is not null and not (app.is_self(f.employee_id) or app.is_admin()) then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if exists (select 1 from app.approval_tasks t where t.subject_type = p_type and app.task_subject_id(t) = p_id and t.status = 'open') then
    raise exception 'PRET-TASK-ROUTED: already routed' using errcode = '23514';
  end if;
  return app.open_approval_level(p_type, p_id, 1, null);
end $$;

-- Single decision (P30). Locks the task and the subject; first decision wins (BR-CLM-25 / ADR-0004).
create or replace function app.decide_task(p_task_id uuid, p_decision text, p_comment text, p_expected_version int,
                                           p_as_override boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t app.approval_tasks%rowtype; f record; v_acting app.acting_as; v_next int; v_outcome text; v_msg text; v_comment text := nullif(btrim(p_comment), '');
begin
  if p_decision not in ('approve','reject') then raise exception 'PRET-TASK-DECISION' using errcode = '22023'; end if;
  select * into t from app.approval_tasks where id = p_task_id for update;
  if t.id is null or not (app.can_see_team_row(t.subject_employee_id) or app.can_act_on_task(t.id)) then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  if t.status <> 'open' or (p_expected_version is not null and t.version <> p_expected_version) then
    raise exception 'PRET-TASK-DECIDED: Already decided by % at %', coalesce(t.decided_by_name, 'someone else'),
      coalesce(to_char(t.decided_at at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'), 'an earlier time') using errcode = '40001';
  end if;
  if t.subject_employee_id = app.current_employee_id() then
    raise exception 'PRET-SELF-001: you cannot decide your own request' using errcode = '42501';
  end if;
  v_acting := app.task_acting_as(t.id);
  if v_acting is null then raise exception 'PRET-TASK-NOT-YOURS: this item is not waiting for you' using errcode = '42501'; end if;
  if v_acting = 'admin_override' and (not p_as_override or char_length(coalesce(v_comment, '')) < 5) then
    raise exception 'PRET-TASK-OVERRIDE: give the reason for the Admin override' using errcode = '23514';
  end if;
  if p_decision = 'reject' and char_length(coalesce(v_comment, '')) < 5 then
    raise exception 'PRET-TASK-COMMENT: add a comment to reject' using errcode = '23514';
  end if;
  select * into f from app.task_subject_facts(t.subject_type, app.task_subject_id(t));
  perform pg_advisory_xact_lock(hashtext('leave:' || t.subject_employee_id::text));
  -- lock the subject row(s)
  if t.subject_type in ('leave_application','leave_cancellation') then
    perform 1 from app.leave_applications a where a.id = t.leave_application_id or a.split_group_id = (select x.split_group_id from app.leave_applications x where x.id = t.leave_application_id) for update;
  elsif t.subject_type = 'replacement_credit' then
    perform 1 from app.replacement_credits c where c.id = t.replacement_credit_id for update;
  end if;
  update app.approval_tasks set status = case when p_decision = 'approve' then 'approved' else 'rejected' end::app.task_status,
         acting_as = v_acting, decision_comment = v_comment
   where id = t.id;
  if p_decision = 'reject' then
    perform app.subject_rejected(t.subject_type, app.task_subject_id(t), v_comment);
    return jsonb_build_object('outcome', 'rejected', 'subject_type', t.subject_type, 'reference', f.reference, 'message', 'Rejected', 'next_level', null);
  end if;
  v_next := app.open_approval_level(t.subject_type, app.task_subject_id(t), t.level + 1, app.current_app_user_id());
  if v_next = 0 then
    perform app.subject_approved(t.subject_type, app.task_subject_id(t));
    v_outcome := 'approved';
    v_msg := case t.subject_type when 'leave_cancellation' then 'Cancellation approved — leave cancelled' else 'Approved' end;
  else
    perform app.subject_moved(t.subject_type, app.task_subject_id(t), v_next);
    v_outcome := 'moved_to_next';
    v_msg := 'Moved to level ' || v_next || ' (' || coalesce((select coalesce(app.user_name(x.assignee_user_id), case x.source when 'super_admin_pool' then 'Super Admin' else 'Any Admin' end)
                                                               from app.approval_tasks x where x.subject_type = t.subject_type and app.task_subject_id(x) = app.task_subject_id(t)
                                                                 and x.status = 'open'), '') || ')';
  end if;
  return jsonb_build_object('outcome', v_outcome, 'subject_type', t.subject_type, 'reference', f.reference, 'message', v_msg,
                            'next_level', case when v_next = 0 then null else v_next end);
end $$;

-- Close every open task of a subject (withdraw / cancel / reject elsewhere).
create or replace function app.close_open_tasks(p_type app.task_subject, p_id uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update app.approval_tasks t set status = 'cancelled', routing_note = left(coalesce(t.routing_note || '; ', '') || p_note, 500)
   where t.subject_type = p_type and app.task_subject_id(t) = p_id and t.status = 'open';
end $$;

-- Re-resolve open person-level tasks (BR-LV-61): approver changed / separated / unavailable / on leave today.
-- p_employee_id limits to tasks about that subject employee (manager change) — null = all.
create or replace function app.reroute_open_tasks(p_employee_id uuid default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare t app.approval_tasks%rowtype; f record; r record; n int := 0; v_new uuid;
begin
  for t in select x.* from app.approval_tasks x
            where x.status = 'open' and x.subject_type in ('leave_application','leave_cancellation','replacement_credit')
              and x.source in ('direct_manager','leave_approver_override','managers_manager','specific_employee','super_admin_pool')
              and (p_employee_id is null or x.subject_employee_id = p_employee_id)
            for update loop
    select * into f from app.task_subject_facts(t.subject_type, app.task_subject_id(t));
    select * into r from app.resolve_level(f.workflow_id, case when t.subject_type = 'leave_cancellation' then 1 else t.level end, f.employee_id, null,
                                           app.task_scope(t.subject_type), app.today_myt());
    continue when r.outcome <> 'open';
    continue when r.source = t.source and r.assignee is not distinct from t.assignee_user_id;
    continue when r.source = 'super_admin_pool' and t.source = 'super_admin_pool';
    update app.approval_tasks set status = 'superseded', routing_note = left(coalesce(routing_note || '; ', '') || 'Re-routed', 500) where id = t.id;
    insert into app.approval_tasks (subject_type, leave_application_id, replacement_credit_id, subject_employee_id, level, source,
                                    assignee_user_id, original_assignee_user_id, routing_note, reminder_count)
    values (t.subject_type, t.leave_application_id, t.replacement_credit_id, t.subject_employee_id, t.level, r.source, r.assignee,
            coalesce(r.original, t.assignee_user_id), coalesce(r.note, 'Re-routed: reporting line changed'), 0)
    returning id into v_new;
    perform app.notify_task(v_new);
    n := n + 1;
  end loop;
  return n;
end $$;

-- L14 HR reassign (UXQ-05). Items about the new approver are skipped (FR-G-16).
create or replace function app.reassign_tasks(p_from_user uuid, p_to_user uuid, p_types app.task_subject[], p_reason text, p_dry_run boolean default false)
returns table (task_id uuid, reference text, subject_type app.task_subject, employee_name text, level int, skipped boolean, note text)
language plpgsql volatile security definer set search_path = '' as $$
declare t app.approval_tasks%rowtype; f record; v_to_emp uuid; v_new uuid;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if char_length(coalesce(p_reason, '')) < 10 and not p_dry_run then raise exception 'PRET-REASSIGN-REASON' using errcode = '23514'; end if;
  select u.employee_id into v_to_emp from app.app_users u where u.id = p_to_user and u.status = 'active' and u.user_type = 'employee';
  if p_to_user is not null and v_to_emp is null and not p_dry_run then
    raise exception 'PRET-REASSIGN-TARGET: the new approver must be an active employee user' using errcode = '23514';
  end if;
  for t in select x.* from app.approval_tasks x
            where x.status = 'open' and x.assignee_user_id = p_from_user and x.subject_type = any(p_types)
            order by x.created_at loop
    select * into f from app.task_subject_facts(t.subject_type, app.task_subject_id(t));
    task_id := t.id; reference := f.reference; subject_type := t.subject_type; employee_name := app.employee_display(t.subject_employee_id);
    level := t.level; skipped := false; note := null;
    if v_to_emp is not null and v_to_emp = t.subject_employee_id then
      skipped := true; note := 'The new approver is the applicant'; return next; continue;
    end if;
    if t.subject_employee_id = app.current_employee_id() then
      skipped := true; note := 'Your own item'; return next; continue;
    end if;
    if not p_dry_run then
      update app.approval_tasks set status = 'superseded', routing_note = left(coalesce(routing_note || '; ', '') || 'Reassigned by HR', 500) where id = t.id;
      insert into app.approval_tasks (subject_type, leave_application_id, replacement_credit_id, subject_employee_id, level, source,
                                      assignee_user_id, original_assignee_user_id, routing_note)
      values (t.subject_type, t.leave_application_id, t.replacement_credit_id, t.subject_employee_id, t.level, t.source, p_to_user,
              p_from_user, left('Reassigned by HR: ' || p_reason, 500))
      returning id into v_new;
      perform app.notify_task(v_new);
    end if;
    return next;
  end loop;
end $$;
