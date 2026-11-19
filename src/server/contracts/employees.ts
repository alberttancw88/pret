// PRET contract — M1 Employee master records (W2-003). Screens E1–E17, P16–P19, P31–P33,
// G10 staff directory, G11 org chart (and O8 reporting lines — types in ./org).
// Types + zod only (client-safe). Implementations:
//   queries  → src/server/queries/employees.ts  (server-only; call from Server Components)
//   actions  → src/server/actions/employees.ts  ('use server')
//
// Role views (PRD §5.3 View columns, §5.4, §16; rls-policies §5.3, §8):
//   * ADM / SA  → EmployeeProfile (every tab; religion/OKU only through getEmployeeSensitive — logged).
//   * EMP (own) → MyProfile (P16). Own MyKad in full (not logged); bank/ASNB masked with a logged "Show".
//   * MGR       → TeamMemberProfile (P32): T1 fields of direct + indirect reportees only.
//                 Never MyKad, DOB, race, religion, OKU, family, statutory, bank, documents, notes.
// Sensitive identifiers (MyKad, spouse/child MyKad, bank, ASNB) are encrypted (ADR-0003). Every
// DTO carries only `…Masked` / `…Last4`; plaintext only through revealEmployeeValue (logged),
// revealMyValue (own, logged) or MyProfile.personal.nric (own MyKad, by design not logged).
// A user whose employee record does not exist yet (e.g. the first Super Admin) gets
// getMyProfile() === null — render "Your employee record has not been created yet."
import { z } from 'zod';
import {
  addressSchema, booleanSchema, isoDateSchema, multi, myStateSchema, optionalEmailSchema, optionalText,
  optionalUuidSchema, pageParamsSchema, requiredText, uuidSchema,
  type Address, type MyState, type Stamps,
} from './common';
import { checkMykad, normaliseMykad } from './mykad';

export * from './common';
export * from './mykad';

// ===========================================================================
// Enums (data-model §3, PRD §5.3) + labels
// ===========================================================================
const labels = <T extends string>(m: Record<T, string>) => m;

export const EMPLOYMENT_STATUSES = ['pending_join', 'on_probation', 'confirmed', 'notice_period', 'separated', 'withdrawn'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];
export const EMPLOYMENT_STATUS_LABELS = labels<EmploymentStatus>({
  pending_join: 'Pending Join', on_probation: 'On Probation', confirmed: 'Confirmed',
  notice_period: 'Notice Period', separated: 'Separated', withdrawn: 'Withdrawn',
});
/** BR-EMP-31: "Active" = On Probation + Confirmed + Notice Period (default list filter). */
export const ACTIVE_STATUSES: EmploymentStatus[] = ['on_probation', 'confirmed', 'notice_period'];
/** PRD §5.7 chip colours (StatusChip tone). */
export const EMPLOYMENT_STATUS_TONE = labels<EmploymentStatus>({
  pending_join: 'grey', on_probation: 'info', confirmed: 'success', notice_period: 'warning', separated: 'dark', withdrawn: 'outline',
});

export const GENDERS = ['male', 'female'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS = labels<Gender>({ male: 'Male', female: 'Female' });

export const MARITAL_STATUSES = ['single', 'married', 'divorced', 'widowed'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export const MARITAL_STATUS_LABELS = labels<MaritalStatus>({ single: 'Single', married: 'Married', divorced: 'Divorced', widowed: 'Widowed' });

export const RACES = ['malay', 'chinese', 'indian', 'bumiputera_sabah', 'bumiputera_sarawak', 'orang_asli', 'others'] as const;
export type Race = (typeof RACES)[number];
export const RACE_LABELS = labels<Race>({
  malay: 'Malay', chinese: 'Chinese', indian: 'Indian', bumiputera_sabah: 'Bumiputera Sabah',
  bumiputera_sarawak: 'Bumiputera Sarawak', orang_asli: 'Orang Asli', others: 'Others',
});

export const RELIGIONS = ['islam', 'buddhism', 'christianity', 'hinduism', 'sikhism', 'taoism', 'other', 'none', 'prefer_not_to_say'] as const;
export type Religion = (typeof RELIGIONS)[number];
export const RELIGION_LABELS = labels<Religion>({
  islam: 'Islam', buddhism: 'Buddhism', christianity: 'Christianity', hinduism: 'Hinduism', sikhism: 'Sikhism',
  taoism: 'Taoism', other: 'Other', none: 'None', prefer_not_to_say: 'Prefer not to say',
});

export const QUALIFICATIONS = ['spm', 'stpm', 'certificate', 'diploma', 'bachelor', 'master', 'doctorate', 'professional', 'other'] as const;
export type Qualification = (typeof QUALIFICATIONS)[number];
export const QUALIFICATION_LABELS = labels<Qualification>({
  spm: 'SPM', stpm: 'STPM', certificate: 'Certificate', diploma: 'Diploma', bachelor: "Bachelor's", master: "Master's",
  doctorate: 'Doctorate', professional: 'Professional', other: 'Other',
});

export const EMPLOYMENT_TYPES = ['permanent_full_time'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS = labels<EmploymentType>({ permanent_full_time: 'Permanent – full time' });

export const JOB_CHANGE_TYPES = [
  'new_hire', 'confirmation', 'promotion', 'transfer', 're_designation', 'grade_change', 'manager_change',
  'working_pattern_change', 'separation', 'rehire', 'data_correction',
] as const;
export type JobChangeType = (typeof JOB_CHANGE_TYPES)[number];
export const JOB_CHANGE_TYPE_LABELS = labels<JobChangeType>({
  new_hire: 'New hire', confirmation: 'Confirmation', promotion: 'Promotion', transfer: 'Transfer (department/location)',
  re_designation: 'Re-designation', grade_change: 'Grade change', manager_change: 'Manager change',
  working_pattern_change: 'Working-pattern change', separation: 'Separation', rehire: 'Rehire', data_correction: 'Data correction',
});
/** Types an Admin may pick in E5 — the others are written by their own actions (create, confirm, separation, rehire). */
export const MANUAL_JOB_CHANGE_TYPES = [
  'promotion', 'transfer', 're_designation', 'grade_change', 'manager_change', 'working_pattern_change', 'data_correction',
] as const satisfies readonly JobChangeType[];

export const SEPARATION_TYPES = [
  'resignation', 'termination_with_notice', 'dismissal_misconduct', 'retirement', 'mutual_separation', 'end_of_probation', 'death', 'other',
] as const;
export type SeparationType = (typeof SEPARATION_TYPES)[number];
export const SEPARATION_TYPE_LABELS = labels<SeparationType>({
  resignation: 'Resignation', termination_with_notice: 'Termination with notice', dismissal_misconduct: 'Dismissal (misconduct)',
  retirement: 'Retirement', mutual_separation: 'Mutual separation (MSS/VSS)', end_of_probation: 'End of probation (not confirmed)',
  death: 'Death', other: 'Other',
});

export const SEPARATION_REASONS = [
  'career_advancement', 'compensation', 'personal', 'relocation', 'further_studies', 'health', 'performance',
  'misconduct', 'restructuring', 'retirement', 'other',
] as const;
export type SeparationReason = (typeof SEPARATION_REASONS)[number];
export const SEPARATION_REASON_LABELS = labels<SeparationReason>({
  career_advancement: 'Career advancement', compensation: 'Compensation', personal: 'Personal', relocation: 'Relocation',
  further_studies: 'Further studies', health: 'Health', performance: 'Performance', misconduct: 'Misconduct',
  restructuring: 'Restructuring', retirement: 'Retirement', other: 'Other',
});

export const NOTICE_OUTCOMES = ['served', 'waived_by_company', 'bought_out_by_employee', 'short_served'] as const;
export type NoticeOutcome = (typeof NOTICE_OUTCOMES)[number];
export const NOTICE_OUTCOME_LABELS = labels<NoticeOutcome>({
  served: 'Served', waived_by_company: 'Waived by company', bought_out_by_employee: 'Bought out by employee', short_served: 'Short-served',
});

export const CONTACT_RELATIONSHIPS = ['spouse', 'parent', 'child', 'sibling', 'relative', 'friend', 'other'] as const;
export type ContactRelationship = (typeof CONTACT_RELATIONSHIPS)[number];
export const CONTACT_RELATIONSHIP_LABELS = labels<ContactRelationship>({
  spouse: 'Spouse', parent: 'Parent', child: 'Child', sibling: 'Sibling', relative: 'Relative', friend: 'Friend', other: 'Other',
});

export const SPOUSE_WORKING_STATUSES = ['working', 'not_working'] as const;
export type SpouseWorkingStatus = (typeof SPOUSE_WORKING_STATUSES)[number];
export const SPOUSE_WORKING_STATUS_LABELS = labels<SpouseWorkingStatus>({ working: 'Working', not_working: 'Not working' });

export const SPOUSE_RECORD_STATUSES = ['current', 'former'] as const;
export type SpouseRecordStatus = (typeof SPOUSE_RECORD_STATUSES)[number];
export const SPOUSE_RECORD_STATUS_LABELS = labels<SpouseRecordStatus>({ current: 'Current', former: 'Former' });

export const CHILD_RELATIONSHIPS = ['biological', 'adopted', 'step_child'] as const;
export type ChildRelationship = (typeof CHILD_RELATIONSHIPS)[number];
export const CHILD_RELATIONSHIP_LABELS = labels<ChildRelationship>({ biological: 'Biological', adopted: 'Adopted', step_child: 'Step-child' });

export const PCB_CHILD_CATEGORIES = ['under_18', 'over_18_pre_university', 'over_18_diploma_plus', 'disabled', 'disabled_diploma_plus', 'not_eligible'] as const;
export type PcbChildCategory = (typeof PCB_CHILD_CATEGORIES)[number];
export const PCB_CHILD_CATEGORY_LABELS = labels<PcbChildCategory>({
  under_18: 'Under 18', over_18_pre_university: '18+ in pre-university or certificate study',
  over_18_diploma_plus: '18+ in diploma+ (Malaysia) or degree+ (overseas)', disabled: 'Disabled',
  disabled_diploma_plus: 'Disabled in diploma+ study', not_eligible: 'Not eligible',
});
/** E8 institution & level is required for these (CHECK chk_study_institution). */
export const STUDY_PCB_CATEGORIES: PcbChildCategory[] = ['over_18_pre_university', 'over_18_diploma_plus', 'disabled_diploma_plus'];

export const RELIEF_SHARES = ['full_100', 'shared_50', 'spouse_claims_0'] as const;
export type ReliefShare = (typeof RELIEF_SHARES)[number];
export const RELIEF_SHARE_LABELS = labels<ReliefShare>({ full_100: '100% (employee)', shared_50: '50% (shared with spouse)', spouse_claims_0: '0% (spouse claims)' });

export const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS = labels<PaymentMethod>({ bank_transfer: 'Bank transfer', cheque: 'Cheque', cash: 'Cash' });

export const BANK_ACCOUNT_TYPES = ['savings', 'current'] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];
export const BANK_ACCOUNT_TYPE_LABELS = labels<BankAccountType>({ savings: 'Savings', current: 'Current' });

export const SOCSO_CATEGORIES = ['category_1', 'category_2'] as const;
export type SocsoCategory = (typeof SOCSO_CATEGORIES)[number];
export const SOCSO_CATEGORY_LABELS = labels<SocsoCategory>({ category_1: 'Category 1 (Injury + Invalidity)', category_2: 'Category 2 (Injury only)' });

export const EPF_RATE_TYPES = ['statutory', 'specific'] as const;
export type EpfRateType = (typeof EPF_RATE_TYPES)[number];
export const EPF_RATE_TYPE_LABELS = labels<EpfRateType>({ statutory: 'Statutory', specific: 'Specific %' });

export const NOTICE_UNITS = ['weeks', 'months'] as const;
export type NoticeUnit = (typeof NOTICE_UNITS)[number];
export const NOTICE_UNIT_LABELS = labels<NoticeUnit>({ weeks: 'Weeks', months: 'Months' });

export const DOCUMENT_CATEGORIES = [
  'offer_letter', 'employment_contract', 'mykad_copy', 'academic_certificate', 'professional_certificate', 'confirmation_letter',
  'promotion_transfer_letter', 'resignation_letter', 'separation_letter', 'disciplinary_letter', 'medical_report', 'bank_proof', 'other',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_CATEGORY_LABELS = labels<DocumentCategory>({
  offer_letter: 'Offer letter', employment_contract: 'Employment contract', mykad_copy: 'MyKad copy',
  academic_certificate: 'Academic certificate', professional_certificate: 'Professional certificate',
  confirmation_letter: 'Confirmation letter', promotion_transfer_letter: 'Promotion or transfer letter',
  resignation_letter: 'Resignation letter', separation_letter: 'Separation letter', disciplinary_letter: 'Disciplinary letter',
  medical_report: 'Medical report', bank_proof: 'Bank proof', other: 'Other',
});
/** K1: always HR-only — "Visible to employee" is forced off (DB CHECK chk_hr_only_categories). */
export const HR_ONLY_DOCUMENT_CATEGORIES: DocumentCategory[] = ['mykad_copy', 'medical_report', 'disciplinary_letter', 'bank_proof'];
/** K5 default visibility by category. */
export const DEFAULT_VISIBLE_DOCUMENT_CATEGORIES: DocumentCategory[] = ['offer_letter', 'employment_contract', 'confirmation_letter', 'promotion_transfer_letter'];

export const CR_CATEGORIES = ['legal_name', 'mykad', 'marital_spouse', 'children', 'oku', 'religion', 'race', 'bank_details', 'statutory_numbers'] as const;
export type CrCategory = (typeof CR_CATEGORIES)[number];
export const CR_CATEGORY_LABELS = labels<CrCategory>({
  legal_name: 'Legal name', mykad: 'MyKad', marital_spouse: 'Marital status & spouse', children: 'Children', oku: 'OKU',
  religion: 'Religion', race: 'Race', bank_details: 'Bank details', statutory_numbers: 'Statutory numbers',
});
/** CR5: supporting document required for these categories, with the label the form shows. */
export const CR_DOCUMENT_REQUIRED: Partial<Record<CrCategory, string>> = {
  legal_name: 'Copy of your new MyKad or deed poll', mykad: 'Copy of your new MyKad',
  marital_spouse: 'Marriage or divorce certificate', children: 'Birth certificate', oku: 'OKU card',
  bank_details: 'Bank statement header or e-banking screenshot (proof of account)',
};

export const CR_STATUSES = ['submitted', 'approved', 'rejected', 'cancelled'] as const;
export type CrStatus = (typeof CR_STATUSES)[number];
export const CR_STATUS_LABELS = labels<CrStatus>({ submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' });

/** Portal account column/filter on E1 (derived from app_users). */
export const PORTAL_ACCOUNT_STATES = ['not_invited', 'pending_activation', 'active', 'disabled'] as const;
export type PortalAccountState = (typeof PORTAL_ACCOUNT_STATES)[number];
export const PORTAL_ACCOUNT_STATE_LABELS = labels<PortalAccountState>({
  not_invited: 'Not invited', pending_activation: 'Pending activation', active: 'Active', disabled: 'Disabled',
});

/** H11 PCB category (derived) — mapping to verify (PRD). */
export const PCB_CATEGORIES = ['single', 'married_spouse_not_working', 'married_spouse_working_or_other'] as const;
export type PcbCategory = (typeof PCB_CATEGORIES)[number];
export const PCB_CATEGORY_LABELS = labels<PcbCategory>({
  single: 'Single', married_spouse_not_working: 'Married, spouse not working',
  married_spouse_working_or_other: 'Married spouse working / divorced / widowed',
});

/** S-AP-08 manager recommendation values (UXQ-11). */
export const PROBATION_RECOMMENDATIONS = ['confirm', 'extend', 'not_confirm'] as const;
export type ProbationRecommendation = (typeof PROBATION_RECOMMENDATIONS)[number];
export const PROBATION_RECOMMENDATION_LABELS = labels<ProbationRecommendation>({ confirm: 'Confirm', extend: 'Extend probation', not_confirm: 'Do not confirm' });

/** E10 reason options for an Admin reveal (SA: reason optional). */
export const REVEAL_REASONS = ['statutory_submission', 'payroll', 'bank_verification', 'employee_request', 'other'] as const;
export type RevealReason = (typeof REVEAL_REASONS)[number];
export const REVEAL_REASON_LABELS = labels<RevealReason>({
  statutory_submission: 'Statutory submission', payroll: 'Payroll', bank_verification: 'Bank verification',
  employee_request: 'Employee request', other: 'Other',
});
export const REVEAL_FIELDS = ['nric', 'bank_account_no', 'asnb_account_no', 'spouse_nric', 'child_nric'] as const;
export type RevealField = (typeof REVEAL_FIELDS)[number];

export const COMPLETENESS_FILTERS = ['complete', 'incomplete', 'missing_payroll'] as const;
export type CompletenessFilter = (typeof COMPLETENESS_FILTERS)[number];

// ===========================================================================
// Shared field schemas
// ===========================================================================
const NAME_RE = /^[\p{L}@'./ -]+$/u;
/** A2 / D1 / E1: letters, spaces and @ ' . - / ; trimmed. */
export const personNameSchema = (label = 'Full name', max = 150) =>
  z.string({ error: `${label} is required.` }).trim().transform((v) => v.replace(/\s+/g, ' '))
    .pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`)
      .regex(NAME_RE, `${label} may contain letters, spaces and @ ' . - / only.`));

/** A4 / D2: 12 digits (dashes allowed on input), valid YYMMDD; stored as 12 digits. */
export const mykadSchema = z.string({ error: 'MyKad is required.' }).trim().superRefine((v, ctx) => {
  const c = checkMykad(v);
  if (!c.ok) ctx.addIssue({ code: 'custom', message: c.error ?? 'Invalid MyKad.' });
}).transform((v) => normaliseMykad(v));
/** E2 (optional): MyKid / MyKad — validated only when entered. */
export const optionalMykadSchema = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null),
  mykadSchema.nullable(),
);

/** BR-EMP-08: Malaysian mobile, stored E.164 `+60` + 9–10 digits. Accepts `012-345 6789`, `+60 12-345 6789`, `60123456789`. */
export function normaliseMyMobile(v: string): string {
  const d = v.replace(/[\s()-]/g, '');
  if (/^0\d{8,10}$/.test(d)) return `+6${d}`;
  if (/^60\d{9,10}$/.test(d)) return `+${d}`;
  return d;
}
export const myMobileSchema = z.string({ error: 'Mobile phone is required.' }).trim()
  .transform(normaliseMyMobile)
  .pipe(z.string().regex(/^\+60[0-9]{9,10}$/, 'Enter a Malaysian mobile number, e.g. +60 12-345 6789.'));
/** C4/C5/D9/B4: Malaysian or international — digits, +, -, spaces, brackets; max 20. */
export const anyPhoneSchema = (label = 'Phone') =>
  z.string({ error: `${label} is required.` }).trim().min(1, `${label} is required.`).max(20, `${label} must be at most 20 characters.`)
    .regex(/^\+?[0-9 ()-]{6,20}$/, `Enter a valid phone number.`);
export const optionalPhoneSchema = (label = 'Phone') =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null), anyPhoneSchema(label).nullable());

/** BR-EMP-19 LHDN TIN: IG + up to 11 digits, or legacy SG/OG + digits (verify). Upper-cased, no spaces. */
export const optionalTaxNoSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.replace(/\s/g, '').toUpperCase()) : v ?? null),
  z.string().regex(/^(IG[0-9]{1,11}|SG[0-9]{1,12}|OG[0-9]{1,12})$/, 'Income tax no. is IG followed by up to 11 digits (or a legacy SG/OG number).').nullable(),
);
/** H15: digits, up to 9 (verify). */
export const optionalEpfNoSchema = z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v ?? null),
  z.string().regex(/^[0-9]{1,9}$/, 'EPF no. is up to 9 digits.').nullable(),
);
/** I4 / I9: digits only, 6–20 (BR-EMP-18). */
export const accountNoSchema = (label = 'Account no.') =>
  z.string({ error: `${label} is required.` }).trim().transform((v) => v.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^[0-9]{6,20}$/, `${label} must be 6–20 digits.`));
