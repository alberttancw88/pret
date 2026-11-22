-- PRET W2-005 · 04 — RLS (enabled AND forced), grants, policies (rls-policies §4, §5.6, §5.7, §6, §8, §9, §11), Storage rules
-- for claim receipts and generated outputs, audit triggers, read wrappers, function surface.
-- Claims, lines, receipts, overrides, batches and outputs are written ONLY through the definer functions of migrations 02–03
-- (no INSERT/UPDATE/DELETE grant — as W2-004 did for leave): they apply P-SELF / P-HR-NOT-OWN / on-behalf rules internally and
-- the guard triggers enforce the status machines. Configuration (categories, rates, grades, limits, policy) is direct P-HR writes.
-- Managers: claims and lines of reportees (T1) — never claim_line_dependants (T2), batches, payees or outputs (rls §8).

do $$
declare t text;
begin
  foreach t in array array['claim_policy','claim_categories','claim_category_grades','claim_category_rates','claim_limits','claims','claim_lines',
    'claim_line_files','claim_line_dependants','claim_late_overrides','claim_events','disbursement_batches','disbursement_batch_claims',
    'disbursement_batch_events','export_files']
  loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('revoke all on app.%I from public, anon, authenticated', t);
  end loop;
end $$;
grant all on all tables in schema app to service_role;
grant usage, select on all sequences in schema app to service_role;

-- configuration
grant select, update (submission_deadline_days, limit_refresh_day, disbursement_cutoff_day, notes_required_default, attachments_required_default,
                      new_claim_reminder_days, include_separated_default, autocount_document_date_basis) on app.claim_policy to authenticated;
grant select, insert (code, name, claim_group, description, receipt_required, notes_required, receipt_no_mode, myinvois_uuid_mode, capture_sst, is_mileage,
                      extra_fields, claimant_scope, min_service_months, eligible_statuses, tax_treatment, ea_form_line, gl_account_code, display_order, is_active),
      update (code, name, claim_group, description, receipt_required, notes_required, receipt_no_mode, myinvois_uuid_mode, capture_sst, is_mileage,
              extra_fields, claimant_scope, min_service_months, eligible_statuses, tax_treatment, ea_form_line, gl_account_code, display_order, is_active)
  on app.claim_categories to authenticated;
grant select, insert, delete on app.claim_category_grades to authenticated;
grant select, insert (category_id, effective_from, rate_per_km) on app.claim_category_rates to authenticated;
grant select, insert (category_id, applies_to, grade_id, department_id, employee_group_id, employee_id, per_transaction, per_month, per_year, behaviour, effective_from, effective_to),
      update (per_transaction, per_month, per_year, behaviour, effective_to)
  on app.claim_limits to authenticated;
-- transactions: read only for users
grant select on app.claims, app.claim_lines, app.claim_line_files, app.claim_line_dependants, app.claim_late_overrides, app.claim_events,
                app.disbursement_batches, app.disbursement_batch_claims, app.disbursement_batch_events, app.export_files
  to authenticated;

-- ---------------------------------------------------------------------------
-- §5.6 Claims
-- ---------------------------------------------------------------------------
create policy claim_policy_select on app.claim_policy for select to authenticated using ((select app.is_active_user()));
create policy claim_policy_update on app.claim_policy for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

create policy claim_categories_select on app.claim_categories for select to authenticated using ((select app.is_active_user()));
create policy claim_categories_insert on app.claim_categories for insert to authenticated with check ((select app.is_admin()));
create policy claim_categories_update on app.claim_categories for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy claim_category_grades_select on app.claim_category_grades for select to authenticated using ((select app.is_active_user()));
create policy claim_category_grades_insert on app.claim_category_grades for insert to authenticated with check ((select app.is_admin()));
create policy claim_category_grades_delete on app.claim_category_grades for delete to authenticated using ((select app.is_admin()));
create policy claim_category_rates_select on app.claim_category_rates for select to authenticated using ((select app.is_active_user()));
create policy claim_category_rates_insert on app.claim_category_rates for insert to authenticated with check ((select app.is_admin()));

create policy claim_limits_select on app.claim_limits for select to authenticated
  using ((select app.is_admin()) or ((select app.is_active_user()) and (applies_to <> 'employee' or employee_id = (select app.current_employee_id()))));
create policy claim_limits_insert on app.claim_limits for insert to authenticated with check ((select app.is_admin()));
create policy claim_limits_update on app.claim_limits for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

-- New claims are private to the owner (and the Admin who entered them on behalf) — BR-CLM-27; otherwise P-TEAM + the decider.
create policy claims_select on app.claims for select to authenticated
  using (case when status = 'new'
              then app.is_self(employee_id) or ((select app.is_admin()) and on_behalf_by is not null)
              else app.can_see_team_row(employee_id)
                   or exists (select 1 from app.approval_tasks t where t.claim_id = claims.id and t.decided_by = (select app.current_app_user_id())) end);
create policy claim_lines_select on app.claim_lines for select to authenticated
  using (exists (select 1 from app.claims c where c.id = claim_lines.claim_id));
