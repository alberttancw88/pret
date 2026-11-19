// PRET contract — M5 Organisation & company setup (W2-002). Screens O1–O7, O9–O11.
// Types + zod only (client-safe). Implementations:
//   queries  → src/server/queries/org.ts   (server-only; call from Server Components)
//   actions  → src/server/actions/org.ts   ('use server'; call from client components)
// Roles: every query/action calls requireUser([...]) and runs under RLS (withUserTx).
// O8 reporting lines (F-ORG-11), department head lookup, headcounts and employee-group
// members need employee records → W2-003 (fields are present here and return null / []).
import { z } from 'zod';
import {
  activeFilterSchema, addressSchema, booleanSchema, codeSchema, isoDateSchema, multi, myStateSchema,
  optionalEmailSchema, optionalText, optionalUuidSchema, pageParamsSchema, requiredText, uuidSchema,
  type Address, type MyState, type Stamps,
} from './common';

export * from './common';

// ---------------------------------------------------------------------------
// Enums (data-model §3, Organisation)
// ---------------------------------------------------------------------------
export const DAY_TYPES = ['full', 'half', 'off', 'rest'] as const;
export type DayType = (typeof DAY_TYPES)[number];
export const DAY_TYPE_LABELS: Record<DayType, string> = {
  full: 'Full working day', half: 'Half working day', off: 'Off day', rest: 'Rest day',
};
export const DAY_TYPE_SHORT: Record<DayType, string> = { full: 'F', half: '½', off: 'Off', rest: 'Rest' };

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MONTH_DAY_BASES = ['actual_working_days', 'fixed_26', 'calendar_days'] as const;
export type MonthDayBasis = (typeof MONTH_DAY_BASES)[number];
export const MONTH_DAY_BASIS_LABELS: Record<MonthDayBasis, string> = {
  actual_working_days: 'Actual working days', fixed_26: 'Fixed 26', calendar_days: 'Calendar days',
};

/** 'replacement' rows are system-generated (F-ORG-08) and never entered. */
export const HOLIDAY_TYPES = ['national', 'state', 'replacement', 'company', 'special'] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];
export const ENTERABLE_HOLIDAY_TYPES = ['national', 'state', 'company', 'special'] as const;
export const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = {
  national: 'National gazetted', state: 'State gazetted', replacement: 'Replacement (auto)',
  company: 'Company holiday', special: 'Special declared',
};

export const COMPULSORY_HOLIDAYS = ['national_day', 'agong_birthday', 'ruler_birthday_or_ft_day', 'workers_day', 'malaysia_day'] as const;
export type CompulsoryHoliday = (typeof COMPULSORY_HOLIDAYS)[number];
export const COMPULSORY_HOLIDAY_LABELS: Record<CompulsoryHoliday, string> = {
  national_day: 'National Day', agong_birthday: "Agong's Birthday", ruler_birthday_or_ft_day: "State Ruler's Birthday or FT Day",
  workers_day: "Workers' Day", malaysia_day: 'Malaysia Day',
};

export type CalendarStatus = 'draft' | 'published';

export const GL_PURPOSES = [
  'claims_payable', 'salary_payable', 'epf_payable', 'socso_payable', 'eis_payable', 'pcb_payable',
  'zakat_payable', 'ptptn_payable', 'hrdf_payable', 'bank_clearing',
] as const;
export type GlPurpose = (typeof GL_PURPOSES)[number];
export const GL_PURPOSE_LABELS: Record<GlPurpose, { label: string; release: 'R1.0' | 'R1.1' }> = {
  claims_payable: { label: 'Claims payable', release: 'R1.0' },
  salary_payable: { label: 'Salary payable', release: 'R1.1' },
  epf_payable: { label: 'EPF payable', release: 'R1.1' },
  socso_payable: { label: 'SOCSO payable', release: 'R1.1' },
  eis_payable: { label: 'EIS payable', release: 'R1.1' },
  pcb_payable: { label: 'PCB payable', release: 'R1.1' },
  zakat_payable: { label: 'Zakat payable', release: 'R1.1' },
  ptptn_payable: { label: 'PTPTN payable', release: 'R1.1' },
  hrdf_payable: { label: 'HRDF payable', release: 'R1.1' },
  bank_clearing: { label: 'Bank clearing', release: 'R1.0' },
};

// ===========================================================================
// O1 Company profile (F-ORG-01) — /organisation/company
// ===========================================================================
export type CompanyProfileView = {
  profile: {
    legalName: string;                       // CO1  (SA edit)
    phone: string | null; email: string | null; website: string | null;   // CO5 (ADM+SA edit)
    businessAddress: Address;                // CO4 business (SA edit)
    logoFileId: string | null;               // CO6 (SA edit) — URL via getCompanyLogoUrl()
    version: number;                         // optimistic lock for updateCompanyContact
  } & Stamps;
  /** null when the statutory row has not been entered yet (first save by SA creates it). */
  statutory: ({
    ssmNoNew: string; ssmNoOld: string | null;                      // CO2, CO3
    registeredAddress: Address;                                      // CO4 registered
    epfEmployerNo: string | null; socsoEmployerCode: string | null;  // CO7, CO8 (R1.1)
    lhdnENo: string | null; companyTaxNo: string | null;             // CO9 (R1.1), CO10
    hrdfRegistered: boolean; hrdfLevyRatePct: 1 | 0.5 | null; hrdfMycoid: string | null;  // CO11
    hlbAccountName: string | null;                                   // CO13
    hlbAccountNoMasked: string | null;                               // CO13 '••••4321' — reveal via revealPayingAccount()
    version: number;
  } & Stamps) | null;
  zakatRegistrations: { id: string; zakatBodyId: string; zakatBodyName: string; state: MyState; employerRef: string }[];  // CO12
  signatories: { id: string; name: string; designation: string; signatureFileId: string | null; displayOrder: number; isActive: boolean }[];  // CO14
  /** CO15: one row per GL purpose (glAccountCode null = not mapped). */
  glMappings: { purpose: GlPurpose; label: string; release: 'R1.0' | 'R1.1'; glAccountCode: string | null }[];
  /** UI capability flags (server-computed; enforcement is in actions + RLS). */
  can: { editRegistration: boolean; editStatutory: boolean; editContact: boolean; editGl: boolean; revealAccount: boolean };
};

