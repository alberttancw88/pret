import 'server-only';
import type { z } from 'zod';
import { sql, withUserTx, type Tx } from '../db';
import type { Role } from '../auth/current-user';
import { authorize, hasRole, iso, likeTerm, resolveNames, stamps } from '../lib/action-helpers';
import {
  costCentreListParamsSchema, departmentListParamsSchema, gradeListParamsSchema, groupListParamsSchema,
  holidayListParamsSchema, locationListParamsSchema, patternListParamsSchema, positionListParamsSchema,
  GL_PURPOSES, GL_PURPOSE_LABELS, yearSchema,
  type CalendarStatus, type CompanyProfileView, type CompulsoryHoliday, type CopyToNextYearPreview, type CostCentreDetail,
  type CostCentreListParams, type CostCentreRow, type DayType, type DepartmentDetail, type DepartmentListParams,
  type DepartmentRow, type EmployeeGroupDetail, type EmployeeGroupRow, type GlPurpose, type GradeDetail,
  type GradeListParams, type GradeRow, type GroupListParams, type HolidayDetail, type HolidayListParams, type HolidayRow,
  type HolidayType, type HolidayYearSummary, type LocationDetail, type LocationListParams, type LocationRow,
  type MonthDayBasis, type MyState, type OrgOptions, type Paged, type PatternListParams, type PatternVersion,
  type PositionDetail, type PositionListParams, type PositionRow, type SystemSettings, type WorkingPatternDetail,
  type WorkingPatternRow,
} from '../contracts/org';
import { MY_STATES } from '../contracts/common';

// M5 Organisation queries (W2-002). Server-only — call from Server Components / Server Actions.
// Every function calls requireUser([...]) (via authorize) and reads under RLS (withUserTx).
// The *Rows(tx, params, all) helpers are shared with the CSV export actions.

export const ORG_ADMIN: Role[] = ['ADM', 'SA'];
export const EXPORT_LIMIT = 10_000;

type Where = ReturnType<typeof sql>;
function and(conds: Where[]): Where {
  return conds.length ? sql.join(conds, sql` and `) : sql`true`;
}
function pageOf(p: { page: number; pageSize: number }, all: boolean) {
  return all ? { limit: EXPORT_LIMIT, offset: 0 } : { limit: p.pageSize, offset: (p.page - 1) * p.pageSize };
}
function dirOf(d: 'asc' | 'desc') {
  return d === 'desc' ? sql.raw('desc') : sql.raw('asc');
}
function activeCond(col: string, active: 'all' | 'active' | 'inactive'): Where[] {
  if (active === 'active') return [sql`${sql.ref(col)} = true`];
  if (active === 'inactive') return [sql`${sql.ref(col)} = false`];
  return [];
}
export function parseParams<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input ?? {});
  if (!r.success) throw new Error('PRET-PARAMS: invalid list parameters');
  return r.data;
}
async function count(tx: Tx, from: Where, where: Where): Promise<number> {
  const r = await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx);
  return r.rows[0]?.n ?? 0;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function dayOfWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

// ===========================================================================
// O1 Company profile
// ===========================================================================
type ProfileRowDb = {
  legal_name: string; phone: string | null; email: string | null; website: string | null;
  biz_addr_line1: string; biz_addr_line2: string | null; biz_addr_line3: string | null; biz_postcode: string;
  biz_city: string; biz_state: MyState; biz_country: string; logo_file_id: string | null; version: number;
  created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null;
};
type StatutoryRowDb = {
  ssm_no_new: string; ssm_no_old: string | null; reg_addr_line1: string; reg_addr_line2: string | null; reg_addr_line3: string | null;
  reg_postcode: string; reg_city: string; reg_state: MyState; reg_country: string; epf_employer_no: string | null;
  socso_employer_code: string | null; lhdn_e_no: string | null; company_tax_no: string | null; hrdf_registered: boolean;
  hrdf_levy_rate: string | null; hrdf_mycoid: string | null; hlb_account_name: string | null; hlb_account_no_last4: string | null;
  version: number; created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null;
};