create policy claim_line_files_select on app.claim_line_files for select to authenticated
  using (exists (select 1 from app.claim_lines l where l.id = claim_line_files.claim_line_id));
create policy claim_events_select on app.claim_events for select to authenticated
  using (exists (select 1 from app.claims c where c.id = claim_events.claim_id));
-- T2 (never MGR — rls §8)
create policy claim_line_dependants_select on app.claim_line_dependants for select to authenticated
  using (app.is_self(employee_id) or (select app.is_admin()));
create policy claim_late_overrides_select on app.claim_late_overrides for select to authenticated
  using ((select app.is_admin()) or app.is_self(employee_id));

create policy batches_select on app.disbursement_batches for select to authenticated using ((select app.is_admin()));
create policy batch_claims_select on app.disbursement_batch_claims for select to authenticated using ((select app.is_admin()));
create policy batch_events_select on app.disbursement_batch_events for select to authenticated using ((select app.is_admin()));
create policy export_files_select on app.export_files for select to authenticated using (app.can_read_file(file_id));

-- ---------------------------------------------------------------------------
-- Storage (rls §9): claim receipts — the employee, ADM/SA, the claimant's manager, the current approver / delegate.
-- generated outputs — ADM/SA (bucket 'generated' now accepts registered uploads by ADM/SA; path out/%).
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
            or (f.subject = 'claim_receipt'
                and exists (select 1 from app.claim_line_files lf join app.claim_lines l on l.id = lf.claim_line_id join app.claims c on c.id = l.claim_id
                             where lf.file_id = f.id and c.status <> 'new'
                               and (app.is_manager_of(c.employee_id)
                                    or exists (select 1 from app.approval_tasks t where t.claim_id = c.id and t.status = 'open' and app.can_act_on_task(t.id)))))
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

drop policy pret_objects_insert on storage.objects;
create policy pret_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('employee-files','leave-files','claim-files','cr-files','generated','imports','company')
              and app.storage_upload_allowed(objects.bucket_id, objects.name));

-- ---------------------------------------------------------------------------
-- Audit (F-ADM-09). Events tables are logs in their own right (not audited).
-- ---------------------------------------------------------------------------
create trigger tg_audit after insert or update or delete on app.claim_policy              for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.claim_categories          for each row execute function audit.tg_log_change('', 'code');
create trigger tg_audit after insert or update or delete on app.claim_category_grades     for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.claim_category_rates      for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.claim_limits              for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.claims                    for each row execute function audit.tg_log_change('', 'claim_no');
create trigger tg_audit after insert or update or delete on app.claim_lines               for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.claim_line_files          for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.claim_line_dependants     for each row execute function audit.tg_log_change('health,family');
create trigger tg_audit after insert or update or delete on app.claim_late_overrides      for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.disbursement_batches      for each row execute function audit.tg_log_change('', 'batch_no');
create trigger tg_audit after insert or update or delete on app.disbursement_batch_claims for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.export_files              for each row execute function audit.tg_log_change();

