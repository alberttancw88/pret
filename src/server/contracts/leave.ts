// PRET contract — M2 Leave management (W2-004). Screens L1–L14 (leave admin), P1 leave tiles, P2–P6, P8–P10,
// P27 Leave decision view, P28 Replacement-credit decision view (decisions themselves: ./approvals).
// Types + zod only (client-safe). Implementations:
//   queries → src/server/queries/leave.ts (server-only)   actions → src/server/actions/leave.ts ('use server')
//
// Role views (PRD §6, §16; rls-policies §5.4):
//   * EMP — own applications, balances, ledger, credits; team calendar per LP12 (approved only, no type).
//   * MGR — reportees (direct + indirect) and items routed to them (incl. as delegate): applications, balances
//           summary (never the ledger — F-LV-28), calendar with type (Sick/Hospitalisation/Maternity → "Medical").
//           MC attachments only while they can decide that item (Q18, every view logged).
//   * ADM / SA — everything; setup, on-behalf, adjustments, overrides, roll-over. Never on their own record
//           (adjust / override / decide / on-behalf — FR-G-16).
// Balances come only from the ledger (ADR-0005). Days are strings with 1 decimal ("8.5"); dates 'yyyy-mm-dd';
// instants ISO-8601. The UI formats dd/mm/yyyy and days with formatDays() from ./leave-engine.
import { z } from 'zod';
import {
  booleanSchema, isoDateSchema, multi, optionalText, optionalUuidSchema, pageParamsSchema, requiredText, uuidSchema,
  type Stamps,
} from './common';
import { WORKFLOW_APPROVER_SOURCES, type ApprovalTrailRow, type ApproverSource, type PersonRef, type TaskActionability } from './approvals';
import { sessionError } from './leave-engine';

export * from './common';
export * from './leave-engine';

const labels = <T extends string>(m: Record<T, string>) => m;
const optionalDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), isoDateSchema.nullable());
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), z.enum(values).nullable());
const optionalNumber = (min: number, max: number, label: string, step?: 0.5) =>
  z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number({ error: `${label} must be a number.` }).min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`)
      .refine((n) => step !== 0.5 || Number.isInteger(n * 2), `${label} must be in ½-day steps.`).nullable());
const requiredNumber = (min: number, max: number, label: string, step?: 0.5) =>
  z.coerce.number({ error: `${label} is required.` }).min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`)
    .refine((n) => step !== 0.5 || Number.isInteger(n * 2), `${label} must be in ½-day steps.`);
const reason10 = (label = 'Reason') => requiredText(500, label).refine((s) => s.length >= 10, `${label} must be at least 10 characters.`);
/** ddmm "01/11" (LP8). */
const ddmmSchema = z.string().trim().regex(/^(0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])$/, 'Use dd/mm.');
/** client-generated per form instance (EC-LV-09: double-tap → one application) */
const idempotencyKeySchema = uuidSchema;

// ===========================================================================
// Enums (data-model §3 — Leave) + labels + chip tones
// ===========================================================================
export const LEAVE_CATEGORIES = ['annual', 'sick', 'hospitalisation', 'maternity', 'paternity', 'compassionate', 'marriage', 'unpaid', 'replacement', 'emergency', 'study_exam', 'other'] as const;
export type LeaveCategory = (typeof LEAVE_CATEGORIES)[number];
export const LEAVE_CATEGORY_LABELS = labels<LeaveCategory>({
  annual: 'Annual', sick: 'Sick', hospitalisation: 'Hospitalisation', maternity: 'Maternity', paternity: 'Paternity',
  compassionate: 'Compassionate', marriage: 'Marriage', unpaid: 'Unpaid', replacement: 'Replacement', emergency: 'Emergency',
  study_exam: 'Study / Exam', other: 'Other',
});
/** BR-LV-01 / BR-LV-02: EA-protected categories (one active type each; statutory floor). */
export const STATUTORY_CATEGORIES: LeaveCategory[] = ['annual', 'sick', 'hospitalisation', 'maternity', 'paternity'];
/** Q17: shown to managers as "Medical" in calendars; MC attachments are health data (LA11). */
export const MEDICAL_CATEGORIES: LeaveCategory[] = ['sick', 'hospitalisation', 'maternity'];

export const COUNT_BASES = ['working_days', 'calendar_days', 'consecutive_calendar_days'] as const;
export const COUNT_BASIS_LABELS = labels<(typeof COUNT_BASES)[number]>({
  working_days: 'Working days', calendar_days: 'Calendar days', consecutive_calendar_days: 'Consecutive calendar days (fixed block)',
});
export const ENTITLEMENT_METHODS = ['annual_banded', 'fixed_per_occurrence', 'earned_credits', 'no_entitlement'] as const;
export type EntitlementMethod = (typeof ENTITLEMENT_METHODS)[number];
export const ENTITLEMENT_METHOD_LABELS = labels<EntitlementMethod>({
  annual_banded: 'Annual banded entitlement', fixed_per_occurrence: 'Fixed per occurrence', earned_credits: 'Earned credits',
  no_entitlement: 'No entitlement (approval only, optional annual cap)',
});
export const ACCRUAL_METHODS = ['policy_default', 'accrual_pro_rata', 'full_pro_rated', 'accrual_first_year_then_full'] as const;
export type AccrualMethod = (typeof ACCRUAL_METHODS)[number];
export const ACCRUAL_METHOD_LABELS = labels<AccrualMethod>({
  policy_default: 'Use policy default', accrual_pro_rata: 'Accrual on pro-rata basis', full_pro_rated: 'Full entitlement pro-rated',
  accrual_first_year_then_full: 'Accrual in first year, then full',
});
export const PRORATE_BASES = ['by_day', 'by_month'] as const;
export const PRORATE_BASIS_LABELS = labels<(typeof PRORATE_BASES)[number]>({ by_day: 'By day', by_month: 'By completed month' });
export const LEAVE_ROUNDINGS = ['up_half', 'nearest_half', 'down_half', 'employment_act'] as const;
export const LEAVE_ROUNDING_LABELS = labels<(typeof LEAVE_ROUNDINGS)[number]>({
  up_half: 'Round up to nearest half day', nearest_half: 'Nearest half day', down_half: 'Round down to half day',
  employment_act: 'Employment Act rule (< ½ disregarded, ≥ ½ = 1 day)',
});
export const ATTACHMENT_RULES = ['not_required', 'always', 'if_more_than_n_days'] as const;
export type AttachmentRule = (typeof ATTACHMENT_RULES)[number];
export const ATTACHMENT_RULE_LABELS = labels<AttachmentRule>({ not_required: 'Not required', always: 'Always', if_more_than_n_days: 'If more than N days' });
export const NOTICE_BEHAVIOURS = ['warn', 'block'] as const;
export const NOTICE_BEHAVIOUR_LABELS = labels<(typeof NOTICE_BEHAVIOURS)[number]>({ warn: 'Warn', block: 'Block' });
export const OCCURRENCE_SCOPES = ['per_year', 'per_employment'] as const;
export const OCCURRENCE_SCOPE_LABELS = labels<(typeof OCCURRENCE_SCOPES)[number]>({ per_year: 'per year', per_employment: 'per employment' });
export const LEAVE_PAYROLL_TREATMENTS = ['paid', 'unpaid_deduct', 'paid_encashable'] as const;
export const LEAVE_PAYROLL_TREATMENT_LABELS = labels<(typeof LEAVE_PAYROLL_TREATMENTS)[number]>({
  paid: 'Paid', unpaid_deduct: 'Unpaid – deduct', paid_encashable: 'Paid – encashable at exit',
});
export const ELIGIBLE_GENDERS = ['all', 'male', 'female'] as const;
export const ELIGIBLE_GENDER_LABELS = labels<(typeof ELIGIBLE_GENDERS)[number]>({ all: 'All', male: 'Male', female: 'Female' });
export const ELIGIBLE_MARITALS = ['any', 'married'] as const;
export const ELIGIBLE_MARITAL_LABELS = labels<(typeof ELIGIBLE_MARITALS)[number]>({ any: 'Any', married: 'Married' });

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'cancellation_pending', 'cancelled'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LEAVE_STATUS_LABELS = labels<LeaveStatus>({
  pending: 'Pending', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn',
  cancellation_pending: 'Cancellation pending', cancelled: 'Cancelled',
});
/** PRD §6.10 chip colours (StatusChip tone). Pending renders "Pending L1/L2". */
export const LEAVE_STATUS_TONE = labels<LeaveStatus>({
  pending: 'warning', approved: 'success', rejected: 'error', withdrawn: 'grey', cancellation_pending: 'info', cancelled: 'grey',
});
/** L1 default status filter: all except Withdrawn. */
export const DEFAULT_ADMIN_LEAVE_STATUSES: LeaveStatus[] = ['pending', 'approved', 'rejected', 'cancellation_pending', 'cancelled'];

export const LEAVE_SESSIONS = ['full', 'am', 'pm'] as const;
export type LeaveSessionValue = (typeof LEAVE_SESSIONS)[number];
export const LEAVE_SESSION_LABELS = labels<LeaveSessionValue>({ full: 'Full', am: 'AM', pm: 'PM' });

export const MC_STATUSES = ['not_checked', 'verified', 'invalid'] as const;
export type McStatus = (typeof MC_STATUSES)[number];
export const MC_STATUS_LABELS = labels<McStatus>({ not_checked: 'Not checked', verified: 'Verified', invalid: 'Invalid' });
/** L1 "MC check" filter adds Attachment pending. */
export const MC_FILTERS = ['not_checked', 'verified', 'invalid', 'attachment_pending'] as const;
export type McFilter = (typeof MC_FILTERS)[number];

export const LEDGER_ENTRY_TYPES = ['entitlement', 'carry_forward', 'credit_earned', 'taken', 'taken_reversal', 'adjustment', 'expired', 'forfeited'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];
/** P6 transaction labels. Opening balances (is_opening) render "Opening balance"; under accrual the entitlement row reads "Entitlement". */
export const LEDGER_TRANSACTIONS = ['entitlement', 'carry_forward', 'credit_earned', 'taken', 'cancelled', 'adjustment', 'expired', 'forfeited', 'opening'] as const;
export type LedgerTransaction = (typeof LEDGER_TRANSACTIONS)[number];
export const LEDGER_TRANSACTION_LABELS = labels<LedgerTransaction>({
  entitlement: 'Entitlement', carry_forward: 'Carry-forward', credit_earned: 'Credit earned', taken: 'Taken', cancelled: 'Cancelled',
  adjustment: 'Adjustment', expired: 'Expired', forfeited: 'Forfeited', opening: 'Opening balance',
});

