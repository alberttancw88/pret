// W2-007 F-NTF-05 / F-NTF-08 — fixed email templates for every §12.2 event and the PDPA-safe renderer (ADR-0010).
// PURE module (no database, no 'server-only') so the unit tests can import it.
//
// Content rule (BR-NTF-02): a short summary — type, dates, reference, amount for claims — and a deep link that requires
// login. Placeholders are a whitelist per template; free-text reasons / comments / remarks, NRIC, bank account, salary,
// diagnosis, religion and family details have NO placeholder, so they can never reach an email. Every rendered email also
// passes pdpaIssues() before it is sent (dispatcher) and before an SA override is saved (A16).

export type RenderedEmail = { subject: string; text: string; html: string };
export type TemplateDef = {
  code: string;
  eventCode: string;
  /** whitelisted payload keys (plus the COMMON placeholders) */
  placeholders: string[];
  subject: string;
  body: string;
  /** deep link when the outbox row has no in-app notification (e.g. N-41 copy to the personal email) */
  defaultLink: string;
};

/** Placeholders every template may use. {title} = the event title written with the notification (already PDPA-safe). */
export const COMMON_PLACEHOLDERS = ['title', 'link', 'company', 'recipient_name'] as const;

export const PLACEHOLDER_INFO: Record<string, { label: string; sample: string }> = {
  title: { label: 'Event title', sample: 'Leave to approve: LV-2027-00031 · Sample Employee' },
  link: { label: 'Link to PRET (sign-in required)', sample: 'https://pret.example.invalid/approvals' },
  company: { label: 'Company name', sample: 'Interact Technology Sdn Bhd' },
  recipient_name: { label: 'Recipient name', sample: 'Sample Approver' },
  reference: { label: 'Reference no.', sample: 'LV-2027-00031' },
  employee: { label: 'Employee name', sample: 'Sample Employee' },
  employee_no: { label: 'Employee no.', sample: 'SMP-01' },
  type: { label: 'Leave type', sample: 'Annual Leave' },
  level: { label: 'Approval level', sample: '1' },
  total: { label: 'Claim total', sample: 'RM 245.60' },
  amount: { label: 'Amount paid', sample: 'RM 245.60' },
  date: { label: 'Payment date', sample: '30/11/2027' },
  batch: { label: 'Batch no.', sample: 'PB-2027-011' },
  count: { label: 'Number of items', sample: '3' },
  action: { label: 'Action taken', sample: 'cancelled' },
  decision: { label: 'Decision', sample: 'approved' },
  before: { label: 'Days before', sample: '3.0' },
  after: { label: 'Days after', sample: '2.0' },
  days: { label: 'Days', sample: '2.0' },
  year: { label: 'Year', sample: '2028' },
  expires_on: { label: 'Expiry date', sample: '31/03/2028' },
  expiry_date: { label: 'Expiry date', sample: '15/01/2028' },
  probation_end: { label: 'Probation end', sample: '14/12/2027' },
  confirmation_date: { label: 'Confirmation date', sample: '01/12/2027' },
  last_working_day: { label: 'Last working day', sample: '31/12/2027' },
  changed_on: { label: 'Changed on', sample: '20/11/2027 10:15' },
  effective_from: { label: 'Effective from', sample: '01/12/2027' },
  changed_by: { label: 'Changed by', sample: 'Sample HR' },
  cr_no: { label: 'Change request no.', sample: 'CR-2027-00004' },
  status: { label: 'Status', sample: 'approved' },
  category: { label: 'Category', sample: 'contact' },
  role: { label: 'Role', sample: 'ADM' },
  change: { label: 'Change', sample: 'granted' },
  from: { label: 'From', sample: '01/12/2027' },
  to: { label: 'To', sample: '15/12/2027' },
  scope: { label: 'Scope', sample: 'all' },
  approver: { label: 'Approver', sample: 'Sample Manager' },
  end_date: { label: 'Access end date', sample: '31/12/2027' },
  publish_by: { label: 'Publish by', sample: '31/12/2027' },
  by: { label: 'Cancelled by', sample: 'Sample HR' },
};

