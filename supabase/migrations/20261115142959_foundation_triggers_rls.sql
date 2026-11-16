-- PRET W2-001 Foundation · 05 — triggers (stamps, guards, audit) + RLS + grants on foundation tables
-- Design: data-model.md §1 (stamps), §15 (trigger catalogue); rls-policies.md §1, §4, §5.1/5.2/5.7, §6.
-- Principles: RLS enabled AND forced on every table; one policy per command; `to authenticated`;
-- WITH CHECK on every insert/update policy; helpers wrapped in (select …) where constant.

-- CREATE TRIGGER needs EXECUTE on the trigger function; audit.tg_log_change is owned by audit_writer.
set role audit_writer;
grant execute on function audit.tg_log_change() to postgres;
reset role;

-- ===========================================================================
-- Generic stamp trigger (FR-G-13, ADR-0015 optimistic locking)
-- ===========================================================================
create or replace function app.tg_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id();
  v_new jsonb := to_jsonb(new);
  v_patch jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    if v_new ? 'created_at' then v_patch := v_patch || jsonb_build_object('created_at', now()); end if;
    if v_new ? 'created_by' and v_actor is not null then v_patch := v_patch || jsonb_build_object('created_by', v_actor); end if;
    if v_new ? 'updated_at' then v_patch := v_patch || jsonb_build_object('updated_at', now()); end if;
    if v_new ? 'updated_by' then v_patch := v_patch || jsonb_build_object('updated_by', v_actor); end if;
    if v_new ? 'version'    then v_patch := v_patch || jsonb_build_object('version', 1); end if;
  else
    if v_new ? 'created_at' then v_patch := v_patch || jsonb_build_object('created_at', to_jsonb(old) -> 'created_at'); end if;
    if v_new ? 'created_by' then v_patch := v_patch || jsonb_build_object('created_by', to_jsonb(old) -> 'created_by'); end if;
    if v_new ? 'updated_at' then v_patch := v_patch || jsonb_build_object('updated_at', now()); end if;
    if v_new ? 'updated_by' then v_patch := v_patch || jsonb_build_object('updated_by', v_actor); end if;
    if v_new ? 'version'    then v_patch := v_patch || jsonb_build_object('version', ((to_jsonb(old) ->> 'version')::int) + 1); end if;
  end if;
  if v_patch <> '{}'::jsonb then
    new := jsonb_populate_record(new, v_patch);
  end if;
  return new;
end $$;

-- ===========================================================================
-- Guards
-- ===========================================================================
-- app_users: immutable user type; self cannot change own status/window/email; auth link and
-- login counters are system-managed (sign-in / invite acceptance run as pret_jobs).
create or replace function app.tg_app_users_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id();
begin
  if tg_op = 'INSERT' then
    if v_actor is not null then                                   -- interactive create (SA / ADM)
      if new.status <> 'invited' or new.auth_user_id is not null or new.mfa_enrolled
         or new.last_login_at is not null or new.failed_login_count <> 0 or new.locked_until is not null then
        raise exception 'PRET-USR-CREATE: new users start as invited' using errcode = '23514';
      end if;
      new.invited_by := null; new.invited_at := null;
    end if;
    return new;
  end if;

  if new.user_type is distinct from old.user_type then
    raise exception 'PRET-USR-TYPE: user type cannot change' using errcode = '23514';
  end if;
  if v_actor is null then
    return new;                                                   -- system (pret_jobs): sign-in, invite acceptance, jobs
  end if;
  if new.auth_user_id is distinct from old.auth_user_id or new.mfa_enrolled is distinct from old.mfa_enrolled
     or new.last_login_at is distinct from old.last_login_at or new.employee_id is distinct from old.employee_id
     or new.invited_by is distinct from old.invited_by or new.invited_at is distinct from old.invited_at then
    raise exception 'PRET-USR-SYSTEM-FIELD' using errcode = '42501';
  end if;
  -- unlocking only (F-ADM-13): counters may be reset, never set
  if (new.failed_login_count is distinct from old.failed_login_count and new.failed_login_count <> 0)
     or (new.locked_until is distinct from old.locked_until and new.locked_until is not null) then
    raise exception 'PRET-USR-UNLOCK-ONLY' using errcode = '42501';
  end if;
  if old.id = v_actor and (new.status is distinct from old.status or new.login_email is distinct from old.login_email
       or new.access_start_date is distinct from old.access_start_date or new.access_end_date is distinct from old.access_end_date
       or new.locked_until is distinct from old.locked_until) then
    raise exception 'PRET-SELF-001: you cannot change your own access' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status not in ('active','disabled','locked')
     and not (new.status = 'invited' and old.status = 'invited') then
    raise exception 'PRET-USR-STATUS %→%', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'active' and old.status = 'invited' then
    raise exception 'PRET-USR-STATUS: users become active by accepting their invitation' using errcode = '23514';
  end if;
  if new.status = 'disabled' and old.status <> 'disabled' then
    update app.app_sessions s set ended_at = now(), end_reason = 'disabled'
     where s.user_id = new.id and s.ended_at is null;
  end if;
  return new;
