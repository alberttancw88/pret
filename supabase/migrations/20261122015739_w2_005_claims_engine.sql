-- PRET W2-005 · 02 — claims engine: periods, limits (BR-CLM-13/14), validation (BR-CLM-10–22), save / submit / withdraw /
-- delete / copy / late overrides, transition guard (rls §7 layer 5), line guards, and the claims plug-in of the GENERIC approval
-- engine (ADR-0004, W2-004): task_subject_facts, route_approval, notify_task, decide_task, reroute / reassign learn the
-- 'claim' and 'disbursement_batch' subjects. One task per claim (D12): source claim_pool — the claimant's claim approver (F16) or
-- manager (+ delegate) OR any ADM / SA; never the claimant, never the on-behalf preparer (subject_prepared_by).

-- line numbers are renumbered on every save → the uniqueness is checked at commit
alter table app.claim_lines drop constraint ux_claim_lines_no;
alter table app.claim_lines add constraint ux_claim_lines_no unique (claim_id, line_no) deferrable initially deferred;

-- ===========================================================================
-- Helpers
-- ===========================================================================
create or replace function app.rm(p numeric) returns text
language sql immutable set search_path = '' as $$ select 'RM ' || to_char(coalesce(p, 0), 'FM999,999,999,990.00') $$;

create or replace function app.money_text(p numeric) returns text
language sql immutable set search_path = '' as $$ select case when p is null then null else (round(p, 2))::numeric(14,2)::text end $$;

create or replace function app.claim_issue(p_line_no int, p_line_id uuid, p_code text, p_field text, p_severity text, p_message text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('lineNo', p_line_no, 'lineId', p_line_id, 'code', p_code, 'field', p_field, 'severity', p_severity, 'message', p_message)
$$;

create or replace function app.claim_event(p_claim_id uuid, p_event text, p_from app.claim_status, p_to app.claim_status,
                                           p_acting app.acting_as default null, p_comment text default null, p_batch uuid default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id();
begin
  insert into app.claim_events (claim_id, employee_id, event, from_status, to_status, actor_user_id, actor_name, acting_as, comment, batch_id)
  select c.id, c.employee_id, left(p_event, 200), p_from, p_to, v_actor, coalesce(app.user_name(v_actor), 'System'), p_acting, left(p_comment, 500), p_batch
    from app.claims c where c.id = p_claim_id;
end $$;

-- CC11 rate effective on a date (EC-CLM-06)
create or replace function app.claim_rate_on(p_category_id uuid, p_date date) returns numeric
language sql stable security definer set search_path = '' as $$
  select r.rate_per_km from app.claim_category_rates r where r.category_id = p_category_id and r.effective_from <= p_date
   order by r.effective_from desc limit 1
$$;

-- BR-CLM-13 period containing a date; refresh day R (31 = month end). month: ends on day R; year: ends on R December.
create or replace function app.claim_period(p_date date, p_kind text, p_refresh int default null) returns daterange
language plpgsql stable security definer set search_path = '' as $$
declare
  r int := coalesce(p_refresh, (select p.limit_refresh_day from app.claim_policy p where p.id = 1), 31);
  m date := date_trunc('month', p_date)::date; v_end date; v_prev date; v_next date; y int := extract(year from p_date)::int;
begin
  if p_kind = 'month' then
    v_end := least(m + (r - 1), (m + interval '1 month')::date - 1);
    if p_date <= v_end then
      v_prev := least((m - interval '1 month')::date + (r - 1), m - 1);
      return daterange(v_prev + 1, v_end, '[]');
    end if;
    v_next := least((m + interval '1 month')::date + (r - 1), (m + interval '2 month')::date - 1);
    return daterange(v_end + 1, v_next, '[]');
  end if;
  if p_date <= make_date(y, 12, r) then return daterange(make_date(y - 1, 12, r) + 1, make_date(y, 12, r), '[]'); end if;
  return daterange(make_date(y, 12, r) + 1, make_date(y + 1, 12, r), '[]');
end $$;

-- BR-CLM-14 precedence: employee > department > grade > employee group > everyone (effective on the transaction date)
create or replace function app.claim_limit_for(p_employee_id uuid, p_category_id uuid, p_date date) returns app.claim_limits
language sql stable security definer set search_path = '' as $$
  select l.* from app.claim_limits l join app.employees e on e.id = p_employee_id
   where l.category_id = p_category_id and l.effective_from <= p_date and (l.effective_to is null or l.effective_to >= p_date)
     and (   l.applies_to = 'everyone'
          or (l.applies_to = 'employee' and l.employee_id = e.id)
          or (l.applies_to = 'department' and l.department_id = e.department_id)
          or (l.applies_to = 'grade' and l.grade_id = e.grade_id)
          or (l.applies_to = 'employee_group' and exists (select 1 from app.employee_group_members gm where gm.group_id = l.employee_group_id and gm.employee_id = e.id)))
   order by case l.applies_to when 'employee' then 1 when 'department' then 2 when 'grade' then 3 when 'employee_group' then 4 else 5 end,
            l.effective_from desc
   limit 1
$$;

-- Σ of the employee's live lines (Submitted / Approved / Disbursed) in a category and period, excluding one claim.
create or replace function app.claim_used(p_employee_id uuid, p_category_id uuid, p_period daterange, p_exclude_claim uuid default null) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(l.amount_incl_sst), 0) from app.claim_lines l
   where l.is_live and l.employee_id = p_employee_id and l.category_id = p_category_id and l.transaction_date <@ p_period
     and l.claim_id is distinct from p_exclude_claim
$$;

-- CLN16 — same result shape as LimitCheck in src/server/contracts/claims-engine.ts (reference mirror, unit-tested).
create or replace function app.claim_limit_eval(p_limit app.claim_limits, p_amount numeric, p_used_month numeric, p_used_year numeric) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare b text; lim numeric; used numeric; best_b text; best_l numeric; best_u numeric;
begin
  if p_limit.id is null or num_nonnulls(p_limit.per_transaction, p_limit.per_month, p_limit.per_year) = 0 then
    return jsonb_build_object('status', 'no_limit', 'behaviour', null, 'basis', null, 'limit', null, 'used', null, 'overBy', null, 'blocking', false, 'message', 'No limit');
  end if;
  foreach b in array array['transaction', 'month', 'year'] loop
    lim := case b when 'transaction' then p_limit.per_transaction when 'month' then p_limit.per_month else p_limit.per_year end;
    continue when lim is null;
    used := p_amount + case b when 'transaction' then 0 when 'month' then coalesce(p_used_month, 0) else coalesce(p_used_year, 0) end;
    if used > lim then
      return jsonb_build_object('status', 'over', 'behaviour', p_limit.behaviour, 'basis', b, 'limit', app.money_text(lim), 'used', app.money_text(used),
        'overBy', app.money_text(used - lim), 'blocking', p_limit.behaviour = 'block',
        'message', case when p_limit.behaviour = 'block'
                        then case when b = 'transaction' then 'Exceeds ' || app.rm(lim) || ' per transaction'
                                  else 'Exceeds ' || app.rm(lim) || ' per ' || b || ' (over by ' || app.rm(used - lim) || ')' end
                        else 'Over limit by ' || app.rm(used - lim) || ' (warning)' end);
    end if;
    if best_b is null or (lim - used) < (best_l - best_u) then best_b := b; best_l := lim; best_u := used; end if;
  end loop;
  return jsonb_build_object('status', 'within', 'behaviour', p_limit.behaviour, 'basis', best_b, 'limit', app.money_text(best_l), 'used', app.money_text(best_u),
    'overBy', null, 'blocking', false,
    'message', 'Within limit (' || app.rm(best_u) || ' of ' || app.rm(best_l) ||
               case best_b when 'transaction' then '' when 'month' then ' this month' else ' this year' end || ')');
end $$;

-- Who decides (D12): claim approver (F16) else manager; unavailable / on leave without delegate → their manager (BR-LV-61
-- pattern); none → nobody named (any ADM / SA still decides — claim_pool).
create or replace function app.resolve_claim_approver(p_employee_id uuid, p_on date, out assignee uuid, out original uuid, out note text)
language plpgsql stable security definer set search_path = '' as $$
declare v_person uuid; v_user uuid; v_mgr uuid; v_hops int := 0;
begin
  select coalesce(e.claim_approver_employee_id, e.manager_employee_id) into v_person from app.employees e where e.id = p_employee_id;
  if v_person is null then note := 'Top of organisation — any Admin or Super Admin may decide (Q11)'; return; end if;
  if v_person = p_employee_id then note := 'Approver is the claimant — any Admin or Super Admin may decide (FR-G-16)'; return; end if;
  loop
    v_user := app.active_user_of(v_person);
    exit when v_user is not null and not (app.is_on_leave(v_person, p_on) and app.active_delegate(v_user, p_on, 'claims') is null);
    if original is null then original := v_user; end if;
    note := case when v_user is null then 'Re-routed: approver unavailable' else 'Re-routed: approver on leave' end;
    v_hops := v_hops + 1;
    select m.manager_employee_id into v_mgr from app.employees m where m.id = v_person;
    if v_mgr is null or v_mgr = p_employee_id or v_hops > 5 then
      assignee := null; note := note || ' — any Admin or Super Admin may decide'; return;
    end if;
    v_person := v_mgr;
  end loop;
  assignee := v_user;
  if original is not null then note := note || ' (' || app.employee_display(v_person) || ')'; end if;
  if app.active_delegate(v_user, p_on, 'claims') is not null then
    note := coalesce(note || '; ', '') || 'Delegate: ' || app.user_name(app.active_delegate(v_user, p_on, 'claims'));
  end if;
end $$;

create or replace function app.claim_approver_hint(p_employee_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r record;
begin
  if not app.can_see_team_row(p_employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  select * into r from app.resolve_claim_approver(p_employee_id, app.today_myt());
  if r.assignee is null then return 'Goes to any Admin or Super Admin for approval.'; end if;
  return 'Goes to ' || app.user_name(r.assignee) || ' or any Admin for approval.';
end $$;

-- ===========================================================================
-- Validation (BR-CLM-10–22). Returns { issues: [...], lines: [{ lineId, lineNo, limitCheck, duplicateOf }], flags }.
-- ===========================================================================
create or replace function app.claim_evaluate(p_claim_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c app.claims%rowtype; pol app.claim_policy%rowtype; e record; l record; cat app.claim_categories%rowtype; v_lim app.claim_limits;
  v_issues jsonb := '[]'; v_lines jsonb := '[]'; v_today date := app.today_myt(); v_lwd date; v_csd date; v_m daterange; v_y daterange;
  v_um numeric; v_uy numeric; v_chk jsonb; v_files int; v_dup text[]; v_x text; v_over boolean := false; v_dupflag boolean := false; v_late boolean := false;
  v_svc int; v_n int := 0;
begin
  select * into c from app.claims where id = p_claim_id;
  select * into pol from app.claim_policy where id = 1;
  select emp.id, emp.status, emp.grade_id, emp.join_date into e from app.employees emp where emp.id = c.employee_id;
  select p.continuous_service_date into v_csd from app.employee_personal p where p.employee_id = c.employee_id;
  select s.last_working_day into v_lwd from app.employee_separations s where s.employee_id = c.employee_id and not s.is_withdrawn and not s.superseded_by_rehire;
  for l in select * from app.claim_lines where claim_id = p_claim_id order by line_no loop
    v_n := v_n + 1;
    select * into cat from app.claim_categories where id = l.category_id;
    v_dup := '{}'; v_chk := null;
    if not cat.is_active and c.status = 'new' then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'category', 'categoryId', 'block', 'This category is no longer available — choose another.');
    end if;
    -- eligibility (BR-CLM-18)
    v_svc := app.completed_months(coalesce(v_csd, e.join_date), l.transaction_date);
    if v_svc < cat.min_service_months then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'eligibility', 'categoryId', 'block',
        'Not eligible yet: needs ' || cat.min_service_months || ' months'' service.');
    end if;
    if e.status not in ('separated') and not (e.status = any(cat.eligible_statuses)) then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'eligibility', 'categoryId', 'block', 'Not eligible for this category in your employment status.');
    end if;
    if exists (select 1 from app.claim_category_grades g where g.category_id = cat.id)
       and not exists (select 1 from app.claim_category_grades g where g.category_id = cat.id and g.grade_id = e.grade_id) then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'eligibility', 'categoryId', 'block', 'Not eligible for this category in your grade.');
    end if;
    -- dates (BR-CLM-10, BR-CLM-18)
    if l.transaction_date > v_today then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'deadline', 'transactionDate', 'block', 'The transaction date cannot be in the future.');
    elsif v_lwd is not null and l.transaction_date > v_lwd then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'lwd', 'transactionDate', 'block', 'After the last working day (' || app.dmy(v_lwd) || ').');
    elsif l.transaction_date < v_today - pol.submission_deadline_days then
      if l.late_override then v_late := true;
      else v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'deadline', 'transactionDate', 'block',
             'Older than ' || pol.submission_deadline_days || ' days — Admin override required'); end if;
    end if;
    -- capture rules (BR-CLM-12, CC7/CC8/CC12)
    select count(*) into v_files from app.claim_line_files f where f.claim_line_id = l.id;
    if cat.receipt_required and v_files = 0 then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'receipt', 'fileIds', 'block', 'Attach the receipt.');
    end if;
    if cat.notes_required and l.description is null then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'notes', 'description', 'block', 'Add the description / notes.');
    end if;
    if cat.receipt_no_mode = 'required' and l.receipt_no is null then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'field', 'receiptNo', 'block', 'Enter the tax invoice / receipt / e-Invoice no.');
    end if;
    if cat.myinvois_uuid_mode = 'required' and l.myinvois_uuid is null then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'field', 'myinvoisUuid', 'block', 'Enter the MyInvois UUID.');
    end if;
    if 'merchant_name' = any(cat.extra_fields) and l.merchant is null then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'field', 'merchant', 'block', 'Enter the merchant / vendor.');
    end if;
    if 'client_attendees' = any(cat.extra_fields) and l.client_attendees is null then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'field', 'clientAttendees', 'block', 'Enter the client / attendees.');
    end if;
    if 'travel_destination' = any(cat.extra_fields) and l.travel_destination is null then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'field', 'travelDestination', 'block', 'Enter the travel destination.');
    end if;
    if (cat.is_mileage or 'from_to_purpose' = any(cat.extra_fields)) and (l.from_place is null or l.to_place is null or l.purpose is null) then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'field', case when l.from_place is null then 'fromPlace' when l.to_place is null then 'toPlace' else 'purpose' end,
        'block', 'Enter From, To and Purpose.');
    end if;
    if cat.is_mileage and (l.distance_km is null or l.rate_per_km is null) then
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'mileage', 'distanceKm', 'block', 'Enter the distance (km).');
    end if;
    -- BR-CLM-16 UUID unique (block, names the claim)
    if l.myinvois_uuid is not null then
      select x.claim_no into v_x from app.claim_lines ol join app.claims x on x.id = ol.claim_id
       where ol.is_live and upper(ol.myinvois_uuid) = upper(l.myinvois_uuid) and ol.claim_id <> p_claim_id limit 1;
      if v_x is null then
        select c.claim_no into v_x from app.claim_lines ol where ol.claim_id = p_claim_id and ol.line_no < l.line_no and upper(ol.myinvois_uuid) = upper(l.myinvois_uuid) limit 1;
      end if;
      if v_x is not null then
        v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'uuid', 'myinvoisUuid', 'block', 'UUID already claimed on ' || v_x || '.');
      end if;
    end if;
    -- BR-CLM-17 possible duplicate (warn): same receipt no. + amount, or same merchant + date + amount, on any non-rejected claim
    select coalesce(array_agg(distinct x.claim_no order by x.claim_no), '{}') into v_dup
      from app.claim_lines ol join app.claims x on x.id = ol.claim_id
     where ol.claim_id <> p_claim_id and x.status in ('submitted','approved','disbursed') and ol.amount_incl_sst = l.amount_incl_sst
       and (   (l.receipt_no is not null and upper(btrim(ol.receipt_no)) = upper(btrim(l.receipt_no)))
            or (l.merchant is not null and lower(btrim(ol.merchant)) = lower(btrim(l.merchant)) and ol.transaction_date = l.transaction_date));
    if cardinality(v_dup) > 0 then
      v_dupflag := true;
      v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'duplicate', 'receiptNo', 'warn',
        case when l.receipt_no is not null then 'Same receipt no. and amount on ' else 'Same merchant, date and amount on ' end || array_to_string(v_dup, ', '));
    end if;
    -- BR-CLM-13 / 14 limits (incl. SST; earlier lines of this claim count)
    v_lim := app.claim_limit_for(c.employee_id, l.category_id, l.transaction_date);
    if v_lim.id is not null then
      v_m := app.claim_period(l.transaction_date, 'month', pol.limit_refresh_day);
      v_y := app.claim_period(l.transaction_date, 'year', pol.limit_refresh_day);
      v_um := app.claim_used(c.employee_id, l.category_id, v_m, p_claim_id)
            + coalesce((select sum(o.amount_incl_sst) from app.claim_lines o where o.claim_id = p_claim_id and o.line_no < l.line_no
                          and o.category_id = l.category_id and o.transaction_date <@ v_m), 0);
      v_uy := app.claim_used(c.employee_id, l.category_id, v_y, p_claim_id)
            + coalesce((select sum(o.amount_incl_sst) from app.claim_lines o where o.claim_id = p_claim_id and o.line_no < l.line_no
                          and o.category_id = l.category_id and o.transaction_date <@ v_y), 0);
      v_chk := app.claim_limit_eval(v_lim, l.amount_incl_sst, v_um, v_uy);
      if v_chk ->> 'status' = 'over' then
        v_over := true;
        v_issues := v_issues || app.claim_issue(l.line_no, l.id, 'limit', 'amountInclSst',
          case when (v_chk ->> 'blocking')::boolean then 'block' else 'warn' end, v_chk ->> 'message');
      end if;
    else
      v_chk := app.claim_limit_eval(null, l.amount_incl_sst, 0, 0);
    end if;
    v_lines := v_lines || jsonb_build_object('lineId', l.id, 'lineNo', l.line_no, 'limitCheck', v_chk, 'duplicateOf', to_jsonb(v_dup));
  end loop;
  if v_n = 0 then v_issues := v_issues || app.claim_issue(null, null, 'field', 'lines', 'block', 'Add at least one line.'); end if;
  return jsonb_build_object('issues', v_issues, 'lines', v_lines,
    'flags', jsonb_build_object('overLimit', v_over, 'possibleDuplicate', v_dupflag, 'lateOverride', v_late));
