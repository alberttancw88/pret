-- PRET W2-004 · 01 — M2 leave + approval engine: enums, tables, constraints, indexes.
-- Design: data-model.md §3 (Leave, Approvals enums), §7 (M2), §8 (approval engine), §16 (indexes); ADR-0004, ADR-0005, ADR-0015.
-- W2-004 deviations (recorded in docs/build/W2-004-backend-report.md §7): leave_policy LP15 reminder/escalate and
-- F-LV-29 team-absence threshold; leave_types.annual_cap_days ("No entitlement" cap); replacement_credits day_type_label,
-- expired_days, attachment_file_id, decided_by; leave_applications cancel/decision columns; team_calendar_entries location.

-- ===========================================================================
-- Enums
-- ===========================================================================
create type app.leave_category    as enum ('annual','sick','hospitalisation','maternity','paternity','compassionate','marriage','unpaid','replacement','emergency','study_exam','other');
create type app.count_basis       as enum ('working_days','calendar_days','consecutive_calendar_days');
create type app.entitlement_method as enum ('annual_banded','fixed_per_occurrence','earned_credits','no_entitlement');
create type app.accrual_method    as enum ('policy_default','accrual_pro_rata','full_pro_rated','accrual_first_year_then_full');
create type app.prorate_basis     as enum ('by_day','by_month');
create type app.leave_rounding    as enum ('up_half','nearest_half','down_half','employment_act');
create type app.attachment_rule   as enum ('not_required','always','if_more_than_n_days');
create type app.notice_behaviour  as enum ('warn','block');
create type app.occurrence_scope  as enum ('per_year','per_employment');
create type app.leave_payroll_treatment as enum ('paid','unpaid_deduct','paid_encashable');
create type app.eligible_gender   as enum ('all','male','female');
create type app.eligible_marital  as enum ('any','married');
create type app.leave_status      as enum ('pending','approved','rejected','withdrawn','cancellation_pending','cancelled');
create type app.leave_session     as enum ('full','am','pm');
create type app.mc_status         as enum ('not_checked','verified','invalid');
create type app.ledger_entry_type as enum ('entitlement','carry_forward','credit_earned','taken','taken_reversal','adjustment','expired','forfeited');
create type app.credit_status     as enum ('pending','approved','rejected','withdrawn');
create type app.credit_duration   as enum ('full_day','half_day');
create type app.team_calendar_visibility as enum ('everyone','same_department','managers_and_hr');
create type app.rollover_status   as enum ('previewed','committed','superseded');
create type app.approver_source   as enum ('direct_manager','leave_approver_override','managers_manager','specific_employee','admin_pool','super_admin_pool','claim_pool');
create type app.task_subject      as enum ('leave_application','leave_cancellation','replacement_credit','claim','change_request','disbursement_batch','payroll_run','statutory_table_version');
create type app.task_status       as enum ('open','approved','rejected','skipped','superseded','cancelled');
create type app.acting_as         as enum ('assignee','delegate','admin_override','rerouted','pool_member','system_auto');

grant usage on type app.leave_category, app.count_basis, app.entitlement_method, app.accrual_method, app.prorate_basis, app.leave_rounding,
  app.attachment_rule, app.notice_behaviour, app.occurrence_scope, app.leave_payroll_treatment, app.eligible_gender, app.eligible_marital,
  app.leave_status, app.leave_session, app.mc_status, app.ledger_entry_type, app.credit_status, app.credit_duration,
  app.team_calendar_visibility, app.rollover_status, app.approver_source, app.task_subject, app.task_status, app.acting_as
  to authenticated, service_role, audit_writer, audit_owner;

