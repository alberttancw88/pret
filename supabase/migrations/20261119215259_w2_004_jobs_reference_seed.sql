-- PRET W2-004 · 06 — nightly leave job (pg_cron, free tier — D27) + reference seed: statutory minimums (L-02, L-05, L-07,
-- L-08), leave policy defaults (LP1–LP18), the two seeded workflows (§6.11) and the D13 leave types (PRD §6.5) with bands.
-- Seeds are policy data, not personal data. Marriage / Study-Exam (Q7) and the Emergency type (LP10 note) are created INACTIVE.

-- ===========================================================================
-- Daily job (ADR-0009): idempotent per business day (app.job_runs 'leave-daily'), 00:10 MYT after the employee job
-- ===========================================================================
create or replace function app.run_leave_daily_job(p_force boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := app.today_myt(); v_year int := extract(year from app.today_myt())::int; v_run uuid; v_summary jsonb := '{}'::jsonb;
  v_errors text[] := '{}'; v_n int; r record; pol app.leave_policy%rowtype; v_used numeric; v_exp numeric; v_y int; v_wd int; v_rl uuid;
begin
  if app.current_app_user_id() is not null and not app.is_sa() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if not p_force and exists (select 1 from app.job_runs j where j.job_name = 'leave-daily' and j.business_date = v_today and j.status = 'succeeded') then
    return jsonb_build_object('skipped', true, 'business_date', v_today);
  end if;
  perform set_config('app.actor_label', 'system:leave-daily', true);
  update app.job_runs j set status = 'running', attempt = j.attempt + 1, started_at = now(), finished_at = null, error = null
   where j.job_name = 'leave-daily' and j.business_date = v_today and j.status = 'succeeded' returning j.id into v_run;
  if v_run is null then insert into app.job_runs (job_name, business_date, status) values ('leave-daily', v_today, 'running') returning id into v_run; end if;
  select * into pol from app.leave_policy where id = 1;

  -- 1. Entitlements (F-LV-04): current year; next year from the LP8 date (BR-LV-73). Idempotent (inputs hash + ledger delta).
  begin
    v_n := app.generate_entitlements(v_year, null, 'Recalculated');
    if pol.allow_next_year_applications and v_today >= to_date(pol.next_year_from_ddmm || '/' || v_year, 'DD/MM/YYYY') then
      v_n := v_n + app.generate_entitlements(v_year + 1, null, 'Entitlement');
    end if;
    v_summary := v_summary || jsonb_build_object('entitlements', v_n);
  exception when others then v_errors := v_errors || ('entitlements: ' || left(sqlerrm, 200));
  end;

  -- 2. Carry-forward expiry (BR-LV-71, FIFO by leave date ≤ expiry — Q-ARCH-03)
  v_n := 0;
  for r in select l.* from app.leave_ledger l
            where l.entry_type = 'carry_forward' and l.expires_on is not null and l.expires_on < v_today and l.source_credit_id is null
              and not exists (select 1 from app.leave_ledger x where x.source_ledger_id = l.id) loop
    begin
      select coalesce(sum(d.weight), 0) into v_used from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
       where d.employee_id = r.employee_id and d.leave_year = r.leave_year and d.leave_date <= r.expires_on
         and a.status in ('approved','cancellation_pending') and app.balance_type_id(a.leave_type_id) = r.leave_type_id;
      v_exp := greatest(r.days - v_used, 0);
      if v_exp > 0 then
        insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, source_ledger_id, reason)
        values (r.employee_id, r.leave_type_id, r.leave_year, 'expired', -v_exp, r.expires_on + 1, r.id, 'Carry-forward expired ' || app.dmy(r.expires_on));
        v_n := v_n + 1;
      end if;
    exception when others then v_errors := v_errors || ('cf ' || r.id || ': ' || left(sqlerrm, 200));
    end;
  end loop;
  v_summary := v_summary || jsonb_build_object('carry_forward_expired', v_n);

  -- 3. Replacement-credit expiry (BR-LV-82) — the ledger year is the year the credit currently sits in
  v_n := 0;
  select t.id into v_rl from app.leave_types t where t.category = 'replacement' and t.entitlement_method = 'earned_credits' order by t.is_active desc, t.display_order limit 1;
  for r in select c.* from app.replacement_credits c where c.status = 'approved' and c.expired_at is null and c.expiry_date < v_today for update loop
    begin
      v_y := case when exists (select 1 from app.leave_ledger l where l.source_credit_id = r.id and l.entry_type = 'carry_forward'
                                 and l.leave_year = extract(year from r.expiry_date)::int)
                  then extract(year from r.expiry_date)::int else extract(year from r.date_worked)::int end;
      if r.remaining_days > 0 and v_rl is not null then
        insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, source_credit_id, reason)
        values (r.employee_id, v_rl, v_y, 'expired', -r.remaining_days, r.expiry_date + 1, r.id, 'Credit ' || r.credit_no || ' expired');
      end if;
      update app.replacement_credits set expired_days = expired_days + remaining_days, remaining_days = 0, expired_at = now() where id = r.id;
      v_n := v_n + 1;
    exception when others then v_errors := v_errors || ('credit ' || r.id || ': ' || left(sqlerrm, 200));
    end;
  end loop;
  v_summary := v_summary || jsonb_build_object('credits_expired', v_n);

  -- 4. N-13 — carry-forward / credits expiring in 30 days (once, on the day)
  begin
    for r in select l.employee_id, l.days, l.expires_on, t.name, t.code from app.leave_ledger l join app.leave_types t on t.id = l.leave_type_id
              where l.entry_type = 'carry_forward' and l.source_credit_id is null and l.expires_on = v_today + 30 loop
      perform app.notify_employee(r.employee_id, 'N-13', r.name || ' carry-forward expires ' || app.dmy(r.expires_on),
        'Use it before ' || app.dmy(r.expires_on) || ' (up to ' || r.days || ' day(s)).', '/my/leave/balances', false, 'leave_expiring',
        jsonb_build_object('type', r.name, 'expires_on', app.dmy(r.expires_on), 'days', r.days));
    end loop;
    for r in select c.id, c.employee_id, c.credit_no, c.remaining_days, c.expiry_date from app.replacement_credits c
              where c.status = 'approved' and c.expired_at is null and c.remaining_days > 0 and c.expiry_date <= v_today + 30 and c.expiry_warned_at is null loop
      perform app.notify_employee(r.employee_id, 'N-13', 'Replacement credit ' || r.credit_no || ' expires ' || app.dmy(r.expiry_date),
        r.remaining_days || ' day(s) left.', '/my/leave/credits', false, 'leave_expiring',
        jsonb_build_object('reference', r.credit_no, 'expires_on', app.dmy(r.expiry_date), 'days', r.remaining_days));
      update app.replacement_credits set expiry_warned_at = now() where id = r.id;
    end loop;
  exception when others then v_errors := v_errors || ('n13: ' || left(sqlerrm, 200));
  end;

  -- 5. N-14 — attachment still pending after the grace period (daily while pending)
  begin
    for r in select a.employee_id, a.ref_no from app.leave_applications a
              where a.attachment_pending and a.attachment_due_at < now() and a.status in ('pending','approved') loop
      perform app.notify_employee(r.employee_id, 'N-14', 'Attachment still missing: ' || r.ref_no, 'Please add the document to your application.',
        '/my/leave/' || r.ref_no, true, 'leave_attachment_pending', jsonb_build_object('reference', r.ref_no));
    end loop;
  exception when others then v_errors := v_errors || ('n14: ' || left(sqlerrm, 200));
  end;

  -- 6. BR-LV-61 — re-route items whose approver left, is unavailable or is on leave today without a delegate
  begin
    v_summary := v_summary || jsonb_build_object('rerouted', app.reroute_open_tasks(null));
  exception when others then v_errors := v_errors || ('reroute: ' || left(sqlerrm, 200));
  end;

  -- 7. N-17 — delegation starts today / ended yesterday (F-LV-24)
  begin
    for r in select d.* from app.delegations d where d.cancelled_at is null and d.valid_from = v_today loop
      perform app.notify(r.delegate_user_id, 'N-17', left('You are the approval delegate of ' || app.user_name(r.delegator_user_id) || ' from today', 150),
        'Until ' || app.dmy(r.valid_to), '/approvals', false, 'delegation_changed', jsonb_build_object('change', 'started', 'to', app.dmy(r.valid_to)));
    end loop;
    for r in select d.* from app.delegations d where d.cancelled_at is null and d.valid_to = v_today - 1 loop
      perform app.notify(r.delegate_user_id, 'N-17', left('Delegation for ' || app.user_name(r.delegator_user_id) || ' has ended', 150), null, '/approvals', false, null, null);
      perform app.notify(r.delegator_user_id, 'N-17', left('Your delegation to ' || app.user_name(r.delegate_user_id) || ' has ended', 150), null, '/account', false, null, null);
    end loop;
  exception when others then v_errors := v_errors || ('n17: ' || left(sqlerrm, 200));
  end;

  -- 8. F-LV-25 — reminders (N-15 daily digest from LP15 working days) and escalation (N-16 once; nothing auto-approved)
  begin
    if pol.reminder_after_working_days > 0 then
      for r in select coalesce(t.assignee_user_id::text, t.source::text) as who, t.assignee_user_id, t.source, count(*)::int as n
                 from app.approval_tasks t
                where t.status = 'open' and t.subject_type in ('leave_application','leave_cancellation','replacement_credit')
                  and (t.last_reminded_at is null or (t.last_reminded_at at time zone 'Asia/Kuala_Lumpur')::date < v_today)
                  and app.working_days_between(t.subject_employee_id, (t.created_at at time zone 'Asia/Kuala_Lumpur')::date, v_today) >= pol.reminder_after_working_days
                group by 1, 2, 3 loop
        if r.assignee_user_id is not null then
          perform app.notify(r.assignee_user_id, 'N-15', r.n || ' approval(s) waiting for you', 'Leave items pending your decision.', '/approvals', true,
                             'approvals_digest', jsonb_build_object('count', r.n));
        else
          perform app.notify_role_holders(case when r.source = 'super_admin_pool' then array['SA'] else array['ADM','SA'] end::app.privileged_role[],
                    'N-15', r.n || ' approval(s) waiting for Admin', 'Leave items pending at the Admin level.', '/approvals', true, 'approvals_digest',
                    jsonb_build_object('count', r.n), null);
        end if;
      end loop;
      update app.approval_tasks t set reminder_count = t.reminder_count + 1, last_reminded_at = now()
       where t.status = 'open' and t.subject_type in ('leave_application','leave_cancellation','replacement_credit')
         and (t.last_reminded_at is null or (t.last_reminded_at at time zone 'Asia/Kuala_Lumpur')::date < v_today)
         and app.working_days_between(t.subject_employee_id, (t.created_at at time zone 'Asia/Kuala_Lumpur')::date, v_today) >= pol.reminder_after_working_days;
    end if;
    if pol.escalate_after_working_days > 0 then
      for r in select t.* from app.approval_tasks t
                where t.status = 'open' and t.escalated_at is null and t.subject_type in ('leave_application','leave_cancellation','replacement_credit')
                  and app.working_days_between(t.subject_employee_id, (t.created_at at time zone 'Asia/Kuala_Lumpur')::date, v_today) >= pol.escalate_after_working_days loop
        if r.assignee_user_id is not null then
          perform app.notify_employee((select e.manager_employee_id from app.app_users u join app.employees e on e.id = u.employee_id where u.id = r.assignee_user_id),
            'N-16', left('Escalation: an approval for ' || app.user_name(r.assignee_user_id) || ' is overdue', 150),
            'Pending ' || pol.escalate_after_working_days || '+ working days.', '/approvals', false, 'approval_escalated', jsonb_build_object('approver', app.user_name(r.assignee_user_id)));
        end if;
        perform app.notify_role_holders(array['ADM']::app.privileged_role[], 'N-16', left('Escalation: ' || coalesce(app.employee_display(r.subject_employee_id), '') || ' — approval overdue', 150),
          'Pending ' || pol.escalate_after_working_days || '+ working days.', '/leave/applications', true, 'approval_escalated', jsonb_build_object('task', r.id), null);
        update app.approval_tasks set escalated_at = now() where id = r.id;
      end loop;
    end if;
  exception when others then v_errors := v_errors || ('reminders: ' || left(sqlerrm, 200));
  end;

  v_summary := v_summary || jsonb_build_object('errors', to_jsonb(v_errors));
  update app.job_runs j set status = case when cardinality(v_errors) = 0 then 'succeeded' else 'failed' end::app.job_status,
         finished_at = now(), summary = v_summary, error = case when cardinality(v_errors) = 0 then null else left(array_to_string(v_errors, '; '), 2000) end
   where j.id = v_run;
  return v_summary;
