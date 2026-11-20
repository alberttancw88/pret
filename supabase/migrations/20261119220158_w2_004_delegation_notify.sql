-- PRET W2-004 · 08 — N-17 "delegation set / ended" (F-LV-24) written by the database when a delegation row is inserted or
-- cancelled (users have no execute on app.notify). In-app + email to the delegate; in-app to the delegator when set by an Admin.
create or replace function app.tg_delegation_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform app.notify(new.delegate_user_id, 'N-17', left('You are the approval delegate of ' || coalesce(app.user_name(new.delegator_user_id), 'an approver'), 150),
      to_char(new.valid_from, 'DD/MM/YYYY') || ' – ' || to_char(new.valid_to, 'DD/MM/YYYY') || ' · ' || initcap(new.scope::text),
      '/approvals', false, 'delegation_changed',
      jsonb_build_object('change', 'set', 'from', to_char(new.valid_from, 'DD/MM/YYYY'), 'to', to_char(new.valid_to, 'DD/MM/YYYY'), 'scope', new.scope));
    if new.set_by is distinct from new.delegator_user_id then
      perform app.notify(new.delegator_user_id, 'N-17', left('HR set ' || coalesce(app.user_name(new.delegate_user_id), 'a delegate') || ' as your approval delegate', 150),
        to_char(new.valid_from, 'DD/MM/YYYY') || ' – ' || to_char(new.valid_to, 'DD/MM/YYYY'), '/account', false, null, null);
    end if;
  elsif new.cancelled_at is not null and old.cancelled_at is null then
    perform app.notify(new.delegate_user_id, 'N-17', left('Delegation for ' || coalesce(app.user_name(new.delegator_user_id), 'an approver') || ' has ended', 150),
      null, '/approvals', false, 'delegation_changed', jsonb_build_object('change', 'ended'));
  end if;
  return null;
end $$;
revoke execute on function app.tg_delegation_notify() from public, anon, authenticated, service_role;
create trigger tg_notify after insert or update of cancelled_at on app.delegations for each row execute function app.tg_delegation_notify();
