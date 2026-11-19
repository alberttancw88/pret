-- PRET W2-003 · 01 — M1 employee master: enums, reference tables (banks, LHDN branches), employee tables,
-- and the foreign keys W2-001/W2-002 left as plain uuid columns.
-- Design: data-model.md §2 (tiers), §3 (enums), §6 (M1), §10 (file FKs); PRD §5.3 field tables.
-- Deviations from data-model §6 are marked "W2-003:" and listed in docs/build/W2-003-backend-report.md.
-- Structural only. No personal data.

-- ===========================================================================
-- Enums (data-model §3 — Employee master)
-- ===========================================================================
create type app.employment_status    as enum ('pending_join','on_probation','confirmed','notice_period','separated','withdrawn');
create type app.gender               as enum ('male','female');
create type app.marital_status       as enum ('single','married','divorced','widowed');
create type app.race                 as enum ('malay','chinese','indian','bumiputera_sabah','bumiputera_sarawak','orang_asli','others');
create type app.religion             as enum ('islam','buddhism','christianity','hinduism','sikhism','taoism','other','none','prefer_not_to_say');
create type app.qualification        as enum ('spm','stpm','certificate','diploma','bachelor','master','doctorate','professional','other');
create type app.employment_type      as enum ('permanent_full_time');
create type app.job_change_type      as enum ('new_hire','confirmation','promotion','transfer','re_designation','grade_change','manager_change','working_pattern_change','separation','rehire','data_correction');
create type app.separation_type      as enum ('resignation','termination_with_notice','dismissal_misconduct','retirement','mutual_separation','end_of_probation','death','other');
create type app.separation_reason    as enum ('career_advancement','compensation','personal','relocation','further_studies','health','performance','misconduct','restructuring','retirement','other');
create type app.notice_outcome       as enum ('served','waived_by_company','bought_out_by_employee','short_served');
create type app.contact_relationship as enum ('spouse','parent','child','sibling','relative','friend','other');
create type app.spouse_record_status as enum ('current','former');
create type app.child_relationship   as enum ('biological','adopted','step_child');
create type app.pcb_child_category   as enum ('under_18','over_18_pre_university','over_18_diploma_plus','disabled','disabled_diploma_plus','not_eligible');
create type app.relief_share         as enum ('full_100','shared_50','spouse_claims_0');
create type app.payment_method       as enum ('bank_transfer','cheque','cash');
create type app.bank_account_type    as enum ('savings','current');
create type app.socso_category       as enum ('category_1','category_2');
create type app.epf_rate_type        as enum ('statutory','specific');
create type app.notice_unit          as enum ('weeks','months');
create type app.document_category    as enum ('offer_letter','employment_contract','mykad_copy','academic_certificate','professional_certificate','confirmation_letter','promotion_transfer_letter','resignation_letter','separation_letter','disciplinary_letter','medical_report','bank_proof','other');
create type app.cr_category          as enum ('legal_name','mykad','marital_spouse','children','oku','religion','race','bank_details','statutory_numbers');
create type app.cr_status            as enum ('submitted','approved','rejected','cancelled');

grant usage on type app.employment_status, app.gender, app.marital_status, app.race, app.religion, app.qualification,
                    app.employment_type, app.job_change_type, app.separation_type, app.separation_reason, app.notice_outcome,
                    app.contact_relationship, app.spouse_record_status, app.child_relationship, app.pcb_child_category,
                    app.relief_share, app.payment_method, app.bank_account_type, app.socso_category, app.epf_rate_type,
                    app.notice_unit, app.document_category, app.cr_category, app.cr_status
  to authenticated, service_role, audit_writer, audit_owner;

-- ===========================================================================
-- Reference lookups deferred from W2-002: banks (I2), LHDN branches (H5)
-- ===========================================================================
create table app.banks (                                                               -- I2 (Malaysian bank list for HLB Connect First)
  id uuid primary key default gen_random_uuid(),
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 100),
  bic text check (bic is null or bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_banks_code unique (code)
);
create table app.lhdn_branches (                                                       -- H5
  id uuid primary key default gen_random_uuid(),
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_lhdn_branches_code unique (code)
);