export const optionalAccountNoSchema = (label = 'ASNB account no.') =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null), accountNoSchema(label).nullable());

/** Money as a string with up to 2 decimals (never a float). '' → null. */
export const optionalMoneySchema = (label = 'Amount') => z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : typeof v === 'number' ? v.toFixed(2) : String(v).replace(/[,\sRM]/gi, '')),
  z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, `${label} must be a valid amount (RM, 2 decimals).`).nullable(),
);
/** Percent 0–89 with one decimal (H17 / H18). '' → null. */
export const optionalPctSchema = (label = 'Percentage') => z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : String(v).trim()),
  z.string().regex(/^\d{1,2}(\.\d)?$/, `${label} must be 0–89 with at most one decimal.`)
    .refine((s) => Number(s) <= 89, `${label} must be 0–89.`).nullable(),
);
const optionalDate = z.preprocess((v) => (v === '' || v === undefined ? null : v), isoDateSchema.nullable());
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T, msg = 'Select a value.') =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), z.enum(values, { error: msg }).nullable());
const idempotencyKey = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.uuid().nullable()).optional();

// ===========================================================================
// Shared DTO pieces
// ===========================================================================
export type Ref = { id: string; label: string };
export type EmployeeRef = { id: string; employeeNo: string; name: string };
export type LengthOfService = { years: number; months: number; days: number };
/** "4 years 1 month 14 days" (F24, as Kakitangan). */
export function lengthOfServiceText(l: LengthOfService | null): string {
  if (!l) return '';
  const p = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return [p(l.years, 'year'), p(l.months, 'month'), p(l.days, 'day')].join(' ');
}
/** Compact "4y 8m" for list columns. */
export function lengthOfServiceShort(l: LengthOfService | null): string {
  return l ? `${l.years}y ${l.months}m` : '';
}
export type MissingField = { field: string; label: string; tab: ProfileTab; payroll: boolean };
export type Completeness = { pct: number; missing: MissingField[] };
export const PROFILE_TABS = [
  'overview', 'personal', 'contact', 'family', 'employment', 'statutory', 'bank', 'leave', 'claims',
  'documents', 'change_requests', 'notes', 'activity',
] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
export type FileRef = { fileId: string; fileName: string; mimeType: string; sizeBytes: number };

// ===========================================================================
// E1 Employee list (F-EMP-01, F-EMP-24) — /employees  [ADM, SA]
// ===========================================================================
export const employeeListParamsSchema = pageParamsSchema.extend({
  /** employee no., full name, preferred name, work email; exactly 4 digits also matches MyKad last 4 */
  departmentIds: multi(uuidSchema),
  positionIds: multi(uuidSchema),
  gradeIds: multi(uuidSchema),
  locationIds: multi(uuidSchema),
  states: multi(myStateSchema),
  /** undefined / empty → ACTIVE_STATUSES (BR-EMP-31) */
  statuses: multi(z.enum(EMPLOYMENT_STATUSES)),
  managerId: uuidSchema.optional().catch(undefined),
  joinFrom: isoDateSchema.optional().catch(undefined),
  joinTo: isoDateSchema.optional().catch(undefined),
  lwdFrom: isoDateSchema.optional().catch(undefined),
  lwdTo: isoDateSchema.optional().catch(undefined),
  probationEndingWithin: z.coerce.number().pipe(z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(60)])).optional().catch(undefined),
  completeness: z.enum(COMPLETENESS_FILTERS).optional().catch(undefined),
  portalAccount: multi(z.enum(PORTAL_ACCOUNT_STATES)),
  sort: z.enum(['employeeNo', 'fullName', 'department', 'position', 'grade', 'manager', 'location', 'joinDate', 'status', 'completeness']).default('employeeNo'),
});
export type EmployeeListParams = z.input<typeof employeeListParamsSchema>;

export type EmployeeRow = {
  id: string;
  employeeNo: string;                    // A1 (link → /employees/{employeeNo})
  fullName: string;                      // A2
  preferredName: string | null;          // A3
  department: Ref;                       // F10
  position: Ref;                         // F11
  grade: Ref;                            // F12
  manager: EmployeeRef | null;           // F13
  workLocation: Ref;                     // F17
  workState: MyState;                    // F18
  joinDate: string;                      // F1
  lengthOfService: LengthOfService;      // F24 ("Years of service")
  status: EmploymentStatus;              // F9
  workEmail: string;                     // B1
  mobilePhone: string;                   // B3 (E.164)
  completeness: Completeness;            // F-EMP-24 (tooltip lists missing)
  portalAccount: PortalAccountState;
  lastWorkingDay: string | null;         // G5 (current separation)
  probationEndDate: string | null;       // F6 ?? F5
};

// ===========================================================================
// MyKad check on blur (E2 step 1, E9) — server action (duplicate check needs the blind index)
// ===========================================================================
export const checkMykadSchema = z.object({ mykad: z.string().trim().max(20), excludeEmployeeId: optionalUuidSchema.optional() });
export type CheckMykadInput = z.input<typeof checkMykadSchema>;
export type CheckMykadResult = {
  valid: boolean; error: string | null; display: string; dateOfBirth: string | null; gender: Gender | null; warnings: string[];
  /** EC-EMP-02: existing record with this MyKad (active or separated). canRehire when Separated. */
  duplicate: { employeeId: string; employeeNo: string; name: string; status: EmploymentStatus; canRehire: boolean } | null;
};

// ===========================================================================
// E2 New employee (F-EMP-02) — /employees/new  [ADM, SA]
// Opening leave (step 5, F-LV-35) arrives with W2-004.
// ===========================================================================
const emergencyContactSchema = z.object({
  id: optionalUuidSchema.optional(),
  priority: z.coerce.number().int().min(1, 'Priority is 1–3.').max(3, 'Priority is 1–3.'),   // C1
  name: requiredText(100, 'Name'),                                                         // C2
  relationship: z.enum(CONTACT_RELATIONSHIPS, { error: 'Select the relationship.' }),       // C3
  mobilePhone: anyPhoneSchema('Mobile phone'),                                             // C4
  altPhone: optionalPhoneSchema('Alternate phone'),                                        // C5
  email: optionalEmailSchema,                                                              // C6
  isNextOfKin: booleanSchema.default(false),                                               // C7
});
export type EmergencyContactInput = z.input<typeof emergencyContactSchema>;
export const emergencyContactsSchema = z.array(emergencyContactSchema)
  .min(1, 'At least one emergency contact is required.').max(3, 'At most 3 emergency contacts.')
  .superRefine((rows, ctx) => {
    const seen = new Set<number>();
    rows.forEach((r, i) => {
      if (seen.has(r.priority)) ctx.addIssue({ code: 'custom', path: [i, 'priority'], message: 'Each priority can be used once.' });
      seen.add(r.priority);
    });
    if (rows.filter((r) => r.isNextOfKin).length > 1) ctx.addIssue({ code: 'custom', path: [0, 'isNextOfKin'], message: 'Only one contact can be next of kin.' });
  });

const identitySchema = z.object({
  mykad: mykadSchema,                                                    // A4
  fullName: personNameSchema(),                                          // A2
  preferredName: optionalText(60, 'Preferred name'),                     // A3
  dateOfBirth: isoDateSchema,                                            // A5
  /** must be true when A5 differs from the MyKad-derived DOB (BR-EMP-02) — logged */
  dobOverrideConfirmed: booleanSchema.default(false),
  gender: z.enum(GENDERS, { error: 'Select the gender.' }),              // A7
  /** must be true when A7 differs from the MyKad-derived gender (BR-EMP-04) — logged */
  genderOverrideConfirmed: booleanSchema.default(false),
  race: optionalEnum(RACES),                                             // A9
  raceOther: optionalText(50, 'Race (other)'),                           // A10
  religion: optionalEnum(RELIGIONS),                                     // A11 (sensitive)
  maritalStatus: z.enum(MARITAL_STATUSES, { error: 'Select the marital status.' }),   // A12
  maritalEffectiveDate: optionalDate,                                    // A13 (required unless Single)
  isOku: booleanSchema.default(false),                                   // A14 (sensitive)
  okuCardNo: optionalText(20, 'OKU card no.'),                           // A15
  photoFileId: optionalUuidSchema,                                       // A16 (confirmed upload)
  passportNo: z.preprocess((v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim().toUpperCase()) : v ?? null),
    z.string().regex(/^[A-Z0-9]{1,20}$/, 'Passport no. is letters and digits only (max 20).').nullable()),   // A17
  passportExpiry: optionalDate,                                          // A18
  highestQualification: optionalEnum(QUALIFICATIONS),                    // A19
});

