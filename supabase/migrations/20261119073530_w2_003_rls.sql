-- PRET W2-003 · 03 — RLS (enabled AND forced), grants, policies, Storage file rules, activity trail.
-- Design: rls-policies.md §1 (principles), §4 (patterns), §5.3 (employee master), §6 (key policies), §8 (no
-- manager policy on T2/T3/T4 tables), §9 (Storage), §10 (definer register), §11 (matrix).

-- ===========================================================================
-- RLS: enable + force on every new table
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array['banks','lhdn_branches','employees','employee_directory','employee_personal','employee_marital_history',
    'employee_sensitive','employee_hr_private','employee_group_members','employee_emergency_contacts','employee_spouses',
    'employee_children','employee_job_history','probation_recommendations','employee_separations','employee_separation_details',
    'employee_statutory_profiles','employee_statutory_employer_flags','employee_bank_accounts','employee_documents','hr_notes',
    'hr_note_revisions','prior_employments','change_requests','change_request_items','change_request_files']
  loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
  end loop;
end $$;

-- ===========================================================================
-- Table privileges (first gate). Column grants keep system-managed columns (status, job cache,
-- confirmation, encrypted values of other tables …) out of reach of direct user writes.
-- ===========================================================================
revoke all on app.banks, app.lhdn_branches, app.employees, app.employee_directory, app.employee_personal,
              app.employee_marital_history, app.employee_sensitive, app.employee_hr_private, app.employee_group_members,
              app.employee_emergency_contacts, app.employee_spouses, app.employee_children, app.employee_job_history,
              app.probation_recommendations, app.employee_separations, app.employee_separation_details,
              app.employee_statutory_profiles, app.employee_statutory_employer_flags, app.employee_bank_accounts,
              app.employee_documents, app.hr_notes, app.hr_note_revisions, app.prior_employments, app.change_requests,
              app.change_request_items, app.change_request_files
  from public, anon, authenticated;
grant all on all tables in schema app to service_role;                 -- pret_jobs path (BYPASSRLS); never interactive

grant select, insert, update on app.banks, app.lhdn_branches to authenticated;
grant select on app.employees to authenticated;
grant insert (id, employee_no, full_name, preferred_name, gender, work_email, mobile_phone, work_phone, photo_file_id, join_date,
              employment_type, probation_months, department_id, position_id, grade_id, manager_employee_id, work_location_id,
              working_pattern_id, leave_approver_employee_id, claim_approver_employee_id)
  on app.employees to authenticated;
grant update (employee_no, full_name, preferred_name, gender, work_email, mobile_phone, work_phone, photo_file_id, join_date,
              probation_months, leave_approver_employee_id, claim_approver_employee_id)
  on app.employees to authenticated;
grant select on app.employee_directory to authenticated;
grant select on app.employee_personal to authenticated;
grant insert (employee_id, nric_enc, nric_last4, nric_bidx, date_of_birth, dob_overridden, race, race_other, passport_no, passport_expiry,
              highest_qualification, personal_email, res_addr_line1, res_addr_line2, res_addr_line3, res_postcode, res_city, res_state,
              res_country, mailing_same_as_residential, mail_addr_line1, mail_addr_line2, mail_addr_line3, mail_postcode, mail_city,
              mail_state, mail_country, continuous_service_date, contractual_notice_value, contractual_notice_unit)
  on app.employee_personal to authenticated;
grant update (nric_enc, nric_last4, nric_bidx, date_of_birth, dob_overridden, race, race_other, passport_no, passport_expiry,
              highest_qualification, personal_email, res_addr_line1, res_addr_line2, res_addr_line3, res_postcode, res_city, res_state,
              res_country, mailing_same_as_residential, mail_addr_line1, mail_addr_line2, mail_addr_line3, mail_postcode, mail_city,
              mail_state, mail_country, continuous_service_date, contractual_notice_value, contractual_notice_unit)
  on app.employee_personal to authenticated;
