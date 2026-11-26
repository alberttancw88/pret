// PRET contract — M8 Notifications (W2-007): email delivery (F-NTF-01, ADR-0010), PDPA-safe templates (F-NTF-08),
// reminders / digest (F-NTF-03) and scheduled HR alerts (F-NTF-04) via the nightly jobs, templates (F-NTF-05, A16) and the
// notification log (F-NTF-07, A15). The in-app centre and preferences (F-NTF-02/06) are in ./portal (W2-006).
// Types + zod only (client-safe — no database or server code). Implementations:
//   queries → src/server/queries/notifications.ts (server-only)   actions → src/server/actions/notifications.ts ('use server')
//   delivery → src/server/email/dispatch.ts (server-only) · templates → src/server/lib/email-templates.ts (pure, unit-tested)
//
// Rules:
//   * Every §12.2 event writes app.notifications (in-app) and, where the catalogue says Email, an app.email_outbox row in the SAME
//     transaction (ADR-0010). Mandatory (action-required / security) emails cannot be switched off (BR-NTF-04, D33).
//   * Delivery: the outbox is sent through Resend right after the user's action commits (after-response hook) and by the
//     daily cron (retry sweep). Retries back off 5 min → 30 min → 2 h → 12 h; after 5 attempts the row is Failed.
//     Without RESEND_API_KEY / PRET_EMAIL_FROM nothing is sent: rows stay Queued and A15 says so; the user's action never fails.
//   * Safety (W2-007 brief rule 6): addresses on example.* / *.invalid / *.test / localhost are never emailed → Suppressed.
//     Unless PRET_EMAIL_DELIVERY=live, delivery is RESTRICTED: only addresses on the allowed email domains (SA control setting)
//     or listed in PRET_EMAIL_TEST_RECIPIENTS are emailed; everything else is Suppressed ("Restricted delivery").
//     Rows older than 3 days that were never sent are Suppressed ("Expired before delivery") so a late configuration does not
//     flood people with stale emails.
//   * Content (BR-NTF-02, F-NTF-08): a short summary (type, dates, reference, amount for claims) + a deep link that requires login.
//     Never NRIC, bank account no., salary / net pay, diagnosis, religion, family details, free-text reasons or attachments.
//     Every rendered email passes a PDPA check before sending; a failing email is never sent (Failed: "Blocked by the PDPA check").
//   * A15 log: ADM and SA; recipients' email addresses are shown to ADM / SA only (the page is ADM / SA only). Content summary only.
//   * A16 templates: list and view for ADM / SA; edit subject / body (Could — built) for SA only, with a synthetic PREVIEW.
//     Placeholders for NRIC, bank account, salary or diagnosis do not exist.
import { z } from 'zod';
import { isoDateSchema, multi, uuidSchema, type Paged } from './common';

export * from './common';

const labels = <T extends string>(m: Record<T, string>) => m;

// ===========================================================================
// §12.2 Event catalogue (R1.0 events; R1.1 payroll events listed for completeness)
// ===========================================================================
export type NotificationEventDef = {
  code: string;               // 'N-01'
  name: string;
  recipients: string;
  email: boolean;
  inApp: boolean;
  release: 'R1.0' | 'R1.1';
};
const ev = (code: string, name: string, recipients: string, email: boolean, inApp = true, release: 'R1.0' | 'R1.1' = 'R1.0'): NotificationEventDef =>
  ({ code, name, recipients, email, inApp, release });
