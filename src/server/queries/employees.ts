import 'server-only';
import { sql, withUserTx, type Tx } from '../db';
import { claimOpenItems, openClaimsFor, teamMemberClaims } from './claims';
import type { CurrentUser, Role } from '../auth/current-user';
import { logDenied, logRecordOpen, writeAccess } from '../audit';
import { fieldCrypto } from '../crypto';
import { signedPhotoUrls } from '../storage';
import { authorize, hasRole, iso, likeTerm, resolveNames, stamps } from '../lib/action-helpers';
import { parseParams, EXPORT_LIMIT } from './org';
import { leaverPositionFor, teamLeaveSummariesTx, teamMemberLeave } from './leave';
import {
  activityParamsSchema, changeRequestListParamsSchema, directoryParamsSchema, documentListParamsSchema, employeeListParamsSchema,
  employeeOptionsSchema, myDocumentListParamsSchema, myTeamParamsSchema, separationPreviewSchema,
  ACTIVE_STATUSES, CR_CATEGORY_LABELS, DOCUMENT_CATEGORY_LABELS, HR_ONLY_DOCUMENT_CATEGORIES, JOB_CHANGE_TYPE_LABELS,
  MY_STATE_LABELS, STUDY_PCB_CATEGORIES,
  ageOn, formatMykad, maskAccount, maskMykad,
  type ActivityEventType, type ActivityParams, type ActivityRow, type Address, type BankAccountView, type ChangeRequestDetail,
  type ChangeRequestFormOptions, type ChangeRequestItemView, type ChangeRequestListParams, type ChangeRequestRow, type ChildCounts, type ChildView, type Completeness,
  type CrCategory, type CrStatus, type DirectoryFilterOptions, type DirectoryParams, type DirectoryRow, type DocumentListParams,
  type EmergencyContactView, type EmployeeDocumentRow, type EmployeeFormOptions, type EmployeeListParams, type EmployeeOption,
  type EmployeeOptionsInput, type EmployeeProfile, type EmployeeRef, type EmployeeRow, type EmploymentStatus, type EmploymentView,
  type FamilyView, type FieldChangeRow, type HrNote, type JobChangeContext, type JobHistoryRow, type LengthOfService,
  type MissingField, type MyDocumentListParams, type MyDocumentRow, type MyProfile, type MyState, type MyTeamParams, type OrgChart,
  type Paged, type PcbCategory, type PersonalView, type PortalAccountState, type ProbationRecommendationView, type Ref,
  type SensitiveView, type SeparationPreview, type SeparationPreviewInput, type SeparationView, type SpouseView, type StatutoryView,
  type TeamMemberProfile, type TeamRow, type UpcomingItem,
} from '../contracts/employees';

// M1 Employee master queries (W2-003). Server-only; every function: requireUser([...]) → withUserTx (RLS).
// Role projections (rls-policies §8): ADM/SA → EmployeeProfile; EMP own → MyProfile; MGR → TeamMemberProfile.
// Sensitive identifiers leave the server only masked, except the owner's own MyKad (P16, by design not logged).

export const EMP_ADMIN: Role[] = ['ADM', 'SA'];
export const ANY_USER: Role[] = ['EMP', 'MGR', 'ADM', 'SA'];
export const TEAM: Role[] = ['MGR', 'ADM', 'SA'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_RE = /^[A-Za-z0-9-]{1,20}$/;
type Where = ReturnType<typeof sql>;
const and = (c: Where[]): Where => (c.length ? sql.join(c, sql` and `) : sql`true`);
const dirOf = (d: 'asc' | 'desc') => sql.raw(d === 'desc' ? 'desc' : 'asc');

// ===========================================================================
// Small helpers (exported for the actions)
// ===========================================================================
export async function todayMyt(tx: Tx): Promise<string> {
  return (await sql<{ d: string }>`select app.today_myt()::text as d`.execute(tx)).rows[0]!.d;
}
export async function currentEmployeeId(tx: Tx): Promise<string | null> {
  return (await sql<{ id: string | null }>`select app.current_employee_id() as id`.execute(tx)).rows[0]?.id ?? null;
}

/** Years / months / days between two plain dates (F24 "4 years 1 month 14 days"). */
export function lengthOfService(from: string, to: string): LengthOfService {
  if (to < from) return { years: 0, months: 0, days: 0 };
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  let years = ty - fy; let months = tm - fm; let days = td - fd;
  if (days < 0) { months -= 1; days += new Date(Date.UTC(ty, tm - 1, 0)).getUTCDate(); }
  if (months < 0) { years -= 1; months += 12; }
  return { years, months, days };
}
export function addDays(d: string, n: number): string {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}
export function addMonths(d: string, n: number): string {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(dd, last));
  return t.toISOString().slice(0, 10);
}
export const displayName = (full: string, preferred: string | null) => (preferred ? `${full} (${preferred})` : full);

/** Names of other employees (directory-level; works for every role). */
export async function employeeRefs(tx: Tx, ids: (string | null | undefined)[]): Promise<Map<string, EmployeeRef & { status: EmploymentStatus }>> {
  const uniq = [...new Set(ids.filter((v): v is string => !!v))];
  const map = new Map<string, EmployeeRef & { status: EmploymentStatus }>();
  if (!uniq.length) return map;
  const r = await sql<{ id: string; employee_no: string; full_name: string; preferred_name: string | null; status: EmploymentStatus }>`
    select id, employee_no, full_name, preferred_name, status from app.employee_names(${uniq}::uuid[])`.execute(tx);
  for (const x of r.rows) map.set(x.id, { id: x.id, employeeNo: x.employee_no, name: x.preferred_name ? `${x.full_name} (${x.preferred_name})` : x.full_name, status: x.status });
  return map;
}
const refOf = (m: Map<string, EmployeeRef>, id: string | null): EmployeeRef | null => {
  if (!id) return null;
  const r = m.get(id);
  return r ? { id: r.id, employeeNo: r.employeeNo, name: r.name } : null;
};

export async function photoUrlMap(accessToken: string, tx: Tx, fileIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(fileIds.filter((v): v is string => !!v))];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const files = await sql<{ id: string; bucket: string; storage_path: string }>`
    select id, bucket, storage_path from app.files where id = any(${ids}::uuid[]) and status = 'active'`.execute(tx);
  const urls = await signedPhotoUrls(accessToken, files.rows.map((f) => ({ bucket: f.bucket, path: f.storage_path })));
  for (const f of files.rows) { const u = urls.get(f.storage_path); if (u) out.set(f.id, u); }
  return out;
}

// ---------------------------------------------------------------------------
// Completeness labels (F-EMP-24)
// ---------------------------------------------------------------------------
const MISSING: Record<string, Omit<MissingField, 'field'>> = {
  personal: { label: 'Personal details (MyKad, DOB, address)', tab: 'personal', payroll: false },
  emergency_contact: { label: 'Emergency contact', tab: 'contact', payroll: false },
  marital_status: { label: 'Marital status', tab: 'personal', payroll: false },
  spouse: { label: 'Spouse details (married)', tab: 'family', payroll: false },
  manager: { label: 'Reporting manager', tab: 'employment', payroll: false },
  payment_method: { label: 'Payment method / bank details', tab: 'bank', payroll: false },
  income_tax_no: { label: 'Income tax no.', tab: 'statutory', payroll: true },
  epf_no: { label: 'EPF no.', tab: 'statutory', payroll: true },
  socso_no: { label: 'SOCSO no.', tab: 'statutory', payroll: true },
  socso_category: { label: 'SOCSO category', tab: 'statutory', payroll: true },
  bank_account: { label: 'Bank account', tab: 'bank', payroll: true },
  spouse_relief: { label: 'Spouse relief claimed', tab: 'family', payroll: true },
  child_pcb: { label: 'Child PCB category / relief share', tab: 'family', payroll: true },
};
export function completenessOf(missing: string[] | null, payroll: string[] | null, total: number | null): Completeness {
  const all = [...(missing ?? []), ...(payroll ?? [])];
  const t = total ?? 13;
  return {
    pct: Math.max(0, Math.round((100 * (t - all.length)) / t)),
    missing: all.map((f) => ({ field: f, ...(MISSING[f] ?? { label: f, tab: 'overview', payroll: false }) })),
  };
}
const portalState = (userId: string | null, status: string | null, accepted: boolean | null): PortalAccountState =>
  !userId ? 'not_invited' : status === 'disabled' || status === 'expired' ? 'disabled' : accepted ? 'active' : 'pending_activation';

// ===========================================================================
// E1 Employee list
// ===========================================================================
type ListDb = {
  id: string; employee_no: string; full_name: string; preferred_name: string | null;
  department_id: string; dept_name: string; position_id: string; pos_title: string; grade_id: string; grade_name: string;
  manager_employee_id: string | null; work_location_id: string; loc_name: string; work_state: MyState; join_date: string;
  csd: string; status: EmploymentStatus; work_email: string; mobile_phone: string; lwd: string | null; prob_end: string | null;
  missing: string[] | null; missing_payroll: string[] | null; total_checks: number | null; portal: PortalAccountState;
};
const LIST_SORT: Record<string, string> = {
  employeeNo: 'x.employee_no', fullName: 'x.full_name', department: 'x.dept_name', position: 'x.pos_title', grade: 'x.grade_rank',
  manager: 'x.mgr_name', location: 'x.loc_name', joinDate: 'x.join_date', status: 'x.status', completeness: 'x.n_missing',
};
const LIST_FROM = sql`(
  select e.id, e.employee_no, e.full_name, e.preferred_name, e.department_id, d.name as dept_name, e.position_id, p.title as pos_title,
         e.grade_id, g.name as grade_name, g.rank as grade_rank, e.manager_employee_id, m.full_name as mgr_name,
         e.work_location_id, l.name as loc_name, e.work_state, e.join_date, coalesce(pp.continuous_service_date, e.join_date) as csd,
         e.status::text as status, e.work_email::text as work_email, e.mobile_phone, s.last_working_day as lwd,
         coalesce(e.extended_probation_end_date, e.probation_end_date) as prob_end, pp.nric_last4,
         c.missing, c.missing_payroll, c.total_checks,
         coalesce(cardinality(c.missing), 0) + coalesce(cardinality(c.missing_payroll), 0) as n_missing,
         case when pa.user_id is null then 'not_invited' when pa.status in ('disabled','expired') then 'disabled'
              when pa.accepted then 'active' else 'pending_activation' end as portal
    from app.employees e
    join app.departments d on d.id = e.department_id
    join app.positions p on p.id = e.position_id
    join app.grades g on g.id = e.grade_id
    join app.work_locations l on l.id = e.work_location_id
    left join app.employees m on m.id = e.manager_employee_id
    left join app.employee_personal pp on pp.employee_id = e.id
    left join app.employee_separations s on s.employee_id = e.id and not s.is_withdrawn and not s.superseded_by_rehire
    left join lateral app.employee_completeness(array[e.id]) c on true
    left join lateral app.employee_portal_accounts(array[e.id]) pa on true) x`;

