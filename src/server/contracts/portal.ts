// PRET contract — M4 Employee self-service portal, remaining screens (W2-006).
//   P11 Public holidays (/my/holidays, F-PRT-10) · P20 Download my data (/my/data-export, F-PRT-16, PDPA)
//   G5 Notification centre (bell panel + /notifications, F-PRT-13, F-NTF-02) · shell status (bell count, privacy link)
//   G6 Account settings (/account, F-PRT-14): password, notification preferences (F-NTF-06), two-factor status.
//       The Delegation tab REUSES ./approvals: listMyDelegations (query), saveMyDelegation / endMyDelegation /
//       searchApproverOptions (actions) — no new delegation functions.
//   G7 Privacy notice (/privacy-notice, F-ADM-15) REUSES ./users: getCurrentPrivacyNotice, listPrivacyNoticeHistory
//       (queries, any signed-in user) and getPrivacyNoticeFileUrl (action, any signed-in user).
// Types + zod only (client-safe — no database or server code). Implementations:
//   queries → src/server/queries/portal.ts (server-only)   actions → src/server/actions/portal.ts ('use server')
//
// Role rules (PRD §8.3, FR-PRT-12; rls-policies §5.7):
//   * Every user sees only their OWN notifications, preferences, data exports and delegations (RLS: recipient / user /
//     requester = me). Nobody — not ADM, not SA — can read another user's notifications or download another user's
//     data export.
//   * "My" items (P11, P20) need an employee record. External administrators (and the Super Admin before their employee
//     record exists) get `hasEmployeeRecord: false` / "Not found or no access" — the UI hides those nav items.
//   * Notifications, preferences, password and privacy notice: every signed-in user incl. External ADM.
// Dates 'yyyy-mm-dd'; instants ISO-8601 (UTC). The UI formats dd/mm/yyyy and dd/mm/yyyy HH:mm.
import { z } from 'zod';
import { isoDateSchema, multi, pageParamsSchema, uuidSchema, type MyState, type Paged } from './common';
import { HOLIDAY_TYPES, type HolidayType } from './org';

export * from './common';
export { HOLIDAY_TYPES, HOLIDAY_TYPE_LABELS, type HolidayType } from './org';

const labels = <T extends string>(m: Record<T, string>) => m;

// ===========================================================================
// P11 Public holidays — published calendar of MY state (work location, or the F20 PH-state override) and a year
// ===========================================================================
export const myHolidaysParamsSchema = pageParamsSchema.extend({
  /** default: the current year (Malaysia time) */
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  types: multi(z.enum(HOLIDAY_TYPES)),
  sort: z.enum(['date', 'name']).default('date'),
});
export type MyHolidaysParams = z.input<typeof myHolidaysParamsSchema>;

export type MyHolidayRow = {
  /** public_holidays.id, or replacement_holidays.id for kind 'replacement' */
  id: string;
  kind: 'holiday' | 'replacement';
  date: string;
  /** 'Monday' … 'Sunday' */
  day: string;
  /** replacement rows: "Replacement holiday (Hari Raya Aidilfitri)" */
  name: string;
  /** National / State / Replacement / Company / Special declared — HOLIDAY_TYPE_LABELS */
  type: HolidayType;
  isHalfDay: boolean;
  /** replacement rows: the holiday it replaces */
  replacesName: string | null;
  replacesDate: string | null;
  isPast: boolean;
};

export type MyHolidaysPage = {
  hasEmployeeRecord: boolean;
  state: MyState | null;
  stateLabel: string | null;
  year: number;
  /** false → show "The {year} calendar has not been published yet." (BR-ORG-25) and no rows */
  published: boolean;
  unpublishedNote: string | null;
  /** years with a published calendar (year ▾), plus the current year */
  years: number[];
  /** list view — search / type filter / sort / pagination applied */
  page: Paged<MyHolidayRow>;
  /** calendar view — every row of the year matching the search and type filter (unpaged; ≤ ~40 rows) */
  calendar: MyHolidayRow[];
};

