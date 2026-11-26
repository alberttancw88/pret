-- PRET W2-007 · 01 — M7 reports & exports (F-RPT-02/13/21) and M8 notifications (F-NTF-01/03/04/05/07).
-- Design: data-model §10 (notification_templates, email_outbox), §11 (job_runs), rls-policies §5.7 / §8 / §11,
-- ADR-0009 (scheduled jobs), ADR-0010 (outbox, PDPA-safe templates), ADR-0011 (exports). Definer functions pin
-- search_path = '' and re-check the caller; RLS enabled and forced on every new table.

-- ===========================================================================
-- F-NTF-05 / A16 — SA overrides of the fixed templates (templates themselves live in code)
-- ===========================================================================
create table app.notification_templates (
  template_code text primary key check (template_code ~ '^[a-z][a-z0-9_]{2,59}$'),
  subject_override text check (char_length(subject_override) between 3 and 150),
  body_override text check (char_length(body_override) between 10 and 2000),
  updated_by uuid references app.app_users(id),
  updated_at timestamptz not null default now(),
  -- F-NTF-08: no placeholder for NRIC, bank account, salary or diagnosis can ever be stored
  constraint chk_template_no_sensitive_placeholder check (
    coalesce(subject_override, '') || ' ' || coalesce(body_override, '')
      !~* '\{\s*(nric|mykad|ic|ic_no|passport|bank|bank_account|account|account_no|salary|net_pay|gross_pay|pay|diagnosis|religion|spouse|child|children)\s*\}')
);
create index ix_notification_templates_updated_by on app.notification_templates (updated_by);

alter table app.notification_templates enable row level security;
alter table app.notification_templates force row level security;
grant select, insert, update, delete on app.notification_templates to authenticated;
create policy notification_templates_select on app.notification_templates for select to authenticated
  using ((select app.is_admin()));
create policy notification_templates_insert on app.notification_templates for insert to authenticated
  with check ((select app.is_sa()));
create policy notification_templates_update on app.notification_templates for update to authenticated
  using ((select app.is_sa())) with check ((select app.is_sa()));
create policy notification_templates_delete on app.notification_templates for delete to authenticated
  using ((select app.is_sa()));

create or replace function app.tg_notification_templates_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := app.current_app_user_id();
  new.updated_at := now();
  return new;
end $$;
create trigger tg_05_stamp before insert or update on app.notification_templates
  for each row execute function app.tg_notification_templates_stamp();
create trigger tg_audit after insert or update or delete on app.notification_templates
  for each row execute function audit.tg_log_change();

-- ===========================================================================
-- F-NTF-07 / A15 — notification log (email outbox + in-app rows), ADM / SA only, content summary only
-- In-app rows stay unreadable to other users through app.notifications RLS (W2-006); this definer returns
-- the summary columns for the log only.
-- ===========================================================================
create or replace function app.email_delivery_status(p_status app.email_status, p_attempts int) returns text
language sql immutable set search_path = '' as $$
  select case p_status
           when 'pending' then 'queued'
           when 'sending' then 'sending'
           when 'sent' then 'sent'
           when 'suppressed' then 'suppressed'
           when 'failed' then case when p_attempts >= 5 then 'failed' else 'retrying' end
         end
$$;

create or replace function app.notification_log(p_q text, p_events text[], p_channels text[], p_statuses text[],
                                                p_from date, p_to date, p_sort text, p_dir text, p_limit int, p_offset int)
