-- PRET W2-004 · 02 — leave engine: calendar resolver, day weights, entitlement (bands, pro-rating, accrual, EA floor),
-- balances from the ledger, summary cache, team-calendar projection.
-- Design: ADR-0005 (ledger + per-day rows), PRD §6.7 (BR-LV-10–27), §6.15 (pool), §6.16 (carry-forward FIFO), Q-ARCH-03.
-- The same rules are mirrored in src/server/contracts/leave-engine.ts (reference implementation; both are tested against
-- the PRD examples). Definer functions pin search_path = ''; the ones callable by users re-check the caller.

-- ===========================================================================
-- Small pure helpers
-- ===========================================================================
create or replace function app.round_leave(p_value numeric, p_rounding app.leave_rounding) returns numeric
language sql immutable set search_path = '' as $$
  select case p_rounding
    when 'up_half'      then ceil(round(p_value, 6) * 2) / 2
    when 'nearest_half' then floor(round(p_value, 6) * 2 + 0.5) / 2
    when 'down_half'    then floor(round(p_value, 6) * 2) / 2
    else floor(round(p_value, 6)) + case when round(p_value, 6) - floor(round(p_value, 6)) >= 0.5 then 1 else 0 end
  end::numeric(6,1)
$$;

-- BR-LV-10 completed years of service on a date (0 before the service date)
create or replace function app.service_years(p_start date, p_on date) returns int
language sql immutable set search_path = '' as $$
  select case when p_on < p_start then 0 else extract(year from age(p_on, p_start))::int end
$$;

-- completed months between two dates (inclusive end) — L-03 / LP3
create or replace function app.completed_months(p_from date, p_to date) returns int
language sql immutable set search_path = '' as $$
  select case when p_to < p_from then 0
              else (extract(year from age(p_to + 1, p_from)) * 12 + extract(month from age(p_to + 1, p_from)))::int end
$$;

-- working-day weight of one date (mirror of leave-engine.dayWeight)
create or replace function app.leave_day_weight(p_day_type app.day_type, p_holiday_name text, p_holiday_half boolean,
                                                p_session app.leave_session, p_basis app.count_basis,
                                                out weight numeric, out kind text, out label text)
language plpgsql immutable set search_path = '' as $$
declare v_base numeric;
begin
  if p_basis <> 'working_days' then
    weight := case when p_session = 'full' then 1 else 0.5 end; kind := 'calendar'; label := 'Calendar day'; return;
  end if;
  if p_day_type is null then weight := 0; kind := 'not_employed'; label := 'No working pattern'; return; end if;
  if p_day_type = 'rest' then weight := 0; kind := 'rest'; label := 'Rest day'; return; end if;
  if p_day_type = 'off' then weight := 0; kind := 'off'; label := 'Off day'; return; end if;
  if p_holiday_name is not null and not coalesce(p_holiday_half, false) then
    weight := 0; kind := 'public_holiday'; label := left('Public holiday: ' || p_holiday_name, 150); return;
  end if;
  v_base := case when p_day_type = 'full' then 1 else 0.5 end;
  kind := case when p_day_type = 'full' then 'working' else 'half_working' end;
  label := case when p_day_type = 'full' then 'Working day' else 'Half working day' end;
  if p_holiday_name is not null then
    v_base := case when p_day_type = 'full' then 0.5 else 0 end;
    kind := 'half_public_holiday'; label := left('Half-day public holiday: ' || p_holiday_name, 150);
  end if;
  weight := case when p_session = 'full' then v_base else least(v_base, 0.5) end;
end $$;

