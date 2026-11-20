'use server';

// M2 Leave Server Actions (W2-004). Contract: src/server/contracts/leave.ts (function register).
// Each action: requireUser([...roles]) → zod → withUserTx (RLS + the database engine and guards: app.leave_evaluate,
// transition trigger, no self-approval, ledger rules, statutory floor) → audit (DB trigger) / access log (exports,
// attachment downloads) → ActionResult. Days and balances are computed only by the database (ADR-0005).

import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql, withUserTx, type Tx } from '../db';
import type { Role } from '../auth/current-user';
import { writeAccess } from '../audit';
import { confirmUpload, getDownloadUrl, requestUpload } from '../storage';
import { fail, hasRole, NO_ACCESS, runAction, type Input } from '../lib/action-helpers';
import { csvDate, csvDateTime, csvFile } from '../lib/csv';
import {
  addLeaveAttachmentSchema, adjustBalanceSchema, adjustmentAttachmentUrlSchema, adjustmentListParamsSchema, adjustmentPreviewSchema,
  actOnBehalfSchema, applyLeaveSchema, balanceListParamsSchema, balancesYearSchema, batchCreditPreviewSchema, batchCreditSchema,
  calendarMarksSchema, calendarParamsSchema, cancelLeaveSchema, colleagueOptionsSchema, creditAttachmentUrlSchema, creditIdSchema,
  creditListParamsSchema, dayKindSchema, fileIdSchema, leaveApplicationListParamsSchema, leaveAttachmentUrlSchema, leaveEmployeeOptionsSchema,
  leaveTypeListParamsSchema, ledgerParamsSchema, myLeaveParamsSchema, openingLeaveFormSchema, overrideIdSchema, overrideListParamsSchema,
  previewLeaveSchema, recomputeEntitlementsSchema, requestAdjustmentUploadSchema, requestCancellationSchema, requestCreditSchema,
  requestLeaveUploadSchema, rolloverPreviewParamsSchema, runRolloverSchema, saveLeaveBandsSchema, saveLeaveTypeSchema, saveOpeningLeaveSchema,
  saveOverrideSchema, saveWorkflowSchema, setCompensateByPaySchema, setLeaveTypeActiveSchema, setMcStatusSchema, updateLeavePolicySchema,
  withdrawLeaveSchema, workflowListParamsSchema, workflowPreviewSchema, uuidSchema, isoDateSchema,
  CREDIT_DURATION_LABELS, CREDIT_STATUS_LABELS, LEAVE_CATEGORY_LABELS, LEAVE_SESSION_LABELS, LEAVE_STATUS_LABELS, LEDGER_TRANSACTION_LABELS,
  MC_STATUS_LABELS, STATUTORY_FLOOR_FIELD,
  type ActionResult, type AdjustmentPreview, type BalancePreview, type BatchCreditPreview, type BatchCreditResult, type CalendarMarks,
  type ColleagueOption, type CsvFile, type DayKindResult, type EmployeeLeaveTab, type LeaveEmployeeOption, type LeaveIssue, type LeavePreview,
  type LeaverPosition, type MyBalances, type OpeningLeaveForm, type RecomputeResult, type RequestCreditResult, type RolloverPreview,
  type RunRolloverResult, type SaveBandsResult, type SaveOverrideResult, type SubmitLeaveResult, type UpdateLeavePolicyResult, type UploadIntent,
  type WorkflowPreview,
} from '../contracts/leave';
import {
  adjustmentRows, applicationRows, balanceListFor, balancesFor, calendarFor, creditRows, d1, dbIsAdmin, employeeLeaveTab, leaveTypeRows,
  ledgerPage, leaverPositionFor, myEmployeeId, myLeaveRows, overrideRows, policyOf, todayMyt, workflowRows,
} from '../queries/leave';

const ANY: Role[] = ['EMP', 'MGR', 'ADM', 'SA'];
const ADMIN: Role[] = ['ADM', 'SA'];
const TEAM: Role[] = ['MGR', 'ADM', 'SA'];
const NOT_FOUND = { ok: false as const, error: NO_ACCESS };
const SELF_MSG = { 'PRET-SELF-001': "You can't do this on your own record or request." };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

async function exported(tx: Tx, entityType: string, count: number, employeeIds: string[] = []) {
  await writeAccess(tx, { action: 'export', entityType, recordCount: count, employeeIds });
}
/** Deterministic UUID from a seed (per-employee idempotency key of a batch). */
function uuidFrom(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function issuesToFail(blocks: LeaveIssue[]) {
  const fe: Record<string, string> = {};
  for (const b of blocks) fe[b.field ?? 'form'] ??= b.message;
  return fail(blocks[0]?.message ?? 'Please correct the highlighted fields.', fe);
}
function evalPayload(d: R, extra: R = {}): R {
  return {
    employee_id: d.employeeId ?? null, leave_type_id: d.leaveTypeId, start_date: d.startDate, start_session: d.startSession, end_date: d.endDate,
    end_session: d.endSession, reason: d.reason, expected_confinement_date: d.expectedConfinementDate, child_birth_date: d.childBirthDate,
    contact_phone: d.contactPhone, cover_employee_id: d.coverEmployeeId, on_behalf_reason: d.onBehalfReason, ...extra,
  };
}
function balancePreview(b: R | null, thisDays: number): BalancePreview {
  if (!b || !b.has_balance) {
    return { availableNow: '0.0', thisApplication: d1(thisDays), pending: d1(b?.pending), availableAfter: '0.0', earnedToDate: null, earnedToDateAt: null,
      pool: null, notApplicable: true };
  }
  const avail = Number(b.available); const pend = Number(b.pending);
  return {
    availableNow: d1(avail + pend), thisApplication: d1(thisDays), pending: d1(pend), availableAfter: d1(avail - thisDays),
    earnedToDate: b.earned_to_date === null || b.earned_to_date === undefined ? null : d1(b.earned_to_date), earnedToDateAt: null,
    pool: b.pool ? { label: b.pool.label, used: d1(b.pool.used), cap: d1(b.pool.cap) } : null, notApplicable: false,
  };
}
function toPreview(j: R): LeavePreview {
  const parts = (j.parts ?? []).map((p: R) => {
    const bp = balancePreview(p.balance, Number(p.days));
    if (bp.earnedToDate !== null) bp.earnedToDateAt = p.end_date;
    return { year: p.year, startDate: p.start_date, endDate: p.end_date, days: d1(p.days), balance: bp };
  });
  return {
    endDate: j.end_date, endDateFixed: !!j.end_fixed, days: d1(j.days),
    breakdown: (j.breakdown ?? []).map((b: R) => ({ date: b.date, session: b.session, weight: Number(b.weight).toFixed(1), kind: b.kind, label: b.label })),
    parts, balance: parts[0]?.balance ?? balancePreview(null, Number(j.days ?? 0)), isEmergency: !!j.is_emergency, attachmentRequired: !!j.attachment_required,
    attachmentMayFollow: !!j.attachment_may_follow, blocks: j.blocks ?? [], warnings: j.warnings ?? [], notes: j.notes ?? [], approverHint: j.approver_hint ?? null,
  };
}
async function openTaskApprover(tx: Tx, applicationId: string): Promise<string | null> {
  const r = (await sql<R>`select t.assignee_user_id, t.source::text as source from app.approval_tasks t
      where t.leave_application_id = ${applicationId}::uuid and t.status = 'open' limit 1`.execute(tx)).rows[0];
  if (!r) return null;
  if (r.assignee_user_id) return (await sql<{ n: string }>`select app.user_name(${r.assignee_user_id}::uuid) as n`.execute(tx)).rows[0]?.n ?? null;
  return r.source === 'super_admin_pool' ? 'a Super Admin' : 'an Admin';
}

// ===========================================================================
// L8 / L9 Leave types (BR-LV-01/02)
// ===========================================================================
export async function exportLeaveTypesCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, leaveTypeListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await leaveTypeRows(tx, p, true);
    await exported(tx, 'leave_types', rows.length);
    return csvFile('leave-types', ['Code', 'Name', 'Category', 'Paid', 'Count basis', 'Entitlement', 'Workflow', 'Visible to employees', 'Active'],
      rows.map((r) => [r.code, r.name, LEAVE_CATEGORY_LABELS[r.category], r.isPaid, r.countBasis.replace(/_/g, ' '), r.entitlementSummary, r.workflow.label,
        r.visibleToEmployees, r.isActive]));
  }));
}