export async function getCompanyProfile(): Promise<CompanyProfileView> {
  const { user, ctx } = await authorize(['EMP', 'MGR', 'ADM', 'SA']);
  const isSa = hasRole(user, 'SA');
  const isAdmin = isSa || hasRole(user, 'ADM');
  return withUserTx(ctx, async (tx) => {
    const p = (await sql<ProfileRowDb>`select * from app.company_profile where id = 1`.execute(tx)).rows[0];
    const s = (await sql<StatutoryRowDb>`select * from app.company_statutory where id = 1`.execute(tx)).rows[0];
    const zakat = await sql<{ id: string; zakat_body_id: string; name: string; state: MyState; employer_ref: string }>`
      select r.id, r.zakat_body_id, b.name, b.state, r.employer_ref
        from app.company_zakat_registrations r join app.zakat_bodies b on b.id = r.zakat_body_id
       order by b.name`.execute(tx);
    const sig = await sql<{ id: string; name: string; designation: string; signature_file_id: string | null; display_order: number; is_active: boolean }>`
      select id, name, designation, signature_file_id, display_order, is_active from app.company_signatories
       order by display_order, name`.execute(tx);
    const gl = await sql<{ purpose: GlPurpose; gl_account_code: string }>`select purpose, gl_account_code from app.gl_mappings`.execute(tx);
    const names = await resolveNames(tx, [p?.created_by, p?.updated_by, s?.created_by, s?.updated_by]);
    const glMap = new Map(gl.rows.map((r) => [r.purpose, r.gl_account_code]));
    const profile = p
      ? {
          legalName: p.legal_name, phone: p.phone, email: p.email, website: p.website,
          businessAddress: { line1: p.biz_addr_line1, line2: p.biz_addr_line2, line3: p.biz_addr_line3, postcode: p.biz_postcode, city: p.biz_city, state: p.biz_state, country: p.biz_country },
          logoFileId: p.logo_file_id, version: p.version, ...stamps(p, names),
        }
      : {
          legalName: '', phone: null, email: null, website: null,
          businessAddress: { line1: '', line2: null, line3: null, postcode: '', city: '', state: 'SGR' as MyState, country: 'Malaysia' },
          logoFileId: null, version: 0, createdAt: null, createdByName: null, updatedAt: null, updatedByName: null,
        };
    return {
      profile,
      statutory: s
        ? {
            ssmNoNew: s.ssm_no_new, ssmNoOld: s.ssm_no_old,
            registeredAddress: { line1: s.reg_addr_line1, line2: s.reg_addr_line2, line3: s.reg_addr_line3, postcode: s.reg_postcode, city: s.reg_city, state: s.reg_state, country: s.reg_country },
            epfEmployerNo: s.epf_employer_no, socsoEmployerCode: s.socso_employer_code, lhdnENo: s.lhdn_e_no, companyTaxNo: s.company_tax_no,
            hrdfRegistered: s.hrdf_registered,
            hrdfLevyRatePct: s.hrdf_levy_rate == null ? null : Number(s.hrdf_levy_rate) === 1 ? 1 : 0.5,
            hrdfMycoid: s.hrdf_mycoid, hlbAccountName: s.hlb_account_name,
            hlbAccountNoMasked: s.hlb_account_no_last4 ? `••••${s.hlb_account_no_last4}` : null,
            version: s.version, ...stamps(s, names),
          }
        : null,
      zakatRegistrations: zakat.rows.map((r) => ({ id: r.id, zakatBodyId: r.zakat_body_id, zakatBodyName: r.name, state: r.state, employerRef: r.employer_ref })),
      signatories: sig.rows.map((r) => ({ id: r.id, name: r.name, designation: r.designation, signatureFileId: r.signature_file_id, displayOrder: r.display_order, isActive: r.is_active })),
      glMappings: GL_PURPOSES.map((purpose) => ({ purpose, label: GL_PURPOSE_LABELS[purpose].label, release: GL_PURPOSE_LABELS[purpose].release, glAccountCode: glMap.get(purpose) ?? null })),
      can: { editRegistration: isSa, editStatutory: isSa, editContact: isAdmin, editGl: isAdmin, revealAccount: isAdmin && !!s?.hlb_account_no_last4 },
    };
  });
}

/** Signed URL for the company logo (any signed-in user; company_asset files are readable by all active users). */
export async function getCompanyLogoUrl(): Promise<string | null> {
  const { ctx, accessToken } = await authorize(['EMP', 'MGR', 'ADM', 'SA']);
  const fileId = await withUserTx(ctx, async (tx) =>
    (await sql<{ logo_file_id: string | null }>`select logo_file_id from app.company_profile where id = 1`.execute(tx)).rows[0]?.logo_file_id ?? null);
  if (!fileId) return null;
  try {
    const { getDownloadUrl } = await import('../storage');
    return (await getDownloadUrl(ctx, accessToken, fileId, { purpose: 'view' })).url;
  } catch {
    return null;
  }
}

// ===========================================================================
// O2 Departments
// ===========================================================================
type DeptDb = {
  id: string; code: string; name: string; parent_id: string | null; parent_name: string | null; head_employee_id: string | null;
  cost_centre_id: string | null; cost_centre_name: string | null; is_active: boolean;
  created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null;
};
const DEPT_SORT: Record<string, string> = { code: 'd.code', name: 'd.name', parent: 'p.name' };
const mapDept = (r: DeptDb): DepartmentRow => ({
  id: r.id, code: r.code, name: r.name, parentId: r.parent_id, parentName: r.parent_name,
  headEmployeeId: r.head_employee_id, headName: null, costCentreId: r.cost_centre_id, costCentreName: r.cost_centre_name,
  activeHeadcount: null, isActive: r.is_active,
});