const contactSchema = z.object({
  workEmail: z.string({ error: 'Work email is required.' }).trim().toLowerCase().pipe(z.email('Enter a valid email address.').max(254)),   // B1
  personalEmail: z.string({ error: 'Personal email is required.' }).trim().toLowerCase().pipe(z.email('Enter a valid email address.').max(254)),   // B2
  mobilePhone: myMobileSchema,                                           // B3
  workPhone: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null),
    z.string().trim().max(20).regex(/^[0-9+\- ]+$/, 'Work phone may contain digits, +, - and spaces.').nullable()),   // B4
  residentialAddress: addressSchema,                                     // B5–B10
  mailingSameAsResidential: booleanSchema.default(true),                 // B11
  mailingAddress: addressSchema.nullable().optional(),                   // B12
});

const employmentSchema = z.object({
  joinDate: isoDateSchema,                                               // F1 (≤ today + 12 months)
  continuousServiceDate: optionalDate,                                   // F2 (default F1; ≤ F1)
  probationMonths: z.coerce.number().int().min(0, 'Probation is 0–12 months.').max(12, 'Probation is 0–12 months.'),   // F4
  departmentId: uuidSchema,                                              // F10
  positionId: uuidSchema,                                                // F11
  gradeId: uuidSchema,                                                   // F12
  managerId: optionalUuidSchema,                                         // F13 (required unless F14)
  isTopOfOrg: booleanSchema.default(false),                              // F14 (SA only)
  leaveApproverId: optionalUuidSchema,                                   // F15
  claimApproverId: optionalUuidSchema,                                   // F16
  workLocationId: uuidSchema,                                            // F17 → F18
  workingPatternId: uuidSchema,                                          // F19
  phStateOverride: z.preprocess((v) => (v === '' || v === undefined ? null : v), myStateSchema.nullable()),   // F20
  contractualNoticeValue: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().int().min(1).max(52).nullable()),                         // F21
  contractualNoticeUnit: optionalEnum(NOTICE_UNITS),                     // F21
  costCentreId: optionalUuidSchema,                                      // F22
  offerContractRef: optionalText(50, 'Offer / contract reference'),      // F23
  contractSignedDate: optionalDate,                                      // F25 (≤ F1 + 30 days)
  employeeGroupIds: z.array(uuidSchema).default([]),                     // F28
  /** SA only (import / manual entry); otherwise assigned on save (BR-EMP-11). */
  employeeNo: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null),
    z.string().trim().max(20).regex(/^[A-Za-z0-9-]+$/, 'Employee no. may contain letters, digits and - only.').nullable()).optional(),
});

/** H group (employee-visible part, T2) — F-EMP-14/15. Defaults per §5.3 H. */
export const statutoryProfileSchema = z.object({
  payPcb: booleanSchema.default(true),                                   // H1
  incomeTaxNo: optionalTaxNoSchema,                                      // H3
  isTaxResident: booleanSchema.default(true),                            // H4
  lhdnBranchId: optionalUuidSchema,                                      // H5
  payEpf: booleanSchema.default(true),                                   // H13
  epfNo: optionalEpfNoSchema,                                            // H15
  epfRateType: z.enum(EPF_RATE_TYPES).default('statutory'),              // H16
  epfSpecificRate: optionalPctSchema('Specific EPF rate'),               // H16 (if specific)
  epfExtraEmployeePct: optionalPctSchema('Extra employee EPF %'),        // H17
  paySocso: booleanSchema.default(true),                                 // H19
  /** H21 — blank = defaults to the MyKad (server) */
  socsoNo: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null),
    z.string().trim().max(12, 'SOCSO no. must be at most 12 characters.').regex(/^[0-9A-Za-z-]+$/, 'SOCSO no. is letters/digits only.').nullable()),
  /** H22 — blank = BR-EMP-20 default by age */
  socsoCategory: optionalEnum(SOCSO_CATEGORIES),
  socsoContributedBefore: z.preprocess((v) => (v === '' || v === undefined ? null : v), booleanSchema.nullable()),   // H23
  payEis: booleanSchema.optional(),                                      // H26 (blank = BR-EMP-20 default)
  payZakat: booleanSchema.default(false),                                // H28
  zakatMonthlyAmount: optionalMoneySchema('Zakat monthly amount'),       // H29
  zakatAccountNo: optionalText(30, 'Zakat account / reference no.'),     // H30
  zakatBodyId: optionalUuidSchema,                                       // H31
  ptptnMonthlyAmount: optionalMoneySchema('PTPTN monthly deduction'),    // H33
  ptptnStartDate: optionalDate,                                          // H34
  ptptnEndDate: optionalDate,                                            // H34
}).superRefine((v, ctx) => {
  if (v.payZakat) {
    if (!v.zakatMonthlyAmount || Number(v.zakatMonthlyAmount) <= 0) ctx.addIssue({ code: 'custom', path: ['zakatMonthlyAmount'], message: 'Enter the zakat monthly amount.' });
    if (!v.zakatAccountNo) ctx.addIssue({ code: 'custom', path: ['zakatAccountNo'], message: 'Enter the zakat account / reference no.' });
  }
  if (v.ptptnMonthlyAmount && Number(v.ptptnMonthlyAmount) > 0) {
    if (!v.ptptnStartDate) ctx.addIssue({ code: 'custom', path: ['ptptnStartDate'], message: 'Enter the PTPTN start date.' });
    if (!v.ptptnEndDate) ctx.addIssue({ code: 'custom', path: ['ptptnEndDate'], message: 'Enter the PTPTN end date.' });
    if (v.ptptnStartDate && v.ptptnEndDate && v.ptptnEndDate < v.ptptnStartDate)
      ctx.addIssue({ code: 'custom', path: ['ptptnEndDate'], message: 'End date must be on or after the start date.' });
  }
  if (v.epfRateType === 'specific' && !v.epfSpecificRate) ctx.addIssue({ code: 'custom', path: ['epfSpecificRate'], message: 'Enter the specific EPF rate.' });
});
export type StatutoryProfileInput = z.input<typeof statutoryProfileSchema>;

/** H2, H9, H10, H14, H18, H20, H24, H25, H32 (T3 — HR only). */
export const employerFlagsSchema = z.object({
  pcbBorneByEmployer: booleanSchema.default(false),
  returningExpertProgramme: booleanSchema.default(false),
  knowledgeWorkerSpecifiedRegion: booleanSchema.default(false),
  epfBorneByEmployer: booleanSchema.default(false),
  epfExtraEmployerPct: optionalPctSchema('Extra employer EPF %'),
  socsoBorneByEmployer: booleanSchema.default(false),
  paySkbbk: booleanSchema.default(false),
  skbbkBorneByEmployer: booleanSchema.default(false),
  eisBorneByEmployer: booleanSchema.default(false),                      // H27 (HR view only — §5.4 "excluding employer-only flags")
  /** H32 — undefined = company HRDF registered (F-ORG-01) */
  payHrdf: booleanSchema.optional(),
});
export type EmployerFlagsInput = z.input<typeof employerFlagsSchema>;

/** I group (E17 / create step 4). Proof (I6) required for bank transfer. */
export const bankDetailsSchema = z.object({
  paymentMethod: z.enum(PAYMENT_METHODS).default('bank_transfer'),      // I1
  bankId: optionalUuidSchema,                                            // I2
  accountType: optionalEnum(BANK_ACCOUNT_TYPES),                         // I3
  accountNo: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null), accountNoSchema().nullable()),   // I4
  accountHolderName: optionalText(150, 'Account holder name'),           // I5
  /** BR-EMP-18: required true when I5 ≠ the employee's full name */
  holderNameMismatchAck: booleanSchema.default(false),
  proofFileId: optionalUuidSchema,                                       // I6 (confirmed upload, purpose 'bank_proof')
  effectiveFrom: optionalDate,                                           // I7 (default today)
  asnbAccountNo: optionalAccountNoSchema(),                              // I9
  /** EC-EMP-12: required when another employee already uses this account (remarks go to the audit trail) */
  sharedAccountRemarks: optionalText(500, 'Remarks'),
}).superRefine((v, ctx) => {
  if (v.paymentMethod !== 'bank_transfer') return;
  if (!v.bankId) ctx.addIssue({ code: 'custom', path: ['bankId'], message: 'Select the bank.' });
  if (!v.accountType) ctx.addIssue({ code: 'custom', path: ['accountType'], message: 'Select the account type.' });
  if (!v.accountNo) ctx.addIssue({ code: 'custom', path: ['accountNo'], message: 'Enter the account no.' });
  if (!v.accountHolderName) ctx.addIssue({ code: 'custom', path: ['accountHolderName'], message: 'Enter the account holder name.' });
  if (!v.proofFileId) ctx.addIssue({ code: 'custom', path: ['proofFileId'], message: 'Upload proof of the account.' });
});
export type BankDetailsInput = z.input<typeof bankDetailsSchema>;

export const INVITE_MODES = ['now', 'scheduled', 'later'] as const;
export type InviteMode = (typeof INVITE_MODES)[number];
export const inviteChoiceSchema = z.object({
  /** E2 step 6: now · scheduled (default join date − invite lead days) · later (no invite) */
  mode: z.enum(INVITE_MODES).default('scheduled'),
  scheduledSendDate: optionalDate,
});

export const createEmployeeSchema = z.object({
  identity: identitySchema,
  contact: contactSchema,
  emergencyContacts: emergencyContactsSchema,
  employment: employmentSchema,
  statutory: statutoryProfileSchema.optional(),
  employerFlags: employerFlagsSchema.optional(),
  bank: bankDetailsSchema.optional(),
  invite: inviteChoiceSchema.default({ mode: 'scheduled', scheduledSendDate: null }),
  idempotencyKey,
}).superRefine((v, ctx) => {
  identityRules(v.identity, ctx, ['identity']);
  contactRules(v.contact, ctx, ['contact']);
  if (!v.employment.managerId && !v.employment.isTopOfOrg)
    ctx.addIssue({ code: 'custom', path: ['employment', 'managerId'], message: 'Select the reporting manager (or tick Top of organisation).' });
  if (v.employment.continuousServiceDate && v.employment.continuousServiceDate > v.employment.joinDate)
    ctx.addIssue({ code: 'custom', path: ['employment', 'continuousServiceDate'], message: 'Continuous-service date must be on or before the join date.' });
  if ((v.employment.contractualNoticeValue == null) !== (v.employment.contractualNoticeUnit == null))
    ctx.addIssue({ code: 'custom', path: ['employment', 'contractualNoticeUnit'], message: 'Enter both the notice period and its unit.' });
  if (v.invite.mode === 'scheduled' && v.invite.scheduledSendDate === undefined) { /* server default */ }
});
export type CreateEmployeeInput = z.input<typeof createEmployeeSchema>;
export type CreateEmployeeResult = {
  employeeId: string; employeeNo: string; status: EmploymentStatus;
  invite: { mode: InviteMode; userId: string | null; scheduledFor: string | null; emailSent: boolean; message: string };
  warnings: string[];
};

type Issue = { code: 'custom'; path: (string | number)[]; message: string };
type Ctx = { addIssue: (i: Issue) => void };
function identityRules(i: z.output<typeof identitySchema>, ctx: Ctx, base: string[]): void {
  if (i.race === 'others' && !i.raceOther) ctx.addIssue({ code: 'custom', path: [...base, 'raceOther'], message: 'Specify the race.' });
  if (i.maritalStatus !== 'single' && !i.maritalEffectiveDate)
    ctx.addIssue({ code: 'custom', path: [...base, 'maritalEffectiveDate'], message: 'Enter the marital status effective date.' });
  if (i.isOku && !i.okuCardNo) ctx.addIssue({ code: 'custom', path: [...base, 'okuCardNo'], message: 'Enter the OKU card no.' });
  if (i.passportNo && !i.passportExpiry) ctx.addIssue({ code: 'custom', path: [...base, 'passportExpiry'], message: 'Enter the passport expiry date.' });
  const c = checkMykad(i.mykad);
  if (c.ok && c.dateOfBirth !== i.dateOfBirth && !i.dobOverrideConfirmed)
    ctx.addIssue({ code: 'custom', path: [...base, 'dobOverrideConfirmed'], message: 'DOB differs from MyKad — confirm the override.' });
  if (c.ok && c.gender !== i.gender && !i.genderOverrideConfirmed)
    ctx.addIssue({ code: 'custom', path: [...base, 'genderOverrideConfirmed'], message: 'Gender differs from MyKad — confirm the override.' });
}
function contactRules(c: z.output<typeof contactSchema>, ctx: Ctx, base: string[]): void {
  if (c.personalEmail === c.workEmail) ctx.addIssue({ code: 'custom', path: [...base, 'personalEmail'], message: 'Personal email must differ from the work email.' });
  if (!c.mailingSameAsResidential && !c.mailingAddress)
    ctx.addIssue({ code: 'custom', path: [...base, 'mailingAddress', 'line1'], message: 'Enter the mailing address.' });
}

// ===========================================================================
// E3 Employee profile (ADM / SA) — /employees/{employeeNo}
// ===========================================================================
export type PersonalView = {
  employeeNo: string;                    // A1
  fullName: string;                      // A2
  preferredName: string | null;          // A3
  nricMasked: string;                    // A4 '******-**-5678' (reveal: revealEmployeeValue field 'nric')
  nricLast4: string;
  dateOfBirth: string;                   // A5
  dobOverridden: boolean;
  age: number;                           // A6
  gender: Gender;                        // A7
  nationality: 'Malaysian';              // A8
  race: Race | null; raceOther: string | null;                   // A9/A10
  maritalStatus: MaritalStatus; maritalEffectiveDate: string | null;   // A12/A13
  maritalHistory: { maritalStatus: MaritalStatus; effectiveDate: string }[];
  photoFileId: string | null; photoUrl: string | null;           // A16 (short-lived signed URL)
  passportNo: string | null; passportExpiry: string | null;      // A17/A18
  highestQualification: Qualification | null;                   // A19
};
/** A11/A14/A15 — T4. ADM/SA: getEmployeeSensitive (logged view_sensitive); own: in MyProfile. */
export type SensitiveView = { religion: Religion | null; isOku: boolean; okuCardNo: string | null };