export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  ev('N-01', 'Leave submitted / moved to next level', 'Current-level approver(s) + delegate', true),
  ev('N-02', 'Leave approved', 'Employee', true),
  ev('N-03', 'Leave rejected', 'Employee', true),
  ev('N-04', 'Leave withdrawn by employee', 'Approver(s) who had it', false),
  ev('N-05', 'Cancellation requested', 'Approver', true),
  ev('N-06', 'Leave cancelled / recounted', 'Employee, approver(s), HR (FYI)', true),
  ev('N-07', 'Cancellation rejected', 'Employee', true),
  ev('N-08', 'Leave applied / withdrawn / cancelled by admin', 'Employee, manager', true),
  ev('N-09', 'Leave applied on behalf', 'Employee', true),
  ev('N-10', 'Balance adjusted', 'Employee', true),
  ev('N-11', 'Replacement credit submitted', 'Approver', true),
  ev('N-12', 'Replacement credit approved / rejected', 'Employee', true),
  ev('N-13', 'Carry-forward / replacement credits expiring in 30 days', 'Employee', true),
  ev('N-14', 'Attachment pending / MC invalid', 'Employee (HR copy in-app)', true),
  ev('N-15', 'Pending approval reminder (daily digest)', 'Approver', true),
  ev('N-16', 'Escalation (pending ≥ 5 working days)', "Approver's manager, HR", true),
  ev('N-17', 'Delegation set / ended', 'Delegate, delegator', true),
  ev('N-18', 'Year-end roll-over completed', 'Admin', false),
  ev('N-20', 'Claim submitted', "Claimant's manager (+ delegate) — email; all Admins — in-app", true),
  ev('N-22', 'Claim approved', 'Employee', true),
  ev('N-23', 'Claim rejected', 'Employee', true),
  ev('N-25', 'Claim disbursed', 'Employee', true),
  ev('N-26', 'Disbursement batch pending approval', 'Super Admin', true),
  ev('N-27', 'Disbursement batch approved / cancelled', 'Preparer', false),
  ev('N-28', 'Claim disbursement undone', 'Employee, Admins', true),
  ev('N-29', 'Claim included in a month-end batch', 'Employee', false),
  ev('N-30', 'Payroll run submitted for approval', 'Super Admin', true, true, 'R1.1'),
  ev('N-31', 'Payroll run approved / returned', 'Admin', true, true, 'R1.1'),
  ev('N-32', 'Payslip available', 'Employee', true, true, 'R1.1'),
  ev('N-33', 'Payroll run re-opened', 'Admin, Super Admin', true, true, 'R1.1'),
  ev('N-34', 'EA form available', 'Employee', true, true, 'R1.1'),
  ev('N-35', 'Statutory submission due in 3 days', 'Admin', true, true, 'R1.1'),
  ev('N-36', 'TP1 declaration submitted', 'Admin', false, true, 'R1.1'),
  ev('N-40', 'Employee self-updated contact / emergency data', 'Admin', false),
  ev('N-41', 'Bank details changed', 'Employee (work and personal email), Super Admin', true),
  ev('N-42', 'Change request approved / rejected', 'Employee', true),
  ev('N-43', 'Change request submitted', 'Admin', true),
  ev('N-44', 'Probation ending in 14 days', 'Manager, Admin', true),
  ev('N-45', 'Retirement age within 6 months', 'Admin', false),
  ev('N-46', 'Document / passport expiring in 30 days', 'Admin (+ employee for passport)', true),
  ev('N-47', 'Employee confirmed', 'Employee, manager', true),
  ev('N-48', 'Separation recorded', 'Admin, manager, Super Admin', true),
  ev('N-49', 'Reportees without an active manager', 'Admin', false),
  ev('N-50', 'User invited', 'User', true, false),
  ev('N-51', 'Password reset requested', 'User', true, false),
  ev('N-52', 'Account locked', 'User, Super Admin', true),
  ev('N-53', 'Privileged role assigned / removed', 'User, Super Admin', true),
  ev('N-54', "External user's access ends in 30 and 7 days", 'Super Admin', true),
  ev('N-55', 'Company privacy notice published / replaced', 'All users', false),
  ev('N-56', 'Import completed / failed', 'Initiator', false),
  ev('N-57', 'Data-subject request due in 5 days', 'Super Admin', true),
  ev('N-58', 'Next-year public-holiday calendar not published', 'Admin', true),
  ev('N-59', 'Approved claim cancelled', 'Employee', true),
  ev('N-60', 'Late-submission override applied', 'Employee', false),
];
export const NOTIFICATION_EVENT_NAMES: Record<string, string> = Object.fromEntries(NOTIFICATION_EVENTS.map((e) => [e.code, e.name]));