async function recordFloorOverride(tx: Tx, typeId: string, reason: string | null | undefined, isSa: boolean, detail: string) {
  if (!reason || !isSa) return;
  await sql`insert into app.statutory_floor_overrides (leave_type_id, detail, reason, approved_by) values (${typeId}::uuid, ${detail}, ${reason}, app.current_app_user_id())`.execute(tx);
}
const floorFail = (e: unknown, isSa: boolean) => {
  const msg = String((e as { message?: string })?.message ?? '');
  if (!msg.includes('PRET-LV-FLOOR')) throw e;
  const text = msg.replace(/^.*?PRET-LV-FLOOR:?\s*/, '').trim();
  return fail(text, { [STATUTORY_FLOOR_FIELD]: isSa ? `${text} Give an override reason to save anyway (logged).` : `${text} Only a Super Admin can override.` });
};

export async function saveLeaveType(input: Input): Promise<ActionResult<{ id: string; code: string }>> {
  return runAction(ADMIN, saveLeaveTypeSchema, input, async (d, { user, ctx }) => {
    const isSa = hasRole(user, 'SA');
    if (d.floorOverrideReason && !isSa) return fail('Only a Super Admin can override the Employment Act minimum.', { floorOverrideReason: 'Super Admin only.' });
    const id = d.id ?? randomUUID();
    try {
      return await withUserTx({ ...ctx, reason: d.floorOverrideReason ?? ctx.reason }, async (tx) => {
        if (d.id) {
          const cur = (await sql<{ version: number }>`select version from app.leave_types where id = ${d.id}::uuid for update`.execute(tx)).rows[0];
          if (!cur) return NOT_FOUND;
          if (d.version && cur.version !== d.version) return fail('This leave type was changed by someone else — refresh and try again.');
        }
        await recordFloorOverride(tx, id, d.floorOverrideReason, isSa, `${d.code}: saved below the Employment Act minimum`);
        const v = d;
        const cols = sql`code = ${v.code}, name = ${v.name}, category = ${v.category}::app.leave_category, description = ${v.description}, is_paid = ${v.isPaid},
          count_basis = ${v.countBasis}::app.count_basis, entitlement_method = ${v.entitlementMethod}::app.entitlement_method,
          accrual_override = ${v.accrualOverride}::app.accrual_method, prorate_joiners_leavers = ${v.prorateJoinersLeavers},
          eligible_gender = ${v.eligibleGender}::app.eligible_gender, eligible_marital = ${v.eligibleMarital}::app.eligible_marital,
          min_service_months = ${v.minServiceMonths}, available_on_probation = ${v.availableOnProbation}, half_day_allowed = ${v.halfDayAllowed},
          reason_required = ${v.reasonRequired}, attachment_rule = ${v.attachmentRule}::app.attachment_rule, attachment_threshold_days = ${v.attachmentThresholdDays},
          attachment_grace_hours = ${v.attachmentGraceHours}, min_notice_days = ${v.minNoticeDays}, min_notice_behaviour = ${v.minNoticeBehaviour}::app.notice_behaviour,
          backdate_working_days = ${v.backdateWorkingDays}, max_days_per_application = ${v.maxDaysPerApplication}, max_occurrences = ${v.maxOccurrences},
          occurrence_scope = ${v.occurrenceScope}::app.occurrence_scope, days_per_occurrence = ${v.daysPerOccurrence}, annual_cap_days = ${v.annualCapDays},
          deduct_from_type_id = ${v.deductFromTypeId}::uuid, pool_with_type_id = ${v.poolWithTypeId}::uuid, pool_cap_days = ${v.poolCapDays},
          carry_forward_allowed = ${v.carryForwardAllowed}, cf_cap_override = ${v.cfCapOverride}, cf_expiry_months_override = ${v.cfExpiryMonthsOverride},
          allow_negative = ${v.allowNegative}, max_negative_days = ${v.maxNegativeDays}, workflow_id = ${v.workflowId}::uuid,
          self_cancel_future_approved = ${v.selfCancelFutureApproved}, visible_to_employees = ${v.visibleToEmployees}, calendar_colour = ${v.calendarColour},
          payroll_treatment = ${v.payrollTreatment}::app.leave_payroll_treatment, display_order = ${v.displayOrder}, is_active = ${v.isActive}`;
        if (d.id) {
          await sql`update app.leave_types set ${cols} where id = ${d.id}::uuid`.execute(tx);
        } else {
          await sql`insert into app.leave_types (id, code, name, category, is_paid, count_basis, entitlement_method, prorate_joiners_leavers, half_day_allowed,
              workflow_id, calendar_colour, payroll_treatment)
            values (${id}::uuid, ${v.code}, ${v.name}, ${v.category}::app.leave_category, ${v.isPaid}, ${v.countBasis}::app.count_basis,
              ${v.entitlementMethod}::app.entitlement_method, ${v.prorateJoinersLeavers}, ${v.halfDayAllowed}, ${v.workflowId}::uuid, ${v.calendarColour},
              ${v.payrollTreatment}::app.leave_payroll_treatment)`.execute(tx);
          await sql`update app.leave_types set ${cols} where id = ${id}::uuid`.execute(tx);
        }
        await sql`set constraints all immediate`.execute(tx);
        return { id, code: d.code };
      });
    } catch (e) {
      return floorFail(e, isSa);
    }
  }, { isActive: 'isActive' });
}

export async function setLeaveTypeActive(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, setLeaveTypeActiveSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const r = await sql`update app.leave_types set is_active = ${d.isActive} where id = ${d.id}::uuid`.execute(tx);
    return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
  }));
}

// ===========================================================================
// L10 bands / L11 policy / recompute
// ===========================================================================
export async function saveLeaveBands(input: Input): Promise<ActionResult<SaveBandsResult>> {
  return runAction(ADMIN, saveLeaveBandsSchema, input, async (d, { user, ctx }) => {
    const isSa = hasRole(user, 'SA');
    if (d.floorOverrideReason && !isSa) return fail('Only a Super Admin can override the Employment Act minimum.', { floorOverrideReason: 'Super Admin only.' });
    try {
      return await withUserTx({ ...ctx, reason: d.floorOverrideReason ?? ctx.reason }, async (tx) => {
        await sql`set constraints all deferred`.execute(tx);              // checked once, after all rows are written
        await recordFloorOverride(tx, d.leaveTypeId, d.floorOverrideReason, isSa, `Bands ${d.effectiveYear} saved below the Employment Act minimum`);
        await sql`delete from app.leave_entitlement_bands where leave_type_id = ${d.leaveTypeId}::uuid and effective_year = ${d.effectiveYear}`.execute(tx);
        for (const r of d.rows) {
          await sql`insert into app.leave_entitlement_bands (leave_type_id, effective_year, service_from_years, service_to_years, days_per_year, grade_id)
              values (${d.leaveTypeId}::uuid, ${d.effectiveYear}, ${r.serviceFromYears}, ${r.serviceToYears}, ${r.daysPerYear}, ${r.gradeId}::uuid)`.execute(tx);
        }
        await sql`set constraints all immediate`.execute(tx);
        const cur = Number((await todayMyt(tx)).slice(0, 4));
        let n = 0;
        for (const y of [cur, cur + 1]) {
          if (y < d.effectiveYear) continue;
          if (y === cur + 1 && !(await sql<{ n: number }>`select count(*)::int as n from app.leave_entitlements where leave_year = ${y}`.execute(tx)).rows[0]?.n) continue;
          n = Math.max(n, (await sql<{ n: number }>`select app.regenerate_entitlements(${y}, null) as n`.execute(tx)).rows[0]?.n ?? 0);
        }
        return { recomputedEmployees: n };
      });
    } catch (e) {
      return floorFail(e, isSa);
    }
  });
}

