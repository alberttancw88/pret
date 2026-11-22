-- PRET W2-005 · 01 — claims tables (data-model §3, §9, §10 export_files; PRD §7.3–§7.9; D12, D16, D23).
-- Extras beyond data-model §9 (reasons in docs/build/W2-005-backend-report.md §9): claim_policy.include_separated_default;
-- claims.on_behalf_note / submitted_by / warnings_acknowledged; claim_lines.duplicate_of / late_override; disbursement_batches
-- idempotency_key / employee_count / out_of_date_reason / outputs_version; app.disbursement_batch_claims (membership history so a
-- disbursed batch stays immutable while an undone claim moves on — F-CLM-23); claim_late_overrides.employee_id / used_at.

create type app.claim_status      as enum ('new','submitted','approved','disbursed','rejected','withdrawn','cancelled');
create type app.claim_group       as enum ('business_travel','meals_entertainment','transport_mileage','medical','communications','office_admin','equipment_software','marketing_sales','employee_wellbeing','other');
create type app.capture_mode      as enum ('hidden','optional','required');
create type app.claim_extra_field as enum ('from_to_purpose','client_attendees','travel_destination','merchant_name');
create type app.claimant_scope    as enum ('employee_only','employee_and_dependants');
create type app.claim_dependant   as enum ('self','spouse','child');
create type app.tax_treatment     as enum ('reimbursement','exempt_benefit','taxable_allowance','taxable_perquisite');
create type app.limit_applies_to  as enum ('everyone','grade','department','employee_group','employee');
create type app.limit_behaviour   as enum ('block','warn');
create type app.batch_status      as enum ('draft','pending_approval','approved','exported','disbursed','cancelled');
create type app.disbursed_via     as enum ('hlb_batch','payroll_run');
create type app.output_kind       as enum ('hlb_claims_payment_list_xlsx','hlb_claims_payment_list_pdf','autocount_claims_xlsx','attachment_bundle_zip','payroll_input_pack_xlsx','report_xlsx','report_pdf','my_data_export','access_review','breach_extract','import_error_report',
                                       'salary_payment_list_xlsx','salary_payment_list_pdf','payslip_pdf','payslip_bundle_zip','ea_form_pdf','form_e_xlsx','kwsp_file','perkeso_file','epcb_file','hrdf_report','zakat_report','ptptn_report','cp22_report','payroll_report','autocount_payroll_journal_xlsx','reconciliation_report');
grant usage on type app.claim_status, app.claim_group, app.capture_mode, app.claim_extra_field, app.claimant_scope, app.claim_dependant,
  app.tax_treatment, app.limit_applies_to, app.limit_behaviour, app.batch_status, app.disbursed_via, app.output_kind
  to authenticated, service_role, audit_writer, audit_owner;

-- ---------------------------------------------------------------------------
-- Configuration (F-CLM-01/02/03)
-- ---------------------------------------------------------------------------
create table app.claim_policy (                                                          -- F-CLM-03 / C8 (SA flag: security_settings.sa_batch_approval_required)
  id smallint primary key default 1 check (id = 1),
  submission_deadline_days smallint not null default 60 check (submission_deadline_days between 1 and 366),   -- BR-CLM-10, Q21
  limit_refresh_day smallint not null default 31 check (limit_refresh_day between 1 and 31),                 -- BR-CLM-13
  disbursement_cutoff_day smallint not null default 31 check (disbursement_cutoff_day between 1 and 31),     -- PB4 (31 = last day)
  notes_required_default boolean not null default false,
  attachments_required_default boolean not null default true,
  new_claim_reminder_days smallint not null default 90 check (new_claim_reminder_days between 1 and 366),    -- BR-CLM-27
  include_separated_default boolean not null default false,                                                 -- C8 (W2-005)
  autocount_document_date_basis text not null default 'approval' check (autocount_document_date_basis in ('approval','disbursed')),
  updated_at timestamptz not null default now(), updated_by uuid
);

