import 'server-only';
import type { z } from 'zod';
import { sql, withUserTx, type Tx } from '../db';
import { writeAccess, type AccessEvent } from '../audit';
import type { CurrentUser, Role } from '../auth/current-user';
import { fieldCrypto } from '../crypto';
import { authorize } from '../lib/action-helpers';
import {
  addYears, ageingBuckets, completedYears, days1, fromSen, monthLabel, monthRange, monthsBetween, pageRows, pct, searchRows, sen, sortRows,
  sumDays, sumMoney, tenths, turnoverPct, unpaidReversals, type ExportedUnpaidLine,
} from '../lib/report-engine';
import { claimListPage, utilisationOf } from './claims';
import { applicationRows, balanceCards, leaverPositionFor } from './leave';
import { completenessOf } from './employees';
import { deliveryConfig } from '../email/dispatch';
import { formatMykad } from '../contracts/mykad';
import { MEDICAL_CATEGORIES, LEAVE_STATUS_LABELS, CREDIT_STATUS_LABELS, LEAVE_SESSION_LABELS } from '../contracts/leave';
import { BATCH_STATUS_LABELS, CLAIM_STATUS_LABELS, TAX_TREATMENT_LABELS, DEFAULT_ADMIN_CLAIM_STATUSES } from '../contracts/claims';
import {
  CONTACT_RELATIONSHIP_LABELS, EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, GENDER_LABELS, JOB_CHANGE_TYPE_LABELS, MARITAL_STATUS_LABELS,
  PAYMENT_METHOD_LABELS, PROBATION_RECOMMENDATION_LABELS, QUALIFICATION_LABELS, RACE_LABELS, RELIGION_LABELS, SEPARATION_REASON_LABELS,
  SEPARATION_TYPE_LABELS, SOCSO_CATEGORY_LABELS,
} from '../contracts/employees';
import {
  dashboardParamsSchema, payrollInputParamsSchema, EMPLOYEE_MASTER_DEFAULT_COLUMNS, EMPLOYEE_MASTER_FIELDS, HEADCOUNT_GROUP_BY_LABELS,
  PAYROLL_INPUT_CARD, PAYROLL_INPUT_NO_CLAIMS_NOTE, PAYROLL_INPUT_SHEET_LABELS, PAYROLL_INPUT_SHEETS, REPORT_CATALOGUE, REPORT_EXPORT_ROW_LIMIT,
  REPORT_GROUP_LABELS, REPORT_GROUPS, REPORT_PARAM_SCHEMAS, MEDICAL_LABEL, COMPLETENESS_CATEGORY_LABELS,
  type AdminDashboard, type AnyReportParams, type DashboardParams, type EmployeeKpis, type ManagerDashboard, type PayrollInputPack,
  type PayrollInputParams, type PayrollInputSheet, type PayrollInputTab, type ReportCatalogue, type ReportCatalogueCard, type ReportColumn,
  type ReportFilterOptions, type ReportId, type ReportMeta, type ReportResult, type ReportRow, type ReportSummaryItem, type ReportTable,
  type SensitiveFieldCategory, type ReportFormat,
} from '../contracts/reports';
import type { DataCategory } from '../db/types';

// M7 report queries (W2-007). Server-only. Every entry point: requireUser(REPORT_CATALOGUE[id].roles) → withUserTx (RLS) →
// builder (SQL through RLS / checked definer functions) → search / sort / page in memory (≤ 10,000 rows; ~200 staff) with totals
// over the whole filtered set. MGR scope is forced to the team (app.is_manager_of); EMP only reaches leave-individual (self).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
type Where = ReturnType<typeof sql>;
const and = (c: Where[]): Where => (c.length ? sql.join(c, sql` and `) : sql`true`);
const ADM_SA: Role[] = ['ADM', 'SA'];
const ACTIVE = sql`('on_probation','confirmed','notice_period')`;
const d1 = (v: unknown) => days1(v);
const m2 = (v: unknown) => fromSen(sen(v));
const iso = (v: Date | string | null | undefined) => (v == null ? null : (v instanceof Date ? v : new Date(v)).toISOString());
const dateOf = (v: Date | string | null | undefined) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const lbl = <T extends string>(m: Record<T, string>, v: string | null | undefined) => (v ? (m as Record<string, string>)[v] ?? v : null);

type Scope = 'all' | 'team' | 'own';
export type ReportCtx = { tx: Tx; user: CurrentUser; today: string; isAdmin: boolean; scope: Scope; me: string | null };
export type Built = {
  title?: string;
  searched?: boolean;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary?: (rows: ReportRow[]) => ReportSummaryItem[];
  tables?: ReportTable[];
  notes?: string[];
  asAt?: string | null;
  sensitive?: boolean;
  /** access-log event for a sensitive on-screen view (export writes its own 'export' row) */
  viewLog?: AccessEvent | null;
  /** columns + categories logged with exports */
  exportFields?: string[];
  exportCategories?: DataCategory[];
  searchKeys: string[];
  defaultSort?: string;
  defaultDir?: 'asc' | 'desc';
  byGroup?: boolean;
};

const col = (key: string, label: string, format: ReportFormat = 'text', o: Partial<ReportColumn> = {}): ReportColumn => ({ key, label, format, sortable: true, ...o });
const row = (id: string, cells: R, href: string | null = null, extra: Partial<ReportRow> = {}): ReportRow => ({ id, cells, href, ...extra });
const empName = (r: R) => (r.preferred_name && r.preferred_name !== r.full_name ? `${r.full_name} (${r.preferred_name})` : r.full_name);

async function todayOf(tx: Tx): Promise<string> {
  return (await sql<{ d: string }>`select app.today_myt()::text as d`.execute(tx)).rows[0]!.d;
}
function teamCond(c: ReportCtx, alias = 'e'): Where {
  return c.scope === 'team' ? sql`app.is_manager_of(${sql.ref(`${alias}.id`)})` : sql`true`;
}
function medicalName(c: ReportCtx, category: string, name: string): string {
  return !c.isAdmin && (MEDICAL_CATEGORIES as string[]).includes(category) ? MEDICAL_LABEL : name;
}
const JOB_AT = (d: Where) => sql`left join lateral (select h.department_id, h.position_id, h.grade_id, h.manager_employee_id, h.work_location_id
      from app.employee_job_history h where h.employee_id = e.id and not h.is_deleted and h.effective_date <= ${d} order by h.effective_date desc limit 1) j on true`;
const SEP = sql`left join app.employee_separations s on s.employee_id = e.id and not s.is_withdrawn and not s.superseded_by_rehire`;
const STATUS_AT = (d: Where) => sql`case when e.join_date > ${d} then 'pending_join' when s.last_working_day < ${d} then 'separated'
      when s.notice_date <= ${d} then 'notice_period' when e.confirmation_date <= ${d} then 'confirmed' else 'on_probation' end`;

// ===========================================================================
// Builders — one per report
// ===========================================================================
type P<I extends ReportId> = z.output<(typeof REPORT_PARAM_SCHEMAS)[I]>;
type Builder<I extends ReportId> = (c: ReportCtx, p: P<I>) => Promise<Built>;

const SENS_TO_CATEGORY: Record<SensitiveFieldCategory, DataCategory> = {
  mykad: 'identity', religion: 'religion', oku: 'health', family: 'family', bank: 'bank', statutory: 'statutory',
};

// ---- S-RP-04 Employee master (F-RPT-02) ----------------------------------------------------------------------------
const employeeMaster: Builder<'employee-master'> = async (c, p) => {
  const fields = (p.columns?.length ? p.columns : EMPLOYEE_MASTER_DEFAULT_COLUMNS)
    .map((k) => EMPLOYEE_MASTER_FIELDS.find((f) => f.key === k)).filter((f): f is NonNullable<typeof f> => !!f);
  const keys = new Set(fields.map((f) => f.key));
  const sens = [...new Set(fields.map((f) => f.sensitive).filter((s): s is SensitiveFieldCategory => !!s))];
  const columns = fields.map((f) => col(f.key, f.label, f.format, { sensitive: !!f.sensitive, group: f.group }));
  const asAt = p.asAt ?? c.today;
  const base: Built = { columns, rows: [], searchKeys: ['employeeNo', 'fullName', 'preferredName'], asAt, sensitive: sens.length > 0, defaultSort: 'employeeNo' };
  if (!p.run) return { ...base, searched: false };
  const d = sql`${asAt}::date`;
  const statusExpr = asAt === c.today ? sql`e.status::text` : STATUS_AT(d);
  const rows = (await sql<R>`
    select * from (
      select e.id, e.employee_no, e.full_name, e.preferred_name, e.gender::text as gender, e.work_email::text as work_email, e.mobile_phone, e.work_phone,
             ${statusExpr} as status_at, e.join_date, e.employment_type::text as employment_type, e.probation_months, e.probation_end_date,
             e.extended_probation_end_date, e.confirmation_date, e.work_state::text as work_state,
             coalesce(j.department_id, e.department_id) as dept_id, coalesce(j.work_location_id, e.work_location_id) as loc_id,
             dp.name as dept, po.title as pos, g.name as grade, m.full_name as mgr, l.name as loc, wp.name as pattern, cc.name as cost_centre,
             pp.date_of_birth, pp.nationality, pp.race::text as race, pp.race_other, pp.passport_no, pp.passport_expiry, pp.highest_qualification::text as qualification,
             pp.personal_email::text as personal_email, concat_ws(', ', pp.res_addr_line1, pp.res_addr_line2, pp.res_addr_line3, pp.res_postcode, pp.res_city) as res_address,
             pp.res_state::text as res_state, coalesce(pp.continuous_service_date, e.join_date) as csd, pp.retirement_date, pp.nric_enc,
             (select mh.marital_status::text from app.employee_marital_history mh where mh.employee_id = e.id and mh.effective_date <= ${d} order by mh.effective_date desc limit 1) as marital,
             ec.name as ec_name, ec.relationship::text as ec_rel, ec.mobile_phone as ec_phone,
             (select sp.full_name from app.employee_spouses sp where sp.employee_id = e.id and sp.record_status = 'current' order by sp.created_at limit 1) as spouse,
             (select sp.working_status from app.employee_spouses sp where sp.employee_id = e.id and sp.record_status = 'current' order by sp.created_at limit 1) as spouse_working,
             (select count(*)::int from app.employee_children ch where ch.employee_id = e.id and ch.is_active) as kids,
             s.notice_date, s.separation_type::text as separation_type, s.last_working_day, sd.reason_category::text as reason_category,
             st.pay_pcb, st.income_tax_no, st.pay_epf, st.epf_no, st.pay_socso, st.socso_no, st.socso_category::text as socso_category, st.pay_eis,
             b.id as bank_id, b.payment_method::text as payment_method, bk.name as bank_name, b.account_no_enc, b.account_holder_name
        from app.employees e
        ${JOB_AT(d)}
        ${SEP}
        left join app.employee_separation_details sd on sd.separation_id = s.id
        join app.departments dp on dp.id = coalesce(j.department_id, e.department_id)
        join app.positions po on po.id = coalesce(j.position_id, e.position_id)
        join app.grades g on g.id = coalesce(j.grade_id, e.grade_id)
        join app.work_locations l on l.id = coalesce(j.work_location_id, e.work_location_id)
        left join app.employees m on m.id = coalesce(j.manager_employee_id, e.manager_employee_id)
        left join app.working_patterns wp on wp.id = e.working_pattern_id
        left join app.employee_hr_private hp on hp.employee_id = e.id
        left join app.cost_centres cc on cc.id = hp.cost_centre_id
        left join app.employee_personal pp on pp.employee_id = e.id
        left join app.employee_statutory_profiles st on st.employee_id = e.id
        left join lateral (select x.* from app.employee_emergency_contacts x where x.employee_id = e.id order by x.priority limit 1) ec on true
        left join lateral (select x.* from app.employee_bank_accounts x where x.employee_id = e.id and x.effective_from <= ${d} order by x.effective_from desc limit 1) b on true
        left join app.banks bk on bk.id = b.bank_id
       where e.status <> 'withdrawn' and e.join_date <= ${d}
         and ${and([
           ...(p.departmentIds?.length ? [sql`coalesce(j.department_id, e.department_id) = any(${p.departmentIds}::uuid[])`] : []),
           ...(p.locationIds?.length ? [sql`coalesce(j.work_location_id, e.work_location_id) = any(${p.locationIds}::uuid[])`] : []),
           ...(p.joinFrom ? [sql`e.join_date >= ${p.joinFrom}::date`] : []),
           ...(p.joinTo ? [sql`e.join_date <= ${p.joinTo}::date`] : []),
         ])}) x
     where ${p.statuses?.length ? sql`x.status_at = any(${p.statuses}::text[])` : sql`x.status_at <> 'separated' or x.last_working_day >= ${d}`}
     order by x.employee_no limit ${REPORT_EXPORT_ROW_LIMIT}`.execute(tx(c))).rows;
  const ids = rows.map((r) => r.id as string);
  const cats = sens.map((s) => SENS_TO_CATEGORY[s]);
  const sensFields = fields.filter((f) => f.sensitive).map((f) => f.key);
  // BR-ADM-21: the access-log row is written before any sensitive value is decrypted / read
  if (sens.length && ids.length) {
    await writeAccess(tx(c), { action: 'view_sensitive', entityType: 'report:employee-master', employeeIds: ids, fields: sensFields, categories: cats, recordCount: ids.length });
  }
  const sensMap = new Map<string, R>();
  if ((keys.has('religion') || keys.has('isOku')) && ids.length) {
    for (const s of (await sql<R>`select * from app.report_sensitive_rows(${ids}::uuid[], 'Employee master report (F-RPT-02)')`.execute(tx(c))).rows) sensMap.set(s.employee_id, s);
  }
  const decrypt = (enc: Buffer | null, ref: { table: string; column: string; rowId: string }) => {
    if (!enc) return null;
    try { return fieldCrypto.decrypt(enc, ref); } catch { return null; }
  };
  const out = rows.map((r) => {
    const cells: R = {};
    const set = (k: string, v: unknown) => { if (keys.has(k)) cells[k] = v ?? null; };
    set('employeeNo', r.employee_no); set('fullName', r.full_name); set('preferredName', r.preferred_name);
    if (keys.has('mykad')) cells.mykad = formatMykad(decrypt(r.nric_enc, { table: 'employee_personal', column: 'nric_enc', rowId: r.id }) ?? '') || null;
    set('dateOfBirth', dateOf(r.date_of_birth)); set('age', r.date_of_birth ? completedYears(dateOf(r.date_of_birth)!, asAt) : null);
    set('gender', lbl(GENDER_LABELS, r.gender)); set('nationality', r.nationality);
    set('race', r.race === 'others' && r.race_other ? `Others (${r.race_other})` : lbl(RACE_LABELS, r.race));
    if (keys.has('religion')) cells.religion = lbl(RELIGION_LABELS, sensMap.get(r.id)?.religion) ?? null;
    if (keys.has('isOku')) cells.isOku = sensMap.get(r.id)?.is_oku ?? null;
    set('maritalStatus', lbl(MARITAL_STATUS_LABELS, r.marital)); set('passportNo', r.passport_no); set('passportExpiry', dateOf(r.passport_expiry));
    set('qualification', lbl(QUALIFICATION_LABELS, r.qualification));
    set('workEmail', r.work_email); set('personalEmail', r.personal_email); set('mobilePhone', r.mobile_phone); set('workPhone', r.work_phone);
    set('residentialAddress', r.res_address || null); set('residentialState', r.res_state);
    set('emergencyName', r.ec_name); set('emergencyRelationship', lbl(CONTACT_RELATIONSHIP_LABELS, r.ec_rel)); set('emergencyPhone', r.ec_phone);
    set('spouseName', r.spouse); set('spouseWorking', r.spouse_working === 'working' ? 'Working' : r.spouse_working === 'not_working' ? 'Not working' : null);
    set('childrenCount', r.kids);
    set('joinDate', dateOf(r.join_date)); set('continuousServiceDate', dateOf(r.csd)); set('employmentType', lbl(EMPLOYMENT_TYPE_LABELS, r.employment_type));
    set('probationMonths', r.probation_months); set('probationEnd', dateOf(r.probation_end_date)); set('extendedProbationEnd', dateOf(r.extended_probation_end_date));
    set('confirmationDate', dateOf(r.confirmation_date)); set('status', lbl(EMPLOYMENT_STATUS_LABELS, r.status_at));
    set('department', r.dept); set('position', r.pos); set('grade', r.grade); set('manager', r.mgr); set('location', r.loc); set('workState', r.work_state);
    set('workingPattern', r.pattern); set('costCentre', r.cost_centre);
    if (keys.has('lengthOfService')) {
      const y = completedYears(dateOf(r.csd)!, asAt);
      const months = (() => { const [fy, fm, fd] = dateOf(r.csd)!.split('-').map(Number) as number[]; const [ty, tm, td] = asAt.split('-').map(Number) as number[];
        let mm = (ty! - fy!) * 12 + (tm! - fm!); if (td! < fd!) mm -= 1; return mm % 12; })();
      cells.lengthOfService = `${y} year${y === 1 ? '' : 's'} ${months} month${months === 1 ? '' : 's'}`;
    }
    set('retirementDate', dateOf(r.retirement_date) ?? (r.date_of_birth ? addYears(dateOf(r.date_of_birth)!, 60) : null));
    set('noticeDate', dateOf(r.notice_date)); set('separationType', lbl(SEPARATION_TYPE_LABELS, r.separation_type));
    set('separationReason', lbl(SEPARATION_REASON_LABELS, r.reason_category)); set('lastWorkingDay', dateOf(r.last_working_day));
    set('payPcb', r.pay_pcb); set('incomeTaxNo', r.income_tax_no); set('payEpf', r.pay_epf); set('epfNo', r.epf_no); set('paySocso', r.pay_socso);
    set('socsoNo', r.socso_no); set('socsoCategory', lbl(SOCSO_CATEGORY_LABELS, r.socso_category)); set('payEis', r.pay_eis);
    set('paymentMethod', lbl(PAYMENT_METHOD_LABELS, r.payment_method)); set('bankName', r.bank_name);
    if (keys.has('bankAccountNo')) cells.bankAccountNo = r.bank_id ? decrypt(r.account_no_enc, { table: 'employee_bank_accounts', column: 'account_no_enc', rowId: r.bank_id }) : null;
    set('accountHolder', r.account_holder_name);
    return row(r.id, cells, `/employees/${encodeURIComponent(r.employee_no)}`);
  });
  return {
    ...base, searched: true, rows: out,
    summary: (rs) => [{ label: 'Employees', value: String(rs.length), format: 'int' }],
    exportFields: sensFields, exportCategories: cats,
    notes: sens.length ? ['Sensitive columns are included — this view and every export are access-logged.'] : [],
  };
};
const tx = (c: ReportCtx) => c.tx;