// ===========================================================================
// A15 Notification log (S-AC-12 · /notifications/log · ADM, SA)
// ===========================================================================
export const NOTIFICATION_CHANNELS = ['email', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const NOTIFICATION_CHANNEL_LABELS = labels<NotificationChannel>({ email: 'Email', in_app: 'In-app' });

/** Delivery status shown in A15 (email: from app.email_status + attempts; in-app: Delivered / Read). */
export const DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'retrying', 'failed', 'suppressed', 'delivered', 'read'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export const DELIVERY_STATUS_LABELS = labels<DeliveryStatus>({
  queued: 'Queued', sending: 'Sending', sent: 'Sent', retrying: 'Retrying', failed: 'Failed', suppressed: 'Suppressed', delivered: 'Delivered', read: 'Read',
});
export const DELIVERY_STATUS_TONES = labels<DeliveryStatus>({
  queued: 'grey', sending: 'info', sent: 'success', retrying: 'warning', failed: 'error', suppressed: 'grey', delivered: 'success', read: 'success',
});
/** Maximum send attempts before an email is Failed (ADR-0010 "retries with back-off then failed"). */
export const EMAIL_MAX_ATTEMPTS = 5;
/** Back-off after attempt n (minutes): 5, 30, 120, 720. */
export const EMAIL_BACKOFF_MINUTES = [5, 30, 120, 720] as const;
/** Never-sent rows older than this are Suppressed ("Expired before delivery"). */
export const EMAIL_STALE_HOURS = 72;

export const notificationLogParamsSchema = z.object({
  q: z.preprocess((v) => (typeof v === 'string' ? v.trim() : undefined), z.string().max(100).optional()),  // recipient, reference, subject
  eventCodes: multi(z.string().trim().regex(/^N-\d{2}$/)),
  channels: multi(z.enum(NOTIFICATION_CHANNELS)),
  statuses: multi(z.enum(DELIVERY_STATUSES)),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['at', 'event', 'recipient', 'status']).default('at'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type NotificationLogParams = z.input<typeof notificationLogParamsSchema>;
export type NotificationLogRow = {
  id: string;                       // outbox id (email) or notification id (in-app)
  channel: NotificationChannel;
  /** sent at (email sent) or created at (queued email, in-app) — ISO */
  at: string;
  createdAt: string;
  eventCode: string | null;         // null for a personal-email copy without an in-app row (N-41) → see templateCode
  eventName: string | null;
  templateCode: string | null;
  recipientName: string | null;
  /** ADM / SA only (the screen is ADM / SA only) */
  recipientEmail: string | null;
  status: DeliveryStatus;
  attempts: number;
  /** provider / safety reason, never personal data (e.g. "Restricted delivery: not an allowed domain") */
  statusDetail: string | null;
  /** content summary (subject / title) — no personal data (BR-NTF-02) */
  summary: string;
  /** deep link (relative path) */
  link: string | null;
  canRetry: boolean;
};
export type EmailDeliveryMode = 'live' | 'restricted';
export type EmailDeliveryStatus = {
  /** RESEND_API_KEY and PRET_EMAIL_FROM both set */
  configured: boolean;
  mode: EmailDeliveryMode;
  /** banner text for A15, e.g. "Email is not configured — 12 emails are queued and will be sent once RESEND_API_KEY and PRET_EMAIL_FROM are set." */
  message: string;
  queued: number;
  retrying: number;
  failed: number;
  sentLast24h: number;
  oldestQueuedAt: string | null;
  lastSentAt: string | null;
  allowedDomains: string[];
};
export type NotificationLogPage = Paged<NotificationLogRow> & { delivery: EmailDeliveryStatus };
export const retryEmailSchema = z.object({ id: uuidSchema });
export type RetryEmailInput = z.input<typeof retryEmailSchema>;

// ===========================================================================
// A16 Notification templates (S-AC-13 · /notifications/templates)
// ===========================================================================
export type TemplatePlaceholder = { key: string; label: string; sample: string };
export type NotificationTemplateRow = {
  templateCode: string;
  eventCode: string;
  eventName: string;
  recipients: string;
  email: true;
  inApp: boolean;
  /** action-required / security → cannot be opted out (BR-NTF-04) */
  mandatory: boolean;
  /** SA may edit (F-NTF-05 Could) */
  editable: boolean;
  overridden: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};
export type NotificationTemplateDetail = NotificationTemplateRow & {
  placeholders: TemplatePlaceholder[];
  defaultSubject: string;
  defaultBody: string;
  subject: string;                  // effective (override or default)
  body: string;
  preview: RenderedEmail;           // synthetic sample
};
export type RenderedEmail = { subject: string; text: string; html: string };
export const notificationTemplateListParamsSchema = z.object({
  q: z.preprocess((v) => (typeof v === 'string' ? v.trim() : undefined), z.string().max(100).optional()),
  overriddenOnly: z.preprocess((v) => v === true || v === 'true' || v === 'on', z.boolean()).default(false),
});
export type NotificationTemplateListParams = z.input<typeof notificationTemplateListParamsSchema>;
const TEMPLATE_CODE = z.string().trim().regex(/^[a-z][a-z0-9_]{2,59}$/, 'Unknown template.');
export const templateCodeSchema = z.object({ templateCode: TEMPLATE_CODE });
export type TemplateCodeInput = z.input<typeof templateCodeSchema>;
export const saveNotificationTemplateSchema = z.object({
  templateCode: TEMPLATE_CODE,
  subject: z.string({ error: 'Subject is required.' }).trim().min(3, 'Subject is required.').max(150, 'Subject must be at most 150 characters.'),
  body: z.string({ error: 'Body is required.' }).trim().min(10, 'Body is required.').max(2000, 'Body must be at most 2,000 characters.'),
});
export type SaveNotificationTemplateInput = z.input<typeof saveNotificationTemplateSchema>;
export const previewNotificationTemplateSchema = z.object({
  templateCode: TEMPLATE_CODE,
  subject: z.string().trim().max(150).optional(),
  body: z.string().trim().max(2000).optional(),
});
export type PreviewNotificationTemplateInput = z.input<typeof previewNotificationTemplateSchema>;
/** Shown under the editor (A16 guard, F-NTF-08). */
export const TEMPLATE_PLACEHOLDER_GUARD = 'Placeholders for NRIC, bank account, salary or diagnosis are not available.';

// ===========================================================================
// FUNCTION REGISTER (exact names and signatures — implementations must match)
// ===========================================================================
// QUERIES — src/server/queries/notifications.ts (server-only; requireUser([...]) → withUserTx)
//   A15 listNotificationLog(p: NotificationLogParams): Promise<NotificationLogPage>           [ADM, SA]
//       getEmailDeliveryStatus(): Promise<EmailDeliveryStatus>                                [ADM, SA] (also R1 alert "email")
//   A16 listNotificationTemplates(p?: NotificationTemplateListParams): Promise<NotificationTemplateRow[]>   [ADM, SA]
//       getNotificationTemplate(templateCode: string): Promise<NotificationTemplateDetail | null>        [ADM, SA]
//
// SERVER ACTIONS — src/server/actions/notifications.ts ('use server')
//   A15 exportNotificationLogCsv(p: NotificationLogParams): Promise<ActionResult<CsvFile>>   [ADM, SA] (Sent at · Event · Recipient · Email ·
//                                                                                               Channel · Status · Attempts · Detail · Summary · Link; logged)
//       retryEmail(i: RetryEmailInput): Promise<ActionResult<{ row: NotificationLogRow }>>   [ADM, SA] (Failed → Queued, then dispatched)
//       sendQueuedEmailsNow(): Promise<ActionResult<{ sent: number; failed: number; suppressed: number; skipped: string | null }>>
//                                                                                              [SA] ("SEND QUEUED NOW" — runs the dispatcher once)
//   A16 saveNotificationTemplate(i: SaveNotificationTemplateInput): Promise<ActionResult<{ template: NotificationTemplateDetail }>>  [SA]
//                                                                                               (unknown / forbidden placeholder → fieldErrors.subject|body)
//       resetNotificationTemplate(i: TemplateCodeInput): Promise<ActionResult<{ template: NotificationTemplateDetail }>>            [SA]
//       previewNotificationTemplate(i: PreviewNotificationTemplateInput): Promise<ActionResult<{ preview: RenderedEmail }>>        [ADM, SA]
//
// SERVER-ONLY (not callable from the browser)
//   src/server/email/dispatch.ts  dispatchOutbox(opts?): Promise<DispatchRun>     — prompt send (after each Server Action, via
//                                                                                  next/server after()) and the cron retry sweep
//   src/server/jobs/daily.ts      runDailyJobs(): Promise<DailyJobsRun>          — Vercel cron: scheduled invites + outbox sweep
//                                                                                  (src/app/api/cron/daily/route.ts should call this)
