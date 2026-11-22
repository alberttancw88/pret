// PRET contract — M3 Claims management + month-end HLB disbursement + AutoCount export (W2-005).
// Screens: C1–C16 (claims admin), P1 claims tiles, P12 My claims, P13 Claim form, P14 Line editor, P15 Claim detail,
// P26 claims tabs (types in ./approvals), P29 Claim decision view, P30 decision dialog (decideTask / bulkDecide in ./approvals),
// E3 profile Claims tab, P32 team member claims.
// Types + zod only (client-safe). Implementations:
//   queries → src/server/queries/claims.ts (server-only)   actions → src/server/actions/claims.ts ('use server')
//
// Role views (PRD §7, §16; rls-policies §5.6, §8):
//   * EMP — own claims (New ones are private to the owner — BR-CLM-27), own limits and utilisation.
//   * MGR — reportees (direct + indirect) and claims routed to them (incl. as delegate): claims and lines, receipts,
//           decide / cancel; NEVER bank details, batch data, tax/GL snapshots or dependant names (Medical shows "Medical").
//   * ADM / SA — everything incl. setup, on behalf, late overrides, batches, HLB list, AutoCount, zips. Never on their own
//           claim (decide / cancel / disburse / undo / late override — FR-G-16).
// Money is a decimal string "1234.50" (never a JS float — ADR-0006); the UI formats it with MoneyText / formatMoney.
// Dates 'yyyy-mm-dd'; instants ISO-8601; the UI shows dd/mm/yyyy.
import { z } from 'zod';
import {
  booleanSchema, isoDateSchema, multi, optionalText, optionalUuidSchema, pageParamsSchema, requiredText, uuidSchema,
  type Paged, type Stamps,
} from './common';
import type { ApprovalTrailRow, PersonRef, TaskActionability } from './approvals';
import { amountError, distanceError, MAX_FILES_PER_LINE, MAX_LINES, type LimitBasis, type LimitBehaviour, type LimitCheck } from './claims-engine';
import { parseMoney } from '../../lib/format/money';

export * from './common';
export * from './claims-engine';

const labels = <T extends string>(m: Record<T, string>) => m;
const optionalDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), isoDateSchema.nullable());
const idempotencyKeySchema = uuidSchema;
const reason5 = (label = 'Reason') => requiredText(500, label).refine((s) => s.length >= 5, `${label} must be at least 5 characters.`);
const reason10 = (label = 'Reason') => requiredText(500, label).refine((s) => s.length >= 10, `${label} must be at least 10 characters.`);
/** Money typed by the user ("1,234.56", "RM 12") → canonical "1234.56"; '' → null. */
const optionalMoney = (label: string) => z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : typeof v === 'number' ? String(v) : v),
  z.string().nullable().transform((v, ctx) => {
    if (v === null) return null;
    const p = parseMoney(v);
    if (p === null || p.startsWith('-')) { ctx.addIssue({ code: 'custom', message: `${label}: enter an amount like 1,234.56.` }); return z.NEVER; }
    return p;
  }));
const requiredMoney = (label: string) => optionalMoney(label).refine((v) => v !== null, `${label} is required.`).transform((v) => v as string);
/** "yyyy-mm" month picker. */
const monthSchema = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Select a month.');

// ===========================================================================
// Enums (data-model §3 — Claims) + labels + chip tones
// ===========================================================================
export const CLAIM_STATUSES = ['new', 'submitted', 'approved', 'disbursed', 'rejected', 'withdrawn', 'cancelled'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_STATUS_LABELS = labels<ClaimStatus>({
  new: 'New', submitted: 'Submitted', approved: 'Approved', disbursed: 'Disbursed', rejected: 'Rejected', withdrawn: 'Withdrawn', cancelled: 'Cancelled',
});
/** PRD §7.7 chips (outlined = grey/red outline). */
export const CLAIM_STATUS_TONE = labels<ClaimStatus>({
  new: 'grey', submitted: 'warning', approved: 'info', disbursed: 'success', rejected: 'error', withdrawn: 'grey', cancelled: 'error',
});
export const CLAIM_STATUS_OUTLINED = labels<ClaimStatus>({
  new: '', submitted: '', approved: '', disbursed: '', rejected: '', withdrawn: 'outlined', cancelled: 'outlined',
});
/** C1 default status filter (New only appears for on-behalf claims — BR-CLM-27). */
export const DEFAULT_ADMIN_CLAIM_STATUSES: ClaimStatus[] = ['submitted', 'approved', 'disbursed', 'rejected', 'withdrawn', 'cancelled'];

export const CLAIM_GROUPS = ['business_travel', 'meals_entertainment', 'transport_mileage', 'medical', 'communications', 'office_admin',
  'equipment_software', 'marketing_sales', 'employee_wellbeing', 'other'] as const;
export type ClaimGroup = (typeof CLAIM_GROUPS)[number];
export const CLAIM_GROUP_LABELS = labels<ClaimGroup>({
  business_travel: 'Business travel', meals_entertainment: 'Meals & entertainment', transport_mileage: 'Transport & mileage', medical: 'Medical',
  communications: 'Communications', office_admin: 'Office & admin', equipment_software: 'Equipment & software', marketing_sales: 'Marketing & sales',
  employee_wellbeing: 'Employee wellbeing', other: 'Other',
});
export const CAPTURE_MODES = ['hidden', 'optional', 'required'] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];
export const CAPTURE_MODE_LABELS = labels<CaptureMode>({ hidden: 'Hidden', optional: 'Optional', required: 'Required' });
export const CLAIM_EXTRA_FIELDS = ['from_to_purpose', 'client_attendees', 'travel_destination', 'merchant_name'] as const;
export type ClaimExtraField = (typeof CLAIM_EXTRA_FIELDS)[number];
export const CLAIM_EXTRA_FIELD_LABELS = labels<ClaimExtraField>({
  from_to_purpose: 'From / To / Purpose', client_attendees: 'Client / attendees', travel_destination: 'Travel destination', merchant_name: 'Merchant name',
});
export const CLAIMANT_SCOPES = ['employee_only', 'employee_and_dependants'] as const;
export type ClaimantScope = (typeof CLAIMANT_SCOPES)[number];
export const CLAIMANT_SCOPE_LABELS = labels<ClaimantScope>({ employee_only: 'Employee only', employee_and_dependants: 'Employee and dependants' });
export const CLAIM_DEPENDANTS = ['self', 'spouse', 'child'] as const;
export type ClaimDependant = (typeof CLAIM_DEPENDANTS)[number];
export const CLAIM_DEPENDANT_LABELS = labels<ClaimDependant>({ self: 'Self', spouse: 'Spouse', child: 'Child' });
export const TAX_TREATMENTS = ['reimbursement', 'exempt_benefit', 'taxable_allowance', 'taxable_perquisite'] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];
export const TAX_TREATMENT_LABELS = labels<TaxTreatment>({
  reimbursement: 'Reimbursement – business expense (not income)', exempt_benefit: 'Exempt benefit', taxable_allowance: 'Taxable allowance',
  taxable_perquisite: 'Taxable perquisite',
});
export const LIMIT_APPLIES_TO = ['everyone', 'grade', 'department', 'employee_group', 'employee'] as const;
export const LIMIT_APPLIES_TO_LABELS = labels<(typeof LIMIT_APPLIES_TO)[number]>({
  everyone: 'Everyone', grade: 'Grade', department: 'Department', employee_group: 'Employee group', employee: 'Employee',
});
export const LIMIT_BEHAVIOURS = ['block', 'warn'] as const;
export const LIMIT_BEHAVIOUR_LABELS = labels<LimitBehaviour>({ block: 'Block', warn: 'Warn' });
export const LIMIT_PRECEDENCE_NOTE = 'Employee > Department > Grade > Group > Everyone';

export const CLAIM_FLAGS = ['over_limit', 'late_override', 'possible_duplicate', 'on_behalf'] as const;
export type ClaimFlag = (typeof CLAIM_FLAGS)[number];
export const CLAIM_FLAG_LABELS = labels<ClaimFlag>({ over_limit: 'Over limit', late_override: 'Late (override)', possible_duplicate: 'Possible duplicate', on_behalf: 'On behalf' });