-- ===========================================================================
-- T1 TEAM — core employee record (only manager-visible fields)
-- ===========================================================================
create table app.employees (                                                          -- F-EMP-02/03/09
  id uuid primary key default gen_random_uuid(),
  employee_no text not null check (char_length(employee_no) between 1 and 20 and employee_no ~ '^[A-Za-z0-9-]+$'),   -- A1 (BR-EMP-11)
  full_name text not null check (char_length(full_name) between 1 and 150 and full_name ~ '^[[:alpha:]@''./ -]+$'),  -- A2
  preferred_name text check (char_length(preferred_name) <= 60),                     -- A3 (E✎)
  gender app.gender not null,                                                          -- A7
  work_email extensions.citext not null check (char_length(work_email) <= 254),       -- B1 (BR-EMP-07)
  mobile_phone text not null check (mobile_phone ~ '^\+60[0-9]{9,10}$'),              -- B3 (E✎)
  work_phone text check (char_length(work_phone) <= 20 and work_phone ~ '^[0-9+\- ]+$'),   -- B4
  photo_file_id uuid,                                                                  -- A16 (E✎) → files
  status app.employment_status not null,                                               -- F9 (system-derived: app.derive_employee_status)
  join_date date not null,                                                             -- F1
  employment_type app.employment_type not null default 'permanent_full_time',          -- F3
  probation_months smallint not null check (probation_months between 0 and 12),        -- F4
  probation_end_date date generated always as (
    case when probation_months = 0 then null
         else (join_date + make_interval(months => probation_months::int) - interval '1 day')::date end) stored,   -- F5 (BR-EMP-12)
  extended_probation_end_date date,                                                    -- F6
  confirmation_date date check (confirmation_date is null or confirmation_date >= join_date),   -- F8 (BR-EMP-13)
  -- current-job cache (maintained by app.apply_current_job() from employee_job_history; never edited directly)
  department_id uuid not null references app.departments(id),                          -- F10
  position_id uuid not null references app.positions(id),                              -- F11
  grade_id uuid not null references app.grades(id),                                    -- F12
  manager_employee_id uuid references app.employees(id),                               -- F13
  work_location_id uuid not null references app.work_locations(id),                    -- F17
  work_state app.my_state not null,                                                    -- F18 (from the location)
  working_pattern_id uuid not null references app.working_patterns(id),                -- F19
  manager_since date,                                                                  -- F27
  leave_approver_employee_id uuid references app.employees(id),                        -- F15
  claim_approver_employee_id uuid references app.employees(id),                        -- F16
  offer_withdrawn_at timestamptz,                                                      -- W2-003: §5.6 Pending Join → Withdrawn
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_employees_employee_no unique (employee_no),
  constraint ux_employees_work_email unique (work_email),
  constraint chk_not_own_manager check (manager_employee_id is distinct from id),      -- BR-EMP-10 (loops: trigger)
  constraint chk_probation_ext check (extended_probation_end_date is null or (probation_months > 0 and extended_probation_end_date > join_date))
);
create index ix_employees_status on app.employees (status);
create index ix_employees_manager on app.employees (manager_employee_id);
create index ix_employees_department on app.employees (department_id);
create index ix_employees_position on app.employees (position_id);
create index ix_employees_grade on app.employees (grade_id);
create index ix_employees_location on app.employees (work_location_id);
create index ix_employees_pattern on app.employees (working_pattern_id);
create index ix_employees_leave_approver on app.employees (leave_approver_employee_id);
create index ix_employees_claim_approver on app.employees (claim_approver_employee_id);
create index ix_employees_photo on app.employees (photo_file_id);
create index ix_employees_name_trgm on app.employees using gin (full_name extensions.gin_trgm_ops);

-- T0 DIRECTORY — trigger-maintained projection (FR-EMP-14, F-EMP-22/23)
create table app.employee_directory (
  employee_id uuid primary key references app.employees(id),
  employee_no text not null, full_name text not null, preferred_name text,
  position_title text not null, department_id uuid, department_name text not null,
  location_id uuid, location_name text not null,
  work_email extensions.citext not null, work_phone text, photo_file_id uuid,
  manager_employee_id uuid,                                                            -- org chart (names/positions only)
  is_listed boolean not null,                                                          -- false for pending_join / separated / withdrawn
  refreshed_at timestamptz not null default now()
);
create index ix_directory_listed on app.employee_directory (is_listed);

