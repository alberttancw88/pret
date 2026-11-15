# PRET — Row-Level Security, Storage Policies and Access Enforcement

**Work item:** W1-003 · **Author:** Solution Architect · **Status:** Proposed for GATE 2 (Design)
**Last updated:** 15/11/2026
**Implements:** PRD §16 role × function matrix, §3 role restrictions, FR-G-02, FR-G-10/11, FR-G-16, BR-ADM-20–22; D11, D12, D15
**Companions:** [`data-model.md`](data-model.md) (tables and access tiers) · [`system-design.md`](system-design.md) · ADR-0001, ADR-0002, ADR-0003, ADR-0004, ADR-0007, ADR-0008

> **Lesson carried from Direct Order:** a hidden nav item is not access control, and an
> RLS policy that reads correctly in isolation can still be bypassed through a
> `SECURITY DEFINER` function that trusts its inputs (Direct Order SEC-01, migrations
> 0019/0026/0028). Every rule in this document is enforced **in the database**, every
> definer function **re-checks its caller**, and every policy has an automated test (§12).

---

## 1. Principles

1. **Deny by default.** Every table in `app` and `audit` has `enable row level security` **and** `force row level security`. No policy = no access.
2. **One policy per command.** Separate `select / insert / update / delete` policies (no `for all`), each `to authenticated`. `anon` has no grants on any PRET schema.
3. **`WITH CHECK` on every insert and update** — a user can never write a row they could not read, and never re-label a row into someone else's scope.
4. **Helpers, not inline joins.** Policies call the helper functions in §3 wrapped as `(select app.fn())` where the argument is constant (initplan, evaluated once per statement), or `app.fn(col)` where it depends on the row.
5. **Authorisation is looked up live**, not from JWT custom claims: a disabled user, an expired external user, a revoked role or a changed reporting line takes effect on the **next statement** (BR-ADM-06 "within 5 minutes" is met immediately). The JWT supplies only `sub` (→ `auth.uid()`) and `aal` (MFA level). (ADR-0001)
6. **No Data API.** The Supabase Data API exposes no PRET schema; the Next.js server connects to Postgres directly and impersonates the signed-in user (§2). RLS is therefore the backstop beneath the server's own checks — **both** must agree (defence in depth, FR-G-02).
7. **Self-approval is impossible by construction** (§7) and **managers have no policy at all** on T2/T3/T4 tables (§8).
8. **Definer functions are few, listed (§10), pinned (`set search_path = ''`, fully-qualified names), revoked from `public`/`anon`, and re-check the caller.** Parameters are prefixed `p_` so they can never collide with column names (Direct Order migration 0026 bug class).

---

## 2. Database roles and the request context

| Role | Login | Used by | Privileges |
|------|-------|---------|------------|
| `pret_app` | yes (Supavisor, transaction mode) | Next.js server, interactive requests | `NOINHERIT`; member of `authenticated`; **no table privileges of its own** — must `set local role authenticated` inside each transaction to touch data. |
| `authenticated` | no | impersonated per transaction | `usage` on `app`; table grants per §11; **all access filtered by RLS**. |
| `pret_jobs` | yes | scheduled jobs and outbox/export workers (Next.js route handlers) | member of `service_role` (BYPASSRLS) for cross-employee system work; every job sets `app.actor_label = 'system:<job>'` for the audit log. Never used for an interactive user request. |
| `audit_writer` | no | owner of audit insert functions | `insert` on `audit.*` only. |
| `audit_owner` | no | owner of `audit` schema | used only by `audit.purge_expired()` (retention) and migrations. |
| `anon` | — | — | **no** usage on `app`, `audit`, `private`. |

**Per-request transaction** (the only way server code may obtain a database handle — `withUserTx()`, ADR-0002):

```sql
begin;
  set local role authenticated;
  select set_config('request.jwt.claims', $1::text, true),   -- claims verified by the server (Supabase Auth JWKS) — never client-supplied text
         set_config('app.request_id',     $2, true),
         set_config('app.client_ip',      $3, true),
         set_config('app.user_agent',     $4, true),
         set_config('app.reason',         $5, true),         -- optional: reason for reveal/override/adjustment (AU8)
         set_config('app.on_behalf_employee_id', $6, true);  -- optional: FR-G-17
  -- … business statements (RLS active; auth.uid() and auth.jwt() read request.jwt.claims) …
commit;
```

---

## 3. Helper functions