// ---- headcount helpers ---------------------------------------------------------------------------------------------
const GROUP_EXPR: Record<string, string> = {
  department: 'dp.name', location: 'l.name', grade: 'g.name',
  status: `case when s.notice_date <= dd.d then 'Notice period' when e.confirmation_date <= dd.d then 'Confirmed' else 'On probation' end`,
  gender: `initcap(e.gender::text)`,
};
async function headcountAt(c: ReportCtx, dates: string[], groupBy: string, extra: Where = sql`true`): Promise<R[]> {
  if (!dates.length) return [];
  return (await sql<R>`
    select dd.d::text as d, ${sql.raw(GROUP_EXPR[groupBy] ?? 'dp.name')} as g, count(*)::int as n
      from unnest(${dates}::date[]) dd(d)
      join app.employees e on e.join_date <= dd.d and e.status not in ('withdrawn','pending_join')
      ${SEP}
      left join lateral (select h.department_id, h.grade_id, h.work_location_id from app.employee_job_history h
                          where h.employee_id = e.id and not h.is_deleted and h.effective_date <= dd.d order by h.effective_date desc limit 1) j on true
      join app.departments dp on dp.id = coalesce(j.department_id, e.department_id)
      join app.work_locations l on l.id = coalesce(j.work_location_id, e.work_location_id)
      join app.grades g on g.id = coalesce(j.grade_id, e.grade_id)
     where (s.last_working_day is null or s.last_working_day >= dd.d) and ${teamCond(c)} and ${extra}
     group by 1, 2`.execute(c.tx)).rows;
}
function monthEnds(from: string, to: string, asAt: string): string[] {
  return monthsBetween(from, to).map((m) => { const e = monthRange(m).to; return e > asAt ? asAt : e; });
}

// ---- S-RP-05 Headcount (F-RPT-03) -----------------------------------------------------------------------------------
const headcount: Builder<'headcount'> = async (c, p) => {
  const asAt = p.asAt ?? c.today;
  const trendFrom = p.trendFrom ?? `${asAt.slice(0, 4)}-01`;
  const trendTo = p.trendTo ?? asAt.slice(0, 7);
  const periodFrom = `${trendFrom}-01`; const periodTo = monthRange(trendTo).to < asAt ? monthRange(trendTo).to : asAt;
  const now = await headcountAt(c, [asAt], p.groupBy);
  const ev = (await sql<R>`
    select kind, ${sql.raw(GROUP_EXPR[p.groupBy]!.replace(/dd\.d/g, 'x.d'))} as g, count(*)::int as n from (
      select 'join' as kind, e.id, e.join_date as d from app.employees e where e.status <> 'withdrawn' and e.join_date between ${periodFrom}::date and ${periodTo}::date
      union all
      select 'leave', e.id, s2.last_working_day from app.employees e join app.employee_separations s2 on s2.employee_id = e.id and not s2.is_withdrawn and not s2.superseded_by_rehire
       where s2.last_working_day between ${periodFrom}::date and ${periodTo}::date) x
    join app.employees e on e.id = x.id
    ${SEP}
    left join lateral (select h.department_id, h.grade_id, h.work_location_id from app.employee_job_history h
                        where h.employee_id = e.id and not h.is_deleted and h.effective_date <= x.d order by h.effective_date desc limit 1) j on true
    join app.departments dp on dp.id = coalesce(j.department_id, e.department_id)
    join app.work_locations l on l.id = coalesce(j.work_location_id, e.work_location_id)
    join app.grades g on g.id = coalesce(j.grade_id, e.grade_id)
   where ${teamCond(c)}
   group by 1, 2`.execute(c.tx)).rows;
  const groups = new Set<string>([...now.map((r) => r.g), ...ev.map((r) => r.g)]);
  const total = now.reduce((a, r) => a + r.n, 0);
  const rows = [...groups].map((g) => {
    const n = now.find((r) => r.g === g)?.n ?? 0;
    return row(g, { group: g, headcount: n, joiners: ev.find((r) => r.g === g && r.kind === 'join')?.n ?? 0, leavers: ev.find((r) => r.g === g && r.kind === 'leave')?.n ?? 0, share: pct(n, total) });
  });
  const ends = monthEnds(trendFrom, trendTo, asAt);
  const trend = await headcountAt(c, ends, p.groupBy);
  const gl = [...new Set(trend.map((r) => r.g))].sort();
  const trendTable: ReportTable = {
    key: 'trend', title: `Headcount by month (${HEADCOUNT_GROUP_BY_LABELS[p.groupBy]})`,
    columns: [col('month', 'Month'), ...gl.map((g) => col(`g:${g}`, g, 'int')), col('total', 'Total', 'int')],
    rows: monthsBetween(trendFrom, trendTo).map((m, i) => {
      const cells: R = { month: monthLabel(m, true) }; let t = 0;
      for (const g of gl) { const n = trend.find((r) => r.d === ends[i] && r.g === g)?.n ?? 0; cells[`g:${g}`] = n; t += n; }
      cells.total = t;
      return row(m, cells);
    }),
  };
  const startHc = (await headcountAt(c, [periodFrom], p.groupBy)).reduce((a, r) => a + r.n, 0);
  return {
    columns: [col('group', HEADCOUNT_GROUP_BY_LABELS[p.groupBy]), col('headcount', 'Headcount', 'int'), col('joiners', 'Joiners', 'int'), col('leavers', 'Leavers', 'int'), col('share', '% of total', 'percent')],
    rows, tables: [trendTable], asAt, searchKeys: ['group'], defaultSort: 'group',
    notes: [`Joiners and leavers: ${periodFrom.split('-').reverse().join('/')} – ${periodTo.split('-').reverse().join('/')}.`],
    summary: (rs) => {
      const j = rs.reduce((a, r) => a + Number(r.cells.joiners), 0); const lv = rs.reduce((a, r) => a + Number(r.cells.leavers), 0);
      return [
        { label: 'Headcount', value: String(rs.reduce((a, r) => a + Number(r.cells.headcount), 0)), format: 'int' },
        { label: 'Joiners', value: String(j), format: 'int' }, { label: 'Leavers', value: String(lv), format: 'int' },
        { label: 'Turnover %', value: turnoverPct(lv, startHc, total) ?? '—', format: 'percent' },
      ];
    },
  };
};

// ---- S-RP-06 Joiners & leavers (F-RPT-04) ---------------------------------------------------------------------------
const joinersLeavers: Builder<'joiners-leavers'> = async (c, p) => {
  const from = p.from ?? `${c.today.slice(0, 4)}-01-01`; const to = p.to ?? c.today;
  const dept = p.departmentIds?.length ? sql`e.department_id = any(${p.departmentIds}::uuid[])` : sql`true`;
  const rows = (await sql<R>`
    select * from (
      select 'Joiner' as kind, e.id, e.employee_no, e.full_name, e.preferred_name, dp.name as dept, po.title as pos, e.join_date as d,
             null::text as sep_type, null::text as reason, e.join_date as from_d
        from app.employees e join app.departments dp on dp.id = e.department_id join app.positions po on po.id = e.position_id
       where e.status <> 'withdrawn' and e.join_date between ${from}::date and ${to}::date and ${dept} and ${teamCond(c)}
         and ${p.kind === 'leavers' ? sql`false` : sql`true`}
      union all
      select 'Leaver', e.id, e.employee_no, e.full_name, e.preferred_name, dp.name, po.title, s.last_working_day, s.separation_type::text, sd.reason_category::text,
             coalesce(pp.continuous_service_date, e.join_date)
        from app.employees e join app.employee_separations s on s.employee_id = e.id and not s.is_withdrawn and not s.superseded_by_rehire
        left join app.employee_separation_details sd on sd.separation_id = s.id
        left join app.employee_personal pp on pp.employee_id = e.id
        join app.departments dp on dp.id = e.department_id join app.positions po on po.id = e.position_id
       where s.last_working_day between ${from}::date and ${to}::date and ${dept} and ${teamCond(c)}
         and ${p.kind === 'joiners' ? sql`false` : sql`true`}
         and ${p.separationTypes?.length ? sql`s.separation_type::text = any(${p.separationTypes}::text[])` : sql`true`}) x
     order by x.d`.execute(c.tx)).rows;
  const hc = async (d: string) => (await headcountAt(c, [d], 'department', dept)).reduce((a, r) => a + r.n, 0);
  const [hs, he] = [await hc(from), await hc(to)];
  return {
    columns: [col('kind', 'Joiner / leaver'), col('employeeNo', 'Employee no.'), col('name', 'Name'), col('department', 'Department'), col('position', 'Position'),
      col('date', 'Join date / LWD', 'date'), col('separationType', 'Separation type'), col('reason', 'Reason category'), col('service', 'Length of service')],
    rows: rows.map((r) => {
      const d = dateOf(r.d)!; const fd = dateOf(r.from_d)!;
      const y = completedYears(fd, d);
      return row(`${r.kind}:${r.id}`, { kind: r.kind, employeeNo: r.employee_no, name: empName(r), department: r.dept, position: r.pos, date: d,
        separationType: lbl(SEPARATION_TYPE_LABELS, r.sep_type), reason: lbl(SEPARATION_REASON_LABELS, r.reason), service: r.kind === 'Leaver' ? `${y} year${y === 1 ? '' : 's'}` : null },
      `/employees/${encodeURIComponent(r.employee_no)}`);
    }),
    searchKeys: ['employeeNo', 'name'], defaultSort: 'date',
    summary: (rs) => {
      const lv = rs.filter((r) => r.cells.kind === 'Leaver').length;
      return [{ label: 'Joiners', value: String(rs.filter((r) => r.cells.kind === 'Joiner').length), format: 'int' }, { label: 'Leavers', value: String(lv), format: 'int' },
        { label: 'Turnover % (leavers ÷ average headcount)', value: turnoverPct(lv, hs, he) ?? '—', format: 'percent' }];
    },
  };
};