export async function employeeRows(tx: Tx, params: EmployeeListParams, all = false): Promise<Paged<EmployeeRow>> {
  const p = parseParams(employeeListParamsSchema, params);
  const today = await todayMyt(tx);
  const q = likeTerm(p.q);
  const statuses = p.statuses?.length ? p.statuses : ACTIVE_STATUSES;
  const where = and([
    ...(q ? [sql`(x.employee_no ilike ${q} or x.full_name ilike ${q} or x.preferred_name ilike ${q} or x.work_email ilike ${q}
                 ${p.q && /^\d{4}$/.test(p.q) ? sql`or x.nric_last4 = ${p.q}` : sql``})`] : []),
    sql`x.status = any(${statuses}::text[])`,
    ...(p.departmentIds?.length ? [sql`x.department_id = any(${p.departmentIds}::uuid[])`] : []),
    ...(p.positionIds?.length ? [sql`x.position_id = any(${p.positionIds}::uuid[])`] : []),
    ...(p.gradeIds?.length ? [sql`x.grade_id = any(${p.gradeIds}::uuid[])`] : []),
    ...(p.locationIds?.length ? [sql`x.work_location_id = any(${p.locationIds}::uuid[])`] : []),
    ...(p.states?.length ? [sql`x.work_state::text = any(${p.states}::text[])`] : []),
    ...(p.managerId ? [sql`x.manager_employee_id = ${p.managerId}::uuid`] : []),
    ...(p.joinFrom ? [sql`x.join_date >= ${p.joinFrom}::date`] : []),
    ...(p.joinTo ? [sql`x.join_date <= ${p.joinTo}::date`] : []),
    ...(p.lwdFrom ? [sql`x.lwd >= ${p.lwdFrom}::date`] : []),
    ...(p.lwdTo ? [sql`x.lwd <= ${p.lwdTo}::date`] : []),
    ...(p.probationEndingWithin ? [sql`x.status = 'on_probation' and x.prob_end between ${today}::date and ${addDays(today, p.probationEndingWithin)}::date`] : []),
    ...(p.completeness === 'complete' ? [sql`x.n_missing = 0`] : p.completeness === 'incomplete' ? [sql`cardinality(x.missing) > 0`]
      : p.completeness === 'missing_payroll' ? [sql`cardinality(x.missing_payroll) > 0`] : []),
    ...(p.portalAccount?.length ? [sql`x.portal = any(${p.portalAccount}::text[])`] : []),
  ]);
  const limit = all ? EXPORT_LIMIT : p.pageSize;
  const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<ListDb>`select x.* from ${LIST_FROM} where ${where}
     order by ${sql.raw(LIST_SORT[p.sort] ?? 'x.employee_no')} ${dirOf(p.dir)} nulls last, x.employee_no
     limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${LIST_FROM} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const refs = await employeeRefs(tx, rows.rows.map((r) => r.manager_employee_id));
  return {
    rows: rows.rows.map((r) => ({
      id: r.id, employeeNo: r.employee_no, fullName: r.full_name, preferredName: r.preferred_name,
      department: { id: r.department_id, label: r.dept_name }, position: { id: r.position_id, label: r.pos_title },
      grade: { id: r.grade_id, label: r.grade_name }, manager: refOf(refs, r.manager_employee_id),
      workLocation: { id: r.work_location_id, label: r.loc_name }, workState: r.work_state, joinDate: r.join_date,
      lengthOfService: lengthOfService(r.csd, r.lwd && r.lwd < today ? r.lwd : today), status: r.status,
      workEmail: r.work_email, mobilePhone: r.mobile_phone, completeness: completenessOf(r.missing, r.missing_payroll, r.total_checks),
      portalAccount: r.portal, lastWorkingDay: r.lwd, probationEndDate: r.prob_end,
    })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}

export async function listEmployees(params: EmployeeListParams): Promise<Paged<EmployeeRow>> {
  const { ctx } = await authorize(EMP_ADMIN);
  return withUserTx(ctx, (tx) => employeeRows(tx, params));
}

// ===========================================================================
// Shared loaders (one employee) — every query runs under the caller's RLS
// ===========================================================================
type EmpCore = {
  id: string; employee_no: string; full_name: string; preferred_name: string | null; gender: 'male' | 'female';
  work_email: string; mobile_phone: string; work_phone: string | null; photo_file_id: string | null; status: EmploymentStatus;
  join_date: string; employment_type: 'permanent_full_time'; probation_months: number; probation_end_date: string | null;
  extended_probation_end_date: string | null; confirmation_date: string | null;
  department_id: string; dept_name: string; position_id: string; pos_title: string; grade_id: string; grade_name: string;
  manager_employee_id: string | null; work_location_id: string; loc_name: string; work_state: MyState; working_pattern_id: string;
  pattern_name: string; manager_since: string | null; leave_approver_employee_id: string | null; claim_approver_employee_id: string | null;
  version: number; created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null;
};
export async function loadCore(tx: Tx, by: { id?: string; employeeNo?: string }): Promise<EmpCore | null> {
  const cond = by.id ? sql`e.id = ${by.id}::uuid` : sql`upper(e.employee_no) = upper(${by.employeeNo ?? ''})`;
  return (await sql<EmpCore>`
    select e.*, e.work_email::text as work_email, e.status::text as status, d.name as dept_name, p.title as pos_title, g.name as grade_name,
           l.name as loc_name, wp.name as pattern_name
      from app.employees e
      join app.departments d on d.id = e.department_id join app.positions p on p.id = e.position_id
      join app.grades g on g.id = e.grade_id join app.work_locations l on l.id = e.work_location_id
      join app.working_patterns wp on wp.id = e.working_pattern_id
     where ${cond}`.execute(tx)).rows[0] ?? null;
}

type PersonalDb = {
  nric_enc: Buffer; nric_last4: string; date_of_birth: string; dob_overridden: boolean; race: PersonalView['race']; race_other: string | null;
  passport_no: string | null; passport_expiry: string | null; highest_qualification: PersonalView['highestQualification'];
  personal_email: string; res_addr_line1: string; res_addr_line2: string | null; res_addr_line3: string | null; res_postcode: string;
  res_city: string; res_state: MyState; res_country: string; mailing_same_as_residential: boolean; mail_addr_line1: string | null;
  mail_addr_line2: string | null; mail_addr_line3: string | null; mail_postcode: string | null; mail_city: string | null;
  mail_state: MyState | null; mail_country: string | null; continuous_service_date: string; probation_extension_reason: string | null;
  contractual_notice_value: number | null; contractual_notice_unit: 'weeks' | 'months' | null; retirement_date: string;
};
async function loadPersonal(tx: Tx, id: string): Promise<PersonalDb | null> {
  return (await sql<PersonalDb>`select p.*, p.personal_email::text as personal_email from app.employee_personal p where p.employee_id = ${id}::uuid`.execute(tx)).rows[0] ?? null;
}
async function loadMarital(tx: Tx, id: string) {
  return (await sql<{ marital_status: NonNullable<PersonalView['maritalStatus']>; effective_date: string }>`
    select marital_status::text as marital_status, effective_date from app.employee_marital_history
     where employee_id = ${id}::uuid order by effective_date desc`.execute(tx)).rows;
}
function currentMarital(rows: { marital_status: NonNullable<PersonalView['maritalStatus']>; effective_date: string }[], today: string) {
  return rows.find((r) => r.effective_date <= today) ?? rows[rows.length - 1] ?? null;
}
const addr = (p: PersonalDb, mail = false): Address => mail
  ? { line1: p.mail_addr_line1 ?? '', line2: p.mail_addr_line2, line3: p.mail_addr_line3, postcode: p.mail_postcode ?? '', city: p.mail_city ?? '', state: (p.mail_state ?? 'SGR'), country: p.mail_country ?? 'Malaysia' }
  : { line1: p.res_addr_line1, line2: p.res_addr_line2, line3: p.res_addr_line3, postcode: p.res_postcode, city: p.res_city, state: p.res_state, country: p.res_country };

async function loadContacts(tx: Tx, id: string, managerView: boolean): Promise<EmergencyContactView[]> {
  const r = await sql<{ id: string; priority: number; name: string; relationship: EmergencyContactView['relationship']; mobile_phone: string; alt_phone: string | null; email: string | null; is_next_of_kin: boolean }>`
    select id, priority, name, relationship::text as relationship, mobile_phone, alt_phone, email::text as email, is_next_of_kin
      from app.employee_emergency_contacts where employee_id = ${id}::uuid order by priority`.execute(tx);
  return r.rows.map((c) => ({
    id: c.id, priority: c.priority, name: c.name, relationship: c.relationship, mobilePhone: c.mobile_phone, altPhone: c.alt_phone,
    email: managerView ? null : c.email, isNextOfKin: managerView ? null : c.is_next_of_kin,   // C6/C7 hidden from managers (§8)
  }));
}

async function loadFamily(tx: Tx, id: string, today: string, maritalNow: string | null): Promise<FamilyView> {
  const sp = await sql<{ id: string; full_name: string; nric_last4: string; marriage_date: string | null; working_status: SpouseView['workingStatus']; is_oku: boolean; income_tax_no: string | null; relief_claimed_by_employee: boolean | null; record_status: SpouseView['recordStatus']; phone: string | null }>`
    select id, full_name, nric_last4, marriage_date, working_status, is_oku, income_tax_no, relief_claimed_by_employee, record_status::text as record_status, phone
      from app.employee_spouses where employee_id = ${id}::uuid order by record_status, created_at`.execute(tx);
  const ch = await sql<{ id: string; full_name: string; nric_last4: string | null; date_of_birth: string; gender: ChildView['gender']; relationship: ChildView['relationship']; pcb_category: ChildView['pcbCategory']; relief_share: ChildView['reliefShare']; institution_level: string | null; is_oku: boolean; is_active: boolean }>`
    select id, full_name, nric_last4, date_of_birth, gender::text as gender, relationship::text as relationship, pcb_category::text as pcb_category,
           relief_share::text as relief_share, institution_level, is_oku, is_active
      from app.employee_children where employee_id = ${id}::uuid order by date_of_birth`.execute(tx);
  const manual = (await sql<{ a: number | null; b: number | null; c: number | null; d: number | null }>`
    select child_count_lt18 as a, child_count_tertiary as b, child_count_disabled_lt18 as c, child_count_disabled_tertiary as d
      from app.employee_statutory_profiles where employee_id = ${id}::uuid`.execute(tx)).rows[0];
  const spouses: SpouseView[] = sp.rows.map((s) => ({
    id: s.id, fullName: s.full_name, nricMasked: maskMykad(s.nric_last4)!, nricLast4: s.nric_last4, marriageDate: s.marriage_date,
    workingStatus: s.working_status, isOku: s.is_oku, incomeTaxNo: s.income_tax_no, reliefClaimedByEmployee: s.relief_claimed_by_employee,
    recordStatus: s.record_status, phone: s.phone,
  }));
  const flags: string[] = [];
  const children: ChildView[] = ch.rows.map((c) => {
    const age = ageOn(c.date_of_birth, today);
    const eighteen = addMonths(c.date_of_birth, 12 * 18);
    const turns18On = eighteen > today && eighteen <= addDays(today, 60) ? eighteen : null;
    let categoryWarning: string | null = null;
    if (c.pcb_category === 'under_18' && age >= 18) categoryWarning = 'Category "Under 18" does not match the age — review.';
    if ((c.pcb_category === 'over_18_pre_university' || c.pcb_category === 'over_18_diploma_plus') && age < 18) categoryWarning = 'An 18+ category does not match the age — review.';
    if (turns18On && c.is_active) flags.push(`Child turns 18 on ${turns18On.split('-').reverse().join('/')} — review PCB category`);
    return {
      id: c.id, fullName: c.full_name, nricMasked: maskMykad(c.nric_last4), nricLast4: c.nric_last4, dateOfBirth: c.date_of_birth, age,
      gender: c.gender, relationship: c.relationship, pcbCategory: c.pcb_category, reliefShare: c.relief_share,
      institutionLevel: c.institution_level, isOku: c.is_oku, isActive: c.is_active, turns18On, categoryWarning,
    };
  });
  const active = children.filter((c) => c.isActive);
  const tertiary = (c: ChildView) => !!c.pcbCategory && STUDY_PCB_CATEGORIES.includes(c.pcbCategory) && c.age >= 18;
  const derived = {
    lt18: active.filter((c) => c.age < 18 && !c.isOku).length,
    tertiary: active.filter((c) => tertiary(c) && !c.isOku).length,
    disabledLt18: active.filter((c) => c.age < 18 && c.isOku).length,
    disabledTertiary: active.filter((c) => tertiary(c) && c.isOku).length,
  };
  const counts: ChildCounts = {
    total: active.length,
    pcbQualifying: active.filter((c) => c.pcbCategory && c.pcbCategory !== 'not_eligible').length,
    derived,
    manual: manual && manual.a != null ? { lt18: manual.a ?? 0, tertiary: manual.b ?? 0, disabledLt18: manual.c ?? 0, disabledTertiary: manual.d ?? 0 } : null,
    reliefPoints: null,
  };
  const current = spouses.filter((s) => s.recordStatus === 'current');
  if (maritalNow === 'married' && current.length === 0) flags.unshift('Spouse details required');
  const pcbCategory: PcbCategory = maritalNow === 'married'
    ? (current.some((s) => s.workingStatus === 'not_working') ? 'married_spouse_not_working' : 'married_spouse_working_or_other')
    : maritalNow === 'single' || !maritalNow ? 'single' : 'married_spouse_working_or_other';
  return { spouses, children, counts, pcbCategory, flags };
}

async function loadJobHistory(tx: Tx, id: string, today: string, view: 'admin' | 'self' | 'manager'): Promise<JobHistoryRow[]> {
  const r = await sql<{ id: string; effective_date: string; change_type: JobHistoryRow['changeType']; department_id: string; dept_name: string; position_id: string; pos_title: string; grade_id: string; grade_name: string; manager_employee_id: string | null; work_location_id: string; loc_name: string; working_pattern_id: string; pattern_name: string; employment_type: 'permanent_full_time'; remarks: string | null; reference_document_id: string | null; created_by: string | null; created_at: Date; version: number }>`
    select h.id, h.effective_date, h.change_type::text as change_type, h.department_id, d.name as dept_name, h.position_id, p.title as pos_title,
           h.grade_id, g.name as grade_name, h.manager_employee_id, h.work_location_id, l.name as loc_name, h.working_pattern_id,
           wp.name as pattern_name, h.employment_type::text as employment_type, h.remarks, h.reference_document_id, h.created_by, h.created_at, h.version
      from app.employee_job_history h
      join app.departments d on d.id = h.department_id join app.positions p on p.id = h.position_id
      join app.grades g on g.id = h.grade_id join app.work_locations l on l.id = h.work_location_id
      join app.working_patterns wp on wp.id = h.working_pattern_id
     where h.employee_id = ${id}::uuid and not h.is_deleted
     order by h.effective_date desc`.execute(tx);
  const refs = await employeeRefs(tx, r.rows.map((x) => x.manager_employee_id));
  const names = view === 'admin' ? await resolveNames(tx, r.rows.map((x) => x.created_by)) : new Map<string, string>();
  const currentId = r.rows.find((x) => x.effective_date <= today)?.id ?? r.rows[r.rows.length - 1]?.id;
  return r.rows.map((x) => ({
    id: x.id, effectiveDate: x.effective_date, changeType: x.change_type,
    department: { id: x.department_id, label: x.dept_name }, position: { id: x.position_id, label: x.pos_title },
    grade: { id: x.grade_id, label: x.grade_name }, manager: refOf(refs, x.manager_employee_id),
    workLocation: { id: x.work_location_id, label: x.loc_name }, workingPattern: { id: x.working_pattern_id, label: x.pattern_name },
    employmentType: x.employment_type,
    remarks: view === 'manager' ? null : x.remarks, referenceDocumentId: view === 'admin' ? x.reference_document_id : null,
    enteredByName: view === 'admin' ? (x.created_by ? names.get(x.created_by) ?? null : 'System') : null,
    enteredAt: view === 'admin' ? iso(x.created_at) : null,
    isScheduled: x.effective_date > today, isCurrent: x.id === currentId, version: x.version,
  }));
}

async function loadSeparations(tx: Tx, id: string, withDetails: boolean): Promise<SeparationView[]> {
  const r = await sql<{ id: string; notice_date: string; separation_type: SeparationView['separationType']; last_working_day: string; is_withdrawn: boolean; withdrawn_at: Date | null; withdraw_remarks: string | null; superseded_by_rehire: boolean; version: number; reason_category: string | null; reason_text: string | null; notice_required_days: number | null; notice_shortfall_days: number | null; notice_outcome: string | null; portal_access_end_date: string | null; eligible_for_rehire: boolean | null; exit_remarks: string | null }>`
    select s.id, s.notice_date, s.separation_type::text as separation_type, s.last_working_day, s.is_withdrawn, s.withdrawn_at, s.withdraw_remarks,
           s.superseded_by_rehire, s.version,
           ${withDetails ? sql`d.reason_category::text as reason_category, d.reason_text, d.notice_required_days, d.notice_shortfall_days, d.notice_outcome::text as notice_outcome, d.portal_access_end_date, d.eligible_for_rehire, d.exit_remarks`
                         : sql`null as reason_category, null as reason_text, null::int as notice_required_days, null::int as notice_shortfall_days, null as notice_outcome, null::date as portal_access_end_date, null::boolean as eligible_for_rehire, null as exit_remarks`}
      from app.employee_separations s
      ${withDetails ? sql`left join app.employee_separation_details d on d.separation_id = s.id` : sql``}
     where s.employee_id = ${id}::uuid order by s.created_at desc`.execute(tx);
  return r.rows.map((s) => ({
    id: s.id, noticeDate: s.notice_date, separationType: s.separation_type, lastWorkingDay: s.last_working_day,
    isWithdrawn: s.is_withdrawn || s.superseded_by_rehire, withdrawnAt: iso(s.withdrawn_at), withdrawRemarks: s.withdraw_remarks,
    details: withDetails && s.reason_category ? {
      reasonCategory: s.reason_category as never, reasonText: s.reason_text, noticeRequiredDays: s.notice_required_days ?? 0,
      noticeShortfallDays: s.notice_shortfall_days ?? 0, noticeOutcome: s.notice_outcome as never,
      portalAccessEndDate: s.portal_access_end_date ?? s.last_working_day, eligibleForRehire: s.eligible_for_rehire, exitRemarks: s.exit_remarks,
    } : null,
    version: s.version,
  }));
}

type StatDb = {
  pay_pcb: boolean; income_tax_no: string | null; is_tax_resident: boolean; lhdn_branch_id: string | null; lhdn_name: string | null;
  pay_epf: boolean; epf_no: string | null; epf_rate_type: 'statutory' | 'specific'; epf_specific_rate: string | null; epf_extra_employee_pct: string | null;
  pay_socso: boolean; socso_no: string | null; socso_category: StatutoryView['socsoCategory']; socso_contributed_before: boolean | null;
  pay_eis: boolean; pay_zakat: boolean; zakat_monthly_amount: string | null; zakat_account_no: string | null; zakat_body_id: string | null;
  zakat_name: string | null; ptptn_monthly_amount: string | null; ptptn_start_date: string | null; ptptn_end_date: string | null;
};
async function loadStatutory(tx: Tx, id: string, pcb: PcbCategory, payrollMissing: string[]): Promise<StatutoryView> {
  const s = (await sql<StatDb>`
    select sp.*, sp.epf_rate_type::text as epf_rate_type, sp.socso_category::text as socso_category, lb.name as lhdn_name, zb.name as zakat_name
      from app.employee_statutory_profiles sp left join app.lhdn_branches lb on lb.id = sp.lhdn_branch_id
      left join app.zakat_bodies zb on zb.id = sp.zakat_body_id
     where sp.employee_id = ${id}::uuid`.execute(tx)).rows[0];
  const needed = payrollMissing.filter((m) => ['income_tax_no', 'epf_no', 'socso_no', 'socso_category'].includes(m)).map((m) => MISSING[m]!.label);
  if (!s) {
    return { payPcb: true, incomeTaxNo: null, isTaxResident: true, lhdnBranch: null, pcbCategory: pcb, payEpf: true, epfNo: null, epfRateType: 'statutory',
      epfSpecificRate: null, epfExtraEmployeePct: null, paySocso: true, socsoNo: null, socsoCategory: null, socsoContributedBefore: null, payEis: true,
      payZakat: false, zakatMonthlyAmount: null, zakatAccountNo: null, zakatBody: null, ptptnMonthlyAmount: null, ptptnStartDate: null, ptptnEndDate: null,
      neededForPayroll: needed, warnings: [] };
  }
  return {
    payPcb: s.pay_pcb, incomeTaxNo: s.income_tax_no, isTaxResident: s.is_tax_resident,
    lhdnBranch: s.lhdn_branch_id ? { id: s.lhdn_branch_id, label: s.lhdn_name ?? '' } : null, pcbCategory: pcb,
    payEpf: s.pay_epf, epfNo: s.epf_no, epfRateType: s.epf_rate_type, epfSpecificRate: s.epf_specific_rate, epfExtraEmployeePct: s.epf_extra_employee_pct,
    paySocso: s.pay_socso, socsoNo: s.socso_no, socsoCategory: s.socso_category, socsoContributedBefore: s.socso_contributed_before,
    payEis: s.pay_eis, payZakat: s.pay_zakat, zakatMonthlyAmount: s.zakat_monthly_amount, zakatAccountNo: s.zakat_account_no,
    zakatBody: s.zakat_body_id ? { id: s.zakat_body_id, label: s.zakat_name ?? '' } : null,
    ptptnMonthlyAmount: s.ptptn_monthly_amount, ptptnStartDate: s.ptptn_start_date, ptptnEndDate: s.ptptn_end_date,
    neededForPayroll: needed, warnings: [],
  };
}

async function loadBank(tx: Tx, id: string, today: string, withNames: boolean): Promise<BankAccountView[]> {
  const r = await sql<{ id: string; payment_method: BankAccountView['paymentMethod']; bank_id: string | null; bank_name: string | null; bank_code: string | null; account_type: BankAccountView['accountType']; account_no_last4: string | null; account_holder_name: string | null; proof_file_id: string | null; effective_from: string; verified_by: string; verified_at: Date; asnb_account_no_last4: string | null; source_change_request_id: string | null; cr_no: string | null }>`
    select b.id, b.payment_method::text as payment_method, b.bank_id, k.name as bank_name, k.code as bank_code, b.account_type::text as account_type,
           b.account_no_last4, b.account_holder_name, b.proof_file_id, b.effective_from, b.verified_by, b.verified_at, b.asnb_account_no_last4,
           b.source_change_request_id, c.cr_no
      from app.employee_bank_accounts b left join app.banks k on k.id = b.bank_id
      left join app.change_requests c on c.id = b.source_change_request_id
     where b.employee_id = ${id}::uuid order by b.effective_from desc, b.created_at desc`.execute(tx);
  const names = withNames ? await resolveNames(tx, r.rows.map((x) => x.verified_by)) : new Map<string, string>();
  const currentId = r.rows.find((x) => x.effective_from <= today)?.id ?? null;
  return r.rows.map((b) => ({
    id: b.id, paymentMethod: b.payment_method, bank: b.bank_id ? { id: b.bank_id, name: b.bank_name ?? '', code: b.bank_code ?? '' } : null,
    accountType: b.account_type, accountNoMasked: maskAccount(b.account_no_last4), accountNoLast4: b.account_no_last4,
    accountHolderName: b.account_holder_name, proofFileId: withNames ? b.proof_file_id : null, effectiveFrom: b.effective_from,
    verifiedByName: withNames ? names.get(b.verified_by) ?? null : null, verifiedAt: iso(b.verified_at)!,
    asnbMasked: maskAccount(b.asnb_account_no_last4), asnbLast4: b.asnb_account_no_last4,
    source: b.source_change_request_id ? 'change_request' : 'direct', changeRequestNo: b.cr_no,
    isCurrent: b.id === currentId, isScheduled: b.effective_from > today,
  }));
}

async function loadPrior(tx: Tx, id: string) {
  return (await sql<{ id: string; employer: string; position: string; date_from: string; date_to: string }>`
    select id, employer, position, date_from, date_to from app.prior_employments where employee_id = ${id}::uuid order by date_from desc`.execute(tx))
    .rows.map((x) => ({ id: x.id, employer: x.employer, position: x.position, dateFrom: x.date_from, dateTo: x.date_to }));
}

function employmentView(e: EmpCore, p: PersonalDb | null, refs: Map<string, EmployeeRef>, today: string, lwd: string | null): EmploymentView {
  const csd = p?.continuous_service_date ?? e.join_date;
  return {
    joinDate: e.join_date, continuousServiceDate: csd, employmentType: e.employment_type, probationMonths: e.probation_months,
    probationEndDate: e.probation_end_date, extendedProbationEndDate: e.extended_probation_end_date,
    probationExtensionReason: p?.probation_extension_reason ?? null, confirmationDate: e.confirmation_date, status: e.status,
    department: { id: e.department_id, label: e.dept_name }, position: { id: e.position_id, label: e.pos_title },
    grade: { id: e.grade_id, label: e.grade_name }, manager: refOf(refs, e.manager_employee_id), managerSince: e.manager_since,
    leaveApprover: refOf(refs, e.leave_approver_employee_id), claimApprover: refOf(refs, e.claim_approver_employee_id),
    workLocation: { id: e.work_location_id, label: e.loc_name }, workState: e.work_state,
    workingPattern: { id: e.working_pattern_id, label: e.pattern_name },
    contractualNoticeValue: p?.contractual_notice_value ?? null, contractualNoticeUnit: p?.contractual_notice_unit ?? null,
    lengthOfService: lengthOfService(csd, lwd && lwd < today ? lwd : today), retirementDate: p?.retirement_date ?? '',
  };
}

async function loadRecommendations(tx: Tx, id: string): Promise<ProbationRecommendationView[]> {
  const r = await sql<{ id: string; recommendation: ProbationRecommendationView['recommendation']; suggested_extension_months: number | null; remarks: string | null; recommended_by: string; recommended_at: Date }>`
    select id, recommendation, suggested_extension_months, remarks, recommended_by, recommended_at
      from app.probation_recommendations where employee_id = ${id}::uuid order by recommended_at desc`.execute(tx);
  const names = await resolveNames(tx, r.rows.map((x) => x.recommended_by));
  return r.rows.map((x) => ({ id: x.id, recommendation: x.recommendation, suggestedExtensionMonths: x.suggested_extension_months, remarks: x.remarks,
    recommendedByName: names.get(x.recommended_by) ?? null, recommendedAt: iso(x.recommended_at)! }));
}

const PLACEHOLDERS = {
  leave: null,
  claims: null,
  compensation: 'Compensation arrives with payroll (R1.1).',
  payslips: 'Payslips arrive with payroll (R1.1).',
};

// ===========================================================================
// E3 Employee profile (ADM / SA)
// ===========================================================================
export async function getEmployeeProfile(employeeNo: string): Promise<EmployeeProfile | null> {
  const { user, ctx, accessToken } = await authorize(EMP_ADMIN);
  if (!NO_RE.test(employeeNo)) return null;
  return withUserTx(ctx, async (tx) => {
    const e = await loadCore(tx, { employeeNo });
    if (!e) { await logDenied(tx, 'employee', employeeNo); return null; }
    await logRecordOpen(tx, user, 'employee', e.id, e.id);
    return buildAdminProfile(tx, user, accessToken, e);
  });
}

async function buildAdminProfile(tx: Tx, user: CurrentUser, accessToken: string, e: EmpCore): Promise<EmployeeProfile> {
  const today = await todayMyt(tx);
  const me = await currentEmployeeId(tx);
  const isOwn = me === e.id;
  const [p, marital, contacts, seps, prior, recs] = await Promise.all([
    loadPersonal(tx, e.id), loadMarital(tx, e.id), loadContacts(tx, e.id, false), loadSeparations(tx, e.id, true), loadPrior(tx, e.id), loadRecommendations(tx, e.id),
  ]);
  const mNow = currentMarital(marital, today);
  const comp = (await sql<{ missing: string[]; missing_payroll: string[]; total_checks: number }>`
    select missing, missing_payroll, total_checks from app.employee_completeness(array[${e.id}]::uuid[])`.execute(tx)).rows[0];
  const family = await loadFamily(tx, e.id, today, mNow?.marital_status ?? null);
  const statutory = await loadStatutory(tx, e.id, family.pcbCategory, comp?.missing_payroll ?? []);
  const flags = (await sql<Record<string, unknown>>`select * from app.employee_statutory_employer_flags where employee_id = ${e.id}::uuid`.execute(tx)).rows[0] ?? {};
  const hr = (await sql<{ is_top_of_org: boolean; ph_state_override: MyState | null; cost_centre_id: string | null; cc_name: string | null; offer_contract_ref: string | null; contract_signed_date: string | null }>`
    select h.is_top_of_org, h.ph_state_override::text as ph_state_override, h.cost_centre_id, c.name as cc_name, h.offer_contract_ref, h.contract_signed_date
      from app.employee_hr_private h left join app.cost_centres c on c.id = h.cost_centre_id where h.employee_id = ${e.id}::uuid`.execute(tx)).rows[0];
  const groups = (await sql<{ id: string; name: string }>`
    select g.id, g.name from app.employee_group_members m join app.employee_groups g on g.id = m.group_id
     where m.employee_id = ${e.id}::uuid order by g.name`.execute(tx)).rows;
  const jobs = await loadJobHistory(tx, e.id, today, 'admin');
  const bank = await loadBank(tx, e.id, today, true);
  const portal = (await sql<{ user_id: string; status: string; accepted: boolean; invite_scheduled_for: string | null; last_login_at: Date | null }>`
    select user_id, status::text as status, accepted, invite_scheduled_for, last_login_at from app.employee_portal_accounts(array[${e.id}]::uuid[])`.execute(tx)).rows[0];
  const docsExpiring = (await sql<{ n: number }>`select count(*)::int as n from app.employee_documents where employee_id = ${e.id}::uuid
     and is_active and expiry_date between ${today}::date and ${addDays(today, 30)}::date`.execute(tx)).rows[0]?.n ?? 0;
  const openCrs = (await sql<{ n: number }>`select count(*)::int as n from app.change_requests where employee_id = ${e.id}::uuid and status = 'submitted'`.execute(tx)).rows[0]?.n ?? 0;
  // W2-004: open leave items + Overview "Leave snapshot" (Available per visible type, current year — from the summary cache)
  const leaveOpen = (await sql<{ l: number; c: number }>`select
      (select count(*)::int from app.leave_applications where employee_id = ${e.id}::uuid and status in ('pending','cancellation_pending')) as l,
      (select count(*)::int from app.replacement_credits where employee_id = ${e.id}::uuid and status = 'pending') as c`.execute(tx)).rows.map((x) => ({ pendingLeave: x.l, pendingCredits: x.c }))[0]!;
  const leaveSnapshot = (await sql<{ id: string; code: string; name: string; available: string }>`select t.id, t.code, t.name, s.available
      from app.leave_balance_summary s join app.leave_types t on t.id = s.leave_type_id
     where s.employee_id = ${e.id}::uuid and s.leave_year = extract(year from app.today_myt())::int and t.is_active and t.visible_to_employees
       and t.entitlement_method in ('annual_banded','earned_credits','no_entitlement') order by t.display_order`.execute(tx)).rows
    .map((x) => ({ leaveTypeId: x.id, code: x.code, name: x.name, available: Number(x.available).toFixed(1) }));
  const refs = await employeeRefs(tx, [e.manager_employee_id, e.leave_approver_employee_id, e.claim_approver_employee_id]);
  const photos = await photoUrlMap(accessToken, tx, [e.photo_file_id]);
  const names = await resolveNames(tx, [e.created_by, e.updated_by]);
  const current = seps.find((s) => !s.isWithdrawn) ?? null;
  const lwd = current?.lastWorkingDay ?? null;
  const upcoming: UpcomingItem[] = [];
  for (const j of jobs.filter((j) => j.isScheduled)) upcoming.push({ kind: 'job_change', date: j.effectiveDate, label: JOB_CHANGE_TYPE_LABELS[j.changeType] });
  const probEnd = e.extended_probation_end_date ?? e.probation_end_date;
  if (e.status === 'on_probation' && probEnd) upcoming.push({ kind: 'probation_end', date: probEnd, label: 'Probation ends' });
  if (p?.passport_expiry && p.passport_expiry >= today) upcoming.push({ kind: 'passport_expiry', date: p.passport_expiry, label: 'Passport expires' });
  if (lwd && lwd >= today) upcoming.push({ kind: 'last_working_day', date: lwd, label: 'Last working day' });
  if (p?.retirement_date && p.retirement_date >= today && p.retirement_date <= addMonths(today, 12)) upcoming.push({ kind: 'retirement', date: p.retirement_date, label: 'Retirement date' });
  const docs = (await sql<{ title: string; expiry_date: string }>`select title, expiry_date from app.employee_documents where employee_id = ${e.id}::uuid
     and is_active and expiry_date between ${today}::date and ${addDays(today, 60)}::date`.execute(tx)).rows;
  for (const d of docs) upcoming.push({ kind: 'document_expiry', date: d.expiry_date, label: `${d.title} expires` });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  const isSa = hasRole(user, 'SA');
  const active = ['pending_join', 'on_probation', 'confirmed', 'notice_period'].includes(e.status);
  const portalState = portal ? (portal.status === 'disabled' || portal.status === 'expired' ? 'disabled' : portal.accepted ? 'active' : 'pending_activation') : 'not_invited';
  const b = (k: string) => flags[k] === true;
  return {
    id: e.id, isOwnRecord: isOwn,
    personal: {
      employeeNo: e.employee_no, fullName: e.full_name, preferredName: e.preferred_name,
      nricMasked: maskMykad(p?.nric_last4) ?? '', nricLast4: p?.nric_last4 ?? '', dateOfBirth: p?.date_of_birth ?? '',
      dobOverridden: p?.dob_overridden ?? false, age: p ? ageOn(p.date_of_birth, today) : 0, gender: e.gender, nationality: 'Malaysian',
      race: p?.race ?? null, raceOther: p?.race_other ?? null, maritalStatus: mNow?.marital_status ?? null, maritalEffectiveDate: mNow?.effective_date ?? null,
      maritalHistory: marital.map((m) => ({ maritalStatus: m.marital_status, effectiveDate: m.effective_date })),
      photoFileId: e.photo_file_id, photoUrl: e.photo_file_id ? photos.get(e.photo_file_id) ?? null : null,
      passportNo: p?.passport_no ?? null, passportExpiry: p?.passport_expiry ?? null, highestQualification: p?.highest_qualification ?? null,
    },
    contact: {
      workEmail: e.work_email, personalEmail: p?.personal_email ?? '', mobilePhone: e.mobile_phone, workPhone: e.work_phone,
      residentialAddress: p ? addr(p) : { line1: '', line2: null, line3: null, postcode: '', city: '', state: 'SGR', country: 'Malaysia' },
      mailingSameAsResidential: p?.mailing_same_as_residential ?? true, mailingAddress: p && !p.mailing_same_as_residential ? addr(p, true) : null,
    },
    emergencyContacts: contacts, family,
    employment: employmentView(e, p, refs, today, lwd),
    employmentHr: {
      isTopOfOrg: hr?.is_top_of_org ?? false, phStateOverride: hr?.ph_state_override ?? null,
      costCentre: hr?.cost_centre_id ? { id: hr.cost_centre_id, label: hr.cc_name ?? '' } : null,
      offerContractRef: hr?.offer_contract_ref ?? null, contractSignedDate: hr?.contract_signed_date ?? null,
      employeeGroups: groups.map((g) => ({ id: g.id, label: g.name })), payGroup: null,
    },
    jobHistory: jobs, probationRecommendations: recs,
    separation: current, separationHistory: seps.filter((s) => s.isWithdrawn),
    priorEmployments: prior, statutory,
    employerFlags: {
      pcbBorneByEmployer: b('pcb_borne_by_employer'), returningExpertProgramme: b('returning_expert_programme'),
      knowledgeWorkerSpecifiedRegion: b('knowledge_worker_specified_region'), epfBorneByEmployer: b('epf_borne_by_employer'),
      epfExtraEmployerPct: (flags.epf_extra_employer_pct as string | null) ?? null, socsoBorneByEmployer: b('socso_borne_by_employer'),
      paySkbbk: b('pay_skbbk'), skbbkBorneByEmployer: b('skbbk_borne_by_employer'), eisBorneByEmployer: b('eis_borne_by_employer'), payHrdf: b('pay_hrdf'),
    },
    bank: { current: bank.find((x) => x.isCurrent) ?? null, history: bank },
    portal: { userId: portal?.user_id ?? null, state: portalState, inviteScheduledFor: portal?.invite_scheduled_for ?? null, lastLoginAt: iso(portal?.last_login_at) },
    completeness: completenessOf(comp?.missing ?? [], comp?.missing_payroll ?? [], comp?.total_checks ?? 13),
    upcoming, openItems: { changeRequests: openCrs, documentsExpiringSoon: docsExpiring, ...leaveOpen, ...(await claimOpenItems(tx, e.id)) }, leaveSnapshot, placeholders: PLACEHOLDERS,
    can: {
      editPersonal: true, editPhoto: true, editSensitive: !isOwn, editMykad: !isOwn, editEmployeeNo: isSa, editContact: true, editFamily: !isOwn,
      editEmployment: active, editTopOfOrg: isSa, addJobChange: active, editStatutory: !isOwn, editBank: !isOwn, reveal: true,
      uploadDocument: !isOwn, addNote: true, viewActivity: true, exportActivity: isSa,
      confirm: !isOwn && e.status === 'on_probation', extendProbation: !isOwn && e.status === 'on_probation',
      recordSeparation: !isOwn && (e.status === 'on_probation' || e.status === 'confirmed'),
      editSeparation: !isOwn && !!current && (current.lastWorkingDay >= today || e.status === 'notice_period'),
      withdrawResignation: !isOwn && e.status === 'notice_period' && !!lwd && lwd >= today,
      withdrawOffer: e.status === 'pending_join', rehire: !isOwn && e.status === 'separated',
      invite: !isOwn && active && portalState === 'not_invited', resendInvite: !isOwn && portalState === 'pending_activation',
    },
    ...stamps(e, names),
  };
}

/** A11/A14/A15 for ADM/SA — every call is access-logged by app.read_employee_sensitive (BR-ADM-21). */
export async function getEmployeeSensitive(employeeId: string): Promise<SensitiveView | null> {
  const { ctx } = await authorize(EMP_ADMIN);
  if (!UUID_RE.test(employeeId)) return null;
  return withUserTx(ctx, async (tx) => {
    const r = (await sql<{ religion: SensitiveView['religion']; is_oku: boolean; oku_card_no: string | null }>`
      select religion::text as religion, is_oku, oku_card_no from app.read_employee_sensitive(${employeeId}::uuid, 'Employee profile — Personal tab')`.execute(tx)).rows[0];
    return r ? { religion: r.religion, isOku: r.is_oku, okuCardNo: r.oku_card_no } : null;
  });
}

// ===========================================================================
// P16 My profile (own)
// ===========================================================================
export async function getMyProfile(): Promise<MyProfile | null> {
  const { ctx, accessToken } = await authorize(ANY_USER);
  return withUserTx(ctx, async (tx) => {
    const me = await currentEmployeeId(tx);
    if (!me) return null;
    const e = await loadCore(tx, { id: me });
    if (!e) return null;                                   // e.g. the first Super Admin before the record is created
    const today = await todayMyt(tx);
    const [p, marital, contacts, seps, prior] = await Promise.all([
      loadPersonal(tx, me), loadMarital(tx, me), loadContacts(tx, me, false), loadSeparations(tx, me, false), loadPrior(tx, me)]);
    const mNow = currentMarital(marital, today);
    const family = await loadFamily(tx, me, today, mNow?.marital_status ?? null);
    const statutory = await loadStatutory(tx, me, family.pcbCategory, []);
    const sens = (await sql<{ religion: SensitiveView['religion']; is_oku: boolean; oku_card_no: string | null }>`
      select religion::text as religion, is_oku, oku_card_no from app.employee_sensitive where employee_id = ${me}::uuid`.execute(tx)).rows[0];
    if (statutory.payZakat && sens?.religion !== 'islam') statutory.warnings.push('Zakat via payroll is set but religion is not Islam.');
    const jobs = await loadJobHistory(tx, me, today, 'self');
    const bank = await loadBank(tx, me, today, false);
    const refs = await employeeRefs(tx, [e.manager_employee_id, e.leave_approver_employee_id, e.claim_approver_employee_id]);
    const photos = await photoUrlMap(accessToken, tx, [e.photo_file_id]);
    const open = (await sql<{ category: CrCategory; cr_no: string }>`
      select category::text as category, cr_no from app.change_requests where employee_id = ${me}::uuid and status = 'submitted'`.execute(tx)).rows;
    const current = seps.find((s) => !s.isWithdrawn) ?? null;
    // Own MyKad shown in full to the owner (P16 / US-EMP-018: no access-log entry for one's own record).
    let nric = '';
    try {
      if (p) nric = formatMykad(fieldCrypto.decrypt(p.nric_enc, { table: 'employee_personal', column: 'nric_enc', rowId: me }));
    } catch {
      nric = maskMykad(p?.nric_last4) ?? '';
    }
    const cur = bank.find((x) => x.isCurrent) ?? null;
    return {
      id: me,
      personal: {
        employeeNo: e.employee_no, fullName: e.full_name, preferredName: e.preferred_name, nric, nricLast4: p?.nric_last4 ?? '',
        dateOfBirth: p?.date_of_birth ?? '', age: p ? ageOn(p.date_of_birth, today) : 0, gender: e.gender, nationality: 'Malaysian',
        race: p?.race ?? null, raceOther: p?.race_other ?? null, maritalStatus: mNow?.marital_status ?? null, maritalEffectiveDate: mNow?.effective_date ?? null,
        maritalHistory: marital.map((m) => ({ maritalStatus: m.marital_status, effectiveDate: m.effective_date })),
        photoFileId: e.photo_file_id, photoUrl: e.photo_file_id ? photos.get(e.photo_file_id) ?? null : null,
        passportNo: p?.passport_no ?? null, passportExpiry: p?.passport_expiry ?? null, highestQualification: p?.highest_qualification ?? null,
        religion: sens?.religion ?? null, isOku: sens?.is_oku ?? false, okuCardNo: sens?.oku_card_no ?? null,
      },
      contact: {
        workEmail: e.work_email, personalEmail: p?.personal_email ?? '', mobilePhone: e.mobile_phone, workPhone: e.work_phone,
        residentialAddress: p ? addr(p) : { line1: '', line2: null, line3: null, postcode: '', city: '', state: 'SGR', country: 'Malaysia' },
        mailingSameAsResidential: p?.mailing_same_as_residential ?? true, mailingAddress: p && !p.mailing_same_as_residential ? addr(p, true) : null,
      },
      emergencyContacts: contacts, family,
      employment: employmentView(e, p, refs, today, current?.lastWorkingDay ?? null),
      jobHistory: jobs,
      separation: current ? { noticeDate: current.noticeDate, separationType: current.separationType, lastWorkingDay: current.lastWorkingDay } : null,
      priorEmployments: prior, statutory,
      bank: { current: cur ? (({ proofFileId: _p, verifiedByName: _v, ...rest }) => rest)(cur) : null },
      openChangeRequests: Object.fromEntries(open.map((o) => [o.category, o.cr_no])),
      completeness: null,
    };
  });
}

// ===========================================================================
// P31 My team / P32 Team member (MGR)
// ===========================================================================
export async function listMyTeam(params: MyTeamParams): Promise<Paged<TeamRow>> {
  const { ctx, accessToken } = await authorize(TEAM);
  return withUserTx(ctx, (tx) => teamRows(tx, params, false, accessToken));
}
export async function teamRows(tx: Tx, params: MyTeamParams, all: boolean, accessToken?: string): Promise<Paged<TeamRow>> {
  const p = parseParams(myTeamParamsSchema, params);
  const me = await currentEmployeeId(tx);
  if (!me) return { rows: [], total: 0, page: 1, pageSize: p.pageSize };
  const q = likeTerm(p.q);
  // the closure table is not readable directly: reportees are the T1 employees rows the caller sees via app.is_manager_of()
  const where = and([
    sql`app.is_manager_of(e.id)`,
    ...(p.scope === 'direct' ? [sql`e.manager_employee_id = ${me}::uuid`] : []),
    ...(q ? [sql`(e.full_name ilike ${q} or e.preferred_name ilike ${q} or e.employee_no ilike ${q})`] : []),
    ...(p.departmentIds?.length ? [sql`e.department_id = any(${p.departmentIds}::uuid[])`] : []),
  ]);
  const sort: Record<string, string> = { name: 'e.full_name', employeeNo: 'e.employee_no', position: 'p.title', department: 'd.name' };
  const from = sql`app.employees e join app.positions p on p.id = e.position_id join app.departments d on d.id = e.department_id`;
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<{ id: string; employee_no: string; full_name: string; preferred_name: string | null; photo_file_id: string | null; position_id: string; title: string; department_id: string; dept: string; status: EmploymentStatus; manager_employee_id: string | null }>`
    select e.id, e.employee_no, e.full_name, e.preferred_name, e.photo_file_id, e.position_id, p.title, e.department_id, d.name as dept,
           e.status::text as status, e.manager_employee_id
      from ${from} where ${where} order by ${sql.raw(sort[p.sort] ?? 'e.full_name')} ${dirOf(p.dir)}, e.employee_no limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const photos = accessToken ? await photoUrlMap(accessToken, tx, rows.rows.map((r) => r.photo_file_id)) : new Map<string, string>();
  const leaveCols = await teamLeaveSummariesTx(tx, rows.rows.map((r) => r.id));
  return {
    rows: rows.rows.map((r) => ({
      employeeId: r.id, employeeNo: r.employee_no, fullName: r.full_name, preferredName: r.preferred_name,
      photoUrl: r.photo_file_id ? photos.get(r.photo_file_id) ?? null : null, position: { id: r.position_id, label: r.title },
      department: { id: r.department_id, label: r.dept }, status: r.status, isDirect: r.manager_employee_id === me, leave: leaveCols.get(r.id) ?? null,
    })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}

export async function getTeamMemberProfile(employeeNo: string): Promise<TeamMemberProfile | null> {
  const { ctx, accessToken } = await authorize(TEAM);
  if (!NO_RE.test(employeeNo)) return null;
  return withUserTx(ctx, async (tx) => {
    const e = await loadCore(tx, { employeeNo });
    const isReportee = e ? (await sql<{ ok: boolean }>`select app.is_manager_of(${e.id}::uuid) as ok`.execute(tx)).rows[0]?.ok : false;
    if (!e || !isReportee) {
      // US-EMP-004: a non-reportee URL shows "Not found or no access" and the attempt is logged
      await writeAccess(tx, { action: 'record_open', entityType: 'employee', entityRef: employeeNo.slice(0, 20), reason: 'Denied: not in your team' });
      return null;
    }
    const today = await todayMyt(tx);
    const me = await currentEmployeeId(tx);
    const contacts = await loadContacts(tx, e.id, true);
    const seps = await loadSeparations(tx, e.id, false);
    const current = seps.find((s) => !s.isWithdrawn) ?? null;
    const refs = await employeeRefs(tx, [e.manager_employee_id, e.leave_approver_employee_id, e.claim_approver_employee_id]);
    const photos = await photoUrlMap(accessToken, tx, [e.photo_file_id]);
    const ev = employmentView(e, null, refs, today, current?.lastWorkingDay ?? null);
    // F24 length of service from the join date (continuous-service date F2 is not a manager field)
    const recs = await loadRecommendations(tx, e.id);
    return {
      id: e.id, employeeNo: e.employee_no, fullName: e.full_name, preferredName: e.preferred_name, gender: e.gender,
      photoUrl: e.photo_file_id ? photos.get(e.photo_file_id) ?? null : null,
      workEmail: e.work_email, mobilePhone: e.mobile_phone, workPhone: e.work_phone, emergencyContacts: contacts,
      employment: {
        joinDate: ev.joinDate, employmentType: ev.employmentType, probationMonths: ev.probationMonths, probationEndDate: ev.probationEndDate,
        extendedProbationEndDate: ev.extendedProbationEndDate, confirmationDate: ev.confirmationDate, status: ev.status,
        department: ev.department, position: ev.position, grade: ev.grade, manager: ev.manager, leaveApprover: ev.leaveApprover,
        claimApprover: ev.claimApprover, workLocation: ev.workLocation, workState: ev.workState, workingPattern: ev.workingPattern,
        lengthOfService: ev.lengthOfService, managerSince: ev.managerSince,
      },
      separation: current ? { noticeDate: current.noticeDate, separationType: current.separationType, lastWorkingDay: current.lastWorkingDay } : null,
      isDirectReport: e.manager_employee_id === me,
      canRecommendProbation: e.status === 'on_probation',
      myRecommendations: recs,
      leave: await teamMemberLeave(tx, e.id),
      claims: await teamMemberClaims(tx, e.id),
      placeholders: { leave: null, claims: null },
    };
  });
}

// ===========================================================================
// G10 Staff directory / G11 Org chart
// ===========================================================================
export async function directoryRows(tx: Tx, params: DirectoryParams, all: boolean, accessToken: string | null, isAdmin: boolean): Promise<Paged<DirectoryRow>> {
  const p = parseParams(directoryParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    sql`d.is_listed`,
    ...(q ? [sql`(d.full_name ilike ${q} or d.preferred_name ilike ${q} or d.position_title ilike ${q} or d.department_name ilike ${q})`] : []),
    ...(p.departmentIds?.length ? [sql`d.department_id = any(${p.departmentIds}::uuid[])`] : []),
    ...(p.locationIds?.length ? [sql`d.location_id = any(${p.locationIds}::uuid[])`] : []),
  ]);
  const sort: Record<string, string> = { name: 'd.full_name', position: 'd.position_title', department: 'd.department_name', location: 'd.location_name' };
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<{ employee_id: string; employee_no: string; full_name: string; preferred_name: string | null; position_title: string; department_name: string; location_name: string; work_email: string; work_phone: string | null; photo_file_id: string | null }>`
    select d.employee_id, d.employee_no, d.full_name, d.preferred_name, d.position_title, d.department_name, d.location_name,
           d.work_email::text as work_email, d.work_phone, d.photo_file_id
      from app.employee_directory d where ${where}
     order by ${sql.raw(sort[p.sort] ?? 'd.full_name')} ${dirOf(p.dir)}, d.full_name limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from app.employee_directory d where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const photos = accessToken ? await photoUrlMap(accessToken, tx, rows.rows.map((r) => r.photo_file_id)) : new Map<string, string>();
  return {
    rows: rows.rows.map((r) => ({
      employeeId: r.employee_id, name: r.full_name, preferredName: r.preferred_name,
      photoUrl: r.photo_file_id ? photos.get(r.photo_file_id) ?? null : null, position: r.position_title, department: r.department_name,
      location: r.location_name, workEmail: r.work_email, workPhone: r.work_phone,
      profileHref: isAdmin ? `/employees/${encodeURIComponent(r.employee_no)}` : null,
    })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listDirectory(params: DirectoryParams): Promise<Paged<DirectoryRow>> {
  const { user, ctx, accessToken } = await authorize(ANY_USER);
  return withUserTx(ctx, (tx) => directoryRows(tx, params, false, accessToken, user.mfaVerified && hasRole(user, 'ADM', 'SA')));
}
export async function getDirectoryFilterOptions(): Promise<DirectoryFilterOptions> {
  const { ctx } = await authorize(ANY_USER);
  return withUserTx(ctx, async (tx) => {
    const d = await sql<Ref>`select distinct department_id as id, department_name as label from app.employee_directory where is_listed and department_id is not null order by 2`.execute(tx);
    const l = await sql<Ref>`select distinct location_id as id, location_name as label from app.employee_directory where is_listed and location_id is not null order by 2`.execute(tx);
    return { departments: d.rows, locations: l.rows };
  });
}
export async function getOrgChart(): Promise<OrgChart> {
  const { user, ctx, accessToken } = await authorize(ANY_USER);
  return withUserTx(ctx, async (tx) => {
    const r = await sql<{ employee_id: string; employee_no: string; manager_employee_id: string | null; full_name: string; preferred_name: string | null; position_title: string; department_name: string; department_id: string | null; photo_file_id: string | null }>`
      select employee_id, employee_no, manager_employee_id, full_name, preferred_name, position_title, department_name, department_id, photo_file_id
        from app.employee_directory where is_listed order by full_name`.execute(tx);
    const photos = await photoUrlMap(accessToken, tx, r.rows.map((x) => x.photo_file_id));
    const listed = new Set(r.rows.map((x) => x.employee_id));
    const admin = hasRole(user, 'ADM', 'SA');
    const nodes = r.rows.map((x) => ({
      employeeId: x.employee_id, managerId: x.manager_employee_id && listed.has(x.manager_employee_id) ? x.manager_employee_id : null,
      name: x.full_name, preferredName: x.preferred_name, position: x.position_title, department: x.department_name, departmentId: x.department_id,
      photoUrl: x.photo_file_id ? photos.get(x.photo_file_id) ?? null : null,
      profileHref: admin ? `/employees/${encodeURIComponent(x.employee_no)}` : null,
    }));
    return { nodes, roots: nodes.filter((n) => !n.managerId).map((n) => n.employeeId) };
  });
}

// ===========================================================================
// Pickers, form options, job-change context, separation preview
// ===========================================================================
export async function employeeOptionRows(tx: Tx, input: EmployeeOptionsInput): Promise<EmployeeOption[]> {
  const p = parseParams(employeeOptionsSchema, input);
  const q = likeTerm(p.q);
  const r = await sql<{ id: string; employee_no: string; full_name: string; preferred_name: string | null; title: string | null; dept: string | null; status: EmploymentStatus }>`
    select e.id, e.employee_no, e.full_name, e.preferred_name, p.title, d.name as dept, e.status::text as status
      from app.employees e left join app.positions p on p.id = e.position_id left join app.departments d on d.id = e.department_id
     where ${p.activeOnly ? sql`e.status in ('pending_join','on_probation','confirmed','notice_period')` : sql`true`}
       and ${p.excludeEmployeeId ? sql`e.id <> ${p.excludeEmployeeId}::uuid` : sql`true`}
       and ${q ? sql`(e.full_name ilike ${q} or e.preferred_name ilike ${q} or e.employee_no ilike ${q})` : sql`true`}
       and ${p.departmentIds?.length ? sql`e.department_id = any(${p.departmentIds}::uuid[])` : sql`true`}
       and ${p.locationIds?.length ? sql`e.work_location_id = any(${p.locationIds}::uuid[])` : sql`true`}
     order by e.full_name limit ${p.limit}`.execute(tx);
  return r.rows.map((x) => ({ id: x.id, employeeNo: x.employee_no, name: displayName(x.full_name, x.preferred_name), position: x.title, department: x.dept, status: x.status }));
}
export async function listEmployeeOptions(input: EmployeeOptionsInput): Promise<EmployeeOption[]> {
  const { ctx } = await authorize(EMP_ADMIN);
  return withUserTx(ctx, (tx) => employeeOptionRows(tx, input));
}

/** Q-F2: banks / LHDN branches / zakat bodies for P17 — P-ACTIVE reference data, every signed-in role. */
export async function changeRequestFormOptions(tx: Tx): Promise<ChangeRequestFormOptions> {
  const banks = await sql<{ id: string; name: string; code: string }>`select id, name, code from app.banks where is_active order by name`.execute(tx);
  const lhdn = await sql<Ref>`select id, name as label from app.lhdn_branches where is_active order by name`.execute(tx);
  const zb = await sql<Ref & { state: MyState }>`select id, name as label, state::text as state from app.zakat_bodies where is_active order by name`.execute(tx);
  return { banks: banks.rows, lhdnBranches: lhdn.rows, zakatBodies: zb.rows };
}
export async function getChangeRequestFormOptions(): Promise<ChangeRequestFormOptions> {
  const { ctx } = await authorize(ANY_USER);
  return withUserTx(ctx, (tx) => changeRequestFormOptions(tx));
}

export async function getEmployeeFormOptions(): Promise<EmployeeFormOptions> {
  const { ctx } = await authorize(EMP_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const banks = await sql<{ id: string; name: string; code: string; bic: string | null }>`select id, name, code, bic from app.banks where is_active order by name`.execute(tx);
    const lhdn = await sql<Ref>`select id, name as label from app.lhdn_branches where is_active order by name`.execute(tx);
    const s = (await sql<{ default_probation_months: number; max_probation_months: number; invite_lead_days: number; allowed_email_domains: string[]; employee_no_prefix: string; employee_no_padding: number; employee_no_next: number; rehire_keep_employee_no: boolean }>`
      select default_probation_months, max_probation_months, invite_lead_days, allowed_email_domains::text[] as allowed_email_domains,
             employee_no_prefix, employee_no_padding, employee_no_next, rehire_keep_employee_no from app.security_settings where id = 1`.execute(tx)).rows[0];
    const hrdf = (await sql<{ hrdf_registered: boolean }>`select hrdf_registered from app.company_statutory limit 1`.execute(tx)).rows[0]?.hrdf_registered ?? false;
    return {
      banks: banks.rows, lhdnBranches: lhdn.rows,
      settings: {
        defaultProbationMonths: s?.default_probation_months ?? 3, maxProbationMonths: s?.max_probation_months ?? 12, inviteLeadDays: s?.invite_lead_days ?? 3,
        allowedEmailDomains: s?.allowed_email_domains ?? [],
        employeeNoPreview: s ? s.employee_no_prefix + String(s.employee_no_next).padStart(s.employee_no_padding, '0') : '',
        rehireKeepEmployeeNo: s?.rehire_keep_employee_no ?? true, companyHrdfRegistered: hrdf,
      },
    };
  });
}

export async function getJobChangeContext(employeeId: string, effectiveDate: string): Promise<JobChangeContext | null> {
  const { ctx } = await authorize(EMP_ADMIN);
  if (!UUID_RE.test(employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) return null;
  return withUserTx(ctx, (tx) => jobChangeContext(tx, employeeId, effectiveDate));
}
export async function jobChangeContext(tx: Tx, employeeId: string, effectiveDate: string): Promise<JobChangeContext | null> {
  {
    const today = await todayMyt(tx);
    const jobs = await loadJobHistory(tx, employeeId, today, 'admin');
    if (!jobs.length) return null;
    const inForce = jobs.find((j) => j.effectiveDate <= effectiveDate) ?? jobs[jobs.length - 1]!;
    const { enteredByName: _a, enteredAt: _b, ...row } = inForce;
    const impacts: string[] = [];
    const n = (await sql<{ n: number }>`select count(*)::int as n from app.employees where manager_employee_id = ${employeeId}::uuid
        and status in ('pending_join','on_probation','confirmed','notice_period')`.execute(tx)).rows[0]?.n ?? 0;
    if (n) impacts.push(`${n} direct reportee(s) keep this person as manager.`);
    impacts.push('Pending leave and claim approvals re-route to the new manager.');
    impacts.push('Leave entitlements will be recomputed from the effective date (W2-004).');
    return { rowInForce: row, impacts };
  }
}

/** EA s12 default notice (BR-EMP-14): < 2 years 4 weeks, 2–5 years 6 weeks, ≥ 5 years 8 weeks (settings). */
export async function getSeparationPreview(input: SeparationPreviewInput): Promise<SeparationPreview | null> {
  const { ctx } = await authorize(EMP_ADMIN);
  const p = parseParams(separationPreviewSchema, input);
  return withUserTx(ctx, (tx) => separationPreview(tx, p.employeeId, p.noticeDate, p.lastWorkingDay ?? null));
}
export async function separationPreview(tx: Tx, employeeId: string, noticeDate: string, lwd: string | null): Promise<SeparationPreview | null> {
  const e = await loadCore(tx, { id: employeeId });
  if (!e) return null;
  const today = await todayMyt(tx);
  const p = await loadPersonal(tx, employeeId);
  const s = (await sql<{ a: number; b: number; c: number }>`select notice_weeks_lt2 as a, notice_weeks_2to5 as b, notice_weeks_ge5 as c from app.security_settings where id = 1`.execute(tx)).rows[0];
  const service = lengthOfService(p?.continuous_service_date ?? e.join_date, noticeDate);
  let days: number; let basis: string;
  if (p?.contractual_notice_value && p.contractual_notice_unit) {
    days = p.contractual_notice_unit === 'weeks' ? p.contractual_notice_value * 7
      : Math.round((Date.parse(addMonths(noticeDate, p.contractual_notice_value)) - Date.parse(noticeDate)) / 86_400_000);
    basis = `Contractual: ${p.contractual_notice_value} ${p.contractual_notice_unit}`;
  } else {
    const weeks = service.years < 2 ? (s?.a ?? 4) : service.years < 5 ? (s?.b ?? 6) : (s?.c ?? 8);
    days = weeks * 7;
    basis = `${weeks} weeks (EA s12, ${service.years} year${service.years === 1 ? '' : 's'}' service)`;
  }
  const expected = addDays(noticeDate, days - 1);
  const useLwd = lwd ?? expected;
  const served = Math.round((Date.parse(useLwd) - Date.parse(noticeDate)) / 86_400_000) + 1;
  const reportees = (await sql<{ n: number }>`select count(*)::int as n from app.employees where manager_employee_id = ${employeeId}::uuid
      and status in ('pending_join','on_probation','confirmed','notice_period')`.execute(tx)).rows[0]?.n ?? 0;
  // W2-004: open approvals where this person is the approver ("will re-route") and BR-LV-43 maternity-period warning
  const pendingApprovals = (await sql<{ n: number }>`select count(*)::int as n from app.approval_tasks t join app.app_users u on u.id = t.assignee_user_id
      where t.status = 'open' and u.employee_id = ${employeeId}::uuid`.execute(tx)).rows[0]?.n ?? 0;
  const warnings: string[] = [];
  const maternity = (await sql<{ n: number }>`select count(*)::int as n from app.leave_applications a join app.leave_types t on t.id = a.leave_type_id
      where a.employee_id = ${employeeId}::uuid and t.category = 'maternity' and a.status in ('approved','cancellation_pending','pending')
        and ${noticeDate}::date <= a.end_date and ${useLwd}::date >= a.start_date - 30`.execute(tx)).rows[0]?.n ?? 0;
  if (maternity) warnings.push('The employee is on or near maternity leave — check s41A protections before recording a termination (BR-LV-43).');
  return {
    noticeRequiredDays: days, noticeBasis: basis, expectedLastWorkingDay: expected, shortfallDays: Math.max(0, days - served),
    statusAfter: useLwd < today ? 'separated' : 'notice_period', defaultPortalAccessEnd: useLwd, maxPortalAccessEnd: addDays(useLwd, 30),
    reporteeCount: reportees, leavePosition: await leaverPositionFor(tx, employeeId, useLwd), pendingApprovals, openClaims: await openClaimsFor(tx, employeeId), warnings,
  };
}

// ===========================================================================
// E11 Documents / P19 My documents / E16 notes
// ===========================================================================
type DocDb = { id: string; employee_id: string; title: string; category: EmployeeDocumentRow['category']; document_date: string | null; expiry_date: string | null; visible_to_employee: boolean; remarks: string | null; file_id: string; original_name: string; mime_type: string; size_bytes: number; created_at: Date; created_by: string | null; is_active: boolean; version: number };
export async function documentRows(tx: Tx, params: DocumentListParams, all = false): Promise<Paged<EmployeeDocumentRow>> {
  const p = parseParams(documentListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    sql`d.employee_id = ${p.employeeId}::uuid`,
    ...(q ? [sql`(d.title ilike ${q} or f.original_name ilike ${q})`] : []),
    ...(p.categories?.length ? [sql`d.category::text = any(${p.categories}::text[])`] : []),
    ...(p.visible === 'visible' ? [sql`d.visible_to_employee`] : p.visible === 'hidden' ? [sql`not d.visible_to_employee`] : []),
    ...(p.active === 'active' ? [sql`d.is_active`] : p.active === 'inactive' ? [sql`not d.is_active`] : []),
  ]);
  const sort: Record<string, string> = { title: 'd.title', category: 'd.category', documentDate: 'd.document_date', expiryDate: 'd.expiry_date', uploadedAt: 'd.created_at' };
  const from = sql`app.employee_documents d join app.files f on f.id = d.file_id`;
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<DocDb>`select d.id, d.employee_id, d.title, d.category::text as category, d.document_date, d.expiry_date, d.visible_to_employee,
      d.remarks, d.file_id, f.original_name, f.mime_type, f.size_bytes, d.created_at, d.created_by, d.is_active, d.version
      from ${from} where ${where} order by ${sql.raw(sort[p.sort] ?? 'd.created_at')} ${dirOf(p.dir)} nulls last limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const names = await resolveNames(tx, rows.rows.map((r) => r.created_by));
  return {
    rows: rows.rows.map((d) => ({
      id: d.id, employeeId: d.employee_id, title: d.title, category: d.category, documentDate: d.document_date, expiryDate: d.expiry_date,
      visibleToEmployee: d.visible_to_employee, isHrOnlyCategory: HR_ONLY_DOCUMENT_CATEGORIES.includes(d.category), remarks: d.remarks,
      file: { fileId: d.file_id, fileName: d.original_name, mimeType: d.mime_type, sizeBytes: d.size_bytes },
      uploadedAt: iso(d.created_at)!, uploadedByName: d.created_by ? names.get(d.created_by) ?? null : null, isActive: d.is_active, version: d.version,
    })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listEmployeeDocuments(params: DocumentListParams): Promise<Paged<EmployeeDocumentRow>> {
  const { ctx } = await authorize(EMP_ADMIN);
  return withUserTx(ctx, (tx) => documentRows(tx, params));
}
export async function myDocumentRows(tx: Tx, params: MyDocumentListParams, all = false): Promise<Paged<MyDocumentRow>> {
  const p = parseParams(myDocumentListParamsSchema, params);
  const me = await currentEmployeeId(tx);
  if (!me) return { rows: [], total: 0, page: 1, pageSize: p.pageSize };
  const q = likeTerm(p.q);
  // RLS already limits the employee to visible + active rows (documents_select)
  const where = and([
    sql`d.employee_id = ${me}::uuid and d.visible_to_employee and d.is_active`,
    ...(q ? [sql`d.title ilike ${q}`] : []),
    ...(p.categories?.length ? [sql`d.category::text = any(${p.categories}::text[])`] : []),
  ]);
  const sort: Record<string, string> = { title: 'd.title', category: 'd.category', documentDate: 'd.document_date', uploadedAt: 'd.created_at' };
  const from = sql`app.employee_documents d join app.files f on f.id = d.file_id`;
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<DocDb>`select d.id, d.employee_id, d.title, d.category::text as category, d.document_date, d.expiry_date, d.file_id,
      f.original_name, f.mime_type, f.size_bytes, d.created_at from ${from} where ${where}
      order by ${sql.raw(sort[p.sort] ?? 'd.created_at')} ${dirOf(p.dir)} nulls last limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return {
    rows: rows.rows.map((d) => ({ id: d.id, employeeId: d.employee_id, title: d.title, category: d.category, documentDate: d.document_date,
      expiryDate: d.expiry_date, file: { fileId: d.file_id, fileName: d.original_name, mimeType: d.mime_type, sizeBytes: d.size_bytes }, uploadedAt: iso(d.created_at)! })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listMyDocuments(params: MyDocumentListParams): Promise<Paged<MyDocumentRow>> {
  const { ctx } = await authorize(ANY_USER);
  return withUserTx(ctx, (tx) => myDocumentRows(tx, params));
}

export async function listHrNotes(employeeId: string): Promise<HrNote[]> {
  const { ctx } = await authorize(EMP_ADMIN);
  if (!UUID_RE.test(employeeId)) return [];
  return withUserTx(ctx, async (tx) => {
    const notes = await sql<{ id: string; note_date: string; body: string; created_by: string | null; created_at: Date; updated_at: Date; updated_by: string | null; version: number }>`
      select id, note_date, body, created_by, created_at, updated_at, updated_by, version from app.hr_notes where employee_id = ${employeeId}::uuid
       order by note_date desc, created_at desc`.execute(tx);
    const revs = await sql<{ note_id: string; revision: number; body: string; edited_by: string | null; edited_at: Date }>`
      select note_id, revision, body, edited_by, edited_at from app.hr_note_revisions where employee_id = ${employeeId}::uuid order by revision desc`.execute(tx);
    const names = await resolveNames(tx, [...notes.rows.flatMap((n) => [n.created_by, n.updated_by]), ...revs.rows.map((r) => r.edited_by)]);
    return notes.rows.map((n) => {
      const rs = revs.rows.filter((r) => r.note_id === n.id);
      return {
        id: n.id, noteDate: n.note_date, body: n.body, createdByName: n.created_by ? names.get(n.created_by) ?? null : null, createdAt: iso(n.created_at)!,
        updatedAt: iso(n.updated_at)!, updatedByName: n.updated_by ? names.get(n.updated_by) ?? null : null, isEdited: rs.length > 0, version: n.version,
        revisions: rs.map((r) => ({ revision: r.revision, body: r.body, editedByName: r.edited_by ? names.get(r.edited_by) ?? null : null, editedAt: iso(r.edited_at)! })),
      };
    });
  });
}

// ===========================================================================
// E3 Activity log (F-EMP-28) and field changes (F-EMP-21)
// ===========================================================================
type TrailDb = { source: 'audit' | 'access'; id: string; occurred_at: Date; actor_user_id: string | null; actor_label: string | null; action: string; entity_type: string; entity_id: string | null; entity_ref: string | null; changes: Record<string, [unknown, unknown]> | null; reason: string | null; on_behalf: boolean };
const ENTITY_EVENT: Record<string, ActivityEventType> = {
  employees: 'personal', employee_personal: 'personal', employee_sensitive: 'personal', employee_marital_history: 'personal',
  employee_emergency_contacts: 'contact', employee_spouses: 'family', employee_children: 'family', employee_job_history: 'job_change',
  employee_hr_private: 'job_change', employee_group_members: 'job_change', probation_recommendations: 'probation',
  employee_separations: 'separation', employee_separation_details: 'separation', employee_statutory_profiles: 'statutory',
  employee_statutory_employer_flags: 'statutory', employee_bank_accounts: 'bank', employee_documents: 'document', files: 'document',
  change_requests: 'change_request', change_request_items: 'change_request', change_request_files: 'change_request',
  hr_notes: 'note', hr_note_revisions: 'note', app_users: 'invited', user_invitations: 'invited', prior_employments: 'personal',
};
const TABLE_LABEL: Record<string, string> = {
  employees: 'Employee', employee_personal: 'Personal', employee_sensitive: 'Sensitive', employee_marital_history: 'Marital status',
  employee_emergency_contacts: 'Emergency contact', employee_spouses: 'Spouse', employee_children: 'Child', employee_job_history: 'Job history',
  employee_hr_private: 'Employment (HR)', employee_group_members: 'Employee group', probation_recommendations: 'Probation recommendation',
  employee_separations: 'Separation', employee_separation_details: 'Separation details', employee_statutory_profiles: 'Statutory profile',
  employee_statutory_employer_flags: 'Employer statutory flags', employee_bank_accounts: 'Bank details', employee_documents: 'Document',
  change_requests: 'Change request', change_request_items: 'Change request item', hr_notes: 'HR note', prior_employments: 'Prior employment',
};
const fieldLabel = (f: string) => f.replace(/_enc$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
function eventTypeOf(r: TrailDb): ActivityEventType {
  if (r.source === 'access') return 'access';
  if (r.entity_type === 'employees' && r.action === 'create') return 'created';
  if (r.entity_type === 'employee_job_history' && (r.entity_ref === 'confirmation')) return 'probation';
  if (r.entity_type === 'employee_job_history' && (r.entity_ref === 'separation')) return 'separation';
  return ENTITY_EVENT[r.entity_type] ?? 'other';
}
function eventText(r: TrailDb): string {
  if (r.source === 'access') return `${r.action.replace(/_/g, ' ')} · ${r.entity_type}${r.entity_ref ? ` (${r.entity_ref})` : ''}`;
  const t = TABLE_LABEL[r.entity_type] ?? r.entity_type;
  if (r.entity_type === 'employee_job_history') return `Job change (${JOB_CHANGE_TYPE_LABELS[r.entity_ref as keyof typeof JOB_CHANGE_TYPE_LABELS] ?? r.entity_ref ?? ''})${r.action === 'create' ? '' : ' updated'}`;
  if (r.entity_type === 'change_requests') return `${r.entity_ref ?? 'Change request'} ${r.action === 'create' ? 'submitted' : r.action === 'status_change' ? String((r.changes?.status ?? [])[1] ?? 'updated') : 'updated'}`;
  if (r.entity_type === 'employees' && r.action === 'create') return 'Employee record created';
  return `${t} ${r.action === 'create' ? 'added' : r.action === 'delete_draft' ? 'removed' : r.action === 'status_change' ? 'status changed' : 'updated'}`;
}
async function trail(tx: Tx, p: ReturnType<typeof activityParamsSchema.parse>): Promise<TrailDb[]> {
  return (await sql<TrailDb>`select source, id::text as id, occurred_at, actor_user_id, actor_label, action::text as action, entity_type, entity_id,
      entity_ref, changes, reason, on_behalf from audit.employee_trail(${p.employeeId}::uuid, ${p.from ?? null}::date, ${p.to ?? null}::date)`.execute(tx)).rows;
}
const SKIP_FIELDS = new Set(['id', 'employee_id', 'version', 'created_at', 'created_by', 'updated_at', 'updated_by', 'change_request_id', 'note_id', 'separation_id']);
function show(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}
export async function activityRows(tx: Tx, params: ActivityParams, all = false): Promise<Paged<ActivityRow>> {
  const p = parseParams(activityParamsSchema, params);
  let rows = (await trail(tx, p)).map((r) => ({ r, type: eventTypeOf(r) }));
  if (p.eventTypes?.length) rows = rows.filter((x) => p.eventTypes!.includes(x.type));
  if (p.dir === 'asc') rows.reverse();
  const total = rows.length;
  const slice = all ? rows : rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize);
  const names = await resolveNames(tx, slice.map((x) => x.r.actor_user_id));
  return {
    rows: slice.map(({ r, type }) => ({
      key: `${r.source}:${r.id}`, occurredAt: iso(r.occurred_at)!, eventType: type, event: eventText(r), action: r.action,
      entityType: r.entity_type, entityRef: r.entity_ref,
      actorName: r.actor_user_id ? names.get(r.actor_user_id) ?? null : r.actor_label === 'system:employee-daily' ? 'System (daily job)' : 'System',
      onBehalf: r.on_behalf,
      link: r.entity_type === 'change_requests' && r.entity_ref ? `/employees/change-requests/${r.entity_ref}` : null,
    })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function fieldChangeRows(tx: Tx, params: ActivityParams, all = false): Promise<Paged<FieldChangeRow>> {
  const p = parseParams(activityParamsSchema, params);
  const out: FieldChangeRow[] = [];
  for (const r of await trail(tx, p)) {
    if (r.source !== 'audit' || !r.changes) continue;
    if (p.eventTypes?.length && !p.eventTypes.includes(eventTypeOf(r))) continue;
    for (const [field, pair] of Object.entries(r.changes)) {
      if (SKIP_FIELDS.has(field) || field.endsWith('_bidx') || field.endsWith('_last4')) continue;
      const [b, a] = Array.isArray(pair) ? pair : [null, pair];
      const masked = field.endsWith('_enc') || ['religion', 'is_oku', 'oku_card_no'].includes(field);
      const last4 = field.endsWith('_enc') ? (r.changes[field.replace(/_enc$/, '_last4')] as unknown[] | undefined) : undefined;
      out.push({
        key: `${r.id}:${field}`, occurredAt: iso(r.occurred_at)!, table: TABLE_LABEL[r.entity_type] ?? r.entity_type, field, label: fieldLabel(field),
        before: masked ? (last4?.[0] ? `••••${String(last4[0])}` : b == null ? null : '••••') : show(b),
        after: masked ? (last4?.[1] ? `••••${String(last4[1])}` : a == null ? null : '••••') : show(a),
        masked, actorName: r.actor_user_id, source: r.actor_label?.startsWith('system') ? 'System' : r.reason ? `Direct edit — ${r.reason}` : 'Direct edit',
      });
    }
  }
  if (p.dir === 'asc') out.reverse();
  const slice = all ? out : out.slice((p.page - 1) * p.pageSize, p.page * p.pageSize);
  const names = await resolveNames(tx, slice.map((x) => x.actorName));
  return { rows: slice.map((x) => ({ ...x, actorName: x.actorName ? names.get(x.actorName) ?? null : 'System' })), total: out.length, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}
export async function listEmployeeActivity(params: ActivityParams): Promise<Paged<ActivityRow>> {
  const { ctx } = await authorize(EMP_ADMIN);
  return withUserTx(ctx, (tx) => activityRows(tx, params));
}
export async function listEmployeeFieldChanges(params: ActivityParams): Promise<Paged<FieldChangeRow>> {
  const { ctx } = await authorize(EMP_ADMIN);
  return withUserTx(ctx, (tx) => fieldChangeRows(tx, params));
}

// ===========================================================================
// E12/E13 Change requests (+ P18 own)
// ===========================================================================
type CrDb = { id: string; cr_no: string; employee_id: string; employee_no: string; full_name: string; preferred_name: string | null; category: CrCategory; created_at: Date; effective_date: string; status: CrStatus; files: number; decided_at: Date | null; decided_by: string | null; applied_at: Date | null; employee_remarks: string | null; decision_remarks: string | null; version: number };
export async function changeRequestRows(tx: Tx, params: ChangeRequestListParams, own: boolean, all = false): Promise<Paged<ChangeRequestRow>> {
  const p = parseParams(changeRequestListParamsSchema, params);
  const me = await currentEmployeeId(tx);
  if (own && !me) return { rows: [], total: 0, page: 1, pageSize: p.pageSize };
  const q = likeTerm(p.q);
  const statuses = p.statuses?.length ? p.statuses : own ? null : ['submitted'];
  const where = and([
    ...(own ? [sql`c.employee_id = ${me}::uuid`] : []),
    ...(q ? [sql`(c.cr_no ilike ${q} or e.employee_no ilike ${q} or e.full_name ilike ${q})`] : []),
    ...(statuses ? [sql`c.status::text = any(${statuses}::text[])`] : []),
    ...(p.categories?.length ? [sql`c.category::text = any(${p.categories}::text[])`] : []),
    ...(p.submittedFrom ? [sql`(c.created_at at time zone 'Asia/Kuala_Lumpur')::date >= ${p.submittedFrom}::date`] : []),
    ...(p.submittedTo ? [sql`(c.created_at at time zone 'Asia/Kuala_Lumpur')::date <= ${p.submittedTo}::date`] : []),
    ...(p.employeeId && !own ? [sql`c.employee_id = ${p.employeeId}::uuid`] : []),
  ]);
  const sort: Record<string, string> = { crNo: 'c.cr_no', employee: 'e.full_name', category: 'c.category', submittedAt: 'c.created_at', effectiveDate: 'c.effective_date', status: 'c.status' };
  const from = sql`app.change_requests c join app.employees e on e.id = c.employee_id`;
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<CrDb>`select c.*, c.category::text as category, c.status::text as status, e.employee_no, e.full_name, e.preferred_name,
      (select count(*)::int from app.change_request_files f where f.change_request_id = c.id) as files
      from ${from} where ${where} order by ${sql.raw(sort[p.sort] ?? 'c.created_at')} ${dirOf(p.dir)} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const names = await resolveNames(tx, rows.rows.map((r) => r.decided_by));
  return { rows: rows.rows.map((r) => mapCr(r, names, me)), total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}
const mapCr = (r: CrDb, names: Map<string, string>, me: string | null): ChangeRequestRow => ({
  id: r.id, crNo: r.cr_no, employee: { id: r.employee_id, employeeNo: r.employee_no, name: displayName(r.full_name, r.preferred_name) },
  category: r.category, submittedAt: iso(r.created_at)!, effectiveDate: r.effective_date, status: r.status, attachmentCount: r.files,
  decidedAt: iso(r.decided_at), decidedByName: r.decided_by ? names.get(r.decided_by) ?? null : null, appliedAt: iso(r.applied_at), isOwn: r.employee_id === me,
});
export async function listChangeRequests(params: ChangeRequestListParams): Promise<Paged<ChangeRequestRow>> {
  const { ctx } = await authorize(EMP_ADMIN);
  return withUserTx(ctx, (tx) => changeRequestRows(tx, params, false));
}
export async function listMyChangeRequests(params: ChangeRequestListParams): Promise<Paged<ChangeRequestRow>> {
  const { ctx } = await authorize(ANY_USER);
  return withUserTx(ctx, (tx) => changeRequestRows(tx, params, true));
}

export async function changeRequestDetail(tx: Tx, crNo: string, own: boolean, isAdmin: boolean): Promise<ChangeRequestDetail | null> {
  const me = await currentEmployeeId(tx);
  const r = (await sql<CrDb>`select c.*, c.category::text as category, c.status::text as status, e.employee_no, e.full_name, e.preferred_name,
      (select count(*)::int from app.change_request_files f where f.change_request_id = c.id) as files
      from app.change_requests c join app.employees e on e.id = c.employee_id where c.cr_no = ${crNo}`.execute(tx)).rows[0];
  if (!r || (own && r.employee_id !== me)) return null;
  const items = await sql<{ id: string; target_table: string; field_name: string; field_label: string | null; group_label: string | null; op: 'update' | 'insert' | 'remove'; current_display: string | null; new_value: unknown; new_value_last4: string | null; new_value_enc: Buffer | null }>`
    select id, target_table, field_name, field_label, group_label, op, current_display, new_value, new_value_last4, new_value_enc
      from app.change_request_items where change_request_id = ${r.id}::uuid order by group_label nulls first, field_label`.execute(tx);
  const files = await sql<{ file_id: string; original_name: string; mime_type: string; size_bytes: number }>`
    select f.id as file_id, f.original_name, f.mime_type, f.size_bytes from app.change_request_files cf join app.files f on f.id = cf.file_id
     where cf.change_request_id = ${r.id}::uuid`.execute(tx);
  const names = await resolveNames(tx, [r.decided_by]);
  const warnings: string[] = [];
  if (r.category === 'bank_details' && isAdmin) {
    const holder = items.rows.find((i) => i.field_name === 'account_holder_name')?.new_value;
    if (typeof holder === 'string' && holder.trim().toLowerCase().replace(/\s+/g, ' ') !== r.full_name.trim().toLowerCase().replace(/\s+/g, ' '))
      warnings.push("Account holder name differs from the employee's name — joint or third-party accounts are discouraged.");
    const acc = items.rows.find((i) => i.field_name === 'account_no');
    if (acc) {
      const bidx = (await sql<{ b: Buffer | null }>`select new_value_bidx as b from app.change_request_items where id = ${acc.id}::uuid`.execute(tx)).rows[0]?.b;
      const shared = bidx ? (await sql<{ no: string }>`select distinct e.employee_no as no from app.employee_bank_accounts b join app.employees e on e.id = b.employee_id
          where b.account_no_bidx = ${bidx} and b.employee_id <> ${r.employee_id}::uuid`.execute(tx)).rows : [];
      if (shared.length) warnings.push(`This account is also used by ${shared.map((s) => s.no).join(', ')} (EC-EMP-12).`);
    }
  }
  const sensitive = (f: string) => ['nric', 'account_no', 'asnb_account_no'].includes(f);
  const itemViews: ChangeRequestItemView[] = items.rows.map((i) => ({
    id: i.id, field: i.field_name, label: i.field_label ?? fieldLabel(i.field_name), op: i.op, group: i.group_label,
    currentDisplay: i.current_display,
    requestedDisplay: i.op === 'remove' ? 'Remove' : sensitive(i.field_name)
      ? (i.field_name === 'nric' ? maskMykad(i.new_value_last4) : maskAccount(i.new_value_last4))
      : i.new_value == null ? null : typeof i.new_value === 'string' ? i.new_value : JSON.stringify(i.new_value),
    isSensitive: sensitive(i.field_name), validation: { ok: true, message: null },
  }));
  const isOwnCr = r.employee_id === me;
  return {
    ...mapCr(r, names, me), items: itemViews,
    files: files.rows.map((f) => ({ fileId: f.file_id, fileName: f.original_name, mimeType: f.mime_type, sizeBytes: f.size_bytes })),
    employeeRemarks: r.employee_remarks, decisionRemarks: r.decision_remarks, warnings, version: r.version,
    can: {
      decide: isAdmin && !isOwnCr && r.status === 'submitted', cancel: isOwnCr && r.status === 'submitted',
      reveal: (isAdmin && !isOwnCr) || (isOwnCr && r.status === 'submitted'), viewFiles: isAdmin || (isOwnCr && r.status === 'submitted'),
    },
  };
}
export async function getChangeRequest(crNo: string): Promise<ChangeRequestDetail | null> {
  const { user, ctx } = await authorize(EMP_ADMIN);
  if (!/^CR-\d{4}-\d{5,}$/.test(crNo)) return null;
  return withUserTx(ctx, async (tx) => {
    const d = await changeRequestDetail(tx, crNo, false, true);
    if (!d) await logDenied(tx, 'change_request', crNo);
    if (d) {
      await logRecordOpen(tx, user, 'change_request', d.id, d.employee.id);
      // BR-ADM-21: an HR view of special-category values (religion / OKU) is always access-logged
      if ((d.category === 'religion' || d.category === 'oku') && !d.isOwn) {
        await writeAccess(tx, { action: 'view_sensitive', entityType: 'change_request', entityId: d.id, entityRef: d.crNo,
          employeeIds: [d.employee.id], fields: d.items.map((i) => i.field), categories: d.category === 'religion' ? ['religion'] : ['health'],
          reason: 'Change request review' });
      }
    }
    return d;
  });
}
export async function getMyChangeRequest(crNo: string): Promise<ChangeRequestDetail | null> {
  const { ctx } = await authorize(ANY_USER);
  if (!/^CR-\d{4}-\d{5,}$/.test(crNo)) return null;
  return withUserTx(ctx, async (tx) => {
    const d = await changeRequestDetail(tx, crNo, true, false);
    if (!d) await logDenied(tx, 'change_request', crNo);
    return d;
  });
}

export const CR_LABEL = CR_CATEGORY_LABELS;
export const DOC_LABEL = DOCUMENT_CATEGORY_LABELS;
export const STATE_LABEL = MY_STATE_LABELS;