export type ZakatBodyOption = { id: string; name: string; code: string; state: MyState };

/** Company + Addresses cards (CO1–CO4) — SA. Saves company_profile + company_statutory together. */
export const saveCompanyRegistrationSchema = z.object({
  legalName: requiredText(150, 'Legal name'),
  ssmNoNew: z.string({ error: 'SSM registration no. is required.' }).trim().regex(/^[0-9]{12}$/, 'SSM registration no. (new) must be 12 digits.'),
  ssmNoOld: optionalText(10, 'SSM registration no. (old)'),
  registeredAddress: addressSchema,
  businessAddress: addressSchema,
});
export type SaveCompanyRegistrationInput = z.input<typeof saveCompanyRegistrationSchema>;

/** Contact card (CO5) — ADM + SA. */
export const updateCompanyContactSchema = z.object({
  phone: optionalText(30, 'Phone'),
  email: optionalEmailSchema,
  website: z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v ?? null),
    z.url({ protocol: /^https?$/, error: 'Enter a website starting with http:// or https://' }).max(200).nullable(),
  ),
  version: z.coerce.number().int().min(1),
});
export type UpdateCompanyContactInput = z.input<typeof updateCompanyContactSchema>;

/** Statutory employer numbers card (CO7–CO11) — SA. Requires the registration to exist. */
export const saveCompanyStatutorySchema = z
  .object({
    epfEmployerNo: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null),
      z.string().regex(/^[0-9]{1,9}$/, 'EPF employer no. must be up to 9 digits.').nullable()),
    socsoEmployerCode: optionalText(12, 'SOCSO / EIS employer code'),
    lhdnENo: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toUpperCase() : null),
      z.string().regex(/^E[0-9]{1,10}$/, 'LHDN E-number is "E" followed by digits (max 11 characters).').nullable()),
    companyTaxNo: optionalText(14, 'Company income tax no.'),
    hrdfRegistered: booleanSchema,
    hrdfLevyRatePct: z.preprocess((v) => (v === '' || v === undefined || v === 'na' ? null : Number(v)),
      z.union([z.literal(1), z.literal(0.5)]).nullable()),
    hrdfMycoid: optionalText(30, 'MyCoID'),
  })
  .superRefine((v, ctx) => {
    if (v.hrdfRegistered && v.hrdfLevyRatePct == null)
      ctx.addIssue({ code: 'custom', path: ['hrdfLevyRatePct'], message: 'Select the HRDF levy rate.' });
    if (!v.hrdfRegistered && v.hrdfLevyRatePct != null)
      ctx.addIssue({ code: 'custom', path: ['hrdfLevyRatePct'], message: 'Levy rate applies only when HRDF registered.' });
  });
export type SaveCompanyStatutoryInput = z.input<typeof saveCompanyStatutorySchema>;

/** Paying bank account (CO13) — SA. accountNo blank = keep the stored number. Encrypted (S1). */
export const savePayingAccountSchema = z.object({
  accountName: requiredText(100, 'Account name'),
  accountNo: z.preprocess((v) => (typeof v === 'string' ? v.replace(/[\s-]/g, '') : v ?? ''),
    z.string().regex(/^([0-9]{6,20})?$/, 'Account no. must be 6–20 digits.')),
});
export type SavePayingAccountInput = z.input<typeof savePayingAccountSchema>;

/** Zakat employer registrations (CO12) — SA. Replaces the full set. */
export const saveZakatRegistrationsSchema = z.object({
  rows: z.array(z.object({ zakatBodyId: uuidSchema, employerRef: requiredText(30, 'Employer ref') })).max(16)
    .refine((rows) => new Set(rows.map((r) => r.zakatBodyId)).size === rows.length, 'Each zakat body can appear only once.'),
});
export type SaveZakatRegistrationsInput = z.input<typeof saveZakatRegistrationsSchema>;

/** Signatories (CO14) — SA. Upsert by id; remove = isActive false. */
export const saveSignatoriesSchema = z.object({
  rows: z.array(z.object({
    id: optionalUuidSchema,
    name: requiredText(100, 'Name'),
    designation: requiredText(100, 'Designation'),
    signatureFileId: optionalUuidSchema,
    displayOrder: z.coerce.number().int().min(1).max(99),
    isActive: booleanSchema,
  })).max(10),
});
export type SaveSignatoriesInput = z.input<typeof saveSignatoriesSchema>;

/** AutoCount GL mapping (CO15) — ADM + SA. null/'' code = remove the mapping. */
export const saveGlMappingsSchema = z.object({
  rows: z.array(z.object({
    purpose: z.enum(GL_PURPOSES),
    glAccountCode: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null),
      z.string().max(20, 'GL account code must be at most 20 characters.').nullable()),
  })),
});
export type SaveGlMappingsInput = z.input<typeof saveGlMappingsSchema>;