export async function updateLeavePolicy(input: Input): Promise<ActionResult<UpdateLeavePolicyResult>> {
  return runAction(ADMIN, updateLeavePolicySchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const before = await policyOf(tx);
    if (before.version !== d.version) return fail('The policy was changed by someone else — refresh and try again.');
    await sql`update app.leave_policy set entitlement_method = ${d.entitlementMethod}::app.accrual_method, prorate_basis = ${d.prorateBasis}::app.prorate_basis,
        rounding = ${d.rounding}::app.leave_rounding, ea_floor_for_joiners_leavers = ${d.eaFloorForJoinersLeavers}, carry_forward_cap_days = ${d.carryForwardCapDays},
        carry_forward_expiry_months = ${d.carryForwardExpiryMonths}, allow_next_year_applications = ${d.allowNextYearApplications},
        next_year_from_ddmm = ${d.nextYearFromDdmm}, form_message = ${d.formMessage}, emergency_threshold_days = ${d.emergencyThresholdDays},
        emergency_leave_type_ids = ${d.emergencyLeaveTypeIds}::uuid[], team_calendar_visibility = ${d.teamCalendarVisibility}::app.team_calendar_visibility,
        notify_on_admin_withdraw = ${d.notifyOnAdminWithdraw}, include_separated_in_reports = ${d.includeSeparatedInReports},
        reminder_after_working_days = ${d.reminderAfterWorkingDays}, escalate_after_working_days = ${d.escalateAfterWorkingDays},
        replacement_credit_validity_days = ${d.replacementCreditValidityDays}, replacement_credits_carry_forward = ${d.replacementCreditsCarryForward},
        replacement_for_ph_on_off_day = ${d.replacementForPhOnOffDay}, replacement_worked_lookback_days = ${d.replacementWorkedLookbackDays},
        cancellation_approver_level1_only = ${d.cancellationApproverLevel1Only}, paternity_window_days_after_birth = ${d.paternityWindowDaysAfterBirth},
        team_absence_threshold = ${d.teamAbsenceThreshold}
      where id = 1`.execute(tx);
    const cur = Number((await todayMyt(tx)).slice(0, 4));
    return {
      recomputeSuggested: before.entitlementMethod !== d.entitlementMethod || before.prorateBasis !== d.prorateBasis || before.rounding !== d.rounding
        || before.eaFloorForJoinersLeavers !== d.eaFloorForJoinersLeavers,
      replacementHolidaysRegenerated: before.replacementForPhOnOffDay !== d.replacementForPhOnOffDay ? [cur, cur + 1] : [],
    };
  }));
}

export async function recomputeEntitlements(input: Input): Promise<ActionResult<RecomputeResult>> {
  return runAction(ADMIN, recomputeEntitlementsSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const before = (await sql<{ n: number }>`select count(*)::int as n from app.leave_ledger where entry_type = 'entitlement' and leave_year = ${d.year}`.execute(tx)).rows[0]?.n ?? 0;
    const n = (await sql<{ n: number }>`select app.regenerate_entitlements(${d.year}, ${d.employeeId ?? null}::uuid) as n`.execute(tx)).rows[0]?.n ?? 0;
    const after = (await sql<{ n: number }>`select count(*)::int as n from app.leave_ledger where entry_type = 'entitlement' and leave_year = ${d.year}`.execute(tx)).rows[0]?.n ?? 0;
    return { employees: n, changed: after - before };
  }));
}

// ===========================================================================
// L12 Workflows
// ===========================================================================
export async function saveWorkflow(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, saveWorkflowSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`set constraints all deferred`.execute(tx);
    let id = d.id ?? null;
    if (id) {
      const r = await sql`update app.approval_workflows set name = ${d.name}, skip_if_approver_is_applicant = ${d.skipIfApproverIsApplicant},
          merge_consecutive_identical = ${d.mergeConsecutiveIdentical}, is_active = ${d.isActive} where id = ${id}::uuid`.execute(tx);
      if (!Number(r.numAffectedRows ?? 0)) return NOT_FOUND;
      await sql`delete from app.approval_workflow_levels where workflow_id = ${id}::uuid`.execute(tx);
    } else {
      id = (await sql<{ id: string }>`insert into app.approval_workflows (name, skip_if_approver_is_applicant, merge_consecutive_identical, is_active)
          values (${d.name}, ${d.skipIfApproverIsApplicant}, ${d.mergeConsecutiveIdentical}, ${d.isActive}) returning id`.execute(tx)).rows[0]!.id;
    }
    for (const [i, l] of d.levels.entries()) {
      await sql`insert into app.approval_workflow_levels (workflow_id, level, source, specific_employee_id)
          values (${id}::uuid, ${i + 1}, ${l.source}::app.approver_source, ${l.source === 'specific_employee' ? l.specificEmployeeId : null}::uuid)`.execute(tx);
    }
    await sql`set constraints all immediate`.execute(tx);
    return { id };
  }));
}
export async function exportWorkflowsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, workflowListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await workflowRows(tx, p, true);
    await exported(tx, 'approval_workflows', rows.length);
    return csvFile('approval-workflows', ['Name', 'Levels', 'Used by', 'Skip if approver is applicant', 'Merge identical approvers', 'Active'],
      rows.map((r) => [r.name, r.levelsLabel, r.usedBy.map((t) => t.code).join(' '), r.skipIfApproverIsApplicant, r.mergeConsecutiveIdentical, r.isActive]));
  }));
}
export async function previewWorkflow(input: Input): Promise<ActionResult<WorkflowPreview>> {
  return runAction(ADMIN, workflowPreviewSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const e = (await sql<R>`select e.id, coalesce(e.preferred_name, e.full_name) as name, m.id as mid, coalesce(m.preferred_name, m.full_name) as mname,
        coalesce(mm.preferred_name, mm.full_name) as mmname, coalesce(ap.preferred_name, ap.full_name) as apname
        from app.employees e left join app.employees m on m.id = e.manager_employee_id left join app.employees mm on mm.id = m.manager_employee_id
        left join app.employees ap on ap.id = e.leave_approver_employee_id
       where ${d.employeeId ? sql`e.id = ${d.employeeId}::uuid` : sql`e.manager_employee_id is not null and e.status in ('on_probation','confirmed','notice_period')`}
       order by e.employee_no limit 1`.execute(tx)).rows[0];
    if (!e) return { example: 'Add an employee with a reporting manager to see an example.' };
    const parts: string[] = [];
    for (const [i, l] of d.levels.entries()) {
      let who = 'any Admin';
      if (l.source === 'direct_manager') who = e.mname ?? 'Super Admin (top of organisation)';
      else if (l.source === 'leave_approver_override') who = e.apname ?? e.mname ?? 'Super Admin';
      else if (l.source === 'managers_manager') who = e.mmname ?? 'any Admin';
      else if (l.source === 'super_admin_pool') who = 'a Super Admin';
      else if (l.source === 'specific_employee' && l.specificEmployeeId) {
        who = (await sql<{ n: string }>`select coalesce(preferred_name, full_name) as n from app.employees where id = ${l.specificEmployeeId}::uuid`.execute(tx)).rows[0]?.n ?? 'the chosen employee';
      }
      parts.push(`L${i + 1} ${who}`);
    }
    return { example: `Example: ${e.name}${e.mname ? ` (reports to ${e.mname})` : ''} → ${parts.join(' → ')}.` };
  }));
}

