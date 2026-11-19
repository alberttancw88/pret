-- PRET W2-003 · 07 — special-category values in change-request audit rows (BR-ADM-21, FR-G-10).
-- * change_request_items audit rows are tagged with every category a CR can carry, so the SA audit viewer
--   (W2-002) masks them and reveals only through its logged REVEAL.
-- * audit.employee_trail (ADM/SA activity log) masks the requested / current values of CR items; the values are
--   shown on the CR review screen, whose religion / OKU view is access-logged by the server.
drop trigger if exists tg_audit on app.change_request_items;
create trigger tg_audit after insert or update or delete on app.change_request_items
  for each row execute function audit.tg_log_change('identity,family,religion,health,bank,statutory');

grant create on schema audit to audit_writer;          -- needed only while the owner replaces the function
set role audit_writer;
create or replace function audit.employee_trail(p_employee_id uuid, p_from date, p_to date)
returns table (source text, id bigint, occurred_at timestamptz, actor_user_id uuid, actor_label text, action app.audit_action,
               entity_type text, entity_id uuid, entity_ref text, changes jsonb, reason text, on_behalf boolean,
               data_categories app.data_category[], fields text[], record_count int)
language sql stable security definer set search_path = '' as $$
  select * from (
    select 'audit'::text, a.id, a.occurred_at, a.actor_user_id, a.actor_label, a.action, a.entity_type, a.entity_id, a.entity_ref,
           (select jsonb_object_agg(j.k, case
                     when j.k ~ '(_enc|_bidx)$' then '["[encrypted]","[encrypted]"]'::jsonb
                     when j.k in ('religion','is_oku','oku_card_no') then '["[sensitive]","[sensitive]"]'::jsonb
                     when a.entity_type = 'change_request_items' and j.k in ('new_value','current_display') then '["[masked]","[masked]"]'::jsonb
                     else j.v end)
              from jsonb_each(coalesce(a.changes, '{}'::jsonb)) as j(k, v)),
           a.reason, a.on_behalf_employee_id is not null, a.data_categories, '{}'::text[], null::int
      from audit.audit_log a
     where (a.employee_id = p_employee_id or (a.entity_type = 'employees' and a.entity_id = p_employee_id))
       and a.occurred_at >= coalesce(p_from, date '2000-01-01')::timestamp at time zone 'Asia/Kuala_Lumpur'
       and a.occurred_at <  (coalesce(p_to, date '2999-12-31') + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
    union all
    select 'access'::text, x.id, x.occurred_at, x.actor_user_id, null, x.action, x.entity_type, x.entity_id, x.entity_ref,
           null::jsonb, x.reason, false, x.data_categories, x.fields, x.record_count
      from audit.access_log x
     where p_employee_id = any(x.employee_ids)
       and x.occurred_at >= coalesce(p_from, date '2000-01-01')::timestamp at time zone 'Asia/Kuala_Lumpur'
       and x.occurred_at <  (coalesce(p_to, date '2999-12-31') + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'
  ) t
  where app.is_admin()
  order by t.occurred_at desc, t.id desc
  limit 5000
$$;
reset role;
revoke create on schema audit from audit_writer;