// ---- S-RP-07 Probation due (F-RPT-05) — ADM/SA, MGR team --------------------------------------------------------------
const probationDue: Builder<'probation-due'> = async (c, p) => {
  const rows = (await sql<R>`
    select e.id, e.employee_no, e.full_name, e.preferred_name, m.full_name as mgr, e.join_date, e.probation_end_date, e.extended_probation_end_date,
           coalesce(e.extended_probation_end_date, e.probation_end_date) as pend,
           (coalesce(e.extended_probation_end_date, e.probation_end_date) - app.today_myt())::int as days_left,
           (select r.recommendation from app.probation_recommendations r where r.employee_id = e.id order by r.recommended_at desc limit 1) as rec
      from app.employees e left join app.employees m on m.id = e.manager_employee_id
     where e.status = 'on_probation' and ${teamCond(c)}
       and ${p.overdueOnly ? sql`coalesce(e.extended_probation_end_date, e.probation_end_date) < app.today_myt()`
                          : sql`coalesce(e.extended_probation_end_date, e.probation_end_date) <= app.today_myt() + ${p.withinDays}::int`}
       and ${p.departmentIds?.length ? sql`e.department_id = any(${p.departmentIds}::uuid[])` : sql`true`}`.execute(c.tx)).rows;
  return {
    columns: [col('employee', 'Employee'), col('manager', 'Manager'), col('joinDate', 'Join date', 'date'), col('probationEnd', 'Probation end', 'date'),
      col('extended', 'Extended', 'bool'), col('newEnd', 'New end', 'date'), col('daysLeft', 'Days left', 'int'), col('recommendation', 'Manager recommendation')],
    rows: rows.map((r) => row(r.id, { employee: `${r.employee_no} · ${empName(r)}`, employeeNo: r.employee_no, manager: r.mgr, joinDate: dateOf(r.join_date),
      probationEnd: dateOf(r.probation_end_date), extended: !!r.extended_probation_end_date, newEnd: dateOf(r.extended_probation_end_date), daysLeft: r.days_left,
      recommendation: lbl(PROBATION_RECOMMENDATION_LABELS, r.rec) }, c.isAdmin ? `/employees/${encodeURIComponent(r.employee_no)}` : `/team/${encodeURIComponent(r.employee_no)}`)),
    searchKeys: ['employee', 'manager'], defaultSort: 'daysLeft',
    summary: (rs) => [{ label: 'Due', value: String(rs.filter((r) => Number(r.cells.daysLeft) >= 0).length), format: 'int' },
      { label: 'Overdue', value: String(rs.filter((r) => Number(r.cells.daysLeft) < 0).length), format: 'int' }],
  };
};

// ---- S-RP-08 Retirement & service milestones (F-RPT-06) ---------------------------------------------------------------
const retirementMilestones: Builder<'retirement-milestones'> = async (c, p) => {
  const until = (() => { const [y, m, d] = c.today.split('-').map(Number) as number[]; const t = new Date(Date.UTC(y!, m! - 1 + p.windowMonths, d!)); return t.toISOString().slice(0, 10); })();
  const emps = (await sql<R>`
    select e.id, e.employee_no, e.full_name, e.preferred_name, e.grade_id, pp.date_of_birth, pp.retirement_date, coalesce(pp.continuous_service_date, e.join_date) as csd
      from app.employees e left join app.employee_personal pp on pp.employee_id = e.id
     where e.status in ${ACTIVE}`.execute(c.tx)).rows;
  const year = Number(c.today.slice(0, 4));
  const bands = (await sql<R>`
    select t.code, b.service_from_years, b.days_per_year, b.grade_id from app.leave_entitlement_bands b join app.leave_types t on t.id = b.leave_type_id
     where t.code in ('AL','SL') and b.effective_year = (select max(b2.effective_year) from app.leave_entitlement_bands b2 where b2.leave_type_id = b.leave_type_id and b2.effective_year <= ${year})
     order by b.service_from_years`.execute(c.tx)).rows;
  const out: ReportRow[] = [];
  for (const e of emps) {
    const dob = dateOf(e.date_of_birth); const csd = dateOf(e.csd)!;
    const ret = dateOf(e.retirement_date) ?? (dob ? addYears(dob, 60) : null);
    const retIn = !!ret && ret >= c.today && ret <= until;
    const svc = completedYears(csd, c.today);
    const forGrade = (code: string) => bands.filter((b) => b.code === code && (!b.grade_id || b.grade_id === e.grade_id));
    const next = forGrade('AL').map((b) => Number(b.service_from_years)).filter((y) => y > svc).sort((a, b) => a - b)[0];
    const nextDate = next !== undefined ? addYears(csd, Math.ceil(next)) : null;
    const bandIn = !!nextDate && nextDate >= c.today && nextDate <= until;
    const daysAt = (code: string, y: number | undefined) => (y === undefined ? null
      : d1(forGrade(code).filter((b) => Number(b.service_from_years) <= y).sort((a, b) => Number(b.service_from_years) - Number(a.service_from_years))[0]?.days_per_year ?? null));
    const want = (p.milestone === 'all' && (retIn || bandIn)) || (p.milestone === 'retirement' && retIn) || (p.milestone === 'service_band' && bandIn);
    if (!want) continue;
    out.push(row(e.id, { employee: `${e.employee_no} · ${empName(e)}`, employeeNo: e.employee_no, dob, age: dob ? completedYears(dob, c.today) : null,
      retirementDate: ret, nextBandDate: bandIn ? nextDate : null, newAl: bandIn ? daysAt('AL', next) : null, newSl: bandIn ? daysAt('SL', next) : null },
    `/employees/${encodeURIComponent(e.employee_no)}`));
  }
  return {
    columns: [col('employee', 'Employee'), col('dob', 'Date of birth', 'date'), col('age', 'Age', 'int'), col('retirementDate', 'Retirement date', 'date'),
      col('nextBandDate', 'Next service-band date', 'date'), col('newAl', 'New AL days', 'days'), col('newSl', 'New SL days', 'days')],
    rows: out, searchKeys: ['employee'], defaultSort: 'retirementDate',
    notes: ['Retirement age 60 (Minimum Retirement Age Act 2012) unless a retirement date is recorded on the profile.'],
    summary: (rs) => [{ label: 'Retiring in window', value: String(rs.filter((r) => r.cells.retirementDate && String(r.cells.retirementDate) <= until).length), format: 'int' },
      { label: 'Service-band changes', value: String(rs.filter((r) => r.cells.nextBandDate).length), format: 'int' }],
  };
};

// ---- S-RP-09 Data completeness (F-RPT-07) — same function as the Employees list (app.employee_completeness) -------------
const CATEGORY_FIELDS: Record<string, string[]> = {
  statutory: ['income_tax_no', 'epf_no', 'socso_no', 'socso_category'], pcb: ['spouse_relief', 'child_pcb'], bank: ['bank_account', 'payment_method'],
};
export async function completenessRows(c: ReportCtx, filter: { departmentIds?: string[]; statuses?: string[] } = {}): Promise<R[]> {
  return (await sql<R>`
    select e.id, e.employee_no, e.full_name, e.preferred_name, dp.name as dept, e.status::text as status, x.missing, x.missing_payroll, x.total_checks
      from app.employees e join app.departments dp on dp.id = e.department_id
      join lateral app.employee_completeness(array[e.id]) x on true
     where e.status in ${filter.statuses?.length ? sql`(select unnest(${filter.statuses}::app.employment_status[]))` : ACTIVE}
       and ${filter.departmentIds?.length ? sql`e.department_id = any(${filter.departmentIds}::uuid[])` : sql`true`}`.execute(c.tx)).rows;
}
const dataCompleteness: Builder<'data-completeness'> = async (c, p) => {
  const rows = await completenessRows(c, { departmentIds: p.departmentIds, statuses: p.statuses });
  const out = rows.map((r) => {
    const comp = completenessOf(r.missing, r.missing_payroll, r.total_checks);
    return { r, comp, all: [...(r.missing ?? []), ...(r.missing_payroll ?? [])] as string[] };
  }).filter(({ r, all }) => {
    if (p.incompleteOnly && all.length === 0) return false;
    if (!p.missingCategory) return true;
    if (p.missingCategory === 'mandatory') return (r.missing ?? []).length > 0;
    return all.some((f) => CATEGORY_FIELDS[p.missingCategory!]!.includes(f));
  }).map(({ r, comp }) => row(r.id, {
    employee: `${r.employee_no} · ${empName(r)}`, employeeNo: r.employee_no, department: r.dept,
    missingMandatory: comp.missing.filter((m) => !m.payroll).map((m) => m.label), missingPayroll: comp.missing.filter((m) => m.payroll).map((m) => m.label),
    completeness: String(comp.pct),
  }, `/employees/${encodeURIComponent(r.employee_no)}`));
  return {
    columns: [col('employee', 'Employee'), col('department', 'Department'), col('missingMandatory', 'Missing mandatory', 'list', { sortable: false }),
      col('missingPayroll', 'Missing R1.1 fields', 'list', { sortable: false }), col('completeness', 'Completeness %', 'percent')],
    rows: out, searchKeys: ['employee'], defaultSort: 'completeness',
    notes: p.missingCategory ? [`Showing employees missing ${COMPLETENESS_CATEGORY_LABELS[p.missingCategory]} fields.`] : [],
    summary: (rs) => [{ label: 'Complete', value: String(rs.filter((r) => r.cells.completeness === '100').length), format: 'int' },
      { label: 'Incomplete', value: String(rs.filter((r) => r.cells.completeness !== '100').length), format: 'int' }],
  };
};

// ---- leave helpers ---------------------------------------------------------------------------------------------------
async function leaveTypesOf(c: ReportCtx, ids?: string[]): Promise<R[]> {
  return (await sql<R>`select t.id, t.code, t.name, t.category::text as category, t.is_paid, t.payroll_treatment::text as payroll_treatment, t.entitlement_method::text as method
      from app.leave_types t where t.is_active and t.deduct_from_type_id is null
       and ${ids?.length ? sql`t.id = any(${ids}::uuid[])` : sql`true`} order by t.display_order`.execute(c.tx)).rows;
}
async function balance(c: ReportCtx, empId: string, typeId: string, year: number, asAt: string): Promise<R> {
  return (await sql<{ b: R }>`select app.leave_balance_view(${empId}::uuid, ${typeId}::uuid, ${year}, ${asAt}::date) as b`.execute(c.tx)).rows[0]!.b;
}
const BAL_PARTS: [string, string, string][] = [
  ['entitled', 'Entitled', 'entitled'], ['cf', 'CF', 'carried_forward'], ['earned', 'Earned', 'earned_credits'], ['adjusted', 'Adjusted', 'adjustments'],
  ['taken', 'Taken', 'taken'], ['pending', 'Pending', 'pending'], ['expired', 'Expired', 'expired_forfeited'], ['available', 'Available', 'available'],
];

// ---- S-RP-10 Leave balances as at (F-RPT-08) — app.leave_balance_view, the same engine as P5 / L-balances ---------------
const leaveBalances: Builder<'leave-balances'> = async (c, p) => {
  const asAt = p.asAt ?? c.today; const year = Number(asAt.slice(0, 4));
  let types = await leaveTypesOf(c, p.leaveTypeIds);
  if (!p.leaveTypeIds?.length) types = types.filter((t) => ['AL', 'SL', 'RL'].includes(t.code));
  types = types.filter((t) => t.method !== 'no_entitlement' && t.method !== 'fixed_per_occurrence');
  const names = new Map<string, string>(); let med = 0;
  for (const t of types) { let n = medicalName(c, t.category, t.name); if (n === MEDICAL_LABEL) { med += 1; if (med > 1) n = `${MEDICAL_LABEL} (${med})`; } names.set(t.id, n); }
  const columns = [col('employeeNo', 'Employee no.'), col('employee', 'Employee'), col('department', 'Department'), col('months', 'Months of service', 'int'),
    ...types.flatMap((t) => BAL_PARTS.map(([k, l]) => col(`${t.code}:${k}`, l, 'days', { group: names.get(t.id) })))];
  const base: Built = { columns, rows: [], asAt, searchKeys: ['employeeNo', 'employee'], defaultSort: 'employee', byGroup: true };
  if (!p.run) return { ...base, searched: false };
  const emps = (await sql<R>`
    select e.id, e.employee_no, e.full_name, e.preferred_name, dp.name as dept,
           app.completed_months(coalesce(pp.continuous_service_date, e.join_date), ${asAt}::date) as months
      from app.employees e join app.departments dp on dp.id = e.department_id left join app.employee_personal pp on pp.employee_id = e.id
     where ${and([teamCond(c),
       ...(p.departmentIds?.length ? [sql`e.department_id = any(${p.departmentIds}::uuid[])`] : []),
       ...(p.locationIds?.length ? [sql`e.work_location_id = any(${p.locationIds}::uuid[])`] : []),
       p.employmentStatus === 'active' ? sql`e.status in ${ACTIVE}` : p.employmentStatus === 'separated' ? sql`e.status = 'separated'` : sql`e.status not in ('withdrawn','pending_join')`,
     ])} order by dp.name, e.full_name`.execute(c.tx)).rows;
  const rows: ReportRow[] = [];
  for (const e of emps) {
    const cells: R = { employeeNo: e.employee_no, employee: empName(e), department: e.dept, months: e.months };
    for (const t of types) {
      const b = await balance(c, e.id, t.id, year, asAt);
      for (const [k, , src] of BAL_PARTS) cells[`${t.code}:${k}`] = d1(b[src]);
    }
    rows.push(row(e.id, cells, null, { group: e.dept }));
  }
  const depts = [...new Set(rows.map((r) => r.group!))];
  const subtotals: ReportTable = {
    key: 'department-subtotals', title: 'Department subtotals',
    columns: [col('department', 'Department'), col('employees', 'Employees', 'int'), ...types.flatMap((t) => BAL_PARTS.map(([k, l]) => col(`${t.code}:${k}`, l, 'days', { group: names.get(t.id) })))],
    rows: depts.map((dname) => {
      const rs = rows.filter((r) => r.group === dname);
      const cells: R = { department: dname, employees: rs.length };
      for (const t of types) for (const [k] of BAL_PARTS) cells[`${t.code}:${k}`] = sumDays(rs.map((r) => r.cells[`${t.code}:${k}`]));
      return row(dname, cells, null, { kind: 'subtotal' });
    }),
  };
  return {
    ...base, searched: true, rows, tables: [subtotals],
    summary: (rs) => [{ label: 'Employees', value: String(rs.length), format: 'int' },
      ...types.map((t) => ({ label: `${names.get(t.id)} available`, value: sumDays(rs.map((r) => r.cells[`${t.code}:available`])), format: 'days' as const }))],
  };
};