export const CREDIT_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];
export const CREDIT_STATUS_LABELS = labels<CreditStatus>({ pending: 'Pending', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn' });
export const CREDIT_STATUS_TONE = labels<CreditStatus>({ pending: 'warning', approved: 'success', rejected: 'error', withdrawn: 'grey' });
export const CREDIT_DURATIONS = ['full_day', 'half_day'] as const;
export type CreditDuration = (typeof CREDIT_DURATIONS)[number];
export const CREDIT_DURATION_LABELS = labels<CreditDuration>({ full_day: 'Full day', half_day: 'Half day' });

export const TEAM_CALENDAR_VISIBILITIES = ['everyone', 'same_department', 'managers_and_hr'] as const;
export const TEAM_CALENDAR_VISIBILITY_LABELS = labels<(typeof TEAM_CALENDAR_VISIBILITIES)[number]>({
  everyone: 'Everyone (type hidden)', same_department: 'Same department (type hidden)', managers_and_hr: 'Managers and HR only',
});
export const ROLLOVER_STATUSES = ['previewed', 'committed', 'superseded'] as const;

/** LT32 fixed accessible palette (swatches). */
export const LEAVE_COLOURS = ['#1E88E5', '#43A047', '#E53935', '#8E24AA', '#3949AB', '#00897B', '#F4511E', '#6D4C41', '#FDD835', '#546E7A', '#D81B60', '#7CB342'] as const;

/** Day kinds for the date picker and the "How is this counted?" breakdown. */
export const DAY_KINDS = ['working', 'half_working', 'off', 'rest', 'public_holiday', 'half_public_holiday', 'calendar', 'not_employed'] as const;
export type CalendarDayKind = (typeof DAY_KINDS)[number];

// ===========================================================================
// Shared refs
// ===========================================================================
export type Ref = { id: string; label: string };
export type LeaveTypeRef = { id: string; code: string; name: string; category: LeaveCategory; colour: string };
export type FileRef = { fileId: string; fileName: string; mimeType: string; sizeBytes: number };
/** An issue from validation: blocks stop submission; warnings need "I understand". */
export type LeaveIssue = { code: string; field: string | null; message: string };

// ===========================================================================
// L8 Leave types list — /leave/setup/types  [ADM, SA]
// ===========================================================================
export const leaveTypeListParamsSchema = pageParamsSchema.extend({
  categories: multi(z.enum(LEAVE_CATEGORIES)),
  active: z.enum(['all', 'active', 'inactive']).default('all'),
  sort: z.enum(['order', 'code', 'name', 'category']).default('order'),
});
export type LeaveTypeListParams = z.input<typeof leaveTypeListParamsSchema>;
export type LeaveTypeRow = {
  id: string; code: string; name: string; category: LeaveCategory;
  isPaid: boolean; countBasis: (typeof COUNT_BASES)[number];
  /** "12 / 12 / 16 by service", "98 consecutive", "Earned credits", "Cap 12/yr", "Pool with SL: 60" */
  entitlementSummary: string;
  workflow: Ref;
  visibleToEmployees: boolean;
  isActive: boolean;
  displayOrder: number;
  colour: string;
  /** BR-LV-01: the statutory five cannot be deactivated while anyone is eligible */
  canDeactivate: boolean;
};

// ===========================================================================
// L9 Leave type form — /leave/setup/types/{code}  [ADM, SA]  (BR-LV-02 statutory floor)
// ===========================================================================
export const leaveTypeSchema = z.object({
  code: z.string({ error: 'Code is required.' }).trim().min(1, 'Code is required.').max(10, 'Code must be at most 10 characters.')
    .regex(/^[A-Za-z0-9]+$/, 'Use letters and digits only.').transform((v) => v.toUpperCase()),    // LT1
  name: requiredText(60, 'Name'),                                                                  // LT2
  category: z.enum(LEAVE_CATEGORIES, { error: 'Select the statutory category.' }),                 // LT3 (locked once used)
  description: optionalText(1000, 'Description'),                                                  // LT4
  isPaid: booleanSchema,                                                                           // LT5
  countBasis: z.enum(COUNT_BASES, { error: 'Select the count basis.' }),                           // LT6
  entitlementMethod: z.enum(ENTITLEMENT_METHODS, { error: 'Select the entitlement method.' }),     // LT7
  accrualOverride: z.enum(ACCRUAL_METHODS).default('policy_default'),                              // LT8
  prorateJoinersLeavers: booleanSchema,                                                            // LT9
  eligibleGender: z.enum(ELIGIBLE_GENDERS).default('all'),                                         // LT10
  eligibleMarital: z.enum(ELIGIBLE_MARITALS).default('any'),                                       // LT11
  minServiceMonths: requiredNumber(0, 120, 'Minimum service'),                                     // LT12
  availableOnProbation: booleanSchema.default(true),                                               // LT13
  halfDayAllowed: booleanSchema,                                                                   // LT14
  reasonRequired: booleanSchema.default(true),                                                     // LT15
  attachmentRule: z.enum(ATTACHMENT_RULES).default('not_required'),                                // LT16
  attachmentThresholdDays: optionalNumber(0.5, 365, 'Attachment threshold', 0.5),                  // LT17
  attachmentGraceHours: requiredNumber(0, 720, 'Attachment after submit (hours)').default(0),      // LT18
  minNoticeDays: requiredNumber(0, 365, 'Minimum notice').default(0),                              // LT19
  minNoticeBehaviour: z.enum(NOTICE_BEHAVIOURS).default('warn'),                                   // LT19
  backdateWorkingDays: requiredNumber(0, 60, 'Back-date allowed'),                                 // LT20
  maxDaysPerApplication: optionalNumber(0.5, 365, 'Max days per application', 0.5),                // LT21
  maxOccurrences: optionalNumber(1, 99, 'Max occurrences'),                                        // LT22
  occurrenceScope: optionalEnum(OCCURRENCE_SCOPES),                                                // LT22
  daysPerOccurrence: optionalNumber(0.5, 365, 'Days per occurrence', 0.5),                         // LT23
  /** "No entitlement" types: optional annual cap (e.g. Unpaid 12 / yr) — W2-004 column annual_cap_days */
  annualCapDays: optionalNumber(0.5, 365, 'Annual cap', 0.5),
  deductFromTypeId: optionalUuidSchema,                                                            // LT24
  poolWithTypeId: optionalUuidSchema,                                                              // LT25
  poolCapDays: optionalNumber(0.5, 365, 'Pool cap', 0.5),                                          // LT25
  carryForwardAllowed: booleanSchema.default(false),                                               // LT26
  cfCapOverride: optionalNumber(0, 365, 'Carry-forward cap', 0.5),                                 // LT27
  cfExpiryMonthsOverride: optionalNumber(0, 24, 'Carry-forward expiry (months)'),                  // LT27
  allowNegative: booleanSchema.default(false),                                                     // LT28
  maxNegativeDays: optionalNumber(0.5, 60, 'Max negative days', 0.5),                              // LT28
  workflowId: uuidSchema,                                                                          // LT29
  selfCancelFutureApproved: booleanSchema.default(true),                                           // LT30
  visibleToEmployees: booleanSchema.default(true),                                                 // LT31
  calendarColour: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/, 'Pick a colour.'),                  // LT32
  payrollTreatment: z.enum(LEAVE_PAYROLL_TREATMENTS, { error: 'Select the payroll treatment.' }),  // LT33
  displayOrder: requiredNumber(0, 999, 'Display order').default(100),                              // LT34
  isActive: booleanSchema.default(true),                                                           // LT34
});
const leaveTypeRule = (v: z.output<typeof leaveTypeSchema>, ctx: z.RefinementCtx) => {
  if (v.attachmentRule === 'if_more_than_n_days' && v.attachmentThresholdDays == null)
    ctx.addIssue({ code: 'custom', path: ['attachmentThresholdDays'], message: 'Enter the day threshold.' });
  if (v.entitlementMethod === 'fixed_per_occurrence' && v.daysPerOccurrence == null)
    ctx.addIssue({ code: 'custom', path: ['daysPerOccurrence'], message: 'Enter the days per occurrence.' });
  if (v.maxOccurrences != null && !v.occurrenceScope)
    ctx.addIssue({ code: 'custom', path: ['occurrenceScope'], message: 'Choose per year or per employment.' });
  if (v.allowNegative && v.maxNegativeDays == null)
    ctx.addIssue({ code: 'custom', path: ['maxNegativeDays'], message: 'Enter the maximum negative days.' });
  if ((v.poolWithTypeId == null) !== (v.poolCapDays == null))
    ctx.addIssue({ code: 'custom', path: ['poolCapDays'], message: 'Choose the pool type and its cap together.' });
  if (v.countBasis === 'consecutive_calendar_days' && v.entitlementMethod !== 'fixed_per_occurrence')
    ctx.addIssue({ code: 'custom', path: ['countBasis'], message: 'Consecutive blocks need "Fixed per occurrence".' });
};
export const saveLeaveTypeSchema = leaveTypeSchema.extend({
  id: optionalUuidSchema.optional(),
  /** optimistic lock (edit) */
  version: z.coerce.number().int().min(1).optional(),
  /** BR-LV-02: SA only — saving below the EA minimum with a logged reason */
  floorOverrideReason: optionalText(500, 'Override reason'),
}).superRefine(leaveTypeRule);
export type SaveLeaveTypeInput = z.input<typeof saveLeaveTypeSchema>;
/** Field key of the BR-LV-02 failure — the UI shows the blocking dialog (ADM: BACK; SA: override reason). */
export const STATUTORY_FLOOR_FIELD = 'statutoryFloor';

export type StatutoryMinimum = { category: LeaveCategory; serviceFromYears: string; serviceToYears: string | null; minDays: string; legalRef: string };
export type LeaveTypeDetail = {
  id: string;
  values: z.output<typeof leaveTypeSchema>;
  categoryLocked: boolean;              // LT3 🔒 once used
  usedByApplications: number;
  bandsSummary: string | null;          // annual banded: "12 / 12 / 16 by service (2027)"
  statutoryMinimums: StatutoryMinimum[];
  floorOverrides: { detail: string; reason: string; approvedByName: string; approvedAt: string }[];
  canDeactivate: boolean;
  version: number;
} & Stamps;
export const leaveTypeIdSchema = z.object({ id: uuidSchema });
export const setLeaveTypeActiveSchema = z.object({ id: uuidSchema, isActive: booleanSchema });
export type SetLeaveTypeActiveInput = z.input<typeof setLeaveTypeActiveSchema>;

// ===========================================================================
// L10 Entitlement bands — /leave/setup/bands?type=AL  [ADM, SA]
// ===========================================================================
export const bandRowSchema = z.object({
  serviceFromYears: requiredNumber(0, 60, 'Service from', 0.5),                                    // EB3
  serviceToYears: optionalNumber(0.5, 99, 'Service to', 0.5),                                      // EB4 (blank = no upper bound)
  daysPerYear: requiredNumber(0, 365, 'Days per year', 0.5),                                       // EB5
  gradeId: optionalUuidSchema,                                                                     // EB6
});
export const saveLeaveBandsSchema = z.object({
  leaveTypeId: uuidSchema,                                                                         // EB1
  effectiveYear: z.coerce.number().int().min(2000).max(2100),                                      // EB2
  rows: z.array(bandRowSchema).min(1, 'Add at least one band.').max(40),
  floorOverrideReason: optionalText(500, 'Override reason'),
}).superRefine((v, ctx) => {
  v.rows.forEach((r, i) => {
    if (r.serviceToYears != null && r.serviceToYears <= r.serviceFromYears)
      ctx.addIssue({ code: 'custom', path: ['rows', i, 'serviceToYears'], message: '"To" must be greater than "From".' });
  });
  const groups = new Map<string, typeof v.rows>();
  for (const r of v.rows) { const k = r.gradeId ?? ''; groups.set(k, [...(groups.get(k) ?? []), r]); }
  for (const rows of groups.values()) {
    const s = [...rows].sort((a, b) => a.serviceFromYears - b.serviceFromYears);
    let ok = s[0]!.serviceFromYears === 0;
    for (let i = 0; i < s.length; i += 1) {
      const next = s[i + 1];
      if (next && s[i]!.serviceToYears !== next.serviceFromYears) ok = false;
      if (!next && s[i]!.serviceToYears !== null) ok = false;
    }
    if (!ok) ctx.addIssue({ code: 'custom', path: ['rows'], message: 'Bands must run from 0 years with no gaps or overlaps (last band open-ended).' });
  }
});
export type SaveLeaveBandsInput = z.input<typeof saveLeaveBandsSchema>;
export type BandRow = {
  id: string; serviceFromYears: string; serviceToYears: string | null; daysPerYear: string;
  grade: Ref | null;
  /** statutory reference column (🔒) for that service band, e.g. "8.0" */
  statutoryMinimum: string | null;
  belowMinimum: boolean;
};
export type LeaveBandSet = {
  leaveType: LeaveTypeRef;
  effectiveYear: number;
  /** versions available for the selector */
  years: number[];
  rows: BandRow[];
  statutoryMinimums: StatutoryMinimum[];
  /** "Entitlements for {n} employees will be recomputed" */
  employeesAffected: number;
};
export type SaveBandsResult = { recomputedEmployees: number };

// ===========================================================================
// L11 Leave policy — /leave/setup/policy  [ADM, SA]  (LP1–LP18 + W2-004 extras)
// ===========================================================================
export const updateLeavePolicySchema = z.object({
  entitlementMethod: z.enum(['accrual_pro_rata', 'full_pro_rated', 'accrual_first_year_then_full']),   // LP2
  prorateBasis: z.enum(PRORATE_BASES),                                                             // LP3
  rounding: z.enum(LEAVE_ROUNDINGS),                                                               // LP4
  eaFloorForJoinersLeavers: booleanSchema,                                                         // LP5
  carryForwardCapDays: requiredNumber(0, 365, 'Carry-forward cap', 0.5),                           // LP6
  carryForwardExpiryMonths: requiredNumber(0, 12, 'Carry-forward expiry'),                         // LP7
  allowNextYearApplications: booleanSchema,                                                        // LP8
  nextYearFromDdmm: ddmmSchema,                                                                    // LP8
  formMessage: optionalText(500, 'Form message'),                                                  // LP9
  emergencyThresholdDays: requiredNumber(0, 30, 'Emergency threshold'),                            // LP10
  emergencyLeaveTypeIds: z.array(uuidSchema).default([]),                                          // LP11
  teamCalendarVisibility: z.enum(TEAM_CALENDAR_VISIBILITIES),                                      // LP12
  notifyOnAdminWithdraw: booleanSchema,                                                            // LP13
  includeSeparatedInReports: booleanSchema,                                                        // LP14
  reminderAfterWorkingDays: requiredNumber(0, 30, 'Reminder after'),                               // LP15 (0 = off)
  escalateAfterWorkingDays: requiredNumber(0, 60, 'Escalate after'),                               // LP15 (0 = off)
  replacementCreditValidityDays: requiredNumber(0, 365, 'Credit validity'),                        // LP16
  replacementCreditsCarryForward: booleanSchema,                                                   // LP17
  replacementForPhOnOffDay: booleanSchema,                                                         // LP18
  replacementWorkedLookbackDays: requiredNumber(0, 365, 'Credit request window'),                  // RC3 setting
  cancellationApproverLevel1Only: booleanSchema,                                                   // §6.10 setting
  paternityWindowDaysAfterBirth: requiredNumber(0, 365, 'Paternity window after birth'),           // BR-LV-47 setting
  teamAbsenceThreshold: requiredNumber(0, 50, 'Team absence threshold'),                           // F-LV-29 (0 = off)
  version: z.coerce.number().int().min(1),
}).refine((v) => v.escalateAfterWorkingDays === 0 || v.reminderAfterWorkingDays === 0 || v.escalateAfterWorkingDays > v.reminderAfterWorkingDays,
  { path: ['escalateAfterWorkingDays'], message: 'Escalation must come after the reminder.' });
export type UpdateLeavePolicyInput = z.input<typeof updateLeavePolicySchema>;
export type LeavePolicy = z.output<typeof updateLeavePolicySchema> & {
  leaveYearStartDdmm: '01/01';                                                                     // LP1 🔒
  /** "Expires 31/03" for LP7 */
  carryForwardExpiryLabel: string;
  emergencyLeaveTypes: LeaveTypeRef[];
} & Stamps;
export type UpdateLeavePolicyResult = {
  /** LP2–LP5 / LP18 changed → ask "Recompute entitlements now?" */
  recomputeSuggested: boolean;
  /** LP18 changed → replacement holidays regenerated for these years */
  replacementHolidaysRegenerated: number[];
};
export const recomputeEntitlementsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  employeeId: optionalUuidSchema.optional(),
});
export type RecomputeEntitlementsInput = z.input<typeof recomputeEntitlementsSchema>;
export type RecomputeResult = { employees: number; changed: number };