grant select, insert on app.employee_marital_history to authenticated;
grant select on app.employee_sensitive to authenticated;                -- self only (RLS); writes via app.write_employee_sensitive
grant select, insert, update on app.employee_hr_private to authenticated;
grant select, insert, delete on app.employee_group_members to authenticated;
grant select, insert, update, delete on app.employee_emergency_contacts to authenticated;
grant select, insert, update on app.employee_spouses, app.employee_children to authenticated;
grant select, insert, update on app.employee_job_history to authenticated;
grant select on app.probation_recommendations to authenticated;
grant insert (employee_id, recommendation, suggested_extension_months, remarks, recommended_by) on app.probation_recommendations to authenticated;
grant select, insert, update on app.employee_separations, app.employee_separation_details to authenticated;
grant select, insert, update on app.employee_statutory_profiles, app.employee_statutory_employer_flags to authenticated;
grant select on app.employee_bank_accounts to authenticated;
grant insert (id, employee_id, payment_method, bank_id, account_type, account_no_enc, account_no_last4, account_no_bidx,
              account_holder_name, holder_name_mismatch_ack, shared_account_remarks, proof_file_id, effective_from, verified_by,
              asnb_account_no_enc, asnb_account_no_last4)
  on app.employee_bank_accounts to authenticated;                      -- insert-only history (no UPDATE / DELETE grant)
grant select, insert, update on app.employee_documents to authenticated;
grant select, insert, update on app.hr_notes to authenticated;
grant select on app.hr_note_revisions to authenticated;
grant select, insert, update, delete on app.prior_employments to authenticated;
grant select on app.change_requests to authenticated;
grant insert (id, employee_id, category, effective_date, employee_remarks, idempotency_key) on app.change_requests to authenticated;
grant update (status) on app.change_requests to authenticated;          -- cancel only (trigger); decisions via app.decide_change_request
grant select, insert on app.change_request_items, app.change_request_files to authenticated;
-- reporting_closure stays P-DEFINER (no grant).

-- ===========================================================================
-- Policies (one per command; WITH CHECK on every insert/update)
-- ===========================================================================
-- Reference lookups (P-ACTIVE read, P-HR write)
create policy banks_select on app.banks for select to authenticated using ((select app.is_active_user()));
create policy banks_insert on app.banks for insert to authenticated with check ((select app.is_admin()));
create policy banks_update on app.banks for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy lhdn_select on app.lhdn_branches for select to authenticated using ((select app.is_active_user()));
create policy lhdn_insert on app.lhdn_branches for insert to authenticated with check ((select app.is_admin()));
create policy lhdn_update on app.lhdn_branches for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));

-- employees (T1): P-TEAM read; P-HR insert; P-HR or P-SELF update (self-edit guard limits columns)
create policy employees_select on app.employees for select to authenticated using (app.can_see_team_row(id));
create policy employees_insert on app.employees for insert to authenticated with check ((select app.is_admin()));
create policy employees_update on app.employees for update to authenticated
  using ((select app.is_admin()) or app.is_self(id)) with check ((select app.is_admin()) or app.is_self(id));

-- directory (T0): any active user sees listed rows; P-HR all
create policy directory_select on app.employee_directory for select to authenticated
  using (((select app.is_active_user()) and is_listed) or (select app.is_admin()));

-- T2 personal
create policy personal_select on app.employee_personal for select to authenticated
  using (app.is_self(employee_id) or (select app.is_admin()));
create policy personal_insert on app.employee_personal for insert to authenticated with check ((select app.is_admin()));
create policy personal_update on app.employee_personal for update to authenticated
  using (app.is_self(employee_id) or (select app.is_admin())) with check (app.is_self(employee_id) or (select app.is_admin()));

create policy marital_select on app.employee_marital_history for select to authenticated
  using (app.is_self(employee_id) or (select app.is_admin()));
create policy marital_insert on app.employee_marital_history for insert to authenticated
  with check ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()));

-- T4 sensitive: direct SELECT by the employee only (ADM/SA via app.read_employee_sensitive — logged)
create policy sensitive_select_self on app.employee_sensitive for select to authenticated using (app.is_self(employee_id));

-- T3 HR only
create policy hr_private_select on app.employee_hr_private for select to authenticated using ((select app.is_admin()));
create policy hr_private_insert on app.employee_hr_private for insert to authenticated with check ((select app.is_admin()));
create policy hr_private_update on app.employee_hr_private for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy group_members_select on app.employee_group_members for select to authenticated using ((select app.is_admin()));
create policy group_members_insert on app.employee_group_members for insert to authenticated with check ((select app.is_admin()));
create policy group_members_delete on app.employee_group_members for delete to authenticated using ((select app.is_admin()));

-- T1 emergency contacts (manager projection hides C6/C7 server-side)
create policy emergency_select on app.employee_emergency_contacts for select to authenticated using (app.can_see_team_row(employee_id));
create policy emergency_insert on app.employee_emergency_contacts for insert to authenticated
  with check (app.is_self(employee_id) or (select app.is_admin()));