export const BATCH_STATUSES = ['draft', 'pending_approval', 'approved', 'exported', 'disbursed', 'cancelled'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];
export const BATCH_STATUS_LABELS = labels<BatchStatus>({
  draft: 'Draft', pending_approval: 'Pending approval', approved: 'Approved', exported: 'Exported', disbursed: 'Disbursed', cancelled: 'Cancelled',
});
export const BATCH_STATUS_TONE = labels<BatchStatus>({
  draft: 'grey', pending_approval: 'warning', approved: 'info', exported: 'info', disbursed: 'success', cancelled: 'error',
});
export const DISBURSED_VIA = ['hlb_batch', 'payroll_run'] as const;
export type DisbursedVia = (typeof DISBURSED_VIA)[number];
export const DISBURSED_VIA_LABELS = labels<DisbursedVia>({ hlb_batch: 'HLB month-end batch', payroll_run: 'PRET payroll run' });
export const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS = labels<PaymentMethod>({ bank_transfer: 'Bank transfer', cheque: 'Cheque', cash: 'Cash' });
export const OUTPUT_KINDS = ['hlb_claims_payment_list_xlsx', 'hlb_claims_payment_list_pdf', 'autocount_claims_xlsx', 'attachment_bundle_zip'] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];
export const OUTPUT_KIND_LABELS = labels<OutputKind>({
  hlb_claims_payment_list_xlsx: 'HLB payment list .xlsx', hlb_claims_payment_list_pdf: 'HLB payment list PDF', autocount_claims_xlsx: 'AutoCount .xlsx',
  attachment_bundle_zip: 'Attachments .zip',
});
/** D16 — fixed route text (🔒 on C10). */
export const BATCH_ROUTE_NOTE = 'Route: Hong Leong Bank Connect First — manual payment list (D16)';
export const HLB_MANUAL_BANNER = 'Key these payments into HLB Connect First manually. PRET does not send anything to the bank.';
/** D31 (9): mileage claims need a Google Maps screenshot as the receipt (also the seeded CC4 text of EMP-TRANS / EMP-TRAVEL). */
export const MILEAGE_RECEIPT_HINT = 'Attach a Google Maps screenshot showing the start point, end point and distance (km).';

// ===========================================================================
// Shared views
// ===========================================================================
export type Ref = { id: string; label: string };
export type FileRef = { fileId: string; fileName: string; mimeType: string; sizeBytes: number };
export type CategoryRef = { id: string; code: string; name: string; group: ClaimGroup; isMileage: boolean };
export type Money = string;
export type ClaimTotals = { total: Money; sst: Money; exclSst: Money };
/** One validation finding (submit / preview). Blocks stop SUBMIT; warnings need "I understand". */
export type ClaimIssue = {
  lineNo: number | null;            // null = claim-level
  lineId: string | null;
  code: string;                     // 'deadline', 'limit', 'receipt', 'notes', 'uuid', 'duplicate', 'eligibility', 'category', 'lwd', 'mileage', 'field'
  field: string | null;             // line field ('transactionDate', 'amountInclSst', 'fileIds', …) or 'title'
  severity: 'block' | 'warn';
  /** "Line 3: Exceeds RM 300.00 per transaction" style sentence (without the "Line n:" prefix) */
  message: string;
};
export type { LimitBasis, LimitBehaviour, LimitCheck };

// ===========================================================================
// C5 / C6 Claim categories — /claims/setup/categories  [ADM, SA]
// ===========================================================================
export const categoryListParamsSchema = pageParamsSchema.extend({
  groups: multi(z.enum(CLAIM_GROUPS)),
  active: z.enum(['all', 'active', 'inactive']).default('all'),
  taxTreatments: multi(z.enum(TAX_TREATMENTS)),
  sort: z.enum(['order', 'code', 'name', 'group']).default('order'),
});
export type CategoryListParams = z.input<typeof categoryListParamsSchema>;
export type CategoryRow = {
  id: string; code: string; name: string; group: ClaimGroup;
  receiptRequired: boolean;
  isMileage: boolean;
  /** current rate (3 dp) for mileage categories */
  mileageRate: string | null;
  /** "RM 300.00 / transaction" (Everyone limit effective today) */
  limitsSummary: string;
  taxTreatment: TaxTreatment;
  glAccountCode: string;
  displayOrder: number;
  isActive: boolean;
};
export type MileageRateRow = { id: string; effectiveFrom: string; ratePerKm: string; setByName: string | null; createdAt: string };
export type CategoryValues = {
  code: string; name: string; group: ClaimGroup; description: string | null;                        // CC1–CC4
  receiptRequired: boolean; notesRequired: boolean; receiptNoMode: CaptureMode; myinvoisUuidMode: CaptureMode; captureSst: boolean;   // CC5–CC9
  isMileage: boolean;                                                                                // CC10
  extraFields: ClaimExtraField[];                                                                    // CC12
  claimantScope: ClaimantScope;                                                                      // CC13
  minServiceMonths: number; eligibleStatuses: ('on_probation' | 'confirmed' | 'notice_period')[]; gradeIds: string[];   // CC14
  taxTreatment: TaxTreatment; eaFormLine: string | null; glAccountCode: string;                     // CC16–CC18
  displayOrder: number; isActive: boolean;                                                           // CC20
};
export type CategoryDetail = {
  id: string; version: number; values: CategoryValues;
  rates: MileageRateRow[];                 // CC11 history (newest first)
  currentRate: string | null;
  limits: LimitRow[];                      // Limits tab
  /** History tab — audit of changes (field · before · after · by · at); SA sees full audit log, ADM sees this projection */
  history: { at: string; byName: string; field: string; before: string | null; after: string | null }[];
  inUse: boolean;                          // has lines (code locked)
} & Stamps;
const ELIGIBLE_STATUSES = ['on_probation', 'confirmed', 'notice_period'] as const;
export const saveCategorySchema = z.object({
  id: uuidSchema.optional().catch(undefined),
  version: z.coerce.number().int().min(1).optional(),
  code: z.string({ error: 'Code is required.' }).trim().min(1, 'Code is required.').max(10, 'Code must be at most 10 characters.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, digits, - or _ only.').transform((v) => v.toUpperCase()),
  name: requiredText(80, 'Name'),
  group: z.enum(CLAIM_GROUPS, { error: 'Select the group.' }),
  description: optionalText(1000, 'Description'),
  receiptRequired: booleanSchema.default(true),
  notesRequired: booleanSchema.default(false),
  receiptNoMode: z.enum(CAPTURE_MODES).default('optional'),
  myinvoisUuidMode: z.enum(CAPTURE_MODES).default('optional'),
  captureSst: booleanSchema.default(true),
  isMileage: booleanSchema.default(false),
  /** CC11 — required when isMileage and the category has no rate yet; a changed rate adds a history row */
  mileageRate: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : String(v).trim()),
    z.string().regex(/^\d{1,4}(\.\d{1,3})?$/, 'Rate must be RM/km with at most 3 decimals.').nullable()),
  mileageRateFrom: optionalDate,
  extraFields: z.array(z.enum(CLAIM_EXTRA_FIELDS)).default([]),
  claimantScope: z.enum(CLAIMANT_SCOPES).default('employee_only'),
  minServiceMonths: z.coerce.number().int().min(0).max(600).default(0),
  eligibleStatuses: z.array(z.enum(ELIGIBLE_STATUSES)).min(1, 'Select at least one status.').default(['on_probation', 'confirmed', 'notice_period']),
  gradeIds: z.array(uuidSchema).default([]),
  taxTreatment: z.enum(TAX_TREATMENTS, { error: 'Select the tax treatment.' }),
  eaFormLine: optionalText(40, 'EA form line'),
  glAccountCode: requiredText(20, 'AutoCount GL account'),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(100),
  isActive: booleanSchema.default(true),
}).superRefine((v, ctx) => {
  if (v.mileageRate !== null && Number(v.mileageRate) <= 0) ctx.addIssue({ code: 'custom', path: ['mileageRate'], message: 'Rate must be more than 0.' });
  if (v.isMileage && !v.id && !v.mileageRate) ctx.addIssue({ code: 'custom', path: ['mileageRate'], message: 'Enter the mileage rate (RM/km).' });
});
export type SaveCategoryInput = z.input<typeof saveCategorySchema>;
export const setCategoryActiveSchema = z.object({ id: uuidSchema, isActive: booleanSchema });
export type SetCategoryActiveInput = z.input<typeof setCategoryActiveSchema>;