// ===========================================================================
// P2 / L2 Apply, preview, calendar marks, attachments
// ===========================================================================
export async function previewLeaveApplication(input: Input): Promise<ActionResult<LeavePreview>> {
  return runAction(ANY, previewLeaveSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const j = (await sql<{ j: R }>`select app.leave_evaluate(${JSON.stringify(evalPayload(d, { attachment_count: d.attachmentCount }))}::jsonb, false) as j`.execute(tx)).rows[0]!.j;
    return toPreview(j);
  }), undefined, SELF_MSG);
}

export async function fetchCalendarMarks(input: Input): Promise<ActionResult<CalendarMarks>> {
  return runAction(ANY, calendarMarksSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const emp = d.employeeId ?? (await myEmployeeId(tx));
    if (!emp) return { days: [] };
    const to = d.to > d.from && (Date.parse(d.to) - Date.parse(d.from)) / 86_400_000 > 400 ? new Date(Date.parse(d.from) + 400 * 86_400_000).toISOString().slice(0, 10) : d.to;
    const r = await sql<R>`select cal_date, kind, label, has_leave from app.calendar_marks(${emp}::uuid, ${d.from}::date, ${to}::date)`.execute(tx);
    return { days: r.rows.map((x) => ({ date: x.cal_date, kind: x.kind, label: x.label, hasLeave: x.has_leave })) };
  }));
}

export async function requestLeaveUpload(input: Input): Promise<ActionResult<UploadIntent>> {
  return runAction(ANY, requestLeaveUploadSchema, input, async (d, { ctx, accessToken }) => {
    const info = await withUserTx(ctx, async (tx) => ({
      emp: d.employeeId ?? (await myEmployeeId(tx)),
      cat: (await sql<{ c: string }>`select category::text as c from app.leave_types where id = ${d.leaveTypeId}::uuid`.execute(tx)).rows[0]?.c,
    }));
    if (!info.emp) return fail('Your employee record has not been created yet.');
    return requestUpload(ctx, accessToken, {
      subject: 'leave_attachment', ownerEmployeeId: info.emp, scope: 'u', originalName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
      dataCategory: info.cat && ['sick', 'hospitalisation', 'maternity'].includes(info.cat) ? 'health' : null,
    });
  }, { fileId: 'fileName' });
}
export async function confirmLeaveUpload(input: Input): Promise<ActionResult<{ fileId: string }>> {
  return runAction(ANY, fileIdSchema, input, async (d, { ctx, accessToken }) => {
    await confirmUpload(ctx, accessToken, d.fileId);
    return { fileId: d.fileId };
  });
}

export async function applyLeave(input: Input): Promise<ActionResult<SubmitLeaveResult>> {
  return runAction(ANY, applyLeaveSchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.onBehalfReason ?? ctx.reason, onBehalfEmployeeId: d.employeeId ?? null }, async (tx) => {
      const payload = evalPayload(d, { attachment_file_ids: d.attachmentFileIds, acknowledge_warnings: d.acknowledgeWarnings, idempotency_key: d.idempotencyKey });
      const j = (await sql<{ j: R }>`select app.leave_evaluate(${JSON.stringify(payload)}::jsonb, true) as j`.execute(tx)).rows[0]!.j;
      if ((j.blocks ?? []).length) return issuesToFail(j.blocks);
      const apps = (j.applications ?? []).map((a: R) => ({ id: a.id, refNo: a.ref_no, year: a.year, days: d1(a.days) }));
      const first = apps[0];
      const who = first ? await openTaskApprover(tx, first.id) : null;
      const refs = apps.map((a: { refNo: string }) => a.refNo).join(' and ');
      const message = j.status === 'approved' ? `Leave approved — ${refs}.`
        : `Leave ${j.duplicate ? 'already submitted' : 'submitted'} — ${refs} ${apps.length > 1 ? 'are' : 'is'} waiting for ${who ?? 'approval'} (level ${j.level} of ${j.levels}).`;
      return { applications: apps, status: j.status, level: j.level, levels: j.levels, message, duplicate: !!j.duplicate };
    }), { startDate: 'startDate' }, SELF_MSG);
}

export async function withdrawLeave(input: Input): Promise<ActionResult> {
  return runAction(ANY, withdrawLeaveSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`select app.withdraw_leave(${d.applicationId}::uuid, null, false)`.execute(tx);
    return {};
  }), undefined, SELF_MSG);
}
export async function cancelLeave(input: Input): Promise<ActionResult> {
  return runAction(ANY, cancelLeaveSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`select app.cancel_leave(${d.applicationId}::uuid, ${d.reason}, false)`.execute(tx);
    return {};
  }), undefined, SELF_MSG);
}
export async function requestLeaveCancellation(input: Input): Promise<ActionResult> {
  return runAction(ANY, requestCancellationSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`select app.request_leave_cancellation(${d.applicationId}::uuid, ${d.reason})`.execute(tx);
    return {};
  }), undefined, SELF_MSG);
}
export async function addLeaveAttachment(input: Input): Promise<ActionResult> {
  return runAction(ANY, addLeaveAttachmentSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`select app.add_leave_attachments(${d.applicationId}::uuid, ${d.fileIds}::uuid[])`.execute(tx);
    return {};
  }), { fileId: 'fileIds' });
}
export async function getLeaveAttachmentUrl(input: Input): Promise<ActionResult<{ url: string; fileName: string }>> {
  return runAction(ANY, leaveAttachmentUrlSchema, input, async (d, { ctx, accessToken }) => {
    const ok = await withUserTx(ctx, async (tx) => (await sql<{ id: string }>`select lf.file_id as id from app.leave_application_files lf
        join app.leave_applications a on a.id = lf.application_id
       where lf.file_id = ${d.fileId}::uuid and (a.id = ${d.applicationId}::uuid or a.id = (select coalesce(x.split_group_id, x.id) from app.leave_applications x where x.id = ${d.applicationId}::uuid))`.execute(tx)).rows[0]);
    if (!ok) return NOT_FOUND;
    return getDownloadUrl(ctx, accessToken, d.fileId, { purpose: 'download' });
  });
}
export async function exportMyLeaveCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ANY, myLeaveParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await myLeaveRows(tx, p, true);
    await exported(tx, 'my_leave', rows.length);
    return csvFile('my-leave', ['Reference', 'Type', 'From', 'Session', 'To', 'Session', 'Days', 'Status', 'Level', 'Emergency', 'Submitted', 'Decided by', 'Decided at'],
      rows.map((r) => [r.refNo, r.leaveType.name, csvDate(r.startDate), LEAVE_SESSION_LABELS[r.startSession], csvDate(r.endDate), LEAVE_SESSION_LABELS[r.endSession],
        r.days, LEAVE_STATUS_LABELS[r.status], r.status === 'pending' ? `L${r.level}/${r.levels}` : '', r.isEmergency, csvDateTime(r.submittedAt),
        r.decidedByName, csvDateTime(r.decidedAt)]));
  }));
}
export async function exportLeaveApplicationsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(TEAM, leaveApplicationListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await applicationRows(tx, p, true);
    await exported(tx, 'leave_applications', rows.length, [...new Set(rows.map((r) => r.employee.id))]);
    return csvFile('leave-applications', ['Reference', 'Employee no.', 'Employee', 'Department', 'Location', 'From', 'To', 'Days', 'Reason', 'Attachments', 'Type',
      'Applied', 'Status', 'Approver', 'Decided at', 'Emergency', 'On behalf', 'MC check'],
      rows.map((r) => [r.refNo, r.employee.employeeNo, r.employee.name, r.department.label, r.location.label, csvDate(r.startDate), csvDate(r.endDate), r.days,
        r.reason, r.attachmentCount, r.leaveType.name, csvDateTime(r.appliedAt), `${LEAVE_STATUS_LABELS[r.status]}${r.status === 'pending' ? ` L${r.level}` : ''}`,
        r.approverName, csvDateTime(r.approverAt), r.isEmergency, r.onBehalf, r.mcStatus ? MC_STATUS_LABELS[r.mcStatus] : '']));
  }));
}
export async function withdrawLeaveOnBehalf(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, actOnBehalfSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
    await sql`select app.withdraw_leave(${d.applicationId}::uuid, ${d.reason}, true)`.execute(tx);
    return {};
  }), undefined, SELF_MSG);
}
export async function cancelLeaveOnBehalf(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, actOnBehalfSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
    await sql`select app.cancel_leave(${d.applicationId}::uuid, ${d.reason}, true)`.execute(tx);
    return {};
  }), undefined, SELF_MSG);
}
export async function setMcStatus(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, setMcStatusSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`select app.set_leave_mc_status(${d.applicationId}::uuid, ${d.mcStatus}::app.mc_status, ${d.remarks})`.execute(tx);
    return {};
  }), undefined, SELF_MSG);
}

