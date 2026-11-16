// PRET contract — M6 Users, roles, access & audit (W2-002). Screens A5–A11.
// Types + zod only (client-safe). Implementations:
//   queries  → src/server/queries/users.ts, src/server/queries/audit.ts (server-only)
//   actions  → src/server/actions/users.ts ('use server')
// Scope rules (BR-ADM-01, D11): SA manages everyone; ADM sees and manages only EMPLOYEE users
// holding no privileged role (enforced by requireUser + RLS + DB guards). Nobody changes their
// own roles/status; the last active Super Admin cannot be revoked or disabled (EC-ADM-01).
// Employee-user invites need employee records → W2-003 (the action returns a clear failure).
import { z } from 'zod';
import {
  booleanSchema, isoDateSchema, multi, optionalText, pageParamsSchema, requiredText, uuidSchema,
  type Stamps,
} from './common';

export * from './common';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const USER_TYPES = ['employee', 'external'] as const;
export type UserType = (typeof USER_TYPES)[number];
export const USER_TYPE_LABELS: Record<UserType, string> = { employee: 'Employee user', external: 'External administrator' };

export const USER_STATUSES = ['invited', 'active', 'locked', 'disabled', 'expired'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  invited: 'Invited', active: 'Active', locked: 'Locked', disabled: 'Disabled', expired: 'Expired',
};

export const PRIVILEGED_ROLES = ['ADM', 'SA'] as const;
export type PrivilegedRole = (typeof PRIVILEGED_ROLES)[number];
export const ROLE_LABELS: Record<'SA' | 'ADM' | 'MGR' | 'EMP', string> = {
  SA: 'Super Admin', ADM: 'Admin', MGR: 'Manager', EMP: 'Employee',
};

export const LOGIN_OUTCOMES = ['success', 'failure', 'locked', 'mfa_failure', 'disabled', 'expired'] as const;
export type LoginOutcome = (typeof LOGIN_OUTCOMES)[number];
export const LOGIN_OUTCOME_LABELS: Record<LoginOutcome, string> = {
  success: 'Success', failure: 'Failed', locked: 'Locked', mfa_failure: 'Two-factor failed', disabled: 'Disabled', expired: 'Expired',
};

export const AUDIT_ACTIONS = [
  'create', 'update', 'status_change', 'approve', 'reject', 'return', 'cancel', 'delete_draft', 'login', 'login_failed',
  'logout', 'view_sensitive', 'reveal', 'download', 'export', 'import', 'config_change', 'payroll_calculate',
  'payroll_approve', 'payroll_finalise', 'payroll_reopen', 'role_change', 'record_open',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Create', update: 'Update', status_change: 'Status change', approve: 'Approve', reject: 'Reject', return: 'Return',
  cancel: 'Cancel', delete_draft: 'Delete draft', login: 'Login', login_failed: 'Login failed', logout: 'Logout',
  view_sensitive: 'View sensitive', reveal: 'Reveal', download: 'Download', export: 'Export', import: 'Import',
  config_change: 'Config change', payroll_calculate: 'Payroll calculate', payroll_approve: 'Payroll approve',
  payroll_finalise: 'Payroll finalise', payroll_reopen: 'Payroll re-open', role_change: 'Role change', record_open: 'Record opened',
};

export const DATA_CATEGORIES = ['identity', 'contact', 'family', 'health', 'religion', 'bank', 'statutory', 'compensation', 'payslip'] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];
export const DATA_CATEGORY_LABELS: Record<DataCategory, string> = {
  identity: 'Identity', contact: 'Contact', family: 'Family', health: 'Health', religion: 'Religion',
  bank: 'Bank', statutory: 'Statutory', compensation: 'Compensation', payslip: 'Payslip',
};

// ===========================================================================
// A5 Users list (F-ADM-01) — /users  [ADM, SA]
// ===========================================================================
export const userListParamsSchema = pageParamsSchema.extend({
  userType: z.enum(USER_TYPES).optional().catch(undefined),
  role: z.enum(['ADM', 'SA', 'none']).optional().catch(undefined),
  status: multi(z.enum(USER_STATUSES)),
  lastLoginFrom: isoDateSchema.optional().catch(undefined),
  lastLoginTo: isoDateSchema.optional().catch(undefined),
  mfa: z.enum(['enrolled', 'not_enrolled']).optional().catch(undefined),
  sort: z.enum(['displayName', 'loginEmail', 'userType', 'status', 'lastLogin', 'accessEnd']).default('displayName'),
});
export type UserListParams = z.input<typeof userListParamsSchema>;

