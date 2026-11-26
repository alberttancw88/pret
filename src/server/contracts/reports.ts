// PRET contract — M7 Reports & exports (W2-007).
//   R1 Admin dashboard (/dashboard, F-RPT-01, live) · F-RPT-22 Manager dashboard (Home manager panel) · Employees-list KPI strip
//   R2 Reports catalogue (/reports) · R3 Report viewer template (/reports/{reportId}) used by EVERY report (F-RPT-02…20, F-RPT-27)
//   R4 report specifications (REPORT_CATALOGUE + per-report params below) · P7 Leave report by individual (/reports/leave-individual)
//   R5 Monthly payroll-input pack (/reports/payroll-input, F-RPT-21 — Kakitangan payroll until R1.1; NO claims sheet, D16)
// Types + zod only (client-safe — no database or server code). Implementations:
//   queries → src/server/queries/reports.ts (server-only)   actions → src/server/actions/reports.ts ('use server')
//
// Rules (PRD §11, wireframes-reports R3, rls-policies §8):
//   * Roles are enforced three times: the page (requireUser), every query / action (REPORT_CATALOGUE[id].roles) and RLS.
//   * MGR sees only Probation due, Leave balances, Who's on leave and Leave report by individual — scope forced to the
//     manager's team (direct + indirect reportees); `meta.scope = 'team'` and the filter shows "My team" 🔒. Managers never
//     get NRIC, bank, family, religion or medical columns; Sick / Hospitalisation / Maternity types show as "Medical".
//   * EMP sees only the Leave report by individual, fixed to self.
//   * Every export (CSV / .xlsx / PDF) is written to audit.access_log; sensitive reports (Employee master with a sensitive
//     column group, Sick & hospitalisation, Payroll-input pack) also log every on-screen view (BR-ADM-21).
//   * One generic result shape (ReportResult) for every report: the viewer renders `columns` + `rows`; totals are computed over
//     the WHOLE filtered set (not the page) and reconcile with the module screens to the sen / ½ day (same queries reused:
//     claims list, leave applications list, leave_balance_view, employee completeness).
//   * Dates 'yyyy-mm-dd', instants ISO-8601, money strings "1234.56" (format 'money' → "RM 1,234.56"), days strings "8.5".
import { z } from 'zod';
import { booleanSchema, isoDateSchema, multi, uuidSchema, type MyState } from './common';

export * from './common';

/** Same role codes as src/server/auth/current-user.ts (client-safe copy). */
export type Role = 'SA' | 'ADM' | 'MGR' | 'EMP';
const labels = <T extends string>(m: Record<T, string>) => m;
const optDate = isoDateSchema.optional().catch(undefined);
const monthSchema = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Select a month.');

// ===========================================================================
// Catalogue (R2)
// ===========================================================================
export const REPORT_GROUPS = ['people', 'leave', 'claims', 'payroll_handover'] as const;
export type ReportGroup = (typeof REPORT_GROUPS)[number];
export const REPORT_GROUP_LABELS = labels<ReportGroup>({ people: 'People', leave: 'Leave', claims: 'Claims', payroll_handover: 'Payroll handover' });

export const REPORT_IDS = [
  'employee-master', 'headcount', 'joiners-leavers', 'probation-due', 'retirement-milestones', 'data-completeness',
  'leave-balances', 'leave-transactions', 'leave-summary', 'whos-on-leave', 'unpaid-leave', 'sick-hospitalisation', 'replacement-leave',
  'carry-forward', 'leave-individual',
  'claims-detail', 'claims-summary', 'approved-not-disbursed', 'disbursement-batches', 'claims-tax-treatment',
] as const;
export type ReportId = (typeof REPORT_IDS)[number];
export const reportIdSchema = z.enum(REPORT_IDS, { error: 'Unknown report.' });

