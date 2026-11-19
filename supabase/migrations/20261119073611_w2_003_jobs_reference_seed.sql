-- PRET W2-003 · 04 — daily employee job (pg_cron, free tier) + reference lookups (banks, LHDN branches).
-- Design: FR-EMP-07 (future-dated job changes at 00:00 MYT), §5.6 (status by date), §5.8 (CRs applied on their
-- effective date), F-ADM-06 / US-ADMIN-006 (leavers' access ends), N-44/N-45/N-46/N-49 reminders; ADR-0009
-- (app.job_runs idempotency). D27: pg_cron is part of the Supabase free plan — no Vercel cron is needed for
-- this job (the scheduled-invite email sender is a server job — see the W2-003 backend report).

-- ===========================================================================
-- The daily job. Idempotent per business date (ux_job_run_success); each step isolated so one failure
-- does not block the others; the summary goes to app.job_runs.
-- ===========================================================================
create or replace function app.run_employee_daily_job(p_force boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := app.today_myt();
  v_run uuid;
  v_summary jsonb := '{}'::jsonb;
  v_errors text[] := '{}';
  v_n int;
  r record;
begin
  if app.current_app_user_id() is not null and not app.is_sa() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if not p_force and exists (select 1 from app.job_runs j where j.job_name = 'employee-daily' and j.business_date = v_today and j.status = 'succeeded') then
    return jsonb_build_object('skipped', true, 'business_date', v_today);
  end if;
  perform set_config('app.actor_label', 'system:employee-daily', true);
  insert into app.job_runs (job_name, business_date, status) values ('employee-daily', v_today, 'running') returning id into v_run;

  -- 1. Future-dated job changes become current (FR-EMP-07) — every employee, ≤ 200 (NFR-01)
  v_n := 0;
  for r in select e.id from app.employees e where e.status <> 'withdrawn' loop
    begin
      perform app.apply_current_job(r.id); v_n := v_n + 1;
    exception when others then v_errors := v_errors || ('job ' || r.id::text || ': ' || left(sqlerrm, 200));
    end;
  end loop;
  v_summary := v_summary || jsonb_build_object('jobs_applied', v_n);

  -- 2. Status by date (§5.6): Pending Join → On Probation/Confirmed; Notice Period → Separated; confirmation dates
  v_n := 0;
  for r in select e.id, e.status from app.employees e loop
    begin
      if app.refresh_employee_status(r.id) is distinct from r.status then v_n := v_n + 1; end if;
    exception when others then v_errors := v_errors || ('status ' || r.id::text || ': ' || left(sqlerrm, 200));
    end;
  end loop;
  v_summary := v_summary || jsonb_build_object('status_changes', v_n);

  -- 3. Approved change requests whose effective date has arrived (§5.8)
  v_n := 0;
  for r in select c.id from app.change_requests c where c.status = 'approved' and c.applied_at is null and c.effective_date <= v_today loop
    begin
      perform app.apply_change_request(r.id); v_n := v_n + 1;
    exception when others then v_errors := v_errors || ('cr ' || r.id::text || ': ' || left(sqlerrm, 200));
    end;
  end loop;
  v_summary := v_summary || jsonb_build_object('change_requests_applied', v_n);

  -- 4. Bank rows superseded by a newer row now in force
  update app.employee_bank_accounts b set is_superseded = true
   where not b.is_superseded
     and exists (select 1 from app.employee_bank_accounts n where n.employee_id = b.employee_id and n.id <> b.id
                    and n.effective_from > b.effective_from and n.effective_from <= v_today);

  -- 5. F-ADM-06: leavers' portal access ends (access_end_date already stops sign-in after G7; the user is Disabled)
  v_n := 0;
  for r in select u.id from app.app_users u
             join app.employee_separations s on s.employee_id = u.employee_id and not s.is_withdrawn and not s.superseded_by_rehire
             join app.employee_separation_details d on d.separation_id = s.id
            where u.user_type = 'employee' and u.status in ('active','invited','locked') and d.portal_access_end_date < v_today loop
    begin
      update app.app_users u set status = 'disabled', disabled_reason = 'Left the company (portal access ended)', invite_scheduled_for = null
       where u.id = r.id;
      v_n := v_n + 1;
    exception when others then v_errors := v_errors || ('disable ' || r.id::text || ': ' || left(sqlerrm, 200));
    end;
  end loop;
  v_summary := v_summary || jsonb_build_object('users_disabled', v_n);

  -- 6. Reminders
  begin
    -- N-44 probation ending in 14 days → manager + ADM
    for r in select e.id, e.employee_no, coalesce(e.preferred_name, e.full_name) as name, e.manager_employee_id,
                    coalesce(e.extended_probation_end_date, e.probation_end_date) as pend
               from app.employees e
              where e.status = 'on_probation' and coalesce(e.extended_probation_end_date, e.probation_end_date) = v_today + 14 loop
      perform app.notify_role_holders(array['ADM']::app.privileged_role[], 'N-44', 'Probation ending for ' || r.employee_no,
                'Probation ends on ' || to_char(r.pend, 'DD/MM/YYYY'), '/employees/' || r.employee_no, true, 'probation_ending',
                jsonb_build_object('employee_no', r.employee_no, 'probation_end', to_char(r.pend, 'DD/MM/YYYY')), null);
      if app.employee_user_id(r.manager_employee_id) is not null then
        perform app.notify(app.employee_user_id(r.manager_employee_id), 'N-44', left('Probation ending for ' || r.name, 150),
                  'Probation ends on ' || to_char(r.pend, 'DD/MM/YYYY') || ' — record your recommendation', '/team/' || r.employee_no, true,
                  'probation_ending', jsonb_build_object('employee_no', r.employee_no, 'probation_end', to_char(r.pend, 'DD/MM/YYYY')));
      end if;
    end loop;
    -- N-45 retirement age within 6 months (sent once, exactly 6 months ahead) → ADM in-app
    for r in select e.employee_no, p.retirement_date from app.employees e join app.employee_personal p on p.employee_id = e.id
              where e.status in ('on_probation','confirmed','notice_period') and p.retirement_date = (v_today + interval '6 months')::date loop
      perform app.notify_role_holders(array['ADM']::app.privileged_role[], 'N-45', 'Retirement age in 6 months: ' || r.employee_no,
                'Retirement date ' || to_char(r.retirement_date, 'DD/MM/YYYY'), '/employees/' || r.employee_no, false, null, null, null);
    end loop;
    -- N-46 document expiring in 30 days → ADM; passport expiring in 30 days → ADM + the employee
    for r in select e.employee_no, d.title, d.expiry_date from app.employee_documents d join app.employees e on e.id = d.employee_id
              where d.is_active and d.expiry_date = v_today + 30 and e.status in ('pending_join','on_probation','confirmed','notice_period') loop
      perform app.notify_role_holders(array['ADM']::app.privileged_role[], 'N-46', left('Document expiring: ' || r.title, 150),
                r.employee_no || ' · expires ' || to_char(r.expiry_date, 'DD/MM/YYYY'), '/employees/' || r.employee_no || '?tab=documents', false,
                'document_expiring', jsonb_build_object('employee_no', r.employee_no, 'expiry_date', to_char(r.expiry_date, 'DD/MM/YYYY')), null);
    end loop;
    for r in select e.id, e.employee_no, p.passport_expiry from app.employees e join app.employee_personal p on p.employee_id = e.id
              where p.passport_expiry = v_today + 30 and e.status in ('on_probation','confirmed','notice_period') loop
      perform app.notify_role_holders(array['ADM']::app.privileged_role[], 'N-46', 'Passport expiring: ' || r.employee_no,
                'Expires ' || to_char(r.passport_expiry, 'DD/MM/YYYY'), '/employees/' || r.employee_no, false, 'document_expiring',
                jsonb_build_object('employee_no', r.employee_no, 'expiry_date', to_char(r.passport_expiry, 'DD/MM/YYYY')), null);
      if app.employee_user_id(r.id) is not null then
        perform app.notify(app.employee_user_id(r.id), 'N-46', 'Your passport expires in 30 days', 'Expires ' || to_char(r.passport_expiry, 'DD/MM/YYYY'),
                  '/my/profile', false, 'passport_expiring', jsonb_build_object('expiry_date', to_char(r.passport_expiry, 'DD/MM/YYYY')));
      end if;
    end loop;
    -- N-49 reportees without an active manager (EC-EMP-04) — once, on the day the manager became Separated
    for r in select m.employee_no as mgr_no, count(*)::int as n
               from app.employees e join app.employees m on m.id = e.manager_employee_id
              where e.status in ('pending_join','on_probation','confirmed','notice_period') and m.status = 'separated'
                and exists (select 1 from app.employee_separations s where s.employee_id = m.id and not s.is_withdrawn
                               and not s.superseded_by_rehire and s.last_working_day = v_today - 1)
              group by m.employee_no loop
      perform app.notify_role_holders(array['ADM']::app.privileged_role[], 'N-49',
                r.n || ' reportee(s) without an active manager', 'Former manager ' || r.mgr_no || ' has left — reassign the reporting line.',
                '/organisation/reporting-lines', true, null, null, null);
    end loop;
  exception when others then v_errors := v_errors || ('reminders: ' || left(sqlerrm, 200));
  end;

  -- 7. Derived caches
  perform app.rebuild_reporting_closure();
  perform app.refresh_directory(null);

  v_summary := v_summary || jsonb_build_object('errors', to_jsonb(v_errors));
  update app.job_runs j set status = case when cardinality(v_errors) = 0 then 'succeeded' else 'failed' end::app.job_status,
         finished_at = now(), summary = v_summary, error = case when cardinality(v_errors) = 0 then null else left(array_to_string(v_errors, '; '), 2000) end
   where j.id = v_run;
  return v_summary;
end $$;

revoke execute on function app.run_employee_daily_job(boolean) from public, anon, authenticated, service_role;
grant execute on function app.run_employee_daily_job(boolean) to service_role;

-- ===========================================================================
-- Schedule: 00:05 MYT daily (16:05 UTC) — Supabase pg_cron (free plan)
-- ===========================================================================
create extension if not exists pg_cron;
select cron.schedule('pret-employee-daily', '5 16 * * *', $cron$select app.run_employee_daily_job(false)$cron$);

-- ===========================================================================
-- Reference lookups (production data, not personal). Codes and BICs to verify against the HLB Connect
-- First bank list (Q46) — BIC left blank until verified; LHDN branches as generic state labels (verify).
-- ===========================================================================
insert into app.banks (code, name) values
  ('AFFIN', 'Affin Bank Berhad'), ('AGRO', 'Agrobank'), ('ALLIANCE', 'Alliance Bank Malaysia Berhad'),
  ('ALRAJHI', 'Al Rajhi Banking & Investment Corporation (Malaysia) Berhad'), ('AMBANK', 'AmBank (M) Berhad'),
  ('BIMB', 'Bank Islam Malaysia Berhad'), ('BKRM', 'Bank Kerjasama Rakyat Malaysia Berhad'), ('MUAMALAT', 'Bank Muamalat Malaysia Berhad'),
  ('BSN', 'Bank Simpanan Nasional'), ('CIMB', 'CIMB Bank Berhad'), ('CITI', 'Citibank Berhad'), ('HLB', 'Hong Leong Bank Berhad'),
  ('HSBC', 'HSBC Bank Malaysia Berhad'), ('KFH', 'Kuwait Finance House (Malaysia) Berhad'), ('MBB', 'Malayan Banking Berhad (Maybank)'),
  ('MBSB', 'MBSB Bank Berhad'), ('OCBC', 'OCBC Bank (Malaysia) Berhad'), ('PBB', 'Public Bank Berhad'), ('RHB', 'RHB Bank Berhad'),
  ('SCB', 'Standard Chartered Bank Malaysia Berhad'), ('UOB', 'United Overseas Bank (Malaysia) Bhd')
on conflict (code) do nothing;

insert into app.lhdn_branches (code, name) values
  ('JHR', 'LHDN branch — Johor'), ('KDH', 'LHDN branch — Kedah'), ('KTN', 'LHDN branch — Kelantan'), ('MLK', 'LHDN branch — Melaka'),
  ('NSN', 'LHDN branch — Negeri Sembilan'), ('PHG', 'LHDN branch — Pahang'), ('PNG', 'LHDN branch — Pulau Pinang'),
  ('PRK', 'LHDN branch — Perak'), ('PLS', 'LHDN branch — Perlis'), ('SBH', 'LHDN branch — Sabah'), ('SWK', 'LHDN branch — Sarawak'),
  ('SGR', 'LHDN branch — Selangor'), ('TRG', 'LHDN branch — Terengganu'), ('KUL', 'LHDN branch — Kuala Lumpur'),
  ('LBN', 'LHDN branch — Labuan'), ('PJY', 'LHDN branch — Putrajaya')
on conflict (code) do nothing;