-- ===========================================================================
-- Policy (F-LV-03, LP1–LP18) — singleton
-- ===========================================================================
create table app.leave_policy (
  id smallint primary key default 1 check (id = 1),
  leave_year_start_ddmm char(5) not null default '01/01' check (leave_year_start_ddmm = '01/01'),                  -- LP1
  entitlement_method app.accrual_method not null default 'accrual_pro_rata' check (entitlement_method <> 'policy_default'),   -- LP2
  prorate_basis app.prorate_basis not null default 'by_day',                                                       -- LP3
  rounding app.leave_rounding not null default 'up_half',                                                          -- LP4
  ea_floor_for_joiners_leavers boolean not null default true,                                                     -- LP5
  carry_forward_cap_days numeric(5,1) not null default 10 check (carry_forward_cap_days >= 0),                     -- LP6
  carry_forward_expiry_months smallint not null default 3 check (carry_forward_expiry_months between 0 and 12),    -- LP7
  allow_next_year_applications boolean not null default true,                                                     -- LP8
  next_year_from_ddmm char(5) not null default '01/11' check (next_year_from_ddmm ~ '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])$'),
  form_message text check (char_length(form_message) <= 500),                                                      -- LP9
  emergency_threshold_days smallint not null default 3 check (emergency_threshold_days between 0 and 30),          -- LP10
  emergency_leave_type_ids uuid[] not null default '{}',                                                           -- LP11
  team_calendar_visibility app.team_calendar_visibility not null default 'everyone',                               -- LP12 (Q17)
  notify_on_admin_withdraw boolean not null default true,                                                          -- LP13
  include_separated_in_reports boolean not null default true,                                                      -- LP14
  reminder_after_working_days smallint not null default 2 check (reminder_after_working_days between 0 and 30),    -- LP15 (W2-004)
  escalate_after_working_days smallint not null default 5 check (escalate_after_working_days between 0 and 60),    -- LP15 (W2-004)
  replacement_credit_validity_days smallint not null default 90 check (replacement_credit_validity_days between 0 and 365),   -- LP16 (Q16)
  replacement_credits_carry_forward boolean not null default true,                                                 -- LP17
  replacement_for_ph_on_off_day boolean not null default false,                                                    -- LP18 (Q14)
  replacement_worked_lookback_days smallint not null default 30 check (replacement_worked_lookback_days between 0 and 365),   -- RC3
  cancellation_approver_level1_only boolean not null default true,                                                 -- §6.10
  paternity_window_days_after_birth smallint not null default 30 check (paternity_window_days_after_birth between 0 and 365),  -- BR-LV-47
  team_absence_threshold smallint not null default 3 check (team_absence_threshold between 0 and 50),              -- F-LV-29 (W2-004; 0 = off)
  version int not null default 1,
  updated_at timestamptz not null default now(), updated_by uuid
);

-- ===========================================================================
-- Approval workflows (F-LV-32) and leave types (F-LV-01)
-- ===========================================================================
create table app.approval_workflows (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  skip_if_approver_is_applicant boolean not null default true,
  merge_consecutive_identical boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_approval_workflows_name unique (name)
);
create table app.approval_workflow_levels (
  workflow_id uuid not null references app.approval_workflows(id) on delete cascade,
  level smallint not null check (level between 1 and 3),
  source app.approver_source not null check (source <> 'claim_pool'),
  specific_employee_id uuid references app.employees(id),
  primary key (workflow_id, level),
  constraint chk_specific check ((source = 'specific_employee') = (specific_employee_id is not null))
);
create index ix_workflow_levels_specific on app.approval_workflow_levels (specific_employee_id);

