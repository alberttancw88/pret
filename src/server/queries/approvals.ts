import 'server-only';
import { sql, withUserTx, type Tx } from '../db';
import { authorize, iso, likeTerm } from '../lib/action-helpers';
import { parseParams, EXPORT_LIMIT } from './org';
import { d1, dbIsAdmin, personRef, todayMyt, typeRef, ADMIN, TEAM } from './leave';
import {
  delegationListParamsSchema, inboxParamsSchema,
  type ApproverOnLeaveRow, type ApproverOption, type DelegationListParams, type DelegationRow, type DelegationState, type InboxCounts,
  type InboxPage, type InboxParams, type Paged,
} from '../contracts/approvals';

// Approval engine queries (W2-004): P26 inbox, L14 / G6 delegations. RLS on approval_tasks (rls §5.5) decides what is
// visible; app.can_act_on_task / app.task_acting_as decide what is actionable (never the subject employee).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
type Where = ReturnType<typeof sql>;
const and = (c: Where[]): Where => (c.length ? sql.join(c, sql` and `) : sql`true`);
const OWN_ACTING = ['assignee', 'rerouted', 'delegate', 'pool_member'];

/** Mon–Fri days elapsed after `from` up to `to` (inbox "Waiting"; holidays ignored in this column). */
export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  const d = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d <= end) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) n += 1; d.setUTCDate(d.getUTCDate() + 1); }
  return n;
}
const mytDate = (v: Date | string) => new Date(new Date(v).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// P26 counts + rows
// ---------------------------------------------------------------------------
export async function inboxCounts(tx: Tx): Promise<InboxCounts> {
  const r = (await sql<R>`select
      count(*) filter (where t.subject_type = 'leave_application')::int as leave,
      count(*) filter (where t.subject_type = 'leave_cancellation')::int as cancellations,
      count(*) filter (where t.subject_type = 'replacement_credit')::int as credits
      from app.approval_tasks t where t.status = 'open' and app.task_acting_as(t.id)::text = any(${OWN_ACTING}::text[])`.execute(tx)).rows[0]!;
  return { leave: r.leave, cancellations: r.cancellations, credits: r.credits, claims: 0, claims_approved: 0, batches: 0 };
}
export async function getInboxCounts(): Promise<InboxCounts> {
  const { ctx } = await authorize(TEAM);
  return withUserTx(ctx, inboxCounts);
}

export async function inboxPage(tx: Tx, params: InboxParams, all: boolean): Promise<InboxPage> {
  const p = parseParams(inboxParamsSchema, params);
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  if (p.tab === 'claims' || p.tab === 'claims_approved' || p.tab === 'batches') {
    return { tab: p.tab, rows: [], total: 0, page: 1, pageSize: p.pageSize, placeholder: 'Claims approvals are available after W2-005 (claims management).' };
  }
  const today = await todayMyt(tx);
  const isAdmin = await dbIsAdmin(tx);
  const subject = p.tab === 'leave' ? 'leave_application' : p.tab === 'cancellations' ? 'leave_cancellation' : 'replacement_credit';
  const q = likeTerm(p.q);
  const mine = p.onlyMine || !isAdmin;
  const common: Where[] = [
    sql`t.status = 'open'`, sql`t.subject_type = ${subject}::app.task_subject`,
    ...(mine ? [sql`app.task_acting_as(t.id)::text = any(${OWN_ACTING}::text[])`] : []),
    ...(p.departmentIds?.length ? [sql`e.department_id = any(${p.departmentIds}::uuid[])`] : []),
    ...(p.locationIds?.length ? [sql`e.work_location_id = any(${p.locationIds}::uuid[])`] : []),
  ];
  if (subject === 'replacement_credit') {
    const where = and([...common,
      ...(q ? [sql`(c.credit_no ilike ${q} or e.full_name ilike ${q} or e.employee_no ilike ${q})`] : []),
      ...(p.from ? [sql`c.date_worked >= ${p.from}::date`] : []), ...(p.to ? [sql`c.date_worked <= ${p.to}::date`] : [])]);
    const from = sql`app.approval_tasks t join app.replacement_credits c on c.id = t.replacement_credit_id join app.employees e on e.id = c.employee_id
                     join app.departments d on d.id = e.department_id`;
    const rows = await sql<R>`select c.*, t.id as task_id, t.version as task_version, t.created_at as task_at, c.duration::text as duration, e.employee_no, e.full_name, e.preferred_name,
          d.name as dept, app.can_act_on_task(t.id) as can, app.task_acting_as(t.id)::text as acting
        from ${from} where ${where} order by c.submitted_at ${p.dir === 'desc' ? sql.raw('desc') : sql.raw('asc')} limit ${limit} offset ${offset}`.execute(tx);
    const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
    return { tab: 'credits', total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
      rows: rows.rows.map((r) => ({ taskId: r.task_id, taskVersion: r.task_version, creditId: r.id, creditNo: r.credit_no,
        employee: personRef(r.employee_id, r.employee_no, r.full_name, r.preferred_name), department: r.dept, dateWorked: r.date_worked,
        dayTypeLabel: r.day_type_label, duration: r.duration, days: d1(r.credit_days), reason: r.reason, submittedAt: iso(r.submitted_at)!,
        waitingWorkingDays: weekdaysBetween(mytDate(r.task_at), today), canDecide: r.can, overrideOnly: r.acting === 'admin_override' })) };
  }
  const where = and([...common,
    ...(q ? [sql`(a.ref_no ilike ${q} or e.full_name ilike ${q} or e.employee_no ilike ${q})`] : []),
    ...(p.leaveTypeIds?.length ? [sql`a.leave_type_id = any(${p.leaveTypeIds}::uuid[])`] : []),
    ...(p.from ? [sql`a.end_date >= ${p.from}::date`] : []), ...(p.to ? [sql`a.start_date <= ${p.to}::date`] : []),
    ...(p.emergencyOnly ? [sql`a.is_emergency`] : [])]);
  const from = sql`app.approval_tasks t join app.leave_applications a on a.id = t.leave_application_id join app.leave_types lt on lt.id = a.leave_type_id
                   join app.employees e on e.id = a.employee_id join app.departments d on d.id = e.department_id`;
  const sort: Record<string, string> = { applied: 'a.submitted_at', from: 'a.start_date', employee: 'e.full_name', waiting: 't.created_at' };
  const rows = await sql<R>`select t.id as task_id, t.version, t.created_at as task_at, t.level, a.id, a.ref_no, a.employee_id, a.start_date, a.start_session::text as start_session,
        coalesce((select max(x.end_date) from app.leave_applications x where x.split_group_id = a.split_group_id), a.end_date) as end_date, a.end_session::text as end_session,
        coalesce((select sum(x.days) from app.leave_applications x where x.split_group_id = a.split_group_id), a.days) as days,
        a.reason, a.is_emergency, a.submitted_at, a.total_levels, a.cancellation_requested_at, a.cancellation_reason,
        lt.id as type_id, lt.code, lt.name as type_name, lt.category::text as category, lt.calendar_colour as colour,
        e.employee_no, e.full_name, e.preferred_name, d.name as dept,
        (select count(*)::int from app.leave_application_files f where f.application_id = a.id) as files,
        app.can_act_on_task(t.id) as can, app.task_acting_as(t.id)::text as acting
      from ${from} where ${where} order by ${sql.raw(sort[p.sort] ?? 'a.submitted_at')} ${p.dir === 'desc' ? sql.raw('desc') : sql.raw('asc')} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const base = { total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
  if (subject === 'leave_cancellation') {
    return { tab: 'cancellations', ...base, rows: rows.rows.map((r) => ({ taskId: r.task_id, taskVersion: r.version, applicationId: r.id, refNo: r.ref_no,
      employee: personRef(r.employee_id, r.employee_no, r.full_name, r.preferred_name), department: r.dept, leaveType: typeRef(r), startDate: r.start_date,
      endDate: r.end_date, days: d1(r.days), requestedAt: iso(r.cancellation_requested_at ?? r.task_at)!, reason: r.cancellation_reason,
      waitingWorkingDays: weekdaysBetween(mytDate(r.task_at), today), canDecide: r.can, overrideOnly: r.acting === 'admin_override' })) };
  }
  return { tab: 'leave', ...base, rows: rows.rows.map((r) => ({ taskId: r.task_id, taskVersion: r.version, applicationId: r.id, refNo: r.ref_no,
    employee: personRef(r.employee_id, r.employee_no, r.full_name, r.preferred_name), department: r.dept, leaveType: typeRef(r), startDate: r.start_date,
    startSession: r.start_session, endDate: r.end_date, endSession: r.end_session, days: d1(r.days), reason: r.reason, attachmentCount: r.files,
    isEmergency: r.is_emergency, appliedAt: iso(r.submitted_at)!, level: r.level, levels: r.total_levels,
    waitingWorkingDays: weekdaysBetween(mytDate(r.task_at), today), canDecide: r.can, overrideOnly: r.acting === 'admin_override' })) };
}
export async function listInbox(params: InboxParams): Promise<InboxPage> {
  const { ctx } = await authorize(TEAM);
  return withUserTx(ctx, (tx) => inboxPage(tx, params, false));
}

// ---------------------------------------------------------------------------
// L14 / G6 delegations
// ---------------------------------------------------------------------------
export async function delegationRows(tx: Tx, params: DelegationListParams, all: boolean, ownOnly: boolean): Promise<Paged<DelegationRow>> {
  const p = parseParams(delegationListParamsSchema, params);
  const today = await todayMyt(tx);
  const isAdmin = await dbIsAdmin(tx);
  const q = likeTerm(p.q);
  const stateSql = sql`case when d.cancelled_at is not null or d.valid_to < ${today}::date then 'ended' when d.valid_from > ${today}::date then 'scheduled' else 'active' end`;
  const where = and([
    ...(ownOnly ? [sql`(d.delegator_user_id = app.current_app_user_id() or d.delegate_user_id = app.current_app_user_id())`] : []),
    ...(p.approverUserId ? [sql`d.delegator_user_id = ${p.approverUserId}::uuid`] : []),
    ...(p.delegateUserId ? [sql`d.delegate_user_id = ${p.delegateUserId}::uuid`] : []),
    ...(p.activeOn ? [sql`d.cancelled_at is null and ${p.activeOn}::date between d.valid_from and d.valid_to`] : []),
    ...(p.scopes?.length ? [sql`d.scope::text = any(${p.scopes}::text[])`] : []),
    ...(p.states?.length ? [sql`${stateSql} = any(${p.states}::text[])`] : []),
    ...(q ? [sql`(app.user_name(d.delegator_user_id) ilike ${q} or app.user_name(d.delegate_user_id) ilike ${q})`] : []),
  ]);
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const order = p.sort === 'approver' ? sql`app.user_name(d.delegator_user_id)` : p.sort === 'delegate' ? sql`app.user_name(d.delegate_user_id)` : sql`d.valid_from`;
  const rows = await sql<R>`select d.*, d.scope::text as scope, ${stateSql} as state, app.user_name(d.delegator_user_id) as approver, app.user_name(d.delegate_user_id) as delegate,
        app.user_name(d.set_by) as set_by_name, app.user_name(d.cancelled_by) as cancelled_by_name
      from app.delegations d where ${where} order by ${order} ${p.dir === 'desc' ? sql.raw('desc') : sql.raw('asc')}, d.created_at desc limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from app.delegations d where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const me = (await sql<{ u: string | null }>`select app.current_app_user_id() as u`.execute(tx)).rows[0]?.u ?? null;
  return {
    rows: rows.rows.map((d) => {
      const mineOrAdmin = isAdmin || d.delegator_user_id === me;
      return { id: d.id, approver: { id: d.delegator_user_id, employeeNo: null, name: d.approver ?? '' }, delegate: { id: d.delegate_user_id, employeeNo: null, name: d.delegate ?? '' },
        validFrom: d.valid_from, validTo: d.valid_to, scope: d.scope, setBy: d.set_by === d.delegator_user_id ? 'self' : 'admin', setByName: d.set_by_name ?? '',
        state: d.state as DelegationState, cancelledAt: iso(d.cancelled_at), cancelledByName: d.cancelled_by_name, createdAt: iso(d.created_at)!,
        canEdit: mineOrAdmin && d.state === 'scheduled', canEnd: mineOrAdmin && d.state !== 'ended' };
    }),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}
export async function listDelegations(params: DelegationListParams): Promise<Paged<DelegationRow>> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => delegationRows(tx, params, false, false));
}
export async function listMyDelegations(): Promise<DelegationRow[]> {
  const { ctx } = await authorize(TEAM);
  return withUserTx(ctx, async (tx) => (await delegationRows(tx, { pageSize: 100 }, true, true)).rows);
}

