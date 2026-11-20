'use server';

// Approval engine Server Actions (W2-004). Contract: src/server/contracts/approvals.ts (function register).
// Decisions go through the database (app.decide_task: row locks, first decision wins, not own in any role — rls §7);
// delegations are cancel-only rows (EDIT = end + new in one transaction); HR reassign uses app.reassign_tasks.

import { z } from 'zod';
import { sql, withUserTx, type Tx } from '../db';
import type { Role } from '../auth/current-user';
import { writeAccess } from '../audit';
import { fail, NO_ACCESS, runAction, type Input } from '../lib/action-helpers';
import { csvDate, csvDateTime, csvFile } from '../lib/csv';
import {
  approverOptionsSchema, bulkDecideSchema, decideTaskSchema, delegationListParamsSchema, endDelegationSchema, inboxParamsSchema, reassignPreviewSchema,
  reassignSchema, saveDelegationSchema,
  DELEGATION_SCOPE_LABELS, DELEGATION_STATE_LABELS,
  type ActionResult, type ApproverOption, type BulkDecisionResult, type BulkDecisionRow, type CsvFile, type DecideTaskResult, type InboxCounts,
  type ReassignItemType, type ReassignPreview, type ReassignResult, type TaskSubject,
} from '../contracts/approvals';
import { approverOptions, delegationRows, inboxCounts, inboxPage } from '../queries/approvals';

const ADMIN: Role[] = ['ADM', 'SA'];
const TEAM: Role[] = ['MGR', 'ADM', 'SA'];
const NOT_FOUND = { ok: false as const, error: NO_ACCESS };
const MSGS = { 'PRET-SELF-001': "You can't decide your own request." };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

const SUBJECTS: Record<ReassignItemType, TaskSubject[]> = {
  leave: ['leave_application'], cancellations: ['leave_cancellation'], credits: ['replacement_credit'], claims: ['claim'],
};

// ===========================================================================
// P30 decisions
// ===========================================================================
export async function decideTask(input: Input): Promise<ActionResult<DecideTaskResult>> {
  return runAction(TEAM, decideTaskSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: d.comment ?? ctx.reason }, async (tx) => {
    const j = (await sql<{ j: R }>`select app.decide_task(${d.taskId}::uuid, ${d.decision}, ${d.comment}, ${d.expectedVersion}, ${d.asOverride}) as j`.execute(tx)).rows[0]!.j;
    return { outcome: j.outcome, subjectType: j.subject_type, reference: j.reference, message: j.message, nextLevel: j.next_level ?? null };
  }), undefined, MSGS);
}

export async function bulkDecide(input: Input): Promise<ActionResult<BulkDecisionResult>> {
  return runAction(TEAM, bulkDecideSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: d.comment ?? ctx.reason }, async (tx) => {
    const rows: BulkDecisionRow[] = [];
    for (const id of [...new Set(d.taskIds)]) {
      const info = (await sql<R>`select t.version, coalesce(a.ref_no, c.credit_no, '') as ref, coalesce(e.preferred_name, e.full_name, '') as name,
            app.task_acting_as(t.id)::text as acting, t.subject_employee_id = app.current_employee_id() as own
          from app.approval_tasks t left join app.leave_applications a on a.id = t.leave_application_id left join app.replacement_credits c on c.id = t.replacement_credit_id
          left join app.employees e on e.id = t.subject_employee_id where t.id = ${id}::uuid`.execute(tx)).rows[0];
      if (!info) { rows.push({ taskId: id, reference: '', employeeName: '', outcome: 'skipped', note: 'Not found' }); continue; }
      // BR-LV-64: only items where the user is the current approver (no Admin override in bulk)
      if (info.own) { rows.push({ taskId: id, reference: info.ref, employeeName: info.name, outcome: 'skipped', note: 'Your own request' }); continue; }
      if (!info.acting || info.acting === 'admin_override') {
        rows.push({ taskId: id, reference: info.ref, employeeName: info.name, outcome: 'skipped', note: 'Not at your level' }); continue;
      }
      await sql`savepoint bulk_decide`.execute(tx);
      try {
        const j = (await sql<{ j: R }>`select app.decide_task(${id}::uuid, ${d.decision}, ${d.comment}, ${info.version}, false) as j`.execute(tx)).rows[0]!.j;
        await sql`release savepoint bulk_decide`.execute(tx);
        rows.push({ taskId: id, reference: info.ref, employeeName: info.name, outcome: j.outcome, note: j.outcome === 'moved_to_next' ? j.message : null });
      } catch (err) {
        await sql`rollback to savepoint bulk_decide`.execute(tx);
        const m = String((err as { message?: string })?.message ?? '');
        rows.push({ taskId: id, reference: info.ref, employeeName: info.name, outcome: 'skipped',
          note: m.includes('PRET-TASK-DECIDED') ? m.replace(/^.*?PRET-TASK-DECIDED:\s*/, '') : m.includes('PRET-SELF') ? 'Your own request' : 'Not at your level' });
      }
    }
    const n = (o: string) => rows.filter((r) => r.outcome === o).length;
    return { rows, approved: n('approved'), moved: n('moved_to_next'), rejected: n('rejected'), skipped: n('skipped') };
  }), undefined, MSGS);
}

