-- PRET W2-006 · 01 — M4 portal: download my data (F-PRT-16), notification centre read/unread (F-PRT-13),
-- notification preferences guard (F-NTF-06 / BR-NTF-04), password-change security event (F-PRT-14).
-- Design: data-model §10 (export_jobs, notifications, notification_preferences), rls-policies §5.7 / §9
-- ("my-data export: requester only"), ADR-0011 (exports), ADR-0014 (auth). Definer functions pin search_path = ''
-- and re-check the caller; RLS enabled and forced on the new table.

-- ===========================================================================
-- Security events: password changed by the user (G6) — login_events outcome + session end reason
-- ===========================================================================
alter type app.login_outcome add value if not exists 'password_changed';

alter table app.app_sessions drop constraint if exists app_sessions_end_reason_check;
alter table app.app_sessions add constraint app_sessions_end_reason_check
  check (end_reason in ('logout','idle_timeout','disabled','expired','role_change','password_reset','mfa_reset','password_change'));

-- ===========================================================================
-- P20 Download my data — export_jobs (data-model §10) + availability window
-- ===========================================================================
create table app.export_jobs (                                                        -- async/sync generation register (F-PRT-16; bulk jobs later)
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references app.app_users(id),
  kind app.output_kind not null,
  params jsonb not null default '{}'::jsonb,
  employee_id uuid references app.employees(id),                                      -- whose data (my-data export: the requester's own record)
  status app.job_status not null default 'running',                                   -- running = "Preparing"
  attempts smallint not null default 0,
  result_export_file_id uuid references app.export_files(id),
  error text check (char_length(error) <= 300),
  expires_at timestamptz,                                                             -- "Available until" (my-data export: finished + 7 days)
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint chk_export_job_result check (status <> 'succeeded' or (result_export_file_id is not null and finished_at is not null))
);
create index ix_export_jobs_requester on app.export_jobs (requested_by, created_at desc);
create index ix_export_jobs_employee on app.export_jobs (employee_id);
create index ix_export_jobs_result on app.export_jobs (result_export_file_id);

alter table app.export_jobs enable row level security;
alter table app.export_jobs force row level security;
grant select on app.export_jobs to authenticated;
grant all on app.export_jobs to service_role;
-- own · P-HR (rls §5.7). Writes only through the definer functions below (no insert/update grant).
create policy export_jobs_select on app.export_jobs for select to authenticated
  using (requested_by = (select app.current_app_user_id()) or (select app.is_admin()));

create trigger tg_audit after insert or update or delete on app.export_jobs for each row execute function audit.tg_log_change();

-- Start: the caller's own record only; one at a time; ≤ 3 per Malaysian day. The generation itself is access-logged
-- here (same transaction) — the server decrypts the employee's own identifiers only after this row exists.
create or replace function app.start_my_data_export() returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := app.current_app_user_id();
  v_emp uuid := app.current_employee_id();
  v_no text;
  v_id uuid;
begin
  if v_me is null or v_emp is null then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mydata:' || v_me::text, 0));
  -- a run that never finished (server crash / timeout) is closed after 15 minutes
  update app.export_jobs j set status = 'failed', finished_at = now(), error = 'The file could not be prepared. Please try again.'
   where j.requested_by = v_me and j.kind = 'my_data_export' and j.status = 'running' and j.created_at < now() - interval '15 minutes';
  if exists (select 1 from app.export_jobs j where j.requested_by = v_me and j.kind = 'my_data_export' and j.status = 'running') then
    raise exception 'PRET-EXPORT-BUSY: a file is already being prepared' using errcode = '23514';
  end if;
  if (select count(*) from app.export_jobs j where j.requested_by = v_me and j.kind = 'my_data_export'
         and (j.created_at at time zone 'Asia/Kuala_Lumpur')::date = app.today_myt()) >= 3 then
    raise exception 'PRET-EXPORT-LIMIT: you can generate up to 3 files a day' using errcode = '23514';
  end if;
  select e.employee_no into v_no from app.employees e where e.id = v_emp;
  insert into app.export_jobs (requested_by, kind, params, employee_id, status, attempts)
  values (v_me, 'my_data_export', jsonb_build_object('format', 'zip:json+pdf'), v_emp, 'running', 1)
  returning id into v_id;
  perform audit.write_access('export'::app.audit_action, 'my_data_export', v_id, array[v_emp],
    array['profile','family','emergency_contacts','bank','documents','leave','claims','change_requests'],
    array['identity','contact','family','religion','health','bank','statutory']::app.data_category[],
    'Download my data (F-PRT-16) — generation', v_no, null, null, null);
  return v_id;
end $$;

-- Finish: register the stored file (own, generated_output, confirmed) as an export_files row and mark Ready.
create or replace function app.finish_my_data_export(p_job_id uuid, p_file_id uuid, p_row_count int, p_sha256 text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_me uuid := app.current_app_user_id();
  v_job app.export_jobs%rowtype;
  v_x uuid;
begin
  select * into v_job from app.export_jobs j where j.id = p_job_id for update;
  if not found or v_job.requested_by is distinct from v_me or v_job.kind <> 'my_data_export' then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  if v_job.status <> 'running' then raise exception 'PRET-EXPORT-STATE' using errcode = '23514'; end if;
  if not exists (select 1 from app.files f where f.id = p_file_id and f.status = 'active' and f.subject = 'generated_output'
                   and f.created_by = v_me and f.owner_employee_id = v_job.employee_id) then
    raise exception 'PRET-FILE-MISSING' using errcode = '23514';
  end if;
  insert into app.export_files (kind, subject_type, subject_id, version, file_id, row_count, checksum, generated_by)
  values ('my_data_export', 'employee', v_job.employee_id,
          coalesce((select max(x.version) from app.export_files x where x.kind = 'my_data_export' and x.subject_type = 'employee'
                     and x.subject_id = v_job.employee_id), 0) + 1,
          p_file_id, p_row_count, decode(nullif(p_sha256, ''), 'hex'), v_me)
  returning id into v_x;
  update app.export_jobs j set status = 'succeeded', result_export_file_id = v_x, finished_at = now(), expires_at = now() + interval '7 days'
   where j.id = p_job_id;
  return v_x;
end $$;

create or replace function app.fail_my_data_export(p_job_id uuid, p_error text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update app.export_jobs j set status = 'failed', finished_at = now(), error = left(coalesce(nullif(p_error, ''), 'The file could not be prepared.'), 300)
   where j.id = p_job_id and j.requested_by = app.current_app_user_id() and j.kind = 'my_data_export' and j.status = 'running';
end $$;

-- A my-data export file is readable by its requester only (not ADM/SA — rls §9), and only while it is available.
create or replace function app.is_my_data_export_file(p_file_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.export_files x where x.file_id = p_file_id and x.kind = 'my_data_export')
$$;

create or replace function app.can_read_file(p_file_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.files f
     where f.id = p_file_id and f.status = 'active'
       and (   (f.subject in ('employee_photo','privacy_notice','company_asset') and app.is_active_user())
            or (app.is_admin() and not (f.subject = 'generated_output' and app.is_my_data_export_file(f.id)))
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
                and f.created_by = app.current_app_user_id()
                and (not app.is_my_data_export_file(f.id)
                     or exists (select 1 from app.export_jobs j join app.export_files x on x.id = j.result_export_file_id
                                 where x.file_id = f.id and j.requested_by = app.current_app_user_id()
                                   and j.status = 'succeeded' and j.expires_at > now())))))
$$;

-- ===========================================================================
-- G5 Notifications: the recipient may mark a notification unread again (row ⋮ Mark unread); read time is server-set
-- ===========================================================================
create or replace function app.tg_notifications_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.read_at is null then
    return new;                                   -- mark unread
  elsif old.read_at is not null then
    new.read_at := old.read_at;                   -- already read: keep the original time
  else
    new.read_at := now();                         -- never a client-chosen time
  end if;
  return new;
end $$;

-- ===========================================================================
-- G6 Notification preferences (F-NTF-06, BR-NTF-04): action-required and security emails cannot be switched off.
-- Must equal MANDATORY_EMAIL_EVENT_CODES in src/server/contracts/portal.ts (tested).
-- ===========================================================================
create or replace function app.notification_email_mandatory() returns text[]
language sql immutable set search_path = '' as $$
  select array['N-01','N-05','N-11','N-14','N-15','N-16','N-20','N-26','N-41','N-43','N-52','N-53','N-54','N-57']::text[]
$$;

create or replace function app.tg_notification_preferences_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not new.email_enabled and new.event_code = any(app.notification_email_mandatory()) then
    raise exception 'PRET-NTF-MANDATORY: this notification is required and cannot be switched off' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger tg_10_guard before insert or update on app.notification_preferences
  for each row execute function app.tg_notification_preferences_guard();
-- (no stored opt-outs exist for mandatory codes; clear any defensively)
delete from app.notification_preferences where not email_enabled and event_code = any(app.notification_email_mandatory());

-- ===========================================================================
-- Function privileges
-- ===========================================================================
revoke execute on function app.start_my_data_export(), app.finish_my_data_export(uuid, uuid, int, text), app.fail_my_data_export(uuid, text),
  app.is_my_data_export_file(uuid), app.notification_email_mandatory(), app.tg_notification_preferences_guard()
  from public, anon, authenticated, service_role;
grant execute on function app.start_my_data_export(), app.finish_my_data_export(uuid, uuid, int, text), app.fail_my_data_export(uuid, text),
  app.is_my_data_export_file(uuid), app.notification_email_mandatory()
  to authenticated;
grant execute on function app.is_my_data_export_file(uuid), app.notification_email_mandatory() to service_role;
