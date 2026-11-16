-- PRET W2-001 Foundation · 02 — core tables
-- Design: data-model.md §4 (company, settings), §5 (users & access), §10 (files,
-- notifications), §11 (jobs, private internals). Module tables (employees, leave,
-- claims, …) arrive with their own work items; FKs to app.employees are added then.

-- ---------------------------------------------------------------------------
-- §4 Organisation & settings (shell needs company + settings)
-- ---------------------------------------------------------------------------
create table app.company_profile (                                                   -- F-ORG-01, CO1–CO6, CO15
  id smallint primary key default 1 check (id = 1),
  legal_name text not null check (char_length(legal_name) <= 150),                   -- CO1 (SA-edit: guard trigger)
  phone text, email extensions.citext, website text,                                 -- CO5
  biz_addr_line1 text not null, biz_addr_line2 text, biz_addr_line3 text,
  biz_postcode char(5) not null check (biz_postcode ~ '^[0-9]{5}$'), biz_city text not null, biz_state app.my_state not null, biz_country text not null default 'Malaysia',
  logo_file_id uuid,                                                                  -- CO6 → app.files (FK below)
  version int not null default 1, created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid
);

create table app.company_statutory (                                                 -- SA edit only (CO2–CO4, CO7–CO13)
  id smallint primary key default 1 check (id = 1),
  ssm_no_new char(12) not null check (ssm_no_new ~ '^[0-9]{12}$'),
  ssm_no_old text check (char_length(ssm_no_old) <= 10),
  reg_addr_line1 text not null, reg_addr_line2 text, reg_addr_line3 text,
  reg_postcode char(5) not null, reg_city text not null, reg_state app.my_state not null, reg_country text not null default 'Malaysia',
  epf_employer_no text check (char_length(epf_employer_no) <= 9),
  socso_employer_code text check (char_length(socso_employer_code) <= 12),
  lhdn_e_no text check (char_length(lhdn_e_no) <= 11),
  company_tax_no text check (char_length(company_tax_no) <= 14),
  hrdf_registered boolean not null default false,
  hrdf_levy_rate numeric(7,4) check (hrdf_levy_rate in (1.0000, 0.5000)),
  hrdf_mycoid text,
  hlb_account_name text,
  hlb_account_no_enc bytea, hlb_account_no_last4 char(4),                             -- S1 encrypted (ADR-0003)
  version int not null default 1, created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid
);

create table app.security_settings (                                                 -- SA-only control settings (F-ORG-12)
  id smallint primary key default 1 check (id = 1),
  employee_no_prefix text not null default 'INT-', employee_no_padding smallint not null default 3, employee_no_next int not null,
  default_probation_months smallint not null default 3, max_probation_months smallint not null default 12,
  notice_weeks_lt2 smallint not null default 4, notice_weeks_2to5 smallint not null default 6, notice_weeks_ge5 smallint not null default 8,
  allowed_email_domains extensions.citext[] not null default '{interact.com.my}',
  idle_timeout_min_employee smallint not null default 30, idle_timeout_min_privileged smallint not null default 15,
  lockout_threshold smallint not null default 5, lockout_minutes smallint not null default 30,
  mfa_required_privileged boolean not null default true,
  invite_lead_days smallint not null default 3, invite_link_hours smallint not null default 72,
  reminder_after_working_days smallint not null default 2, escalate_after_working_days smallint not null default 5,
  sa_batch_approval_required boolean not null default false,
  max_top_of_org smallint not null default 1,
  hr_reply_to_email extensions.citext,
  retention_years_hr smallint not null default 7, retention_years_payroll smallint not null default 7, retention_years_audit smallint not null default 7,
  retention_days_import_files smallint not null default 30,
  updated_at timestamptz not null default now(), updated_by uuid
);