-- ===========================================================================
-- T2 SELF + HR — personal and identity data (never MGR)
-- ===========================================================================
create table app.employee_personal (                                                 -- PRD §5.3 A, B, F2, F7, F21, F26
  employee_id uuid primary key references app.employees(id),
  nric_enc bytea not null, nric_last4 char(4) not null check (nric_last4 ~ '^[0-9]{4}$'), nric_bidx bytea not null,   -- A4 (S1)
  date_of_birth date not null,                                                          -- A5 (≤ today: trigger)
  dob_overridden boolean not null default false,                                        -- BR-EMP-02 (logged)
  nationality text not null default 'Malaysian' check (nationality = 'Malaysian'),      -- A8 (BR-EMP-23)
  race app.race, race_other text check (char_length(race_other) <= 50),                -- A9/A10
  passport_no text check (passport_no ~ '^[A-Za-z0-9]{1,20}$'), passport_expiry date,    -- A17/A18 (E✎)
  highest_qualification app.qualification,                                              -- A19 (E✎)
  personal_email extensions.citext not null check (char_length(personal_email) <= 254), -- B2 (E✎)
  res_addr_line1 text not null check (char_length(res_addr_line1) <= 150), res_addr_line2 text check (char_length(res_addr_line2) <= 150),
  res_addr_line3 text check (char_length(res_addr_line3) <= 150),
  res_postcode char(5) not null check (res_postcode ~ '^[0-9]{5}$'), res_city text not null check (char_length(res_city) <= 80),
  res_state app.my_state not null, res_country text not null default 'Malaysia' check (char_length(res_country) <= 60),
  mailing_same_as_residential boolean not null default true,                            -- B11
  mail_addr_line1 text check (char_length(mail_addr_line1) <= 150), mail_addr_line2 text check (char_length(mail_addr_line2) <= 150),
  mail_addr_line3 text check (char_length(mail_addr_line3) <= 150),
  mail_postcode char(5) check (mail_postcode ~ '^[0-9]{5}$'), mail_city text check (char_length(mail_city) <= 80),
  mail_state app.my_state, mail_country text check (char_length(mail_country) <= 60),  -- B12
  continuous_service_date date not null,                                                -- F2 (BR-EMP-15)
  probation_extension_reason text check (char_length(probation_extension_reason) <= 500),   -- F7
  contractual_notice_value smallint check (contractual_notice_value between 1 and 52),
  contractual_notice_unit app.notice_unit,                                              -- F21
  retirement_date date generated always as ((date_of_birth + interval '60 years')::date) stored,   -- F26 (L-13)
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_employee_personal_nric_bidx unique (nric_bidx),                         -- BR-EMP-05
  constraint chk_race_other check (race is distinct from 'others' or race_other is not null),
  constraint chk_passport_expiry check (passport_no is null or passport_expiry is not null),
  constraint chk_mailing check (mailing_same_as_residential or (mail_addr_line1 is not null and mail_postcode is not null and mail_city is not null and mail_state is not null)),
  constraint chk_notice_pair check ((contractual_notice_value is null) = (contractual_notice_unit is null))
);
create index ix_employee_personal_last4 on app.employee_personal (nric_last4);           -- §5.7 search by last 4 (A,S)

create table app.employee_marital_history (                                           -- A12/A13 (BR-EMP-22)
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  marital_status app.marital_status not null, effective_date date not null,
  created_at timestamptz not null default now(), created_by uuid,
  constraint ux_marital_history_date unique (employee_id, effective_date)
);

-- T4 SPECIAL CATEGORY — religion, OKU (PDPA s4). Direct SELECT: self only; ADM/SA via logged definer functions.
create table app.employee_sensitive (                                                 -- A11, A14, A15 (BR-EMP-21)
  employee_id uuid primary key references app.employees(id),
  religion app.religion,
  is_oku boolean not null default false,
  oku_card_no text check (char_length(oku_card_no) <= 20),
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_oku_card check (not is_oku or oku_card_no is not null)
);