/** Logo (CO6, SA) and signature images (CO14, SA): PNG or JPEG ≤ 10 MB (SVG not accepted — script risk). */
export const requestCompanyAssetUploadSchema = z.object({
  kind: z.enum(['logo', 'signature']),
  fileName: requiredText(200, 'File name'),
  mimeType: z.enum(['image/png', 'image/jpeg'], { error: 'Upload a PNG or JPEG image.' }),
  sizeBytes: z.coerce.number().int().min(1).max(10 * 1024 * 1024, 'The file must be 10 MB or smaller.'),
});
export type RequestCompanyAssetUploadInput = z.input<typeof requestCompanyAssetUploadSchema>;
export const fileIdSchema = z.object({ fileId: uuidSchema });

// ===========================================================================
// O2 Departments (F-ORG-02) — /organisation/departments
// ===========================================================================
export const departmentListParamsSchema = pageParamsSchema.extend({
  active: activeFilterSchema,
  parentId: optionalUuidSchema.optional(),
  sort: z.enum(['code', 'name', 'parent']).default('code'),
});
export type DepartmentListParams = z.input<typeof departmentListParamsSchema>;
export type DepartmentRow = {
  id: string; code: string; name: string;
  parentId: string | null; parentName: string | null;
  headEmployeeId: string | null; headName: string | null;     // W2-003
  costCentreId: string | null; costCentreName: string | null;
  activeHeadcount: number | null;                               // null until W2-003
  isActive: boolean;
};
export type DepartmentDetail = DepartmentRow & Stamps;

export const departmentInputSchema = z.object({
  code: codeSchema(10),
  name: requiredText(80, 'Name'),
  parentId: optionalUuidSchema,
  /** Head of department — an active employee (W2-003). */
  headEmployeeId: optionalUuidSchema,
  costCentreId: optionalUuidSchema,
  isActive: booleanSchema.default(true),
});
export const updateDepartmentSchema = departmentInputSchema.extend({ id: uuidSchema });
export type DepartmentInput = z.input<typeof departmentInputSchema>;
export type UpdateDepartmentInput = z.input<typeof updateDepartmentSchema>;

/** Generic activate / deactivate for every master (departments, positions, grades, cost centres, groups, locations, patterns). */
export const setActiveSchema = z.object({ id: uuidSchema, isActive: booleanSchema });
export type SetActiveInput = z.input<typeof setActiveSchema>;
export const idSchema = z.object({ id: uuidSchema });

// ===========================================================================
// O3 Positions (F-ORG-03) — /organisation/positions
// ===========================================================================
export const positionListParamsSchema = pageParamsSchema.extend({
  active: activeFilterSchema,
  departmentId: optionalUuidSchema.optional(),
  gradeId: optionalUuidSchema.optional(),
  sort: z.enum(['code', 'title', 'department', 'grade']).default('code'),
});
export type PositionListParams = z.input<typeof positionListParamsSchema>;
export type PositionRow = {
  id: string; code: string; title: string;
  defaultDepartmentId: string | null; defaultDepartmentName: string | null;
  defaultGradeId: string | null; defaultGradeName: string | null;
  headcount: number | null;                                     // null until W2-003
  isActive: boolean;
};
export type PositionDetail = PositionRow & { description: string | null } & Stamps;
export const positionInputSchema = z.object({
  code: codeSchema(10),
  title: requiredText(100, 'Title'),
  defaultDepartmentId: optionalUuidSchema,
  defaultGradeId: optionalUuidSchema,
  description: optionalText(1000, 'Description'),
  isActive: booleanSchema.default(true),
});
export const updatePositionSchema = positionInputSchema.extend({ id: uuidSchema });
export type PositionInput = z.input<typeof positionInputSchema>;
export type UpdatePositionInput = z.input<typeof updatePositionSchema>;

// ===========================================================================
// O4 Grades (F-ORG-04) — /organisation/grades
// ===========================================================================
export const gradeListParamsSchema = pageParamsSchema.extend({
  active: activeFilterSchema,
  sort: z.enum(['code', 'name', 'rank']).default('rank'),
});
export type GradeListParams = z.input<typeof gradeListParamsSchema>;
export type GradeRow = { id: string; code: string; name: string; rank: number; headcount: number | null; isActive: boolean };
export type GradeDetail = GradeRow & Stamps;
export const gradeInputSchema = z.object({
  code: codeSchema(10),
  name: requiredText(80, 'Name'),
  rank: z.coerce.number({ error: 'Rank is required.' }).int('Rank must be a whole number.').min(1, 'Rank must be 1 or more.').max(999),
  isActive: booleanSchema.default(true),
});
export const updateGradeSchema = gradeInputSchema.extend({ id: uuidSchema });
export type GradeInput = z.input<typeof gradeInputSchema>;
export type UpdateGradeInput = z.input<typeof updateGradeSchema>;