export type ContactView = {
  workEmail: string; personalEmail: string; mobilePhone: string; workPhone: string | null;   // B1–B4
  residentialAddress: Address;                                                                 // B5–B10
  mailingSameAsResidential: boolean; mailingAddress: Address | null;                           // B11/B12
};
export type EmergencyContactView = {
  id: string; priority: number; name: string; relationship: ContactRelationship; mobilePhone: string; altPhone: string | null;
  /** C6/C7: null in TeamMemberProfile (manager projection) */
  email: string | null; isNextOfKin: boolean | null;
};
export type SpouseView = {
  id: string; fullName: string; nricMasked: string; nricLast4: string;                     // D1, D2 (reveal 'spouse_nric')
  marriageDate: string | null; workingStatus: SpouseWorkingStatus; isOku: boolean;          // D3–D5
  incomeTaxNo: string | null; reliefClaimedByEmployee: boolean | null;                      // D6, D7
  recordStatus: SpouseRecordStatus; phone: string | null;                                   // D8, D9
};
export type ChildView = {
  id: string; fullName: string; nricMasked: string | null; nricLast4: string | null;       // E1, E2 (reveal 'child_nric')
  dateOfBirth: string; age: number; gender: Gender | null; relationship: ChildRelationship; // E3–E5
  pcbCategory: PcbChildCategory | null; reliefShare: ReliefShare | null;                    // E6, E7
  institutionLevel: string | null; isOku: boolean; isActive: boolean;                       // E8, E9
  /** BR-EMP-17: set when the child turns 18 within 60 days ("review PCB category") */
  turns18On: string | null;
  /** category inconsistent with age (e.g. "Under 18" for an adult) */
  categoryWarning: string | null;
};
export type ChildCounts = {
  total: number;                                                        // E10
  pcbQualifying: number;                                                // E11
  derived: { lt18: number; tertiary: number; disabledLt18: number; disabledTertiary: number };   // E12 (derived)
  manual: { lt18: number; tertiary: number; disabledLt18: number; disabledTertiary: number } | null;   // E12 (migration)
  /** E13 — derivation pending LHDN rules (verify) → null until R1.1 */
  reliefPoints: string | null;
};
export type FamilyView = {
  spouses: SpouseView[]; children: ChildView[]; counts: ChildCounts;
  pcbCategory: PcbCategory;                                             // H11 (derived)
  flags: string[];                                                      // "Spouse details required", "Child turns 18 on dd/mm/yyyy…"
};

export type EmploymentView = {
  joinDate: string;                                                     // F1
  continuousServiceDate: string;                                        // F2
  employmentType: EmploymentType;                                       // F3
  probationMonths: number;                                              // F4
  probationEndDate: string | null;                                      // F5
  extendedProbationEndDate: string | null;                              // F6
  probationExtensionReason: string | null;                              // F7
  confirmationDate: string | null;                                      // F8
  status: EmploymentStatus;                                             // F9
  department: Ref; position: Ref; grade: Ref;                           // F10–F12
  manager: EmployeeRef | null; managerSince: string | null;             // F13, F27
  leaveApprover: EmployeeRef | null; claimApprover: EmployeeRef | null; // F15, F16
  workLocation: Ref; workState: MyState; workingPattern: Ref;           // F17–F19
  contractualNoticeValue: number | null; contractualNoticeUnit: NoticeUnit | null;   // F21
  lengthOfService: LengthOfService;                                     // F24
  retirementDate: string;                                               // F26
};
/** T3 — ADM/SA only. */
export type EmploymentHrView = {
  isTopOfOrg: boolean;                                                  // F14
  phStateOverride: MyState | null;                                      // F20
  costCentre: Ref | null;                                               // F22
  offerContractRef: string | null;                                      // F23
  contractSignedDate: string | null;                                    // F25
  employeeGroups: Ref[];                                                // F28
  payGroup: Ref | null;                                                 // F29 (R1.1 — always null in R1.0)
};
export type JobHistoryRow = {
  id: string; effectiveDate: string; changeType: JobChangeType;
  department: Ref; position: Ref; grade: Ref; manager: EmployeeRef | null; workLocation: Ref; workingPattern: Ref;
  employmentType: EmploymentType;
  /** JH10 — null in the manager projection */
  remarks: string | null; referenceDocumentId: string | null;
  /** JH11 — null in own / manager projections */
  enteredByName: string | null; enteredAt: string | null;
  isScheduled: boolean;                                                 // effective date > today ("Scheduled" chip)
  isCurrent: boolean;
  version: number;
};
export type ProbationRecommendationView = {
  id: string; recommendation: ProbationRecommendation; suggestedExtensionMonths: number | null; remarks: string | null;
  recommendedByName: string | null; recommendedAt: string;
};
export type SeparationView = {
  id: string; noticeDate: string; separationType: SeparationType; lastWorkingDay: string;   // G1, G2, G5
  isWithdrawn: boolean; withdrawnAt: string | null; withdrawRemarks: string | null;
  /** T3 — null outside ADM/SA */
  details: {
    reasonCategory: SeparationReason; reasonText: string | null;                            // G3
    noticeRequiredDays: number; noticeShortfallDays: number; noticeOutcome: NoticeOutcome;  // G4, G6
    portalAccessEndDate: string; eligibleForRehire: boolean | null; exitRemarks: string | null;   // G7–G9
  } | null;
  version: number;
};
export type PriorEmploymentView = { id: string; employer: string; position: string; dateFrom: string; dateTo: string };

export type StatutoryView = {
  payPcb: boolean; incomeTaxNo: string | null; isTaxResident: boolean; lhdnBranch: Ref | null;          // H1, H3–H5
  pcbCategory: PcbCategory;                                                                              // H11
  payEpf: boolean; epfNo: string | null; epfRateType: EpfRateType; epfSpecificRate: string | null; epfExtraEmployeePct: string | null;   // H13, H15–H17
  paySocso: boolean; socsoNo: string | null; socsoCategory: SocsoCategory | null; socsoContributedBefore: boolean | null;               // H19, H21–H23
  payEis: boolean;                                                                                       // H26
  payZakat: boolean; zakatMonthlyAmount: string | null; zakatAccountNo: string | null; zakatBody: Ref | null;   // H28–H31
  ptptnMonthlyAmount: string | null; ptptnStartDate: string | null; ptptnEndDate: string | null;         // H33, H34
  /** R1.1-required fields that are blank ("Needed for payroll") */
  neededForPayroll: string[];
  /** e.g. "Zakat via payroll but religion is not Islam" (ADM: only if the sensitive read was made) */
  warnings: string[];
};
export type EmployerFlagsView = {
  pcbBorneByEmployer: boolean; returningExpertProgramme: boolean; knowledgeWorkerSpecifiedRegion: boolean;   // H2, H9, H10
  epfBorneByEmployer: boolean; epfExtraEmployerPct: string | null;                                       // H14, H18
  socsoBorneByEmployer: boolean; paySkbbk: boolean; skbbkBorneByEmployer: boolean;                       // H20, H24, H25
  eisBorneByEmployer: boolean; payHrdf: boolean;                                                         // H27, H32
};
export type BankAccountView = {
  id: string; paymentMethod: PaymentMethod;                                                              // I1
  bank: { id: string; name: string; code: string } | null; accountType: BankAccountType | null;         // I2, I3
  accountNoMasked: string | null; accountNoLast4: string | null;                                         // I4 (reveal 'bank_account_no')
  accountHolderName: string | null;                                                                      // I5
  proofFileId: string | null;                                                                            // I6 (ADM/SA only)
  effectiveFrom: string;                                                                                 // I7
  verifiedByName: string | null; verifiedAt: string;                                                     // I8
  asnbMasked: string | null; asnbLast4: string | null;                                                   // I9 (reveal 'asnb_account_no')
  source: 'direct' | 'change_request'; changeRequestNo: string | null;
  isCurrent: boolean; isScheduled: boolean;
};
export type BankView = { current: BankAccountView | null; history: BankAccountView[] };

export type PortalAccountView = {
  userId: string | null; state: PortalAccountState; inviteScheduledFor: string | null; lastLoginAt: string | null;
};
export type UpcomingItem = { kind: 'job_change' | 'probation_end' | 'passport_expiry' | 'document_expiry' | 'last_working_day' | 'retirement'; date: string; label: string };

export type EmployeeProfileCan = {
  editPersonal: boolean; /** Q-F5: CHANGE PHOTO (A16 is E✎ — allowed on an Admin's own record too) */ editPhoto: boolean; editSensitive: boolean; editMykad: boolean; editEmployeeNo: boolean; editContact: boolean;
  editFamily: boolean; editEmployment: boolean; editTopOfOrg: boolean; addJobChange: boolean; editStatutory: boolean;
  editBank: boolean; reveal: boolean; uploadDocument: boolean; addNote: boolean; viewActivity: boolean; exportActivity: boolean;
  confirm: boolean; extendProbation: boolean; recordSeparation: boolean; editSeparation: boolean;
  withdrawResignation: boolean; withdrawOffer: boolean; rehire: boolean; invite: boolean; resendInvite: boolean;
};
export type EmployeeProfile = {
  id: string;
  /** true when the viewer (ADM/SA) is this employee — E→CR fields locked (FR-EMP-12, EC-EMP-10) */
  isOwnRecord: boolean;
  personal: PersonalView;
  contact: ContactView;
  emergencyContacts: EmergencyContactView[];
  family: FamilyView;
  employment: EmploymentView;
  employmentHr: EmploymentHrView;
  jobHistory: JobHistoryRow[];
  probationRecommendations: ProbationRecommendationView[];
  separation: SeparationView | null;               // current (not withdrawn) separation
  separationHistory: SeparationView[];             // withdrawn / previous employments
  priorEmployments: PriorEmploymentView[];         // L2
  statutory: StatutoryView;
  employerFlags: EmployerFlagsView;
  bank: BankView;
  portal: PortalAccountView;
  completeness: Completeness;
  upcoming: UpcomingItem[];
  openItems: { changeRequests: number; documentsExpiringSoon: number };   // leave/claims counts arrive with W2-004/005
  /** Tabs that arrive later render a placeholder: leave → W2-004, claims → W2-005, compensation/payslips → R1.1 */
  placeholders: { leave: string; claims: string; compensation: string; payslips: string };
  can: EmployeeProfileCan;
} & Stamps;

// ===========================================================================
// P16 My profile (EMP own) — /my/profile
// ===========================================================================
export type MyProfile = {
  id: string;
  personal: Omit<PersonalView, 'nricMasked' | 'dobOverridden'> & { nric: string /* full 'YYMMDD-PB-###G' (own, not logged) */ } & SensitiveView;
  contact: ContactView;
  emergencyContacts: EmergencyContactView[];
  family: FamilyView;
  employment: EmploymentView;
  jobHistory: JobHistoryRow[];                     // enteredByName = null
  separation: Pick<SeparationView, 'noticeDate' | 'separationType' | 'lastWorkingDay'> | null;   // G1, G2, G5
  priorEmployments: PriorEmploymentView[];
  /** employer-only flags (H2, H14, H18, H20, H24, H25, H27, H32) are not part of this view */
  statutory: StatutoryView;
  bank: { current: Omit<BankAccountView, 'proofFileId' | 'verifiedByName'> | null };
  /** categories with an open CR (EC-EMP-07) → crNo */
  openChangeRequests: Partial<Record<CrCategory, string>>;
  completeness: null;
};

export const updateMyPersonalSchema = z.object({
  preferredName: optionalText(60, 'Preferred name'),                     // A3 ✎
  passportNo: identitySchema.shape.passportNo,                           // A17 ✎
  passportExpiry: optionalDate,                                          // A18 ✎
  highestQualification: optionalEnum(QUALIFICATIONS),                    // A19 ✎
}).refine((v) => !v.passportNo || !!v.passportExpiry, { path: ['passportExpiry'], message: 'Enter the passport expiry date.' });
export type UpdateMyPersonalInput = z.input<typeof updateMyPersonalSchema>;

export const updateMyContactSchema = z.object({
  personalEmail: contactSchema.shape.personalEmail,                      // B2 ✎
  mobilePhone: myMobileSchema,                                           // B3 ✎
  residentialAddress: addressSchema,                                     // B5–B10 ✎
  mailingSameAsResidential: booleanSchema.default(true),                 // B11 ✎
  mailingAddress: addressSchema.nullable().optional(),                   // B12 ✎
}).refine((v) => v.mailingSameAsResidential || !!v.mailingAddress, { path: ['mailingAddress', 'line1'], message: 'Enter the mailing address.' });
export type UpdateMyContactInput = z.input<typeof updateMyContactSchema>;

export const saveMyEmergencyContactsSchema = z.object({ contacts: emergencyContactsSchema });
export type SaveMyEmergencyContactsInput = z.input<typeof saveMyEmergencyContactsSchema>;
export const updateMySpousePhoneSchema = z.object({ spouseId: uuidSchema, phone: optionalPhoneSchema('Spouse phone') });   // D9 ✎
export type UpdateMySpousePhoneInput = z.input<typeof updateMySpousePhoneSchema>;

// ===========================================================================
// P31 My team / P32 Team member (MGR) — /team, /team/{employeeNo}
// ===========================================================================
export const myTeamParamsSchema = pageParamsSchema.extend({
  departmentIds: multi(uuidSchema),
  scope: z.enum(['all', 'direct']).default('all'),
  sort: z.enum(['name', 'employeeNo', 'position', 'department']).default('name'),
});
export type MyTeamParams = z.input<typeof myTeamParamsSchema>;
export type TeamRow = {
  employeeId: string; employeeNo: string; fullName: string; preferredName: string | null; photoUrl: string | null;
  position: Ref; department: Ref; status: EmploymentStatus; isDirect: boolean;
  /** leave columns (Today / This week / AL / SL / RL available / pending items) arrive with W2-004 → null */
  leave: null;
};
export type TeamMemberProfile = {
  id: string; employeeNo: string; fullName: string; preferredName: string | null; gender: Gender;   // A1–A3, A7
  photoUrl: string | null;                                                                          // A16
  workEmail: string; mobilePhone: string; workPhone: string | null;                                 // B1, B3, B4
  emergencyContacts: EmergencyContactView[];                                                        // C1–C5 (email / next of kin null)
  employment: Pick<EmploymentView, 'joinDate' | 'employmentType' | 'probationMonths' | 'probationEndDate' | 'extendedProbationEndDate'
    | 'confirmationDate' | 'status' | 'department' | 'position' | 'grade' | 'manager' | 'leaveApprover' | 'claimApprover'
    | 'workLocation' | 'workState' | 'workingPattern' | 'lengthOfService' | 'managerSince'>;       // F1, F3–F6, F8–F13, F15–F19, F24, F27
  separation: Pick<SeparationView, 'noticeDate' | 'separationType' | 'lastWorkingDay'> | null;      // G1, G2, G5
  isDirectReport: boolean;
  /** RECORD PROBATION RECOMMENDATION (On Probation only) */
  canRecommendProbation: boolean;
  myRecommendations: ProbationRecommendationView[];
  placeholders: { leave: string; claims: string };
};