// ---- S-RP-11 Leave transactions (F-RPT-09) — the leave applications list query (reconciles with L1) ------------------------
const leaveTransactions: Builder<'leave-transactions'> = async (c, p) => {
  const from = p.from ?? `${c.today.slice(0, 7)}-01`; const to = p.to ?? monthRange(c.today.slice(0, 7)).to;
  const page = await applicationRows(c.tx, {
    ...(p.dateBasis === 'leave' ? { from, to } : { appliedFrom: from, appliedTo: to }),
    leaveTypeIds: p.leaveTypeIds, statuses: p.statuses?.length ? p.statuses : ['pending', 'approved', 'rejected', 'withdrawn', 'cancellation_pending', 'cancelled'],
    departmentIds: p.departmentIds, emergencyOnly: p.emergencyOnly, onBehalfOnly: p.onBehalfOnly, includeSeparated: true, sort: 'applied', dir: 'desc', page: 1, pageSize: 100,
  }, true);
  return {
    columns: [col('reference', 'Reference'), col('employee', 'Employee'), col('type', 'Type'), col('from', 'From', 'date'), col('to', 'To', 'date'), col('days', 'Days', 'days'),
      col('status', 'Status'), col('applied', 'Applied', 'datetime'), col('approvers', 'Approver(s)'), col('decided', 'Decided', 'datetime')],
    rows: page.rows.map((a) => row(a.id, { reference: a.refNo, employee: `${a.employee.employeeNo ?? ''} · ${a.employee.name}`, type: a.leaveType.name,
      from: a.startDate, to: a.endDate, days: a.days, status: LEAVE_STATUS_LABELS[a.status], applied: a.appliedAt, approvers: a.approverName,
      decided: a.status === 'pending' ? null : a.approverAt, emergency: a.isEmergency }, `/approvals/leave/${encodeURIComponent(a.refNo)}`)),
    searchKeys: ['reference', 'employee'], defaultSort: 'applied', defaultDir: 'desc',
    summary: (rs) => [{ label: 'Applications', value: String(rs.length), format: 'int' }, { label: 'Days', value: sumDays(rs.map((r) => r.cells.days)), format: 'days' }],
  };
};

// ---- leave-day aggregates (summary, who's on leave, unpaid) ------------------------------------------------------------
const TAKEN = sql`a.status in ('approved','cancellation_pending')`;

// ---- S-RP-12 Leave summary (F-RPT-10) ----------------------------------------------------------------------------------
const leaveSummary: Builder<'leave-summary'> = async (c, p) => {
  const year = p.year ?? Number(c.today.slice(0, 4));
  const mf = Math.min(p.monthFrom, p.monthTo); const mt = Math.max(p.monthFrom, p.monthTo);
  const from = `${year}-${String(mf).padStart(2, '0')}-01`; const to = monthRange(`${year}-${String(mt).padStart(2, '0')}`).to;
  const agg = (await sql<R>`
    select dp.name as dept, t.code, t.name as type_name, to_char(d.leave_date, 'YYYY-MM') as month, sum(d.weight) as days
      from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
      join app.leave_types t on t.id = a.leave_type_id join app.employees e on e.id = d.employee_id join app.departments dp on dp.id = e.department_id
     where ${TAKEN} and d.leave_date between ${from}::date and ${to}::date and d.weight > 0 and ${teamCond(c)}
     group by 1, 2, 3, 4`.execute(c.tx)).rows;
  const types = [...new Map(agg.map((r) => [r.code, r.type_name])).entries()];
  const depts = [...new Set(agg.map((r) => r.dept))].sort();
  const sumOf = (f: (r: R) => boolean) => sumDays(agg.filter(f).map((r) => r.days));
  const rows = depts.map((dn) => {
    const cells: R = { department: dn };
    for (const [code] of types) cells[`t:${code}`] = sumOf((r) => r.dept === dn && r.code === code);
    cells.total = sumOf((r) => r.dept === dn);
    return row(dn, cells);
  });
  const months = monthsBetween(from.slice(0, 7), to.slice(0, 7));
  const perMonth: ReportTable = {
    key: 'per-month', title: 'Days taken per month',
    columns: [col('month', 'Month'), ...types.map(([code, n]) => col(`t:${code}`, n, 'days')), col('total', 'Total', 'days')],
    rows: months.map((m) => {
      const cells: R = { month: monthLabel(m, true) };
      for (const [code] of types) cells[`t:${code}`] = sumOf((r) => r.month === m && r.code === code);
      cells.total = sumOf((r) => r.month === m);
      return row(m, cells);
    }),
  };
  return {
    columns: [col('department', 'Department'), ...types.map(([code, n]) => col(`t:${code}`, n, 'days')), col('total', 'Total', 'days')],
    rows, tables: [perMonth], searchKeys: ['department'], defaultSort: 'department',
    notes: [`Approved leave days (incl. cancellation pending) from ${from.split('-').reverse().join('/')} to ${to.split('-').reverse().join('/')}.`],
    summary: (rs) => [...types.map(([code, n]) => ({ label: n, value: sumDays(rs.map((r) => r.cells[`t:${code}`])), format: 'days' as const })),
      { label: 'Total days', value: sumDays(rs.map((r) => r.cells.total)), format: 'days' }],
  };
};

// ---- S-RP-13 Who's on leave (F-RPT-11) — ADM/SA, MGR team ---------------------------------------------------------------
export async function onLeaveRows(c: ReportCtx, from: string, to: string, f: { departmentIds?: string[]; locationIds?: string[] } = {}): Promise<R[]> {
  return (await sql<R>`
    select a.id, a.ref_no, a.start_date, a.end_date, a.start_session::text as start_session, a.end_session::text as end_session, e.id as emp_id, e.employee_no,
           e.full_name, e.preferred_name, dp.name as dept, t.name as type_name, t.category::text as category, sum(d.weight) as days_in_range
      from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
      join app.leave_types t on t.id = a.leave_type_id join app.employees e on e.id = d.employee_id join app.departments dp on dp.id = e.department_id
     where ${TAKEN} and d.leave_date between ${from}::date and ${to}::date and d.weight > 0 and ${teamCond(c)}
       and ${f.departmentIds?.length ? sql`e.department_id = any(${f.departmentIds}::uuid[])` : sql`true`}
       and ${f.locationIds?.length ? sql`e.work_location_id = any(${f.locationIds}::uuid[])` : sql`true`}
     group by a.id, e.id, dp.name, t.name, t.category order by a.start_date`.execute(c.tx)).rows;
}
const whosOnLeave: Builder<'whos-on-leave'> = async (c, p) => {
  const from = p.from ?? c.today; const to = p.to && p.to >= from ? p.to : from;
  const rows = await onLeaveRows(c, from, to, p);
  return {
    columns: [col('employee', 'Employee'), col('department', 'Department'), col('type', 'Type'), col('from', 'From', 'date'), col('to', 'To', 'date'), col('session', 'Session')],
    rows: rows.map((r) => row(r.id, { employee: empName(r), department: r.dept, type: medicalName(c, r.category, r.type_name), from: dateOf(r.start_date), to: dateOf(r.end_date),
      session: dateOf(r.start_date) === dateOf(r.end_date) ? LEAVE_SESSION_LABELS[r.start_session as 'full'] ?? r.start_session
        : `${LEAVE_SESSION_LABELS[r.start_session as 'full'] ?? ''} – ${LEAVE_SESSION_LABELS[r.end_session as 'full'] ?? ''}` }, c.isAdmin ? `/approvals/leave/${encodeURIComponent(r.ref_no)}` : null)),
    searchKeys: ['employee'], defaultSort: 'from', asAt: from,
    summary: (rs) => [{ label: 'Employees on leave', value: String(new Set(rows.map((r) => r.emp_id)).size), format: 'int' }, { label: 'Applications', value: String(rs.length), format: 'int' }],
  };
};

// ---- S-RP-14 Unpaid leave (F-RPT-12) — also the payroll-input "Unpaid leave days" sheet --------------------------------
export async function unpaidRows(c: ReportCtx, month: string, departmentIds?: string[]): Promise<R[]> {
  const { from, to } = monthRange(month);
  return (await sql<R>`
    select a.id, a.ref_no, a.status::text as status, e.id as emp_id, e.employee_no, e.full_name, e.preferred_name, dp.name as dept,
           min(d.leave_date) as first_d, max(d.leave_date) as last_d, sum(d.weight) as days,
           array_agg(to_char(d.leave_date, 'DD/MM/YYYY') || case when d.weight < 1 then ' (½)' else '' end order by d.leave_date) as dates
      from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
      join app.leave_types t on t.id = a.leave_type_id join app.employees e on e.id = d.employee_id join app.departments dp on dp.id = e.department_id
     where ${TAKEN} and (not t.is_paid or t.payroll_treatment = 'unpaid_deduct') and d.weight > 0
       and d.leave_date between ${from}::date and ${to}::date
       and ${departmentIds?.length ? sql`e.department_id = any(${departmentIds}::uuid[])` : sql`true`}
     group by a.id, e.id, dp.name order by e.employee_no, min(d.leave_date)`.execute(c.tx)).rows;
}
const unpaidLeave: Builder<'unpaid-leave'> = async (c, p) => {
  const month = p.month ?? c.today.slice(0, 7);
  const rows = await unpaidRows(c, month, p.departmentIds);
  return {
    columns: [col('employee', 'Employee'), col('department', 'Department'), col('dates', 'Dates', 'list', { sortable: false }), col('days', 'Unpaid days', 'days'), col('reference', 'Reference')],
    rows: rows.map((r) => row(r.id, { employee: `${r.employee_no} · ${empName(r)}`, department: r.dept, dates: r.dates, days: d1(r.days), reference: r.ref_no },
      `/approvals/leave/${encodeURIComponent(r.ref_no)}`)),
    searchKeys: ['employee', 'reference'], defaultSort: 'employee', notes: [`Payroll month ${monthLabel(month)}.`],
    summary: (rs) => [{ label: 'Total unpaid days', value: sumDays(rs.map((r) => r.cells.days)), format: 'days' }],
  };
};

// ---- S-RP-15 Sick & hospitalisation (F-RPT-13) 🔒 ------------------------------------------------------------------------
const sickHospitalisation: Builder<'sick-hospitalisation'> = async (c, p) => {
  const year = p.year ?? Number(c.today.slice(0, 4));
  const asAt = year === Number(c.today.slice(0, 4)) ? c.today : `${year}-12-31`;
  const types = (await leaveTypesOf(c)).filter((t) => t.category === 'sick' || t.category === 'hospitalisation');
  const sl = types.find((t) => t.category === 'sick'); const hl = types.find((t) => t.category === 'hospitalisation');
  const emps = (await sql<R>`
    select e.id, e.employee_no, e.full_name, e.preferred_name, dp.name as dept,
           (select count(*)::int from app.leave_applications a join app.leave_types t on t.id = a.leave_type_id
             where a.employee_id = e.id and a.leave_year = ${year} and t.category in ('sick','hospitalisation') and a.mc_status = 'verified') as mc
      from app.employees e join app.departments dp on dp.id = e.department_id
     where e.status not in ('withdrawn','pending_join') and e.join_date <= ${asAt}::date
       and (e.status <> 'separated' or exists (select 1 from app.employee_separations s where s.employee_id = e.id and not s.is_withdrawn and s.last_working_day >= ${`${year}-01-01`}::date))
       and ${p.departmentIds?.length ? sql`e.department_id = any(${p.departmentIds}::uuid[])` : sql`true`}
     order by e.full_name`.execute(c.tx)).rows;
  const rows: ReportRow[] = [];
  for (const e of emps) {
    const bs = sl ? await balance(c, e.id, sl.id, year, asAt) : null;
    const bh = hl ? await balance(c, e.id, hl.id, year, asAt) : null;
    const pool = bs?.pool ?? bh?.pool;
    rows.push(row(e.id, { employee: `${e.employee_no} · ${empName(e)}`, department: e.dept, slEntitled: d1(bs?.entitled), slTaken: d1(bs?.taken), hlTaken: d1(bh?.taken),
      pool: pool ? `${d1(pool.used)} / ${Number(pool.cap)}` : null, poolUsed: pool ? d1(pool.used) : null, mcVerified: e.mc }, `/employees/${encodeURIComponent(e.employee_no)}`));
  }
  const ids = emps.map((e) => e.id as string);
  return {
    columns: [col('employee', 'Employee'), col('department', 'Department'), col('slEntitled', 'SL entitled', 'days'), col('slTaken', 'SL taken', 'days'),
      col('hlTaken', 'HL taken', 'days'), col('pool', 'Pool used / 60', 'text', { sortable: false }), col('mcVerified', 'MC verified', 'int')],
    rows, searchKeys: ['employee'], defaultSort: 'employee', sensitive: true, asAt,
    viewLog: { action: 'view_sensitive', entityType: 'report:sick-hospitalisation', employeeIds: ids, fields: ['sick_leave', 'hospitalisation_leave', 'mc_status'], categories: ['health'], recordCount: ids.length },
    exportFields: ['sick_leave', 'hospitalisation_leave', 'mc_status'], exportCategories: ['health'],
    summary: (rs) => [{ label: 'SL taken', value: sumDays(rs.map((r) => r.cells.slTaken)), format: 'days' }, { label: 'HL taken', value: sumDays(rs.map((r) => r.cells.hlTaken)), format: 'days' }],
  };
};

// ---- S-RP-16 Replacement leave (F-RPT-14) -------------------------------------------------------------------------------
const replacementLeave: Builder<'replacement-leave'> = async (c, p) => {
  const from = p.from ?? `${c.today.slice(0, 4)}-01-01`; const to = p.to ?? c.today;
  const rows = (await sql<R>`
    select r.id, r.credit_no, r.date_worked, r.credit_days, r.status::text as status, r.expiry_date, r.remaining_days, r.expired_days, r.compensate_by_pay,
           e.employee_no, e.full_name, e.preferred_name
      from app.replacement_credits r join app.employees e on e.id = r.employee_id
     where r.date_worked between ${from}::date and ${to}::date and ${teamCond(c)}
       and ${p.statuses?.length ? sql`r.status::text = any(${p.statuses}::text[])` : sql`true`}
       and ${p.expiringWithinDays ? sql`r.status = 'approved' and coalesce(r.remaining_days, 0) > 0 and r.expiry_date between app.today_myt() and app.today_myt() + ${p.expiringWithinDays}::int` : sql`true`}`.execute(c.tx)).rows;
  return {
    columns: [col('employee', 'Employee'), col('creditNo', 'Credit no.'), col('dateWorked', 'Date worked', 'date'), col('days', 'Days', 'days'), col('status', 'Status'),
      col('used', 'Used', 'days'), col('expiry', 'Expiry', 'date'), col('expired', 'Expired', 'days')],
    rows: rows.map((r) => {
      const earned = r.status === 'approved' && !r.compensate_by_pay ? tenths(r.credit_days) : 0;
      const used = Math.max(0, earned - tenths(r.remaining_days) - tenths(r.expired_days));
      return row(r.id, { employee: `${r.employee_no} · ${empName(r)}`, creditNo: r.credit_no, dateWorked: dateOf(r.date_worked), days: d1(r.credit_days),
        status: r.compensate_by_pay && r.status === 'approved' ? 'Approved (paid)' : CREDIT_STATUS_LABELS[r.status as 'pending'], used: (used / 10).toFixed(1),
        expiry: dateOf(r.expiry_date), expired: d1(r.expired_days), earned: (earned / 10).toFixed(1) }, `/approvals/credits/${encodeURIComponent(r.credit_no)}`);
    }),
    searchKeys: ['employee', 'creditNo'], defaultSort: 'dateWorked',
    summary: (rs) => [{ label: 'Earned', value: sumDays(rs.map((r) => r.cells.earned)), format: 'days' }, { label: 'Used', value: sumDays(rs.map((r) => r.cells.used)), format: 'days' },
      { label: 'Expired', value: sumDays(rs.map((r) => r.cells.expired)), format: 'days' }],
  };
};

