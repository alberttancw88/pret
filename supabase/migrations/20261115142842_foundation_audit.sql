-- PRET W2-001 Foundation · 04 — audit schema (append-only), audit trigger, access log writer, seals
-- Design: data-model.md §12; rls-policies.md §5.7, §10; ADR-0008.
-- Ownership: tables → audit_owner; writer functions → audit_writer (SECURITY DEFINER).
-- No UPDATE/DELETE/TRUNCATE privilege for any login role (service_role included).

create table audit.audit_log (                                                        -- AU1–AU10
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid, actor_user_type app.user_type, actor_roles text[] not null default '{}', actor_label text,
  on_behalf_employee_id uuid,
  action app.audit_action not null,
  entity_type text not null, entity_id uuid, entity_ref text,
  employee_id uuid,
  changes jsonb,
  reason text,
  ip inet, user_agent text, request_id uuid,
  data_categories app.data_category[] not null default '{}',
  txid bigint not null default txid_current()
);
create index ix_audit_log_occurred on audit.audit_log (occurred_at);
create index ix_audit_log_employee on audit.audit_log (employee_id, occurred_at);
create index ix_audit_log_actor on audit.audit_log (actor_user_id, occurred_at);
create index ix_audit_log_entity on audit.audit_log (entity_type, entity_id);

create table audit.access_log (                                                       -- BR-ADM-21/22
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_user_id uuid not null, actor_user_type app.user_type not null, actor_roles text[] not null,
  action app.audit_action not null check (action in ('view_sensitive','reveal','download','export','import','record_open')),
  entity_type text not null, entity_id uuid, entity_ref text,
  employee_ids uuid[] not null default '{}',
  fields text[] not null default '{}', data_categories app.data_category[] not null default '{}',
  record_count int, reason text, file_id uuid, export_file_id uuid,
  ip inet, user_agent text, request_id uuid
);
create index ix_access_log_occurred on audit.access_log (occurred_at);
create index ix_access_log_actor on audit.access_log (actor_user_id, occurred_at);
create index ix_access_log_employees on audit.access_log using gin (employee_ids);

create table audit.daily_seals (                                                      -- tamper evidence
  seal_date date not null, table_name text not null check (table_name in ('audit_log','access_log')),
  first_id bigint, last_id bigint, row_count bigint not null, digest bytea not null, prev_digest bytea,
  sealed_at timestamptz not null default now(), primary key (seal_date, table_name)
);

alter table audit.audit_log   enable row level security;
alter table audit.audit_log   force  row level security;
alter table audit.access_log  enable row level security;
alter table audit.access_log  force  row level security;
alter table audit.daily_seals enable row level security;
alter table audit.daily_seals force  row level security;

revoke all on all tables in schema audit from public, anon, authenticated, service_role;
grant select on audit.audit_log, audit.access_log, audit.daily_seals to authenticated;     -- RLS: SA only
grant select, insert on audit.audit_log, audit.access_log, audit.daily_seals to audit_writer;
grant usage on all sequences in schema audit to audit_writer;

-- SA read (P-SA)
create policy audit_log_select_sa   on audit.audit_log   for select to authenticated using ((select app.is_sa()));
create policy access_log_select_sa  on audit.access_log  for select to authenticated using ((select app.is_sa()));
create policy daily_seals_select_sa on audit.daily_seals for select to authenticated using ((select app.is_sa()));
-- Writer role (owner of the definer functions below): insert + read (for sealing) only
create policy audit_log_writer_insert   on audit.audit_log   for insert to audit_writer with check (true);
create policy audit_log_writer_select   on audit.audit_log   for select to audit_writer using (true);
create policy access_log_writer_insert  on audit.access_log  for insert to audit_writer with check (true);
create policy access_log_writer_select  on audit.access_log  for select to audit_writer using (true);
create policy daily_seals_writer_insert on audit.daily_seals for insert to audit_writer with check (true);
create policy daily_seals_writer_select on audit.daily_seals for select to audit_writer using (true);
-- Owner: retention purge only (audit.purge_expired)
create policy audit_log_owner_select  on audit.audit_log  for select to audit_owner using (true);
create policy audit_log_owner_insert  on audit.audit_log  for insert to audit_owner with check (true);
create policy audit_log_owner_delete  on audit.audit_log  for delete to audit_owner using (occurred_at < now() - interval '7 years');
create policy access_log_owner_select on audit.access_log for select to audit_owner using (true);
create policy access_log_owner_delete on audit.access_log for delete to audit_owner using (occurred_at < now() - interval '7 years');

-- Defence in depth: UPDATE never; DELETE only by audit_owner (retention); TRUNCATE never.
create or replace function audit.tg_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_user = 'audit_owner' then
    return old;
  end if;
  raise exception 'PRET-AUDIT-APPEND-ONLY: % on audit.% is not allowed', tg_op, tg_table_name using errcode = '42501';