export const probationRecommendationSchema = z.object({
  employeeId: uuidSchema,
  recommendation: z.enum(PROBATION_RECOMMENDATIONS, { error: 'Select a recommendation.' }),
  suggestedExtensionMonths: z.preprocess((v) => (v === '' || v === undefined || v === null ? null : Number(v)), z.number().int().min(1).max(9).nullable()),
  remarks: requiredText(1000, 'Remarks'),
}).refine((v) => v.recommendation !== 'extend' || v.suggestedExtensionMonths != null, { path: ['suggestedExtensionMonths'], message: 'Enter the suggested extension (months).' });
export type ProbationRecommendationInput = z.input<typeof probationRecommendationSchema>;

// ===========================================================================
// E4 Inline section edits (ADM / SA) — every card has its own action
// ===========================================================================
export const employeeIdSchema = z.object({ employeeId: uuidSchema });
export type EmployeeIdInput = z.input<typeof employeeIdSchema>;

/** Personal card (A2, A3, A5, A7, A9, A10, A12/A13, A17–A19). A2, A9/A10, A12 are E→CR: not on own record. */
export const updatePersonalSchema = z.object({
  employeeId: uuidSchema,
  fullName: personNameSchema(),
  preferredName: optionalText(60, 'Preferred name'),
  dateOfBirth: isoDateSchema,
  dobOverrideConfirmed: booleanSchema.default(false),
  gender: z.enum(GENDERS, { error: 'Select the gender.' }),
  genderOverrideConfirmed: booleanSchema.default(false),
  race: optionalEnum(RACES),
  raceOther: optionalText(50, 'Race (other)'),
  maritalStatus: z.enum(MARITAL_STATUSES),
  /** required when A12 changes (≤ today + 30 days) */
  maritalEffectiveDate: optionalDate,
  passportNo: identitySchema.shape.passportNo,
  passportExpiry: optionalDate,
  highestQualification: optionalEnum(QUALIFICATIONS),
}).superRefine((v, ctx) => {
  if (v.race === 'others' && !v.raceOther) ctx.addIssue({ code: 'custom', path: ['raceOther'], message: 'Specify the race.' });
  if (v.passportNo && !v.passportExpiry) ctx.addIssue({ code: 'custom', path: ['passportExpiry'], message: 'Enter the passport expiry date.' });
});
export type UpdatePersonalInput = z.input<typeof updatePersonalSchema>;

/** A4 MyKad (E→CR; not own). Re-derives nothing automatically — DOB/gender stay as recorded. */
export const updateMykadSchema = z.object({ employeeId: uuidSchema, mykad: mykadSchema });
export type UpdateMykadInput = z.input<typeof updateMykadSchema>;
/** A11/A14/A15 (sensitive, E→CR; not own) — written through app.write_employee_sensitive (audited). */
export const updateSensitiveSchema = z.object({
  employeeId: uuidSchema, religion: optionalEnum(RELIGIONS), isOku: booleanSchema.default(false), okuCardNo: optionalText(20, 'OKU card no.'),
}).refine((v) => !v.isOku || !!v.okuCardNo, { path: ['okuCardNo'], message: 'Enter the OKU card no.' });
export type UpdateSensitiveInput = z.input<typeof updateSensitiveSchema>;
/** A1 employee no. — SA only (BR-EMP-11), logged with the reason. */
export const changeEmployeeNoSchema = z.object({
  employeeId: uuidSchema,
  employeeNo: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9-]+$/, 'Employee no. may contain letters, digits and - only.'),
  reason: requiredText(500, 'Reason'),
});
export type ChangeEmployeeNoInput = z.input<typeof changeEmployeeNoSchema>;

/** Contact card (B1–B12). B1 is the sign-in email: blocked once the user has accepted the invitation (open question Q-W3-03). */
export const updateContactSchema = contactSchema.extend({ employeeId: uuidSchema }).superRefine((v, ctx) => contactRules(v, ctx, []));
export type UpdateContactInput = z.input<typeof updateContactSchema>;
export const saveEmergencyContactsSchema = z.object({ employeeId: uuidSchema, contacts: emergencyContactsSchema });
export type SaveEmergencyContactsInput = z.input<typeof saveEmergencyContactsSchema>;

/** Photo (A16, E✎ for own) — after requestEmployeeFileUpload(purpose 'photo') + confirm. null removes. */
export const setPhotoSchema = z.object({ employeeId: uuidSchema, fileId: optionalUuidSchema });
export type SetPhotoInput = z.input<typeof setPhotoSchema>;

// Family (D, E) — not own (E→CR)
export const saveSpouseSchema = z.object({
  employeeId: uuidSchema,
  id: optionalUuidSchema.optional(),                                     // omitted → add (max 4 Current)
  fullName: personNameSchema('Spouse full name'),                        // D1
  /** D2 — required when adding; omit/blank on edit to keep the stored value */
  mykad: optionalMykadSchema,
  marriageDate: optionalDate,                                            // D3 (≤ today)
  workingStatus: z.enum(SPOUSE_WORKING_STATUSES, { error: 'Select the working status.' }),   // D4
  isOku: booleanSchema.default(false),                                   // D5
  incomeTaxNo: optionalTaxNoSchema,                                      // D6
  reliefClaimedByEmployee: z.preprocess((v) => (v === '' || v === undefined ? null : v), booleanSchema.nullable()),   // D7
  recordStatus: z.enum(SPOUSE_RECORD_STATUSES).default('current'),      // D8
  phone: optionalPhoneSchema('Spouse phone'),                            // D9
}).superRefine((v, ctx) => {
  if (!v.id && !v.mykad) ctx.addIssue({ code: 'custom', path: ['mykad'], message: 'Spouse MyKad is required.' });
  if (v.reliefClaimedByEmployee && v.workingStatus !== 'not_working')
    ctx.addIssue({ code: 'custom', path: ['reliefClaimedByEmployee'], message: 'Spouse relief applies only when the spouse is not working.' });
});
export type SaveSpouseInput = z.input<typeof saveSpouseSchema>;

export const saveChildSchema = z.object({
  employeeId: uuidSchema,
  id: optionalUuidSchema.optional(),
  fullName: personNameSchema('Child full name'),                         // E1
  mykad: optionalMykadSchema,                                            // E2 (blank on edit = keep)
  dateOfBirth: isoDateSchema,                                            // E3 (≤ today)
  gender: optionalEnum(GENDERS),                                         // E4
  relationship: z.enum(CHILD_RELATIONSHIPS, { error: 'Select the relationship.' }),   // E5
  pcbCategory: optionalEnum(PCB_CHILD_CATEGORIES),                       // E6 (BR-EMP-17 vs age)
  reliefShare: optionalEnum(RELIEF_SHARES),                              // E7
  institutionLevel: optionalText(100, 'Institution & level of study'),  // E8
  isOku: booleanSchema.default(false),                                   // E9
}).superRefine((v, ctx) => {
  if (v.pcbCategory && STUDY_PCB_CATEGORIES.includes(v.pcbCategory) && !v.institutionLevel)
    ctx.addIssue({ code: 'custom', path: ['institutionLevel'], message: 'Enter the institution and level of study.' });
});
export type SaveChildInput = z.input<typeof saveChildSchema>;
/** Removes a child from the family list (soft: is_active = false — FR-G-08). */
export const setChildActiveSchema = z.object({ id: uuidSchema, isActive: booleanSchema });
export type SetChildActiveInput = z.input<typeof setChildActiveSchema>;
/** E12 manual counts (migration only). null clears and the derived counts apply. */
const count = z.coerce.number().int().min(0).max(20);
export const saveChildCountsSchema = z.object({
  employeeId: uuidSchema,
  counts: z.object({ lt18: count, tertiary: count, disabledLt18: count, disabledTertiary: count }).nullable(),
});
export type SaveChildCountsInput = z.input<typeof saveChildCountsSchema>;

/** Employment card — non-effective-dated fields only (UXQ-13); job fields go through addJobChange. */
export const updateEmploymentSchema = z.object({
  employeeId: uuidSchema,
  joinDate: isoDateSchema,                                               // F1 (moves the New-hire row when unchanged history)
  continuousServiceDate: isoDateSchema,                                  // F2
  probationMonths: employmentSchema.shape.probationMonths,               // F4
  leaveApproverId: optionalUuidSchema,                                   // F15
  claimApproverId: optionalUuidSchema,                                   // F16
  contractualNoticeValue: employmentSchema.shape.contractualNoticeValue, // F21
  contractualNoticeUnit: employmentSchema.shape.contractualNoticeUnit,
  phStateOverride: employmentSchema.shape.phStateOverride,               // F20
  costCentreId: optionalUuidSchema,                                      // F22
  offerContractRef: optionalText(50, 'Offer / contract reference'),      // F23
  contractSignedDate: optionalDate,                                      // F25
  employeeGroupIds: z.array(uuidSchema).default([]),                     // F28
  /** F14 — SA only; ignored (unchanged) for ADM */
  isTopOfOrg: booleanSchema.optional(),
}).superRefine((v, ctx) => {
  if (v.continuousServiceDate > v.joinDate) ctx.addIssue({ code: 'custom', path: ['continuousServiceDate'], message: 'Continuous-service date must be on or before the join date.' });
  if ((v.contractualNoticeValue == null) !== (v.contractualNoticeUnit == null))
    ctx.addIssue({ code: 'custom', path: ['contractualNoticeUnit'], message: 'Enter both the notice period and its unit.' });
});
export type UpdateEmploymentInput = z.input<typeof updateEmploymentSchema>;

// E5 Job change
const jobFields = {
  effectiveDate: isoDateSchema,                                          // JH1 (≥ join date; future = Scheduled)
  changeType: z.enum(MANUAL_JOB_CHANGE_TYPES, { error: 'Select the change type.' }),   // JH2
  departmentId: uuidSchema, positionId: uuidSchema, gradeId: uuidSchema, // JH3–JH5
  managerId: optionalUuidSchema,                                         // JH6 (loop check)
  workLocationId: uuidSchema, workingPatternId: uuidSchema,              // JH7, JH8
  remarks: optionalText(500, 'Remarks'),                                 // JH10 (required for Data correction)
  referenceDocumentId: optionalUuidSchema,                               // JH10 optional document link
};
const jobRule = (v: { changeType: string; remarks: string | null }, ctx: Ctx) => {
  if (v.changeType === 'data_correction' && !v.remarks) ctx.addIssue({ code: 'custom', path: ['remarks'], message: 'Remarks are required for a data correction.' });
};
export const addJobChangeSchema = z.object({ employeeId: uuidSchema, ...jobFields }).superRefine(jobRule);
export type AddJobChangeInput = z.input<typeof addJobChangeSchema>;
/** Future rows: any field; past/current rows: change type must be Data correction with remarks (DB guard). */
export const updateJobChangeSchema = z.object({ id: uuidSchema, version: z.coerce.number().int().min(1), ...jobFields }).superRefine(jobRule);
export type UpdateJobChangeInput = z.input<typeof updateJobChangeSchema>;
/** EC-EMP-06: future rows only, reason required (soft delete). */
export const deleteJobChangeSchema = z.object({ id: uuidSchema, reason: requiredText(500, 'Reason') });
export type DeleteJobChangeInput = z.input<typeof deleteJobChangeSchema>;
/** E5 pre-fill + impact panel. */
export type JobChangeContext = {
  rowInForce: Omit<JobHistoryRow, 'enteredByName' | 'enteredAt'> | null;
  impacts: string[];                     // "PH calendar changes to … from …", "N reportees …"
};

// E6 Probation
export const confirmEmployeeSchema = z.object({
  employeeId: uuidSchema, confirmationDate: isoDateSchema, remarks: optionalText(500, 'Remarks'),
});
export type ConfirmEmployeeInput = z.input<typeof confirmEmployeeSchema>;
export const extendProbationSchema = z.object({
  employeeId: uuidSchema, newEndDate: isoDateSchema, reason: requiredText(500, 'Reason'),
});
export type ExtendProbationInput = z.input<typeof extendProbationSchema>;

// E7 Separation
export const separationFieldsSchema = z.object({
  noticeDate: isoDateSchema,                                             // G1
  separationType: z.enum(SEPARATION_TYPES, { error: 'Select the separation type.' }),   // G2
  reasonCategory: z.enum(SEPARATION_REASONS, { error: 'Select the reason.' }),           // G3
  reasonText: optionalText(500, 'Reason details'),
  lastWorkingDay: isoDateSchema,                                         // G5 (≥ G1)
  noticeOutcome: z.enum(NOTICE_OUTCOMES, { error: 'Select the notice handling.' }),      // G6
  portalAccessEndDate: optionalDate,                                     // G7 (default G5; ≤ G5 + 30)
  eligibleForRehire: z.preprocess((v) => (v === '' || v === undefined ? null : v), booleanSchema.nullable()),   // G8
  exitRemarks: optionalText(1000, 'Exit remarks'),                       // G9
});
const separationRule = (v: z.output<typeof separationFieldsSchema>, ctx: Ctx) => {
  if (v.lastWorkingDay < v.noticeDate) ctx.addIssue({ code: 'custom', path: ['lastWorkingDay'], message: 'Last working day must be on or after the notice date.' });
  if (v.reasonCategory === 'other' && !v.reasonText) ctx.addIssue({ code: 'custom', path: ['reasonText'], message: 'Describe the reason.' });
  if (v.portalAccessEndDate && v.portalAccessEndDate < v.lastWorkingDay)
    ctx.addIssue({ code: 'custom', path: ['portalAccessEndDate'], message: 'Portal access end must be on or after the last working day.' });
};
export const recordSeparationSchema = separationFieldsSchema.extend({ employeeId: uuidSchema }).superRefine(separationRule);
export type RecordSeparationInput = z.input<typeof recordSeparationSchema>;
export const updateSeparationSchema = separationFieldsSchema.extend({ separationId: uuidSchema, version: z.coerce.number().int().min(1) }).superRefine(separationRule);
export type UpdateSeparationInput = z.input<typeof updateSeparationSchema>;
export const separationPreviewSchema = z.object({ employeeId: uuidSchema, noticeDate: isoDateSchema, lastWorkingDay: optionalDate.optional() });
export type SeparationPreviewInput = z.input<typeof separationPreviewSchema>;
export type SeparationPreview = {
  noticeRequiredDays: number;            // G4
  noticeBasis: string;                   // "6 weeks (EA s12, 3 years' service)" or "Contractual: 2 months"
  expectedLastWorkingDay: string;        // G1 + G4 − 1
  shortfallDays: number;                 // G6 (for the given LWD)
  statusAfter: EmploymentStatus;         // Notice Period / Separated
  defaultPortalAccessEnd: string;        // = LWD
  maxPortalAccessEnd: string;            // = LWD + 30
  reporteeCount: number;                 // "N reportees will need a new manager"
  /** W2-004 / W2-005 — null until then */
  leavePosition: null; pendingApprovals: null; openClaims: null;
  warnings: string[];                    // e.g. maternity-period termination (BR-LV-43) once leave exists
};
export const withdrawResignationSchema = z.object({ employeeId: uuidSchema, remarks: requiredText(500, 'Remarks') });
export type WithdrawResignationInput = z.input<typeof withdrawResignationSchema>;
/** Pending Join → Withdrawn (offer withdrawn / no-show — §5.6). */
export const withdrawOfferSchema = z.object({ employeeId: uuidSchema, remarks: requiredText(500, 'Remarks') });
export type WithdrawOfferInput = z.input<typeof withdrawOfferSchema>;