// ---- S-RP-17 Year-end carry-forward & forfeiture (F-RPT-15) ------------------------------------------------------------
const carryForward: Builder<'carry-forward'> = async (c, p) => {
  const year = p.year ?? Number(c.today.slice(0, 4)) - 1;
  const rows = (await sql<R>`
    select l.employee_id, l.leave_type_id, l.closing_balance, l.carry_forward, l.forfeited, l.cf_expiry_date, t.name as type_name, e.employee_no, e.full_name, e.preferred_name,
           (select coalesce(sum(abs(x.days)), 0) from app.leave_ledger x
             where x.employee_id = l.employee_id and x.leave_type_id = l.leave_type_id and x.leave_year = ${year + 1} and x.entry_type = 'expired'
               and x.source_ledger_id in (select y.id from app.leave_ledger y where y.employee_id = l.employee_id and y.leave_type_id = l.leave_type_id
                                            and y.leave_year = ${year + 1} and y.entry_type = 'carry_forward')) as cf_expired,
           (select coalesce(sum(abs(x.days)), 0) from app.leave_ledger x
             where x.employee_id = l.employee_id and x.leave_type_id = l.leave_type_id and x.leave_year = ${year + 1} and x.entry_type in ('taken','taken_reversal')
               and (l.cf_expiry_date is null or x.effective_date <= l.cf_expiry_date)) as taken_before_expiry
      from app.rollover_lines l join app.rollover_runs r on r.id = l.run_id and r.status = 'committed' and r.closing_year = ${year}
      join app.leave_types t on t.id = l.leave_type_id join app.employees e on e.id = l.employee_id`.execute(c.tx)).rows;
  return {
    columns: [col('employee', 'Employee'), col('type', 'Type'), col('closing', 'Closing balance', 'days'), col('carried', 'Carried', 'days'), col('forfeited', 'Forfeited', 'days'),
      col('cfExpiry', 'CF expiry', 'date'), col('cfUsed', 'CF used', 'days'), col('cfExpired', 'CF expired', 'days')],
    rows: rows.map((r) => {
      const carried = tenths(r.carry_forward); const exp = tenths(r.cf_expired);
      const used = Math.max(0, Math.min(carried - exp, tenths(r.taken_before_expiry)));
      return row(`${r.employee_id}:${r.leave_type_id}`, { employee: `${r.employee_no} · ${empName(r)}`, type: r.type_name, closing: d1(r.closing_balance), carried: d1(r.carry_forward),
        forfeited: d1(r.forfeited), cfExpiry: dateOf(r.cf_expiry_date), cfUsed: (used / 10).toFixed(1), cfExpired: (exp / 10).toFixed(1) });
    }),
    searchKeys: ['employee'], defaultSort: 'employee',
    notes: rows.length ? [`Roll-over of ${year} into ${year + 1}. CF used = days taken up to the CF expiry, capped at the carried days (carry-forward is used first).`]
      : [`The ${year} year-end roll-over has not been committed yet.`],
    summary: (rs) => ['closing', 'carried', 'forfeited', 'cfUsed', 'cfExpired'].map((k) => ({ label: ({ closing: 'Closing balance', carried: 'Carried', forfeited: 'Forfeited', cfUsed: 'CF used', cfExpired: 'CF expired' } as R)[k],
      value: sumDays(rs.map((r) => r.cells[k])), format: 'days' as const })),
  };
};

// ---- S-RP-24 / P7 Leave report by individual (F-RPT-27) ------------------------------------------------------------------
const leaveIndividual: Builder<'leave-individual'> = async (c, p) => {
  const year = p.year ?? Number(c.today.slice(0, 4));
  let target = c.scope === 'own' ? c.me : p.employeeId ?? c.me;
  if (!target) throw new Error('PRET-ACC-404');
  if (target !== c.me && !c.isAdmin) {
    const ok = (await sql<{ ok: boolean }>`select app.is_manager_of(${target}::uuid) as ok`.execute(c.tx)).rows[0]?.ok;
    if (!ok) throw new Error('PRET-ACC-404');
  }
  const e = (await sql<R>`select e.id, e.employee_no, e.full_name, e.preferred_name, dp.name as dept, po.title as pos, e.join_date,
        coalesce((select pp.continuous_service_date from app.employee_personal pp where pp.employee_id = e.id), e.join_date) as csd
      from app.employees e join app.departments dp on dp.id = e.department_id join app.positions po on po.id = e.position_id where e.id = ${target}::uuid`.execute(c.tx)).rows[0];
  if (!e) throw new Error('PRET-ACC-404');
  target = e.id as string;
  const cards = await balanceCards(c.tx, target, year, { visibleOnly: !c.isAdmin });
  const apps = (await sql<R>`select a.id, a.ref_no, a.start_date, a.end_date, a.days, a.status::text as status, a.decided_at, t.name as type_name, t.category::text as category,
        (select u.display_name from app.app_users u where u.id = a.decided_by) as decided_by
      from app.leave_applications a join app.leave_types t on t.id = a.leave_type_id
     where a.employee_id = ${target}::uuid and a.leave_year = ${year} order by a.start_date`.execute(c.tx)).rows;
  const svcY = completedYears(dateOf(e.csd)!, c.today);
  const header: ReportTable = {
    key: 'header', title: 'Employee',
    columns: [col('employeeNo', 'Employee no.'), col('name', 'Name'), col('department', 'Department'), col('position', 'Position'), col('joinDate', 'Join date', 'date'), col('service', 'Service')],
    rows: [row(e.id, { employeeNo: e.employee_no, name: empName(e), department: e.dept, position: e.pos, joinDate: dateOf(e.join_date), service: `${svcY} year${svcY === 1 ? '' : 's'}` })],
  };
  const applications: ReportTable = {
    key: 'applications', title: `Applications ${year}`,
    columns: [col('reference', 'Reference'), col('type', 'Type'), col('from', 'From', 'date'), col('to', 'To', 'date'), col('days', 'Days', 'days'), col('status', 'Status'),
      col('decidedBy', 'Decided by'), col('decidedAt', 'Decided at', 'datetime')],
    rows: apps.map((a) => row(a.id, { reference: a.ref_no, type: medicalName(c, a.category, a.type_name), from: dateOf(a.start_date), to: dateOf(a.end_date), days: d1(a.days),
      status: LEAVE_STATUS_LABELS[a.status as 'pending'], decidedBy: a.decided_by, decidedAt: iso(a.decided_at) },
      target === c.me ? `/my/leave/${encodeURIComponent(a.ref_no)}` : `/approvals/leave/${encodeURIComponent(a.ref_no)}`)),
  };
  return {
    title: `Leave report — ${e.employee_no} · ${empName(e)} · ${year}`,
    columns: [col('type', 'Type'), col('entitled', 'Entitled', 'days'), col('cf', 'CF', 'days'), col('earned', 'Earned', 'days'), col('adjusted', 'Adjusted', 'days'),
      col('taken', 'Taken', 'days'), col('pending', 'Pending', 'days'), col('expired', 'Expired', 'days'), col('available', 'Available', 'days')],
    rows: cards.map((b) => row(b.leaveType.id, { type: medicalName(c, b.leaveType.category, b.leaveType.name), entitled: b.entitled, cf: b.carriedForward, earned: b.earned,
      adjusted: b.adjustments, taken: b.taken, pending: b.pending, expired: b.expiredForfeited, available: b.availableLabel === 'approval only' || b.occurrences ? null : b.available })),
    tables: [header, applications], searchKeys: ['type'], asAt: year === Number(c.today.slice(0, 4)) ? c.today : `${year}-12-31`,
    summary: () => [{ label: 'Applications', value: String(apps.length), format: 'int' },
      { label: 'Days taken (approved)', value: sumDays(apps.filter((a) => a.status === 'approved' || a.status === 'cancellation_pending').map((a) => a.days)), format: 'days' }],
  };
};

// ---- S-RP-18 Claims detail (F-RPT-16) — the claims list query in line view (reconciles with S-CL-01) -----------------------
const claimsDetail: Builder<'claims-detail'> = async (c, p) => {
  const from = p.from ?? `${c.today.slice(0, 7)}-01`; const to = p.to ?? monthRange(c.today.slice(0, 7)).to;
  const range = p.dateBasis === 'transaction' ? { from, to } : p.dateBasis === 'application' ? { submittedFrom: from, submittedTo: to }
    : p.dateBasis === 'approval' ? { decidedFrom: from, decidedTo: to } : { disbursedFrom: from, disbursedTo: to };
  const page = await claimListPage(c.tx, { view: 'line', ...range, categoryIds: p.categoryIds, statuses: p.statuses?.length ? p.statuses : DEFAULT_ADMIN_CLAIM_STATUSES,
    departmentIds: p.departmentIds, batchNo: p.batchNo, includeSeparated: true, sort: 'transaction', dir: 'asc', page: 1, pageSize: 100 }, true, 'all');
  if (page.view !== 'line') throw new Error('PRET-DB');
  const lines = page.rows.filter((l) => !p.categoryIds?.length || p.categoryIds.includes(l.category.id))
    .filter((l) => p.dateBasis !== 'transaction' || (l.transactionDate >= from && l.transactionDate <= to));
  return {
    columns: [col('employee', 'Employee'), col('department', 'Department'), col('transactionDate', 'Date of transaction', 'date'), col('applicationDate', 'Date of application', 'datetime'),
      col('category', 'Category'), col('claimNo', 'Claim no.'), col('moreInfo', 'More info'), col('amount', 'Amount (RM)', 'money'), col('sst', 'SST (RM)', 'money'),
      col('attachments', 'Attachments', 'int'), col('receiptNo', 'Receipt / e-Invoice no.'), col('uuid', 'UUID'), col('decidedAt', 'Date of approval / rejection', 'datetime'),
      col('decidedBy', 'Approved / rejected by'), col('status', 'Status'), col('batch', 'Batch'), col('disbursedOn', 'Disbursed on', 'date')],
    rows: lines.map((l) => row(l.lineId, { employee: `${l.employee.employeeNo ?? ''} · ${l.employee.name}`, department: l.department, transactionDate: l.transactionDate,
      applicationDate: l.submittedAt, category: l.category.name, claimNo: l.claimNo, moreInfo: l.moreInfo, amount: l.amountInclSst, sst: l.sstAmount, attachments: l.attachmentCount,
      receiptNo: l.receiptNo, uuid: l.myinvoisUuid, decidedAt: l.decidedAt, decidedBy: l.decidedByName, status: CLAIM_STATUS_LABELS[l.status], batch: l.batchNo, disbursedOn: l.disbursedOn },
      `/approvals/claims/${encodeURIComponent(l.claimNo)}`)),
    searchKeys: ['claimNo', 'employee', 'receiptNo'], defaultSort: 'transactionDate',
    summary: (rs) => {
      const tot = sumMoney(rs.map((r) => r.cells.amount)); const sst = sumMoney(rs.map((r) => r.cells.sst));
      return [{ label: 'Lines', value: String(rs.length), format: 'int' }, { label: 'Excl. SST', value: fromSen(sen(tot) - sen(sst)), format: 'money' },
        { label: 'SST', value: sst, format: 'money' }, { label: 'Total', value: tot, format: 'money' }];
    },
  };
};

// ---- S-RP-19 Claims summary & limit utilisation (F-RPT-17) -------------------------------------------------------------
const claimsSummary: Builder<'claims-summary'> = async (c, p) => {
  const from = p.from ?? `${c.today.slice(0, 7)}-01`; const to = p.to ?? monthRange(c.today.slice(0, 7)).to;
  const agg = (await sql<R>`
    select k.name as category, dp.name as dept, to_char(l.transaction_date, 'YYYY-MM') as month, count(*)::int as lines,
           sum(l.amount_excl_sst) as excl, sum(l.sst_amount) as sst, sum(l.amount_incl_sst) as total
      from app.claim_lines l join app.claims cl on cl.id = l.claim_id join app.claim_categories k on k.id = l.category_id
      join app.employees e on e.id = cl.employee_id join app.departments dp on dp.id = e.department_id
     where cl.status in ('submitted','approved','disbursed') and l.transaction_date between ${from}::date and ${to}::date
       and ${p.departmentIds?.length ? sql`e.department_id = any(${p.departmentIds}::uuid[])` : sql`true`}
       and ${p.categoryIds?.length ? sql`l.category_id = any(${p.categoryIds}::uuid[])` : sql`true`}
     group by 1, 2, 3 order by 1, 2, 3`.execute(c.tx)).rows;
  const emps = (await sql<R>`select e.id, e.employee_no, e.full_name, e.preferred_name from app.employees e where e.status in ${ACTIVE}
       and ${p.departmentIds?.length ? sql`e.department_id = any(${p.departmentIds}::uuid[])` : sql`true`} order by e.full_name`.execute(c.tx)).rows;
  const util: ReportRow[] = [];
  for (const e of emps) {
    const u = await utilisationOf(c.tx, e.id, p.categoryIds?.length ? p.categoryIds : undefined);
    for (const r of u.rows) {
      const used = sen(r.used); const lim = sen(r.limit);
      util.push(row(`${e.id}:${r.category.id}:${r.basis}`, { employee: `${e.employee_no} · ${empName(e)}`, category: r.category.name, period: r.periodLabel,
        used: r.used, limit: r.limit, pctUsed: lim > 0 ? (Math.round((used / lim) * 1000) / 10).toFixed(1) : null }));
    }
  }
  return {
    columns: [col('category', 'Category'), col('department', 'Department'), col('month', 'Month'), col('lines', 'Lines', 'int'), col('excl', 'Excl. SST (RM)', 'money'),
      col('sst', 'SST (RM)', 'money'), col('total', 'Total (RM)', 'money')],
    rows: agg.map((r) => row(`${r.category}|${r.dept}|${r.month}`, { category: r.category, department: r.dept, month: monthLabel(r.month, true), monthKey: r.month, lines: r.lines,
      excl: m2(r.excl), sst: m2(r.sst), total: m2(r.total) })),
    tables: [{ key: 'utilisation', title: 'Limit utilisation (today)', rows: util,
      columns: [col('employee', 'Employee'), col('category', 'Category'), col('period', 'Period'), col('used', 'Used (RM)', 'money'), col('limit', 'Limit (RM)', 'money'), col('pctUsed', '% used', 'percent')] }],
    searchKeys: ['category', 'department'], defaultSort: 'category',
    notes: ['Claims Submitted, Approved or Disbursed, by transaction date. Utilisation uses the current limit periods.'],
    summary: (rs) => [{ label: 'Excl. SST', value: sumMoney(rs.map((r) => r.cells.excl)), format: 'money' }, { label: 'SST', value: sumMoney(rs.map((r) => r.cells.sst)), format: 'money' },
      { label: 'Total', value: sumMoney(rs.map((r) => r.cells.total)), format: 'money' }],
  };
};