// ===========================================================================
// P6 Ledger export
// ===========================================================================
export async function exportLedgerCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ANY, ledgerParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const page = await ledgerPage(tx, p, true);
    if (!page) return NOT_FOUND;
    await exported(tx, 'leave_ledger', page.rows.length, [page.employee.id]);
    return csvFile(`leave-ledger-${page.leaveType.code}-${page.year}`, ['Date', 'Transaction', 'Days', 'Reference', 'Running balance', 'By', 'Reason', 'Expires'],
      page.rows.map((r) => [csvDate(r.date), LEDGER_TRANSACTION_LABELS[r.transaction], r.days, r.reference?.label ?? '', r.runningBalance, r.byName, r.reason, csvDate(r.expiresOn)]));
  }));
}

// ===========================================================================
// P8 / P9 / L7 / P28 Replacement credits
// ===========================================================================
export async function fetchDayKind(input: Input): Promise<ActionResult<DayKindResult>> {
  return runAction(ANY, dayKindSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const emp = d.employeeId ?? (await myEmployeeId(tx));
    if (!emp) return fail('Your employee record has not been created yet.');
    const k = (await sql<{ k: R }>`select app.day_kind_on(${emp}::uuid, ${d.date}::date) as k`.execute(tx)).rows[0]!.k;
    const dup = (await sql<{ no: string }>`select credit_no as no from app.replacement_credits where employee_id = ${emp}::uuid and date_worked = ${d.date}::date
        and status in ('pending','approved')`.execute(tx)).rows[0]?.no ?? null;
    const pol = await policyOf(tx);
    const expiry = pol.replacementCreditValidityDays > 0 ? new Date(Date.parse(d.date) + pol.replacementCreditValidityDays * 86_400_000).toISOString().slice(0, 10)
      : `${Number(d.date.slice(0, 4)) + 1}-${String(pol.carryForwardExpiryMonths).padStart(2, '0')}-28`;
    return { kind: k.kind, label: k.label, eligible: !!k.eligible && !dup,
      message: dup ? 'You already have a credit for this date' : k.eligible ? null : 'Replacement credit is only for work on a rest day, off day or public holiday',
      duplicateCreditNo: dup, expiryIfApproved: expiry };
  }));
}
export async function requestReplacementCredit(input: Input): Promise<ActionResult<RequestCreditResult>> {
  return runAction(ANY, requestCreditSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const me = await myEmployeeId(tx);
    if (!me) return fail('Your employee record has not been created yet.');
    const j = (await sql<{ j: R }>`select app.request_credit(${me}::uuid, ${d.dateWorked}::date, ${d.duration}::app.credit_duration, ${d.reason},
        ${d.attachmentFileId}::uuid, ${d.idempotencyKey}::uuid) as j`.execute(tx)).rows[0]!.j;
    const who = (await sql<R>`select coalesce(app.user_name(t.assignee_user_id), case t.source when 'super_admin_pool' then 'a Super Admin' else 'an Admin' end) as n
        from app.approval_tasks t where t.replacement_credit_id = ${j.id}::uuid and t.status = 'open' limit 1`.execute(tx)).rows[0]?.n;
    return { id: j.id, creditNo: j.credit_no, duplicate: !!j.duplicate, message: who ? `${j.credit_no} submitted — goes to ${who} for approval.` : `${j.credit_no} approved.` };
  }), { fileId: 'attachmentFileId' }, SELF_MSG);
}
export async function requestCreditUpload(input: Input): Promise<ActionResult<UploadIntent>> {
  return requestLeaveUpload(input);
}
export async function withdrawCredit(input: Input): Promise<ActionResult> {
  return runAction(ANY, creditIdSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`select app.withdraw_credit(${d.creditId}::uuid)`.execute(tx);
    return {};
  }));
}
function creditCsv(rows: Awaited<ReturnType<typeof creditRows>>['rows'], base: string) {
  return csvFile(base, ['Credit no.', 'Employee no.', 'Employee', 'Department', 'Date worked', 'Day type', 'Duration', 'Days', 'Status', 'Expiry', 'Used', 'Remaining',
    'Compensate by pay', 'Decided by', 'Decided at'],
    rows.map((r) => [r.creditNo, r.employee.employeeNo, r.employee.name, r.department, csvDate(r.dateWorked), r.dayTypeLabel, CREDIT_DURATION_LABELS[r.duration], r.days,
      CREDIT_STATUS_LABELS[r.status], csvDate(r.expiryDate), r.used, r.remaining, r.compensateByPay, r.decidedByName, csvDateTime(r.decidedAt)]));
}
export async function exportMyCreditsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ANY, creditListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await creditRows(tx, p, true, 'own');
    await exported(tx, 'my_replacement_credits', rows.length);
    return creditCsv(rows, 'my-replacement-credits');
  }));
}
export async function exportCreditsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(TEAM, creditListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await creditRows(tx, p, true, 'team');
    await exported(tx, 'replacement_credits', rows.length, [...new Set(rows.map((r) => r.employee.id))]);
    return creditCsv(rows, 'replacement-credits');
  }));
}
export async function previewBatchCredits(input: Input): Promise<ActionResult<BatchCreditPreview>> {
  return runAction(ADMIN, batchCreditPreviewSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const me = await myEmployeeId(tx);
    const rows: BatchCreditPreview['rows'] = [];
    for (const id of [...new Set(d.employeeIds)]) {
      const e = (await sql<R>`select id, employee_no, full_name, preferred_name from app.employee_names(${[id]}::uuid[])`.execute(tx)).rows[0];
      if (!e) continue;
      const person = { id: e.id, employeeNo: e.employee_no, name: e.preferred_name ? `${e.full_name} (${e.preferred_name})` : e.full_name };
      if (id === me) { rows.push({ employee: person, kind: 'working', label: '—', eligible: false, note: 'Your own record — request it yourself' }); continue; }
      const k = (await sql<{ k: R }>`select app.day_kind_on(${id}::uuid, ${d.dateWorked}::date) as k`.execute(tx)).rows[0]!.k;
      const dup = (await sql<{ n: number }>`select count(*)::int as n from app.replacement_credits where employee_id = ${id}::uuid and date_worked = ${d.dateWorked}::date
          and status in ('pending','approved')`.execute(tx)).rows[0]?.n ?? 0;
      rows.push({ employee: person, kind: k.kind, label: k.label, eligible: !!k.eligible && !dup,
        note: dup ? 'Already has a credit for this date' : k.eligible ? null : 'Working day — excluded' });
    }
    return { rows };
  }));
}
export async function batchApplyCredits(input: Input): Promise<ActionResult<BatchCreditResult>> {
  return runAction(ADMIN, batchCreditSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const created: BatchCreditResult['created'] = []; const skipped: BatchCreditResult['skipped'] = [];
    for (const id of [...new Set(d.employeeIds)]) {
      const e = (await sql<R>`select id, employee_no, full_name, preferred_name from app.employee_names(${[id]}::uuid[])`.execute(tx)).rows[0];
      const person = e ? { id: e.id, employeeNo: e.employee_no, name: e.preferred_name ? `${e.full_name} (${e.preferred_name})` : e.full_name } : { id, employeeNo: null, name: id };
      await sql`savepoint batch_credit`.execute(tx);
      try {
        const j = (await sql<{ j: R }>`select app.request_credit(${id}::uuid, ${d.dateWorked}::date, ${d.duration}::app.credit_duration, ${d.reason}, null,
            ${uuidFrom(`${d.idempotencyKey}:${id}`)}::uuid) as j`.execute(tx)).rows[0]!.j;
        await sql`release savepoint batch_credit`.execute(tx);
        created.push({ employee: person, creditNo: j.credit_no });
      } catch (err) {
        await sql`rollback to savepoint batch_credit`.execute(tx);
        const m = String((err as { message?: string })?.message ?? '');
        skipped.push({ employee: person, note: m.includes('PRET-RL-WORKING-DAY') ? 'Working day' : m.includes('PRET-RL-DUPLICATE') ? 'Already has a credit for this date'
          : m.includes('PRET-SELF-001') ? 'Your own record' : m.includes('PRET-RL-WINDOW') ? 'Outside the request window' : 'Not allowed' });
      }
    }
    return { created, skipped };
  }));
}
export async function setCompensateByPay(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, setCompensateByPaySchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`select app.set_credit_compensation(${d.creditId}::uuid, ${d.compensateByPay}, ${d.hours})`.execute(tx);
    return {};
  }), undefined, SELF_MSG);
}