create table app.claim_categories (                                                      -- F-CLM-01, CC1–CC20
  id uuid primary key default gen_random_uuid(),
  code text not null check (char_length(code) between 1 and 10 and code ~ '^[A-Z0-9_-]+$'),
  name text not null check (char_length(name) between 1 and 80),
  claim_group app.claim_group not null,
  description text check (char_length(description) <= 1000),
  receipt_required boolean not null default true,
  notes_required boolean not null default false,
  receipt_no_mode app.capture_mode not null default 'optional',
  myinvois_uuid_mode app.capture_mode not null default 'optional',
  capture_sst boolean not null default true,
  is_mileage boolean not null default false,
  extra_fields app.claim_extra_field[] not null default '{}',
  claimant_scope app.claimant_scope not null default 'employee_only',
  min_service_months smallint not null default 0 check (min_service_months between 0 and 600),
  eligible_statuses app.employment_status[] not null default '{on_probation,confirmed,notice_period}',
  tax_treatment app.tax_treatment not null,
  ea_form_line text check (char_length(ea_form_line) <= 40),
  gl_account_code text not null check (char_length(gl_account_code) between 1 and 20),
  display_order smallint not null default 100, is_active boolean not null default true,
  version int not null default 1, created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_claim_categories_code unique (code),
  constraint ux_claim_categories_name unique (name),
  constraint chk_eligible_statuses check (eligible_statuses <@ '{on_probation,confirmed,notice_period}'::app.employment_status[] and cardinality(eligible_statuses) > 0)
);
create table app.claim_category_grades (                                                 -- CC14 grades (empty = all)
  category_id uuid not null references app.claim_categories(id), grade_id uuid not null references app.grades(id),
  primary key (category_id, grade_id)
);
create index ix_claim_category_grades_grade on app.claim_category_grades (grade_id);
create table app.claim_category_rates (                                                  -- CC11, effective-dated (EC-CLM-06)
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references app.claim_categories(id),
  effective_from date not null, rate_per_km numeric(8,3) not null check (rate_per_km > 0),
  created_at timestamptz not null default now(), created_by uuid,
  constraint ux_claim_rate_effective unique (category_id, effective_from)
);
create table app.claim_limits (                                                          -- F-CLM-02, CLM-L1–L8
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references app.claim_categories(id),
  applies_to app.limit_applies_to not null,
  grade_id uuid references app.grades(id), department_id uuid references app.departments(id),
  employee_group_id uuid references app.employee_groups(id), employee_id uuid references app.employees(id),
  per_transaction numeric(14,2) check (per_transaction > 0), per_month numeric(14,2) check (per_month > 0), per_year numeric(14,2) check (per_year > 0),
  behaviour app.limit_behaviour not null default 'block',
  effective_from date not null, effective_to date,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_target check (
     (applies_to = 'everyone' and num_nonnulls(grade_id, department_id, employee_group_id, employee_id) = 0) or
     (applies_to = 'grade' and grade_id is not null and num_nonnulls(department_id, employee_group_id, employee_id) = 0) or
     (applies_to = 'department' and department_id is not null and num_nonnulls(grade_id, employee_group_id, employee_id) = 0) or
     (applies_to = 'employee_group' and employee_group_id is not null and num_nonnulls(grade_id, department_id, employee_id) = 0) or
     (applies_to = 'employee' and employee_id is not null and num_nonnulls(grade_id, department_id, employee_group_id) = 0)),
  constraint chk_limit_amount check (num_nonnulls(per_transaction, per_month, per_year) > 0),
  constraint chk_limit_order check ((per_month is null or per_transaction is null or per_month >= per_transaction) and (per_year is null or per_month is null or per_year >= per_month)),
  constraint chk_limit_dates check (effective_to is null or effective_to >= effective_from)
);
create index ix_claim_limits_category on app.claim_limits (category_id);
create index ix_claim_limits_grade on app.claim_limits (grade_id);
create index ix_claim_limits_department on app.claim_limits (department_id);
create index ix_claim_limits_group on app.claim_limits (employee_group_id);
create index ix_claim_limits_employee on app.claim_limits (employee_id);

