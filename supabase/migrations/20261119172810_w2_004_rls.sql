-- PRET W2-004 · 05 — RLS (enabled AND forced), grants, policies (rls-policies §4, §5.4, §5.5, §6, §7, §9, §11), Storage file
-- rules for leave attachments (Q18), audit triggers, and the function surface.
-- Writes to leave_applications / approval_tasks / replacement_credits / rollover_* go ONLY through the definer functions of
-- migrations 03–04 (no direct INSERT/UPDATE grant): they apply the same P-SELF / P-HR-NOT-OWN rules as the register and
-- also compute days, balances and routing in the database. Config tables, overrides and HR adjustments are direct writes
-- under RLS + guard triggers.

do $$
declare t text;
begin
  foreach t in array array['leave_policy','approval_workflows','approval_workflow_levels','leave_types','statutory_leave_minimums',
    'statutory_floor_overrides','leave_entitlement_bands','leave_entitlement_overrides','leave_entitlements','leave_applications',
    'leave_application_days','leave_application_files','leave_application_events','replacement_credits','leave_ledger','leave_balance_summary',
    'replacement_credit_consumptions','employee_leave_counters','rollover_runs','rollover_lines','team_calendar_entries','approval_tasks']
  loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
  end loop;
end $$;

revoke all on app.leave_policy, app.approval_workflows, app.approval_workflow_levels, app.leave_types, app.statutory_leave_minimums,
  app.statutory_floor_overrides, app.leave_entitlement_bands, app.leave_entitlement_overrides, app.leave_entitlements, app.leave_applications,
  app.leave_application_days, app.leave_application_files, app.leave_application_events, app.replacement_credits, app.leave_ledger,
  app.leave_balance_summary, app.replacement_credit_consumptions, app.employee_leave_counters, app.rollover_runs, app.rollover_lines,
  app.team_calendar_entries, app.approval_tasks
  from public, anon, authenticated;
grant all on all tables in schema app to service_role;
grant usage, select on all sequences in schema app to service_role;

-- configuration (P-ACTIVE read, P-HR write)
grant select on app.leave_policy to authenticated;
grant update (entitlement_method, prorate_basis, rounding, ea_floor_for_joiners_leavers, carry_forward_cap_days, carry_forward_expiry_months,
              allow_next_year_applications, next_year_from_ddmm, form_message, emergency_threshold_days, emergency_leave_type_ids,
              team_calendar_visibility, notify_on_admin_withdraw, include_separated_in_reports, reminder_after_working_days,
              escalate_after_working_days, replacement_credit_validity_days, replacement_credits_carry_forward, replacement_for_ph_on_off_day,
              replacement_worked_lookback_days, cancellation_approver_level1_only, paternity_window_days_after_birth, team_absence_threshold)
  on app.leave_policy to authenticated;
grant select, insert, update (name, skip_if_approver_is_applicant, merge_consecutive_identical, is_active) on app.approval_workflows to authenticated;
grant select, insert, delete on app.approval_workflow_levels to authenticated;
grant select, insert on app.leave_types to authenticated;
grant update (code, name, category, description, is_paid, count_basis, entitlement_method, accrual_override, prorate_joiners_leavers, eligible_gender,
              eligible_marital, min_service_months, available_on_probation, half_day_allowed, reason_required, attachment_rule,
              attachment_threshold_days, attachment_grace_hours, min_notice_days, min_notice_behaviour, backdate_working_days,
              max_days_per_application, max_occurrences, occurrence_scope, days_per_occurrence, annual_cap_days, deduct_from_type_id,
              pool_with_type_id, pool_cap_days, carry_forward_allowed, cf_cap_override, cf_expiry_months_override, allow_negative,
              max_negative_days, workflow_id, self_cancel_future_approved, visible_to_employees, calendar_colour, payroll_treatment,
              display_order, is_active)
  on app.leave_types to authenticated;
grant select on app.statutory_leave_minimums to authenticated;
grant select, insert (id, leave_type_id, detail, reason, approved_by) on app.statutory_floor_overrides to authenticated;
grant select, insert (leave_type_id, effective_year, service_from_years, service_to_years, days_per_year, grade_id), delete on app.leave_entitlement_bands to authenticated;
grant select, insert (employee_id, leave_type_id, leave_year, days, reason, created_by), update (days, reason, is_active) on app.leave_entitlement_overrides to authenticated;
grant select on app.leave_entitlements to authenticated;
-- transactions (read only for users; writes through definer functions)
grant select on app.leave_applications, app.leave_application_days, app.leave_application_files, app.leave_application_events,
                app.replacement_credits, app.leave_balance_summary, app.replacement_credit_consumptions, app.employee_leave_counters,
                app.rollover_runs, app.rollover_lines, app.team_calendar_entries, app.approval_tasks
  to authenticated;
