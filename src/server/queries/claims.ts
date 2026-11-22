import 'server-only';
import { sql, withUserTx, type Tx } from '../db';
import type { Role } from '../auth/current-user';
import { authorize, iso, likeTerm, resolveNames, stamps } from '../lib/action-helpers';
import { parseParams, EXPORT_LIMIT } from './org';
import { actionability, dbIsAdmin, myEmployeeId, personRef, todayMyt } from './leave';
import { weekdaysBetween } from './approvals';
import { fieldCrypto } from '../crypto';
import {
  batchListParamsSchema, categoryListParamsSchema, claimListParamsSchema, employeeClaimsParamsSchema, lateOverrideListParamsSchema,
  limitListParamsSchema, limitSummary, myClaimsParamsSchema, MILEAGE_RECEIPT_HINT, monthPeriod, yearPeriod, BATCH_ROUTE_NOTE, DEFAULT_ADMIN_CLAIM_STATUSES, HLB_MANUAL_BANNER,
  type BatchDefaults, type BatchDetail, type BatchListPage, type BatchListParams, type BatchOutputVersion, type BatchPayeeRow, type BatchRow,
  type CategoryDetail, type CategoryListParams, type CategoryRef, type CategoryRow, type ClaimDetail, type ClaimFlag, type ClaimForm,
  type ClaimFormCategory, type ClaimKpis, type ClaimLineListRow, type ClaimLineView, type ClaimListPage, type ClaimListParams, type ClaimListRow,
  type ClaimPolicy, type ClaimSetupOptions, type ClaimStatus, type EmployeeClaimRow, type EmployeeClaimsParams, type EmployeeClaimsTab,
  type HomeClaims, type LateOverrideListParams, type LateOverrideRow, type LimitCheck, type LimitListParams, type LimitRow, type LimitUtilisation,
  type LimitUtilisationRow, type MyClaimRow, type MyClaimsPage, type MyClaimsParams, type Paged, type PaymentListReport, type Ref,
  type SeparationOpenClaims, type TeamMemberClaims,
} from '../contracts/claims';
import type { ApprovalTrailRow, ApproverSource, TaskSubject } from '../contracts/approvals';
import { APPROVER_SOURCE_LABELS, APPROVER_SOURCE_SHORT } from '../contracts/approvals';
import { buildPaymentList, maskAccount, monthLabel, sumMoney, type PayeeInput, type PostingLineInput } from '../lib/claims-outputs';
import { csvDate } from '../lib/csv';
import type { z } from 'zod';
import type { attachmentBundleSchema, batchCandidatesSchema, BatchCandidates, BatchPreview, ClaimEmployeeOption, LateOverrideCandidate } from '../contracts/claims';
type AttachmentBundleInputParsed = z.output<typeof attachmentBundleSchema>;
type BatchCandidatesParsed = z.output<typeof batchCandidatesSchema>;

// M3 Claims queries (W2-005). Server-only; every exported query: requireUser([...]) → withUserTx (RLS). The database decides
// visibility (rls §5.6: New claims private to the owner / on-behalf ADM; P-TEAM otherwise; batches & payees ADM/SA only) and
// this module projects per role (managers never get batch, bank, dependant, tax / GL data — rls §8).

export const ANY: Role[] = ['EMP', 'MGR', 'ADM', 'SA'];
export const ADMIN: Role[] = ['ADM', 'SA'];
export const TEAM: Role[] = ['MGR', 'ADM', 'SA'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
type Where = ReturnType<typeof sql>;
const and = (c: Where[]): Where => (c.length ? sql.join(c, sql` and `) : sql`true`);
const dirOf = (d: 'asc' | 'desc') => sql.raw(d === 'desc' ? 'desc' : 'asc');
export const m2 = (v: unknown): string => (v === null || v === undefined || v === '' ? '0.00' : Number.isNaN(Number(v)) ? '0.00' : String(v).includes('.') ? String(v) : `${v}.00`);
export const m2n = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : m2(v));
const mytDate = (v: Date | string) => new Date(new Date(v).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
const CLAIM_NO_RE = /^CL-[0-9]{4}-[0-9]{5,}$/;
const BATCH_NO_RE = /^PB-[0-9]{4}-[0-9]{3,}$/;

export function catRef(r: R, p = ''): CategoryRef {
  return { id: r[`${p}category_id`] ?? r.id, code: r[`${p}code`], name: r[`${p}category_name`] ?? r.name, group: r[`${p}claim_group`], isMileage: !!r[`${p}is_mileage`] };
}
export function flagsOf(r: R): ClaimFlag[] {
  const f: ClaimFlag[] = [];
  if (r.flag_over_limit) f.push('over_limit');
  if (r.flag_late_override) f.push('late_override');
  if (r.flag_possible_duplicate) f.push('possible_duplicate');
  if (r.on_behalf_by) f.push('on_behalf');
  return f;
}
export async function isManager(tx: Tx): Promise<boolean> {
  return (await sql<{ m: boolean }>`select app.is_manager() as m`.execute(tx)).rows[0]?.m ?? false;
}

// ===========================================================================
// C5 / C6 categories · C7 limits · C8 policy
// ===========================================================================
const CURRENT_RATE = sql`(select r.rate_per_km from app.claim_category_rates r where r.category_id = k.id and r.effective_from <= app.today_myt() order by r.effective_from desc limit 1)`;
const EVERYONE_LIMIT = sql`(select row_to_json(l) from app.claim_limits l where l.category_id = k.id and l.applies_to = 'everyone'
    and l.effective_from <= app.today_myt() and (l.effective_to is null or l.effective_to >= app.today_myt()) order by l.effective_from desc limit 1)`;
function limitJsonSummary(j: R | null): string {
  if (!j) return 'No limit';
  return limitSummary({ perTransaction: m2n(j.per_transaction), perMonth: m2n(j.per_month), perYear: m2n(j.per_year) });
}
export async function categoryRows(tx: Tx, params: CategoryListParams, all: boolean): Promise<Paged<CategoryRow>> {
  const p = parseParams(categoryListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    ...(q ? [sql`(k.code ilike ${q} or k.name ilike ${q})`] : []),
    ...(p.groups?.length ? [sql`k.claim_group::text = any(${p.groups}::text[])`] : []),
    ...(p.taxTreatments?.length ? [sql`k.tax_treatment::text = any(${p.taxTreatments}::text[])`] : []),
    ...(p.active === 'active' ? [sql`k.is_active`] : p.active === 'inactive' ? [sql`not k.is_active`] : []),
  ]);
  const order = p.sort === 'code' ? sql`k.code` : p.sort === 'name' ? sql`k.name` : p.sort === 'group' ? sql`k.claim_group, k.display_order` : sql`k.display_order, k.code`;
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<R>`select k.*, k.claim_group::text as claim_group, k.tax_treatment::text as tax_treatment, ${CURRENT_RATE} as rate, ${EVERYONE_LIMIT} as lim
      from app.claim_categories k where ${where} order by ${order} ${dirOf(p.dir)} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from app.claim_categories k where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return {
    rows: rows.rows.map((k) => ({ id: k.id, code: k.code, name: k.name, group: k.claim_group, receiptRequired: k.receipt_required, isMileage: k.is_mileage,
      mileageRate: k.rate === null ? null : Number(k.rate).toFixed(3), limitsSummary: limitJsonSummary(k.lim), taxTreatment: k.tax_treatment,
      glAccountCode: k.gl_account_code, displayOrder: k.display_order, isActive: k.is_active })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listCategories(params: CategoryListParams): Promise<Paged<CategoryRow>> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => categoryRows(tx, params, false));
}
export async function getCategory(code: string): Promise<CategoryDetail | null> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, async (tx) => {
    const k = (await sql<R>`select k.*, k.claim_group::text as claim_group, k.tax_treatment::text as tax_treatment, k.receipt_no_mode::text as rnm,
        k.myinvois_uuid_mode::text as umm, k.claimant_scope::text as cs, k.extra_fields::text[] as ef, k.eligible_statuses::text[] as es,
        ${CURRENT_RATE} as rate, exists (select 1 from app.claim_lines l where l.category_id = k.id) as in_use
        from app.claim_categories k where k.code = ${code.toUpperCase()}`.execute(tx)).rows[0];
    if (!k) return null;
    const grades = (await sql<{ g: string }>`select grade_id as g from app.claim_category_grades where category_id = ${k.id}::uuid`.execute(tx)).rows.map((r) => r.g);
    const rates = (await sql<R>`select * from app.claim_category_rates where category_id = ${k.id}::uuid order by effective_from desc`.execute(tx)).rows;
    const hist = (await sql<R>`select occurred_at, actor_user_id, changes from audit.audit_log where entity_type = 'claim_categories' and entity_id = ${k.id}::uuid
        order by occurred_at desc limit 200`.execute(tx)).rows;
    const names = await resolveNames(tx, [k.created_by, k.updated_by, ...rates.map((r) => r.created_by), ...hist.map((h) => h.actor_user_id)]);
    const history: CategoryDetail['history'] = [];
    for (const h of hist) for (const [field, pair] of Object.entries((h.changes ?? {}) as Record<string, unknown[]>)) {
      history.push({ at: iso(h.occurred_at)!, byName: names.get(h.actor_user_id) ?? 'System', field,
        before: Array.isArray(pair) && pair[0] != null ? String(typeof pair[0] === 'object' ? JSON.stringify(pair[0]) : pair[0]) : null,
        after: Array.isArray(pair) && pair[1] != null ? String(typeof pair[1] === 'object' ? JSON.stringify(pair[1]) : pair[1]) : null });
    }
    return {
      id: k.id, version: k.version,
      values: { code: k.code, name: k.name, group: k.claim_group, description: k.description, receiptRequired: k.receipt_required, notesRequired: k.notes_required,
        receiptNoMode: k.rnm, myinvoisUuidMode: k.umm, captureSst: k.capture_sst, isMileage: k.is_mileage, extraFields: k.ef, claimantScope: k.cs,
        minServiceMonths: k.min_service_months, eligibleStatuses: k.es, gradeIds: grades, taxTreatment: k.tax_treatment, eaFormLine: k.ea_form_line,
        glAccountCode: k.gl_account_code, displayOrder: k.display_order, isActive: k.is_active },
      rates: rates.map((r) => ({ id: r.id, effectiveFrom: r.effective_from, ratePerKm: Number(r.rate_per_km).toFixed(3), setByName: names.get(r.created_by) ?? null, createdAt: iso(r.created_at)! })),
      currentRate: k.rate === null ? null : Number(k.rate).toFixed(3),
      limits: (await limitRows(tx, { pageSize: 100 }, true, k.id)).rows,
      history, inUse: k.in_use,
      ...stamps(k, names),
    };
  });
}

export async function limitRows(tx: Tx, params: LimitListParams, all: boolean, categoryId?: string): Promise<Paged<LimitRow>> {
  const p = parseParams(limitListParamsSchema, params);
  const today = await todayMyt(tx);
  const q = likeTerm(p.q);
  const where = and([
    ...(categoryId ? [sql`l.category_id = ${categoryId}::uuid`] : []),
    ...(p.categoryIds?.length ? [sql`l.category_id = any(${p.categoryIds}::uuid[])`] : []),
    ...(p.appliesTo?.length ? [sql`l.applies_to::text = any(${p.appliesTo}::text[])`] : []),
    ...(p.behaviours?.length ? [sql`l.behaviour::text = any(${p.behaviours}::text[])`] : []),
    ...(p.effectiveOn ? [sql`l.effective_from <= ${p.effectiveOn}::date and (l.effective_to is null or l.effective_to >= ${p.effectiveOn}::date)`] : []),
    ...(q ? [sql`(k.name ilike ${q} or k.code ilike ${q} or g.name ilike ${q} or d.name ilike ${q} or eg.name ilike ${q} or e.full_name ilike ${q} or e.employee_no ilike ${q})`] : []),
  ]);
  const from = sql`app.claim_limits l join app.claim_categories k on k.id = l.category_id left join app.grades g on g.id = l.grade_id
      left join app.departments d on d.id = l.department_id left join app.employee_groups eg on eg.id = l.employee_group_id left join app.employees e on e.id = l.employee_id`;
  const order = p.sort === 'appliesTo' ? sql`l.applies_to, k.display_order` : p.sort === 'from' ? sql`l.effective_from` : sql`k.display_order, l.applies_to, l.effective_from`;
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<R>`select l.*, l.applies_to::text as at, l.behaviour::text as bh, k.code, k.name as category_name, k.claim_group::text as claim_group, k.is_mileage,
        g.name as grade_name, d.name as dept_name, eg.name as group_name, e.employee_no, e.full_name
      from ${from} where ${where} order by ${order} ${dirOf(p.dir)} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return {
    rows: rows.rows.map((l) => {
      const target: Ref | null = l.at === 'grade' ? { id: l.grade_id, label: l.grade_name } : l.at === 'department' ? { id: l.department_id, label: l.dept_name }
        : l.at === 'employee_group' ? { id: l.employee_group_id, label: l.group_name } : l.at === 'employee' ? { id: l.employee_id, label: `${l.employee_no} ${l.full_name}` } : null;
      const current = l.effective_from <= today && (l.effective_to === null || l.effective_to >= today);
      return { id: l.id, category: catRef(l), appliesTo: l.at, target, perTransaction: m2n(l.per_transaction), perMonth: m2n(l.per_month), perYear: m2n(l.per_year),
        behaviour: l.bh, effectiveFrom: l.effective_from, effectiveTo: l.effective_to, isCurrent: current, canEdit: l.effective_to === null || l.effective_to >= today,
        canEnd: l.effective_to === null };
    }),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listLimits(params: LimitListParams): Promise<Paged<LimitRow>> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => limitRows(tx, params, false));
}