/** Payload keys that must never appear in an outbox payload or template (F-NTF-08). */
export const FORBIDDEN_KEYS = [
  'nric', 'mykad', 'ic', 'ic_no', 'passport', 'passport_no', 'bank', 'bank_name', 'bank_account', 'account', 'account_no', 'asnb',
  'salary', 'net_pay', 'gross_pay', 'pay', 'basic_salary', 'diagnosis', 'medical', 'religion', 'spouse', 'child', 'children',
] as const;

const t = (code: string, eventCode: string, placeholders: string[], subject: string, body: string, defaultLink = '/notifications'): TemplateDef =>
  ({ code, eventCode, placeholders, subject, body, defaultLink });

export const EMAIL_TEMPLATES: TemplateDef[] = [
  // Leave (N-01 … N-17)
  t('leave_submitted', 'N-01', ['reference', 'employee', 'type', 'level'], '{title}',
    '{employee} has applied for {type} ({reference}). It is waiting for your decision at level {level}.', '/approvals'),
  t('leave_approved', 'N-02', ['reference', 'type'], '{title}', 'Your {type} application {reference} has been approved.', '/my/leave'),
  t('leave_rejected', 'N-03', ['reference'], '{title}', 'Your leave application {reference} was not approved. Sign in to see the approver\'s comment.', '/my/leave'),
  t('leave_cancellation_requested', 'N-05', ['reference', 'employee', 'type', 'level'], '{title}',
    '{employee} has asked to cancel {type} ({reference}). It is waiting for your decision.', '/approvals'),
  t('leave_cancelled', 'N-06', ['reference', 'type'], '{title}', 'Your {type} application {reference} has been cancelled and the days restored.', '/my/leave'),
  t('leave_recounted', 'N-06', ['reference', 'before', 'after'], '{title}',
    'Your leave {reference} was recounted after a calendar change: {before} → {after} days.', '/my/leave'),
  t('leave_cancellation_rejected', 'N-07', ['reference'], '{title}', 'Your request to cancel leave {reference} was not approved. Sign in to see the comment.', '/my/leave'),
  t('leave_admin_action', 'N-08', ['reference', 'action'], '{title}', 'HR has {action} leave {reference}. Sign in to see the details.', '/my/leave'),
  t('leave_on_behalf', 'N-09', ['reference', 'type'], '{title}', 'HR applied {type} ({reference}) on your behalf. Sign in to check the dates.', '/my/leave'),
  t('leave_balance_adjusted', 'N-10', ['type', 'days', 'year'], '{title}', 'Your {type} balance for {year} was adjusted by {days} day(s). Sign in to see the reason.', '/my/leave/balances'),
  t('credit_submitted', 'N-11', ['reference', 'employee', 'type', 'level'], '{title}',
    '{employee} has requested a replacement credit ({reference}). It is waiting for your decision.', '/approvals'),
  t('credit_decided', 'N-12', ['reference', 'decision'], '{title}', 'Your replacement credit {reference} was {decision}.', '/my/leave/credits'),
  t('leave_expiring', 'N-13', ['reference', 'type', 'expires_on', 'days'], '{title}', '{days} day(s) expire on {expires_on}. Plan your leave before then.', '/my/leave/balances'),
  t('leave_attachment_pending', 'N-14', ['reference'], '{title}', 'Your leave {reference} still needs its supporting document. Please add it in PRET.', '/my/leave'),
  t('leave_mc_invalid', 'N-14', ['reference'], '{title}', 'The medical certificate for leave {reference} was not accepted. Please sign in to resubmit or convert the leave.', '/my/leave'),
  t('approvals_digest', 'N-15', ['count'], '{title}', 'You have {count} approval(s) waiting for 2 or more working days.', '/approvals'),
  t('approval_escalated', 'N-16', ['approver'], '{title}', 'An approval has been pending for 5 or more working days. Please follow up.', '/approvals'),
  t('delegation_changed', 'N-17', ['change', 'from', 'to', 'scope'], '{title}', 'An approval delegation was {change}. Sign in to see the dates.', '/approvals'),
  // Claims (N-20 … N-29, N-59)
  t('claim_submitted', 'N-20', ['reference', 'employee', 'total'], '{title}', '{employee} submitted claim {reference} for {total}. It is waiting for your approval.', '/approvals?tab=claims'),
  t('claim_approved', 'N-22', ['reference', 'total'], '{title}', 'Your claim {reference} ({total}) has been approved and will be paid in the month-end disbursement.', '/my/claims'),
  t('claim_rejected', 'N-23', ['reference'], '{title}', 'Your claim {reference} was not approved. Sign in to see the reason.', '/my/claims'),
  t('claim_disbursed', 'N-25', ['amount', 'date', 'batch'], '{title}', '{amount} in claims was paid on {date} (batch {batch}).', '/my/claims'),
  t('batch_pending_approval', 'N-26', ['reference', 'total', 'count'], '{title}', 'Disbursement batch {reference} ({count} claims, {total}) is waiting for your approval.', '/claims/batches'),
  t('claim_disbursement_undone', 'N-28', ['reference'], '{title}', 'The payment of claim {reference} was reversed. It will be paid in the next batch. Sign in for details.', '/my/claims'),
  t('claim_cancelled', 'N-59', ['reference', 'by'], '{title}', 'Your approved claim {reference} was cancelled by {by}. Sign in to see the reason.', '/my/claims'),
  // Profile, employment, security (N-41 … N-58)
  t('bank_details_changed', 'N-41', ['changed_on', 'effective_from', 'changed_by'], '{title}',
    'Your bank details in PRET were changed on {changed_on} by {changed_by}, effective {effective_from}. If you did not request this, contact HR immediately.', '/my/profile?tab=bank'),
  t('bank_details_changed_sa', 'N-41', ['employee_no', 'changed_on', 'effective_from', 'changed_by'], '{title}',
    'Bank details of {employee_no} were changed on {changed_on} by {changed_by}, effective {effective_from}.', '/employees'),
  t('change_request_decided', 'N-42', ['cr_no', 'status'], '{title}', 'Your change request {cr_no} was {status}.', '/my/profile/change-requests'),
  t('change_request_submitted', 'N-43', ['cr_no', 'employee_no', 'category'], '{title}', '{employee_no} submitted change request {cr_no} ({category}). Please review it.', '/employees/change-requests'),
  t('probation_ending', 'N-44', ['employee_no', 'probation_end'], '{title}', 'The probation of {employee_no} ends on {probation_end}. Please record the recommendation.', '/reports/probation-due'),
  t('passport_expiring', 'N-46', ['expiry_date'], '{title}', 'Your passport recorded in PRET expires on {expiry_date}. Please update HR when renewed.', '/my/profile'),
  t('document_expiring', 'N-46', ['employee_no', 'expiry_date'], '{title}', 'A document of {employee_no} expires on {expiry_date}.', '/employees'),
  t('employee_confirmed', 'N-47', ['confirmation_date'], '{title}', 'Confirmation date: {confirmation_date}.', '/my/profile'),
  t('separation_recorded', 'N-48', ['employee_no', 'last_working_day'], '{title}', 'A separation was recorded for {employee_no}. Last working day: {last_working_day}.', '/employees'),
  t('account_locked', 'N-52', [], '{title}', 'Your PRET account was locked after repeated unsuccessful sign-ins. If this was not you, contact your administrator.', '/login'),
  t('account_locked_admin', 'N-52', [], '{title}', 'A PRET account was locked after repeated unsuccessful sign-ins. Sign in to review it.', '/users'),
  t('role_changed', 'N-53', ['role', 'change'], '{title}', 'The {role} role was {change} on your PRET account. If you did not expect this, contact your Super Admin.', '/'),
  t('role_changed_admin', 'N-53', ['role', 'change'], '{title}', 'A user\'s {role} role was {change}. Sign in to review it.', '/users'),
  t('external_access_ending', 'N-54', ['end_date', 'days'], '{title}', 'An external administrator\'s access ends on {end_date} ({days} days). Extend it or let it end.', '/users'),
  t('ph_calendar_unpublished', 'N-58', ['year', 'publish_by'], '{title}', 'The {year} public-holiday calendar is not published yet. Please publish it by {publish_by}.', '/organisation/holidays'),
];
export const TEMPLATE_BY_CODE: Record<string, TemplateDef> = Object.fromEntries(EMAIL_TEMPLATES.map((x) => [x.code, x]));

