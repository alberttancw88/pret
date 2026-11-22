-- PRET W2-005 · 03 — cancel an approved claim (F-CLM-30), month-end disbursement batches (F-CLM-14/17/23, BR-CLM-26/28,
-- PB1–PB13, D12/D16/D23), generated outputs register (PB13), payee facts for the HLB payment list, bank-change flag (EC-CLM-10).
-- Guards (brief rule 3): only Approved claims enter a batch; one active batch per claim (ux_batch_claim_active); a Disbursed
-- claim leaves its batch only through undo; batch totals immutable once disbursed / cancelled; idempotent create and marking.

-- ===========================================================================
-- Batch membership and totals
-- ===========================================================================
create or replace function app.refresh_batch_totals(p_batch_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update app.disbursement_batches b
     set claim_count = x.n, employee_count = x.e, total_amount = x.t, total_sst = x.s
    from (select count(*)::int as n, count(distinct m.employee_id)::int as e, coalesce(sum(m.amount), 0) as t, coalesce(sum(m.sst), 0) as s
            from app.disbursement_batch_claims m where m.batch_id = p_batch_id and m.removed_at is null) x
   where b.id = p_batch_id and b.status not in ('disbursed','cancelled')
     and (b.claim_count, b.employee_count, b.total_amount, b.total_sst) is distinct from (x.n, x.e, x.t, x.s);
end $$;

create or replace function app.batch_add_claim(p_batch_id uuid, p_claim_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c app.claims%rowtype; v_other text;
begin
  select * into c from app.claims where id = p_claim_id for update;
  if c.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if c.status <> 'approved' then raise exception 'PRET-BATCH-CLAIM-STATE: % is not Approved', c.claim_no using errcode = '23514'; end if;
  if app.is_self(c.employee_id) then raise exception 'PRET-SELF-001: you cannot disburse your own claim (%)', c.claim_no using errcode = '42501'; end if;
  select b.batch_no into v_other from app.disbursement_batch_claims m join app.disbursement_batches b on b.id = m.batch_id
   where m.claim_id = c.id and m.removed_at is null and m.undone_at is null;
  if v_other is not null then raise exception 'PRET-BATCH-CLAIM-TAKEN: % is already in %', c.claim_no, v_other using errcode = '23514'; end if;
  insert into app.disbursement_batch_claims (batch_id, claim_id, employee_id, amount, sst, added_by)
  values (p_batch_id, c.id, c.employee_id, c.total_amount, c.total_sst, app.current_app_user_id());
  update app.claims set disbursement_batch_id = p_batch_id, disbursed_via = 'hlb_batch' where id = c.id;
end $$;

-- remove one claim from an open batch (Draft removal by ADM; cancellation of the claim — BR-CLM-26)
create or replace function app.batch_drop_claim(p_claim_id uuid, p_reason text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare m app.disbursement_batch_claims%rowtype; b app.disbursement_batches%rowtype; v_no text;
begin
  select * into m from app.disbursement_batch_claims where claim_id = p_claim_id and removed_at is null and undone_at is null for update;
  if m.id is null then return null; end if;
  select * into b from app.disbursement_batches where id = m.batch_id for update;
  if b.status = 'disbursed' then raise exception 'PRET-BATCH-DISBURSED: use Undo disbursement' using errcode = '23514'; end if;
  update app.disbursement_batch_claims set removed_at = now(), removed_by = app.current_app_user_id(), removed_reason = left(p_reason, 500) where id = m.id;
  update app.claims set disbursement_batch_id = null, disbursed_via = null where id = p_claim_id and disbursement_batch_id = m.batch_id;
  perform app.refresh_batch_totals(b.id);
  select claim_no into v_no from app.claims where id = p_claim_id;
  if b.outputs_version > 0 then
    update app.disbursement_batches set outputs_out_of_date = true, out_of_date_reason = left(v_no || ' was ' || coalesce(p_reason, 'removed') || ' after export', 300)
     where id = b.id;
    update app.export_files set is_out_of_date = true where subject_type = 'disbursement_batch' and subject_id = b.id and not is_superseded;
  end if;
  perform app.batch_event(b.id, 'Removed ' || v_no, b.status, b.status, p_reason);
  return b.id;
end $$;

-- ===========================================================================
-- F-CLM-30 cancel an approved claim (claimant's Manager / delegate, any ADM / SA; never own) — BR-CLM-26, EC-CLM-11
-- ===========================================================================
create or replace function app.can_cancel_claim(p_claim_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.claims c
     where c.id = p_claim_id and c.status = 'approved' and app.current_app_user_id() is not null
       and c.employee_id is distinct from app.current_employee_id()
       and (app.is_admin() or app.is_manager_of(c.employee_id)
            or exists (select 1 from app.approval_tasks t where t.claim_id = c.id and t.status = 'approved'
                        and (app.current_app_user_id() in (t.assignee_user_id, t.original_assignee_user_id, t.decided_by)
                             or app.active_delegate(t.assignee_user_id, app.today_myt(), 'claims') = app.current_app_user_id()))))
$$;

create or replace function app.cancel_claim(p_claim_id uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c app.claims%rowtype; v_reason text := nullif(btrim(p_reason), '');
begin
  select * into c from app.claims where id = p_claim_id for update;
  if c.id is null or not app.can_see_team_row(c.employee_id) then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if app.is_self(c.employee_id) then raise exception 'PRET-SELF-001: you cannot cancel your own claim' using errcode = '42501'; end if;
  if c.status <> 'approved' then raise exception 'PRET-CLM-STATE: only Approved claims that are not yet disbursed can be cancelled' using errcode = '23514'; end if;
  if char_length(coalesce(v_reason, '')) < 5 then raise exception 'PRET-CLM-REASON: give the reason (at least 5 characters)' using errcode = '23514'; end if;
  if not app.can_cancel_claim(c.id) then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('claims:' || c.employee_id::text));
  update app.claims set status = 'cancelled', cancel_reason = v_reason where id = c.id;   -- the transition trigger clears the batch pointer
  perform app.batch_drop_claim(c.id, 'cancelled');
  perform app.claim_event(c.id, 'Cancelled', 'approved', 'cancelled', null, v_reason);
  perform app.notify_employee(c.employee_id, 'N-59', 'Claim cancelled: ' || c.claim_no,
    left(coalesce(app.user_name(app.current_app_user_id()), '') || ': ' || v_reason, 500), '/my/claims/' || c.claim_no, false, 'claim_cancelled',
    jsonb_build_object('reference', c.claim_no, 'reason', v_reason, 'by', app.user_name(app.current_app_user_id())));
end $$;

-- F-CLM-23 undo disbursement (Disbursed → Approved, reason; picked up by the next batch) — ADM / SA, not own; N-28
create or replace function app.undo_claim_disbursement(p_claim_id uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c app.claims%rowtype; v_reason text := nullif(btrim(p_reason), ''); v_batch uuid;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  select * into c from app.claims where id = p_claim_id for update;
  if c.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if app.is_self(c.employee_id) then raise exception 'PRET-SELF-001: you cannot undo your own claim' using errcode = '42501'; end if;
  if c.status <> 'disbursed' then raise exception 'PRET-CLM-STATE: only Disbursed claims can be undone' using errcode = '23514'; end if;
  if char_length(coalesce(v_reason, '')) < 5 then raise exception 'PRET-CLM-REASON: give the reason (at least 5 characters)' using errcode = '23514'; end if;
  v_batch := c.disbursement_batch_id;
  update app.disbursement_batch_claims set undone_at = now(), undone_by = app.current_app_user_id(), undo_reason = v_reason
   where claim_id = c.id and removed_at is null and undone_at is null;
  update app.claims set status = 'approved' where id = c.id;
  perform app.claim_event(c.id, 'Disbursement undone', 'disbursed', 'approved', null, v_reason, v_batch);
  if v_batch is not null then perform app.batch_event(v_batch, 'Disbursement undone: ' || c.claim_no, 'disbursed', 'disbursed', v_reason); end if;
  perform app.notify_employee(c.employee_id, 'N-28', 'Payment reversed: ' || c.claim_no,
    left('Payment reversed — ' || v_reason || '; it will be paid in the next batch.', 500), '/my/claims/' || c.claim_no, false, 'claim_disbursement_undone',
    jsonb_build_object('reference', c.claim_no, 'reason', v_reason));
  perform app.notify_role_holders(array['ADM','SA']::app.privileged_role[], 'N-28', left('Disbursement undone: ' || c.claim_no, 150),
    left(v_reason, 500), '/approvals/claims/' || c.claim_no, false, null, null, app.current_app_user_id());
end $$;

-- ===========================================================================
-- Batches (C10 / C11 / C13)
-- ===========================================================================
create or replace function app.create_batch(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id(); v_key uuid := nullif(p ->> 'idempotencyKey', '')::uuid; b app.disbursement_batches%rowtype;
  v_month date := to_date(p ->> 'disbursementMonth' || '-01', 'YYYY-MM-DD'); v_cut date := (p ->> 'cutoffDate')::date;
  v_planned date := (p ->> 'plannedPaymentDate')::date; v_id uuid; v_regular boolean; r record;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if v_key is not null then
    select * into b from app.disbursement_batches where idempotency_key = v_key;
    if b.id is not null then return jsonb_build_object('id', b.id, 'batchNo', b.batch_no, 'duplicate', true); end if;
  end if;
  if v_planned < app.today_myt() then raise exception 'PRET-BATCH-FIELD plannedPaymentDate: the planned payment date must be today or later' using errcode = '23514'; end if;
  if v_cut > (v_month + interval '1 month')::date - 1 then
    raise exception 'PRET-BATCH-FIELD cutoffDate: the cut-off must be on or before the last day of the month' using errcode = '23514';
  end if;
  if jsonb_array_length(coalesce(p -> 'claimIds', '[]')) = 0 then raise exception 'PRET-BATCH-FIELD claimIds: select at least one claim' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtext('batch:' || v_month::text));
  v_regular := not exists (select 1 from app.disbursement_batches x where x.disbursement_month = v_month and x.is_regular and x.status <> 'cancelled');
  insert into app.disbursement_batches (batch_no, disbursement_month, is_regular, approval_cutoff_date, planned_payment_date, notes, prepared_by, idempotency_key)
  values (private.next_doc_no('PB', extract(year from v_month)::int), v_month, v_regular, v_cut, v_planned, nullif(p ->> 'notes', ''), v_actor, v_key)
  returning * into b;
  for v_id in select distinct (x)::uuid from jsonb_array_elements_text(p -> 'claimIds') x loop
    perform app.batch_add_claim(b.id, v_id);
  end loop;
  perform app.refresh_batch_totals(b.id);
  perform app.batch_event(b.id, 'Created', null, 'draft', nullif(p ->> 'notes', ''));
  for r in select c.employee_id, c.claim_no, c.id from app.claims c where c.disbursement_batch_id = b.id loop
    perform app.claim_event(r.id, 'Included in batch ' || b.batch_no, 'approved', 'approved', null, null, b.id);
  end loop;
  for r in select c.employee_id, string_agg(c.claim_no, ', ' order by c.claim_no) as nos, sum(c.total_amount) as amt
             from app.claims c where c.disbursement_batch_id = b.id group by c.employee_id loop
    perform app.notify_employee(r.employee_id, 'N-29', left('Claims to be paid: ' || r.nos, 150),
      left(app.rm(r.amt) || ' — planned payment ' || app.dmy(v_planned) || ' (' || b.batch_no || ')', 500), '/my/claims', false, null, null);
  end loop;
  return jsonb_build_object('id', b.id, 'batchNo', b.batch_no, 'duplicate', false);
end $$;

create or replace function app.batch_add_claims(p_batch_id uuid, p_claim_ids uuid[], p_expected_version int default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b app.disbursement_batches%rowtype; v_id uuid; c record;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  select * into b from app.disbursement_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if b.status <> 'draft' then raise exception 'PRET-BATCH-STATE: claims can be added only while the batch is Draft' using errcode = '23514'; end if;
  if p_expected_version is not null and b.version <> p_expected_version then raise exception 'PRET-STALE' using errcode = '40001'; end if;
  foreach v_id in array p_claim_ids loop
    perform app.batch_add_claim(b.id, v_id);
    select claim_no, employee_id into c from app.claims where id = v_id;
    perform app.claim_event(v_id, 'Included in batch ' || b.batch_no, 'approved', 'approved', null, null, b.id);
    perform app.batch_event(b.id, 'Added ' || c.claim_no, 'draft', 'draft');
  end loop;
  perform app.refresh_batch_totals(b.id);
end $$;

create or replace function app.batch_remove_claim(p_batch_id uuid, p_claim_id uuid, p_expected_version int default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b app.disbursement_batches%rowtype;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  select * into b from app.disbursement_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if b.status <> 'draft' then raise exception 'PRET-BATCH-STATE: claims can be removed only while the batch is Draft' using errcode = '23514'; end if;
  if p_expected_version is not null and b.version <> p_expected_version then raise exception 'PRET-STALE' using errcode = '40001'; end if;
  if not exists (select 1 from app.disbursement_batch_claims m where m.batch_id = b.id and m.claim_id = p_claim_id and m.removed_at is null) then
    raise exception 'PRET-ACC-404' using errcode = '42501';
  end if;
  perform app.batch_drop_claim(p_claim_id, 'removed');
  perform app.claim_event(p_claim_id, 'Removed from batch ' || b.batch_no, 'approved', 'approved', null, null, b.id);
end $$;

create or replace function app.batch_submit_for_approval(p_batch_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b app.disbursement_batches%rowtype;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if not coalesce((select s.sa_batch_approval_required from app.security_settings s where s.id = 1), false) then
    raise exception 'PRET-BATCH-APPROVAL-OFF: Super Admin approval of batches is off — generate the outputs instead' using errcode = '23514';
  end if;
  select * into b from app.disbursement_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if b.status <> 'draft' then raise exception 'PRET-BATCH-STATE: only a Draft batch can be submitted for approval' using errcode = '23514'; end if;
  if b.claim_count = 0 then raise exception 'PRET-BATCH-EMPTY: the batch has no claims' using errcode = '23514'; end if;
  update app.disbursement_batches set status = 'pending_approval' where id = b.id;
  perform app.batch_event(b.id, 'Submitted for approval', 'draft', 'pending_approval');
  perform app.route_approval('disbursement_batch', b.id);
end $$;

-- Payees of a batch (C11 By employee, C12, HLB list generation). ADM/SA only. account_no_enc is returned for the server's
-- payment-list generator, which writes audit.access_log BEFORE decrypting (brief rule 4); every other caller ignores it.
create or replace function app.batch_payees(p_batch_id uuid)
returns table (employee_id uuid, employee_no text, full_name text, work_email text, claim_count int, claim_nos text[], amount numeric, sst numeric,
               payment_method app.payment_method, bank_account_id uuid, bank_name text, bank_code text, bic text, account_no_enc bytea, account_no_last4 text,
               account_holder_name text, bank_complete boolean, bank_changed_after_export boolean, is_separated boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  return query
    with m as (
      select x.employee_id, count(*)::int as n, array_agg(c.claim_no order by c.claim_no) as nos, sum(x.amount) as amt, sum(x.sst) as s
        from app.disbursement_batch_claims x join app.claims c on c.id = x.claim_id
       where x.batch_id = p_batch_id and x.removed_at is null
       group by x.employee_id),
    ba as (
      select distinct on (a.employee_id) a.*
        from app.employee_bank_accounts a where a.employee_id in (select m.employee_id from m) and a.effective_from <= app.today_myt()
       order by a.employee_id, a.effective_from desc, a.created_at desc)
    select e.id, e.employee_no, e.full_name, e.work_email::text, m.n, m.nos, m.amt, m.s,
           ba.payment_method, ba.id, bk.name, bk.code, bk.bic, ba.account_no_enc, ba.account_no_last4::text, ba.account_holder_name,
           (ba.payment_method = 'bank_transfer' and ba.bank_id is not null and ba.account_no_enc is not null and ba.account_holder_name is not null),
           exists (select 1 from app.disbursement_batches b where b.id = p_batch_id and b.exported_at is not null and ba.created_at > b.exported_at),
           e.status = 'separated'
      from m join app.employees e on e.id = m.employee_id
      left join ba on ba.employee_id = e.id left join app.banks bk on bk.id = ba.bank_id
     order by e.full_name, e.employee_no;
end $$;

-- PB13: register a generated output set (HLB .xlsx + PDF + AutoCount .xlsx). Totals check is blocking (ADR-0011):
-- HLB list total + cheque/cash section total must equal the batch total to the sen.
create or replace function app.record_batch_outputs(p_batch_id uuid, p_files jsonb, p_hlb_total numeric, p_cheque_total numeric) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare b app.disbursement_batches%rowtype; x jsonb; v_ver int; v_sa boolean; v_from app.batch_status;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  select * into b from app.disbursement_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  v_sa := coalesce((select s.sa_batch_approval_required from app.security_settings s where s.id = 1), false);
  if b.status in ('disbursed','cancelled','pending_approval') or (b.status = 'draft' and v_sa) then
    raise exception 'PRET-BATCH-STATE: outputs cannot be generated in status %', b.status using errcode = '23514';
  end if;
  if b.claim_count = 0 then raise exception 'PRET-BATCH-EMPTY: the batch has no claims' using errcode = '23514'; end if;
  if coalesce(p_hlb_total, 0) + coalesce(p_cheque_total, 0) <> b.total_amount then
    raise exception 'PRET-BATCH-TOTALS: the payment list total (%) does not equal the batch total (%)', app.rm(coalesce(p_hlb_total, 0) + coalesce(p_cheque_total, 0)), app.rm(b.total_amount)
      using errcode = '23514';
  end if;
  v_ver := b.outputs_version + 1;
  update app.export_files set is_superseded = true where subject_type = 'disbursement_batch' and subject_id = b.id and not is_superseded;
  for x in select * from jsonb_array_elements(p_files) loop
    if not exists (select 1 from app.files f where f.id = (x ->> 'fileId')::uuid and f.status = 'active' and f.subject = 'generated_output'
                     and f.created_by = app.current_app_user_id()) then
      raise exception 'PRET-FILE-MISSING' using errcode = '23514';
    end if;
    insert into app.export_files (kind, subject_type, subject_id, version, file_id, layout_code, layout_version, row_count, total_amount, checksum, generated_by)
    values ((x ->> 'kind')::app.output_kind, 'disbursement_batch', b.id, v_ver, (x ->> 'fileId')::uuid, x ->> 'layoutCode', nullif(x ->> 'layoutVersion', '')::int,
            nullif(x ->> 'rowCount', '')::int, nullif(x ->> 'total', '')::numeric, decode(nullif(x ->> 'sha256', ''), 'hex'), app.current_app_user_id());
  end loop;
  v_from := b.status;
  update app.disbursement_batches set status = 'exported', outputs_version = v_ver, outputs_out_of_date = false, out_of_date_reason = null,
         bank_details_changed_after_export = false, exported_at = now()
   where id = b.id;
  perform app.batch_event(b.id, case when v_ver = 1 then 'Outputs generated' else 'Outputs regenerated (version ' || v_ver || ')' end, v_from, 'exported');
  return jsonb_build_object('version', v_ver, 'status', 'exported');
end $$;

-- F-CLM-17 / C13 mark Disbursed (idempotent: the same date + reference again returns the same result) — N-25 per employee
create or replace function app.mark_batch_disbursed(p_batch_id uuid, p_payment_date date, p_reference text, p_notes text, p_expected_version int default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare b app.disbursement_batches%rowtype; r record; v_ref text := nullif(btrim(p_reference), '');
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  select * into b from app.disbursement_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if b.status = 'disbursed' then
    if b.payment_reference = v_ref and b.payment_date = p_payment_date then
      return jsonb_build_object('claims', b.claim_count, 'employees', b.employee_count, 'total', app.money_text(b.total_amount), 'duplicate', true);
    end if;
    raise exception 'PRET-BATCH-STATE: this batch is already Disbursed' using errcode = '23514';
  end if;
  if p_expected_version is not null and b.version <> p_expected_version then raise exception 'PRET-STALE' using errcode = '40001'; end if;
  if b.status <> 'exported' then raise exception 'PRET-BATCH-STATE: generate the outputs before marking the batch Disbursed' using errcode = '23514'; end if;
  if b.outputs_out_of_date then raise exception 'PRET-BATCH-OUT-OF-DATE: regenerate the outputs first — they are out of date' using errcode = '23514'; end if;
  if p_payment_date is null or p_payment_date > app.today_myt() then raise exception 'PRET-BATCH-FIELD paymentDate: the payment date must be today or earlier' using errcode = '23514'; end if;
  if v_ref is null then raise exception 'PRET-BATCH-FIELD paymentReference: enter the HLB payment reference' using errcode = '23514'; end if;
  if exists (select 1 from app.disbursement_batch_claims m join app.claims c on c.id = m.claim_id
              where m.batch_id = b.id and m.removed_at is null and c.employee_id = app.current_employee_id()) then
    raise exception 'PRET-SELF-001: the batch contains your own claim — another Admin must mark it Disbursed' using errcode = '42501';
  end if;
  update app.claims c set status = 'disbursed', disbursed_on = p_payment_date, payment_reference = v_ref, disbursed_via = 'hlb_batch'
    from app.disbursement_batch_claims m where m.batch_id = b.id and m.removed_at is null and m.claim_id = c.id and c.status = 'approved';
  update app.disbursement_batches set status = 'disbursed', payment_date = p_payment_date, payment_reference = v_ref,
         notes = coalesce(nullif(btrim(p_notes), ''), notes), disbursed_by = app.current_app_user_id(), disbursed_at = now()
   where id = b.id;
  perform app.batch_event(b.id, 'Disbursed (ref ' || v_ref || ')', 'exported', 'disbursed', p_notes);
  for r in select c.id from app.claims c join app.disbursement_batch_claims m on m.claim_id = c.id where m.batch_id = b.id and m.removed_at is null loop
    perform app.claim_event(r.id, 'Disbursed (ref ' || v_ref || ')', 'approved', 'disbursed', null, null, b.id);
  end loop;
  for r in select m.employee_id, sum(m.amount) as amt, string_agg(c.claim_no, ', ' order by c.claim_no) as nos
             from app.disbursement_batch_claims m join app.claims c on c.id = m.claim_id
            where m.batch_id = b.id and m.removed_at is null group by m.employee_id loop
    perform app.notify_employee(r.employee_id, 'N-25', left('Claims paid: ' || app.rm(r.amt), 150),
      left(r.nos || ' · paid ' || app.dmy(p_payment_date) || ' · HLB ref ' || v_ref || ' (' || b.batch_no || ')', 500), '/my/claims', false, 'claim_disbursed',
      jsonb_build_object('amount', app.rm(r.amt), 'date', app.dmy(p_payment_date), 'reference', v_ref, 'batch', b.batch_no));
  end loop;
  return jsonb_build_object('claims', b.claim_count, 'employees', b.employee_count, 'total', app.money_text(b.total_amount), 'duplicate', false);
end $$;

create or replace function app.cancel_batch(p_batch_id uuid, p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b app.disbursement_batches%rowtype; v_reason text := nullif(btrim(p_reason), ''); r record;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if char_length(coalesce(v_reason, '')) < 5 then raise exception 'PRET-BATCH-FIELD reason: give the reason (at least 5 characters)' using errcode = '23514'; end if;
  select * into b from app.disbursement_batches where id = p_batch_id for update;
  if b.id is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  if b.status in ('disbursed','cancelled') then raise exception 'PRET-BATCH-STATE: a % batch cannot be cancelled', b.status using errcode = '23514'; end if;
  for r in select m.claim_id from app.disbursement_batch_claims m where m.batch_id = b.id and m.removed_at is null loop
    update app.disbursement_batch_claims set removed_at = now(), removed_by = app.current_app_user_id(), removed_reason = 'Batch cancelled'
     where batch_id = b.id and claim_id = r.claim_id and removed_at is null;
    update app.claims set disbursement_batch_id = null, disbursed_via = null where id = r.claim_id;
    perform app.claim_event(r.claim_id, 'Batch ' || b.batch_no || ' cancelled — back to Approved', 'approved', 'approved', null, v_reason, b.id);
  end loop;
  perform app.close_open_tasks('disbursement_batch', b.id, 'Batch cancelled');
  update app.disbursement_batches set status = 'cancelled', cancelled_by = app.current_app_user_id(), cancelled_at = now(), cancel_reason = v_reason where id = b.id;
  update app.export_files set is_out_of_date = true where subject_type = 'disbursement_batch' and subject_id = b.id;
  perform app.batch_event(b.id, 'Cancelled', b.status, 'cancelled', v_reason);
  if app.current_app_user_id() is distinct from b.prepared_by then
    perform app.notify(b.prepared_by, 'N-27', left('Disbursement batch cancelled: ' || b.batch_no, 150), left(v_reason, 500), '/claims/batches/' || b.batch_no, false, null, null);
  end if;
end $$;

-- Batch status machine + immutability once Disbursed / Cancelled (brief rule 3)
create or replace function app.tg_batches_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'PRET-BATCH-STATE: batches start Draft' using errcode = '23514'; end if;
    new.prepared_by := coalesce(app.current_app_user_id(), new.prepared_by);
    return new;
  end if;
  if old.status in ('disbursed','cancelled') then
    raise exception 'PRET-BATCH-IMMUTABLE: a % batch cannot change', old.status using errcode = '23514';
  end if;
  if (new.batch_no, new.disbursement_month, new.prepared_by, new.created_at, new.is_regular)
     is distinct from (old.batch_no, old.disbursement_month, old.prepared_by, old.created_at, old.is_regular) then
    raise exception 'PRET-BATCH-IMMUTABLE' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and (old.status, new.status) not in (
       ('draft','exported'),('draft','pending_approval'),('pending_approval','approved'),('pending_approval','draft'),('approved','exported'),
       ('exported','disbursed'),('draft','cancelled'),('pending_approval','cancelled'),('approved','cancelled'),('exported','cancelled')) then
    raise exception 'PRET-BATCH-TRANSITION %→%', old.status, new.status using errcode = '23514';
  end if;
  if new.status = 'approved' and old.status = 'pending_approval' then
    if not app.is_sa() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
    new.approved_by := app.current_app_user_id(); new.approved_at := now();
  end if;
  if new.status = 'disbursed' and new.disbursed_by is not distinct from null then new.disbursed_by := app.current_app_user_id(); end if;
  return new;
end $$;
create trigger tg_stamp before insert or update on app.disbursement_batches for each row execute function app.tg_stamp();
create trigger tg_10_guard before insert or update on app.disbursement_batches for each row execute function app.tg_batches_guard();

create or replace function app.tg_batch_claims_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status app.batch_status;
begin
  select b.status into v_status from app.disbursement_batches b where b.id = new.batch_id;
  if tg_op = 'INSERT' then
    if v_status <> 'draft' then raise exception 'PRET-BATCH-STATE: claims can be added only while the batch is Draft' using errcode = '23514'; end if;
    return new;
  end if;
  if (new.batch_id, new.claim_id, new.amount, new.sst, new.added_at) is distinct from (old.batch_id, old.claim_id, old.amount, old.sst, old.added_at) then
    raise exception 'PRET-BATCH-IMMUTABLE' using errcode = '23514';
  end if;
  if old.removed_at is not null or old.undone_at is not null then raise exception 'PRET-BATCH-IMMUTABLE' using errcode = '23514'; end if;
  if new.removed_at is not null and v_status = 'disbursed' then raise exception 'PRET-BATCH-DISBURSED: use Undo disbursement' using errcode = '23514'; end if;
  if new.undone_at is not null and v_status <> 'disbursed' then raise exception 'PRET-BATCH-STATE' using errcode = '23514'; end if;
  return new;
end $$;
create trigger tg_10_guard before insert or update on app.disbursement_batch_claims for each row execute function app.tg_batch_claims_guard();

-- a Disbursed claim leaves its batch only through undo; only Approved claims point to a batch
create or replace function app.tg_claims_batch_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.disbursement_batch_id is distinct from old.disbursement_batch_id then
    if old.status = 'disbursed' and not (new.status = 'approved') then
      raise exception 'PRET-BATCH-DISBURSED: a Disbursed claim leaves its batch only through Undo disbursement' using errcode = '23514';
    end if;
    if new.disbursement_batch_id is not null and not exists (select 1 from app.disbursement_batch_claims m
         where m.batch_id = new.disbursement_batch_id and m.claim_id = new.id and m.removed_at is null and m.undone_at is null) then
      raise exception 'PRET-BATCH-LINK: add claims to a batch through the batch functions' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger tg_30_batch_link before update on app.claims for each row execute function app.tg_claims_batch_link();

-- EC-CLM-10: new bank details for an employee in an exported (not yet disbursed) batch → outputs out of date + warning
create or replace function app.tg_bank_change_batches() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update app.disbursement_batches b set bank_details_changed_after_export = true, outputs_out_of_date = true,
         out_of_date_reason = left('Bank details of ' || coalesce(app.employee_display(new.employee_id), 'an employee') || ' changed after export', 300)
   where b.status = 'exported'
     and exists (select 1 from app.disbursement_batch_claims m where m.batch_id = b.id and m.employee_id = new.employee_id and m.removed_at is null);
  return null;
end $$;
create trigger tg_claims_batches after insert on app.employee_bank_accounts for each row execute function app.tg_bank_change_batches();

-- export_files guard: versions are append-only (only the supersede / out-of-date flags change)
create or replace function app.tg_export_files_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (to_jsonb(new) - array['is_superseded','is_out_of_date']) is distinct from (to_jsonb(old) - array['is_superseded','is_out_of_date']) then
    raise exception 'PRET-EXPORT-IMMUTABLE' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger tg_10_guard before update on app.export_files for each row execute function app.tg_export_files_guard();

-- Generic output register for non-batch outputs (AutoCount by date range, attachment zips, claims .xlsx) — ADM/SA
create or replace function app.record_export(p_kind app.output_kind, p_subject_type text, p_subject_id uuid, p_file_id uuid, p_row_count int,
                                             p_total numeric, p_sha256 text, p_layout text default null) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if not exists (select 1 from app.files f where f.id = p_file_id and f.status = 'active' and f.subject = 'generated_output' and f.created_by = app.current_app_user_id()) then
    raise exception 'PRET-FILE-MISSING' using errcode = '23514';
  end if;
  insert into app.export_files (kind, subject_type, subject_id, version, file_id, layout_code, row_count, total_amount, checksum, generated_by)
  values (p_kind, p_subject_type, p_subject_id,
          coalesce((select max(x.version) from app.export_files x where x.kind = p_kind and x.subject_type = p_subject_type and x.subject_id = p_subject_id), 0) + 1,
          p_file_id, p_layout, p_row_count, p_total, decode(nullif(p_sha256, ''), 'hex'), app.current_app_user_id())
  returning id into v_id;
  return v_id;
end $$;