grant select, insert (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, reason, attachment_file_id, idempotency_key, created_by)
  on app.leave_ledger to authenticated;

-- ---------------------------------------------------------------------------
-- Policies — §5.4 Leave
-- ---------------------------------------------------------------------------
create policy leave_policy_select on app.leave_policy for select to authenticated using ((select app.is_active_user()));
create policy leave_policy_update on app.leave_policy for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

create policy workflows_select on app.approval_workflows for select to authenticated using ((select app.is_active_user()));
create policy workflows_insert on app.approval_workflows for insert to authenticated with check ((select app.is_admin()));
create policy workflows_update on app.approval_workflows for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy workflow_levels_select on app.approval_workflow_levels for select to authenticated using ((select app.is_active_user()));
create policy workflow_levels_insert on app.approval_workflow_levels for insert to authenticated with check ((select app.is_admin()));
create policy workflow_levels_delete on app.approval_workflow_levels for delete to authenticated using ((select app.is_admin()));

create policy leave_types_select on app.leave_types for select to authenticated using ((select app.is_active_user()));
create policy leave_types_insert on app.leave_types for insert to authenticated with check ((select app.is_admin()));
create policy leave_types_update on app.leave_types for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

create policy stat_min_select on app.statutory_leave_minimums for select to authenticated using ((select app.is_active_user()));
create policy floor_overrides_select on app.statutory_floor_overrides for select to authenticated using ((select app.is_admin()));
create policy floor_overrides_insert on app.statutory_floor_overrides for insert to authenticated
  with check ((select app.is_sa()) and approved_by = (select app.current_app_user_id()));

create policy bands_select on app.leave_entitlement_bands for select to authenticated using ((select app.is_active_user()));
create policy bands_insert on app.leave_entitlement_bands for insert to authenticated with check ((select app.is_admin()));
create policy bands_delete on app.leave_entitlement_bands for delete to authenticated using ((select app.is_admin()));

create policy overrides_select on app.leave_entitlement_overrides for select to authenticated
  using (app.is_self(employee_id) or (select app.is_admin()));
create policy overrides_insert on app.leave_entitlement_overrides for insert to authenticated
  with check ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()) and created_by = (select app.current_app_user_id()));
create policy overrides_update on app.leave_entitlement_overrides for update to authenticated
  using ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()))
  with check ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()));

create policy entitlements_select on app.leave_entitlements for select to authenticated using (app.is_self(employee_id) or (select app.is_admin()));

create policy leave_select on app.leave_applications for select to authenticated
  using (app.can_see_team_row(employee_id)
         or exists (select 1 from app.approval_tasks t where t.leave_application_id = leave_applications.id
                       and t.decided_by = (select app.current_app_user_id())));
create policy leave_days_select on app.leave_application_days for select to authenticated using (app.can_see_team_row(employee_id));
create policy leave_files_select on app.leave_application_files for select to authenticated
  using (exists (select 1 from app.leave_applications a where a.id = application_id and app.can_see_team_row(a.employee_id)));
create policy leave_events_select on app.leave_application_events for select to authenticated using (app.can_see_team_row(employee_id));

-- T2: never MGR (F-LV-28); HR adjustments for others only (FR-LV-11, FR-G-16)
create policy ledger_select on app.leave_ledger for select to authenticated using (app.is_self(employee_id) or (select app.is_admin()));
create policy ledger_insert_adjustment on app.leave_ledger for insert to authenticated
  with check ((select app.is_admin()) and entry_type = 'adjustment'
              and employee_id is distinct from (select app.current_employee_id())
              and created_by = (select app.current_app_user_id()));

create policy summary_select on app.leave_balance_summary for select to authenticated using (app.can_see_team_row(employee_id));
create policy credits_select on app.replacement_credits for select to authenticated using (app.can_see_team_row(employee_id));
create policy consumptions_select on app.replacement_credit_consumptions for select to authenticated using (app.is_self(employee_id) or (select app.is_admin()));
create policy counters_select on app.employee_leave_counters for select to authenticated using (app.is_self(employee_id) or (select app.is_admin()));
create policy rollover_runs_select on app.rollover_runs for select to authenticated using ((select app.is_admin()));
create policy rollover_lines_select on app.rollover_lines for select to authenticated using (app.is_self(employee_id) or (select app.is_admin()));