-- ---------------------------------------------------------------------------
-- Claims (CH1–CH16) and lines (CLN1–CLN18)
-- ---------------------------------------------------------------------------
create table app.claims (
  id uuid primary key default gen_random_uuid(),
  claim_no text not null,                                                                -- CH1 CL-yyyy-nnnnn
  employee_id uuid not null references app.employees(id),                                -- CH2
  title text not null check (char_length(title) between 1 and 120),                      -- CH3
  project_ref text check (char_length(project_ref) <= 60),                               -- CH4
  total_amount numeric(14,2) not null default 0, total_sst numeric(14,2) not null default 0,   -- CH5/CH6
  total_excl_sst numeric(14,2) generated always as (total_amount - total_sst) stored,     -- CH7
  status app.claim_status not null default 'new',                                        -- CH8
  flag_over_limit boolean not null default false, flag_late_override boolean not null default false,
  flag_possible_duplicate boolean not null default false,                                -- CH9
  on_behalf_by uuid references app.app_users(id), on_behalf_note text check (char_length(on_behalf_note) <= 300),
  warnings_acknowledged boolean not null default false,
  submitted_at timestamptz, submitted_by uuid references app.app_users(id),               -- CH14
  decided_by uuid references app.app_users(id), decided_by_employee_id uuid, decided_by_name text, decided_at timestamptz,
  reject_reason text check (char_length(reject_reason) <= 500),                          -- CH15
  cancelled_by uuid references app.app_users(id), cancelled_by_employee_id uuid, cancelled_at timestamptz,
  cancel_reason text check (char_length(cancel_reason) <= 500),
  copied_from_claim_id uuid references app.claims(id),                                   -- CH16
  disbursed_via app.disbursed_via,                                                       -- CH11
  disbursement_batch_id uuid,                                                            -- CH12 (current batch)
  payroll_run_id uuid,                                                                   -- R1.1
  disbursed_on date, payment_reference text check (char_length(payment_reference) <= 50),   -- CH13
  idempotency_key uuid,
  version int not null default 1, created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_claims_claim_no unique (claim_no),
  constraint ux_claims_idempotency unique (idempotency_key),
  constraint chk_claim_no check (claim_no ~ '^CL-[0-9]{4}-[0-9]{5,}$'),
  constraint chk_reject_reason check (status <> 'rejected' or reject_reason is not null),
  constraint chk_cancel_reason check (status <> 'cancelled' or cancel_reason is not null),
  constraint chk_not_self_decided check (decided_by_employee_id is distinct from employee_id),
  constraint chk_not_self_cancelled check (cancelled_by_employee_id is distinct from employee_id),
  constraint chk_disbursed_fields check (status <> 'disbursed' or (disbursed_on is not null and payment_reference is not null and disbursed_via is not null)),
  constraint chk_batch_xor_run check (num_nonnulls(disbursement_batch_id, payroll_run_id) <= 1),
  constraint chk_batch_only_approved check (disbursement_batch_id is null or status in ('approved','disbursed'))
);
create index ix_claims_employee_status on app.claims (employee_id, status);
create index ix_claims_open_status on app.claims (status) where status in ('submitted','approved');
create index ix_claims_batch on app.claims (disbursement_batch_id);
create index ix_claims_on_behalf on app.claims (on_behalf_by);
create index ix_claims_decided_by on app.claims (decided_by);
create index ix_claims_cancelled_by on app.claims (cancelled_by);
create index ix_claims_copied_from on app.claims (copied_from_claim_id);
create index ix_claims_submitted_by on app.claims (submitted_by);