export async function departmentRows(tx: Tx, params: DepartmentListParams, all = false): Promise<Paged<DepartmentRow>> {
  const p = parseParams(departmentListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    ...(q ? [sql`(d.code ilike ${q} or d.name ilike ${q})`] : []),
    ...activeCond('d.is_active', p.active),
    ...(p.parentId ? [sql`d.parent_id = ${p.parentId}::uuid`] : []),
  ]);
  const from = sql`app.departments d left join app.departments p on p.id = d.parent_id left join app.cost_centres cc on cc.id = d.cost_centre_id`;
  const { limit, offset } = pageOf(p, all);
  const rows = await sql<DeptDb>`
    select d.*, p.name as parent_name, cc.name as cost_centre_name from ${from} where ${where}
     order by ${sql.raw(DEPT_SORT[p.sort] ?? 'd.code')} ${dirOf(p.dir)} nulls last, d.code
     limit ${limit} offset ${offset}`.execute(tx);
  return { rows: rows.rows.map(mapDept), total: await count(tx, from, where), page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}

export async function listDepartments(params: DepartmentListParams): Promise<Paged<DepartmentRow>> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, (tx) => departmentRows(tx, params));
}

export async function getDepartment(id: string): Promise<DepartmentDetail | null> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const r = (await sql<DeptDb>`
      select d.*, p.name as parent_name, cc.name as cost_centre_name
        from app.departments d left join app.departments p on p.id = d.parent_id left join app.cost_centres cc on cc.id = d.cost_centre_id
       where d.id = ${id}::uuid`.execute(tx)).rows[0];
    if (!r) return null;
    const names = await resolveNames(tx, [r.created_by, r.updated_by]);
    return { ...mapDept(r), ...stamps(r, names) };
  });
}

// ===========================================================================
// O3 Positions
// ===========================================================================
type PosDb = {
  id: string; code: string; title: string; default_department_id: string | null; department_name: string | null;
  default_grade_id: string | null; grade_name: string | null; description: string | null; is_active: boolean;
  created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null;
};
const POS_SORT: Record<string, string> = { code: 'x.code', title: 'x.title', department: 'd.name', grade: 'g.rank' };
const mapPos = (r: PosDb): PositionRow => ({
  id: r.id, code: r.code, title: r.title, defaultDepartmentId: r.default_department_id, defaultDepartmentName: r.department_name,
  defaultGradeId: r.default_grade_id, defaultGradeName: r.grade_name, headcount: null, isActive: r.is_active,
});
const POS_FROM = sql`app.positions x left join app.departments d on d.id = x.default_department_id left join app.grades g on g.id = x.default_grade_id`;

export async function positionRows(tx: Tx, params: PositionListParams, all = false): Promise<Paged<PositionRow>> {
  const p = parseParams(positionListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    ...(q ? [sql`(x.code ilike ${q} or x.title ilike ${q})`] : []),
    ...activeCond('x.is_active', p.active),
    ...(p.departmentId ? [sql`x.default_department_id = ${p.departmentId}::uuid`] : []),
    ...(p.gradeId ? [sql`x.default_grade_id = ${p.gradeId}::uuid`] : []),
  ]);
  const { limit, offset } = pageOf(p, all);
  const rows = await sql<PosDb>`
    select x.*, d.name as department_name, g.name as grade_name from ${POS_FROM} where ${where}
     order by ${sql.raw(POS_SORT[p.sort] ?? 'x.code')} ${dirOf(p.dir)} nulls last, x.code
     limit ${limit} offset ${offset}`.execute(tx);
  return { rows: rows.rows.map(mapPos), total: await count(tx, POS_FROM, where), page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}

export async function listPositions(params: PositionListParams): Promise<Paged<PositionRow>> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, (tx) => positionRows(tx, params));
}

export async function getPosition(id: string): Promise<PositionDetail | null> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const r = (await sql<PosDb>`select x.*, d.name as department_name, g.name as grade_name from ${POS_FROM} where x.id = ${id}::uuid`.execute(tx)).rows[0];
    if (!r) return null;
    const names = await resolveNames(tx, [r.created_by, r.updated_by]);
    return { ...mapPos(r), description: r.description, ...stamps(r, names) };
  });
}

// ===========================================================================
// O4 Grades
// ===========================================================================
type GradeDb = { id: string; code: string; name: string; rank: number; is_active: boolean; created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null };
const GRADE_SORT: Record<string, string> = { code: 'g.code', name: 'g.name', rank: 'g.rank' };
const mapGrade = (r: GradeDb): GradeRow => ({ id: r.id, code: r.code, name: r.name, rank: r.rank, headcount: null, isActive: r.is_active });

export async function gradeRows(tx: Tx, params: GradeListParams, all = false): Promise<Paged<GradeRow>> {
  const p = parseParams(gradeListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([...(q ? [sql`(g.code ilike ${q} or g.name ilike ${q})`] : []), ...activeCond('g.is_active', p.active)]);
  const from = sql`app.grades g`;
  const { limit, offset } = pageOf(p, all);
  const rows = await sql<GradeDb>`select g.* from ${from} where ${where}
     order by ${sql.raw(GRADE_SORT[p.sort] ?? 'g.rank')} ${dirOf(p.dir)}, g.code limit ${limit} offset ${offset}`.execute(tx);
  return { rows: rows.rows.map(mapGrade), total: await count(tx, from, where), page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}

export async function listGrades(params: GradeListParams): Promise<Paged<GradeRow>> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, (tx) => gradeRows(tx, params));
}

