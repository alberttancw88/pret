-- PRET W2-004 · 04 — leave workflow: validation + submission (BR-LV-22–58), approval subject handlers, transition guard
-- (§6.10, rls §7 layer 5), ledger rules (ADR-0005), replacement credits (§6.13), recount on calendar change (BR-LV-27),
-- year-end roll-over (§6.16), leavers (§6.17), opening balances (F-LV-35), configuration guards (BR-LV-01/02).
-- Every user-callable definer function re-checks the caller; every write lands in audit via the table triggers (05).

-- ===========================================================================
-- Helpers
-- ===========================================================================
create or replace function app.lv_issue(p_code text, p_field text, p_message text) returns jsonb
language sql immutable set search_path = '' as $$ select jsonb_build_array(jsonb_build_object('code', p_code, 'field', p_field, 'message', p_message)) $$;

create or replace function app.dmy(p_date date) returns text
language sql immutable set search_path = '' as $$ select to_char(p_date, 'DD/MM/YYYY') $$;

create or replace function app.leave_group(p_application_id uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select a.id from app.leave_applications a
   where a.id = p_application_id
      or (a.split_group_id is not null and a.split_group_id = (select x.split_group_id from app.leave_applications x where x.id = p_application_id))
$$;

create or replace function app.leave_event(p_application_id uuid, p_event text, p_from app.leave_status, p_to app.leave_status,
                                           p_acting app.acting_as default null, p_comment text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id();
begin
  insert into app.leave_application_events (application_id, employee_id, event, from_status, to_status, actor_user_id, actor_name, acting_as, comment)
  select a.id, a.employee_id, p_event, p_from, p_to, v_actor, coalesce(app.user_name(v_actor), 'System'), p_acting, left(p_comment, 500)
    from app.leave_applications a where a.id = p_application_id;
end $$;

create or replace function app.notify_employee(p_employee_id uuid, p_code text, p_title text, p_body text, p_link text, p_action boolean,
                                               p_template text, p_payload jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_user uuid := app.employee_user_id(p_employee_id);
begin
  if v_user is not null then perform app.notify(v_user, p_code, left(p_title, 150), left(p_body, 500), p_link, p_action, p_template, p_payload); end if;
end $$;

-- ===========================================================================
-- Ledger rules (append-only; adjustments by HR for others only — rls §6 / FR-G-16)
-- ===========================================================================
create or replace function app.tg_ledger_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id();
begin
  if tg_op <> 'INSERT' then raise exception 'PRET-LEDGER-IMMUTABLE: ledger rows cannot be changed' using errcode = '42501'; end if;
  new.effective_date := coalesce(new.effective_date, app.today_myt());
  new.created_at := now();
  if v_actor is not null then new.created_by := v_actor; end if;
  if current_user = 'authenticated' then                                        -- a direct user write: adjustments only
    if new.entry_type <> 'adjustment' or new.is_opening or not app.is_admin() then
      raise exception 'PRET-ACC-403' using errcode = '42501';
    end if;
    if new.employee_id = app.current_employee_id() then
      raise exception 'PRET-SELF-001: you cannot adjust your own leave balance' using errcode = '42501';
    end if;
    if new.source_application_id is not null or new.source_credit_id is not null or new.source_rollover_id is not null or new.expires_on is not null then
      raise exception 'PRET-ACC-403' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create or replace function app.tg_ledger_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_t record;
begin
  perform app.refresh_leave_summary(new.employee_id, new.leave_type_id, new.leave_year);
  if new.entry_type = 'adjustment' and not new.is_opening then                  -- N-10
    select code, name into v_t from app.leave_types where id = new.leave_type_id;
    perform app.notify_employee(new.employee_id, 'N-10', 'Your ' || v_t.name || ' balance was adjusted',
      (case when new.days > 0 then '+' else '' end) || new.days::text || ' day(s) for ' || new.leave_year || ': ' || coalesce(new.reason, ''),
      '/my/leave/balances/' || v_t.code || '?year=' || new.leave_year, false, 'leave_balance_adjusted',
      jsonb_build_object('type', v_t.name, 'days', new.days, 'year', new.leave_year, 'reason', new.reason));
  end if;
  return null;
end $$;

-- ===========================================================================
-- Validation + submission (P2 / L2). One function evaluates (preview) and, with p_commit, submits.
-- Input keys: employee_id, leave_type_id, start_date, start_session, end_date, end_session, reason, expected_confinement_date,
-- child_birth_date, contact_phone, cover_employee_id, on_behalf_reason, attachment_file_ids[], attachment_count,
-- acknowledge_warnings, idempotency_key.
-- ===========================================================================
create or replace function app.leave_evaluate(p jsonb, p_commit boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id(); v_me uuid := app.current_employee_id(); v_today date := app.today_myt();
  v_emp uuid; v_on_behalf boolean; t app.leave_types%rowtype; pol app.leave_policy%rowtype; e record;
  v_start date; v_end date; v_ss app.leave_session; v_es app.leave_session; v_fixed boolean := false;
  v_blocks jsonb := '[]'; v_warn jsonb := '[]'; v_notes jsonb := '[]'; v_breakdown jsonb := '[]'; v_parts jsonb := '[]';
  v_total numeric := 0; v_lwd date; v_csd date; v_marital app.marital_status; v_files uuid[]; v_att_count int;
  v_y int; v_cur int := extract(year from app.today_myt())::int; v_lp8 date; r record; v_bal jsonb; v_part_days numeric;
  v_avail numeric; v_emergency boolean := false; v_backdated boolean := false; v_beyond boolean := false; v_limit date;
  v_occ int; v_max_occ int; v_att_required boolean := false; v_att_pending boolean := false; v_conflict record;
  v_hint text; v_lvl record; v_levels int; v_name text; v_first_bal jsonb := null; v_key uuid; v_existing record;
  v_base text; v_group uuid; v_ids jsonb := '[]'; v_app uuid; v_level int; v_status app.leave_status; v_reason text;
  v_onb text; v_pat_window int; v_conf date; v_birth date; v_mgr_user uuid; v_ack boolean; v_idx int := 0;
begin
  if v_actor is null then raise exception 'PRET-ACC-401' using errcode = '42501'; end if;
  v_emp := coalesce(nullif(p ->> 'employee_id', '')::uuid, v_me);
  if v_emp is null then raise exception 'PRET-LV-NO-EMPLOYEE: your employee record has not been created yet' using errcode = '23514'; end if;
  v_on_behalf := v_emp is distinct from v_me;
  if v_on_behalf and not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if p_commit then perform pg_advisory_xact_lock(hashtext('leave:' || v_emp::text)); end if;

  -- idempotency (EC-LV-09)
  v_key := nullif(p ->> 'idempotency_key', '')::uuid;
  if p_commit and v_key is not null then
    select a.id, a.ref_no, a.status, a.current_level, a.total_levels into v_existing from app.leave_applications a
     where a.idempotency_key = v_key and a.employee_id = v_emp order by a.split_part nulls first limit 1;
    if v_existing.id is not null then
      return jsonb_build_object('duplicate', true, 'status', v_existing.status, 'level', v_existing.current_level, 'levels', v_existing.total_levels,
        'applications', (select jsonb_agg(jsonb_build_object('id', a.id, 'ref_no', a.ref_no, 'year', a.leave_year, 'days', a.days) order by a.split_part)
                           from app.leave_applications a where a.idempotency_key = v_key and a.employee_id = v_emp),
        'blocks', '[]'::jsonb, 'warnings', '[]'::jsonb);
    end if;
  end if;

  select * into pol from app.leave_policy where id = 1;
  select * into t from app.leave_types where id = nullif(p ->> 'leave_type_id', '')::uuid;
  select x.id, x.status, x.join_date, x.gender, x.probation_end_date, x.extended_probation_end_date, x.confirmation_date,
         x.manager_employee_id, x.employee_no, coalesce(x.preferred_name, x.full_name) as name
    into e from app.employees x where x.id = v_emp;
  if e.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if t.id is null or not t.is_active then
    return jsonb_build_object('blocks', app.lv_issue('BR-LV-51', 'leaveTypeId', 'Select an active leave type.'), 'warnings', '[]'::jsonb,
      'notes', '[]'::jsonb, 'breakdown', '[]'::jsonb, 'parts', '[]'::jsonb, 'days', 0, 'end_date', p ->> 'end_date', 'end_fixed', false);
  end if;
  if not t.visible_to_employees and not v_on_behalf then
    v_blocks := v_blocks || app.lv_issue('BR-LV-51', 'leaveTypeId', t.name || ' can only be recorded by HR.');
  end if;

  -- dates and sessions (BR-LV-22/23)
  v_start := (p ->> 'start_date')::date;
  v_ss := coalesce(nullif(p ->> 'start_session', ''), 'full')::app.leave_session;
  v_es := coalesce(nullif(p ->> 'end_session', ''), 'full')::app.leave_session;
  if t.count_basis = 'consecutive_calendar_days' then
    v_end := v_start + (ceil(t.days_per_occurrence)::int - 1); v_fixed := true; v_ss := 'full'; v_es := 'full';
  else
    v_end := coalesce(nullif(p ->> 'end_date', '')::date, v_start);
  end if;
  if v_end < v_start then
    return jsonb_build_object('blocks', app.lv_issue('DATES', 'endDate', 'End date must be on or after the start date.'), 'warnings', '[]'::jsonb,
      'notes', '[]'::jsonb, 'breakdown', '[]'::jsonb, 'parts', '[]'::jsonb, 'days', 0, 'end_date', v_end, 'end_fixed', v_fixed);
  end if;
  if v_end - v_start > 400 then
    return jsonb_build_object('blocks', app.lv_issue('DATES', 'endDate', 'An application can cover at most 400 days.'), 'warnings', '[]'::jsonb,
      'notes', '[]'::jsonb, 'breakdown', '[]'::jsonb, 'parts', '[]'::jsonb, 'days', 0, 'end_date', v_end, 'end_fixed', v_fixed);
  end if;
  if v_start = v_end then v_es := v_ss;
  else
    if v_ss = 'am' then v_blocks := v_blocks || app.lv_issue('BR-LV-22', 'startSession', 'The first day of a multi-day application can be Full or PM only.'); end if;
    if v_es = 'pm' then v_blocks := v_blocks || app.lv_issue('BR-LV-22', 'endSession', 'The last day of a multi-day application can be Full or AM only.'); end if;
  end if;
  if not t.half_day_allowed and (v_ss <> 'full' or v_es <> 'full') then
    v_blocks := v_blocks || app.lv_issue('LT14', 'startSession', t.name || ' cannot be taken in half days.');
  end if;

  -- status, LWD (BR-LV-50) and eligibility (BR-LV-51)
  v_lwd := app.employee_active_lwd(v_emp);
  select coalesce(pp.continuous_service_date, e.join_date) into v_csd from app.employee_personal pp where pp.employee_id = v_emp;
  v_csd := coalesce(v_csd, e.join_date);
  if e.status in ('withdrawn') or (e.status in ('pending_join','separated') and not v_on_behalf) then
    v_blocks := v_blocks || app.lv_issue('BR-LV-50', 'startDate', 'Leave isn''t available for your current status.');
  end if;
  if v_start < e.join_date then
    v_blocks := v_blocks || app.lv_issue('BR-LV-50', 'startDate', 'Leave can''t start before the join date (' || app.dmy(e.join_date) || ').');
  end if;
  if v_lwd is not null and v_end > v_lwd then
    v_blocks := v_blocks || app.lv_issue('BR-LV-50', 'endDate', 'You can''t apply for dates after your last working day (' || app.dmy(v_lwd) || ').');
  end if;
  select m.marital_status into v_marital from app.employee_marital_history m
   where m.employee_id = v_emp and m.effective_date <= v_start order by m.effective_date desc limit 1;
  if t.eligible_gender <> 'all' and t.eligible_gender::text <> e.gender::text then
    v_blocks := v_blocks || app.lv_issue('BR-LV-51', 'leaveTypeId', 'You''re not eligible for ' || t.name || ': ' || t.eligible_gender::text || ' employees only.');
  end if;
  if t.eligible_marital = 'married' and v_marital is distinct from 'married' then
    v_blocks := v_blocks || app.lv_issue('BR-LV-51', 'leaveTypeId', 'You''re not eligible for ' || t.name || ': requires married status on the start date.');
  end if;
  if t.min_service_months > 0 and app.completed_months(v_csd, v_start - 1) < t.min_service_months then
    v_blocks := v_blocks || app.lv_issue('BR-LV-51', 'leaveTypeId', 'You''re not eligible for ' || t.name || ': requires ' || t.min_service_months || ' months'' service.');
  end if;
  if not t.available_on_probation and e.confirmation_date is null and coalesce(e.extended_probation_end_date, e.probation_end_date) >= v_start then
    v_blocks := v_blocks || app.lv_issue('BR-LV-51', 'leaveTypeId', 'You''re not eligible for ' || t.name || ' during probation.');
  end if;

  -- leave years (BR-LV-58)
  for v_y in extract(year from v_start)::int .. extract(year from v_end)::int loop
    if v_y > v_cur + 1 then
      v_blocks := v_blocks || app.lv_issue('BR-LV-58', 'startDate', 'Applications for ' || v_y || ' are not open yet.');
    elsif v_y = v_cur + 1 then
      v_lp8 := to_date(pol.next_year_from_ddmm || '/' || v_cur, 'DD/MM/YYYY');
      if not pol.allow_next_year_applications or v_today < v_lp8 then
        v_blocks := v_blocks || app.lv_issue('BR-LV-58', 'startDate', 'Applications for ' || v_y || ' open on ' || app.dmy(v_lp8) || '.');
      elsif not app.holiday_year_published(v_y) then
        v_blocks := v_blocks || app.lv_issue('BR-LV-58', 'startDate', 'Holiday calendar for ' || v_y || ' not yet published.');
      else
        v_notes := v_notes || to_jsonb('Uses your projected ' || v_y || ' entitlement.');
      end if;
    elsif not app.holiday_year_published(v_y) and t.count_basis = 'working_days' then
      v_notes := v_notes || to_jsonb('The ' || v_y || ' holiday calendar is not published yet — public holidays are not deducted until it is (the leave is recounted then).');
    end if;
  end loop;

  -- day count (BR-LV-21–24)
  for r in select c.leave_date, c.session, c.weight, c.kind, c.label from app.leave_count(v_emp, v_start, v_ss, v_end, v_es, t.count_basis) c order by c.leave_date loop
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object('date', r.leave_date, 'session', r.session, 'weight', r.weight, 'kind', r.kind, 'label', r.label));
    v_total := v_total + r.weight;
  end loop;
  if v_total = 0 then v_blocks := v_blocks || app.lv_issue('BR-LV-24', 'startDate', 'No working days in the selected dates.'); end if;
  if jsonb_array_length(v_breakdown) > 0 and (select count(*) from generate_series(extract(year from v_start)::int, extract(year from v_end)::int)) > 1 then
    v_notes := v_notes || to_jsonb('This will be split into ' || (extract(year from v_end) - extract(year from v_start) + 1)::int
                                   || ' linked applications, approved together.');
  end if;

  -- overlap (BR-LV-52) — AM + PM halves allowed
  select d.leave_date, a.ref_no into v_conflict
    from jsonb_to_recordset(v_breakdown) as nb(date date, session app.leave_session)
    join app.leave_application_days d on d.employee_id = v_emp and d.leave_date = nb.date and d.is_blocking
     and d.slot && (case nb.session when 'am' then int4range(0,1) when 'pm' then int4range(1,2) else int4range(0,2) end)
    join app.leave_applications a on a.id = d.application_id
   order by d.leave_date limit 1;
  if v_conflict.leave_date is not null then
    v_blocks := v_blocks || app.lv_issue('BR-LV-52', 'startDate', 'You already have leave on ' || app.dmy(v_conflict.leave_date) || ' (' || v_conflict.ref_no || ').');
  end if;

  -- per-year parts with balances (BR-LV-25, BR-LV-53, BR-LV-30/31)
  for v_y in extract(year from v_start)::int .. extract(year from v_end)::int loop
    select coalesce(sum((b ->> 'weight')::numeric), 0) into v_part_days from jsonb_array_elements(v_breakdown) b where extract(year from (b ->> 'date')::date) = v_y;
    v_bal := app.leave_balance(v_emp, t.id, v_y, least(v_end, make_date(v_y, 12, 31)));
    v_avail := (v_bal ->> 'available')::numeric;
    if v_first_bal is null then v_first_bal := v_bal; end if;
    v_parts := v_parts || jsonb_build_array(jsonb_build_object('year', v_y, 'start_date', greatest(v_start, make_date(v_y, 1, 1)),
                 'end_date', least(v_end, make_date(v_y, 12, 31)), 'days', v_part_days, 'balance', v_bal));
    if (v_bal ->> 'has_balance')::boolean and v_part_days > v_avail
       and not ((v_bal ->> 'allow_negative')::boolean and v_part_days - v_avail <= coalesce((v_bal ->> 'max_negative')::numeric, 0)) then
      v_blocks := v_blocks || app.lv_issue(case when t.category = 'sick' then 'BR-LV-30' when v_bal -> 'pool' <> 'null'::jsonb then 'BR-LV-31' else 'BR-LV-53' end, 'leaveTypeId',
        case when t.category = 'hospitalisation' and v_bal -> 'pool' <> 'null'::jsonb
               then 'Hospitalisation available: ' || greatest(v_avail, 0)::text || ' days (' || ((v_bal -> 'pool') ->> 'cap') || '-day pool less sick leave taken). Consider Annual or Unpaid leave for the rest.'
             when t.category = 'sick' and v_avail <= 0
               then 'Sick leave for ' || v_y || ' is used up. Apply for Hospitalisation (if hospitalised), Annual or Unpaid leave.'
             else 'Not enough balance: you have ' || greatest(v_avail, 0)::text || ' days available to apply; this needs ' || v_part_days::text || '.' end);
    end if;
  end loop;

  -- back-date window (BR-LV-54) and emergency flag (BR-LV-16 / LP10 / LP11)
  if v_start < v_today then v_backdated := true; end if;
  if v_end < v_today then
    v_limit := app.working_days_back(v_emp, v_today, t.backdate_working_days);
    if t.backdate_working_days = 0 or v_end < v_limit then
      if v_on_behalf then
        v_beyond := true;
        v_notes := v_notes || to_jsonb('Beyond the ' || t.backdate_working_days || '-day back-date window — recorded as on behalf.');
      else
        v_blocks := v_blocks || app.lv_issue('BR-LV-54', 'endDate', 'This is past the ' || t.backdate_working_days || '-working-day limit for ' || t.name
                                             || '. Contact HR — they can record it for you.');
      end if;
    end if;
  end if;
  v_emergency := v_backdated or (t.id = any(pol.emergency_leave_type_ids) and v_start < v_today + pol.emergency_threshold_days);

  -- notice (LT19), max per application (LT21), occurrences (LT22)
  if t.min_notice_days > 0 and v_start - v_today < t.min_notice_days then
    if t.min_notice_behaviour = 'block' and not v_on_behalf then
      v_blocks := v_blocks || app.lv_issue('BR-LV-55', 'startDate', t.name || ' must be applied at least ' || t.min_notice_days || ' days ahead.');
    else
      v_warn := v_warn || app.lv_issue('BR-LV-55', 'startDate', t.name || ' needs ' || t.min_notice_days || ' days'' notice.');
    end if;
  end if;
  if t.max_days_per_application is not null and v_total > t.max_days_per_application then
    v_blocks := v_blocks || app.lv_issue('BR-LV-56', 'endDate', 'Maximum ' || t.max_days_per_application::text || ' days per application for ' || t.name || '.');
  end if;
  if t.max_occurrences is not null then
    select count(distinct coalesce(a.split_group_id, a.id)) into v_occ from app.leave_applications a
     where a.employee_id = v_emp and a.leave_type_id = t.id and a.status in ('pending','approved','cancellation_pending')
       and (t.occurrence_scope = 'per_employment' or a.leave_year = extract(year from v_start)::int);
    if t.occurrence_scope = 'per_employment' then
      v_occ := v_occ + coalesce((select c.migrated_occurrences from app.employee_leave_counters c where c.employee_id = v_emp and c.leave_type_id = t.id), 0);
    end if;
    if v_occ >= t.max_occurrences then
      v_blocks := v_blocks || app.lv_issue('BR-LV-56', 'leaveTypeId', 'You''ve used all ' || t.max_occurrences || ' ' || t.name || ' occurrences.');
    end if;
  end if;

  -- attachments (BR-LV-57)
  v_files := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'attachment_file_ids', '[]'::jsonb)) x), '{}');
  v_att_count := greatest(coalesce(cardinality(v_files), 0), coalesce((p ->> 'attachment_count')::int, 0));
  v_att_required := t.attachment_rule = 'always' or (t.attachment_rule = 'if_more_than_n_days' and v_total > t.attachment_threshold_days);
  if v_att_required and v_att_count = 0 then
    if t.attachment_grace_hours > 0 then
      v_att_pending := true;
      v_notes := v_notes || to_jsonb('You can add the document within ' || t.attachment_grace_hours || ' hours (shown as "Attachment pending").');
    else
      v_blocks := v_blocks || app.lv_issue('BR-LV-57', 'attachmentFileIds',
        case when t.category in ('sick','hospitalisation') then 'Medical certificate required.' else t.name || ' needs a supporting document.' end);
    end if;
  end if;
  if cardinality(v_files) > 3 then v_blocks := v_blocks || app.lv_issue('LA11', 'attachmentFileIds', 'At most 3 attachments.'); end if;

  -- reason (LT15), maternity / paternity (BR-LV-40–48), cover (LA15)
  v_reason := nullif(btrim(p ->> 'reason'), '');
  if t.reason_required and v_reason is null then v_blocks := v_blocks || app.lv_issue('LA10', 'reason', 'Please give a reason.'); end if;
  v_conf := nullif(p ->> 'expected_confinement_date', '')::date;
  v_birth := nullif(p ->> 'child_birth_date', '')::date;
  if t.category in ('maternity','paternity') and v_conf is null then
    v_blocks := v_blocks || app.lv_issue('LA12', 'expectedConfinementDate', 'Enter the expected confinement date.');
  end if;
  if t.category = 'paternity' then
    if v_conf is not null and v_today > v_conf - 30 then
      v_warn := v_warn || app.lv_issue('BR-LV-48', 'expectedConfinementDate', 'Paternity leave should be notified 30 days before the expected confinement. You can still submit.');
    end if;
    v_pat_window := pol.paternity_window_days_after_birth;
    if v_birth is not null and v_start > v_birth + v_pat_window then
      v_blocks := v_blocks || app.lv_issue('BR-LV-47', 'startDate', 'Paternity leave must start within ' || v_pat_window || ' days of the birth.');
    end if;
    if v_birth is not null and v_birth > v_today then
      v_blocks := v_blocks || app.lv_issue('LA13', 'childBirthDate', 'The child''s date of birth can''t be in the future.');
    end if;
  end if;
  if nullif(p ->> 'cover_employee_id', '')::uuid = v_emp then
    v_blocks := v_blocks || app.lv_issue('LA15', 'coverEmployeeId', 'Choose a colleague other than the applicant.');
  end if;
  v_onb := nullif(btrim(p ->> 'on_behalf_reason'), '');
  if v_on_behalf and p_commit and char_length(coalesce(v_onb, '')) < 10 then
    v_blocks := v_blocks || app.lv_issue('FR-G-17', 'onBehalfReason', 'Give the reason for acting on behalf (at least 10 characters).');
  end if;

  -- approver hint (level 1 of the type's workflow)
  select count(*) into v_levels from app.approval_workflow_levels l where l.workflow_id = t.workflow_id;
  select * into v_lvl from app.resolve_level(t.workflow_id, 1, v_emp, null, 'leave', v_today);
  v_hint := case when v_lvl.outcome = 'auto' then 'Level 1 is recorded automatically (' || coalesce(v_lvl.note, '') || ')'
                 when v_lvl.outcome = 'skip' then 'Level 1 is skipped (you are the approver)'
                 when v_lvl.assignee is not null then 'Goes to ' || app.user_name(v_lvl.assignee) || ' for approval (level 1 of ' || v_levels || ').'
                 when v_lvl.source = 'super_admin_pool' then 'Goes to a Super Admin for approval (level 1 of ' || v_levels || ').'
                 else 'Goes to an Admin for approval (level 1 of ' || v_levels || ').' end;

  v_ack := coalesce((p ->> 'acknowledge_warnings')::boolean, false);
  if p_commit and jsonb_array_length(v_warn) > 0 and not v_ack and jsonb_array_length(v_blocks) = 0 then
    v_blocks := v_blocks || app.lv_issue('ACK', 'acknowledgeWarnings', 'Tick "I understand" to submit with these warnings.');
  end if;

  if not p_commit or jsonb_array_length(v_blocks) > 0 then
    return jsonb_build_object('end_date', v_end, 'end_fixed', v_fixed, 'days', v_total, 'breakdown', v_breakdown, 'parts', v_parts,
      'balance', v_first_bal, 'is_emergency', v_emergency, 'attachment_required', v_att_required, 'attachment_may_follow', t.attachment_grace_hours > 0,
      'attachment_pending', v_att_pending, 'blocks', v_blocks, 'warnings', v_warn, 'notes', v_notes, 'approver_hint', v_hint, 'levels', v_levels);
  end if;

  -- ===== commit =====
  -- attachments must be this employee's confirmed, unattached leave uploads
  if cardinality(v_files) > 0 and exists (select 1 from unnest(v_files) fid
       where not exists (select 1 from app.files f where f.id = fid and f.status = 'active' and f.subject = 'leave_attachment'
                           and f.owner_employee_id = v_emp and f.created_by = v_actor)
          or exists (select 1 from app.leave_application_files lf where lf.file_id = fid)) then
    raise exception 'PRET-FILE-MISSING' using errcode = '23514';
  end if;
  v_base := private.next_doc_no('LV', extract(year from v_start)::int);
  if extract(year from v_end) <> extract(year from v_start) then v_group := gen_random_uuid(); end if;
  for r in select (x ->> 'year')::int as y, (x ->> 'start_date')::date as s, (x ->> 'end_date')::date as en, (x ->> 'days')::numeric as d
             from jsonb_array_elements(v_parts) x order by 1 loop
    v_idx := v_idx + 1;
    insert into app.leave_applications (ref_no, split_group_id, split_part, employee_id, leave_type_id, leave_year, start_date, start_session,
        end_date, end_session, days, reason, expected_confinement_date, child_birth_date, contact_phone, cover_employee_id, is_emergency,
        attachment_pending, attachment_due_at, status, workflow_id, current_level, total_levels, on_behalf_by, on_behalf_reason,
        beyond_backdate_window, warnings_acknowledged, idempotency_key)
    values (case when v_group is null then v_base else v_base || '-' || v_idx end, v_group, case when v_group is null then null else v_idx end,
        v_emp, t.id, r.y, r.s, case when r.s = v_start then v_ss else 'full' end, r.en, case when r.en = v_end then v_es else 'full' end, r.d,
        v_reason, v_conf, v_birth, nullif(btrim(p ->> 'contact_phone'), ''), nullif(p ->> 'cover_employee_id', '')::uuid, v_emergency,
        v_att_pending, case when v_att_pending then now() + make_interval(hours => t.attachment_grace_hours) end, 'pending', t.workflow_id, 1,
        greatest(v_levels, 1), case when v_on_behalf then v_actor end, case when v_on_behalf then v_onb end, v_beyond,
        case when jsonb_array_length(v_warn) > 0 then v_warn end, v_key)
    returning id into v_app;
    if v_idx = 1 and v_group is not null then
      update app.leave_applications set split_group_id = v_app where id = v_app;  -- the group id is part 1's id
      v_group := v_app;
    elsif v_group is not null then
      update app.leave_applications set split_group_id = v_group where id = v_app;
    end if;
    insert into app.leave_application_days (application_id, employee_id, leave_date, session, weight, day_kind, day_label, leave_year)
    select v_app, v_emp, (b ->> 'date')::date, (b ->> 'session')::app.leave_session, (b ->> 'weight')::numeric, b ->> 'kind', b ->> 'label', r.y
      from jsonb_array_elements(v_breakdown) b where extract(year from (b ->> 'date')::date) = r.y;
    perform app.leave_event(v_app, case when v_on_behalf then 'Submitted on behalf' else 'Submitted' end, null, 'pending', null, v_onb);
    v_ids := v_ids || jsonb_build_array(jsonb_build_object('id', v_app, 'ref_no', case when v_group is null then v_base else v_base || '-' || v_idx end,
                                                           'year', r.y, 'days', r.d));
  end loop;
  v_app := (v_ids -> 0 ->> 'id')::uuid;
  insert into app.leave_application_files (application_id, file_id, added_by) select v_app, fid, v_actor from unnest(v_files) fid;
  -- route (tasks hang on part 1; decisions move the whole group)
  v_level := app.route_approval('leave_application', v_app);
  if v_level = 0 then
    perform app.subject_approved('leave_application', v_app);
  else
    update app.leave_applications set current_level = v_level where id in (select app.leave_group(v_app));
  end if;
  select a.status into v_status from app.leave_applications a where a.id = v_app;
  -- maternity allowance indicator (BR-LV-42, HR only)
  if t.category = 'maternity' and v_conf is not null then
    update app.employee_hr_private h set maternity_allowance_eligible =
           ((select count(*) from generate_series(greatest(e.join_date, (v_conf - interval '9 months')::date), v_conf - 1, interval '1 day')) >= 90
            and (select count(*) from app.employee_children c where c.employee_id = v_emp and c.is_active) < 5)
     where h.employee_id = v_emp;
  end if;
  -- on behalf: N-09 to the employee, N-08 to the manager (LP13)
  if v_on_behalf then
    perform app.notify_employee(v_emp, 'N-09', 'Leave applied on your behalf: ' || v_base, t.name || ' · ' || app.dmy(v_start) || ' – ' || app.dmy(v_end),
      '/my/leave/' || (v_ids -> 0 ->> 'ref_no'), false, 'leave_on_behalf', jsonb_build_object('reference', v_base, 'type', t.name));
    if pol.notify_on_admin_withdraw and e.manager_employee_id is not null then
      perform app.notify_employee(e.manager_employee_id, 'N-08', 'Leave applied by HR for ' || e.name, t.name || ' · ' || app.dmy(v_start) || ' – ' || app.dmy(v_end),
        '/approvals/leave/' || (v_ids -> 0 ->> 'ref_no'), false, 'leave_admin_action', jsonb_build_object('reference', v_base, 'action', 'applied'));
    end if;
  end if;
  select a.current_level into v_level from app.leave_applications a where a.id = v_app;
  return jsonb_build_object('duplicate', false, 'applications', v_ids, 'status', v_status, 'level', v_level, 'levels', greatest(v_levels, 1),
    'approver_hint', v_hint, 'is_emergency', v_emergency, 'blocks', '[]'::jsonb, 'warnings', v_warn, 'days', v_total);
end $$;

-- ===========================================================================
-- Approval subject handlers (called by app.decide_task / app.open_approval_level)
-- ===========================================================================
create or replace function app.post_leave_taken(p_application_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare a app.leave_applications%rowtype; v_bt uuid; v_net numeric; v_need numeric; c record; v_use numeric;
begin
  select * into a from app.leave_applications where id = p_application_id;
  v_bt := app.balance_type_id(a.leave_type_id);
  select coalesce(sum(l.days), 0) into v_net from app.leave_ledger l where l.source_application_id = a.id and l.entry_type in ('taken','taken_reversal');
  if -v_net <> a.days then
    insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, source_application_id, reason)
    values (a.employee_id, v_bt, a.leave_year, case when -v_net < a.days then 'taken' else 'taken_reversal' end::app.ledger_entry_type,
            -(a.days + v_net), a.start_date, a.id, case when v_net = 0 then 'Taken' else 'Recounted' end);
  end if;
  -- replacement credits: consume the earliest-expiring credit first (BR-LV-81)
  if (select t.entitlement_method from app.leave_types t where t.id = v_bt) = 'earned_credits' then
    v_need := a.days - coalesce((select sum(x.days) from app.replacement_credit_consumptions x where x.application_id = a.id and x.reversed_at is null), 0);
    for c in select rc.id, rc.remaining_days from app.replacement_credits rc
              where rc.employee_id = a.employee_id and rc.status = 'approved' and rc.remaining_days > 0 and rc.expired_at is null
                and (rc.expiry_date is null or rc.expiry_date >= a.start_date)
              order by rc.expiry_date nulls last, rc.date_worked for update loop
      exit when v_need <= 0;
      v_use := least(v_need, c.remaining_days);
      update app.replacement_credits set remaining_days = remaining_days - v_use where id = c.id;
      insert into app.replacement_credit_consumptions (credit_id, application_id, employee_id, days) values (c.id, a.id, a.employee_id, v_use)
      on conflict (credit_id, application_id) do update set days = app.replacement_credit_consumptions.days + excluded.days, reversed_at = null;
      v_need := v_need - v_use;
    end loop;
  end if;
end $$;

create or replace function app.reverse_leave_taken(p_application_id uuid, p_note text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare a app.leave_applications%rowtype; v_net numeric; c record;
begin
  select * into a from app.leave_applications where id = p_application_id;
  select coalesce(sum(l.days), 0) into v_net from app.leave_ledger l where l.source_application_id = a.id and l.entry_type in ('taken','taken_reversal');
  if v_net <> 0 then
    insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, source_application_id, reason)
    values (a.employee_id, app.balance_type_id(a.leave_type_id), a.leave_year, 'taken_reversal', -v_net, app.today_myt(), a.id, left(p_note, 500));
  end if;
  for c in select x.credit_id, x.days from app.replacement_credit_consumptions x where x.application_id = a.id and x.reversed_at is null loop
    update app.replacement_credits set remaining_days = remaining_days + c.days where id = c.credit_id and expired_at is null;
    update app.replacement_credit_consumptions set reversed_at = now() where application_id = a.id and credit_id = c.credit_id;
  end loop;
end $$;

create or replace function app.subject_approved(p_type app.task_subject, p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id(); a record; c app.replacement_credits%rowtype; pol app.leave_policy%rowtype; v_auto boolean; x uuid;
begin
  v_auto := not exists (select 1 from app.approval_tasks t where t.subject_type = p_type and app.task_subject_id(t) = p_id
                                                              and t.status = 'approved' and t.acting_as <> 'system_auto');
  if v_auto then perform set_config('app.system_decision', 'on', true); end if;
  if p_type = 'leave_application' then
    for x in select app.leave_group(p_id) loop
      update app.leave_applications set status = 'approved', decided_at = now(), decided_by = case when v_auto then null else v_actor end,
             current_level = total_levels where id = x;
      perform app.post_leave_taken(x);
      perform app.refresh_team_calendar(x);
      perform app.leave_event(x, 'Approved', 'pending', 'approved', case when v_auto then 'system_auto'::app.acting_as end);
    end loop;
    select la.employee_id, la.ref_no, t.name, la.start_date, la.end_date into a from app.leave_applications la join app.leave_types t on t.id = la.leave_type_id where la.id = p_id;
    perform app.notify_employee(a.employee_id, 'N-02', 'Leave approved: ' || a.ref_no, a.name || ' · ' || app.dmy(a.start_date) || ' – ' || app.dmy(a.end_date),
      '/my/leave/' || a.ref_no, false, 'leave_approved', jsonb_build_object('reference', a.ref_no, 'type', a.name));
  elsif p_type = 'leave_cancellation' then
    for x in select app.leave_group(p_id) loop
      update app.leave_applications set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor where id = x;
      perform app.reverse_leave_taken(x, 'Cancellation approved');
      perform app.refresh_team_calendar(x);
      perform app.leave_event(x, 'Cancellation approved', 'cancellation_pending', 'cancelled');
    end loop;
    select la.employee_id, la.ref_no, t.name into a from app.leave_applications la join app.leave_types t on t.id = la.leave_type_id where la.id = p_id;
    perform app.notify_employee(a.employee_id, 'N-06', 'Leave cancelled: ' || a.ref_no, a.name || ' — your days have been restored.',
      '/my/leave/' || a.ref_no, false, 'leave_cancelled', jsonb_build_object('reference', a.ref_no, 'type', a.name));
  elsif p_type = 'replacement_credit' then
    select * into c from app.replacement_credits where id = p_id;
    select * into pol from app.leave_policy where id = 1;
    update app.replacement_credits
       set status = 'approved', decided_at = now(), decided_by = v_actor, current_level = total_levels,
           expiry_date = case when pol.replacement_credit_validity_days > 0 then c.date_worked + pol.replacement_credit_validity_days
                              else (make_date(extract(year from c.date_worked)::int + 1, 1, 1) + make_interval(months => pol.carry_forward_expiry_months))::date - 1 end,
           remaining_days = case when c.compensate_by_pay then 0 else c.credit_days end
     where id = p_id
    returning * into c;
    if not c.compensate_by_pay then
      insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, expires_on, source_credit_id, reason)
      select c.employee_id, t.id, extract(year from c.date_worked)::int, 'credit_earned', c.credit_days, c.date_worked, c.expiry_date, c.id, 'Credit ' || c.credit_no
        from app.leave_types t where t.category = 'replacement' and t.is_active and t.entitlement_method = 'earned_credits' order by t.display_order limit 1;
    end if;
    perform app.notify_employee(c.employee_id, 'N-12', 'Replacement credit approved: ' || c.credit_no,
      case when c.compensate_by_pay then 'Compensated by pay (' || c.compensate_hours || ' h).' else c.credit_days || ' day(s), expires ' || app.dmy(c.expiry_date) end,
      '/my/leave/credits', false, 'credit_decided', jsonb_build_object('reference', c.credit_no, 'decision', 'approved'));
  end if;
  perform set_config('app.system_decision', '', true);
end $$;

create or replace function app.subject_rejected(p_type app.task_subject, p_id uuid, p_comment text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id(); a record; x uuid;
begin
  if p_type = 'leave_application' then
    for x in select app.leave_group(p_id) loop
      update app.leave_applications set status = 'rejected', decided_at = now(), decided_by = v_actor where id = x;
      perform app.leave_event(x, 'Rejected', 'pending', 'rejected', null, p_comment);
    end loop;
    select la.employee_id, la.ref_no, t.name into a from app.leave_applications la join app.leave_types t on t.id = la.leave_type_id where la.id = p_id;
    perform app.notify_employee(a.employee_id, 'N-03', 'Leave rejected: ' || a.ref_no, left(a.name || ' — ' || coalesce(p_comment, ''), 500),
      '/my/leave/' || a.ref_no, false, 'leave_rejected', jsonb_build_object('reference', a.ref_no, 'comment', p_comment));
  elsif p_type = 'leave_cancellation' then
    for x in select app.leave_group(p_id) loop
      update app.leave_applications set status = 'approved', cancellation_requested_at = null where id = x;
      perform app.leave_event(x, 'Cancellation rejected', 'cancellation_pending', 'approved', null, p_comment);
    end loop;
    select la.employee_id, la.ref_no into a from app.leave_applications la where la.id = p_id;
    perform app.notify_employee(a.employee_id, 'N-07', 'Cancellation rejected: ' || a.ref_no, left(coalesce(p_comment, ''), 500),
      '/my/leave/' || a.ref_no, false, 'leave_cancellation_rejected', jsonb_build_object('reference', a.ref_no, 'comment', p_comment));
  elsif p_type = 'replacement_credit' then
    update app.replacement_credits set status = 'rejected', decided_at = now(), decided_by = v_actor where id = p_id returning employee_id, credit_no into a;
    perform app.notify_employee(a.employee_id, 'N-12', 'Replacement credit rejected: ' || a.credit_no, left(coalesce(p_comment, ''), 500),
      '/my/leave/credits', false, 'credit_decided', jsonb_build_object('reference', a.credit_no, 'decision', 'rejected', 'comment', p_comment));
  end if;
end $$;

create or replace function app.subject_moved(p_type app.task_subject, p_id uuid, p_level int) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_type = 'leave_application' then
    update app.leave_applications set current_level = p_level where id in (select app.leave_group(p_id));
    perform app.leave_event(p_id, 'Approved at level ' || (p_level - 1) || ' — moved to level ' || p_level, 'pending', 'pending');
  elsif p_type = 'replacement_credit' then
    update app.replacement_credits set current_level = p_level where id = p_id;
  end if;
end $$;

-- ===========================================================================
-- Transition guard (§6.10 + rls §7 layer 5) and derived data
-- ===========================================================================
create or replace function app.tg_leave_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor_emp uuid := app.current_employee_id(); v_actor uuid := app.current_app_user_id(); v_system boolean;
begin
  if (new.employee_id, new.leave_type_id, new.leave_year, new.ref_no, new.submitted_at, new.workflow_id)
     is distinct from (old.employee_id, old.leave_type_id, old.leave_year, old.ref_no, old.submitted_at, old.workflow_id) then
    raise exception 'PRET-LV-IMMUTABLE' using errcode = '23514';
  end if;
  if new.status is not distinct from old.status then return new; end if;
  if (old.status, new.status) not in (('pending','approved'),('pending','rejected'),('pending','withdrawn'),('approved','cancelled'),
        ('approved','cancellation_pending'),('cancellation_pending','cancelled'),('cancellation_pending','approved')) then
    raise exception 'PRET-LV-TRANSITION %→%', old.status, new.status using errcode = '23514';
  end if;
  v_system := current_setting('app.system_decision', true) = 'on';
  -- decisions (approve / reject / decide a cancellation) are never by the applicant
  if (old.status = 'pending' and new.status in ('approved','rejected')) or old.status = 'cancellation_pending' then
    if v_actor_emp is not null and v_actor_emp = new.employee_id then
      if not (v_system and new.status = 'approved' and old.status = 'pending'
              and exists (select 1 from app.approval_tasks t where t.leave_application_id = coalesce(new.split_group_id, new.id)
                            and t.acting_as = 'system_auto' and t.status = 'approved')
              and not exists (select 1 from app.approval_tasks t where t.leave_application_id = coalesce(new.split_group_id, new.id)
                                and t.status = 'approved' and t.acting_as <> 'system_auto')) then
        raise exception 'PRET-SELF-001: you cannot decide your own leave' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.status = 'withdrawn' and not (app.is_self(new.employee_id) or (app.is_admin() and v_actor_emp is distinct from new.employee_id)) and v_actor is not null then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if new.status = 'cancellation_pending' and v_actor is not null and not app.is_self(new.employee_id) then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if old.status = 'approved' and new.status = 'cancelled' and v_actor is not null
     and not (app.is_self(new.employee_id) or (app.is_admin() and v_actor_emp is distinct from new.employee_id)) then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function app.tg_leave_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('rejected','withdrawn','cancelled') then
    update app.leave_application_days set is_blocking = false where application_id = new.id and is_blocking;
    perform app.refresh_team_calendar(new.id);
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.days is distinct from old.days then
    perform app.refresh_leave_summary(new.employee_id, app.balance_type_id(new.leave_type_id), new.leave_year);
  end if;
  return null;
end $$;

-- ===========================================================================
-- Employee actions on their own leave (P3/P4) and HR on behalf (P27, FR-LV-09)
-- ===========================================================================
create or replace function app.withdraw_leave(p_application_id uuid, p_reason text default null, p_on_behalf boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare a app.leave_applications%rowtype; x uuid; pol app.leave_policy%rowtype; t record; v_notified uuid[] := '{}'; v_u uuid;
begin
  select * into a from app.leave_applications where id = p_application_id for update;
  if a.id is null or not app.can_see_team_row(a.employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if p_on_behalf then
    if not app.is_admin() or app.is_self(a.employee_id) then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
    if char_length(coalesce(p_reason, '')) < 10 then raise exception 'PRET-LV-REASON: give the reason (at least 10 characters)' using errcode = '23514'; end if;
  elsif not app.is_self(a.employee_id) then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if a.status <> 'pending' then raise exception 'PRET-LV-STATE: only pending applications can be withdrawn' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || a.employee_id::text));
  -- N-04 to approvers who had it (in-app only)
  for t in select tk.assignee_user_id from app.approval_tasks tk where tk.leave_application_id = coalesce(a.split_group_id, a.id) and tk.status = 'open' and tk.assignee_user_id is not null loop
    if not t.assignee_user_id = any(v_notified) then
      perform app.notify(t.assignee_user_id, 'N-04', left('Leave withdrawn: ' || a.ref_no, 150), app.employee_display(a.employee_id), '/approvals', false, null, null);
      v_notified := v_notified || t.assignee_user_id;
    end if;
  end loop;
  perform app.close_open_tasks('leave_application', coalesce(a.split_group_id, a.id), case when p_on_behalf then 'Withdrawn by HR' else 'Withdrawn by the employee' end);
  for x in select app.leave_group(a.id) loop
    update app.leave_applications set status = 'withdrawn', cancel_reason = left(p_reason, 500) where id = x;
    perform app.leave_event(x, case when p_on_behalf then 'Withdrawn on behalf' else 'Withdrawn' end, 'pending', 'withdrawn', null, p_reason);
  end loop;
  if p_on_behalf then
    select * into pol from app.leave_policy where id = 1;
    if pol.notify_on_admin_withdraw then
      perform app.notify_employee(a.employee_id, 'N-08', 'Leave withdrawn by HR: ' || a.ref_no, left(p_reason, 500), '/my/leave/' || a.ref_no, false,
        'leave_admin_action', jsonb_build_object('reference', a.ref_no, 'action', 'withdrawn', 'reason', p_reason));
      perform app.notify_employee((select e.manager_employee_id from app.employees e where e.id = a.employee_id), 'N-08', 'Leave withdrawn by HR: ' || a.ref_no,
        app.employee_display(a.employee_id), '/team/leave', false, 'leave_admin_action', jsonb_build_object('reference', a.ref_no, 'action', 'withdrawn'));
    end if;
  end if;
end $$;

-- Cancel approved leave: own future leave (LT30) directly; HR on behalf (any date, reason).
create or replace function app.cancel_leave(p_application_id uuid, p_reason text default null, p_on_behalf boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare a app.leave_applications%rowtype; x uuid; t app.leave_types%rowtype; pol app.leave_policy%rowtype; v_first date;
begin
  select * into a from app.leave_applications where id = p_application_id for update;
  if a.id is null or not app.can_see_team_row(a.employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  select * into t from app.leave_types where id = a.leave_type_id;
  select min(la.start_date) into v_first from app.leave_applications la where la.id in (select app.leave_group(a.id));
  if p_on_behalf then
    if not app.is_admin() or app.is_self(a.employee_id) then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
    if char_length(coalesce(p_reason, '')) < 10 then raise exception 'PRET-LV-REASON: give the reason (at least 10 characters)' using errcode = '23514'; end if;
    if a.status not in ('approved','cancellation_pending') then raise exception 'PRET-LV-STATE: only approved leave can be cancelled' using errcode = '23514'; end if;
  else
    if not app.is_self(a.employee_id) then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
    if a.status <> 'approved' then raise exception 'PRET-LV-STATE: only approved leave can be cancelled' using errcode = '23514'; end if;
    if not t.self_cancel_future_approved or v_first <= app.today_myt() then
      raise exception 'PRET-LV-CANCEL-REQUEST: this leave has started or self-cancel is off — request cancellation instead' using errcode = '23514';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || a.employee_id::text));
  perform app.close_open_tasks('leave_cancellation', coalesce(a.split_group_id, a.id), 'Cancelled by HR');
  for x in select app.leave_group(a.id) loop
    update app.leave_applications set status = 'cancelled', cancelled_at = now(), cancelled_by = app.current_app_user_id(),
           cancel_reason = left(p_reason, 500) where id = x and status in ('approved','cancellation_pending');
    perform app.reverse_leave_taken(x, case when p_on_behalf then 'Cancelled by HR' else 'Cancelled' end);
    perform app.leave_event(x, case when p_on_behalf then 'Cancelled on behalf' else 'Cancelled' end, a.status, 'cancelled', null, p_reason);
  end loop;
  select * into pol from app.leave_policy where id = 1;
  -- N-06 to approver(s) / HR (FYI) and the employee; N-08 for HR actions (LP13)
  perform app.notify_role_holders(array['ADM']::app.privileged_role[], 'N-06', left('Leave cancelled: ' || a.ref_no, 150), app.employee_display(a.employee_id),
    '/leave/applications', false, null, null, app.current_app_user_id());
  if p_on_behalf and pol.notify_on_admin_withdraw then
    perform app.notify_employee(a.employee_id, 'N-08', 'Leave cancelled by HR: ' || a.ref_no, left(p_reason, 500), '/my/leave/' || a.ref_no, false,
      'leave_admin_action', jsonb_build_object('reference', a.ref_no, 'action', 'cancelled', 'reason', p_reason));
    perform app.notify_employee((select e.manager_employee_id from app.employees e where e.id = a.employee_id), 'N-08', 'Leave cancelled by HR: ' || a.ref_no,
      app.employee_display(a.employee_id), '/team/leave', false, 'leave_admin_action', jsonb_build_object('reference', a.ref_no, 'action', 'cancelled'));
  end if;
end $$;

create or replace function app.request_leave_cancellation(p_application_id uuid, p_reason text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare a app.leave_applications%rowtype; x uuid; v_level int;
begin
  select * into a from app.leave_applications where id = p_application_id for update;
  if a.id is null or not app.is_self(a.employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if a.status <> 'approved' then raise exception 'PRET-LV-STATE: only approved leave can be cancelled' using errcode = '23514'; end if;
  if char_length(coalesce(btrim(p_reason), '')) < 10 then raise exception 'PRET-LV-REASON: give the reason (at least 10 characters)' using errcode = '23514'; end if;
  for x in select app.leave_group(a.id) loop
    update app.leave_applications set status = 'cancellation_pending', cancellation_requested_at = now(), cancellation_reason = left(p_reason, 500) where id = x;
    perform app.leave_event(x, 'Cancellation requested', 'approved', 'cancellation_pending', null, p_reason);
  end loop;
  v_level := app.route_approval('leave_cancellation', coalesce(a.split_group_id, a.id));
  if v_level = 0 then perform app.subject_approved('leave_cancellation', coalesce(a.split_group_id, a.id)); end if;
  return v_level;
end $$;

-- F-LV-26 MC verification (HR, not own). Invalid → N-14.
create or replace function app.set_leave_mc_status(p_application_id uuid, p_status app.mc_status, p_remarks text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare a app.leave_applications%rowtype;
begin
  select * into a from app.leave_applications where id = p_application_id for update;
  if a.id is null or not app.is_admin() then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if app.is_self(a.employee_id) then raise exception 'PRET-SELF-001: you cannot verify your own certificate' using errcode = '42501'; end if;
  update app.leave_applications set mc_status = p_status, mc_checked_by = app.current_app_user_id(), mc_checked_at = now(), mc_remarks = left(p_remarks, 500)
   where id in (select app.leave_group(a.id));
  perform app.leave_event(a.id, 'MC marked ' || replace(p_status::text, '_', ' '), a.status, a.status, null, p_remarks);
  if p_status = 'invalid' then
    perform app.notify_employee(a.employee_id, 'N-14', 'Medical certificate not accepted: ' || a.ref_no,
      left('Please resubmit a valid certificate or convert the leave. ' || coalesce(p_remarks, ''), 500), '/my/leave/' || a.ref_no, true,
      'leave_mc_invalid', jsonb_build_object('reference', a.ref_no, 'remarks', p_remarks));
  end if;
end $$;

-- LA11 add attachments after submit (attachment pending / grace) — own application, ≤ 3 in total.
create or replace function app.add_leave_attachments(p_application_id uuid, p_file_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare a app.leave_applications%rowtype; v_actor uuid := app.current_app_user_id();
begin
  select * into a from app.leave_applications where id = p_application_id for update;
  if a.id is null or not (app.is_self(a.employee_id) or (app.is_admin() and not app.is_self(a.employee_id))) then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  if a.status in ('rejected','withdrawn','cancelled') then raise exception 'PRET-LV-STATE: this application is closed' using errcode = '23514'; end if;
  if exists (select 1 from unnest(p_file_ids) fid where not exists (select 1 from app.files f where f.id = fid and f.status = 'active'
               and f.subject = 'leave_attachment' and f.owner_employee_id = a.employee_id and f.created_by = v_actor)
               or exists (select 1 from app.leave_application_files lf where lf.file_id = fid)) then
    raise exception 'PRET-FILE-MISSING' using errcode = '23514';
  end if;
  if (select count(*) from app.leave_application_files lf where lf.application_id = coalesce(a.split_group_id, a.id)) + cardinality(p_file_ids) > 3 then
    raise exception 'PRET-LV-FILES: at most 3 attachments' using errcode = '23514';
  end if;
  insert into app.leave_application_files (application_id, file_id, added_by) select coalesce(a.split_group_id, a.id), fid, v_actor from unnest(p_file_ids) fid;
  update app.leave_applications set attachment_pending = false, attachment_due_at = null, mc_status = 'not_checked'
   where id in (select app.leave_group(a.id));
  perform app.leave_event(a.id, 'Attachment added', a.status, a.status);
end $$;

-- ===========================================================================
-- Replacement credits (F-LV-15)
-- ===========================================================================
create or replace function app.day_kind_on(p_employee_id uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c record;
begin
  if not app.can_see_team_row(p_employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  select * into c from app.employee_calendar(p_employee_id, p_date, p_date);
  if c.cal_date is null or not c.employed then return jsonb_build_object('kind', 'not_employed', 'label', 'Not employed on this date', 'eligible', false); end if;
  if c.holiday_name is not null then
    return jsonb_build_object('kind', case when c.holiday_half then 'half_public_holiday' else 'public_holiday' end, 'label', left('Public holiday: ' || c.holiday_name, 150), 'eligible', true);
  end if;
  return jsonb_build_object('kind', case c.day_type when 'full' then 'working' when 'half' then 'half_working' else c.day_type::text end,
    'label', case c.day_type when 'rest' then 'Rest day' when 'off' then 'Off day' when 'half' then 'Half working day' else 'Working day' end,
    'eligible', c.day_type in ('rest','off'));
end $$;

create or replace function app.request_credit(p_employee_id uuid, p_date date, p_duration app.credit_duration, p_reason text,
                                              p_file_id uuid, p_idempotency_key uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id(); v_batch boolean; v_kind jsonb; pol app.leave_policy%rowtype; v_rl app.leave_types%rowtype;
  v_id uuid; v_no text; v_levels int; v_level int; v_dup record;
begin
  if v_actor is null then raise exception 'PRET-ACC-401' using errcode = '42501'; end if;
  v_batch := not app.is_self(p_employee_id);
  if v_batch and (not app.is_admin()) then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if v_batch and p_employee_id = app.current_employee_id() then raise exception 'PRET-SELF-001' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('leave:' || p_employee_id::text));
  select c.id, c.credit_no into v_dup from app.replacement_credits c where c.idempotency_key = p_idempotency_key and c.employee_id = p_employee_id;
  if v_dup.id is not null then return jsonb_build_object('id', v_dup.id, 'credit_no', v_dup.credit_no, 'duplicate', true); end if;
  select * into pol from app.leave_policy where id = 1;
  select * into v_rl from app.leave_types t where t.category = 'replacement' and t.is_active and t.entitlement_method = 'earned_credits' order by t.display_order limit 1;
  if v_rl.id is null then raise exception 'PRET-RL-TYPE: replacement leave is not set up' using errcode = '23514'; end if;
  if p_date > app.today_myt() then raise exception 'PRET-RL-FUTURE: the date worked can''t be in the future' using errcode = '23514'; end if;
  if pol.replacement_worked_lookback_days > 0 and p_date < app.today_myt() - pol.replacement_worked_lookback_days then
    raise exception 'PRET-RL-WINDOW: request credits within % days of the date worked', pol.replacement_worked_lookback_days using errcode = '23514';
  end if;
  v_kind := app.day_kind_on(p_employee_id, p_date);
  if not (v_kind ->> 'eligible')::boolean then
    raise exception 'PRET-RL-WORKING-DAY: Replacement credit is only for work on a rest day, off day or public holiday' using errcode = '23514';
  end if;
  if exists (select 1 from app.replacement_credits c where c.employee_id = p_employee_id and c.date_worked = p_date and c.status in ('pending','approved')) then
    raise exception 'PRET-RL-DUPLICATE: You already have a credit for this date' using errcode = '23514';
  end if;
  if p_file_id is not null and not exists (select 1 from app.files f where f.id = p_file_id and f.status = 'active' and f.subject = 'leave_attachment'
                                             and f.owner_employee_id = p_employee_id and f.created_by = v_actor) then
    raise exception 'PRET-FILE-MISSING' using errcode = '23514';
  end if;
  select count(*) into v_levels from app.approval_workflow_levels l where l.workflow_id = v_rl.workflow_id;
  v_no := private.next_doc_no('RL', extract(year from app.today_myt())::int);
  insert into app.replacement_credits (credit_no, employee_id, date_worked, duration, credit_days, day_kind, day_type_label, reason, attachment_file_id,
                                       workflow_id, total_levels, entered_by_admin, idempotency_key)
  values (v_no, p_employee_id, p_date, p_duration, case when p_duration = 'full_day' then 1.0 else 0.5 end, v_kind ->> 'kind', v_kind ->> 'label',
          left(btrim(p_reason), 500), p_file_id, v_rl.workflow_id, greatest(v_levels, 1), case when v_batch then v_actor end, p_idempotency_key)
  returning id into v_id;
  v_level := app.route_approval('replacement_credit', v_id);
  if v_level = 0 then perform app.subject_approved('replacement_credit', v_id); else update app.replacement_credits set current_level = v_level where id = v_id; end if;
  return jsonb_build_object('id', v_id, 'credit_no', v_no, 'duplicate', false, 'level', v_level);
end $$;

create or replace function app.withdraw_credit(p_credit_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c app.replacement_credits%rowtype;
begin
  select * into c from app.replacement_credits where id = p_credit_id for update;
  if c.id is null or not app.is_self(c.employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if c.status <> 'pending' then raise exception 'PRET-RL-STATE: only pending credits can be withdrawn' using errcode = '23514'; end if;
  perform app.close_open_tasks('replacement_credit', c.id, 'Withdrawn by the employee');
  update app.replacement_credits set status = 'withdrawn' where id = c.id;
end $$;

create or replace function app.set_credit_compensation(p_credit_id uuid, p_compensate boolean, p_hours numeric) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c app.replacement_credits%rowtype;
begin
  select * into c from app.replacement_credits where id = p_credit_id for update;
  if c.id is null or not app.is_admin() then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if app.is_self(c.employee_id) then raise exception 'PRET-SELF-001' using errcode = '42501'; end if;
  if c.status <> 'pending' then raise exception 'PRET-RL-STATE: only pending credits can be changed' using errcode = '23514'; end if;
  update app.replacement_credits set compensate_by_pay = p_compensate, compensate_hours = case when p_compensate then p_hours end where id = c.id;
end $$;

-- ===========================================================================
-- Recount when the calendar changes (BR-LV-27, EC-LV-02, EC-LV-10)
-- ===========================================================================
create or replace function app.recount_application(p_application_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare a app.leave_applications%rowtype; t app.leave_types%rowtype; v_new numeric; v_changed boolean;
begin
  select * into a from app.leave_applications where id = p_application_id for update;
  if a.id is null or a.status not in ('pending','approved','cancellation_pending') then return false; end if;
  select * into t from app.leave_types where id = a.leave_type_id;
  if t.count_basis <> 'working_days' then return false; end if;
  create temp table if not exists pg_temp.lv_recount (leave_date date primary key, weight numeric, kind text, label text) on commit drop;
  delete from pg_temp.lv_recount;
  insert into pg_temp.lv_recount select c.leave_date, c.weight, c.kind, c.label
    from app.leave_count(a.employee_id, a.start_date, a.start_session, a.end_date, a.end_session, t.count_basis) c;
  select exists (select 1 from app.leave_application_days d join pg_temp.lv_recount n on n.leave_date = d.leave_date
                  where d.application_id = a.id and d.weight <> n.weight) into v_changed;
  if not v_changed then return false; end if;
  update app.leave_application_days d set weight = n.weight, day_kind = n.kind, day_label = n.label
    from pg_temp.lv_recount n where d.application_id = a.id and n.leave_date = d.leave_date;
  select coalesce(sum(weight), 0) into v_new from app.leave_application_days where application_id = a.id;
  update app.leave_applications set days = v_new where id = a.id;
  if a.status in ('approved','cancellation_pending') then perform app.post_leave_taken(a.id); perform app.refresh_team_calendar(a.id); end if;
  perform app.leave_event(a.id, 'Recounted: ' || a.days::text || ' → ' || v_new::text || ' days (calendar change)', a.status, a.status);
  perform app.notify_employee(a.employee_id, 'N-06', 'Leave recounted: ' || a.ref_no, a.days::text || ' → ' || v_new::text || ' days after a calendar change.',
    '/my/leave/' || a.ref_no, false, 'leave_recounted', jsonb_build_object('reference', a.ref_no, 'before', a.days, 'after', v_new));
  return true;
end $$;

create or replace function app.recount_range(p_from date, p_to date, p_employee_id uuid default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select a.id from app.leave_applications a
            where a.status in ('pending','approved','cancellation_pending') and a.end_date >= p_from and a.start_date <= p_to
              and (p_employee_id is null or a.employee_id = p_employee_id) loop
    if app.recount_application(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function app.tg_recount_holiday() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'public_holidays' then
    perform app.recount_range(least(coalesce(new.holiday_date, old.holiday_date), coalesce(old.holiday_date, new.holiday_date)),
                              greatest(coalesce(new.holiday_date, old.holiday_date), coalesce(old.holiday_date, new.holiday_date)));
  elsif tg_table_name = 'public_holiday_states' then
    perform app.recount_range(h.holiday_date, h.holiday_date) from app.public_holidays h where h.id = coalesce(new.holiday_id, old.holiday_id);
  elsif tg_table_name = 'replacement_holidays' then
    perform app.recount_range(least(coalesce(new.replacement_date, old.replacement_date), coalesce(old.replacement_date, new.replacement_date)),
                              greatest(coalesce(new.replacement_date, old.replacement_date), coalesce(old.replacement_date, new.replacement_date)));
  elsif tg_table_name = 'holiday_calendar_years' then
    perform app.recount_range(make_date(coalesce(new.year, old.year), 1, 1), make_date(coalesce(new.year, old.year), 12, 31));
  elsif tg_table_name = 'working_pattern_versions' then
    perform app.recount_range(new.effective_from, new.effective_from + 800);
  elsif tg_table_name = 'employee_job_history' then
    perform app.recount_range(new.effective_date, new.effective_date + 800, new.employee_id);
  end if;
  return null;
end $$;

-- ===========================================================================
-- Re-generation hooks: join / continuous-service date, grade, override, separation (EC-EMP-05, F-LV-31, BR-LV-90–92)
-- ===========================================================================
create or replace function app.tg_leave_inputs_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; v_from int; v_to int := extract(year from app.today_myt())::int; y int;
begin
  if tg_table_name = 'employees' then
    v_emp := new.id;
    v_from := extract(year from least(new.join_date, coalesce(old.join_date, new.join_date)))::int;
  elsif tg_table_name = 'employee_personal' then
    v_emp := new.employee_id;
    v_from := extract(year from case when tg_op = 'INSERT' then new.continuous_service_date
                                     else least(new.continuous_service_date, old.continuous_service_date) end)::int;
  elsif tg_table_name = 'leave_entitlement_overrides' then
    perform app.refresh_entitlement(new.employee_id, new.leave_type_id, new.leave_year, 'Override');
    return null;
  else
    v_emp := new.employee_id;
    v_from := extract(year from new.last_working_day)::int;
  end if;
  v_from := greatest(v_from, v_to - 1);                                          -- recompute the current (and previous) year only
  for y in v_from .. v_to loop
    perform app.generate_entitlements(y, v_emp, 'Recalculated');
  end loop;
  return null;
end $$;

-- BR-LV-91 leave position at LWD (E7 preview and the separation snapshot)
create or replace function app.leaver_position(p_employee_id uuid, p_lwd date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record; v_rows jsonb := '[]'; v_after jsonb; v_year int := extract(year from p_lwd)::int; v_calc jsonb; v_bal jsonb;
        v_ent numeric; v_taken_after numeric; v_balance numeric; v_summary text := 'No leave balance to settle.';
begin
  if not app.is_admin() and app.current_app_user_id() is not null then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  for r in select t.* from app.leave_types t where t.is_active and t.entitlement_method = 'annual_banded' order by t.display_order loop
    v_calc := app.compute_entitlement(p_employee_id, r.id, v_year, null, p_lwd);
    v_bal := app.leave_balance(p_employee_id, r.id, v_year);
    v_ent := coalesce((v_calc ->> 'entitled')::numeric, 0);
    select coalesce(sum(d.weight), 0) into v_taken_after from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
     where a.employee_id = p_employee_id and app.balance_type_id(a.leave_type_id) = r.id and a.status in ('approved','cancellation_pending')
       and d.leave_date > p_lwd and d.leave_year = v_year;
    v_balance := v_ent + (v_bal ->> 'carried_forward')::numeric + (v_bal ->> 'earned_credits')::numeric + (v_bal ->> 'adjustments')::numeric
                 - ((v_bal ->> 'taken')::numeric - v_taken_after) - (v_bal ->> 'expired_forfeited')::numeric
                 - (v_bal ->> 'entitled')::numeric + (v_bal ->> 'entitled')::numeric;
    -- opening entitlement rows (migration) stay part of the entitlement
    v_balance := v_balance + greatest((v_bal ->> 'entitled')::numeric - coalesce((select sum(l.days) from app.leave_ledger l where l.employee_id = p_employee_id
                   and l.leave_type_id = r.id and l.leave_year = v_year and l.entry_type = 'entitlement' and not l.is_opening), 0), 0);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('leave_type_id', r.id, 'code', r.code, 'name', r.name, 'category', r.category, 'colour', r.calendar_colour,
      'entitled_to_lwd', v_ent, 'taken', (v_bal ->> 'taken')::numeric - v_taken_after, 'balance', v_balance,
      'encashable', case when v_balance > 0 and r.payroll_treatment = 'paid_encashable' then v_balance else 0 end,
      'recoverable', case when v_balance < 0 then -v_balance else 0 end));
    if r.category = 'annual' then
      v_summary := case when v_balance > 0 then 'Encashable ' || v_balance::text || ' day(s)' when v_balance < 0 then 'Recoverable ' || (-v_balance)::text || ' day(s)'
                        else 'No annual leave to settle' end;
    end if;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('ref_no', a.ref_no, 'start_date', a.start_date, 'end_date', a.end_date, 'days', a.days) order by a.start_date), '[]')
    into v_after from app.leave_applications a where a.employee_id = p_employee_id and a.status in ('approved','cancellation_pending','pending') and a.end_date > p_lwd;
  return jsonb_build_object('last_working_day', p_lwd, 'rows', v_rows, 'leave_after_lwd', v_after, 'summary', v_summary);
end $$;

create or replace function app.tg_separation_leave() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_lwd date; v_emp uuid; r record;
begin
  v_emp := new.employee_id;
  perform app.generate_entitlements(extract(year from coalesce(app.employee_active_lwd(v_emp), app.today_myt()))::int, v_emp, 'Recalculated to last working day');
  v_lwd := app.employee_active_lwd(v_emp);
  if tg_table_name = 'employee_separation_details' and v_lwd is not null then
    update app.employee_separation_details d set final_leave_position = app.leaver_position(v_emp, v_lwd) where d.separation_id = new.separation_id;
    -- BR-LV-92: approved leave after the LWD is flagged to HR; employee + manager notified
    for r in select a.ref_no from app.leave_applications a where a.employee_id = v_emp and a.status in ('approved','cancellation_pending') and a.end_date > v_lwd loop
      perform app.notify_role_holders(array['ADM']::app.privileged_role[], 'N-06', left('Leave after last working day: ' || r.ref_no, 150),
        app.employee_display(v_emp) || ' — cancel or shorten it', '/leave/applications', true, null, null, null);
      perform app.notify_employee(v_emp, 'N-06', 'Leave after your last working day: ' || r.ref_no, 'HR will cancel or shorten it.', '/my/leave/' || r.ref_no, false, null, null);
    end loop;
  end if;
  return null;
end $$;

-- ===========================================================================
-- Year-end roll-over (F-LV-19, BR-LV-70–74) — preview then commit; idempotent per closing year
-- ===========================================================================
create or replace function app.rollover_preview(p_closing_year int) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_run uuid; pol app.leave_policy%rowtype; r record; v_bal jsonb; v_close numeric; v_cap numeric; v_cf numeric; v_exp date; v_new jsonb; v_months int;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  select * into pol from app.leave_policy where id = 1;
  update app.rollover_runs set status = 'superseded' where closing_year = p_closing_year and status = 'previewed';
  insert into app.rollover_runs (closing_year, previewed_by) values (p_closing_year, app.current_app_user_id()) returning id into v_run;
  for r in select e.id as emp, t.* from app.employees e cross join app.leave_types t
            where t.is_active and (t.carry_forward_allowed or (t.entitlement_method = 'earned_credits' and pol.replacement_credits_carry_forward is not null))
              and e.status <> 'withdrawn' and e.join_date <= make_date(p_closing_year, 12, 31)
              and (app.employee_active_lwd(e.id) is null or app.employee_active_lwd(e.id) > make_date(p_closing_year, 12, 31)) loop
    v_bal := app.leave_balance(r.emp, r.id, p_closing_year);
    v_close := (v_bal ->> 'balance')::numeric;
    continue when v_close = 0 and not exists (select 1 from app.leave_ledger l where l.employee_id = r.emp and l.leave_type_id = r.id and l.leave_year = p_closing_year);
    if r.entitlement_method = 'earned_credits' then
      v_cf := case when pol.replacement_credits_carry_forward then greatest(v_close, 0) else 0 end; v_exp := null;
    else
      v_cap := coalesce(r.cf_cap_override, pol.carry_forward_cap_days);
      v_months := coalesce(r.cf_expiry_months_override, pol.carry_forward_expiry_months);
      v_cf := least(greatest(v_close, 0), v_cap);
      v_exp := case when v_months > 0 then (make_date(p_closing_year + 1, 1, 1) + make_interval(months => v_months))::date - 1 end;
    end if;
    v_new := app.compute_entitlement(r.emp, r.id, p_closing_year + 1);
    insert into app.rollover_lines (run_id, employee_id, leave_type_id, closing_balance, carry_forward, forfeited, new_year_entitlement, cf_expiry_date)
    values (v_run, r.emp, r.id, v_close, v_cf, greatest(v_close, 0) - v_cf, coalesce((v_new ->> 'entitled')::numeric, 0), v_exp);
  end loop;
  update app.rollover_runs set summary = (select jsonb_build_object('employees', count(distinct employee_id), 'carried', coalesce(sum(carry_forward), 0),
                                                                   'forfeited', coalesce(sum(forfeited), 0)) from app.rollover_lines where run_id = v_run)
   where id = v_run;
  return v_run;
end $$;

create or replace function app.rollover_blockers(p_closing_year int) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when not app.holiday_year_published(p_closing_year + 1) then 'Publish the ' || (p_closing_year + 1) || ' holiday calendar first.' end,
    case when app.today_myt() < make_date(p_closing_year, 12, 1) or app.today_myt() > make_date(p_closing_year + 1, 1, 31)
         then 'Roll-over for ' || p_closing_year || ' runs between 01/12/' || p_closing_year || ' and 31/01/' || (p_closing_year + 1) || '.' end
  ], null)
$$;

create or replace function app.rollover_commit(p_run_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare run app.rollover_runs%rowtype; l record; v_existing app.rollover_runs%rowtype; v_blockers text[]; c record; pol app.leave_policy%rowtype; v_left numeric; v_use numeric;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  select * into run from app.rollover_runs where id = p_run_id for update;
  if run.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('rollover:' || run.closing_year));
  select * into v_existing from app.rollover_runs where closing_year = run.closing_year and status = 'committed';
  if v_existing.id is not null then
    return jsonb_build_object('already_run', true, 'run_id', v_existing.id, 'summary', v_existing.summary,
                              'committed_at', v_existing.committed_at, 'committed_by', app.user_name(v_existing.committed_by));
  end if;
  if run.status <> 'previewed' then raise exception 'PRET-ROLLOVER-STALE: preview again' using errcode = '23514'; end if;
  v_blockers := app.rollover_blockers(run.closing_year);
  if cardinality(v_blockers) > 0 then raise exception 'PRET-ROLLOVER-BLOCKED: %', v_blockers[1] using errcode = '23514'; end if;
  select * into pol from app.leave_policy where id = 1;
  perform set_config('app.actor_label', 'rollover:' || run.closing_year, true);
  for l in select rl.*, t.entitlement_method from app.rollover_lines rl join app.leave_types t on t.id = rl.leave_type_id where rl.run_id = run.id loop
    if l.carry_forward > 0 then
      insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, source_rollover_id, reason)
      values (l.employee_id, l.leave_type_id, run.closing_year, 'forfeited', -l.carry_forward, make_date(run.closing_year, 12, 31), run.id,
              'Carried forward to ' || (run.closing_year + 1));
      if l.entitlement_method = 'earned_credits' then
        -- one carry-forward row per unexpired credit, keeping the credit's own expiry (BR-LV-83)
        v_left := l.carry_forward;
        for c in select rc.id, rc.remaining_days, rc.expiry_date from app.replacement_credits rc
                  where rc.employee_id = l.employee_id and rc.status = 'approved' and rc.remaining_days > 0 and rc.expired_at is null
                  order by rc.expiry_date nulls last loop
          exit when v_left <= 0;
          v_use := least(v_left, c.remaining_days);
          insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, expires_on, source_rollover_id, source_credit_id, reason)
          values (l.employee_id, l.leave_type_id, run.closing_year + 1, 'carry_forward', v_use, make_date(run.closing_year + 1, 1, 1), c.expiry_date, run.id, c.id,
                  'Carried forward from ' || run.closing_year);
          v_left := v_left - v_use;
        end loop;
      else
        insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, expires_on, source_rollover_id, reason)
        values (l.employee_id, l.leave_type_id, run.closing_year + 1, 'carry_forward', l.carry_forward, make_date(run.closing_year + 1, 1, 1), l.cf_expiry_date, run.id,
                'Carried forward from ' || run.closing_year);
      end if;
    end if;
    if l.forfeited > 0 then
      insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, source_rollover_id, reason)
      values (l.employee_id, l.leave_type_id, run.closing_year, 'forfeited', -l.forfeited, make_date(run.closing_year, 12, 31), run.id, 'Forfeited at year end');
      if l.entitlement_method = 'earned_credits' and not pol.replacement_credits_carry_forward then
        update app.replacement_credits set expired_days = expired_days + remaining_days, remaining_days = 0, expired_at = now()
         where employee_id = l.employee_id and status = 'approved' and remaining_days > 0 and expired_at is null;
      end if;
    end if;
  end loop;
  perform app.generate_entitlements(run.closing_year + 1, null, 'Entitlement');
  update app.rollover_runs set status = 'committed', committed_by = app.current_app_user_id(), committed_at = now() where id = run.id;
  perform app.notify_role_holders(array['ADM']::app.privileged_role[], 'N-18', 'Year-end roll-over ' || run.closing_year || ' completed',
    'Carried ' || coalesce(run.summary ->> 'carried', '0') || ' · forfeited ' || coalesce(run.summary ->> 'forfeited', '0') || ' days',
    '/leave/year-end', false, null, null, null);
  return jsonb_build_object('already_run', false, 'run_id', run.id, 'summary', run.summary);
end $$;

-- ===========================================================================
-- F-LV-35 opening balances on creation (HR, not own; once per employee)
-- ===========================================================================
create or replace function app.save_opening_leave(p_employee_id uuid, p jsonb) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_year int := extract(year from app.today_myt())::int; v_join date; r record; n int := 0; v_rl uuid; v_id uuid; v_pl uuid;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if app.is_self(p_employee_id) then raise exception 'PRET-SELF-001' using errcode = '42501'; end if;
  select e.join_date into v_join from app.employees e where e.id = p_employee_id;
  if v_join is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if exists (select 1 from app.leave_ledger l where l.employee_id = p_employee_id and l.is_opening) then
    raise exception 'PRET-LV-OPENING-DONE: opening balances were already entered — use a balance adjustment' using errcode = '23514';
  end if;
  perform app.generate_entitlements(v_year, p_employee_id);
  for r in select (x ->> 'leave_type_id')::uuid as typ, coalesce((x ->> 'taken_this_year')::numeric, 0) as taken,
                  coalesce((x ->> 'carry_forward')::numeric, 0) as cf, nullif(x ->> 'carry_forward_expiry', '')::date as cf_exp
             from jsonb_array_elements(coalesce(p -> 'rows', '[]'::jsonb)) x loop
    if r.taken > 0 then
      insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, is_opening, reason)
      values (p_employee_id, r.typ, v_year, 'taken', -r.taken, greatest(v_join, make_date(v_year, 1, 1)), true, 'Opening balance: taken this year'); n := n + 1;
    end if;
    if r.cf > 0 then
      insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, expires_on, is_opening, reason)
      values (p_employee_id, r.typ, v_year, 'carry_forward', r.cf, make_date(v_year, 1, 1), r.cf_exp, true, 'Opening balance: carry-forward'); n := n + 1;
    end if;
  end loop;
  select t.id into v_rl from app.leave_types t where t.category = 'replacement' and t.is_active and t.entitlement_method = 'earned_credits' order by t.display_order limit 1;
  for r in select (x ->> 'date_worked')::date as dw, (x ->> 'days')::numeric as d, (x ->> 'expiry_date')::date as ex
             from jsonb_array_elements(coalesce(p -> 'credits', '[]'::jsonb)) x loop
    insert into app.replacement_credits (credit_no, employee_id, date_worked, duration, credit_days, day_kind, day_type_label, reason, status, workflow_id,
                                         expiry_date, remaining_days, is_opening, entered_by_admin, decided_at, decided_by)
    select private.next_doc_no('RL', v_year), p_employee_id, r.dw, case when r.d = 1 then 'full_day' else 'half_day' end::app.credit_duration, r.d,
           'opening', 'Opening balance', 'Opening balance (F-LV-35)', 'approved', t.workflow_id, r.ex, r.d, true, app.current_app_user_id(), now(), app.current_app_user_id()
      from app.leave_types t where t.id = v_rl
    returning id into v_id;
    insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, expires_on, is_opening, source_credit_id, reason)
    values (p_employee_id, v_rl, v_year, 'credit_earned', r.d, r.dw, r.ex, true, v_id, 'Opening balance: replacement credit'); n := n + 1;
  end loop;
  if coalesce((p ->> 'paternity_occurrences_used')::int, 0) > 0 then
    select t.id into v_pl from app.leave_types t where t.category = 'paternity' and t.is_active limit 1;
    if v_pl is not null then
      insert into app.employee_leave_counters (employee_id, leave_type_id, migrated_occurrences) values (p_employee_id, v_pl, (p ->> 'paternity_occurrences_used')::int)
      on conflict (employee_id, leave_type_id) do update set migrated_occurrences = excluded.migrated_occurrences;
      n := n + 1;
    end if;
  end if;
  return n;
end $$;

alter table app.statutory_floor_overrides alter constraint statutory_floor_overrides_leave_type_id_fkey deferrable initially deferred;

-- ===========================================================================
-- Configuration guards (BR-LV-01, BR-LV-02, LT3 lock, workflows in use) and the statutory floor
-- ===========================================================================
-- An SA override row for this leave type written in this transaction (BR-LV-02).
create or replace function app.floor_override_present(p_type_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.statutory_floor_overrides o join app.user_roles r on r.user_id = o.approved_by and r.role = 'SA' and r.revoked_at is null
                  where o.leave_type_id = p_type_id and o.approved_at = now())
$$;

create or replace function app.tg_leave_types_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_used boolean; v_msg text;
begin
  if tg_op = 'UPDATE' and new.category is distinct from old.category then
    v_used := exists (select 1 from app.leave_applications a where a.leave_type_id = old.id) or exists (select 1 from app.leave_ledger l where l.leave_type_id = old.id);
    if v_used then raise exception 'PRET-LV-CATEGORY-LOCKED: the category cannot change once the type is used' using errcode = '23514'; end if;
  end if;
  -- BR-LV-01: the statutory five cannot be deactivated while anyone is eligible
  if tg_op = 'UPDATE' and old.is_active and not new.is_active and old.category in ('annual','sick','hospitalisation','maternity','paternity')
     and exists (select 1 from app.employees e where e.status in ('pending_join','on_probation','confirmed','notice_period')
                   and (old.eligible_gender = 'all' or old.eligible_gender::text = e.gender::text)) then
    raise exception 'PRET-LV-STATUTORY-ACTIVE: % cannot be deactivated while employees are eligible (BR-LV-01)', old.name using errcode = '23514';
  end if;
  -- BR-LV-02 floor for per-occurrence and pooled statutory types
  v_msg := case
    when new.category = 'maternity' and new.entitlement_method = 'fixed_per_occurrence' and new.days_per_occurrence < 98 then 'Maternity must be at least 98 consecutive days (s37).'
    when new.category = 'paternity' and new.entitlement_method = 'fixed_per_occurrence' and new.days_per_occurrence < 7 then 'Paternity must be at least 7 consecutive days (s60FA).'
    when new.category = 'paternity' and new.max_occurrences is not null and new.max_occurrences < 5 then 'Paternity must allow 5 confinements (s60FA).'
    when new.category = 'hospitalisation' and new.pool_cap_days is not null and new.pool_cap_days < 60 then 'Hospitalisation must allow 60 days with sick leave (s60F).'
    end;
  if v_msg is not null and new.is_active and not app.floor_override_present(new.id) then
    raise exception 'PRET-LV-FLOOR: Below Employment Act minimum (s60E/s60F/s37/s60FA). %', v_msg using errcode = '23514';
  end if;
  return new;
end $$;

-- Bands: contiguous from 0 per (type, year, grade) and ≥ the statutory minimum (deferred: checked once per transaction state)
create or replace function app.tg_bands_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_type uuid := coalesce(new.leave_type_id, old.leave_type_id); v_year int := coalesce(new.effective_year, old.effective_year); g record; v_cat app.leave_category; b record; v_min numeric;
begin
  for g in select distinct grade_id from app.leave_entitlement_bands where leave_type_id = v_type and effective_year = v_year loop
    if not exists (select 1 from app.leave_entitlement_bands where leave_type_id = v_type and effective_year = v_year and grade_id is not distinct from g.grade_id and service_from_years = 0)
       or (select count(*) from app.leave_entitlement_bands where leave_type_id = v_type and effective_year = v_year and grade_id is not distinct from g.grade_id and service_to_years is null) <> 1
       or exists (select 1 from app.leave_entitlement_bands x where x.leave_type_id = v_type and x.effective_year = v_year and x.grade_id is not distinct from g.grade_id
                    and x.service_to_years is not null
                    and not exists (select 1 from app.leave_entitlement_bands y where y.leave_type_id = v_type and y.effective_year = v_year
                                      and y.grade_id is not distinct from g.grade_id and y.service_from_years = x.service_to_years)) then
      raise exception 'PRET-LV-BANDS: Bands must run from 0 years with no gaps or overlaps' using errcode = '23514';
    end if;
  end loop;
  select category into v_cat from app.leave_types where id = v_type;
  for b in select * from app.leave_entitlement_bands where leave_type_id = v_type and effective_year = v_year loop
    select max(m.min_days) into v_min from app.statutory_leave_minimums m
     where m.category = v_cat and numrange(m.service_from_years, coalesce(m.service_to_years, 999), '[)') && numrange(b.service_from_years, coalesce(b.service_to_years, 999), '[)');
    if v_min is not null and b.days_per_year < v_min and not app.floor_override_present(v_type) then
      raise exception 'PRET-LV-FLOOR: Below Employment Act minimum (s60E/s60F/s37/s60FA). % years: % days is below the statutory %.',
        b.service_from_years, b.days_per_year, v_min using errcode = '23514';
    end if;
  end loop;
  return null;
end $$;

create or replace function app.tg_override_floor() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_cat app.leave_category; v_csd date; v_min numeric;
begin
  if not new.is_active then return new; end if;
  select category into v_cat from app.leave_types where id = new.leave_type_id;
  select coalesce(p.continuous_service_date, e.join_date) into v_csd from app.employees e left join app.employee_personal p on p.employee_id = e.id where e.id = new.employee_id;
  v_min := app.statutory_min_days(v_cat, app.service_years(v_csd, make_date(new.leave_year, 12, 31)));
  if v_min is not null and new.days < v_min and not app.floor_override_present(new.leave_type_id) then
    raise exception 'PRET-LV-FLOOR: Below Employment Act minimum (s60E/s60F/s37/s60FA). % days is below the statutory %.', new.days, v_min using errcode = '23514';
  end if;
  if current_user = 'authenticated' then
    new.created_by := app.current_app_user_id();
    if tg_op = 'UPDATE' and not new.is_active and old.is_active then new.removed_at := now(); new.removed_by := app.current_app_user_id(); end if;
  end if;
  return new;
end $$;

create or replace function app.tg_workflow_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_wf uuid; v_n int; v_max int;
begin
  if tg_table_name = 'approval_workflows' then
    if new.is_active = false and old.is_active and exists (select 1 from app.leave_types t where t.workflow_id = new.id and t.is_active) then
      raise exception 'PRET-WF-IN-USE: this workflow is assigned to an active leave type' using errcode = '23514';
    end if;
    return null;
  end if;
  v_wf := coalesce(new.workflow_id, old.workflow_id);
  select count(*), coalesce(max(level), 0) into v_n, v_max from app.approval_workflow_levels where workflow_id = v_wf;
  if exists (select 1 from app.approval_workflows w where w.id = v_wf) and (v_n = 0 or v_n <> v_max) then
    raise exception 'PRET-WF-LEVELS: levels must run 1, 2, 3 without gaps' using errcode = '23514';
  end if;
  return null;
end $$;

-- LP18 change → regenerate replacement holidays (W2-002 generator reads leave_policy)
create or replace function app.tg_leave_policy_after() returns trigger
language plpgsql security definer set search_path = '' as $$
declare y int := extract(year from app.today_myt())::int;
begin
  if new.replacement_for_ph_on_off_day is distinct from old.replacement_for_ph_on_off_day then
    perform app.regenerate_replacement_holidays(y);
    perform app.regenerate_replacement_holidays(y + 1);
  end if;
  return null;
end $$;

-- ===========================================================================
-- apply_current_job (W2-003) + BR-LV-61: re-route open direct-manager tasks when the reporting line changes
-- ===========================================================================
create or replace function app.tg_employee_approver_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.manager_employee_id is distinct from old.manager_employee_id or new.leave_approver_employee_id is distinct from old.leave_approver_employee_id then
    perform app.reroute_open_tasks(new.id);
  end if;
  if new.status is distinct from old.status and new.status in ('separated','withdrawn') then
    perform app.reroute_open_tasks(null);
  end if;
  return null;
end $$;

-- ===========================================================================
-- Triggers
-- ===========================================================================
create trigger tg_stamp before insert or update on app.leave_policy for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.approval_workflows for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.leave_types for each row execute function app.tg_stamp();
create trigger tg_stamp before insert on app.leave_entitlement_bands for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.leave_applications for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.replacement_credits for each row execute function app.tg_stamp();

create trigger tg_10_guard before insert or update on app.leave_types for each row execute function app.tg_leave_types_guard();
create constraint trigger tg_bands_check after insert or update or delete on app.leave_entitlement_bands
  deferrable initially deferred for each row execute function app.tg_bands_check();
create trigger tg_floor before insert or update on app.leave_entitlement_overrides for each row execute function app.tg_override_floor();
create trigger tg_recompute after insert or update on app.leave_entitlement_overrides for each row execute function app.tg_leave_inputs_changed();
create trigger tg_in_use after update of is_active on app.approval_workflows for each row execute function app.tg_workflow_check();
create constraint trigger tg_levels_check after insert or update or delete on app.approval_workflow_levels
  deferrable initially deferred for each row execute function app.tg_workflow_check();
create trigger tg_after after update on app.leave_policy for each row execute function app.tg_leave_policy_after();

create trigger tg_20_transition before update on app.leave_applications for each row execute function app.tg_leave_transition();
create trigger tg_after after insert or update on app.leave_applications for each row execute function app.tg_leave_after();
create trigger tg_10_before before insert or update or delete on app.leave_ledger for each row execute function app.tg_ledger_before();
create trigger tg_after after insert on app.leave_ledger for each row execute function app.tg_ledger_after();
create trigger tg_decision before insert or update on app.approval_tasks for each row execute function app.tg_task_decision();

create trigger tg_leave_recount after insert or update or delete on app.public_holidays for each row execute function app.tg_recount_holiday();
create trigger tg_leave_recount after insert or delete on app.public_holiday_states for each row execute function app.tg_recount_holiday();
create trigger tg_leave_recount after insert or update on app.replacement_holidays for each row execute function app.tg_recount_holiday();
create trigger tg_leave_recount after update of status on app.holiday_calendar_years for each row execute function app.tg_recount_holiday();
create trigger tg_leave_recount after insert on app.working_pattern_versions for each row execute function app.tg_recount_holiday();
create trigger tg_leave_recount after insert or update on app.employee_job_history for each row execute function app.tg_recount_holiday();

create trigger tg_leave_inputs after update of join_date, grade_id on app.employees for each row
  when (old.join_date is distinct from new.join_date or old.grade_id is distinct from new.grade_id) execute function app.tg_leave_inputs_changed();
create trigger tg_leave_inputs after insert or update of continuous_service_date on app.employee_personal for each row execute function app.tg_leave_inputs_changed();
create trigger tg_leave_approvers after update on app.employees for each row execute function app.tg_employee_approver_change();
create trigger tg_leave_position after insert or update of last_working_day, is_withdrawn, superseded_by_rehire on app.employee_separations for each row execute function app.tg_separation_leave();
create trigger tg_leave_position after insert on app.employee_separation_details for each row execute function app.tg_separation_leave();