export async function policyOf(tx: Tx): Promise<ClaimPolicy> {
  const p = (await sql<R>`select * from app.claim_policy where id = 1`.execute(tx)).rows[0] ?? {};
  const gl = (await sql<{ g: string | null }>`select gl_account_code as g from app.gl_mappings where purpose = 'claims_payable'`.execute(tx)).rows[0]?.g ?? null;
  const sa = (await sql<{ s: boolean | null }>`select sa_batch_approval_required as s from app.security_settings where id = 1`.execute(tx)).rows[0]?.s ?? false;
  const isSa = (await sql<{ s: boolean }>`select app.is_sa() as s`.execute(tx)).rows[0]?.s ?? false;
  const names = await resolveNames(tx, [p.updated_by]);
  return {
    submissionDeadlineDays: p.submission_deadline_days ?? 60, limitRefreshDay: p.limit_refresh_day ?? 31, disbursementCutoffDay: p.disbursement_cutoff_day ?? 31,
    notesRequiredDefault: !!p.notes_required_default, attachmentsRequiredDefault: p.attachments_required_default ?? true,
    newClaimReminderDays: p.new_claim_reminder_days ?? 90, includeSeparatedDefault: !!p.include_separated_default,
    autocountDocumentDateBasis: p.autocount_document_date_basis ?? 'approval', claimsPayableGl: gl, saBatchApprovalRequired: !!sa, canEditSaSetting: isSa,
    createdAt: null, createdByName: null, updatedAt: iso(p.updated_at), updatedByName: p.updated_by ? names.get(p.updated_by) ?? null : null,
  };
}
export async function getClaimPolicy(): Promise<ClaimPolicy> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, policyOf);
}
export async function setupOptions(tx: Tx): Promise<ClaimSetupOptions> {
  const ref = async (q: ReturnType<typeof sql>) => (await sql<{ id: string; label: string }>`${q}`.execute(tx)).rows;
  return {
    grades: await ref(sql`select id, code || ' – ' || name as label from app.grades where is_active order by rank, code`),
    departments: await ref(sql`select id, code || ' – ' || name as label from app.departments where is_active order by name`),
    employeeGroups: await ref(sql`select id, name as label from app.employee_groups where is_active order by name`),
    costCentres: await ref(sql`select id, code || ' – ' || name as label from app.cost_centres where is_active order by code`),
    glAccounts: (await sql<{ g: string }>`select distinct gl_account_code as g from app.claim_categories order by 1`.execute(tx)).rows.map((r) => r.g),
    claimsPayableGl: (await sql<{ g: string | null }>`select gl_account_code as g from app.gl_mappings where purpose = 'claims_payable'`.execute(tx)).rows[0]?.g ?? null,
  };
}
export async function getClaimSetupOptions(): Promise<ClaimSetupOptions> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, setupOptions);
}

// ===========================================================================
// Utilisation (F-CLM-20)
// ===========================================================================
export async function utilisationOf(tx: Tx, employeeId: string, categoryIds?: string[]): Promise<LimitUtilisation> {
  const today = await todayMyt(tx);
  const rows = await sql<R>`select u.*, k.code, k.name as category_name, k.claim_group::text as claim_group, k.is_mileage, u.category_id
      from app.claim_utilisation(${employeeId}::uuid, null) u join app.claim_categories k on k.id = u.category_id order by k.display_order, u.basis`.execute(tx);
  const filtered = rows.rows.filter((r) => !categoryIds || categoryIds.includes(r.category_id));
  const limited = new Set(rows.rows.map((r) => r.category_id));
  const unlimited = categoryIds ? [] : (await sql<{ name: string; id: string }>`select id, name from app.claim_categories where is_active order by display_order`.execute(tx))
    .rows.filter((k) => !limited.has(k.id)).map((k) => k.name);
  return {
    asOf: today,
    rows: filtered.map((r): LimitUtilisationRow => {
      const used = m2(r.used); const lim = m2(r.limit_amount);
      const remaining = (Math.round(Number(lim) * 100) - Math.round(Number(used) * 100)) / 100;
      return { category: catRef(r), basis: r.basis, periodLabel: r.basis === 'transaction' ? 'per transaction' : r.basis === 'month' ? monthLabel(r.period_to.slice(0, 7) + '-01') : r.period_to.slice(0, 4),
        periodFrom: r.period_from, periodTo: r.period_to, used, limit: lim, remaining: remaining < 0 ? '0.00' : remaining.toFixed(2), behaviour: r.behaviour };
    }),
    unlimitedCategories: unlimited,
  };
}
export async function getMyClaimLimits(): Promise<LimitUtilisation | null> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, async (tx) => {
    const me = await myEmployeeId(tx);
    return me ? utilisationOf(tx, me) : null;
  });
}