// ===========================================================================
// P26 inbox
// ===========================================================================
export async function exportInboxCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(TEAM, inboxParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const page = await inboxPage(tx, p, true);
    await writeAccess(tx, { action: 'export', entityType: `approvals_${page.tab}`, recordCount: page.rows.length });
    if (page.tab === 'leave') {
      return csvFile('approvals-leave', ['Reference', 'Employee no.', 'Employee', 'Department', 'Type', 'From', 'To', 'Days', 'Reason', 'Attachments', 'Emergency', 'Applied', 'Level', 'Waiting (working days)'],
        page.rows.map((r) => [r.refNo, r.employee.employeeNo, r.employee.name, r.department, r.leaveType.name, csvDate(r.startDate), csvDate(r.endDate), r.days, r.reason,
          r.attachmentCount, r.isEmergency, csvDateTime(r.appliedAt), `L${r.level}/${r.levels}`, r.waitingWorkingDays]));
    }
    if (page.tab === 'cancellations') {
      return csvFile('approvals-cancellations', ['Reference', 'Employee no.', 'Employee', 'Type', 'From', 'To', 'Days', 'Requested', 'Reason', 'Waiting (working days)'],
        page.rows.map((r) => [r.refNo, r.employee.employeeNo, r.employee.name, r.leaveType.name, csvDate(r.startDate), csvDate(r.endDate), r.days, csvDateTime(r.requestedAt),
          r.reason, r.waitingWorkingDays]));
    }
    if (page.tab === 'credits') {
      return csvFile('approvals-credits', ['Credit no.', 'Employee no.', 'Employee', 'Date worked', 'Day type', 'Days', 'Reason', 'Submitted', 'Waiting (working days)'],
        page.rows.map((r) => [r.creditNo, r.employee.employeeNo, r.employee.name, csvDate(r.dateWorked), r.dayTypeLabel, r.days, r.reason, csvDateTime(r.submittedAt), r.waitingWorkingDays]));
    }
    return csvFile(`approvals-${page.tab}`, ['Reference'], []);
  }));
}
export async function fetchInboxCounts(): Promise<ActionResult<{ counts: InboxCounts }>> {
  return runAction(TEAM, z.object({}).passthrough(), {}, async (_d, { ctx }) => withUserTx(ctx, async (tx) => ({ counts: await inboxCounts(tx) })));
}