export async function getGrade(id: string): Promise<GradeDetail | null> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const r = (await sql<GradeDb>`select * from app.grades where id = ${id}::uuid`.execute(tx)).rows[0];
    if (!r) return null;
    return { ...mapGrade(r), ...stamps(r, await resolveNames(tx, [r.created_by, r.updated_by])) };
  });
}

// ===========================================================================
// O5 Work locations
// ===========================================================================
type LocDb = {
  id: string; name: string; addr_line1: string; addr_line2: string | null; addr_line3: string | null; postcode: string; city: string;
  state: MyState; default_pattern_id: string; pattern_name: string; is_active: boolean;
  created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null;
};
const LOC_SORT: Record<string, string> = { name: 'l.name', state: 'l.state', pattern: 'wp.name' };
const LOC_FROM = sql`app.work_locations l join app.working_patterns wp on wp.id = l.default_pattern_id`;
const mapLoc = (r: LocDb): LocationRow => ({
  id: r.id, name: r.name, state: r.state, city: r.city, defaultPatternId: r.default_pattern_id, defaultPatternName: r.pattern_name,
  activeEmployees: null, isActive: r.is_active,
});

export async function locationRows(tx: Tx, params: LocationListParams, all = false): Promise<Paged<LocationRow>> {
  const p = parseParams(locationListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    ...(q ? [sql`(l.name ilike ${q} or l.city ilike ${q})`] : []),
    ...activeCond('l.is_active', p.active),
    ...(p.state?.length ? [sql`l.state::text = any(${p.state}::text[])`] : []),
  ]);
  const { limit, offset } = pageOf(p, all);
  const rows = await sql<LocDb>`select l.*, wp.name as pattern_name from ${LOC_FROM} where ${where}
     order by ${sql.raw(LOC_SORT[p.sort] ?? 'l.name')} ${dirOf(p.dir)}, l.name limit ${limit} offset ${offset}`.execute(tx);
  return { rows: rows.rows.map(mapLoc), total: await count(tx, LOC_FROM, where), page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}

export async function listLocations(params: LocationListParams): Promise<Paged<LocationRow>> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, (tx) => locationRows(tx, params));
}

export async function getLocation(id: string): Promise<LocationDetail | null> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const r = (await sql<LocDb>`select l.*, wp.name as pattern_name from ${LOC_FROM} where l.id = ${id}::uuid`.execute(tx)).rows[0];
    if (!r) return null;
    return {
      ...mapLoc(r),
      address: { line1: r.addr_line1, line2: r.addr_line2, line3: r.addr_line3, postcode: r.postcode, city: r.city, state: r.state, country: 'Malaysia' },
      ...stamps(r, await resolveNames(tx, [r.created_by, r.updated_by])),
    };
  });
}

// ===========================================================================
// O6 Working-week patterns
// ===========================================================================
type VerDb = {
  id: string; pattern_id: string; effective_from: string; mon: DayType; tue: DayType; wed: DayType; thu: DayType; fri: DayType;
  sat: DayType; sun: DayType; hours_per_full_day: string; month_day_basis: MonthDayBasis; created_at: Date; created_by: string | null;
  is_future: boolean;
};
function mapVersion(v: VerDb, names: Map<string, string>): PatternVersion {
  return {
    id: v.id, effectiveFrom: v.effective_from,
    days: { mon: v.mon, tue: v.tue, wed: v.wed, thu: v.thu, fri: v.fri, sat: v.sat, sun: v.sun },
    hoursPerFullDay: v.hours_per_full_day, monthDayBasis: v.month_day_basis, isFuture: v.is_future,
    createdAt: iso(v.created_at)!, createdByName: v.created_by ? names.get(v.created_by) ?? null : 'System',
  };
}
type PatDb = {
  id: string; name: string; is_active: boolean; used_by_locations: number; current_version: VerDb | null;
  created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null;
};
const PAT_SORT: Record<string, string> = { name: 'x.name', effectiveFrom: "x.current_version->>'effective_from'" };