end $$;
revoke execute on function app.run_leave_daily_job(boolean) from public, anon, authenticated, service_role;
grant execute on function app.run_leave_daily_job(boolean) to service_role;

select cron.schedule('pret-leave-daily', '10 16 * * *', $cron$select app.run_leave_daily_job(false)$cron$);

-- ===========================================================================
-- Reference seed
-- ===========================================================================
insert into app.statutory_leave_minimums (category, service_from_years, service_to_years, min_days, legal_ref) values
  ('annual', 0, 2, 8, 'EA s60E(1)'), ('annual', 2, 5, 12, 'EA s60E(1)'), ('annual', 5, null, 16, 'EA s60E(1)'),
  ('sick', 0, 2, 14, 'EA s60F(1)(aa)'), ('sick', 2, 5, 18, 'EA s60F(1)(aa)'), ('sick', 5, null, 22, 'EA s60F(1)(aa)'),
  ('hospitalisation', 0, null, 60, 'EA s60F(1)(bb)'),
  ('maternity', 0, null, 98, 'EA s37(1)(a)'),
  ('paternity', 0, null, 7, 'EA s60FA(1)');

insert into app.approval_workflows (id, name) values
  ('00000000-0000-4000-8000-00000000f001', 'Direct Manager → Admin'),
  ('00000000-0000-4000-8000-00000000f002', 'Direct Manager only');