// ===========================================================================
// P20 Download my data (F-PRT-16, PDPA s12 / s43A)
// Format (system-design §ADR-0011 row "Download my data"): one .zip containing
//   my-data.json         — machine-readable, every field (portability)
//   my-data-summary.pdf  — human-readable summary
// Includes: profile (identity incl. full MyKad, contact, addresses, employment, job history, statutory numbers),
// family (spouses, children incl. full MyKad), emergency contacts, bank / payment details (full account no.),
// religion / OKU, documents list (names only), leave (applications, balances, credits), claims (claims + lines),
// change requests; payslips from R1.1. Generated server-side, stored privately (bucket "generated"), downloadable only
// by the requester through a 60-second signed URL. Every generation and every download is access-logged.
// Never emailed. Files are available for MY_DATA_EXPORT_AVAILABLE_DAYS days, then show "Expired".
// ===========================================================================
export const MY_DATA_EXPORT_AVAILABLE_DAYS = 7;
/** At most this many generations per day (Malaysia time) — the file is heavy to build. */
export const MY_DATA_EXPORT_DAILY_LIMIT = 3;

export const DATA_EXPORT_STATUSES = ['preparing', 'ready', 'expired', 'failed'] as const;
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];
export const DATA_EXPORT_STATUS_LABELS = labels<DataExportStatus>({ preparing: 'Preparing', ready: 'Ready', expired: 'Expired', failed: 'Failed' });
export const DATA_EXPORT_STATUS_TONE = labels<DataExportStatus>({ preparing: 'info', ready: 'success', expired: 'grey', failed: 'error' });

export const MY_DATA_EXPORT_INTRO =
  'Download a copy of your personal data held in PRET: profile, family, leave, claims. The file is available here only (not emailed).';
export const MY_DATA_EXPORT_SECTIONS = [
  'Profile (personal, contact, employment, job history, statutory numbers)',
  'Family and emergency contacts',
  'Bank and payment details',
  'Documents list',
  'Leave applications, balances and replacement credits',
  'Claims and claim lines',
  'Change requests',
] as const;

export type MyDataExportRow = {
  id: string;
  requestedAt: string;
  status: DataExportStatus;
  /** set when Ready (and kept when Expired) */
  availableUntil: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  canDownload: boolean;
  /** Failed: a readable reason */
  error: string | null;
};

export type MyDataExportPage = {
  hasEmployeeRecord: boolean;
  intro: string;
  sections: readonly string[];
  availableDays: number;
  /** newest first, last 20 requests */
  rows: MyDataExportRow[];
  canGenerate: boolean;
  /** why GENERATE MY DATA FILE is disabled ("A file is being prepared." / "You can generate up to 3 files a day.") */
  generateBlockedReason: string | null;
};

export const myDataExportIdSchema = z.object({ id: uuidSchema });
export type MyDataExportIdInput = z.input<typeof myDataExportIdSchema>;

// ===========================================================================
// G5 Notifications (F-PRT-13, F-NTF-02) — app.notifications, own rows only
// ===========================================================================
export const NOTIFICATION_CATEGORIES = ['leave', 'claims', 'profile', 'payroll', 'system'] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export const NOTIFICATION_CATEGORY_LABELS = labels<NotificationCategory>({
  leave: 'Leave', claims: 'Claims', profile: 'Profile & requests', payroll: 'Payroll', system: 'System',
});

/** PRD §12.2 catalogue ranges: N-01…19 leave · N-20…29 + N-59/N-60 claims · N-30…39 payroll · N-40…49 profile & requests · rest system. */
export function notificationCategory(eventCode: string): NotificationCategory {
  const n = Number(/^N-(\d{2})$/.exec(eventCode)?.[1] ?? NaN);
  if (!Number.isFinite(n)) return 'system';
  if (n === 59 || n === 60 || (n >= 20 && n <= 29)) return 'claims';
  if (n >= 1 && n <= 19) return 'leave';
  if (n >= 30 && n <= 39) return 'payroll';
  if (n >= 40 && n <= 49) return 'profile';
  return 'system';
}