-- T3 HR ONLY — employment fields not visible to the employee or manager
create table app.employee_hr_private (                                                -- F14, F20, F22, F23, F25, F29
  employee_id uuid primary key references app.employees(id),
  is_top_of_org boolean not null default false,                                         -- F14 (SA only; max per security_settings)
  ph_state_override app.my_state,                                                       -- F20
  cost_centre_id uuid references app.cost_centres(id),                                  -- F22
  offer_contract_ref text check (char_length(offer_contract_ref) <= 50),                -- F23
  contract_signed_date date,                                                            -- F25
  pay_group_id uuid,                                                                    -- F29 (R1.1 → app.pay_groups)
  maternity_allowance_eligible boolean,                                                 -- BR-LV-42 indicator (HR only)
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid
);
create index ix_hr_private_cost_centre on app.employee_hr_private (cost_centre_id);

create table app.employee_group_members (                                             -- F28 (T3)
  group_id uuid not null references app.employee_groups(id),
  employee_id uuid not null references app.employees(id),
  added_at timestamptz not null default now(), added_by uuid,
  primary key (group_id, employee_id)
);
create index ix_group_members_employee on app.employee_group_members (employee_id);

-- T1 TEAM — emergency contacts (manager sees C1–C5 by DTO projection; Q26)
create table app.employee_emergency_contacts (                                        -- C1–C7
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  priority smallint not null check (priority between 1 and 3),
  name text not null check (char_length(name) between 1 and 100),
  relationship app.contact_relationship not null,
  mobile_phone text not null check (char_length(mobile_phone) <= 20),
  alt_phone text check (char_length(alt_phone) <= 20),
  email extensions.citext check (char_length(email) <= 254),
  is_next_of_kin boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_emergency_priority unique (employee_id, priority)
);
create unique index ux_next_of_kin on app.employee_emergency_contacts (employee_id) where is_next_of_kin;

-- T2 SELF + HR — family (never MGR)
create table app.employee_spouses (                                                   -- D1–D9
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  full_name text not null check (char_length(full_name) between 1 and 150),
  nric_enc bytea not null, nric_last4 char(4) not null check (nric_last4 ~ '^[0-9]{4}$'), nric_bidx bytea not null,   -- D2 (S1)
  marriage_date date,
  working_status text not null check (working_status in ('working','not_working')),
  is_oku boolean not null default false,
  income_tax_no text check (char_length(income_tax_no) <= 20),
  relief_claimed_by_employee boolean,
  record_status app.spouse_record_status not null default 'current',
  phone text check (char_length(phone) <= 20),
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_spouse_nric unique (employee_id, nric_bidx),
  constraint chk_relief_only_not_working check (relief_claimed_by_employee is not true or working_status = 'not_working')
);
create index ix_spouses_employee on app.employee_spouses (employee_id);

create table app.employee_children (                                                  -- E1–E9 (E10–E13 derived)
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  full_name text not null check (char_length(full_name) between 1 and 150),
  nric_enc bytea, nric_last4 char(4) check (nric_last4 ~ '^[0-9]{4}$'), nric_bidx bytea,   -- E2 optional (S1)
  date_of_birth date not null,
  gender app.gender, relationship app.child_relationship not null,
  pcb_category app.pcb_child_category, relief_share app.relief_share,
  institution_level text check (char_length(institution_level) <= 100),
  is_oku boolean not null default false,
  is_active boolean not null default true,                                              -- W2-003: removal is soft (FR-G-08)
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_child_nric_all check ((nric_enc is null) = (nric_last4 is null) and (nric_enc is null) = (nric_bidx is null)),
  constraint chk_study_institution check (pcb_category is null or pcb_category not in ('over_18_pre_university','over_18_diploma_plus','disabled_diploma_plus') or institution_level is not null)
);
create index ix_children_employee on app.employee_children (employee_id);

