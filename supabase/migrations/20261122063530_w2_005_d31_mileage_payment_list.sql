-- PRET W2-005 · 07 — D31 (Albert's answers, 22/11/2026):
--   (5) mileage rate RM 0.50/km (replaces the RM 0.60 placeholder) · (9) mileage claims need a receipt — a Google Maps screenshot
--   showing start point, end point and distance (km) · (6) the C12 HLB payment list shows account numbers in full on screen for
--   ADM/SA, every view access-logged · (2)(3) placeholders: claims-payable account TBC-CLAIMS-PAYABLE (GL accounts stay TBC-<code>).

-- (5) the seeded placeholder rate was never used for a submitted claim: correct it in place (history keeps one row per date)
update app.claim_category_rates r set rate_per_km = 0.500
  from app.claim_categories k
 where k.id = r.category_id and k.code in ('EMP-TRANS','EMP-TRAVEL') and r.effective_from = date '2020-01-01' and r.rate_per_km = 0.600;
-- New (unsubmitted) mileage lines follow the rate effective on their transaction date (submitted claims keep their snapshot — BR-CLM-15)
update app.claim_lines l set rate_per_km = x.rate, amount_incl_sst = round(l.distance_km * x.rate, 2)
  from (select l2.id, app.claim_rate_on(l2.category_id, l2.transaction_date) as rate
          from app.claim_lines l2 join app.claims c on c.id = l2.claim_id where c.status = 'new' and l2.distance_km is not null) x
 where x.id = l.id and x.rate is not null and l.rate_per_km is distinct from x.rate;

-- (9) receipt required + the hint shown under the category on the line (CC4)
update app.claim_categories set receipt_required = true,
       description = 'Attach a Google Maps screenshot showing the start point, end point and distance (km).'
 where code in ('EMP-TRANS','EMP-TRAVEL');

-- (2)(3) claims-payable credit account placeholder (AutoCount export credit column) — obviously not configured
insert into app.gl_mappings (purpose, gl_account_code) values ('claims_payable', 'TBC-CLAIMS-PAYABLE') on conflict (purpose) do nothing;

-- (6) full payment list for ADM/SA — the ONLY source of account ciphertext. Writes audit.access_log in the same transaction
-- as the read, so no decryption can happen without a log row: purpose 'view' (C12 on screen → reveal) or 'export'
-- (.xlsx / PDF generation). Managers / employees get PRET-ACC-403.
create or replace function app.payment_list_view(p_batch_id uuid, p_purpose text)
returns table (employee_id uuid, employee_no text, full_name text, bank_account_id uuid, account_no_enc bytea)
language plpgsql volatile security definer set search_path = '' as $$
declare v_ids uuid[]; v_no text;
begin
  if not app.is_admin() then raise exception 'PRET-ACC-403' using errcode = '42501'; end if;
  if p_purpose not in ('view','export') then raise exception 'PRET-ACC-PURPOSE' using errcode = '22023'; end if;
  select b.batch_no into v_no from app.disbursement_batches b where b.id = p_batch_id;
  if v_no is null then raise exception 'PRET-ACC-404' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct m.employee_id), '{}') into v_ids from app.disbursement_batch_claims m where m.batch_id = p_batch_id and m.removed_at is null;
  perform audit.write_access(case when p_purpose = 'view' then 'reveal' else 'export' end::app.audit_action, 'disbursement_batch', p_batch_id, v_ids,
    array['account_no'], array['bank']::app.data_category[],
    case when p_purpose = 'view' then 'HLB payment list viewed (C12)' else 'HLB payment list generation' end, v_no, cardinality(v_ids), null, null);
  return query
    with ba as (
      select distinct on (a.employee_id) a.*
        from app.employee_bank_accounts a where a.employee_id = any(v_ids) and a.effective_from <= app.today_myt()
       order by a.employee_id, a.effective_from desc, a.created_at desc)
    select e.id, e.employee_no, e.full_name, ba.id, ba.account_no_enc
      from app.employees e join ba on ba.employee_id = e.id
     where ba.payment_method = 'bank_transfer' and ba.account_no_enc is not null;
end $$;
revoke execute on function app.payment_list_view(uuid, text) from public, anon, authenticated, service_role;
grant execute on function app.payment_list_view(uuid, text) to authenticated;

-- batch_payees no longer returns ciphertext (masked facts only); decryption goes through app.payment_list_view
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
           ba.payment_method, ba.id, bk.name, bk.code, bk.bic, null::bytea, ba.account_no_last4::text, ba.account_holder_name,
           (ba.payment_method = 'bank_transfer' and ba.bank_id is not null and ba.account_no_enc is not null and ba.account_holder_name is not null),
           exists (select 1 from app.disbursement_batches b where b.id = p_batch_id and b.exported_at is not null and ba.created_at > b.exported_at),
           e.status = 'separated'
      from m join app.employees e on e.id = m.employee_id
      left join ba on ba.employee_id = e.id left join app.banks bk on bk.id = ba.bank_id
     order by e.full_name, e.employee_no;
end $$;
