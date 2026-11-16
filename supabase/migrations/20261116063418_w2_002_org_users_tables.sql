-- PRET W2-002 · 10 — M5 organisation tables + M6 additions (enums, tables, constraints, indexes)
-- Design: data-model.md §3 (Organisation enums), §4 (M5), §5 (M6), §11 (privacy_notices); PRD §9, §10.
-- Columns that will reference app.employees stay plain uuid; W2-003 adds the FKs
-- (departments.head_employee_id). employee_group_members (T3) arrives with W2-003.
-- banks / lhdn_branches (employee bank & statutory lookups) arrive with W2-003.

-- ---------------------------------------------------------------------------
-- Enums (data-model §3 — Organisation)
-- ---------------------------------------------------------------------------
create type app.day_type           as enum ('full','half','off','rest');
create type app.month_day_basis    as enum ('actual_working_days','fixed_26','calendar_days');
create type app.holiday_type       as enum ('national','state','replacement','company','special');
create type app.compulsory_holiday as enum ('national_day','agong_birthday','ruler_birthday_or_ft_day','workers_day','malaysia_day');
create type app.calendar_status    as enum ('draft','published');

grant usage on type app.day_type, app.month_day_basis, app.holiday_type, app.compulsory_holiday, app.calendar_status
  to authenticated, service_role, audit_writer, audit_owner;

-- ---------------------------------------------------------------------------
-- Company: zakat registrations, signatories, AutoCount GL mapping (CO12, CO14, CO15)
-- ---------------------------------------------------------------------------
create table app.zakat_bodies (                                                       -- reference list (H31, CO12)
  id uuid primary key default gen_random_uuid(),
  state app.my_state not null, name text not null check (char_length(name) <= 150),
  code text not null check (char_length(code) <= 20), is_active boolean not null default true,
  constraint ux_zakat_bodies_code unique (code)
);

create table app.company_zakat_registrations (                                        -- CO12 (SA)
  id uuid primary key default gen_random_uuid(),
  zakat_body_id uuid not null references app.zakat_bodies(id),
  employer_ref text not null check (char_length(employer_ref) between 1 and 30),
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_company_zakat_body unique (zakat_body_id)
);

create table app.company_signatories (                                                -- CO14 (SA)
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  designation text not null check (char_length(designation) between 1 and 100),
  signature_file_id uuid references app.files(id),
  display_order smallint not null default 1 check (display_order between 1 and 99),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid
);
create index ix_company_signatories_file on app.company_signatories (signature_file_id);

create table app.gl_mappings (                                                        -- CO15 (ADM + SA; D10, Q37)
  purpose text primary key check (purpose in ('claims_payable','salary_payable','epf_payable','socso_payable','eis_payable',
                                               'pcb_payable','zakat_payable','ptptn_payable','hrdf_payable','bank_clearing')),
  gl_account_code text not null check (char_length(gl_account_code) between 1 and 20),
  updated_at timestamptz not null default now(), updated_by uuid
);

-- ---------------------------------------------------------------------------
-- Organisation masters (F-ORG-02–06, 13, 14)
-- ---------------------------------------------------------------------------
create table app.cost_centres (                                                       -- F-ORG-13
  id uuid primary key default gen_random_uuid(),
  code text not null check (char_length(code) between 1 and 10 and code ~ '^[A-Z0-9_-]+$'),
  name text not null check (char_length(name) between 1 and 80),
  autocount_code text check (char_length(autocount_code) <= 30),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_cost_centres_code unique (code)
);