create table app.claim_lines (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references app.claims(id) on delete cascade,                     -- New claims are owner-deletable (FR-G-08)
  employee_id uuid not null references app.employees(id),
  line_no smallint not null check (line_no between 1 and 50),
  category_id uuid not null references app.claim_categories(id),                         -- CLN2
  transaction_date date not null,                                                        -- CLN3
  description text check (char_length(description) <= 500),                             -- CLN4
  merchant text check (char_length(merchant) <= 100),                                    -- CLN5
  receipt_no text check (char_length(receipt_no) <= 50),                                 -- CLN6
  myinvois_uuid text check (myinvois_uuid ~ '^[A-Za-z0-9-]{1,40}$'),                     -- CLN7 (verify spec length)
  amount_incl_sst numeric(14,2) not null check (amount_incl_sst > 0 and amount_incl_sst <= 99999.99),   -- CLN8 BR-CLM-11
  sst_amount numeric(14,2) not null default 0,                                           -- CLN9
  amount_excl_sst numeric(14,2) generated always as (amount_incl_sst - sst_amount) stored,
  from_place text check (char_length(from_place) <= 100), to_place text check (char_length(to_place) <= 100),
  purpose text check (char_length(purpose) <= 100),                                      -- CLN10
  distance_km numeric(6,1) check (distance_km between 0.1 and 2000),                     -- CLN11 BR-CLM-15
  rate_per_km numeric(8,3) check (rate_per_km > 0),                                      -- CLN12 (snapshot)
  client_attendees text check (char_length(client_attendees) <= 300),                    -- CLN13
  travel_destination text check (char_length(travel_destination) <= 100),
  claimant app.claim_dependant not null default 'self',                                  -- CLN14
  cost_centre_id uuid references app.cost_centres(id),                                   -- CLN18
  limit_check jsonb,                                                                     -- CLN16 (last validation)
  duplicate_of text[] not null default '{}',                                             -- BR-CLM-17 warning (claim nos)
  late_override boolean not null default false,                                          -- F-CLM-21 applied
  tax_treatment_snapshot app.tax_treatment, ea_form_line_snapshot text, gl_account_snapshot text,   -- CLN17 (at approval)
  is_live boolean not null default false,                                                -- claim ∈ submitted/approved/disbursed (trigger)
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_claim_lines_no unique (claim_id, line_no),
  constraint chk_sst check (sst_amount >= 0 and sst_amount <= amount_incl_sst),
  constraint chk_mileage check (distance_km is null or (rate_per_km is not null and amount_incl_sst = round(distance_km * rate_per_km, 2)))
);
create unique index ux_myinvois_uuid_live on app.claim_lines (upper(myinvois_uuid)) where is_live and myinvois_uuid is not null;   -- BR-CLM-16
create index ix_claim_lines_limits on app.claim_lines (employee_id, category_id, transaction_date) where is_live;             -- BR-CLM-13
create index ix_claim_lines_receipt on app.claim_lines (receipt_no) where receipt_no is not null;                            -- BR-CLM-17
create index ix_claim_lines_merchant on app.claim_lines (transaction_date, amount_incl_sst) where merchant is not null;
create index ix_claim_lines_claim on app.claim_lines (claim_id);
create index ix_claim_lines_employee on app.claim_lines (employee_id);
create index ix_claim_lines_category on app.claim_lines (category_id);
create index ix_claim_lines_cost_centre on app.claim_lines (cost_centre_id);

