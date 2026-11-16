-- PRET W2-002 · 15 — deterministic "second holiday" for BR-ORG-22: holidays entered in the same
-- transaction share created_at, so order by (created_at, name, id) instead of (created_at, id).
-- Found by supabase/tests/w2_002_role_matrix.sql G3 (intermittent).
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
        select h.holiday_date, array_agg(h.id order by h.created_at, h.name, h.id) as ids
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

revoke execute on function app.regenerate_replacement_holidays(int, app.my_state) from public, anon, authenticated;
