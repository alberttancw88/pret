-- PRET W2-002 · 11 — guards, replacement-holiday generation, publish/notice functions, helpers, triggers
-- Design: data-model.md §15 (trigger catalogue); PRD §9.2–9.4 (BR-ORG-10, 20–25), §10.2 (BR-ADM-01–03),
-- rls-policies.md §10 (definer register). Definer functions pin search_path = '' and re-check the caller.

-- ===========================================================================
-- Helpers (read-only facts; used by policies and the server)
-- ===========================================================================
-- A holiday year is published when any state-year row of it is published (publish is per year).
create or replace function app.holiday_year_published(p_year int) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.holiday_calendar_years y where y.year = p_year and y.status = 'published')
$$;

create or replace function app.holiday_visible(p_holiday_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.public_holidays h
                  where h.id = p_holiday_id
                    and exists (select 1 from app.holiday_calendar_years y where y.year = h.year and y.status = 'published'))
$$;

-- Display names for "created/updated by" and actor columns. Admins may resolve any user;
-- others only themselves (names are directory-level data, never sensitive fields).
create or replace function app.user_display_names(p_ids uuid[])
returns table (id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.display_name
    from app.app_users u
   where u.id = any(p_ids)
     and app.is_active_user()
     and (app.is_admin() or u.id = app.current_app_user_id())
$$;

-- Derived MGR (D11): number of direct reportees per employee — admins only.
create or replace function app.direct_reportee_counts(p_employee_ids uuid[])
returns table (employee_id uuid, n int)
language sql stable security definer set search_path = '' as $$
  select c.manager_employee_id, count(*)::int
    from app.reporting_closure c
   where c.manager_employee_id = any(p_employee_ids) and c.depth = 1 and app.is_admin()
   group by c.manager_employee_id
$$;

-- Day type of a working pattern on a date (version in force on that date).
create or replace function app.pattern_day_type(p_pattern_id uuid, p_date date) returns app.day_type
language sql stable security definer set search_path = '' as $$
  select case extract(isodow from p_date)::int
           when 1 then v.mon when 2 then v.tue when 3 then v.wed when 4 then v.thu
           when 5 then v.fri when 6 then v.sat else v.sun end
    from app.working_pattern_versions v
   where v.pattern_id = p_pattern_id and v.effective_from <= p_date
   order by v.effective_from desc
   limit 1
$$;

-- ===========================================================================
-- Replacement holidays (F-ORG-08, BR-ORG-21/22) — idempotent diff, per year (and optionally state).
-- * Triggering holidays: active, observed, full-day, gazetted or special-declared (EA s60D; company
--   holidays do not create replacements). Replacement date: next working day (full/half) of the
--   pattern that is not a holiday for that state and not already used by another replacement.
-- * Rest day → replacement for every holiday on that date. Off day → only if leave_policy LP18
--   (replacement_for_ph_on_off_day; default No, Q14 — table arrives with the leave module).
--   Working day with k holidays → the first is absorbed, k−1 get replacements (BR-ORG-22).
-- ===========================================================================
create or replace function app.regenerate_replacement_holidays(p_year int, p_state app.my_state default null)
returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_lp18 boolean := false;
  v_state app.my_state;
  v_pattern uuid;
  v_used date[];
  v_keep uuid[] := '{}';
  v_day record;
  v_dt app.day_type;
  v_dt2 app.day_type;
  v_need int;
  v_cand date;
  v_guard int;
  v_id uuid;
  v_n int := 0;
  i int;
begin
  if p_year is null then return 0; end if;
  if to_regclass('app.leave_policy') is not null then
    begin
      execute 'select coalesce((select replacement_for_ph_on_off_day from app.leave_policy where id = 1), false)' into v_lp18;
    exception when others then v_lp18 := false;
    end;
  end if;

  for v_state in
    select s from unnest(enum_range(null::app.my_state)) s where p_state is null or s = p_state
  loop
    for v_pattern in select p.id from app.working_patterns p where p.is_active order by p.id loop
      v_used := '{}';
      for v_day in
        select h.holiday_date, array_agg(h.id order by h.created_at, h.id) as ids
          from app.public_holidays h
          join app.public_holiday_states hs on hs.holiday_id = h.id and hs.state = v_state
         where h.year = p_year and h.is_active and h.is_observed and not h.is_half_day
           and h.holiday_type in ('national','state','special')
         group by h.holiday_date
         order by h.holiday_date
      loop
        v_dt := app.pattern_day_type(v_pattern, v_day.holiday_date);
        continue when v_dt is null;
        v_need := case
                    when v_dt = 'rest' then cardinality(v_day.ids)
                    when v_dt = 'off' and v_lp18 then cardinality(v_day.ids)
                    else greatest(cardinality(v_day.ids) - 1, 0)
                  end;
        continue when v_need = 0;
        for i in (cardinality(v_day.ids) - v_need + 1) .. cardinality(v_day.ids) loop
          v_cand := v_day.holiday_date + 1;
          v_guard := 0;
          loop
            v_guard := v_guard + 1;
            exit when v_guard > 400;
            v_dt2 := app.pattern_day_type(v_pattern, v_cand);
            if v_dt2 in ('full','half')
               and not (v_cand = any(v_used))
               and not exists (select 1 from app.public_holidays h2
                                 join app.public_holiday_states s2 on s2.holiday_id = h2.id and s2.state = v_state
                                where h2.holiday_date = v_cand and h2.is_active and h2.is_observed)
               and not exists (select 1 from app.replacement_holidays r2
                                 join app.public_holidays h3 on h3.id = r2.source_holiday_id
                                where r2.state = v_state and r2.pattern_id = v_pattern and r2.is_active
                                  and r2.replacement_date = v_cand and h3.year <> p_year) then
              exit;
            end if;
            v_cand := v_cand + 1;
          end loop;
          continue when v_guard > 400;
          v_used := v_used || v_cand;
          v_id := null;
          insert into app.replacement_holidays as r (source_holiday_id, state, pattern_id, replacement_date, is_active)
          values (v_day.ids[i], v_state, v_pattern, v_cand, true)
          on conflict (source_holiday_id, state, pattern_id) do update
            set replacement_date = excluded.replacement_date, is_active = true
            where (r.replacement_date, r.is_active) is distinct from (excluded.replacement_date, true)
          returning r.id into v_id;
          if v_id is null then
            select r.id into v_id from app.replacement_holidays r
             where r.source_holiday_id = v_day.ids[i] and r.state = v_state and r.pattern_id = v_pattern;
          end if;
          v_keep := v_keep || v_id;
          v_n := v_n + 1;
        end loop;
      end loop;
    end loop;
  end loop;

  update app.replacement_holidays r set is_active = false
    from app.public_holidays h
   where h.id = r.source_holiday_id and h.year = p_year
     and (p_state is null or r.state = p_state)
     and r.is_active and not (r.id = any(v_keep));
  return v_n;
end $$;

-- ===========================================================================
-- Publish checks (BR-ORG-20) and publish (BR-ORG-25)
-- Checked states = states of active work locations (W2-003 narrows to "states with active employees").
-- ===========================================================================
create or replace function app.holiday_year_checks(p_year int)
returns table (state app.my_state, compulsory_present app.compulsory_holiday[], compulsory_missing app.compulsory_holiday[], paid_count int)
language sql stable security definer set search_path = '' as $$
  with st as (select distinct l.state from app.work_locations l where l.is_active),
  hol as (
    select hs.state, h.compulsory, h.holiday_type, h.is_half_day
      from app.public_holidays h join app.public_holiday_states hs on hs.holiday_id = h.id
     where h.year = p_year and h.is_active and h.is_observed)
  select st.state,
         coalesce((select array_agg(distinct hol.compulsory order by hol.compulsory) from hol
                    where hol.state = st.state and hol.compulsory is not null), '{}'),
         coalesce((select array_agg(c order by c) from unnest(enum_range(null::app.compulsory_holiday)) c
                    where not exists (select 1 from hol where hol.state = st.state and hol.compulsory = c)), '{}'),
         (select count(*)::int from hol where hol.state = st.state and hol.holiday_type in ('national','state','special') and not hol.is_half_day)
    from st
   where app.is_admin()
   order by st.state
$$;

create or replace function app.publish_holiday_year(p_year int, p_acknowledge_warnings boolean default false)
returns text[]
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id();
  v_blocking text;
  v_warn text[];
begin
  if not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'PRET-PH-YEAR' using errcode = '22023';
  end if;
  if not exists (select 1 from app.work_locations l where l.is_active) then
    raise exception 'PRET-PH-NO-LOCATION: add an active work location first so the calendar can be checked' using errcode = '23514';
  end if;
  select string_agg(c.state::text || ' missing ' || array_to_string(c.compulsory_missing::text[], ', '), '; ')
    into v_blocking from app.holiday_year_checks(p_year) c where cardinality(c.compulsory_missing) > 0;
  if v_blocking is not null then
    raise exception 'PRET-PH-COMPULSORY: %', v_blocking using errcode = '23514';
  end if;
  select coalesce(array_agg(c.state::text || ': ' || c.paid_count || ' paid holidays (fewer than 11)'), '{}')
    into v_warn from app.holiday_year_checks(p_year) c where c.paid_count < 11;
  if cardinality(v_warn) > 0 and not coalesce(p_acknowledge_warnings, false) then
    raise exception 'PRET-PH-WARN-ACK: %', array_to_string(v_warn, '; ') using errcode = '23514';
  end if;
  insert into app.holiday_calendar_years as y (year, state, status, published_by, published_at)
  select p_year, s, 'published', v_actor, now() from unnest(enum_range(null::app.my_state)) s
  on conflict (year, state) do update
    set status = 'published', published_by = excluded.published_by, published_at = excluded.published_at
    where y.status <> 'published';
  perform app.regenerate_replacement_holidays(p_year);
  return v_warn;
end $$;

-- ===========================================================================
-- Company privacy notice (F-ADM-15): publish replaces the current one; history kept; N-55 in-app only.
-- ===========================================================================
create or replace function app.publish_privacy_notice(p_title text, p_body_text text, p_file_id uuid, p_effective_date date)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id();
  v_id uuid;
begin
  if not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if p_file_id is not null and not exists (
       select 1 from app.files f where f.id = p_file_id and f.subject = 'privacy_notice' and f.status = 'active'
          and f.mime_type = 'application/pdf') then
    raise exception 'PRET-NOTICE-FILE: the PDF upload is missing or not confirmed' using errcode = '23514';
  end if;
  update app.privacy_notices n set is_current = false, superseded_at = now() where n.is_current;
  insert into app.privacy_notices (title, body_text, file_id, effective_date, is_current, published_by)
  values (p_title, nullif(btrim(p_body_text), ''), p_file_id, p_effective_date, true, v_actor)
  returning id into v_id;
  perform app.notify(u.id, 'N-55', 'A company privacy notice has been published', null, '/privacy-notice', false)
     from app.app_users u
    where u.status = 'active' and u.id <> '00000000-0000-0000-0000-000000000001';
  return v_id;
end $$;

-- ===========================================================================
-- Guards (trigger-only; EXECUTE revoked from every login role)
-- ===========================================================================
create or replace function app.tg_departments_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cycle boolean;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'PRET-ORG-CYCLE: a department cannot be its own parent' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id then
      if not exists (select 1 from app.departments d where d.id = new.parent_id and d.is_active) then
        raise exception 'PRET-ORG-PARENT-INACTIVE: the parent department must be active' using errcode = '23514';
      end if;
      with recursive up as (
        select d.id, d.parent_id, 1 as depth from app.departments d where d.id = new.parent_id
        union all
        select d.id, d.parent_id, up.depth + 1 from app.departments d join up on d.id = up.parent_id where up.depth < 200)
      select exists (select 1 from up where up.id = new.id) into v_cycle;
      if v_cycle then
        raise exception 'PRET-ORG-CYCLE: a department cannot sit under itself or one of its sub-departments' using errcode = '23514';
      end if;
    end if;
  end if;
  if new.cost_centre_id is not null and (tg_op = 'INSERT' or new.cost_centre_id is distinct from old.cost_centre_id)
     and not exists (select 1 from app.cost_centres c where c.id = new.cost_centre_id and c.is_active) then
    raise exception 'PRET-ORG-REF-INACTIVE: the cost centre must be active' using errcode = '23514';
  end if;
  if new.head_employee_id is not null and to_regclass('app.employees') is null then
    raise exception 'PRET-ORG-HEAD-W2003: head of department can be set once employee records exist' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.is_active and not new.is_active then
    if exists (select 1 from app.departments c where c.parent_id = new.id and c.is_active) then
      raise exception 'PRET-ORG-ACTIVE-CHILDREN: deactivate or move its active sub-departments first' using errcode = '23514';
    end if;
    -- W2-003 extends this guard: blocked while active employees are assigned ("Move {n} employees first").
  end if;
  return new;
end $$;

create or replace function app.tg_positions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.default_department_id is not null and (tg_op = 'INSERT' or new.default_department_id is distinct from old.default_department_id)
     and not exists (select 1 from app.departments d where d.id = new.default_department_id and d.is_active) then
    raise exception 'PRET-ORG-REF-INACTIVE: the default department must be active' using errcode = '23514';
  end if;
  if new.default_grade_id is not null and (tg_op = 'INSERT' or new.default_grade_id is distinct from old.default_grade_id)
     and not exists (select 1 from app.grades g where g.id = new.default_grade_id and g.is_active) then
    raise exception 'PRET-ORG-REF-INACTIVE: the default grade must be active' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function app.tg_work_locations_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.default_pattern_id is distinct from old.default_pattern_id then
    if not exists (select 1 from app.working_patterns p where p.id = new.default_pattern_id and p.is_active) then
      raise exception 'PRET-ORG-REF-INACTIVE: the default working-week pattern must be active' using errcode = '23514';
    end if;
  end if;
  -- W2-003 extends: deactivation blocked while active employees are assigned (WL5).
  return new;
end $$;

create or replace function app.tg_working_patterns_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.is_active and not new.is_active
     and exists (select 1 from app.work_locations l where l.default_pattern_id = new.id and l.is_active) then
    raise exception 'PRET-WP-IN-USE: this pattern is the default of an active work location' using errcode = '23514';
  end if;
  return new;
end $$;

-- Versions in force (effective today or earlier) are immutable; new versions start today or later
-- unless the pattern has none yet (initial set-up). EC-ORG-03: past leave is not recounted.
create or replace function app.tg_pattern_versions_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.effective_from < app.today_myt()
       and exists (select 1 from app.working_pattern_versions v where v.pattern_id = new.pattern_id) then
      raise exception 'PRET-WP-BACKDATE: a new version must take effect today or later' using errcode = '23514';
    end if;
    return new;
  end if;
  if old.effective_from <= app.today_myt() then
    raise exception 'PRET-WP-VERSION-LOCKED: a version already in force cannot be changed — add a new version' using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.pattern_id is distinct from old.pattern_id then
    raise exception 'PRET-WP-VERSION-LOCKED' using errcode = '23514';
  end if;
  if new.effective_from < app.today_myt() then
    raise exception 'PRET-WP-BACKDATE: a new version must take effect today or later' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function app.tg_public_holidays_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if app.holiday_year_published(old.year) then
      raise exception 'PRET-PH-PUBLISHED-DELETE: holidays of a published year are deactivated, not deleted' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.year is distinct from old.year then
    raise exception 'PRET-PH-YEAR-CHANGE: a holiday cannot move to another year — add it to that year instead' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function app.tg_public_holiday_states_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_year int;
begin
  select h.year into v_year from app.public_holidays h where h.id = old.holiday_id;
  if v_year is not null and app.holiday_year_published(v_year) then
    raise exception 'PRET-PH-PUBLISHED-STATES: states of a holiday in a published year cannot be removed — deactivate it and add a new one' using errcode = '23514';
  end if;
  return old;
end $$;

-- Regeneration triggers
create or replace function app.tg_holiday_states_regen() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_row record; v_year int; v_date date;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  select h.year, h.holiday_date into v_year, v_date from app.public_holidays h where h.id = v_row.holiday_id;
  if v_year is null then
    return null;   -- parent holiday being deleted: its replacements cascade away
  end if;
  perform app.regenerate_replacement_holidays(v_year, v_row.state);
  if extract(month from v_date) = 1 then
    perform app.regenerate_replacement_holidays(v_year - 1, v_row.state);
  end if;
  return null;
end $$;

create or replace function app.tg_holidays_regen() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- INSERT: states are added afterwards (their trigger regenerates). DELETE: replacements cascade.
  if tg_op = 'UPDATE' and (new.holiday_date, new.is_active, new.is_observed, new.is_half_day, new.holiday_type)
       is distinct from (old.holiday_date, old.is_active, old.is_observed, old.is_half_day, old.holiday_type) then
    perform app.regenerate_replacement_holidays(new.year);
    if extract(month from new.holiday_date) = 1 or extract(month from old.holiday_date) = 1 then
      perform app.regenerate_replacement_holidays(new.year - 1);
    end if;
  end if;
  return null;
end $$;

create or replace function app.tg_patterns_regen() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_year int;
begin
  for v_year in select distinct h.year from app.public_holidays h where h.year >= extract(year from app.today_myt())::int - 1 loop
    perform app.regenerate_replacement_holidays(v_year);
  end loop;
  return null;
end $$;

-- access_reviews: reviewer and time from the session.
create or replace function app.tg_access_reviews_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id();
begin
  if v_actor is not null then new.reviewed_by := v_actor; end if;
  new.reviewed_at := now();
  return new;
end $$;

-- company_profile: legal name, logo and business address are SA-only (CO1, CO4, CO6). Replaces W2-001 version.
create or replace function app.tg_company_profile_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.current_app_user_id() is not null and not app.is_sa()
     and (new.legal_name, new.logo_file_id, new.biz_addr_line1, new.biz_addr_line2, new.biz_addr_line3,
          new.biz_postcode, new.biz_city, new.biz_state, new.biz_country)
         is distinct from
         (old.legal_name, old.logo_file_id, old.biz_addr_line1, old.biz_addr_line2, old.biz_addr_line3,
          old.biz_postcode, old.biz_city, old.biz_state, old.biz_country) then
    raise exception 'PRET-ORG-SA-ONLY: only a Super Admin can change the legal name, business address or logo' using errcode = '42501';
  end if;
  return new;
end $$;

-- app_users guard (replaces migration 09): adds Disabled → Invited for a user who never accepted
-- (so the invitation can be re-sent) and blocks Disabled → Active without an Auth account.
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
  if new.login_email is distinct from old.login_email and old.auth_user_id is not null then
    raise exception 'PRET-USR-EMAIL-LOCKED: the login email cannot change after the invitation was accepted' using errcode = '23514';
  end if;
  if new.status is distinct from old.status
     and new.status not in ('active','disabled','locked')
     and not (new.status = 'invited' and old.status = 'disabled' and old.auth_user_id is null) then
    raise exception 'PRET-USR-STATUS %→%', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'active' and old.status is distinct from 'active' and (old.status = 'invited' or old.auth_user_id is null) then
    raise exception 'PRET-USR-STATUS: users become active by accepting their invitation' using errcode = '23514';
  end if;
  return new;
end $$;

-- user_roles AFTER (replaces W2-001): also tells the other active Super Admins (BR-ADM-02, N-53).
create or replace function app.tg_user_roles_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
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
  select u.display_name into v_name from app.app_users u where u.id = new.user_id;
  perform app.notify(r.user_id, 'N-53',
                     left(coalesce(v_name, 'A user') || case when tg_op = 'INSERT' then ' was given the ' else ' lost the ' end
                          || new.role::text || ' role', 150),
                     null, '/users/' || new.user_id::text, false, 'role_changed_admin',
                     jsonb_build_object('role', new.role::text, 'change', case when tg_op = 'INSERT' then 'granted' else 'revoked' end))
     from app.user_roles r join app.app_users u on u.id = r.user_id
    where r.role = 'SA' and r.revoked_at is null and u.status = 'active'
      and r.user_id <> new.user_id
      and r.user_id is distinct from app.current_app_user_id();
  return null;
end $$;

-- ===========================================================================
-- Admin events that change no table row (password-reset email sent, MFA reset, invitation email)
-- → audit.audit_log, actor from the session. Owned by audit_writer like the other writers.
-- ===========================================================================
create or replace function audit.write_admin_event(p_action app.audit_action, p_entity_type text, p_entity_id uuid,
                                                   p_entity_ref text, p_changes jsonb default null)
returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id();
  v_id bigint;
begin
  if v_actor is null or not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if p_action not in ('update','status_change','config_change','role_change') then
    raise exception 'PRET-AUDIT-ACTION' using errcode = '22023';
  end if;
  if p_entity_type not in ('user_password_reset','user_mfa_reset','user_invitation_email') then
    raise exception 'PRET-AUDIT-ENTITY' using errcode = '22023';
  end if;
  insert into audit.audit_log (actor_user_id, actor_user_type, actor_roles, action, entity_type, entity_id, entity_ref,
                               changes, reason, ip, user_agent, request_id)
  values (v_actor, app.current_user_type(), app.current_role_codes(), p_action, p_entity_type, p_entity_id,
          left(p_entity_ref, 200), p_changes, audit.ctx_text('app.reason'),
          audit.ctx_inet('app.client_ip'), left(audit.ctx_text('app.user_agent'), 500), audit.ctx_uuid('app.request_id'))
  returning id into v_id;
  return v_id;
end $$;

-- ===========================================================================
-- Attach triggers
-- ===========================================================================
create trigger tg_stamp before insert or update on app.company_zakat_registrations for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.company_signatories         for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.gl_mappings                 for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.cost_centres                for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.departments                 for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.grades                      for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.positions                   for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.employee_groups             for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.working_patterns            for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.working_pattern_versions    for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.work_locations              for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.public_holidays             for each row execute function app.tg_stamp();

create trigger tg_guard before insert or update on app.departments    for each row execute function app.tg_departments_guard();
create trigger tg_guard before insert or update on app.positions      for each row execute function app.tg_positions_guard();
create trigger tg_guard before insert or update on app.work_locations for each row execute function app.tg_work_locations_guard();
create trigger tg_guard before update on app.working_patterns         for each row execute function app.tg_working_patterns_guard();
create trigger tg_guard before insert or update or delete on app.working_pattern_versions for each row execute function app.tg_pattern_versions_guard();
create trigger tg_guard before insert or update or delete on app.public_holidays          for each row execute function app.tg_public_holidays_guard();
create trigger tg_guard before delete on app.public_holiday_states    for each row execute function app.tg_public_holiday_states_guard();
create trigger tg_guard before insert or update on app.access_reviews for each row execute function app.tg_access_reviews_stamp();

create trigger tg_regen after insert or delete on app.public_holiday_states for each row execute function app.tg_holiday_states_regen();
create trigger tg_regen after update on app.public_holidays                 for each row execute function app.tg_holidays_regen();
create trigger tg_regen after insert or update or delete on app.working_pattern_versions for each row execute function app.tg_patterns_regen();
create trigger tg_regen after update of is_active on app.working_patterns   for each row
  when (old.is_active is distinct from new.is_active) execute function app.tg_patterns_regen();

-- Data-change audit (F-ADM-09). replacement_holidays is derived (regenerated) and not audited.
create trigger tg_audit after insert or update or delete on app.zakat_bodies                for each row execute function audit.tg_log_change('', 'code');
create trigger tg_audit after insert or update or delete on app.company_zakat_registrations for each row execute function audit.tg_log_change('', 'employer_ref');
create trigger tg_audit after insert or update or delete on app.company_signatories         for each row execute function audit.tg_log_change('', 'name');
create trigger tg_audit after insert or update or delete on app.gl_mappings                 for each row execute function audit.tg_log_change('', 'purpose');
create trigger tg_audit after insert or update or delete on app.cost_centres                for each row execute function audit.tg_log_change('', 'code');
create trigger tg_audit after insert or update or delete on app.departments                 for each row execute function audit.tg_log_change('', 'code');
create trigger tg_audit after insert or update or delete on app.grades                      for each row execute function audit.tg_log_change('', 'code');
create trigger tg_audit after insert or update or delete on app.positions                   for each row execute function audit.tg_log_change('', 'code');
create trigger tg_audit after insert or update or delete on app.employee_groups             for each row execute function audit.tg_log_change('', 'name');
create trigger tg_audit after insert or update or delete on app.working_patterns            for each row execute function audit.tg_log_change('', 'name');
create trigger tg_audit after insert or update or delete on app.working_pattern_versions    for each row execute function audit.tg_log_change('', 'effective_from');
create trigger tg_audit after insert or update or delete on app.work_locations              for each row execute function audit.tg_log_change('', 'name');
create trigger tg_audit after insert or update or delete on app.holiday_calendar_years      for each row execute function audit.tg_log_change('', 'year');
create trigger tg_audit after insert or update or delete on app.public_holidays             for each row execute function audit.tg_log_change('', 'name');
create trigger tg_audit after insert or update or delete on app.public_holiday_states       for each row execute function audit.tg_log_change('', 'state');
create trigger tg_audit after insert or update or delete on app.privacy_notices             for each row execute function audit.tg_log_change('', 'title');
create trigger tg_audit after insert or update or delete on app.access_reviews              for each row execute function audit.tg_log_change('', 'review_month');

-- ===========================================================================
-- Function privileges
-- ===========================================================================
revoke execute on function
  app.holiday_year_published(int), app.holiday_visible(uuid), app.user_display_names(uuid[]),
  app.direct_reportee_counts(uuid[]), app.pattern_day_type(uuid, date),
  app.regenerate_replacement_holidays(int, app.my_state), app.holiday_year_checks(int),
  app.publish_holiday_year(int, boolean), app.publish_privacy_notice(text, text, uuid, date),
  app.tg_departments_guard(), app.tg_positions_guard(), app.tg_work_locations_guard(), app.tg_working_patterns_guard(),
  app.tg_pattern_versions_guard(), app.tg_public_holidays_guard(), app.tg_public_holiday_states_guard(),
  app.tg_holiday_states_regen(), app.tg_holidays_regen(), app.tg_patterns_regen(), app.tg_access_reviews_stamp(),
  app.tg_company_profile_guard(), app.tg_app_users_guard(), app.tg_user_roles_after()
  from public, anon, authenticated, service_role;

grant execute on function
  app.holiday_year_published(int), app.holiday_visible(uuid), app.user_display_names(uuid[]),
  app.direct_reportee_counts(uuid[]), app.pattern_day_type(uuid, date), app.holiday_year_checks(int),
  app.publish_holiday_year(int, boolean), app.publish_privacy_notice(text, text, uuid, date)
  to authenticated;
grant execute on function
  app.holiday_year_published(int), app.holiday_visible(uuid), app.pattern_day_type(uuid, date),
  app.regenerate_replacement_holidays(int, app.my_state)
  to service_role;

-- audit.write_admin_event: owned by audit_writer (like audit.write_access).
revoke execute on function audit.write_admin_event(app.audit_action, text, uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function app.is_admin(), app.has_role(app.privileged_role), app.mfa_required_privileged(), app.current_aal()
  to audit_writer;
grant create on schema audit to audit_writer;          -- needed only while ownership is transferred
alter function audit.write_admin_event(app.audit_action, text, uuid, text, jsonb) owner to audit_writer;
revoke create on schema audit from audit_writer;
set role audit_writer;
grant execute on function audit.write_admin_event(app.audit_action, text, uuid, text, jsonb) to authenticated;
reset role;