// ===========================================================================
// C7 Claim limits — /claims/setup/limits  [ADM, SA] (own limits visible to EMP through utilisation)
// ===========================================================================
export const limitListParamsSchema = pageParamsSchema.extend({
  categoryIds: multi(uuidSchema),
  appliesTo: multi(z.enum(LIMIT_APPLIES_TO)),
  effectiveOn: isoDateSchema.optional().catch(undefined),
  behaviours: multi(z.enum(LIMIT_BEHAVIOURS)),
  sort: z.enum(['category', 'appliesTo', 'from']).default('category'),
});
export type LimitListParams = z.input<typeof limitListParamsSchema>;
export type LimitRow = {
  id: string;
  category: CategoryRef;
  appliesTo: (typeof LIMIT_APPLIES_TO)[number];
  /** grade / department / group / employee label ("INT-004 Ben Lee") — null for Everyone */
  target: Ref | null;
  perTransaction: Money | null; perMonth: Money | null; perYear: Money | null;
  behaviour: LimitBehaviour;
  effectiveFrom: string; effectiveTo: string | null;
  isCurrent: boolean;
  canEdit: boolean; canEnd: boolean;
};
export const saveLimitSchema = z.object({
  id: uuidSchema.optional().catch(undefined),
  categoryId: uuidSchema,                                                            // CLM-L1
  appliesTo: z.enum(LIMIT_APPLIES_TO, { error: 'Select who it applies to.' }),        // CLM-L2
  targetId: optionalUuidSchema,                                                      // CLM-L3
  perTransaction: optionalMoney('Per transaction'),                                  // CLM-L4
  perMonth: optionalMoney('Per month'),                                              // CLM-L5
  perYear: optionalMoney('Per year'),                                                // CLM-L6
  behaviour: z.enum(LIMIT_BEHAVIOURS).default('block'),                              // CLM-L7
  effectiveFrom: isoDateSchema,                                                      // CLM-L8
  effectiveTo: optionalDate,
}).superRefine((v, ctx) => {
  if (v.appliesTo !== 'everyone' && !v.targetId) ctx.addIssue({ code: 'custom', path: ['targetId'], message: 'Select the target.' });
  if (!v.perTransaction && !v.perMonth && !v.perYear) ctx.addIssue({ code: 'custom', path: ['perTransaction'], message: 'Enter at least one amount.' });
  const n = (s: string | null) => (s === null ? null : Number(s));
  if (n(v.perMonth) !== null && n(v.perTransaction) !== null && n(v.perMonth)! < n(v.perTransaction)!)
    ctx.addIssue({ code: 'custom', path: ['perMonth'], message: 'Per month must be at least the per-transaction amount.' });
  if (n(v.perYear) !== null && n(v.perMonth) !== null && n(v.perYear)! < n(v.perMonth)!)
    ctx.addIssue({ code: 'custom', path: ['perYear'], message: 'Per year must be at least the per-month amount.' });
  if (v.effectiveTo && v.effectiveTo < v.effectiveFrom) ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'To must be on or after From.' });
});
export type SaveLimitInput = z.input<typeof saveLimitSchema>;
export const endLimitSchema = z.object({ id: uuidSchema, effectiveTo: isoDateSchema });
export type EndLimitInput = z.input<typeof endLimitSchema>;

// ===========================================================================
// C8 Claims settings — /claims/setup/settings  [ADM, SA] (SA-only toggle 🔒)
// ===========================================================================
export type ClaimPolicy = {
  submissionDeadlineDays: number;            // default 60 (BR-CLM-10, Q21)
  limitRefreshDay: number;                   // 1–31; 31 = month end
  disbursementCutoffDay: number;             // 1–31; 31 = "Last day of the month"
  notesRequiredDefault: boolean;
  attachmentsRequiredDefault: boolean;
  newClaimReminderDays: number;              // BR-CLM-27 (90)
  includeSeparatedDefault: boolean;          // C1 "Include separated employees" default
  autocountDocumentDateBasis: 'approval' | 'disbursed';
  /** gl_mappings.claims_payable (credit account on the AutoCount export) */
  claimsPayableGl: string | null;
  /** security_settings.sa_batch_approval_required — editable by SA only (US-CLAIM-004) */
  saBatchApprovalRequired: boolean;
  canEditSaSetting: boolean;
} & Stamps;
export const updateClaimPolicySchema = z.object({
  submissionDeadlineDays: z.coerce.number().int().min(1, 'At least 1 day.').max(366, 'At most 366 days.'),
  limitRefreshDay: z.coerce.number().int().min(1).max(31),
  disbursementCutoffDay: z.coerce.number().int().min(1).max(31),
  notesRequiredDefault: booleanSchema.default(false),
  attachmentsRequiredDefault: booleanSchema.default(true),
  newClaimReminderDays: z.coerce.number().int().min(1).max(366).default(90),
  includeSeparatedDefault: booleanSchema.default(false),
  autocountDocumentDateBasis: z.enum(['approval', 'disbursed']).default('approval'),
  claimsPayableGl: optionalText(20, 'Claims-payable account'),
  /** ignored unless the caller is SA */
  saBatchApprovalRequired: booleanSchema.optional(),
});
export type UpdateClaimPolicyInput = z.input<typeof updateClaimPolicySchema>;

export type ClaimSetupOptions = {
  grades: Ref[]; departments: Ref[]; employeeGroups: Ref[]; costCentres: Ref[];
  /** distinct GL codes already used (autocomplete; there is no GL master list in PRET — see report) */
  glAccounts: string[];
  claimsPayableGl: string | null;
};

// ===========================================================================
// P13 / P14 / C2 Claim form (create / edit New)
// ===========================================================================
/** Category as offered on a line (active + eligible for the employee — BR-CLM-18). */
export type ClaimFormCategory = CategoryRef & {
  description: string | null;               // CC4 policy text under the select
  receiptRequired: boolean; notesRequired: boolean;
  receiptNoMode: CaptureMode; myinvoisUuidMode: CaptureMode; captureSst: boolean;
  extraFields: ClaimExtraField[];
  claimantScope: ClaimantScope;
  /** rate effective today (the line uses the rate effective on its transaction date — fetchMileageAmount) */
  currentRate: string | null;
  limitSummary: string;
  hasLimit: boolean;
  /** shown next to the receipt control (D31): MILEAGE_RECEIPT_HINT for mileage categories that require a receipt, else null */
  receiptHint: string | null;
};
export type ClaimForm = {
  employee: PersonRef & { department: string; status: string };
  isOnBehalf: boolean;
  categories: ClaimFormCategory[];
  costCentres: Ref[];                       // CLN18 (empty → field hidden)
  defaultCostCentreId: string | null;
  deadlineDays: number;
  /** today − deadline (date picker min unless a late override exists) */
  earliestTransactionDate: string;
  today: string;
  /** latest allowed transaction date: min(today, LWD) — BR-CLM-18 */
  latestTransactionDate: string;
  /** CLN14 dependant choices (own claim, categories allowing dependants only) */
  dependants: { kind: 'spouse' | 'child'; name: string }[];
  /** "Goes to {manager} or any Admin for approval." */
  approverHint: string | null;
  /** edit mode */
  claim: ClaimDetail | null;
};

const lineMoney = (label: string) => requiredMoney(label);
export const claimLineSchema = z.object({
  id: uuidSchema.optional().catch(undefined),                                 // existing line (edit)
  categoryId: uuidSchema,                                                     // CLN2
  transactionDate: isoDateSchema,                                             // CLN3
  description: optionalText(500, 'Description'),                              // CLN4
  merchant: optionalText(100, 'Merchant'),                                    // CLN5
  receiptNo: optionalText(50, 'Receipt no.'),                                 // CLN6
  myinvoisUuid: z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v ?? null),
    z.string().regex(/^[A-Za-z0-9-]{1,40}$/, 'UUID: letters, digits and - only (max 40).').nullable()),   // CLN7
  /** ignored for mileage categories (computed = round(km × rate, 2)) */
  amountInclSst: optionalMoney('Amount'),                                     // CLN8
  sstAmount: optionalMoney('SST amount'),                                     // CLN9
  fromPlace: optionalText(100, 'From'), toPlace: optionalText(100, 'To'), purpose: optionalText(100, 'Purpose'),   // CLN10
  distanceKm: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : String(v).trim()), z.string().nullable()),   // CLN11
  clientAttendees: optionalText(300, 'Client / attendees'),                   // CLN13
  travelDestination: optionalText(100, 'Travel destination'),
  claimant: z.enum(CLAIM_DEPENDANTS).default('self'),                         // CLN14
  dependantName: optionalText(150, 'Dependant name'),
  costCentreId: optionalUuidSchema,                                           // CLN18
  fileIds: z.array(uuidSchema).max(MAX_FILES_PER_LINE, `At most ${MAX_FILES_PER_LINE} receipts per line.`).default([]),   // CLN15
}).superRefine((v, ctx) => {
  if (v.distanceKm !== null) {
    const e = distanceError(v.distanceKm);
    if (e) ctx.addIssue({ code: 'custom', path: ['distanceKm'], message: e });
  } else {
    if (!v.amountInclSst) ctx.addIssue({ code: 'custom', path: ['amountInclSst'], message: 'Enter the amount (RM).' });
    else {
      const e = amountError(v.amountInclSst, v.sstAmount);
      if (e) ctx.addIssue({ code: 'custom', path: [e.field], message: e.message });
    }
  }
  if (v.claimant !== 'self' && !v.dependantName) ctx.addIssue({ code: 'custom', path: ['dependantName'], message: 'Select the dependant.' });
});
export type ClaimLineInput = z.input<typeof claimLineSchema>;