-- team calendar — leave type never stored here; visibility per LP12 (Q17)
create policy team_calendar_select on app.team_calendar_entries for select to authenticated
  using (   app.is_self(employee_id) or (select app.is_admin()) or app.is_manager_of(employee_id)
         or ((select p.team_calendar_visibility from app.leave_policy p where p.id = 1) = 'everyone' and (select app.current_employee_id()) is not null)
         or ((select p.team_calendar_visibility from app.leave_policy p where p.id = 1) = 'same_department'
             and department_id = (select e.department_id from app.employees e where e.id = (select app.current_employee_id()))));

-- §5.5 Approvals
create policy tasks_select on app.approval_tasks for select to authenticated
  using (   (select app.is_admin())
         or (select app.current_app_user_id()) in (assignee_user_id, original_assignee_user_id, decided_by)
         or app.is_self(subject_employee_id)
         or app.is_manager_of(subject_employee_id)
         or (assignee_user_id is not null and app.active_delegate(assignee_user_id, app.today_myt(), app.task_scope(subject_type)) = (select app.current_app_user_id())));

-- ---------------------------------------------------------------------------
-- Storage: leave attachments (rls §9, Q18) — the employee, ADM/SA, and an approver/delegate only while they can decide
-- the item. Every grant is access-logged by app.tg_file_grant_log (Health category set at upload for SL/HL/ML).
-- ---------------------------------------------------------------------------
create or replace function app.can_read_file(p_file_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.files f
     where f.id = p_file_id and f.status = 'active'
       and (   (f.subject in ('employee_photo','privacy_notice','company_asset') and app.is_active_user())
            or app.is_admin()
            or (app.is_self(f.owner_employee_id) and f.subject in ('leave_attachment','claim_receipt','tp1_doc'))
            or (f.subject = 'leave_attachment'
                and (exists (select 1 from app.leave_application_files lf join app.approval_tasks t on t.leave_application_id = lf.application_id
                              where lf.file_id = f.id and t.status = 'open' and app.can_act_on_task(t.id))
                     or exists (select 1 from app.replacement_credits c join app.approval_tasks t on t.replacement_credit_id = c.id
                                 where c.attachment_file_id = f.id and t.status = 'open' and app.can_act_on_task(t.id))))
            or (f.subject = 'employee_document' and app.is_self(f.owner_employee_id)
                and exists (select 1 from app.employee_documents d
                             where d.file_id = f.id and d.employee_id = f.owner_employee_id and d.is_active and d.visible_to_employee
                               and d.category not in ('mykad_copy','medical_report','disciplinary_letter','bank_proof')))
            or (f.subject = 'change_request_doc' and app.is_self(f.owner_employee_id)
                and not exists (select 1 from app.change_request_files cf join app.change_requests c on c.id = cf.change_request_id
                                 where cf.file_id = f.id and c.status <> 'submitted'))
            or (f.subject = 'generated_output' and app.is_self(f.owner_employee_id)
                and f.created_by = app.current_app_user_id())))
$$;

-- ---------------------------------------------------------------------------
-- Audit (F-ADM-09). Derived caches (leave_balance_summary, leave_entitlements, team_calendar_entries) and the per-day rows
-- are not audited; the ledger and events are append-only logs in their own right but are audited too (adjustments show "By").
-- ---------------------------------------------------------------------------
create trigger tg_audit after insert or update or delete on app.leave_policy                 for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.approval_workflows           for each row execute function audit.tg_log_change('', 'name');
create trigger tg_audit after insert or update or delete on app.approval_workflow_levels     for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.leave_types                  for each row execute function audit.tg_log_change('', 'code');
create trigger tg_audit after insert or update or delete on app.statutory_floor_overrides    for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.leave_entitlement_bands      for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.leave_entitlement_overrides  for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.leave_applications           for each row execute function audit.tg_log_change('', 'ref_no');
create trigger tg_audit after insert or update or delete on app.leave_application_files      for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.replacement_credits          for each row execute function audit.tg_log_change('', 'credit_no');
create trigger tg_audit after insert or update or delete on app.leave_ledger                 for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.employee_leave_counters      for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.rollover_runs                for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.approval_tasks               for each row execute function audit.tg_log_change();