end $$;

-- user_roles: grantor from the session; revoke-only updates; external users ADM only;
-- at least one active SA must remain (EC-ADM-01); N-53 to the affected user.
create or replace function app.tg_user_roles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id();
  v_target app.app_users%rowtype;
begin
  select * into v_target from app.app_users u where u.id = new.user_id;
  if tg_op = 'INSERT' then
    if v_actor is not null then
      new.granted_by := v_actor;
    end if;
    new.granted_at := now(); new.revoked_at := null; new.revoked_by := null;
    if v_target.user_type = 'external' and new.role <> 'ADM' then
      raise exception 'PRET-ROLE-EXTERNAL: external users may hold ADM only' using errcode = '23514';
    end if;
    if v_target.status in ('disabled','expired') then
      raise exception 'PRET-ROLE-INACTIVE-USER' using errcode = '23514';
    end if;
    return new;
  end if;
  -- UPDATE: revoke only
  if new.user_id is distinct from old.user_id or new.role is distinct from old.role
     or new.granted_by is distinct from old.granted_by or new.granted_at is distinct from old.granted_at
     or old.revoked_at is not null or new.revoked_at is null then
    raise exception 'PRET-ROLE-REVOKE-ONLY' using errcode = '23514';
  end if;
  new.revoked_at := now();
  if v_actor is not null then
    new.revoked_by := v_actor;
  end if;
  return new;
end $$;

create or replace function app.tg_user_roles_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app.user_roles r join app.app_users u on u.id = r.user_id
                  where r.role = 'SA' and r.revoked_at is null and u.status in ('active','invited')
                    and u.id <> '00000000-0000-0000-0000-000000000001') then
    raise exception 'PRET-ADM-LAST-SA: at least one active Super Admin must remain' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    update app.app_sessions s set ended_at = now(), end_reason = 'role_change'
     where s.user_id = new.user_id and s.ended_at is null;
  end if;
  perform app.notify(new.user_id, 'N-53',
                     case when tg_op = 'INSERT' then 'You have been given the ' || new.role::text || ' role in PRET'
                          else 'Your ' || new.role::text || ' role in PRET has been removed' end,
                     null, '/', false, 'role_changed', jsonb_build_object('role', new.role::text,
                     'change', case when tg_op = 'INSERT' then 'granted' else 'revoked' end));
  return null;
end $$;

-- app_users status changes that remove the last SA are also blocked.
create or replace function app.tg_app_users_last_sa() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('disabled','expired','locked') and old.status is distinct from new.status
     and not exists (select 1 from app.user_roles r join app.app_users u on u.id = r.user_id
                      where r.role = 'SA' and r.revoked_at is null and u.status in ('active','invited')
                        and u.id <> '00000000-0000-0000-0000-000000000001')
     and exists (select 1 from app.user_roles r where r.user_id = new.id and r.role = 'SA' and r.revoked_at is null) then
    raise exception 'PRET-ADM-LAST-SA: at least one active Super Admin must remain' using errcode = '23514';
  end if;
  return null;
end $$;

-- delegations: delegate must be an active employee user (Q-ARCH-01); set_by from session; cancel-only updates.
create or replace function app.tg_delegations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id();
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from app.app_users u where u.id = new.delegate_user_id
                    and u.user_type = 'employee' and u.status = 'active') then
      raise exception 'PRET-DLG-DELEGATE: the delegate must be an active employee user' using errcode = '23514';
    end if;
    if not exists (select 1 from app.app_users u where u.id = new.delegator_user_id and u.user_type = 'employee') then
      raise exception 'PRET-DLG-DELEGATOR: only employee users delegate approvals' using errcode = '23514';
    end if;
    if v_actor is not null then new.set_by := v_actor; end if;
    new.cancelled_at := null; new.cancelled_by := null; new.created_at := now();
    return new;
  end if;
  if (new.delegator_user_id, new.delegate_user_id, new.valid_from, new.valid_to, new.scope, new.set_by, new.created_at)
     is distinct from (old.delegator_user_id, old.delegate_user_id, old.valid_from, old.valid_to, old.scope, old.set_by, old.created_at)
     or old.cancelled_at is not null or new.cancelled_at is null then
    raise exception 'PRET-DLG-CANCEL-ONLY' using errcode = '23514';
  end if;
  new.cancelled_at := now();
  new.cancelled_by := v_actor;
  return new;