create policy emergency_update on app.employee_emergency_contacts for update to authenticated
  using (app.is_self(employee_id) or (select app.is_admin())) with check (app.is_self(employee_id) or (select app.is_admin()));
create policy emergency_delete on app.employee_emergency_contacts for delete to authenticated
  using (app.is_self(employee_id) or (select app.is_admin()));

-- T2 family: self read; P-HR-NOT-OWN write (own spouse phone D9 via the self-edit guard's E✎ list)
create policy spouses_select on app.employee_spouses for select to authenticated using (app.is_self(employee_id) or (select app.is_admin()));
create policy spouses_insert on app.employee_spouses for insert to authenticated
  with check ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()));
create policy spouses_update on app.employee_spouses for update to authenticated
  using (app.is_self(employee_id) or (select app.is_admin())) with check (app.is_self(employee_id) or (select app.is_admin()));
create policy children_select on app.employee_children for select to authenticated using (app.is_self(employee_id) or (select app.is_admin()));
create policy children_insert on app.employee_children for insert to authenticated
  with check ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()));
create policy children_update on app.employee_children for update to authenticated
  using ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()))
  with check ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()));

-- T1 job history and separation dates; T3 separation details
create policy job_history_select on app.employee_job_history for select to authenticated using (app.can_see_team_row(employee_id));
create policy job_history_insert on app.employee_job_history for insert to authenticated with check ((select app.is_admin()));
create policy job_history_update on app.employee_job_history for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy separations_select on app.employee_separations for select to authenticated using (app.can_see_team_row(employee_id));
create policy separations_insert on app.employee_separations for insert to authenticated with check ((select app.is_admin()));
create policy separations_update on app.employee_separations for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy separation_details_select on app.employee_separation_details for select to authenticated using ((select app.is_admin()));
create policy separation_details_insert on app.employee_separation_details for insert to authenticated with check ((select app.is_admin()));
create policy separation_details_update on app.employee_separation_details for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Probation recommendations: the recommending manager (own rows) and P-HR
create policy probation_rec_select on app.probation_recommendations for select to authenticated
  using ((select app.is_admin()) or recommended_by = (select app.current_app_user_id()));
create policy probation_rec_insert on app.probation_recommendations for insert to authenticated
  with check (recommended_by = (select app.current_app_user_id())
              and (app.is_manager_of(employee_id) or (select app.is_admin())));

-- Statutory (T2 self read; P-HR-NOT-OWN write) and employer flags (T3, not own)
create policy statutory_select on app.employee_statutory_profiles for select to authenticated
  using (app.is_self(employee_id) or (select app.is_admin()));
create policy statutory_insert on app.employee_statutory_profiles for insert to authenticated
  with check ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()));
create policy statutory_update on app.employee_statutory_profiles for update to authenticated
  using ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()))
  with check ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()));
create policy employer_flags_select on app.employee_statutory_employer_flags for select to authenticated using ((select app.is_admin()));
create policy employer_flags_insert on app.employee_statutory_employer_flags for insert to authenticated
  with check ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()));
create policy employer_flags_update on app.employee_statutory_employer_flags for update to authenticated
  using ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()))
  with check ((select app.is_admin()) and employee_id is distinct from (select app.current_employee_id()));

-- Bank (T2): self read (masked); ADM/SA insert for others only, no confirmation step (D15)
create policy bank_select on app.employee_bank_accounts for select to authenticated
  using (app.is_self(employee_id) or (select app.is_admin()));
create policy bank_insert on app.employee_bank_accounts for insert to authenticated
  with check ((select app.is_admin())
              and employee_id is distinct from (select app.current_employee_id())
              and verified_by = (select app.current_app_user_id()));

-- Documents (T2/T3): HR all; the employee only visible + active rows of non-HR-only categories
create policy documents_select on app.employee_documents for select to authenticated
  using ((select app.is_admin()) or (app.is_self(employee_id) and visible_to_employee and is_active));
create policy documents_insert on app.employee_documents for insert to authenticated with check ((select app.is_admin()));
create policy documents_update on app.employee_documents for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- HR notes (T3)
create policy hr_notes_select on app.hr_notes for select to authenticated using ((select app.is_admin()));
create policy hr_notes_insert on app.hr_notes for insert to authenticated with check ((select app.is_admin()));
create policy hr_notes_update on app.hr_notes for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy note_revisions_select on app.hr_note_revisions for select to authenticated using ((select app.is_admin()));