// ===========================================================================
// P13 claim form
// ===========================================================================
export async function claimFormFor(tx: Tx, claimNo: string | undefined, employeeId: string | undefined): Promise<ClaimForm | null> {
  const me = await myEmployeeId(tx);
  const isAdmin = await dbIsAdmin(tx);
  let detail: ClaimDetail | null = null;
  if (claimNo) {
    detail = await claimDetail(tx, claimNo);
    if (!detail || !detail.can.edit) return null;
  }
  const emp = detail?.employee.id ?? employeeId ?? me;
  if (!emp) return null;
  const onBehalf = emp !== me;
  if (onBehalf && !isAdmin) return null;
  const e = (await sql<R>`select e.id, e.employee_no, e.full_name, e.preferred_name, e.status::text as status, e.grade_id, e.join_date, d.name as dept,
      coalesce(h.cost_centre_id, d.cost_centre_id) as cc, p.continuous_service_date as csd,
      (select s.last_working_day from app.employee_separations s where s.employee_id = e.id and not s.is_withdrawn and not s.superseded_by_rehire) as lwd
      from app.employees e join app.departments d on d.id = e.department_id left join app.employee_hr_private h on h.employee_id = e.id
      left join app.employee_personal p on p.employee_id = e.id where e.id = ${emp}::uuid`.execute(tx)).rows[0];
  if (!e) return null;
  const today = await todayMyt(tx);
  const pol = await policyOf(tx);
  const lineCats = new Set((detail?.lines ?? []).map((l) => l.category.id));
  const cats = (await sql<R>`select k.*, k.claim_group::text as claim_group, k.receipt_no_mode::text as rnm, k.myinvois_uuid_mode::text as umm,
        k.claimant_scope::text as cs, k.extra_fields::text[] as ef, k.eligible_statuses::text[] as es, ${CURRENT_RATE} as rate,
        app.claim_limit_view(${emp}::uuid, k.id, app.today_myt()) as lim,
        (not exists (select 1 from app.claim_category_grades g where g.category_id = k.id)
          or exists (select 1 from app.claim_category_grades g where g.category_id = k.id and g.grade_id = ${e.grade_id}::uuid)) as grade_ok
      from app.claim_categories k where k.is_active or k.id = any(${[...lineCats]}::uuid[]) order by k.display_order, k.code`.execute(tx)).rows;
  const serviceMonths = (() => {
    const from = new Date(`${e.csd ?? e.join_date}T00:00:00Z`); const to = new Date(`${today}T00:00:00Z`);
    let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
    if (to.getUTCDate() < from.getUTCDate()) m -= 1;
    return m;
  })();
  const categories: ClaimFormCategory[] = cats
    .filter((k) => lineCats.has(k.id) || (k.grade_ok && serviceMonths >= k.min_service_months && (e.status === 'separated' || (k.es as string[]).includes(e.status))))
    .map((k) => ({ id: k.id, code: k.code, name: k.name, group: k.claim_group, isMileage: k.is_mileage, description: k.description,
      receiptRequired: k.receipt_required, notesRequired: k.notes_required, receiptNoMode: k.rnm, myinvoisUuidMode: k.umm, captureSst: k.capture_sst,
      extraFields: k.ef, claimantScope: k.cs, currentRate: k.rate === null ? null : Number(k.rate).toFixed(3),
      limitSummary: k.lim ? limitSummary({ perTransaction: k.lim.perTransaction, perMonth: k.lim.perMonth, perYear: k.lim.perYear }) : 'No limit', hasLimit: !!k.lim,
      receiptHint: k.is_mileage && k.receipt_required ? MILEAGE_RECEIPT_HINT : null }));
  const deps: ClaimForm['dependants'] = [];
  if (categories.some((c) => c.claimantScope === 'employee_and_dependants')) {
    for (const s of (await sql<{ n: string }>`select full_name as n from app.employee_spouses where employee_id = ${emp}::uuid and record_status::text = 'current' order by full_name`.execute(tx)).rows) deps.push({ kind: 'spouse', name: s.n });
    for (const c of (await sql<{ n: string }>`select full_name as n from app.employee_children where employee_id = ${emp}::uuid order by date_of_birth`.execute(tx)).rows) deps.push({ kind: 'child', name: c.n });
  }
  const costCentres = (await sql<{ id: string; label: string }>`select id, code || ' – ' || name as label from app.cost_centres where is_active order by code`.execute(tx)).rows;
  const hint = (await sql<{ h: string | null }>`select app.claim_approver_hint(${emp}::uuid) as h`.execute(tx)).rows[0]?.h ?? null;
  const earliest = new Date(`${today}T00:00:00Z`); earliest.setUTCDate(earliest.getUTCDate() - pol.submissionDeadlineDays);
  return {
    employee: { ...personRef(e.id, e.employee_no, e.full_name, e.preferred_name), department: e.dept, status: e.status },
    isOnBehalf: onBehalf, categories, costCentres, defaultCostCentreId: e.cc ?? null, deadlineDays: pol.submissionDeadlineDays,
    earliestTransactionDate: earliest.toISOString().slice(0, 10), today, latestTransactionDate: e.lwd && e.lwd < today ? e.lwd : today,
    dependants: deps, approverHint: hint, claim: detail,
  };
}
export async function getClaimForm(claimNo?: string, employeeId?: string): Promise<ClaimForm | null> {
  const { ctx } = await authorize(ANY);
  if (claimNo && !CLAIM_NO_RE.test(claimNo)) return null;
  return withUserTx(ctx, (tx) => claimFormFor(tx, claimNo, employeeId));
}

// ===========================================================================
// P15 / P29 detail
// ===========================================================================
export async function claimTrail(tx: Tx, claimId: string): Promise<ApprovalTrailRow[]> {
  const r = await sql<R>`select t.*, t.subject_type::text as st, t.source::text as src, t.status::text as stt, t.acting_as::text as act,
      app.user_name(t.assignee_user_id) as assignee_name from app.approval_tasks t where t.claim_id = ${claimId}::uuid order by t.created_at`.execute(tx);
  return r.rows.map((x) => ({
    taskId: x.id, subjectType: x.st as TaskSubject, level: x.level, source: x.src as ApproverSource, sourceLabel: APPROVER_SOURCE_LABELS[x.src as ApproverSource],
    approverName: x.assignee_user_id ? `${x.assignee_name ?? ''} or any Admin` : APPROVER_SOURCE_SHORT[x.src as ApproverSource] === 'Manager / Admin' ? 'Any Admin or Super Admin' : APPROVER_SOURCE_SHORT[x.src as ApproverSource],
    routingNote: x.routing_note, status: x.stt, decidedByName: x.decided_by_name, actingAs: x.act, comment: x.decision_comment,
    decidedAt: iso(x.decided_at), createdAt: iso(x.created_at)!,
  }));
}
export async function claimDetail(tx: Tx, claimNo: string): Promise<ClaimDetail | null> {
  const c = (await sql<R>`select c.*, c.status::text as status, c.disbursed_via::text as via, e.employee_no, e.full_name, e.preferred_name,
      d.name as dept, p.title as position, cf.claim_no as copied_no
      from app.claims c join app.employees e on e.id = c.employee_id join app.departments d on d.id = e.department_id join app.positions p on p.id = e.position_id
      left join app.claims cf on cf.id = c.copied_from_claim_id where c.claim_no = ${claimNo}`.execute(tx)).rows[0];
  if (!c) return null;
  const me = await myEmployeeId(tx);
  const meUser = (await sql<{ u: string | null }>`select app.current_app_user_id() as u`.execute(tx)).rows[0]?.u ?? null;
  const isAdmin = await dbIsAdmin(tx);
  const isOwn = me === c.employee_id;
  const full = isOwn || isAdmin;                                   // T2 / batch fields (rls §8)
  const today = await todayMyt(tx);
  const lines = (await sql<R>`select l.*, k.code, k.name as category_name, k.claim_group::text as claim_group, k.is_mileage, l.claimant::text as claimant_t,
        l.tax_treatment_snapshot::text as tts, cc.code as cc_code, cc.name as cc_name, dp.dependant_name
      from app.claim_lines l join app.claim_categories k on k.id = l.category_id left join app.cost_centres cc on cc.id = l.cost_centre_id
      left join app.claim_line_dependants dp on dp.claim_line_id = l.id where l.claim_id = ${c.id}::uuid order by l.line_no`.execute(tx)).rows;
  const files = (await sql<R>`select lf.claim_line_id, f.id, f.original_name, f.mime_type, f.size_bytes, app.can_read_file(f.id) as readable
      from app.claim_line_files lf join app.claim_lines l on l.id = lf.claim_line_id join app.files f on f.id = lf.file_id
      where l.claim_id = ${c.id}::uuid order by lf.added_at`.execute(tx)).rows;
  const lineViews: ClaimLineView[] = lines.map((l) => ({
    id: l.id, lineNo: l.line_no, category: catRef(l), transactionDate: l.transaction_date, description: l.description, merchant: l.merchant,
    receiptNo: l.receipt_no, myinvoisUuid: l.myinvois_uuid, amountInclSst: m2(l.amount_incl_sst), sstAmount: m2(l.sst_amount), amountExclSst: m2(l.amount_excl_sst),
    fromPlace: l.from_place, toPlace: l.to_place, purpose: l.purpose, distanceKm: l.distance_km === null ? null : Number(l.distance_km).toFixed(1),
    ratePerKm: l.rate_per_km === null ? null : Number(l.rate_per_km).toFixed(3), clientAttendees: l.client_attendees, travelDestination: l.travel_destination,
    claimantLabel: l.claimant_t === 'self' ? 'Self' : full ? (l.claimant_t === 'spouse' ? 'Spouse' : 'Child') : 'Medical',
    claimant: full ? l.claimant_t : null, dependantName: full ? l.dependant_name ?? null : null,
    costCentre: full && l.cost_centre_id ? { id: l.cost_centre_id, label: `${l.cc_code} – ${l.cc_name}` } : null,
    files: files.filter((f) => f.claim_line_id === l.id && f.readable).map((f) => ({ fileId: f.id, fileName: f.original_name, mimeType: f.mime_type, sizeBytes: f.size_bytes })),
    limitCheck: (l.limit_check as LimitCheck | null) ?? null, duplicateWarnings: (l.duplicate_of ?? []).map((n: string) => `Same receipt / merchant and amount on ${n}`),
    lateOverride: l.late_override,
    taxTreatment: isAdmin ? l.tts : null, eaFormLine: isAdmin ? l.ea_form_line_snapshot : null, glAccount: isAdmin ? l.gl_account_snapshot : null,
  }));
  const trail = await claimTrail(tx, c.id);
  const open = trail.find((t) => t.status === 'open');
  const task = await actionability(tx, open?.taskId ?? null, c.employee_id);
  const preparedByMe = !!c.on_behalf_by && c.on_behalf_by === meUser;
  if (task && preparedByMe) { task.canDecide = false; task.blockedReason = 'You entered this claim on behalf — another approver must decide.'; }
  if (task && isOwn) task.blockedReason = "You can't decide your own claim.";
  const decided = trail.filter((t) => t.status === 'approved' || t.status === 'rejected').pop();
  const events = (await sql<R>`select ev.*, ev.from_status::text as fs, ev.to_status::text as ts, b.batch_no from app.claim_events ev
      left join app.disbursement_batches b on b.id = ev.batch_id where ev.claim_id = ${c.id}::uuid order by ev.occurred_at, ev.id`.execute(tx)).rows;
  let disbursement: ClaimDetail['disbursement'] = null;
  if (full) {
    const b = (await sql<R>`select * from app.claim_batch_info(${c.id}::uuid)`.execute(tx)).rows[0];
    const undo = [...events].reverse().find((x) => x.event === 'Disbursement undone');
    disbursement = { via: c.via, batchId: b?.batch_id ?? null, batchNo: b?.batch_no ?? null, batchStatus: b?.status ?? null, plannedPaymentDate: b?.planned_payment_date ?? null,
      disbursedOn: c.disbursed_on, paymentReference: c.payment_reference, undoneReason: c.status === 'approved' && undo ? undo.comment : null };
  }
  const util = (await sql<{ ok: boolean }>`select app.can_see_team_row(${c.employee_id}::uuid) as ok`.execute(tx)).rows[0]?.ok
    ? (await utilisationOf(tx, c.employee_id, [...new Set(lineViews.map((l) => l.category.id))])).rows : [];
  const names = await resolveNames(tx, [c.created_by, c.updated_by, c.on_behalf_by, c.cancelled_by]);
  const pol = (await sql<{ d: number }>`select new_claim_reminder_days as d from app.claim_policy where id = 1`.execute(tx)).rows[0]?.d ?? 90;
  const canCancel = (await sql<{ ok: boolean }>`select app.can_cancel_claim(${c.id}::uuid) as ok`.execute(tx)).rows[0]?.ok ?? false;
  const ownerOrPreparer = isOwn || (isAdmin && preparedByMe) || (isAdmin && !!c.on_behalf_by && !isOwn);
  return {
    id: c.id, claimNo: c.claim_no, version: c.version,
    employee: { ...personRef(c.employee_id, c.employee_no, c.full_name, c.preferred_name), department: c.dept, position: c.position },
    title: c.title, projectRef: c.project_ref, totals: { total: m2(c.total_amount), sst: m2(c.total_sst), exclSst: m2(c.total_excl_sst) },
    status: c.status, flags: flagsOf(c), onBehalfByName: c.on_behalf_by ? names.get(c.on_behalf_by) ?? 'Admin' : null, onBehalfNote: full ? c.on_behalf_note : null,
    copiedFrom: c.copied_from_claim_id ? { id: c.copied_from_claim_id, claimNo: c.copied_no } : null, submittedAt: iso(c.submitted_at),
    decision: c.decided_at ? { byName: c.decided_by_name ?? '', at: iso(c.decided_at)!, actingAs: decided?.actingAs ?? null, reason: c.reject_reason,
      outcome: c.reject_reason ? 'rejected' : 'approved' } : null,
    cancellation: c.cancelled_at ? { byName: c.cancelled_by ? names.get(c.cancelled_by) ?? '' : '', at: iso(c.cancelled_at)!, reason: c.cancel_reason } : null,
    disbursement, lines: lineViews, trail, task,
    waitingFor: open ? `Waiting for ${open.approverName}` : null,
    waitingWorkingDays: open ? weekdaysBetween(mytDate(open.createdAt), today) : null,
    alreadyDecided: !open && decided?.decidedByName ? { byName: decided.decidedByName, at: decided.decidedAt ?? '' } : null,
    utilisation: util,
    events: events.map((x) => ({ at: iso(x.occurred_at)!, event: x.event, fromStatus: x.fs, toStatus: x.ts, actorName: x.actor_name, comment: x.comment,
      batchNo: full ? x.batch_no ?? null : null })),
    isOwn,
    staleNew: c.status === 'new' && weekdaysBetween(mytDate(c.created_at), today) >= 0 && (Date.parse(today) - Date.parse(mytDate(c.created_at))) / 86_400_000 > pol,
    can: {
      edit: c.status === 'new' && ownerOrPreparer, submit: c.status === 'new' && ownerOrPreparer, delete: c.status === 'new' && ownerOrPreparer,
      withdraw: c.status === 'submitted' && ownerOrPreparer, copy: c.status === 'rejected' && isOwn,
      cancel: canCancel, undoDisbursement: c.status === 'disbursed' && isAdmin && !isOwn,
      applyLateOverride: c.status === 'new' && isAdmin && !isOwn, downloadReceipts: lineViews.some((l) => l.files.length > 0),
    },
    blockedReason: isOwn && c.status === 'submitted' ? "You can't decide your own claim." : preparedByMe && c.status === 'submitted' ? 'You entered this claim on behalf — another approver must decide.' : null,
    ...stamps(c, names),
  };
}
export async function getClaim(claimNo: string): Promise<ClaimDetail | null> {
  const { ctx } = await authorize(ANY);
  if (!CLAIM_NO_RE.test(claimNo)) return null;
  return withUserTx(ctx, (tx) => claimDetail(tx, claimNo));
}