-- ---------------------------------------------------------------------------
-- §5 Users, roles and access
-- ---------------------------------------------------------------------------
create table app.app_users (                                                         -- F-ADM-01/02/04, U1–U15
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  user_type app.user_type not null,
  employee_id uuid unique,                                                            -- → app.employees(id): FK added by W2-003
  login_email extensions.citext not null unique,
  display_name text not null check (char_length(display_name) between 1 and 100),
  status app.user_status not null default 'invited',
  access_start_date date not null,
  access_end_date date,
  service_provider text check (char_length(service_provider) <= 150),
  mfa_enrolled boolean not null default false,
  last_login_at timestamptz, failed_login_count smallint not null default 0, locked_until timestamptz,
  invited_by uuid references app.app_users(id), invited_at timestamptz,
  disabled_reason text,
  version int not null default 1, created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid,
  constraint chk_user_link check ((user_type = 'employee' and employee_id is not null) or (user_type = 'external' and employee_id is null)),
  constraint chk_external_window check (user_type = 'employee' or (access_end_date is not null and service_provider is not null)),
  constraint chk_window_order check (access_end_date is null or access_end_date >= access_start_date)
);
create index ix_app_users_invited_by on app.app_users (invited_by);

create table app.user_roles (                                                        -- F-ADM-03 (ADM / SA only)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.app_users(id),
  role app.privileged_role not null,
  granted_by uuid not null references app.app_users(id), granted_at timestamptz not null default now(),
  revoked_by uuid references app.app_users(id), revoked_at timestamptz,
  constraint chk_not_self_grant check (granted_by <> user_id and (revoked_by is null or revoked_by <> user_id))
);
create unique index ux_user_roles_active on app.user_roles (user_id, role) where revoked_at is null;
create index ix_user_roles_user on app.user_roles (user_id);
create index ix_user_roles_granted_by on app.user_roles (granted_by);
create index ix_user_roles_revoked_by on app.user_roles (revoked_by);

create table app.user_invitations (                                                  -- own 72-hour invite tokens (ADR-0014)
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.app_users(id),
  token_hash bytea not null unique,                                                   -- SHA-256 of the token; token only in the email
  expires_at timestamptz not null, scheduled_send_at timestamptz,
  sent_at timestamptz, accepted_at timestamptz, revoked_at timestamptz,
  created_by uuid not null, created_at timestamptz not null default now()
);
create index ix_user_invitations_user on app.user_invitations (user_id);

create table app.app_sessions (                                                      -- idle timeout per role (F-ADM-14)
  session_id uuid primary key,                                                        -- = JWT session_id claim
  user_id uuid not null references app.app_users(id),
  created_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  aal text not null default 'aal1', ip inet, user_agent text,
  ended_at timestamptz, end_reason text check (end_reason in ('logout','idle_timeout','disabled','expired','role_change','password_reset'))
);
create index ix_app_sessions_user on app.app_sessions (user_id);
create index ix_app_sessions_user_open on app.app_sessions (user_id) where ended_at is null;

create table app.login_events (                                                      -- F-ADM-13 (SA view)
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  login_email extensions.citext not null, user_id uuid references app.app_users(id),
  outcome app.login_outcome not null, ip inet, user_agent text, detail text
);
create index ix_login_events_email on app.login_events (login_email, occurred_at desc);
create index ix_login_events_user on app.login_events (user_id);

create table app.delegations (                                                       -- F-LV-24, BR-LV-60, F-PRT-14
  id uuid primary key default gen_random_uuid(),
  delegator_user_id uuid not null references app.app_users(id),
  delegate_user_id  uuid not null references app.app_users(id),
  valid_from date not null, valid_to date not null,
  scope app.delegation_scope not null,
  set_by uuid not null references app.app_users(id),
  cancelled_at timestamptz, cancelled_by uuid,
  created_at timestamptz not null default now(),
  constraint chk_delegate_not_self check (delegate_user_id <> delegator_user_id),
  constraint chk_delegation_dates check (valid_to >= valid_from)
);
create index ix_delegations_delegator_window on app.delegations (delegator_user_id, valid_from, valid_to) where cancelled_at is null;
create index ix_delegations_delegator on app.delegations (delegator_user_id);
create index ix_delegations_delegate on app.delegations (delegate_user_id);
create index ix_delegations_set_by on app.delegations (set_by);

-- Derived MGR cache (data-model §6) — created now because role resolution (D11, ADR-0001)
-- needs it; populated by app.apply_current_job() from W2-003. FKs to app.employees added then.
create table app.reporting_closure (
  manager_employee_id uuid not null,
  employee_id uuid not null,
  depth smallint not null check (depth >= 1),
  primary key (manager_employee_id, employee_id)
);
create index ix_reporting_closure_employee on app.reporting_closure (employee_id);