/** SAVE (status New). First save creates CL-yyyy-nnnnn. Category-specific requirements are checked by the database. */
export const saveClaimSchema = z.object({
  claimId: uuidSchema.optional().catch(undefined),
  expectedVersion: z.coerce.number().int().min(1).optional(),
  /** C2 on behalf (ADM/SA; not own) — omitted for own claims */
  employeeId: uuidSchema.optional().catch(undefined),
  onBehalfNote: optionalText(300, 'On-behalf note'),
  title: requiredText(120, 'Title / purpose'),                                // CH3
  projectRef: optionalText(60, 'Project / customer reference'),               // CH4
  lines: z.array(claimLineSchema).min(1, 'Add at least one line.').max(MAX_LINES, `At most ${MAX_LINES} lines.`),
  idempotencyKey: idempotencyKeySchema,
});
export type SaveClaimInput = z.input<typeof saveClaimSchema>;
export type SaveClaimResult = { id: string; claimNo: string; version: number; totals: ClaimTotals; lineIds: string[]; duplicate: boolean };

export const submitClaimSchema = z.object({
  claimId: uuidSchema,
  expectedVersion: z.coerce.number().int().min(1).optional(),
  /** "[x] I understand" for Warn limits / possible duplicates */
  acknowledgeWarnings: booleanSchema.default(false),
});
export type SubmitClaimInput = z.input<typeof submitClaimSchema>;
/** submitted=false → nothing changed; show `issues` in the summary card (blocks, or warnings needing acknowledgement). */
export type SubmitClaimResult = {
  submitted: boolean;
  claimNo: string;
  status: ClaimStatus;
  issues: ClaimIssue[];
  needsAcknowledgement: boolean;
  /** "Submitted — waiting for approval by {manager} or an Admin." */
  message: string;
};
export const claimIdSchema = z.object({ claimId: uuidSchema });
export type ClaimIdInput = z.input<typeof claimIdSchema>;
export type ValidateClaimResult = { issues: ClaimIssue[]; lines: { lineId: string; lineNo: number; limitCheck: LimitCheck | null }[] };

// While typing (P14)
export const checkClaimLineSchema = z.object({
  employeeId: uuidSchema.optional().catch(undefined),
  claimId: uuidSchema.optional().catch(undefined),
  lineId: uuidSchema.optional().catch(undefined),
  categoryId: uuidSchema,
  transactionDate: isoDateSchema,
  amountInclSst: optionalMoney('Amount'),
  distanceKm: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : String(v).trim()), z.string().nullable()).optional(),
  receiptNo: optionalText(50, 'Receipt no.'),
  myinvoisUuid: optionalText(40, 'UUID'),
  merchant: optionalText(100, 'Merchant'),
  /** amounts of the OTHER unsaved lines of this claim in the same category: [{ transactionDate, amountInclSst }] */
  otherLines: z.array(z.object({ categoryId: uuidSchema, transactionDate: isoDateSchema, amountInclSst: z.string() })).max(MAX_LINES).default([]),
});
export type CheckClaimLineInput = z.input<typeof checkClaimLineSchema>;
export type ClaimLineCheck = {
  limit: LimitCheck | null;                 // CLN16 chip
  /** BR-CLM-10 — "Older than 60 days — Admin override required" / null; lateOverride=true → chip "Late (override)" */
  deadline: { ok: boolean; message: string | null; lateOverride: boolean };
  /** BR-CLM-17 warning ("Same receipt no. on CL-2027-00077") */
  duplicate: string | null;
  /** BR-CLM-16 block ("UUID already claimed on CL-…") */
  uuidClash: string | null;
  /** mileage: amount computed with the rate effective on the transaction date */
  mileage: { ratePerKm: string; amount: Money } | null;
};
export const mileageAmountSchema = z.object({ categoryId: uuidSchema, transactionDate: isoDateSchema, distanceKm: z.string().trim() })
  .superRefine((v, ctx) => { const e = distanceError(v.distanceKm); if (e) ctx.addIssue({ code: 'custom', path: ['distanceKm'], message: e }); });
export type MileageAmountInput = z.input<typeof mileageAmountSchema>;
export type MileageAmountResult = { ratePerKm: string; amount: Money; rateLabel: string /* "RM 0.500/km" */ };
export const approverHintSchema = z.object({ employeeId: uuidSchema.optional().catch(undefined) });
export type ApproverHintInput = z.input<typeof approverHintSchema>;

// Receipts (CLN15) — JPG/PNG/HEIC/PDF ≤ 10 MB (FR-G-12)
export const CLAIM_RECEIPT_MIME = ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'] as const;
export const requestClaimUploadSchema = z.object({
  /** on behalf (ADM/SA); omitted = own */
  employeeId: uuidSchema.optional().catch(undefined),
  fileName: requiredText(200, 'File name'),
  mimeType: z.enum(CLAIM_RECEIPT_MIME, { error: 'Upload a JPG, PNG, HEIC or PDF file.' }),
  sizeBytes: z.coerce.number().int().min(1).max(10 * 1024 * 1024, 'The file must be 10 MB or smaller.'),
  /** Medical categories → health data category (logged on every download) */
  categoryId: uuidSchema.optional().catch(undefined),
});
export type RequestClaimUploadInput = z.input<typeof requestClaimUploadSchema>;
export const fileIdSchema = z.object({ fileId: uuidSchema });
export const claimReceiptUrlSchema = z.object({ claimId: uuidSchema, fileId: uuidSchema });
export type ClaimReceiptUrlInput = z.input<typeof claimReceiptUrlSchema>;

export const copyClaimSchema = z.object({ claimId: uuidSchema, idempotencyKey: idempotencyKeySchema });
export type CopyClaimInput = z.input<typeof copyClaimSchema>;
export const cancelClaimSchema = z.object({ claimId: uuidSchema, reason: reason5('Reason') });
export type CancelClaimInput = z.input<typeof cancelClaimSchema>;
export const undoDisbursementSchema = z.object({ claimId: uuidSchema, reason: reason5('Reason') });
export type UndoDisbursementInput = z.input<typeof undoDisbursementSchema>;

// ===========================================================================
// P15 / P29 Claim detail (own / approver / admin)
// ===========================================================================
export type ClaimLineView = {
  id: string; lineNo: number;
  category: CategoryRef;
  transactionDate: string;
  description: string | null; merchant: string | null; receiptNo: string | null; myinvoisUuid: string | null;
  amountInclSst: Money; sstAmount: Money; amountExclSst: Money;
  fromPlace: string | null; toPlace: string | null; purpose: string | null;
  distanceKm: string | null; ratePerKm: string | null;
  clientAttendees: string | null; travelDestination: string | null;
  /** "Self" / "Spouse" / "Child" — MGR sees "Medical" for dependant medical lines (Q18), null otherwise */
  claimantLabel: string | null;
  claimant: ClaimDependant | null;          // own / ADM / SA only
  dependantName: string | null;             // T2: own / ADM / SA only
  costCentre: Ref | null;                   // ADM / SA (and own)
  files: FileRef[];
  limitCheck: LimitCheck | null;            // CLN16 (as at the last validation)
  /** BR-CLM-17 "Same receipt no. on CL-2027-00077" */
  duplicateWarnings: string[];
  lateOverride: boolean;
  /** CLN17 — ADM / SA only, after approval */
  taxTreatment: TaxTreatment | null; eaFormLine: string | null; glAccount: string | null;
};
export type ClaimEvent = { at: string; event: string; fromStatus: ClaimStatus | null; toStatus: ClaimStatus | null; actorName: string; comment: string | null; batchNo: string | null };
export type ClaimDisbursement = {
  via: DisbursedVia | null;
  batchId: string | null; batchNo: string | null; batchStatus: BatchStatus | null;
  plannedPaymentDate: string | null;
  disbursedOn: string | null; paymentReference: string | null;
  /** latest undo: "Payment reversed — {reason}; will be paid in the next batch" */
  undoneReason: string | null;
};
export type LimitUtilisationRow = {
  category: CategoryRef;
  basis: LimitBasis;
  /** "Nov 2027" / "2027" / "per transaction" */
  periodLabel: string;
  periodFrom: string | null; periodTo: string | null;
  used: Money; limit: Money; remaining: Money;
  behaviour: LimitBehaviour;
};
export type LimitUtilisation = {
  asOf: string;
  rows: LimitUtilisationRow[];
  /** categories without any limit ("No limit", collapsed) */
  unlimitedCategories: string[];
};
export type ClaimDetail = {
  id: string; claimNo: string; version: number;
  employee: PersonRef & { department: string; position: string };
  title: string; projectRef: string | null;
  totals: ClaimTotals;
  status: ClaimStatus;
  flags: ClaimFlag[];
  onBehalfByName: string | null; onBehalfNote: string | null;
  copiedFrom: { id: string; claimNo: string } | null;
  submittedAt: string | null;
  decision: { byName: string; at: string; actingAs: string | null; reason: string | null; outcome: 'approved' | 'rejected' } | null;
  cancellation: { byName: string; at: string; reason: string } | null;
  /** null for managers (CH11–CH13 are E, A, S only) */
  disbursement: ClaimDisbursement | null;
  lines: ClaimLineView[];
  trail: ApprovalTrailRow[];
  /** open approval task (P29 APPROVE / REJECT via decideTask) */
  task: TaskActionability | null;
  /** "Waiting for Ben Lee or any Admin" */
  waitingFor: string | null;
  waitingWorkingDays: number | null;
  alreadyDecided: { byName: string; at: string } | null;
  /** the employee's utilisation for the categories on this claim (P29) */
  utilisation: LimitUtilisationRow[];
  events: ClaimEvent[];
  isOwn: boolean;
  /** BR-CLM-27: New claim saved more than 90 days ago */
  staleNew: boolean;
  can: {
    edit: boolean; submit: boolean; delete: boolean; withdraw: boolean; copy: boolean;
    cancel: boolean; undoDisbursement: boolean; applyLateOverride: boolean; downloadReceipts: boolean;
  };
  /** "You can't decide your own claim." / "You entered this claim on behalf — another approver must decide." */
  blockedReason: string | null;
} & Stamps;