create table app.claim_line_files (                                                      -- CLN15 (≤ 5: trigger)
  claim_line_id uuid not null references app.claim_lines(id) on delete cascade,
  file_id uuid not null references app.files(id),
  added_at timestamptz not null default now(),
  primary key (claim_line_id, file_id)
);
create index ix_claim_line_files_file on app.claim_line_files (file_id);
create table app.claim_line_dependants (                                                 -- T2 (self + HR; never MGR)
  claim_line_id uuid primary key references app.claim_lines(id) on delete cascade,
  employee_id uuid not null references app.employees(id),
  dependant_name text not null check (char_length(dependant_name) between 1 and 150),
  spouse_id uuid references app.employee_spouses(id), child_id uuid references app.employee_children(id)
);
create index ix_claim_line_dependants_employee on app.claim_line_dependants (employee_id);
create index ix_claim_line_dependants_spouse on app.claim_line_dependants (spouse_id);
create index ix_claim_line_dependants_child on app.claim_line_dependants (child_id);
create table app.claim_late_overrides (                                                  -- F-CLM-21, BR-CLM-10
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references app.claims(id) on delete cascade,
  claim_line_id uuid not null references app.claim_lines(id) on delete cascade,
  employee_id uuid not null references app.employees(id),
  reason text not null check (char_length(reason) between 10 and 500),
  granted_by uuid not null references app.app_users(id), granted_by_employee_id uuid, granted_at timestamptz not null default now(),
  used_at timestamptz,
  constraint chk_override_not_own check (granted_by_employee_id is distinct from employee_id)
);
create index ix_late_overrides_claim on app.claim_late_overrides (claim_id);
create index ix_late_overrides_line on app.claim_late_overrides (claim_line_id);
create index ix_late_overrides_employee on app.claim_late_overrides (employee_id);
create index ix_late_overrides_granted_by on app.claim_late_overrides (granted_by);
create table app.claim_events (                                                          -- status timeline (CH10, F-PRT-07)
  id bigint generated always as identity primary key,
  claim_id uuid not null references app.claims(id) on delete cascade,
  employee_id uuid not null,
  event text not null check (char_length(event) <= 200),
  from_status app.claim_status, to_status app.claim_status,
  actor_user_id uuid, actor_name text not null, acting_as app.acting_as, comment text check (char_length(comment) <= 500),
  batch_id uuid, payroll_run_id uuid, occurred_at timestamptz not null default now()
);
create index ix_claim_events_claim on app.claim_events (claim_id, occurred_at);
create index ix_claim_events_employee on app.claim_events (employee_id);

-- ---------------------------------------------------------------------------
-- Month-end disbursement (F-CLM-14/15/17/23, PB1–PB13)
-- ---------------------------------------------------------------------------
create table app.disbursement_batches (
  id uuid primary key default gen_random_uuid(),
  batch_no text not null,                                                                -- PB1 PB-yyyy-nnn
  disbursement_month date not null check (extract(day from disbursement_month) = 1),     -- PB3
  is_regular boolean not null default true,
  approval_cutoff_date date not null,                                                    -- PB4
  status app.batch_status not null default 'draft',                                      -- PB7
  claim_count int not null default 0, employee_count int not null default 0,
  total_amount numeric(14,2) not null default 0, total_sst numeric(14,2) not null default 0,   -- PB6
  planned_payment_date date not null,                                                    -- PB9
  payment_date date, payment_reference text check (char_length(payment_reference) <= 50),   -- PB10/PB11
  notes text check (char_length(notes) <= 500),                                          -- PB12
  outputs_version int not null default 0,
  outputs_out_of_date boolean not null default false, out_of_date_reason text check (char_length(out_of_date_reason) <= 300),
  bank_details_changed_after_export boolean not null default false,                      -- EC-CLM-10
  exported_at timestamptz,
  prepared_by uuid not null references app.app_users(id),
  approved_by uuid references app.app_users(id), approved_at timestamptz,                -- PB8
  disbursed_by uuid references app.app_users(id), disbursed_at timestamptz,
  cancelled_by uuid references app.app_users(id), cancelled_at timestamptz, cancel_reason text check (char_length(cancel_reason) <= 500),
  idempotency_key uuid,
  version int not null default 1, created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_batches_batch_no unique (batch_no),
  constraint ux_batches_idempotency unique (idempotency_key),
  constraint chk_batch_approver check (approved_by is distinct from prepared_by),
  constraint chk_disbursed check (status <> 'disbursed' or (payment_date is not null and payment_reference is not null)),
  constraint chk_not_out_of_date_disbursed check (status <> 'disbursed' or not outputs_out_of_date),
  constraint chk_cutoff check (approval_cutoff_date >= disbursement_month - 31)
);
create unique index ux_regular_batch_per_month on app.disbursement_batches (disbursement_month) where is_regular and status <> 'cancelled';
create index ix_batches_prepared_by on app.disbursement_batches (prepared_by);
create index ix_batches_approved_by on app.disbursement_batches (approved_by);
create index ix_batches_disbursed_by on app.disbursement_batches (disbursed_by);
create index ix_batches_cancelled_by on app.disbursement_batches (cancelled_by);
create index ix_batches_status on app.disbursement_batches (status);