create table app.leave_types (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9]{1,10}$'),                                                           -- LT1
  name text not null check (char_length(name) between 1 and 60),                                                  -- LT2
  category app.leave_category not null,                                                                            -- LT3
  description text check (char_length(description) <= 1000),                                                      -- LT4
  is_paid boolean not null,                                                                                        -- LT5
  count_basis app.count_basis not null,                                                                            -- LT6
  entitlement_method app.entitlement_method not null,                                                              -- LT7
  accrual_override app.accrual_method not null default 'policy_default',                                           -- LT8
  prorate_joiners_leavers boolean not null,                                                                        -- LT9
  eligible_gender app.eligible_gender not null default 'all',                                                      -- LT10
  eligible_marital app.eligible_marital not null default 'any',                                                    -- LT11
  min_service_months smallint not null default 0 check (min_service_months between 0 and 120),                    -- LT12
  available_on_probation boolean not null default true,                                                            -- LT13
  half_day_allowed boolean not null,                                                                               -- LT14
  reason_required boolean not null default true,                                                                   -- LT15
  attachment_rule app.attachment_rule not null default 'not_required',                                             -- LT16
  attachment_threshold_days numeric(4,1),                                                                          -- LT17
  attachment_grace_hours smallint not null default 0 check (attachment_grace_hours between 0 and 720),             -- LT18
  min_notice_days smallint not null default 0 check (min_notice_days >= 0),                                        -- LT19
  min_notice_behaviour app.notice_behaviour not null default 'warn',
  backdate_working_days smallint not null default 0 check (backdate_working_days between 0 and 60),                -- LT20
  max_days_per_application numeric(4,1) check (max_days_per_application > 0),                                      -- LT21
  max_occurrences smallint check (max_occurrences > 0), occurrence_scope app.occurrence_scope,                     -- LT22
  days_per_occurrence numeric(4,1) check (days_per_occurrence > 0),                                                -- LT23
  annual_cap_days numeric(5,1) check (annual_cap_days > 0),                                                        -- W2-004: "No entitlement" cap
  deduct_from_type_id uuid references app.leave_types(id),                                                         -- LT24
  pool_with_type_id uuid references app.leave_types(id), pool_cap_days numeric(5,1) check (pool_cap_days > 0),     -- LT25
  carry_forward_allowed boolean not null default false,                                                            -- LT26
  cf_cap_override numeric(5,1) check (cf_cap_override >= 0), cf_expiry_months_override smallint check (cf_expiry_months_override between 0 and 24),   -- LT27
  allow_negative boolean not null default false, max_negative_days numeric(4,1),                                   -- LT28
  workflow_id uuid not null references app.approval_workflows(id),                                                 -- LT29
  self_cancel_future_approved boolean not null default true,                                                       -- LT30
  visible_to_employees boolean not null default true,                                                              -- LT31
  calendar_colour text not null check (calendar_colour ~ '^#[0-9A-Fa-f]{6}$'),                                     -- LT32
  payroll_treatment app.leave_payroll_treatment not null,                                                          -- LT33
  display_order smallint not null default 100, is_active boolean not null default true,                            -- LT34
  version int not null default 1, created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_leave_types_code unique (code),
  constraint ux_leave_types_name unique (name),
  constraint chk_threshold check (attachment_rule <> 'if_more_than_n_days' or attachment_threshold_days is not null),
  constraint chk_fixed_occurrence check (entitlement_method <> 'fixed_per_occurrence' or days_per_occurrence is not null),
  constraint chk_negative check (not allow_negative or max_negative_days is not null),
  constraint chk_occurrence_scope check (max_occurrences is null or occurrence_scope is not null),
  constraint chk_pool_pair check ((pool_with_type_id is null) = (pool_cap_days is null)),
  constraint chk_not_self_ref check (deduct_from_type_id is distinct from id and pool_with_type_id is distinct from id),
  constraint chk_consecutive check (count_basis <> 'consecutive_calendar_days' or entitlement_method = 'fixed_per_occurrence')
);
create unique index ux_one_active_statutory_type on app.leave_types (category)
  where is_active and category in ('annual','sick','hospitalisation','maternity','paternity');                    -- BR-LV-01
create index ix_leave_types_workflow on app.leave_types (workflow_id);
create index ix_leave_types_deduct on app.leave_types (deduct_from_type_id);
create index ix_leave_types_pool on app.leave_types (pool_with_type_id);