export type UserRow = {
  id: string;
  displayName: string;                  // U2
  loginEmail: string;                   // U1
  userType: UserType;                   // U3
  employeeId: string | null;            // U4
  employeeNo: string | null;            // W2-003
  employeeName: string | null;          // W2-003
  roles: PrivilegedRole[];              // U5 (held privileged roles)
  /** MGR is derived: direct reportees (0 → not a manager). Shown as "Manager (n reportees)". */
  directReportees: number;
  /** Effective status: 'locked' while locked_until is in the future; 'expired' once the access end date has passed. */
  status: UserStatus;                   // U6
  lastLoginAt: string | null;           // U14
  mfaEnrolled: boolean;                 // U13
  accessStartDate: string;              // U7
  accessEndDate: string | null;         // U8
  serviceProvider: string | null;       // U9
};

export type UserInvitationInfo = {
  status: 'pending' | 'scheduled' | 'expired' | 'accepted' | 'revoked';
  createdAt: string; scheduledSendAt: string | null; sentAt: string | null; expiresAt: string; acceptedAt: string | null;
};

// ===========================================================================
// A7 User detail (F-ADM-03/04/05/07/13) — /users/{id}  [ADM (scope), SA]
// ===========================================================================
export type UserDetail = UserRow & {
  failedLoginCount: number;             // U14
  lockedUntil: string | null;
  disabledReason: string | null;
  invitedAt: string | null; invitedByName: string | null;   // U15
  invitation: UserInvitationInfo | null;
  /** SA only (empty for ADM). */
  roleHistory: { role: PrivilegedRole; grantedAt: string; grantedByName: string | null; revokedAt: string | null; revokedByName: string | null }[];
  isSelf: boolean;
  /** Server-computed UI capabilities — enforcement is in actions, RLS and DB guards. */
  can: {
    editAccount: boolean; editRoles: boolean; editAccessWindow: boolean;
    disable: boolean; enable: boolean; unlock: boolean; sendPasswordReset: boolean;
    resetMfa: boolean; resendInvite: boolean; viewLoginHistory: boolean;
  };
} & Stamps;