end $$;

-- company_profile: legal name and logo are SA-only columns (CO1/CO6).
create or replace function app.tg_company_profile_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.current_app_user_id() is not null and not app.is_sa()
     and (new.legal_name is distinct from old.legal_name or new.logo_file_id is distinct from old.logo_file_id) then
    raise exception 'PRET-ORG-SA-ONLY: only a Super Admin can change the legal name or logo' using errcode = '42501';
  end if;
  return new;
end $$;

-- notifications: users may only mark read (column grant also limits this); read_at set once.
create or replace function app.tg_notifications_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.read_at is not null then
    new.read_at := old.read_at;
  elsif new.read_at is not null then
    new.read_at := now();
  end if;
  return new;
end $$;

-- files: registry rows are created as upload intents by their uploader.
create or replace function app.tg_files_guard() returns trigger
language plpgsql set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id();
begin
  if v_actor is not null then
    new.created_by := v_actor;
    new.status := 'pending_upload';
    new.sha256 := null;
    new.deleted_at := null; new.deleted_reason := null;
    new.upload_expires_at := least(coalesce(new.upload_expires_at, now() + interval '10 minutes'), now() + interval '10 minutes');
  end if;
  return new;
end $$;

-- file_access_grants: every grant writes an access-log row (F-ADM-10, BR-ADM-21).
create or replace function app.tg_file_grant_log() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_file app.files%rowtype;
begin
  select * into v_file from app.files f where f.id = new.file_id;
  perform audit.write_access(
    case when v_file.data_category in ('health','religion') then 'view_sensitive' else 'download' end::app.audit_action,
    'file', v_file.id, array[v_file.owner_employee_id], array[v_file.subject::text],
    case when v_file.data_category is null then '{}'::app.data_category[] else array[v_file.data_category] end,
    new.reason, v_file.original_name, null, v_file.id, null);
  return null;
end $$;

-- ===========================================================================
-- Attach triggers
-- ===========================================================================
create trigger tg_stamp before insert or update on app.company_profile   for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.company_statutory for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.security_settings for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.app_users         for each row execute function app.tg_stamp();

create trigger tg_guard before insert or update on app.app_users for each row execute function app.tg_app_users_guard();
create trigger tg_last_sa after update of status on app.app_users for each row execute function app.tg_app_users_last_sa();
create trigger tg_guard before insert or update on app.user_roles for each row execute function app.tg_user_roles_guard();
create trigger tg_after after insert or update on app.user_roles for each row execute function app.tg_user_roles_after();
create trigger tg_guard before insert or update on app.delegations for each row execute function app.tg_delegations_guard();
create trigger tg_guard before update on app.company_profile for each row execute function app.tg_company_profile_guard();
create trigger tg_guard before update on app.notifications for each row execute function app.tg_notifications_guard();
create trigger tg_guard before insert on app.files for each row execute function app.tg_files_guard();
create trigger tg_access_log after insert on app.file_access_grants for each row execute function app.tg_file_grant_log();

-- Data-change audit (F-ADM-09). Excluded by design: derived cache (reporting_closure), and
-- tables that are themselves logs or high-churn technical state (app_sessions, login_events,
-- notifications, email_outbox, file_access_grants — the latter logged to access_log —, job_runs).
create trigger tg_audit after insert or update or delete on app.company_profile          for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.company_statutory        for each row execute function audit.tg_log_change('bank,statutory');
create trigger tg_audit after insert or update or delete on app.security_settings        for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.app_users                for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.user_roles               for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.user_invitations         for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.delegations              for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.files                    for each row execute function audit.tg_log_change();
create trigger tg_audit after insert or update or delete on app.notification_preferences for each row execute function audit.tg_log_change();

-- ===========================================================================
-- RLS: enable + force on every foundation table (app and private)
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array['company_profile','company_statutory','security_settings','app_users','user_roles',
                           'user_invitations','app_sessions','login_events','delegations','reporting_closure',
                           'files','file_access_grants','notifications','email_outbox','notification_preferences','job_runs']
  loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
  end loop;
  foreach t in array array['doc_counters','rate_limit_counters','key_versions']
  loop
    execute format('alter table private.%I enable row level security', t);
    execute format('alter table private.%I force row level security', t);
  end loop;
end $$;