create table app.disbursement_batch_claims (                                             -- membership history (BR-CLM-28; F-CLM-23)
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references app.disbursement_batches(id),
  claim_id uuid not null references app.claims(id),
  employee_id uuid not null references app.employees(id),
  amount numeric(14,2) not null, sst numeric(14,2) not null,
  added_at timestamptz not null default now(), added_by uuid,
  removed_at timestamptz, removed_by uuid, removed_reason text check (char_length(removed_reason) <= 500),
  undone_at timestamptz, undone_by uuid, undo_reason text check (char_length(undo_reason) <= 500)
);
create unique index ux_batch_claim_active on app.disbursement_batch_claims (claim_id) where removed_at is null and undone_at is null;   -- one batch at a time
create index ix_batch_claims_batch on app.disbursement_batch_claims (batch_id);
create index ix_batch_claims_employee on app.disbursement_batch_claims (employee_id);

create table app.disbursement_batch_events (
  id bigint generated always as identity primary key,
  batch_id uuid not null references app.disbursement_batches(id),
  event text not null check (char_length(event) <= 200),
  from_status app.batch_status, to_status app.batch_status,
  actor_user_id uuid, actor_name text not null, comment text check (char_length(comment) <= 500),
  occurred_at timestamptz not null default now()
);
create index ix_batch_events_batch on app.disbursement_batch_events (batch_id, occurred_at);

alter table app.claims add constraint fk_claims_batch foreign key (disbursement_batch_id) references app.disbursement_batches(id);
alter table app.approval_tasks add constraint fk_task_claim foreign key (claim_id) references app.claims(id);
alter table app.approval_tasks add constraint fk_task_batch foreign key (disbursement_batch_id) references app.disbursement_batches(id);
create index ix_tasks_claim on app.approval_tasks (claim_id);
create index ix_tasks_batch on app.approval_tasks (disbursement_batch_id);

-- ---------------------------------------------------------------------------
-- §10 Generated outputs (PB13, ADR-0011) — versioned; layouts live in code for R1.0 (Q37/Q46 not confirmed)
-- ---------------------------------------------------------------------------
create table app.export_files (
  id uuid primary key default gen_random_uuid(),
  kind app.output_kind not null,
  subject_type text not null check (subject_type in ('disbursement_batch','claims_filter','claims_range','report')),
  subject_id uuid,
  version int not null default 1,
  file_id uuid not null references app.files(id),
  is_watermarked boolean not null default false,
  is_superseded boolean not null default false, is_out_of_date boolean not null default false,
  layout_code text, layout_version int,
  row_count int, total_amount numeric(14,2), checksum bytea,
  generated_by uuid references app.app_users(id), generated_at timestamptz not null default now()
);
create unique index ux_export_files_version on app.export_files (kind, subject_type, subject_id, version) where subject_id is not null;
create index ix_export_files_subject on app.export_files (subject_type, subject_id);
create index ix_export_files_file on app.export_files (file_id);
create index ix_export_files_generated_by on app.export_files (generated_by);