end $$;
create trigger tg_append_only before update or delete on audit.audit_log  for each row execute function audit.tg_append_only();
create trigger tg_append_only before update or delete on audit.access_log for each row execute function audit.tg_append_only();
create trigger tg_append_only before update or delete on audit.daily_seals for each row execute function audit.tg_append_only();
create trigger tg_no_truncate before truncate on audit.audit_log   for each statement execute function audit.tg_append_only();
create trigger tg_no_truncate before truncate on audit.access_log  for each statement execute function audit.tg_append_only();
create trigger tg_no_truncate before truncate on audit.daily_seals for each statement execute function audit.tg_append_only();

-- ---------------------------------------------------------------------------
-- Request-context readers (values set by withUserTx via set_config; never trusted for authorisation)
-- ---------------------------------------------------------------------------
create or replace function audit.ctx_text(p_key text) returns text
language sql stable set search_path = '' as $$ select nullif(current_setting(p_key, true), '') $$;

create or replace function audit.ctx_inet(p_key text) returns inet
language plpgsql stable set search_path = '' as $$
begin
  return nullif(current_setting(p_key, true), '')::inet;
exception when others then return null;
end $$;

create or replace function audit.ctx_uuid(p_key text) returns uuid
language plpgsql stable set search_path = '' as $$
begin
  return nullif(current_setting(p_key, true), '')::uuid;
exception when others then return null;
end $$;

-- ---------------------------------------------------------------------------
-- Generic data-change trigger (F-ADM-09). Trigger args: [0] data categories csv, [1] ref column.
-- ---------------------------------------------------------------------------
create or replace function audit.tg_log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_ignore text[] := array['updated_at','updated_by','version','created_at','created_by','last_login_at','failed_login_count'];
  v_redact text[] := array['token_hash'];
  v_key text;
  v_action app.audit_action;
  v_actor uuid := app.current_app_user_id();
  v_cats app.data_category[] := '{}';
  v_ref text;
  v_emp text;
  v_id text;
begin
  v_row := coalesce(v_new, v_old);
  for v_key in select jsonb_object_keys(v_row) loop
    continue when v_key = any(v_ignore);
    if tg_op = 'UPDATE' and (v_old -> v_key) is not distinct from (v_new -> v_key) then continue; end if;
    if tg_op = 'INSERT' and jsonb_typeof(v_new -> v_key) = 'null' then continue; end if;
    if tg_op = 'DELETE' and jsonb_typeof(v_old -> v_key) = 'null' then continue; end if;
    v_changes := v_changes || jsonb_build_object(v_key,
                   case when v_key = any(v_redact) then to_jsonb(array['[redacted]'])
                        else jsonb_build_array(v_old -> v_key, v_new -> v_key) end);
  end loop;
  if tg_op = 'UPDATE' and v_changes = '{}'::jsonb then
    return null;
  end if;

  v_action := case tg_op
                when 'INSERT' then 'create'
                when 'DELETE' then 'delete_draft'
                else case when v_old ? 'status' and (v_old -> 'status') is distinct from (v_new -> 'status')
                          then 'status_change' else 'update' end
              end::app.audit_action;
  if tg_nargs > 0 and coalesce(tg_argv[0], '') <> '' then
    v_cats := string_to_array(tg_argv[0], ',')::app.data_category[];
  end if;
  if tg_nargs > 1 and coalesce(tg_argv[1], '') <> '' then
    v_ref := v_row ->> tg_argv[1];
  end if;
  v_id  := v_row ->> 'id';
  v_emp := coalesce(v_row ->> 'employee_id', v_row ->> 'owner_employee_id');

  insert into audit.audit_log (actor_user_id, actor_user_type, actor_roles, actor_label, on_behalf_employee_id,
                               action, entity_type, entity_id, entity_ref, employee_id, changes, reason,
                               ip, user_agent, request_id, data_categories)
  values (v_actor,
          case when v_actor is not null then app.current_user_type() end,
          case when v_actor is not null then app.current_role_codes() else '{}'::text[] end,
          coalesce(audit.ctx_text('app.actor_label'), case when v_actor is null then 'system' end),
          audit.ctx_uuid('app.on_behalf_employee_id'),
          v_action, tg_table_name,
          case when v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_id::uuid end,
          v_ref,
          case when v_emp ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_emp::uuid end,
          v_changes,
          audit.ctx_text('app.reason'),
          audit.ctx_inet('app.client_ip'), left(audit.ctx_text('app.user_agent'), 500), audit.ctx_uuid('app.request_id'),
          v_cats);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Access log writer (server-side events: reveals, exports, record opens — actor from session).
-- ---------------------------------------------------------------------------
create or replace function audit.write_access(p_action app.audit_action, p_entity_type text, p_entity_id uuid,
                                              p_employee_ids uuid[], p_fields text[], p_categories app.data_category[],
                                              p_reason text default null, p_entity_ref text default null,
                                              p_record_count int default null, p_file_id uuid default null,
                                              p_export_file_id uuid default null)
returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.current_app_user_id();
  v_id bigint;