// ---- S-RP-20 Approved not disbursed (F-RPT-18) ---------------------------------------------------------------------------
const approvedNotDisbursed: Builder<'approved-not-disbursed'> = async (c, p) => {
  const asAt = p.asAt ?? c.today;
  const rows = (await sql<R>`
    select cl.id, cl.claim_no, cl.total_amount, cl.decided_by_name, (cl.decided_at at time zone 'Asia/Kuala_Lumpur')::date as approved_on,
           (${asAt}::date - (cl.decided_at at time zone 'Asia/Kuala_Lumpur')::date)::int as age, e.employee_no, e.full_name, e.preferred_name, b.batch_no
      from app.claims cl join app.employees e on e.id = cl.employee_id left join app.disbursement_batches b on b.id = cl.disbursement_batch_id
     where cl.decided_at is not null and (cl.decided_at at time zone 'Asia/Kuala_Lumpur')::date <= ${asAt}::date
       and (cl.status = 'approved' or (cl.status = 'disbursed' and cl.disbursed_on > ${asAt}::date))
       and ${p.ageOver !== undefined ? sql`(${asAt}::date - (cl.decided_at at time zone 'Asia/Kuala_Lumpur')::date) > ${p.ageOver}::int` : sql`true`}`.execute(c.tx)).rows;
  return {
    columns: [col('claimNo', 'Claim'), col('employee', 'Employee'), col('approvedOn', 'Approved date', 'date'), col('approvedBy', 'Approved by'), col('amount', 'Amount (RM)', 'money'),
      col('age', 'Age (days)', 'int'), col('batch', 'Batch / payroll run')],
    rows: rows.map((r) => row(r.id, { claimNo: r.claim_no, employee: `${r.employee_no} · ${empName(r)}`, approvedOn: dateOf(r.approved_on), approvedBy: r.decided_by_name,
      amount: m2(r.total_amount), age: r.age, batch: r.batch_no }, `/approvals/claims/${encodeURIComponent(r.claim_no)}`)),
    searchKeys: ['claimNo', 'employee'], defaultSort: 'age', defaultDir: 'desc', asAt,
    summary: (rs) => {
      const b = ageingBuckets(rs.map((r) => ({ ageDays: Number(r.cells.age), amount: String(r.cells.amount) })));
      return [{ label: 'Claims', value: String(rs.length), format: 'int' }, { label: 'Total', value: sumMoney(rs.map((r) => r.cells.amount)), format: 'money' },
        { label: '0–30 days', value: `${b.d0_30.count} · RM ${b.d0_30.amount}`, format: 'text' }, { label: '31–60 days', value: `${b.d31_60.count} · RM ${b.d31_60.amount}`, format: 'text' },
        { label: '> 60 days', value: `${b.over60.count} · RM ${b.over60.amount}`, format: 'text' }];
    },
  };
};

// ---- S-RP-21 Disbursement batches (F-RPT-19) ----------------------------------------------------------------------------
const disbursementBatches: Builder<'disbursement-batches'> = async (c, p) => {
  const rows = (await sql<R>`
    select b.*, b.status::text as status, (select u.display_name from app.app_users u where u.id = b.prepared_by) as prepared,
           (select u.display_name from app.app_users u where u.id = b.approved_by) as approved
      from app.disbursement_batches b
     where ${and([
       ...(p.from ? [sql`coalesce(b.payment_date, b.planned_payment_date) >= ${p.from}::date`] : []),
       ...(p.to ? [sql`coalesce(b.payment_date, b.planned_payment_date) <= ${p.to}::date`] : []),
       ...(p.month ? [sql`b.disbursement_month = ${`${p.month}-01`}::date`] : []),
       ...(p.statuses?.length ? [sql`b.status::text = any(${p.statuses}::text[])`] : []),
     ])}`.execute(c.tx)).rows;
  return {
    columns: [col('batchNo', 'Batch'), col('month', 'Disbursement month'), col('cutoff', 'Approval cut-off', 'date'), col('paymentDate', 'Payment date', 'date'), col('count', 'Count', 'int'),
      col('total', 'Total (RM)', 'money'), col('status', 'Status'), col('reference', 'Payment reference'), col('prepared', 'Prepared by'), col('approved', 'Approved by')],
    rows: rows.map((b) => row(b.id, { batchNo: b.batch_no, month: monthLabel(dateOf(b.disbursement_month)!.slice(0, 7)), monthKey: dateOf(b.disbursement_month), cutoff: dateOf(b.approval_cutoff_date),
      paymentDate: dateOf(b.payment_date ?? b.planned_payment_date), count: b.claim_count, total: m2(b.total_amount), status: BATCH_STATUS_LABELS[b.status as 'draft'],
      statusCode: b.status, reference: b.payment_reference, prepared: b.prepared, approved: b.approved }, `/claims/batches/${encodeURIComponent(b.batch_no)}`)),
    searchKeys: ['batchNo', 'reference'], defaultSort: 'batchNo', defaultDir: 'desc',
    summary: (rs) => [{ label: 'Batches', value: String(rs.length), format: 'int' },
      { label: 'Total paid', value: sumMoney(rs.filter((r) => r.cells.statusCode === 'disbursed').map((r) => r.cells.total)), format: 'money' }],
  };
};

// ---- S-RP-22 Claims by tax treatment (F-RPT-20) --------------------------------------------------------------------------
const claimsTaxTreatment: Builder<'claims-tax-treatment'> = async (c, p) => {
  const year = p.year ?? Number(c.today.slice(0, 4));
  const rows = (await sql<R>`
    select e.id as emp_id, e.employee_no, e.full_name, e.preferred_name, l.tax_treatment_snapshot::text as treatment, l.ea_form_line_snapshot as ea_line,
           count(*)::int as lines, sum(l.amount_incl_sst) as total
      from app.claim_lines l join app.claims cl on cl.id = l.claim_id join app.employees e on e.id = cl.employee_id
     where cl.status = 'disbursed' and extract(year from cl.disbursed_on) = ${year}
       and ${p.employeeId ? sql`cl.employee_id = ${p.employeeId}::uuid` : sql`true`}
     group by 1, 2, 3, 4, 5, 6 order by e.employee_no, 5`.execute(c.tx)).rows;
  return {
    columns: [col('employee', 'Employee'), col('treatment', 'Tax treatment'), col('eaLine', 'EA line'), col('lines', 'Lines', 'int'), col('total', 'Total disbursed (RM)', 'money')],
    rows: rows.map((r) => row(`${r.emp_id}:${r.treatment}:${r.ea_line}`, { employee: `${r.employee_no} · ${empName(r)}`, treatment: lbl(TAX_TREATMENT_LABELS, r.treatment),
      treatmentCode: r.treatment, eaLine: r.ea_line, lines: r.lines, total: m2(r.total) })),
    searchKeys: ['employee'], defaultSort: 'employee', notes: [`Claims disbursed in ${year} (feeds the EA form in R1.1).`],
    summary: (rs) => [...new Set(rs.map((r) => String(r.cells.treatment)))].map((t) => ({ label: t, value: sumMoney(rs.filter((r) => r.cells.treatment === t).map((r) => r.cells.total)), format: 'money' as const })),
  };
};

const BUILDERS: { [I in ReportId]: Builder<I> } = {
  'employee-master': employeeMaster, headcount, 'joiners-leavers': joinersLeavers, 'probation-due': probationDue, 'retirement-milestones': retirementMilestones,
  'data-completeness': dataCompleteness, 'leave-balances': leaveBalances, 'leave-transactions': leaveTransactions, 'leave-summary': leaveSummary,
  'whos-on-leave': whosOnLeave, 'unpaid-leave': unpaidLeave, 'sick-hospitalisation': sickHospitalisation, 'replacement-leave': replacementLeave,
  'carry-forward': carryForward, 'leave-individual': leaveIndividual, 'claims-detail': claimsDetail, 'claims-summary': claimsSummary,
  'approved-not-disbursed': approvedNotDisbursed, 'disbursement-batches': disbursementBatches, 'claims-tax-treatment': claimsTaxTreatment,
};

// ===========================================================================
// Runner (shared by the query, the SEARCH action and the export action)
// ===========================================================================
export async function reportCtx(tx: Tx, user: CurrentUser, id: ReportId | null): Promise<ReportCtx> {
  const r = (await sql<{ today: string; adm: boolean; me: string | null; mgr: boolean }>`
    select app.today_myt()::text as today, app.is_admin() as adm, app.current_employee_id() as me, app.is_manager() as mgr`.execute(tx)).rows[0]!;
  const def = id ? REPORT_CATALOGUE[id] : null;
  const scope: Scope = r.adm ? 'all' : def?.managerTeam && r.mgr ? 'team' : 'own';
  if (def && !r.adm && !(scope === 'team' || id === 'leave-individual')) throw new Error('PRET-ACC-403');
  return { tx, user, today: r.today, isAdmin: r.adm, scope, me: r.me };
}

export function parseReportParams<I extends ReportId>(id: I, params: unknown): P<I> {
  const parsed = REPORT_PARAM_SCHEMAS[id].safeParse(params ?? {});
  if (!parsed.success) throw new Error('PRET-PARAMS: invalid report parameters');
  return parsed.data as P<I>;
}

export async function buildReport(c: ReportCtx, id: ReportId, params: unknown, opts: { all: boolean; forExport?: boolean }): Promise<{ result: ReportResult; built: Built; filtered: ReportRow[] }> {
  const p = parseReportParams(id, params);
  // exports always run the query (SEARCH semantics)
  const run = opts.forExport ? { ...(p as object), run: true } : p;
  const built = await (BUILDERS[id] as Builder<ReportId>)(c, run as never);
  const def = REPORT_CATALOGUE[id];
  const searched = built.searched !== false;
  const filtered = sortRows(searchRows(built.rows, (p as { q?: string }).q, built.searchKeys), built.columns,
    (p as { sort?: string }).sort ?? built.defaultSort, (p as { sort?: string }).sort ? (p as { dir: 'asc' | 'desc' }).dir : built.defaultDir ?? 'asc', built.byGroup);
  const page = (p as { page: number }).page; const pageSize = (p as { pageSize: number }).pageSize;
  const viewLogged = !opts.forExport && searched && !!built.viewLog && filtered.length > 0;
  if (viewLogged) await writeAccess(c.tx, built.viewLog!);
  const meta: ReportMeta = {
    generatedAt: new Date().toISOString(), generatedBy: c.user.displayName, asAt: built.asAt ?? c.today, scope: c.scope,
    sensitive: def.sensitive === 'always' || !!built.sensitive, viewLogged: viewLogged || (id === 'employee-master' && !!built.sensitive && searched && filtered.length > 0),
    notes: [...(c.scope === 'team' ? ['My team only.'] : []), ...(built.notes ?? [])],
  };
  return {
    built, filtered,
    result: {
      reportId: id, title: built.title ?? def.name, searched, columns: built.columns,
      rows: pageRows(filtered, page, pageSize, opts.all), total: filtered.length, page: opts.all ? 1 : page, pageSize: opts.all ? filtered.length : pageSize,
      summary: searched && built.summary ? built.summary(filtered) : [], tables: built.tables ?? [], meta,
    },
  };
}

export async function runReport(reportId: ReportId, params: AnyReportParams): Promise<ReportResult> {
  const def = REPORT_CATALOGUE[reportId];
  if (!def) throw new Error('PRET-ACC-404');
  const { ctx, user } = await authorize(def.roles);
  return withUserTx(ctx, async (tx) => (await buildReport(await reportCtx(tx, user, reportId), reportId, params, { all: false })).result);
}

// ===========================================================================
// R2 catalogue and R3 filter options
// ===========================================================================
export async function getReportCatalogue(): Promise<ReportCatalogue> {
  const { ctx, user } = await authorize(['EMP', 'MGR', 'ADM', 'SA']);
  return withUserTx(ctx, async (tx) => {
    const c = await reportCtx(tx, user, null);
    const cards: ReportCatalogueCard[] = Object.values(REPORT_CATALOGUE)
      .filter((d) => c.isAdmin || (d.managerTeam && user.roles.includes('MGR')) || (d.id === 'leave-individual' && !!c.me))
      .map((d) => ({ id: d.id, screenId: d.screenId, functionId: d.functionId, name: d.name, description: d.description, group: d.group,
        sensitive: d.sensitive !== 'no', path: d.path, teamScope: !c.isAdmin && d.managerTeam && d.id !== 'leave-individual' }));
    if (c.isAdmin) {
      const { id: _id, roles: _roles, sensitive: _s, ...card } = PAYROLL_INPUT_CARD;
      cards.push({ ...card, id: 'payroll-input', sensitive: true, teamScope: false });
    }
    return { groups: REPORT_GROUPS.map((g) => ({ group: g, label: REPORT_GROUP_LABELS[g], cards: cards.filter((x) => x.group === g) })).filter((g) => g.cards.length) };
  });
}

export async function getReportFilterOptions(reportId: ReportId): Promise<ReportFilterOptions> {
  const def = REPORT_CATALOGUE[reportId];
  if (!def) throw new Error('PRET-ACC-404');
  const { ctx, user } = await authorize(def.roles);
  return withUserTx(ctx, async (tx) => {
    const c = await reportCtx(tx, user, reportId);
    const opt = async (q: Where) => (await sql<{ id: string; label: string }>`${q}`.execute(tx)).rows;
    const year = Number(c.today.slice(0, 4));
    const employees = reportId === 'leave-individual' || reportId === 'claims-tax-treatment'
      ? c.scope === 'own'
        ? await opt(sql`select e.id, e.employee_no || ' · ' || e.full_name as label from app.employees e where e.id = app.current_employee_id()`)
        : await opt(sql`select e.id, e.employee_no || ' · ' || e.full_name || case when e.status = 'separated' then ' (separated)' else '' end as label
              from app.employees e where e.status not in ('withdrawn','pending_join')
               and (${c.isAdmin} or e.id = app.current_employee_id() or app.is_manager_of(e.id)) order by e.full_name`)
      : [];
    const defaults: ReportFilterOptions['defaults'] = {
      asAt: c.today, year, month: c.today.slice(0, 7), from: `${c.today.slice(0, 7)}-01`, to: monthRange(c.today.slice(0, 7)).to,
      ...(reportId === 'carry-forward' ? { year: year - 1 } : {}),
      ...(reportId === 'whos-on-leave' ? { from: c.today, to: c.today } : {}),
      ...(['joiners-leavers', 'replacement-leave'].includes(reportId) ? { from: `${year}-01-01`, to: c.today } : {}),
      ...(reportId === 'leave-individual' && c.me ? { employeeId: c.me } : {}),
      ...(reportId === 'employee-master' ? { columns: EMPLOYEE_MASTER_DEFAULT_COLUMNS } : {}),
    };
    return {
      reportId,
      departments: await opt(sql`select d.id, d.name as label from app.departments d where d.is_active order by d.name`),
      locations: await opt(sql`select l.id, l.name as label from app.work_locations l where l.is_active order by l.name`),
      leaveTypes: (await sql<R>`select t.id, t.name, t.category::text as category from app.leave_types t where t.is_active and t.deduct_from_type_id is null order by t.display_order`.execute(tx)).rows
        .map((t) => ({ id: t.id, label: medicalName(c, t.category, t.name) })),
      claimCategories: c.isAdmin ? await opt(sql`select k.id, k.name as label from app.claim_categories k order by k.display_order`) : [],
      batches: c.isAdmin ? await opt(sql`select b.batch_no as id, b.batch_no || ' · ' || to_char(b.disbursement_month, 'Mon YYYY') as label from app.disbursement_batches b order by b.batch_no desc limit 60`) : [],
      separationTypes: Object.entries(SEPARATION_TYPE_LABELS).map(([id, label]) => ({ id, label })),
      employees, employeeLocked: c.scope === 'own',
      defaults,
      employeeMasterFields: reportId === 'employee-master' ? EMPLOYEE_MASTER_FIELDS : [],
    };
  });
}