// ===========================================================================
// L12 Approval workflows — /leave/setup/workflows  [ADM, SA]
// ===========================================================================
export const workflowLevelSchema = z.object({
  source: z.enum(WORKFLOW_APPROVER_SOURCES, { error: 'Select the approver source.' }),
  specificEmployeeId: optionalUuidSchema,
});
export const saveWorkflowSchema = z.object({
  id: optionalUuidSchema.optional(),
  name: requiredText(80, 'Name'),
  levels: z.array(workflowLevelSchema).min(1, 'Add at least one level.').max(3, 'At most 3 levels.'),
  skipIfApproverIsApplicant: booleanSchema.default(true),
  mergeConsecutiveIdentical: booleanSchema.default(true),
  isActive: booleanSchema.default(true),
}).superRefine((v, ctx) => {
  v.levels.forEach((l, i) => {
    if (l.source === 'specific_employee' && !l.specificEmployeeId)
      ctx.addIssue({ code: 'custom', path: ['levels', i, 'specificEmployeeId'], message: 'Choose the employee.' });
  });
});
export type SaveWorkflowInput = z.input<typeof saveWorkflowSchema>;
export const workflowListParamsSchema = pageParamsSchema.extend({
  active: z.enum(['all', 'active', 'inactive']).default('all'),
  sort: z.enum(['name']).default('name'),
});
export type WorkflowListParams = z.input<typeof workflowListParamsSchema>;
export type WorkflowLevelView = { level: number; source: ApproverSource; sourceLabel: string; specificEmployee: PersonRef | null };
export type WorkflowRow = {
  id: string; name: string;
  /** "Direct manager → Any Admin" */
  levelsLabel: string;
  levels: WorkflowLevelView[];
  usedBy: LeaveTypeRef[];
  skipIfApproverIsApplicant: boolean; mergeConsecutiveIdentical: boolean;
  isActive: boolean;
  /** cannot deactivate while assigned to an active type */
  canDeactivate: boolean;
} & Stamps;
export const workflowPreviewSchema = z.object({ levels: z.array(workflowLevelSchema).min(1).max(3), employeeId: optionalUuidSchema.optional() });
export type WorkflowPreviewInput = z.input<typeof workflowPreviewSchema>;
/** "Example: Ben (reports to Aina) → L1 Aina → L2 any Admin." */
export type WorkflowPreview = { example: string };

// ===========================================================================
// Setup lookups for forms (L2/L5/L6/L7/L9/L12/L13)
// ===========================================================================
export type LeaveSetupOptions = {
  leaveTypes: (LeaveTypeRef & { entitlementMethod: EntitlementMethod; isActive: boolean })[];
  workflows: Ref[];
  grades: Ref[];
  departments: Ref[];
  locations: Ref[];
  currentYear: number;
  statutoryMinimums: StatutoryMinimum[];
};