-- ===========================================================================
-- T1 TEAM — effective-dated job history (F-EMP-10, §5.5)
-- ===========================================================================
create table app.employee_job_history (                                               -- JH1–JH11
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  effective_date date not null,
  change_type app.job_change_type not null,
  department_id uuid not null references app.departments(id),
  position_id uuid not null references app.positions(id),
  grade_id uuid not null references app.grades(id),
  manager_employee_id uuid references app.employees(id),
  work_location_id uuid not null references app.work_locations(id),
  working_pattern_id uuid not null references app.working_patterns(id),
  employment_type app.employment_type not null default 'permanent_full_time',
  remarks text check (char_length(remarks) <= 500), reference_document_id uuid,         -- JH10 (manager: hidden by projection) → files
  is_deleted boolean not null default false, delete_reason text check (char_length(delete_reason) <= 500),   -- EC-EMP-06
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_correction_remarks check (change_type <> 'data_correction' or remarks is not null),
  constraint chk_job_not_own_manager check (manager_employee_id is distinct from employee_id),
  constraint chk_delete_reason check (not is_deleted or delete_reason is not null)
);
-- effective-dated rows cannot overlap: one live row per employee per effective date
create unique index ux_job_history_effective on app.employee_job_history (employee_id, effective_date) where not is_deleted;
create index ix_job_history_effective on app.employee_job_history (effective_date) where not is_deleted;
create index ix_job_history_department on app.employee_job_history (department_id);
create index ix_job_history_position on app.employee_job_history (position_id);
create index ix_job_history_grade on app.employee_job_history (grade_id);
create index ix_job_history_manager on app.employee_job_history (manager_employee_id);
create index ix_job_history_location on app.employee_job_history (work_location_id);
create index ix_job_history_pattern on app.employee_job_history (working_pattern_id);
create index ix_job_history_ref_doc on app.employee_job_history (reference_document_id);

create table app.probation_recommendations (                                          -- F-EMP-11 (S-AP-08)
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  recommendation text not null check (recommendation in ('confirm','extend','not_confirm')),
  suggested_extension_months smallint check (suggested_extension_months between 1 and 9),   -- W2-003 (UXQ-11)
  remarks text check (char_length(remarks) <= 1000),
  recommended_by uuid not null references app.app_users(id), recommended_at timestamptz not null default now(),
  constraint chk_recommend_extension check (recommendation <> 'extend' or suggested_extension_months is not null)
);
create index ix_probation_rec_employee on app.probation_recommendations (employee_id);
create index ix_probation_rec_by on app.probation_recommendations (recommended_by);

-- Separation: T1 part (dates/type) and T3 part (reason, notice maths, access end)
create table app.employee_separations (                                               -- G1, G2, G5
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  notice_date date not null,
  separation_type app.separation_type not null,
  last_working_day date not null,
  is_withdrawn boolean not null default false, withdrawn_at timestamptz, withdrawn_by uuid,   -- G10 (BR-EMP-33)
  withdraw_remarks text check (char_length(withdraw_remarks) <= 500),                     -- W2-003
  superseded_by_rehire boolean not null default false,                                    -- W2-003: closed by a rehire (F-EMP-13)
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_lwd check (last_working_day >= notice_date)
);
create unique index ux_active_separation on app.employee_separations (employee_id) where not is_withdrawn and not superseded_by_rehire;
create index ix_separations_employee on app.employee_separations (employee_id);

create table app.employee_separation_details (                                        -- G3, G4, G6–G9 (T3)
  separation_id uuid primary key references app.employee_separations(id),
  employee_id uuid not null references app.employees(id),                                -- W2-003: denormalised for audit/AU6
  reason_category app.separation_reason not null, reason_text text check (char_length(reason_text) <= 500),
  notice_required_days smallint not null check (notice_required_days >= 0),
  notice_shortfall_days smallint not null default 0 check (notice_shortfall_days >= 0),
  notice_outcome app.notice_outcome not null,
  portal_access_end_date date not null,
  eligible_for_rehire boolean, exit_remarks text check (char_length(exit_remarks) <= 1000),
  final_leave_position jsonb,                                                            -- BR-LV-91 snapshot (W2-004)
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_reason_other check (reason_category <> 'other' or reason_text is not null)
);
create index ix_separation_details_employee on app.employee_separation_details (employee_id);