// ===========================================================================
// P12 My claims
// ===========================================================================
export async function myClaimRows(tx: Tx, params: MyClaimsParams, all: boolean): Promise<MyClaimsPage> {
  const p = parseParams(myClaimsParamsSchema, params);
  const me = await myEmployeeId(tx);
  if (!me) return { rows: [], total: 0, page: 1, pageSize: p.pageSize, staleNewCount: 0, staleDays: 90, hasEmployeeRecord: false };
  const q = likeTerm(p.q);
  const where = and([
    sql`c.employee_id = ${me}::uuid`,
    ...(q ? [sql`(c.claim_no ilike ${q} or c.title ilike ${q})`] : []),
    ...(p.statuses?.length ? [sql`c.status::text = any(${p.statuses}::text[])`] : []),
    ...(p.categoryIds?.length ? [sql`exists (select 1 from app.claim_lines l where l.claim_id = c.id and l.category_id = any(${p.categoryIds}::uuid[]))`] : []),
    ...(p.year ? [sql`extract(year from c.created_at at time zone 'Asia/Kuala_Lumpur') = ${p.year}`] : []),
    ...(p.from ? [sql`exists (select 1 from app.claim_lines l where l.claim_id = c.id and l.transaction_date >= ${p.from}::date)`] : []),
    ...(p.to ? [sql`exists (select 1 from app.claim_lines l where l.claim_id = c.id and l.transaction_date <= ${p.to}::date)`] : []),
  ]);
  const order = p.sort === 'submitted' ? sql`c.submitted_at` : p.sort === 'claimNo' ? sql`c.claim_no` : p.sort === 'total' ? sql`c.total_amount`
    : p.sort === 'status' ? sql`c.status` : sql`c.created_at`;
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<R>`select c.*, c.status::text as status, (select count(*)::int from app.claim_lines l where l.claim_id = c.id) as lines
      from app.claims c where ${where} order by ${order} ${dirOf(p.dir)} nulls last, c.claim_no desc limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from app.claims c where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const pol = (await sql<{ d: number }>`select new_claim_reminder_days as d from app.claim_policy where id = 1`.execute(tx)).rows[0]?.d ?? 90;
  const stale = (await sql<{ n: number }>`select count(*)::int as n from app.claims where employee_id = ${me}::uuid and status = 'new'
      and created_at < now() - make_interval(days => ${pol})`.execute(tx)).rows[0]?.n ?? 0;
  return {
    rows: rows.rows.map((c): MyClaimRow => ({ id: c.id, claimNo: c.claim_no, title: c.title, lineCount: c.lines, total: m2(c.total_amount), totalSst: m2(c.total_sst),
      status: c.status, flags: flagsOf(c), submittedAt: iso(c.submitted_at), disbursedOn: c.disbursed_on, paymentReference: c.payment_reference, createdAt: iso(c.created_at)!,
      can: { edit: c.status === 'new', submit: c.status === 'new', delete: c.status === 'new', withdraw: c.status === 'submitted', copy: c.status === 'rejected' } })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize, staleNewCount: stale, staleDays: pol, hasEmployeeRecord: true,
  };
}
export async function listMyClaims(params: MyClaimsParams): Promise<MyClaimsPage> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, (tx) => myClaimRows(tx, params, false));
}

// ===========================================================================
// C1 claims list (admin / team)
// ===========================================================================
export async function claimListPage(tx: Tx, params: ClaimListParams, all: boolean, scope: 'all' | 'team'): Promise<ClaimListPage> {
  const p = parseParams(claimListParamsSchema, params);
  const isAdmin = await dbIsAdmin(tx);
  const full = isAdmin && scope === 'all';
  const includeSep = p.includeSeparated ?? (await policyOf(tx)).includeSeparatedDefault;
  const q = likeTerm(p.q);
  const statuses = p.statuses?.length ? p.statuses : DEFAULT_ADMIN_CLAIM_STATUSES;
  const lineCond = (inner: Where) => sql`exists (select 1 from app.claim_lines l2 where l2.claim_id = c.id and ${inner})`;
  const where = and([
    sql`not (c.status = 'new' and c.on_behalf_by is null)`,                         // BR-CLM-27: New only when entered on behalf
    sql`c.status::text = any(${statuses}::text[])`,
    ...(scope === 'team' ? [sql`c.employee_id is distinct from app.current_employee_id()`] : []),
    ...(q ? [sql`(c.claim_no ilike ${q} or e.full_name ilike ${q} or e.employee_no ilike ${q} or ${lineCond(sql`(l2.receipt_no ilike ${q} or l2.myinvois_uuid ilike ${q})`)})`] : []),
    ...(p.employeeId ? [sql`c.employee_id = ${p.employeeId}::uuid`] : []),
    ...(p.departmentIds?.length ? [sql`e.department_id = any(${p.departmentIds}::uuid[])`] : []),
    ...(p.categoryIds?.length ? [lineCond(sql`l2.category_id = any(${p.categoryIds}::uuid[])`)] : []),
    ...(p.from ? [lineCond(sql`l2.transaction_date >= ${p.from}::date`)] : []),
    ...(p.to ? [lineCond(sql`l2.transaction_date <= ${p.to}::date`)] : []),
    ...(p.submittedFrom ? [sql`(c.submitted_at at time zone 'Asia/Kuala_Lumpur')::date >= ${p.submittedFrom}::date`] : []),
    ...(p.submittedTo ? [sql`(c.submitted_at at time zone 'Asia/Kuala_Lumpur')::date <= ${p.submittedTo}::date`] : []),
    ...(p.decidedFrom ? [sql`(c.decided_at at time zone 'Asia/Kuala_Lumpur')::date >= ${p.decidedFrom}::date`] : []),
    ...(p.decidedTo ? [sql`(c.decided_at at time zone 'Asia/Kuala_Lumpur')::date <= ${p.decidedTo}::date`] : []),
    ...(full && p.disbursedFrom ? [sql`c.disbursed_on >= ${p.disbursedFrom}::date`] : []),
    ...(full && p.disbursedTo ? [sql`c.disbursed_on <= ${p.disbursedTo}::date`] : []),
    ...(full && p.batchNo ? [sql`b.batch_no ilike ${likeTerm(p.batchNo)}`] : []),
    ...(p.flags?.includes('over_limit') ? [sql`c.flag_over_limit`] : []),
    ...(p.flags?.includes('late_override') ? [sql`c.flag_late_override`] : []),
    ...(p.flags?.includes('possible_duplicate') ? [sql`c.flag_possible_duplicate`] : []),
    ...(p.flags?.includes('on_behalf') || p.onBehalfOnly ? [sql`c.on_behalf_by is not null`] : []),
    ...(includeSep || p.employeeId ? [] : [sql`e.status not in ('separated','withdrawn')`]),   // one employee (E3 Claims tab export): always included
  ]);
  const from = sql`app.claims c join app.employees e on e.id = c.employee_id join app.departments d on d.id = e.department_id
      left join app.disbursement_batches b on b.id = c.disbursement_batch_id`;
  const k = (await sql<R>`select count(*) filter (where c.status = 'submitted')::int as s, count(*) filter (where c.status = 'approved')::int as a,
      count(*) filter (where c.status = 'disbursed')::int as dd, count(*) filter (where c.status = 'rejected')::int as r,
      coalesce(sum(c.total_excl_sst), 0) as ex, coalesce(sum(c.total_sst), 0) as sst, coalesce(sum(c.total_amount), 0) as tot from ${from} where ${where}`.execute(tx)).rows[0]!;
  const kpis: ClaimKpis = { submitted: k.s, approvedNotDisbursed: k.a, disbursed: k.dd, rejected: k.r, totalExclSst: m2(k.ex), totalSst: m2(k.sst), total: m2(k.tot) };
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const base = { page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
  if (p.view === 'line') {
    const lsort: Record<string, string> = { submitted: 'c.submitted_at', claimNo: 'c.claim_no, l.line_no', employee: 'e.full_name', total: 'l.amount_incl_sst', status: 'c.status', transaction: 'l.transaction_date' };
    const rows = await sql<R>`select l.*, c.claim_no, c.status::text as status, c.submitted_at, c.decided_at, c.decided_by_name, c.employee_id as emp_id, c.disbursed_on,
          b.batch_no, e.employee_no, e.full_name, e.preferred_name, d.name as dept, k.code, k.name as category_name, k.claim_group::text as claim_group, k.is_mileage,
          (select count(*)::int from app.claim_line_files f where f.claim_line_id = l.id) as files
        from ${from} join app.claim_lines l on l.claim_id = c.id join app.claim_categories k on k.id = l.category_id
       where ${where} order by ${sql.raw(lsort[p.sort] ?? 'c.submitted_at')} ${dirOf(p.dir)} nulls last limit ${limit} offset ${offset}`.execute(tx);
    const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} join app.claim_lines l on l.claim_id = c.id where ${where}`.execute(tx)).rows[0]?.n ?? 0;
    return { view: 'line', kpis, total, ...base, rows: rows.rows.map((l): ClaimLineListRow => ({
      claimId: l.claim_id, claimNo: l.claim_no, lineId: l.id, lineNo: l.line_no, employee: personRef(l.emp_id, l.employee_no, l.full_name, l.preferred_name), department: l.dept,
      transactionDate: l.transaction_date, submittedAt: iso(l.submitted_at), category: catRef(l),
      moreInfo: [l.claim_no, l.distance_km !== null ? `${Number(l.distance_km).toFixed(1)} km` : null, l.description].filter(Boolean).join(' · '),
      distanceKm: l.distance_km === null ? null : Number(l.distance_km).toFixed(1), description: l.description, amountInclSst: m2(l.amount_incl_sst), sstAmount: m2(l.sst_amount),
      attachmentCount: l.files, receiptNo: l.receipt_no, myinvoisUuid: l.myinvois_uuid, decidedAt: iso(l.decided_at), decidedByName: l.decided_by_name, status: l.status,
      batchNo: full ? l.batch_no : null, disbursedOn: full ? l.disbursed_on : null })) };
  }
  const hsort: Record<string, string> = { submitted: 'c.submitted_at', claimNo: 'c.claim_no', employee: 'e.full_name', total: 'c.total_amount', status: 'c.status', transaction: 'c.submitted_at' };
  const rows = await sql<R>`select c.*, c.status::text as status, e.employee_no, e.full_name, e.preferred_name, d.name as dept, b.batch_no,
        (select count(*)::int from app.claim_lines l where l.claim_id = c.id) as lines,
        (select count(*)::int from app.claim_line_files f join app.claim_lines l on l.id = f.claim_line_id where l.claim_id = c.id) as files,
        t.id as task_id, t.version as task_version, coalesce(app.can_act_on_task(t.id), false) as can
      from ${from} left join app.approval_tasks t on t.claim_id = c.id and t.status = 'open'
     where ${where} order by ${sql.raw(hsort[p.sort] ?? 'c.submitted_at')} ${dirOf(p.dir)} nulls last limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return { view: 'header', kpis, total, ...base, rows: rows.rows.map((c): ClaimListRow => ({
    id: c.id, claimNo: c.claim_no, employee: personRef(c.employee_id, c.employee_no, c.full_name, c.preferred_name), department: c.dept, title: c.title,
    lineCount: c.lines, total: m2(c.total_amount), totalSst: m2(c.total_sst), status: c.status, flags: flagsOf(c), submittedAt: iso(c.submitted_at),
    decidedByName: c.decided_by_name, decidedAt: iso(c.decided_at), batchNo: full ? c.batch_no : null, disbursedOn: full ? c.disbursed_on : null,
    paymentReference: full ? c.payment_reference : null, attachmentCount: c.files, taskId: c.task_id, taskVersion: c.task_version,
    canDecide: !!c.can && c.status === 'submitted' })) };
}
export async function listClaims(params: ClaimListParams): Promise<ClaimListPage> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => claimListPage(tx, params, false, 'all'));
}
export async function listTeamClaims(params: ClaimListParams): Promise<ClaimListPage> {
  const { ctx } = await authorize(['MGR']);
  return withUserTx(ctx, (tx) => claimListPage(tx, params, false, 'team'));
}

// ===========================================================================
// C4 late overrides
// ===========================================================================
export async function lateOverrideRows(tx: Tx, params: LateOverrideListParams, all: boolean): Promise<Paged<LateOverrideRow>> {
  const p = parseParams(lateOverrideListParamsSchema, params);
  const pol = await policyOf(tx);
  const q = likeTerm(p.q);
  const where = and([
    ...(p.employeeId ? [sql`o.employee_id = ${p.employeeId}::uuid`] : []),
    ...(p.from ? [sql`(o.granted_at at time zone 'Asia/Kuala_Lumpur')::date >= ${p.from}::date`] : []),
    ...(p.to ? [sql`(o.granted_at at time zone 'Asia/Kuala_Lumpur')::date <= ${p.to}::date`] : []),
    ...(q ? [sql`(c.claim_no ilike ${q} or e.full_name ilike ${q} or e.employee_no ilike ${q} or o.reason ilike ${q})`] : []),
  ]);
  const from = sql`app.claim_late_overrides o join app.claims c on c.id = o.claim_id join app.employees e on e.id = o.employee_id
      left join app.claim_lines l on l.id = o.claim_line_id`;
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<R>`select o.*, c.claim_no, c.status::text as cs, e.employee_no, e.full_name, e.preferred_name, l.line_no, l.transaction_date,
        app.user_name(o.granted_by) as by_name, (l.transaction_date - (o.granted_at at time zone 'Asia/Kuala_Lumpur')::date)::int as age
      from ${from} where ${where} order by ${p.sort === 'employee' ? sql`e.full_name` : sql`o.granted_at`} ${dirOf(p.dir)} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return {
    rows: rows.rows.map((o) => ({ id: o.id, employee: personRef(o.employee_id, o.employee_no, o.full_name, o.preferred_name), claimId: o.claim_id, claimNo: o.claim_no,
      lineNo: o.line_no, transactionDate: o.transaction_date, daysPastDeadline: o.age === null ? null : Math.max(0, -o.age - pol.submissionDeadlineDays),
      reason: o.reason, appliedByName: o.by_name ?? '', appliedAt: iso(o.granted_at)!, used: o.used_at !== null || o.cs !== 'new' })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listLateOverrides(params: LateOverrideListParams): Promise<Paged<LateOverrideRow>> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => lateOverrideRows(tx, params, false));
}