export const NOTIFICATION_READ_FILTERS = ['all', 'unread', 'read'] as const;
export type NotificationReadFilter = (typeof NOTIFICATION_READ_FILTERS)[number];

export const notificationListParamsSchema = pageParamsSchema.extend({
  /** search: title and summary text */
  read: z.enum(NOTIFICATION_READ_FILTERS).default('all'),
  categories: multi(z.enum(NOTIFICATION_CATEGORIES)),
  /** Received from–to (dd/mm/yyyy in the UI) */
  dateFrom: isoDateSchema.optional().catch(undefined),
  dateTo: isoDateSchema.optional().catch(undefined),
  /** Received, newest first by default */
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type NotificationListParams = z.input<typeof notificationListParamsSchema>;

export type NotificationRow = {
  id: string;
  eventCode: string;
  category: NotificationCategory;
  title: string;
  /** PDPA-safe summary (BR-NTF-02) */
  summary: string | null;
  /** in-app deep link (always a relative path starting with '/'); null when the event has none */
  href: string | null;
  isActionRequired: boolean;
  unread: boolean;
  readAt: string | null;
  /** Received (dd/mm/yyyy HH:mm in the UI; the panel shows "2 h ago") */
  createdAt: string;
};

/** Bell panel (S-GL-06): max 10 latest + unread count. */
export const NOTIFICATION_PANEL_SIZE = 10;
export type NotificationPanel = { items: NotificationRow[]; unreadCount: number };

/** ServerShell (every authenticated page): bell + "Privacy notice" link in the user menu / footer (hidden when none). */
export type ShellStatus = {
  notifications: NotificationPanel;
  privacyNoticePublished: boolean;
  hasEmployeeRecord: boolean;
};

export const markNotificationSchema = z.object({
  id: uuidSchema,
  /** false = mark unread (row ⋮ Mark unread) */
  read: z.preprocess((v) => (v === 'false' || v === false ? false : true), z.boolean()).default(true),
});
export type MarkNotificationInput = z.input<typeof markNotificationSchema>;
export const notificationIdSchema = z.object({ id: uuidSchema });
export type NotificationIdInput = z.input<typeof notificationIdSchema>;

// ===========================================================================
// G6 Account settings (F-PRT-14)
// ===========================================================================
export const ACCOUNT_TABS = ['password', 'notifications', 'delegation', 'two_factor'] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];
export const ACCOUNT_TAB_LABELS = labels<AccountTab>({ password: 'Password', notifications: 'Notifications', delegation: 'Delegation', two_factor: 'Two-factor' });

export type AccountSettings = {
  displayName: string;
  loginEmail: string;
  isExternal: boolean;
  hasEmployeeRecord: boolean;
  /** Password + Notifications always; Delegation for MGR / ADM / SA (not External ADM — BR-ADM-04); Two-factor for ADM / SA */
  tabs: AccountTab[];
  twoFactor: {
    /** ADM / SA only */
    applicable: boolean;
    enrolled: boolean;
    /** the SA control setting requires MFA for privileged roles */
    required: boolean;
    /** this session is at aal2 */
    verifiedThisSession: boolean;
    /** always "Reset requires a Super Admin." — re-enrolment is admin-reset only */
    note: string;
  };
  /** BR-ADM-07 — mirrors src/server/auth/policy.ts */
  passwordPolicy: { minLength: number; maxLength: number; rules: string[] };
};

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_RULES = [
  `At least ${PASSWORD_MIN_LENGTH} characters`,
  'An upper-case letter',
  'A lower-case letter',
  'A number',
  'A symbol',
] as const;

/** Same rule as src/server/auth/policy.ts passwordSchema (BR-ADM-07). */
const newPasswordSchema = z
  .string({ error: 'Enter a new password.' })
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`)
  .regex(/[A-Z]/, 'Include an upper-case letter.')
  .regex(/[a-z]/, 'Include a lower-case letter.')
  .regex(/[0-9]/, 'Include a number.')
  .regex(/[^A-Za-z0-9]/, 'Include a symbol.');

export const changePasswordSchema = z.object({
  currentPassword: z.string({ error: 'Enter your current password.' }).min(1, 'Enter your current password.').max(200),
  newPassword: newPasswordSchema,
  confirmPassword: z.string({ error: 'Confirm the new password.' }).min(1, 'Confirm the new password.'),
})
  .refine((v) => v.confirmPassword === v.newPassword, { path: ['confirmPassword'], message: "The passwords don't match." })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a password different from your current one.' });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
export const PASSWORD_CHANGED_MESSAGE = 'Password changed. Other sessions have been signed out.';

// ---------------------------------------------------------------------------
// Notification preferences (F-NTF-06, BR-NTF-04): FYI emails can be switched off; in-app is always on;
// action-required and security emails are locked ("Required"). Stored per event code in
// app.notification_preferences (email_enabled); a database trigger refuses opting out of a mandatory code.
// ---------------------------------------------------------------------------
export type PreferenceAudience = 'employee' | 'approver' | 'admin' | 'super_admin' | 'all';
export type NotificationPreferenceGroupDef = {
  key: string;
  label: string;
  description: string;
  category: NotificationCategory;
  eventCodes: string[];
  mandatory: boolean;
  audience: PreferenceAudience;
};

export const NOTIFICATION_PREFERENCE_GROUPS: NotificationPreferenceGroupDef[] = [
  // Leave
  { key: 'leave_to_approve', label: 'Leave waiting for my approval', description: 'Leave, cancellations and replacement credits submitted to you (N-01, N-05, N-11).', category: 'leave', eventCodes: ['N-01', 'N-05', 'N-11'], mandatory: true, audience: 'approver' },
  { key: 'approval_reminders', label: 'Approval reminders and escalations', description: 'Daily digest of items pending 2+ working days and escalations (N-15, N-16).', category: 'leave', eventCodes: ['N-15', 'N-16'], mandatory: true, audience: 'approver' },
  { key: 'leave_decisions', label: 'Decisions on my leave', description: 'Approved, rejected, cancellation rejected, replacement credit decided (N-02, N-03, N-07, N-12).', category: 'leave', eventCodes: ['N-02', 'N-03', 'N-07', 'N-12'], mandatory: false, audience: 'employee' },
  { key: 'leave_changes', label: 'Changes to my leave by HR', description: 'Recounts, leave applied/cancelled by HR or on my behalf, balance adjustments (N-06, N-08, N-09, N-10).', category: 'leave', eventCodes: ['N-06', 'N-08', 'N-09', 'N-10'], mandatory: false, audience: 'employee' },
  { key: 'leave_expiry', label: 'Expiring carry-forward and credits', description: 'Carry-forward or replacement credits expiring in 30 days (N-13).', category: 'leave', eventCodes: ['N-13'], mandatory: false, audience: 'employee' },
  { key: 'leave_attachment', label: 'Attachment needed', description: 'An attachment is pending or a medical certificate is invalid (N-14).', category: 'leave', eventCodes: ['N-14'], mandatory: true, audience: 'employee' },
  { key: 'delegation', label: 'Delegations', description: 'A delegation to or from you was set or ended (N-17).', category: 'leave', eventCodes: ['N-17'], mandatory: false, audience: 'approver' },
  // Claims
  { key: 'claims_to_approve', label: 'Claims waiting for my approval', description: 'Claims submitted to you; disbursement batches waiting for Super Admin approval (N-20, N-26).', category: 'claims', eventCodes: ['N-20', 'N-26'], mandatory: true, audience: 'approver' },
  { key: 'claim_decisions', label: 'Decisions on my claims', description: 'Claim approved, rejected or cancelled after approval (N-22, N-23, N-59).', category: 'claims', eventCodes: ['N-22', 'N-23', 'N-59'], mandatory: false, audience: 'employee' },
  { key: 'claim_payments', label: 'Claim payments', description: 'Claim disbursed or disbursement undone (N-25, N-28).', category: 'claims', eventCodes: ['N-25', 'N-28'], mandatory: false, audience: 'employee' },
  // Profile & requests
  { key: 'bank_changed', label: 'Bank details changed', description: 'Security notice whenever your bank details change (N-41).', category: 'profile', eventCodes: ['N-41'], mandatory: true, audience: 'employee' },
  { key: 'my_change_requests', label: 'My change requests', description: 'A change request you submitted was approved or rejected (N-42).', category: 'profile', eventCodes: ['N-42'], mandatory: false, audience: 'employee' },
  { key: 'employment_updates', label: 'Employment updates', description: 'Confirmation, separation recorded, passport expiring (N-46, N-47, N-48).', category: 'profile', eventCodes: ['N-46', 'N-47', 'N-48'], mandatory: false, audience: 'employee' },
  { key: 'probation_due', label: 'Probation ending', description: 'A team member\'s probation ends in 14 days (N-44).', category: 'profile', eventCodes: ['N-44'], mandatory: false, audience: 'approver' },
  { key: 'change_requests_to_review', label: 'Change requests to review', description: 'An employee submitted a change request (N-43).', category: 'profile', eventCodes: ['N-43'], mandatory: true, audience: 'admin' },
  // System
  { key: 'account_security', label: 'Account security', description: 'Account locked, privileged role assigned or removed (N-52, N-53).', category: 'system', eventCodes: ['N-52', 'N-53'], mandatory: true, audience: 'all' },
  { key: 'admin_reminders', label: 'HR reminders', description: 'Next year\'s holiday calendar not yet published (N-58).', category: 'system', eventCodes: ['N-58'], mandatory: false, audience: 'admin' },
  { key: 'sa_alerts', label: 'Super Admin alerts', description: 'External user access ending; data-subject request due (N-54, N-57).', category: 'system', eventCodes: ['N-54', 'N-57'], mandatory: true, audience: 'super_admin' },
];
/** Every mandatory event code — must equal app.notification_email_mandatory() in the database (tested). */
export const MANDATORY_EMAIL_EVENT_CODES: string[] = NOTIFICATION_PREFERENCE_GROUPS.filter((g) => g.mandatory).flatMap((g) => g.eventCodes).sort();

export type NotificationPreferenceGroup = {
  key: string;
  label: string;
  description: string;
  category: NotificationCategory;
  /** Email toggle (locked on when mandatory) */
  emailEnabled: boolean;
  /** In-app is always on (🔒) */
  inAppEnabled: true;
  mandatory: boolean;
  /** "Required" (BR-NTF-04) when mandatory */
  lockedReason: string | null;
};
export type NotificationPreferences = { groups: NotificationPreferenceGroup[] };

export const saveNotificationPreferencesSchema = z.object({
  groups: z.array(z.object({
    key: z.string().trim().min(1).max(60),
    emailEnabled: z.preprocess((v) => (v === 'true' || v === 'on' ? true : v === 'false' || v === 'off' ? false : v), z.boolean()),
  })).min(1).max(50),
});
export type SaveNotificationPreferencesInput = z.input<typeof saveNotificationPreferencesSchema>;

// ===========================================================================
// FUNCTION REGISTER (exact names and signatures — implementations must match)
// ===========================================================================
// QUERIES — src/server/queries/portal.ts (server-only; requireUser([...]) → withUserTx)
//   Roles: EMP = "has an employee record" (app.current_role_codes) — so [EMP] covers MGR / ADM / SA who are employees and
//   excludes External ADM (and the Super Admin before their record exists), who get Not Found (G8).
//   P11 getMyHolidays(p: MyHolidaysParams): Promise<MyHolidaysPage>                          [EMP] (own state)
//   P20 getMyDataExports(): Promise<MyDataExportPage>                                         [EMP] (own)
//   G5  getShellStatus(): Promise<ShellStatus>                                                [any signed-in user] (ServerShell: bell panel, unread count, privacy link)
//       getNotificationPanel(): Promise<NotificationPanel>                                    [any signed-in user]
//       listNotifications(p: NotificationListParams): Promise<Paged<NotificationRow>>          [any signed-in user] (own)
//   G6  getAccountSettings(): Promise<AccountSettings>                                        [any signed-in user]
//       getNotificationPreferences(): Promise<NotificationPreferences>                        [any signed-in user] (groups for the user's roles)
//       Delegation tab → ./approvals listMyDelegations()                                      [MGR, ADM, SA]
//   G7  → ./users getCurrentPrivacyNotice(), listPrivacyNoticeHistory()                       [any signed-in user]
//
// SERVER ACTIONS — src/server/actions/portal.ts ('use server')
//   P11 exportMyHolidaysCsv(p: MyHolidaysParams): Promise<ActionResult<CsvFile>>              [EMP] (Date · Day · Name · Type · Half day)
//   P20 generateMyDataExport(): Promise<ActionResult<{ export: MyDataExportRow }>>            [EMP] (own; access-logged;
//                                                                                               synchronous — returns Ready or Failed)
//       downloadMyDataExport(i: MyDataExportIdInput): Promise<ActionResult<{ url: string; fileName: string }>>  [EMP] (requester only — not even ADM/SA; 60-s signed URL; logged)
//       fetchMyDataExports(): Promise<ActionResult<{ page: MyDataExportPage }>>               [EMP] (refresh)
//   G5  fetchNotificationPanel(): Promise<ActionResult<{ panel: NotificationPanel }>>          [any signed-in user] (bell open / refresh)
//       markNotification(i: MarkNotificationInput): Promise<ActionResult<{ unreadCount: number }>>         [any] (row ⋮ Mark read / unread — own only)
//       markAllNotificationsRead(): Promise<ActionResult<{ marked: number; unreadCount: 0 }>>  [any] (MARK ALL READ — own only)
//       openNotification(i: NotificationIdInput): Promise<ActionResult<{ href: string | null; unreadCount: number }>>  [any] (title click: marks read, returns the deep link)
//       exportNotificationsCsv(p: NotificationListParams): Promise<ActionResult<CsvFile>>     [any] (own, filtered set — Received · Category · Title · Summary · Status)
//   G6  changePassword(i: ChangePasswordInput): Promise<ActionResult<{ message: string }>>     [any] (re-authenticates with the current password through Supabase Auth;
//                                                                                               wrong current password counts toward lockout; other sessions signed out;
//                                                                                               login_events 'password_changed'; never logs or returns a password)
//       saveNotificationPreferences(i: SaveNotificationPreferencesInput): Promise<ActionResult<{ preferences: NotificationPreferences }>>  [any]
//                                                                                               (mandatory group switched off → fieldErrors['groups.<key>'] "Required")
//       Delegation tab → ./approvals saveMyDelegation / endMyDelegation / searchApproverOptions  [MGR, ADM, SA]
//   G7  → ./users getPrivacyNoticeFileUrl({ noticeId })                                       [any signed-in user]
//
// Errors the UI may branch on (ActionFail.error is a readable sentence):
//   changePassword: wrong current password → fieldErrors.currentPassword "Current password is incorrect." ·
//                   locked → "Too many unsuccessful attempts. … " (the session is signed out; go to /login) ·
//                   breached / weak (Supabase) → fieldErrors.newPassword
//   generateMyDataExport: no employee record → "Not found or no access." · already preparing / daily limit → message only
//   downloadMyDataExport: expired → "This file has expired. Generate a new one."