end $$;

-- Store the validation results on the lines (CLN16 / BR-CLM-17) — allowed while New and at submit.
create or replace function app.claim_store_checks(p_claim_id uuid, p_eval jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare x jsonb;
begin
  for x in select * from jsonb_array_elements(p_eval -> 'lines') loop
    update app.claim_lines set limit_check = x -> 'limitCheck',
           duplicate_of = coalesce((select array_agg(v) from jsonb_array_elements_text(x -> 'duplicateOf') v), '{}')
     where id = (x ->> 'lineId')::uuid
       and (limit_check is distinct from x -> 'limitCheck'
            or duplicate_of is distinct from coalesce((select array_agg(v) from jsonb_array_elements_text(x -> 'duplicateOf') v), '{}'::text[]));
  end loop;
end $$;

-- ===========================================================================
-- P14 while typing: limit chip, deadline, duplicate, UUID, mileage (caller re-checked)
-- ===========================================================================
create or replace function app.claim_line_preview(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_emp uuid := coalesce(nullif(p ->> 'employeeId', '')::uuid, app.current_employee_id()); v_claim uuid := nullif(p ->> 'claimId', '')::uuid;
  v_line uuid := nullif(p ->> 'lineId', '')::uuid; v_cat app.claim_categories%rowtype; v_date date := (p ->> 'transactionDate')::date;
  v_amount numeric := nullif(p ->> 'amountInclSst', '')::numeric; v_km numeric := nullif(p ->> 'distanceKm', '')::numeric; v_rate numeric;
  pol app.claim_policy%rowtype; v_lim app.claim_limits; v_m daterange; v_y daterange; v_um numeric; v_uy numeric; v_other jsonb := coalesce(p -> 'otherLines', '[]');
  v_dl jsonb; v_dup text; v_uuid text; v_mile jsonb := null; v_chk jsonb := null; v_late boolean := false; v_lwd date;
begin
  if v_emp is null then raise exception 'PRET-CLM-NO-EMPLOYEE' using errcode = '42501'; end if;
  if not (app.is_self(v_emp) or (app.is_admin() and not app.is_self(v_emp) and app.can_see_team_row(v_emp))) then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  select * into v_cat from app.claim_categories where id = (p ->> 'categoryId')::uuid;
  if v_cat.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  select * into pol from app.claim_policy where id = 1;
  if v_cat.is_mileage then
    v_rate := app.claim_rate_on(v_cat.id, v_date);
    if v_rate is not null and v_km is not null then
      v_amount := round(v_km * v_rate, 2);
      v_mile := jsonb_build_object('ratePerKm', v_rate::numeric(8,3)::text, 'amount', app.money_text(v_amount));
    elsif v_rate is not null then v_mile := jsonb_build_object('ratePerKm', v_rate::numeric(8,3)::text, 'amount', null);
    end if;
  end if;
  if v_line is not null then
    select l.late_override into v_late from app.claim_lines l where l.id = v_line and l.claim_id = v_claim;
  end if;
  select s.last_working_day into v_lwd from app.employee_separations s where s.employee_id = v_emp and not s.is_withdrawn and not s.superseded_by_rehire;
  v_dl := case
    when v_date > app.today_myt() then jsonb_build_object('ok', false, 'message', 'The transaction date cannot be in the future.', 'lateOverride', false)
    when v_lwd is not null and v_date > v_lwd then jsonb_build_object('ok', false, 'message', 'After the last working day (' || app.dmy(v_lwd) || ').', 'lateOverride', false)
    when v_date < app.today_myt() - pol.submission_deadline_days then
      case when coalesce(v_late, false) then jsonb_build_object('ok', true, 'message', null, 'lateOverride', true)
           else jsonb_build_object('ok', false, 'message', 'Older than ' || pol.submission_deadline_days || ' days — Admin override required', 'lateOverride', false) end
    else jsonb_build_object('ok', true, 'message', null, 'lateOverride', false) end;
  if v_amount is not null then
    v_lim := app.claim_limit_for(v_emp, v_cat.id, v_date);
    if v_lim.id is not null then
      v_m := app.claim_period(v_date, 'month', pol.limit_refresh_day); v_y := app.claim_period(v_date, 'year', pol.limit_refresh_day);
      v_um := app.claim_used(v_emp, v_cat.id, v_m, v_claim)
            + coalesce((select sum((o ->> 'amountInclSst')::numeric) from jsonb_array_elements(v_other) o
                         where (o ->> 'categoryId')::uuid = v_cat.id and (o ->> 'transactionDate')::date <@ v_m), 0);
      v_uy := app.claim_used(v_emp, v_cat.id, v_y, v_claim)
            + coalesce((select sum((o ->> 'amountInclSst')::numeric) from jsonb_array_elements(v_other) o
                         where (o ->> 'categoryId')::uuid = v_cat.id and (o ->> 'transactionDate')::date <@ v_y), 0);
      v_chk := app.claim_limit_eval(v_lim, v_amount, v_um, v_uy);
    end if;
    select x.claim_no into v_dup from app.claim_lines ol join app.claims x on x.id = ol.claim_id
     where x.status in ('submitted','approved','disbursed') and ol.claim_id is distinct from v_claim and ol.amount_incl_sst = v_amount
       and (   (nullif(p ->> 'receiptNo', '') is not null and upper(btrim(ol.receipt_no)) = upper(btrim(p ->> 'receiptNo')))
            or (nullif(p ->> 'merchant', '') is not null and lower(btrim(ol.merchant)) = lower(btrim(p ->> 'merchant')) and ol.transaction_date = v_date))
     order by x.claim_no limit 1;
  end if;
  if nullif(p ->> 'myinvoisUuid', '') is not null then
    select x.claim_no into v_uuid from app.claim_lines ol join app.claims x on x.id = ol.claim_id
     where ol.is_live and upper(ol.myinvois_uuid) = upper(p ->> 'myinvoisUuid') and ol.claim_id is distinct from v_claim limit 1;
  end if;
  return jsonb_build_object('limit', v_chk, 'deadline', v_dl,
    'duplicate', case when v_dup is not null then case when nullif(p ->> 'receiptNo', '') is not null then 'Same receipt no. on ' else 'Same merchant, date and amount on ' end || v_dup end,
    'uuidClash', case when v_uuid is not null then 'UUID already claimed on ' || v_uuid end,
    'mileage', v_mile);
end $$;

-- ===========================================================================
-- Save (P13 / C2): header + lines in one call. Creates CL-yyyy-nnnnn at first save; edits only while New.
-- ===========================================================================
create or replace function app.save_claim(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id(); v_me uuid := app.current_employee_id(); c app.claims%rowtype; v_emp uuid; v_on_behalf boolean;
  v_key uuid := nullif(p ->> 'idempotencyKey', '')::uuid; x jsonb; i int := 0; v_line uuid; cat app.claim_categories%rowtype; old_l app.claim_lines%rowtype;
  v_amount numeric; v_sst numeric; v_km numeric; v_rate numeric; v_cc uuid; v_keep uuid[] := '{}'; v_ids uuid[] := '{}'; v_fid uuid; v_fids uuid[];
  v_status app.employment_status; v_lwd date; v_access date; v_eval jsonb; v_claimant app.claim_dependant; v_dep text;
begin
  if v_actor is null then raise exception 'PRET-ACC-401' using errcode = '42501'; end if;
  if nullif(p ->> 'claimId', '') is not null then
    select * into c from app.claims where id = (p ->> 'claimId')::uuid for update;
    if c.id is null or not (app.is_self(c.employee_id) or (app.is_admin() and c.on_behalf_by is not null and not app.is_self(c.employee_id))) then
      raise exception 'PRET-ACC-404' using errcode = '42501';
    end if;
    if c.status <> 'new' then raise exception 'PRET-CLM-LOCKED: only New claims can be edited' using errcode = '23514'; end if;
    if nullif(p ->> 'expectedVersion', '') is not null and c.version <> (p ->> 'expectedVersion')::int then
      raise exception 'PRET-STALE' using errcode = '40001';
    end if;
    update app.claims set title = p ->> 'title', project_ref = nullif(p ->> 'projectRef', ''),
           on_behalf_note = case when on_behalf_by is not null then coalesce(nullif(p ->> 'onBehalfNote', ''), on_behalf_note) else null end
     where id = c.id;
  else
    if v_key is not null then
      select * into c from app.claims where idempotency_key = v_key;
      if c.id is not null then
        if not (app.is_self(c.employee_id) or app.is_admin()) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
        return jsonb_build_object('id', c.id, 'claimNo', c.claim_no, 'version', c.version, 'duplicate', true,
          'lineIds', coalesce((select jsonb_agg(l.id order by l.line_no) from app.claim_lines l where l.claim_id = c.id), '[]'),
          'totals', jsonb_build_object('total', app.money_text(c.total_amount), 'sst', app.money_text(c.total_sst), 'exclSst', app.money_text(c.total_excl_sst)));
      end if;
    end if;
    v_emp := coalesce(nullif(p ->> 'employeeId', '')::uuid, v_me);
    if v_emp is null then raise exception 'PRET-CLM-NO-EMPLOYEE: your employee record has not been created yet' using errcode = '42501'; end if;
    v_on_behalf := v_emp is distinct from v_me;
    if v_on_behalf and not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
    select e.status into v_status from app.employees e where e.id = v_emp;
    if v_status is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
    if v_status in ('pending_join','withdrawn') then raise exception 'PRET-CLM-EMPLOYEE-STATUS: claims are not available for this employee' using errcode = '23514'; end if;
    if v_status = 'separated' then
      select s.last_working_day into v_lwd from app.employee_separations s where s.employee_id = v_emp and not s.is_withdrawn and not s.superseded_by_rehire;
      select max(u.access_end_date) into v_access from app.app_users u where u.employee_id = v_emp;
      if coalesce(v_access, v_lwd + 30) < app.today_myt() then
        raise exception 'PRET-CLM-EMPLOYEE-STATUS: the portal access of this separated employee has ended' using errcode = '23514';
      end if;
    end if;
    insert into app.claims (claim_no, employee_id, title, project_ref, on_behalf_by, on_behalf_note, idempotency_key)
    values (private.next_doc_no('CL', extract(year from app.today_myt())::int), v_emp, p ->> 'title', nullif(p ->> 'projectRef', ''),
            case when v_on_behalf then v_actor end, case when v_on_behalf then nullif(p ->> 'onBehalfNote', '') end, v_key)
    returning * into c;
    perform app.claim_event(c.id, case when v_on_behalf then 'Created on behalf' else 'Created' end, null, 'new');
  end if;
  -- lines
  for x in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    v_line := nullif(x ->> 'id', '')::uuid;
    if v_line is not null and exists (select 1 from app.claim_lines l where l.id = v_line and l.claim_id = c.id) then v_keep := v_keep || v_line; end if;
  end loop;
  delete from app.claim_lines where claim_id = c.id and not (id = any(v_keep));
  for x in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    i := i + 1;
    if i > 50 then raise exception 'PRET-CLM-LINES: at most 50 lines' using errcode = '23514'; end if;
    v_line := nullif(x ->> 'id', '')::uuid;
    old_l := null;
    if v_line is not null then select * into old_l from app.claim_lines where id = v_line and claim_id = c.id; end if;
    select * into cat from app.claim_categories where id = (x ->> 'categoryId')::uuid;
    if cat.id is null then raise exception 'PRET-CLM-FIELD lines.%.categoryId: select the category', i - 1 using errcode = '23514'; end if;
    if not cat.is_active and old_l.category_id is distinct from cat.id then
      raise exception 'PRET-CLM-FIELD lines.%.categoryId: this category is no longer available', i - 1 using errcode = '23514';
    end if;
    v_claimant := coalesce(nullif(x ->> 'claimant', ''), 'self')::app.claim_dependant;
    if v_claimant <> 'self' and cat.claimant_scope <> 'employee_and_dependants' then
      raise exception 'PRET-CLM-FIELD lines.%.claimant: this category is for the employee only', i - 1 using errcode = '23514';
    end if;
    if cat.is_mileage then
      v_km := nullif(x ->> 'distanceKm', '')::numeric;
      if v_km is null or v_km < 0.1 or v_km > 2000 then raise exception 'PRET-CLM-FIELD lines.%.distanceKm: distance must be between 0.1 and 2,000 km', i - 1 using errcode = '23514'; end if;
      v_rate := app.claim_rate_on(cat.id, (x ->> 'transactionDate')::date);
      if v_rate is null then raise exception 'PRET-CLM-FIELD lines.%.transactionDate: no mileage rate is set for this date — contact HR', i - 1 using errcode = '23514'; end if;
      v_amount := round(v_km * v_rate, 2); v_sst := 0;
    else
      v_km := null; v_rate := null;
      v_amount := nullif(x ->> 'amountInclSst', '')::numeric;
      v_sst := case when cat.capture_sst then coalesce(nullif(x ->> 'sstAmount', '')::numeric, 0) else 0 end;
      if v_amount is null or v_amount <= 0 or v_amount > 99999.99 then
        raise exception 'PRET-CLM-FIELD lines.%.amountInclSst: amount must be more than RM 0.00 and at most RM 99,999.99', i - 1 using errcode = '23514';
      end if;
      if v_sst < 0 or v_sst > v_amount then raise exception 'PRET-CLM-FIELD lines.%.sstAmount: SST cannot be more than the amount', i - 1 using errcode = '23514'; end if;
    end if;
    v_cc := nullif(x ->> 'costCentreId', '')::uuid;
    if v_cc is not null and not exists (select 1 from app.cost_centres cc where cc.id = v_cc and cc.is_active) then
      raise exception 'PRET-CLM-FIELD lines.%.costCentreId: the cost centre must be active', i - 1 using errcode = '23514';
    end if;
    if v_cc is null then
      select coalesce(h.cost_centre_id, d.cost_centre_id) into v_cc from app.employees e join app.departments d on d.id = e.department_id
        left join app.employee_hr_private h on h.employee_id = e.id where e.id = c.employee_id;
    end if;
    if old_l.id is not null then
      update app.claim_lines set line_no = i, category_id = cat.id, transaction_date = (x ->> 'transactionDate')::date,
             description = nullif(x ->> 'description', ''), merchant = nullif(x ->> 'merchant', ''),
             receipt_no = case when cat.receipt_no_mode = 'hidden' then null else nullif(x ->> 'receiptNo', '') end,
             myinvois_uuid = case when cat.myinvois_uuid_mode = 'hidden' then null else nullif(x ->> 'myinvoisUuid', '') end,
             amount_incl_sst = v_amount, sst_amount = v_sst,
             from_place = nullif(x ->> 'fromPlace', ''), to_place = nullif(x ->> 'toPlace', ''), purpose = nullif(x ->> 'purpose', ''),
             distance_km = v_km, rate_per_km = v_rate, client_attendees = nullif(x ->> 'clientAttendees', ''),
             travel_destination = nullif(x ->> 'travelDestination', ''), claimant = v_claimant, cost_centre_id = v_cc,
             late_override = case when old_l.transaction_date = (x ->> 'transactionDate')::date then old_l.late_override else false end
       where id = old_l.id;
      v_line := old_l.id;
      if old_l.transaction_date <> (x ->> 'transactionDate')::date then delete from app.claim_late_overrides o where o.claim_line_id = old_l.id and o.used_at is null; end if;
    else
      insert into app.claim_lines (claim_id, employee_id, line_no, category_id, transaction_date, description, merchant, receipt_no, myinvois_uuid,
                                   amount_incl_sst, sst_amount, from_place, to_place, purpose, distance_km, rate_per_km, client_attendees,
                                   travel_destination, claimant, cost_centre_id)
      values (c.id, c.employee_id, i, cat.id, (x ->> 'transactionDate')::date, nullif(x ->> 'description', ''), nullif(x ->> 'merchant', ''),
              case when cat.receipt_no_mode = 'hidden' then null else nullif(x ->> 'receiptNo', '') end,
              case when cat.myinvois_uuid_mode = 'hidden' then null else nullif(x ->> 'myinvoisUuid', '') end,
              v_amount, v_sst, nullif(x ->> 'fromPlace', ''), nullif(x ->> 'toPlace', ''), nullif(x ->> 'purpose', ''), v_km, v_rate,
              nullif(x ->> 'clientAttendees', ''), nullif(x ->> 'travelDestination', ''), v_claimant, v_cc)
      returning id into v_line;
    end if;
    v_ids := v_ids || v_line;
    -- CLN14 dependant (T2)
    v_dep := nullif(btrim(x ->> 'dependantName'), '');
    if v_claimant <> 'self' then
      if v_dep is null then raise exception 'PRET-CLM-FIELD lines.%.dependantName: select the dependant', i - 1 using errcode = '23514'; end if;
      insert into app.claim_line_dependants (claim_line_id, employee_id, dependant_name) values (v_line, c.employee_id, v_dep)
      on conflict (claim_line_id) do update set dependant_name = excluded.dependant_name;
    else
      delete from app.claim_line_dependants where claim_line_id = v_line;
    end if;
    -- CLN15 receipts: own uploads (or files already on this claim / the claim it was copied from)
    v_fids := coalesce((select array_agg(distinct (f)::uuid) from jsonb_array_elements_text(coalesce(x -> 'fileIds', '[]')) f), '{}');
    if cardinality(v_fids) > 5 then raise exception 'PRET-CLM-FIELD lines.%.fileIds: at most 5 receipts per line', i - 1 using errcode = '23514'; end if;
    delete from app.claim_line_files where claim_line_id = v_line and not (file_id = any(v_fids));
    foreach v_fid in array v_fids loop
      if not exists (select 1 from app.claim_line_files lf where lf.claim_line_id = v_line and lf.file_id = v_fid) then
        if not exists (select 1 from app.files f where f.id = v_fid and f.status = 'active' and f.subject = 'claim_receipt'
                         and f.owner_employee_id = c.employee_id
                         and (f.created_by = v_actor
                              or exists (select 1 from app.claim_line_files lf join app.claim_lines ol on ol.id = lf.claim_line_id
                                          where lf.file_id = f.id and (ol.claim_id = c.id or ol.claim_id = c.copied_from_claim_id)))) then
          raise exception 'PRET-CLM-FIELD lines.%.fileIds: upload the receipt again', i - 1 using errcode = '23514';
        end if;
        insert into app.claim_line_files (claim_line_id, file_id) values (v_line, v_fid);
      end if;
    end loop;
  end loop;
  if i = 0 then raise exception 'PRET-CLM-FIELD lines: add at least one line' using errcode = '23514'; end if;
  v_eval := app.claim_evaluate(c.id);
  perform app.claim_store_checks(c.id, v_eval);
  select * into c from app.claims where id = c.id;
  return jsonb_build_object('id', c.id, 'claimNo', c.claim_no, 'version', c.version, 'duplicate', false, 'lineIds', to_jsonb(v_ids),
    'totals', jsonb_build_object('total', app.money_text(c.total_amount), 'sst', app.money_text(c.total_sst), 'exclSst', app.money_text(c.total_excl_sst)));
end $$;

-- ===========================================================================
-- Submit (FR-CLM-04, BR-CLM-10–22) → Submitted + one approval task (D12). EC-CLM-02: per-employee lock + re-validation.
-- ===========================================================================
create or replace function app.open_claim_task(p_claim_id uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare c app.claims%rowtype; r record; v_task uuid;
begin
  select * into c from app.claims where id = p_claim_id;
  select * into r from app.resolve_claim_approver(c.employee_id, app.today_myt());
  insert into app.approval_tasks (subject_type, claim_id, subject_employee_id, subject_prepared_by, level, source, assignee_user_id, original_assignee_user_id, routing_note)
  values ('claim', c.id, c.employee_id, c.on_behalf_by, 1, 'claim_pool', r.assignee, r.original, r.note)
  returning id into v_task;
  perform app.notify_task(v_task);
  return v_task;
end $$;

create or replace function app.submit_claim(p_claim_id uuid, p_ack boolean default false, p_expected_version int default null) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c app.claims%rowtype; v_eval jsonb; v_blocks int; v_warns int; v_task uuid; v_hint text; l record; v_rate numeric;
begin
  select * into c from app.claims where id = p_claim_id for update;
  if c.id is null or not (app.is_self(c.employee_id) or (app.is_admin() and c.on_behalf_by is not null and not app.is_self(c.employee_id))) then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  if c.status <> 'new' then raise exception 'PRET-CLM-STATE: this claim has already been submitted' using errcode = '23514'; end if;
  if p_expected_version is not null and c.version <> p_expected_version then raise exception 'PRET-STALE' using errcode = '40001'; end if;
  perform pg_advisory_xact_lock(hashtext('claims:' || c.employee_id::text));
  -- BR-CLM-15 rate snapshot at submission (rate effective on the transaction date)
  for l in select * from app.claim_lines where claim_id = c.id and distance_km is not null loop
    v_rate := app.claim_rate_on(l.category_id, l.transaction_date);
    if v_rate is not null and v_rate is distinct from l.rate_per_km then
      update app.claim_lines set rate_per_km = v_rate, amount_incl_sst = round(l.distance_km * v_rate, 2) where id = l.id;
    end if;
  end loop;
  v_eval := app.claim_evaluate(c.id);
  perform app.claim_store_checks(c.id, v_eval);
  select count(*) filter (where i ->> 'severity' = 'block'), count(*) filter (where i ->> 'severity' = 'warn')
    into v_blocks, v_warns from jsonb_array_elements(v_eval -> 'issues') i;
  if v_blocks > 0 or (v_warns > 0 and not p_ack) then
    return jsonb_build_object('submitted', false, 'claimNo', c.claim_no, 'status', 'new', 'issues', v_eval -> 'issues',
      'needsAcknowledgement', v_blocks = 0 and v_warns > 0,
      'message', case when v_blocks > 0 then 'Fix the highlighted lines before submitting.' else 'Confirm the warnings to submit.' end);
  end if;
  update app.claims set status = 'submitted', submitted_at = now(), submitted_by = app.current_app_user_id(),
         flag_over_limit = coalesce((v_eval -> 'flags' ->> 'overLimit')::boolean, false),
         flag_possible_duplicate = coalesce((v_eval -> 'flags' ->> 'possibleDuplicate')::boolean, false),
         flag_late_override = coalesce((v_eval -> 'flags' ->> 'lateOverride')::boolean, false),
         warnings_acknowledged = v_warns > 0
   where id = c.id;
  update app.claim_late_overrides set used_at = now() where claim_id = c.id and used_at is null;
  perform app.claim_event(c.id, case when c.on_behalf_by is not null and not app.is_self(c.employee_id) then 'Submitted on behalf' else 'Submitted' end, 'new', 'submitted');
  v_task := app.open_claim_task(c.id);
  select case when t.assignee_user_id is null then 'Submitted — waiting for approval by an Admin.'
              else 'Submitted — waiting for approval by ' || app.user_name(t.assignee_user_id) || ' or an Admin.' end into v_hint
    from app.approval_tasks t where t.id = v_task;
  return jsonb_build_object('submitted', true, 'claimNo', c.claim_no, 'status', 'submitted', 'issues', v_eval -> 'issues',
    'needsAcknowledgement', false, 'message', v_hint);
end $$;

-- FR-CLM-14 withdraw (Submitted → Withdrawn) — owner, or the Admin who entered it on behalf
create or replace function app.withdraw_claim(p_claim_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c app.claims%rowtype; t record;
begin
  select * into c from app.claims where id = p_claim_id for update;
  if c.id is null or not (app.is_self(c.employee_id) or (app.is_admin() and c.on_behalf_by is not null and not app.is_self(c.employee_id))) then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  if c.status <> 'submitted' then raise exception 'PRET-CLM-STATE: only Submitted claims can be withdrawn' using errcode = '23514'; end if;
  for t in select tk.assignee_user_id from app.approval_tasks tk where tk.claim_id = c.id and tk.status = 'open' and tk.assignee_user_id is not null loop
    perform app.notify(t.assignee_user_id, 'N-20', left('Claim withdrawn: ' || c.claim_no, 150), app.employee_display(c.employee_id), '/approvals?tab=claims', false, null, null);
  end loop;
  perform app.close_open_tasks('claim', c.id, 'Withdrawn');
  update app.claims set status = 'withdrawn' where id = c.id;
  perform app.claim_event(c.id, 'Withdrawn', 'submitted', 'withdrawn');
end $$;

-- FR-G-08 delete a New claim (owner; or the Admin who entered it on behalf)
create or replace function app.delete_claim(p_claim_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c app.claims%rowtype;
begin
  select * into c from app.claims where id = p_claim_id for update;
  if c.id is null or not ((app.is_self(c.employee_id)) or (app.is_admin() and c.on_behalf_by is not null and not app.is_self(c.employee_id))) then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  if c.status <> 'new' then raise exception 'PRET-CLM-LOCKED: only New claims can be deleted' using errcode = '23514'; end if;
  delete from app.claims where id = c.id;
end $$;

-- F-CLM-29 copy a Rejected claim (header, lines, attachments) into a new New claim
create or replace function app.copy_claim(p_claim_id uuid, p_key uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare c app.claims%rowtype; n app.claims%rowtype; l record; v_new uuid;
begin
  if p_key is not null then
    select * into n from app.claims where idempotency_key = p_key;
    if n.id is not null then
      if not app.is_self(n.employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
      return jsonb_build_object('id', n.id, 'claimNo', n.claim_no);
    end if;
  end if;
  select * into c from app.claims where id = p_claim_id;
  if c.id is null or not app.is_self(c.employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if c.status <> 'rejected' then raise exception 'PRET-CLM-STATE: only Rejected claims can be copied' using errcode = '23514'; end if;
  insert into app.claims (claim_no, employee_id, title, project_ref, copied_from_claim_id, idempotency_key)
  values (private.next_doc_no('CL', extract(year from app.today_myt())::int), c.employee_id, c.title, c.project_ref, c.id, p_key)
  returning * into n;
  for l in select * from app.claim_lines where claim_id = c.id order by line_no loop
    insert into app.claim_lines (claim_id, employee_id, line_no, category_id, transaction_date, description, merchant, receipt_no, myinvois_uuid,
                                 amount_incl_sst, sst_amount, from_place, to_place, purpose, distance_km, rate_per_km, client_attendees, travel_destination,
                                 claimant, cost_centre_id)
    values (n.id, n.employee_id, l.line_no, l.category_id, l.transaction_date, l.description, l.merchant, l.receipt_no, l.myinvois_uuid,
            l.amount_incl_sst, l.sst_amount, l.from_place, l.to_place, l.purpose, l.distance_km, l.rate_per_km, l.client_attendees, l.travel_destination,
            l.claimant, l.cost_centre_id)
    returning id into v_new;
    insert into app.claim_line_files (claim_line_id, file_id) select v_new, f.file_id from app.claim_line_files f where f.claim_line_id = l.id;
    insert into app.claim_line_dependants (claim_line_id, employee_id, dependant_name, spouse_id, child_id)
      select v_new, d.employee_id, d.dependant_name, d.spouse_id, d.child_id from app.claim_line_dependants d where d.claim_line_id = l.id;
  end loop;
  perform app.claim_event(n.id, 'Copied from ' || c.claim_no, null, 'new');
  perform app.claim_store_checks(n.id, app.claim_evaluate(n.id));
  return jsonb_build_object('id', n.id, 'claimNo', n.claim_no);
end $$;

-- F-CLM-21 late-submission override (ADM/SA; not own; lines of New claims older than the deadline)
create or replace function app.apply_late_override(p_employee_id uuid, p_line_ids uuid[], p_reason text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id(); l record; n int := 0; pol app.claim_policy%rowtype; v_nos text[] := '{}';
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if app.is_self(p_employee_id) then raise exception 'PRET-SELF-001: you cannot override your own claim' using errcode = '42501'; end if;
  if char_length(coalesce(btrim(p_reason), '')) < 10 then raise exception 'PRET-CLM-REASON: give the reason (at least 10 characters)' using errcode = '23514'; end if;
  select * into pol from app.claim_policy where id = 1;
  for l in select cl.*, c.claim_no from app.claim_lines cl join app.claims c on c.id = cl.claim_id
            where cl.id = any(p_line_ids) and cl.employee_id = p_employee_id and c.status = 'new' for update of cl loop
    if l.transaction_date >= app.today_myt() - pol.submission_deadline_days then continue; end if;
    insert into app.claim_late_overrides (claim_id, claim_line_id, employee_id, reason, granted_by, granted_by_employee_id)
    values (l.claim_id, l.id, l.employee_id, btrim(p_reason), v_actor, app.current_employee_id());
    update app.claim_lines set late_override = true where id = l.id;
    if not l.claim_no = any(v_nos) then v_nos := v_nos || l.claim_no; end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'PRET-CLM-OVERRIDE-NONE: none of the selected lines is past the deadline on a New claim' using errcode = '23514'; end if;
  perform app.notify_employee(p_employee_id, 'N-60', left('You can now submit ' || array_to_string(v_nos, ', '), 150),
    'A late-submission override was applied.', '/my/claims', false, null, null);
  return n;
end $$;

-- ===========================================================================
-- Guards (rls §7 layer 5; data-model §15)
-- ===========================================================================
create or replace function app.tg_claims_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor_emp uuid := app.current_employee_id(); v_actor uuid := app.current_app_user_id();
begin
  if tg_op = 'DELETE' then
    if old.status <> 'new' then raise exception 'PRET-CLM-LOCKED: only New claims can be deleted' using errcode = '23514'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'new' then raise exception 'PRET-CLM-TRANSITION: claims start New' using errcode = '23514'; end if;
    return new;
  end if;
  if (new.employee_id, new.claim_no, new.created_at, new.copied_from_claim_id, new.on_behalf_by)
     is distinct from (old.employee_id, old.claim_no, old.created_at, old.copied_from_claim_id, old.on_behalf_by) then
    raise exception 'PRET-CLM-IMMUTABLE' using errcode = '23514';
  end if;
  if new.status is not distinct from old.status then
    if old.status <> 'new' then
      if (new.title, new.project_ref, new.total_amount, new.total_sst, new.on_behalf_note, new.submitted_at, new.decided_by, new.reject_reason)
         is distinct from (old.title, old.project_ref, old.total_amount, old.total_sst, old.on_behalf_note, old.submitted_at, old.decided_by, old.reject_reason) then
        raise exception 'PRET-CLM-LOCKED: only New claims can be edited' using errcode = '23514';
      end if;
      if (new.disbursement_batch_id, new.disbursed_via, new.disbursed_on, new.payment_reference)
         is distinct from (old.disbursement_batch_id, old.disbursed_via, old.disbursed_on, old.payment_reference)
         and v_actor is not null and not app.is_admin() then
        raise exception 'PRET-ACC-403' using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if (old.status, new.status) not in (('new','submitted'),('submitted','approved'),('submitted','rejected'),('submitted','withdrawn'),
        ('approved','cancelled'),('approved','disbursed'),('disbursed','approved')) then
    raise exception 'PRET-CLM-TRANSITION %→%', old.status, new.status using errcode = '23514';
  end if;
  if new.status in ('approved','rejected','cancelled','disbursed') or old.status = 'disbursed' then
    if v_actor_emp is not null and v_actor_emp = new.employee_id then
      raise exception 'PRET-SELF-001: you cannot decide, cancel or disburse your own claim' using errcode = '42501';
    end if;
  end if;
  if new.status in ('submitted','withdrawn') and v_actor is not null
     and not (app.is_self(new.employee_id) or (app.is_admin() and new.on_behalf_by is not null)) then
    raise exception 'PRET-CLM-OWNER-ONLY' using errcode = '42501';
  end if;
  if (new.status = 'disbursed' or old.status = 'disbursed') and v_actor is not null and not app.is_admin() then
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  if old.status = 'submitted' and new.status in ('approved','rejected') then
    -- layer: a decision exists only through the approval engine (task decided by this actor in this transaction)
    if not exists (select 1 from app.approval_tasks t where t.claim_id = new.id and t.status::text = new.status::text
                     and t.decided_by is not distinct from v_actor and t.decided_at = now()) then
      raise exception 'PRET-CLM-DECIDE-VIA-TASK' using errcode = '42501';
    end if;
    new.decided_by := v_actor; new.decided_by_employee_id := v_actor_emp; new.decided_by_name := app.user_name(v_actor); new.decided_at := now();
  elsif new.status = 'cancelled' then
    new.cancelled_by := v_actor; new.cancelled_by_employee_id := v_actor_emp; new.cancelled_at := now();
    new.disbursement_batch_id := null; new.disbursed_via := null;
  elsif old.status = 'disbursed' and new.status = 'approved' then
    new.disbursed_on := null; new.payment_reference := null; new.disbursed_via := null; new.disbursement_batch_id := null;
  end if;
  return new;
end $$;

create or replace function app.tg_claims_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    update app.claim_lines set is_live = new.status in ('submitted','approved','disbursed')
     where claim_id = new.id and is_live is distinct from (new.status in ('submitted','approved','disbursed'));
  end if;
  return null;
end $$;

-- lines: editable only while the claim is New (system columns excepted); employee_id from the claim; ≤ 50 by line_no CHECK.
create or replace function app.tg_claim_lines_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status app.claim_status; v_emp uuid;
begin
  select c.status, c.employee_id into v_status, v_emp from app.claims c where c.id = coalesce(new.claim_id, old.claim_id);
  if tg_op = 'DELETE' then
    if v_status is not null and v_status <> 'new' then raise exception 'PRET-CLM-LOCKED: only New claims can be edited' using errcode = '23514'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if v_status <> 'new' then raise exception 'PRET-CLM-LOCKED: only New claims can be edited' using errcode = '23514'; end if;
    new.employee_id := v_emp;
    return new;
  end if;
  if new.claim_id <> old.claim_id or new.employee_id <> old.employee_id then raise exception 'PRET-CLM-IMMUTABLE' using errcode = '23514'; end if;
  if v_status <> 'new' and
     (to_jsonb(new) - array['amount_excl_sst','is_live','limit_check','duplicate_of','tax_treatment_snapshot','ea_form_line_snapshot','gl_account_snapshot','updated_at','updated_by'])
     is distinct from (to_jsonb(old) - array['amount_excl_sst','is_live','limit_check','duplicate_of','tax_treatment_snapshot','ea_form_line_snapshot','gl_account_snapshot','updated_at','updated_by']) then
    raise exception 'PRET-CLM-LOCKED: only New claims can be edited' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function app.tg_claim_lines_totals() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_claim uuid := coalesce(new.claim_id, old.claim_id);
begin
  update app.claims c set total_amount = x.t, total_sst = x.s
    from (select coalesce(sum(l.amount_incl_sst), 0) as t, coalesce(sum(l.sst_amount), 0) as s from app.claim_lines l where l.claim_id = v_claim) x
   where c.id = v_claim and (c.total_amount, c.total_sst) is distinct from (x.t, x.s);
  return null;
end $$;

create or replace function app.tg_claim_line_files_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status app.claim_status;
begin
  select c.status into v_status from app.claim_lines l join app.claims c on c.id = l.claim_id where l.id = coalesce(new.claim_line_id, old.claim_line_id);
  if v_status is not null and v_status <> 'new' then raise exception 'PRET-CLM-LOCKED: receipts can be changed only while the claim is New' using errcode = '23514'; end if;
  if tg_op = 'INSERT' and (select count(*) from app.claim_line_files f where f.claim_line_id = new.claim_line_id) >= 5 then
    raise exception 'PRET-CLM-FILES: at most 5 receipts per line' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;

create or replace function app.tg_claim_dependants_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status app.claim_status; v_emp uuid;
begin
  select c.status, c.employee_id into v_status, v_emp from app.claim_lines l join app.claims c on c.id = l.claim_id where l.id = coalesce(new.claim_line_id, old.claim_line_id);
  if v_status is not null and v_status <> 'new' then raise exception 'PRET-CLM-LOCKED' using errcode = '23514'; end if;
  if tg_op <> 'DELETE' then new.employee_id := v_emp; end if;
  return coalesce(new, old);
end $$;

create or replace function app.tg_late_override_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.granted_by := coalesce(app.current_app_user_id(), new.granted_by);
    new.granted_by_employee_id := app.current_employee_id();
    select l.employee_id, l.claim_id into new.employee_id, new.claim_id from app.claim_lines l where l.id = new.claim_line_id;
    return new;
  end if;
  if (new.reason, new.granted_by, new.claim_line_id) is distinct from (old.reason, old.granted_by, old.claim_line_id) then
    raise exception 'PRET-CLM-IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end $$;

-- config guards: mileage needs a rate (US-CLAIM-001); category code locked once used; limits never overlap for the same target
create or replace function app.tg_claim_categories_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.code <> old.code and exists (select 1 from app.claim_lines l where l.category_id = old.id) then
    raise exception 'PRET-CLM-CODE-LOCKED: the code cannot change once the category has been used' using errcode = '23514';
  end if;
  if new.is_mileage then
    new.capture_sst := false;
    if not ('from_to_purpose' = any(new.extra_fields)) then new.extra_fields := new.extra_fields || 'from_to_purpose'::app.claim_extra_field; end if;
  end if;
  return new;
end $$;
create or replace function app.tg_claim_categories_after() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_mileage and new.is_active and not exists (select 1 from app.claim_category_rates r where r.category_id = new.id) then
    raise exception 'PRET-CLM-RATE: enter the mileage rate (RM/km)' using errcode = '23514';
  end if;
  return null;
end $$;
create or replace function app.tg_claim_limits_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from app.claim_limits x
              where x.id <> new.id and x.category_id = new.category_id and x.applies_to = new.applies_to
                and x.grade_id is not distinct from new.grade_id and x.department_id is not distinct from new.department_id
                and x.employee_group_id is not distinct from new.employee_group_id and x.employee_id is not distinct from new.employee_id
                and daterange(x.effective_from, x.effective_to, '[]') && daterange(new.effective_from, new.effective_to, '[]')) then
    raise exception 'PRET-CLM-LIMIT-OVERLAP: a limit for this category and target already covers these dates — end it first' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger tg_stamp before insert or update on app.claim_policy for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.claim_categories for each row execute function app.tg_stamp();
create trigger tg_stamp before insert on app.claim_category_rates for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.claim_limits for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.claims for each row execute function app.tg_stamp();
create trigger tg_stamp before insert or update on app.claim_lines for each row execute function app.tg_stamp();
create trigger tg_10_guard before insert or update on app.claim_categories for each row execute function app.tg_claim_categories_guard();
create constraint trigger tg_rate_required after insert or update on app.claim_categories deferrable initially deferred
  for each row execute function app.tg_claim_categories_after();
create trigger tg_10_guard before insert or update on app.claim_limits for each row execute function app.tg_claim_limits_guard();
create trigger tg_20_transition before insert or update or delete on app.claims for each row execute function app.tg_claims_transition();
create trigger tg_after after update on app.claims for each row execute function app.tg_claims_after();
create trigger tg_10_guard before insert or update or delete on app.claim_lines for each row execute function app.tg_claim_lines_guard();
create trigger tg_totals after insert or delete or update of amount_incl_sst, sst_amount on app.claim_lines for each row execute function app.tg_claim_lines_totals();
create trigger tg_10_guard before insert or delete on app.claim_line_files for each row execute function app.tg_claim_line_files_guard();
create trigger tg_10_guard before insert or update or delete on app.claim_line_dependants for each row execute function app.tg_claim_dependants_guard();
create trigger tg_10_guard before insert or update on app.claim_late_overrides for each row execute function app.tg_late_override_guard();

-- ===========================================================================
-- Generic approval engine — claims + SA batch approval plug-in (replaces the W2-004 versions; leave paths unchanged)
-- ===========================================================================
create or replace function app.task_subject_facts(p_type app.task_subject, p_id uuid,
  out employee_id uuid, out workflow_id uuid, out total_levels int, out reference text, out label text, out is_emergency boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_type in ('leave_application','leave_cancellation') then
    select a.employee_id, a.workflow_id, a.total_levels, a.ref_no, t.name, a.is_emergency
      into employee_id, workflow_id, total_levels, reference, label, is_emergency
      from app.leave_applications a join app.leave_types t on t.id = a.leave_type_id where a.id = p_id;
    if p_type = 'leave_cancellation' then total_levels := 1; end if;
  elsif p_type = 'replacement_credit' then
    select c.employee_id, c.workflow_id, c.total_levels, c.credit_no, 'Replacement credit', false
      into employee_id, workflow_id, total_levels, reference, label, is_emergency
      from app.replacement_credits c where c.id = p_id;
  elsif p_type = 'claim' then
    select c.employee_id, null::uuid, 1, c.claim_no, c.title, false
      into employee_id, workflow_id, total_levels, reference, label, is_emergency
      from app.claims c where c.id = p_id;
  elsif p_type = 'disbursement_batch' then
    select null::uuid, null::uuid, 1, b.batch_no, 'Disbursement batch', false
      into employee_id, workflow_id, total_levels, reference, label, is_emergency
      from app.disbursement_batches b where b.id = p_id;
  else
    raise exception 'PRET-TASK-SUBJECT: % is not handled by this engine yet', p_type using errcode = '22023';
  end if;
end $$;

create or replace function app.notify_task(p_task_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  t app.approval_tasks%rowtype; f record; v_code text; v_title text; v_link text; v_tpl text; v_del uuid; v_subject_user uuid; v_payload jsonb;
  c app.claims%rowtype; b app.disbursement_batches%rowtype; r record;
begin
  select * into t from app.approval_tasks where id = p_task_id;
  if t.id is null or t.status <> 'open' then return; end if;
  select * into f from app.task_subject_facts(t.subject_type, app.task_subject_id(t));
  if t.subject_type = 'claim' then
    select * into c from app.claims where id = t.claim_id;
    v_subject_user := app.active_user_of(c.employee_id);
    v_title := left('Claim to approve: ' || c.claim_no || ' · ' || coalesce(app.employee_display(c.employee_id), '') || ' · ' || app.rm(c.total_amount), 150);
    v_link := '/approvals/claims/' || c.claim_no;
    v_payload := jsonb_build_object('reference', c.claim_no, 'employee', app.employee_display(c.employee_id), 'title', c.title, 'total', app.rm(c.total_amount));
    -- N-20: the claimant's approver (+ delegate) by email; every ADM / SA in-app (any of them may approve — D12)
    if t.assignee_user_id is not null then
      perform app.notify(t.assignee_user_id, 'N-20', v_title, c.title, v_link, true, 'claim_submitted', v_payload);
      v_del := app.active_delegate(t.assignee_user_id, app.today_myt(), 'claims');
      if v_del is not null and v_del is distinct from v_subject_user then
        perform app.notify(v_del, 'N-20', v_title, left(c.title || ' — as delegate of ' || app.user_name(t.assignee_user_id), 500), v_link, true, 'claim_submitted', v_payload);
      end if;
    end if;
    for r in select distinct u.id from app.user_roles ur join app.app_users u on u.id = ur.user_id
              where ur.role in ('ADM','SA') and ur.revoked_at is null and u.status = 'active' and u.id <> '00000000-0000-0000-0000-000000000001'
                and u.id is distinct from v_subject_user and u.id is distinct from t.assignee_user_id and u.id is distinct from v_del
                and u.id is distinct from t.subject_prepared_by loop
      perform app.notify(r.id, 'N-20', v_title, c.title, v_link, t.assignee_user_id is null, case when t.assignee_user_id is null then 'claim_submitted' end, v_payload);
    end loop;
    return;
  elsif t.subject_type = 'disbursement_batch' then
    select * into b from app.disbursement_batches where id = t.disbursement_batch_id;
    for r in select distinct u.id from app.user_roles ur join app.app_users u on u.id = ur.user_id
              where ur.role = 'SA' and ur.revoked_at is null and u.status = 'active' and u.id <> '00000000-0000-0000-0000-000000000001'
                and u.id is distinct from b.prepared_by loop
      perform app.notify(r.id, 'N-26', left('Disbursement batch to approve: ' || b.batch_no || ' · ' || app.rm(b.total_amount), 150),
        b.claim_count || ' claims · ' || to_char(b.disbursement_month, 'FMMonth YYYY'), '/claims/batches/' || b.batch_no, true, 'batch_pending_approval',
        jsonb_build_object('reference', b.batch_no, 'total', app.rm(b.total_amount), 'count', b.claim_count));
    end loop;
    return;
  end if;
  v_subject_user := app.active_user_of(t.subject_employee_id);
  v_code := case t.subject_type when 'leave_cancellation' then 'N-05' when 'replacement_credit' then 'N-11' else 'N-01' end;
  v_tpl := case t.subject_type when 'leave_cancellation' then 'leave_cancellation_requested' when 'replacement_credit' then 'credit_submitted' else 'leave_submitted' end;
  v_title := left(case when f.is_emergency and t.subject_type = 'leave_application' then '[EMERGENCY] ' else '' end ||
             case t.subject_type when 'leave_cancellation' then 'Cancellation requested: ' when 'replacement_credit' then 'Replacement credit to approve: '
                                 else 'Leave to approve: ' end || f.reference || ' · ' || coalesce(app.employee_display(t.subject_employee_id), ''), 150);
  v_link := case t.subject_type when 'replacement_credit' then '/approvals/credits/' || f.reference else '/approvals/leave/' || f.reference end;
  v_payload := jsonb_build_object('reference', f.reference, 'employee', app.employee_display(t.subject_employee_id), 'type', f.label,
                                  'level', t.level, 'emergency', coalesce(f.is_emergency, false));
  if t.source = 'admin_pool' then
    perform app.notify_role_holders(array['ADM','SA']::app.privileged_role[], v_code, v_title, f.label || ' — level ' || t.level, v_link, true, v_tpl, v_payload, v_subject_user);
  elsif t.source = 'super_admin_pool' then
    perform app.notify_role_holders(array['SA']::app.privileged_role[], v_code, v_title, f.label || ' — level ' || t.level, v_link, true, v_tpl, v_payload, v_subject_user);
  elsif t.assignee_user_id is not null then
    perform app.notify(t.assignee_user_id, v_code, v_title, f.label || ' — level ' || t.level, v_link, true, v_tpl, v_payload);
    v_del := app.active_delegate(t.assignee_user_id, app.today_myt(), app.task_scope(t.subject_type));
    if v_del is not null and v_del is distinct from v_subject_user then
      perform app.notify(v_del, v_code, v_title, f.label || ' — as delegate of ' || app.user_name(t.assignee_user_id), v_link, true, v_tpl, v_payload);
    end if;
  end if;
end $$;

create or replace function app.route_approval(p_type app.task_subject, p_id uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare f record;
begin
  select * into f from app.task_subject_facts(p_type, p_id);
  if f.reference is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if p_type = 'disbursement_batch' then
    if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  else
    if f.employee_id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
    if app.current_app_user_id() is not null and not (app.is_self(f.employee_id) or app.is_admin()) then
      raise exception 'PRET-ACC-403' using errcode = '42501';
    end if;
  end if;
  if exists (select 1 from app.approval_tasks t where t.subject_type = p_type and app.task_subject_id(t) = p_id and t.status = 'open') then
    raise exception 'PRET-TASK-ROUTED: already routed' using errcode = '23514';
  end if;
  if p_type = 'claim' then perform app.open_claim_task(p_id); return 1; end if;
  if p_type = 'disbursement_batch' then perform app.open_batch_task(p_id); return 1; end if;
  return app.open_approval_level(p_type, p_id, 1, null);
end $$;

-- SA approval of a disbursement batch (setting on — D12 / PB8): super_admin_pool, approver ≠ preparer (chk_not_preparer).
create or replace function app.open_batch_task(p_batch_id uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare b app.disbursement_batches%rowtype; v_task uuid;
begin
  select * into b from app.disbursement_batches where id = p_batch_id;
  insert into app.approval_tasks (subject_type, disbursement_batch_id, subject_prepared_by, level, source, routing_note)
  values ('disbursement_batch', b.id, b.prepared_by, 1, 'super_admin_pool', 'Super Admin approval of disbursement batches is on')
  returning id into v_task;
  perform app.notify_task(v_task);
  return v_task;
end $$;

create or replace function app.batch_event(p_batch_id uuid, p_event text, p_from app.batch_status, p_to app.batch_status, p_comment text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := app.current_app_user_id();
begin
  insert into app.disbursement_batch_events (batch_id, event, from_status, to_status, actor_user_id, actor_name, comment)
  values (p_batch_id, left(p_event, 200), p_from, p_to, v_actor, coalesce(app.user_name(v_actor), 'System'), left(p_comment, 500));
end $$;

-- Claim / batch decision effects (called by decide_task after the task row is decided).
create or replace function app.claim_task_decided(p_type app.task_subject, p_id uuid, p_decision text, p_comment text, p_acting app.acting_as) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c app.claims%rowtype; b app.disbursement_batches%rowtype;
begin
  if p_type = 'claim' then
    select * into c from app.claims where id = p_id for update;
    if c.status <> 'submitted' then raise exception 'PRET-TASK-DECIDED: Already decided' using errcode = '40001'; end if;
    if p_decision = 'approve' then
      update app.claims set status = 'approved' where id = p_id;
      update app.claim_lines l set tax_treatment_snapshot = k.tax_treatment, ea_form_line_snapshot = k.ea_form_line, gl_account_snapshot = k.gl_account_code
        from app.claim_categories k where k.id = l.category_id and l.claim_id = p_id;                                -- BR-CLM-24
      perform app.claim_event(p_id, 'Approved', 'submitted', 'approved', p_acting, p_comment);
      perform app.notify_employee(c.employee_id, 'N-22', 'Claim approved: ' || c.claim_no,
        left(app.rm(c.total_amount) || ' · approved by ' || coalesce(app.user_name(app.current_app_user_id()), '') || ' — paid at month end.', 500),
        '/my/claims/' || c.claim_no, false, 'claim_approved', jsonb_build_object('reference', c.claim_no, 'total', app.rm(c.total_amount)));
    else
      update app.claims set status = 'rejected', reject_reason = p_comment where id = p_id;
      perform app.claim_event(p_id, 'Rejected', 'submitted', 'rejected', p_acting, p_comment);
      perform app.notify_employee(c.employee_id, 'N-23', 'Claim rejected: ' || c.claim_no, left(coalesce(p_comment, ''), 500),
        '/my/claims/' || c.claim_no, false, 'claim_rejected', jsonb_build_object('reference', c.claim_no, 'reason', p_comment));
    end if;
  elsif p_type = 'disbursement_batch' then
    select * into b from app.disbursement_batches where id = p_id for update;
    if b.status <> 'pending_approval' then raise exception 'PRET-TASK-DECIDED: Already decided' using errcode = '40001'; end if;
    if p_decision = 'approve' then
      update app.disbursement_batches set status = 'approved', approved_by = app.current_app_user_id(), approved_at = now() where id = p_id;
      perform app.batch_event(p_id, 'Approved by Super Admin', 'pending_approval', 'approved', p_comment);
    else
      update app.disbursement_batches set status = 'draft' where id = p_id;
      perform app.batch_event(p_id, 'Returned by Super Admin', 'pending_approval', 'draft', p_comment);
    end if;
    perform app.notify(b.prepared_by, 'N-27', left('Disbursement batch ' || case when p_decision = 'approve' then 'approved: ' else 'returned: ' end || b.batch_no, 150),
      left(coalesce(p_comment, ''), 500), '/claims/batches/' || b.batch_no, p_decision <> 'approve', null, null);
  end if;
end $$;

create or replace function app.decide_task(p_task_id uuid, p_decision text, p_comment text, p_expected_version int,
                                           p_as_override boolean default false)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  t app.approval_tasks%rowtype; f record; v_acting app.acting_as; v_next int; v_outcome text; v_msg text; v_comment text := nullif(btrim(p_comment), '');
begin
  if p_decision not in ('approve','reject') then raise exception 'PRET-TASK-DECISION' using errcode = '22023'; end if;
  select * into t from app.approval_tasks where id = p_task_id for update;
  if t.id is null or not (app.can_see_team_row(t.subject_employee_id) or app.can_act_on_task(t.id)
                          or (t.subject_type = 'disbursement_batch' and app.is_admin())) then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  if t.status <> 'open' or (p_expected_version is not null and t.version <> p_expected_version) then
    raise exception 'PRET-TASK-DECIDED: Already decided by % at %', coalesce(t.decided_by_name, 'someone else'),
      coalesce(to_char(t.decided_at at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'), 'an earlier time') using errcode = '40001';
  end if;
  if t.subject_employee_id = app.current_employee_id() then
    raise exception 'PRET-SELF-001: you cannot decide your own request' using errcode = '42501';
  end if;
  if t.subject_prepared_by = app.current_app_user_id() then
    raise exception 'PRET-SELF-001: you prepared or entered this item — another approver must decide' using errcode = '42501';
  end if;
  v_acting := app.task_acting_as(t.id);
  if v_acting is null then raise exception 'PRET-TASK-NOT-YOURS: this item is not waiting for you' using errcode = '42501'; end if;
  if v_acting = 'admin_override' and (not p_as_override or char_length(coalesce(v_comment, '')) < 5) then
    raise exception 'PRET-TASK-OVERRIDE: give the reason for the Admin override' using errcode = '23514';
  end if;
  if p_decision = 'reject' and char_length(coalesce(v_comment, '')) < 5 then
    raise exception 'PRET-TASK-COMMENT: add a comment to reject' using errcode = '23514';
  end if;
  select * into f from app.task_subject_facts(t.subject_type, app.task_subject_id(t));
  if t.subject_employee_id is not null then
    perform pg_advisory_xact_lock(hashtext(case when t.subject_type = 'claim' then 'claims:' else 'leave:' end || t.subject_employee_id::text));
  end if;
  if t.subject_type in ('claim','disbursement_batch') then
    update app.approval_tasks set status = case when p_decision = 'approve' then 'approved' else 'rejected' end::app.task_status,
           acting_as = v_acting, decision_comment = v_comment
     where id = t.id;
    perform app.claim_task_decided(t.subject_type, app.task_subject_id(t), p_decision, v_comment, v_acting);
    return jsonb_build_object('outcome', case when p_decision = 'approve' then 'approved' else 'rejected' end, 'subject_type', t.subject_type,
      'reference', f.reference, 'next_level', null,
      'message', case when t.subject_type = 'disbursement_batch' then case when p_decision = 'approve' then 'Batch approved' else 'Returned to the preparer' end
                      else case when p_decision = 'approve' then 'Approved' else 'Rejected' end end);
  end if;
  -- leave subjects (W2-004 behaviour, unchanged)
  if t.subject_type in ('leave_application','leave_cancellation') then
    perform 1 from app.leave_applications a where a.id = t.leave_application_id or a.split_group_id = (select x.split_group_id from app.leave_applications x where x.id = t.leave_application_id) for update;
  elsif t.subject_type = 'replacement_credit' then
    perform 1 from app.replacement_credits c where c.id = t.replacement_credit_id for update;
  end if;
  update app.approval_tasks set status = case when p_decision = 'approve' then 'approved' else 'rejected' end::app.task_status,
         acting_as = v_acting, decision_comment = v_comment
   where id = t.id;
  if p_decision = 'reject' then
    perform app.subject_rejected(t.subject_type, app.task_subject_id(t), v_comment);
    return jsonb_build_object('outcome', 'rejected', 'subject_type', t.subject_type, 'reference', f.reference, 'message', 'Rejected', 'next_level', null);
  end if;
  v_next := app.open_approval_level(t.subject_type, app.task_subject_id(t), t.level + 1, app.current_app_user_id());
  if v_next = 0 then
    perform app.subject_approved(t.subject_type, app.task_subject_id(t));
    v_outcome := 'approved';
    v_msg := case t.subject_type when 'leave_cancellation' then 'Cancellation approved — leave cancelled' else 'Approved' end;
  else
    perform app.subject_moved(t.subject_type, app.task_subject_id(t), v_next);
    v_outcome := 'moved_to_next';
    v_msg := 'Moved to level ' || v_next || ' (' || coalesce((select coalesce(app.user_name(x.assignee_user_id), case x.source when 'super_admin_pool' then 'Super Admin' else 'Any Admin' end)
                                                               from app.approval_tasks x where x.subject_type = t.subject_type and app.task_subject_id(x) = app.task_subject_id(t)
                                                                 and x.status = 'open'), '') || ')';
  end if;
  return jsonb_build_object('outcome', v_outcome, 'subject_type', t.subject_type, 'reference', f.reference, 'message', v_msg,
                            'next_level', case when v_next = 0 then null else v_next end);
end $$;

-- Re-resolve open claim tasks (manager / claim approver change, approver separated / on leave) — called by reroute_open_tasks.
create or replace function app.reroute_claim_tasks(p_employee_id uuid default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare t app.approval_tasks%rowtype; r record; n int := 0; v_new uuid;
begin
  for t in select x.* from app.approval_tasks x
            where x.status = 'open' and x.subject_type = 'claim' and (p_employee_id is null or x.subject_employee_id = p_employee_id)
              and (x.routing_note is null or x.routing_note not like 'Reassigned by HR%')
            for update loop
    select * into r from app.resolve_claim_approver(t.subject_employee_id, app.today_myt());
    continue when r.assignee is not distinct from t.assignee_user_id;
    update app.approval_tasks set status = 'superseded', routing_note = left(coalesce(routing_note || '; ', '') || 'Re-routed', 500) where id = t.id;
    insert into app.approval_tasks (subject_type, claim_id, subject_employee_id, subject_prepared_by, level, source, assignee_user_id, original_assignee_user_id, routing_note)
    values ('claim', t.claim_id, t.subject_employee_id, t.subject_prepared_by, 1, 'claim_pool', r.assignee, coalesce(r.original, t.assignee_user_id),
            coalesce(r.note, 'Re-routed: reporting line changed'))
    returning id into v_new;
    if r.assignee is not null then perform app.notify_task(v_new); end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function app.reroute_open_tasks(p_employee_id uuid default null) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare t app.approval_tasks%rowtype; f record; r record; n int := 0; v_new uuid;
begin
  for t in select x.* from app.approval_tasks x
            where x.status = 'open' and x.subject_type in ('leave_application','leave_cancellation','replacement_credit')
              and x.source in ('direct_manager','leave_approver_override','managers_manager','specific_employee','super_admin_pool')
              and (p_employee_id is null or x.subject_employee_id = p_employee_id)
            for update loop
    select * into f from app.task_subject_facts(t.subject_type, app.task_subject_id(t));
    select * into r from app.resolve_level(f.workflow_id, case when t.subject_type = 'leave_cancellation' then 1 else t.level end, f.employee_id, null,
                                           app.task_scope(t.subject_type), app.today_myt());
    continue when r.outcome <> 'open';
    continue when r.source = t.source and r.assignee is not distinct from t.assignee_user_id;
    continue when r.source = 'super_admin_pool' and t.source = 'super_admin_pool';
    update app.approval_tasks set status = 'superseded', routing_note = left(coalesce(routing_note || '; ', '') || 'Re-routed', 500) where id = t.id;
    insert into app.approval_tasks (subject_type, leave_application_id, replacement_credit_id, subject_employee_id, level, source,
                                    assignee_user_id, original_assignee_user_id, routing_note, reminder_count)
    values (t.subject_type, t.leave_application_id, t.replacement_credit_id, t.subject_employee_id, t.level, r.source, r.assignee,
            coalesce(r.original, t.assignee_user_id), coalesce(r.note, 'Re-routed: reporting line changed'), 0)
    returning id into v_new;
    perform app.notify_task(v_new);
    n := n + 1;
  end loop;
  return n + app.reroute_claim_tasks(p_employee_id);
end $$;

create or replace function app.reassign_tasks(p_from_user uuid, p_to_user uuid, p_types app.task_subject[], p_reason text, p_dry_run boolean default false)
returns table (task_id uuid, reference text, subject_type app.task_subject, employee_name text, level int, skipped boolean, note text)
language plpgsql volatile security definer set search_path = '' as $$
declare t app.approval_tasks%rowtype; f record; v_to_emp uuid; v_new uuid;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if char_length(coalesce(p_reason, '')) < 10 and not p_dry_run then raise exception 'PRET-REASSIGN-REASON' using errcode = '23514'; end if;
  select u.employee_id into v_to_emp from app.app_users u where u.id = p_to_user and u.status = 'active' and u.user_type = 'employee';
  if p_to_user is not null and v_to_emp is null and not p_dry_run then
    raise exception 'PRET-REASSIGN-TARGET: the new approver must be an active employee user' using errcode = '23514';
  end if;
  for t in select x.* from app.approval_tasks x
            where x.status = 'open' and x.assignee_user_id = p_from_user and x.subject_type = any(p_types)
            order by x.created_at loop
    select * into f from app.task_subject_facts(t.subject_type, app.task_subject_id(t));
    task_id := t.id; reference := f.reference; subject_type := t.subject_type; employee_name := app.employee_display(t.subject_employee_id);
    level := t.level; skipped := false; note := null;
    if v_to_emp is not null and v_to_emp = t.subject_employee_id then
      skipped := true; note := 'The new approver is the applicant'; return next; continue;
    end if;
    if p_to_user is not null and p_to_user = t.subject_prepared_by then
      skipped := true; note := 'The new approver entered this item'; return next; continue;
    end if;
    if t.subject_employee_id = app.current_employee_id() then
      skipped := true; note := 'Your own item'; return next; continue;
    end if;
    if not p_dry_run then
      update app.approval_tasks set status = 'superseded', routing_note = left(coalesce(routing_note || '; ', '') || 'Reassigned by HR', 500) where id = t.id;
      insert into app.approval_tasks (subject_type, leave_application_id, replacement_credit_id, claim_id, disbursement_batch_id, subject_employee_id,
                                      subject_prepared_by, level, source, assignee_user_id, original_assignee_user_id, routing_note)
      values (t.subject_type, t.leave_application_id, t.replacement_credit_id, t.claim_id, t.disbursement_batch_id, t.subject_employee_id,
              t.subject_prepared_by, t.level, t.source, p_to_user, p_from_user, left('Reassigned by HR: ' || p_reason, 500))
      returning id into v_new;
      perform app.notify_task(v_new);
    end if;
    return next;
  end loop;
end $$;

create or replace function app.tg_employee_approver_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.manager_employee_id is distinct from old.manager_employee_id or new.leave_approver_employee_id is distinct from old.leave_approver_employee_id
     or new.claim_approver_employee_id is distinct from old.claim_approver_employee_id then
    perform app.reroute_open_tasks(new.id);
  end if;
  if new.status is distinct from old.status and new.status in ('separated','withdrawn') then
    perform app.reroute_open_tasks(null);
  end if;
  return null;
end $$;