-- ===========================================================================
-- Table privileges (grants are the first gate; RLS the second)
-- ===========================================================================
revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
grant all on all tables in schema app to service_role;          -- pret_jobs path (BYPASSRLS); never interactive
grant all on all tables in schema private to service_role;
grant usage, select on all sequences in schema app to service_role;
grant usage, select on all sequences in schema private to service_role;

grant select, update                         on app.company_profile   to authenticated;
grant select, insert, update                 on app.company_statutory to authenticated;
grant select, update                         on app.security_settings to authenticated;
grant select                                 on app.app_users         to authenticated;
grant insert (user_type, employee_id, login_email, display_name, access_start_date, access_end_date, service_provider)
                                             on app.app_users         to authenticated;
grant update (display_name, login_email, status, access_start_date, access_end_date, service_provider, disabled_reason,
              failed_login_count, locked_until)
                                             on app.app_users         to authenticated;
grant select                                 on app.user_roles        to authenticated;
grant insert (user_id, role, granted_by)     on app.user_roles        to authenticated;
grant update (revoked_at, revoked_by)        on app.user_roles        to authenticated;
grant select (id, user_id, expires_at, scheduled_send_at, sent_at, accepted_at, revoked_at, created_by, created_at)
                                             on app.user_invitations  to authenticated;   -- never token_hash
grant select                                 on app.app_sessions      to authenticated;
grant select                                 on app.login_events      to authenticated;
grant select, insert                         on app.delegations       to authenticated;
grant update (cancelled_at, cancelled_by)    on app.delegations       to authenticated;
grant select                                 on app.files             to authenticated;
grant insert (bucket, storage_path, subject, owner_employee_id, data_category, original_name, mime_type, size_bytes,
              retention_delete_after, upload_expires_at, created_by)
                                             on app.files             to authenticated;
grant select, insert                         on app.file_access_grants to authenticated;
grant select                                 on app.notifications     to authenticated;
grant update (read_at)                       on app.notifications     to authenticated;
grant select                                 on app.email_outbox      to authenticated;
grant select, insert, update, delete         on app.notification_preferences to authenticated;
grant select                                 on app.job_runs          to authenticated;
-- reporting_closure: P-DEFINER (no grant; read by helpers only)

-- ===========================================================================
-- Policies
-- ===========================================================================
-- §5.1 Organisation & settings
create policy company_profile_select on app.company_profile for select to authenticated
  using ((select app.is_active_user()));
create policy company_profile_update on app.company_profile for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy company_statutory_select on app.company_statutory for select to authenticated
  using ((select app.is_admin()));
create policy company_statutory_insert on app.company_statutory for insert to authenticated
  with check ((select app.is_sa()));
create policy company_statutory_update on app.company_statutory for update to authenticated
  using ((select app.is_sa())) with check ((select app.is_sa()));

create policy security_settings_select on app.security_settings for select to authenticated
  using ((select app.is_admin()));
create policy security_settings_update on app.security_settings for update to authenticated
  using ((select app.is_sa())) with check ((select app.is_sa()));

-- §5.2 Users and access
create policy app_users_select on app.app_users for select to authenticated
  using (   auth_user_id = (select auth.uid())
         or (select app.is_sa())
         or ((select app.is_admin()) and user_type = 'employee' and not app.user_has_privileged_role(id)));
create policy app_users_insert on app.app_users for insert to authenticated
  with check (   (select app.is_sa())
              or ((select app.is_admin()) and user_type = 'employee'));
create policy app_users_update on app.app_users for update to authenticated
  using (   (select app.is_sa())
         or ((select app.is_admin()) and user_type = 'employee' and not app.user_has_privileged_role(id)
             and id is distinct from (select app.current_app_user_id())))
  with check (   (select app.is_sa())
              or ((select app.is_admin()) and user_type = 'employee' and not app.user_has_privileged_role(id)
                  and id is distinct from (select app.current_app_user_id())));

create policy user_roles_select on app.user_roles for select to authenticated
  using (user_id = (select app.current_app_user_id()) or (select app.is_sa()));
create policy user_roles_insert on app.user_roles for insert to authenticated
  with check ((select app.is_sa()) and granted_by = (select app.current_app_user_id())
              and user_id is distinct from (select app.current_app_user_id()));
create policy user_roles_update on app.user_roles for update to authenticated
  using ((select app.is_sa()) and revoked_at is null and user_id is distinct from (select app.current_app_user_id()))
  with check ((select app.is_sa()) and user_id is distinct from (select app.current_app_user_id()));

create policy user_invitations_select on app.user_invitations for select to authenticated
  using ((select app.is_admin()));

create policy app_sessions_select on app.app_sessions for select to authenticated
  using (user_id = (select app.current_app_user_id()) or (select app.is_sa()));

