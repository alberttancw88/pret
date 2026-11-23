import 'server-only';
import { sql, withUserTx, type Tx } from '../db';
import { logDenied } from '../audit';
import type { Role } from '../auth/current-user';
import { authorize, iso, likeTerm, resolveNames, stamps } from '../lib/action-helpers';
import { parseParams, EXPORT_LIMIT } from './org';
import {
  adjustmentListParamsSchema, balanceListParamsSchema, calendarParamsSchema, creditListParamsSchema, leaveApplicationListParamsSchema,
  leaveTypeListParamsSchema, ledgerParamsSchema, myLeaveParamsSchema, overrideListParamsSchema, workflowListParamsSchema,
  DEFAULT_ADMIN_LEAVE_STATUSES, MEDICAL_CATEGORIES, MY_STATE_LABELS,
  type AdjustmentListParams, type AdjustmentRow, type ApplyLeaveForm, type ApplyLeaveTypeOption, type BalanceCard, type BalanceList,
  type BalanceListParams, type BalanceListRow, type CalendarEntry, type CalendarParams, type CreditDetail, type CreditListParams,
  type CreditRow, type DayBreakdown, type EmployeeLeaveTab, type EntitlementMethod, type FileRef, type HomeLeave, type LeaveApplicationDetail,
  type LeaveApplicationListParams, type LeaveApplicationRow, type LeaveBandSet, type LeaveCalendar, type LeaveCategory, type LeavePolicy,
  type LeaverPosition, type LeaveSetupOptions, type LeaveStatus, type LeaveTypeDetail, type LeaveTypeListParams, type LeaveTypeRef,
  type LeaveTypeRow, type LedgerPage, type LedgerParams, type LedgerRow, type LedgerTransaction, type MyBalances, type MyLeaveParams,
  type MyLeaveRow, type MyState, type OverrideListParams, type OverrideRow, type Paged, type StatutoryMinimum, type TeamLeaveSummary,
  type TeamMemberLeave, type WorkflowListParams, type WorkflowRow, type YearEndStatus, type Ref,
} from '../contracts/leave';
import {
  APPROVER_SOURCE_LABELS, APPROVER_SOURCE_SHORT, type ApprovalTrailRow, type ApproverSource, type PersonRef, type TaskActionability,
  type TaskSubject,
} from '../contracts/approvals';

// M2 Leave queries (W2-004). Server-only; every function: requireUser([...]) → withUserTx (RLS). The database engine
// (app.leave_balance_view, app.entitlement_view, app.calendar_marks …) computes balances and calendars; this module projects
// rows per role (rls-policies §5.4, §8): peers never see type/reason, managers never see the ledger (F-LV-28).

export const ANY: Role[] = ['EMP', 'MGR', 'ADM', 'SA'];
export const ADMIN: Role[] = ['ADM', 'SA'];
export const TEAM: Role[] = ['MGR', 'ADM', 'SA'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
type Where = ReturnType<typeof sql>;
const and = (c: Where[]): Where => (c.length ? sql.join(c, sql` and `) : sql`true`);
const dirOf = (d: 'asc' | 'desc') => sql.raw(d === 'desc' ? 'desc' : 'asc');
export const d1 = (v: unknown): string => (v === null || v === undefined || v === '' ? '0.0' : Number(v).toFixed(1));
export const d1n = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : Number(v).toFixed(1));
const dmy = (d: string | null | undefined) => (d ? d.split('-').reverse().join('/') : '');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ===========================================================================
// Small shared helpers (exported for the actions)
// ===========================================================================
export async function todayMyt(tx: Tx): Promise<string> {
  return (await sql<{ d: string }>`select app.today_myt()::text as d`.execute(tx)).rows[0]!.d;
}
export async function myEmployeeId(tx: Tx): Promise<string | null> {
  return (await sql<{ id: string | null }>`select app.current_employee_id() as id`.execute(tx)).rows[0]?.id ?? null;
}
export async function dbIsAdmin(tx: Tx): Promise<boolean> {
  return (await sql<{ a: boolean }>`select app.is_admin() as a`.execute(tx)).rows[0]?.a ?? false;
}
export async function canSeeEmployee(tx: Tx, employeeId: string): Promise<boolean> {
  return (await sql<{ a: boolean }>`select app.can_see_team_row(${employeeId}::uuid) as a`.execute(tx)).rows[0]?.a ?? false;
}
export function typeRef(r: R, p = ''): LeaveTypeRef {
  return { id: r[`${p}type_id`] ?? r.id, code: r[`${p}code`], name: r[`${p}type_name`] ?? r.name, category: r[`${p}category`], colour: r[`${p}colour`] ?? r.calendar_colour };
}
export function personRef(id: string, no: string | null, full: string, preferred: string | null): PersonRef {
  return { id, employeeNo: no, name: preferred ? `${full} (${preferred})` : full };
}
export async function leaveTypes(tx: Tx, activeOnly = false): Promise<R[]> {
  return (await sql<R>`select t.*, t.calendar_colour as colour from app.leave_types t
      ${activeOnly ? sql`where t.is_active` : sql``} order by t.display_order, t.code`.execute(tx)).rows;
}
async function statutoryMinimums(tx: Tx): Promise<StatutoryMinimum[]> {
  const r = await sql<R>`select category::text as category, service_from_years, service_to_years, min_days, legal_ref
      from app.statutory_leave_minimums order by category, service_from_years`.execute(tx);
  return r.rows.map((x) => ({ category: x.category, serviceFromYears: d1(x.service_from_years), serviceToYears: d1n(x.service_to_years),
    minDays: d1(x.min_days), legalRef: x.legal_ref }));
}
async function bandsByType(tx: Tx, year: number): Promise<Map<string, R[]>> {
  const r = await sql<R>`select b.* from app.leave_entitlement_bands b
      where b.effective_year = coalesce((select max(x.effective_year) from app.leave_entitlement_bands x where x.leave_type_id = b.leave_type_id and x.effective_year <= ${year}),
                                        (select min(x.effective_year) from app.leave_entitlement_bands x where x.leave_type_id = b.leave_type_id))
        and b.grade_id is null order by b.service_from_years`.execute(tx);
  const m = new Map<string, R[]>();
  for (const b of r.rows) m.set(b.leave_type_id, [...(m.get(b.leave_type_id) ?? []), b]);
  return m;
}
export function entitlementSummary(t: R, bands: R[] | undefined): string {
  if (t.entitlement_method === 'fixed_per_occurrence') return `${Number(t.days_per_occurrence)} ${t.count_basis === 'consecutive_calendar_days' ? 'consecutive' : 'days'}${t.max_occurrences ? ` · max ${t.max_occurrences}` : ''}`;
  if (t.entitlement_method === 'earned_credits') return 'Earned credits';
  if (t.entitlement_method === 'no_entitlement') return t.deduct_from_type_id ? 'Deducts from another type' : t.annual_cap_days ? `Cap ${Number(t.annual_cap_days)}/yr` : 'Approval only';
  const days = (bands ?? []).map((b) => Number(b.days_per_year));
  const base = days.length > 1 ? `${days.join(' / ')} by service` : days.length === 1 ? `${days[0]} per year` : 'No bands';
  return t.pool_cap_days ? `${base} · pool ${Number(t.pool_cap_days)}` : base;
}

/** Approval trail rows (LA19) for a subject (+ its cancellation tasks). */
export async function trailRows(tx: Tx, subjectIds: { leave?: string; credit?: string }): Promise<ApprovalTrailRow[]> {
  const r = await sql<R>`select t.*, t.subject_type::text as st, t.source::text as src, t.status::text as stt, t.acting_as::text as act
      from app.approval_tasks t
     where ${subjectIds.leave ? sql`t.leave_application_id = ${subjectIds.leave}::uuid` : sql`t.replacement_credit_id = ${subjectIds.credit ?? null}::uuid`}
     order by t.created_at, t.level`.execute(tx);
  const names = new Map<string, string>();
  for (const id of new Set(r.rows.map((x) => x.assignee_user_id).filter(Boolean))) {
    names.set(id, (await sql<{ n: string | null }>`select app.user_name(${id}::uuid) as n`.execute(tx)).rows[0]?.n ?? '');
  }
  return r.rows.map((x) => ({
    taskId: x.id, subjectType: x.st as TaskSubject, level: x.level, source: x.src as ApproverSource,
    sourceLabel: APPROVER_SOURCE_LABELS[x.src as ApproverSource],
    approverName: x.assignee_user_id ? names.get(x.assignee_user_id) ?? '' : APPROVER_SOURCE_SHORT[x.src as ApproverSource],
    routingNote: x.routing_note, status: x.stt, decidedByName: x.decided_by_name, actingAs: x.act, comment: x.decision_comment,
    decidedAt: iso(x.decided_at), createdAt: iso(x.created_at)!,
  }));
}

/** What the caller may do with an open task (DB: app.can_act_on_task / app.task_acting_as). */
export async function actionability(tx: Tx, taskId: string | null, subjectEmployeeId: string): Promise<TaskActionability | null> {
  if (!taskId) return null;
  const r = (await sql<{ version: number; level: number; can: boolean; acting: string | null; me: string | null }>`
      select t.version, t.level, app.can_act_on_task(t.id) as can, app.task_acting_as(t.id)::text as acting, app.current_employee_id() as me
        from app.approval_tasks t where t.id = ${taskId}::uuid`.execute(tx)).rows[0];
  if (!r) return null;
  const own = r.me === subjectEmployeeId;
  return {
    taskId, version: r.version, level: r.level, canDecide: r.can && !own, overrideOnly: r.acting === 'admin_override', asDelegate: r.acting === 'delegate',
    blockedReason: own ? "You can't decide your own request." : r.can ? null : 'This item is not waiting for you.',
  };
}

// ===========================================================================
// Balance cards (P5 / P1 / E3 Leave tab / P32)
// ===========================================================================
export async function balanceCards(tx: Tx, employeeId: string, year: number, opts: { visibleOnly?: boolean } = {}): Promise<BalanceCard[]> {
  const today = await todayMyt(tx);
  const emp = (await sql<R>`select e.gender::text as gender from app.employees e where e.id = ${employeeId}::uuid`.execute(tx)).rows[0];
  if (!emp) return [];
  const types = (await leaveTypes(tx, true)).filter((t) => (!opts.visibleOnly || t.visible_to_employees)
    && (t.eligible_gender === 'all' || t.eligible_gender === emp.gender) && !t.deduct_from_type_id);
  const asAt = year === Number(today.slice(0, 4)) ? today : `${year}-12-31`;
  const cards: BalanceCard[] = [];
  for (const t of types) {
    const b = (await sql<{ b: R }>`select app.leave_balance_view(${employeeId}::uuid, ${t.id}::uuid, ${year}, ${asAt}::date) as b`.execute(tx)).rows[0]!.b;
    const exp = await sql<R>`select l.days, l.expires_on, case when l.source_credit_id is null then 'carry_forward' else 'credit' end as kind
        from app.leave_ledger l where l.employee_id = ${employeeId}::uuid and l.leave_type_id = ${t.id}::uuid and l.leave_year = ${year}
         and l.entry_type in ('carry_forward','credit_earned') and l.expires_on >= ${today}::date
         and not exists (select 1 from app.leave_ledger x where x.source_ledger_id = l.id) order by l.expires_on`.execute(tx);
    let occurrences: BalanceCard['occurrences'] = null;
    if (t.entitlement_method === 'fixed_per_occurrence') {
      const used = (await sql<{ n: number }>`select (count(distinct coalesce(a.split_group_id, a.id)) + coalesce((select c.migrated_occurrences from app.employee_leave_counters c
          where c.employee_id = ${employeeId}::uuid and c.leave_type_id = ${t.id}::uuid), 0))::int as n
          from app.leave_applications a where a.employee_id = ${employeeId}::uuid and a.leave_type_id = ${t.id}::uuid
           and a.status in ('approved','cancellation_pending','pending')`.execute(tx)).rows[0]?.n ?? 0;
      occurrences = { used, max: t.max_occurrences ?? null };
    }
    const available = d1(b.available);
    const label = t.entitlement_method === 'fixed_per_occurrence'
      ? `${Number(t.days_per_occurrence)} ${t.count_basis === 'consecutive_calendar_days' ? 'consecutive days' : 'days'} per ${t.category === 'maternity' || t.category === 'paternity' ? 'confinement' : 'occurrence'}`
      : b.has_balance ? `${available} available` : 'approval only';
    cards.push({
      leaveType: { ...typeRef(t), entitlementMethod: t.entitlement_method as EntitlementMethod }, year,
      entitled: d1(b.entitled), carriedForward: d1(b.carried_forward), earned: d1(b.earned_credits), adjustments: d1(b.adjustments),
      taken: d1(b.taken), pending: d1(b.pending), expiredForfeited: d1(b.expired_forfeited), balance: d1(b.balance), available,
      earnedToDate: d1n(b.earned_to_date),
      expiring: exp.rows.map((x) => ({ days: d1(x.days), date: x.expires_on, kind: x.kind })),
      pool: b.pool ? { label: b.pool.label, used: d1(b.pool.used), cap: d1(b.pool.cap) } : null,
      occurrences, availableLabel: label,
    });
  }
  return cards;
}