-- Prior employment (T2; E✎)
create policy prior_select on app.prior_employments for select to authenticated using (app.is_self(employee_id) or (select app.is_admin()));
create policy prior_insert on app.prior_employments for insert to authenticated with check (app.is_self(employee_id) or (select app.is_admin()));
create policy prior_update on app.prior_employments for update to authenticated
  using (app.is_self(employee_id) or (select app.is_admin())) with check (app.is_self(employee_id) or (select app.is_admin()));
create policy prior_delete on app.prior_employments for delete to authenticated using (app.is_self(employee_id) or (select app.is_admin()));

-- Change requests (T2): own + HR read; own submit; own cancel (trigger); decisions via app.decide_change_request
create policy cr_select on app.change_requests for select to authenticated using (app.is_self(employee_id) or (select app.is_admin()));
create policy cr_insert on app.change_requests for insert to authenticated with check (app.is_self(employee_id) and status = 'submitted');
create policy cr_update on app.change_requests for update to authenticated
  using (app.is_self(employee_id) and status = 'submitted') with check (app.is_self(employee_id));
create policy cr_items_select on app.change_request_items for select to authenticated using (app.is_self(employee_id) or (select app.is_admin()));
create policy cr_items_insert on app.change_request_items for insert to authenticated with check (app.is_self(employee_id));
create policy cr_files_select on app.change_request_files for select to authenticated
  using (exists (select 1 from app.change_requests c where c.id = change_request_id
                  and (app.is_self(c.employee_id) or (select app.is_admin()))));
create policy cr_files_insert on app.change_request_files for insert to authenticated
  with check (exists (select 1 from app.change_requests c where c.id = change_request_id and app.is_self(c.employee_id)
                       and c.status = 'submitted'));