// ===========================================================================
// R1 Admin dashboard (F-RPT-01) — each tile in its own savepoint: a failing tile is null, the others still load
// ===========================================================================
async function tile<T>(tx: Tx, name: string, fn: () => Promise<T>): Promise<T | null> {
  await sql`savepoint ${sql.raw(name)}`.execute(tx);
  try {
    const v = await fn();
    await sql`release savepoint ${sql.raw(name)}`.execute(tx);
    return v;
  } catch {
    await sql`rollback to savepoint ${sql.raw(name)}`.execute(tx);
    return null;
  }
}
const one = async (tx: Tx, q: Where): Promise<number> => Number((await sql<{ n: number }>`${q}`.execute(tx)).rows[0]?.n ?? 0);

export async function adminDashboardTx(tx: Tx, user: CurrentUser, params?: DashboardParams): Promise<AdminDashboard> {
  const p = dashboardParamsSchema.parse(params ?? {});
  const today = await todayOf(tx);
  const year = Number(today.slice(0, 4));
  const isSa = user.roles.includes('SA');
  const headcount = await tile(tx, 'hc', () => one(tx, sql`select count(*)::int as n from app.employees e where e.status in ${ACTIVE}`));
  const onLeaveToday = await tile(tx, 'olt', () => one(tx, sql`select count(distinct d.employee_id)::int as n from app.leave_application_days d
      join app.leave_applications a on a.id = d.application_id where d.leave_date = ${today}::date and d.weight > 0 and ${TAKEN}`));
  const pend = await tile(tx, 'pl', async () => (await sql<R>`select count(*)::int as n, count(*) filter (where t.source in ('admin_pool','super_admin_pool'))::int as adm
      from app.approval_tasks t where t.status = 'open' and t.subject_type in ('leave_application','leave_cancellation','replacement_credit')`.execute(tx)).rows[0]!);
  const probationDue = await tile(tx, 'pd', () => one(tx, sql`select count(*)::int as n from app.employees e where e.status = 'on_probation'
      and coalesce(e.extended_probation_end_date, e.probation_end_date) between app.today_myt() and app.today_myt() + 30`));
  const missingPayroll = await tile(tx, 'mp', () => one(tx, sql`select count(*)::int as n from app.employees e join lateral app.employee_completeness(array[e.id]) x on true
      where e.status in ${ACTIVE} and coalesce(cardinality(x.missing), 0) + coalesce(cardinality(x.missing_payroll), 0) > 0`));
  const changeRequests = await tile(tx, 'cr', () => one(tx, sql`select count(*)::int as n from app.change_requests r where r.status = 'submitted'`));
  const ph = (await tile(tx, 'ph', async () => (await sql<R>`select bool_or(y.status = 'published') as pub, count(*)::int as n from app.holiday_calendar_years y where y.year = ${year + 1}`.execute(tx)).rows[0]!)) ?? { pub: false, n: 0 };
  const alerts: AdminDashboard['alerts'] = [];
  await tile(tx, 'al', async () => {
    const orphans = await one(tx, sql`select count(*)::int as n from app.employees e join app.employees m on m.id = e.manager_employee_id
        where e.status in ${ACTIVE} and m.status in ('separated','withdrawn')`);
    if (orphans) alerts.push({ code: 'N-49', message: `${orphans} reportee${orphans === 1 ? '' : 's'} without an active manager`, href: '/organisation/reporting-lines', tone: 'warning' });
    if (isSa) {
      const ext = (await sql<R>`select min(u.access_end_date - app.today_myt())::int as days, count(*)::int as n from app.app_users u
          where u.user_type = 'external' and u.status = 'active' and u.access_end_date between app.today_myt() and app.today_myt() + 30`.execute(tx)).rows[0]!;
      if (ext.n) alerts.push({ code: 'N-54', message: `External access ends in ${ext.days} day${ext.days === 1 ? '' : 's'}${ext.n > 1 ? ` (${ext.n} users)` : ''}`, href: '/users?type=external', tone: 'warning' });
    }
    if (today >= `${year}-11-01` && !ph.pub) alerts.push({ code: 'N-58', message: `Public-holiday calendar ${year + 1} not published — publish by 31/12/${year}`, href: `/organisation/holidays?year=${year + 1}`, tone: 'warning' });
    const cfg = deliveryConfig();
    if (!cfg.configured) {
      const q = await one(tx, sql`select count(*)::int as n from app.email_outbox o where o.status = 'pending'`);
      if (q) alerts.push({ code: 'email', message: `Email is not configured — ${q} email${q === 1 ? '' : 's'} queued`, href: '/notifications/log', tone: 'info' });
    } else {
      const f = await one(tx, sql`select count(*)::int as n from app.email_outbox o where o.status = 'failed' and o.attempts >= 5`);
      if (f) alerts.push({ code: 'email', message: `${f} email${f === 1 ? '' : 's'} failed to send`, href: '/notifications/log?statuses=failed', tone: 'error' });
    }
  });
  const pr = p.claimPeriod === 'this' ? { from: `${today.slice(0, 7)}-01`, to: monthRange(today.slice(0, 7)).to }
    : p.claimPeriod === 'last' ? (() => { const [y, m] = today.split('-').map(Number) as number[]; const lm = m === 1 ? `${y! - 1}-12` : `${y}-${String(m! - 1).padStart(2, '0')}`; return monthRange(lm); })()
      : { from: `${year}-01-01`, to: `${year}-12-31` };
  const claims = await tile(tx, 'cl', async () => {
    const page = await claimListPage(tx, { view: 'header', submittedFrom: pr.from, submittedTo: pr.to, page: 1, pageSize: 1 }, false, 'all');
    const k = page.kpis;
    const agg = (await sql<R>`select count(*) filter (where c.status = 'submitted')::int as s_n, coalesce(sum(c.total_amount) filter (where c.status = 'submitted'), 0) as s_amt,
        count(*) filter (where c.status = 'approved')::int as a_n, coalesce(sum(c.total_amount) filter (where c.status = 'approved'), 0) as a_amt,
        count(*) filter (where c.status = 'approved' and c.decided_at < now() - interval '30 days')::int as aged from app.claims c`.execute(tx)).rows[0]!;
    const b = (await sql<R>`select b.batch_no, b.status::text as status, b.outputs_out_of_date from app.disbursement_batches b
        where b.status not in ('disbursed','cancelled') order by b.disbursement_month desc, b.created_at desc limit 1`.execute(tx)).rows[0];
    const NEXT: Record<string, string> = { draft: 'Generate outputs', pending_approval: 'Awaiting Super Admin', approved: 'Generate outputs', exported: 'Mark disbursed' };
    return {
      period: p.claimPeriod, periodFrom: pr.from, periodTo: pr.to,
      submitted: k.submitted, approvedNotDisbursed: k.approvedNotDisbursed, disbursed: k.disbursed, rejected: k.rejected, exclSst: k.totalExclSst, sst: k.totalSst, total: k.total,
      awaiting: { count: agg.s_n, amount: m2(agg.s_amt) }, approvedNd: { count: agg.a_n, amount: m2(agg.a_amt), agedOver30: agg.aged },
      batch: b ? { batchNo: b.batch_no, href: `/claims/batches/${encodeURIComponent(b.batch_no)}`, status: b.status, statusLabel: BATCH_STATUS_LABELS[b.status as 'draft'],
        outOfDate: !!b.outputs_out_of_date, nextStep: b.outputs_out_of_date ? 'Regenerate outputs' : NEXT[b.status] ?? '—' } : null,
    };
  });
  return {
    asAt: new Date().toISOString(), today,
    hr: { headcount, onLeaveToday, pendingLeave: pend?.n ?? null, pendingLeaveAdmin: pend?.adm ?? null, probationDue, missingPayroll, changeRequests,
      phYear: year + 1, phStatus: ph.pub ? 'Published' : ph.n ? 'Draft' : 'Not started', phPublishBy: `${year}-12-31` },
    alerts, claims,
  };
}

export async function getAdminDashboard(params?: DashboardParams): Promise<AdminDashboard> {
  const { ctx, user } = await authorize(ADM_SA);
  return withUserTx(ctx, (tx) => adminDashboardTx(tx, user, params));
}

// ===========================================================================
// F-RPT-22 Manager dashboard and the Employees-list KPI strip
// ===========================================================================
export async function getManagerDashboard(): Promise<ManagerDashboard | null> {
  const { ctx } = await authorize(['MGR']);
  return withUserTx(ctx, async (tx) => {
    const mgr = (await sql<{ m: boolean }>`select app.is_manager() as m`.execute(tx)).rows[0]?.m;
    if (!mgr) return null;
    const today = await todayOf(tx);
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const monday = new Date(Date.parse(`${today}T00:00:00Z`) - dow * 86400_000).toISOString().slice(0, 10);
    const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10);
    const r = (await sql<R>`select
        (select count(*)::int from app.approval_tasks t where t.status = 'open' and app.can_act_on_task(t.id)
            and (t.assignee_user_id = app.current_app_user_id() or app.active_delegate(t.assignee_user_id, app.today_myt(), app.task_scope(t.subject_type)) = app.current_app_user_id())) as waiting,
        (select count(distinct d.employee_id)::int from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
          where app.is_manager_of(d.employee_id) and d.leave_date = ${today}::date and d.weight > 0 and ${TAKEN}) as today,
        (select count(distinct d.employee_id)::int from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
          where app.is_manager_of(d.employee_id) and d.leave_date between ${monday}::date and ${sunday}::date and d.weight > 0 and ${TAKEN}) as week,
        (select count(*)::int from app.employees e where app.is_manager_of(e.id) and e.status = 'on_probation'
          and coalesce(e.extended_probation_end_date, e.probation_end_date) between app.today_myt() and app.today_myt() + 30) as probation,
        (select count(*)::int from app.claims c where app.is_manager_of(c.employee_id) and c.status = 'submitted') as claims`.execute(tx)).rows[0]!;
    return {
      approvalsWaiting: r.waiting, teamOnLeaveToday: r.today, teamOnLeaveThisWeek: r.week, probationDue: r.probation, teamClaimsSubmitted: r.claims,
      links: { approvals: '/approvals', onLeaveToday: `/reports/whos-on-leave?from=${today}&to=${today}`, onLeaveWeek: `/reports/whos-on-leave?from=${monday}&to=${sunday}`,
        probation: '/reports/probation-due?withinDays=30', claims: '/approvals?tab=claims' },
    };
  });
}

export async function getEmployeeKpis(): Promise<EmployeeKpis> {
  const { ctx } = await authorize(ADM_SA);
  return withUserTx(ctx, async (tx) => {
    const today = await todayOf(tx);
    const r = (await sql<R>`select
        (select count(*)::int from app.employees e where e.status in ${ACTIVE}) as hc,
        (select count(*)::int from app.employees e where e.status = 'on_probation') as prob,
        (select count(*)::int from app.employees e where e.status = 'notice_period') as notice,
        (select count(distinct d.employee_id)::int from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
          where d.leave_date = ${today}::date and d.weight > 0 and ${TAKEN}) as olt`.execute(tx)).rows[0]!;
    return {
      headcount: r.hc, onProbation: r.prob, noticePeriod: r.notice, onLeaveToday: r.olt,
      links: { headcount: '/employees', onProbation: '/employees?statuses=on_probation', noticePeriod: '/employees?statuses=notice_period',
        onLeaveToday: `/reports/whos-on-leave?from=${today}&to=${today}` },
    };
  });
}

// ===========================================================================
// R5 Monthly payroll-input pack (F-RPT-21) — ADM / SA, sensitive (MyKad, bank account full, statutory numbers)
// ===========================================================================
const PI_FIELDS = ['nric', 'bank_account_no', 'epf_no', 'socso_no', 'income_tax_no'];
const PI_CATEGORIES: DataCategory[] = ['identity', 'bank', 'statutory'];

function decryptOr(enc: Buffer | null, ref: { table: string; column: string; rowId: string }): string | null {
  if (!enc) return null;
  try { return fieldCrypto.decrypt(enc, ref); } catch { return null; }
}

export type PayrollPackBuilt = { pack: PayrollInputPack; unpaidLines: ExportedUnpaidLine[]; employeeIds: string[] };