-- ===========================================================================
-- Statutory & payroll-deduction profile (F-EMP-14/15)
-- ===========================================================================
create table app.employee_statutory_profiles (                                        -- T2 (E-visible part)
  employee_id uuid primary key references app.employees(id),
  pay_pcb boolean not null default true,                                               -- H1
  income_tax_no text check (income_tax_no ~ '^(IG[0-9]{1,11}|SG[0-9]{1,12}|OG[0-9]{1,12})$'),   -- H3 (BR-EMP-19, verify)
  is_tax_resident boolean not null default true,                                       -- H4
  lhdn_branch_id uuid references app.lhdn_branches(id),                                -- H5
  pay_epf boolean not null default true,                                               -- H13
  epf_no text check (epf_no ~ '^[0-9]{1,9}$'),                                         -- H15
  epf_rate_type app.epf_rate_type not null default 'statutory',                        -- H16
  epf_specific_rate numeric(7,4) check (epf_specific_rate between 0 and 89),
  epf_extra_employee_pct numeric(4,1) check (epf_extra_employee_pct between 0 and 89), -- H17
  pay_socso boolean not null default true,                                             -- H19
  socso_no text check (char_length(socso_no) <= 12),                                   -- H21 (default = MyKad; set by server)
  socso_category app.socso_category,                                                   -- H22 (BR-EMP-20)
  socso_contributed_before boolean,                                                    -- H23
  pay_eis boolean not null default true,                                               -- H26
  pay_zakat boolean not null default false,                                            -- H28
  zakat_monthly_amount numeric(14,2) check (zakat_monthly_amount > 0),                 -- H29
  zakat_account_no text check (char_length(zakat_account_no) <= 30),                   -- H30
  zakat_body_id uuid references app.zakat_bodies(id),                                  -- H31
  ptptn_monthly_amount numeric(14,2) check (ptptn_monthly_amount >= 0),                -- H33
  ptptn_start_date date, ptptn_end_date date,                                          -- H34
  child_count_lt18 smallint check (child_count_lt18 between 0 and 20),                 -- E12 manual counts (migration)
  child_count_tertiary smallint check (child_count_tertiary between 0 and 20),
  child_count_disabled_lt18 smallint check (child_count_disabled_lt18 between 0 and 20),
  child_count_disabled_tertiary smallint check (child_count_disabled_tertiary between 0 and 20),
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_zakat check (not pay_zakat or (zakat_monthly_amount is not null and zakat_account_no is not null)),
  constraint chk_ptptn check (coalesce(ptptn_monthly_amount, 0) = 0 or (ptptn_start_date is not null and ptptn_end_date >= ptptn_start_date)),
  constraint chk_epf_specific check (epf_rate_type = 'statutory' or epf_specific_rate is not null)
);
create index ix_statutory_lhdn_branch on app.employee_statutory_profiles (lhdn_branch_id);
create index ix_statutory_zakat_body on app.employee_statutory_profiles (zakat_body_id);

create table app.employee_statutory_employer_flags (                                  -- T3 (H2, H9, H10, H14, H18, H20, H24, H25, H27, H32)
  employee_id uuid primary key references app.employees(id),
  pcb_borne_by_employer boolean not null default false,                                -- H2
  returning_expert_programme boolean not null default false,                           -- H9
  knowledge_worker_specified_region boolean not null default false,                    -- H10
  epf_borne_by_employer boolean not null default false,                                -- H14
  epf_extra_employer_pct numeric(4,1) check (epf_extra_employer_pct between 0 and 89), -- H18
  socso_borne_by_employer boolean not null default false,                              -- H20
  pay_skbbk boolean not null default false, skbbk_borne_by_employer boolean not null default false,   -- H24/H25 (Q40)
  eis_borne_by_employer boolean not null default false,                                -- H27 (W2-003: PRD View A,S → T3)
  pay_hrdf boolean not null default false,                                             -- H32
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid
);

-- ===========================================================================
-- T2 SELF + HR — bank details, effective-dated and insert-only (I1–I9, D15)
-- ===========================================================================
create table app.employee_bank_accounts (                                             -- F-EMP-16
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  payment_method app.payment_method not null default 'bank_transfer',                  -- I1
  bank_id uuid references app.banks(id),                                               -- I2
  account_type app.bank_account_type,                                                  -- I3
  account_no_enc bytea, account_no_last4 char(4) check (account_no_last4 ~ '^[0-9]{4}$'), account_no_bidx bytea,   -- I4 (S1)
  account_holder_name text check (char_length(account_holder_name) <= 150),            -- I5
  holder_name_mismatch_ack boolean not null default false,                             -- BR-EMP-18
  shared_account_remarks text check (char_length(shared_account_remarks) <= 500),      -- W2-003: EC-EMP-12 remarks
  proof_file_id uuid,                                                                  -- I6 → files
  effective_from date not null,                                                        -- I7
  verified_by uuid not null references app.app_users(id), verified_at timestamptz not null default now(),   -- I8
  asnb_account_no_enc bytea, asnb_account_no_last4 char(4) check (asnb_account_no_last4 ~ '^[0-9]{4}$'),    -- I9 (S1)
  source_change_request_id uuid,                                                       -- set when applied from a CR → change_requests
  is_superseded boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  constraint ux_bank_effective unique (employee_id, effective_from),
  constraint chk_bank_transfer_fields check (payment_method <> 'bank_transfer' or (bank_id is not null and account_type is not null
    and account_no_enc is not null and account_no_last4 is not null and account_no_bidx is not null and account_holder_name is not null
    and proof_file_id is not null)),
  constraint chk_asnb_pair check ((asnb_account_no_enc is null) = (asnb_account_no_last4 is null))
);
create index ix_bank_accounts_bidx on app.employee_bank_accounts (account_no_bidx);
create index ix_bank_accounts_bank on app.employee_bank_accounts (bank_id);
create index ix_bank_accounts_verified_by on app.employee_bank_accounts (verified_by);
create index ix_bank_accounts_proof on app.employee_bank_accounts (proof_file_id);
create index ix_bank_accounts_cr on app.employee_bank_accounts (source_change_request_id);