// ===========================================================================
// P2 Apply leave — /my/leave/apply  [EMP, MGR, ADM, SA]  ·  L2 apply on behalf [ADM, SA]
// ===========================================================================
export type ApplyLeaveTypeOption = LeaveTypeRef & {
  description: string | null;                                       // LT4 (shown when selected)
  countBasis: (typeof COUNT_BASES)[number];
  entitlementMethod: EntitlementMethod;
  halfDayAllowed: boolean;                                          // LT14
  reasonRequired: boolean;                                          // LT15
  attachmentRule: AttachmentRule; attachmentThresholdDays: string | null; attachmentGraceHours: number;   // LT16–18
  daysPerOccurrence: string | null;                                 // LT23 (consecutive → end date read-only)
  requiresConfinementDate: boolean;                                 // LA12 (maternity / paternity)
  allowsChildBirthDate: boolean;                                    // LA13 (paternity)
  /** "8.5 days available" / "approval only" / "cap 12.0 days left" / "98 consecutive days" / "3 of 5 occurrences left" */
  availableLabel: string;
  available: string | null;
  /** L2 only: hidden types (LT31 = No) carry "HR only" */
  hrOnly: boolean;
};
export type ApplyLeaveForm = {
  employee: PersonRef & { department: string; workState: string; isSelf: boolean; status: string };
  /** LP9 */
  formMessage: string | null;
  types: ApplyLeaveTypeOption[];
  /** types the employee is not eligible for with the reason (deep links / HR info) */
  ineligible: { type: LeaveTypeRef; reason: string }[];
  /** "Goes to {name} for approval (level 1 of 2)" for the default workflow */
  approverHint: string | null;
  today: string;
  /** latest leave date accepted (next-year rule, BR-LV-58) */
  maxDate: string;
  /** LA15 cover picker scope: active colleagues */
  emergencyThresholdDays: number;
};

const applyBaseSchema = z.object({
  /** L2 on behalf (ADM/SA): the employee; omitted/null for own application */
  employeeId: optionalUuidSchema.optional(),
  leaveTypeId: uuidSchema,                                                    // LA3
  startDate: isoDateSchema,                                                   // LA4
  startSession: z.enum(LEAVE_SESSIONS).default('full'),                       // LA5
  /** LA6 — ignored for consecutive types (computed: start + LT23 − 1) */
  endDate: isoDateSchema,
  endSession: z.enum(LEAVE_SESSIONS).default('full'),                         // LA7
  reason: optionalText(500, 'Reason'),                                        // LA10
  expectedConfinementDate: optionalDate,                                      // LA12
  childBirthDate: optionalDate,                                               // LA13
  contactPhone: optionalText(20, 'Contact while on leave'),                   // LA14
  coverEmployeeId: optionalUuidSchema,                                        // LA15
  /** L2: required (≥ 10 chars) when acting on behalf */
  onBehalfReason: optionalText(500, 'Reason for acting on behalf'),
});
const sessionsRule = (v: { startDate: string; endDate: string; startSession: LeaveSessionValue; endSession: LeaveSessionValue }, ctx: z.RefinementCtx) => {
  const e = sessionError(v.startDate, v.endDate, v.startSession, v.endSession);
  if (e) ctx.addIssue({ code: 'custom', path: [v.endDate < v.startDate ? 'endDate' : 'startSession'], message: e });
};
/** Live preview while the user types (server action previewLeaveApplication). */
export const previewLeaveSchema = applyBaseSchema.extend({
  attachmentCount: z.coerce.number().int().min(0).max(3).default(0),
});
export type PreviewLeaveInput = z.input<typeof previewLeaveSchema>;
export const applyLeaveSchema = applyBaseSchema.extend({
  attachmentFileIds: z.array(uuidSchema).max(3, 'At most 3 attachments.').default([]),   // LA11 (confirmed uploads)
  /** FR-LV-06: the user ticked "I understand" for the warnings shown */
  acknowledgeWarnings: booleanSchema.default(false),
  idempotencyKey: idempotencyKeySchema,
}).superRefine(sessionsRule);
export type ApplyLeaveInput = z.input<typeof applyLeaveSchema>;

export type DayBreakdown = { date: string; session: LeaveSessionValue; weight: string; kind: CalendarDayKind; label: string };
export type BalancePreview = {
  availableNow: string;                  // Available to apply before this application
  thisApplication: string;
  pending: string;                       // other pending of this type/year
  availableAfter: string;
  /** accrual only: earned to date at the end date (BR-LV-14) */
  earnedToDate: string | null;
  earnedToDateAt: string | null;
  /** pooled types: "Sick + hospitalisation pool: 22.0 of 60 used" */
  pool: { label: string; used: string; cap: string } | null;
  /** true for types without a balance (fixed per occurrence / approval only) */
  notApplicable: boolean;
};
export type LeavePreview = {
  /** end date actually used (consecutive types: computed, read-only) */
  endDate: string;
  endDateFixed: boolean;
  days: string;                          // LA8 total
  breakdown: DayBreakdown[];             // "How is this counted?"
  /** BR-LV-25 split: one entry per leave year */
  parts: { year: number; startDate: string; endDate: string; days: string; balance: BalancePreview }[];
  /** combined panel (first part when split) */
  balance: BalancePreview;
  isEmergency: boolean;                  // LA16
  attachmentRequired: boolean;           // BR-LV-57
  attachmentMayFollow: boolean;          // LT18 > 0 → "You can add the MC within {n} hours"
  blocks: LeaveIssue[];
  warnings: LeaveIssue[];
  /** info lines: split notice, next-year notice, unpublished calendar */
  notes: string[];
  approverHint: string | null;
};
export type SubmitLeaveResult = {
  applications: { id: string; refNo: string; year: number; days: string }[];
  status: LeaveStatus;
  level: number; levels: number;
  /** "Leave submitted — LV-2027-00031 is waiting for {approver} (level 1 of 2)." */
  message: string;
  /** EC-LV-09: true when an earlier submit with the same idempotency key already created it */
  duplicate: boolean;
};