export type ReportDef = {
  id: ReportId;
  screenId: string;                 // S-RP-xx
  functionId: string;               // F-RPT-xx
  name: string;
  description: string;
  group: ReportGroup;
  roles: Role[];
  /** MGR may open it — scope forced to the team */
  managerTeam: boolean;
  /** 🔒 badge: view and export access-logged (always for 'sick-hospitalisation'; employee-master only with sensitive groups) */
  sensitive: 'always' | 'when_sensitive_columns' | 'no';
  /** heavy reports show no data until SEARCH (R3) */
  loadsOnSearch: boolean;
  path: string;
};
const ADM_SA: Role[] = ['ADM', 'SA'];
const TEAM: Role[] = ['MGR', 'ADM', 'SA'];
const def = (d: Omit<ReportDef, 'path'>): ReportDef => ({ ...d, path: `/reports/${d.id}` });
export const REPORT_CATALOGUE: Record<ReportId, ReportDef> = {
  'employee-master': def({ id: 'employee-master', screenId: 'S-RP-04', functionId: 'F-RPT-02', name: 'Employee master', description: 'Choose any employee fields you may view; sensitive groups are logged.', group: 'people', roles: ADM_SA, managerTeam: false, sensitive: 'when_sensitive_columns', loadsOnSearch: true }),
  headcount: def({ id: 'headcount', screenId: 'S-RP-05', functionId: 'F-RPT-03', name: 'Headcount', description: 'Headcount, joiners and leavers by department, location, grade, status or gender; monthly trend.', group: 'people', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'joiners-leavers': def({ id: 'joiners-leavers', screenId: 'S-RP-06', functionId: 'F-RPT-04', name: 'Joiners & leavers', description: 'Joiners and leavers in a period, separation reasons and turnover rate.', group: 'people', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'probation-due': def({ id: 'probation-due', screenId: 'S-RP-07', functionId: 'F-RPT-05', name: 'Probation due', description: 'Probation ending soon and overdue confirmations.', group: 'people', roles: TEAM, managerTeam: true, sensitive: 'no', loadsOnSearch: false }),
  'retirement-milestones': def({ id: 'retirement-milestones', screenId: 'S-RP-08', functionId: 'F-RPT-06', name: 'Retirement & service milestones', description: 'Employees approaching age 60 and upcoming service-band changes.', group: 'people', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'data-completeness': def({ id: 'data-completeness', screenId: 'S-RP-09', functionId: 'F-RPT-07', name: 'Data completeness', description: 'Missing mandatory, statutory, PCB and bank fields per employee (payroll readiness).', group: 'people', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'leave-balances': def({ id: 'leave-balances', screenId: 'S-RP-10', functionId: 'F-RPT-08', name: 'Leave balances', description: 'Balances per employee and leave type as at a date, by department.', group: 'leave', roles: TEAM, managerTeam: true, sensitive: 'no', loadsOnSearch: true }),
  'leave-transactions': def({ id: 'leave-transactions', screenId: 'S-RP-11', functionId: 'F-RPT-09', name: 'Leave transactions', description: 'All leave applications in a period with status and approvers.', group: 'leave', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'leave-summary': def({ id: 'leave-summary', screenId: 'S-RP-12', functionId: 'F-RPT-10', name: 'Leave summary', description: 'Days taken by department and leave type, per month.', group: 'leave', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'whos-on-leave': def({ id: 'whos-on-leave', screenId: 'S-RP-13', functionId: 'F-RPT-11', name: "Who's on leave", description: 'Employees on approved leave for a date or range.', group: 'leave', roles: TEAM, managerTeam: true, sensitive: 'no', loadsOnSearch: false }),
  'unpaid-leave': def({ id: 'unpaid-leave', screenId: 'S-RP-14', functionId: 'F-RPT-12', name: 'Unpaid leave', description: 'Unpaid leave days per employee for a month (payroll input).', group: 'leave', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'sick-hospitalisation': def({ id: 'sick-hospitalisation', screenId: 'S-RP-15', functionId: 'F-RPT-13', name: 'Sick & hospitalisation', description: 'Sick and hospitalisation utilisation against entitlement and the 60-day pool.', group: 'leave', roles: ADM_SA, managerTeam: false, sensitive: 'always', loadsOnSearch: false }),
  'replacement-leave': def({ id: 'replacement-leave', screenId: 'S-RP-16', functionId: 'F-RPT-14', name: 'Replacement leave', description: 'Replacement credits earned, used, expiring and expired.', group: 'leave', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'carry-forward': def({ id: 'carry-forward', screenId: 'S-RP-17', functionId: 'F-RPT-15', name: 'Year-end carry-forward & forfeiture', description: 'Closing balance, carried, forfeited and carry-forward use per employee.', group: 'leave', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'leave-individual': def({ id: 'leave-individual', screenId: 'S-RP-24', functionId: 'F-RPT-27', name: 'Leave report by individual', description: "One employee's balances and applications for a year — printable.", group: 'leave', roles: ['EMP', 'MGR', 'ADM', 'SA'], managerTeam: true, sensitive: 'no', loadsOnSearch: false }),
  'claims-detail': def({ id: 'claims-detail', screenId: 'S-RP-18', functionId: 'F-RPT-16', name: 'Claims detail', description: 'Every claim line in a period with status, category and amounts.', group: 'claims', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'claims-summary': def({ id: 'claims-summary', screenId: 'S-RP-19', functionId: 'F-RPT-17', name: 'Claims summary & limit utilisation', description: 'Totals by category, department and month; usage against limits.', group: 'claims', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'approved-not-disbursed': def({ id: 'approved-not-disbursed', screenId: 'S-RP-20', functionId: 'F-RPT-18', name: 'Approved not disbursed', description: 'Approved claims not yet paid, with ageing.', group: 'claims', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'disbursement-batches': def({ id: 'disbursement-batches', screenId: 'S-RP-21', functionId: 'F-RPT-19', name: 'Disbursement batches', description: 'Month-end batches with totals, status and payment references.', group: 'claims', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
  'claims-tax-treatment': def({ id: 'claims-tax-treatment', screenId: 'S-RP-22', functionId: 'F-RPT-20', name: 'Claims by tax treatment', description: 'Disbursed claims per employee and tax treatment for the year (EA-form preparation).', group: 'claims', roles: ADM_SA, managerTeam: false, sensitive: 'no', loadsOnSearch: false }),
};
/** The payroll-input pack is listed in the catalogue (group payroll_handover) but uses its own screen (R5). */
export const PAYROLL_INPUT_CARD = {
  id: 'payroll-input', screenId: 'S-RP-23', functionId: 'F-RPT-21', name: 'Monthly payroll-input pack',
  description: 'Joiners, leavers, job, bank and statutory changes, unpaid leave and rest-day work for the Kakitangan payroll. No claims sheet (D16).',
  group: 'payroll_handover' as ReportGroup, roles: ADM_SA, sensitive: 'always' as const, path: '/reports/payroll-input',
};

export type ReportCatalogueCard = {
  id: ReportId | 'payroll-input'; screenId: string; functionId: string; name: string; description: string; group: ReportGroup;
  sensitive: boolean; path: string; teamScope: boolean;
};
export type ReportCatalogue = { groups: { group: ReportGroup; label: string; cards: ReportCatalogueCard[] }[] };

// ===========================================================================
// Generic result (R3 viewer)
// ===========================================================================
export const REPORT_FORMATS = ['text', 'date', 'datetime', 'int', 'days', 'money', 'percent', 'bool', 'list'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export type ReportColumn = {
  key: string;
  label: string;
  format: ReportFormat;
  /** header group (e.g. leave type name over Entitled/CF/… in Leave balances) */
  group?: string;
  sortable: boolean;
  /** column carries a sensitive value (access-logged) */
  sensitive?: boolean;
};
export type ReportCell = string | number | boolean | null | string[];
export type ReportRow = {
  id: string;
  cells: Record<string, ReportCell>;
  /** drill-in link for the row's "›" (relative path) */
  href: string | null;
  /** grouping label (e.g. department) — rows arrive sorted by group when grouped */
  group?: string | null;
  /** subtotal / total rows (rendered bold, never paginated away: they are added after paging) */
  kind?: 'row' | 'subtotal' | 'total';
  /** e.g. "Reversal" in payroll-input sheets */
  badge?: string | null;
};
export type ReportSummaryItem = { label: string; value: string; format: ReportFormat };
export type ReportTable = { key: string; title: string; columns: ReportColumn[]; rows: ReportRow[] };
export type ReportMeta = {
  generatedAt: string;            // ISO
  generatedBy: string;            // display name — footer "Generated dd/mm/yyyy HH:mm by {name} · as at {date}"
  asAt: string | null;            // yyyy-mm-dd
  scope: 'all' | 'team' | 'own';
  sensitive: boolean;             // 🔒 banner "Sensitive — access is logged"
  /** this on-screen view was written to audit.access_log */
  viewLogged: boolean;
  notes: string[];
};
export type ReportResult = {
  reportId: ReportId;
  title: string;
  /** false → heavy report not yet searched: no rows, show "Set the filters and press SEARCH" */
  searched: boolean;
  columns: ReportColumn[];
  rows: ReportRow[];
  total: number;
  page: number;
  pageSize: number;
  /** totals over the whole filtered set */
  summary: ReportSummaryItem[];
  /** extra tables: headcount trend, claims summary tab B (utilisation), leave-individual applications, leave-summary per month */
  tables: ReportTable[];
  meta: ReportMeta;
};

// ===========================================================================
// Parameters (one schema per report; every one accepts q / page / pageSize / sort / dir)
// ===========================================================================
const base = z.object({
  q: z.preprocess((v) => (typeof v === 'string' ? v.trim() : undefined), z.string().max(100).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** a column key of the result (unknown keys fall back to the report's default order) */
  sort: z.string().trim().max(60).optional().catch(undefined),
  dir: z.enum(['asc', 'desc']).default('asc'),
  /** heavy reports: true when the user pressed SEARCH */
  run: booleanSchema.default(false),
});
const deptLoc = { departmentIds: multi(uuidSchema), locationIds: multi(uuidSchema) };
export const EMPLOYMENT_STATUS_FILTER = ['active', 'separated', 'all'] as const;

// ---- S-RP-04 Employee master: column chooser -------------------------------------------------------
export const EMPLOYEE_FIELD_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'] as const;
export type EmployeeFieldGroup = (typeof EMPLOYEE_FIELD_GROUPS)[number];
export const EMPLOYEE_FIELD_GROUP_LABELS = labels<EmployeeFieldGroup>({
  A: 'Identity & personal', B: 'Contact & address', C: 'Emergency contact', D: 'Spouse', E: 'Children', F: 'Employment', G: 'Separation',
  H: 'Statutory & payroll deductions', I: 'Bank & payment',
});
/** Sensitive groups ticked separately with 🔒 "logged" (R4 S-RP-04). */
export const SENSITIVE_FIELD_CATEGORIES = ['mykad', 'religion', 'oku', 'family', 'bank', 'statutory'] as const;
export type SensitiveFieldCategory = (typeof SENSITIVE_FIELD_CATEGORIES)[number];
export const SENSITIVE_FIELD_CATEGORY_LABELS = labels<SensitiveFieldCategory>({
  mykad: 'MyKad / passport', religion: 'Religion', oku: 'OKU (disability)', family: 'Family (spouse, children, emergency contact)', bank: 'Bank details', statutory: 'Statutory numbers',
});
export type EmployeeFieldDef = { key: string; id: string; label: string; group: EmployeeFieldGroup; format: ReportFormat; sensitive: SensitiveFieldCategory | null };
const f = (key: string, id: string, label: string, group: EmployeeFieldGroup, format: ReportFormat = 'text', sensitive: SensitiveFieldCategory | null = null): EmployeeFieldDef =>
  ({ key, id, label, group, format, sensitive });
export const EMPLOYEE_MASTER_FIELDS: EmployeeFieldDef[] = [
  f('employeeNo', 'A1', 'Employee no.', 'A'), f('fullName', 'A2', 'Full name', 'A'), f('preferredName', 'A3', 'Preferred name', 'A'),
  f('mykad', 'A4', 'MyKad no.', 'A', 'text', 'mykad'), f('dateOfBirth', 'A5', 'Date of birth', 'A', 'date'), f('age', 'A6', 'Age', 'A', 'int'),
  f('gender', 'A7', 'Gender', 'A'), f('nationality', 'A8', 'Nationality', 'A'), f('race', 'A9', 'Race', 'A'),
  f('religion', 'A11', 'Religion', 'A', 'text', 'religion'), f('maritalStatus', 'A12', 'Marital status', 'A'),
  f('isOku', 'A14', 'OKU', 'A', 'bool', 'oku'), f('passportNo', 'A17', 'Passport no.', 'A', 'text', 'mykad'), f('passportExpiry', 'A18', 'Passport expiry', 'A', 'date'),
  f('qualification', 'A19', 'Highest qualification', 'A'),
  f('workEmail', 'B1', 'Work email', 'B'), f('personalEmail', 'B2', 'Personal email', 'B'), f('mobilePhone', 'B3', 'Mobile phone', 'B'),
  f('workPhone', 'B4', 'Work phone', 'B'), f('residentialAddress', 'B5', 'Residential address', 'B'), f('residentialState', 'B9', 'Residential state', 'B'),
  f('emergencyName', 'C2', 'Emergency contact', 'C', 'text', 'family'), f('emergencyRelationship', 'C3', 'Emergency relationship', 'C', 'text', 'family'),
  f('emergencyPhone', 'C4', 'Emergency phone', 'C', 'text', 'family'),
  f('spouseName', 'D1', 'Spouse name', 'D', 'text', 'family'), f('spouseWorking', 'D4', 'Spouse working status', 'D', 'text', 'family'),
  f('childrenCount', 'E10', 'Number of children', 'E', 'int', 'family'),
  f('joinDate', 'F1', 'Join date', 'F', 'date'), f('continuousServiceDate', 'F2', 'Continuous-service date', 'F', 'date'), f('employmentType', 'F3', 'Employment type', 'F'),
  f('probationMonths', 'F4', 'Probation (months)', 'F', 'int'), f('probationEnd', 'F5', 'Probation end', 'F', 'date'), f('extendedProbationEnd', 'F6', 'Extended probation end', 'F', 'date'),
  f('confirmationDate', 'F8', 'Confirmation date', 'F', 'date'), f('status', 'F9', 'Employment status', 'F'), f('department', 'F10', 'Department', 'F'),
  f('position', 'F11', 'Position', 'F'), f('grade', 'F12', 'Grade', 'F'), f('manager', 'F13', 'Reporting manager', 'F'), f('location', 'F17', 'Work location', 'F'),
  f('workState', 'F18', 'Work state', 'F'), f('workingPattern', 'F19', 'Working-week pattern', 'F'), f('costCentre', 'F22', 'Cost centre', 'F'),
  f('lengthOfService', 'F24', 'Length of service', 'F'), f('retirementDate', 'F26', 'Retirement date', 'F', 'date'),
  f('noticeDate', 'G1', 'Notice date', 'G', 'date'), f('separationType', 'G2', 'Separation type', 'G'), f('separationReason', 'G3', 'Separation reason', 'G'),
  f('lastWorkingDay', 'G5', 'Last working day', 'G', 'date'),
  f('payPcb', 'H1', 'Pay PCB', 'H', 'bool'), f('incomeTaxNo', 'H3', 'Income tax no.', 'H', 'text', 'statutory'), f('payEpf', 'H13', 'Pay EPF', 'H', 'bool'),
  f('epfNo', 'H15', 'EPF no.', 'H', 'text', 'statutory'), f('paySocso', 'H19', 'Pay SOCSO', 'H', 'bool'), f('socsoNo', 'H21', 'SOCSO no.', 'H', 'text', 'statutory'),
  f('socsoCategory', 'H22', 'SOCSO category', 'H'), f('payEis', 'H24', 'Pay EIS', 'H', 'bool'),
  f('paymentMethod', 'I1', 'Payment method', 'I'), f('bankName', 'I2', 'Bank', 'I', 'text', 'bank'), f('bankAccountNo', 'I4', 'Bank account no.', 'I', 'text', 'bank'),
  f('accountHolder', 'I5', 'Account holder', 'I', 'text', 'bank'),
];
export const EMPLOYEE_MASTER_FIELD_KEYS = EMPLOYEE_MASTER_FIELDS.map((x) => x.key);
/** Default columns (R4): A1, A2, A3, F10, F11, F12, F13, F17, F1, F9, B1, B3 */
export const EMPLOYEE_MASTER_DEFAULT_COLUMNS = ['employeeNo', 'fullName', 'preferredName', 'department', 'position', 'grade', 'manager', 'location', 'joinDate', 'status', 'workEmail', 'mobilePhone'];

export const employeeMasterParamsSchema = base.extend({
  statuses: multi(z.enum(['pending_join', 'on_probation', 'confirmed', 'notice_period', 'separated'])),
  ...deptLoc,
  joinFrom: optDate, joinTo: optDate,
  asAt: optDate,
  columns: multi(z.string().trim().max(40)),
});
export const HEADCOUNT_GROUP_BY = ['department', 'location', 'grade', 'status', 'gender'] as const;
export type HeadcountGroupBy = (typeof HEADCOUNT_GROUP_BY)[number];
export const HEADCOUNT_GROUP_BY_LABELS = labels<HeadcountGroupBy>({ department: 'Department', location: 'Location', grade: 'Grade', status: 'Status', gender: 'Gender' });
export const headcountParamsSchema = base.extend({
  asAt: optDate,
  groupBy: z.enum(HEADCOUNT_GROUP_BY).default('department'),
  trendFrom: monthSchema.optional().catch(undefined),
  trendTo: monthSchema.optional().catch(undefined),
});
export const joinersLeaversParamsSchema = base.extend({
  from: optDate, to: optDate,
  departmentIds: multi(uuidSchema),
  separationTypes: multi(z.string().trim().max(40)),
  kind: z.enum(['joiners', 'leavers', 'both']).default('both'),
});
export const PROBATION_WINDOWS = [7, 14, 30, 60] as const;
export const probationDueParamsSchema = base.extend({
  withinDays: z.coerce.number().int().refine((n) => (PROBATION_WINDOWS as readonly number[]).includes(n), 'Choose 7, 14, 30 or 60 days.').default(30),
  overdueOnly: booleanSchema.default(false),
  departmentIds: multi(uuidSchema),
});
export const retirementMilestonesParamsSchema = base.extend({
  windowMonths: z.coerce.number().int().min(1).max(36).default(6),
  milestone: z.enum(['all', 'retirement', 'service_band']).default('all'),
});
export const COMPLETENESS_CATEGORIES = ['mandatory', 'statutory', 'pcb', 'bank'] as const;
export type CompletenessCategory = (typeof COMPLETENESS_CATEGORIES)[number];
export const COMPLETENESS_CATEGORY_LABELS = labels<CompletenessCategory>({ mandatory: 'Mandatory', statutory: 'Statutory', pcb: 'PCB inputs', bank: 'Bank' });
export const dataCompletenessParamsSchema = base.extend({
  departmentIds: multi(uuidSchema),
  statuses: multi(z.enum(['pending_join', 'on_probation', 'confirmed', 'notice_period'])),
  missingCategory: z.enum(COMPLETENESS_CATEGORIES).optional().catch(undefined),
  incompleteOnly: booleanSchema.default(false),
});
export const leaveBalancesParamsSchema = base.extend({
  asAt: optDate,
  ...deptLoc,
  leaveTypeIds: multi(uuidSchema),
  employmentStatus: z.enum(EMPLOYMENT_STATUS_FILTER).default('active'),
});
export const leaveTransactionsParamsSchema = base.extend({
  dateBasis: z.enum(['leave', 'applied']).default('leave'),
  from: optDate, to: optDate,
  leaveTypeIds: multi(uuidSchema),
  statuses: multi(z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'cancellation_pending', 'cancelled'])),
  departmentIds: multi(uuidSchema),
  emergencyOnly: booleanSchema.default(false),
  onBehalfOnly: booleanSchema.default(false),
});
export const leaveSummaryParamsSchema = base.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  monthFrom: z.coerce.number().int().min(1).max(12).default(1),
  monthTo: z.coerce.number().int().min(1).max(12).default(12),
});
export const whosOnLeaveParamsSchema = base.extend({ from: optDate, to: optDate, ...deptLoc });
export const unpaidLeaveParamsSchema = base.extend({ month: monthSchema.optional().catch(undefined), departmentIds: multi(uuidSchema) });
export const sickHospitalisationParamsSchema = base.extend({ year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined), departmentIds: multi(uuidSchema) });
export const replacementLeaveParamsSchema = base.extend({
  from: optDate, to: optDate,
  statuses: multi(z.enum(['pending', 'approved', 'rejected', 'withdrawn'])),
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional().catch(undefined),
});
export const carryForwardParamsSchema = base.extend({ year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined) });
export const leaveIndividualParamsSchema = base.extend({
  /** EMP: ignored (always self). MGR: a team member or self. ADM/SA: anyone. Omitted → self. */
  employeeId: uuidSchema.optional().catch(undefined),
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
});
export const CLAIM_DATE_BASES = ['transaction', 'application', 'approval', 'disbursement'] as const;
export const claimsDetailParamsSchema = base.extend({
  dateBasis: z.enum(CLAIM_DATE_BASES).default('transaction'),
  from: optDate, to: optDate,
  categoryIds: multi(uuidSchema),
  statuses: multi(z.enum(['submitted', 'approved', 'disbursed', 'rejected', 'withdrawn', 'cancelled'])),
  departmentIds: multi(uuidSchema),
  batchNo: z.string().trim().max(20).optional().catch(undefined),
});
export const claimsSummaryParamsSchema = base.extend({
  from: optDate, to: optDate,
  departmentIds: multi(uuidSchema),
  categoryIds: multi(uuidSchema),
});
export const approvedNotDisbursedParamsSchema = base.extend({
  asAt: optDate,
  ageOver: z.coerce.number().int().min(0).max(3650).optional().catch(undefined),
});
export const disbursementBatchesParamsSchema = base.extend({
  from: optDate, to: optDate,
  month: monthSchema.optional().catch(undefined),
  statuses: multi(z.enum(['draft', 'pending_approval', 'approved', 'exported', 'disbursed', 'cancelled'])),
});
export const claimsTaxTreatmentParamsSchema = base.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  employeeId: uuidSchema.optional().catch(undefined),
});

export const REPORT_PARAM_SCHEMAS = {
  'employee-master': employeeMasterParamsSchema,
  headcount: headcountParamsSchema,
  'joiners-leavers': joinersLeaversParamsSchema,
  'probation-due': probationDueParamsSchema,
  'retirement-milestones': retirementMilestonesParamsSchema,
  'data-completeness': dataCompletenessParamsSchema,
  'leave-balances': leaveBalancesParamsSchema,
  'leave-transactions': leaveTransactionsParamsSchema,
  'leave-summary': leaveSummaryParamsSchema,
  'whos-on-leave': whosOnLeaveParamsSchema,
  'unpaid-leave': unpaidLeaveParamsSchema,
  'sick-hospitalisation': sickHospitalisationParamsSchema,
  'replacement-leave': replacementLeaveParamsSchema,
  'carry-forward': carryForwardParamsSchema,
  'leave-individual': leaveIndividualParamsSchema,
  'claims-detail': claimsDetailParamsSchema,
  'claims-summary': claimsSummaryParamsSchema,
  'approved-not-disbursed': approvedNotDisbursedParamsSchema,
  'disbursement-batches': disbursementBatchesParamsSchema,
  'claims-tax-treatment': claimsTaxTreatmentParamsSchema,
} as const satisfies Record<ReportId, z.ZodTypeAny>;
export type ReportParams<I extends ReportId> = z.input<(typeof REPORT_PARAM_SCHEMAS)[I]>;
export type AnyReportParams = { [I in ReportId]: ReportParams<I> }[ReportId];

/** Filter drop-downs for the viewer (only the lists the report uses are filled; MGR gets team employees only). */
export type ReportOption = { id: string; label: string };
export type ReportFilterOptions = {
  reportId: ReportId;
  departments: ReportOption[];
  locations: ReportOption[];
  leaveTypes: ReportOption[];
  claimCategories: ReportOption[];
  batches: ReportOption[];                      // id = batch no.
  separationTypes: ReportOption[];
  /** P7 employee picker (EMP: self only, locked; MGR: self + team; ADM/SA: everyone incl. separated) */
  employees: ReportOption[];
  employeeLocked: boolean;
  /** defaults the viewer pre-fills (as-at today, current year, this month …) */
  defaults: Record<string, string | number | boolean | string[]>;
  employeeMasterFields: EmployeeFieldDef[];     // employee-master only (else [])
};

// ===========================================================================
// Exports (F-RPT-24/25): CSV, .xlsx, PDF — same filtered set, columns the user may view, access-logged
// ===========================================================================
export const REPORT_EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];
export const exportReportSchema = z.object({
  reportId: reportIdSchema,
  format: z.enum(REPORT_EXPORT_FORMATS),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type ExportReportInput = z.input<typeof exportReportSchema>;
/** File returned inline by an export action. csv → encoding 'utf8' (BOM included); xlsx / pdf → 'base64'. */
export type ReportDownload = { filename: string; contentType: string; encoding: 'utf8' | 'base64'; content: string; rowCount: number };
/** Safety limit per export (Vercel Hobby function time — D27). */
export const REPORT_EXPORT_ROW_LIMIT = 10_000;

// ===========================================================================
// R1 Admin dashboard (F-RPT-01) — live
// ===========================================================================
export const DASHBOARD_CLAIM_PERIODS = ['this', 'last', 'year'] as const;
export type DashboardClaimPeriod = (typeof DASHBOARD_CLAIM_PERIODS)[number];
export const dashboardParamsSchema = z.object({ claimPeriod: z.enum(DASHBOARD_CLAIM_PERIODS).default('this') });
export type DashboardParams = z.input<typeof dashboardParamsSchema>;
export type DashboardAlert = { code: 'N-49' | 'N-54' | 'N-58' | 'email'; message: string; href: string; tone: 'warning' | 'error' | 'info' };
/** Each tile is null when it failed to load ("Couldn't load — RETRY" without blocking others). */
export type AdminDashboard = {
  asAt: string;                                 // ISO instant
  today: string;                                // yyyy-mm-dd (MYT)
  hr: {
    headcount: number | null;                   // On probation + Confirmed + Notice period → /employees?status=active
    onLeaveToday: number | null;                // → /reports/whos-on-leave
    pendingLeave: number | null;                // all open leave / cancellation / credit tasks
    pendingLeaveAdmin: number | null;           // of which at the Admin level
    probationDue: number | null;                // probation ending ≤ 30 days → /reports/probation-due
    missingPayroll: number | null;              // employees with missing Y / R1.1 fields → /reports/data-completeness
    changeRequests: number | null;              // Submitted → /employees/change-requests
    phYear: number;                             // next year
    phStatus: 'Published' | 'Draft' | 'Not started';
    phPublishBy: string;                        // yyyy-12-31
  };
  alerts: DashboardAlert[];
  claims: {
    period: DashboardClaimPeriod;
    periodFrom: string; periodTo: string;
    /** KPI strip — same numbers as S-CL-01 for that period (counts by status, totals of Submitted+Approved+Disbursed) */
    submitted: number; approvedNotDisbursed: number; disbursed: number; rejected: number;
    exclSst: string; sst: string; total: string;
    awaiting: { count: number; amount: string };                       // all Submitted (any period) → /approvals?tab=claims
    approvedNd: { count: number; amount: string; agedOver30: number }; // all Approved not disbursed → /reports/approved-not-disbursed
    batch: { batchNo: string; href: string; status: string; statusLabel: string; outOfDate: boolean; nextStep: string } | null;
  } | null;
};

// ===========================================================================
// F-RPT-22 Manager dashboard (Home manager panel) and the Employees-list KPI strip (deferred from W2-009)
// ===========================================================================
export type ManagerDashboard = {
  approvalsWaiting: number;        // → /approvals
  teamOnLeaveToday: number;        // → /reports/whos-on-leave (today)
  teamOnLeaveThisWeek: number;     // → /reports/whos-on-leave (Mon–Sun)
  probationDue: number;            // ≤ 30 days → /reports/probation-due
  teamClaimsSubmitted: number;     // → /approvals?tab=claims
  links: { approvals: string; onLeaveToday: string; onLeaveWeek: string; probation: string; claims: string };
};
export type EmployeeKpis = {
  headcount: number;               // active = On probation + Confirmed + Notice period (same as R1)
  onProbation: number;
  noticePeriod: number;
  onLeaveToday: number;
  /** filters the Employees list applies when a tile is clicked */
  links: { headcount: string; onProbation: string; noticePeriod: string; onLeaveToday: string };
};

// ===========================================================================
// R5 Monthly payroll-input pack (F-RPT-21) — ADM/SA, sensitive (bank account full, logged)
// ===========================================================================
export const PAYROLL_INPUT_SHEETS = ['joiners', 'leavers', 'job_changes', 'bank_changes', 'statutory_changes', 'unpaid_leave', 'rest_day_work'] as const;
export type PayrollInputSheet = (typeof PAYROLL_INPUT_SHEETS)[number];
export const PAYROLL_INPUT_SHEET_LABELS = labels<PayrollInputSheet>({
  joiners: 'Joiners', leavers: 'Leavers', job_changes: 'Job changes', bank_changes: 'Bank changes', statutory_changes: 'Statutory-profile changes',
  unpaid_leave: 'Unpaid leave days', rest_day_work: 'Rest-day work paid',
});
export const payrollInputParamsSchema = z.object({
  month: monthSchema.optional().catch(undefined),           // payroll month 'yyyy-mm' (default: current MYT month)
  sheet: z.enum(PAYROLL_INPUT_SHEETS).default('joiners'),   // EXPORT .CSV exports this sheet
});
export type PayrollInputParams = z.input<typeof payrollInputParamsSchema>;
export type PayrollInputTab = ReportTable & { sheet: PayrollInputSheet; count: number };
export type PayrollInputPack = {
  month: string;                   // 'yyyy-mm'
  monthLabel: string;              // "November 2026"
  periodFrom: string; periodTo: string;
  tabs: PayrollInputTab[];
  /** "Last exported dd/mm/yyyy by {name}" */
  lastExport: { at: string; byName: string; version: number } | null;
  /** D16 note always shown */
  noClaimsNote: string;
  retired: { on: string } | null;  // after R1.1 cut-over (always null in R1.0)
  meta: ReportMeta;
};
export const exportPayrollInputSchema = z.object({
  month: monthSchema,
  format: z.enum(['xlsx', 'csv']),
  sheet: z.enum(PAYROLL_INPUT_SHEETS).optional(),
});
export type ExportPayrollInputInput = z.input<typeof exportPayrollInputSchema>;
export const PAYROLL_INPUT_NO_CLAIMS_NOTE = 'No claims sheet — approved claims are paid directly through Hong Leong Bank in the month-end disbursement batch (D16).';

// ===========================================================================
// Small display helpers shared by both sides
// ===========================================================================
export const MEDICAL_LABEL = 'Medical';
export type ReportStateLabel = { code: MyState; label: string };

// ===========================================================================
// FUNCTION REGISTER (exact names and signatures — implementations must match)
// ===========================================================================
// QUERIES — src/server/queries/reports.ts (server-only; requireUser([...]) → withUserTx (RLS))
//   R1  getAdminDashboard(p?: DashboardParams): Promise<AdminDashboard>                       [ADM, SA]
//   F-RPT-22 getManagerDashboard(): Promise<ManagerDashboard | null>                           [MGR] (null when the user has no reportees)
//   E1  getEmployeeKpis(): Promise<EmployeeKpis>                                              [ADM, SA]
//   R2  getReportCatalogue(): Promise<ReportCatalogue>                                        [EMP, MGR, ADM, SA] (cards filtered by role;
//                                                                                               EMP: Leave report by individual only)
//   R3  getReportFilterOptions(reportId: ReportId): Promise<ReportFilterOptions>               [per REPORT_CATALOGUE[id].roles]
//       runReport(reportId: ReportId, params: AnyReportParams): Promise<ReportResult>          [per REPORT_CATALOGUE[id].roles]
//                                                                                               (MGR forced to team; sensitive views logged;
//                                                                                               loadsOnSearch reports return searched:false until run=true)
//   R5  getPayrollInputPack(p: PayrollInputParams): Promise<PayrollInputPack>                 [ADM, SA] (view access-logged: bank, statutory)
//
// SERVER ACTIONS — src/server/actions/reports.ts ('use server')
//   R1  fetchAdminDashboard(p: DashboardParams): Promise<ActionResult<{ dashboard: AdminDashboard }>>      [ADM, SA] (RETRY / claims period toggle)
//   R3  fetchReport(i: { reportId: ReportId; params: AnyReportParams }): Promise<ActionResult<{ result: ReportResult }>>  [per report] (SEARCH / paging)
//       exportReport(i: ExportReportInput): Promise<ActionResult<{ file: ReportDownload }>>  [per report] (CSV / .xlsx / PDF of the WHOLE filtered set;
//                                                                                               audit.access_log 'export' with row count, fields and
//                                                                                               categories of sensitive columns)
//   R5  exportPayrollInputPack(i: ExportPayrollInputInput): Promise<ActionResult<{ file: ReportDownload; lastExport: PayrollInputPack['lastExport'] }>>
//                                                                                               [ADM, SA] (.xlsx all sheets / CSV current sheet; logged;
//                                                                                               records the export version used for later "Reversal" lines)
//
// Errors: ActionFail.error is a readable sentence; invalid filters → fieldErrors keyed by the param name
//         (e.g. 'from' "Enter the date range."). Over REPORT_EXPORT_ROW_LIMIT rows → "Too many rows — narrow the filters."