// ===========================================================================
// O5 Work locations (F-ORG-05) — /organisation/locations
// ===========================================================================
export const locationListParamsSchema = pageParamsSchema.extend({
  active: activeFilterSchema,
  state: multi(myStateSchema),
  sort: z.enum(['name', 'state', 'pattern']).default('name'),
});
export type LocationListParams = z.input<typeof locationListParamsSchema>;
export type LocationRow = {
  id: string; name: string; state: MyState; city: string;
  defaultPatternId: string; defaultPatternName: string;
  activeEmployees: number | null;                               // null until W2-003
  isActive: boolean;
};
export type LocationDetail = LocationRow & { address: Address } & Stamps;
export const locationInputSchema = z.object({
  name: requiredText(80, 'Location name'),                       // WL1
  address: addressSchema.omit({ state: true }),                  // WL2 (state is WL3)
  state: myStateSchema,                                          // WL3
  defaultPatternId: uuidSchema,                                  // WL4
  isActive: booleanSchema.default(true),                         // WL5
});
export const updateLocationSchema = locationInputSchema.extend({ id: uuidSchema });
export type LocationInput = z.input<typeof locationInputSchema>;
export type UpdateLocationInput = z.input<typeof updateLocationSchema>;
/** updateLocation result: affectedEmployees is the count whose leave is recounted when WL3 changes (0 until W2-003). */
export type UpdateLocationResult = { id: string; stateChanged: boolean; affectedEmployees: number };

// ===========================================================================
// O6 Working-week patterns (F-ORG-06) — /organisation/working-patterns
// ===========================================================================
export type PatternDays = Record<Weekday, DayType>;
export type PatternVersion = {
  id: string; effectiveFrom: string; days: PatternDays;
  hoursPerFullDay: string;                                      // numeric(3,1) as string, e.g. '8.0'
  monthDayBasis: MonthDayBasis;
  isFuture: boolean;                                            // future versions may still be edited
  createdAt: string; createdByName: string | null;
};
export const patternListParamsSchema = pageParamsSchema.extend({
  active: activeFilterSchema,
  sort: z.enum(['name', 'effectiveFrom']).default('name'),
});
export type PatternListParams = z.input<typeof patternListParamsSchema>;
export type WorkingPatternRow = {
  id: string; name: string;
  current: PatternVersion | null;                               // version in force today (else earliest future)
  usedByLocations: number; usedByEmployees: number | null;      // employees: W2-003
  isActive: boolean;
};
export type WorkingPatternDetail = { id: string; name: string; isActive: boolean; versions: PatternVersion[] } & Stamps;

const dayTypeSchema = z.enum(DAY_TYPES, { error: 'Select a day type.' });
export const patternVersionInputSchema = z
  .object({
    effectiveFrom: isoDateSchema,                                // WP5
    mon: dayTypeSchema, tue: dayTypeSchema, wed: dayTypeSchema, thu: dayTypeSchema,
    fri: dayTypeSchema, sat: dayTypeSchema, sun: dayTypeSchema,  // WP2
    hoursPerFullDay: z.coerce.number({ error: 'Hours per full day is required.' }).min(0.5).max(24)
      .refine((n) => Math.round(n * 10) === n * 10, 'Use at most one decimal place.'),   // WP3
    monthDayBasis: z.enum(MONTH_DAY_BASES),                      // WP4
  })
  .refine((v) => WEEKDAYS.some((d) => v[d] === 'rest'), {
    path: ['sun'], message: 'At least one rest day per week is required (EA s59).',
  });
export type PatternVersionInput = z.input<typeof patternVersionInputSchema>;

export const createWorkingPatternSchema = z.object({
  name: requiredText(60, 'Pattern name'),                        // WP1
  isActive: booleanSchema.default(true),                         // WP6
  version: patternVersionInputSchema,
});
export type CreateWorkingPatternInput = z.input<typeof createWorkingPatternSchema>;
export const updateWorkingPatternSchema = z.object({ id: uuidSchema, name: requiredText(60, 'Pattern name'), isActive: booleanSchema });
export type UpdateWorkingPatternInput = z.input<typeof updateWorkingPatternSchema>;
/** Adds a version (or replaces a FUTURE version with the same effective date). Past/current versions are immutable. */
export const addPatternVersionSchema = z.object({ patternId: uuidSchema, version: patternVersionInputSchema });
export type AddPatternVersionInput = z.input<typeof addPatternVersionSchema>;

// ===========================================================================
// O7 Public holidays (F-ORG-07–10) — /organisation/holidays
// ===========================================================================
export const yearSchema = z.coerce.number({ error: 'Select a year.' }).int().min(2000).max(2100);

export const holidayListParamsSchema = pageParamsSchema.extend({
  year: yearSchema,
  states: multi(myStateSchema),
  types: multi(z.enum(HOLIDAY_TYPES)),
  observed: z.enum(['all', 'yes', 'no']).default('all'),
  /** include deactivated holidays (published years keep them as inactive) */
  includeInactive: booleanSchema.default(false),
  sort: z.enum(['date', 'name']).default('date'),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),   // calendar view asks for 500
});
export type HolidayListParams = z.input<typeof holidayListParamsSchema>;

/** One list/calendar row. Replacement rows are per state × working pattern (kind = 'replacement'). */
export type HolidayRow = {
  id: string;
  kind: 'holiday' | 'replacement';
  holidayDate: string;                    // PH2
  dayOfWeek: string;                      // 'Mon'…'Sun'
  name: string;                           // PH3 (replacement: "<source> (replacement)")
  holidayType: HolidayType;               // PH4
  states: MyState[];                      // PH5
  allStates: boolean;
  compulsory: CompulsoryHoliday | null;   // PH6
  isObserved: boolean;                    // PH7
  isHalfDay: boolean;                     // PH8
  remarks: string | null;                 // PH10
  isActive: boolean;
  sourceHolidayId: string | null;         // PH9 (replacement only)
  sourceHolidayName: string | null;
  patternId: string | null;               // replacement only
  patternName: string | null;
};
export type HolidayDetail = HolidayRow & { year: number; yearStatus: CalendarStatus } & Stamps;

