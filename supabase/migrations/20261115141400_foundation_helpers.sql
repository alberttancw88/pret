-- PRET W2-001 Foundation · 03 — RLS helper functions and foundation definer functions
-- Design: rls-policies.md §3 (helpers), §9 (storage), §10 (definer register); ADR-0001, ADR-0007,
-- ADR-0014, ADR-0015.
-- Rules: definer functions pin search_path = '', use fully-qualified names, take `p_` params,
-- answer questions only about the caller (auth.uid()), and re-check the caller.

-- ---------------------------------------------------------------------------
-- Time
-- ---------------------------------------------------------------------------
create or replace function app.today_myt() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date
$$;

-- ---------------------------------------------------------------------------
-- Caller identity (looked up live per statement — ADR-0001)
-- ---------------------------------------------------------------------------
-- The caller's app_users.id — NULL if not active or outside the access window (F-ADM-04/06, BR-ADM-05).
create or replace function app.current_app_user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id
    from app.app_users u
   where u.auth_user_id = auth.uid()
     and u.status = 'active'
     and u.access_start_date <= app.today_myt()
     and (u.access_end_date is null or u.access_end_date >= app.today_myt())
$$;

-- The caller's employee — NULL for external administrators (D11, BR-ADM-04).
create or replace function app.current_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.employee_id from app.app_users u
   where u.id = app.current_app_user_id() and u.user_type = 'employee'
$$;

create or replace function app.current_user_type() returns app.user_type
language sql stable security definer set search_path = '' as $$
  select u.user_type from app.app_users u where u.id = app.current_app_user_id()
$$;

create or replace function app.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.current_app_user_id() is not null
$$;

-- MFA assurance level of the verified JWT (set by withUserTx from JWKS-verified claims).
create or replace function app.current_aal() returns text
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1')
$$;

create or replace function app.mfa_required_privileged() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.mfa_required_privileged from app.security_settings s where s.id = 1), true)
$$;

-- Privileged roles require aal2 when the SA control setting is on (F-ADM-07, Q31).
create or replace function app.has_role(p_role app.privileged_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.user_roles r
                  where r.user_id = app.current_app_user_id() and r.role = p_role and r.revoked_at is null)
     and (not app.mfa_required_privileged() or app.current_aal() = 'aal2')
$$;

-- Role HELD regardless of MFA level — only for deciding "send this user to /mfa".
-- Never used in a policy (policy lint: rls-policies.md §12).
create or replace function app.holds_role(p_role app.privileged_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.user_roles r
                  where r.user_id = app.current_app_user_id() and r.role = p_role and r.revoked_at is null)
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$ select app.has_role('ADM') or app.has_role('SA') $$;

create or replace function app.is_sa() returns boolean
language sql stable security definer set search_path = '' as $$ select app.has_role('SA') $$;

create or replace function app.is_self(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_employee_id is not null and p_employee_id = app.current_employee_id()
$$;

-- MGR is derived (D11): direct + indirect reportees from the closure table.
create or replace function app.is_manager_of(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.reporting_closure c
                  where c.manager_employee_id = app.current_employee_id()
                    and c.employee_id = p_employee_id)
$$;

-- Caller has at least one reportee, or is an active delegate today (PRD §3 MGR).
create or replace function app.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.reporting_closure c where c.manager_employee_id = app.current_employee_id())
      or exists (select 1 from app.delegations d
                  where d.delegate_user_id = app.current_app_user_id()
                    and d.cancelled_at is null
                    and app.today_myt() between d.valid_from and d.valid_to)
$$;

-- Role codes of the caller for audit rows and the UI role chip: SA/ADM held (any aal), MGR derived, EMP implicit.
create or replace function app.current_role_codes() returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
           case when app.holds_role('SA')  then 'SA'  end,
           case when app.holds_role('ADM') then 'ADM' end,
           case when app.current_employee_id() is not null and app.is_manager() then 'MGR' end,
           case when app.current_employee_id() is not null then 'EMP' end
         ], null)