/** Attachments (LA11): request an upload intent → PUT → confirm → pass fileIds to applyLeave / addLeaveAttachment. */
export const requestLeaveUploadSchema = z.object({
  employeeId: optionalUuidSchema.optional(),     // on behalf (ADM/SA)
  leaveTypeId: uuidSchema,                        // decides the data category (Health for SL/HL/ML)
  fileName: requiredText(200, 'File name'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/heic', 'application/pdf'], { error: 'Upload a JPEG, PNG, HEIC or PDF.' }),
  sizeBytes: z.coerce.number().int().min(1).max(10 * 1024 * 1024, 'The file must be 10 MB or smaller.'),
});
export type RequestLeaveUploadInput = z.input<typeof requestLeaveUploadSchema>;
export const fileIdSchema = z.object({ fileId: uuidSchema });
export const addLeaveAttachmentSchema = z.object({ applicationId: uuidSchema, fileIds: z.array(uuidSchema).min(1).max(3) });
export type AddLeaveAttachmentInput = z.input<typeof addLeaveAttachmentSchema>;
export const leaveAttachmentUrlSchema = z.object({ applicationId: uuidSchema, fileId: uuidSchema });
export type LeaveAttachmentUrlInput = z.input<typeof leaveAttachmentUrlSchema>;

// ===========================================================================
// P3 My leave / L1 Leave applications (ADM/SA all; MGR team)
// ===========================================================================
export const myLeaveParamsSchema = pageParamsSchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  leaveTypeIds: multi(uuidSchema),
  statuses: multi(z.enum(LEAVE_STATUSES)),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  sort: z.enum(['from', 'submitted', 'status', 'type']).default('from'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type MyLeaveParams = z.input<typeof myLeaveParamsSchema>;
export type MyLeaveRow = {
  id: string; refNo: string;
  leaveType: LeaveTypeRef;
  startDate: string; startSession: LeaveSessionValue; endDate: string; endSession: LeaveSessionValue;
  days: string;
  status: LeaveStatus; level: number; levels: number;           // "Pending L1/L2"
  isEmergency: boolean;
  onBehalfByName: string | null;
  attachmentPending: boolean;
  submittedAt: string;
  decidedByName: string | null; decidedAt: string | null;
  /** row actions per status (P3) */
  can: { withdraw: boolean; cancel: boolean; requestCancellation: boolean };
};

export const leaveApplicationListParamsSchema = pageParamsSchema.extend({
  employeeId: uuidSchema.optional().catch(undefined),
  locationIds: multi(uuidSchema),
  departmentIds: multi(uuidSchema),
  from: isoDateSchema.optional().catch(undefined),               // leave date from–to
  to: isoDateSchema.optional().catch(undefined),
  leaveTypeIds: multi(uuidSchema),
  /** undefined → DEFAULT_ADMIN_LEAVE_STATUSES */
  statuses: multi(z.enum(LEAVE_STATUSES)),
  emergencyOnly: booleanSchema.default(false),
  onBehalfOnly: booleanSchema.default(false),
  appliedFrom: isoDateSchema.optional().catch(undefined),
  appliedTo: isoDateSchema.optional().catch(undefined),
  level: z.coerce.number().int().min(1).max(3).optional().catch(undefined),
  mcFilters: multi(z.enum(MC_FILTERS)),
  /** undefined → LP14 */
  includeSeparated: booleanSchema.optional(),
  sort: z.enum(['applied', 'from', 'employee', 'type', 'status']).default('applied'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type LeaveApplicationListParams = z.input<typeof leaveApplicationListParamsSchema>;
export type LeaveApplicationRow = {
  id: string; refNo: string;
  employee: PersonRef; department: Ref; location: Ref;
  startDate: string; startSession: LeaveSessionValue; endDate: string; endSession: LeaveSessionValue;
  days: string;
  reason: string | null;
  attachmentCount: number;                                      // 📎
  leaveType: LeaveTypeRef;                                      // approver sees the real type (L1 scope note)
  appliedAt: string;
  status: LeaveStatus; level: number; levels: number;
  /** current approver (pending) or deciding approver + date */
  approverName: string | null; approverAt: string | null;
  isEmergency: boolean; onBehalf: boolean;
  /** ADM/SA only (null for MGR) */
  mcStatus: McStatus | null; attachmentPending: boolean;
  /** open task the current user may decide (bulk selectable) */
  myTaskId: string | null; myTaskVersion: number | null;
};

// ===========================================================================
// P4 / P27 Application detail (role projection)
// ===========================================================================
export type LeaveEventRow = { at: string; event: string; fromStatus: LeaveStatus | null; toStatus: LeaveStatus | null; actorName: string; actingAs: string | null; comment: string | null };
export type TeamOverlapRow = { employee: PersonRef; dates: string[]; status: LeaveStatus; label: string };
export type LeaveApplicationDetail = {
  id: string; refNo: string;                                                   // LA1
  employee: PersonRef & { department: string; position: string };             // LA2
  leaveType: LeaveTypeRef & { countBasis: (typeof COUNT_BASES)[number] };      // LA3
  leaveYear: number;
  startDate: string; startSession: LeaveSessionValue;                          // LA4/LA5
  endDate: string; endSession: LeaveSessionValue;                              // LA6/LA7
  days: string;                                                                // LA8
  breakdown: DayBreakdown[];
  reason: string | null;                                                       // LA10
  expectedConfinementDate: string | null;                                      // LA12
  /** LA13 — null for MGR (E, A, S only) */
  childBirthDate: string | null;
  contactPhone: string | null;                                                 // LA14
  cover: PersonRef | null;                                                     // LA15
  isEmergency: boolean;                                                        // LA16
  onBehalfByName: string | null;                                               // LA17
  /** ADM/SA and the employee only */
  onBehalfReason: string | null;
  status: LeaveStatus; level: number; levels: number;                          // LA18
  trail: ApprovalTrailRow[];                                                   // LA19
  /** next pending level shown greyed: "Waiting for {name}" */
  waitingFor: string | null;
  /** LA20 — ADM/SA only (null otherwise) */
  mcStatus: McStatus | null; mcCheckedByName: string | null; mcCheckedAt: string | null;
  submittedAt: string; decidedAt: string | null;                               // LA21
  cancellationRequestedAt: string | null; cancelledAt: string | null; cancelReason: string | null;
  attachmentPending: boolean; attachmentDueAt: string | null;
  /** LA11: null = not visible to this viewer; MGR sees them only while they can decide (Q18, logged on open) */
  attachments: FileRef[] | null;
  attachmentsLogged: boolean;                                                  // "Viewing is logged"
  /** BR-LV-25 linked part ("Part 2 of 2: LV-…-2") */
  linked: { id: string; refNo: string; part: number } | null;
  /** balance of this type/year at view time (P27 panel / P4 "Balance effect") */
  balance: { available: string; thisApplication: string; otherPending: string; afterApproval: string; earnedToDate: string | null };
  /** P27 overlap card (approver / ADM views only) */
  teamOnLeave: TeamOverlapRow[] | null;
  /** F-LV-29 "⚠ 3 of 5 team members away" */
  teamAbsenceWarning: string | null;
  /** BR-LV-42 HR-only card (maternity) — null for others */
  maternityAllowanceEligible: 'eligible' | 'not_eligible' | 'check' | null;
  /** the open task this user may act on */
  task: TaskActionability | null;
  /** the open cancellation task (cancellation pending) this user may act on */
  cancellationTask: TaskActionability | null;
  /** "Already decided by {name} at …" when the item moved on */
  alreadyDecided: { byName: string; at: string } | null;
  isOwn: boolean;
  can: {
    withdraw: boolean; cancel: boolean; requestCancellation: boolean;            // employee (own)
    withdrawOnBehalf: boolean; cancelOnBehalf: boolean;                         // ADM/SA (not own)
    reassign: boolean;                                                          // ADM/SA (UXQ-05)
    setMcStatus: boolean;                                                       // ADM/SA (F-LV-26), types with attachments
    addAttachment: boolean;                                                     // own, attachment pending / within grace
  };
  events: LeaveEventRow[];
} & Stamps;

// Employee actions
export const applicationIdSchema = z.object({ applicationId: uuidSchema });
export type ApplicationIdInput = z.input<typeof applicationIdSchema>;
export const withdrawLeaveSchema = z.object({ applicationId: uuidSchema, version: z.coerce.number().int().min(1).optional() });
export type WithdrawLeaveInput = z.input<typeof withdrawLeaveSchema>;
export const cancelLeaveSchema = z.object({ applicationId: uuidSchema, reason: optionalText(500, 'Reason') });
export type CancelLeaveInput = z.input<typeof cancelLeaveSchema>;
/** Approved & started/past (or LT30 = No) → Cancellation pending (UXQ-04: reason ≥ 10). */
export const requestCancellationSchema = z.object({ applicationId: uuidSchema, reason: reason10() });
export type RequestCancellationInput = z.input<typeof requestCancellationSchema>;
// HR on behalf (FR-LV-09; LP13 notifications)
export const actOnBehalfSchema = z.object({ applicationId: uuidSchema, reason: reason10() });
export type ActOnBehalfInput = z.input<typeof actOnBehalfSchema>;
// F-LV-26 MC verification
export const setMcStatusSchema = z.object({ applicationId: uuidSchema, mcStatus: z.enum(MC_STATUSES), remarks: optionalText(500, 'Remarks') })
  .refine((v) => v.mcStatus !== 'invalid' || (v.remarks ?? '').length >= 5, { path: ['remarks'], message: 'Say why the MC is invalid (at least 5 characters).' });
export type SetMcStatusInput = z.input<typeof setMcStatusSchema>;

// ===========================================================================
// P5 My balances / P6 Ledger / P1 tiles
// ===========================================================================
export type BalanceCard = {
  leaveType: LeaveTypeRef & { entitlementMethod: EntitlementMethod };
  year: number;
  entitled: string; carriedForward: string; earned: string; adjustments: string;
  taken: string; pending: string; expiredForfeited: string;
  balance: string;                  // BR-LV-20
  available: string;                // Balance − Pending (pooled: min with the pool)
  /** accrual types: earned to date today */
  earnedToDate: string | null;
  /** CF / credits expiring (P1 within 30 days; P5 all) */
  expiring: { days: string; date: string; kind: 'carry_forward' | 'credit' }[];
  pool: { label: string; used: string; cap: string } | null;
  /** fixed-per-occurrence types: occurrences used / max */
  occurrences: { used: number; max: number | null } | null;
  /** "8.5 available" / "98 consecutive days per confinement" / "approval only" */
  availableLabel: string;
};
export type MyBalances = { year: number; years: number[]; cards: BalanceCard[] };
export const balancesYearSchema = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined) });

export const ledgerParamsSchema = pageParamsSchema.extend({
  /** ADM/SA (and MGR → refused: F-LV-28 ledger is not MGR) — omitted = own */
  employeeId: uuidSchema.optional().catch(undefined),
  leaveTypeId: uuidSchema,
  year: z.coerce.number().int().min(2000).max(2100),
  transactions: multi(z.enum(LEDGER_TRANSACTIONS)),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).default('asc'),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type LedgerParams = z.input<typeof ledgerParamsSchema>;
export type LedgerRow = {
  id: string;
  date: string;
  transaction: LedgerTransaction;
  entryType: LedgerEntryType;
  isOpening: boolean;
  days: string;                      // signed, 1 dp
  reference: { kind: 'leave' | 'credit' | 'adjustment' | 'rollover' | 'entitlement'; label: string; href: string | null } | null;
  runningBalance: string;
  byName: string;                    // user or "System"
  reason: string | null;
  expiresOn: string | null;
};
export type LedgerPage = {
  employee: PersonRef;
  leaveType: LeaveTypeRef;
  year: number;
  rows: LedgerRow[]; total: number; page: number; pageSize: number;
  closingBalance: string;
};

export type HomeLeave = {
  tiles: (BalanceCard & { expiringSoon: { days: string; date: string } | null })[];
  pendingItems: { kind: 'leave' | 'credit'; id: string; reference: string; label: string; status: string; tone: string; href: string }[];
  upcoming: { id: string; refNo: string; leaveType: LeaveTypeRef; startDate: string; endDate: string; days: string }[];
  /** MGR only (null otherwise) — F-RPT-22 (probationDue: team, probation ending within 30 days) */
  manager: { approvalsWaiting: number; teamOnLeaveToday: number; teamOnLeaveThisWeek: number; probationDue: number } | null;
  /** Q-F3: ADM/SA only (null otherwise) — company-wide probation ending within 30 days */
  admin: { probationDue: number } | null;
  /** Q-F3: next 3 published public holidays for my work state ("Selangor" label) */
  holidays: { date: string; name: string; half: boolean; state: string; stateLabel: string }[];
  /** "Holiday calendar for {year} not yet published" when the current year has no published calendar */
  holidaysNote: string | null;
  /** "No leave types available yet — contact HR" when empty */
  hasEmployeeRecord: boolean;
};

// ===========================================================================
// P8/P9 Replacement credits (own) · L7 (ADM/SA all, MGR team) · P28 decision view
// ===========================================================================
export const dayKindSchema = z.object({ employeeId: optionalUuidSchema.optional(), date: isoDateSchema });
export type DayKindInput = z.input<typeof dayKindSchema>;
/** RC3 chip: "Rest day" / "Off day" / "Public holiday: Hari Malaysia" / "Working day" */
export type DayKindResult = { kind: CalendarDayKind; label: string; eligible: boolean; message: string | null; duplicateCreditNo: string | null; expiryIfApproved: string };
export const requestCreditSchema = z.object({
  dateWorked: isoDateSchema,                                                       // RC3
  duration: z.enum(CREDIT_DURATIONS, { error: 'Select the duration.' }),           // RC4
  reason: requiredText(500, 'Reason / work done'),                                 // RC5
  attachmentFileId: optionalUuidSchema,                                            // RC6
  idempotencyKey: idempotencyKeySchema,
});
export type RequestCreditInput = z.input<typeof requestCreditSchema>;
export type RequestCreditResult = { id: string; creditNo: string; message: string; duplicate: boolean };
export const batchCreditSchema = z.object({
  employeeIds: z.array(uuidSchema).min(1, 'Select at least one employee.').max(200),
  dateWorked: isoDateSchema,
  duration: z.enum(CREDIT_DURATIONS),
  reason: requiredText(500, 'Reason / work done'),
  idempotencyKey: idempotencyKeySchema,
});
export type BatchCreditInput = z.input<typeof batchCreditSchema>;
export const batchCreditPreviewSchema = z.object({ employeeIds: z.array(uuidSchema).min(1).max(200), dateWorked: isoDateSchema });
export type BatchCreditPreviewInput = z.input<typeof batchCreditPreviewSchema>;
export type BatchCreditPreview = { rows: { employee: PersonRef; kind: CalendarDayKind; label: string; eligible: boolean; note: string | null }[] };
export type BatchCreditResult = { created: { employee: PersonRef; creditNo: string }[]; skipped: { employee: PersonRef; note: string }[] };
export const creditIdSchema = z.object({ creditId: uuidSchema });
export type CreditIdInput = z.input<typeof creditIdSchema>;
/** P28 ADM: COMPENSATE BY PAY (BR-LV-84) — set before approving. */
export const setCompensateByPaySchema = z.object({
  creditId: uuidSchema, compensateByPay: booleanSchema,
  hours: optionalNumber(0.5, 24, 'Hours', 0.5),
}).refine((v) => !v.compensateByPay || v.hours != null, { path: ['hours'], message: 'Enter the hours worked.' });
export type SetCompensateByPayInput = z.input<typeof setCompensateByPaySchema>;

export const creditListParamsSchema = pageParamsSchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  statuses: multi(z.enum(CREDIT_STATUSES)),
  from: isoDateSchema.optional().catch(undefined),     // date worked
  to: isoDateSchema.optional().catch(undefined),
  departmentIds: multi(uuidSchema),
  expiringWithin: z.coerce.number().pipe(z.union([z.literal(30), z.literal(60), z.literal(90)])).optional().catch(undefined),
  employeeId: uuidSchema.optional().catch(undefined),
  sort: z.enum(['dateWorked', 'creditNo', 'expiry', 'employee']).default('dateWorked'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type CreditListParams = z.input<typeof creditListParamsSchema>;
export type CreditRow = {
  id: string; creditNo: string;
  employee: PersonRef; department: string;
  dateWorked: string; dayTypeLabel: string;
  duration: CreditDuration; days: string;
  reason: string;
  status: CreditStatus;
  expiryDate: string | null;
  used: string; remaining: string; expired: string;
  compensateByPay: boolean; compensateHours: string | null;
  enteredByAdmin: boolean;
  submittedAt: string;
  decidedByName: string | null; decidedAt: string | null;
  can: { withdraw: boolean };
  myTaskId: string | null; myTaskVersion: number | null;
};
export type CreditDetail = CreditRow & {
  attachment: FileRef | null;
  trail: ApprovalTrailRow[];
  consumptions: { refNo: string; applicationId: string; days: string; date: string; reversed: boolean }[];
  /** P28 — employee's RL balance now */
  rlAvailable: string;
  expiryIfApproved: string;
  task: TaskActionability | null;
  alreadyDecided: { byName: string; at: string } | null;
  isOwn: boolean;
  canSetCompensateByPay: boolean;
};

// ===========================================================================
// P10 Leave calendar — /leave/calendar  (EMP limited per LP12, MGR team with type, ADM/SA all)
// ===========================================================================
export const calendarParamsSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  view: z.enum(['month', 'week']).default('month'),
  departmentIds: multi(uuidSchema),
  locationIds: multi(uuidSchema),
  /** "Holidays for location" (default: mine) */
  holidayLocationId: uuidSchema.optional().catch(undefined),
  /** only viewers with type visibility */
  leaveTypeIds: multi(uuidSchema),
  /** MGR, ADM, SA */
  includePending: booleanSchema.default(false),
  q: z.string().trim().max(100).optional(),
}).refine((v) => v.to >= v.from, { path: ['to'], message: 'To must be on or after From.' });
export type CalendarParams = z.input<typeof calendarParamsSchema>;
export type CalendarEntry = {
  employeeId: string;
  date: string;
  session: LeaveSessionValue;
  /** peers: "On leave" / "On leave (AM)"; MGR: type name or "Medical"; ADM/SA: type name */
  label: string;
  leaveTypeId: string | null;          // null when the type is hidden
  colour: string | null;               // null when the type is hidden
  status: 'approved' | 'pending' | 'cancellation_pending';
  /** MGR/ADM → S-AP-02; EMP peers: null (no detail) */
  refNo: string | null;
};
export type LeaveCalendar = {
  from: string; to: string;
  scope: 'peer' | 'team' | 'all';
  showTypes: boolean;
  legend: { id: string; label: string; colour: string }[];
  employees: { employeeId: string; name: string; department: string; isSelf: boolean }[];
  entries: CalendarEntry[];
  holidays: { date: string; name: string; type: string; half: boolean; state: string }[];
  holidayLocation: Ref | null;
};

// ===========================================================================
// L3 Leave balances (ADM/SA all; MGR team) — /leave/balances, /team/balances
// ===========================================================================
export const balanceListParamsSchema = pageParamsSchema.extend({
  asAt: isoDateSchema.optional().catch(undefined),               // default today
  departmentIds: multi(uuidSchema),
  locationIds: multi(uuidSchema),
  /** default AL, SL, RL */
  leaveTypeIds: multi(uuidSchema),
  /** 'active' (default) / 'separated' / 'all' (LP14) */
  employmentStatus: z.enum(['active', 'separated', 'all']).default('active'),
  sort: z.enum(['department', 'employee']).default('department'),
});
export type BalanceListParams = z.input<typeof balanceListParamsSchema>;
export type BalanceCell = { entitled: string; taken: string; pending: string; available: string };
export type BalanceListRow = {
  employee: PersonRef; department: Ref; location: Ref;
  monthsOfService: number;
  cells: Record<string, BalanceCell>;          // keyed by leave type id
};
export type BalanceList = {
  asAt: string; year: number;
  types: LeaveTypeRef[];
  rows: BalanceListRow[]; total: number; page: number; pageSize: number;
  /** collapsible group headers with headcount */
  groups: { department: Ref; headcount: number }[];
};

// ===========================================================================
// L4/L5 Balance adjustments [ADM, SA] (not own)
// ===========================================================================
export const adjustmentListParamsSchema = pageParamsSchema.extend({
  employeeId: uuidSchema.optional().catch(undefined),
  leaveTypeIds: multi(uuidSchema),
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  reasonContains: z.string().trim().max(100).optional(),
  sort: z.enum(['date', 'employee']).default('date'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type AdjustmentListParams = z.input<typeof adjustmentListParamsSchema>;
export type AdjustmentRow = {
  id: string; date: string; employee: PersonRef; leaveType: LeaveTypeRef; year: number;
  days: string; reason: string; attachment: FileRef | null; byName: string; createdAt: string; isOpening: boolean;
};
export const adjustBalanceSchema = z.object({
  employeeId: uuidSchema,
  leaveTypeId: uuidSchema,
  year: z.coerce.number().int().min(2000).max(2100),
  direction: z.enum(['add', 'deduct']),
  days: requiredNumber(0.5, 365, 'Days', 0.5),
  reason: reason10(),
  attachmentFileId: optionalUuidSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type AdjustBalanceInput = z.input<typeof adjustBalanceSchema>;
export const adjustmentPreviewSchema = z.object({
  employeeId: uuidSchema, leaveTypeId: uuidSchema, year: z.coerce.number().int().min(2000).max(2100),
  direction: z.enum(['add', 'deduct']).default('add'), days: z.coerce.number().min(0).max(365).default(0),
});
export type AdjustmentPreviewInput = z.input<typeof adjustmentPreviewSchema>;
/** "Balance before 8.5 → after 10.0" */
export type AdjustmentPreview = { before: string; after: string };
export const requestAdjustmentUploadSchema = z.object({
  employeeId: uuidSchema, fileName: requiredText(200, 'File name'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf'], { error: 'Upload a JPEG, PNG or PDF.' }),
  sizeBytes: z.coerce.number().int().min(1).max(10 * 1024 * 1024, 'The file must be 10 MB or smaller.'),
});
export type RequestAdjustmentUploadInput = z.input<typeof requestAdjustmentUploadSchema>;

// ===========================================================================
// L6 Entitlement overrides [ADM, SA] (not own) — F-LV-31
// ===========================================================================
export const overrideListParamsSchema = pageParamsSchema.extend({
  employeeId: uuidSchema.optional().catch(undefined),
  leaveTypeIds: multi(uuidSchema),
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  sort: z.enum(['employee', 'year']).default('employee'),
});
export type OverrideListParams = z.input<typeof overrideListParamsSchema>;
export type OverrideRow = {
  id: string; employee: PersonRef; leaveType: LeaveTypeRef; year: number;
  days: string; bandValue: string | null; reason: string;
  enteredByName: string; enteredAt: string; isActive: boolean;
};
export const saveOverrideSchema = z.object({
  id: optionalUuidSchema.optional(),
  employeeId: uuidSchema,
  leaveTypeId: uuidSchema,
  year: z.coerce.number().int().min(2000).max(2100),
  days: requiredNumber(0, 365, 'Days per year', 0.5),
  reason: reason10(),
  floorOverrideReason: optionalText(500, 'Override reason'),
});
export type SaveOverrideInput = z.input<typeof saveOverrideSchema>;
export type SaveOverrideResult = { id: string; before: string; after: string };
export const overrideIdSchema = z.object({ id: uuidSchema });

// ===========================================================================
// L13 Year-end roll-over [ADM run, SA] — F-LV-19 (+ F-LV-04 regenerate)
// ===========================================================================
export const yearEndSchema = z.object({ closingYear: z.coerce.number().int().min(2000).max(2100) });
export type YearEndInput = z.input<typeof yearEndSchema>;
export type YearEndStatus = {
  closingYear: number;
  window: { from: string; to: string; open: boolean };          // 01/12 – 31/01
  /** blocking: "Publish the 2028 holiday calendar first" */
  blockers: string[];
  pendingInClosingYear: number;                                 // "3 pending — they stay pending"
  alreadyRun: { at: string; byName: string } | null;
  history: { runId: string; closingYear: number; runAt: string; byName: string; employees: number; carried: string; forfeited: string }[];
  canRun: boolean;
};
export const rolloverPreviewParamsSchema = pageParamsSchema.extend({
  closingYear: z.coerce.number().int().min(2000).max(2100),
  departmentIds: multi(uuidSchema),
  onlyForfeiting: booleanSchema.default(false),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type RolloverPreviewParams = z.input<typeof rolloverPreviewParamsSchema>;
export type RolloverLineRow = {
  employee: PersonRef; department: string; leaveType: LeaveTypeRef;
  closingBalance: string; carryForward: string; forfeited: string; cfExpiry: string | null; newYearEntitlement: string;
};
export type RolloverPreview = {
  runId: string; closingYear: number; previewedAt: string;
  rows: RolloverLineRow[]; total: number; page: number; pageSize: number;
  totals: { employees: number; carried: string; forfeited: string };
};
export const runRolloverSchema = z.object({ closingYear: z.coerce.number().int().min(2000).max(2100), runId: uuidSchema });
export type RunRolloverInput = z.input<typeof runRolloverSchema>;
export type RunRolloverResult = { runId: string; alreadyRun: boolean; employees: number; carried: string; forfeited: string; message: string };

// ===========================================================================
// Employee profile Leave tab (E3 tab 10), P31/P32 team leave, E7 leaver (F-LV-27)
// ===========================================================================
export type LeaverPosition = {
  lastWorkingDay: string;
  rows: { leaveType: LeaveTypeRef; entitledToLwd: string; taken: string; balance: string; encashable: string; recoverable: string }[];
  /** BR-LV-92 approved leave dated after LWD — "will be flagged for cancellation" */
  leaveAfterLwd: { refNo: string; startDate: string; endDate: string; days: string }[];
  /** "Encashable 3.5 days" / "Recoverable 1.0 day" (Annual; BR-LV-91) */
  summary: string;
};
export type EmployeeLeaveTab = {
  employee: PersonRef;
  year: number; years: number[];
  balances: BalanceCard[];
  applications: MyLeaveRow[];
  credits: CreditRow[];
  overrides: OverrideRow[];
  leaver: LeaverPosition | null;
  can: { applyOnBehalf: boolean; adjust: boolean; addOverride: boolean; viewLedger: boolean };
};
/** P31 leave columns (Today / This week / AL, SL, RL available / pending items). */
export type TeamLeaveSummary = {
  today: 'full' | 'am' | 'pm' | null;
  thisWeek: { date: string; session: LeaveSessionValue }[];
  alAvailable: string | null; slAvailable: string | null; rlAvailable: string | null;
  pendingItems: number;
};
/** P32 leave section (team scope; ledger not shown — F-LV-28). */
export type TeamMemberLeave = { year: number; balances: BalanceCard[]; applications: MyLeaveRow[] };

// ===========================================================================
// F-LV-35 Opening leave (E2 step 5) — computed before the employee exists
// ===========================================================================
export const openingLeaveFormSchema = z.object({
  joinDate: isoDateSchema,
  continuousServiceDate: optionalDate,
  gradeId: optionalUuidSchema,
  gender: z.enum(['male', 'female']).optional().catch(undefined),
});
export type OpeningLeaveFormInput = z.input<typeof openingLeaveFormSchema>;
export type OpeningLeaveForm = {
  /** step shown only if join date < today and in the current leave year */
  applicable: boolean;
  year: number;
  defaultCfExpiry: string;            // 31/03 by LP7
  rows: { leaveType: LeaveTypeRef & { entitlementMethod: EntitlementMethod }; entitlementThisYear: string; carryForwardAllowed: boolean }[];
  paternityTypeId: string | null;
  /** client-side recompute (leave-engine computeEntitlement) when the join date changes */
  engine: { rounding: (typeof LEAVE_ROUNDINGS)[number]; basis: (typeof PRORATE_BASES)[number]; eaFloor: boolean };
};
export const openingLeaveSchema = z.object({
  rows: z.array(z.object({
    leaveTypeId: uuidSchema,
    takenThisYear: requiredNumber(0, 365, 'Taken this year', 0.5).default(0),
    carryForward: requiredNumber(0, 365, 'Carry-forward remaining', 0.5).default(0),
    carryForwardExpiry: optionalDate,
  })).default([]),
  credits: z.array(z.object({
    dateWorked: isoDateSchema,
    days: z.coerce.number().refine((n) => n === 0.5 || n === 1, 'Credit is 0.5 or 1.0 day.'),
    expiryDate: isoDateSchema,
  })).max(50).default([]),
  paternityOccurrencesUsed: z.coerce.number().int().min(0).max(5).default(0),
});
export type OpeningLeaveInput = z.input<typeof openingLeaveSchema>;
export const saveOpeningLeaveSchema = openingLeaveSchema.extend({ employeeId: uuidSchema });
export type SaveOpeningLeaveInput = z.input<typeof saveOpeningLeaveSchema>;

// ===========================================================================
// Pickers / options while typing
// ===========================================================================
export const leaveEmployeeOptionsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** L2: active + Notice Period (+ Separated tagged "Separated — HR only"); own record excluded */
  includeSeparated: booleanSchema.default(false),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type LeaveEmployeeOptionsInput = z.input<typeof leaveEmployeeOptionsSchema>;
export type LeaveEmployeeOption = PersonRef & { department: string | null; status: string; tag: string | null };
export const calendarMarksSchema = z.object({ employeeId: optionalUuidSchema.optional(), from: isoDateSchema, to: isoDateSchema })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'To must be on or after From.' });
export type CalendarMarksInput = z.input<typeof calendarMarksSchema>;
/** Date picker: PHs dotted, rest/off days greyed (employee's pattern + state calendar), own leave marked. */
export type CalendarMarks = { days: { date: string; kind: CalendarDayKind; label: string; hasLeave: boolean }[] };

// ===========================================================================
// Q-F1 colleague search (P2 cover person LA15) — any signed-in employee; directory-level fields only
// ===========================================================================
export const colleagueOptionsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ColleagueOptionsInput = z.input<typeof colleagueOptionsSchema>;
/** Active (listed) colleagues only; never sensitive fields; the caller is excluded. */
export type ColleagueOption = { id: string; employeeNo: string; name: string; position: string | null };

// Q-F2 attachment downloads (signed URL, access-logged)
export const creditAttachmentUrlSchema = z.object({ creditId: uuidSchema });
export type CreditAttachmentUrlInput = z.input<typeof creditAttachmentUrlSchema>;
export const adjustmentAttachmentUrlSchema = z.object({ adjustmentId: z.string().regex(/^[0-9]+$/, 'Invalid reference.') });
export type AdjustmentAttachmentUrlInput = z.input<typeof adjustmentAttachmentUrlSchema>;

// ===========================================================================
// FUNCTION REGISTER (exact names and signatures — implementations must match)
// ===========================================================================
// Shared types from './common': ActionResult, Paged, CsvFile, UploadIntent. Actions take a plain object or FormData.
//
// QUERIES — src/server/queries/leave.ts (server-only; requireUser([...]) → withUserTx)
//   L8  listLeaveTypes(p: LeaveTypeListParams): Promise<Paged<LeaveTypeRow>>                        [ADM, SA]
//   L9  getLeaveType(code: string): Promise<LeaveTypeDetail | null>                                  [ADM, SA]
//   L10 getLeaveBands(leaveTypeId: string, year?: number): Promise<LeaveBandSet | null>              [ADM, SA]
//   L11 getLeavePolicy(): Promise<LeavePolicy>                                                       [ADM, SA]
//   L12 listWorkflows(p: WorkflowListParams): Promise<Paged<WorkflowRow>>                            [ADM, SA]
//       getWorkflow(id: string): Promise<WorkflowRow | null>                                         [ADM, SA]
//       getLeaveSetupOptions(): Promise<LeaveSetupOptions>                                           [ADM, SA]
//   P2  getApplyLeaveForm(employeeId?: string): Promise<ApplyLeaveForm | null>                       [EMP, MGR, ADM, SA] (employeeId ≠ own → ADM/SA on behalf)
//   P3  listMyLeave(p: MyLeaveParams): Promise<Paged<MyLeaveRow>>                                    [EMP, MGR, ADM, SA]
//   L1  listLeaveApplications(p: LeaveApplicationListParams): Promise<Paged<LeaveApplicationRow>>    [MGR (team + routed), ADM, SA]
//   P4/P27 getLeaveApplication(refNo: string): Promise<LeaveApplicationDetail | null>                [EMP own, MGR team/routed, ADM, SA]
//   P5  getMyBalances(year?: number): Promise<MyBalances | null>                                     [EMP, MGR, ADM, SA] (null = no employee record)
//   P6  getLedger(p: LedgerParams): Promise<LedgerPage | null>                                       [EMP own, ADM, SA] (never MGR — F-LV-28)
//   P1  getHomeLeave(): Promise<HomeLeave>                                                           [EMP, MGR, ADM, SA]
//   P9  listMyCredits(p: CreditListParams): Promise<Paged<CreditRow>>                                [EMP, MGR, ADM, SA]
//   L7  listCredits(p: CreditListParams): Promise<Paged<CreditRow>>                                  [MGR (team + routed), ADM, SA]
//   P28 getCredit(creditNo: string): Promise<CreditDetail | null>                                    [EMP own, MGR team/routed, ADM, SA]
//   P10 getLeaveCalendar(p: CalendarParams): Promise<LeaveCalendar>                                  [EMP, MGR, ADM, SA]
//   L3  listBalances(p: BalanceListParams): Promise<BalanceList>                                     [MGR (team), ADM, SA]
//   L4  listAdjustments(p: AdjustmentListParams): Promise<Paged<AdjustmentRow>>                      [ADM, SA]
//   L6  listOverrides(p: OverrideListParams): Promise<Paged<OverrideRow>>                            [ADM, SA]
//   L13 getYearEnd(closingYear: number): Promise<YearEndStatus>                                      [ADM, SA]
//   E3  getEmployeeLeave(employeeId: string, year?: number): Promise<EmployeeLeaveTab | null>        [ADM, SA]
//   P32 getTeamMemberLeave(employeeId: string, year?: number): Promise<TeamMemberLeave | null>       [MGR (reportee)]
//   P31 teamLeaveSummaries(employeeIds: string[]): Promise<Map<string, TeamLeaveSummary>>            [MGR, ADM, SA] (used by listMyTeam)
//   E7  getLeaverPosition(employeeId: string, lastWorkingDay: string): Promise<LeaverPosition | null>  [ADM, SA]
//
// SERVER ACTIONS — src/server/actions/leave.ts ('use server')
//   L8  exportLeaveTypesCsv(p: LeaveTypeListParams): Promise<ActionResult<CsvFile>>                  [ADM, SA]
//   L9  saveLeaveType(i: SaveLeaveTypeInput): Promise<ActionResult<{ id: string; code: string }>>   [ADM, SA] (BR-LV-02: fieldErrors.statutoryFloor; SA + floorOverrideReason)
//       setLeaveTypeActive(i: SetLeaveTypeActiveInput): Promise<ActionResult>                       [ADM, SA] (BR-LV-01)
//   L10 saveLeaveBands(i: SaveLeaveBandsInput): Promise<ActionResult<SaveBandsResult>>              [ADM, SA] (recomputes entitlements)
//   L11 updateLeavePolicy(i: UpdateLeavePolicyInput): Promise<ActionResult<UpdateLeavePolicyResult>>  [ADM, SA]
//       recomputeEntitlements(i: RecomputeEntitlementsInput): Promise<ActionResult<RecomputeResult>>  [ADM, SA] (also L13 REGENERATE ENTITLEMENTS)
//   L12 saveWorkflow(i: SaveWorkflowInput): Promise<ActionResult<{ id: string }>>                    [ADM, SA]
//       exportWorkflowsCsv(p: WorkflowListParams): Promise<ActionResult<CsvFile>>                   [ADM, SA]
//       previewWorkflow(i: WorkflowPreviewInput): Promise<ActionResult<WorkflowPreview>>            [ADM, SA] (while editing)
//   P2/L2 previewLeaveApplication(i: PreviewLeaveInput): Promise<ActionResult<LeavePreview>>        [EMP, MGR, ADM, SA] (while typing)
//       fetchCalendarMarks(i: CalendarMarksInput): Promise<ActionResult<CalendarMarks>>             [EMP, MGR, ADM, SA] (date picker; ≤ 400 days)
//       requestLeaveUpload(i: RequestLeaveUploadInput): Promise<ActionResult<UploadIntent>>         [EMP, MGR, ADM, SA] (own; ADM/SA on behalf)
//       confirmLeaveUpload(i: { fileId }): Promise<ActionResult<{ fileId: string }>>                [EMP, MGR, ADM, SA]
//       applyLeave(i: ApplyLeaveInput): Promise<ActionResult<SubmitLeaveResult>>                    [EMP, MGR, ADM, SA] (own; on behalf ADM/SA not own; N-01/N-08/N-09)
//   P3/P4 withdrawLeave(i: WithdrawLeaveInput): Promise<ActionResult>                               [EMP, MGR, ADM, SA] (own, Pending; N-04)
//       cancelLeave(i: CancelLeaveInput): Promise<ActionResult>                                     [EMP, MGR, ADM, SA] (own, future Approved, LT30; N-06)
//       requestLeaveCancellation(i: RequestCancellationInput): Promise<ActionResult>                [EMP, MGR, ADM, SA] (own; N-05)
//       addLeaveAttachment(i: AddLeaveAttachmentInput): Promise<ActionResult>                        [EMP, MGR, ADM, SA] (own; ≤ 3)
//       getLeaveAttachmentUrl(i: LeaveAttachmentUrlInput): Promise<ActionResult<{ url: string; fileName: string }>>  [own, MGR while deciding (Q18), ADM, SA] (logged)
//       exportMyLeaveCsv(p: MyLeaveParams): Promise<ActionResult<CsvFile>>                          [EMP, MGR, ADM, SA]
//   L1  exportLeaveApplicationsCsv(p: LeaveApplicationListParams): Promise<ActionResult<CsvFile>>    [MGR, ADM, SA]
//   P27 withdrawLeaveOnBehalf(i: ActOnBehalfInput): Promise<ActionResult>                           [ADM, SA] (not own; N-08)
//       cancelLeaveOnBehalf(i: ActOnBehalfInput): Promise<ActionResult>                             [ADM, SA] (not own; N-08)
//       setMcStatus(i: SetMcStatusInput): Promise<ActionResult>                                     [ADM, SA] (not own; invalid → N-14)
//   P6  exportLedgerCsv(p: LedgerParams): Promise<ActionResult<CsvFile>>                            [EMP own, ADM, SA]
//   P8  fetchDayKind(i: DayKindInput): Promise<ActionResult<DayKindResult>>                         [EMP, MGR, ADM, SA] (RC3 chip while picking)
//       requestReplacementCredit(i: RequestCreditInput): Promise<ActionResult<RequestCreditResult>> [EMP, MGR, ADM, SA] (own; N-11)
//       requestCreditUpload(i: RequestLeaveUploadInput): Promise<ActionResult<UploadIntent>>        [EMP, MGR, ADM, SA] (own; leaveTypeId = RL type)
//   P9  withdrawCredit(i: CreditIdInput): Promise<ActionResult>                                     [EMP, MGR, ADM, SA] (own, Pending)
//       exportMyCreditsCsv(p: CreditListParams): Promise<ActionResult<CsvFile>>                     [EMP, MGR, ADM, SA]
//   L7  previewBatchCredits(i: BatchCreditPreviewInput): Promise<ActionResult<BatchCreditPreview>>  [ADM, SA]
//       batchApplyCredits(i: BatchCreditInput): Promise<ActionResult<BatchCreditResult>>            [ADM, SA] (own record skipped)
//       exportCreditsCsv(p: CreditListParams): Promise<ActionResult<CsvFile>>                       [MGR, ADM, SA]
//   P28 setCompensateByPay(i: SetCompensateByPayInput): Promise<ActionResult>                       [ADM, SA] (not own; Pending)
//   P10 exportLeaveCalendarCsv(p: CalendarParams): Promise<ActionResult<CsvFile>>                   [EMP, MGR, ADM, SA] (same masking)
//   L3  exportBalancesCsv(p: BalanceListParams): Promise<ActionResult<CsvFile>>                     [MGR, ADM, SA]
//   L4  exportAdjustmentsCsv(p: AdjustmentListParams): Promise<ActionResult<CsvFile>>               [ADM, SA]
//   L5  previewAdjustment(i: AdjustmentPreviewInput): Promise<ActionResult<AdjustmentPreview>>      [ADM, SA] (while typing)
//       requestAdjustmentUpload(i: RequestAdjustmentUploadInput): Promise<ActionResult<UploadIntent>>  [ADM, SA]
//       adjustBalance(i: AdjustBalanceInput): Promise<ActionResult<{ id: string; after: string }>>  [ADM, SA] (not own; N-10)
//   L6  saveOverride(i: SaveOverrideInput): Promise<ActionResult<SaveOverrideResult>>               [ADM, SA] (not own; recomputes)
//       removeOverride(i: { id }): Promise<ActionResult>                                            [ADM, SA] (not own; recomputes)
//       exportOverridesCsv(p: OverrideListParams): Promise<ActionResult<CsvFile>>                   [ADM, SA]
//   L13 previewRollover(p: RolloverPreviewParams): Promise<ActionResult<RolloverPreview>>           [ADM, SA]
//       runRollover(i: RunRolloverInput): Promise<ActionResult<RunRolloverResult>>                  [ADM, SA] (idempotent per year; N-18)
//       exportRolloverCsv(p: RolloverPreviewParams): Promise<ActionResult<CsvFile>>                 [ADM, SA]
//   E2  fetchOpeningLeaveForm(i: OpeningLeaveFormInput): Promise<ActionResult<OpeningLeaveForm>>    [ADM, SA]
//       saveOpeningLeave(i: SaveOpeningLeaveInput): Promise<ActionResult<{ entries: number }>>      [ADM, SA] (not own; once per employee)
//   E7  fetchLeaverPosition(i: { employeeId, lastWorkingDay }): Promise<ActionResult<{ position: LeaverPosition | null }>>  [ADM, SA]
//   Q-F1 searchColleagues(i: ColleagueOptionsInput): Promise<ActionResult<{ rows: ColleagueOption[] }>>         [EMP, MGR, ADM, SA]
//   Q-F2 getCreditAttachmentUrl(i: CreditAttachmentUrlInput): Promise<ActionResult<{ url: string; fileName: string }>>  [own, approver while deciding, ADM, SA] (logged)
//        getAdjustmentAttachmentUrl(i: AdjustmentAttachmentUrlInput): Promise<ActionResult<{ url: string; fileName: string }>>  [own, ADM, SA] (logged)
//   Q-F4 fetchCreditApproverHint(): Promise<ActionResult<{ hint: string | null }>>                    [EMP, MGR, ADM, SA] ("Goes to {name} for approval.")
//   pickers: searchLeaveEmployees(i: LeaveEmployeeOptionsInput): Promise<ActionResult<{ rows: LeaveEmployeeOption[] }>>  [ADM, SA] (own record excluded)
//            fetchEmployeeLeaveTab(i: { employeeId, year? }): Promise<ActionResult<{ tab: EmployeeLeaveTab | null }>>    [ADM, SA] (year selector)
//            fetchMyBalances(i: { year? }): Promise<ActionResult<{ balances: MyBalances | null }>>                          [EMP, MGR, ADM, SA]
//
// Decisions (approve / reject / approve or reject cancellation / approve or reject credit / bulk) are in ./approvals
// (decideTask, bulkDecide) — the detail views carry the TaskActionability (taskId + version) to pass.
//
// Error messages the UI may branch on (ActionFail.error is a readable sentence; texts from interaction-notes §4.1):
//   blocks from previewLeaveApplication / applyLeave → fieldErrors keyed by LeaveIssue.field ('startDate', 'leaveTypeId',
//   'attachmentFileIds', 'reason', 'form'); warnings not acknowledged → fieldErrors.acknowledgeWarnings ·
//   own record on HR screens → "You can't do this on your own record." · BR-LV-02 → fieldErrors.statutoryFloor.