export type HolidayStateCheck = {
  state: MyState;
  compulsoryPresent: CompulsoryHoliday[];
  compulsoryMissing: CompulsoryHoliday[];   // non-empty → publish blocked (BR-ORG-20)
  paidHolidayCount: number;                 // < 11 → warning needing acknowledgement
  blocking: boolean;
  warning: boolean;
};
export type HolidayYearSummary = {
  year: number;
  status: CalendarStatus;
  publishedAt: string | null;
  publishedByName: string | null;
  /** Checked states = states of active work locations ("states with active employees" once W2-003 lands). */
  checks: HolidayStateCheck[];
  holidayCount: number;
  canPublish: boolean;
};

const holidayFields = {
  holidayDate: isoDateSchema,                                         // PH2
  name: requiredText(100, 'Name'),                                    // PH3
  holidayType: z.enum(ENTERABLE_HOLIDAY_TYPES, { error: 'Select a type.' }),   // PH4
  states: z.array(myStateSchema).min(1, 'Select at least one state (or All states).'),   // PH5
  compulsory: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.enum(COMPULSORY_HOLIDAYS).nullable()),  // PH6
  isObserved: booleanSchema.default(true),                            // PH7
  isHalfDay: booleanSchema.default(false),                            // PH8
  remarks: optionalText(200, 'Remarks'),                              // PH10
};
export const createHolidaySchema = z
  .object({ year: yearSchema, ...holidayFields })                     // PH1 from the year selector
  .refine((v) => Number(v.holidayDate.slice(0, 4)) === v.year, { path: ['holidayDate'], message: 'The date must be within the selected year.' });
export type CreateHolidayInput = z.input<typeof createHolidaySchema>;
export const updateHolidaySchema = z.object({ id: uuidSchema, ...holidayFields, isActive: booleanSchema.default(true) });
export type UpdateHolidayInput = z.input<typeof updateHolidaySchema>;
/** Result of create/update/deactivate on a PUBLISHED year: leave to recount (0 until the leave module, BR-ORG-23). */
export type HolidayChangeResult = { id: string; yearPublished: boolean; affectedLeaveApplications: number };

export type CopyPreviewItem = {
  id: string; holidayDate: string; name: string; holidayType: HolidayType; states: MyState[];
  /** pre-ticked: fixed-date holiday (e.g. 01/01, 01/02, 01/05, 31/08, 16/09, 25/12) */
  suggested: boolean;
  targetDate: string;              // same day/month in the next year
  alreadyExists: boolean;          // same date + name already in the target year
};
export type CopyToNextYearPreview = { fromYear: number; toYear: number; toYearStatus: CalendarStatus; items: CopyPreviewItem[] };
export const copyHolidaysSchema = z.object({
  fromYear: yearSchema,
  holidayIds: z.array(uuidSchema).min(1, 'Select at least one holiday to copy.'),
});
export type CopyHolidaysInput = z.input<typeof copyHolidaysSchema>;
export type CopyHolidaysResult = { toYear: number; created: number; skipped: number; toEnterFromGazette: { name: string; holidayDate: string }[] };

export const publishHolidayYearSchema = z.object({ year: yearSchema, acknowledgeWarnings: booleanSchema.default(false) });
export type PublishHolidayYearInput = z.input<typeof publishHolidayYearSchema>;
/** On failure with error code PRET-PH-WARN-ACK the UI shows the warnings and re-submits with acknowledgeWarnings = true. */
export type PublishHolidayYearResult = { year: number; warnings: string[] };

// ===========================================================================
// O9 Cost centres (F-ORG-13) — /organisation/cost-centres
// ===========================================================================
export const costCentreListParamsSchema = pageParamsSchema.extend({
  active: activeFilterSchema,
  sort: z.enum(['code', 'name']).default('code'),
});
export type CostCentreListParams = z.input<typeof costCentreListParamsSchema>;
export type CostCentreRow = { id: string; code: string; name: string; autocountCode: string | null; isActive: boolean };
export type CostCentreDetail = CostCentreRow & Stamps;
export const costCentreInputSchema = z.object({
  code: codeSchema(10),
  name: requiredText(80, 'Name'),
  autocountCode: optionalText(30, 'AutoCount code'),
  isActive: booleanSchema.default(true),
});
export const updateCostCentreSchema = costCentreInputSchema.extend({ id: uuidSchema });
export type CostCentreInput = z.input<typeof costCentreInputSchema>;
export type UpdateCostCentreInput = z.input<typeof updateCostCentreSchema>;

// ===========================================================================
// O10 Employee groups (F-ORG-14) — /organisation/groups  (members → W2-003)
// ===========================================================================
export const groupListParamsSchema = pageParamsSchema.extend({
  active: activeFilterSchema,
  sort: z.enum(['name']).default('name'),
});
export type GroupListParams = z.input<typeof groupListParamsSchema>;
export type EmployeeGroupRow = {
  id: string; name: string; description: string | null;
  memberCount: number | null;      // null until W2-003 (employee_group_members)
  usedBy: number | null;           // limits / overrides (leave & claims modules)
  isActive: boolean;
};
export type EmployeeGroupDetail = EmployeeGroupRow & { members: { employeeId: string; name: string; employeeNo: string }[] } & Stamps;
export const employeeGroupInputSchema = z.object({
  name: requiredText(80, 'Name'),
  description: optionalText(500, 'Description'),
  isActive: booleanSchema.default(true),
  /** W2-003: the full member list (replaces membership). Omit to leave members unchanged. */
  memberIds: z.array(uuidSchema).max(500).optional(),
});
export const updateEmployeeGroupSchema = employeeGroupInputSchema.extend({ id: uuidSchema });
export type EmployeeGroupInput = z.input<typeof employeeGroupInputSchema>;
export type UpdateEmployeeGroupInput = z.input<typeof updateEmployeeGroupSchema>;