// ===========================================================================
// C9 / C10 / C11 / C12 batches
// ===========================================================================
export async function batchRows(tx: Tx, params: BatchListParams, all: boolean): Promise<BatchListPage> {
  const p = parseParams(batchListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    ...(q ? [sql`(b.batch_no ilike ${q} or b.payment_reference ilike ${q})`] : []),
    ...(p.year ? [sql`extract(year from b.disbursement_month) = ${p.year}`] : []),
    ...(p.month ? [sql`extract(month from b.disbursement_month) = ${p.month}`] : []),
    ...(p.statuses?.length ? [sql`b.status::text = any(${p.statuses}::text[])`] : []),
  ]);
  const order = p.sort === 'batchNo' ? sql`b.batch_no` : p.sort === 'status' ? sql`b.status` : p.sort === 'total' ? sql`b.total_amount` : sql`b.disbursement_month, b.batch_no`;
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<R>`select b.*, b.status::text as status, app.user_name(b.prepared_by) as prep, app.user_name(b.approved_by) as appr
      from app.disbursement_batches b where ${where} order by ${order} ${dirOf(p.dir)} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from app.disbursement_batches b where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const ub = (await sql<R>`select count(*)::int as n, coalesce(sum(total_amount), 0) as t from app.claims where status = 'approved' and disbursement_batch_id is null`.execute(tx)).rows[0]!;
  const sa = (await sql<{ s: boolean }>`select coalesce(sa_batch_approval_required, false) as s from app.security_settings where id = 1`.execute(tx)).rows[0]?.s ?? false;
  return {
    rows: rows.rows.map((b): BatchRow => ({ id: b.id, batchNo: b.batch_no, disbursementMonth: b.disbursement_month, cutoffDate: b.approval_cutoff_date, claimCount: b.claim_count,
      total: m2(b.total_amount), totalSst: m2(b.total_sst), status: b.status, paymentDate: b.payment_date, paymentReference: b.payment_reference, preparedByName: b.prep ?? '',
      approvedByName: b.appr, outputs: b.outputs_version === 0 ? null : b.outputs_out_of_date ? 'out_of_date' : 'current' })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
    unbatched: ub.n > 0 ? { count: ub.n, total: m2(ub.t) } : null, saApprovalOn: sa,
  };
}
export async function listBatches(params: BatchListParams): Promise<BatchListPage> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => batchRows(tx, params, false));
}
export async function batchDefaults(tx: Tx, month?: string): Promise<BatchDefaults> {
  const today = await todayMyt(tx);
  const pol = await policyOf(tx);
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7);
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cutoff = `${m}-${String(Math.min(pol.disbursementCutoffDay, last)).padStart(2, '0')}`;
  const regular = (await sql<{ n: number }>`select count(*)::int as n from app.disbursement_batches where disbursement_month = ${`${m}-01`}::date and is_regular and status <> 'cancelled'`.execute(tx)).rows[0]?.n ?? 0;
  return { disbursementMonth: m, cutoffDate: cutoff, plannedPaymentDate: cutoff < today ? today : cutoff, regularExists: regular > 0 };
}
export async function getBatchDefaults(month?: string): Promise<BatchDefaults> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => batchDefaults(tx, month));
}
export async function payeesOf(tx: Tx, batchId: string): Promise<(PayeeInput & { enc: Buffer | null; bankAccountId: string | null; changed: boolean; separated: boolean })[]> {
  const r = await sql<R>`select * from app.batch_payees(${batchId}::uuid)`.execute(tx);
  return r.rows.map((p) => ({ employeeId: p.employee_id, employeeNo: p.employee_no, fullName: p.full_name, workEmail: p.work_email, claimNos: p.claim_nos ?? [],
    amount: m2(p.amount), paymentMethod: p.payment_method, bankName: p.bank_name, bankCode: p.bank_code, bic: p.bic, accountNo: null, accountLast4: p.account_no_last4,
    accountHolderName: p.account_holder_name, bankComplete: !!p.bank_complete, enc: p.account_no_enc ?? null, bankAccountId: p.bank_account_id,
    changed: !!p.bank_changed_after_export, separated: !!p.is_separated }));
}
export function payeeRow(p: Awaited<ReturnType<typeof payeesOf>>[number]): BatchPayeeRow {
  return { employee: personRef(p.employeeId, p.employeeNo, p.fullName, null), claimCount: p.claimNos.length, claimNos: p.claimNos, amount: p.amount,
    paymentMethod: p.paymentMethod, bankName: p.bankName, accountMasked: maskAccount(p.accountLast4), bankComplete: p.bankComplete, bankChangedAfterExport: p.changed };
}
export async function outputsOf(tx: Tx, batchId: string, current: number, outOfDate: boolean): Promise<BatchOutputVersion[]> {
  const r = await sql<R>`select x.*, x.kind::text as k, f.original_name, app.user_name(x.generated_by) as by_name from app.export_files x join app.files f on f.id = x.file_id
      where x.subject_type = 'disbursement_batch' and x.subject_id = ${batchId}::uuid order by x.version desc, x.kind`.execute(tx);
  const byVersion = new Map<number, BatchOutputVersion>();
  for (const x of r.rows) {
    const v: BatchOutputVersion = byVersion.get(x.version) ?? { version: x.version, generatedAt: iso(x.generated_at)!, generatedByName: x.by_name,
      status: x.version === current ? (outOfDate ? 'out_of_date' : 'current') : 'superseded', files: [] };
    v.files.push({ exportFileId: x.id, kind: x.k, fileName: x.original_name, rowCount: x.row_count, total: m2n(x.total_amount) });
    byVersion.set(x.version, v);
  }
  return [...byVersion.values()];
}
/**
 * The ONLY decryption path for bank account numbers (brief rule 4, D31): app.payment_list_view(batch, purpose) checks ADM/SA and
 * writes audit.access_log ('reveal' for the C12 screen, 'export' for .xlsx / PDF generation) in the same transaction, then the
 * ciphertext is decrypted here. Returns the employees whose account could not be read.
 */
export async function decryptPayees(tx: Tx, batchId: string, payees: Awaited<ReturnType<typeof payeesOf>>, purpose: 'view' | 'export'): Promise<string[]> {
  const enc = await sql<R>`select * from app.payment_list_view(${batchId}::uuid, ${purpose})`.execute(tx);
  const failed: string[] = [];
  for (const p of payees) {
    const row = enc.rows.find((x) => x.employee_id === p.employeeId);
    if (!row || p.paymentMethod !== 'bank_transfer') continue;
    try { p.accountNo = fieldCrypto.decrypt(row.account_no_enc, { table: 'employee_bank_accounts', column: 'account_no_enc', rowId: row.bank_account_id }); }
    catch { failed.push(p.employeeNo); }
  }
  return failed;
}
export async function batchDetail(tx: Tx, batchNo: string): Promise<BatchDetail | null> {
  const b = (await sql<R>`select b.*, b.status::text as status from app.disbursement_batches b where b.batch_no = ${batchNo}`.execute(tx)).rows[0];
  if (!b) return null;
  const claims = await sql<R>`select m.*, c.claim_no, c.title, c.status::text as cs, (c.decided_at at time zone 'Asia/Kuala_Lumpur')::date as approved_on,
        e.employee_no, e.full_name, e.preferred_name
      from app.disbursement_batch_claims m join app.claims c on c.id = m.claim_id join app.employees e on e.id = m.employee_id
     where m.batch_id = ${b.id}::uuid and m.removed_at is null order by e.full_name, c.claim_no`.execute(tx);
  const payees = await payeesOf(tx, b.id);
  const history = await sql<R>`select ev.*, ev.from_status::text as fs, ev.to_status::text as ts from app.disbursement_batch_events ev where ev.batch_id = ${b.id}::uuid order by ev.occurred_at, ev.id`.execute(tx);
  const sa = (await sql<{ s: boolean }>`select coalesce(sa_batch_approval_required, false) as s from app.security_settings where id = 1`.execute(tx)).rows[0]?.s ?? false;
  const task = (await sql<{ id: string }>`select id from app.approval_tasks where disbursement_batch_id = ${b.id}::uuid and status = 'open'`.execute(tx)).rows[0];
  const ta = await actionability(tx, task?.id ?? null, '00000000-0000-0000-0000-000000000000');
  const me = (await sql<{ u: string | null }>`select app.current_app_user_id() as u`.execute(tx)).rows[0]?.u ?? null;
  if (ta && b.prepared_by === me) { ta.canDecide = false; ta.blockedReason = 'You prepared this batch — another Super Admin must approve it.'; }
  const missingGl = (await sql<R>`select distinct k.id, k.name from app.disbursement_batch_claims m join app.claim_lines l on l.claim_id = m.claim_id
      join app.claim_categories k on k.id = l.category_id where m.batch_id = ${b.id}::uuid and m.removed_at is null and coalesce(l.gl_account_snapshot, k.gl_account_code) is null`.execute(tx)).rows;
  const blockers: BatchDetail['blockers'] = [
    ...payees.filter((p) => p.paymentMethod === 'bank_transfer' && !p.bankComplete).map((p) => ({ kind: 'bank' as const, label: `${p.employeeNo} ${p.fullName}: incomplete bank details`, href: `/employees/${p.employeeNo}?tab=bank` })),
    ...missingGl.map((k) => ({ kind: 'gl' as const, label: `Category without GL account: ${k.name}`, href: `/claims/setup/categories` })),
  ];
  const names = await resolveNames(tx, [b.prepared_by, b.approved_by, b.disbursed_by, b.cancelled_by, b.created_by, b.updated_by]);
  const draftLike = b.status === 'draft';
  const canGenerate = !['disbursed', 'cancelled', 'pending_approval'].includes(b.status) && !(draftLike && sa) && blockers.length === 0 && b.claim_count > 0;
  return {
    id: b.id, batchNo: b.batch_no, version: b.version, disbursementMonth: b.disbursement_month, cutoffDate: b.approval_cutoff_date, plannedPaymentDate: b.planned_payment_date,
    isRegular: b.is_regular, status: b.status, claimCount: b.claim_count, employeeCount: b.employee_count, total: m2(b.total_amount), totalSst: m2(b.total_sst),
    paymentDate: b.payment_date, paymentReference: b.payment_reference, notes: b.notes,
    preparedByName: names.get(b.prepared_by) ?? '', preparedAt: iso(b.created_at)!, approvedByName: b.approved_by ? names.get(b.approved_by) ?? null : null, approvedAt: iso(b.approved_at),
    disbursedByName: b.disbursed_by ? names.get(b.disbursed_by) ?? null : null, disbursedAt: iso(b.disbursed_at),
    cancelledByName: b.cancelled_by ? names.get(b.cancelled_by) ?? null : null, cancelledAt: iso(b.cancelled_at), cancelReason: b.cancel_reason,
    outputsOutOfDate: b.outputs_out_of_date, outOfDateReason: b.out_of_date_reason, bankChangedAfterExport: b.bank_details_changed_after_export,
    routeNote: BATCH_ROUTE_NOTE, saApprovalOn: sa,
    claims: claims.rows.map((m) => ({ claimId: m.claim_id, claimNo: m.claim_no, employee: personRef(m.employee_id, m.employee_no, m.full_name, m.preferred_name), title: m.title,
      approvedOn: m.approved_on, total: m2(m.amount), status: m.cs, undone: m.undone_at ? { reason: m.undo_reason, at: iso(m.undone_at)! } : null })),
    byEmployee: payees.map(payeeRow),
    outputs: await outputsOf(tx, b.id, b.outputs_version, b.outputs_out_of_date),
    history: history.rows.map((h) => ({ at: iso(h.occurred_at)!, event: h.event, fromStatus: h.fs, toStatus: h.ts, actorName: h.actor_name, comment: h.comment })),
    task: ta, blockers,
    can: {
      generateOutputs: canGenerate && b.outputs_version === 0, regenerateOutputs: canGenerate && b.outputs_version > 0,
      submitForApproval: sa && draftLike && b.claim_count > 0, addClaims: draftLike, removeClaims: draftLike,
      markDisbursed: b.status === 'exported' && !b.outputs_out_of_date, cancel: !['disbursed', 'cancelled'].includes(b.status),
      downloadAttachments: b.claim_count > 0, viewPaymentList: b.claim_count > 0,
    },
    markDisbursedBlockedReason: b.status !== 'exported' ? 'Generate the outputs first.' : b.outputs_out_of_date ? 'Regenerate the outputs first — they are out of date.' : null,
    ...stamps(b, names),
  };
}
export async function getBatch(batchNo: string): Promise<BatchDetail | null> {
  const { ctx } = await authorize(ADMIN);
  if (!BATCH_NO_RE.test(batchNo)) return null;
  return withUserTx(ctx, (tx) => batchDetail(tx, batchNo));
}
export async function paymentListReport(tx: Tx, batchNo: string): Promise<PaymentListReport | null> {
  const b = (await sql<R>`select b.*, app.user_name(b.prepared_by) as prep, app.user_name(b.approved_by) as appr from app.disbursement_batches b where b.batch_no = ${batchNo}`.execute(tx)).rows[0];
  if (!b) return null;
  const co = (await sql<R>`select p.legal_name, s.hlb_account_no_last4 from app.company_profile p left join app.company_statutory s on true limit 1`.execute(tx)).rows[0] ?? {};
  const payees = await payeesOf(tx, b.id);
  await decryptPayees(tx, b.id, payees, 'view');         // D31: full numbers on screen; app.payment_list_view writes the access-log row
  const list = buildPaymentList(payees, { batchNo: b.batch_no, disbursementMonth: b.disbursement_month, total: m2(b.total_amount) });
  const cur = await outputsOf(tx, b.id, b.outputs_version, b.outputs_out_of_date);
  const latest = cur.find((v) => v.version === b.outputs_version);
  const f = (k: string) => { const x = latest?.files.find((y) => y.kind === k); return x ? { exportFileId: x.exportFileId, fileName: x.fileName } : null; };
  return {
    header: { companyName: co.legal_name ?? 'Interact Technology Sdn Bhd', payingAccount: `Hong Leong Bank ${maskAccount(co.hlb_account_no_last4) ?? '(not set)'}`,
      batchNo: b.batch_no, disbursementMonth: b.disbursement_month, plannedPaymentDate: b.planned_payment_date, count: b.claim_count, total: m2(b.total_amount),
      preparedByName: b.prep ?? '', preparedAt: iso(b.created_at)!, approvedByName: b.appr, approvedAt: iso(b.approved_at),
      version: latest?.version ?? null, generatedAt: latest?.generatedAt ?? null },
    rows: list.rows.map((r) => ({ no: r.no, employeeNo: r.employeeNo, beneficiaryName: r.beneficiaryName, bank: r.bank, bankCode: r.bankCode, bic: r.bic,
      accountMasked: maskAccount(payees.find((p) => p.employeeNo === r.employeeNo)?.accountLast4) ?? '', accountNo: r.accountNo, amount: r.amount, paymentReference: r.paymentReference, paymentDescription: r.paymentDescription, beneficiaryEmail: r.beneficiaryEmail,
      claimNos: r.claimNos.split(', ').filter(Boolean) })),
    chequeCash: list.chequeCash.map((r) => ({ no: r.no, employeeNo: r.employeeNo, name: r.name, method: r.method, amount: r.amount, claimNos: r.claimNos.split(', ').filter(Boolean) })),
    totals: { hlb: list.totals.hlb, chequeCash: list.totals.chequeCash, batch: list.totals.batch, matches: list.totals.matches },
    banner: HLB_MANUAL_BANNER, xlsx: f('hlb_claims_payment_list_xlsx'), pdf: f('hlb_claims_payment_list_pdf'),
  };
}
export async function getPaymentListReport(batchNo: string): Promise<PaymentListReport | null> {
  const { ctx } = await authorize(ADMIN);
  if (!BATCH_NO_RE.test(batchNo)) return null;
  return withUserTx(ctx, (tx) => paymentListReport(tx, batchNo));
}

// ===========================================================================
// P1 Home, E3 profile tab, P32 team member, E7 separation
// ===========================================================================
export async function homeClaims(tx: Tx): Promise<HomeClaims> {
  const me = await myEmployeeId(tx);
  const isAdmin = await dbIsAdmin(tx);
  let admin: HomeClaims['admin'] = null;
  if (isAdmin) {
    const a = (await sql<R>`select count(*) filter (where status = 'submitted')::int as s, count(*) filter (where status = 'approved')::int as a,
        count(*) filter (where status = 'approved' and disbursement_batch_id is null)::int as nb,
        coalesce(sum(total_amount) filter (where status = 'approved' and disbursement_batch_id is null), 0) as nbt from app.claims`.execute(tx)).rows[0]!;
    admin = { submitted: a.s, approvedNotDisbursed: a.a, approvedNotInBatch: a.nb, approvedNotInBatchTotal: m2(a.nbt) };
  }
  if (!me) return { pending: [], recent: [], manager: null, admin, hasEmployeeRecord: false };
  const pend = await sql<R>`select id, claim_no, title, total_amount, status::text as status from app.claims where employee_id = ${me}::uuid and status in ('new','submitted')
      order by created_at desc limit 5`.execute(tx);
  const recent = await sql<R>`select id, claim_no, title, total_amount, status::text as status from app.claims where employee_id = ${me}::uuid order by created_at desc limit 3`.execute(tx);
  let manager: HomeClaims['manager'] = null;
  if (await isManager(tx)) {
    const n = (await sql<{ n: number }>`select count(*)::int as n from app.approval_tasks t where t.status = 'open' and t.subject_type = 'claim'
        and app.task_acting_as(t.id)::text in ('assignee','rerouted','delegate')`.execute(tx)).rows[0]?.n ?? 0;
    manager = { teamClaimsSubmitted: n };
  }
  return {
    pending: pend.rows.map((c) => ({ id: c.id, claimNo: c.claim_no, label: c.title, total: m2(c.total_amount), status: c.status as ClaimStatus,
      href: c.status === 'new' ? `/my/claims/${c.claim_no}/edit` : `/my/claims/${c.claim_no}` })),
    recent: recent.rows.map((c) => ({ id: c.id, claimNo: c.claim_no, title: c.title, total: m2(c.total_amount), status: c.status as ClaimStatus, href: `/my/claims/${c.claim_no}` })),
    manager, admin, hasEmployeeRecord: true,
  };
}
export async function getHomeClaims(): Promise<HomeClaims> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, homeClaims);
}

export async function employeeClaimRows(tx: Tx, employeeId: string, params: EmployeeClaimsParams | undefined, all: boolean, withBatch: boolean): Promise<Paged<EmployeeClaimRow>> {
  const p = parseParams(employeeClaimsParamsSchema, params ?? {});
  const q = likeTerm(p.q);
  const where = and([
    sql`c.employee_id = ${employeeId}::uuid`, sql`not (c.status = 'new' and c.on_behalf_by is null)`,
    ...(q ? [sql`(c.claim_no ilike ${q} or c.title ilike ${q})`] : []),
    ...(p.statuses?.length ? [sql`c.status::text = any(${p.statuses}::text[])`] : []),
    ...(p.year ? [sql`extract(year from c.created_at at time zone 'Asia/Kuala_Lumpur') = ${p.year}`] : []),
  ]);
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<R>`select c.*, c.status::text as status, b.batch_no from app.claims c left join app.disbursement_batches b on b.id = c.disbursement_batch_id
      where ${where} order by c.created_at ${dirOf(p.dir)} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from app.claims c where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return {
    rows: rows.rows.map((c) => ({ id: c.id, claimNo: c.claim_no, title: c.title, total: m2(c.total_amount), status: c.status, flags: flagsOf(c), submittedAt: iso(c.submitted_at),
      approvedByName: c.decided_at && !c.reject_reason ? c.decided_by_name : null, batchNo: withBatch ? c.batch_no : null, disbursedOn: withBatch ? c.disbursed_on : null })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function employeeClaimsTab(tx: Tx, employeeId: string, params?: EmployeeClaimsParams): Promise<EmployeeClaimsTab | null> {
  if (!(await dbIsAdmin(tx))) return null;
  const me = await myEmployeeId(tx);
  return {
    claims: await employeeClaimRows(tx, employeeId, params, false, true),
    utilisation: await utilisationOf(tx, employeeId),
    canSubmitOnBehalf: me !== employeeId, submitOnBehalfHref: me !== employeeId ? `/claims/new-on-behalf?employee=${employeeId}` : null,
  };
}
export async function getEmployeeClaims(employeeId: string, params?: EmployeeClaimsParams): Promise<EmployeeClaimsTab | null> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => employeeClaimsTab(tx, employeeId, params));
}
export async function teamMemberClaims(tx: Tx, employeeId: string): Promise<TeamMemberClaims | null> {
  const ok = (await sql<{ m: boolean }>`select app.is_manager_of(${employeeId}::uuid) as m`.execute(tx)).rows[0]?.m;
  if (!ok) return null;
  const rows = (await employeeClaimRows(tx, employeeId, { pageSize: 10, dir: 'desc' }, false, false)).rows.map(({ batchNo: _b, ...r }) => r);
  const n = (await sql<{ n: number }>`select count(*)::int as n from app.claims where employee_id = ${employeeId}::uuid and status = 'submitted'`.execute(tx)).rows[0]?.n ?? 0;
  return { rows, submittedCount: n, utilisation: await utilisationOf(tx, employeeId) };
}
export async function getTeamMemberClaims(employeeId: string): Promise<TeamMemberClaims | null> {
  const { ctx } = await authorize(['MGR']);
  return withUserTx(ctx, (tx) => teamMemberClaims(tx, employeeId));
}
export async function openClaimsFor(tx: Tx, employeeId: string): Promise<SeparationOpenClaims> {
  const r = (await sql<R>`select count(*) filter (where status = 'new')::int as n, count(*) filter (where status = 'submitted')::int as s,
      count(*) filter (where status = 'approved')::int as a, coalesce(sum(total_amount) filter (where status = 'approved'), 0) as amt
      from app.claims where employee_id = ${employeeId}::uuid`.execute(tx)).rows[0]!;
  return { newCount: r.n, submitted: r.s, approvedNotDisbursed: r.a, approvedAmount: m2(r.amt) };
}
export async function claimOpenItems(tx: Tx, employeeId: string): Promise<{ pendingClaims: number; approvedClaims: number }> {
  const r = await openClaimsFor(tx, employeeId);
  return { pendingClaims: r.submitted, approvedClaims: r.approvedNotDisbursed };
}
// ===========================================================================
// Helpers used by the Server Actions (kept here so they are testable and never exposed as actions)
// ===========================================================================
export async function postingLines(tx: Tx, where: ReturnType<typeof sql>): Promise<PostingLineInput[]> {
  const r = await sql<R>`select c.claim_no, l.line_no, e.employee_no, e.full_name, (c.decided_at at time zone 'Asia/Kuala_Lumpur')::date as approved_on, c.disbursed_on,
        k.name as category, l.description, coalesce(l.gl_account_snapshot, k.gl_account_code) as gl, l.amount_excl_sst, l.sst_amount, l.amount_incl_sst,
        d.name as dept, cc.autocount_code, cc.code as cc_code, b.batch_no
      from app.claim_lines l join app.claims c on c.id = l.claim_id join app.employees e on e.id = c.employee_id join app.departments d on d.id = e.department_id
      join app.claim_categories k on k.id = l.category_id left join app.cost_centres cc on cc.id = l.cost_centre_id
      left join app.disbursement_batches b on b.id = c.disbursement_batch_id
     where ${where} order by c.claim_no, l.line_no`.execute(tx);
  return r.rows.map((x) => ({ claimNo: x.claim_no, lineNo: x.line_no, employeeNo: x.employee_no, employeeName: x.full_name, approvedOn: x.approved_on, disbursedOn: x.disbursed_on,
    categoryName: x.category, description: x.description, glAccount: x.gl, amountExclSst: m2(x.amount_excl_sst), sst: m2(x.sst_amount), amountInclSst: m2(x.amount_incl_sst),
    department: x.dept, costCentre: x.autocount_code ?? x.cc_code ?? null, batchNo: x.batch_no }));
}