$$;

-- Fact about ANOTHER user used by app_users policies (ADM may manage only employee users
-- holding no privileged role — BR-ADM-01). Returns a boolean only; grants nothing.
create or replace function app.user_has_privileged_role(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.user_roles r where r.user_id = p_user_id and r.revoked_at is null)
$$;

-- Profile of the caller for the server's CurrentUser (src/server/auth/current-user.ts).
-- employee_no is NULL until W2-003 replaces this function to join app.employees.
create or replace function app.current_user_profile()
returns table (app_user_id uuid, display_name text, login_email text, user_type app.user_type,
               employee_id uuid, employee_no text, roles text[], aal text,
               mfa_required boolean, mfa_enrolled boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, u.display_name, u.login_email::text, u.user_type,
         case when u.user_type = 'employee' then u.employee_id end,
         null::text,
         app.current_role_codes(), app.current_aal(),
         app.mfa_required_privileged() and (app.holds_role('SA') or app.holds_role('ADM')),
         u.mfa_enrolled
    from app.app_users u
   where u.id = app.current_app_user_id()
$$;

-- ---------------------------------------------------------------------------
-- Sessions — idle timeout per role (F-ADM-14). Acts only on the caller's own session,
-- identified by the verified JWT's session_id claim (never a parameter).
-- ---------------------------------------------------------------------------
create or replace function app.touch_session(p_ip inet default null, p_user_agent text default null)
returns table (status text, idle_timeout_min int)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_user    uuid := app.current_app_user_id();
  v_sid     uuid;
  v_aal     text := app.current_aal();
  v_priv    boolean;
  v_timeout int;
  s         app.app_sessions%rowtype;
begin
  if v_user is null then
    return query select 'inactive'::text, 0; return;
  end if;
  begin
    v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then v_sid := null;
  end;
  if v_sid is null then
    return query select 'no_session'::text, 0; return;
  end if;

  v_priv := exists (select 1 from app.user_roles r where r.user_id = v_user and r.revoked_at is null);
  select case when v_priv then st.idle_timeout_min_privileged else st.idle_timeout_min_employee end
    into v_timeout from app.security_settings st where st.id = 1;
  v_timeout := coalesce(v_timeout, case when v_priv then 15 else 30 end);

  select * into s from app.app_sessions a where a.session_id = v_sid for update;
  if not found then
    insert into app.app_sessions (session_id, user_id, aal, ip, user_agent)
    values (v_sid, v_user, v_aal, p_ip, left(p_user_agent, 500));
    return query select 'ok'::text, v_timeout; return;
  end if;
  if s.user_id <> v_user then
    raise exception 'PRET-AUTH-SESSION' using errcode = '42501';
  end if;
  if s.ended_at is not null then
    return query select 'ended'::text, v_timeout; return;
  end if;
  if s.last_seen_at < now() - make_interval(mins => v_timeout) then
    update app.app_sessions a set ended_at = now(), end_reason = 'idle_timeout' where a.session_id = v_sid;
    return query select 'idle_timeout'::text, v_timeout; return;
  end if;
  if s.last_seen_at < now() - interval '30 seconds' or s.aal is distinct from v_aal then
    update app.app_sessions a
       set last_seen_at = now(), aal = v_aal,
           ip = coalesce(p_ip, a.ip), user_agent = coalesce(left(p_user_agent, 500), a.user_agent)
     where a.session_id = v_sid;
  end if;
  return query select 'ok'::text, v_timeout;
end $$;

-- Ends the caller's own current session (sign-out).
create or replace function app.end_my_session(p_reason text default 'logout') returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_sid uuid;
begin
  if p_reason not in ('logout','idle_timeout') then
    raise exception 'PRET-AUTH-REASON' using errcode = '22023';
  end if;
  begin
    v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then v_sid := null;
  end;
  update app.app_sessions a set ended_at = now(), end_reason = p_reason
   where a.session_id = v_sid and a.ended_at is null
     and a.user_id = (select u.id from app.app_users u where u.auth_user_id = auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- Invitations (ADR-0014) — token generated by the server; only its SHA-256 arrives here.
-- ---------------------------------------------------------------------------
create or replace function app.create_invitation(p_user_id uuid, p_token_hash bytea, p_expires_at timestamptz,
                                                 p_scheduled_send_at timestamptz default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id();
  v_target app.app_users%rowtype;
  v_hours int;
  v_id uuid;
begin
  select * into v_target from app.app_users u where u.id = p_user_id for update;
  if not found then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  if not (   app.is_sa()
          or (app.is_admin() and v_target.user_type = 'employee'
              and not app.user_has_privileged_role(v_target.id))) then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if v_target.id = v_actor then
    raise exception 'PRET-SELF-001' using errcode = '42501';
  end if;
  if v_target.status <> 'invited' or v_target.auth_user_id is not null then
    raise exception 'PRET-INV-STATE: user is not awaiting an invitation' using errcode = '23514';
  end if;
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'PRET-INV-TOKEN' using errcode = '22023';
  end if;
  select st.invite_link_hours into v_hours from app.security_settings st where st.id = 1;
  if p_expires_at <= now() or p_expires_at > coalesce(p_scheduled_send_at, now()) + make_interval(hours => coalesce(v_hours, 72)) + interval '1 minute' then
    raise exception 'PRET-INV-EXPIRY' using errcode = '22023';
  end if;

  update app.user_invitations i set revoked_at = now()
   where i.user_id = p_user_id and i.accepted_at is null and i.revoked_at is null;
  insert into app.user_invitations (user_id, token_hash, expires_at, scheduled_send_at, created_by)
  values (p_user_id, p_token_hash, p_expires_at, p_scheduled_send_at, v_actor)
  returning id into v_id;
  update app.app_users u set invited_by = v_actor, invited_at = now() where u.id = p_user_id;
  return v_id;
end $$;

create or replace function app.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid;
begin
  select i.user_id into v_user from app.user_invitations i where i.id = p_invitation_id for update;
  if v_user is null then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  if not (app.is_sa() or (app.is_admin() and not app.user_has_privileged_role(v_user)
                          and exists (select 1 from app.app_users u where u.id = v_user and u.user_type = 'employee'))) then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  update app.user_invitations i set revoked_at = now()
   where i.id = p_invitation_id and i.accepted_at is null and i.revoked_at is null;
end $$;

-- ---------------------------------------------------------------------------
-- Files (ADR-0007, rls-policies.md §9). Foundation rules; module work items extend
-- can_read_file() with subject-table rules (document visibility, manager/approver MC access).
-- ---------------------------------------------------------------------------
create or replace function app.can_upload_for(p_subject app.file_subject, p_owner_employee_id uuid,
                                              p_bucket text, p_path text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user()
     and p_path !~ '(^/|\.\.|//)'
     and case p_subject
       when 'employee_photo' then p_bucket = 'employee-files'
            and p_path like 'emp/' || p_owner_employee_id::text || '/photo/%'
            and (app.is_self(p_owner_employee_id) or app.is_admin())
       when 'employee_document' then p_bucket = 'employee-files'
            and p_path like 'emp/' || p_owner_employee_id::text || '/docs/%'
            and app.is_admin() and not app.is_self(p_owner_employee_id)
       when 'leave_attachment' then p_bucket = 'leave-files'
            and p_path like 'emp/' || p_owner_employee_id::text || '/leave/%'
            and (app.is_self(p_owner_employee_id) or app.is_admin())
       when 'claim_receipt' then p_bucket = 'claim-files'
            and p_path like 'emp/' || p_owner_employee_id::text || '/claims/%'
            and (app.is_self(p_owner_employee_id) or app.is_admin())
       when 'change_request_doc' then p_bucket = 'cr-files'
            and p_path like 'emp/' || p_owner_employee_id::text || '/cr/%'
            and app.is_self(p_owner_employee_id)
       when 'import_source' then p_bucket = 'imports' and p_path like 'imp/%'
            and p_owner_employee_id is null and app.is_admin()
       when 'company_asset' then p_bucket = 'company' and p_path like 'co/%'
            and p_owner_employee_id is null and app.is_admin()
       when 'privacy_notice' then p_bucket = 'company' and p_path like 'co/privacy/%'
            and p_owner_employee_id is null and app.is_admin()
       when 'generated_output' then p_bucket = 'generated' and (p_path like 'out/%' or p_path like 'payslips/%')
            and (app.is_admin() or (p_owner_employee_id is not null and app.is_self(p_owner_employee_id)))
       else false                                                              -- cp38_letter / tp1_doc: R1.1
     end
$$;

create or replace function app.can_read_file(p_file_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.files f
     where f.id = p_file_id and f.status = 'active'
       and (   (f.subject in ('employee_photo','privacy_notice','company_asset') and app.is_active_user())
            or app.is_admin()
            or (app.is_self(f.owner_employee_id)
                and f.subject in ('leave_attachment','claim_receipt','change_request_doc','tp1_doc','employee_photo'))
            or (f.subject = 'generated_output' and app.is_self(f.owner_employee_id)
                and f.created_by = app.current_app_user_id())))
$$;

-- Storage SELECT (signed-URL creation): photos/logo/privacy notice for any active user;
-- everything else needs a fresh, logged grant. The uploader may also read back their own
-- pending upload so the server can sniff magic bytes before confirm_upload (W2-001 addition).
create or replace function app.storage_read_allowed(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.files f
     where f.bucket = p_bucket and f.storage_path = p_name
       and (   (f.status = 'active'
                and (   (f.subject in ('employee_photo','privacy_notice','company_asset') and app.is_active_user())
                     or exists (select 1 from app.file_access_grants g
                                 where g.file_id = f.id and g.user_id = app.current_app_user_id() and g.expires_at > now())))
            or (f.status = 'pending_upload' and f.created_by = app.current_app_user_id() and f.upload_expires_at > now())))
$$;

-- Storage INSERT: only to a path the server pre-registered for this user (10-minute intent).
create or replace function app.storage_upload_allowed(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.files f
     where f.bucket = p_bucket and f.storage_path = p_name
       and f.status = 'pending_upload' and f.created_by = app.current_app_user_id()
       and f.upload_expires_at > now())
$$;

-- Flip an upload intent to active once the object exists. Size is taken from Storage (not the client).
create or replace function app.confirm_upload(p_file_id uuid, p_sha256 bytea) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_file app.files%rowtype;
  v_size bigint;
begin
  select * into v_file from app.files f where f.id = p_file_id for update;
  if not found or v_file.created_by is distinct from app.current_app_user_id() then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  if v_file.status <> 'pending_upload' then
    raise exception 'PRET-FILE-STATE' using errcode = '23514';
  end if;
  if v_file.upload_expires_at < now() - interval '5 minutes' then
    raise exception 'PRET-FILE-EXPIRED' using errcode = '23514';
  end if;
  select (o.metadata ->> 'size')::bigint into v_size
    from storage.objects o where o.bucket_id = v_file.bucket and o.name = v_file.storage_path;
  if v_size is null then
    raise exception 'PRET-FILE-MISSING' using errcode = '23514';
  end if;
  if v_size <= 0 or v_size > 10485760 then
    raise exception 'PRET-FILE-SIZE' using errcode = '23514';
  end if;
  if p_sha256 is null or octet_length(p_sha256) <> 32 then
    raise exception 'PRET-FILE-HASH' using errcode = '22023';
  end if;
  update app.files f
     set status = 'active', size_bytes = v_size, sha256 = p_sha256, upload_expires_at = null
   where f.id = p_file_id;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications (ADR-0010) — called by triggers, definer functions and jobs; not by users.
-- ---------------------------------------------------------------------------
create or replace function app.notify(p_recipient_user_id uuid, p_event_code text, p_title text,
                                      p_body text default null, p_link_path text default null,
                                      p_action_required boolean default false,
                                      p_email_template text default null, p_email_payload jsonb default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text;
  v_status app.user_status;
begin
  insert into app.notifications (recipient_user_id, event_code, title, body, link_path, is_action_required)
  values (p_recipient_user_id, p_event_code, p_title, p_body, p_link_path, p_action_required)
  returning id into v_id;

  if p_email_template is not null then
    select u.login_email::text, u.status into v_email, v_status from app.app_users u where u.id = p_recipient_user_id;
    if v_email is not null and v_status = 'active'
       and (p_action_required or not exists (
             select 1 from app.notification_preferences np
              where np.user_id = p_recipient_user_id and np.event_code = p_event_code and not np.email_enabled)) then
      insert into app.email_outbox (notification_id, to_user_id, to_address, template_code, subject, payload)
      values (v_id, p_recipient_user_id, v_email, p_email_template, left(p_title, 200), coalesce(p_email_payload, '{}'::jsonb));
    end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- private: reference numbers (ADR-0015), rate limits, bootstrap
-- ---------------------------------------------------------------------------
create or replace function private.next_doc_no(p_doc_type text, p_year int) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_no int; v_width int;
begin
  if p_doc_type not in ('LV','CL','PB','CR','RL','IM') then
    raise exception 'PRET-DOCNO-TYPE %', p_doc_type using errcode = '22023';
  end if;
  if p_year < 2000 or p_year > 2999 then
    raise exception 'PRET-DOCNO-YEAR' using errcode = '22023';
  end if;
  insert into private.doc_counters as c (doc_type, year, last_no) values (p_doc_type, p_year, 1)
  on conflict (doc_type, year) do update set last_no = c.last_no + 1
  returning c.last_no into v_no;
  v_width := case when p_doc_type in ('PB','IM') then 3 else 5 end;
  return p_doc_type || '-' || p_year::text || '-' ||
         case when length(v_no::text) >= v_width then v_no::text else lpad(v_no::text, v_width, '0') end;
end $$;

-- Fixed-window rate limiter for sign-in / reset / invite endpoints. Returns true when allowed.
create or replace function private.rate_limit_hit(p_bucket_key text, p_window_seconds int, p_max_hits int)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_window timestamptz; v_hits int;
begin
  if p_window_seconds <= 0 or p_max_hits <= 0 then
    raise exception 'PRET-RATE-ARGS' using errcode = '22023';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into private.rate_limit_counters as r (bucket_key, window_start, hits) values (p_bucket_key, v_window, 1)
  on conflict (bucket_key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_max_hits;
end $$;

-- First Super Admin (granted by the PRET System actor, since nobody may grant themselves — BR-ADM-03).
-- Works only while there is no active SA. Run by Albert (postgres) once per environment.
create or replace function private.bootstrap_super_admin(p_login_email text, p_display_name text,
                                                         p_employee_id uuid, p_auth_user_id uuid default null)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid;
begin
  if exists (select 1 from app.user_roles r join app.app_users u on u.id = r.user_id
              where r.role = 'SA' and r.revoked_at is null and u.status in ('active','invited')
                and u.id <> '00000000-0000-0000-0000-000000000001') then
    raise exception 'PRET-BOOTSTRAP: an active Super Admin already exists' using errcode = '42501';
  end if;
  insert into app.app_users (user_type, employee_id, login_email, display_name, status, access_start_date, auth_user_id)
  values ('employee', p_employee_id, p_login_email, p_display_name,
          case when p_auth_user_id is null then 'invited' else 'active' end::app.user_status,
          app.today_myt(), p_auth_user_id)
  on conflict (login_email) do update set auth_user_id = coalesce(excluded.auth_user_id, app.app_users.auth_user_id),
                                          status = excluded.status
  returning id into v_user;
  insert into app.user_roles (user_id, role, granted_by)
  values (v_user, 'SA', '00000000-0000-0000-0000-000000000001')
  on conflict do nothing;
  return v_user;
end $$;