// ===========================================================================
// O8 Reporting lines (F-ORG-11, US-ORG-009) — /organisation/reporting-lines  [ADM, SA]  (W2-003)
// ===========================================================================
export type ReportingLineNode = {
  employeeId: string; employeeNo: string; name: string; position: string; department: string;
  managerId: string | null; managerSince: string | null;
  status: 'pending_join' | 'on_probation' | 'confirmed' | 'notice_period';
  isTopOfOrg: boolean;
  directCount: number; indirectCount: number;
  /** active approval delegation set by this person (if any) */
  delegation: { delegateName: string; validFrom: string; validTo: string; scope: 'leave' | 'claims' | 'both' } | null;
};
export type ReportingLines = {
  nodes: ReportingLineNode[];
  roots: string[];                         // top of organisation (and anyone without a manager)
  /** N-49: active employees whose manager is Separated / Withdrawn (or missing without Top of organisation) */
  withoutActiveManager: { employeeId: string; employeeNo: string; name: string; managerName: string | null; managerStatus: string | null }[];
};
export const reassignReporteesSchema = z.object({
  fromManagerId: optionalUuidSchema,
  employeeIds: z.array(uuidSchema).min(1, 'Select the reportees to move.').max(500),
  newManagerId: uuidSchema,
  effectiveDate: isoDateSchema,
  remarks: optionalText(500, 'Remarks'),
});
export type ReassignReporteesInput = z.input<typeof reassignReporteesSchema>;
export type ReassignReporteesResult = { moved: number; rows: { employeeId: string; employeeNo: string; ok: boolean; message: string | null }[] };

// ===========================================================================
// Options for selects (one call per form)
// ===========================================================================
export type OrgOption = { id: string; code: string | null; label: string; isActive: boolean };
export type OrgOptions = {
  departments: OrgOption[]; positions: OrgOption[]; grades: OrgOption[]; costCentres: OrgOption[];
  workingPatterns: OrgOption[]; locations: (OrgOption & { state: MyState })[]; employeeGroups: OrgOption[];
  zakatBodies: ZakatBodyOption[];
};

// ===========================================================================
// O11 System settings (F-ORG-12) — /settings. View: ADM + SA. Edit: SA only (control settings).
// Leave / claims / payroll operating settings are their own screens (later work items).
// ===========================================================================
export type SystemSettings = {
  // Employee numbers
  employeeNoPrefix: string; employeeNoPadding: number; employeeNoNext: number;
  // Probation & notice
  defaultProbationMonths: number; maxProbationMonths: number;
  noticeWeeksLt2: number; noticeWeeks2to5: number; noticeWeeksGe5: number;
  inviteLeadDays: number;
  // Sign-in & security
  allowedEmailDomains: string[]; idleTimeoutMinEmployee: number; idleTimeoutMinPrivileged: number;
  lockoutThreshold: number; lockoutMinutes: number; mfaRequiredPrivileged: boolean; inviteLinkHours: number;
  // Approvals
  reminderAfterWorkingDays: number; escalateAfterWorkingDays: number; saBatchApprovalRequired: boolean;
  /** Leave setting (§6.10) — lives in leave_policy, delivered with the leave module; null until then. */
  cancellationApproverLevel1Only: boolean | null;
  // Employment / rehire
  rehireKeepEmployeeNo: boolean; maxTopOfOrg: number;
  // Retention (§10.6)
  retentionYearsHr: number; retentionYearsPayroll: number; retentionYearsAudit: number; retentionDaysImportFiles: number;
  // Notifications
  hrReplyToEmail: string | null; directoryShowBirthdays: boolean;
  updatedAt: string | null; updatedByName: string | null;
  canEdit: boolean;   // SA only
};