create policy login_events_select on app.login_events for select to authenticated
  using ((select app.is_sa()));

create policy delegations_select on app.delegations for select to authenticated
  using (   delegator_user_id = (select app.current_app_user_id())
         or delegate_user_id  = (select app.current_app_user_id())
         or (select app.is_admin()));
create policy delegations_insert on app.delegations for insert to authenticated
  with check (set_by = (select app.current_app_user_id())
              and (delegator_user_id = (select app.current_app_user_id()) or (select app.is_admin())));
create policy delegations_update on app.delegations for update to authenticated
  using (delegator_user_id = (select app.current_app_user_id()) or (select app.is_admin()))
  with check (delegator_user_id = (select app.current_app_user_id()) or (select app.is_admin()));

-- §5.7 Files, notifications, jobs
create policy files_select on app.files for select to authenticated
  using (app.can_read_file(id) or (select app.is_admin())
         or (status = 'pending_upload' and created_by = (select app.current_app_user_id())));
create policy files_insert on app.files for insert to authenticated
  with check (created_by = (select app.current_app_user_id())
              and status = 'pending_upload'
              and app.can_upload_for(subject, owner_employee_id, bucket, storage_path));

create policy file_access_grants_select on app.file_access_grants for select to authenticated
  using (user_id = (select app.current_app_user_id()) or (select app.is_sa()));
create policy file_access_grants_insert on app.file_access_grants for insert to authenticated
  with check (user_id = (select app.current_app_user_id())
              and app.can_read_file(file_id)
              and expires_at <= now() + interval '5 minutes');

create policy notifications_select on app.notifications for select to authenticated
  using (recipient_user_id = (select app.current_app_user_id()));
create policy notifications_update on app.notifications for update to authenticated
  using (recipient_user_id = (select app.current_app_user_id()))
  with check (recipient_user_id = (select app.current_app_user_id()));

create policy email_outbox_select on app.email_outbox for select to authenticated
  using ((select app.is_admin()));

create policy notification_preferences_select on app.notification_preferences for select to authenticated
  using (user_id = (select app.current_app_user_id()));
create policy notification_preferences_insert on app.notification_preferences for insert to authenticated
  with check (user_id = (select app.current_app_user_id()));
create policy notification_preferences_update on app.notification_preferences for update to authenticated
  using (user_id = (select app.current_app_user_id()))
  with check (user_id = (select app.current_app_user_id()));
create policy notification_preferences_delete on app.notification_preferences for delete to authenticated
  using (user_id = (select app.current_app_user_id()));

create policy job_runs_select on app.job_runs for select to authenticated
  using ((select app.is_sa()));

-- ===========================================================================
-- Function privileges: revoke everything, then grant the callable surface.
-- ===========================================================================
revoke execute on all functions in schema app from public, anon, authenticated, service_role;
revoke execute on all functions in schema private from public, anon, authenticated, service_role;

grant execute on function
  app.today_myt(), app.current_app_user_id(), app.current_employee_id(), app.current_user_type(),
  app.is_active_user(), app.current_aal(), app.mfa_required_privileged(), app.has_role(app.privileged_role),
  app.holds_role(app.privileged_role), app.is_admin(), app.is_sa(), app.is_self(uuid), app.is_manager_of(uuid),
  app.is_manager(), app.current_role_codes(), app.user_has_privileged_role(uuid), app.current_user_profile(),
  app.touch_session(inet, text), app.end_my_session(text),
  app.create_invitation(uuid, bytea, timestamptz, timestamptz), app.revoke_invitation(uuid),
  app.can_upload_for(app.file_subject, uuid, text, text), app.can_read_file(uuid),
  app.storage_read_allowed(text, text), app.storage_upload_allowed(text, text), app.confirm_upload(uuid, bytea)
  to authenticated;
-- service_role (pret_jobs): read-only helpers are needed because stamp/guard triggers call them
-- (they return NULL / false without a user JWT), plus the job-only functions.
grant execute on function
  app.today_myt(), app.current_app_user_id(), app.current_employee_id(), app.current_user_type(),
  app.is_active_user(), app.current_aal(), app.mfa_required_privileged(), app.has_role(app.privileged_role),
  app.holds_role(app.privileged_role), app.is_admin(), app.is_sa(), app.is_self(uuid), app.is_manager_of(uuid),
  app.is_manager(), app.current_role_codes(),
  app.notify(uuid, text, text, text, text, boolean, text, jsonb)
  to service_role;
grant execute on function private.next_doc_no(text, int), private.rate_limit_hit(text, int, int) to service_role;
-- private.bootstrap_super_admin: postgres only (no grant).