// ===========================================================================
// P10 calendar / L3 balances / L4 adjustments / L6 overrides
// ===========================================================================
export async function exportLeaveCalendarCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ANY, calendarParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const cal = await calendarFor(tx, p);
    const names = new Map(cal.employees.map((e) => [e.employeeId, e]));
    await exported(tx, 'leave_calendar', cal.entries.length);
    return csvFile('leave-calendar', ['Date', 'Employee', 'Department', 'Session', 'Leave', 'Status'],
      cal.entries.sort((a, b) => a.date.localeCompare(b.date)).map((x) => [csvDate(x.date), names.get(x.employeeId)?.name ?? '', names.get(x.employeeId)?.department ?? '',
        LEAVE_SESSION_LABELS[x.session], x.label, x.status === 'pending' ? 'Pending' : 'Approved']));
  }));
}
export async function exportBalancesCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(TEAM, balanceListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const list = await balanceListFor(tx, p, true);
    await exported(tx, 'leave_balances', list.rows.length, list.rows.map((r) => r.employee.id));
    const headers = ['Employee no.', 'Employee', 'Department', 'Months of service', ...list.types.flatMap((t) => [`${t.code} entitled`, `${t.code} taken`, `${t.code} pending`, `${t.code} available`])];
    return csvFile(`leave-balances-${list.asAt}`, headers, list.rows.map((r) => [r.employee.employeeNo, r.employee.name, r.department.label, r.monthsOfService,
      ...list.types.flatMap((t) => { const c = r.cells[t.id]; return [c?.entitled, c?.taken, c?.pending, c?.available]; })]));
  }));
}
export async function exportAdjustmentsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, adjustmentListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await adjustmentRows(tx, p, true);
    await exported(tx, 'leave_adjustments', rows.length, [...new Set(rows.map((r) => r.employee.id))]);
    return csvFile('leave-adjustments', ['Date', 'Employee no.', 'Employee', 'Type', 'Year', 'Days', 'Reason', 'Attachment', 'By'],
      rows.map((r) => [csvDate(r.date), r.employee.employeeNo, r.employee.name, r.leaveType.name, r.year, r.days, r.reason, r.attachment ? 'Yes' : 'No', r.byName]));
  }));
}
export async function previewAdjustment(input: Input): Promise<ActionResult<AdjustmentPreview>> {
  return runAction(ADMIN, adjustmentPreviewSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const b = (await sql<{ b: R }>`select app.leave_balance_view(${d.employeeId}::uuid, ${d.leaveTypeId}::uuid, ${d.year}, null) as b`.execute(tx)).rows[0]!.b;
    const before = Number(b.balance);
    return { before: d1(before), after: d1(before + (d.direction === 'add' ? d.days : -d.days)) };
  }));
}
export async function requestAdjustmentUpload(input: Input): Promise<ActionResult<UploadIntent>> {
  return runAction(ADMIN, requestAdjustmentUploadSchema, input, async (d, { ctx, accessToken }) =>
    requestUpload(ctx, accessToken, { subject: 'leave_attachment', ownerEmployeeId: d.employeeId, scope: 'adj', originalName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes }),
  { fileId: 'fileName' });
}
export async function adjustBalance(input: Input): Promise<ActionResult<{ id: string; after: string }>> {
  return runAction(ADMIN, adjustBalanceSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
    if ((await myEmployeeId(tx)) === d.employeeId) return fail("You can't adjust your own leave balance.", { employeeId: 'Your own record is excluded.' });
    const dup = (await sql<{ id: string }>`select id::text as id from app.leave_ledger where idempotency_key = ${d.idempotencyKey}::uuid`.execute(tx)).rows[0];
    let id = dup?.id;
    if (!id) {
      if (d.attachmentFileId && !(await sql<{ id: string }>`select id from app.files where id = ${d.attachmentFileId}::uuid and owner_employee_id = ${d.employeeId}::uuid
          and status = 'active' and created_by = app.current_app_user_id()`.execute(tx)).rows[0]) return fail('The upload did not finish. Please upload the file again.', { attachmentFileId: 'Upload again.' });
      id = (await sql<{ id: string }>`insert into app.leave_ledger (employee_id, leave_type_id, leave_year, entry_type, days, effective_date, reason, attachment_file_id,
          idempotency_key, created_by)
        values (${d.employeeId}::uuid, ${d.leaveTypeId}::uuid, ${d.year}, 'adjustment', ${d.direction === 'add' ? d.days : -d.days}, app.today_myt(), ${d.reason},
          ${d.attachmentFileId}::uuid, ${d.idempotencyKey}::uuid, app.current_app_user_id()) returning id::text as id`.execute(tx)).rows[0]!.id;
    }
    const b = (await sql<{ b: R }>`select app.leave_balance_view(${d.employeeId}::uuid, ${d.leaveTypeId}::uuid, ${d.year}, null) as b`.execute(tx)).rows[0]!.b;
    return { id, after: d1(b.balance) };
  }), undefined, SELF_MSG);
}
export async function saveOverride(input: Input): Promise<ActionResult<SaveOverrideResult>> {
  return runAction(ADMIN, saveOverrideSchema, input, async (d, { user, ctx }) => {
    const isSa = hasRole(user, 'SA');
    if (d.floorOverrideReason && !isSa) return fail('Only a Super Admin can override the Employment Act minimum.', { floorOverrideReason: 'Super Admin only.' });
    try {
      return await withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
        if ((await myEmployeeId(tx)) === d.employeeId) return fail("You can't override your own entitlement.", { employeeId: 'Your own record is excluded.' });
        const ent = async () => d1((await sql<{ e: string | null }>`select entitled_days as e from app.leave_entitlements where employee_id = ${d.employeeId}::uuid
            and leave_type_id = ${d.leaveTypeId}::uuid and leave_year = ${d.year}`.execute(tx)).rows[0]?.e);
        const before = await ent();
        await recordFloorOverride(tx, d.leaveTypeId, d.floorOverrideReason, isSa, `Override ${d.year}: ${d.days} days`);
        let id = d.id ?? null;
        if (id) {
          const r = await sql`update app.leave_entitlement_overrides set days = ${d.days}, reason = ${d.reason} where id = ${id}::uuid and is_active`.execute(tx);
          if (!Number(r.numAffectedRows ?? 0)) return NOT_FOUND;
        } else {
          id = (await sql<{ id: string }>`insert into app.leave_entitlement_overrides (employee_id, leave_type_id, leave_year, days, reason, created_by)
              values (${d.employeeId}::uuid, ${d.leaveTypeId}::uuid, ${d.year}, ${d.days}, ${d.reason}, app.current_app_user_id()) returning id`.execute(tx)).rows[0]!.id;
        }
        return { id, before, after: await ent() };
      });
    } catch (e) {
      return floorFail(e, isSa);
    }
  }, undefined, SELF_MSG);
}
export async function removeOverride(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, overrideIdSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const r = (await sql<R>`update app.leave_entitlement_overrides set is_active = false where id = ${d.id}::uuid and is_active
        returning employee_id, leave_type_id, leave_year`.execute(tx)).rows[0];
    if (!r) return NOT_FOUND;
    await sql`select app.regenerate_entitlements(${r.leave_year}, ${r.employee_id}::uuid)`.execute(tx);
    return {};
  }), undefined, SELF_MSG);
}
export async function exportOverridesCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, overrideListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await overrideRows(tx, p, true);
    await exported(tx, 'leave_overrides', rows.length, [...new Set(rows.map((r) => r.employee.id))]);
    return csvFile('entitlement-overrides', ['Employee no.', 'Employee', 'Type', 'Year', 'Days', 'Band value', 'Reason', 'Entered by', 'Entered at'],
      rows.map((r) => [r.employee.employeeNo, r.employee.name, r.leaveType.name, r.year, r.days, r.bandValue, r.reason, r.enteredByName, csvDateTime(r.enteredAt)]));
  }));
}