export async function payrollInputPackTx(tx: Tx, user: CurrentUser, params: PayrollInputParams, forExport: boolean): Promise<PayrollPackBuilt> {
  const p = payrollInputParamsSchema.parse(params ?? {});
  const c = await reportCtx(tx, user, null);
  if (!c.isAdmin) throw new Error('PRET-ACC-403');
  const month = p.month ?? c.today.slice(0, 7);
  const { from, to } = monthRange(month);
  const empIds = new Set<string>();
  const joiners = (await sql<R>`
    select e.id, e.employee_no, e.full_name, e.join_date, dp.name as dept, po.title as pos, pp.nric_enc, st.epf_no, st.socso_no, st.socso_category::text as socso_category,
           st.income_tax_no, st.pay_epf, st.pay_socso, st.pay_eis, st.pay_pcb, b.id as bank_id, b.payment_method::text as payment_method, bk.name as bank_name,
           b.account_no_enc, b.account_holder_name
      from app.employees e join app.departments dp on dp.id = e.department_id join app.positions po on po.id = e.position_id
      left join app.employee_personal pp on pp.employee_id = e.id left join app.employee_statutory_profiles st on st.employee_id = e.id
      left join lateral (select x.* from app.employee_bank_accounts x where x.employee_id = e.id and not x.is_superseded order by x.effective_from desc limit 1) b on true
      left join app.banks bk on bk.id = b.bank_id
     where e.status <> 'withdrawn' and e.join_date between ${from}::date and ${to}::date order by e.employee_no`.execute(tx)).rows;
  const leavers = (await sql<R>`
    select e.id, e.employee_no, e.full_name, s.last_working_day, s.separation_type::text as separation_type, sd.notice_shortfall_days, sd.notice_outcome::text as notice_outcome
      from app.employees e join app.employee_separations s on s.employee_id = e.id and not s.is_withdrawn and not s.superseded_by_rehire
      left join app.employee_separation_details sd on sd.separation_id = s.id
     where s.last_working_day between ${from}::date and ${to}::date order by e.employee_no`.execute(tx)).rows;
  const jobs = (await sql<R>`
    select h.id, h.effective_date, h.change_type::text as change_type, e.id as emp_id, e.employee_no, e.full_name,
           dp.name as dept, po.title as pos, g.name as grade, m.full_name as mgr, l.name as loc,
           pd.name as p_dept, ppo.title as p_pos, pg.name as p_grade, pm.full_name as p_mgr, pl.name as p_loc
      from app.employee_job_history h join app.employees e on e.id = h.employee_id
      left join app.departments dp on dp.id = h.department_id left join app.positions po on po.id = h.position_id left join app.grades g on g.id = h.grade_id
      left join app.employees m on m.id = h.manager_employee_id left join app.work_locations l on l.id = h.work_location_id
      left join lateral (select x.* from app.employee_job_history x where x.employee_id = h.employee_id and not x.is_deleted and x.effective_date < h.effective_date
                          order by x.effective_date desc limit 1) pv on true
      left join app.departments pd on pd.id = pv.department_id left join app.positions ppo on ppo.id = pv.position_id left join app.grades pg on pg.id = pv.grade_id
      left join app.employees pm on pm.id = pv.manager_employee_id left join app.work_locations pl on pl.id = pv.work_location_id
     where not h.is_deleted and h.effective_date between ${from}::date and ${to}::date and pv.effective_date is not null
     order by e.employee_no, h.effective_date`.execute(tx)).rows;
  const banks = (await sql<R>`
    select b.id, b.effective_from, b.payment_method::text as payment_method, bk.name as bank_name, b.account_no_enc, b.account_holder_name, e.id as emp_id, e.employee_no, e.full_name
      from app.employee_bank_accounts b join app.employees e on e.id = b.employee_id left join app.banks bk on bk.id = b.bank_id
     where b.effective_from between ${from}::date and ${to}::date
       and exists (select 1 from app.employee_bank_accounts o where o.employee_id = b.employee_id and o.effective_from < b.effective_from)
     order by e.employee_no, b.effective_from`.execute(tx)).rows;
  const stat = (await sql<R>`
    select st.*, st.socso_category::text as socso_cat, e.employee_no, e.full_name, e.id as emp_id
      from app.employee_statutory_profiles st join app.employees e on e.id = st.employee_id
     where (st.updated_at at time zone 'Asia/Kuala_Lumpur')::date between ${from}::date and ${to}::date
       and st.updated_at > st.created_at + interval '1 minute' order by e.employee_no`.execute(tx)).rows;
  const unpaid = await unpaidRows(c, month);
  const rest = (await sql<R>`
    select r.id, r.credit_no, r.date_worked, r.compensate_hours, e.employee_no, e.full_name, e.id as emp_id
      from app.replacement_credits r join app.employees e on e.id = r.employee_id
     where r.status = 'approved' and r.compensate_by_pay and r.date_worked between ${from}::date and ${to}::date order by e.employee_no, r.date_worked`.execute(tx)).rows;
  // EC-LV-14: unpaid lines exported for earlier months, now cancelled / shortened → Reversal
  const prev = (await sql<{ lines: ExportedUnpaidLine[] }>`select x.unpaid_lines as lines from app.payroll_input_exports x where x.payroll_month < ${from}::date order by x.payroll_month, x.version`.execute(tx)).rows
    .flatMap((r) => r.lines ?? []);
  const prevApps = [...new Set(prev.map((l) => l.applicationId))];
  const current = prevApps.length ? (await sql<R>`select a.id, a.status::text as status, to_char(d.leave_date, 'YYYY-MM') as month, sum(d.weight) as days
      from app.leave_applications a left join app.leave_application_days d on d.application_id = a.id and d.weight > 0
     where a.id = any(${prevApps}::uuid[]) group by 1, 2, 3`.execute(tx)).rows.map((r) => ({ applicationId: r.id, month: r.month ?? '', days: String(r.days ?? 0), status: r.status })) : [];
  const reversals = unpaidReversals(prev, current, month);
  const revEmps = reversals.length ? (await sql<R>`select a.id, e.employee_no, e.full_name, e.id as emp_id from app.leave_applications a join app.employees e on e.id = a.employee_id
      where a.id = any(${reversals.map((r) => r.applicationId)}::uuid[])`.execute(tx)).rows : [];

  [...joiners.map((r) => r.id), ...leavers.map((r) => r.id), ...jobs.map((r) => r.emp_id), ...banks.map((r) => r.emp_id), ...stat.map((r) => r.emp_id),
    ...unpaid.map((r) => r.emp_id), ...rest.map((r) => r.emp_id), ...revEmps.map((r) => r.emp_id)].forEach((id) => empIds.add(id));
  // BR-ADM-21: the access-log row comes before any value is decrypted (the export action logs its own 'export' row)
  if (!forExport && empIds.size) {
    await writeAccess(tx, { action: 'view_sensitive', entityType: 'report:payroll-input', entityRef: month, employeeIds: [...empIds], fields: PI_FIELDS, categories: PI_CATEGORIES, recordCount: empIds.size });
  }
  const leaverPos = new Map<string, string>();
  for (const l of leavers) {
    const pos = await leaverPositionFor(tx, l.id, dateOf(l.last_working_day)!);
    leaverPos.set(l.id, pos?.summary ?? '');
  }
  const diffs = (j: R) => [
    j.p_dept !== j.dept ? `Department: ${j.p_dept ?? '—'} → ${j.dept ?? '—'}` : null, j.p_pos !== j.pos ? `Position: ${j.p_pos ?? '—'} → ${j.pos ?? '—'}` : null,
    j.p_grade !== j.grade ? `Grade: ${j.p_grade ?? '—'} → ${j.grade ?? '—'}` : null, j.p_mgr !== j.mgr ? `Manager: ${j.p_mgr ?? '—'} → ${j.mgr ?? '—'}` : null,
    j.p_loc !== j.loc ? `Location: ${j.p_loc ?? '—'} → ${j.loc ?? '—'}` : null,
  ].filter(Boolean) as string[];
  const tab = (sheet: PayrollInputSheet, columns: ReportColumn[], rows: ReportRow[]): PayrollInputTab => ({ key: sheet, sheet, title: PAYROLL_INPUT_SHEET_LABELS[sheet], columns, rows, count: rows.length });
  const tabs: PayrollInputTab[] = [
    tab('joiners', [col('employeeNo', 'Employee no.'), col('name', 'Name'), col('joinDate', 'Join date', 'date'), col('department', 'Department'), col('position', 'Position'),
      col('mykad', 'MyKad no.', 'text', { sensitive: true }), col('epfNo', 'EPF no.', 'text', { sensitive: true }), col('socsoNo', 'SOCSO no.', 'text', { sensitive: true }),
      col('socsoCategory', 'SOCSO category'), col('taxNo', 'Income tax no.', 'text', { sensitive: true }), col('contributions', 'Contributions'),
      col('paymentMethod', 'Payment method'), col('bank', 'Bank'), col('accountNo', 'Account no.', 'text', { sensitive: true }), col('holder', 'Account holder')],
    joiners.map((r) => row(r.id, { employeeNo: r.employee_no, name: r.full_name, joinDate: dateOf(r.join_date), department: r.dept, position: r.pos,
      mykad: formatMykad(decryptOr(r.nric_enc, { table: 'employee_personal', column: 'nric_enc', rowId: r.id }) ?? '') || null, epfNo: r.epf_no, socsoNo: r.socso_no,
      socsoCategory: lbl(SOCSO_CATEGORY_LABELS, r.socso_category), taxNo: r.income_tax_no,
      contributions: [r.pay_epf ? 'EPF' : null, r.pay_socso ? 'SOCSO' : null, r.pay_eis ? 'EIS' : null, r.pay_pcb ? 'PCB' : null].filter(Boolean).join(', ') || null,
      paymentMethod: lbl(PAYMENT_METHOD_LABELS, r.payment_method), bank: r.bank_name,
      accountNo: r.bank_id ? decryptOr(r.account_no_enc, { table: 'employee_bank_accounts', column: 'account_no_enc', rowId: r.bank_id }) : null, holder: r.account_holder_name },
    `/employees/${encodeURIComponent(r.employee_no)}`))),
    tab('leavers', [col('employeeNo', 'Employee no.'), col('name', 'Name'), col('lwd', 'Last working day', 'date'), col('separationType', 'Separation type'),
      col('finalLeave', 'Final leave balance'), col('noticeShortfall', 'Notice shortfall (days)', 'int'), col('noticeOutcome', 'Notice')],
    leavers.map((r) => row(r.id, { employeeNo: r.employee_no, name: r.full_name, lwd: dateOf(r.last_working_day), separationType: lbl(SEPARATION_TYPE_LABELS, r.separation_type),
      finalLeave: leaverPos.get(r.id) || null, noticeShortfall: r.notice_shortfall_days ?? 0, noticeOutcome: r.notice_outcome ? String(r.notice_outcome).replace(/_/g, ' ') : null },
    `/employees/${encodeURIComponent(r.employee_no)}`))),
    tab('job_changes', [col('employeeNo', 'Employee no.'), col('name', 'Name'), col('effectiveDate', 'Effective date', 'date'), col('changeType', 'Change type'), col('change', 'From → to', 'list', { sortable: false })],
      jobs.map((j) => row(j.id, { employeeNo: j.employee_no, name: j.full_name, effectiveDate: dateOf(j.effective_date), changeType: lbl(JOB_CHANGE_TYPE_LABELS, j.change_type), change: diffs(j) }))),
    tab('bank_changes', [col('employeeNo', 'Employee no.'), col('name', 'Name'), col('effectiveDate', 'Effective date', 'date'), col('paymentMethod', 'Payment method'), col('bank', 'Bank'),
      col('accountNo', 'Account no.', 'text', { sensitive: true }), col('holder', 'Account holder')],
    banks.map((b) => row(b.id, { employeeNo: b.employee_no, name: b.full_name, effectiveDate: dateOf(b.effective_from), paymentMethod: lbl(PAYMENT_METHOD_LABELS, b.payment_method),
      bank: b.bank_name, accountNo: decryptOr(b.account_no_enc, { table: 'employee_bank_accounts', column: 'account_no_enc', rowId: b.id }), holder: b.account_holder_name }))),
    tab('statutory_changes', [col('employeeNo', 'Employee no.'), col('name', 'Name'), col('changedOn', 'Changed on', 'datetime'), col('epfNo', 'EPF no.', 'text', { sensitive: true }),
      col('socsoNo', 'SOCSO no.', 'text', { sensitive: true }), col('socsoCategory', 'SOCSO category'), col('taxNo', 'Income tax no.', 'text', { sensitive: true }),
      col('contributions', 'Contributions'), col('zakat', 'Zakat (RM/month)', 'money'), col('ptptn', 'PTPTN (RM/month)', 'money')],
    stat.map((s) => row(s.employee_id, { employeeNo: s.employee_no, name: s.full_name, changedOn: iso(s.updated_at), epfNo: s.epf_no, socsoNo: s.socso_no,
      socsoCategory: lbl(SOCSO_CATEGORY_LABELS, s.socso_cat), taxNo: s.income_tax_no,
      contributions: [s.pay_epf ? 'EPF' : null, s.pay_socso ? 'SOCSO' : null, s.pay_eis ? 'EIS' : null, s.pay_pcb ? 'PCB' : null].filter(Boolean).join(', ') || null,
      zakat: s.pay_zakat ? m2(s.zakat_monthly_amount) : null, ptptn: s.ptptn_monthly_amount ? m2(s.ptptn_monthly_amount) : null }))),
    tab('unpaid_leave', [col('employeeNo', 'Employee no.'), col('name', 'Name'), col('reference', 'Reference'), col('dates', 'Dates', 'list', { sortable: false }), col('days', 'Days', 'days')],
      [...unpaid.map((u) => row(u.id, { employeeNo: u.employee_no, name: u.full_name, reference: u.ref_no, dates: u.dates, days: d1(u.days) })),
        ...reversals.map((r) => { const e = revEmps.find((x) => x.id === r.applicationId); return row(`rev:${r.applicationId}:${r.month}`,
          { employeeNo: e?.employee_no ?? null, name: e?.full_name ?? null, reference: r.refNo, dates: [`Reversal of ${monthLabel(r.month)}`], days: r.days }, null, { badge: 'Reversal' }); })]),
    tab('rest_day_work', [col('employeeNo', 'Employee no.'), col('name', 'Name'), col('dateWorked', 'Date worked', 'date'), col('hours', 'Hours', 'days'), col('creditNo', 'Credit no.')],
      rest.map((r) => row(r.id, { employeeNo: r.employee_no, name: r.full_name, dateWorked: dateOf(r.date_worked), hours: d1(r.compensate_hours), creditNo: r.credit_no }))),
  ];
  const last = (await sql<R>`select x.version, x.exported_at, (select u.display_name from app.app_users u where u.id = x.exported_by) as by_name
      from app.payroll_input_exports x where x.payroll_month = ${from}::date order by x.version desc limit 1`.execute(tx)).rows[0];
  const unpaidLines: ExportedUnpaidLine[] = [
    ...unpaid.map((u) => ({ applicationId: u.id as string, refNo: u.ref_no as string, month, days: d1(u.days) })),
    ...reversals,
  ];
  void PAYROLL_INPUT_SHEETS;
  return {
    unpaidLines, employeeIds: [...empIds],
    pack: {
      month, monthLabel: monthLabel(month), periodFrom: from, periodTo: to, tabs,
      lastExport: last ? { at: iso(last.exported_at)!, byName: last.by_name ?? '—', version: last.version } : null,
      noClaimsNote: PAYROLL_INPUT_NO_CLAIMS_NOTE, retired: null,
      meta: { generatedAt: new Date().toISOString(), generatedBy: user.displayName, asAt: to < c.today ? to : c.today, scope: 'all', sensitive: true,
        viewLogged: !forExport && empIds.size > 0, notes: ['Statutory-profile changes list profiles edited this month (current values).'] },
    },
  };
}

export async function getPayrollInputPack(params: PayrollInputParams): Promise<PayrollInputPack> {
  const { ctx, user } = await authorize(ADM_SA);
  return withUserTx({ ...ctx, reason: 'Monthly payroll-input pack (F-RPT-21)' }, async (tx) => (await payrollInputPackTx(tx, user, params, false)).pack);
}