-- ---------------------------------------------------------------------------
-- Read wrappers for the server queries (caller re-checked; return facts only)
-- ---------------------------------------------------------------------------
-- Balance (BR-LV-20 + accrual earned-to-date + pool) of an employee the caller may see (self / team / routed / HR).
create or replace function app.leave_balance_view(p_employee_id uuid, p_type_id uuid, p_year int, p_as_at date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_see_team_row(p_employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  return app.leave_balance(p_employee_id, p_type_id, p_year, p_as_at);
end $$;

-- Date-picker marks (P2/P8/L2): day kinds of the employee's calendar + own leave (self / team / HR).
create or replace function app.calendar_marks(p_employee_id uuid, p_from date, p_to date)
returns table (cal_date date, kind text, label text, has_leave boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_see_team_row(p_employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  return query
    select c.cal_date,
           case when not c.employed then 'not_employed'
                when c.holiday_name is not null then case when c.holiday_half then 'half_public_holiday' else 'public_holiday' end
                when c.day_type = 'full' then 'working' when c.day_type = 'half' then 'half_working' else c.day_type::text end,
           case when not c.employed then 'Not employed'
                when c.holiday_name is not null then left('Public holiday: ' || c.holiday_name, 150)
                when c.day_type = 'rest' then 'Rest day' when c.day_type = 'off' then 'Off day' when c.day_type = 'half' then 'Half working day'
                else 'Working day' end,
           exists (select 1 from app.leave_application_days d where d.employee_id = p_employee_id and d.leave_date = c.cal_date and d.is_blocking and d.weight > 0)
      from app.employee_calendar(p_employee_id, p_from, p_to) c;
end $$;

-- E2 wizard (F-LV-35): entitlement this year before the employee exists (ADM/SA).
create or replace function app.preview_entitlement(p_type_id uuid, p_year int, p_join date, p_service date, p_grade uuid, p_gender app.gender) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  return app.compute_entitlement(null, p_type_id, p_year, null, null, p_join, p_service, p_grade, p_gender);
end $$;

-- Yearly entitlement + earned to date for one employee (self / team / HR) — used by balance cards.
create or replace function app.entitlement_view(p_employee_id uuid, p_type_id uuid, p_year int, p_as_at date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_see_team_row(p_employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  return app.compute_entitlement(p_employee_id, p_type_id, p_year, p_as_at);
end $$;

-- Who would approve level 1 (P2 hint; L12 preview) — names only.
create or replace function app.workflow_preview(p_workflow_id uuid, p_employee_id uuid) returns table (level int, source app.approver_source, approver text, note text, outcome text)
language plpgsql stable security definer set search_path = '' as $$
declare r record; i int;
begin
  if not app.can_see_team_row(p_employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  for i in 1 .. 3 loop
    select * into r from app.resolve_level(p_workflow_id, i, p_employee_id, null, 'leave', app.today_myt());
    exit when r.outcome = 'none';
    level := i; source := r.source; note := r.note; outcome := r.outcome;
    approver := case when r.assignee is not null then app.user_name(r.assignee) when r.source = 'super_admin_pool' then 'Super Admin'
                     when r.source = 'admin_pool' then 'Any Admin' else null end;
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema app from public, anon;
revoke execute on function
  app.round_leave(numeric, app.leave_rounding), app.service_years(date, date), app.completed_months(date, date),
  app.leave_day_weight(app.day_type, text, boolean, app.leave_session, app.count_basis),
  app.employee_calendar(uuid, date, date), app.leave_count(uuid, date, app.leave_session, date, app.leave_session, app.count_basis),
  app.working_days_between(uuid, date, date), app.working_days_back(uuid, date, int),
  app.leave_band_days(uuid, int, uuid, int), app.statutory_min_days(app.leave_category, numeric),
  app.leave_accrue(uuid, int, uuid, date, date, date, app.prorate_basis, numeric), app.entitlement_method_for(uuid, date, int),
  app.compute_entitlement(uuid, uuid, int, date, date, date, date, uuid, app.gender), app.balance_type_id(uuid),
  app.refresh_leave_summary(uuid, uuid, int), app.rebuild_leave_summaries(), app.leave_balance(uuid, uuid, int, date, uuid),
  app.refresh_entitlement(uuid, uuid, int, text), app.generate_entitlements(int, uuid, text), app.regenerate_entitlements(int, uuid),
  app.refresh_team_calendar(uuid),
  app.active_user_of(uuid), app.user_name(uuid), app.employee_display(uuid), app.is_on_leave(uuid, date), app.active_delegate(uuid, date, text),
  app.task_scope(app.task_subject), app.task_subject_id(app.approval_tasks), app.is_current_approver_for(uuid), app.can_act_on_task(uuid),
  app.task_acting_as(uuid), app.task_subject_facts(app.task_subject, uuid), app.resolve_level(uuid, int, uuid, uuid, text, date),
  app.notify_task(uuid), app.open_approval_level(app.task_subject, uuid, int, uuid), app.tg_task_decision(),
  app.route_approval(app.task_subject, uuid), app.decide_task(uuid, text, text, int, boolean), app.close_open_tasks(app.task_subject, uuid, text),
  app.reroute_open_tasks(uuid), app.reassign_tasks(uuid, uuid, app.task_subject[], text, boolean),
  app.lv_issue(text, text, text), app.dmy(date), app.leave_group(uuid), app.leave_event(uuid, text, app.leave_status, app.leave_status, app.acting_as, text),
  app.notify_employee(uuid, text, text, text, text, boolean, text, jsonb), app.tg_ledger_before(), app.tg_ledger_after(),
  app.leave_evaluate(jsonb, boolean), app.post_leave_taken(uuid), app.reverse_leave_taken(uuid, text),
  app.subject_approved(app.task_subject, uuid), app.subject_rejected(app.task_subject, uuid, text), app.subject_moved(app.task_subject, uuid, int),
  app.tg_leave_transition(), app.tg_leave_after(), app.withdraw_leave(uuid, text, boolean), app.cancel_leave(uuid, text, boolean),
  app.request_leave_cancellation(uuid, text), app.set_leave_mc_status(uuid, app.mc_status, text), app.add_leave_attachments(uuid, uuid[]),
  app.day_kind_on(uuid, date), app.request_credit(uuid, date, app.credit_duration, text, uuid, uuid), app.withdraw_credit(uuid),
  app.set_credit_compensation(uuid, boolean, numeric), app.recount_application(uuid), app.recount_range(date, date, uuid), app.tg_recount_holiday(),
  app.tg_leave_inputs_changed(), app.leaver_position(uuid, date), app.tg_separation_leave(), app.rollover_preview(int), app.rollover_blockers(int),
  app.rollover_commit(uuid), app.save_opening_leave(uuid, jsonb), app.floor_override_present(uuid), app.tg_leave_types_guard(), app.tg_bands_check(),
  app.tg_override_floor(), app.tg_workflow_check(), app.tg_leave_policy_after(), app.tg_employee_approver_change()
  from public, anon, authenticated, service_role;

-- user-callable surface (each re-checks the caller)
grant execute on function
  app.round_leave(numeric, app.leave_rounding), app.service_years(date, date), app.completed_months(date, date),
  app.is_current_approver_for(uuid), app.can_act_on_task(uuid), app.task_acting_as(uuid), app.active_delegate(uuid, date, text),
  app.task_scope(app.task_subject), app.balance_type_id(uuid), app.user_name(uuid),
  app.decide_task(uuid, text, text, int, boolean), app.reassign_tasks(uuid, uuid, app.task_subject[], text, boolean),
  app.leave_evaluate(jsonb, boolean), app.withdraw_leave(uuid, text, boolean), app.cancel_leave(uuid, text, boolean),
  app.request_leave_cancellation(uuid, text), app.set_leave_mc_status(uuid, app.mc_status, text), app.add_leave_attachments(uuid, uuid[]),
  app.day_kind_on(uuid, date), app.request_credit(uuid, date, app.credit_duration, text, uuid, uuid), app.withdraw_credit(uuid),
  app.set_credit_compensation(uuid, boolean, numeric), app.leaver_position(uuid, date), app.rollover_preview(int), app.rollover_blockers(int),
  app.rollover_commit(uuid), app.save_opening_leave(uuid, jsonb), app.regenerate_entitlements(int, uuid),
  app.leave_balance_view(uuid, uuid, int, date), app.calendar_marks(uuid, date, date), app.preview_entitlement(uuid, int, date, date, uuid, app.gender),
  app.entitlement_view(uuid, uuid, int, date), app.workflow_preview(uuid, uuid)
  to authenticated;
-- service_role (pret_jobs): helpers the triggers and the daily job call
grant execute on function
  app.round_leave(numeric, app.leave_rounding), app.service_years(date, date), app.completed_months(date, date), app.is_current_approver_for(uuid),
  app.can_act_on_task(uuid), app.active_delegate(uuid, date, text), app.task_scope(app.task_subject), app.balance_type_id(uuid), app.user_name(uuid)
  to service_role;
grant execute on function app.can_act_on_task(uuid), app.is_current_approver_for(uuid) to audit_writer;