export async function patternRows(tx: Tx, params: PatternListParams, all = false): Promise<Paged<WorkingPatternRow>> {
  const p = parseParams(patternListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([...(q ? [sql`x.name ilike ${q}`] : []), ...activeCond('x.is_active', p.active)]);
  const from = sql`(
    select wp.*,
           (select count(*)::int from app.work_locations l where l.default_pattern_id = wp.id and l.is_active) as used_by_locations,
           (select to_jsonb(v) || jsonb_build_object('is_future', v.effective_from > app.today_myt())
              from app.working_pattern_versions v where v.pattern_id = wp.id
             order by (v.effective_from <= app.today_myt()) desc,
                      case when v.effective_from <= app.today_myt() then v.effective_from end desc nulls last,
                      v.effective_from asc
             limit 1) as current_version
      from app.working_patterns wp) x`;
  const { limit, offset } = pageOf(p, all);
  const rows = await sql<PatDb>`select x.* from ${from} where ${where}
     order by ${sql.raw(PAT_SORT[p.sort] ?? 'x.name')} ${dirOf(p.dir)}, x.name limit ${limit} offset ${offset}`.execute(tx);
  const names = await resolveNames(tx, rows.rows.map((r) => r.current_version?.created_by));
  return {
    rows: rows.rows.map((r) => ({
      id: r.id, name: r.name, isActive: r.is_active, usedByLocations: r.used_by_locations, usedByEmployees: null,
      current: r.current_version ? mapVersion(r.current_version, names) : null,
    })),
    total: await count(tx, from, where), page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}

export async function listWorkingPatterns(params: PatternListParams): Promise<Paged<WorkingPatternRow>> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, (tx) => patternRows(tx, params));
}

export async function getWorkingPattern(id: string): Promise<WorkingPatternDetail | null> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const r = (await sql<{ id: string; name: string; is_active: boolean; created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null }>`
      select * from app.working_patterns where id = ${id}::uuid`.execute(tx)).rows[0];
    if (!r) return null;
    const v = await sql<VerDb>`select v.*, v.effective_from > app.today_myt() as is_future
      from app.working_pattern_versions v where v.pattern_id = ${id}::uuid order by v.effective_from desc`.execute(tx);
    const names = await resolveNames(tx, [r.created_by, r.updated_by, ...v.rows.map((x) => x.created_by)]);
    return { id: r.id, name: r.name, isActive: r.is_active, versions: v.rows.map((x) => mapVersion(x, names)), ...stamps(r, names) };
  });
}

// ===========================================================================
// O7 Public holidays
// ===========================================================================
type HolDb = {
  id: string; kind: 'holiday' | 'replacement'; holiday_date: string; name: string; holiday_type: HolidayType; states: MyState[];
  compulsory: CompulsoryHoliday | null; is_observed: boolean; is_half_day: boolean; remarks: string | null; is_active: boolean;
  source_holiday_id: string | null; source_holiday_name: string | null; pattern_id: string | null; pattern_name: string | null;
};
const mapHol = (r: HolDb): HolidayRow => ({
  id: r.id, kind: r.kind, holidayDate: r.holiday_date, dayOfWeek: dayOfWeek(r.holiday_date), name: r.name,
  holidayType: r.holiday_type, states: r.states, allStates: r.states.length === MY_STATES.length,
  compulsory: r.compulsory, isObserved: r.is_observed, isHalfDay: r.is_half_day, remarks: r.remarks, isActive: r.is_active,
  sourceHolidayId: r.source_holiday_id, sourceHolidayName: r.source_holiday_name, patternId: r.pattern_id, patternName: r.pattern_name,
});
function holidayBase(year: number) {
  return sql`(
    select h.id, 'holiday'::text as kind, h.holiday_date, h.name, h.holiday_type::text as holiday_type,
           array(select s.state::text from app.public_holiday_states s where s.holiday_id = h.id order by s.state) as states,
           h.compulsory::text as compulsory, h.is_observed, h.is_half_day, h.remarks, h.is_active,
           null::uuid as source_holiday_id, null::text as source_holiday_name, null::uuid as pattern_id, null::text as pattern_name
      from app.public_holidays h where h.year = ${year}
    union all
    select r.id, 'replacement', r.replacement_date, h.name || ' (replacement)', 'replacement', array[r.state::text],
           null, true, false, null, r.is_active, h.id, h.name, r.pattern_id, wp.name
      from app.replacement_holidays r
      join app.public_holidays h on h.id = r.source_holiday_id
      join app.working_patterns wp on wp.id = r.pattern_id
     where extract(year from r.replacement_date) = ${year}) x`;
}

export async function holidayRows(tx: Tx, params: HolidayListParams, all = false): Promise<Paged<HolidayRow>> {
  const p = parseParams(holidayListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    ...(q ? [sql`x.name ilike ${q}`] : []),
    ...(p.states?.length ? [sql`x.states && ${p.states}::text[]`] : []),
    ...(p.types?.length ? [sql`x.holiday_type = any(${p.types}::text[])`] : []),
    ...(p.observed === 'yes' ? [sql`x.is_observed`] : p.observed === 'no' ? [sql`not x.is_observed`] : []),
    ...(p.includeInactive ? [] : [sql`x.is_active`]),
  ]);
  const from = holidayBase(p.year);
  const { limit, offset } = pageOf(p, all);
  const order = p.sort === 'name' ? sql`x.name ${dirOf(p.dir)}, x.holiday_date` : sql`x.holiday_date ${dirOf(p.dir)}, x.kind, x.name`;
  const rows = await sql<HolDb>`select x.* from ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`.execute(tx);
  return { rows: rows.rows.map(mapHol), total: await count(tx, from, where), page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}