export const loginHistoryParamsSchema = pageParamsSchema.extend({
  userId: uuidSchema,
  outcome: multi(z.enum(LOGIN_OUTCOMES)),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type LoginHistoryParams = z.input<typeof loginHistoryParamsSchema>;
export type LoginEventRow = { id: string; occurredAt: string; outcome: LoginOutcome; ip: string | null; userAgent: string | null; detail: string | null };

// ===========================================================================
// A6 Invite user (F-ADM-02, F-ADM-04) — /users/new
// ===========================================================================
const loginEmailSchema = z.string({ error: 'Login email is required.' }).trim().toLowerCase()
  .pipe(z.email('Enter a valid email address.').max(254));

export const inviteEmployeeUserSchema = z.object({
  userType: z.literal('employee'),
  employeeId: uuidSchema,                                             // U4 (employees without a user)
  displayName: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
    z.string().max(100).optional()),                                  // U2 (default preferred + surname)
  roles: z.array(z.enum(PRIVILEGED_ROLES)).default([]),               // U5 (SA only)
  accessStartDate: isoDateSchema,                                     // U7
  sendMode: z.enum(['now', 'schedule']).default('now'),
  scheduledSendDate: isoDateSchema.optional(),
}).refine((v) => v.sendMode === 'now' || !!v.scheduledSendDate, { path: ['scheduledSendDate'], message: 'Choose the send date.' });

export const inviteExternalUserSchema = z.object({
  userType: z.literal('external'),
  loginEmail: loginEmailSchema,                                       // U1
  displayName: requiredText(100, 'Display name'),                     // U2
  serviceProvider: requiredText(150, 'Service provider'),             // U9
  accessStartDate: isoDateSchema,                                     // U7
  accessEndDate: isoDateSchema,                                       // U8 (auto-expiry)
}).refine((v) => v.accessEndDate >= v.accessStartDate, { path: ['accessEndDate'], message: 'Access end must be on or after access start.' });

export const inviteUserSchema = z.discriminatedUnion('userType', [inviteEmployeeUserSchema, inviteExternalUserSchema]);
export type InviteUserInput = z.input<typeof inviteUserSchema>;
/** emailSent false = account + invitation created but the email could not be sent (e.g. email not configured): use RESEND INVITE later. */
export type InviteUserResult = { userId: string; emailSent: boolean; expiresAt: string; message: string };

/** Employees without a user account, for the U4 picker — always [] with available=false until W2-003. */
export type InvitableEmployee = { employeeId: string; employeeNo: string; name: string; workEmail: string; suggestedDisplayName: string; joinDate: string | null };
export type InvitableEmployees = { available: boolean; message: string | null; rows: InvitableEmployee[] };

// ===========================================================================
// A7 actions
// ===========================================================================
export const userIdSchema = z.object({ userId: uuidSchema });
export type UserIdInput = z.input<typeof userIdSchema>;

export const saveUserRolesSchema = z.object({
  userId: uuidSchema,
  roles: z.array(z.enum(PRIVILEGED_ROLES)).max(2).transform((r) => [...new Set(r)]),
});
export type SaveUserRolesInput = z.input<typeof saveUserRolesSchema>;
export type SaveUserRolesResult = { granted: PrivilegedRole[]; revoked: PrivilegedRole[] };

/** U1 (only while Invited — the address is the sign-in identity once accepted), U2, U9 (external). SA only. */
export const updateUserAccountSchema = z.object({
  userId: uuidSchema,
  displayName: requiredText(100, 'Display name'),
  loginEmail: loginEmailSchema.optional(),
  serviceProvider: optionalText(150, 'Service provider'),
});
export type UpdateUserAccountInput = z.input<typeof updateUserAccountSchema>;

/** U7/U8 — SA. Extending an Expired user's end date re-activates them (EC-ADM-02). External users need an end date. */
export const updateAccessWindowSchema = z.object({
  userId: uuidSchema,
  accessStartDate: isoDateSchema,
  accessEndDate: z.preprocess((v) => (v === '' || v === undefined ? null : v), isoDateSchema.nullable()),
}).refine((v) => !v.accessEndDate || v.accessEndDate >= v.accessStartDate, { path: ['accessEndDate'], message: 'Access end must be on or after access start.' });
export type UpdateAccessWindowInput = z.input<typeof updateAccessWindowSchema>;

export const disableUserSchema = z.object({ userId: uuidSchema, reason: requiredText(500, 'Reason') });
export type DisableUserInput = z.input<typeof disableUserSchema>;

// ===========================================================================
// A8 Role permission reference (F-ADM-08) — /users/roles  [ADM, SA]  (static, PRD §16)
// ===========================================================================
export type RolePermissionRow = { group: string; EMP: string; MGR: string; ADM: string; SA: string };
export const ROLE_PERMISSION_LEGEND =
  'C create · R read · U update · A approve/decide · X export/download · ✗ none. Scope: o = own · t = team (reportees) · a = all.';
export const ROLE_DESCRIPTIONS: { role: 'EMP' | 'MGR' | 'ADM' | 'SA'; name: string; description: string }[] = [
  { role: 'EMP', name: 'Employee', description: 'Every employee user automatically. Self-service: own profile, leave, claims, payslips.' },
  { role: 'MGR', name: 'Manager', description: 'Derived from the reporting line (anyone with reportees, or an active delegate). Approves reportees’ leave and claims.' },
  { role: 'ADM', name: 'Admin', description: 'HR, finance and payroll administration (assigned by a Super Admin). May be an Interact employee or the external administrator.' },
  { role: 'SA', name: 'Super Admin', description: 'Everything, including control settings, roles, audit and access logs. At least one must remain.' },
];
export const ROLE_PERMISSION_MATRIX: RolePermissionRow[] = [
  { group: 'Employee list / master report (F-EMP-01, F-RPT-02)', EMP: '✗', MGR: 'R t (limited columns)', ADM: 'C R U X a', SA: 'C R U X a' },
  { group: 'Personal, contact, emergency (A, B, C)', EMP: 'R o; U o (E✎)', MGR: 'R t (name, phone, emergency)', ADM: 'R U a (own E→CR fields via CR only)', SA: 'R U a' },
  { group: 'MyKad reveal', EMP: 'R o', MGR: '✗', ADM: 'R a (logged, reason)', SA: 'R a (logged)' },
  { group: 'Religion / OKU (sensitive)', EMP: 'R o', MGR: '✗', ADM: 'R U a', SA: 'R U a' },
  { group: 'Family (D, E)', EMP: 'R o; CR', MGR: '✗', ADM: 'R U a (not own)', SA: 'R U a (not own)' },
  { group: 'Employment & job history (F, JH)', EMP: 'R o', MGR: 'R t (limited)', ADM: 'C R U a', SA: 'C R U a' },
  { group: 'Separation (G)', EMP: 'R o (dates, type)', MGR: 'R t (dates)', ADM: 'C R U a', SA: 'C R U a' },
  { group: 'Statutory & payroll-deduction profile (H)', EMP: 'R o (excl. employer-only flags); CR', MGR: '✗', ADM: 'R U a (not own)', SA: 'R U a (not own)' },
  { group: 'Bank & ASNB (I)', EMP: 'R o masked; CR', MGR: '✗', ADM: 'R U a (not own; reveal logged; change notified to employee + SA)', SA: 'R U a (not own)' },
  { group: 'Compensation (J / F-PAY-04, R1.1)', EMP: 'R o (basic)', MGR: '✗', ADM: 'C R U a (not own)', SA: 'C R U a' },
  { group: 'Documents (K)', EMP: 'R X o (visible ones)', MGR: '✗', ADM: 'C R U X a', SA: 'C R U X a' },
  { group: 'HR notes (L1)', EMP: '✗', MGR: '✗', ADM: 'C R U a', SA: 'C R U a' },
  { group: 'Change requests (F-EMP-19)', EMP: 'C R o', MGR: '✗', ADM: 'R A a (not own)', SA: 'R A a (not own)' },
  { group: 'Leave types, bands, policy, workflows (F-LV-01–03, 32)', EMP: 'R (names)', MGR: 'R (names)', ADM: 'C R U a', SA: 'C R U a' },
  { group: 'Apply / withdraw / cancel leave (F-LV-05/08/10)', EMP: 'C U o', MGR: 'C U o', ADM: 'C U a (on behalf)', SA: 'C U a' },
  { group: 'Approve leave / cancellation / replacement credit', EMP: '✗', MGR: 'A t (routed)', ADM: 'A a (Admin level, override; not own)', SA: 'A a (not own)' },
  { group: 'Leave balances & ledger', EMP: 'R o', MGR: 'R t', ADM: 'R a', SA: 'R a' },
  { group: 'Balance adjustment, roll-over (F-LV-18/19)', EMP: '✗', MGR: '✗', ADM: 'C a (not own)', SA: 'C a (not own)' },
  { group: 'Team calendar (F-LV-23)', EMP: 'R a (no type)', MGR: 'R t (with type)', ADM: 'R a', SA: 'R a' },
  { group: 'MC / medical attachments', EMP: 'R o', MGR: 'R t (item being approved, logged)', ADM: 'R a (logged)', SA: 'R a (logged)' },
  { group: 'Claim categories & limits (F-CLM-01/02)', EMP: 'R (names, own limits)', MGR: 'R', ADM: 'C R U a', SA: 'C R U a' },
  { group: 'Create / edit / delete (New) / submit / withdraw / copy claim', EMP: 'C U o', MGR: 'C U o', ADM: 'C a (on behalf)', SA: 'C U o' },
  { group: 'Approve / reject claim — single level (F-CLM-09, D12)', EMP: '✗', MGR: 'A t (reportees; not own)', ADM: 'A a (not own)', SA: 'A a (not own)' },
  { group: 'Cancel approved claim before disbursement (F-CLM-30)', EMP: '✗', MGR: 'A t (not own)', ADM: 'A a (not own)', SA: 'A a (not own)' },
  { group: 'Claims list / reports / attachment zip', EMP: 'R o', MGR: 'R t', ADM: 'R X a', SA: 'R X a' },
  { group: 'Month-end disbursement batches, HLB payment list, AutoCount claims export, undo disbursement', EMP: '✗', MGR: '✗', ADM: 'C U X a', SA: 'R X a; A (batch approval, only if setting on)' },
  { group: 'Payroll settings, pay items, statutory tables (F-PAY-01–05)', EMP: '✗', MGR: '✗', ADM: 'C R U a', SA: 'C R U a + verify tables' },
  { group: 'Payroll run: create, inputs, calculate, submit, finalise', EMP: '✗', MGR: '✗', ADM: 'C U a', SA: 'C U a' },
  { group: 'Payroll run: approve / return / re-open', EMP: '✗', MGR: '✗', ADM: '✗', SA: 'A a (not as preparer)' },
  { group: 'Payslips, YTD, EA forms', EMP: 'R X o', MGR: '✗', ADM: 'R X a', SA: 'R X a' },
  { group: 'Statutory outputs, salary payment list, AutoCount payroll journal, payroll reports', EMP: '✗', MGR: '✗', ADM: 'R X a', SA: 'R X a' },
  { group: 'Organisation masters, PH calendars (F-ORG-02–11)', EMP: 'R (PH calendar)', MGR: 'R', ADM: 'C R U a', SA: 'C R U a' },
  { group: 'Company profile & statutory employer numbers (F-ORG-01)', EMP: 'R (name/logo)', MGR: 'R', ADM: 'R (non-statutory U)', SA: 'C R U a' },
  { group: 'System settings (F-ORG-12)', EMP: '✗', MGR: '✗', ADM: 'R (leave, claims, payroll operating settings U)', SA: 'R U a (incl. control settings)' },
  { group: 'Users & roles (F-ADM-01–05)', EMP: '✗', MGR: '✗', ADM: 'C U a (employee users without privileged roles)', SA: 'C R U a' },
  { group: 'Audit & access logs (F-ADM-09–11)', EMP: '✗', MGR: '✗', ADM: '✗', SA: 'R X a' },
  { group: 'Company privacy notice (F-ADM-15)', EMP: 'R', MGR: 'R', ADM: 'C R U', SA: 'C R U' },
  { group: 'DSR log, breach extract, retention (F-ADM-16–18)', EMP: '✗', MGR: '✗', ADM: 'R (DSR log)', SA: 'C R U X a' },
  { group: 'Imports (M9)', EMP: '✗', MGR: '✗', ADM: 'C a (all templates)', SA: 'C a' },
  { group: 'Dashboards', EMP: 'Home', MGR: 'Manager', ADM: 'Admin', SA: 'All' },
];

// ===========================================================================
// A9 Audit & access log (F-ADM-09/10/11) — /audit  [SA only]
// ===========================================================================
export const auditListParamsSchema = pageParamsSchema.extend({
  from: isoDateSchema,                                   // required (default last 7 days in the UI)
  to: isoDateSchema,
  actorUserId: uuidSchema.optional().catch(undefined),
  externalOnly: booleanSchema.default(false),
  actions: multi(z.enum(AUDIT_ACTIONS)),
  entityType: z.string().trim().max(60).optional().catch(undefined),
  employeeId: uuidSchema.optional().catch(undefined),
  categories: multi(z.enum(DATA_CATEGORIES)),
  /** searches entity reference */
  dir: z.enum(['asc', 'desc']).default('desc'),
}).refine((v) => v.to >= v.from, { path: ['to'], message: '"To" must be on or after "From".' });
export type AuditListParams = z.input<typeof auditListParamsSchema>;

export type AuditSource = 'audit' | 'access';
export type AuditRow = {
  key: string;                          // `${source}:${id}` — stable React key + detail reference
  source: AuditSource;                  // audit_log (data changes) or access_log (views/exports)
  id: string;
  occurredAt: string;                   // AU1 (display dd/mm/yyyy HH:mm:ss MYT)
  actorUserId: string | null;           // AU2
  actorName: string | null;
  actorUserType: UserType | null;
  actorRoles: string[];
  actorLabel: string | null;            // 'system:<job>' for jobs
  action: AuditAction;                  // AU4
  entityType: string;                   // AU5
  entityId: string | null;
  entityRef: string | null;
  employeeIds: string[];                // AU6 (names after W2-003)
  dataCategories: DataCategory[];       // AU10
  reason: string | null;                // AU8
};
export type AuditChange = { field: string; before: string | null; after: string | null; masked: boolean };
export type AuditEntryDetail = AuditRow & {
  changes: AuditChange[];               // AU7 (audit source); masked unless revealed
  fields: string[];                     // access source: fields viewed
  recordCount: number | null;
  ip: string | null; userAgent: string | null; requestId: string | null;   // AU9
  onBehalfEmployeeId: string | null;    // AU3
  fileId: string | null;
  revealed: boolean;
};
export const auditEntryRefSchema = z.object({ source: z.enum(['audit', 'access']), id: z.string().regex(/^[0-9]{1,18}$/, 'Invalid reference.') });
export type AuditEntryRef = z.input<typeof auditEntryRefSchema>;
export const revealAuditEntrySchema = auditEntryRefSchema.extend({ reason: requiredText(500, 'Reason') });
export type RevealAuditEntryInput = z.input<typeof revealAuditEntrySchema>;
export type AuditFilterOptions = { actors: { id: string; displayName: string; userType: UserType }[]; entityTypes: string[] };

// ===========================================================================
// A10 Access review (F-ADM-12) — /audit/access-review  [SA]
// ===========================================================================
export const monthSchema = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Select a month.');   // 'yyyy-mm'
export type AccessReview = {
  month: string;                        // 'yyyy-mm'
  users: { userId: string; displayName: string; userType: UserType; roles: string[]; status: UserStatus; lastLoginAt: string | null; daysSinceLogin: number | null }[];
  externalUsers: { userId: string; displayName: string; serviceProvider: string | null; accessEndDate: string | null; recordsOpened: number; sensitiveViews: number; exports: number }[];
  flags: { kind: 'bank_change_and_payment_export' | 'sa_own_compensation_change' | 'privileged_role_change'; occurredAt: string; actorName: string | null; description: string }[];
  review: { reviewedAt: string; reviewedByName: string | null; remarks: string | null } | null;
};
export const accessReviewMonthSchema = z.object({ month: monthSchema });
export const markAccessReviewedSchema = z.object({ month: monthSchema, remarks: optionalText(1000, 'Remarks') });
export type MarkAccessReviewedInput = z.input<typeof markAccessReviewedSchema>;

// ===========================================================================
// A11 Company privacy notice (F-ADM-15) — /privacy/notice  [view: all users; publish: ADM, SA]
// ===========================================================================
export type PrivacyNotice = {
  id: string; title: string; bodyText: string | null; fileId: string | null; fileName: string | null;
  effectiveDate: string; isCurrent: boolean; publishedAt: string; publishedByName: string | null; supersededAt: string | null;
};
/** Body text is plain text (paragraphs separated by blank lines) — rendered as text, never as HTML. */
export const publishPrivacyNoticeSchema = z.object({
  title: requiredText(100, 'Title'),
  bodyText: optionalText(20000, 'Body text'),
  fileId: z.preprocess((v) => (v === '' || v === undefined ? null : v), uuidSchema.nullable()),
  effectiveDate: isoDateSchema,
}).refine((v) => !!v.bodyText || !!v.fileId, { path: ['bodyText'], message: 'Enter body text or attach a PDF (at least one).' });
export type PublishPrivacyNoticeInput = z.input<typeof publishPrivacyNoticeSchema>;
export const requestPrivacyNoticeUploadSchema = z.object({
  fileName: requiredText(200, 'File name'),
  mimeType: z.literal('application/pdf', { error: 'Upload a PDF.' }),
  sizeBytes: z.coerce.number().int().min(1).max(10 * 1024 * 1024, 'The file must be 10 MB or smaller.'),
});
export type RequestPrivacyNoticeUploadInput = z.input<typeof requestPrivacyNoticeUploadSchema>;

// ===========================================================================
// FUNCTION REGISTER (exact names and signatures)
// ===========================================================================
// QUERIES — src/server/queries/users.ts (server-only)
//   listUsers(p: UserListParams): Promise<Paged<UserRow>>                               [ADM (scope), SA]
//   getUser(id: string): Promise<UserDetail | null>                                     [ADM (scope), SA]
//   listUserLoginHistory(p: LoginHistoryParams): Promise<Paged<LoginEventRow>>          [SA]
//   listInvitableEmployees(): Promise<InvitableEmployees>                               [ADM, SA]  (W2-003)
//   getRolePermissionMatrix(): Promise<{ roles: typeof ROLE_DESCRIPTIONS; rows: RolePermissionRow[]; legend: string }>  [ADM, SA]
//   getCurrentPrivacyNotice(): Promise<PrivacyNotice | null>                            [any signed-in user]
//   listPrivacyNoticeHistory(): Promise<PrivacyNotice[]>                                [any signed-in user] (S-GL-09 shows history to all)
// QUERIES — src/server/queries/audit.ts (server-only)
//   listAuditEntries(p: AuditListParams): Promise<Paged<AuditRow>>                      [SA]
//   getAuditEntry(ref: AuditEntryRef): Promise<AuditEntryDetail | null>                 [SA] (masked)
//   getAuditFilterOptions(): Promise<AuditFilterOptions>                                [SA]
//   getAccessReview(month: string): Promise<AccessReview>                               [SA]
//
// SERVER ACTIONS — src/server/actions/users.ts ('use server')
//   A6  inviteUser(i: InviteUserInput): Promise<ActionResult<InviteUserResult>>   external: [SA]; employee: [ADM, SA] → fails until W2-003
//   A7  resendInvite(i: UserIdInput): Promise<ActionResult<InviteUserResult>>                         [ADM (scope), SA]
//       saveUserRoles(i: SaveUserRolesInput): Promise<ActionResult<SaveUserRolesResult>>              [SA]
//       updateUserAccount(i: UpdateUserAccountInput): Promise<ActionResult>                           [SA]
//       updateUserAccessWindow(i: UpdateAccessWindowInput): Promise<ActionResult>                     [SA]
//       disableUser(i: DisableUserInput): Promise<ActionResult>                                       [ADM (scope), SA]
//       enableUser(i: UserIdInput): Promise<ActionResult<{ status: UserStatus }>>                     [ADM (scope), SA]
//       unlockUser(i: UserIdInput): Promise<ActionResult>                                             [ADM (scope), SA]
//       sendPasswordReset(i: UserIdInput): Promise<ActionResult>                                      [ADM (scope), SA]
//       resetUserMfa(i: UserIdInput): Promise<ActionResult>   (needs SUPABASE_SECRET_KEY)             [SA]
//   A5  exportUsersCsv(p: UserListParams): Promise<ActionResult<CsvFile>>                             [ADM (scope), SA]
//       exportLoginHistoryCsv(p: LoginHistoryParams): Promise<ActionResult<CsvFile>>                  [SA]
//   A8  exportRolePermissionMatrixCsv(): Promise<ActionResult<CsvFile>>                               [ADM, SA]
//   A9  revealAuditEntry(i: RevealAuditEntryInput): Promise<ActionResult<{ entry: AuditEntryDetail }>> [SA] (logged)
//       exportAuditEntriesCsv(p: AuditListParams): Promise<ActionResult<CsvFile>>                     [SA] (logged)
//   A10 markAccessReviewed(i: MarkAccessReviewedInput): Promise<ActionResult>                         [SA]
//       exportAccessReviewCsv(i: { month }): Promise<ActionResult<CsvFile>>                           [SA] (logged)
//   A11 requestPrivacyNoticeUpload(i: RequestPrivacyNoticeUploadInput): Promise<ActionResult<UploadIntent>>  [ADM, SA]
//       confirmPrivacyNoticeUpload(i: { fileId }): Promise<ActionResult<{ fileId: string }>>          [ADM, SA]
//       publishPrivacyNotice(i: PublishPrivacyNoticeInput): Promise<ActionResult<{ id: string }>>     [ADM, SA]
//       getPrivacyNoticeFileUrl(i: { noticeId }): Promise<ActionResult<{ url: string; fileName: string }>>  [any signed-in user]
