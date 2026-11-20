-- PRET W2-004 · 07 — delegate / approver picker for G6 (MGR) and L14 (ADM/SA). Managers cannot read app_users (rls §5.2), so the
-- picker is a definer function returning directory-level facts only (name, employee no., position, holds a privileged role) for
-- ACTIVE employee users — never external users (BR-ADM-04), never the caller. Callable by managers / delegates and ADM/SA.
create or replace function app.approver_options(p_q text, p_limit int)
returns table (user_id uuid, employee_id uuid, employee_no text, name text, position_title text, is_admin boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, e.id, e.employee_no,
         case when e.preferred_name is null then e.full_name else e.full_name || ' (' || e.preferred_name || ')' end,
         p.title,
         exists (select 1 from app.user_roles r where r.user_id = u.id and r.revoked_at is null)
    from app.app_users u join app.employees e on e.id = u.employee_id join app.positions p on p.id = e.position_id
   where u.user_type = 'employee' and u.status = 'active' and e.status in ('on_probation','confirmed','notice_period')
     and u.id is distinct from app.current_app_user_id()
     and (app.is_admin() or app.is_manager())
     and (nullif(btrim(p_q), '') is null or e.full_name ilike '%' || btrim(p_q) || '%' or e.preferred_name ilike '%' || btrim(p_q) || '%'
          or e.employee_no ilike '%' || btrim(p_q) || '%')
   order by e.full_name
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;
revoke execute on function app.approver_options(text, int) from public, anon, authenticated, service_role;
grant execute on function app.approver_options(text, int) to authenticated;