export async function listHolidays(params: HolidayListParams): Promise<Paged<HolidayRow>> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, (tx) => holidayRows(tx, params));
}

export async function getHoliday(id: string): Promise<HolidayDetail | null> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const h = (await sql<{ year: number; created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null; published: boolean }>`
      select h.year, h.created_at, h.created_by, h.updated_at, h.updated_by, app.holiday_year_published(h.year) as published
        from app.public_holidays h where h.id = ${id}::uuid`.execute(tx)).rows[0];
    if (!h) return null;
    const r = (await sql<HolDb>`select x.* from ${holidayBase(h.year)} where x.id = ${id}::uuid`.execute(tx)).rows[0];
    if (!r) return null;
    return { ...mapHol(r), year: h.year, yearStatus: h.published ? 'published' : 'draft', ...stamps(h, await resolveNames(tx, [h.created_by, h.updated_by])) };
  });
}

export async function holidayYearSummary(tx: Tx, year: number): Promise<HolidayYearSummary> {
  const st = (await sql<{ published_at: Date | null; published_by: string | null }>`
    select max(published_at) as published_at, (array_agg(published_by order by published_at desc nulls last))[1] as published_by
      from app.holiday_calendar_years where year = ${year} and status = 'published'`.execute(tx)).rows[0];
  const checks = await sql<{ state: MyState; compulsory_present: CompulsoryHoliday[]; compulsory_missing: CompulsoryHoliday[]; paid_count: number }>`
    select state, compulsory_present::text[] as compulsory_present, compulsory_missing::text[] as compulsory_missing, paid_count
      from app.holiday_year_checks(${year})`.execute(tx);
  const cnt = (await sql<{ n: number }>`select count(*)::int as n from app.public_holidays where year = ${year} and is_active`.execute(tx)).rows[0]?.n ?? 0;
  const hasLocation = ((await sql<{ n: number }>`select count(*)::int as n from app.work_locations where is_active`.execute(tx)).rows[0]?.n ?? 0) > 0;
  const published = !!st?.published_at;
  const names = await resolveNames(tx, [st?.published_by]);
  const mapped = checks.rows.map((c) => ({
    state: c.state, compulsoryPresent: c.compulsory_present, compulsoryMissing: c.compulsory_missing, paidHolidayCount: c.paid_count,
    blocking: c.compulsory_missing.length > 0, warning: c.paid_count < 11,
  }));
  return {
    year, status: published ? 'published' : 'draft', publishedAt: iso(st?.published_at ?? null),
    publishedByName: st?.published_by ? names.get(st.published_by) ?? null : null,
    checks: mapped, holidayCount: cnt, canPublish: !published && hasLocation && !mapped.some((c) => c.blocking),
  };
}

export async function getHolidayYearSummary(year: number): Promise<HolidayYearSummary> {
  const { ctx } = await authorize(ORG_ADMIN);
  const y = yearSchema.parse(year);
  return withUserTx(ctx, (tx) => holidayYearSummary(tx, y));
}

export async function listHolidayYears(): Promise<{ year: number; status: CalendarStatus }[]> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const r = await sql<{ year: number; published: boolean }>`
      with y as (
        select year::int from app.public_holidays
        union select year::int from app.holiday_calendar_years
        union select extract(year from app.today_myt())::int
        union select extract(year from app.today_myt())::int + 1)
      select y.year, app.holiday_year_published(y.year) as published from (select distinct year from y) y order by y.year`.execute(tx);
    return r.rows.map((x) => ({ year: x.year, status: x.published ? 'published' : 'draft' }));
  });
}