// ===========================================================================
// L13 Year-end
// ===========================================================================
async function previewRun(tx: Tx, year: number): Promise<{ id: string; at: Date }> {
  const recent = (await sql<{ id: string; at: Date }>`select id, previewed_at as at from app.rollover_runs where closing_year = ${year} and status = 'previewed'
      and previewed_by = app.current_app_user_id() and previewed_at > now() - interval '10 minutes' order by previewed_at desc limit 1`.execute(tx)).rows[0];
  if (recent) return recent;
  const id = (await sql<{ id: string }>`select app.rollover_preview(${year}) as id`.execute(tx)).rows[0]!.id;
  return { id, at: new Date() };
}
async function rolloverLines(tx: Tx, runId: string, p: z.output<typeof rolloverPreviewParamsSchema>, all: boolean) {
  const q = p.q ? `%${p.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const where = sql`l.run_id = ${runId}::uuid ${p.onlyForfeiting ? sql`and l.forfeited > 0` : sql``}
    ${p.departmentIds?.length ? sql`and e.department_id = any(${p.departmentIds}::uuid[])` : sql``}
    ${q ? sql`and (e.full_name ilike ${q} or e.employee_no ilike ${q})` : sql``}`;
  const limit = all ? 100_000 : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const from = sql`app.rollover_lines l join app.employees e on e.id = l.employee_id join app.departments d on d.id = e.department_id join app.leave_types t on t.id = l.leave_type_id`;
  const rows = await sql<R>`select l.*, e.employee_no, e.full_name, e.preferred_name, d.name as dept, t.code, t.name as type_name, t.category::text as category, t.calendar_colour as colour
      from ${from} where ${where} order by e.full_name, t.display_order limit ${limit} offset ${offset}`.execute(tx);
  const tot = (await sql<R>`select count(*)::int as n, count(distinct l.employee_id)::int as emps, coalesce(sum(l.carry_forward), 0) as cf, coalesce(sum(l.forfeited), 0) as ff
      from ${from} where ${where}`.execute(tx)).rows[0]!;
  return { rows: rows.rows.map((r) => ({ employee: { id: r.employee_id, employeeNo: r.employee_no, name: r.preferred_name ? `${r.full_name} (${r.preferred_name})` : r.full_name },
      department: r.dept, leaveType: { id: r.leave_type_id, code: r.code, name: r.type_name, category: r.category, colour: r.colour },
      closingBalance: d1(r.closing_balance), carryForward: d1(r.carry_forward), forfeited: d1(r.forfeited), cfExpiry: r.cf_expiry_date, newYearEntitlement: d1(r.new_year_entitlement) })),
    total: tot.n, totals: { employees: tot.emps, carried: d1(tot.cf), forfeited: d1(tot.ff) } };
}
export async function previewRollover(params: Input): Promise<ActionResult<RolloverPreview>> {
  return runAction(ADMIN, rolloverPreviewParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const run = await previewRun(tx, p.closingYear);
    const l = await rolloverLines(tx, run.id, p, false);
    return { runId: run.id, closingYear: p.closingYear, previewedAt: new Date(run.at).toISOString(), rows: l.rows, total: l.total, page: p.page, pageSize: p.pageSize, totals: l.totals };
  }));
}
export async function runRollover(input: Input): Promise<ActionResult<RunRolloverResult>> {
  return runAction(ADMIN, runRolloverSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const j = (await sql<{ j: R }>`select app.rollover_commit(${d.runId}::uuid) as j`.execute(tx)).rows[0]!.j;
    const s = j.summary ?? {};
    const when = j.committed_at ? new Date(j.committed_at).toISOString() : null;
    return { runId: j.run_id, alreadyRun: !!j.already_run, employees: Number(s.employees ?? 0), carried: d1(s.carried), forfeited: d1(s.forfeited),
      message: j.already_run ? `Already run${when ? ` on ${csvDateTime(when)}` : ''}${j.committed_by ? ` by ${j.committed_by}` : ''} — running again changes nothing.`
        : `Carried forward ${d1(s.carried)} days, forfeited ${d1(s.forfeited)} days for ${Number(s.employees ?? 0)} employees and generated ${d.closingYear + 1} entitlements.` };
  }));
}
export async function exportRolloverCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, rolloverPreviewParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const run = await previewRun(tx, p.closingYear);
    const l = await rolloverLines(tx, run.id, p, true);
    await exported(tx, 'rollover_preview', l.rows.length);
    return csvFile(`year-end-${p.closingYear}`, ['Employee no.', 'Employee', 'Department', 'Type', 'Closing balance', 'Carry-forward', 'Forfeited', 'CF expiry', 'New-year entitlement'],
      l.rows.map((r) => [r.employee.employeeNo, r.employee.name, r.department, r.leaveType.name, r.closingBalance, r.carryForward, r.forfeited, csvDate(r.cfExpiry), r.newYearEntitlement]));
  }));
}

// ===========================================================================
// E2 opening leave (F-LV-35) / E7 leaver (F-LV-27) / E3 tab
// ===========================================================================
export async function fetchOpeningLeaveForm(input: Input): Promise<ActionResult<OpeningLeaveForm>> {
  return runAction(ADMIN, openingLeaveFormSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const today = await todayMyt(tx);
    const year = Number(today.slice(0, 4));
    const pol = await policyOf(tx);
    const types = (await sql<R>`select t.*, t.category::text as category, t.entitlement_method::text as entitlement_method, t.eligible_gender::text as eligible_gender
        from app.leave_types t where t.is_active and (t.entitlement_method = 'annual_banded' or (t.entitlement_method = 'no_entitlement' and t.annual_cap_days is not null))
        order by t.display_order`.execute(tx)).rows.filter((t) => !d.gender || t.eligible_gender === 'all' || t.eligible_gender === d.gender);
    const rows: OpeningLeaveForm['rows'] = [];
    for (const t of types) {
      const c = (await sql<{ c: R | null }>`select app.preview_entitlement(${t.id}::uuid, ${year}, ${d.joinDate}::date, ${d.continuousServiceDate ?? d.joinDate}::date,
          ${d.gradeId}::uuid, ${d.gender ?? null}::app.gender) as c`.execute(tx)).rows[0]?.c;
      rows.push({ leaveType: { id: t.id, code: t.code, name: t.name, category: t.category, colour: t.calendar_colour, entitlementMethod: t.entitlement_method },
        entitlementThisYear: d1(c?.entitled), carryForwardAllowed: t.carry_forward_allowed });
    }
    const pl = (await sql<{ id: string }>`select id from app.leave_types where category = 'paternity' and is_active limit 1`.execute(tx)).rows[0]?.id ?? null;
    const months = pol.carryForwardExpiryMonths;
    return { applicable: d.joinDate < today && Number(d.joinDate.slice(0, 4)) === year, year,
      defaultCfExpiry: new Date(Date.UTC(year, months, 0)).toISOString().slice(0, 10), rows, paternityTypeId: d.gender === 'female' ? null : pl,
      engine: { rounding: pol.rounding, basis: pol.prorateBasis, eaFloor: pol.eaFloorForJoinersLeavers } };
  }));
}
export async function saveOpeningLeave(input: Input): Promise<ActionResult<{ entries: number }>> {
  return runAction(ADMIN, saveOpeningLeaveSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: 'Opening balances (F-LV-35)' }, async (tx) => {
    const payload = { rows: d.rows.map((r) => ({ leave_type_id: r.leaveTypeId, taken_this_year: r.takenThisYear, carry_forward: r.carryForward, carry_forward_expiry: r.carryForwardExpiry })),
      credits: d.credits.map((c) => ({ date_worked: c.dateWorked, days: c.days, expiry_date: c.expiryDate })), paternity_occurrences_used: d.paternityOccurrencesUsed };
    const n = (await sql<{ n: number }>`select app.save_opening_leave(${d.employeeId}::uuid, ${JSON.stringify(payload)}::jsonb) as n`.execute(tx)).rows[0]?.n ?? 0;
    return { entries: n };
  }), undefined, SELF_MSG);
}
export async function fetchLeaverPosition(input: Input): Promise<ActionResult<{ position: LeaverPosition | null }>> {
  return runAction(ADMIN, z.object({ employeeId: uuidSchema, lastWorkingDay: isoDateSchema }), input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => ({ position: await leaverPositionFor(tx, d.employeeId, d.lastWorkingDay) })));
}
export async function searchLeaveEmployees(input: Input): Promise<ActionResult<{ rows: LeaveEmployeeOption[] }>> {
  return runAction(ADMIN, leaveEmployeeOptionsSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const q = d.q ? `%${d.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const r = await sql<R>`select e.id, e.employee_no, e.full_name, e.preferred_name, e.status::text as status, d.name as dept from app.employees e
        join app.departments d on d.id = e.department_id
       where e.id is distinct from app.current_employee_id()
         and e.status in ('on_probation','confirmed','notice_period' ${d.includeSeparated ? sql`, 'separated'` : sql``})
         ${q ? sql`and (e.full_name ilike ${q} or e.preferred_name ilike ${q} or e.employee_no ilike ${q})` : sql``}
       order by e.full_name limit ${d.limit}`.execute(tx);
    return { rows: r.rows.map((x) => ({ id: x.id, employeeNo: x.employee_no, name: x.preferred_name ? `${x.full_name} (${x.preferred_name})` : x.full_name,
      department: x.dept, status: x.status, tag: x.status === 'separated' ? 'Separated — HR only' : null })) };
  }));
}
export async function fetchEmployeeLeaveTab(input: Input): Promise<ActionResult<{ tab: EmployeeLeaveTab | null }>> {
  return runAction(ADMIN, z.object({ employeeId: uuidSchema, year: z.coerce.number().int().min(2000).max(2100).optional() }), input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => ({ tab: await employeeLeaveTab(tx, d.employeeId, d.year) })));
}
export async function fetchMyBalances(input: Input): Promise<ActionResult<{ balances: MyBalances | null }>> {
  return runAction(ANY, balancesYearSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const me = await myEmployeeId(tx);
    return { balances: me ? await balancesFor(tx, me, d.year) : null };
  }));
}