const int = (min: number, max: number, label: string) =>
  z.coerce.number({ error: `${label} is required.` }).int(`${label} must be a whole number.`)
    .min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`);

export const saveEmployeeNumberSettingsSchema = z.object({
  employeeNoPrefix: z.string().trim().min(1, 'Prefix is required.').max(10).regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits or - only.'),
  employeeNoPadding: int(1, 8, 'Padding'),
  employeeNoNext: int(1, 99_999_999, 'Next number'),
});
export const saveProbationNoticeSettingsSchema = z
  .object({
    defaultProbationMonths: int(0, 24, 'Default probation'),
    maxProbationMonths: int(1, 24, 'Maximum total probation'),
    noticeWeeksLt2: int(1, 52, 'Notice (< 2 years)'),
    noticeWeeks2to5: int(1, 52, 'Notice (2–5 years)'),
    noticeWeeksGe5: int(1, 52, 'Notice (≥ 5 years)'),
    inviteLeadDays: int(0, 30, 'Invite timing'),
  })
  .refine((v) => v.maxProbationMonths >= v.defaultProbationMonths, { path: ['maxProbationMonths'], message: 'Maximum must be at least the default probation.' })
  .refine((v) => v.noticeWeeksLt2 >= 4 && v.noticeWeeks2to5 >= 6 && v.noticeWeeksGe5 >= 8, { path: ['noticeWeeksLt2'], message: 'Notice periods cannot be below EA s12 (4 / 6 / 8 weeks).' });
export const saveSignInSecuritySettingsSchema = z
  .object({
    allowedEmailDomains: z.array(z.string().trim().toLowerCase().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'Enter a domain such as example.com.'))
      .min(1, 'Add at least one domain.').max(10),
    idleTimeoutMinEmployee: int(5, 120, 'Idle timeout (employees)'),
    idleTimeoutMinPrivileged: int(5, 60, 'Idle timeout (Admin / Super Admin)'),
    lockoutThreshold: int(3, 10, 'Failed attempts'),
    lockoutMinutes: int(5, 1440, 'Lockout minutes'),
    mfaRequiredPrivileged: booleanSchema,
    inviteLinkHours: int(1, 168, 'Invitation link validity'),
  })
  .refine((v) => v.idleTimeoutMinPrivileged <= v.idleTimeoutMinEmployee, { path: ['idleTimeoutMinPrivileged'], message: 'Admin timeout cannot be longer than the employee timeout.' });
export const saveApprovalSettingsSchema = z
  .object({
    reminderAfterWorkingDays: int(1, 30, 'Reminder after'),
    escalateAfterWorkingDays: int(1, 60, 'Escalate after'),
    saBatchApprovalRequired: booleanSchema,
  })
  .refine((v) => v.escalateAfterWorkingDays > v.reminderAfterWorkingDays, { path: ['escalateAfterWorkingDays'], message: 'Escalation must come after the reminder.' });
export const saveEmploymentSettingsSchema = z.object({
  rehireKeepEmployeeNo: booleanSchema,
  maxTopOfOrg: int(1, 5, 'Top of organisation'),
});
export const saveRetentionSettingsSchema = z.object({
  retentionYearsHr: int(7, 20, 'HR records'),
  retentionYearsPayroll: int(7, 20, 'Payroll records'),
  retentionYearsAudit: int(7, 20, 'Audit logs'),
  retentionDaysImportFiles: int(1, 365, 'Import source files'),
});
export const saveNotificationSettingsSchema = z.object({
  hrReplyToEmail: optionalEmailSchema,
  directoryShowBirthdays: booleanSchema,
});
export type SaveEmployeeNumberSettingsInput = z.input<typeof saveEmployeeNumberSettingsSchema>;
export type SaveProbationNoticeSettingsInput = z.input<typeof saveProbationNoticeSettingsSchema>;
export type SaveSignInSecuritySettingsInput = z.input<typeof saveSignInSecuritySettingsSchema>;
export type SaveApprovalSettingsInput = z.input<typeof saveApprovalSettingsSchema>;
export type SaveEmploymentSettingsInput = z.input<typeof saveEmploymentSettingsSchema>;
export type SaveRetentionSettingsInput = z.input<typeof saveRetentionSettingsSchema>;
export type SaveNotificationSettingsInput = z.input<typeof saveNotificationSettingsSchema>;

// ===========================================================================
// FUNCTION REGISTER (exact names and signatures — implementations must match)
// ===========================================================================
// Shared types used below come from './common': ActionResult, Paged, CsvFile, UploadIntent.
//
// QUERIES — src/server/queries/org.ts (server-only; roles in brackets; all throw/redirect via requireUser)
//   getCompanyProfile(): Promise<CompanyProfileView>                                   [EMP, MGR, ADM, SA]*
//       * EMP/MGR get statutory = null, zakat/signatories/gl = [] (RLS); the page itself is ADM/SA.
//   getCompanyLogoUrl(): Promise<string | null>                                        [any signed-in user]
//   listDepartments(p: DepartmentListParams): Promise<Paged<DepartmentRow>>            [ADM, SA]
//   getDepartment(id: string): Promise<DepartmentDetail | null>                        [ADM, SA]
//   listPositions(p: PositionListParams): Promise<Paged<PositionRow>>                  [ADM, SA]
//   getPosition(id: string): Promise<PositionDetail | null>                            [ADM, SA]
//   listGrades(p: GradeListParams): Promise<Paged<GradeRow>>                           [ADM, SA]
//   getGrade(id: string): Promise<GradeDetail | null>                                  [ADM, SA]
//   listLocations(p: LocationListParams): Promise<Paged<LocationRow>>                  [ADM, SA]
//   getLocation(id: string): Promise<LocationDetail | null>                            [ADM, SA]
//   listWorkingPatterns(p: PatternListParams): Promise<Paged<WorkingPatternRow>>       [ADM, SA]
//   getWorkingPattern(id: string): Promise<WorkingPatternDetail | null>                [ADM, SA]
//   listHolidays(p: HolidayListParams): Promise<Paged<HolidayRow>>                     [ADM, SA] (EMP/MGR: published only via RLS)
//   getHoliday(id: string): Promise<HolidayDetail | null>                              [ADM, SA]
//   getHolidayYearSummary(year: number): Promise<HolidayYearSummary>                   [ADM, SA]
//   listHolidayYears(): Promise<{ year: number; status: CalendarStatus }[]>            [ADM, SA]
//   getCopyToNextYearPreview(fromYear: number): Promise<CopyToNextYearPreview>         [ADM, SA]
//   listCostCentres(p: CostCentreListParams): Promise<Paged<CostCentreRow>>            [ADM, SA]
//   getCostCentre(id: string): Promise<CostCentreDetail | null>                        [ADM, SA]
//   listEmployeeGroups(p: GroupListParams): Promise<Paged<EmployeeGroupRow>>           [ADM, SA]
//   getEmployeeGroup(id: string): Promise<EmployeeGroupDetail | null>                  [ADM, SA]
//   getOrgOptions(): Promise<OrgOptions>                                               [ADM, SA]
//   getSystemSettings(): Promise<SystemSettings>                                       [ADM, SA]
//
// SERVER ACTIONS — src/server/actions/org.ts ('use server'; input = plain object or FormData)
//   O1  saveCompanyRegistration(i: SaveCompanyRegistrationInput): Promise<ActionResult>                 [SA]
//       updateCompanyContact(i: UpdateCompanyContactInput): Promise<ActionResult<{ version: number }>> [ADM, SA]
//       saveCompanyStatutory(i: SaveCompanyStatutoryInput): Promise<ActionResult>                       [SA]
//       savePayingAccount(i: SavePayingAccountInput): Promise<ActionResult<{ masked: string | null }>>  [SA]
//       revealPayingAccount(i: { reason?: string }): Promise<ActionResult<{ accountNo: string }>>       [ADM, SA] (logged reveal)
//       saveZakatRegistrations(i: SaveZakatRegistrationsInput): Promise<ActionResult>                   [SA]
//       saveSignatories(i: SaveSignatoriesInput): Promise<ActionResult>                                 [SA]
//       saveGlMappings(i: SaveGlMappingsInput): Promise<ActionResult>                                   [ADM, SA]
//       requestCompanyAssetUpload(i: RequestCompanyAssetUploadInput): Promise<ActionResult<UploadIntent>> [SA]
//       confirmCompanyAssetUpload(i: { fileId }): Promise<ActionResult<{ fileId: string }>>             [SA]
//       setCompanyLogo(i: { fileId }): Promise<ActionResult>   (fileId must be a confirmed upload)     [SA]
//   O2  createDepartment(i: DepartmentInput): Promise<ActionResult<{ id: string }>>                     [ADM, SA]
//       updateDepartment(i: UpdateDepartmentInput): Promise<ActionResult<{ id: string }>>               [ADM, SA]
//       setDepartmentActive(i: SetActiveInput): Promise<ActionResult>                                   [ADM, SA]
//       exportDepartmentsCsv(p: DepartmentListParams): Promise<ActionResult<CsvFile>>                   [ADM, SA]
//   O3  createPosition / updatePosition / setPositionActive / exportPositionsCsv   (same shapes)        [ADM, SA]
//   O4  createGrade / updateGrade / setGradeActive / exportGradesCsv                                    [ADM, SA]
//   O5  createLocation(i): ActionResult<{ id }> / updateLocation(i): ActionResult<UpdateLocationResult>
//       setLocationActive / exportLocationsCsv                                                          [ADM, SA]
//   O6  createWorkingPattern(i: CreateWorkingPatternInput): Promise<ActionResult<{ id: string }>>       [ADM, SA]
//       updateWorkingPattern(i: UpdateWorkingPatternInput): Promise<ActionResult<{ id: string }>>       [ADM, SA]
//       addPatternVersion(i: AddPatternVersionInput): Promise<ActionResult<{ id: string }>>             [ADM, SA]
//       setWorkingPatternActive(i: SetActiveInput) / exportWorkingPatternsCsv(p: PatternListParams)    [ADM, SA]
//   O7  createHoliday(i: CreateHolidayInput): Promise<ActionResult<HolidayChangeResult>>                [ADM, SA]
//       updateHoliday(i: UpdateHolidayInput): Promise<ActionResult<HolidayChangeResult>>                [ADM, SA]
//       deleteHoliday(i: { id }): Promise<ActionResult>   (draft years only)                           [ADM, SA]
//       setHolidayActive(i: SetActiveInput): Promise<ActionResult<HolidayChangeResult>>                 [ADM, SA]
//       copyHolidaysToNextYear(i: CopyHolidaysInput): Promise<ActionResult<CopyHolidaysResult>>         [ADM, SA]
//       publishHolidayYear(i: PublishHolidayYearInput): Promise<ActionResult<PublishHolidayYearResult>> [ADM, SA]
//       exportHolidaysCsv(p: HolidayListParams): Promise<ActionResult<CsvFile>>                         [ADM, SA]
//   O9  createCostCentre / updateCostCentre / setCostCentreActive / exportCostCentresCsv                [ADM, SA]
//   O10 createEmployeeGroup / updateEmployeeGroup / setEmployeeGroupActive / exportEmployeeGroupsCsv    [ADM, SA]
//       (W2-003: memberIds replaces the member list when given; headcounts / head / members now filled)
//   O8  (W2-003) queries/org.ts getReportingLines(): Promise<ReportingLines>                           [ADM, SA]
//       reassignReportees(i: ReassignReporteesInput): Promise<ActionResult<ReassignReporteesResult>>  [ADM, SA] (job-history rows "Manager change")
//       exportReportingLinesCsv(): Promise<ActionResult<CsvFile>>   (Employee · Manager · Since)        [ADM, SA]
//   O11 saveEmployeeNumberSettings(i) / saveProbationNoticeSettings(i) / saveSignInSecuritySettings(i) /
//       saveApprovalSettings(i) / saveEmploymentSettings(i) / saveRetentionSettings(i) /
//       saveNotificationSettings(i): Promise<ActionResult<{ changed: string[] }>>                       [SA]
//
// Error codes the UI may branch on (ActionFail.error is always a readable sentence; fieldErrors keyed by input field):
//   duplicate code/name → fieldErrors.code / .name · parent cycle → fieldErrors.parentId ·
//   publish blocked → error starts with "Publishing is blocked" · warnings to acknowledge → fieldErrors.acknowledgeWarnings