-- ---------------------------------------------------------------------------
-- Read wrappers (caller re-checked; facts only)
-- ---------------------------------------------------------------------------
-- P13 summary card / validateClaim
create or replace function app.claim_validate(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c app.claims%rowtype;
begin
  select * into c from app.claims where id = p_claim_id;
  if c.id is null or not (app.is_self(c.employee_id) or (app.is_admin() and (c.status <> 'new' or c.on_behalf_by is not null))
                          or (c.status <> 'new' and app.can_see_team_row(c.employee_id))) then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  return app.claim_evaluate(p_claim_id);
end $$;

-- F-CLM-20 utilisation for an employee the caller may see: one row per limit basis of each active category with a limit.
create or replace function app.claim_utilisation(p_employee_id uuid, p_as_of date default null)
returns table (category_id uuid, basis text, period_from date, period_to date, used numeric, limit_amount numeric, behaviour app.limit_behaviour)
language plpgsql stable security definer set search_path = '' as $$
declare v_on date := coalesce(p_as_of, app.today_myt()); k app.claim_categories%rowtype; l app.claim_limits; m daterange; y daterange;
begin
  if not app.can_see_team_row(p_employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  m := app.claim_period(v_on, 'month'); y := app.claim_period(v_on, 'year');
  for k in select * from app.claim_categories where is_active order by display_order, code loop
    l := app.claim_limit_for(p_employee_id, k.id, v_on);
    continue when l.id is null;
    if l.per_transaction is not null then
      category_id := k.id; basis := 'transaction'; period_from := lower(m); period_to := upper(m) - 1; limit_amount := l.per_transaction; behaviour := l.behaviour;
      used := coalesce((select max(x.amount_incl_sst) from app.claim_lines x where x.is_live and x.employee_id = p_employee_id and x.category_id = k.id
                         and x.transaction_date <@ m), 0);
      return next;
    end if;
    if l.per_month is not null then
      category_id := k.id; basis := 'month'; period_from := lower(m); period_to := upper(m) - 1; limit_amount := l.per_month; behaviour := l.behaviour;
      used := app.claim_used(p_employee_id, k.id, m); return next;
    end if;
    if l.per_year is not null then
      category_id := k.id; basis := 'year'; period_from := lower(y); period_to := upper(y) - 1; limit_amount := l.per_year; behaviour := l.behaviour;
      used := app.claim_used(p_employee_id, k.id, y); return next;
    end if;
  end loop;
end $$;

-- Limit of a category for an employee the caller may see (P13 form summaries; C5 "Everyone" summary uses the table directly).
create or replace function app.claim_limit_view(p_employee_id uuid, p_category_id uuid, p_on date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l app.claim_limits;
begin
  if not app.can_see_team_row(p_employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  l := app.claim_limit_for(p_employee_id, p_category_id, p_on);
  if l.id is null then return null; end if;
  return jsonb_build_object('perTransaction', app.money_text(l.per_transaction), 'perMonth', app.money_text(l.per_month),
                            'perYear', app.money_text(l.per_year), 'behaviour', l.behaviour, 'appliesTo', l.applies_to);
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema app from public, anon;
revoke execute on function
  app.rm(numeric), app.money_text(numeric), app.claim_issue(int, uuid, text, text, text, text),
  app.claim_event(uuid, text, app.claim_status, app.claim_status, app.acting_as, text, uuid), app.claim_rate_on(uuid, date),
  app.claim_period(date, text, int), app.claim_limit_for(uuid, uuid, date), app.claim_used(uuid, uuid, daterange, uuid),
  app.claim_limit_eval(app.claim_limits, numeric, numeric, numeric), app.resolve_claim_approver(uuid, date), app.claim_approver_hint(uuid),
  app.claim_evaluate(uuid), app.claim_store_checks(uuid, jsonb), app.claim_line_preview(jsonb), app.save_claim(jsonb), app.open_claim_task(uuid),
  app.submit_claim(uuid, boolean, int), app.withdraw_claim(uuid), app.delete_claim(uuid), app.copy_claim(uuid, uuid), app.apply_late_override(uuid, uuid[], text),
  app.tg_claims_transition(), app.tg_claims_after(), app.tg_claim_lines_guard(), app.tg_claim_lines_totals(), app.tg_claim_line_files_guard(),
  app.tg_claim_dependants_guard(), app.tg_late_override_guard(), app.tg_claim_categories_guard(), app.tg_claim_categories_after(), app.tg_claim_limits_guard(),
  app.open_batch_task(uuid), app.batch_event(uuid, text, app.batch_status, app.batch_status, text),
  app.claim_task_decided(app.task_subject, uuid, text, text, app.acting_as), app.reroute_claim_tasks(uuid),
  app.refresh_batch_totals(uuid), app.batch_add_claim(uuid, uuid), app.batch_drop_claim(uuid, text), app.can_cancel_claim(uuid), app.cancel_claim(uuid, text),
  app.undo_claim_disbursement(uuid, text), app.create_batch(jsonb), app.batch_add_claims(uuid, uuid[], int), app.batch_remove_claim(uuid, uuid, int),
  app.batch_submit_for_approval(uuid), app.batch_payees(uuid), app.record_batch_outputs(uuid, jsonb, numeric, numeric),
  app.mark_batch_disbursed(uuid, date, text, text, int), app.cancel_batch(uuid, text), app.tg_batches_guard(), app.tg_batch_claims_guard(),
  app.tg_claims_batch_link(), app.tg_bank_change_batches(), app.tg_export_files_guard(), app.record_export(app.output_kind, text, uuid, uuid, int, numeric, text, text),
  app.claim_validate(uuid), app.claim_utilisation(uuid, date), app.claim_limit_view(uuid, uuid, date)
  from public, anon, authenticated, service_role;

-- user-callable surface (each re-checks the caller)
grant execute on function
  app.rm(numeric), app.money_text(numeric), app.claim_period(date, text, int), app.claim_rate_on(uuid, date), app.claim_approver_hint(uuid),
  app.claim_line_preview(jsonb), app.save_claim(jsonb), app.submit_claim(uuid, boolean, int), app.withdraw_claim(uuid), app.delete_claim(uuid),
  app.copy_claim(uuid, uuid), app.apply_late_override(uuid, uuid[], text), app.can_cancel_claim(uuid), app.cancel_claim(uuid, text),
  app.undo_claim_disbursement(uuid, text), app.create_batch(jsonb), app.batch_add_claims(uuid, uuid[], int), app.batch_remove_claim(uuid, uuid, int),
  app.batch_submit_for_approval(uuid), app.batch_payees(uuid), app.record_batch_outputs(uuid, jsonb, numeric, numeric),
  app.mark_batch_disbursed(uuid, date, text, text, int), app.cancel_batch(uuid, text), app.record_export(app.output_kind, text, uuid, uuid, int, numeric, text, text),
  app.claim_validate(uuid), app.claim_utilisation(uuid, date), app.claim_limit_view(uuid, uuid, date)
  to authenticated;
grant execute on function app.rm(numeric), app.money_text(numeric), app.claim_period(date, text, int) to service_role;