// ===========================================================================
// Q-F1 … Q-F4
// ===========================================================================
export async function searchColleagues(input: Input): Promise<ActionResult<{ rows: ColleagueOption[] }>> {
  return runAction(ANY, colleagueOptionsSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const q = d.q ? `%${d.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const r = await sql<R>`select employee_id, employee_no, full_name, preferred_name, position_title from app.employee_directory
        where is_listed and employee_id is distinct from app.current_employee_id()
          ${q ? sql`and (full_name ilike ${q} or preferred_name ilike ${q} or employee_no ilike ${q})` : sql``}
        order by full_name limit ${d.limit}`.execute(tx);
    return { rows: r.rows.map((x) => ({ id: x.employee_id, employeeNo: x.employee_no, name: x.preferred_name ? `${x.full_name} (${x.preferred_name})` : x.full_name,
      position: x.position_title })) };
  }));
}
export async function getCreditAttachmentUrl(input: Input): Promise<ActionResult<{ url: string; fileName: string }>> {
  return runAction(ANY, creditAttachmentUrlSchema, input, async (d, { ctx, accessToken }) => {
    const f = await withUserTx(ctx, async (tx) => (await sql<{ f: string | null }>`select attachment_file_id as f from app.replacement_credits where id = ${d.creditId}::uuid`.execute(tx)).rows[0]?.f);
    if (!f) return NOT_FOUND;
    return getDownloadUrl(ctx, accessToken, f, { purpose: 'download' });
  });
}
export async function getAdjustmentAttachmentUrl(input: Input): Promise<ActionResult<{ url: string; fileName: string }>> {
  return runAction(ANY, adjustmentAttachmentUrlSchema, input, async (d, { ctx, accessToken }) => {
    const f = await withUserTx(ctx, async (tx) => (await sql<{ f: string | null }>`select attachment_file_id as f from app.leave_ledger
        where id = ${d.adjustmentId}::bigint and entry_type = 'adjustment'`.execute(tx)).rows[0]?.f);
    if (!f) return NOT_FOUND;
    return getDownloadUrl(ctx, accessToken, f, { purpose: 'download' });
  });
}
export async function fetchCreditApproverHint(): Promise<ActionResult<{ hint: string | null }>> {
  return runAction(ANY, z.object({}).passthrough(), {}, async (_d, { ctx }) => withUserTx(ctx, async (tx) => {
    const me = await myEmployeeId(tx);
    const wf = (await sql<{ w: string }>`select workflow_id as w from app.leave_types where category = 'replacement' and is_active order by display_order limit 1`.execute(tx)).rows[0]?.w;
    if (!me || !wf) return { hint: null };
    const lv = (await sql<R>`select * from app.workflow_preview(${wf}::uuid, ${me}::uuid)`.execute(tx)).rows;
    const first = lv.find((l) => l.outcome === 'open');
    return { hint: first ? `Goes to ${first.approver ?? 'an Admin'} for approval.` : lv.length ? 'Recorded automatically at level 1.' : null };
  }));
}