begin
  if v_actor is null then
    raise exception 'PRET-ACC-401' using errcode = '42501';
  end if;
  insert into audit.access_log (actor_user_id, actor_user_type, actor_roles, action, entity_type, entity_id, entity_ref,
                                employee_ids, fields, data_categories, record_count, reason, file_id, export_file_id,
                                ip, user_agent, request_id)
  values (v_actor, app.current_user_type(), app.current_role_codes(), p_action, p_entity_type, p_entity_id, p_entity_ref,
          coalesce(array_remove(p_employee_ids, null), '{}'), coalesce(p_fields, '{}'), coalesce(p_categories, '{}'),
          p_record_count, coalesce(p_reason, audit.ctx_text('app.reason')), p_file_id, p_export_file_id,
          audit.ctx_inet('app.client_ip'), left(audit.ctx_text('app.user_agent'), 500), audit.ctx_uuid('app.request_id'))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Daily seal (ADR-0008): SHA-256 chain over one MYT day's rows per log table. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function audit.seal_day(p_date date) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_from timestamptz := (p_date::timestamp at time zone 'Asia/Kuala_Lumpur');
  v_to   timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur');
  v_prev bytea; v_first bigint; v_last bigint; v_count bigint; v_body text;
begin
  if exists (select 1 from audit.daily_seals s where s.seal_date = p_date and s.table_name = 'audit_log') then
    null;
  else
    select s.digest into v_prev from audit.daily_seals s where s.table_name = 'audit_log' and s.seal_date < p_date order by s.seal_date desc limit 1;
    select min(a.id), max(a.id), count(*), coalesce(string_agg(row_to_json(a)::text, E'\n' order by a.id), '')
      into v_first, v_last, v_count, v_body
      from audit.audit_log a where a.occurred_at >= v_from and a.occurred_at < v_to;
    insert into audit.daily_seals (seal_date, table_name, first_id, last_id, row_count, digest, prev_digest)
    values (p_date, 'audit_log', v_first, v_last, v_count,
            extensions.digest(coalesce(v_prev, ''::bytea) || convert_to(v_body, 'UTF8'), 'sha256'), v_prev);
  end if;

  if not exists (select 1 from audit.daily_seals s where s.seal_date = p_date and s.table_name = 'access_log') then
    select s.digest into v_prev from audit.daily_seals s where s.table_name = 'access_log' and s.seal_date < p_date order by s.seal_date desc limit 1;
    select min(a.id), max(a.id), count(*), coalesce(string_agg(row_to_json(a)::text, E'\n' order by a.id), '')
      into v_first, v_last, v_count, v_body
      from audit.access_log a where a.occurred_at >= v_from and a.occurred_at < v_to;
    insert into audit.daily_seals (seal_date, table_name, first_id, last_id, row_count, digest, prev_digest)
    values (p_date, 'access_log', v_first, v_last, v_count,
            extensions.digest(coalesce(v_prev, ''::bytea) || convert_to(v_body, 'UTF8'), 'sha256'), v_prev);
  end if;
end $$;

-- Retention purge (> retention years) — the only deletion path; logs itself.
create or replace function audit.purge_expired(p_years int default 7) returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare v_cut timestamptz; v_a bigint; v_b bigint;
begin
  if p_years < 7 then
    raise exception 'PRET-AUDIT-RETENTION: minimum 7 years' using errcode = '22023';
  end if;
  v_cut := now() - make_interval(years => p_years);
  delete from audit.audit_log a where a.occurred_at < v_cut;
  get diagnostics v_a = row_count;
  delete from audit.access_log a where a.occurred_at < v_cut;
  get diagnostics v_b = row_count;
  insert into audit.audit_log (actor_label, action, entity_type, changes)
  values ('system:retention', 'config_change', 'audit_purge',
          jsonb_build_object('cutoff', v_cut, 'audit_log_rows', v_a, 'access_log_rows', v_b));
  return v_a + v_b;
end $$;


revoke execute on all functions in schema audit from public, anon, authenticated, service_role;
-- helpers the writer functions call
grant execute on function app.current_app_user_id(), app.current_user_type(), app.current_role_codes(),
                          app.today_myt(), app.holds_role(app.privileged_role), app.is_manager(),
                          app.current_employee_id()
  to audit_writer;
grant execute on function audit.ctx_text(text), audit.ctx_inet(text), audit.ctx_uuid(text) to audit_writer, audit_owner;
-- callers
grant execute on function audit.write_access(app.audit_action, text, uuid, uuid[], text[], app.data_category[], text, text, int, uuid, uuid)
  to authenticated, postgres;
grant execute on function audit.seal_day(date) to service_role;
grant execute on function audit.purge_expired(int) to service_role;

-- Ownership last (policies, triggers and grants above need the creating owner). Grants made by
-- postgres move to audit_owner; postgres keeps no privileges on the audit tables.
grant create on schema audit to audit_writer;          -- needed only while ownership is transferred
alter table audit.audit_log   owner to audit_owner;
alter table audit.access_log  owner to audit_owner;
alter table audit.daily_seals owner to audit_owner;
alter function audit.tg_log_change() owner to audit_writer;
alter function audit.write_access(app.audit_action, text, uuid, uuid[], text[], app.data_category[], text, text, int, uuid, uuid) owner to audit_writer;
alter function audit.seal_day(date) owner to audit_writer;
alter function audit.purge_expired(int) owner to audit_owner;
revoke create on schema audit from audit_writer;
