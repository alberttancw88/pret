// Kysely table types for the W2-001 foundation schema (supabase/migrations/202611151000xx_*).
// Hand-written until type generation is wired in; keep in step with the migrations.
// numeric → string, date → 'yyyy-mm-dd' string, timestamptz → Date (pg defaults, see pool.ts).
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type CreatedTs = ColumnType<Date, never, never>;

export type UserType = 'employee' | 'external';
export type UserStatus = 'invited' | 'active' | 'locked' | 'disabled' | 'expired';
export type PrivilegedRole = 'ADM' | 'SA';
export type FileStatus = 'pending_upload' | 'active' | 'superseded' | 'deleted';
export type FileSubject =
  | 'employee_document' | 'employee_photo' | 'leave_attachment' | 'claim_receipt' | 'change_request_doc'
  | 'privacy_notice' | 'company_asset' | 'import_source' | 'generated_output' | 'cp38_letter' | 'tp1_doc';
export type DataCategory =
  | 'identity' | 'contact' | 'family' | 'health' | 'religion' | 'bank' | 'statutory' | 'compensation' | 'payslip';
export type AuditAction =
  | 'create' | 'update' | 'status_change' | 'approve' | 'reject' | 'return' | 'cancel' | 'delete_draft' | 'login'
  | 'login_failed' | 'logout' | 'view_sensitive' | 'reveal' | 'download' | 'export' | 'import' | 'config_change'
  | 'payroll_calculate' | 'payroll_approve' | 'payroll_finalise' | 'payroll_reopen' | 'role_change' | 'record_open';
export type LoginOutcome = 'success' | 'failure' | 'locked' | 'mfa_failure' | 'disabled' | 'expired' | 'password_changed';
export type JobStatus = 'running' | 'succeeded' | 'failed';

interface Stamps {
  created_at: CreatedTs;
  created_by: ColumnType<string | null, never, never>;
  updated_at: CreatedTs;
  updated_by: ColumnType<string | null, never, never>;
}

export interface CompanyProfileTable extends Stamps {
  id: Generated<number>;
  legal_name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  biz_addr_line1: string;
  biz_addr_line2: string | null;
  biz_addr_line3: string | null;
  biz_postcode: string;
  biz_city: string;
  biz_state: string;
  biz_country: Generated<string>;
  logo_file_id: string | null;
  version: Generated<number>;
}

export interface SecuritySettingsTable {
  id: Generated<number>;
  idle_timeout_min_employee: number;
  idle_timeout_min_privileged: number;
  lockout_threshold: number;
  lockout_minutes: number;
  mfa_required_privileged: boolean;
  invite_link_hours: number;
  invite_lead_days: number;
  allowed_email_domains: string[];
  updated_at: CreatedTs;
  updated_by: ColumnType<string | null, never, never>;
}

export interface AppUsersTable extends Stamps {
  id: Generated<string>;
  auth_user_id: string | null;
  user_type: UserType;
  employee_id: string | null;
  login_email: string;
  display_name: string;
  status: Generated<UserStatus>;
  access_start_date: string;
  access_end_date: string | null;
  service_provider: string | null;
  mfa_enrolled: Generated<boolean>;
  last_login_at: Timestamp | null;
  failed_login_count: Generated<number>;
  locked_until: Timestamp | null;
  invited_by: string | null;
  invited_at: Timestamp | null;
  disabled_reason: string | null;
  version: Generated<number>;
}

export interface UserRolesTable {
  id: Generated<string>;
  user_id: string;
  role: PrivilegedRole;
  granted_by: string;
  granted_at: Generated<Date>;
  revoked_by: string | null;
  revoked_at: Timestamp | null;
}

export interface UserInvitationsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  expires_at: Timestamp;
  scheduled_send_at: Timestamp | null;
  sent_at: Timestamp | null;
  accepted_at: Timestamp | null;
  revoked_at: Timestamp | null;
  created_by: string;
  created_at: Generated<Date>;
}

export interface AppSessionsTable {
  session_id: string;
  user_id: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  aal: Generated<string>;
  ip: string | null;
  user_agent: string | null;
  ended_at: Timestamp | null;
  end_reason: string | null;
}

export interface LoginEventsTable {
  id: Generated<string>;
  occurred_at: Generated<Date>;
  login_email: string;
  user_id: string | null;
  outcome: LoginOutcome;
  ip: string | null;
  user_agent: string | null;
  detail: string | null;
}

export interface FilesTable {
  id: Generated<string>;
  bucket: string;
  storage_path: string;
  subject: FileSubject;
  owner_employee_id: string | null;
  data_category: DataCategory | null;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: Buffer | null;
  preview_file_id: string | null;
  status: Generated<FileStatus>;
  upload_expires_at: Timestamp | null;
  retention_delete_after: string | null;
  deleted_at: Timestamp | null;
  deleted_reason: string | null;
  created_at: Generated<Date>;
  created_by: string;
}

export interface FileAccessGrantsTable {
  id: Generated<string>;
  file_id: string;
  user_id: string;
  purpose: 'view' | 'download' | 'bundle' | 'approve_review';
  reason: string | null;
  expires_at: Timestamp;
  created_at: Generated<Date>;
}

export interface NotificationsTable {
  id: Generated<string>;
  recipient_user_id: string;
  event_code: string;
  title: string;
  body: string | null;
  link_path: string | null;
  is_action_required: Generated<boolean>;
  read_at: Timestamp | null;
  created_at: Generated<Date>;
}

export interface JobRunsTable {
  id: Generated<string>;
  job_name: string;
  business_date: string;
  status: Generated<JobStatus>;
  attempt: Generated<number>;
  started_at: Generated<Date>;
  finished_at: Timestamp | null;
  summary: unknown | null;
  error: string | null;
}

export interface DB {
  'app.company_profile': CompanyProfileTable;
  'app.security_settings': SecuritySettingsTable;
  'app.app_users': AppUsersTable;
  'app.user_roles': UserRolesTable;
  'app.user_invitations': UserInvitationsTable;
  'app.app_sessions': AppSessionsTable;
  'app.login_events': LoginEventsTable;
  'app.files': FilesTable;
  'app.file_access_grants': FileAccessGrantsTable;
  'app.notifications': NotificationsTable;
  'app.job_runs': JobRunsTable;
}