const FIXED_MMDD = new Set(['01-01', '02-01', '05-01', '08-31', '09-16', '12-25']);
const FIXED_COMPULSORY = new Set<CompulsoryHoliday>(['national_day', 'workers_day', 'malaysia_day']);
function isLeap(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export async function copyPreview(tx: Tx, fromYear: number): Promise<CopyToNextYearPreview> {
  const toYear = fromYear + 1;
  const src = await sql<{ id: string; holiday_date: string; name: string; holiday_type: HolidayType; compulsory: CompulsoryHoliday | null; states: MyState[] }>`
    select h.id, h.holiday_date, h.name, h.holiday_type::text as holiday_type, h.compulsory::text as compulsory,
           array(select s.state::text from app.public_holiday_states s where s.holiday_id = h.id order by s.state) as states
      from app.public_holidays h where h.year = ${fromYear} and h.is_active order by h.holiday_date, h.name`.execute(tx);
  const existing = await sql<{ holiday_date: string; name: string }>`
    select holiday_date, name from app.public_holidays where year = ${toYear}`.execute(tx);
  const ex = new Set(existing.rows.map((e) => `${e.holiday_date}|${e.name.toLowerCase()}`));
  const published = (await sql<{ p: boolean }>`select app.holiday_year_published(${toYear}) as p`.execute(tx)).rows[0]?.p ?? false;
  return {
    fromYear, toYear, toYearStatus: published ? 'published' : 'draft',
    items: src.rows.map((h) => {
      const mmdd = h.holiday_date.slice(5);
      const leapIssue = mmdd === '02-29' && !isLeap(toYear);
      const targetDate = `${toYear}-${leapIssue ? '02-28' : mmdd}`;
      return {
        id: h.id, holidayDate: h.holiday_date, name: h.name, holidayType: h.holiday_type, states: h.states,
        suggested: !leapIssue && (FIXED_MMDD.has(mmdd) || (h.compulsory != null && FIXED_COMPULSORY.has(h.compulsory))),
        targetDate, alreadyExists: ex.has(`${targetDate}|${h.name.toLowerCase()}`),
      };
    }),
  };
}

export async function getCopyToNextYearPreview(fromYear: number): Promise<CopyToNextYearPreview> {
  const { ctx } = await authorize(ORG_ADMIN);
  const y = yearSchema.parse(fromYear);
  return withUserTx(ctx, (tx) => copyPreview(tx, y));
}

// ===========================================================================
// O9 Cost centres
// ===========================================================================
type CcDb = { id: string; code: string; name: string; autocount_code: string | null; is_active: boolean; created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null };
const mapCc = (r: CcDb): CostCentreRow => ({ id: r.id, code: r.code, name: r.name, autocountCode: r.autocount_code, isActive: r.is_active });

export async function costCentreRows(tx: Tx, params: CostCentreListParams, all = false): Promise<Paged<CostCentreRow>> {
  const p = parseParams(costCentreListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([...(q ? [sql`(c.code ilike ${q} or c.name ilike ${q} or c.autocount_code ilike ${q})`] : []), ...activeCond('c.is_active', p.active)]);
  const from = sql`app.cost_centres c`;
  const { limit, offset } = pageOf(p, all);
  const rows = await sql<CcDb>`select c.* from ${from} where ${where}
     order by ${sql.raw(p.sort === 'name' ? 'c.name' : 'c.code')} ${dirOf(p.dir)}, c.code limit ${limit} offset ${offset}`.execute(tx);
  return { rows: rows.rows.map(mapCc), total: await count(tx, from, where), page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}

export async function listCostCentres(params: CostCentreListParams): Promise<Paged<CostCentreRow>> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, (tx) => costCentreRows(tx, params));
}

export async function getCostCentre(id: string): Promise<CostCentreDetail | null> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const r = (await sql<CcDb>`select * from app.cost_centres where id = ${id}::uuid`.execute(tx)).rows[0];
    return r ? { ...mapCc(r), ...stamps(r, await resolveNames(tx, [r.created_by, r.updated_by])) } : null;
  });
}

// ===========================================================================
// O10 Employee groups (members → W2-003)
// ===========================================================================
type GrpDb = { id: string; name: string; description: string | null; is_active: boolean; created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null };
const mapGrp = (r: GrpDb): EmployeeGroupRow => ({ id: r.id, name: r.name, description: r.description, memberCount: null, usedBy: null, isActive: r.is_active });

export async function groupRows(tx: Tx, params: GroupListParams, all = false): Promise<Paged<EmployeeGroupRow>> {
  const p = parseParams(groupListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([...(q ? [sql`(g.name ilike ${q} or g.description ilike ${q})`] : []), ...activeCond('g.is_active', p.active)]);
  const from = sql`app.employee_groups g`;
  const { limit, offset } = pageOf(p, all);
  const rows = await sql<GrpDb>`select g.* from ${from} where ${where} order by g.name ${dirOf(p.dir)} limit ${limit} offset ${offset}`.execute(tx);
  return { rows: rows.rows.map(mapGrp), total: await count(tx, from, where), page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}

export async function listEmployeeGroups(params: GroupListParams): Promise<Paged<EmployeeGroupRow>> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, (tx) => groupRows(tx, params));
}

export async function getEmployeeGroup(id: string): Promise<EmployeeGroupDetail | null> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const r = (await sql<GrpDb>`select * from app.employee_groups where id = ${id}::uuid`.execute(tx)).rows[0];
    return r ? { ...mapGrp(r), members: [], ...stamps(r, await resolveNames(tx, [r.created_by, r.updated_by])) } : null;
  });
}