// ===========================================================================
// L8 / L9 Leave types
// ===========================================================================
export async function leaveTypeRows(tx: Tx, params: LeaveTypeListParams, all: boolean): Promise<Paged<LeaveTypeRow>> {
  const p = parseParams(leaveTypeListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    ...(q ? [sql`(t.code ilike ${q} or t.name ilike ${q})`] : []),
    ...(p.categories?.length ? [sql`t.category::text = any(${p.categories}::text[])`] : []),
    ...(p.active === 'active' ? [sql`t.is_active`] : p.active === 'inactive' ? [sql`not t.is_active`] : []),
  ]);
  const sort: Record<string, string> = { order: 't.display_order', code: 't.code', name: 't.name', category: 't.category' };
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<R>`select t.*, t.category::text as category, t.count_basis::text as count_basis, t.entitlement_method::text as entitlement_method,
        w.name as workflow_name,
        (t.category in ('annual','sick','hospitalisation','maternity','paternity') and exists (select 1 from app.employees e
            where e.status in ('pending_join','on_probation','confirmed','notice_period') and (t.eligible_gender = 'all' or t.eligible_gender::text = e.gender::text))) as locked
      from app.leave_types t join app.approval_workflows w on w.id = t.workflow_id
     where ${where} order by ${sql.raw(sort[p.sort] ?? 't.display_order')} ${dirOf(p.dir)}, t.code limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from app.leave_types t where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const bands = await bandsByType(tx, Number((await todayMyt(tx)).slice(0, 4)));
  return {
    rows: rows.rows.map((t) => ({
      id: t.id, code: t.code, name: t.name, category: t.category, isPaid: t.is_paid, countBasis: t.count_basis,
      entitlementSummary: entitlementSummary(t, bands.get(t.id)), workflow: { id: t.workflow_id, label: t.workflow_name },
      visibleToEmployees: t.visible_to_employees, isActive: t.is_active, displayOrder: t.display_order, colour: t.calendar_colour,
      canDeactivate: t.is_active && !t.locked,
    })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listLeaveTypes(params: LeaveTypeListParams): Promise<Paged<LeaveTypeRow>> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => leaveTypeRows(tx, params, false));
}

export function typeValues(t: R): LeaveTypeDetail['values'] {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    code: t.code, name: t.name, category: t.category, description: t.description, isPaid: t.is_paid, countBasis: t.count_basis,
    entitlementMethod: t.entitlement_method, accrualOverride: t.accrual_override, prorateJoinersLeavers: t.prorate_joiners_leavers,
    eligibleGender: t.eligible_gender, eligibleMarital: t.eligible_marital, minServiceMonths: t.min_service_months,
    availableOnProbation: t.available_on_probation, halfDayAllowed: t.half_day_allowed, reasonRequired: t.reason_required,
    attachmentRule: t.attachment_rule, attachmentThresholdDays: n(t.attachment_threshold_days), attachmentGraceHours: t.attachment_grace_hours,
    minNoticeDays: t.min_notice_days, minNoticeBehaviour: t.min_notice_behaviour, backdateWorkingDays: t.backdate_working_days,
    maxDaysPerApplication: n(t.max_days_per_application), maxOccurrences: t.max_occurrences, occurrenceScope: t.occurrence_scope,
    daysPerOccurrence: n(t.days_per_occurrence), annualCapDays: n(t.annual_cap_days), deductFromTypeId: t.deduct_from_type_id,
    poolWithTypeId: t.pool_with_type_id, poolCapDays: n(t.pool_cap_days), carryForwardAllowed: t.carry_forward_allowed,
    cfCapOverride: n(t.cf_cap_override), cfExpiryMonthsOverride: t.cf_expiry_months_override, allowNegative: t.allow_negative,
    maxNegativeDays: n(t.max_negative_days), workflowId: t.workflow_id, selfCancelFutureApproved: t.self_cancel_future_approved,
    visibleToEmployees: t.visible_to_employees, calendarColour: t.calendar_colour, payrollTreatment: t.payroll_treatment,
    displayOrder: t.display_order, isActive: t.is_active,
  };
}
export async function getLeaveType(code: string): Promise<LeaveTypeDetail | null> {
  const { ctx } = await authorize(ADMIN);
  if (!/^[A-Za-z0-9]{1,10}$/.test(code)) return null;
  return withUserTx(ctx, async (tx) => {
    const t = (await sql<R>`select t.*, t.category::text as category, t.count_basis::text as count_basis, t.entitlement_method::text as entitlement_method,
        t.accrual_override::text as accrual_override, t.eligible_gender::text as eligible_gender, t.eligible_marital::text as eligible_marital,
        t.attachment_rule::text as attachment_rule, t.min_notice_behaviour::text as min_notice_behaviour, t.occurrence_scope::text as occurrence_scope,
        t.payroll_treatment::text as payroll_treatment,
        (select count(*)::int from app.leave_applications a where a.leave_type_id = t.id) as used
        from app.leave_types t where t.code = ${code.toUpperCase()}`.execute(tx)).rows[0];
    if (!t) return null;
    const bands = await bandsByType(tx, Number((await todayMyt(tx)).slice(0, 4)));
    const overrides = await sql<R>`select o.detail, o.reason, o.approved_at, app.user_name(o.approved_by) as by from app.statutory_floor_overrides o
        where o.leave_type_id = ${t.id}::uuid order by o.approved_at desc`.execute(tx);
    const names = await resolveNames(tx, [t.created_by, t.updated_by]);
    const used = t.used > 0 || ((await sql<{ n: number }>`select count(*)::int as n from app.leave_ledger where leave_type_id = ${t.id}::uuid`.execute(tx)).rows[0]?.n ?? 0) > 0;
    const statutory = (await statutoryMinimums(tx)).filter((m) => m.category === t.category);
    const eligibleCount = (await sql<{ n: number }>`select count(*)::int as n from app.employees e where e.status in ('pending_join','on_probation','confirmed','notice_period')
        and (${t.eligible_gender} = 'all' or ${t.eligible_gender} = e.gender::text)`.execute(tx)).rows[0]?.n ?? 0;
    return {
      id: t.id, values: typeValues(t), categoryLocked: used, usedByApplications: t.used,
      bandsSummary: t.entitlement_method === 'annual_banded' ? entitlementSummary(t, bands.get(t.id)) : null,
      statutoryMinimums: statutory,
      floorOverrides: overrides.rows.map((o) => ({ detail: o.detail, reason: o.reason, approvedByName: o.by ?? '', approvedAt: iso(o.approved_at)! })),
      canDeactivate: t.is_active && !(['annual', 'sick', 'hospitalisation', 'maternity', 'paternity'].includes(t.category) && eligibleCount > 0),
      version: t.version, ...stamps(t, names),
    };
  });
}

// ===========================================================================
// L10 Bands
// ===========================================================================
export async function getLeaveBands(leaveTypeId: string, year?: number): Promise<LeaveBandSet | null> {
  const { ctx } = await authorize(ADMIN);
  if (!UUID_RE.test(leaveTypeId)) return null;
  return withUserTx(ctx, async (tx) => {
    const t = (await sql<R>`select t.*, t.category::text as category from app.leave_types t where t.id = ${leaveTypeId}::uuid`.execute(tx)).rows[0];
    if (!t) return null;
    const years = (await sql<{ y: number }>`select distinct effective_year as y from app.leave_entitlement_bands where leave_type_id = ${leaveTypeId}::uuid order by 1`.execute(tx)).rows.map((r) => r.y);
    const cur = Number((await todayMyt(tx)).slice(0, 4));
    const y = year ?? (years.filter((v) => v <= cur).pop() ?? years[0] ?? cur);
    const stat = (await statutoryMinimums(tx)).filter((m) => m.category === t.category);
    const rows = await sql<R>`select b.*, g.name as grade_name from app.leave_entitlement_bands b left join app.grades g on g.id = b.grade_id
        where b.leave_type_id = ${leaveTypeId}::uuid and b.effective_year = ${y} order by b.grade_id nulls first, b.service_from_years`.execute(tx);
    const minFor = (from: number, to: number | null) => {
      const ms = stat.filter((m) => Number(m.serviceFromYears) < (to ?? 999) && (m.serviceToYears === null || Number(m.serviceToYears) > from)).map((m) => Number(m.minDays));
      return ms.length ? Math.max(...ms) : null;
    };
    const affected = (await sql<{ n: number }>`select count(distinct employee_id)::int as n from app.leave_entitlements where leave_type_id = ${leaveTypeId}::uuid and leave_year >= ${y}`.execute(tx)).rows[0]?.n ?? 0;
    return {
      leaveType: typeRef(t), effectiveYear: y, years,
      rows: rows.rows.map((b) => {
        const m = minFor(Number(b.service_from_years), b.service_to_years === null ? null : Number(b.service_to_years));
        return { id: b.id, serviceFromYears: d1(b.service_from_years), serviceToYears: d1n(b.service_to_years), daysPerYear: d1(b.days_per_year),
          grade: b.grade_id ? { id: b.grade_id, label: b.grade_name } : null, statutoryMinimum: m === null ? null : m.toFixed(1),
          belowMinimum: m !== null && Number(b.days_per_year) < m };
      }),
      statutoryMinimums: stat, employeesAffected: affected,
    };
  });
}

// ===========================================================================
// L11 Policy
// ===========================================================================
export async function policyOf(tx: Tx): Promise<LeavePolicy> {
  const p = (await sql<R>`select p.*, p.entitlement_method::text as entitlement_method, p.prorate_basis::text as prorate_basis, p.rounding::text as rounding,
      p.team_calendar_visibility::text as team_calendar_visibility from app.leave_policy p where p.id = 1`.execute(tx)).rows[0]!;
  const types = (await leaveTypes(tx)).filter((t) => (p.emergency_leave_type_ids ?? []).includes(t.id)).map((t) => typeRef(t));
  const names = await resolveNames(tx, [p.updated_by]);
  const months = Number(p.carry_forward_expiry_months);
  const expiry = months > 0 ? dmy(new Date(Date.UTC(2001, months, 0)).toISOString().slice(0, 10)).slice(0, 5) : null;
  return {
    entitlementMethod: p.entitlement_method, prorateBasis: p.prorate_basis, rounding: p.rounding, eaFloorForJoinersLeavers: p.ea_floor_for_joiners_leavers,
    carryForwardCapDays: Number(p.carry_forward_cap_days), carryForwardExpiryMonths: months, allowNextYearApplications: p.allow_next_year_applications,
    nextYearFromDdmm: p.next_year_from_ddmm, formMessage: p.form_message, emergencyThresholdDays: p.emergency_threshold_days,
    emergencyLeaveTypeIds: p.emergency_leave_type_ids ?? [], teamCalendarVisibility: p.team_calendar_visibility,
    notifyOnAdminWithdraw: p.notify_on_admin_withdraw, includeSeparatedInReports: p.include_separated_in_reports,
    reminderAfterWorkingDays: p.reminder_after_working_days, escalateAfterWorkingDays: p.escalate_after_working_days,
    replacementCreditValidityDays: p.replacement_credit_validity_days, replacementCreditsCarryForward: p.replacement_credits_carry_forward,
    replacementForPhOnOffDay: p.replacement_for_ph_on_off_day, replacementWorkedLookbackDays: p.replacement_worked_lookback_days,
    cancellationApproverLevel1Only: p.cancellation_approver_level1_only, paternityWindowDaysAfterBirth: p.paternity_window_days_after_birth,
    teamAbsenceThreshold: p.team_absence_threshold, version: p.version, leaveYearStartDdmm: '01/01',
    carryForwardExpiryLabel: expiry ? `Expires ${expiry}` : 'No expiry', emergencyLeaveTypes: types,
    createdAt: null, createdByName: null, updatedAt: iso(p.updated_at), updatedByName: p.updated_by ? names.get(p.updated_by) ?? null : 'System',
  };
}
export async function getLeavePolicy(): Promise<LeavePolicy> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, policyOf);
}

// ===========================================================================
// L12 Workflows + setup options
// ===========================================================================
export async function workflowRows(tx: Tx, params: WorkflowListParams, all: boolean, id?: string): Promise<Paged<WorkflowRow>> {
  const p = parseParams(workflowListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    ...(id ? [sql`w.id = ${id}::uuid`] : []),
    ...(q ? [sql`w.name ilike ${q}`] : []),
    ...(p.active === 'active' ? [sql`w.is_active`] : p.active === 'inactive' ? [sql`not w.is_active`] : []),
  ]);
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<R>`select w.* from app.approval_workflows w where ${where} order by w.name ${dirOf(p.dir)} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from app.approval_workflows w where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const ids = rows.rows.map((r) => r.id);
  const levels = await sql<R>`select l.workflow_id, l.level, l.source::text as source, l.specific_employee_id, e.employee_no, e.full_name, e.preferred_name
      from app.approval_workflow_levels l left join app.employees e on e.id = l.specific_employee_id
     where l.workflow_id = any(${ids}::uuid[]) order by l.level`.execute(tx);
  const types = await sql<R>`select t.id, t.code, t.name, t.category::text as category, t.calendar_colour, t.workflow_id, t.is_active
      from app.leave_types t where t.workflow_id = any(${ids}::uuid[]) order by t.display_order`.execute(tx);
  const names = await resolveNames(tx, rows.rows.flatMap((r) => [r.created_by, r.updated_by]));
  return {
    rows: rows.rows.map((w) => {
      const lv = levels.rows.filter((l) => l.workflow_id === w.id).map((l) => ({
        level: l.level, source: l.source as ApproverSource, sourceLabel: APPROVER_SOURCE_LABELS[l.source as ApproverSource],
        specificEmployee: l.specific_employee_id ? personRef(l.specific_employee_id, l.employee_no, l.full_name, l.preferred_name) : null,
      }));
      const used = types.rows.filter((t) => t.workflow_id === w.id);
      return {
        id: w.id, name: w.name,
        levelsLabel: lv.map((l) => (l.specificEmployee ? l.specificEmployee.name : APPROVER_SOURCE_SHORT[l.source])).join(' → '),
        levels: lv, usedBy: used.map((t) => typeRef(t)), skipIfApproverIsApplicant: w.skip_if_approver_is_applicant,
        mergeConsecutiveIdentical: w.merge_consecutive_identical, isActive: w.is_active, canDeactivate: !used.some((t) => t.is_active),
        ...stamps(w, names),
      };
    }),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listWorkflows(params: WorkflowListParams): Promise<Paged<WorkflowRow>> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => workflowRows(tx, params, false));
}
export async function getWorkflow(id: string): Promise<WorkflowRow | null> {
  const { ctx } = await authorize(ADMIN);
  if (!UUID_RE.test(id)) return null;
  return withUserTx(ctx, async (tx) => (await workflowRows(tx, {}, true, id)).rows[0] ?? null);
}
export async function getLeaveSetupOptions(): Promise<LeaveSetupOptions> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, async (tx) => {
    const types = await leaveTypes(tx);
    const ref = async (q: Where) => (await sql<{ id: string; label: string }>`${q}`.execute(tx)).rows;
    return {
      leaveTypes: types.map((t) => ({ ...typeRef(t), entitlementMethod: t.entitlement_method, isActive: t.is_active })),
      workflows: await ref(sql`select id, name as label from app.approval_workflows where is_active order by name`),
      grades: await ref(sql`select id, name as label from app.grades where is_active order by rank`),
      departments: await ref(sql`select id, name as label from app.departments where is_active order by name`),
      locations: await ref(sql`select id, name as label from app.work_locations where is_active order by name`),
      currentYear: Number((await todayMyt(tx)).slice(0, 4)),
      statutoryMinimums: await statutoryMinimums(tx),
    };
  });
}