insert into app.approval_workflow_levels (workflow_id, level, source) values
  ('00000000-0000-4000-8000-00000000f001', 1, 'direct_manager'), ('00000000-0000-4000-8000-00000000f001', 2, 'admin_pool'),
  ('00000000-0000-4000-8000-00000000f002', 1, 'direct_manager');

insert into app.leave_types (id, code, name, category, description, is_paid, count_basis, entitlement_method, prorate_joiners_leavers,
    eligible_gender, eligible_marital, min_service_months, half_day_allowed, reason_required, attachment_rule, attachment_grace_hours,
    backdate_working_days, max_days_per_application, max_occurrences, occurrence_scope, days_per_occurrence, annual_cap_days, deduct_from_type_id,
    carry_forward_allowed, workflow_id, calendar_colour, payroll_treatment, display_order, is_active)
values
  ('00000000-0000-4000-8000-00000000e101', 'AL', 'Annual Leave', 'annual', null, true, 'working_days', 'annual_banded', true,
    'all', 'any', 0, true, true, 'not_required', 0, 3, null, null, null, null, null, null, true, '00000000-0000-4000-8000-00000000f001', '#1E88E5', 'paid_encashable', 10, true),
  ('00000000-0000-4000-8000-00000000e102', 'SL', 'Sick Leave', 'sick', 'A medical certificate (MC) is required. No diagnosis is recorded.', true, 'working_days', 'annual_banded', false,
    'all', 'any', 0, true, true, 'always', 0, 3, null, null, null, null, null, null, false, '00000000-0000-4000-8000-00000000f001', '#E53935', 'paid', 20, true),
  ('00000000-0000-4000-8000-00000000e103', 'HL', 'Hospitalisation Leave', 'hospitalisation', 'Up to 60 days a year together with sick leave. Certification required.', true, 'working_days', 'annual_banded', false,
    'all', 'any', 0, false, true, 'always', 0, 3, null, null, null, null, null, null, false, '00000000-0000-4000-8000-00000000f001', '#8E24AA', 'paid', 30, true),
  ('00000000-0000-4000-8000-00000000e104', 'ML', 'Maternity Leave', 'maternity', '98 consecutive days per confinement.', true, 'consecutive_calendar_days', 'fixed_per_occurrence', false,
    'female', 'any', 0, false, true, 'always', 0, 0, null, null, null, 98, null, null, false, '00000000-0000-4000-8000-00000000f001', '#D81B60', 'paid', 40, true),
  ('00000000-0000-4000-8000-00000000e105', 'PL', 'Paternity Leave', 'paternity', '7 consecutive days per confinement, up to 5 confinements. Birth certificate within 30 days.', true, 'consecutive_calendar_days', 'fixed_per_occurrence', false,
    'male', 'married', 12, false, true, 'always', 720, 3, null, 5, 'per_employment', 7, null, null, false, '00000000-0000-4000-8000-00000000f001', '#3949AB', 'paid', 50, true),
  ('00000000-0000-4000-8000-00000000e106', 'CL', 'Compassionate Leave', 'compassionate', null, true, 'working_days', 'annual_banded', false,
    'all', 'any', 0, true, true, 'not_required', 0, 3, 5, null, null, null, null, null, false, '00000000-0000-4000-8000-00000000f001', '#6D4C41', 'paid', 60, true),
  ('00000000-0000-4000-8000-00000000e107', 'UL', 'Unpaid Leave', 'unpaid', null, false, 'working_days', 'no_entitlement', false,
    'all', 'any', 0, true, true, 'not_required', 0, 3, null, null, null, null, 12, null, false, '00000000-0000-4000-8000-00000000f001', '#546E7A', 'unpaid_deduct', 70, true),
  ('00000000-0000-4000-8000-00000000e108', 'RL', 'Replacement Leave', 'replacement', 'Earned by working on a rest day, off day or public holiday.', true, 'working_days', 'earned_credits', false,
    'all', 'any', 0, true, true, 'not_required', 0, 3, null, null, null, null, null, null, false, '00000000-0000-4000-8000-00000000f001', '#00897B', 'paid', 80, true),
  ('00000000-0000-4000-8000-00000000e109', 'MRL', 'Marriage Leave', 'marriage', 'Once per employment (Q7 — activate if the policy exists).', true, 'working_days', 'no_entitlement', false,
    'all', 'any', 0, false, true, 'always', 0, 3, 3, 1, 'per_employment', null, null, null, false, '00000000-0000-4000-8000-00000000f001', '#FDD835', 'paid', 90, false),
  ('00000000-0000-4000-8000-00000000e110', 'EXL', 'Study / Exam Leave', 'study_exam', '1 day per exam paper, max 5 a year (Q7 — activate if the policy exists).', true, 'working_days', 'no_entitlement', false,
    'all', 'any', 0, false, true, 'always', 0, 3, null, null, null, null, 5, null, false, '00000000-0000-4000-8000-00000000f001', '#7CB342', 'paid', 100, false),
  ('00000000-0000-4000-8000-00000000e111', 'EL', 'Emergency Leave', 'emergency', 'Deducted from Annual Leave (PRET uses the EMERGENCY flag instead — LP10).', true, 'working_days', 'no_entitlement', false,
    'all', 'any', 0, true, true, 'not_required', 0, 3, null, null, null, null, null, '00000000-0000-4000-8000-00000000e101', false, '00000000-0000-4000-8000-00000000f001', '#F4511E', 'paid', 110, false);