// ===========================================================================
// Options for selects
// ===========================================================================
export async function getOrgOptions(): Promise<OrgOptions> {
  const { ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    type O = { id: string; code: string | null; label: string; is_active: boolean };
    const m = (rows: O[]) => rows.map((r) => ({ id: r.id, code: r.code, label: r.label, isActive: r.is_active }));
    const dep = await sql<O>`select id, code, name as label, is_active from app.departments order by name`.execute(tx);
    const pos = await sql<O>`select id, code, title as label, is_active from app.positions order by title`.execute(tx);
    const gr = await sql<O>`select id, code, name as label, is_active from app.grades order by rank`.execute(tx);
    const cc = await sql<O>`select id, code, name as label, is_active from app.cost_centres order by name`.execute(tx);
    const wp = await sql<O>`select id, null as code, name as label, is_active from app.working_patterns order by name`.execute(tx);
    const loc = await sql<O & { state: MyState }>`select id, null as code, name as label, is_active, state from app.work_locations order by name`.execute(tx);
    const grp = await sql<O>`select id, null as code, name as label, is_active from app.employee_groups order by name`.execute(tx);
    const zb = await sql<{ id: string; name: string; code: string; state: MyState }>`
      select id, name, code, state from app.zakat_bodies where is_active order by name`.execute(tx);
    return {
      departments: m(dep.rows), positions: m(pos.rows), grades: m(gr.rows), costCentres: m(cc.rows), workingPatterns: m(wp.rows),
      locations: loc.rows.map((r) => ({ id: r.id, code: null, label: r.label, isActive: r.is_active, state: r.state })),
      employeeGroups: m(grp.rows), zakatBodies: zb.rows,
    };
  });
}

// ===========================================================================
// O11 System settings
// ===========================================================================
type SettingsDb = {
  employee_no_prefix: string; employee_no_padding: number; employee_no_next: number; default_probation_months: number;
  max_probation_months: number; notice_weeks_lt2: number; notice_weeks_2to5: number; notice_weeks_ge5: number;
  allowed_email_domains: string | string[]; idle_timeout_min_employee: number; idle_timeout_min_privileged: number;
  lockout_threshold: number; lockout_minutes: number; mfa_required_privileged: boolean; invite_lead_days: number;
  invite_link_hours: number; reminder_after_working_days: number; escalate_after_working_days: number;
  sa_batch_approval_required: boolean; max_top_of_org: number; hr_reply_to_email: string | null; retention_years_hr: number;
  retention_years_payroll: number; retention_years_audit: number; retention_days_import_files: number;
  rehire_keep_employee_no: boolean; directory_show_birthdays: boolean; updated_at: Date | null; updated_by: string | null;
};

export async function getSystemSettings(): Promise<SystemSettings> {
  const { user, ctx } = await authorize(ORG_ADMIN);
  return withUserTx(ctx, async (tx) => {
    const s = (await sql<SettingsDb>`select *, allowed_email_domains::text[] as allowed_email_domains from app.security_settings where id = 1`.execute(tx)).rows[0];
    if (!s) throw new Error('PRET-SETTINGS-MISSING');
    let cancelL1: boolean | null = null;
    const lp = (await sql<{ t: string | null }>`select to_regclass('app.leave_policy')::text as t`.execute(tx)).rows[0]?.t;
    if (lp) {
      try {
        cancelL1 = (await sql<{ v: boolean }>`select cancellation_approver_level1_only as v from app.leave_policy where id = 1`.execute(tx)).rows[0]?.v ?? null;
      } catch {
        cancelL1 = null;
      }
    }
    const names = await resolveNames(tx, [s.updated_by]);
    const domains = Array.isArray(s.allowed_email_domains) ? s.allowed_email_domains : String(s.allowed_email_domains).replace(/[{}]/g, '').split(',').filter(Boolean);
    return {
      employeeNoPrefix: s.employee_no_prefix, employeeNoPadding: s.employee_no_padding, employeeNoNext: s.employee_no_next,
      defaultProbationMonths: s.default_probation_months, maxProbationMonths: s.max_probation_months,
      noticeWeeksLt2: s.notice_weeks_lt2, noticeWeeks2to5: s.notice_weeks_2to5, noticeWeeksGe5: s.notice_weeks_ge5,
      inviteLeadDays: s.invite_lead_days, allowedEmailDomains: domains,
      idleTimeoutMinEmployee: s.idle_timeout_min_employee, idleTimeoutMinPrivileged: s.idle_timeout_min_privileged,
      lockoutThreshold: s.lockout_threshold, lockoutMinutes: s.lockout_minutes, mfaRequiredPrivileged: s.mfa_required_privileged,
      inviteLinkHours: s.invite_link_hours, reminderAfterWorkingDays: s.reminder_after_working_days,
      escalateAfterWorkingDays: s.escalate_after_working_days, saBatchApprovalRequired: s.sa_batch_approval_required,
      cancellationApproverLevel1Only: cancelL1, rehireKeepEmployeeNo: s.rehire_keep_employee_no, maxTopOfOrg: s.max_top_of_org,
      retentionYearsHr: s.retention_years_hr, retentionYearsPayroll: s.retention_years_payroll, retentionYearsAudit: s.retention_years_audit,
      retentionDaysImportFiles: s.retention_days_import_files, hrReplyToEmail: s.hr_reply_to_email,
      directoryShowBirthdays: s.directory_show_birthdays, updatedAt: iso(s.updated_at),
      updatedByName: s.updated_by ? names.get(s.updated_by) ?? null : null, canEdit: hasRole(user, 'SA'),
    };
  });
}