-- T2/T3 — documents (visibility per row; HR-only categories forced)
create table app.employee_documents (                                                 -- F-EMP-18, K1–K7
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  category app.document_category not null,
  title text not null check (char_length(title) between 1 and 100),
  file_id uuid not null,                                                               -- → files
  document_date date, expiry_date date,
  visible_to_employee boolean not null,
  remarks text check (char_length(remarks) <= 500),
  is_active boolean not null default true,
  replaces_document_id uuid references app.employee_documents(id),                     -- W2-003: E11 "replace file = new version"
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_hr_only_categories check (not (visible_to_employee and category in ('mykad_copy','medical_report','disciplinary_letter','bank_proof'))),
  constraint chk_doc_expiry check (expiry_date is null or document_date is null or expiry_date >= document_date)
);
create index ix_documents_employee on app.employee_documents (employee_id) where is_active;
create index ix_documents_employee_all on app.employee_documents (employee_id);
create index ix_documents_expiry on app.employee_documents (expiry_date) where is_active and expiry_date is not null;
create index ix_documents_file on app.employee_documents (file_id);
create index ix_documents_replaces on app.employee_documents (replaces_document_id);

create table app.hr_notes (                                                           -- F-EMP-26, L1 (T3)
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  note_date date not null, body text not null check (char_length(body) between 1 and 2000),
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid
);
create index ix_hr_notes_employee on app.hr_notes (employee_id);
create table app.hr_note_revisions (                                                  -- "edits keep history" (T3)
  id bigint generated always as identity primary key,
  note_id uuid not null references app.hr_notes(id),
  employee_id uuid not null references app.employees(id),                               -- W2-003: denormalised for audit/AU6
  revision smallint not null, note_date date not null, body text not null,
  edited_by uuid, edited_at timestamptz not null default now(),
  constraint ux_note_revision unique (note_id, revision)
);
create index ix_note_revisions_employee on app.hr_note_revisions (employee_id);

create table app.prior_employments (                                                  -- F-EMP-27, L2 (T2; E✎)
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id),
  employer text not null check (char_length(employer) between 1 and 150),
  position text not null check (char_length(position) between 1 and 100),
  date_from date not null, date_to date not null,
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_prior_dates check (date_to >= date_from)
);
create index ix_prior_employments_employee on app.prior_employments (employee_id);

-- ===========================================================================
-- Change requests (F-EMP-19, §5.8) — T2 (self while open; HR)
-- ===========================================================================
create table app.change_requests (                                                    -- CR1–CR9
  id uuid primary key default gen_random_uuid(),
  cr_no text not null,                                                                 -- CR-yyyy-nnnnn (trigger)
  employee_id uuid not null references app.employees(id),
  category app.cr_category not null,
  effective_date date not null,
  employee_remarks text check (char_length(employee_remarks) <= 500),
  status app.cr_status not null default 'submitted',
  decision_remarks text check (char_length(decision_remarks) <= 500),
  decided_by uuid references app.app_users(id), decided_by_employee_id uuid, decided_at timestamptz,
  applied_at timestamptz,
  idempotency_key uuid,
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_change_requests_no unique (cr_no),
  constraint ux_change_requests_idem unique (idempotency_key),
  constraint chk_cr_reject_reason check (status <> 'rejected' or decision_remarks is not null),
  constraint chk_cr_not_self check (decided_by_employee_id is distinct from employee_id)     -- FR-G-16
);
create unique index ux_cr_one_open_per_category on app.change_requests (employee_id, category) where status = 'submitted';   -- EC-EMP-07
create index ix_change_requests_employee on app.change_requests (employee_id);
create index ix_change_requests_decided_by on app.change_requests (decided_by);
create index ix_change_requests_due on app.change_requests (effective_date) where status = 'approved' and applied_at is null;