-- Replacement credits follow "Direct Manager only" (RC7, Q16)
update app.leave_types set workflow_id = '00000000-0000-4000-8000-00000000f002' where code = 'RL';
-- Hospitalisation pooled with Sick (BR-LV-31)
update app.leave_types set pool_with_type_id = '00000000-0000-4000-8000-00000000e102', pool_cap_days = 60 where code = 'HL';

insert into app.leave_entitlement_bands (leave_type_id, effective_year, service_from_years, service_to_years, days_per_year) values
  ('00000000-0000-4000-8000-00000000e101', 2026, 0, 2, 12), ('00000000-0000-4000-8000-00000000e101', 2026, 2, 5, 12), ('00000000-0000-4000-8000-00000000e101', 2026, 5, null, 16),
  ('00000000-0000-4000-8000-00000000e102', 2026, 0, 2, 14), ('00000000-0000-4000-8000-00000000e102', 2026, 2, 5, 18), ('00000000-0000-4000-8000-00000000e102', 2026, 5, null, 22),
  ('00000000-0000-4000-8000-00000000e103', 2026, 0, null, 60),
  ('00000000-0000-4000-8000-00000000e106', 2026, 0, null, 5);

insert into app.leave_policy (id, emergency_leave_type_ids) values (1, array['00000000-0000-4000-8000-00000000e101'::uuid]);