// ===========================================================================
// P2 / L2 Apply form
// ===========================================================================
export async function applyFormFor(tx: Tx, employeeId: string | null): Promise<ApplyLeaveForm | null> {
  const me = await myEmployeeId(tx);
  const emp = employeeId ?? me;
  if (!emp) return null;
  const isSelf = emp === me;
  if (!isSelf && !(await dbIsAdmin(tx))) return null;
  const e = (await sql<R>`select e.id, e.employee_no, e.full_name, e.preferred_name, e.status::text as status, e.gender::text as gender, e.work_state::text as work_state,
      d.name as dept, coalesce(p.continuous_service_date, e.join_date) as csd, e.confirmation_date, coalesce(e.extended_probation_end_date, e.probation_end_date) as pend,
      (select m.marital_status::text from app.employee_marital_history m where m.employee_id = e.id and m.effective_date <= app.today_myt() order by m.effective_date desc limit 1) as marital
      from app.employees e join app.departments d on d.id = e.department_id left join app.employee_personal p on p.employee_id = e.id where e.id = ${emp}::uuid`.execute(tx)).rows[0];
  if (!e) return null;
  const pol = await policyOf(tx);
  const today = await todayMyt(tx);
  const year = Number(today.slice(0, 4));
  const cards = new Map((await balanceCards(tx, emp, year)).map((c) => [c.leaveType.id, c]));
  const months = (await sql<{ n: number }>`select app.completed_months(${e.csd}::date, app.today_myt()) as n`.execute(tx)).rows[0]?.n ?? 0;
  const types: ApplyLeaveTypeOption[] = []; const ineligible: ApplyLeaveForm['ineligible'] = [];
  for (const t of await leaveTypes(tx, true)) {
    if (!t.visible_to_employees && isSelf) continue;
    const reason = t.eligible_gender !== 'all' && t.eligible_gender !== e.gender ? `${t.eligible_gender === 'female' ? 'female' : 'male'} employees only`
      : t.eligible_marital === 'married' && e.marital !== 'married' ? 'requires married status'
      : months < t.min_service_months ? `requires ${t.min_service_months} months' service`
      : !t.available_on_probation && !e.confirmation_date && e.pend && e.pend >= today ? 'not available during probation' : null;
    if (reason) { ineligible.push({ type: typeRef(t), reason }); continue; }
    const c = cards.get(t.deduct_from_type_id ?? t.id);
    types.push({
      ...typeRef(t), description: t.description, countBasis: t.count_basis, entitlementMethod: t.entitlement_method, halfDayAllowed: t.half_day_allowed,
      reasonRequired: t.reason_required, attachmentRule: t.attachment_rule, attachmentThresholdDays: d1n(t.attachment_threshold_days),
      attachmentGraceHours: t.attachment_grace_hours, daysPerOccurrence: d1n(t.days_per_occurrence),
      requiresConfinementDate: t.category === 'maternity' || t.category === 'paternity', allowsChildBirthDate: t.category === 'paternity',
      availableLabel: t.entitlement_method === 'fixed_per_occurrence' && c?.occurrences?.max
        ? `${c.occurrences.max - c.occurrences.used} of ${c.occurrences.max} occurrences left`
        : t.entitlement_method === 'no_entitlement' && t.annual_cap_days ? `cap ${c?.available ?? d1(t.annual_cap_days)} days left`
        : c?.availableLabel ?? 'approval only',
      available: c && c.availableLabel.endsWith('available') ? c.available : null,
      hrOnly: !t.visible_to_employees,
    });
  }
  const def = types[0];
  let approverHint: string | null = null;
  if (def) {
    const wf = (await sql<{ w: string }>`select workflow_id as w from app.leave_types where id = ${def.id}::uuid`.execute(tx)).rows[0]!.w;
    const lv = await sql<R>`select * from app.workflow_preview(${wf}::uuid, ${emp}::uuid)`.execute(tx);
    const first = lv.rows.find((l) => l.outcome === 'open');
    if (first) approverHint = `Goes to ${first.approver ?? 'an Admin'} for approval (level ${first.level} of ${lv.rows.length}).`;
  }
  const maxDate = pol.allowNextYearApplications && today >= `${year}-${pol.nextYearFromDdmm.slice(3, 5)}-${pol.nextYearFromDdmm.slice(0, 2)}` ? `${year + 1}-12-31` : `${year}-12-31`;
  return {
    employee: { ...personRef(e.id, e.employee_no, e.full_name, e.preferred_name), department: e.dept, workState: e.work_state, isSelf, status: e.status },
    formMessage: pol.formMessage, types, ineligible, approverHint, today, maxDate, emergencyThresholdDays: pol.emergencyThresholdDays,
  };
}
export async function getApplyLeaveForm(employeeId?: string): Promise<ApplyLeaveForm | null> {
  const { ctx } = await authorize(ANY);
  if (employeeId && !UUID_RE.test(employeeId)) return null;
  return withUserTx(ctx, (tx) => applyFormFor(tx, employeeId ?? null));
}

// ===========================================================================
// P3 My leave / L1 Leave applications
// ===========================================================================
const APP_SELECT = sql`a.id, a.ref_no, a.employee_id, a.leave_type_id as type_id, t.code, t.name as type_name, t.category::text as category, t.calendar_colour as colour,
  a.start_date, a.start_session::text as start_session, a.end_date, a.end_session::text as end_session, a.days, a.status::text as status, a.current_level,
  a.total_levels, a.is_emergency, a.on_behalf_by, a.attachment_pending, a.submitted_at, a.decided_at, a.decided_by, a.reason, a.mc_status::text as mc_status,
  a.leave_year, a.split_group_id, t.self_cancel_future_approved`;