// E9 Rehire (Could)
export const rehireEmployeeSchema = z.object({
  employeeId: uuidSchema,
  /** BR-EMP-05 "same person" confirmation */
  samePersonConfirmed: z.literal(true, { error: 'Confirm this is the same person.' }),
  /** default = setting rehire_keep_employee_no; a typed new number is SA only */
  keepEmployeeNo: booleanSchema.default(true),
  newEmployeeNo: employmentSchema.shape.employeeNo,
  joinDate: isoDateSchema,
  continuousServiceChoice: z.enum(['new_join_date', 'original_join_date', 'other']).default('new_join_date'),
  continuousServiceDate: optionalDate,
  probationMonths: employmentSchema.shape.probationMonths,
  departmentId: uuidSchema, positionId: uuidSchema, gradeId: uuidSchema, managerId: optionalUuidSchema,
  workLocationId: uuidSchema, workingPatternId: uuidSchema,
  invite: inviteChoiceSchema.default({ mode: 'scheduled', scheduledSendDate: null }),
}).superRefine((v, ctx) => {
  if (v.continuousServiceChoice === 'other' && !v.continuousServiceDate) ctx.addIssue({ code: 'custom', path: ['continuousServiceDate'], message: 'Enter the continuous-service date.' });
});
export type RehireEmployeeInput = z.input<typeof rehireEmployeeSchema>;

// Statutory & bank
export const saveStatutorySchema = z.object({
  employeeId: uuidSchema,
  profile: statutoryProfileSchema,
  employerFlags: employerFlagsSchema,
});
export type SaveStatutoryInput = z.input<typeof saveStatutorySchema>;
export const saveBankDetailsSchema = z.object({ employeeId: uuidSchema, bank: bankDetailsSchema });
export type SaveBankDetailsInput = z.input<typeof saveBankDetailsSchema>;
export type SaveBankDetailsResult = { bankAccountId: string; notified: boolean; warnings: string[] };

// E10 Reveal
export const revealEmployeeValueSchema = z.object({
  employeeId: uuidSchema,
  field: z.enum(REVEAL_FIELDS),
  /** spouse / child / bank row id (bank: omitted = current row) */
  rowId: optionalUuidSchema.optional(),
  /** ADM: required (select + text); SA: optional */
  reasonCode: optionalEnum(REVEAL_REASONS).optional(),
  reasonText: optionalText(500, 'Reason'),
});
export type RevealEmployeeValueInput = z.input<typeof revealEmployeeValueSchema>;
/** Own values (P16 "Show"): bank / ASNB / spouse / child MyKad — logged. Own MyKad needs no reveal. */
export const revealMyValueSchema = z.object({ field: z.enum(['bank_account_no', 'asnb_account_no', 'spouse_nric', 'child_nric']), rowId: optionalUuidSchema.optional() });
export type RevealMyValueInput = z.input<typeof revealMyValueSchema>;
export type RevealResult = { value: string };

// ===========================================================================
// File uploads (documents, bank proof, photo, CR attachments) — ADR-0007 two-step upload
// ===========================================================================
export const EMPLOYEE_FILE_PURPOSES = ['document', 'bank_proof', 'photo'] as const;
export type EmployeeFilePurpose = (typeof EMPLOYEE_FILE_PURPOSES)[number];
export const DOCUMENT_MIME_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const requestEmployeeFileUploadSchema = z.object({
  /** photo: own employee id allowed for EMP; document / bank_proof: ADM/SA, never own record */
  employeeId: uuidSchema,
  purpose: z.enum(EMPLOYEE_FILE_PURPOSES),
  fileName: requiredText(200, 'File name'),
  mimeType: z.enum(DOCUMENT_MIME_TYPES, { error: 'Allowed types: PDF, JPG, PNG, HEIC, DOCX.' }),
  sizeBytes: z.coerce.number().int().min(1).max(10 * 1024 * 1024, 'The file must be 10 MB or smaller.'),
}).superRefine((v, ctx) => {
  if (v.purpose === 'photo' && !(PHOTO_MIME_TYPES as readonly string[]).includes(v.mimeType)) ctx.addIssue({ code: 'custom', path: ['mimeType'], message: 'Upload a JPG or PNG photo.' });
  if (v.purpose === 'photo' && v.sizeBytes > PHOTO_MAX_BYTES) ctx.addIssue({ code: 'custom', path: ['sizeBytes'], message: 'The photo must be 5 MB or smaller.' });
  if (v.purpose === 'bank_proof' && v.mimeType.includes('wordprocessingml')) ctx.addIssue({ code: 'custom', path: ['mimeType'], message: 'Upload a PDF or image as proof.' });
});
export type RequestEmployeeFileUploadInput = z.input<typeof requestEmployeeFileUploadSchema>;
export const fileIdSchema = z.object({ fileId: uuidSchema });
export type FileIdInput = z.input<typeof fileIdSchema>;