create table app.departments (                                                        -- F-ORG-02
  id uuid primary key default gen_random_uuid(),
  code text not null check (char_length(code) between 1 and 10 and code ~ '^[A-Z0-9_-]+$'),
  name text not null check (char_length(name) between 1 and 80),
  parent_id uuid references app.departments(id),
  head_employee_id uuid,                                                              -- → app.employees(id): FK added by W2-003
  cost_centre_id uuid references app.cost_centres(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_departments_code unique (code),
  constraint chk_department_not_own_parent check (parent_id is distinct from id)
);
create index ix_departments_parent on app.departments (parent_id);
create index ix_departments_cost_centre on app.departments (cost_centre_id);
create index ix_departments_head on app.departments (head_employee_id);

create table app.grades (                                                             -- F-ORG-04 (Q25)
  id uuid primary key default gen_random_uuid(),
  code text not null check (char_length(code) between 1 and 10 and code ~ '^[A-Z0-9_-]+$'),
  name text not null check (char_length(name) between 1 and 80),
  rank smallint not null check (rank between 1 and 999),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_grades_code unique (code),
  constraint ux_grades_rank unique (rank)
);

create table app.positions (                                                          -- F-ORG-03
  id uuid primary key default gen_random_uuid(),
  code text not null check (char_length(code) between 1 and 10 and code ~ '^[A-Z0-9_-]+$'),
  title text not null check (char_length(title) between 1 and 100),
  default_department_id uuid references app.departments(id),
  default_grade_id uuid references app.grades(id),
  description text check (char_length(description) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_positions_code unique (code)
);
create index ix_positions_department on app.positions (default_department_id);
create index ix_positions_grade on app.positions (default_grade_id);

create table app.employee_groups (                                                    -- F-ORG-14 (members: W2-003)
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_employee_groups_name unique (name)
);

create table app.working_patterns (                                                   -- F-ORG-06, WP1/WP6
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_working_patterns_name unique (name)
);

create table app.working_pattern_versions (                                           -- WP2–WP5 (versioned, EC-ORG-03)
  id uuid primary key default gen_random_uuid(),
  pattern_id uuid not null references app.working_patterns(id),
  effective_from date not null,
  mon app.day_type not null, tue app.day_type not null, wed app.day_type not null, thu app.day_type not null,
  fri app.day_type not null, sat app.day_type not null, sun app.day_type not null,
  hours_per_full_day numeric(3,1) not null default 8.0 check (hours_per_full_day > 0 and hours_per_full_day <= 24),
  month_day_basis app.month_day_basis not null default 'fixed_26',
  created_at timestamptz not null default now(), created_by uuid,
  constraint ux_pattern_versions_effective unique (pattern_id, effective_from),
  constraint chk_one_rest_day check ('rest' in (mon,tue,wed,thu,fri,sat,sun))          -- BR-ORG-10 (EA s59)
);

create table app.work_locations (                                                     -- F-ORG-05
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  addr_line1 text not null check (char_length(addr_line1) <= 150), addr_line2 text check (char_length(addr_line2) <= 150),
  addr_line3 text check (char_length(addr_line3) <= 150),
  postcode char(5) not null check (postcode ~ '^[0-9]{5}$'), city text not null check (char_length(city) <= 80),
  state app.my_state not null,                                                        -- WL3 drives the PH calendar
  default_pattern_id uuid not null references app.working_patterns(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint ux_work_locations_name unique (name)
);
create index ix_work_locations_pattern on app.work_locations (default_pattern_id);

-- ---------------------------------------------------------------------------
-- Public holidays (F-ORG-07–10)
-- ---------------------------------------------------------------------------
create table app.holiday_calendar_years (                                             -- BR-ORG-25 draft/publish per state-year
  year smallint not null check (year between 2000 and 2100),
  state app.my_state not null,
  status app.calendar_status not null default 'draft',
  published_by uuid references app.app_users(id), published_at timestamptz,
  primary key (year, state)
);
create index ix_holiday_years_published_by on app.holiday_calendar_years (published_by);

create table app.public_holidays (                                                    -- PH1–PH8, PH10
  id uuid primary key default gen_random_uuid(),
  year smallint not null check (year between 2000 and 2100),
  holiday_date date not null,
  name text not null check (char_length(name) between 1 and 100),
  holiday_type app.holiday_type not null check (holiday_type <> 'replacement'),
  compulsory app.compulsory_holiday,
  is_observed boolean not null default true,
  is_half_day boolean not null default false,
  remarks text check (char_length(remarks) <= 200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_holiday_in_year check (extract(year from holiday_date) = year)
);
create index ix_public_holidays_date on app.public_holidays (holiday_date) where is_active;
create index ix_public_holidays_year on app.public_holidays (year);

create table app.public_holiday_states (                                              -- PH5
  holiday_id uuid not null references app.public_holidays(id) on delete cascade,     -- cascade: draft-year deletes only (RLS)
  state app.my_state not null,
  primary key (holiday_id, state)
);
create index ix_public_holiday_states_state on app.public_holiday_states (state);

create table app.replacement_holidays (                                               -- F-ORG-08, BR-ORG-21/22 (system-generated)
  id uuid primary key default gen_random_uuid(),
  source_holiday_id uuid not null references app.public_holidays(id) on delete cascade, -- PH9
  state app.my_state not null,
  pattern_id uuid not null references app.working_patterns(id),
  replacement_date date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint ux_replacement_source_state_pattern unique (source_holiday_id, state, pattern_id)
);
create index ix_replacement_holidays_lookup on app.replacement_holidays (state, pattern_id, replacement_date) where is_active;
create index ix_replacement_holidays_pattern on app.replacement_holidays (pattern_id);

-- ---------------------------------------------------------------------------
-- M6: company privacy notice (F-ADM-15, data-model §11) and monthly access review sign-off (F-ADM-12)
-- ---------------------------------------------------------------------------
create table app.privacy_notices (                                                    -- no acknowledgement (D14)
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  body_text text check (char_length(body_text) <= 20000),
  file_id uuid references app.files(id),
  effective_date date not null,
  is_current boolean not null default false,
  published_by uuid not null references app.app_users(id),
  published_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint chk_notice_content check (body_text is not null or file_id is not null)
);
create unique index ux_one_current_notice on app.privacy_notices (is_current) where is_current;
create index ix_privacy_notices_file on app.privacy_notices (file_id);
create index ix_privacy_notices_published_by on app.privacy_notices (published_by);

-- W2-002 addition (A10 "MARK REVIEWED — remarks; by/at stored"; no table in data-model §5).
create table app.access_reviews (
  review_month date primary key check (extract(day from review_month) = 1),
  reviewed_by uuid not null references app.app_users(id),
  reviewed_at timestamptz not null default now(),
  remarks text check (char_length(remarks) <= 1000)
);
create index ix_access_reviews_reviewed_by on app.access_reviews (reviewed_by);

-- ---------------------------------------------------------------------------
-- Settings additions (O11 wireframe: Rehire, Notifications sections) + sanity ranges
-- ---------------------------------------------------------------------------
alter table app.security_settings
  add column rehire_keep_employee_no boolean not null default true,
  add column directory_show_birthdays boolean not null default false,
  add constraint chk_settings_ranges check (
        employee_no_padding between 1 and 8 and employee_no_next >= 1
    and default_probation_months between 0 and 24 and max_probation_months between 1 and 24
    and max_probation_months >= default_probation_months
    and notice_weeks_lt2 >= 4 and notice_weeks_2to5 >= 6 and notice_weeks_ge5 >= 8
    and idle_timeout_min_employee between 5 and 120 and idle_timeout_min_privileged between 5 and 60
    and lockout_threshold between 3 and 10 and lockout_minutes between 5 and 1440
    and invite_lead_days between 0 and 30 and invite_link_hours between 1 and 168
    and reminder_after_working_days >= 1 and escalate_after_working_days > reminder_after_working_days
    and max_top_of_org between 1 and 5
    and retention_years_hr >= 7 and retention_years_payroll >= 7 and retention_years_audit >= 7
    and retention_days_import_files between 1 and 365
    and cardinality(allowed_email_domains) >= 1);

-- Sessions ended by an MFA reset (A7 RESET TWO-FACTOR).
alter table app.app_sessions drop constraint if exists app_sessions_end_reason_check;
alter table app.app_sessions add constraint app_sessions_end_reason_check
  check (end_reason in ('logout','idle_timeout','disabled','expired','role_change','password_reset','mfa_reset'));
