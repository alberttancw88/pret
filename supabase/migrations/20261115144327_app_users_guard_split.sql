-- PRET W2-001 Foundation · 09 — restructure app_users guards (found by foundation_role_matrix.sql E8/E13).
-- * tg_app_users_guard is SECURITY INVOKER again, so `current_user` tells a direct user write
--   ('authenticated') from a write made by a registered definer function (owner postgres,
--   e.g. app.create_invitation stamping invited_by) or the system (service_role).
--   System-managed columns are blocked only for direct user writes.
-- * Ending sessions on disable/expire moves to the AFTER trigger, which runs as definer.

alter function app.tg_app_users_guard() security invoker;

create or replace function app.tg_app_users_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id();
  v_direct boolean := current_user = 'authenticated';
begin
  if tg_op = 'INSERT' then
    if v_direct then
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
  if not v_direct then
    return new;                       -- system (service_role) or a registered definer function
  end if;
  if new.auth_user_id is distinct from old.auth_user_id or new.mfa_enrolled is distinct from old.mfa_enrolled
     or new.last_login_at is distinct from old.last_login_at or new.employee_id is distinct from old.employee_id
     or new.invited_by is distinct from old.invited_by or new.invited_at is distinct from old.invited_at then
    raise exception 'PRET-USR-SYSTEM-FIELD' using errcode = '42501';
  end if;
  if (new.failed_login_count is distinct from old.failed_login_count and new.failed_login_count <> 0)
     or (new.locked_until is distinct from old.locked_until and new.locked_until is not null) then
    raise exception 'PRET-USR-UNLOCK-ONLY' using errcode = '42501';
  end if;
  if old.id = v_actor and (new.status is distinct from old.status or new.login_email is distinct from old.login_email
       or new.access_start_date is distinct from old.access_start_date or new.access_end_date is distinct from old.access_end_date
       or new.locked_until is distinct from old.locked_until) then
    raise exception 'PRET-SELF-001: you cannot change your own access' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and new.status not in ('active','disabled','locked') then
    raise exception 'PRET-USR-STATUS %→%', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'active' and old.status = 'invited' then
    raise exception 'PRET-USR-STATUS: users become active by accepting their invitation' using errcode = '23514';
  end if;
  return new;
end $$;

-- AFTER UPDATE OF status (definer): last-SA rule, then end the user's open sessions (BR-ADM-06).
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
  if new.status in ('disabled','expired') and old.status is distinct from new.status then
    update app.app_sessions s set ended_at = now(), end_reason = new.status::text
     where s.user_id = new.id and s.ended_at is null;
  end if;
  return null;
end $$;

revoke execute on function app.tg_app_users_guard(), app.tg_app_users_last_sa() from public, anon, authenticated, service_role;