// E11 Documents (K1–K7)
export const documentListParamsSchema = pageParamsSchema.extend({
  employeeId: uuidSchema,
  categories: multi(z.enum(DOCUMENT_CATEGORIES)),
  visible: z.enum(['all', 'visible', 'hidden']).default('all'),
  active: z.enum(['all', 'active', 'inactive']).default('active'),
  sort: z.enum(['title', 'category', 'documentDate', 'expiryDate', 'uploadedAt']).default('uploadedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type DocumentListParams = z.input<typeof documentListParamsSchema>;
export type EmployeeDocumentRow = {
  id: string; employeeId: string; title: string; category: DocumentCategory;            // K2, K1
  documentDate: string | null; expiryDate: string | null;                              // K4
  visibleToEmployee: boolean; isHrOnlyCategory: boolean;                               // K5
  remarks: string | null;                                                              // K6 (ADM/SA only)
  file: FileRef;
  uploadedAt: string; uploadedByName: string | null;                                   // K7
  isActive: boolean; version: number;
};
const documentFields = {
  category: z.enum(DOCUMENT_CATEGORIES, { error: 'Select the category.' }),
  title: requiredText(100, 'Title'),
  documentDate: optionalDate,
  expiryDate: optionalDate,
  visibleToEmployee: booleanSchema.default(false),
  remarks: optionalText(500, 'Remarks'),
};
const documentRule = (v: { category: DocumentCategory; visibleToEmployee: boolean; documentDate: string | null; expiryDate: string | null }, ctx: Ctx) => {
  if (v.visibleToEmployee && HR_ONLY_DOCUMENT_CATEGORIES.includes(v.category))
    ctx.addIssue({ code: 'custom', path: ['visibleToEmployee'], message: 'This category is always HR-only.' });
  if (v.documentDate && v.expiryDate && v.expiryDate < v.documentDate)
    ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry must be on or after the document date.' });
};
export const createDocumentSchema = z.object({ employeeId: uuidSchema, fileId: uuidSchema, ...documentFields }).superRefine(documentRule);
export type CreateDocumentInput = z.input<typeof createDocumentSchema>;
/** replaceFileId: a new confirmed upload — creates a new document row and deactivates this one (old version kept). */
export const updateDocumentSchema = z.object({ id: uuidSchema, version: z.coerce.number().int().min(1), replaceFileId: optionalUuidSchema.optional(), ...documentFields }).superRefine(documentRule);
export type UpdateDocumentInput = z.input<typeof updateDocumentSchema>;
export const setDocumentActiveSchema = z.object({ id: uuidSchema, isActive: booleanSchema });
export type SetDocumentActiveInput = z.input<typeof setDocumentActiveSchema>;
export const documentIdSchema = z.object({ id: uuidSchema });
export type DocumentIdInput = z.input<typeof documentIdSchema>;

// P19 My documents (visible ones)
export const myDocumentListParamsSchema = pageParamsSchema.extend({
  categories: multi(z.enum(DOCUMENT_CATEGORIES)),
  sort: z.enum(['title', 'category', 'documentDate', 'uploadedAt']).default('uploadedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type MyDocumentListParams = z.input<typeof myDocumentListParamsSchema>;
export type MyDocumentRow = Omit<EmployeeDocumentRow, 'remarks' | 'uploadedByName' | 'isHrOnlyCategory' | 'version' | 'visibleToEmployee' | 'isActive'>;

// E16 HR notes (L1) — HR-only
export type HrNote = {
  id: string; noteDate: string; body: string; createdByName: string | null; createdAt: string;
  updatedAt: string; updatedByName: string | null; isEdited: boolean; version: number;
  revisions: { revision: number; body: string; editedByName: string | null; editedAt: string }[];
};
export const createHrNoteSchema = z.object({ employeeId: uuidSchema, noteDate: isoDateSchema, body: requiredText(2000, 'Note') });
export type CreateHrNoteInput = z.input<typeof createHrNoteSchema>;
export const updateHrNoteSchema = z.object({ id: uuidSchema, version: z.coerce.number().int().min(1), noteDate: isoDateSchema, body: requiredText(2000, 'Note') });
export type UpdateHrNoteInput = z.input<typeof updateHrNoteSchema>;

// L2 Prior employment (A,S; E✎ own)
export const savePriorEmploymentSchema = z.object({
  employeeId: uuidSchema, id: optionalUuidSchema.optional(),
  employer: requiredText(150, 'Employer'), position: requiredText(100, 'Position'),
  dateFrom: isoDateSchema, dateTo: isoDateSchema,
}).refine((v) => v.dateTo >= v.dateFrom, { path: ['dateTo'], message: '"To" must be on or after "From".' });
export type SavePriorEmploymentInput = z.input<typeof savePriorEmploymentSchema>;
export const deletePriorEmploymentSchema = z.object({ id: uuidSchema });

// ===========================================================================
// E12/E13 Change requests (F-EMP-19) + P17/P18 (EMP own)
// ===========================================================================
const spouseCrRow = z.object({
  /** existing spouse id when editing; omitted → new spouse */
  id: optionalUuidSchema.optional(),
  fullName: personNameSchema('Spouse full name'),
  mykad: optionalMykadSchema,
  marriageDate: optionalDate,
  workingStatus: z.enum(SPOUSE_WORKING_STATUSES),
  isOku: booleanSchema.default(false),
  incomeTaxNo: optionalTaxNoSchema,
  reliefClaimedByEmployee: z.preprocess((v) => (v === '' || v === undefined ? null : v), booleanSchema.nullable()),
  recordStatus: z.enum(SPOUSE_RECORD_STATUSES).default('current'),
}).refine((v) => !!v.id || !!v.mykad, { path: ['mykad'], message: 'Spouse MyKad is required.' });
const childCrRow = z.object({
  id: optionalUuidSchema.optional(),
  /** remove: the child is taken off the family list */
  op: z.enum(['add', 'update', 'remove']).default('update'),
  fullName: personNameSchema('Child full name'),
  mykad: optionalMykadSchema,
  dateOfBirth: isoDateSchema,
  gender: optionalEnum(GENDERS),
  relationship: z.enum(CHILD_RELATIONSHIPS),
  pcbCategory: optionalEnum(PCB_CHILD_CATEGORIES),
  reliefShare: optionalEnum(RELIEF_SHARES),
  institutionLevel: optionalText(100, 'Institution & level of study'),
  isOku: booleanSchema.default(false),
});
const crCommon = {
  /** CR4: default today; Marital status may be past-dated ≤ 90 days; at most 90 days ahead */
  effectiveDate: isoDateSchema,
  remarks: optionalText(500, 'Remarks'),                                 // CR6
  fileIds: z.array(uuidSchema).max(5).default([]),                       // CR5 (confirmed uploads)
  idempotencyKey,
};
export const submitChangeRequestSchema = z.discriminatedUnion('category', [
  z.object({ category: z.literal('legal_name'), ...crCommon, fullName: personNameSchema() }),
  z.object({ category: z.literal('mykad'), ...crCommon, mykad: mykadSchema }),
  z.object({ category: z.literal('marital_spouse'), ...crCommon, maritalStatus: z.enum(MARITAL_STATUSES), spouses: z.array(spouseCrRow).max(4).default([]) }),
  z.object({ category: z.literal('children'), ...crCommon, children: z.array(childCrRow).min(1, 'Add at least one change.').max(20) }),
  z.object({ category: z.literal('oku'), ...crCommon, isOku: booleanSchema, okuCardNo: optionalText(20, 'OKU card no.') }),
  z.object({ category: z.literal('religion'), ...crCommon, religion: optionalEnum(RELIGIONS) }),
  z.object({ category: z.literal('race'), ...crCommon, race: optionalEnum(RACES), raceOther: optionalText(50, 'Race (other)') }),
  z.object({
    category: z.literal('bank_details'), ...crCommon,
    paymentMethod: z.enum(PAYMENT_METHODS).default('bank_transfer'), bankId: optionalUuidSchema, accountType: optionalEnum(BANK_ACCOUNT_TYPES),
    accountNo: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null), accountNoSchema().nullable()),
    accountHolderName: optionalText(150, 'Account holder name'), holderNameMismatchAck: booleanSchema.default(false),
    asnbAccountNo: optionalAccountNoSchema(),
  }),
  z.object({
    category: z.literal('statutory_numbers'), ...crCommon,
    incomeTaxNo: optionalTaxNoSchema, lhdnBranchId: optionalUuidSchema, epfNo: optionalEpfNoSchema,
    epfRateType: z.enum(EPF_RATE_TYPES).default('statutory'), epfSpecificRate: optionalPctSchema('Specific EPF rate'),
    epfExtraEmployeePct: optionalPctSchema('Extra employee EPF %'),
    socsoContributedBefore: z.preprocess((v) => (v === '' || v === undefined ? null : v), booleanSchema.nullable()),
    payZakat: booleanSchema.default(false), zakatMonthlyAmount: optionalMoneySchema('Zakat monthly amount'),
    zakatAccountNo: optionalText(30, 'Zakat account / reference no.'), zakatBodyId: optionalUuidSchema,
    ptptnMonthlyAmount: optionalMoneySchema('PTPTN monthly deduction'), ptptnStartDate: optionalDate, ptptnEndDate: optionalDate,
  }),
]).superRefine((v, ctx) => {
  if (CR_DOCUMENT_REQUIRED[v.category] && v.fileIds.length === 0)
    ctx.addIssue({ code: 'custom', path: ['fileIds'], message: `Attach: ${CR_DOCUMENT_REQUIRED[v.category]}.` });
  if (v.category === 'oku' && v.isOku && !v.okuCardNo) ctx.addIssue({ code: 'custom', path: ['okuCardNo'], message: 'Enter the OKU card no.' });
  if (v.category === 'race' && v.race === 'others' && !v.raceOther) ctx.addIssue({ code: 'custom', path: ['raceOther'], message: 'Specify the race.' });
  if (v.category === 'bank_details' && v.paymentMethod === 'bank_transfer') {
    if (!v.bankId) ctx.addIssue({ code: 'custom', path: ['bankId'], message: 'Select the bank.' });
    if (!v.accountType) ctx.addIssue({ code: 'custom', path: ['accountType'], message: 'Select the account type.' });
    if (!v.accountNo) ctx.addIssue({ code: 'custom', path: ['accountNo'], message: 'Enter the account no.' });
    if (!v.accountHolderName) ctx.addIssue({ code: 'custom', path: ['accountHolderName'], message: 'Enter the account holder name.' });
  }
  if (v.category === 'statutory_numbers' && v.payZakat && (!v.zakatMonthlyAmount || !v.zakatAccountNo))
    ctx.addIssue({ code: 'custom', path: ['zakatMonthlyAmount'], message: 'Enter the zakat amount and account no.' });
});
export type SubmitChangeRequestInput = z.input<typeof submitChangeRequestSchema>;
export type SubmitChangeRequestResult = { id: string; crNo: string; itemCount: number; warnings: string[] };

/** CR attachment upload (EMP own; cr-files bucket) → then pass fileId in fileIds. */
export const requestChangeRequestUploadSchema = z.object({
  fileName: requiredText(200, 'File name'),
  mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/heic'], { error: 'Allowed types: PDF, JPG, PNG, HEIC.' }),
  sizeBytes: z.coerce.number().int().min(1).max(10 * 1024 * 1024, 'The file must be 10 MB or smaller.'),
});
export type RequestChangeRequestUploadInput = z.input<typeof requestChangeRequestUploadSchema>;

export const changeRequestListParamsSchema = pageParamsSchema.extend({
  /** searches CR no. and employee no./name */
  statuses: multi(z.enum(CR_STATUSES)),          // E12 default ['submitted'] when undefined
  categories: multi(z.enum(CR_CATEGORIES)),
  submittedFrom: isoDateSchema.optional().catch(undefined),
  submittedTo: isoDateSchema.optional().catch(undefined),
  employeeId: uuidSchema.optional().catch(undefined),
  sort: z.enum(['crNo', 'employee', 'category', 'submittedAt', 'effectiveDate', 'status']).default('submittedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type ChangeRequestListParams = z.input<typeof changeRequestListParamsSchema>;
export type ChangeRequestRow = {
  id: string; crNo: string; employee: EmployeeRef; category: CrCategory;
  submittedAt: string; effectiveDate: string; status: CrStatus;
  attachmentCount: number; decidedAt: string | null; decidedByName: string | null;
  appliedAt: string | null;
  /** the viewer's own request ("Your request" — read-only) */
  isOwn: boolean;
};
export type ChangeRequestItemView = {
  id: string; field: string; label: string; op: 'update' | 'insert' | 'remove';
  /** e.g. "Spouse 1 · Siti (new)" */
  group: string | null;
  currentDisplay: string | null;         // masked where sensitive
  requestedDisplay: string | null;       // masked where sensitive (REVEAL via revealChangeRequestValue)
  isSensitive: boolean;
  validation: { ok: boolean; message: string | null };
};
export type ChangeRequestDetail = ChangeRequestRow & {
  items: ChangeRequestItemView[];
  files: FileRef[];                      // viewer, logged download
  employeeRemarks: string | null;        // CR6
  decisionRemarks: string | null;        // CR8
  warnings: string[];                    // bank: name mismatch / shared account (EC-EMP-12)
  version: number;
  can: { decide: boolean; cancel: boolean; reveal: boolean; viewFiles: boolean };
};
export const decideChangeRequestSchema = z.object({
  id: uuidSchema, decision: z.enum(['approve', 'reject']), remarks: optionalText(500, 'Remarks'), version: z.coerce.number().int().min(1),
}).refine((v) => v.decision === 'approve' || !!v.remarks, { path: ['remarks'], message: 'Remarks are required to reject.' });
export type DecideChangeRequestInput = z.input<typeof decideChangeRequestSchema>;
export type DecideChangeRequestResult = { status: CrStatus; applied: boolean; appliesOn: string | null };
export const changeRequestIdSchema = z.object({ id: uuidSchema });
export type ChangeRequestIdInput = z.input<typeof changeRequestIdSchema>;
export const revealChangeRequestValueSchema = z.object({
  itemId: uuidSchema, reasonCode: optionalEnum(REVEAL_REASONS).optional(), reasonText: optionalText(500, 'Reason'),
});
export type RevealChangeRequestValueInput = z.input<typeof revealChangeRequestValueSchema>;
export const changeRequestFileSchema = z.object({ changeRequestId: uuidSchema, fileId: uuidSchema });
export type ChangeRequestFileInput = z.input<typeof changeRequestFileSchema>;

// ===========================================================================
// E14 Bulk update via CSV (F-EMP-25) — /employees/bulk-update
// ===========================================================================
export const BULK_UPDATE_FIELDS = ['manager', 'department', 'position', 'grade', 'work_location', 'working_pattern', 'employee_groups'] as const;
export type BulkUpdateField = (typeof BULK_UPDATE_FIELDS)[number];
export const BULK_UPDATE_FIELD_LABELS = labels<BulkUpdateField>({
  manager: 'Reporting manager', department: 'Department', position: 'Position', grade: 'Grade',
  work_location: 'Work location', working_pattern: 'Working pattern', employee_groups: 'Employee groups',
});
/** CSV header per field. Values: manager = employee no.; department/position/grade = code; location/pattern = name; groups = names separated by ';' (replaces membership). */
export const BULK_UPDATE_HEADERS = labels<BulkUpdateField>({
  manager: 'Reporting manager (employee no.)', department: 'Department (code)', position: 'Position (code)', grade: 'Grade (code)',
  work_location: 'Work location (name)', working_pattern: 'Working pattern (name)', employee_groups: 'Employee groups (names; separated)',
});
export const BULK_MAX_CSV_BYTES = 1024 * 1024;
export const bulkTemplateSchema = z.object({ fields: z.array(z.enum(BULK_UPDATE_FIELDS)).min(1, 'Select the fields to update.'), employeeIds: z.array(uuidSchema).optional() });
export type BulkTemplateInput = z.input<typeof bulkTemplateSchema>;
export const bulkUpdateSchema = z.object({
  fields: z.array(z.enum(BULK_UPDATE_FIELDS)).min(1, 'Select the fields to update.'),
  effectiveDate: isoDateSchema,
  /** the uploaded file's text (UTF-8, read in the browser) */
  csv: z.string().min(1, 'Upload the CSV file.').max(BULK_MAX_CSV_BYTES, 'The file must be 1 MB or smaller.'),
  remarks: optionalText(500, 'Remarks'),
});
export type BulkUpdateInput = z.input<typeof bulkUpdateSchema>;
export type BulkUpdatePreviewRow = {
  rowNo: number; employeeNo: string; employeeName: string | null; field: BulkUpdateField | null;
  current: string | null; requested: string | null;
  result: 'ok' | 'unchanged' | 'error' | 'warning'; message: string | null;
};
export type BulkUpdatePreview = { rows: BulkUpdatePreviewRow[]; totalRows: number; valid: number; errors: number; warnings: number; changes: number };
export type BulkUpdateCommitResult = { employeesChanged: number; jobRowsCreated: number; groupChanges: number };

// E15 Bulk actions
export const bulkChangeManagerSchema = z.object({
  employeeIds: z.array(uuidSchema).min(1, 'Select employees.').max(500),
  managerId: uuidSchema,
  effectiveDate: isoDateSchema,
  remarks: optionalText(500, 'Remarks'),
});
export type BulkChangeManagerInput = z.input<typeof bulkChangeManagerSchema>;
export type BulkRowResult = { employeeId: string; employeeNo: string; ok: boolean; message: string | null };
export type BulkChangeManagerResult = { applied: number; skipped: number; rows: BulkRowResult[] };
export const bulkSendInvitesSchema = z.object({
  employeeIds: z.array(uuidSchema).min(1, 'Select employees.').max(500),
  mode: z.enum(['now', 'scheduled']).default('now'),
  scheduledSendDate: optionalDate,
}).refine((v) => v.mode === 'now' || !!v.scheduledSendDate, { path: ['scheduledSendDate'], message: 'Choose the send date.' });
export type BulkSendInvitesInput = z.input<typeof bulkSendInvitesSchema>;
export type BulkSendInvitesResult = { sent: number; scheduled: number; emailNotSent: number; skipped: { employeeNo: string; reason: string }[] };

/** Profile "Send / re-send invite" (F-ADM-02) — creates the employee user if needed. */
export const inviteEmployeeSchema = z.object({ employeeId: uuidSchema, mode: z.enum(['now', 'scheduled']).default('now'), scheduledSendDate: optionalDate })
  .refine((v) => v.mode === 'now' || !!v.scheduledSendDate, { path: ['scheduledSendDate'], message: 'Choose the send date.' });
export type InviteEmployeeInput = z.input<typeof inviteEmployeeSchema>;
export type InviteEmployeeResult = { userId: string; emailSent: boolean; scheduledFor: string | null; message: string };

// ===========================================================================
// E3 Activity log (F-EMP-28) + field changes (F-EMP-21) — ADM/SA; export SA
// ===========================================================================
export const ACTIVITY_EVENT_TYPES = [
  'created', 'invited', 'personal', 'contact', 'family', 'job_change', 'probation', 'separation', 'statutory', 'bank',
  'document', 'change_request', 'note', 'access', 'other',
] as const;
export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];
export const ACTIVITY_EVENT_LABELS = labels<ActivityEventType>({
  created: 'Created', invited: 'Portal access', personal: 'Personal details', contact: 'Contact & emergency', family: 'Family',
  job_change: 'Job change', probation: 'Probation', separation: 'Separation', statutory: 'Statutory & payroll', bank: 'Bank details',
  document: 'Document', change_request: 'Change request', note: 'HR note', access: 'Sensitive view / export', other: 'Other',
});
export const activityParamsSchema = pageParamsSchema.extend({
  employeeId: uuidSchema,
  view: z.enum(['events', 'fields']).default('events'),
  eventTypes: multi(z.enum(ACTIVITY_EVENT_TYPES)),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type ActivityParams = z.input<typeof activityParamsSchema>;
export type ActivityRow = {
  key: string; occurredAt: string; eventType: ActivityEventType; event: string;          // "Job change (Promotion)", "CR-2027-00012 approved"
  action: string; entityType: string; entityRef: string | null;
  actorName: string | null; onBehalf: boolean; link: string | null;
};
export type FieldChangeRow = {
  key: string; occurredAt: string; table: string; field: string; label: string;
  before: string | null; after: string | null; masked: boolean;
  actorName: string | null; source: string;                                              // 'Direct edit' / 'CR-…' / 'System'
};

// ===========================================================================
// G10 Staff directory (F-EMP-23) / G11 Org chart (F-EMP-22) — all employee users, ADM, SA
// ===========================================================================
export const directoryParamsSchema = pageParamsSchema.extend({
  departmentIds: multi(uuidSchema),
  locationIds: multi(uuidSchema),
  sort: z.enum(['name', 'position', 'department', 'location']).default('name'),
});
export type DirectoryParams = z.input<typeof directoryParamsSchema>;
/** FR-EMP-14: exactly these fields, nothing else. */
export type DirectoryRow = {
  employeeId: string; name: string; preferredName: string | null; photoUrl: string | null;
  position: string; department: string; location: string; workEmail: string; workPhone: string | null;
  /** ADM/SA only (link → S-EM-03); null for others */
  profileHref: string | null;
};
export type DirectoryFilterOptions = { departments: Ref[]; locations: Ref[] };
export type OrgChartNode = {
  employeeId: string; managerId: string | null; name: string; preferredName: string | null; position: string;
  department: string; departmentId: string | null; photoUrl: string | null; profileHref: string | null;
};
export type OrgChart = { nodes: OrgChartNode[]; roots: string[] };

// ===========================================================================
// Employee pickers (manager, approvers, department head, group members, invite U4)
// ===========================================================================
export const employeeOptionsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  /** default true: Pending Join + On Probation + Confirmed + Notice Period */
  activeOnly: booleanSchema.default(true),
  excludeEmployeeId: optionalUuidSchema.optional(),
  /** Q-F3 (O10 "ADD BY FILTER"): optional department / work-location filters */
  departmentIds: multi(uuidSchema),
  locationIds: multi(uuidSchema),
  /** type-ahead ≤ 50; ADD BY FILTER may ask up to 500 */
  limit: z.coerce.number().int().min(1).max(500).default(20),
});
export type EmployeeOptionsInput = z.input<typeof employeeOptionsSchema>;
export type EmployeeOption = { id: string; employeeNo: string; name: string; position: string | null; department: string | null; status: EmploymentStatus };

/** Q-F1: E5 pre-fill / impact panel while typing. */
export const jobChangeContextSchema = z.object({ employeeId: uuidSchema, effectiveDate: isoDateSchema });
export type JobChangeContextInput = z.input<typeof jobChangeContextSchema>;

/** Q-F2: lookups for P17 change requests — readable by every signed-in role (P-ACTIVE reference data). */
export type ChangeRequestFormOptions = {
  banks: { id: string; name: string; code: string }[];
  lhdnBranches: Ref[];
  zakatBodies: (Ref & { state: MyState })[];
};

/** Lookups for the employee forms (banks I2, LHDN branches H5). */
export type BankOption = { id: string; name: string; code: string; bic: string | null };
export type EmployeeFormOptions = {
  banks: BankOption[];
  lhdnBranches: Ref[];
  settings: { defaultProbationMonths: number; maxProbationMonths: number; inviteLeadDays: number; allowedEmailDomains: string[];
    employeeNoPreview: string; rehireKeepEmployeeNo: boolean; companyHrdfRegistered: boolean };
};

// ===========================================================================
// FUNCTION REGISTER (exact names and signatures — implementations must match)
// ===========================================================================
// Shared types from './common': ActionResult, Paged, CsvFile, UploadIntent. All actions take a plain
// object or FormData. fieldErrors keys are dotted input paths ('identity.mykad', 'contacts.0.priority').
//
// QUERIES — src/server/queries/employees.ts (server-only; requireUser([...]) → withUserTx)
//   listEmployees(p: EmployeeListParams): Promise<Paged<EmployeeRow>>                               [ADM, SA]
//   getEmployeeProfile(employeeNo: string): Promise<EmployeeProfile | null>                         [ADM, SA]  (external ADM: record open logged)
//   getEmployeeSensitive(employeeId: string): Promise<SensitiveView | null>                         [ADM, SA]  (logged view_sensitive; own → no log)
//   getEmployeeFormOptions(): Promise<EmployeeFormOptions>                                          [ADM, SA]
//   listEmployeeOptions(i: EmployeeOptionsInput): Promise<EmployeeOption[]>                        [ADM, SA]
//   getJobChangeContext(employeeId: string, effectiveDate: string): Promise<JobChangeContext | null>  [ADM, SA]
//   listEmployeeDocuments(p: DocumentListParams): Promise<Paged<EmployeeDocumentRow>>               [ADM, SA]
//   listHrNotes(employeeId: string): Promise<HrNote[]>                                              [ADM, SA]
//   listEmployeeActivity(p: ActivityParams): Promise<Paged<ActivityRow>>                            [ADM, SA]  (view 'events')
//   listEmployeeFieldChanges(p: ActivityParams): Promise<Paged<FieldChangeRow>>                     [ADM, SA]  (view 'fields'; masked)
//   listChangeRequests(p: ChangeRequestListParams): Promise<Paged<ChangeRequestRow>>                [ADM, SA]
//   getChangeRequest(crNo: string): Promise<ChangeRequestDetail | null>                             [ADM, SA]
//   getMyProfile(): Promise<MyProfile | null>                                                       [EMP, MGR, ADM, SA]  (null = no employee record)
//   listMyChangeRequests(p: ChangeRequestListParams): Promise<Paged<ChangeRequestRow>>              [EMP, MGR, ADM, SA]
//   getMyChangeRequest(crNo: string): Promise<ChangeRequestDetail | null>                           [EMP, MGR, ADM, SA]
//   listMyDocuments(p: MyDocumentListParams): Promise<Paged<MyDocumentRow>>                         [EMP, MGR, ADM, SA]
//   listMyTeam(p: MyTeamParams): Promise<Paged<TeamRow>>                                            [MGR (+ ADM/SA who manage)]
//   getTeamMemberProfile(employeeNo: string): Promise<TeamMemberProfile | null>                     [MGR] (non-reportee → null, attempt logged)
//   listDirectory(p: DirectoryParams): Promise<Paged<DirectoryRow>>                                 [EMP, MGR, ADM, SA]
//   getDirectoryFilterOptions(): Promise<DirectoryFilterOptions>                                    [EMP, MGR, ADM, SA]
//   getOrgChart(): Promise<OrgChart>                                                                [EMP, MGR, ADM, SA]
//   getSeparationPreview(i: SeparationPreviewInput): Promise<SeparationPreview | null>              [ADM, SA]
//   getChangeRequestFormOptions(): Promise<ChangeRequestFormOptions>                                [EMP, MGR, ADM, SA]  (Q-F2)
//
// SERVER ACTIONS — src/server/actions/employees.ts ('use server')
//   E1  exportEmployeesCsv(p: EmployeeListParams): Promise<ActionResult<CsvFile>>                   [ADM, SA] (no NRIC/bank/religion/OKU/family; logged)
//   E2  checkMykadAction(i: CheckMykadInput): Promise<ActionResult<CheckMykadResult>>               [ADM, SA]
//       createEmployee(i: CreateEmployeeInput): Promise<ActionResult<CreateEmployeeResult>>          [ADM, SA]
//   E4  updatePersonal(i: UpdatePersonalInput): Promise<ActionResult>                               [ADM, SA]
//       updateMykad(i: UpdateMykadInput): Promise<ActionResult>                                     [ADM, SA] (not own)
//       updateSensitive(i: UpdateSensitiveInput): Promise<ActionResult>                             [ADM, SA] (not own)
//       changeEmployeeNo(i: ChangeEmployeeNoInput): Promise<ActionResult>                           [SA]
//       updateContact(i: UpdateContactInput): Promise<ActionResult>                                 [ADM, SA]
//       saveEmergencyContacts(i: SaveEmergencyContactsInput): Promise<ActionResult>                 [ADM, SA]
//       setEmployeePhoto(i: SetPhotoInput): Promise<ActionResult>                                   [EMP (own), ADM, SA]
//       saveSpouse(i: SaveSpouseInput): Promise<ActionResult<{ id: string }>>                       [ADM, SA] (not own)
//       saveChild(i: SaveChildInput): Promise<ActionResult<{ id: string }>>                         [ADM, SA] (not own)
//       setChildActive(i: SetChildActiveInput): Promise<ActionResult>                               [ADM, SA] (not own)
//       saveChildCounts(i: SaveChildCountsInput): Promise<ActionResult>                             [ADM, SA] (not own)
//       updateEmployment(i: UpdateEmploymentInput): Promise<ActionResult>                           [ADM, SA]
//   E5  addJobChange(i: AddJobChangeInput): Promise<ActionResult<{ id: string; scheduled: boolean }>>  [ADM, SA]
//       updateJobChange(i: UpdateJobChangeInput): Promise<ActionResult<{ id: string }>>             [ADM, SA]
//       deleteJobChange(i: DeleteJobChangeInput): Promise<ActionResult>                             [ADM, SA] (future rows)
//       exportJobHistoryCsv(i: EmployeeIdInput): Promise<ActionResult<CsvFile>>                     [ADM, SA]
//   E6  confirmEmployee(i: ConfirmEmployeeInput): Promise<ActionResult<{ status: EmploymentStatus }>>  [ADM, SA] (not own)
//       extendProbation(i: ExtendProbationInput): Promise<ActionResult>                             [ADM, SA] (not own)
//   E7  recordSeparation(i: RecordSeparationInput): Promise<ActionResult<{ separationId: string; status: EmploymentStatus }>>  [ADM, SA] (not own)
//       updateSeparation(i: UpdateSeparationInput): Promise<ActionResult<{ status: EmploymentStatus }>>  [ADM, SA] (not own)
//   E8  withdrawResignation(i: WithdrawResignationInput): Promise<ActionResult<{ status: EmploymentStatus }>>  [ADM, SA] (before LWD)
//       withdrawOffer(i: WithdrawOfferInput): Promise<ActionResult>                                 [ADM, SA] (Pending Join only)
//   E9  rehireEmployee(i: RehireEmployeeInput): Promise<ActionResult<{ employeeNo: string; status: EmploymentStatus; invite: CreateEmployeeResult['invite'] }>>  [ADM, SA]
//   E6/H saveStatutory(i: SaveStatutoryInput): Promise<ActionResult<{ warnings: string[] }>>        [ADM, SA] (not own)
//   E17 saveBankDetails(i: SaveBankDetailsInput): Promise<ActionResult<SaveBankDetailsResult>>      [ADM, SA] (not own; N-41)
//   E10 revealEmployeeValue(i: RevealEmployeeValueInput): Promise<ActionResult<RevealResult>>       [ADM, SA] (logged; ADM reason)
//       revealMyValue(i: RevealMyValueInput): Promise<ActionResult<RevealResult>>                   [EMP, MGR, ADM, SA] (own; logged)
//   E11 requestEmployeeFileUpload(i: RequestEmployeeFileUploadInput): Promise<ActionResult<UploadIntent>>  [EMP (own photo), ADM, SA]
//       confirmEmployeeFileUpload(i: FileIdInput): Promise<ActionResult<{ fileId: string }>>        [EMP, MGR, ADM, SA]
//       createDocument(i: CreateDocumentInput): Promise<ActionResult<{ id: string }>>               [ADM, SA] (not own)
//       updateDocument(i: UpdateDocumentInput): Promise<ActionResult<{ id: string }>>               [ADM, SA]
//       setDocumentActive(i: SetDocumentActiveInput): Promise<ActionResult>                         [ADM, SA]
//       getDocumentDownloadUrl(i: DocumentIdInput): Promise<ActionResult<{ url: string; fileName: string }>>  [EMP (visible own), ADM, SA] (logged)
//       getEmployeeFileUrl(i: { employeeId, fileId }): Promise<ActionResult<{ url: string; fileName: string }>>  [ADM, SA] (bank proof / job ref doc; logged)
//       exportEmployeeDocumentsCsv(p: DocumentListParams): Promise<ActionResult<CsvFile>>           [ADM, SA]
//   E16 createHrNote(i: CreateHrNoteInput): Promise<ActionResult<{ id: string }>>                   [ADM, SA]
//       updateHrNote(i: UpdateHrNoteInput): Promise<ActionResult>                                   [ADM, SA]
//   L2  savePriorEmployment(i: SavePriorEmploymentInput): Promise<ActionResult<{ id: string }>>     [EMP (own), ADM, SA]
//       deletePriorEmployment(i: { id }): Promise<ActionResult>                                     [EMP (own), ADM, SA]
//   E12 exportChangeRequestsCsv(p: ChangeRequestListParams): Promise<ActionResult<CsvFile>>         [ADM, SA]
//   E13 decideChangeRequest(i: DecideChangeRequestInput): Promise<ActionResult<DecideChangeRequestResult>>  [ADM, SA] (not own; N-42; bank → N-41)
//       revealChangeRequestValue(i: RevealChangeRequestValueInput): Promise<ActionResult<RevealResult>>  [ADM, SA (logged); EMP own while submitted]
//       getChangeRequestFileUrl(i: ChangeRequestFileInput): Promise<ActionResult<{ url: string; fileName: string }>>  [ADM, SA; EMP own while submitted] (logged)
//   P17 requestChangeRequestUpload(i: RequestChangeRequestUploadInput): Promise<ActionResult<UploadIntent>>  [EMP, MGR, ADM, SA] (own)
//       confirmChangeRequestUpload(i: FileIdInput): Promise<ActionResult<{ fileId: string }>>       [EMP, MGR, ADM, SA]
//       submitChangeRequest(i: SubmitChangeRequestInput): Promise<ActionResult<SubmitChangeRequestResult>>  [EMP, MGR, ADM, SA] (own; N-43)
//   P18 cancelChangeRequest(i: ChangeRequestIdInput): Promise<ActionResult>                         [EMP, MGR, ADM, SA] (own, Submitted)
//       exportMyChangeRequestsCsv(p: ChangeRequestListParams): Promise<ActionResult<CsvFile>>       [EMP, MGR, ADM, SA]
//   P16 updateMyPersonal(i: UpdateMyPersonalInput): Promise<ActionResult>                           [EMP, MGR, ADM, SA] (N-40)
//       updateMyContact(i: UpdateMyContactInput): Promise<ActionResult>                             [EMP, MGR, ADM, SA] (N-40)
//       saveMyEmergencyContacts(i: SaveMyEmergencyContactsInput): Promise<ActionResult>             [EMP, MGR, ADM, SA] (N-40)
//       updateMySpousePhone(i: UpdateMySpousePhoneInput): Promise<ActionResult>                     [EMP, MGR, ADM, SA]
//   P19 exportMyDocumentsCsv(p: MyDocumentListParams): Promise<ActionResult<CsvFile>>               [EMP, MGR, ADM, SA]
//   P31 exportMyTeamCsv(p: MyTeamParams): Promise<ActionResult<CsvFile>>                            [MGR]
//   P33 recordProbationRecommendation(i: ProbationRecommendationInput): Promise<ActionResult<{ id: string }>>  [MGR of the employee]
//   E14 downloadBulkUpdateTemplate(i: BulkTemplateInput): Promise<ActionResult<CsvFile>>            [ADM, SA] (logged export)
//       previewBulkUpdate(i: BulkUpdateInput): Promise<ActionResult<BulkUpdatePreview>>             [ADM, SA]
//       exportBulkUpdateErrorsCsv(i: BulkUpdateInput): Promise<ActionResult<CsvFile>>               [ADM, SA]
//       commitBulkUpdate(i: BulkUpdateInput): Promise<ActionResult<BulkUpdateCommitResult>>         [ADM, SA] (all or none; 0 errors)
//   E15 bulkChangeManager(i: BulkChangeManagerInput): Promise<ActionResult<BulkChangeManagerResult>>  [ADM, SA]
//       bulkSendInvites(i: BulkSendInvitesInput): Promise<ActionResult<BulkSendInvitesResult>>      [ADM, SA]
//       inviteEmployee(i: InviteEmployeeInput): Promise<ActionResult<InviteEmployeeResult>>         [ADM, SA]
//   E3  exportEmployeeActivityCsv(p: ActivityParams): Promise<ActionResult<CsvFile>>                [SA]
//   G10 exportDirectoryCsv(p: DirectoryParams): Promise<ActionResult<CsvFile>>                      [EMP, MGR, ADM, SA] (7 columns only)
//   Q-F1 client-callable wrappers of the queries above (dialogs that update while the user types):
//       searchEmployeeOptions(i: EmployeeOptionsInput): Promise<ActionResult<{ rows: EmployeeOption[] }>>          [ADM, SA]
//       fetchJobChangeContext(i: JobChangeContextInput): Promise<ActionResult<{ context: JobChangeContext | null }>>  [ADM, SA]
//       fetchSeparationPreview(i: SeparationPreviewInput): Promise<ActionResult<{ preview: SeparationPreview | null }>>  [ADM, SA]
//   Q-F2 fetchChangeRequestFormOptions(): Promise<ActionResult<ChangeRequestFormOptions>>            [EMP, MGR, ADM, SA]
//
// Error messages the UI may branch on (ActionFail.error is always a readable sentence):
//   own E→CR field → "Use a change request for your own record." (fieldErrors on the field) ·
//   MyKad duplicate → fieldErrors['identity.mykad'] "MyKad already exists for INT-…" ·
//   reporting loop → fieldErrors.managerId "Reporting line would create a loop." ·
//   one open CR per category → fieldErrors.category · decide own CR → "You can't decide your own request."