-- ---------------------------------------------------------------------------
-- §10 Files and notifications
-- ---------------------------------------------------------------------------
create table app.files (                                                             -- registry for every Storage object (ADR-0007)
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in ('employee-files','leave-files','claim-files','cr-files','generated','imports','company')),
  storage_path text not null,
  subject app.file_subject not null,
  owner_employee_id uuid,                                                             -- → app.employees(id): FK added by W2-003
  data_category app.data_category,
  original_name text not null check (char_length(original_name) <= 200),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/heic','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/zip')),
  size_bytes int not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 bytea,
  preview_file_id uuid references app.files(id),
  status app.file_status not null default 'pending_upload',
  upload_expires_at timestamptz,
  retention_delete_after date,
  deleted_at timestamptz, deleted_reason text,
  created_at timestamptz not null default now(), created_by uuid not null,
  unique (bucket, storage_path)
);
create index ix_files_owner on app.files (owner_employee_id);
create index ix_files_retention on app.files (retention_delete_after) where status = 'active';
create index ix_files_preview on app.files (preview_file_id);
create index ix_files_created_by on app.files (created_by);

alter table app.company_profile add constraint fk_company_profile_logo foreign key (logo_file_id) references app.files(id);
create index ix_company_profile_logo on app.company_profile (logo_file_id);

create table app.file_access_grants (                                                -- every download passes through a grant
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references app.files(id),
  user_id uuid not null references app.app_users(id),
  purpose text not null check (purpose in ('view','download','bundle','approve_review')),
  reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index ix_file_access_grants_lookup on app.file_access_grants (file_id, user_id, expires_at);
create index ix_file_access_grants_user on app.file_access_grants (user_id);

create table app.notifications (                                                     -- F-NTF-02, F-PRT-13
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references app.app_users(id),
  event_code text not null check (event_code ~ '^N-[0-9]{2}$'),
  title text not null check (char_length(title) <= 150),
  body text check (char_length(body) <= 500),
  link_path text,
  is_action_required boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index ix_notifications_recipient on app.notifications (recipient_user_id, created_at desc);
create index ix_notifications_unread on app.notifications (recipient_user_id) where read_at is null;

create table app.email_outbox (                                                      -- F-NTF-01/07 (transactional outbox, ADR-0010)
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references app.notifications(id),
  to_user_id uuid references app.app_users(id), to_address extensions.citext not null,
  template_code text not null, subject text not null check (char_length(subject) <= 200),
  payload jsonb not null,
  status app.email_status not null default 'pending',
  attempts smallint not null default 0, next_attempt_at timestamptz not null default now(),
  last_error text, provider_message_id text, sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index ix_email_outbox_due on app.email_outbox (next_attempt_at) where status in ('pending','failed');
create index ix_email_outbox_notification on app.email_outbox (notification_id);
create index ix_email_outbox_to_user on app.email_outbox (to_user_id);

create table app.notification_preferences (                                          -- F-NTF-06 (FYI opt-out only)
  user_id uuid not null references app.app_users(id), event_code text not null check (event_code ~ '^N-[0-9]{2}$'),
  email_enabled boolean not null default true,
  primary key (user_id, event_code)
);

-- ---------------------------------------------------------------------------
-- §11 Jobs and private internals
-- ---------------------------------------------------------------------------
create table app.job_runs (                                                          -- ADR-0009
  id uuid primary key default gen_random_uuid(),
  job_name text not null, business_date date not null,
  status app.job_status not null default 'running', attempt smallint not null default 1,
  started_at timestamptz not null default now(), finished_at timestamptz, summary jsonb, error text
);
create unique index ux_job_run_success on app.job_runs (job_name, business_date) where status = 'succeeded';
create index ix_job_runs_name_date on app.job_runs (job_name, business_date desc);

create table private.doc_counters (doc_type text not null, year smallint not null, last_no int not null default 0, primary key (doc_type, year));
create table private.rate_limit_counters (bucket_key text not null, window_start timestamptz not null, hits int not null default 0, primary key (bucket_key, window_start));
create table private.key_versions (key_id smallint primary key, purpose text not null check (purpose in ('field_encryption','blind_index')), activated_at timestamptz not null, retired_at timestamptz);