create table app.change_request_items (                                               -- CR3
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references app.change_requests(id),
  employee_id uuid not null references app.employees(id),                                -- W2-003: denormalised (RLS / audit)
  target_table text not null check (target_table in ('employees','employee_personal','employee_marital_history','employee_sensitive',
                                                     'employee_spouses','employee_children','employee_bank_accounts','employee_statutory_profiles')),
  target_row_id uuid,                                                                   -- existing row, or the id the new row will get
  op text not null default 'update' check (op in ('update','insert','remove')),          -- W2-003
  field_name text not null check (field_name ~ '^[a-z_0-9*]{1,60}$'),
  field_label text check (char_length(field_label) <= 100),                              -- W2-003: display label
  group_label text check (char_length(group_label) <= 100),                              -- W2-003: "Spouse 1 (new)"
  current_display text check (char_length(current_display) <= 300),                      -- masked where sensitive
  new_value jsonb,                                                                      -- non-S1 fields
  new_value_enc bytea, new_value_last4 char(4), new_value_bidx bytea,                   -- S1 fields (AAD = target table/column/row) — never plaintext
  constraint chk_cr_item_value check (op = 'remove' or new_value is not null or new_value_enc is not null or field_name = '*')
);
create index ix_cr_items_request on app.change_request_items (change_request_id);
create index ix_cr_items_employee on app.change_request_items (employee_id);
create table app.change_request_files (                                               -- CR5
  change_request_id uuid not null references app.change_requests(id),
  file_id uuid not null,                                                                -- → files
  primary key (change_request_id, file_id)
);
create index ix_cr_files_file on app.change_request_files (file_id);

-- ===========================================================================
-- Foreign keys left as plain uuid by W2-001 / W2-002, and file FKs (data-model §10)
-- ===========================================================================
alter table app.reporting_closure
  add constraint fk_closure_manager foreign key (manager_employee_id) references app.employees(id),
  add constraint fk_closure_employee foreign key (employee_id) references app.employees(id);
alter table app.files add constraint fk_files_owner_employee foreign key (owner_employee_id) references app.employees(id);
alter table app.departments add constraint fk_departments_head foreign key (head_employee_id) references app.employees(id);
-- The first Super Admin's app_users row already carries a reserved employee id whose employee row
-- will be created by the Delivery Lead with the owner's own details → NOT VALID now (enforced for
-- new and updated rows); VALIDATE CONSTRAINT later (SQL in the W2-003 backend report).
alter table app.app_users add constraint fk_app_users_employee foreign key (employee_id) references app.employees(id) not valid;
create index ix_app_users_employee on app.app_users (employee_id);

alter table app.employees add constraint fk_employees_photo foreign key (photo_file_id) references app.files(id);
alter table app.employee_bank_accounts
  add constraint fk_bank_proof_file foreign key (proof_file_id) references app.files(id),
  add constraint fk_bank_source_cr foreign key (source_change_request_id) references app.change_requests(id);
alter table app.employee_documents add constraint fk_documents_file foreign key (file_id) references app.files(id);
alter table app.employee_job_history add constraint fk_job_history_ref_doc foreign key (reference_document_id) references app.files(id);
alter table app.change_request_files add constraint fk_cr_files_file foreign key (file_id) references app.files(id);

-- ===========================================================================
-- Scheduled invitations (FR-EMP-02 "invite on join date − 3 days"): the token must exist only in the
-- email (ADR-0014), so a scheduled invite is a date on the user row; the server job sends it.
-- ===========================================================================
alter table app.app_users add column invite_scheduled_for date;                        -- W2-003
create index ix_app_users_invite_scheduled on app.app_users (invite_scheduled_for) where invite_scheduled_for is not null;