export async function bundleFiles(tx: Tx, d: AttachmentBundleInputParsed) {
  let claimIds: string[];
  if (d.scope === 'batch') {
    claimIds = (await sql<{ id: string }>`select claim_id as id from app.disbursement_batch_claims where batch_id = ${d.batchId!}::uuid and removed_at is null`.execute(tx)).rows.map((r) => r.id);
  } else if (d.claimIds?.length) {
    claimIds = d.claimIds;
  } else {
    const page = await claimListPage(tx, { ...(d.filter ?? {}), view: 'header' }, true, 'all');
    claimIds = page.rows.map((r) => (r as { id: string }).id);
  }
  const r = await sql<R>`select c.claim_no, l.line_no, f.id, f.original_name, f.mime_type, f.size_bytes, f.data_category::text as cat,
        row_number() over (partition by l.id order by lf.added_at, f.id)::int as n
      from app.claim_line_files lf join app.claim_lines l on l.id = lf.claim_line_id join app.claims c on c.id = l.claim_id join app.files f on f.id = lf.file_id
     where c.id = any(${claimIds}::uuid[]) and c.status <> 'new' and f.status = 'active' order by c.claim_no, l.line_no`.execute(tx);
  return { files: r.rows, claims: new Set(r.rows.map((x) => x.claim_no)).size };
}