export function myRowOf(r: R, today: string, names: Map<string, string>): MyLeaveRow {
  return {
    id: r.id, refNo: r.ref_no, leaveType: typeRef(r), startDate: r.start_date, startSession: r.start_session, endDate: r.end_date, endSession: r.end_session,
    days: d1(r.days), status: r.status, level: r.current_level, levels: r.total_levels, isEmergency: r.is_emergency,
    onBehalfByName: r.on_behalf_by ? names.get(r.on_behalf_by) ?? r.on_behalf_name ?? 'HR' : null, attachmentPending: r.attachment_pending,
    submittedAt: iso(r.submitted_at)!, decidedByName: r.decided_by ? names.get(r.decided_by) ?? r.decided_name ?? null : null, decidedAt: iso(r.decided_at),
    can: {
      withdraw: r.status === 'pending',
      cancel: r.status === 'approved' && r.self_cancel_future_approved && r.start_date > today,
      requestCancellation: r.status === 'approved' && !(r.self_cancel_future_approved && r.start_date > today),
    },
  };
}
export async function myLeaveRows(tx: Tx, params: MyLeaveParams, all: boolean, employeeId?: string): Promise<Paged<MyLeaveRow>> {
  const p = parseParams(myLeaveParamsSchema, params);
  const emp = employeeId ?? (await myEmployeeId(tx));
  if (!emp) return { rows: [], total: 0, page: 1, pageSize: p.pageSize };
  const today = await todayMyt(tx);
  const q = likeTerm(p.q);
  const where = and([
    sql`a.employee_id = ${emp}::uuid`,
    ...(p.year ? [sql`a.leave_year = ${p.year}`] : []),
    ...(q ? [sql`a.ref_no ilike ${q}`] : []),
    ...(p.leaveTypeIds?.length ? [sql`a.leave_type_id = any(${p.leaveTypeIds}::uuid[])`] : []),
    ...(p.statuses?.length ? [sql`a.status::text = any(${p.statuses}::text[])`] : []),
    ...(p.from ? [sql`a.end_date >= ${p.from}::date`] : []),
    ...(p.to ? [sql`a.start_date <= ${p.to}::date`] : []),
  ]);
  const sort: Record<string, string> = { from: 'a.start_date', submitted: 'a.submitted_at', status: 'a.status', type: 't.name' };
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const from = sql`app.leave_applications a join app.leave_types t on t.id = a.leave_type_id`;
  const rows = await sql<R>`select ${APP_SELECT}, app.user_name(a.on_behalf_by) as on_behalf_name, app.user_name(a.decided_by) as decided_name
      from ${from} where ${where} order by ${sql.raw(sort[p.sort] ?? 'a.start_date')} ${dirOf(p.dir)}, a.ref_no limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return { rows: rows.rows.map((r) => myRowOf(r, today, new Map())), total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}
export async function listMyLeave(params: MyLeaveParams): Promise<Paged<MyLeaveRow>> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, (tx) => myLeaveRows(tx, params, false));
}

export async function applicationRows(tx: Tx, params: LeaveApplicationListParams, all: boolean): Promise<Paged<LeaveApplicationRow>> {
  const p = parseParams(leaveApplicationListParamsSchema, params);
  const isAdmin = await dbIsAdmin(tx);
  const pol = await policyOf(tx);
  const q = likeTerm(p.q);
  const statuses = p.statuses?.length ? p.statuses : DEFAULT_ADMIN_LEAVE_STATUSES;
  const includeSeparated = p.includeSeparated ?? pol.includeSeparatedInReports;
  const mc = p.mcFilters ?? [];
  const where = and([
    sql`a.status::text = any(${statuses}::text[])`,
    ...(isAdmin ? [] : [sql`a.employee_id is distinct from app.current_employee_id()`]),
    ...(q ? [sql`(a.ref_no ilike ${q} or e.employee_no ilike ${q} or e.full_name ilike ${q} or e.preferred_name ilike ${q})`] : []),
    ...(p.employeeId ? [sql`a.employee_id = ${p.employeeId}::uuid`] : []),
    ...(p.locationIds?.length ? [sql`e.work_location_id = any(${p.locationIds}::uuid[])`] : []),
    ...(p.departmentIds?.length ? [sql`e.department_id = any(${p.departmentIds}::uuid[])`] : []),
    ...(p.from ? [sql`a.end_date >= ${p.from}::date`] : []),
    ...(p.to ? [sql`a.start_date <= ${p.to}::date`] : []),
    ...(p.leaveTypeIds?.length ? [sql`a.leave_type_id = any(${p.leaveTypeIds}::uuid[])`] : []),
    ...(p.emergencyOnly ? [sql`a.is_emergency`] : []),
    ...(p.onBehalfOnly ? [sql`a.on_behalf_by is not null`] : []),
    ...(p.appliedFrom ? [sql`a.submitted_at >= ${p.appliedFrom}::date::timestamp at time zone 'Asia/Kuala_Lumpur'`] : []),
    ...(p.appliedTo ? [sql`a.submitted_at < (${p.appliedTo}::date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur'`] : []),
    ...(p.level ? [sql`a.status = 'pending' and a.current_level = ${p.level}`] : []),
    ...(mc.length && isAdmin ? [sql`(a.mc_status::text = any(${mc}::text[]) ${mc.includes('attachment_pending') ? sql`or a.attachment_pending` : sql``})`] : []),
    ...(includeSeparated ? [] : [sql`e.status not in ('separated','withdrawn')`]),
  ]);
  const sort: Record<string, string> = { applied: 'a.submitted_at', from: 'a.start_date', employee: 'e.full_name', type: 't.name', status: 'a.status' };
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const from = sql`app.leave_applications a join app.leave_types t on t.id = a.leave_type_id join app.employees e on e.id = a.employee_id
                   join app.departments d on d.id = e.department_id join app.work_locations l on l.id = e.work_location_id`;
  const rows = await sql<R>`select ${APP_SELECT}, e.employee_no, e.full_name, e.preferred_name, e.department_id, d.name as dept, e.work_location_id, l.name as loc,
        (select count(*)::int from app.leave_application_files f where f.application_id = coalesce(a.split_group_id, a.id)) as files,
        ot.id as task_id, ot.version as task_version, ot.assignee_user_id, ot.source::text as task_source,
        coalesce(app.can_act_on_task(ot.id), false) as can_act
      from ${from}
      left join lateral (select x.* from app.approval_tasks x where x.leave_application_id = coalesce(a.split_group_id, a.id) and x.status = 'open'
                          and x.subject_type in ('leave_application','leave_cancellation') order by x.created_at desc limit 1) ot on true
     where ${where} order by ${sql.raw(sort[p.sort] ?? 'a.submitted_at')} ${dirOf(p.dir)}, a.ref_no limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const out: LeaveApplicationRow[] = [];
  for (const r of rows.rows) {
    const approverName = r.task_id ? (r.assignee_user_id ? (await sql<{ n: string }>`select app.user_name(${r.assignee_user_id}::uuid) as n`.execute(tx)).rows[0]?.n ?? null
      : r.task_source === 'super_admin_pool' ? 'Super Admin' : 'Any Admin')
      : r.decided_by ? (await sql<{ n: string }>`select app.user_name(${r.decided_by}::uuid) as n`.execute(tx)).rows[0]?.n ?? null : null;
    out.push({
      id: r.id, refNo: r.ref_no, employee: personRef(r.employee_id, r.employee_no, r.full_name, r.preferred_name),
      department: { id: r.department_id, label: r.dept }, location: { id: r.work_location_id, label: r.loc },
      startDate: r.start_date, startSession: r.start_session, endDate: r.end_date, endSession: r.end_session, days: d1(r.days), reason: r.reason,
      attachmentCount: r.files, leaveType: typeRef(r), appliedAt: iso(r.submitted_at)!, status: r.status, level: r.current_level, levels: r.total_levels,
      approverName, approverAt: r.task_id ? null : iso(r.decided_at), isEmergency: r.is_emergency, onBehalf: !!r.on_behalf_by,
      mcStatus: isAdmin ? r.mc_status : null, attachmentPending: r.attachment_pending,
      myTaskId: r.can_act ? r.task_id : null, myTaskVersion: r.can_act ? r.task_version : null,
    });
  }
  return { rows: out, total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}
export async function listLeaveApplications(params: LeaveApplicationListParams): Promise<Paged<LeaveApplicationRow>> {
  const { ctx } = await authorize(TEAM);
  return withUserTx(ctx, (tx) => applicationRows(tx, params, false));
}

// ===========================================================================
// P4 / P27 Application detail
// ===========================================================================
export async function applicationDetail(tx: Tx, refNo: string): Promise<LeaveApplicationDetail | null> {
  const a = (await sql<R>`select ${APP_SELECT}, a.expected_confinement_date, a.child_birth_date, a.contact_phone, a.cover_employee_id, a.on_behalf_reason,
      a.mc_checked_by, a.mc_checked_at, a.cancellation_requested_at, a.cancelled_at, a.cancel_reason, a.cancellation_reason, a.attachment_due_at, a.split_part,
      a.created_at, a.created_by, a.updated_at, a.updated_by, t.count_basis::text as count_basis,
      e.employee_no, e.full_name, e.preferred_name, e.manager_employee_id, e.department_id, d.name as dept, p.title as position
      from app.leave_applications a join app.leave_types t on t.id = a.leave_type_id join app.employees e on e.id = a.employee_id
      join app.departments d on d.id = e.department_id join app.positions p on p.id = e.position_id where a.ref_no = ${refNo}`.execute(tx)).rows[0];
  if (!a) return null;
  const me = await myEmployeeId(tx);
  const isAdmin = await dbIsAdmin(tx);
  const isOwn = me === a.employee_id;
  const today = await todayMyt(tx);
  const groupId = a.split_group_id ?? a.id;
  const days = await sql<R>`select leave_date, session::text as session, weight, day_kind, day_label from app.leave_application_days where application_id = ${a.id}::uuid order by leave_date`.execute(tx);
  const breakdown: DayBreakdown[] = days.rows.map((x) => ({ date: x.leave_date, session: x.session, weight: Number(x.weight).toFixed(1), kind: x.day_kind, label: x.day_label }));
  const trail = await trailRows(tx, { leave: groupId });
  const openApp = trail.find((t) => t.status === 'open' && t.subjectType === 'leave_application');
  const openCxl = trail.find((t) => t.status === 'open' && t.subjectType === 'leave_cancellation');
  const task = await actionability(tx, openApp?.taskId ?? null, a.employee_id);
  const cancellationTask = await actionability(tx, openCxl?.taskId ?? null, a.employee_id);
  const canApprove = !!(task?.canDecide || cancellationTask?.canDecide);
  // attachments: own / HR always; an approver only while they can decide (Q18)
  const files = await sql<R>`select f.id, f.original_name, f.mime_type, f.size_bytes, app.can_read_file(f.id) as readable
      from app.leave_application_files lf join app.files f on f.id = lf.file_id where lf.application_id = ${groupId}::uuid order by lf.added_at`.execute(tx);
  const visibleFiles = files.rows.filter((f) => f.readable);
  const attachments: FileRef[] | null = isOwn || isAdmin || visibleFiles.length ? visibleFiles.map((f) => ({ fileId: f.id, fileName: f.original_name, mimeType: f.mime_type, sizeBytes: f.size_bytes })) : null;
  const linked = a.split_group_id ? (await sql<R>`select id, ref_no, split_part from app.leave_applications where split_group_id = ${a.split_group_id}::uuid and id <> ${a.id}::uuid`.execute(tx)).rows[0] : null;
  const bal = (await sql<{ b: R }>`select app.leave_balance_view(${a.employee_id}::uuid, ${a.type_id}::uuid, ${a.leave_year}, ${a.end_date}::date) as b`.execute(tx)).rows[0]!.b;
  const thisDays = Number(a.days);
  const counted = ['approved', 'cancellation_pending'].includes(a.status);
  const base = Number(bal.available) + Number(bal.pending) + (counted ? thisDays : 0);
  const otherPending = Number(bal.pending) - (a.status === 'pending' ? thisDays : 0);
  let teamOnLeave: LeaveApplicationDetail['teamOnLeave'] = null; let teamAbsenceWarning: string | null = null;
  if (!isOwn && (isAdmin || canApprove || (await sql<{ m: boolean }>`select app.is_manager_of(${a.employee_id}::uuid) as m`.execute(tx)).rows[0]?.m)) {
    const team = await sql<R>`select e.id, e.employee_no, e.full_name, e.preferred_name, x.status::text as status, array_agg(distinct d.leave_date order by d.leave_date)::text[] as dates
        from app.leave_application_days d join app.leave_applications x on x.id = d.application_id join app.employees e on e.id = d.employee_id
       where d.is_blocking and d.weight > 0 and d.leave_date between ${a.start_date}::date and ${a.end_date}::date and d.employee_id <> ${a.employee_id}::uuid
         and (e.manager_employee_id is not distinct from ${a.manager_employee_id}::uuid or e.department_id = ${a.department_id}::uuid)
       group by e.id, e.employee_no, e.full_name, e.preferred_name, x.status order by e.full_name limit 50`.execute(tx);
    teamOnLeave = team.rows.map((t) => ({ employee: personRef(t.id, t.employee_no, t.full_name, t.preferred_name), dates: t.dates, status: t.status as LeaveStatus,
      label: t.status === 'pending' ? 'Pending' : 'On leave' }));
    const pol = await policyOf(tx);
    const size = (await sql<{ n: number }>`select count(*)::int as n from app.employees e where (e.manager_employee_id is not distinct from ${a.manager_employee_id}::uuid
        or e.department_id = ${a.department_id}::uuid) and e.status in ('on_probation','confirmed','notice_period')`.execute(tx)).rows[0]?.n ?? 0;
    const away = new Set(team.rows.map((t) => t.id)).size + 1;
    if (pol.teamAbsenceThreshold > 0 && away >= pol.teamAbsenceThreshold) teamAbsenceWarning = `${away} of ${size} team members away on these dates.`;
  }
  let maternity: LeaveApplicationDetail['maternityAllowanceEligible'] = null;
  if (isAdmin && a.category === 'maternity') {
    const m = (await sql<{ m: boolean | null }>`select maternity_allowance_eligible as m from app.employee_hr_private where employee_id = ${a.employee_id}::uuid`.execute(tx)).rows[0];
    maternity = m?.m === true ? 'eligible' : m?.m === false ? 'not_eligible' : 'check';
  }
  const decidedOther = trail.filter((t) => t.status === 'approved' || t.status === 'rejected').pop();
  const events = await sql<R>`select occurred_at, event, from_status::text as fs, to_status::text as ts, actor_name, acting_as::text as acting, comment
      from app.leave_application_events where application_id = ${a.id}::uuid order by occurred_at, id`.execute(tx);
  const cover = a.cover_employee_id ? (await sql<R>`select id, employee_no, full_name, preferred_name from app.employee_names(${[a.cover_employee_id]}::uuid[])`.execute(tx)).rows[0] : null;
  const names = await resolveNames(tx, [a.created_by, a.updated_by]);
  const onBehalfName = a.on_behalf_by ? (await sql<{ n: string }>`select app.user_name(${a.on_behalf_by}::uuid) as n`.execute(tx)).rows[0]?.n ?? 'HR' : null;
  const mcBy = isAdmin && a.mc_checked_by ? (await sql<{ n: string }>`select app.user_name(${a.mc_checked_by}::uuid) as n`.execute(tx)).rows[0]?.n ?? null : null;
  const waiting = openApp ?? openCxl;
  const hasAttachmentRule = (await sql<{ r: string }>`select attachment_rule::text as r from app.leave_types where id = ${a.type_id}::uuid`.execute(tx)).rows[0]?.r !== 'not_required';
  return {
    id: a.id, refNo: a.ref_no, employee: { ...personRef(a.employee_id, a.employee_no, a.full_name, a.preferred_name), department: a.dept, position: a.position },
    leaveType: { ...typeRef(a), countBasis: a.count_basis }, leaveYear: a.leave_year, startDate: a.start_date, startSession: a.start_session,
    endDate: a.end_date, endSession: a.end_session, days: d1(a.days), breakdown, reason: a.reason, expectedConfinementDate: a.expected_confinement_date,
    childBirthDate: isOwn || isAdmin ? a.child_birth_date : null, contactPhone: a.contact_phone,
    cover: cover ? personRef(cover.id, cover.employee_no, cover.full_name, cover.preferred_name) : null, isEmergency: a.is_emergency,
    onBehalfByName: onBehalfName, onBehalfReason: isOwn || isAdmin ? a.on_behalf_reason : null,
    status: a.status, level: a.current_level, levels: a.total_levels, trail, waitingFor: waiting ? `Waiting for ${waiting.approverName}` : null,
    mcStatus: isAdmin ? a.mc_status : null, mcCheckedByName: mcBy, mcCheckedAt: isAdmin ? iso(a.mc_checked_at) : null,
    submittedAt: iso(a.submitted_at)!, decidedAt: iso(a.decided_at), cancellationRequestedAt: iso(a.cancellation_requested_at),
    cancelledAt: iso(a.cancelled_at), cancelReason: a.cancel_reason ?? a.cancellation_reason, attachmentPending: a.attachment_pending,
    attachmentDueAt: iso(a.attachment_due_at), attachments, attachmentsLogged: !isOwn,
    linked: linked ? { id: linked.id, refNo: linked.ref_no, part: linked.split_part } : null,
    balance: { available: base.toFixed(1), thisApplication: d1(thisDays), otherPending: d1(otherPending), afterApproval: (base - thisDays - otherPending).toFixed(1),
      earnedToDate: d1n(bal.earned_to_date) },
    teamOnLeave, teamAbsenceWarning, maternityAllowanceEligible: maternity, task, cancellationTask,
    alreadyDecided: !waiting && decidedOther && decidedOther.decidedByName ? { byName: decidedOther.decidedByName, at: decidedOther.decidedAt ?? '' } : null,
    isOwn,
    can: {
      withdraw: isOwn && a.status === 'pending',
      cancel: isOwn && a.status === 'approved' && a.self_cancel_future_approved && a.start_date > today,
      requestCancellation: isOwn && a.status === 'approved' && !(a.self_cancel_future_approved && a.start_date > today),
      withdrawOnBehalf: isAdmin && !isOwn && a.status === 'pending',
      cancelOnBehalf: isAdmin && !isOwn && ['approved', 'cancellation_pending'].includes(a.status),
      reassign: isAdmin && !!waiting,
      setMcStatus: isAdmin && !isOwn && hasAttachmentRule && ['pending', 'approved', 'cancellation_pending'].includes(a.status),
      addAttachment: isOwn && !['rejected', 'withdrawn', 'cancelled'].includes(a.status) && (files.rows.length < 3),
    },
    events: events.rows.map((x) => ({ at: iso(x.occurred_at)!, event: x.event, fromStatus: x.fs, toStatus: x.ts, actorName: x.actor_name, actingAs: x.acting, comment: x.comment })),
    ...stamps(a, names),
  };
}
export async function getLeaveApplication(refNo: string): Promise<LeaveApplicationDetail | null> {
  const { ctx } = await authorize(ANY);
  if (!/^LV-[0-9]{4}-[0-9]{5}(-[12])?$/.test(refNo)) return null;
  return withUserTx(ctx, async (tx) => {
    const d = await applicationDetail(tx, refNo);
    if (!d) await logDenied(tx, 'leave_application', refNo);
    return d;
  });
}

// ===========================================================================
// P5 balances / P6 ledger
// ===========================================================================
export async function balancesFor(tx: Tx, employeeId: string, year?: number, visibleOnly = true): Promise<MyBalances> {
  const today = await todayMyt(tx);
  const cur = Number(today.slice(0, 4));
  const y = year ?? cur;
  const years = (await sql<{ y: number }>`select distinct leave_year as y from app.leave_balance_summary where employee_id = ${employeeId}::uuid order by 1 desc`.execute(tx)).rows.map((r) => r.y);
  if (!years.includes(cur)) years.unshift(cur);
  return { year: y, years: [...new Set(years)].sort((a, b) => b - a), cards: await balanceCards(tx, employeeId, y, { visibleOnly }) };
}
export async function getMyBalances(year?: number): Promise<MyBalances | null> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, async (tx) => {
    const me = await myEmployeeId(tx);
    return me ? balancesFor(tx, me, year) : null;
  });
}

const TX_OF: Record<string, LedgerTransaction> = {
  entitlement: 'entitlement', carry_forward: 'carry_forward', credit_earned: 'credit_earned', taken: 'taken', taken_reversal: 'cancelled',
  adjustment: 'adjustment', expired: 'expired', forfeited: 'forfeited',
};
export async function ledgerPage(tx: Tx, params: LedgerParams, all: boolean): Promise<LedgerPage | null> {
  const p = parseParams(ledgerParamsSchema, params);
  const me = await myEmployeeId(tx);
  const emp = p.employeeId ?? me;
  if (!emp) return null;
  if (emp !== me && !(await dbIsAdmin(tx))) return null;                 // F-LV-28: never MGR
  const t = (await sql<R>`select t.*, t.category::text as category from app.leave_types t where t.id = ${p.leaveTypeId}::uuid`.execute(tx)).rows[0];
  const e = (await sql<R>`select id, employee_no, full_name, preferred_name from app.employee_names(${[emp]}::uuid[])`.execute(tx)).rows[0];
  if (!t || !e) return null;
  const rows = await sql<R>`select l.id::text as id, l.effective_date, l.entry_type::text as entry_type, l.is_opening, l.days, l.reason, l.expires_on, l.created_by,
        l.source_application_id, a.ref_no, l.source_credit_id, c.credit_no, l.source_rollover_id, l.created_at
      from app.leave_ledger l left join app.leave_applications a on a.id = l.source_application_id left join app.replacement_credits c on c.id = l.source_credit_id
     where l.employee_id = ${emp}::uuid and l.leave_type_id = ${p.leaveTypeId}::uuid and l.leave_year = ${p.year}
     order by l.effective_date, l.id`.execute(tx);
  const names = await resolveNames(tx, rows.rows.map((r) => r.created_by));
  for (const id of new Set(rows.rows.map((r) => r.created_by).filter((v) => v && !names.has(v)))) {
    names.set(id, (await sql<{ n: string }>`select app.user_name(${id}::uuid) as n`.execute(tx)).rows[0]?.n ?? 'User');
  }
  let running = 0;
  const allRows: LedgerRow[] = rows.rows.map((r) => {
    running += Number(r.days);
    const transaction: LedgerTransaction = r.is_opening ? 'opening' : TX_OF[r.entry_type] ?? 'adjustment';
    return {
      id: r.id, date: r.effective_date, transaction, entryType: r.entry_type, isOpening: r.is_opening,
      days: Number(r.days) > 0 ? `+${d1(r.days)}` : d1(r.days),
      reference: r.ref_no ? { kind: 'leave', label: r.ref_no, href: `/my/leave/${r.ref_no}` }
        : r.credit_no ? { kind: 'credit', label: r.credit_no, href: '/my/leave/credits' }
        : r.source_rollover_id ? { kind: 'rollover', label: `Roll-over ${p.year}`, href: null }
        : r.entry_type === 'adjustment' ? { kind: 'adjustment', label: 'Adjustment', href: null }
        : r.entry_type === 'entitlement' ? { kind: 'entitlement', label: `Entitlement ${p.year}`, href: null } : null,
      runningBalance: running.toFixed(1), byName: r.created_by ? names.get(r.created_by) ?? 'User' : 'System', reason: r.reason, expiresOn: r.expires_on,
    };
  });
  const q = (p.q ?? '').toLowerCase();
  let filtered = allRows.filter((r) => (!p.transactions?.length || p.transactions.includes(r.transaction))
    && (!p.from || r.date >= p.from) && (!p.to || r.date <= p.to) && (!q || (r.reference?.label ?? '').toLowerCase().includes(q)));
  if (p.dir === 'desc') filtered = filtered.reverse();
  const page = all ? filtered : filtered.slice((p.page - 1) * p.pageSize, p.page * p.pageSize);
  return { employee: personRef(e.id, e.employee_no, e.full_name, e.preferred_name), leaveType: typeRef(t), year: p.year, rows: page, total: filtered.length,
    page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize, closingBalance: running.toFixed(1) };
}
export async function getLedger(params: LedgerParams): Promise<LedgerPage | null> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, (tx) => ledgerPage(tx, params, false));
}

// ===========================================================================
// P1 Home
// ===========================================================================
export async function getHomeLeave(): Promise<HomeLeave> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, async (tx) => {
    const me = await myEmployeeId(tx);
    const today = await todayMyt(tx);
    const isAdmin = await dbIsAdmin(tx);
    const admin = isAdmin ? { probationDue: (await sql<{ n: number }>`select count(*)::int as n from app.employees e where e.status = 'on_probation'
        and coalesce(e.extended_probation_end_date, e.probation_end_date) between app.today_myt() and app.today_myt() + 30`.execute(tx)).rows[0]?.n ?? 0 } : null;
    if (!me) return { tiles: [], pendingItems: [], upcoming: [], manager: null, admin, holidays: [], holidaysNote: null, hasEmployeeRecord: false };
    const cards = await balanceCards(tx, me, Number(today.slice(0, 4)), { visibleOnly: true });
    const soon = (c: BalanceCard) => c.expiring.find((x) => x.date <= addDaysIso(today, 30)) ?? null;
    const pend = await sql<R>`select 'leave' as kind, a.id, a.ref_no as reference, t.name as label, a.status::text as status, a.current_level
        from app.leave_applications a join app.leave_types t on t.id = a.leave_type_id
       where a.employee_id = ${me}::uuid and a.status in ('pending','cancellation_pending') and (a.split_part is null or a.split_part = 1)
       union all
      select 'credit', c.id, c.credit_no, 'Replacement credit ' || to_char(c.date_worked, 'DD/MM/YYYY'), c.status::text, c.current_level
        from app.replacement_credits c where c.employee_id = ${me}::uuid and c.status = 'pending'
       order by 3 desc limit 5`.execute(tx);
    const up = await sql<R>`select ${APP_SELECT} from app.leave_applications a join app.leave_types t on t.id = a.leave_type_id
       where a.employee_id = ${me}::uuid and a.status = 'approved' and a.end_date >= ${today}::date order by a.start_date limit 3`.execute(tx);
    const isMgr = (await sql<{ m: boolean }>`select app.is_manager() as m`.execute(tx)).rows[0]?.m ?? false;
    let manager: HomeLeave['manager'] = null;
    if (isMgr) {
      const weekEnd = addDaysIso(today, 6 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
      const c = (await sql<R>`select
          (select count(*)::int from app.approval_tasks t where t.status = 'open' and app.can_act_on_task(t.id)
              and (t.assignee_user_id = app.current_app_user_id() or app.active_delegate(t.assignee_user_id, app.today_myt(), app.task_scope(t.subject_type)) = app.current_app_user_id())) as waiting,
          (select count(distinct d.employee_id)::int from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
            where app.is_manager_of(d.employee_id) and d.leave_date = ${today}::date and d.weight > 0 and a.status in ('approved','cancellation_pending')) as today,
          (select count(distinct d.employee_id)::int from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
            where app.is_manager_of(d.employee_id) and d.leave_date between ${today}::date and ${weekEnd}::date and d.weight > 0 and a.status in ('approved','cancellation_pending')) as week,
          (select count(*)::int from app.employees e where app.is_manager_of(e.id) and e.status = 'on_probation'
            and coalesce(e.extended_probation_end_date, e.probation_end_date) between app.today_myt() and app.today_myt() + 30) as probation`.execute(tx)).rows[0]!;
      manager = { approvalsWaiting: c.waiting, teamOnLeaveToday: c.today, teamOnLeaveThisWeek: c.week, probationDue: c.probation };
    }
    const st = (await sql<{ s: MyState }>`select coalesce(h.ph_state_override, e.work_state)::text as s from app.employees e
        left join app.employee_hr_private h on h.employee_id = e.id where e.id = ${me}::uuid`.execute(tx)).rows[0]!.s;
    const hol = await sql<R>`select h.holiday_date, h.name, h.is_half_day from app.public_holidays h join app.public_holiday_states s on s.holiday_id = h.id and s.state = ${st}::app.my_state
        where h.is_active and h.is_observed and h.holiday_date >= ${today}::date and app.holiday_year_published(h.year) order by h.holiday_date limit 3`.execute(tx);
    const published = (await sql<{ p: boolean }>`select app.holiday_year_published(${Number(today.slice(0, 4))}) as p`.execute(tx)).rows[0]?.p;
    return {
      tiles: cards.map((c) => ({ ...c, expiringSoon: soon(c) ? { days: soon(c)!.days, date: soon(c)!.date } : null })),
      pendingItems: pend.rows.map((r) => ({
        kind: r.kind, id: r.id, reference: r.reference, label: r.label,
        status: r.status === 'pending' && r.kind === 'leave' ? `Pending L${r.current_level}` : r.status === 'cancellation_pending' ? 'Cancellation pending' : 'Pending',
        tone: r.status === 'cancellation_pending' ? 'info' : 'warning', href: r.kind === 'leave' ? `/my/leave/${r.reference}` : '/my/leave/credits',
      })),
      upcoming: up.rows.map((r) => ({ id: r.id, refNo: r.ref_no, leaveType: typeRef(r), startDate: r.start_date, endDate: r.end_date, days: d1(r.days) })),
      manager, admin,
      holidays: hol.rows.map((h) => ({ date: h.holiday_date, name: h.name, half: h.is_half_day, state: st, stateLabel: MY_STATE_LABELS[st] })),
      holidaysNote: published ? null : `Holiday calendar for ${today.slice(0, 4)} not yet published`,
      hasEmployeeRecord: true,
    };
  });
}
function addDaysIso(d: string, n: number): string {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10);
}

// ===========================================================================
// P8/P9/L7/P28 Replacement credits
// ===========================================================================
export async function creditRows(tx: Tx, params: CreditListParams, all: boolean, scope: 'own' | 'team'): Promise<Paged<CreditRow>> {
  const p = parseParams(creditListParamsSchema, params);
  const me = await myEmployeeId(tx);
  if (scope === 'own' && !me) return { rows: [], total: 0, page: 1, pageSize: p.pageSize };
  const q = likeTerm(p.q);
  const where = and([
    ...(scope === 'own' ? [sql`c.employee_id = ${me}::uuid`] : []),
    ...(p.employeeId ? [sql`c.employee_id = ${p.employeeId}::uuid`] : []),
    ...(q ? [sql`(c.credit_no ilike ${q} or e.full_name ilike ${q} or e.employee_no ilike ${q})`] : []),
    ...(p.year ? [sql`extract(year from c.date_worked)::int = ${p.year}`] : []),
    ...(p.statuses?.length ? [sql`c.status::text = any(${p.statuses}::text[])`] : []),
    ...(p.from ? [sql`c.date_worked >= ${p.from}::date`] : []),
    ...(p.to ? [sql`c.date_worked <= ${p.to}::date`] : []),
    ...(p.departmentIds?.length ? [sql`e.department_id = any(${p.departmentIds}::uuid[])`] : []),
    ...(p.expiringWithin ? [sql`c.status = 'approved' and c.remaining_days > 0 and c.expiry_date <= app.today_myt() + ${p.expiringWithin}::int`] : []),
  ]);
  const sort: Record<string, string> = { dateWorked: 'c.date_worked', creditNo: 'c.credit_no', expiry: 'c.expiry_date', employee: 'e.full_name' };
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const from = sql`app.replacement_credits c join app.employees e on e.id = c.employee_id join app.departments d on d.id = e.department_id`;
  const rows = await sql<R>`select c.*, c.status::text as status, c.duration::text as duration, e.employee_no, e.full_name, e.preferred_name, d.name as dept,
        app.user_name(c.decided_by) as decided_name,
        (select coalesce(sum(x.days), 0) from app.replacement_credit_consumptions x where x.credit_id = c.id and x.reversed_at is null) as used,
        ot.id as task_id, ot.version as task_version, coalesce(app.can_act_on_task(ot.id), false) as can_act
      from ${from} left join lateral (select x.* from app.approval_tasks x where x.replacement_credit_id = c.id and x.status = 'open' limit 1) ot on true
     where ${where} order by ${sql.raw(sort[p.sort] ?? 'c.date_worked')} ${dirOf(p.dir)} nulls last, c.credit_no limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return { rows: rows.rows.map((c) => creditRowOf(c, me)), total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}