-- ===========================================================================
-- Calendar resolver (single source for every path — ADR-0005). Per date: the job-history row in force
-- (pattern, location → state), F20 PH-state override, published PHs of that state, replacement holidays
-- of (state, pattern), and whether the person is employed (join date … LWD).
-- ===========================================================================
create or replace function app.employee_calendar(p_employee_id uuid, p_from date, p_to date)
returns table (cal_date date, day_type app.day_type, state app.my_state, pattern_id uuid, holiday_name text, holiday_half boolean, employed boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp record; v_override app.my_state; v_lwd date; d date;
  v_pat uuid; v_loc uuid; v_state app.my_state; v_dt app.day_type; v_hname text; v_hhalf boolean;
begin
  if p_to < p_from or p_to - p_from > 800 then
    raise exception 'PRET-LV-RANGE: the date range is too long' using errcode = '22023';
  end if;
  select e.id, e.join_date, e.working_pattern_id, e.work_location_id, e.work_state into v_emp from app.employees e where e.id = p_employee_id;
  if v_emp.id is null then return; end if;
  select h.ph_state_override into v_override from app.employee_hr_private h where h.employee_id = p_employee_id;
  v_lwd := app.employee_active_lwd(p_employee_id);
  d := p_from;
  while d <= p_to loop
    select h.working_pattern_id, h.work_location_id into v_pat, v_loc
      from app.employee_job_history h
     where h.employee_id = p_employee_id and not h.is_deleted and h.effective_date <= d
     order by h.effective_date desc limit 1;
    if v_pat is null then v_pat := v_emp.working_pattern_id; v_loc := v_emp.work_location_id; end if;
    select l.state into v_state from app.work_locations l where l.id = v_loc;
    v_state := coalesce(v_override, v_state, v_emp.work_state);
    v_dt := app.pattern_day_type(v_pat, d);
    if v_dt is null then                                                    -- before the first pattern version: use the earliest
      select case extract(isodow from d)::int when 1 then v.mon when 2 then v.tue when 3 then v.wed when 4 then v.thu
                  when 5 then v.fri when 6 then v.sat else v.sun end
        into v_dt from app.working_pattern_versions v where v.pattern_id = v_pat order by v.effective_from limit 1;
    end if;
    v_hname := null; v_hhalf := null;
    select string_agg(h.name, ' / ' order by h.name), bool_and(h.is_half_day) into v_hname, v_hhalf
      from app.public_holidays h join app.public_holiday_states s on s.holiday_id = h.id and s.state = v_state
     where h.holiday_date = d and h.is_active and h.is_observed and app.holiday_year_published(h.year);
    if v_hname is null then
      select 'Replacement holiday (' || h.name || ')', false into v_hname, v_hhalf
        from app.replacement_holidays r join app.public_holidays h on h.id = r.source_holiday_id
       where r.state = v_state and r.pattern_id = v_pat and r.replacement_date = d and r.is_active and app.holiday_year_published(h.year)
       limit 1;
    end if;
    cal_date := d; day_type := v_dt; state := v_state; pattern_id := v_pat; holiday_name := v_hname; holiday_half := v_hhalf;
    employed := d >= v_emp.join_date and (v_lwd is null or d <= v_lwd);
    return next;
    v_pat := null; v_loc := null; v_state := null;
    d := d + 1;
  end loop;
end $$;

-- Per-date weights of a range (BR-LV-21–23). Session rules BR-LV-22 are validated by the caller.
create or replace function app.leave_count(p_employee_id uuid, p_start date, p_start_session app.leave_session,
                                           p_end date, p_end_session app.leave_session, p_basis app.count_basis)
returns table (leave_date date, session app.leave_session, weight numeric, kind text, label text, employed boolean)
language sql stable security definer set search_path = '' as $$
  select c.cal_date,
         s.sess,
         case when c.employed then w.weight else 0 end,
         case when c.employed then w.kind else 'not_employed' end,
         case when c.employed then w.label else 'Not employed on this date' end,
         c.employed
    from app.employee_calendar(p_employee_id, p_start, p_end) c
   cross join lateral (select (case when p_start = p_end then p_start_session
                                    when c.cal_date = p_start then p_start_session
                                    when c.cal_date = p_end then p_end_session
                                    else 'full' end)::app.leave_session as sess) s
   cross join lateral app.leave_day_weight(c.day_type, c.holiday_name, c.holiday_half, s.sess, p_basis) w
$$;

-- Working days between two dates (exclusive start, inclusive end) on an employee's calendar — LT20 / reminders.
create or replace function app.working_days_between(p_employee_id uuid, p_from date, p_to date) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(count(*) filter (where c.day_type in ('full','half') and c.holiday_name is null), 0)::int
    from app.employee_calendar(p_employee_id, p_from + 1, greatest(p_to, p_from + 1)) c
   where p_to > p_from
$$;

-- The date N working days before p_on (LT20 back-date window).
create or replace function app.working_days_back(p_employee_id uuid, p_on date, p_n int) returns date
language plpgsql stable security definer set search_path = '' as $$
declare v_d date := p_on; v_left int := p_n; r record;
begin
  if p_n <= 0 then return p_on; end if;
  for r in select c.cal_date, c.day_type, c.holiday_name from app.employee_calendar(p_employee_id, p_on - 120, p_on - 1) c order by c.cal_date desc loop
    if r.day_type in ('full','half') and r.holiday_name is null then
      v_left := v_left - 1;
      if v_left = 0 then return r.cal_date; end if;
    end if;
  end loop;
  return p_on - 120;
end $$;

-- ===========================================================================
-- Entitlement (BR-LV-11–16, LP2–LP5, F-LV-31)
-- ===========================================================================
-- Band days for a service value: band set of the latest effective year ≤ p_year (else the earliest); grade row wins.
create or replace function app.leave_band_days(p_type_id uuid, p_year int, p_grade_id uuid, p_years int) returns numeric
language sql stable security definer set search_path = '' as $$
  with v as (
    select coalesce((select max(b.effective_year) from app.leave_entitlement_bands b where b.leave_type_id = p_type_id and b.effective_year <= p_year),
                    (select min(b.effective_year) from app.leave_entitlement_bands b where b.leave_type_id = p_type_id)) as y)
  select coalesce(
    (select b.days_per_year from app.leave_entitlement_bands b, v
      where b.leave_type_id = p_type_id and b.effective_year = v.y and b.grade_id = p_grade_id
        and p_years >= b.service_from_years and (b.service_to_years is null or p_years < b.service_to_years) limit 1),
    (select b.days_per_year from app.leave_entitlement_bands b, v
      where b.leave_type_id = p_type_id and b.effective_year = v.y and b.grade_id is null
        and p_years >= b.service_from_years and (b.service_to_years is null or p_years < b.service_to_years) limit 1),
    0)
$$;

create or replace function app.statutory_min_days(p_category app.leave_category, p_years numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select m.min_days from app.statutory_leave_minimums m
   where m.category = p_category and p_years >= m.service_from_years and (m.service_to_years is null or p_years < m.service_to_years)
   limit 1
$$;

-- Σ band(d) / days-in-year over [p_from, p_to] (by day, segment per service year) or Σ band(slice start) / 12
-- over completed month slices from p_from (by month). p_override replaces the band.
create or replace function app.leave_accrue(p_type_id uuid, p_year int, p_grade_id uuid, p_service_start date, p_from date, p_to date,
                                            p_basis app.prorate_basis, p_override numeric) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  v_n numeric := (make_date(p_year + 1, 1, 1) - make_date(p_year, 1, 1));
  v_sum numeric := 0; v_k int; v_seg_from date; v_seg_to date; v_band numeric; v_s date; v_e date; i int := 0;
begin
  if p_to < p_from then return 0; end if;
  if p_basis = 'by_day' then
    v_k := app.service_years(p_service_start, p_from);
    v_seg_from := p_from;
    loop
      v_seg_to := least(p_to, (p_service_start + make_interval(years => v_k + 1))::date - 1);
      if v_seg_to < v_seg_from then v_seg_to := p_to; end if;
      v_band := coalesce(p_override, app.leave_band_days(p_type_id, p_year, p_grade_id, v_k));
      v_sum := v_sum + v_band * (v_seg_to - v_seg_from + 1);
      exit when v_seg_to >= p_to;
      v_seg_from := v_seg_to + 1; v_k := app.service_years(p_service_start, v_seg_from);
    end loop;
    return v_sum / v_n;
  end if;
  loop
    v_s := (p_from + make_interval(months => i))::date;
    v_e := (p_from + make_interval(months => i + 1))::date - 1;
    exit when v_e > p_to;
    v_sum := v_sum + coalesce(p_override, app.leave_band_days(p_type_id, p_year, p_grade_id, app.service_years(p_service_start, v_s)));
    i := i + 1;
  end loop;
  return v_sum / 12;
end $$;

-- Effective entitlement method for an employee/type/year (LP2, LT8, accrual-first-year-then-full).
create or replace function app.entitlement_method_for(p_type_id uuid, p_join date, p_year int) returns app.accrual_method
language sql stable security definer set search_path = '' as $$
  select case when m = 'accrual_first_year_then_full'
              then (case when extract(year from p_join)::int = p_year then 'accrual_pro_rata' else 'full_pro_rated' end)::app.accrual_method
              else m end
    from (select case when t.accrual_override = 'policy_default' then p.entitlement_method else t.accrual_override end as m
            from app.leave_types t cross join app.leave_policy p where t.id = p_type_id and p.id = 1) x
$$;

-- Yearly entitlement (and earned to date) for one employee/type/year. p_lwd overrides the LWD (E7 preview);
-- p_join / p_service / p_grade allow the E2 wizard preview before the employee exists (employee id null).
create or replace function app.compute_entitlement(p_employee_id uuid, p_type_id uuid, p_year int, p_as_at date default null,
                                                   p_lwd date default null, p_join date default null, p_service date default null,
                                                   p_grade uuid default null, p_gender app.gender default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t app.leave_types%rowtype; p app.leave_policy%rowtype;
  v_join date; v_service date; v_grade uuid; v_gender app.gender; v_lwd date; v_override numeric;
  ys date := make_date(p_year, 1, 1); ye date := make_date(p_year, 12, 31); a date; b date;
  v_raw numeric; v_ent numeric; v_floor numeric := null; v_floor_applied boolean := false; v_method app.accrual_method;
  v_earned numeric := null; v_stat numeric;
begin
  select * into t from app.leave_types where id = p_type_id;
  select * into p from app.leave_policy where id = 1;
  if p_employee_id is not null then
    select e.join_date, coalesce(pp.continuous_service_date, e.join_date), e.grade_id, e.gender
      into v_join, v_service, v_grade, v_gender
      from app.employees e left join app.employee_personal pp on pp.employee_id = e.id where e.id = p_employee_id;
    v_lwd := coalesce(p_lwd, app.employee_active_lwd(p_employee_id));
    select o.days into v_override from app.leave_entitlement_overrides o
     where o.employee_id = p_employee_id and o.leave_type_id = p_type_id and o.leave_year = p_year and o.is_active;
  else
    v_join := p_join; v_service := coalesce(p_service, p_join); v_grade := p_grade; v_gender := p_gender; v_lwd := p_lwd;
  end if;
  if t.id is null or v_join is null then return null; end if;
  if t.entitlement_method not in ('annual_banded','no_entitlement') or (t.entitlement_method = 'no_entitlement' and t.annual_cap_days is null) then
    return null;                                                        -- per-occurrence / credits / approval-only: no yearly entitlement
  end if;
  a := greatest(ys, v_join); b := least(ye, coalesce(v_lwd, ye));
  v_method := app.entitlement_method_for(p_type_id, v_join, p_year);
  if a > b or (t.eligible_gender <> 'all' and v_gender is not null and t.eligible_gender::text <> v_gender::text) then
    return jsonb_build_object('entitled', 0, 'unrounded', 0, 'method', v_method, 'active_from', null, 'active_to', null,
                              'earned_to_date', 0, 'floor_applied', false, 'override', v_override);
  end if;
  if t.entitlement_method = 'no_entitlement' then
    v_raw := coalesce(v_override, t.annual_cap_days);
    v_ent := v_raw;
  elsif t.prorate_joiners_leavers then
    v_raw := app.leave_accrue(p_type_id, p_year, v_grade, v_service, a, b, p.prorate_basis, v_override);
    v_ent := app.round_leave(v_raw, p.rounding);
    if p.ea_floor_for_joiners_leavers and (a > ys or b < ye) then
      v_stat := app.statutory_min_days(t.category, app.service_years(v_service, b));
      if v_stat is not null then
        v_floor := app.round_leave(v_stat * app.completed_months(a, b) / 12, 'employment_act');
        if v_floor > v_ent then v_ent := v_floor; v_floor_applied := true; end if;
      end if;
    end if;
  else
    v_raw := app.leave_accrue(p_type_id, p_year, v_grade, v_service, ys, ye, 'by_day', v_override);
    v_ent := app.round_leave(v_raw, p.rounding);
  end if;
  if p_as_at is not null then
    if v_method = 'accrual_pro_rata' and t.entitlement_method = 'annual_banded' then
      if p_as_at < a then v_earned := 0;
      elsif p_as_at >= b then v_earned := v_ent;
      else v_earned := least(v_ent, app.round_leave(app.leave_accrue(p_type_id, p_year, v_grade, v_service,
                                     case when t.prorate_joiners_leavers then a else ys end, p_as_at, p.prorate_basis, v_override), p.rounding));
      end if;
    else
      v_earned := v_ent;
    end if;
  end if;
  return jsonb_build_object('entitled', v_ent, 'unrounded', round(v_raw, 6), 'method', v_method, 'active_from', a, 'active_to', b,
                            'earned_to_date', v_earned, 'floor_applied', v_floor_applied, 'ea_floor', v_floor, 'override', v_override,
                            'rounding', p.rounding, 'basis', p.prorate_basis, 'service_start', v_service);
end $$;

-- ===========================================================================
-- Summary cache (BR-LV-20) — recomputed from the ledger + open applications; never edited directly.
-- ===========================================================================
create or replace function app.balance_type_id(p_type_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(t.deduct_from_type_id, t.id) from app.leave_types t where t.id = p_type_id
$$;

create or replace function app.refresh_leave_summary(p_employee_id uuid, p_type_id uuid, p_year int) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into app.leave_balance_summary as s (employee_id, leave_type_id, leave_year, entitled, carried_forward, earned_credits, adjustments,
                                              taken, expired_forfeited, pending, refreshed_at)
  select p_employee_id, p_type_id, p_year,
         coalesce(sum(l.days) filter (where l.entry_type = 'entitlement'), 0),
         coalesce(sum(l.days) filter (where l.entry_type = 'carry_forward'), 0),
         coalesce(sum(l.days) filter (where l.entry_type = 'credit_earned'), 0),
         coalesce(sum(l.days) filter (where l.entry_type = 'adjustment'), 0),
         coalesce(-sum(l.days) filter (where l.entry_type in ('taken','taken_reversal')), 0),
         coalesce(-sum(l.days) filter (where l.entry_type in ('expired','forfeited')), 0),
         coalesce((select sum(a.days) from app.leave_applications a
                    where a.employee_id = p_employee_id and a.leave_year = p_year and a.status = 'pending'
                      and app.balance_type_id(a.leave_type_id) = p_type_id), 0),
         now()
    from app.leave_ledger l
   where l.employee_id = p_employee_id and l.leave_type_id = p_type_id and l.leave_year = p_year
  on conflict (employee_id, leave_type_id, leave_year) do update
     set entitled = excluded.entitled, carried_forward = excluded.carried_forward, earned_credits = excluded.earned_credits,
         adjustments = excluded.adjustments, taken = excluded.taken, expired_forfeited = excluded.expired_forfeited,
         pending = excluded.pending, refreshed_at = now();
end $$;

-- Rebuild every summary row (maintenance; ADR-0005 "rebuildable").
create or replace function app.rebuild_leave_summaries() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select distinct employee_id, leave_type_id, leave_year from app.leave_ledger
           union select distinct employee_id, app.balance_type_id(leave_type_id), leave_year from app.leave_applications loop
    perform app.refresh_leave_summary(r.employee_id, r.leave_type_id, r.leave_year); n := n + 1;
  end loop;
  return n;
end $$;

-- ===========================================================================
-- Balance for validation / preview (BR-LV-14, BR-LV-20, BR-LV-31, BR-LV-53, BR-LV-71 FIFO, BR-LV-81 credit expiry)
-- p_as_at = last leave day (accrual reference; carry-forward/credit usability); p_exclude = the application being re-checked.
-- ===========================================================================
create or replace function app.leave_balance(p_employee_id uuid, p_type_id uuid, p_year int, p_as_at date default null,
                                             p_exclude uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t app.leave_types%rowtype; v_bt uuid := app.balance_type_id(p_type_id); bt app.leave_types%rowtype;
  v_ent numeric; v_cf numeric; v_cr numeric; v_adj numeric; v_taken numeric; v_exp numeric; v_pend numeric;
  v_earned numeric := null; v_calc jsonb; v_basis numeric; v_unusable numeric := 0; v_avail numeric; v_bal numeric;
  v_pool_cap numeric := null; v_pool_used numeric := null; v_pool_types uuid[]; v_pool_label text; r record; v_used_before numeric;
  v_has_balance boolean;
begin
  select * into t from app.leave_types where id = p_type_id;
  select * into bt from app.leave_types where id = v_bt;
  select coalesce(sum(days) filter (where entry_type = 'entitlement'), 0),
         coalesce(sum(days) filter (where entry_type = 'carry_forward'), 0),
         coalesce(sum(days) filter (where entry_type = 'credit_earned'), 0),
         coalesce(sum(days) filter (where entry_type = 'adjustment'), 0),
         coalesce(-sum(days) filter (where entry_type in ('taken','taken_reversal')), 0),
         coalesce(-sum(days) filter (where entry_type in ('expired','forfeited')), 0)
    into v_ent, v_cf, v_cr, v_adj, v_taken, v_exp
    from app.leave_ledger where employee_id = p_employee_id and leave_type_id = v_bt and leave_year = p_year;
  select coalesce(sum(a.days), 0) into v_pend from app.leave_applications a
   where a.employee_id = p_employee_id and a.leave_year = p_year and a.status = 'pending'
     and app.balance_type_id(a.leave_type_id) = v_bt and a.id is distinct from p_exclude
     and (p_exclude is null or a.split_group_id is distinct from (select x.split_group_id from app.leave_applications x where x.id = p_exclude) or a.split_group_id is null);
  v_bal := v_ent + v_cf + v_cr + v_adj - v_taken - v_exp;
  v_basis := v_ent;
  -- accrual: earned to date at the reference date replaces the yearly entitlement
  if bt.entitlement_method = 'annual_banded' then
    v_calc := app.compute_entitlement(p_employee_id, v_bt, p_year, coalesce(p_as_at, least(app.today_myt(), make_date(p_year, 12, 31))));
    if v_calc is not null and (v_calc ->> 'method') = 'accrual_pro_rata' then
      v_earned := (v_calc ->> 'earned_to_date')::numeric;
      -- entitlement ledger rows include opening/recalc deltas; scale: earned = ledger entitlement × (earned / yearly) when yearly > 0
      if (v_calc ->> 'entitled')::numeric > 0 then
        v_basis := least(v_ent, v_earned + greatest(v_ent - (v_calc ->> 'entitled')::numeric, 0));
      end if;
    end if;
  end if;
  -- carry-forward not used before its expiry is unusable for later dates (FIFO, Q-ARCH-03)
  if p_as_at is not null then
    for r in select l.id, l.days, l.expires_on from app.leave_ledger l
              where l.employee_id = p_employee_id and l.leave_type_id = v_bt and l.leave_year = p_year and l.entry_type = 'carry_forward'
                and l.expires_on is not null and l.expires_on < p_as_at
                and not exists (select 1 from app.leave_ledger x where x.source_ledger_id = l.id and x.entry_type = 'expired') loop
      select coalesce(sum(d.weight), 0) into v_used_before from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
       where d.employee_id = p_employee_id and d.leave_year = p_year and d.is_blocking and d.leave_date <= r.expires_on
         and app.balance_type_id(a.leave_type_id) = v_bt and a.id is distinct from p_exclude;
      v_unusable := v_unusable + greatest(r.days - v_used_before, 0);
    end loop;
    -- replacement credits that expire before the leave date cannot be used (BR-LV-81/82)
    if bt.entitlement_method = 'earned_credits' then
      select v_unusable + coalesce(sum(c.remaining_days), 0) into v_unusable from app.replacement_credits c
       where c.employee_id = p_employee_id and c.status = 'approved' and c.expired_at is null and c.expiry_date < p_as_at
         and c.remaining_days > 0;
    end if;
  end if;
  v_has_balance := bt.entitlement_method in ('annual_banded','earned_credits') or (bt.entitlement_method = 'no_entitlement' and bt.annual_cap_days is not null);
  v_avail := v_basis + v_cf + v_cr + v_adj - v_taken - v_exp - v_pend - v_unusable;
  -- aggregate pool (BR-LV-31: HL + SL ≤ 60)
  select coalesce(t2.pool_cap_days, t3.pool_cap_days),
         array_remove(array[v_bt, coalesce(t2.pool_with_type_id, t3.id)], null)
    into v_pool_cap, v_pool_types
    from (select 1) one
    left join app.leave_types t2 on t2.id = v_bt and t2.pool_with_type_id is not null
    left join app.leave_types t3 on t3.pool_with_type_id = v_bt and t3.is_active;
  if v_pool_cap is not null then
    select coalesce(-sum(l.days) filter (where l.entry_type in ('taken','taken_reversal')), 0) into v_pool_used
      from app.leave_ledger l where l.employee_id = p_employee_id and l.leave_year = p_year and l.leave_type_id = any(v_pool_types);
    v_pool_used := v_pool_used + coalesce((select sum(a.days) from app.leave_applications a
      where a.employee_id = p_employee_id and a.leave_year = p_year and a.status = 'pending' and app.balance_type_id(a.leave_type_id) = any(v_pool_types)
        and a.id is distinct from p_exclude), 0);
    select string_agg(x.name, ' + ' order by x.display_order) into v_pool_label from app.leave_types x where x.id = any(v_pool_types);
    if v_has_balance then v_avail := least(v_avail, v_pool_cap - v_pool_used); else v_avail := v_pool_cap - v_pool_used; v_has_balance := true; end if;
  end if;
  return jsonb_build_object(
    'balance_type_id', v_bt, 'has_balance', v_has_balance,
    'entitled', v_ent, 'carried_forward', v_cf, 'earned_credits', v_cr, 'adjustments', v_adj, 'taken', v_taken,
    'expired_forfeited', v_exp, 'pending', v_pend, 'balance', v_bal, 'available', v_avail,
    'earned_to_date', v_earned, 'unusable_expiring', v_unusable,
    'pool', case when v_pool_cap is null then null else jsonb_build_object('label', v_pool_label || ' pool', 'used', v_pool_used, 'cap', v_pool_cap) end,
    'allow_negative', bt.allow_negative, 'max_negative', bt.max_negative_days);
end $$;

-- ===========================================================================
-- Entitlement generation (F-LV-04): yearly row + ledger delta ("Entitlement" / "Recalculated")
-- ===========================================================================
create or replace function app.refresh_entitlement(p_employee_id uuid, p_type_id uuid, p_year int, p_note text default null) returns numeric
language plpgsql volatile security definer set search_path = '' as $$
declare v_calc jsonb; v_ent numeric; v_posted numeric; v_delta numeric; v_hash bytea; v_join date; v_eff date;
begin
  v_calc := app.compute_entitlement(p_employee_id, p_type_id, p_year);
  if v_calc is null then return null; end if;
  v_ent := (v_calc ->> 'entitled')::numeric;
  v_hash := extensions.digest(v_calc::text, 'sha256');
  insert into app.leave_entitlements as e (employee_id, leave_type_id, leave_year, entitled_days, method, calc_detail, engine_version, inputs_hash, computed_at)
  values (p_employee_id, p_type_id, p_year, v_ent, (v_calc ->> 'method')::app.accrual_method, v_calc, 'w2-004.1', v_hash, now())
  on conflict (employee_id, leave_type_id, leave_year) do update
     set entitled_days = excluded.entitled_days, method = excluded.method, calc_detail = excluded.calc_detail,
         engine_version = excluded.engine_version, inputs_hash = excluded.inputs_hash, computed_at = now()
   where e.inputs_hash is distinct from excluded.inputs_hash;
  select coalesce(sum(l.days), 0) into v_posted from app.leave_ledger l
   where l.employee_id = p_employee_id and l.leave_type_id = p_type_id and l.leave_year = p_year and l.entry_type = 'entitlement' and not l.is_opening;
  v_delta := v_ent - v_posted;
  if v_delta <> 0 then
    select e.join_date into v_join from app.employees e where e.id = p_employee_id;
    v_eff := greatest(make_date(p_year, 1, 1), least(v_join, make_date(p_year, 12, 31)));
    if v_posted <> 0 then v_eff := greatest(v_eff, least(app.today_myt(), make_date(p_year, 12, 31))); end if;
    insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, reason)
    values (p_employee_id, p_type_id, p_year, 'entitlement', v_delta, v_eff,
            left(case when v_posted = 0 then 'Entitlement ' || p_year
                      else coalesce(p_note, 'Recalculated') || ': ' || v_posted::text || ' → ' || v_ent::text end, 500));
  end if;
  return v_ent;
end $$;

-- All yearly entitlements for a year (one employee or everyone in service that year).
create or replace function app.generate_entitlements(p_year int, p_employee_id uuid default null, p_note text default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select e.id as emp, t.id as typ
             from app.employees e cross join app.leave_types t
            where (p_employee_id is null or e.id = p_employee_id)
              and t.is_active and (t.entitlement_method = 'annual_banded' or (t.entitlement_method = 'no_entitlement' and t.annual_cap_days is not null))
              and e.status <> 'withdrawn' and e.join_date <= make_date(p_year, 12, 31)
              and (app.employee_active_lwd(e.id) is null or app.employee_active_lwd(e.id) >= make_date(p_year, 1, 1)) loop
    if app.refresh_entitlement(r.emp, r.typ, p_year, p_note) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ===========================================================================
-- Team calendar projection (peer-safe; approved leave only, weight > 0)
-- ===========================================================================
create or replace function app.refresh_team_calendar(p_application_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare a record;
begin
  delete from app.team_calendar_entries c where c.application_id = p_application_id;
  select la.*, e.department_id, e.work_location_id into a
    from app.leave_applications la join app.employees e on e.id = la.employee_id where la.id = p_application_id;
  if a.id is null or a.status not in ('approved','cancellation_pending') then return; end if;
  insert into app.team_calendar_entries (employee_id, leave_date, session, department_id, work_location_id, application_id)
  select d.employee_id, d.leave_date, d.session, a.department_id, a.work_location_id, d.application_id
    from app.leave_application_days d where d.application_id = p_application_id and d.weight > 0
  on conflict (employee_id, leave_date, session) do update set application_id = excluded.application_id,
     department_id = excluded.department_id, work_location_id = excluded.work_location_id;
end $$;

-- User entry point (L11 RECOMPUTE / L13 REGENERATE ENTITLEMENTS): ADM/SA only.
create or replace function app.regenerate_entitlements(p_year int, p_employee_id uuid default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  return app.generate_entitlements(p_year, p_employee_id, 'Recalculated');
end $$;
