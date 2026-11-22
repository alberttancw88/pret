-- PRET W2-005 · 06 — P15 status timeline: the batch a claim is in (batch no., status, planned payment date) for the claimant
-- and ADM/SA only (batches themselves stay ADM/SA — rls §5.6; managers never see batch data).
create or replace function app.claim_batch_info(p_claim_id uuid)
returns table (batch_id uuid, batch_no text, status app.batch_status, planned_payment_date date)
language sql stable security definer set search_path = '' as $$
  select b.id, b.batch_no, b.status, b.planned_payment_date
    from app.claims c join app.disbursement_batches b on b.id = c.disbursement_batch_id
   where c.id = p_claim_id and (app.is_self(c.employee_id) or app.is_admin())
$$;
revoke execute on function app.claim_batch_info(uuid) from public, anon, authenticated, service_role;
grant execute on function app.claim_batch_info(uuid) to authenticated;