export async function claimEmployeeOptions(tx: Tx, d: { q?: string; limit: number }): Promise<{ rows: ClaimEmployeeOption[] }> {
    const q = d.q ? `%${d.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const r = await sql<R>`select e.id, e.employee_no, e.full_name, e.preferred_name, e.status::text as status, d.name as dept,
          (select s.last_working_day from app.employee_separations s where s.employee_id = e.id and not s.is_withdrawn and not s.superseded_by_rehire) as lwd,
          (select max(u.access_end_date) from app.app_users u where u.employee_id = e.id) as access_end
        from app.employees e join app.departments d on d.id = e.department_id
       where e.id is distinct from app.current_employee_id()
         and (e.status in ('on_probation','confirmed','notice_period')
              or (e.status = 'separated' and coalesce((select max(u.access_end_date) from app.app_users u where u.employee_id = e.id),
                   (select s.last_working_day + 30 from app.employee_separations s where s.employee_id = e.id and not s.is_withdrawn and not s.superseded_by_rehire)) >= app.today_myt()))
         and (${q}::text is null or e.full_name ilike ${q} or e.preferred_name ilike ${q} or e.employee_no ilike ${q})
       order by e.full_name limit ${d.limit}`.execute(tx);
    return { rows: r.rows.map((x) => ({ id: x.id, employeeNo: x.employee_no, name: x.preferred_name ? `${x.full_name} (${x.preferred_name})` : x.full_name, department: x.dept,
      status: x.status, note: x.status === 'separated' ? `Separated — portal access until ${csvDate(x.access_end ?? x.lwd)}` : x.status === 'notice_period' ? 'Notice period' : null })) };
}

export async function lateOverrideCandidates(tx: Tx, d: { employeeId: string }): Promise<{ rows: LateOverrideCandidate[] }> {
    const r = await sql<R>`select l.id as line_id, l.line_no, l.transaction_date, l.amount_incl_sst, l.late_override, c.id as claim_id, c.claim_no, k.name as category,
          (app.today_myt() - l.transaction_date - p.submission_deadline_days)::int as past
        from app.claim_lines l join app.claims c on c.id = l.claim_id join app.claim_categories k on k.id = l.category_id cross join app.claim_policy p
       where c.employee_id = ${d.employeeId}::uuid and c.status = 'new' and l.transaction_date < app.today_myt() - p.submission_deadline_days
       order by c.claim_no, l.line_no`.execute(tx);
    return { rows: r.rows.map((x) => ({ claimId: x.claim_id, claimNo: x.claim_no, lineId: x.line_id, lineNo: x.line_no, category: x.category, transactionDate: x.transaction_date,
      amount: m2(x.amount_incl_sst), daysPastDeadline: x.past, hasOverride: x.late_override })) };
}

export async function batchCandidates(tx: Tx, d: BatchCandidatesParsed): Promise<BatchCandidates> {
    const q = d.q ? `%${d.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const r = await sql<R>`select c.id, c.claim_no, c.title, c.total_amount, c.total_sst, c.decided_by_name, (c.decided_at at time zone 'Asia/Kuala_Lumpur')::date as approved_on,
          e.id as emp_id, e.employee_no, e.full_name, e.preferred_name, e.status::text as es, d.name as dept, ba.payment_method::text as pm,
          (ba.payment_method = 'bank_transfer' and ba.bank_id is not null and ba.account_no_enc is not null and ba.account_holder_name is not null) as complete
        from app.claims c join app.employees e on e.id = c.employee_id join app.departments d on d.id = e.department_id
        left join lateral (select a.* from app.employee_bank_accounts a where a.employee_id = e.id and a.effective_from <= app.today_myt()
                            order by a.effective_from desc, a.created_at desc limit 1) ba on true
       where c.status = 'approved' and c.employee_id is distinct from app.current_employee_id()
         and not exists (select 1 from app.disbursement_batch_claims m where m.claim_id = c.id and m.removed_at is null and m.undone_at is null)
         and (${q}::text is null or c.claim_no ilike ${q} or e.full_name ilike ${q} or e.employee_no ilike ${q})
         and (${d.employeeId ?? null}::uuid is null or c.employee_id = ${d.employeeId ?? null}::uuid)
         and (${d.departmentIds?.length ? d.departmentIds : null}::uuid[] is null or e.department_id = any(${d.departmentIds ?? []}::uuid[]))
         and (${d.approvedFrom ?? null}::date is null or (c.decided_at at time zone 'Asia/Kuala_Lumpur')::date >= ${d.approvedFrom ?? null}::date)
         and (${d.approvedTo ?? null}::date is null or (c.decided_at at time zone 'Asia/Kuala_Lumpur')::date <= ${d.approvedTo ?? null}::date)
       order by c.decided_at, c.claim_no limit 2000`.execute(tx);
    const other = await sql<R>`select count(*)::int as n, coalesce(array_agg(distinct b.batch_no), '{}') as nos from app.disbursement_batch_claims m
        join app.disbursement_batches b on b.id = m.batch_id join app.claims c on c.id = m.claim_id
       where m.removed_at is null and m.undone_at is null and c.status = 'approved' and b.status not in ('disbursed','cancelled')
         and (${d.batchId ?? null}::uuid is null or b.id <> ${d.batchId ?? null}::uuid)`.execute(tx);
    return {
      rows: r.rows.map((c) => ({ claimId: c.id, claimNo: c.claim_no, employee: personRef(c.emp_id, c.employee_no, c.full_name, c.preferred_name), department: c.dept, title: c.title,
        approvedOn: c.approved_on, approvedByName: c.decided_by_name, total: m2(c.total_amount), totalSst: m2(c.total_sst), preselected: c.approved_on <= d.cutoffDate,
        bankComplete: !!c.complete, paymentMethod: c.pm ?? null, isSeparated: c.es === 'separated' })),
      inOtherBatches: { count: other.rows[0]?.n ?? 0, batchNos: other.rows[0]?.nos ?? [] },
    };
}

export async function batchPreview(tx: Tx, d: { claimIds: string[] }): Promise<BatchPreview> {
    const r = await sql<R>`select e.id, e.employee_no, e.full_name, e.preferred_name, count(*)::int as n, array_agg(c.claim_no order by c.claim_no) as nos,
          sum(c.total_amount) as amt, sum(c.total_sst) as sst, ba.payment_method::text as pm, bk.name as bank, ba.account_no_last4 as last4,
          (ba.payment_method = 'bank_transfer' and ba.bank_id is not null and ba.account_no_enc is not null and ba.account_holder_name is not null) as complete
        from app.claims c join app.employees e on e.id = c.employee_id
        left join lateral (select a.* from app.employee_bank_accounts a where a.employee_id = e.id and a.effective_from <= app.today_myt()
                            order by a.effective_from desc, a.created_at desc limit 1) ba on true
        left join app.banks bk on bk.id = ba.bank_id
       where c.id = any(${d.claimIds}::uuid[]) and c.status = 'approved'
       group by e.id, e.employee_no, e.full_name, e.preferred_name, ba.payment_method, bk.name, ba.account_no_last4, ba.bank_id, ba.account_no_enc, ba.account_holder_name
       order by e.full_name`.execute(tx);
    const payees = r.rows.map((x) => ({ employee: personRef(x.id, x.employee_no, x.full_name, x.preferred_name), claimCount: x.n, claimNos: x.nos, amount: m2(x.amt),
      paymentMethod: x.pm ?? null, bankName: x.bank, accountMasked: x.last4 ? `••••${x.last4}` : null, bankComplete: !!x.complete, bankChangedAfterExport: false }));
    return {
      count: r.rows.reduce((a, x) => a + x.n, 0), total: sumMoney(r.rows.map((x) => m2(x.amt))), totalSst: sumMoney(r.rows.map((x) => m2(x.sst))), employees: r.rows.length,
      payees, incompleteBank: payees.filter((p) => p.paymentMethod === 'bank_transfer' && !p.bankComplete).map((p) => p.employee),
      chequeCash: payees.filter((p) => p.paymentMethod !== 'bank_transfer'),
    };
}

export { monthPeriod, yearPeriod };