// ===========================================================================
// P12 My claims — /my/claims (+ utilisation panel)
// ===========================================================================
export const myClaimsParamsSchema = pageParamsSchema.extend({
  statuses: multi(z.enum(CLAIM_STATUSES)),
  categoryIds: multi(uuidSchema),
  year: z.coerce.number().int().min(2000).max(2999).optional().catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  sort: z.enum(['created', 'submitted', 'claimNo', 'total', 'status']).default('created'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type MyClaimsParams = z.input<typeof myClaimsParamsSchema>;
export type MyClaimRow = {
  id: string; claimNo: string; title: string; lineCount: number;
  total: Money; totalSst: Money;
  status: ClaimStatus; flags: ClaimFlag[];
  submittedAt: string | null; disbursedOn: string | null; paymentReference: string | null;
  createdAt: string;
  can: { edit: boolean; submit: boolean; delete: boolean; withdraw: boolean; copy: boolean };
};
export type MyClaimsPage = Paged<MyClaimRow> & {
  /** BR-CLM-27 banner: "1 claim saved more than 90 days ago is still not submitted" */
  staleNewCount: number; staleDays: number;
  hasEmployeeRecord: boolean;
};

// ===========================================================================
// C1 Claims (admin; MGR = /team/claims) — header or line view, KPI strip
// ===========================================================================
export const CLAIM_LIST_VIEWS = ['header', 'line'] as const;
export const claimListParamsSchema = pageParamsSchema.extend({
  view: z.enum(CLAIM_LIST_VIEWS).default('header'),
  /** one employee (E3 profile Claims tab + its CSV export); separated employees are then always included */
  employeeId: uuidSchema.optional().catch(undefined),
  departmentIds: multi(uuidSchema),
  categoryIds: multi(uuidSchema),
  statuses: multi(z.enum(CLAIM_STATUSES)),
  from: isoDateSchema.optional().catch(undefined),            // transaction date
  to: isoDateSchema.optional().catch(undefined),
  submittedFrom: isoDateSchema.optional().catch(undefined), submittedTo: isoDateSchema.optional().catch(undefined),
  decidedFrom: isoDateSchema.optional().catch(undefined), decidedTo: isoDateSchema.optional().catch(undefined),
  disbursedFrom: isoDateSchema.optional().catch(undefined), disbursedTo: isoDateSchema.optional().catch(undefined),
  batchNo: z.string().trim().max(20).optional().catch(undefined),
  flags: multi(z.enum(CLAIM_FLAGS)),
  onBehalfOnly: booleanSchema.default(false),
  includeSeparated: booleanSchema.optional(),                 // default from C8 setting
  sort: z.enum(['submitted', 'claimNo', 'employee', 'total', 'status', 'transaction']).default('submitted'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type ClaimListParams = z.input<typeof claimListParamsSchema>;
export type ClaimKpis = {
  submitted: number; approvedNotDisbursed: number; disbursed: number; rejected: number;
  totalExclSst: Money; totalSst: Money; total: Money;
};
export type ClaimListRow = {
  id: string; claimNo: string;
  employee: PersonRef; department: string;
  title: string; lineCount: number; total: Money; totalSst: Money;
  status: ClaimStatus; flags: ClaimFlag[];
  submittedAt: string | null;
  decidedByName: string | null; decidedAt: string | null;
  /** "PB-2027-011" (ADM/SA only; null for MGR) */
  batchNo: string | null; disbursedOn: string | null; paymentReference: string | null;
  attachmentCount: number;
  /** selectable for bulk approve/reject (Submitted, actionable, not own) */
  taskId: string | null; taskVersion: number | null; canDecide: boolean;
};
export type ClaimLineListRow = {
  claimId: string; claimNo: string; lineId: string; lineNo: number;
  employee: PersonRef; department: string;
  transactionDate: string;
  submittedAt: string | null;                   // date of application
  category: CategoryRef;
  /** More info: "CL-… · 42.5 km · description" */
  moreInfo: string;
  distanceKm: string | null; description: string | null;
  amountInclSst: Money; sstAmount: Money;
  attachmentCount: number;
  receiptNo: string | null; myinvoisUuid: string | null;
  decidedAt: string | null; decidedByName: string | null;
  status: ClaimStatus;
  batchNo: string | null; disbursedOn: string | null;
};
export type ClaimListPage =
  | ({ view: 'header'; kpis: ClaimKpis } & Paged<ClaimListRow>)
  | ({ view: 'line'; kpis: ClaimKpis } & Paged<ClaimLineListRow>);

// Employee pickers for C2 / C3 / C4 (active, Notice Period, or Separated within portal-access end; own record excluded)
export const claimEmployeeOptionsSchema = z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
export type ClaimEmployeeOptionsInput = z.input<typeof claimEmployeeOptionsSchema>;
export type ClaimEmployeeOption = { id: string; employeeNo: string; name: string; department: string; status: string; note: string | null };

// ===========================================================================
// C3 Bulk claim entry (Could) — rows with the same employee + title form one claim
// ===========================================================================
export const bulkClaimRowSchema = z.object({
  rowNo: z.coerce.number().int().min(1),
  employeeId: uuidSchema,
  title: requiredText(120, 'Claim title'),
  categoryId: uuidSchema,
  transactionDate: isoDateSchema,
  amountInclSst: optionalMoney('Amount'),
  sstAmount: optionalMoney('SST'),
  receiptNo: optionalText(50, 'Receipt no.'),
  myinvoisUuid: optionalText(40, 'UUID'),
  description: optionalText(500, 'Notes'),
  distanceKm: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : String(v).trim()), z.string().nullable()),
  fromPlace: optionalText(100, 'From'), toPlace: optionalText(100, 'To'), purpose: optionalText(100, 'Purpose'),
  merchant: optionalText(100, 'Merchant'),
  fileIds: z.array(uuidSchema).max(MAX_FILES_PER_LINE).default([]),
});
export const bulkClaimsSchema = z.object({
  rows: z.array(bulkClaimRowSchema).min(1, 'Add at least one row.').max(200, 'At most 200 rows at a time.'),
  idempotencyKey: idempotencyKeySchema,
});
export type BulkClaimsInput = z.input<typeof bulkClaimsSchema>;
export type BulkClaimRowResult = { rowNo: number; ok: boolean; message: string | null };
export type BulkClaimPreview = { rows: BulkClaimRowResult[]; claims: number; errors: number };
export type BulkClaimResult = {
  claims: { claimNo: string | null; employee: PersonRef; lines: number; total: Money; result: string; ok: boolean }[];
  created: number; failed: number;
};

// ===========================================================================
// C4 Late-submission overrides — /claims/late-overrides  [ADM, SA] (not own)
// ===========================================================================
export const lateOverrideListParamsSchema = pageParamsSchema.extend({
  employeeId: uuidSchema.optional().catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  sort: z.enum(['applied', 'employee']).default('applied'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type LateOverrideListParams = z.input<typeof lateOverrideListParamsSchema>;
export type LateOverrideRow = {
  id: string; employee: PersonRef; claimId: string; claimNo: string;
  lineNo: number | null; transactionDate: string | null; daysPastDeadline: number | null;
  reason: string; appliedByName: string; appliedAt: string;
  used: boolean;                             // claim has been submitted
};
export const lateOverrideCandidatesSchema = z.object({ employeeId: uuidSchema });
export type LateOverrideCandidate = { claimId: string; claimNo: string; lineId: string; lineNo: number; category: string; transactionDate: string; amount: Money; daysPastDeadline: number; hasOverride: boolean };
export const applyLateOverrideSchema = z.object({
  employeeId: uuidSchema,
  lineIds: z.array(uuidSchema).min(1, 'Select at least one line.').max(MAX_LINES),
  reason: reason10('Reason'),
});
export type ApplyLateOverrideInput = z.input<typeof applyLateOverrideSchema>;

// ===========================================================================
// C9 / C10 / C11 Disbursement batches  [ADM, SA]
// ===========================================================================
export const batchListParamsSchema = pageParamsSchema.extend({
  year: z.coerce.number().int().min(2000).max(2999).optional().catch(undefined),
  month: z.coerce.number().int().min(1).max(12).optional().catch(undefined),
  statuses: multi(z.enum(BATCH_STATUSES)),
  sort: z.enum(['month', 'batchNo', 'status', 'total']).default('month'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type BatchListParams = z.input<typeof batchListParamsSchema>;
export type BatchRow = {
  id: string; batchNo: string;
  disbursementMonth: string;               // 'yyyy-mm-01' (UI: "November 2027")
  cutoffDate: string;
  claimCount: number; total: Money; totalSst: Money;
  status: BatchStatus;
  paymentDate: string | null; paymentReference: string | null;
  preparedByName: string; approvedByName: string | null;
  /** ✓ current / ⚠ out of date / null (none generated) */
  outputs: 'current' | 'out_of_date' | null;
};
export type BatchListPage = Paged<BatchRow> & {
  /** C9 banner "11 approved claims (RM 2,140.60) are not in a batch yet." */
  unbatched: { count: number; total: Money } | null;
  saApprovalOn: boolean;
};

export const batchCandidatesSchema = z.object({
  cutoffDate: isoDateSchema,
  q: z.string().trim().max(100).optional(),
  employeeId: uuidSchema.optional().catch(undefined),
  departmentIds: multi(uuidSchema),
  approvedFrom: isoDateSchema.optional().catch(undefined),
  approvedTo: isoDateSchema.optional().catch(undefined),
  /** C11 ADD CLAIMS: exclude claims already in this batch */
  batchId: uuidSchema.optional().catch(undefined),
});
export type BatchCandidatesInput = z.input<typeof batchCandidatesSchema>;
export type BatchCandidateRow = {
  claimId: string; claimNo: string; employee: PersonRef; department: string; title: string;
  approvedOn: string; approvedByName: string | null; total: Money; totalSst: Money;
  /** pre-ticked when approved on or before the cut-off (BR-CLM-28) */
  preselected: boolean;
  bankComplete: boolean; paymentMethod: PaymentMethod | null;
  isSeparated: boolean;
};
export type BatchCandidates = {
  rows: BatchCandidateRow[];
  /** "3 claims are in PB-2027-010" */
  inOtherBatches: { count: number; batchNos: string[] };
};
export type BatchDefaults = { disbursementMonth: string /* yyyy-mm */; cutoffDate: string; plannedPaymentDate: string; regularExists: boolean };
export const batchDefaultsSchema = z.object({ disbursementMonth: monthSchema.optional() });
export const batchPreviewSchema = z.object({ claimIds: z.array(uuidSchema).max(2000) });
export type BatchPreviewInput = z.input<typeof batchPreviewSchema>;
export type BatchPayeeRow = {
  employee: PersonRef; claimCount: number; claimNos: string[]; amount: Money;
  paymentMethod: PaymentMethod | null;
  bankName: string | null;
  /** "••••1234" — never the full number outside the generated payment list */
  accountMasked: string | null;
  bankComplete: boolean;
  /** EC-CLM-10 */
  bankChangedAfterExport: boolean;
};
export type BatchPreview = {
  count: number; total: Money; totalSst: Money; employees: number;
  payees: BatchPayeeRow[];
  /** blocking for output generation: bank-transfer payees with incomplete bank details (link → profile Bank tab) */
  incompleteBank: PersonRef[];
  /** D23 — "Pay by cheque/cash" section, excluded from the HLB list */
  chequeCash: BatchPayeeRow[];
};
export const createBatchSchema = z.object({
  disbursementMonth: monthSchema,                                    // PB3
  cutoffDate: isoDateSchema,                                         // PB4
  plannedPaymentDate: isoDateSchema,                                 // PB9 (≥ today — DB)
  notes: optionalText(500, 'Notes'),                                 // PB12
  claimIds: z.array(uuidSchema).min(1, 'Select at least one claim.').max(2000),   // PB5
  idempotencyKey: idempotencyKeySchema,
});
export type CreateBatchInput = z.input<typeof createBatchSchema>;
export type CreateBatchResult = { id: string; batchNo: string; duplicate: boolean };

export type BatchOutputVersion = {
  version: number;
  generatedAt: string; generatedByName: string | null;
  status: 'current' | 'out_of_date' | 'superseded';
  files: { exportFileId: string; kind: OutputKind; fileName: string; rowCount: number | null; total: Money | null }[];
};
export type BatchClaimRow = {
  claimId: string; claimNo: string; employee: PersonRef; title: string; approvedOn: string | null;
  total: Money; status: ClaimStatus;
  /** undone after disbursement (F-CLM-23) — shown struck through with the reason */
  undone: { reason: string; at: string } | null;
};
export type BatchEvent = { at: string; event: string; fromStatus: BatchStatus | null; toStatus: BatchStatus | null; actorName: string; comment: string | null };
export type BatchDetail = {
  id: string; batchNo: string; version: number;
  disbursementMonth: string; cutoffDate: string; plannedPaymentDate: string;
  isRegular: boolean;
  status: BatchStatus;
  claimCount: number; employeeCount: number; total: Money; totalSst: Money;
  paymentDate: string | null; paymentReference: string | null; notes: string | null;
  preparedByName: string; preparedAt: string;
  approvedByName: string | null; approvedAt: string | null;
  disbursedByName: string | null; disbursedAt: string | null;
  cancelledByName: string | null; cancelledAt: string | null; cancelReason: string | null;
  outputsOutOfDate: boolean;
  /** "CL-2027-00099 was cancelled after export" */
  outOfDateReason: string | null;
  bankChangedAfterExport: boolean;
  routeNote: string;
  saApprovalOn: boolean;
  claims: BatchClaimRow[];
  byEmployee: BatchPayeeRow[];
  outputs: BatchOutputVersion[];
  history: BatchEvent[];
  /** SA approval task (setting on) — APPROVE BATCH / RETURN via decideTask (reject = return, comment required) */
  task: TaskActionability | null;
  /** generation blockers (bank details incomplete, category without GL account) */
  blockers: { kind: 'bank' | 'gl'; label: string; href: string | null }[];
  can: {
    generateOutputs: boolean; regenerateOutputs: boolean; submitForApproval: boolean; addClaims: boolean; removeClaims: boolean;
    markDisbursed: boolean; cancel: boolean; downloadAttachments: boolean; viewPaymentList: boolean;
  };
  /** tooltip when MARK DISBURSED is disabled: "Regenerate the outputs first — they are out of date." */
  markDisbursedBlockedReason: string | null;
} & Stamps;
export const batchIdSchema = z.object({ batchId: uuidSchema });
export type BatchIdInput = z.input<typeof batchIdSchema>;
export const batchClaimsChangeSchema = z.object({ batchId: uuidSchema, claimIds: z.array(uuidSchema).min(1).max(2000), expectedVersion: z.coerce.number().int().min(1).optional() });
export type BatchClaimsChangeInput = z.input<typeof batchClaimsChangeSchema>;
export const removeBatchClaimSchema = z.object({ batchId: uuidSchema, claimId: uuidSchema, expectedVersion: z.coerce.number().int().min(1).optional() });
export type RemoveBatchClaimInput = z.input<typeof removeBatchClaimSchema>;
export const markBatchDisbursedSchema = z.object({
  batchId: uuidSchema,
  paymentDate: isoDateSchema,                                        // PB10 (≤ today — DB)
  paymentReference: requiredText(50, 'HLB payment reference'),       // PB11
  notes: optionalText(500, 'Notes'),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});
export type MarkBatchDisbursedInput = z.input<typeof markBatchDisbursedSchema>;
export type MarkBatchDisbursedResult = { claims: number; employees: number; total: Money };
export const cancelBatchSchema = z.object({ batchId: uuidSchema, reason: reason5('Reason') });
export type CancelBatchInput = z.input<typeof cancelBatchSchema>;
export type GenerateOutputsResult = { version: number; files: BatchOutputVersion['files']; status: BatchStatus };
export const exportFileUrlSchema = z.object({ exportFileId: uuidSchema });
export type ExportFileUrlInput = z.input<typeof exportFileUrlSchema>;
export const paymentListReportSchema = z.object({ batchNo: z.string().trim().regex(/^PB-[0-9]{4}-[0-9]{3,}$/, 'Invalid batch no.') });
export type PaymentListReportInput = z.input<typeof paymentListReportSchema>;
export type DownloadUrl = { url: string; fileName: string };

// C12 HLB payment list (on-screen report, D31): ADM/SA see account numbers IN FULL; every view writes audit.access_log (reveal, bank)
export type PaymentListRow = {
  no: number; employeeNo: string; beneficiaryName: string; bank: string; bankCode: string; bic: string | null;
  accountMasked: string;
  /** full account number (D31 — C12 on screen, ADM/SA only; the view is access-logged by app.payment_list_view) */
  accountNo: string;
  amount: Money;
  paymentReference: string;                 // "CLAIM PB-2027-011"
  paymentDescription: string;               // "Claims reimbursement Nov 2027"
  beneficiaryEmail: string;
  claimNos: string[];
};
export type PaymentListReport = {
  header: {
    companyName: string;
    payingAccount: string;                  // "Hong Leong Bank ••••4321"
    batchNo: string; disbursementMonth: string; plannedPaymentDate: string;
    count: number; total: Money;
    preparedByName: string; preparedAt: string;
    approvedByName: string | null; approvedAt: string | null;
    version: number | null; generatedAt: string | null;
  };
  rows: PaymentListRow[];
  /** D23 cheque / cash section (excluded from the HLB list) */
  chequeCash: { no: number; employeeNo: string; name: string; method: PaymentMethod; amount: Money; claimNos: string[] }[];
  totals: { hlb: Money; chequeCash: Money; batch: Money; matches: boolean };
  banner: string;
  /** latest current .xlsx / PDF version (DOWNLOAD buttons); null → generate first */
  xlsx: { exportFileId: string; fileName: string } | null;
  pdf: { exportFileId: string; fileName: string } | null;
};

// C15 AutoCount claims postings export (layout Q37 — isolated column map in src/server/lib/claims-outputs.ts)
export const autocountExportSchema = z.object({
  source: z.enum(['batch', 'range']),
  batchId: uuidSchema.optional().catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  statuses: z.array(z.enum(['approved', 'disbursed'])).min(1, 'Select at least one status.').default(['approved', 'disbursed']),
}).superRefine((v, ctx) => {
  if (v.source === 'batch' && !v.batchId) ctx.addIssue({ code: 'custom', path: ['batchId'], message: 'Select the batch.' });
  if (v.source === 'range' && (!v.from || !v.to)) ctx.addIssue({ code: 'custom', path: ['from'], message: 'Enter the date range.' });
  if (v.from && v.to && v.to < v.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'To must be on or after From.' });
});
export type AutocountExportInput = z.input<typeof autocountExportSchema>;
export type AutocountPreview = {
  rowCount: number; total: Money;
  documentDateBasis: 'approval' | 'disbursed';
  /** "Category without GL account: {name}" [FIX] */
  blocked: { categoryId: string; code: string; name: string }[];
  creditAccount: string | null;
  columns: string[];
};

// C16 attachment bundle (zip named <claim no.>-<line>-<n>.<ext>)
export const attachmentBundleSchema = z.object({
  scope: z.enum(['batch', 'filter']),
  batchId: uuidSchema.optional().catch(undefined),
  filter: claimListParamsSchema.optional(),
  /** P26 claims tab selection */
  claimIds: z.array(uuidSchema).max(2000).optional(),
}).refine((v) => v.scope !== 'batch' || !!v.batchId, { path: ['batchId'], message: 'Select the batch.' });
export type AttachmentBundleInput = z.input<typeof attachmentBundleSchema>;
export type AttachmentBundlePreview = { files: number; claims: number; totalBytes: number; tooLarge: boolean; limitNote: string };
export type AttachmentBundleResult = DownloadUrl & { files: number; claims: number };

// ===========================================================================
// P1 Home — claims parts
// ===========================================================================
export type HomeClaims = {
  /** My pending items: New / Submitted claims (max 5, newest first) */
  pending: { id: string; claimNo: string; label: string; total: Money; status: ClaimStatus; href: string }[];
  /** Recent claims (last 3) */
  recent: { id: string; claimNo: string; title: string; total: Money; status: ClaimStatus; href: string }[];
  /** MGR only — "Team claims submitted" (reportees' Submitted claims I can act on) → /approvals?tab=claims */
  manager: { teamClaimsSubmitted: number } | null;
  /** ADM / SA — admin dashboard claims panel */
  admin: { submitted: number; approvedNotDisbursed: number; approvedNotInBatch: number; approvedNotInBatchTotal: Money } | null;
  hasEmployeeRecord: boolean;
};

// ===========================================================================
// E3 profile Claims tab (ADM/SA) · P32 team member claims (MGR)
// ===========================================================================
export const employeeClaimsParamsSchema = pageParamsSchema.extend({
  statuses: multi(z.enum(CLAIM_STATUSES)),
  year: z.coerce.number().int().min(2000).max(2999).optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type EmployeeClaimsParams = z.input<typeof employeeClaimsParamsSchema>;
export type EmployeeClaimRow = {
  id: string; claimNo: string; title: string; total: Money; status: ClaimStatus; flags: ClaimFlag[];
  submittedAt: string | null; approvedByName: string | null;
  batchNo: string | null; disbursedOn: string | null;
};
export type EmployeeClaimsTab = {
  claims: Paged<EmployeeClaimRow>;
  utilisation: LimitUtilisation;
  canSubmitOnBehalf: boolean;               // not own record
  submitOnBehalfHref: string | null;        // "/claims/new-on-behalf?employee={id}"
};
/** P32 (MGR): reportee's recent claims (no batch / bank data) */
export type TeamMemberClaims = {
  rows: Omit<EmployeeClaimRow, 'batchNo'>[];
  submittedCount: number;
  utilisation: LimitUtilisation;
};
/** E7 separation preview — open claims (BR-CLM-22: approved claims remain payable) */
export type SeparationOpenClaims = { newCount: number; submitted: number; approvedNotDisbursed: number; approvedAmount: Money };

// ===========================================================================
// FUNCTION REGISTER (exact names and signatures — implementations must match)
// ===========================================================================
// Shared types from './common': ActionResult, Paged, CsvFile, UploadIntent. Actions take a plain object or FormData.
//
// QUERIES — src/server/queries/claims.ts (server-only; requireUser([...]) → withUserTx)
//   C5  listCategories(p: CategoryListParams): Promise<Paged<CategoryRow>>                         [ADM, SA]
//   C6  getCategory(code: string): Promise<CategoryDetail | null>                                  [ADM, SA]
//   C7  listLimits(p: LimitListParams): Promise<Paged<LimitRow>>                                   [ADM, SA]
//   C8  getClaimPolicy(): Promise<ClaimPolicy>                                                     [ADM, SA]
//       getClaimSetupOptions(): Promise<ClaimSetupOptions>                                         [ADM, SA]
//   P13 getClaimForm(claimNo?: string, employeeId?: string): Promise<ClaimForm | null>            [EMP, MGR, ADM, SA] (employeeId ≠ own → ADM/SA on behalf)
//   P12 listMyClaims(p: MyClaimsParams): Promise<MyClaimsPage>                                     [EMP, MGR, ADM, SA]
//       getMyClaimLimits(): Promise<LimitUtilisation | null>                                       [EMP, MGR, ADM, SA] (F-CLM-20)
//   P15/P29 getClaim(claimNo: string): Promise<ClaimDetail | null>                                 [EMP own, MGR team/routed, ADM, SA]
//   C1  listClaims(p: ClaimListParams): Promise<ClaimListPage>                                     [ADM, SA]
//       listTeamClaims(p: ClaimListParams): Promise<ClaimListPage>                                 [MGR] (reportees + routed; no batch data)
//   C4  listLateOverrides(p: LateOverrideListParams): Promise<Paged<LateOverrideRow>>              [ADM, SA]
//   C9  listBatches(p: BatchListParams): Promise<BatchListPage>                                    [ADM, SA]
//   C10 getBatchDefaults(month?: string): Promise<BatchDefaults>                                   [ADM, SA]
//   C11 getBatch(batchNo: string): Promise<BatchDetail | null>                                     [ADM, SA]
//   C12 getPaymentListReport(batchNo: string): Promise<PaymentListReport | null>                   [ADM, SA] (FULL account numbers — D31; every call access-logged)
//   P1  getHomeClaims(): Promise<HomeClaims>                                                       [EMP, MGR, ADM, SA]
//   E3  getEmployeeClaims(employeeId: string, p?: EmployeeClaimsParams): Promise<EmployeeClaimsTab | null>  [ADM, SA]
//   P32 getTeamMemberClaims(employeeId: string): Promise<TeamMemberClaims | null>                  [MGR (reportee)]
//
// SERVER ACTIONS — src/server/actions/claims.ts ('use server')
//   C5  exportCategoriesCsv(p: CategoryListParams): Promise<ActionResult<CsvFile>>                 [ADM, SA]
//   C6  saveCategory(i: SaveCategoryInput): Promise<ActionResult<{ id: string; code: string }>>   [ADM, SA] (mileage needs a rate; GL required)
//       setCategoryActive(i: SetCategoryActiveInput): Promise<ActionResult>                        [ADM, SA] (EC-CLM-05)
//   C7  saveLimit(i: SaveLimitInput): Promise<ActionResult<{ id: string }>>                        [ADM, SA]
//       endLimit(i: EndLimitInput): Promise<ActionResult>                                          [ADM, SA]
//       exportLimitsCsv(p: LimitListParams): Promise<ActionResult<CsvFile>>                        [ADM, SA]
//   C8  updateClaimPolicy(i: UpdateClaimPolicyInput): Promise<ActionResult>                        [ADM, SA] (saBatchApprovalRequired: SA only)
//   P13 saveClaim(i: SaveClaimInput): Promise<ActionResult<SaveClaimResult>>                       [EMP, MGR, ADM, SA] (own; C2 on behalf ADM/SA not own)
//       submitClaim(i: SubmitClaimInput): Promise<ActionResult<SubmitClaimResult>>                 [EMP, MGR, ADM, SA] (own / on-behalf ADM; N-20)
//       validateClaim(i: ClaimIdInput): Promise<ActionResult<ValidateClaimResult>>                 [EMP, MGR, ADM, SA] (summary card before SUBMIT)
//       deleteClaim(i: ClaimIdInput): Promise<ActionResult>                                        [EMP, MGR, ADM, SA] (New only; owner or on-behalf ADM)
//   client-callable while typing (P14 / C2 / C3):
//       checkClaimLine(i: CheckClaimLineInput): Promise<ActionResult<ClaimLineCheck>>              [EMP, MGR, ADM, SA] (limit chip, deadline, duplicate, UUID)
//       fetchMileageAmount(i: MileageAmountInput): Promise<ActionResult<MileageAmountResult>>      [EMP, MGR, ADM, SA]
//       fetchClaimApproverHint(i: ApproverHintInput): Promise<ActionResult<{ hint: string | null }>>  [EMP, MGR, ADM, SA]
//       searchClaimEmployees(i: ClaimEmployeeOptionsInput): Promise<ActionResult<{ rows: ClaimEmployeeOption[] }>>  [ADM, SA] (own excluded)
//       fetchClaimForm(i: { claimNo?, employeeId? }): Promise<ActionResult<{ form: ClaimForm | null }>>  [EMP, MGR, ADM, SA]
//   CLN15 requestClaimUpload(i: RequestClaimUploadInput): Promise<ActionResult<UploadIntent>>      [EMP, MGR, ADM, SA] (own; ADM/SA on behalf)
//       confirmClaimUpload(i: { fileId }): Promise<ActionResult<{ fileId: string }>>               [EMP, MGR, ADM, SA]
//       getClaimReceiptUrl(i: ClaimReceiptUrlInput): Promise<ActionResult<DownloadUrl>>           [own, MGR of claimant / current approver, ADM, SA] (logged)
//   P12/P15 withdrawClaim(i: ClaimIdInput): Promise<ActionResult>                                  [EMP, MGR, ADM, SA] (own / on-behalf ADM; Submitted → Withdrawn)
//       copyClaim(i: CopyClaimInput): Promise<ActionResult<{ id: string; claimNo: string }>>       [EMP, MGR, ADM, SA] (own Rejected → new New claim)
//       exportMyClaimsCsv(p: MyClaimsParams): Promise<ActionResult<CsvFile>>                       [EMP, MGR, ADM, SA]
//   P29 cancelClaim(i: CancelClaimInput): Promise<ActionResult>                                    [MGR (team), ADM, SA] (Approved → Cancelled; not own; N-59)
//       undoDisbursement(i: UndoDisbursementInput): Promise<ActionResult>                          [ADM, SA] (Disbursed → Approved; not own; N-28)
//       (APPROVE / REJECT: decideTask / bulkDecide in ./approvals with ClaimDetail.task)
//   C1  exportClaimsCsv(p: ClaimListParams): Promise<ActionResult<CsvFile>>                        [MGR (team scope), ADM, SA] (columns of the view; no bank data)
//       exportClaimsXlsx(p: ClaimListParams): Promise<ActionResult<DownloadUrl>>                   [ADM, SA]
//   C3  validateBulkClaims(i: BulkClaimsInput): Promise<ActionResult<BulkClaimPreview>>            [ADM, SA]
//       submitBulkClaims(i: BulkClaimsInput): Promise<ActionResult<BulkClaimResult>>               [ADM, SA] (on behalf, Submitted)
//   C4  fetchLateOverrideCandidates(i: { employeeId }): Promise<ActionResult<{ rows: LateOverrideCandidate[] }>>  [ADM, SA]
//       applyLateOverride(i: ApplyLateOverrideInput): Promise<ActionResult<{ lines: number }>>     [ADM, SA] (not own; employee notified)
//       exportLateOverridesCsv(p: LateOverrideListParams): Promise<ActionResult<CsvFile>>          [ADM, SA]
//   C9  exportBatchesCsv(p: BatchListParams): Promise<ActionResult<CsvFile>>                       [ADM, SA]
//   C10 fetchBatchDefaults(i: { disbursementMonth? }): Promise<ActionResult<BatchDefaults>>        [ADM, SA]
//       fetchBatchCandidates(i: BatchCandidatesInput): Promise<ActionResult<BatchCandidates>>      [ADM, SA]
//       previewBatch(i: BatchPreviewInput): Promise<ActionResult<BatchPreview>>                    [ADM, SA] (Step 3; masked)
//       createBatch(i: CreateBatchInput): Promise<ActionResult<CreateBatchResult>>                 [ADM, SA] (idempotent; N-29)
//   C11 addBatchClaims(i: BatchClaimsChangeInput): Promise<ActionResult>                           [ADM, SA] (Draft only)
//       removeBatchClaim(i: RemoveBatchClaimInput): Promise<ActionResult>                          [ADM, SA] (Draft only)
//       submitBatchForApproval(i: BatchIdInput): Promise<ActionResult>                             [ADM, SA] (setting on; N-26)
//       (APPROVE BATCH / RETURN: decideTask in ./approvals with BatchDetail.task — SA ≠ preparer; N-27)
//       generateBatchOutputs(i: BatchIdInput): Promise<ActionResult<GenerateOutputsResult>>        [ADM, SA] (HLB .xlsx + PDF + AutoCount .xlsx; logged; → Exported)
//       getExportFileUrl(i: ExportFileUrlInput): Promise<ActionResult<DownloadUrl>>               [ADM, SA] (logged)
//   C12 fetchPaymentListReport(i: PaymentListReportInput): Promise<ActionResult<{ report: PaymentListReport | null }>>  [ADM, SA] (full numbers; logged)
//       markBatchDisbursed(i: MarkBatchDisbursedInput): Promise<ActionResult<MarkBatchDisbursedResult>>  [ADM, SA] (idempotent; N-25)
//       cancelBatch(i: CancelBatchInput): Promise<ActionResult>                                    [ADM, SA] (claims stay Approved)
//       exportBatchClaimsCsv(i: BatchIdInput): Promise<ActionResult<CsvFile>>                      [ADM, SA] (no account numbers)
//   C15 previewAutocountExport(i: AutocountExportInput): Promise<ActionResult<AutocountPreview>>   [ADM, SA]
//       exportAutocount(i: AutocountExportInput): Promise<ActionResult<DownloadUrl & { rowCount: number }>>  [ADM, SA] (logged)
//   C16 previewAttachmentBundle(i: AttachmentBundleInput): Promise<ActionResult<AttachmentBundlePreview>>  [ADM, SA]
//       downloadAttachmentBundle(i: AttachmentBundleInput): Promise<ActionResult<AttachmentBundleResult>>  [ADM, SA] (every file grant logged)
//   E3  fetchEmployeeClaimsTab(i: { employeeId, statuses?, year?, page?, pageSize? }): Promise<ActionResult<{ tab: EmployeeClaimsTab | null }>>  [ADM, SA]
//
// Error messages the UI may branch on (ActionFail.error is a readable sentence):
//   own claim on decide / cancel / undo → "You can't decide your own claim." · not New → "Only New claims can be edited." ·
//   stale version → "This claim changed since you opened it — refresh and try again." ·
//   line field errors → fieldErrors['lines.<index>.<field>'] · UUID clash → fieldErrors['lines.<i>.myinvoisUuid'] "UUID already claimed on CL-…" ·
//   batch → "Regenerate the outputs first — they are out of date." / "Employees with incomplete bank details: …".