export async function approversOnLeaveToday(tx: Tx): Promise<ApproverOnLeaveRow[]> {
  if (!(await dbIsAdmin(tx))) return [];
  const today = await todayMyt(tx);
  const r = await sql<R>`select u.id as user_id, e.id as emp_id, e.employee_no, e.full_name, e.preferred_name, e.manager_employee_id,
        (select max(x.end_date) from app.leave_applications x where x.employee_id = e.id and x.status in ('approved','cancellation_pending') and x.end_date >= ${today}::date
           and x.start_date <= ${today}::date) as until,
        (select count(*)::int from app.approval_tasks t where t.status = 'open' and (t.assignee_user_id = u.id or t.original_assignee_user_id = u.id)) as open_items,
        app.user_name((select mu.id from app.app_users mu where mu.employee_id = e.manager_employee_id and mu.status = 'active' limit 1)) as rerouted_to
      from app.app_users u join app.employees e on e.id = u.employee_id
     where u.status = 'active' and app.active_delegate(u.id, ${today}::date, 'leave') is null
       and exists (select 1 from app.leave_application_days d join app.leave_applications a on a.id = d.application_id
                    where d.employee_id = e.id and d.leave_date = ${today}::date and d.weight > 0 and a.status in ('approved','cancellation_pending'))
       and (exists (select 1 from app.employees r where r.manager_employee_id = e.id)
            or exists (select 1 from app.approval_tasks t where t.status = 'open' and t.assignee_user_id = u.id))
     order by e.full_name`.execute(tx);
  return r.rows.map((x) => ({ approver: personRef(x.user_id, x.employee_no, x.full_name, x.preferred_name), leaveUntil: x.until ?? today, openItems: x.open_items,
    reroutedTo: x.rerouted_to ?? 'Any Admin' }));
}
export async function listApproversOnLeaveToday(): Promise<ApproverOnLeaveRow[]> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, approversOnLeaveToday);
}

/** Delegate / approver picker (DB: app.approver_options — directory-level facts, active employee users only). */
export async function approverOptions(tx: Tx, q: string | undefined, excludeUserId: string | undefined, limit: number): Promise<ApproverOption[]> {
  const r = await sql<R>`select * from app.approver_options(${q ?? null}, ${limit})`.execute(tx);
  return r.rows.filter((x) => x.user_id !== excludeUserId).map((x) => ({ userId: x.user_id, employeeId: x.employee_id, employeeNo: x.employee_no,
    name: x.name, position: x.position_title, isAdmin: x.is_admin }));
}