function creditRowOf(c: R, me: string | null): CreditRow {
  return {
    id: c.id, creditNo: c.credit_no, employee: personRef(c.employee_id, c.employee_no, c.full_name, c.preferred_name), department: c.dept,
    dateWorked: c.date_worked, dayTypeLabel: c.day_type_label, duration: c.duration, days: d1(c.credit_days), reason: c.reason, status: c.status,
    expiryDate: c.expiry_date, used: d1(c.used), remaining: d1(c.remaining_days), expired: d1(c.expired_days), compensateByPay: c.compensate_by_pay,
    compensateHours: d1n(c.compensate_hours), enteredByAdmin: !!c.entered_by_admin, submittedAt: iso(c.submitted_at)!, decidedByName: c.decided_name ?? null,
    decidedAt: iso(c.decided_at), can: { withdraw: c.status === 'pending' && c.employee_id === me },
    myTaskId: c.can_act ? c.task_id : null, myTaskVersion: c.can_act ? c.task_version : null,
  };
}
export async function listMyCredits(params: CreditListParams): Promise<Paged<CreditRow>> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, (tx) => creditRows(tx, params, false, 'own'));
}
export async function listCredits(params: CreditListParams): Promise<Paged<CreditRow>> {
  const { ctx } = await authorize(TEAM);
  return withUserTx(ctx, (tx) => creditRows(tx, params, false, 'team'));
}
export async function creditDetail(tx: Tx, creditNo: string): Promise<CreditDetail | null> {
  const c = (await sql<R>`select c.*, c.status::text as status, c.duration::text as duration, e.employee_no, e.full_name, e.preferred_name, d.name as dept,
        app.user_name(c.decided_by) as decided_name,
        (select coalesce(sum(x.days), 0) from app.replacement_credit_consumptions x where x.credit_id = c.id and x.reversed_at is null) as used
      from app.replacement_credits c join app.employees e on e.id = c.employee_id join app.departments d on d.id = e.department_id where c.credit_no = ${creditNo}`.execute(tx)).rows[0];
  if (!c) return null;
  const me = await myEmployeeId(tx);
  const isAdmin = await dbIsAdmin(tx);
  const trail = await trailRows(tx, { credit: c.id });
  const open = trail.find((t) => t.status === 'open');
  const task = await actionability(tx, open?.taskId ?? null, c.employee_id);
  const row = creditRowOf({ ...c, task_id: open?.taskId ?? null, task_version: task?.version ?? null, can_act: !!task?.canDecide }, me);
  const file = c.attachment_file_id ? (await sql<R>`select id, original_name, mime_type, size_bytes, app.can_read_file(id) as ok from app.files where id = ${c.attachment_file_id}::uuid`.execute(tx)).rows[0] : null;
  const cons = await sql<R>`select a.ref_no, a.id, x.days, a.start_date, x.reversed_at from app.replacement_credit_consumptions x join app.leave_applications a on a.id = x.application_id
      where x.credit_id = ${c.id}::uuid order by a.start_date`.execute(tx);
  const rl = (await sql<R>`select id from app.leave_types where category = 'replacement' and is_active order by display_order limit 1`.execute(tx)).rows[0];
  const today = await todayMyt(tx);
  const rlBal = rl ? (await sql<{ b: R }>`select app.leave_balance_view(${c.employee_id}::uuid, ${rl.id}::uuid, ${Number(today.slice(0, 4))}, ${today}::date) as b`.execute(tx)).rows[0]!.b : null;
  const validity = (await policyOf(tx)).replacementCreditValidityDays;
  const decided = trail.filter((t) => t.status === 'approved' || t.status === 'rejected').pop();
  return {
    ...row, attachment: file && file.ok ? { fileId: file.id, fileName: file.original_name, mimeType: file.mime_type, sizeBytes: file.size_bytes } : null,
    trail, consumptions: cons.rows.map((x) => ({ refNo: x.ref_no, applicationId: x.id, days: d1(x.days), date: x.start_date, reversed: !!x.reversed_at })),
    rlAvailable: rlBal ? d1(rlBal.available) : '0.0', expiryIfApproved: c.expiry_date ?? addDaysIso(c.date_worked, validity || 90),
    task, alreadyDecided: !open && decided?.decidedByName ? { byName: decided.decidedByName, at: decided.decidedAt ?? '' } : null,
    isOwn: me === c.employee_id, canSetCompensateByPay: isAdmin && me !== c.employee_id && c.status === 'pending',
  };
}
export async function getCredit(creditNo: string): Promise<CreditDetail | null> {
  const { ctx } = await authorize(ANY);
  if (!/^RL-[0-9]{4}-[0-9]{5}$/.test(creditNo)) return null;
  return withUserTx(ctx, async (tx) => {
    const d = await creditDetail(tx, creditNo);
    if (!d) await logDenied(tx, 'replacement_credit', creditNo);
    return d;
  });
}