-- ===========================================================================
-- Storage: who may obtain a download grant (rls-policies §9 table) — replaces the foundation rules now
-- that employee_documents / change_requests exist. Uploads: app.can_upload_for (foundation) already
-- limits employee documents to ADM/SA not-own, photos to self/ADM/SA, CR documents to the employee.
-- ===========================================================================
create or replace function app.can_read_file(p_file_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.files f
     where f.id = p_file_id and f.status = 'active'
       and (   (f.subject in ('employee_photo','privacy_notice','company_asset') and app.is_active_user())
            or app.is_admin()
            or (app.is_self(f.owner_employee_id) and f.subject in ('leave_attachment','claim_receipt','tp1_doc'))
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

-- ===========================================================================
-- Activity trail for one employee (F-EMP-21/28) — ADM/SA. Owned by audit_writer (the only role that
-- may read the append-only logs besides SA under RLS). Sensitive values are masked here, not in the UI.
-- ===========================================================================
create or replace function audit.employee_trail(p_employee_id uuid, p_from date, p_to date)
returns table (source text, id bigint, occurred_at timestamptz, actor_user_id uuid, actor_label text, action app.audit_action,
               entity_type text, entity_id uuid, entity_ref text, changes jsonb, reason text, on_behalf boolean,
               data_categories app.data_category[], fields text[], record_count int)
language sql stable security definer set search_path = '' as $$
  select * from (
    select 'audit'::text, a.id, a.occurred_at, a.actor_user_id, a.actor_label, a.action, a.entity_type, a.entity_id, a.entity_ref,
           (select jsonb_object_agg(j.k, case
                     when j.k ~ '(_enc|_bidx)$' then '["[encrypted]","[encrypted]"]'::jsonb
                     when j.k in ('religion','is_oku','oku_card_no') then '["[sensitive]","[sensitive]"]'::jsonb
                     else j.v end)
              from jsonb_each(coalesce(a.changes, '{}'::jsonb)) as j(k, v)),
           a.reason, a.on_behalf_employee_id is not null, a.data_categories, '{}'::text[], null::int
      from audit.audit_log a
     where (a.employee_id = p_employee_id or (a.entity_type = 'employees' and a.entity_id = p_employee_id))
       and a.occurred_at >= coalesce(p_from, date '2000-01-01')::timestamp at time zone 'Asia/Kuala_Lumpur'
       and a.occurred_at <  (coalesce(p_to, date '2999-12-31') + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
    union all
    select 'access'::text, x.id, x.occurred_at, x.actor_user_id, null, x.action, x.entity_type, x.entity_id, x.entity_ref,
           null::jsonb, x.reason, false, x.data_categories, x.fields, x.record_count
      from audit.access_log x
     where p_employee_id = any(x.employee_ids)
       and x.occurred_at >= coalesce(p_from, date '2000-01-01')::timestamp at time zone 'Asia/Kuala_Lumpur'
       and x.occurred_at <  (coalesce(p_to, date '2999-12-31') + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
  ) t
  where app.is_admin()
  order by t.occurred_at desc, t.id desc
  limit 5000
$$;

-- ===========================================================================
-- Function privileges: revoke everything new, then grant the callable surface
-- ===========================================================================
revoke execute on function
  app.can_see_team_row(uuid), app.employee_names(uuid[]), app.employee_portal_accounts(uuid[]),
  app.derive_employee_status(date, int, date, timestamptz, date, date), app.employee_active_lwd(uuid),
  app.refresh_employee_status(uuid), app.check_reporting_line(uuid, uuid), app.check_approver(uuid, uuid),
  app.rebuild_reporting_closure(), app.apply_current_job(uuid), app.refresh_directory(uuid), app.employee_user_id(uuid),
  app.notify_role_holders(app.privileged_role[], text, text, text, text, boolean, text, jsonb, uuid),
  app.allocate_employee_no(), app.read_employee_sensitive(uuid, text),
  app.write_employee_sensitive(uuid, app.religion, boolean, text),
  app.confirm_employee(uuid, date, text), app.extend_probation(uuid, date, text), app.withdraw_resignation(uuid, text),
  app.withdraw_offer(uuid), app.rehire_employee(uuid, text, date, date, int, uuid, uuid, uuid, uuid, uuid, uuid),
  app.cr_field_allowed(app.cr_category, text, text), app.apply_change_request(uuid),
  app.decide_change_request(uuid, text, text, int), app.employee_completeness(uuid[]),
  app.tg_self_edit_guard(), app.tg_employees_guard(), app.tg_employees_derive(), app.tg_employees_after(), app.tg_employees_closure(),
  app.tg_check_top_of_org(), app.tg_hr_private_guard(), app.tg_personal_validate(), app.tg_marital_after(), app.tg_family_validate(),
  app.tg_emergency_min_one(), app.tg_prior_employment_validate(), app.tg_self_update_notify(), app.tg_job_history_guard(),
  app.tg_job_history_validate(), app.tg_job_history_after(), app.tg_separation_guard(), app.tg_separation_after(),
  app.tg_separation_details_before(), app.tg_separation_details_after(), app.tg_bank_before(), app.tg_bank_change_alert(),
  app.tg_documents_before(), app.tg_hr_notes_revision(), app.tg_probation_rec_before(), app.tg_group_members_before(),
  app.tg_cr_before_insert(), app.tg_cr_guard(), app.tg_cr_after_insert(), app.tg_cr_items_before(), app.tg_cr_files_before(),
  app.tg_work_locations_after(), app.tg_directory_lookup_refresh()
  from public, anon, authenticated, service_role;

grant execute on function
  app.can_see_team_row(uuid), app.employee_names(uuid[]), app.employee_portal_accounts(uuid[]),
  app.derive_employee_status(date, int, date, timestamptz, date, date),
  app.allocate_employee_no(), app.read_employee_sensitive(uuid, text),
  app.write_employee_sensitive(uuid, app.religion, boolean, text),
  app.confirm_employee(uuid, date, text), app.extend_probation(uuid, date, text), app.withdraw_resignation(uuid, text),
  app.withdraw_offer(uuid), app.rehire_employee(uuid, text, date, date, int, uuid, uuid, uuid, uuid, uuid, uuid),
  app.decide_change_request(uuid, text, text, int), app.employee_completeness(uuid[])
  to authenticated;
-- service_role (pret_jobs): helpers the triggers call during job writes
grant execute on function
  app.can_see_team_row(uuid), app.derive_employee_status(date, int, date, timestamptz, date, date), app.employee_active_lwd(uuid),
  app.refresh_employee_status(uuid), app.rebuild_reporting_closure(), app.apply_current_job(uuid), app.refresh_directory(uuid),
  app.employee_user_id(uuid), app.employee_names(uuid[])
  to service_role;
-- audit_writer runs audit.employee_trail and the audit trigger on the new tables
grant execute on function app.is_admin(), app.current_app_user_id() to audit_writer;

-- audit.employee_trail: owned by audit_writer (like audit.write_access)
revoke execute on function audit.employee_trail(uuid, date, date) from public, anon, authenticated, service_role;
grant create on schema audit to audit_writer;          -- needed only while ownership is transferred
alter function audit.employee_trail(uuid, date, date) owner to audit_writer;
revoke create on schema audit from audit_writer;
set role audit_writer;
grant execute on function audit.employee_trail(uuid, date, date) to authenticated;
reset role;