returns table (id uuid, channel text, at timestamptz, created_at timestamptz, event_code text, template_code text,
               recipient_name text, recipient_email text, status text, attempts int, status_detail text,
               summary text, link text, total_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  if not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  return query
  with rows as (
    select o.id, 'email'::text as channel, coalesce(o.sent_at, o.created_at) as at, o.created_at,
           coalesce(n.event_code, case o.template_code when 'bank_details_changed' then 'N-41' end) as event_code,
           o.template_code, u.display_name as recipient_name, o.to_address::text as recipient_email,
           app.email_delivery_status(o.status, o.attempts) as status, o.attempts::int as attempts,
           left(o.last_error, 200) as status_detail, o.subject as summary, n.link_path as link
      from app.email_outbox o
      left join app.notifications n on n.id = o.notification_id
      left join app.app_users u on u.id = o.to_user_id
     where p_channels is null or 'email' = any(p_channels)
    union all
    select n.id, 'in_app', n.created_at, n.created_at, n.event_code, null, u.display_name, u.login_email::text,
           case when n.read_at is null then 'delivered' else 'read' end, 1, null, n.title, n.link_path
      from app.notifications n
      join app.app_users u on u.id = n.recipient_user_id
     where p_channels is null or 'in_app' = any(p_channels)
  ), f as (
    select r.* from rows r
     where (p_events is null or r.event_code = any(p_events))
       and (p_statuses is null or r.status = any(p_statuses))
       and (p_from is null or (r.at at time zone 'Asia/Kuala_Lumpur')::date >= p_from)
       and (p_to is null or (r.at at time zone 'Asia/Kuala_Lumpur')::date <= p_to)
       and (v_q is null or r.recipient_name ilike '%' || v_q || '%' or r.recipient_email ilike '%' || v_q || '%'
            or r.summary ilike '%' || v_q || '%' or coalesce(r.link, '') ilike '%' || v_q || '%')
  )
  select f.id, f.channel, f.at, f.created_at, f.event_code, f.template_code, f.recipient_name, f.recipient_email, f.status,
         f.attempts, f.status_detail, f.summary, f.link, count(*) over () as total_count
    from f
   order by
     case when p_dir = 'asc' then case p_sort when 'event' then f.event_code when 'recipient' then f.recipient_name when 'status' then f.status end end asc nulls last,
     case when p_dir <> 'asc' then case p_sort when 'event' then f.event_code when 'recipient' then f.recipient_name when 'status' then f.status end end desc nulls last,
     case when p_dir = 'asc' then f.at end asc,
     case when p_dir <> 'asc' then f.at end desc,
     f.id
   limit greatest(1, least(coalesce(p_limit, 25), 10000)) offset greatest(0, coalesce(p_offset, 0));
end $$;

create or replace function app.email_delivery_counts()
returns table (queued int, retrying int, failed int, sent_last_24h int, oldest_queued_at timestamptz, last_sent_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  return query
  select count(*) filter (where o.status in ('pending','sending'))::int,
         count(*) filter (where o.status = 'failed' and o.attempts < 5)::int,
         count(*) filter (where o.status = 'failed' and o.attempts >= 5)::int,
         count(*) filter (where o.status = 'sent' and o.sent_at > now() - interval '24 hours')::int,
         min(o.created_at) filter (where o.status in ('pending','sending')),
         max(o.sent_at)
    from app.email_outbox o;
end $$;

-- A15 RETRY: a Failed (or retrying) email goes back to the queue; the dispatcher sends it next.
create or replace function app.retry_email(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  update app.email_outbox o
     set status = 'pending', attempts = 0, next_attempt_at = now(),
         last_error = left('Retry requested by ' || coalesce(app.user_name(app.current_app_user_id()), 'an administrator'), 200)
   where o.id = p_id and o.status = 'failed';
  if not found then
    raise exception 'PRET-NTF-RETRY: only a failed email can be retried' using errcode = '23514';
  end if;
end $$;

-- ===========================================================================
-- F-RPT-02 Employee master — religion / OKU for the report (employee_sensitive is self-only under RLS).
-- One access-log row for the whole set (BR-ADM-21) BEFORE any value is returned.
-- ===========================================================================
create or replace function app.report_sensitive_rows(p_ids uuid[], p_reason text)
returns table (employee_id uuid, religion text, is_oku boolean)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  perform audit.write_access('view_sensitive'::app.audit_action, 'employee_sensitive', null, p_ids,
                             array['religion','is_oku'], array['religion','health']::app.data_category[],
                             coalesce(nullif(p_reason, ''), 'Employee master report (F-RPT-02)'), null, cardinality(p_ids), null, null);
  return query select s.employee_id, s.religion::text, s.is_oku from app.employee_sensitive s where s.employee_id = any(p_ids);
end $$;

-- ===========================================================================
-- F-RPT-21 Monthly payroll-input pack — export register ("Last exported …") and the unpaid-leave lines exported,
-- so cancellations after an export appear as "Reversal" lines in the next pack (EC-LV-14).
-- ===========================================================================
create table app.payroll_input_exports (
  id uuid primary key default gen_random_uuid(),
  payroll_month date not null check (extract(day from payroll_month) = 1),
  version int not null check (version >= 1),
  format text not null check (format in ('xlsx','csv')),
  sheet text check (sheet in ('joiners','leavers','job_changes','bank_changes','statutory_changes','unpaid_leave','rest_day_work')),
  row_counts jsonb not null default '{}'::jsonb,
  unpaid_lines jsonb not null default '[]'::jsonb,        -- [{application_id, ref_no, days}] — no personal data beyond ids
  exported_by uuid not null references app.app_users(id),
  exported_at timestamptz not null default now(),
  constraint ux_payroll_input_export_version unique (payroll_month, version)
);
create index ix_payroll_input_exports_by on app.payroll_input_exports (exported_by);

alter table app.payroll_input_exports enable row level security;
alter table app.payroll_input_exports force row level security;
grant select on app.payroll_input_exports to authenticated;
create policy payroll_input_exports_select on app.payroll_input_exports for select to authenticated
  using ((select app.is_admin()));
create trigger tg_audit after insert or update or delete on app.payroll_input_exports
  for each row execute function audit.tg_log_change();

create or replace function app.record_payroll_input_export(p_month date, p_format text, p_sheet text, p_counts jsonb, p_lines jsonb)
returns table (version int, exported_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date; v_ver int;
begin
  if not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('payroll-input:' || v_month::text));
  select coalesce(max(x.version), 0) + 1 into v_ver from app.payroll_input_exports x where x.payroll_month = v_month;
  return query
  insert into app.payroll_input_exports (payroll_month, version, format, sheet, row_counts, unpaid_lines, exported_by)
  values (v_month, v_ver, p_format, p_sheet, coalesce(p_counts, '{}'::jsonb), case when p_format = 'xlsx' or p_sheet = 'unpaid_leave' then coalesce(p_lines, '[]'::jsonb) else '[]'::jsonb end,
          app.current_app_user_id())
  returning payroll_input_exports.version, payroll_input_exports.exported_at;
end $$;

-- ===========================================================================
-- F-NTF-04 scheduled HR alerts not yet covered by the W2-003 / W2-004 nightly jobs, and outbox housekeeping:
--   N-54 External user's access ends in 30 and 7 days (SA, mandatory email)
--   N-58 Next-year PH calendar not published (from 01/11; ADM; at most once a week per user)
--   Outbox: never-sent rows older than 72 hours → suppressed ("Expired before delivery"); stuck "sending" → retry
-- Idempotent per MYT business date (job_runs), like run_employee_daily_job.
-- ===========================================================================
create or replace function app.run_notification_daily_job(p_force boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_today date := app.today_myt();
  v_year int := extract(year from app.today_myt())::int;
  v_run uuid;
  v_n54 int := 0; v_n58 int := 0; v_stale int := 0; v_stuck int := 0;
  r record;
begin
  if app.current_app_user_id() is not null and not app.is_sa() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if not p_force and exists (select 1 from app.job_runs j where j.job_name = 'notification-daily' and j.business_date = v_today and j.status = 'succeeded') then
    return jsonb_build_object('skipped', true, 'business_date', v_today);
  end if;
  perform set_config('app.actor_label', 'system:notification-daily', true);
  update app.job_runs j set status = 'running', attempt = j.attempt + 1, started_at = now(), finished_at = null, error = null
   where j.job_name = 'notification-daily' and j.business_date = v_today and j.status = 'succeeded'
  returning j.id into v_run;
  if v_run is null then
    insert into app.job_runs (job_name, business_date, status) values ('notification-daily', v_today, 'running') returning id into v_run;
  end if;

  -- N-54: external administrators whose access ends in exactly 30 or 7 days
  for r in select u.id, u.access_end_date, (u.access_end_date - v_today) as days
             from app.app_users u
            where u.user_type = 'external' and u.status = 'active' and u.access_end_date in (v_today + 30, v_today + 7)
  loop
    v_n54 := v_n54 + app.notify_role_holders(array['SA']::app.privileged_role[], 'N-54',
              'External access ends in ' || r.days || ' days (' || to_char(r.access_end_date, 'DD/MM/YYYY') || ')',
              'Extend or let the external administrator''s access end.', '/users/' || r.id::text, true,
              'external_access_ending', jsonb_build_object('end_date', to_char(r.access_end_date, 'DD/MM/YYYY'), 'days', r.days), null);
  end loop;

  -- N-58: from 01/11, next year's public-holiday calendar not yet published (weekly reminder per Admin)
  if v_today >= make_date(v_year, 11, 1) and not app.holiday_year_published(v_year + 1) then
    for r in select distinct u.id from app.user_roles ur join app.app_users u on u.id = ur.user_id
              where ur.role = 'ADM' and ur.revoked_at is null and u.status = 'active'
                and u.id <> '00000000-0000-0000-0000-000000000001'
                and not exists (select 1 from app.notifications n where n.recipient_user_id = u.id and n.event_code = 'N-58'
                                   and n.created_at > now() - interval '6 days')
    loop
      perform app.notify(r.id, 'N-58', 'Public-holiday calendar ' || (v_year + 1) || ' not published',
                         'Publish it by 31/12/' || v_year || ' so leave can be applied for ' || (v_year + 1) || '.',
                         '/organisation/holidays?year=' || (v_year + 1), false, 'ph_calendar_unpublished',
                         jsonb_build_object('year', v_year + 1, 'publish_by', '31/12/' || v_year));
      v_n58 := v_n58 + 1;
    end loop;
  end if;

  -- Outbox housekeeping (ADR-0010): stale never-sent rows are not sent late; stuck sends are retried
  update app.email_outbox o set status = 'suppressed', last_error = 'Expired before delivery (not sent within 72 hours)'
   where (o.status = 'pending' or (o.status = 'failed' and o.attempts < 5)) and o.created_at < now() - interval '72 hours';
  get diagnostics v_stale = row_count;
  update app.email_outbox o set status = 'failed', next_attempt_at = now(), last_error = 'Send interrupted — will retry'
   where o.status = 'sending' and o.next_attempt_at < now();
  get diagnostics v_stuck = row_count;

  update app.job_runs j set status = 'succeeded', finished_at = now(),
         summary = jsonb_build_object('n54', v_n54, 'n58', v_n58, 'outbox_expired', v_stale, 'outbox_requeued', v_stuck)
   where j.id = v_run;
  return jsonb_build_object('business_date', v_today, 'n54', v_n54, 'n58', v_n58, 'outbox_expired', v_stale, 'outbox_requeued', v_stuck);
end $$;

-- ===========================================================================
-- Function privileges
-- ===========================================================================
revoke execute on function app.email_delivery_status(app.email_status, int), app.notification_log(text, text[], text[], text[], date, date, text, text, int, int),
  app.email_delivery_counts(), app.retry_email(uuid), app.report_sensitive_rows(uuid[], text),
  app.record_payroll_input_export(date, text, text, jsonb, jsonb), app.run_notification_daily_job(boolean),
  app.tg_notification_templates_stamp()
  from public, anon, authenticated, service_role;
grant execute on function app.email_delivery_status(app.email_status, int), app.notification_log(text, text[], text[], text[], date, date, text, text, int, int),
  app.email_delivery_counts(), app.retry_email(uuid), app.report_sensitive_rows(uuid[], text),
  app.record_payroll_input_export(date, text, text, jsonb, jsonb), app.run_notification_daily_job(boolean)
  to authenticated;
grant execute on function app.email_delivery_status(app.email_status, int), app.run_notification_daily_job(boolean) to service_role;
grant select, insert, update, delete on app.notification_templates, app.payroll_input_exports to service_role;

-- Nightly at 00:20 MYT (after employee-daily 00:05 and leave-daily 00:10)
select cron.schedule('pret-notification-daily', '20 16 * * *', $cron$select app.run_notification_daily_job(false)$cron$);