All helpers: `language sql stable security definer set search_path = ''`, owned by `postgres`
(table owner, so they can read `app_users` / `user_roles` / `reporting_closure` without
recursing into those tables' own RLS), `revoke execute … from public, anon`,
`grant execute … to authenticated`. They take **no user-id parameter** — they only ever
answer questions about the caller (`auth.uid()`), so they cannot be used to impersonate.

```sql
create function app.today_myt() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date
$$;

-- The caller's app_users.id — NULL if not active or outside the access window (F-ADM-04/06, BR-ADM-05).
create function app.current_app_user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id
    from app.app_users u
   where u.auth_user_id = auth.uid()
     and u.status = 'active'
     and u.access_start_date <= app.today_myt()
     and (u.access_end_date is null or u.access_end_date >= app.today_myt())
$$;

-- The caller's employee — NULL for external administrators (they never hold EMP/MGR — D11, BR-ADM-04).
create function app.current_employee_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.employee_id from app.app_users u
   where u.id = app.current_app_user_id() and u.user_type = 'employee'
$$;

create function app.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.current_app_user_id() is not null
$$;

-- Privileged roles require MFA (aal2) when the SA control setting is on (F-ADM-07, Q31).
create function app.has_role(p_role app.privileged_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.user_roles r
                  where r.user_id = app.current_app_user_id() and r.role = p_role and r.revoked_at is null)
     and (   not coalesce((select s.mfa_required_privileged from app.security_settings s where s.id = 1), true)
          or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
$$;
create function app.is_admin() returns boolean language sql stable security definer set search_path = '' as $$ select app.has_role('ADM') or app.has_role('SA') $$;
create function app.is_sa()    returns boolean language sql stable security definer set search_path = '' as $$ select app.has_role('SA') $$;

-- MGR is derived (D11): direct + indirect reportees from the closure table (rebuilt on every reporting-line change).
create function app.is_manager_of(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.reporting_closure c
                  where c.manager_employee_id = app.current_employee_id()
                    and c.employee_id = p_employee_id)
$$;

-- The caller currently holds (or delegates for) an open approval task about this employee —
-- gives an override approver / delegate exactly the T1 context needed to decide (F15/F16, BR-LV-60).
create function app.is_current_approver_for(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app.approval_tasks t
                  where t.subject_employee_id = p_employee_id
                    and t.status = 'open'
                    and app.current_app_user_id() in (t.assignee_user_id, t.original_assignee_user_id))
$$;

create function app.is_self(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select p_employee_id = app.current_employee_id() $$;

-- T1 row visibility used by every team-scoped table.
create function app.can_see_team_row(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_self(p_employee_id) or app.is_admin()
      or app.is_manager_of(p_employee_id) or app.is_current_approver_for(p_employee_id)
$$;

-- Approver eligibility for one task (ADR-0004). Used by app.decide_task() and by file rules.
create function app.can_act_on_task(p_task_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.approval_tasks t
     where t.id = p_task_id
       and t.status = 'open'
       and t.subject_employee_id is distinct from app.current_employee_id()            -- FR-G-16
       and t.subject_prepared_by is distinct from app.current_app_user_id()            -- approver ≠ preparer
       and (
             (t.source = 'admin_pool'       and app.is_admin())
          or (t.source = 'super_admin_pool' and app.is_sa())
          or (t.source = 'claim_pool'       and (app.is_admin()                        -- D12: Manager or ADM or SA
                                                 or app.current_app_user_id() in (t.assignee_user_id, t.original_assignee_user_id)
                                                 or exists (select 1 from app.delegations d
                                                             where d.delegator_user_id = t.assignee_user_id
                                                               and d.delegate_user_id = app.current_app_user_id()
                                                               and d.scope in ('claims','both') and d.cancelled_at is null
                                                               and app.today_myt() between d.valid_from and d.valid_to)))
          or (t.source in ('direct_manager','leave_approver_override','managers_manager','specific_employee')
              and (app.current_app_user_id() in (t.assignee_user_id, t.original_assignee_user_id)
                   or exists (select 1 from app.delegations d
                               where d.delegator_user_id = t.assignee_user_id
                                 and d.delegate_user_id = app.current_app_user_id()
                                 and d.scope in ('leave','both') and d.cancelled_at is null
                                 and app.today_myt() between d.valid_from and d.valid_to)
                   or app.has_role('ADM')))                                             -- BR-LV-62 admin override (reason required by decide_task)
       ))
$$;
```

---

## 4. Policy patterns

| Code | Meaning | `USING` / `WITH CHECK` |
|------|---------|------------------------|
| **P-ACTIVE** | any active user (config/reference data, directory) | `(select app.is_active_user())` |
| **P-SELF** | the employee's own row | `app.is_self(employee_id)` |
| **P-TEAM** | self · manager (direct + indirect) · current approver · ADM/SA | `app.can_see_team_row(employee_id)` |
| **P-HR** | ADM or SA | `(select app.is_admin())` |
| **P-SA** | SA only | `(select app.is_sa())` |
| **P-HR-NOT-OWN** | ADM/SA acting on someone else's record (FR-G-16) | `(select app.is_admin()) and employee_id is distinct from (select app.current_employee_id())` |
| **P-DEFINER** | no direct policy; reachable only through a listed definer function (§10) | — |

---

## 5. Policy register (every table)

`S` select · `I` insert · `U` update · `D` delete. "—" = no policy (denied). Writes that a
trigger or definer function performs on the user's behalf are marked *(fn)*.

### 5.1 Organisation, settings, reference

| Table | S | I | U | D |
|-------|---|---|---|---|
| `company_profile` | P-ACTIVE | — (seeded) | P-HR (+ SA-only column guard: legal name, logo) | — |
| `company_statutory`, `company_zakat_registrations`, `company_signatories` | P-HR | P-SA | P-SA | — |
| `gl_mappings` | P-HR | P-HR | P-HR | — |
| `banks`, `lhdn_branches`, `zakat_bodies` | P-ACTIVE | P-HR | P-HR | — |
| `departments`, `positions`, `grades`, `cost_centres`, `work_locations`, `working_patterns`, `working_pattern_versions` | P-ACTIVE | P-HR | P-HR | — |
| `employee_groups` | P-HR | P-HR | P-HR | — |
| `holiday_calendar_years`, `public_holidays`, `public_holiday_states`, `replacement_holidays` | P-ACTIVE where published (BR-ORG-25); P-HR all | P-HR | P-HR | P-HR on draft rows only |
| `security_settings` | P-HR (read-only for ADM — §9.5) | — (seeded) | P-SA | — |
| `leave_policy`, `claim_policy` | P-ACTIVE | — | P-HR | — |
| `statutory_leave_minimums` | P-ACTIVE | — (seed) | — | — |
| `statutory_floor_overrides` | P-HR | P-SA | — | — |

### 5.2 Users and access

| Table | S | I | U | D |
|-------|---|---|---|---|
| `app_users` | own row · P-SA all · ADM: employee users holding no privileged role (BR-ADM-01) | P-SA any; ADM: `user_type = 'employee'` only | P-SA (not own status/roles — BR-ADM-03); ADM: employee users without privileged roles, not self | — |
| `user_roles` | own rows · P-SA | P-SA with `granted_by = me` (CHECK `granted_by <> user_id`) | P-SA (revoke only) | — |
| `user_invitations` | P-HR (metadata, never token) | *(fn)* `app.create_invitation()` | *(fn)* | — |
| `app_sessions` | own · P-SA | *(server, pret_jobs)* | *(server)* | — |
| `login_events` | P-SA | *(server, pret_jobs)* | — | — |
| `delegations` | delegator · delegate · P-HR | delegator = me, or P-HR on behalf (`set_by = me`) | delegator or P-HR (cancel only) | — |

### 5.3 Employee master

| Table | Tier | S | I | U | D |
|-------|------|---|---|---|---|
| `employees` | T1 | P-TEAM | P-HR | P-HR **or** P-SELF (self-edit guard: E✎ columns only) | — |
| `employee_directory` | T0 | P-ACTIVE and `is_listed` · P-HR all | *(trigger)* | *(trigger)* | — |
| `employee_personal` | T2 | P-SELF · P-HR | P-HR | P-SELF (E✎ only) · P-HR (E→CR columns: not own — guard) | — |
| `employee_marital_history` | T2 | P-SELF · P-HR | P-HR-NOT-OWN (or CR apply *(fn)*) | — | — |
| `employee_sensitive` | **T4** | **P-SELF only** | P-DEFINER `app.write_employee_sensitive()` | P-DEFINER | — |
| `employee_hr_private`, `employee_group_members`, `employee_separation_details`, `employee_statutory_employer_flags`, `hr_notes`, `hr_note_revisions` | T3 | P-HR | P-HR | P-HR | — |
| `employee_emergency_contacts` | T1 | P-TEAM | P-SELF · P-HR | P-SELF · P-HR | P-SELF · P-HR (≥ 1 must remain: trigger) |
| `employee_spouses`, `employee_children` | T2 | P-SELF · P-HR | P-HR-NOT-OWN | P-HR-NOT-OWN | — |
| `employee_job_history` | T1 | P-TEAM | P-HR | P-HR (past rows: `data_correction` only) | — (soft delete future rows) |
| `reporting_closure` | derived | P-DEFINER (read by helpers only) | *(fn)* | *(fn)* | *(fn)* |
| `probation_recommendations` | T1 | P-TEAM | `app.is_manager_of(employee_id)` · P-HR | — | — |
| `employee_separations` | T1 | P-TEAM | P-HR | P-HR | — |
| `employee_statutory_profiles` | T2 | P-SELF · P-HR | P-HR | P-HR-NOT-OWN | — |
| `employee_bank_accounts` | T2 | P-SELF · P-HR | P-HR-NOT-OWN with `verified_by = me` (D15 — no confirmation step) | — (insert-only; `is_superseded` *(trigger)*) | — |
| `employee_documents` | T2/T3 | P-HR · P-SELF where `visible_to_employee and is_active` | P-HR | P-HR | — |
| `prior_employments` | T2 | P-SELF · P-HR | P-SELF · P-HR | P-SELF · P-HR | P-SELF · P-HR |
| `change_requests`, `change_request_items`, `change_request_files` | T2 | P-SELF · P-HR | P-SELF (`status = 'submitted'`) | P-SELF (cancel only, trigger) · decisions *(fn)* `app.decide_task()` | — |

### 5.4 Leave

| Table | S | I | U | D |
|-------|---|---|---|---|
| `leave_types`, `leave_entitlement_bands`, `approval_workflows`, `approval_workflow_levels` | P-ACTIVE | P-HR | P-HR | — |
| `leave_entitlement_overrides` | P-SELF · P-HR | P-HR-NOT-OWN | P-HR-NOT-OWN | — |
| `leave_entitlements` | P-SELF · P-HR | *(engine, fn/jobs)* | *(engine)* | — |
| `leave_applications` | P-TEAM · past deciders | P-SELF (`on_behalf_by is null`) · P-HR (`on_behalf_by = me`) | P-SELF (withdraw / cancel / request cancellation — trigger) · P-HR · decisions *(fn)* | — |
| `leave_application_days`, `leave_application_files`, `leave_application_events` | P-TEAM | *(engine/trigger)* | *(trigger)* | — |
| `leave_ledger` | P-SELF · P-HR (**not MGR** — F-LV-28) | P-HR-NOT-OWN, `entry_type = 'adjustment'`, `created_by = me`; others *(trigger/jobs)* | — | — |
| `leave_balance_summary` | P-TEAM | *(trigger)* | *(trigger)* | — |
| `replacement_credits` | P-TEAM | P-SELF · P-HR (batch entry, not own) | P-SELF (withdraw) · P-HR · decisions *(fn)* | — |
| `replacement_credit_consumptions`, `employee_leave_counters`, `rollover_lines` | P-SELF · P-HR | *(fn/import)* | — | — |
| `rollover_runs` | P-HR | P-HR | P-HR | — |
| `team_calendar_entries` | per LP12 (§6.6) — see §6 | *(trigger)* | *(trigger)* | *(trigger)* |

### 5.5 Approvals

| Table | S | I | U | D |
|-------|---|---|---|---|
| `approval_tasks` | P-HR · assignee / original assignee / decider · subject employee (own trail) · `app.is_manager_of(subject_employee_id)` | P-DEFINER `app.route_approval()` | P-DEFINER `app.decide_task()` | — |

### 5.6 Claims

| Table | S | I | U | D |
|-------|---|---|---|---|
| `claim_categories`, `claim_category_grades`, `claim_category_rates` | P-ACTIVE | P-HR | P-HR | — |
| `claim_limits` | P-HR · P-ACTIVE where `applies_to <> 'employee' or employee_id = me` (F-CLM-20 "own limits") | P-HR | P-HR | — |
| `claims` | P-TEAM, **except `status = 'new'`: owner and on-behalf ADM only** (BR-CLM-27) | P-SELF (`on_behalf_by is null`) · P-HR (`on_behalf_by = me`, not own) | P-SELF while `new` (edit), submit, withdraw (trigger) · decisions/cancel *(fn)* · batch/disbursement P-HR | P-SELF where `status = 'new'` (FR-G-08) |
| `claim_lines`, `claim_line_files` | as parent claim | owner while claim `new` · P-HR on behalf | owner while `new` | owner while `new` |
| `claim_line_dependants` | T2: P-SELF · P-HR (never MGR) | owner while `new` | owner while `new` | owner while `new` |
| `claim_late_overrides` | P-HR · P-SELF | P-HR-NOT-OWN (`granted_by = me`) | — | — |
| `claim_events` | as parent claim | *(trigger)* | — | — |
| `disbursement_batches`, `disbursement_batch_events` | P-HR | P-HR (`prepared_by = me`) | P-HR (status machine trigger; SA approval *(fn)* when setting on) | — |

### 5.7 Files, outputs, notifications, privacy, imports, jobs

| Table | S | I | U | D |
|-------|---|---|---|---|
| `files` | `app.can_read_file(id)` · P-HR | upload intent: `created_by = me and app.can_upload_for(subject, owner_employee_id)` | P-DEFINER `app.confirm_upload()` | — (retention job) |
| `file_access_grants` | own · P-SA | `user_id = me and app.can_read_file(file_id) and expires_at <= now() + interval '5 minutes'` | — | — |
| `export_files` | `app.can_read_file(file_id)` | P-HR (generation in the ADM's session) · *(jobs)* | P-HR (supersede/out-of-date flags) | — |
| `export_layouts` | P-HR | P-SA | P-SA | — |
| `export_jobs` | own · P-HR | `requested_by = me and app.can_request_output(kind)` | *(jobs)* | — |
| `notifications` | own | *(fn/trigger/jobs)* | own (`read_at` only — trigger) | — |
| `email_outbox` | P-HR (notification log, F-NTF-07) | *(fn/trigger)* | *(jobs)* | — |
| `notification_preferences` | own | own | own | own |
| `notification_templates` | P-HR | P-SA | P-SA | — |
| `privacy_notices` | P-ACTIVE | P-HR | P-HR | — |
| `data_subject_requests` | P-HR (ADM read — §16 "R (DSR log)") | P-SA | P-SA | — |
| `incidents`, `anonymisation_requests` | P-SA | P-SA | P-SA | — |
| `import_jobs`, `import_rows`, `migration_control_totals` | P-HR | P-HR | P-HR | — |
| `migration_signoffs` | P-HR | P-SA | — | — |
| `job_runs` | P-SA | *(jobs)* | *(jobs)* | — |
| `audit.audit_log`, `audit.access_log`, `audit.daily_seals` | P-SA | *(audit_writer fn)* | — (no grant to any login role) | — (no grant) |
| `private.*` | — (no grants) | — | — | — |

### 5.8 Payroll (R1.1)

| Table | S | I | U | D |
|-------|---|---|---|---|
| `payroll_settings`, `pay_groups`, `pay_items`, `kk_element_mappings` | P-HR | P-HR | P-HR | — |
| `employee_compensation`, `employee_recurring_items` | P-SELF (CP1/CP5 own) · P-HR | P-HR-NOT-OWN (Q-ARCH-02 — applies to SA too) | — (insert-only) | — |
| `statutory_table_versions` + `stat_*` | P-HR | P-HR (`entered_by = me`) | P-HR on `draft` only; verify *(fn)* `decide_task` (SA, ≠ entered_by) | — |
| `payroll_runs`, `payroll_run_events`, `payroll_run_employees`, `payroll_variable_inputs`, `payroll_results`, `payroll_result_lines`, `salary_payment_lines`, `ytd_opening_balances`, `kk_payroll_results`, `reconciliation_*`, `cutover_signoffs` | P-HR | P-HR (signoffs: P-SA) | P-HR (status trigger; approve/return/re-open: SA *(fn)*) | — |
| `payroll_ytd` | P-SELF where `scope = 'live'` · P-HR | *(finalise fn)* | *(finalise fn)* | — |
| `payslips` | P-SELF where `status in ('published','viewed','revised')` · P-HR | *(finalise fn)* | own (`first_viewed_at`) · P-HR | — |
| `ea_forms` | P-SELF where `status = 'issued'` · P-HR | P-HR | P-HR | — |
| `tp1_declarations` | P-SELF · P-HR | P-SELF (Should) · P-HR | P-HR (verify, not own) | — |
| `tp3_records`, `cp38_orders` | P-SELF · P-HR | P-HR-NOT-OWN | P-HR-NOT-OWN | — |

**Nothing in M10 has a manager policy** (FR-PAY-11).

---

## 6. Key policies in SQL

```sql
-- employees (T1)
alter table app.employees enable row level security;
alter table app.employees force  row level security;
create policy employees_select on app.employees for select to authenticated
  using (app.can_see_team_row(id));
create policy employees_insert on app.employees for insert to authenticated
  with check ((select app.is_admin()));
create policy employees_update on app.employees for update to authenticated
  using      ((select app.is_admin()) or app.is_self(id))
  with check ((select app.is_admin()) or app.is_self(id));          -- app.tg_self_edit_guard restricts which columns a self-edit may change

-- employee_personal (T2) — never MGR
create policy personal_select on app.employee_personal for select to authenticated
  using (app.is_self(employee_id) or (select app.is_admin()));
create policy personal_update on app.employee_personal for update to authenticated
  using      (app.is_self(employee_id) or (select app.is_admin()))
  with check (app.is_self(employee_id) or (select app.is_admin()));

-- employee_sensitive (T4) — direct read by the employee only
create policy sensitive_select_self on app.employee_sensitive for select to authenticated
  using (app.is_self(employee_id));
-- (no insert/update/delete policies — writes and HR reads go through definer functions below)

-- employee_bank_accounts (T2) — ADM/SA insert for others only; insert-only history (D15, FR-EMP-11)
create policy bank_select on app.employee_bank_accounts for select to authenticated
  using (app.is_self(employee_id) or (select app.is_admin()));
create policy bank_insert on app.employee_bank_accounts for insert to authenticated
  with check ((select app.is_admin())
              and employee_id is distinct from (select app.current_employee_id())   -- not own (EC-EMP-10)
              and verified_by = (select app.current_app_user_id()));

-- leave_ledger — adjustments by HR for others only (FR-LV-11, FR-G-16)
create policy ledger_select on app.leave_ledger for select to authenticated
  using (app.is_self(employee_id) or (select app.is_admin()));
create policy ledger_insert_adjustment on app.leave_ledger for insert to authenticated
  with check ((select app.is_admin())
              and entry_type = 'adjustment'
              and employee_id is distinct from (select app.current_employee_id())
              and created_by = (select app.current_app_user_id()));

-- leave_applications (T1)
create policy leave_select on app.leave_applications for select to authenticated
  using (app.can_see_team_row(employee_id)
         or exists (select 1 from app.approval_tasks t
                     where t.leave_application_id = leave_applications.id
                       and t.decided_by = (select app.current_app_user_id())));
create policy leave_insert on app.leave_applications for insert to authenticated
  with check (   (app.is_self(employee_id) and on_behalf_by is null)
              or ((select app.is_admin()) and on_behalf_by = (select app.current_app_user_id())
                  and employee_id is distinct from (select app.current_employee_id())));
create policy leave_update on app.leave_applications for update to authenticated
  using      (app.is_self(employee_id) or (select app.is_admin()))
  with check (app.is_self(employee_id) or (select app.is_admin()));   -- app.tg_leave_transition enforces which transitions each actor may make

-- claims (T1, but New claims are private to the owner — BR-CLM-27)
create policy claims_select on app.claims for select to authenticated
  using (case when status = 'new'
              then app.is_self(employee_id) or ((select app.is_admin()) and on_behalf_by is not null)
              else app.can_see_team_row(employee_id) end);
create policy claims_insert on app.claims for insert to authenticated
  with check (   (app.is_self(employee_id) and on_behalf_by is null and status = 'new')
              or ((select app.is_admin()) and on_behalf_by = (select app.current_app_user_id())
                  and employee_id is distinct from (select app.current_employee_id())));
create policy claims_update on app.claims for update to authenticated
  using      (app.is_self(employee_id) or (select app.is_admin()))
  with check (app.is_self(employee_id) or (select app.is_admin()));
create policy claims_delete_new on app.claims for delete to authenticated
  using (app.is_self(employee_id) and status = 'new');

-- team calendar — leave type never stored here; visibility per LP12 (Q17)
create policy team_calendar_select on app.team_calendar_entries for select to authenticated
  using (   app.is_self(employee_id) or (select app.is_admin()) or app.is_manager_of(employee_id)
         or ((select p.team_calendar_visibility from app.leave_policy p where p.id = 1) = 'everyone'
             and (select app.current_employee_id()) is not null)
         or ((select p.team_calendar_visibility from app.leave_policy p where p.id = 1) = 'same_department'
             and department_id = (select e.department_id from app.employees e where e.id = (select app.current_employee_id()))));

-- notifications — own only
create policy notif_select on app.notifications for select to authenticated
  using (recipient_user_id = (select app.current_app_user_id()));
create policy notif_mark_read on app.notifications for update to authenticated
  using      (recipient_user_id = (select app.current_app_user_id()))
  with check (recipient_user_id = (select app.current_app_user_id()));

-- audit — SA read only; nobody writes except audit_writer functions
revoke all on all tables in schema audit from public, anon, authenticated, service_role;
grant select on audit.audit_log, audit.access_log, audit.daily_seals to authenticated;
create policy audit_select_sa  on audit.audit_log  for select to authenticated using ((select app.is_sa()));
create policy access_select_sa on audit.access_log for select to authenticated using ((select app.is_sa()));
```

**Logged read / write of special-category data (T4)** — the database writes the access-log
row in the same transaction as the read, so an HR read of religion/OKU cannot happen
without a log entry (BR-ADM-21):

```sql
create function app.read_employee_sensitive(p_employee_id uuid, p_purpose text)
returns table (religion app.religion, is_oku boolean, oku_card_no text)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if app.is_self(p_employee_id) then                      -- own data: no log (US-EMP-018 pattern)
    return query select s.religion, s.is_oku, s.oku_card_no from app.employee_sensitive s where s.employee_id = p_employee_id;
    return;
  end if;
  if not app.is_admin() then                               -- caller re-check: MGR/EMP/peers never
    raise exception 'PRET-ACC-403' using errcode = '42501';
  end if;
  perform audit.write_access('view_sensitive', 'employee', p_employee_id, array[p_employee_id],
                             array['religion','is_oku','oku_card_no'], array['religion','health']::app.data_category[], p_purpose);
  return query select s.religion, s.is_oku, s.oku_card_no from app.employee_sensitive s where s.employee_id = p_employee_id;
end $$;
revoke execute on function app.read_employee_sensitive(uuid, text) from public, anon;
grant  execute on function app.read_employee_sensitive(uuid, text) to authenticated;

-- app.write_employee_sensitive(p_employee_id, p_religion, p_is_oku, p_oku_card_no, p_reason):
--   requires app.is_admin() and p_employee_id is distinct from app.current_employee_id() (FR-G-16),
--   or is invoked by app.decide_task() when applying an approved CR (approver ≠ requester); writes audit.
```

---

## 7. How "no self-approval" is enforced in the database (FR-G-16, BR-CLM-20, US-ADMIN-022)

Eight independent layers — any one of them stops a self-decision:

| # | Layer | Mechanism |
|---|-------|-----------|
| 1 | Routing | `app.route_approval()` skips any level whose resolved approver is the applicant (BR-LV-60, EC-LV-06) and never assigns a task to the subject employee's own user. |
| 2 | Eligibility | `app.can_act_on_task()` returns false when `subject_employee_id = current_employee_id()` or `subject_prepared_by = current_app_user_id()` — regardless of role (ADM and SA included). |
| 3 | Decider identity from the session | Trigger `app.tg_task_decision` sets `decided_by` / `decided_by_employee_id` from `app.current_app_user_id()` / `app.current_employee_id()`; client-supplied values are overwritten. |
| 4 | Table CHECKs | `approval_tasks.chk_not_self_decision`, `claims.chk_not_self_decided`, `claims.chk_not_self_cancelled`, `change_requests.chk_cr_not_self`, `user_roles.chk_not_self_grant`, and approver ≠ preparer on `approval_tasks`, `disbursement_batches`, `payroll_runs`, `statutory_table_versions`. |
| 5 | Transition triggers | `app.tg_leave_transition` / `app.tg_claims_transition` raise `PRET-SELF-001` if the actor's employee = `NEW.employee_id` for `approved / rejected / cancelled (approved claim) / cancellation decided / disbursed / undo disbursement`. |
| 6 | RLS `WITH CHECK` not-own | balance adjustments, entitlement overrides, late-submission overrides, bank accounts, family, statutory profile, compensation, TP3/CP38 (pattern P-HR-NOT-OWN). |
| 7 | Self-edit guard | `app.tg_self_edit_guard`: an Admin editing their own employee rows may change only E✎ columns; E→CR fields (incl. own bank) require a CR decided by someone else (FR-EMP-12, EC-EMP-10). |
| 8 | Tests | pgTAP suite (§12) attempts every self-action as EMP, MGR, ADM (internal), SA and expects failure. |

```sql
-- Excerpt: claims transition guard (BEFORE UPDATE)
create function app.tg_claims_transition() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_actor_emp uuid := app.current_employee_id();
        v_actor     uuid := app.current_app_user_id();
begin
  if new.status is not distinct from old.status then
    if old.status <> 'new' and not app.is_admin() then           -- only New claims are editable by the owner (BR-CLM-21)
      raise exception 'PRET-CLM-LOCKED' using errcode = '42501';
    end if;
    return new;
  end if;
  if not (old.status, new.status) in (('new','submitted'),('submitted','approved'),('submitted','rejected'),
        ('submitted','withdrawn'),('approved','cancelled'),('approved','disbursed'),('disbursed','approved')) then
    raise exception 'PRET-CLM-TRANSITION %→%', old.status, new.status using errcode = '23514';
  end if;
  if new.status in ('approved','rejected','cancelled','disbursed') or (old.status = 'disbursed') then
    if v_actor_emp is not null and v_actor_emp = new.employee_id then
      raise exception 'PRET-SELF-001: you cannot decide, cancel or disburse your own claim' using errcode = '42501';
    end if;
  end if;
  if new.status in ('submitted','withdrawn') and not (app.is_self(new.employee_id) or (app.is_admin() and new.on_behalf_by = v_actor)) then
    raise exception 'PRET-CLM-OWNER-ONLY' using errcode = '42501';
  end if;
  if new.status in ('approved','rejected') then
    new.decided_by := v_actor; new.decided_by_employee_id := v_actor_emp; new.decided_at := now();
  elsif new.status = 'cancelled' then
    new.cancelled_by := v_actor; new.cancelled_by_employee_id := v_actor_emp; new.cancelled_at := now();
    new.disbursement_batch_id := null;                            -- BR-CLM-26: leaves the batch; batch outputs marked out of date by trigger
  end if;
  return new;
end $$;
```

---

## 8. How "a manager cannot see reportees' NRIC / bank / family / religion" is enforced

1. **Location.** MyKad (and spouse/child MyKad) are in `employee_personal`, `employee_spouses`, `employee_children`; bank and ASNB in `employee_bank_accounts`; family in `employee_spouses` / `employee_children`; religion and OKU in `employee_sensitive`; statutory numbers in `employee_statutory_profiles`; documents in `employee_documents` — all **T2/T3/T4**.
2. **No manager policy.** None of those tables has a policy that calls `app.is_manager_of()`, `app.can_see_team_row()` or `app.is_current_approver_for()`. A manager's query returns zero rows — through the server or any other path.
3. **Ciphertext anyway.** Even an Admin who passes RLS reads only `*_enc` + `*_last4`; plaintext requires the server's logged reveal (ADR-0003).
4. **Files.** `app.can_read_file()` never admits a manager to `employee_document`, `change_request_doc` or bank proofs; MC files only while the manager can act on the pending item (Q18, logged).
5. **Policy lint test** (§12): a catalogue query over `pg_policies` fails the build if any T2/T3/T4 table's `qual` or `with_check` mentions `is_manager_of`, `can_see_team_row` or `is_current_approver_for`.

**Within T1, fields hidden from managers by DTO projection (server-enforced, QA-tested, not sensitive):**
emergency-contact email (C6) and next-of-kin flag (C7); job-history remarks / reference
letter (JH10); separation type is shown (G2 has M in the PRD) but separation reason is T3.
Leave application `reason` and `attachment` for **peers** never leave the server — peers
read only `team_calendar_entries`.

---

## 9. Storage policies (Supabase Storage — ADR-0007)

Buckets (all **private**; no public bucket in PRET):

| Bucket | Path convention | Subjects |
|--------|-----------------|----------|
| `employee-files` | `emp/<employee_id>/docs/<document_id>/<uuid>.<ext>` · `emp/<employee_id>/photo/<uuid>.jpg` · `emp/<employee_id>/bank/<uuid>.<ext>` | documents, photo, bank proof |
| `leave-files` | `emp/<employee_id>/leave/<application_id>/<uuid>.<ext>` | MC / medical confirmation / certificates |
| `claim-files` | `emp/<employee_id>/claims/<claim_id>/<line_id>/<uuid>.<ext>` | receipts |
| `cr-files` | `emp/<employee_id>/cr/<change_request_id>/<uuid>.<ext>` | CR supporting documents |
| `generated` | `out/<kind>/<subject_id>/v<version>/<file>` · `payslips/<employee_id>/<run_id>/v<n>.pdf` | HLB lists, AutoCount, payslips, EA, statutory files, reports, zips |
| `imports` | `imp/<import_id>/<uuid>.<ext>` | import sources (deleted after 30 days) |
| `company` | `co/logo/<uuid>.png` · `co/signatures/<uuid>.png` · `co/privacy/<uuid>.pdf` | logo, signatures, privacy notice |

Authorisation lives in the `app.files` registry; Storage policies only ask the registry:

```sql
-- READ (signed-URL creation): photos/logo/privacy notice for any active user; everything else needs a fresh, logged grant.
create function app.storage_read_allowed(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.files f
     where f.bucket = p_bucket and f.storage_path = p_name and f.status = 'active'
       and (   (f.subject in ('employee_photo','privacy_notice','company_asset') and app.is_active_user())
            or exists (select 1 from app.file_access_grants g
                        where g.file_id = f.id and g.user_id = app.current_app_user_id() and g.expires_at > now())))
$$;

-- UPLOAD: only to a path the server pre-registered for this user (upload intent, 10-minute expiry).
create function app.storage_upload_allowed(p_bucket text, p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.files f
     where f.bucket = p_bucket and f.storage_path = p_name
       and f.status = 'pending_upload' and f.created_by = app.current_app_user_id()
       and f.upload_expires_at > now())
$$;

create policy pret_objects_select on storage.objects for select to authenticated
  using (bucket_id in ('employee-files','leave-files','claim-files','cr-files','generated','imports','company')
         and app.storage_read_allowed(objects.bucket_id, objects.name));          -- qualified: objects.name (Direct Order 0026)
create policy pret_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('employee-files','leave-files','claim-files','cr-files','imports')
              and app.storage_upload_allowed(objects.bucket_id, objects.name));
-- No UPDATE (upsert disabled) and no DELETE policy for authenticated. Retention deletion runs as pret_jobs.
```

**`app.can_read_file(p_file_id)`** (definer; gate for `file_access_grants` inserts):

| File subject | Who may obtain a grant |
|--------------|------------------------|
| `employee_document` | ADM/SA · the employee if `visible_to_employee` and category not HR-only (K1) |
| `employee_photo`, `privacy_notice`, `company_asset` | any active user (no grant needed) |
| `leave_attachment` | the employee · ADM/SA · a manager/delegate **only while** `app.can_act_on_task()` is true for the open task of that application (Q18) |
| `claim_receipt` | the employee · ADM/SA · the claimant's manager · current approver |
| `change_request_doc` | ADM/SA · the employee while the CR is `submitted` (HR-only after decision) |
| `generated_output` | payslip / EA: the employee (published/issued only) · ADM/SA; my-data export: requester only; access review / breach extract: SA; all others: ADM/SA |
| `import_source` | ADM/SA |
| `cp38_letter`, `tp1_doc` | ADM/SA · the employee (TP1 own) |

`app.tg_file_grant_log` writes an `audit.access_log` row for **every** grant, with the file's
`data_category` (Health for MCs, Identity for MyKad copies, Bank for proofs and payment
lists) — so downloads are logged by the database, not by the UI (F-ADM-10, BR-ADM-21).

---

## 10. SECURITY DEFINER function register

Every function below re-checks the caller **inside** the function and never trusts an
id it is given to imply permission.

| Function | Caller re-check | Why it must be definer |
|----------|-----------------|------------------------|
| helpers in §3 | n/a (read-only facts about the caller) | read `app_users`, `user_roles`, `reporting_closure`, `approval_tasks` without RLS recursion |
| `app.route_approval(p_subject_type, p_subject_id)` | caller can see the subject and is its owner / on-behalf ADM / system | computes assignees from reporting lines, workflows, delegations, leave calendar the caller cannot read |
| `app.decide_task(p_task_id, p_decision, p_comment, p_expected_version)` | `app.can_act_on_task(p_task_id)`; `select … for update` on task and subject; first decision wins (BR-CLM-25) | updates subject + ledger + next level + notifications atomically |
| `app.read_employee_sensitive` / `app.write_employee_sensitive` | self or ADM/SA; write not-own | T4 has no HR policy by design |
| `app.confirm_upload(p_file_id)` | `created_by = me`; object exists in `storage.objects` with matching size; MIME sniffed by server | flips registry to `active` |
| `app.can_read_file`, `app.can_upload_for`, `app.can_request_output` | rules in §9 | read subject tables across tiers |
| `private.next_doc_no(p_doc_type, p_year)` | `p_doc_type` from a fixed list; caller active | counters table has no grants |
| `audit.write_access(...)`, `audit.tg_log_change()` | n/a (append only) | owned by `audit_writer` |
| `app.rebuild_reporting_closure()`, `app.apply_current_job(p_employee_id)` | invoked by triggers / jobs only (execute revoked from authenticated) | maintain derived data |
| trigger functions with side effects (`tg_leave_transition`, `tg_claims_transition`, `tg_bank_change_alert`, `tg_ledger_summary`, `tg_refresh_directory`, …) | trigger-only (execute revoked) | write caches, ledger, notifications |

The Supabase security advisor is run after every migration batch; `security_definer_*`
findings are accepted only for functions in this register.

---

## 11. Role × table matrix (traced to PRD §16)

Codes: **S/I/U/D** as above; scope **o** own · **t** team · **a** all; **fn** = via listed function; **✗** none.
"not own" applies to every role (FR-G-16).

| PRD §16 row | Tables | EMP | MGR | ADM | SA |
|-------------|--------|-----|-----|-----|----|
| Employee list / master report | `employees`, `employee_directory` | S o; directory S a | S t | S I U a | S I U a |
| Personal, contact, emergency | `employees`, `employee_personal`, `employee_emergency_contacts` | S o; U o (E✎) | S t (`employees`, contacts; **not** `employee_personal`) | S I U a (own E→CR via CR) | S I U a |
| MyKad reveal | `employee_personal.nric_enc` + server reveal | S o (full, no log) | ✗ | reveal a (logged, reason) | reveal a (logged) |
| Religion / OKU | `employee_sensitive` | S o | ✗ | fn read (logged) / fn write, not own | fn read / fn write, not own |
| Family | `employee_spouses`, `employee_children`, `employee_marital_history` | S o; CR | ✗ | S I U a, not own | S I U a, not own |
| Employment & job history | `employees`, `employee_job_history`, `employee_hr_private` (T3) | S o (T1) | S t (T1, limited) | S I U a | S I U a |
| Separation | `employee_separations` (T1), `employee_separation_details` (T3) | S o (T1) | S t (T1) | S I U a | S I U a |
| Statutory & payroll-deduction profile | `employee_statutory_profiles` (T2), `employee_statutory_employer_flags` (T3) | S o (T2 only); CR | ✗ | S I U a, not own | S I U a, not own |
| Bank & ASNB | `employee_bank_accounts` | S o (masked; reveal own); CR | ✗ | S a; I a not own (no confirmation — D15); reveal logged | same |
| Compensation (R1.1) | `employee_compensation`, `employee_recurring_items` | S o | ✗ | S I a, not own | S I a, not own (Q-ARCH-02) |
| Documents | `employee_documents`, `files` | S o (visible) + grant | ✗ | S I U a + grant | S I U a + grant |
| HR notes | `hr_notes`, `hr_note_revisions` | ✗ | ✗ | S I U a | S I U a |
| Change requests | `change_requests` (+ items, files) | S I o; U o (cancel) | ✗ | S a; decide fn (not own) | S a; decide fn (not own) |
| Leave config | `leave_types`, bands, `leave_policy`, workflows | S | S | S I U a | S I U a |
| Apply / withdraw / cancel leave | `leave_applications` (+ days, files, events) | S I U o | S I U o; S t | S I U a (on behalf) | S I U a |
| Approve leave / cancellation / replacement credit | `approval_tasks` via `decide_task` | ✗ | fn t (routed, delegate) | fn a (Admin level, override; not own) | fn a (not own) |
| Leave balances & ledger | `leave_balance_summary` (T1), `leave_ledger` (T2) | S o (both) | S t (summary only) | S a | S a |
| Balance adjustment, roll-over | `leave_ledger` (adjustment), `rollover_runs` | ✗ | ✗ | I a, not own | I a, not own |
| Team calendar | `team_calendar_entries` / `leave_application_days` | S per LP12 (no type) | S t (with type) | S a | S a |
| MC / medical attachments | `files` (leave_attachment) + grants | S o | grant while deciding (logged) | grant a (logged) | grant a (logged) |
| Claim categories & limits | `claim_categories`, `claim_limits`, rates | S (own limits) | S | S I U a | S I U a |
| Create / edit / submit / withdraw / copy claim | `claims`, `claim_lines`, files | S I U D o (New) | S I U D o | I a (on behalf, not own) | S I U D o |
| Approve / reject claim (D12) | `approval_tasks` (claim_pool) via `decide_task` | ✗ | fn t (not own) | fn a (not own) | fn a (not own) |
| Cancel approved claim | `claims` via `decide_task('cancel')` | ✗ | fn t (not own) | fn a (not own) | fn a (not own) |
| Claims list / reports / zip | `claims`, `claim_lines`, `export_files` | S o | S t | S X a | S X a |
| Disbursement batches, HLB list, AutoCount, undo | `disbursement_batches`, `export_files`, `claims` | ✗ | ✗ | S I U X a | S X a; approve fn (if setting on, ≠ preparer) |
| Payroll settings, pay items, statutory tables (R1.1) | `payroll_settings`, `pay_items`, `statutory_table_versions` | ✗ | ✗ | S I U a | S I U a + verify fn |
| Payroll run create … finalise (R1.1) | `payroll_runs` + children | ✗ | ✗ | S I U a | S I U a |
| Payroll run approve / return / re-open (R1.1) | `approval_tasks` (payroll_run) via `decide_task` | ✗ | ✗ | ✗ | fn a (≠ preparer) |
| Payslips, YTD, EA forms (R1.1) | `payslips`, `payroll_ytd`, `ea_forms` | S o (published) | ✗ | S X a | S X a |
| Statutory outputs, salary list, AutoCount journal (R1.1) | `export_files`, `salary_payment_lines` | ✗ | ✗ | S X a | S X a |
| Organisation masters, PH calendars | `departments` … `replacement_holidays` | S (published PH) | S | S I U a | S I U a |
| Company profile & statutory employer numbers | `company_profile`, `company_statutory` | S (profile) | S (profile) | S both; U profile (non-statutory) | S I U both |
| System settings | `security_settings`, `leave_policy`, `claim_policy`, `payroll_settings` | ✗ (policies S for rules) | ✗ | S; U operating (leave, claims, payroll) | S U all (incl. control) |
| Users & roles | `app_users`, `user_roles`, `user_invitations` | own row | own row | S I U employee users w/o privileged roles | S I U a |
| Audit & access logs | `audit.*`, `login_events` | ✗ | ✗ | ✗ | S X a |
| Company privacy notice | `privacy_notices` | S | S | S I U | S I U |
| DSR log, breach extract, retention | `data_subject_requests`, `incidents`, `anonymisation_requests` | ✗ | ✗ | S (DSR log) | S I U X a |
| Imports | `import_jobs`, `import_rows`, migration tables | ✗ | ✗ | S I U a | S I U a (+ sign-off) |
| Dashboards | read models over the above | own | team | all | all |

---

## 12. Verification (handed to QA / Security for GATE 3)

| Test | What it proves |
|------|----------------|
| **pgTAP role matrix** | For each row of §11, seeded synthetic users (EMP, MGR with direct + indirect reportees, delegate, override approver, internal ADM, external ADM, SA, disabled user, expired external) run select/insert/update/delete and get exactly the expected row counts / errors. |
| **Self-action suite** | Every self-decision path in §7 attempted as EMP, MGR, ADM (internal) and SA → `PRET-SELF-001` / zero rows. |
| **Policy lint** | `pg_policies` scan: every `app`/`audit` table has RLS enabled + forced; every insert/update policy has `with_check`; no T2/T3/T4 policy references manager helpers; no `for all` policies. |
| **Definer lint** | every `prosecdef` function is in the §10 register, has `proconfig` containing `search_path=`, and `execute` is not granted to `anon`/`public`. |
| **Direct-API probe** | with a real user JWT and the anon key, PostgREST and GraphQL endpoints return 404/permission errors for every PRET table (Data API not exposed). |
| **Storage probe** | own-path upload succeeds only after an upload intent; other-employee path, expired intent and no-intent uploads fail; signed URL creation without a grant fails; manager MC access ends when the item is decided. |
| **Live session revocation** | disable a user / expire an external user / revoke ADM mid-session → next request returns no rows (no token refresh needed). |
| **MFA gate** | ADM without aal2 sees EMP-only data when `mfa_required_privileged` is on. |