// ===========================================================================
// Delegations (G6 own / L14 HR)
// ===========================================================================
async function saveDelegationTx(tx: Tx, d: z.output<typeof saveDelegationSchema>, delegator: string, own: boolean) {
  const today = (await sql<{ d: string }>`select app.today_myt()::text as d`.execute(tx)).rows[0]!.d;
  if (d.validFrom < today) return fail('From must be today or later.', { validFrom: 'From must be today or later.' });
  if (d.delegateUserId === delegator) return fail("You can't delegate to the same person.", { delegateUserId: "You can't delegate to the same person." });
  if (d.replaceId) {
    const old = (await sql<R>`select d.*, d.scope::text as scope from app.delegations d where d.id = ${d.replaceId}::uuid`.execute(tx)).rows[0];
    if (!old || (own && old.delegator_user_id !== delegator)) return NOT_FOUND;
    if (old.cancelled_at) return fail('This delegation has already ended.');
  }
  const scopes = d.scope === 'both' ? ['leave', 'claims', 'both'] : [d.scope, 'both'];
  const clash = (await sql<{ n: number }>`select count(*)::int as n from app.delegations x where x.delegator_user_id = ${delegator}::uuid and x.cancelled_at is null
      and x.scope::text = any(${scopes}::text[]) and x.valid_from <= ${d.validTo}::date and x.valid_to >= ${d.validFrom}::date
      ${d.replaceId ? sql`and x.id <> ${d.replaceId}::uuid` : sql``}`.execute(tx)).rows[0]?.n ?? 0;
  if (clash) return fail('You already have a delegate for these dates.', { validFrom: 'You already have a delegate for these dates.' });
  if (d.replaceId) await sql`update app.delegations set cancelled_at = now(), cancelled_by = app.current_app_user_id() where id = ${d.replaceId}::uuid`.execute(tx);
  const id = (await sql<{ id: string }>`insert into app.delegations (delegator_user_id, delegate_user_id, valid_from, valid_to, scope, set_by)
      values (${delegator}::uuid, ${d.delegateUserId}::uuid, ${d.validFrom}::date, ${d.validTo}::date, ${d.scope}::app.delegation_scope, app.current_app_user_id())
      returning id`.execute(tx)).rows[0]!.id;
  return { id };
}
export async function saveMyDelegation(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(TEAM, saveDelegationSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const me = (await sql<{ u: string | null }>`select app.current_app_user_id() as u`.execute(tx)).rows[0]?.u;
    if (!me) return NOT_FOUND;
    return saveDelegationTx(tx, d, me, true);
  }));
}
export async function saveDelegation(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, saveDelegationSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    if (!d.delegatorUserId) return fail('Choose the approver.', { delegatorUserId: 'Choose the approver.' });
    return saveDelegationTx(tx, d, d.delegatorUserId, false);
  }));
}
async function endDelegationTx(tx: Tx, id: string) {
  const r = await sql`update app.delegations set cancelled_at = now(), cancelled_by = app.current_app_user_id() where id = ${id}::uuid and cancelled_at is null`.execute(tx);
  return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
}
export async function endMyDelegation(input: Input): Promise<ActionResult> {
  return runAction(TEAM, endDelegationSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const own = (await sql<{ ok: boolean }>`select delegator_user_id = app.current_app_user_id() as ok from app.delegations where id = ${d.id}::uuid`.execute(tx)).rows[0]?.ok;
    if (!own) return NOT_FOUND;
    return endDelegationTx(tx, d.id);
  }));
}
export async function endDelegation(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, endDelegationSchema, input, async (d, { ctx }) => withUserTx(ctx, (tx) => endDelegationTx(tx, d.id)));
}
export async function exportDelegationsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, delegationListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await delegationRows(tx, p, true, false);
    await writeAccess(tx, { action: 'export', entityType: 'delegations', recordCount: rows.length });
    return csvFile('delegations', ['Approver', 'Delegate', 'From', 'To', 'Scope', 'Set by', 'Status', 'Ended at'],
      rows.map((r) => [r.approver.name, r.delegate.name, csvDate(r.validFrom), csvDate(r.validTo), DELEGATION_SCOPE_LABELS[r.scope],
        r.setBy === 'self' ? 'Self' : `Admin (${r.setByName})`, DELEGATION_STATE_LABELS[r.state], csvDateTime(r.cancelledAt)]));
  }));
}

// ===========================================================================
// L14 reassign
// ===========================================================================
export async function previewReassign(input: Input): Promise<ActionResult<ReassignPreview>> {
  return runAction(ADMIN, reassignPreviewSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const types = d.itemTypes.flatMap((t) => SUBJECTS[t]);
    const r = await sql<R>`select * from app.reassign_tasks(${d.fromUserId}::uuid, ${d.toUserId ?? null}::uuid, ${types}::app.task_subject[], '', true)`.execute(tx);
    return { count: r.rows.filter((x) => !x.skipped).length,
      skipped: r.rows.filter((x) => x.skipped).map((x) => ({ reference: x.reference, employeeName: x.employee_name, note: x.note })),
      items: r.rows.filter((x) => !x.skipped).map((x) => ({ reference: x.reference, subjectType: x.subject_type, employeeName: x.employee_name, level: x.level })) };
  }));
}
export async function reassignPendingItems(input: Input): Promise<ActionResult<ReassignResult>> {
  return runAction(ADMIN, reassignSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
    const types = d.itemTypes.flatMap((t) => SUBJECTS[t]);
    const r = await sql<R>`select * from app.reassign_tasks(${d.fromUserId}::uuid, ${d.toUserId}::uuid, ${types}::app.task_subject[], ${d.reason}, false)`.execute(tx);
    return { reassigned: r.rows.filter((x) => !x.skipped).length, skipped: r.rows.filter((x) => x.skipped).map((x) => ({ reference: x.reference, note: x.note })) };
  }));
}
export async function searchApproverOptions(input: Input): Promise<ActionResult<{ rows: ApproverOption[] }>> {
  return runAction(TEAM, approverOptionsSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => ({
    rows: await approverOptions(tx, d.q, d.excludeUserId, d.limit),
  })));
}