create table app.statutory_leave_minimums (                                                                       -- BR-LV-02 reference (L-02, L-05, L-07, L-08)
  category app.leave_category not null, service_from_years numeric(4,1) not null, service_to_years numeric(4,1),
  min_days numeric(5,1) not null, legal_ref text not null,
  primary key (category, service_from_years)
);
create table app.statutory_floor_overrides (                                                                      -- BR-LV-02 SA override, logged
  id uuid primary key default gen_random_uuid(),
  leave_type_id uuid not null references app.leave_types(id),
  detail text not null check (char_length(detail) <= 500),
  reason text not null check (char_length(reason) between 10 and 500),
  approved_by uuid not null references app.app_users(id), approved_at timestamptz not null default now()
);
create index ix_floor_overrides_type on app.statutory_floor_overrides (leave_type_id);
create index ix_floor_overrides_by on app.statutory_floor_overrides (approved_by);

create table app.leave_entitlement_bands (                                                                        -- F-LV-02 (versioned per year)
  id uuid primary key default gen_random_uuid(),
  leave_type_id uuid not null references app.leave_types(id),
  effective_year smallint not null check (effective_year between 2000 and 2100),
  service_from_years numeric(4,1) not null check (service_from_years >= 0),
  service_to_years numeric(4,1),
  days_per_year numeric(5,1) not null check (days_per_year >= 0 and days_per_year * 2 = trunc(days_per_year * 2)),
  grade_id uuid references app.grades(id),
  created_at timestamptz not null default now(), created_by uuid,
  constraint chk_band_order check (service_to_years is null or service_to_years > service_from_years),
  constraint ex_band_overlap exclude using gist (leave_type_id with =, effective_year with =,
     (coalesce(grade_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
     (numrange(service_from_years, coalesce(service_to_years, 999), '[)')) with &&)
);
create index ix_bands_grade on app.leave_entitlement_bands (grade_id);

create table app.leave_entitlement_overrides (                                                                    -- F-LV-31
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id), leave_type_id uuid not null references app.leave_types(id),
  leave_year smallint not null check (leave_year between 2000 and 2100),
  days numeric(5,1) not null check (days >= 0 and days * 2 = trunc(days * 2)),
  reason text not null check (char_length(reason) between 10 and 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid not null,
  removed_at timestamptz, removed_by uuid
);
create unique index ux_entitlement_override on app.leave_entitlement_overrides (employee_id, leave_type_id, leave_year) where is_active;
create index ix_overrides_type on app.leave_entitlement_overrides (leave_type_id);

create table app.leave_entitlements (                                                                             -- F-LV-04 (computed)
  employee_id uuid not null references app.employees(id),
  leave_type_id uuid not null references app.leave_types(id),
  leave_year smallint not null,
  entitled_days numeric(5,1) not null,
  method app.accrual_method not null,
  calc_detail jsonb not null,
  engine_version text not null, inputs_hash bytea not null,
  computed_at timestamptz not null default now(),
  primary key (employee_id, leave_type_id, leave_year)
);
create index ix_entitlements_type on app.leave_entitlements (leave_type_id);

-- ===========================================================================
-- Applications (F-LV-05, LA1–LA21)
-- ===========================================================================
create table app.leave_applications (
  id uuid primary key default gen_random_uuid(),
  ref_no text not null,                                                                  -- LA1 LV-yyyy-nnnnn (split: -1/-2)
  split_group_id uuid, split_part smallint check (split_part in (1,2)),
  employee_id uuid not null references app.employees(id),                                -- LA2
  leave_type_id uuid not null references app.leave_types(id),                            -- LA3
  leave_year smallint not null,
  start_date date not null, start_session app.leave_session not null,                    -- LA4/LA5
  end_date date not null, end_session app.leave_session not null,                        -- LA6/LA7
  days numeric(5,1) not null check (days >= 0),                                          -- LA8 (0 only after a recount to zero)
  reason text check (char_length(reason) <= 500),                                        -- LA10
  expected_confinement_date date, child_birth_date date,                                 -- LA12/LA13
  contact_phone text check (char_length(contact_phone) <= 20), cover_employee_id uuid references app.employees(id),   -- LA14/LA15
  is_emergency boolean not null default false,                                           -- LA16
  attachment_pending boolean not null default false, attachment_due_at timestamptz,      -- LT18 / BR-LV-57
  mc_status app.mc_status not null default 'not_checked', mc_checked_by uuid references app.app_users(id), mc_checked_at timestamptz, mc_remarks text,
  status app.leave_status not null default 'pending',                                    -- LA18
  workflow_id uuid not null references app.approval_workflows(id),
  current_level smallint not null default 1, total_levels smallint not null default 1,
  on_behalf_by uuid references app.app_users(id), on_behalf_reason text check (char_length(on_behalf_reason) <= 500),   -- LA17
  beyond_backdate_window boolean not null default false,                                 -- recorded on behalf (L2)
  warnings_acknowledged jsonb,
  submitted_at timestamptz not null default now(), decided_at timestamptz,               -- LA21
  decided_by uuid references app.app_users(id),
  cancellation_requested_at timestamptz, cancellation_reason text check (char_length(cancellation_reason) <= 500),
  cancelled_at timestamptz, cancelled_by uuid references app.app_users(id), cancel_reason text check (char_length(cancel_reason) <= 500),
  idempotency_key uuid,
  version int not null default 1, created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_leave_applications_ref unique (ref_no),
  constraint chk_dates check (end_date >= start_date),
  constraint chk_same_year check (extract(year from start_date) = leave_year and extract(year from end_date) = leave_year),
  constraint chk_on_behalf_reason check (on_behalf_by is null or on_behalf_reason is not null),
  constraint chk_levels check (current_level between 1 and total_levels)
);
create unique index ux_leave_applications_idem on app.leave_applications (idempotency_key, coalesce(split_part, 0)) where idempotency_key is not null;
create index ix_leave_apps_employee_year on app.leave_applications (employee_id, leave_year);
create index ix_leave_apps_open on app.leave_applications (status) where status in ('pending','cancellation_pending');
create index ix_leave_apps_dates on app.leave_applications (start_date, end_date);
create index ix_leave_apps_type on app.leave_applications (leave_type_id);
create index ix_leave_apps_workflow on app.leave_applications (workflow_id);
create index ix_leave_apps_cover on app.leave_applications (cover_employee_id);
create index ix_leave_apps_on_behalf on app.leave_applications (on_behalf_by);
create index ix_leave_apps_mc_by on app.leave_applications (mc_checked_by);
create index ix_leave_apps_decided_by on app.leave_applications (decided_by);
create index ix_leave_apps_cancelled_by on app.leave_applications (cancelled_by);
create index ix_leave_apps_split on app.leave_applications (split_group_id);

create table app.leave_application_days (                                              -- BR-LV-21–27 per-date breakdown
  application_id uuid not null references app.leave_applications(id),
  employee_id uuid not null references app.employees(id),
  leave_date date not null,
  session app.leave_session not null,
  slot int4range generated always as (case session when 'am' then int4range(0,1) when 'pm' then int4range(1,2) else int4range(0,2) end) stored,
  weight numeric(3,2) not null check (weight between 0 and 1),
  day_kind text not null,                                                               -- working / half_working / off / rest / public_holiday / …
  day_label text not null,
  leave_year smallint not null,
  is_blocking boolean not null default true,
  primary key (application_id, leave_date),
  constraint ex_leave_no_overlap exclude using gist (employee_id with =, leave_date with =, slot with &&) where (is_blocking)   -- BR-LV-52
);
create index ix_leave_days_date on app.leave_application_days (leave_date) where is_blocking;
create index ix_leave_days_employee on app.leave_application_days (employee_id, leave_date);

create table app.leave_application_files (                                              -- LA11 (≤ 3: trigger)
  application_id uuid not null references app.leave_applications(id),
  file_id uuid not null references app.files(id),
  added_at timestamptz not null default now(), added_by uuid,
  primary key (application_id, file_id)
);
create index ix_leave_files_file on app.leave_application_files (file_id);

create table app.leave_application_events (                                             -- timeline (+ LA19 with approval_tasks)
  id bigint generated always as identity primary key,
  application_id uuid not null references app.leave_applications(id), employee_id uuid not null references app.employees(id),
  event text not null, from_status app.leave_status, to_status app.leave_status,
  actor_user_id uuid references app.app_users(id), actor_name text not null, acting_as app.acting_as, comment text,
  occurred_at timestamptz not null default now()
);
create index ix_leave_events_app on app.leave_application_events (application_id);
create index ix_leave_events_employee on app.leave_application_events (employee_id);
create index ix_leave_events_actor on app.leave_application_events (actor_user_id);

-- ===========================================================================
-- Replacement credits (F-LV-15, RC1–RC8, BR-LV-80–84)
-- ===========================================================================
create table app.replacement_credits (
  id uuid primary key default gen_random_uuid(),
  credit_no text not null,                                                              -- RL-yyyy-nnnnn
  employee_id uuid not null references app.employees(id),
  date_worked date not null, duration app.credit_duration not null,
  credit_days numeric(3,1) not null check (credit_days in (0.5, 1.0)),
  day_kind text not null, day_type_label text not null,                                 -- "Rest day" / "Public holiday: …" (W2-004)
  reason text not null check (char_length(reason) between 1 and 500),
  attachment_file_id uuid references app.files(id),                                     -- RC6
  status app.credit_status not null default 'pending',
  workflow_id uuid not null references app.approval_workflows(id),
  current_level smallint not null default 1, total_levels smallint not null default 1,
  expiry_date date,                                                                      -- RC8
  remaining_days numeric(3,1) not null default 0 check (remaining_days >= 0),
  expired_days numeric(3,1) not null default 0 check (expired_days >= 0),
  expired_at timestamptz, expiry_warned_at timestamptz,
  compensate_by_pay boolean not null default false, compensate_hours numeric(4,1),        -- BR-LV-84
  entered_by_admin uuid references app.app_users(id),                                    -- HR batch entry
  is_opening boolean not null default false,                                             -- F-LV-35 / migration
  submitted_at timestamptz not null default now(), decided_at timestamptz, decided_by uuid references app.app_users(id),
  idempotency_key uuid,
  version int not null default 1, created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_credit_no unique (credit_no),
  constraint ux_credit_idem unique (idempotency_key, employee_id),
  constraint chk_compensate check (not compensate_by_pay or compensate_hours is not null)
);
create unique index ux_credit_per_date on app.replacement_credits (employee_id, date_worked) where status in ('pending','approved');   -- BR-LV-80
create index ix_credits_status on app.replacement_credits (status);
create index ix_credits_expiry on app.replacement_credits (expiry_date) where status = 'approved';
create index ix_credits_workflow on app.replacement_credits (workflow_id);
create index ix_credits_file on app.replacement_credits (attachment_file_id);
create index ix_credits_entered_by on app.replacement_credits (entered_by_admin);
create index ix_credits_decided_by on app.replacement_credits (decided_by);

-- ===========================================================================
-- Ledger (ADR-0005) and summary cache
-- ===========================================================================
create table app.leave_ledger (                                                         -- F-LV-28, BR-LV-20 (append-only)
  id bigint generated always as identity primary key,
  employee_id uuid not null references app.employees(id),
  leave_type_id uuid not null references app.leave_types(id),
  leave_year smallint not null,
  entry_type app.ledger_entry_type not null,
  days numeric(6,1) not null check (days <> 0),
  effective_date date not null,
  expires_on date,
  is_opening boolean not null default false,
  source_application_id uuid references app.leave_applications(id),
  source_credit_id uuid references app.replacement_credits(id),
  source_rollover_id uuid, source_import_id uuid,
  source_ledger_id bigint references app.leave_ledger(id),                               -- expiry of a carry-forward row (W2-004)
  attachment_file_id uuid references app.files(id),                                      -- L5 adjustment attachment (W2-004)
  idempotency_key uuid,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now(), created_by uuid,
  constraint chk_adjust_reason check (entry_type <> 'adjustment' or char_length(reason) >= 10),   -- FR-LV-11
  constraint chk_half_steps check (days * 2 = trunc(days * 2)),
  constraint ux_ledger_idem unique (idempotency_key)
);
create index ix_ledger_emp_type_year on app.leave_ledger (employee_id, leave_type_id, leave_year);
create index ix_ledger_expires on app.leave_ledger (expires_on) where expires_on is not null;
create index ix_ledger_type on app.leave_ledger (leave_type_id);
create index ix_ledger_app on app.leave_ledger (source_application_id);
create index ix_ledger_credit on app.leave_ledger (source_credit_id);
create index ix_ledger_source on app.leave_ledger (source_ledger_id);
create index ix_ledger_file on app.leave_ledger (attachment_file_id);
create index ix_ledger_rollover on app.leave_ledger (source_rollover_id);

create table app.leave_balance_summary (                                                -- derived cache (MGR-readable)
  employee_id uuid not null references app.employees(id),
  leave_type_id uuid not null references app.leave_types(id),
  leave_year smallint not null,
  entitled numeric(6,1) not null default 0, carried_forward numeric(6,1) not null default 0,
  earned_credits numeric(6,1) not null default 0, adjustments numeric(6,1) not null default 0,
  taken numeric(6,1) not null default 0, expired_forfeited numeric(6,1) not null default 0,
  pending numeric(6,1) not null default 0,
  balance numeric(6,1) generated always as (entitled + carried_forward + earned_credits + adjustments - taken - expired_forfeited) stored,
  available numeric(6,1) generated always as (entitled + carried_forward + earned_credits + adjustments - taken - expired_forfeited - pending) stored,
  refreshed_at timestamptz not null default now(),
  primary key (employee_id, leave_type_id, leave_year)
);
create index ix_summary_type on app.leave_balance_summary (leave_type_id);

create table app.replacement_credit_consumptions (                                      -- FIFO (BR-LV-81)
  credit_id uuid not null references app.replacement_credits(id),
  application_id uuid not null references app.leave_applications(id),
  employee_id uuid not null references app.employees(id),
  days numeric(3,1) not null check (days > 0), consumed_at timestamptz not null default now(), reversed_at timestamptz,
  primary key (credit_id, application_id)
);
create index ix_consumptions_app on app.replacement_credit_consumptions (application_id);
create index ix_consumptions_employee on app.replacement_credit_consumptions (employee_id);

create table app.employee_leave_counters (                                              -- BR-LV-46, EC-LV-13
  employee_id uuid not null references app.employees(id), leave_type_id uuid not null references app.leave_types(id),
  migrated_occurrences smallint not null default 0 check (migrated_occurrences between 0 and 99), source_import_id uuid,
  primary key (employee_id, leave_type_id)
);
create index ix_counters_type on app.employee_leave_counters (leave_type_id);

create table app.rollover_runs (                                                        -- F-LV-19, BR-LV-70–74
  id uuid primary key default gen_random_uuid(),
  closing_year smallint not null, status app.rollover_status not null default 'previewed',
  previewed_by uuid not null references app.app_users(id), previewed_at timestamptz not null default now(),
  committed_by uuid references app.app_users(id), committed_at timestamptz, summary jsonb
);
create unique index ux_rollover_committed on app.rollover_runs (closing_year) where status = 'committed';
create index ix_rollover_previewed_by on app.rollover_runs (previewed_by);
create index ix_rollover_committed_by on app.rollover_runs (committed_by);
create table app.rollover_lines (
  run_id uuid not null references app.rollover_runs(id) on delete cascade,
  employee_id uuid not null references app.employees(id), leave_type_id uuid not null references app.leave_types(id),
  closing_balance numeric(6,1) not null, carry_forward numeric(6,1) not null, forfeited numeric(6,1) not null,
  new_year_entitlement numeric(6,1) not null, cf_expiry_date date,
  primary key (run_id, employee_id, leave_type_id)
);
create index ix_rollover_lines_employee on app.rollover_lines (employee_id);
create index ix_rollover_lines_type on app.rollover_lines (leave_type_id);

create table app.team_calendar_entries (                                                -- peer-safe projection (Q17): no leave type
  employee_id uuid not null references app.employees(id),
  leave_date date not null, session app.leave_session not null,
  department_id uuid not null references app.departments(id),
  work_location_id uuid references app.work_locations(id),
  application_id uuid not null references app.leave_applications(id),
  primary key (employee_id, leave_date, session)
);
create index ix_team_calendar_date on app.team_calendar_entries (leave_date);
create index ix_team_calendar_app on app.team_calendar_entries (application_id);
create index ix_team_calendar_dept on app.team_calendar_entries (department_id);
create index ix_team_calendar_loc on app.team_calendar_entries (work_location_id);

-- ===========================================================================
-- Approval tasks (data-model §8, ADR-0004)
-- ===========================================================================
create table app.approval_tasks (
  id uuid primary key default gen_random_uuid(),
  subject_type app.task_subject not null,
  leave_application_id uuid references app.leave_applications(id),
  replacement_credit_id uuid references app.replacement_credits(id),
  claim_id uuid,                                                                          -- → app.claims (W2-005)
  change_request_id uuid references app.change_requests(id),
  disbursement_batch_id uuid, payroll_run_id uuid, stat_table_version_id uuid,
  subject_employee_id uuid references app.employees(id),
  subject_prepared_by uuid references app.app_users(id),
  level smallint not null default 1,
  source app.approver_source not null,
  assignee_user_id uuid references app.app_users(id),
  original_assignee_user_id uuid references app.app_users(id),
  routing_note text check (char_length(routing_note) <= 500),
  status app.task_status not null default 'open',
  decided_by uuid references app.app_users(id), decided_by_employee_id uuid references app.employees(id), decided_by_name text,
  acting_as app.acting_as, decision_comment text check (char_length(decision_comment) <= 500), decided_at timestamptz,
  reminder_count smallint not null default 0, last_reminded_at timestamptz, escalated_at timestamptz,
  created_at timestamptz not null default now(),
  version int not null default 1,
  constraint chk_one_subject check (num_nonnulls(leave_application_id, replacement_credit_id, claim_id, change_request_id, disbursement_batch_id, payroll_run_id, stat_table_version_id) = 1),
  constraint chk_not_self_decision check (decided_by_employee_id is null or subject_employee_id is null or decided_by_employee_id <> subject_employee_id),
  constraint chk_not_preparer check (subject_prepared_by is null or decided_by is null or decided_by <> subject_prepared_by),
  constraint chk_reject_comment check (status <> 'rejected' or char_length(decision_comment) > 0)
);
create unique index ux_task_open_level on app.approval_tasks (subject_type,
  coalesce(leave_application_id, replacement_credit_id, claim_id, change_request_id, disbursement_batch_id, payroll_run_id, stat_table_version_id), level)
  where status = 'open';
create index ix_tasks_assignee_open on app.approval_tasks (assignee_user_id) where status = 'open';
create index ix_tasks_source_open on app.approval_tasks (source) where status = 'open';
create index ix_tasks_subject_employee on app.approval_tasks (subject_employee_id);
create index ix_tasks_leave on app.approval_tasks (leave_application_id);
create index ix_tasks_credit on app.approval_tasks (replacement_credit_id);
create index ix_tasks_cr on app.approval_tasks (change_request_id);
create index ix_tasks_assignee on app.approval_tasks (assignee_user_id);
create index ix_tasks_original on app.approval_tasks (original_assignee_user_id);
create index ix_tasks_decided_by on app.approval_tasks (decided_by);
create index ix_tasks_decided_emp on app.approval_tasks (decided_by_employee_id);
create index ix_tasks_prepared_by on app.approval_tasks (subject_prepared_by);

-- ===========================================================================
-- W2-003 leftovers that reference leave: nothing to alter (employee_separation_details.final_leave_position exists).
-- ===========================================================================