// ===========================================================================
// P10 Leave calendar (LP12 / Q17 masking)
// ===========================================================================
export async function calendarFor(tx: Tx, params: CalendarParams): Promise<LeaveCalendar> {
  const p = parseParams(calendarParamsSchema, params);
  const me = await myEmployeeId(tx);
  const isAdmin = await dbIsAdmin(tx);
  const isMgr = (await sql<{ m: boolean }>`select app.is_manager() as m`.execute(tx)).rows[0]?.m ?? false;
  const scope: LeaveCalendar['scope'] = isAdmin ? 'all' : isMgr ? 'team' : 'peer';
  const to = p.to > addDaysIso(p.from, 62) ? addDaysIso(p.from, 62) : p.to;
  const q = likeTerm(p.q);
  const empWhere = and([
    ...(p.departmentIds?.length ? [sql`e.department_id = any(${p.departmentIds}::uuid[])`] : []),
    ...(p.locationIds?.length ? [sql`e.work_location_id = any(${p.locationIds}::uuid[])`] : []),
    ...(q ? [sql`(e.full_name ilike ${q} or e.preferred_name ilike ${q})`] : []),
  ]);
  // detailed rows (type) for HR / own team / own; peer-safe projection for everyone else
  const typed = await sql<R>`select d.employee_id, d.leave_date, d.session::text as session, a.status::text as status, a.ref_no, t.id as type_id, t.code, t.name as type_name,
        t.category::text as category, t.calendar_colour as colour, app.is_manager_of(d.employee_id) as mine
      from app.leave_application_days d join app.leave_applications a on a.id = d.application_id join app.leave_types t on t.id = a.leave_type_id
      join app.employees e on e.id = d.employee_id
     where d.is_blocking and d.weight > 0 and d.leave_date between ${p.from}::date and ${to}::date and ${empWhere}
       and (app.is_admin() or app.is_manager_of(d.employee_id) or d.employee_id = app.current_employee_id())
       and (a.status in ('approved','cancellation_pending') ${p.includePending && scope !== 'peer' ? sql`or a.status = 'pending'` : sql``})
       ${p.leaveTypeIds?.length && scope !== 'peer' ? sql`and t.id = any(${p.leaveTypeIds}::uuid[])` : sql``}`.execute(tx);
  const seen = new Set(typed.rows.map((r) => `${r.employee_id}|${r.leave_date}|${r.session}`));
  const peer = await sql<R>`select c.employee_id, c.leave_date, c.session::text as session from app.team_calendar_entries c join app.employees e on e.id = c.employee_id
      where c.leave_date between ${p.from}::date and ${to}::date and ${empWhere}`.execute(tx);
  const entries: CalendarEntry[] = typed.rows.map((r) => {
    const own = r.employee_id === me;
    const medical = !isAdmin && !own && MEDICAL_CATEGORIES.includes(r.category as LeaveCategory);
    return { employeeId: r.employee_id, date: r.leave_date, session: r.session, label: medical ? 'Medical' : r.type_name,
      leaveTypeId: medical ? null : r.type_id, colour: medical ? '#9E9E9E' : r.colour, status: r.status, refNo: isAdmin || r.mine || own ? r.ref_no : null };
  });
  for (const r of peer.rows) {
    if (seen.has(`${r.employee_id}|${r.leave_date}|${r.session}`)) continue;
    entries.push({ employeeId: r.employee_id, date: r.leave_date, session: r.session, label: r.session === 'full' ? 'On leave' : `On leave (${r.session.toUpperCase()})`,
      leaveTypeId: null, colour: null, status: 'approved', refNo: null });
  }
  const ids = [...new Set(entries.map((e) => e.employeeId))];
  const emps = await sql<R>`select n.employee_id, n.full_name, n.preferred_name, n.department_name from app.employee_directory n where n.employee_id = any(${ids}::uuid[])`.execute(tx);
  const holLoc = p.holidayLocationId ?? (me ? (await sql<{ l: string }>`select work_location_id as l from app.employees where id = ${me}::uuid`.execute(tx)).rows[0]?.l : undefined);
  const loc = holLoc ? (await sql<R>`select id, name, state::text as state from app.work_locations where id = ${holLoc}::uuid`.execute(tx)).rows[0] : null;
  const hol = loc ? await sql<R>`select h.holiday_date, h.name, h.holiday_type::text as type, h.is_half_day from app.public_holidays h
      join app.public_holiday_states s on s.holiday_id = h.id and s.state = ${loc.state}::app.my_state
     where h.is_active and h.holiday_date between ${p.from}::date and ${to}::date and app.holiday_year_published(h.year) order by h.holiday_date`.execute(tx) : { rows: [] as R[] };
  const legend = scope === 'peer' ? [] : (await leaveTypes(tx, true)).map((t) => ({ id: t.id, label: t.name, colour: t.calendar_colour }));
  return {
    from: p.from, to, scope, showTypes: scope !== 'peer', legend, entries,
    employees: emps.rows.map((e) => ({ employeeId: e.employee_id, name: e.preferred_name ? `${e.full_name} (${e.preferred_name})` : e.full_name, department: e.department_name, isSelf: e.employee_id === me }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    holidays: hol.rows.map((h) => ({ date: h.holiday_date, name: h.name, type: h.type, half: h.is_half_day, state: loc!.state })),
    holidayLocation: loc ? { id: loc.id, label: loc.name } : null,
  };
}
export async function getLeaveCalendar(params: CalendarParams): Promise<LeaveCalendar> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, (tx) => calendarFor(tx, params));
}