/** Used when an outbox row names a template not in the registry: title + link only (still PDPA-safe). */
export const GENERIC_TEMPLATE: TemplateDef = t('generic', 'N-00', [], '{title}', 'You have a new notification in PRET.');

export function allowedPlaceholders(def: TemplateDef): string[] {
  return [...COMMON_PLACEHOLDERS, ...def.placeholders];
}

const PH_RE = /\{\s*([a-z_][a-z0-9_]*)\s*\}/gi;
export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PH_RE)].map((m) => m[1]!.toLowerCase()))];
}

/** A16 save guard: unknown placeholders and forbidden (sensitive) ones. */
export function validateTemplateText(templateCode: string, text: string): { unknown: string[]; forbidden: string[] } {
  const def = TEMPLATE_BY_CODE[templateCode] ?? GENERIC_TEMPLATE;
  const allowed = new Set(allowedPlaceholders(def));
  const used = placeholdersIn(text);
  const forbidden = used.filter((p) => (FORBIDDEN_KEYS as readonly string[]).includes(p));
  const unknown = used.filter((p) => !allowed.has(p) && !forbidden.includes(p));
  return { unknown, forbidden };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function valueOf(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '';
  return s.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
}

export type RenderInput = {
  templateCode: string;
  /** outbox subject = the event title (already PDPA-safe) */
  title: string;
  payload: Record<string, unknown>;
  /** absolute deep link, or null → origin + template default link */
  link: string | null;
  origin: string;
  companyName: string;
  recipientName?: string | null;
  /** A16 SA override (null → default) */
  override?: { subject?: string | null; body?: string | null } | null;
};

/** Renders subject + plain-text + simple accessible HTML (Sunrise look). Only whitelisted placeholders are substituted. */
export function renderEmail(i: RenderInput): RenderedEmail {
  const def = TEMPLATE_BY_CODE[i.templateCode] ?? GENERIC_TEMPLATE;
  const allowed = new Set(allowedPlaceholders(def));
  const link = i.link ?? `${i.origin.replace(/\/+$/, '')}${def.defaultLink}`;
  const values: Record<string, string> = {
    title: valueOf(i.title).slice(0, 150),
    link,
    company: valueOf(i.companyName),
    recipient_name: valueOf(i.recipientName ?? ''),
  };
  for (const k of def.placeholders) values[k] = valueOf(i.payload[k]);
  const fill = (s: string) => s.replace(PH_RE, (_m, k: string) => (allowed.has(k.toLowerCase()) ? values[k.toLowerCase()] ?? '' : ''));
  let subject = fill(i.override?.subject || def.subject).replace(/\s+/g, ' ').trim().slice(0, 150) || 'PRET notification';
  // BR-NTF-03: emergency leave keeps the [EMERGENCY] prefix even when SA edits the subject
  if (i.payload.emergency === true && def.code === 'leave_submitted' && !subject.startsWith('[EMERGENCY]')) subject = `[EMERGENCY] ${subject}`.slice(0, 150);
  const body = fill(i.override?.body || def.body).trim();
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const greeting = values.recipient_name ? `Hello ${values.recipient_name},` : 'Hello,';
  const footer = `This is an automated message from PRET, ${values.company}'s HR system. Please do not reply. Details are shown only after you sign in.`;
  const text = [greeting, '', ...paragraphs.flatMap((p) => [p, '']), `Open in PRET: ${link}`, '', footer, ''].join('\n');
  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${esc(subject)}</title></head>` +
    '<body style="margin:0;padding:0;background:#f4f1fb;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f1a2e">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1fb;padding:24px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4def3">' +
    '<tr><td style="padding:20px 24px;border-bottom:1px solid #eee8f8;font-weight:700;font-size:18px;color:#4b3a8f">PRET</td></tr>' +
    `<tr><td style="padding:24px"><p style="margin:0 0 16px">${esc(greeting)}</p>` +
    paragraphs.map((p) => `<p style="margin:0 0 16px">${esc(p)}</p>`).join('') +
    `<p style="margin:24px 0"><a href="${esc(link)}" style="display:inline-block;background:#5b45b0;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Open in PRET</a></p>` +
    `<p style="margin:0;font-size:13px;color:#5f5873">${esc(footer)}</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// PDPA check (F-NTF-08) — run on every rendered email before sending and on SA overrides before saving
// ---------------------------------------------------------------------------
const NRIC_RE = /\b\d{6}-?\d{2}-?\d{4}\b/;
const LONG_DIGITS_RE = /\d{9,}/;                       // bank / ASNB / passport-style numbers (references use ≤ 5-digit runs)
const SENSITIVE_WORDS_RE = /\b(diagnos[a-z]*|nric|mykad|salary|net pay|bank account no|account no\.?)\b/i;

/** Returns the problems found (empty = safe). `payload` keys are checked too. */
export function pdpaIssues(rendered: RenderedEmail, payload: Record<string, unknown> = {}): string[] {
  const issues: string[] = [];
  const forbidden = Object.keys(payload).filter((k) => (FORBIDDEN_KEYS as readonly string[]).includes(k.toLowerCase()));
  if (forbidden.length) issues.push(`forbidden payload keys: ${forbidden.join(', ')}`);
  // strip URLs (ids in links are not personal data) before scanning
  const scan = (s: string) => s.replace(/https?:\/\/\S+/g, ' ').replace(/href="[^"]*"/g, ' ');
  for (const [part, value] of [['subject', rendered.subject], ['text', rendered.text], ['html', rendered.html]] as const) {
    const v = scan(value);
    if (NRIC_RE.test(v)) issues.push(`${part}: looks like an NRIC`);
    if (LONG_DIGITS_RE.test(v)) issues.push(`${part}: long number (account / ID)`);
    if (SENSITIVE_WORDS_RE.test(v)) issues.push(`${part}: sensitive wording`);
  }
  if (/<(img|iframe|script|object|embed)\b/i.test(rendered.html) || /attachment/i.test(rendered.html.replace(/href="[^"]*"/g, ''))) {
    issues.push('html: attachments or embedded content');
  }
  return [...new Set(issues)];
}

/** Synthetic sample payload for the A16 PREVIEW (never real data). */
export function samplePayload(templateCode: string): Record<string, unknown> {
  const def = TEMPLATE_BY_CODE[templateCode] ?? GENERIC_TEMPLATE;
  return Object.fromEntries(def.placeholders.map((k) => [k, PLACEHOLDER_INFO[k]?.sample ?? 'Sample']));
}

// ---------------------------------------------------------------------------
// Delivery safety (W2-007 brief rule 6) — which addresses may be emailed
// ---------------------------------------------------------------------------
export type DeliveryDecision = { send: true } | { send: false; reason: string };
const NEVER_DOMAINS = /(^|\.)(example\.(com|org|net)|example|invalid|test|localhost|local)$/i;

export function deliveryDecision(address: string, opts: { mode: 'live' | 'restricted'; allowedDomains: string[]; testRecipients: string[] }): DeliveryDecision {
  const a = address.trim().toLowerCase();
  const at = a.lastIndexOf('@');
  if (at < 1 || at === a.length - 1) return { send: false, reason: 'Invalid address' };
  const domain = a.slice(at + 1);
  if (NEVER_DOMAINS.test(domain) || /^example\./.test(domain)) return { send: false, reason: 'Sample address (example / test domain) — never emailed' };
  if (opts.mode === 'live') return { send: true };
  if (opts.testRecipients.map((x) => x.trim().toLowerCase()).includes(a)) return { send: true };
  if (opts.allowedDomains.map((d) => d.trim().toLowerCase()).includes(domain)) return { send: true };
  return { send: false, reason: 'Restricted delivery: not an allowed domain or test recipient' };
}

/** Back-off after a failed attempt n (1-based) in minutes: 5, 30, 120, 720. */
export function backoffMinutes(attempt: number): number {
  const steps = [5, 30, 120, 720];
  return steps[Math.min(Math.max(attempt, 1), steps.length) - 1]!;
}