// ===========================================================================
// L3 Balances list (ADM/SA all; MGR team)
// ===========================================================================
export async function balanceListFor(tx: Tx, params: BalanceListParams, all: boolean): Promise<BalanceList> {
  const p = parseParams(balanceListParamsSchema, params);
  const asAt = p.asAt ?? (await todayMyt(tx));
  const year = Number(asAt.slice(0, 4));
  const isAdmin = await dbIsAdmin(tx);
  let types = await leaveTypes(tx, true);
  types = p.leaveTypeIds?.length ? types.filter((t) => p.leaveTypeIds!.includes(t.id)) : types.filter((t) => ['AL', 'SL', 'RL'].includes(t.code));
  const q = likeTerm(p.q);
  const where = and([
    ...(isAdmin ? [] : [sql`app.is_manager_of(e.id)`]),
    ...(q ? [sql`(e.full_name ilike ${q} or e.preferred_name ilike ${q} or e.employee_no ilike ${q})`] : []),
    ...(p.departmentIds?.length ? [sql`e.department_id = any(${p.departmentIds}::uuid[])`] : []),
    ...(p.locationIds?.length ? [sql`e.work_location_id = any(${p.locationIds}::uuid[])`] : []),
    p.employmentStatus === 'active' ? sql`e.status in ('on_probation','confirmed','notice_period')`
      : p.employmentStatus === 'separated' ? sql`e.status = 'separated'` : sql`e.status <> 'withdrawn'`,
  ]);
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const from = sql`app.employees e join app.departments d on d.id = e.department_id join app.work_locations l on l.id = e.work_location_id
                   left join app.employee_personal pp on pp.employee_id = e.id`;
  const order = p.sort === 'employee' ? sql`e.full_name` : sql`d.name, e.full_name`;
  const rows = await sql<R>`select e.id, e.employee_no, e.full_name, e.preferred_name, e.department_id, d.name as dept, e.work_location_id, l.name as loc,
        app.completed_months(coalesce(pp.continuous_service_date, e.join_date), ${asAt}::date) as months
      from ${from} where ${where} order by ${order} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const groups = (await sql<R>`select e.department_id, d.name, count(*)::int as n from ${from} where ${where} group by e.department_id, d.name order by d.name`.execute(tx)).rows;
  const out: BalanceListRow[] = [];
  for (const r of rows.rows) {
    const cells: BalanceListRow['cells'] = {};
    for (const t of types) {
      const b = (await sql<{ b: R }>`select app.leave_balance_view(${r.id}::uuid, ${t.id}::uuid, ${year}, ${asAt}::date) as b`.execute(tx)).rows[0]!.b;
      cells[t.id] = { entitled: d1(b.entitled), taken: d1(b.taken), pending: d1(b.pending), available: d1(b.available) };
    }
    out.push({ employee: personRef(r.id, r.employee_no, r.full_name, r.preferred_name), department: { id: r.department_id, label: r.dept },
      location: { id: r.work_location_id, label: r.loc }, monthsOfService: r.months, cells });
  }
  return { asAt, year, types: types.map((t) => typeRef(t)), rows: out, total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
    groups: groups.map((g) => ({ department: { id: g.department_id, label: g.name } as Ref, headcount: g.n })) };
}
export async function listBalances(params: BalanceListParams): Promise<BalanceList> {
  const { ctx } = await authorize(TEAM);
  return withUserTx(ctx, (tx) => balanceListFor(tx, params, false));
}

// ===========================================================================
// L4 Adjustments / L6 Overrides
// ===========================================================================
export async function adjustmentRows(tx: Tx, params: AdjustmentListParams, all: boolean): Promise<Paged<AdjustmentRow>> {
  const p = parseParams(adjustmentListParamsSchema, params);
  const q = likeTerm(p.q); const rc = likeTerm(p.reasonContains);
  const where = and([
    sql`l.entry_type = 'adjustment'`,
    ...(q ? [sql`(e.full_name ilike ${q} or e.employee_no ilike ${q})`] : []),
    ...(p.employeeId ? [sql`l.employee_id = ${p.employeeId}::uuid`] : []),
    ...(p.leaveTypeIds?.length ? [sql`l.leave_type_id = any(${p.leaveTypeIds}::uuid[])`] : []),
    ...(p.year ? [sql`l.leave_year = ${p.year}`] : []),
    ...(p.from ? [sql`l.effective_date >= ${p.from}::date`] : []),
    ...(p.to ? [sql`l.effective_date <= ${p.to}::date`] : []),
    ...(rc ? [sql`l.reason ilike ${rc}`] : []),
  ]);
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const from = sql`app.leave_ledger l join app.employees e on e.id = l.employee_id join app.leave_types t on t.id = l.leave_type_id left join app.files f on f.id = l.attachment_file_id`;
  const rows = await sql<R>`select l.id::text as id, l.effective_date, l.leave_year, l.days, l.reason, l.is_opening, l.created_at, l.created_by, app.user_name(l.created_by) as by,
        e.id as employee_id, e.employee_no, e.full_name, e.preferred_name, t.id as type_id, t.code, t.name as type_name, t.category::text as category, t.calendar_colour as colour,
        f.id as file_id, f.original_name, f.mime_type, f.size_bytes
      from ${from} where ${where} order by ${p.sort === 'employee' ? sql`e.full_name` : sql`l.created_at`} ${dirOf(p.dir)} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return {
    rows: rows.rows.map((r) => ({ id: r.id, date: r.effective_date, employee: personRef(r.employee_id, r.employee_no, r.full_name, r.preferred_name), leaveType: typeRef(r),
      year: r.leave_year, days: Number(r.days) > 0 ? `+${d1(r.days)}` : d1(r.days), reason: r.reason ?? '',
      attachment: r.file_id ? { fileId: r.file_id, fileName: r.original_name, mimeType: r.mime_type, sizeBytes: r.size_bytes } : null,
      byName: r.by ?? 'System', createdAt: iso(r.created_at)!, isOpening: r.is_opening })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listAdjustments(params: AdjustmentListParams): Promise<Paged<AdjustmentRow>> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => adjustmentRows(tx, params, false));
}
export async function overrideRows(tx: Tx, params: OverrideListParams, all: boolean, employeeId?: string): Promise<Paged<OverrideRow>> {
  const p = parseParams(overrideListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    sql`o.is_active`,
    ...(q ? [sql`(e.full_name ilike ${q} or e.employee_no ilike ${q})`] : []),
    ...(employeeId ?? p.employeeId ? [sql`o.employee_id = ${employeeId ?? p.employeeId}::uuid`] : []),
    ...(p.leaveTypeIds?.length ? [sql`o.leave_type_id = any(${p.leaveTypeIds}::uuid[])`] : []),
    ...(p.year ? [sql`o.leave_year = ${p.year}`] : []),
  ]);
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const from = sql`app.leave_entitlement_overrides o join app.employees e on e.id = o.employee_id join app.leave_types t on t.id = o.leave_type_id`;
  const rows = await sql<R>`select o.*, app.user_name(o.created_by) as by, e.employee_no, e.full_name, e.preferred_name, t.id as type_id, t.code, t.name as type_name,
        t.category::text as category, t.calendar_colour as colour,
        (select b.days_per_year from app.leave_entitlement_bands b
          where b.leave_type_id = o.leave_type_id and b.grade_id is null
            and b.effective_year = (select max(x.effective_year) from app.leave_entitlement_bands x where x.leave_type_id = o.leave_type_id and x.effective_year <= o.leave_year)
            and app.service_years(coalesce(pp.continuous_service_date, e.join_date), make_date(o.leave_year, 12, 31)) >= b.service_from_years
            and (b.service_to_years is null or app.service_years(coalesce(pp.continuous_service_date, e.join_date), make_date(o.leave_year, 12, 31)) < b.service_to_years)
          limit 1) as band
      from ${from} left join app.employee_personal pp on pp.employee_id = e.id
     where ${where} order by ${p.sort === 'year' ? sql`o.leave_year desc, e.full_name` : sql`e.full_name, o.leave_year desc`} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return {
    rows: rows.rows.map((o) => ({ id: o.id, employee: personRef(o.employee_id, o.employee_no, o.full_name, o.preferred_name), leaveType: typeRef(o), year: o.leave_year,
      days: d1(o.days), bandValue: d1n(o.band), reason: o.reason, enteredByName: o.by ?? '', enteredAt: iso(o.created_at)!, isActive: o.is_active })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listOverrides(params: OverrideListParams): Promise<Paged<OverrideRow>> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => overrideRows(tx, params, false));
}

// ===========================================================================
// L13 Year-end
// ===========================================================================
export async function getYearEnd(closingYear: number): Promise<YearEndStatus> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, async (tx) => {
    const y = Number.isInteger(closingYear) && closingYear >= 2000 && closingYear <= 2100 ? closingYear : Number((await todayMyt(tx)).slice(0, 4));
    const today = await todayMyt(tx);
    const blockers = (await sql<{ b: string[] }>`select app.rollover_blockers(${y}) as b`.execute(tx)).rows[0]?.b ?? [];
    const pending = (await sql<{ n: number }>`select count(*)::int as n from app.leave_applications where leave_year = ${y} and status = 'pending'`.execute(tx)).rows[0]?.n ?? 0;
    const hist = await sql<R>`select r.id, r.closing_year, r.committed_at, app.user_name(r.committed_by) as by, r.summary from app.rollover_runs r
        where r.status = 'committed' order by r.closing_year desc`.execute(tx);
    const done = hist.rows.find((h) => h.closing_year === y);
    const from = `${y}-12-01`; const to = `${y + 1}-01-31`;
    return {
      closingYear: y, window: { from, to, open: today >= from && today <= to }, blockers, pendingInClosingYear: pending,
      alreadyRun: done ? { at: iso(done.committed_at)!, byName: done.by ?? '' } : null,
      history: hist.rows.map((h) => ({ runId: h.id, closingYear: h.closing_year, runAt: iso(h.committed_at)!, byName: h.by ?? '',
        employees: Number(h.summary?.employees ?? 0), carried: d1(h.summary?.carried), forfeited: d1(h.summary?.forfeited) })),
      canRun: blockers.length === 0 && !done,
    };
  });
}

// ===========================================================================
// E3 Leave tab / P32 / P31 / E7
// ===========================================================================
export async function employeeLeaveTab(tx: Tx, employeeId: string, year?: number): Promise<EmployeeLeaveTab | null> {
  if (!(await dbIsAdmin(tx))) return null;
  const e = (await sql<R>`select id, employee_no, full_name, preferred_name, status::text as status from app.employees where id = ${employeeId}::uuid`.execute(tx)).rows[0];
  if (!e) return null;
  const me = await myEmployeeId(tx);
  const own = me === employeeId;
  const bal = await balancesFor(tx, employeeId, year, false);
  const apps = await myLeaveRows(tx, { year: bal.year, pageSize: 100 }, false, employeeId);
  const credits = await creditRows(tx, { employeeId, pageSize: 100 }, false, 'team');
  const overrides = await overrideRows(tx, {}, true, employeeId);
  let leaver: LeaverPosition | null = null;
  const lwd = (await sql<{ d: string | null }>`select last_working_day::text as d from app.employee_separations
      where employee_id = ${employeeId}::uuid and not is_withdrawn and not superseded_by_rehire`.execute(tx)).rows[0]?.d ?? null;
  if (lwd) leaver = await leaverPositionFor(tx, employeeId, lwd);
  return { employee: personRef(e.id, e.employee_no, e.full_name, e.preferred_name), year: bal.year, years: bal.years, balances: bal.cards,
    applications: apps.rows, credits: credits.rows, overrides: overrides.rows, leaver,
    can: { applyOnBehalf: !own && e.status !== 'withdrawn', adjust: !own, addOverride: !own, viewLedger: true } };
}
export async function getEmployeeLeave(employeeId: string, year?: number): Promise<EmployeeLeaveTab | null> {
  const { ctx } = await authorize(ADMIN);
  if (!UUID_RE.test(employeeId)) return null;
  return withUserTx(ctx, (tx) => employeeLeaveTab(tx, employeeId, year));
}
export async function teamMemberLeave(tx: Tx, employeeId: string, year?: number): Promise<TeamMemberLeave | null> {
  const ok = (await sql<{ m: boolean }>`select app.is_manager_of(${employeeId}::uuid) as m`.execute(tx)).rows[0]?.m;
  if (!ok) return null;
  const bal = await balancesFor(tx, employeeId, year, false);
  const apps = await myLeaveRows(tx, { year: bal.year, pageSize: 50 }, false, employeeId);
  return { year: bal.year, balances: bal.cards, applications: apps.rows.map((r) => ({ ...r, can: { withdraw: false, cancel: false, requestCancellation: false } })) };
}
export async function getTeamMemberLeave(employeeId: string, year?: number): Promise<TeamMemberLeave | null> {
  const { ctx } = await authorize(TEAM);
  if (!UUID_RE.test(employeeId)) return null;
  return withUserTx(ctx, (tx) => teamMemberLeave(tx, employeeId, year));
}
export async function teamLeaveSummariesTx(tx: Tx, employeeIds: string[]): Promise<Map<string, TeamLeaveSummary>> {
  const out = new Map<string, TeamLeaveSummary>();
  if (!employeeIds.length) return out;
  const today = await todayMyt(tx);
  const year = Number(today.slice(0, 4));
  const weekEnd = addDaysIso(today, 6 - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const days = await sql<R>`select d.employee_id, d.leave_date, d.session::text as session from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
      where d.employee_id = any(${employeeIds}::uuid[]) and d.leave_date between ${today}::date and ${weekEnd}::date and d.weight > 0
        and a.status in ('approved','cancellation_pending') order by d.leave_date`.execute(tx);
  const sums = await sql<R>`select s.employee_id, t.code, s.available from app.leave_balance_summary s join app.leave_types t on t.id = s.leave_type_id
      where s.employee_id = any(${employeeIds}::uuid[]) and s.leave_year = ${year} and t.code in ('AL','SL','RL')`.execute(tx);
  const pend = await sql<R>`select employee_id, count(*)::int as n from app.leave_applications where employee_id = any(${employeeIds}::uuid[]) and status in ('pending','cancellation_pending')
      group by employee_id`.execute(tx);
  for (const id of employeeIds) {
    const mine = days.rows.filter((d) => d.employee_id === id);
    const s = (code: string) => d1n(sums.rows.find((x) => x.employee_id === id && x.code === code)?.available);
    const t = mine.find((d) => d.leave_date === today);
    out.set(id, { today: t ? t.session : null, thisWeek: mine.map((d) => ({ date: d.leave_date, session: d.session })),
      alAvailable: s('AL'), slAvailable: s('SL'), rlAvailable: s('RL'), pendingItems: pend.rows.find((x) => x.employee_id === id)?.n ?? 0 });
  }
  return out;
}
export async function teamLeaveSummaries(employeeIds: string[]): Promise<Map<string, TeamLeaveSummary>> {
  const { ctx } = await authorize(TEAM);
  return withUserTx(ctx, (tx) => teamLeaveSummariesTx(tx, employeeIds.filter((x) => UUID_RE.test(x))));
}
export async function leaverPositionFor(tx: Tx, employeeId: string, lwd: string): Promise<LeaverPosition | null> {
  if (!(await dbIsAdmin(tx))) return null;
  const j = (await sql<{ j: R }>`select app.leaver_position(${employeeId}::uuid, ${lwd}::date) as j`.execute(tx)).rows[0]?.j;
  if (!j) return null;
  return {
    lastWorkingDay: lwd,
    rows: (j.rows ?? []).map((r: R) => ({ leaveType: { id: r.leave_type_id, code: r.code, name: r.name, category: r.category, colour: r.colour },
      entitledToLwd: d1(r.entitled_to_lwd), taken: d1(r.taken), balance: d1(r.balance), encashable: d1(r.encashable), recoverable: d1(r.recoverable) })),
    leaveAfterLwd: (j.leave_after_lwd ?? []).map((a: R) => ({ refNo: a.ref_no, startDate: a.start_date, endDate: a.end_date, days: d1(a.days) })),
    summary: j.summary ?? '',
  };
}
export async function getLeaverPosition(employeeId: string, lastWorkingDay: string): Promise<LeaverPosition | null> {
  const { ctx } = await authorize(ADMIN);
  if (!UUID_RE.test(employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(lastWorkingDay)) return null;
  return withUserTx(ctx, (tx) => leaverPositionFor(tx, employeeId, lastWorkingDay));
}
