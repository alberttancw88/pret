// PRET contract — generic approval engine (W2-004; claims join in W2-005). ADR-0004, data-model §8,
// rls-policies §3 (can_act_on_task), §5.5, §7 (no self-approval). Screens: P26 Approvals inbox, P30 Decision
// dialog (single + bulk), L14 Delegations & reassignment, G6 Account settings → Delegation tab.
// Types + zod only (client-safe). Implementations:
//   queries → src/server/queries/approvals.ts   actions → src/server/actions/approvals.ts ('use server')
//
// One approval task = one level of one subject. The database decides who may act
// (app.can_act_on_task): the assignee, the original assignee, an active delegate (scope Leave/Both),
// a pool member (Any Admin / Super Admin), or an Admin as "Admin override" (comment required).
// Nobody can decide an item about themselves — in any role, including as delegate (eight layers, rls §7).
import { z } from 'zod';
import { booleanSchema, isoDateSchema, multi, optionalText, pageParamsSchema, requiredText, uuidSchema } from './common';

export * from './common';

const labels = <T extends string>(m: Record<T, string>) => m;

// ===========================================================================
// Enums (data-model §3 — Approvals)
// ===========================================================================
export const APPROVER_SOURCES = ['direct_manager', 'leave_approver_override', 'managers_manager', 'specific_employee', 'admin_pool', 'super_admin_pool', 'claim_pool'] as const;
export type ApproverSource = (typeof APPROVER_SOURCES)[number];
/** Sources selectable in an L12 workflow level (claim_pool is fixed for claims, D12). */
export const WORKFLOW_APPROVER_SOURCES = ['direct_manager', 'leave_approver_override', 'managers_manager', 'specific_employee', 'admin_pool', 'super_admin_pool'] as const;
export type WorkflowApproverSource = (typeof WORKFLOW_APPROVER_SOURCES)[number];
export const APPROVER_SOURCE_LABELS = labels<ApproverSource>({
  direct_manager: 'Direct manager', leave_approver_override: 'Leave approver override (F15)', managers_manager: "Manager's manager",
  specific_employee: 'Specific employee', admin_pool: 'Any Admin', super_admin_pool: 'Super Admin', claim_pool: 'Manager or any Admin',
});
/** Short labels for "Direct manager → Any Admin" summaries. */
export const APPROVER_SOURCE_SHORT = labels<ApproverSource>({
  direct_manager: 'Direct manager', leave_approver_override: 'Leave approver', managers_manager: "Manager's manager",
  specific_employee: 'Specific person', admin_pool: 'Any Admin', super_admin_pool: 'Super Admin', claim_pool: 'Manager / Admin',
});

export const TASK_SUBJECTS = ['leave_application', 'leave_cancellation', 'replacement_credit', 'claim', 'change_request', 'disbursement_batch', 'payroll_run', 'statutory_table_version'] as const;
export type TaskSubject = (typeof TASK_SUBJECTS)[number];
export const TASK_SUBJECT_LABELS = labels<TaskSubject>({
  leave_application: 'Leave', leave_cancellation: 'Leave cancellation', replacement_credit: 'Replacement credit', claim: 'Claim',
  change_request: 'Change request', disbursement_batch: 'Disbursement batch', payroll_run: 'Payroll run', statutory_table_version: 'Statutory table',
});

export const TASK_STATUSES = ['open', 'approved', 'rejected', 'skipped', 'superseded', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS = labels<TaskStatus>({
  open: 'Waiting', approved: 'Approved', rejected: 'Rejected', skipped: 'Skipped', superseded: 'Re-routed', cancelled: 'Closed',
});
export const TASK_STATUS_TONE = labels<TaskStatus>({
  open: 'warning', approved: 'success', rejected: 'error', skipped: 'grey', superseded: 'grey', cancelled: 'grey',
});

export const ACTING_AS = ['assignee', 'delegate', 'admin_override', 'rerouted', 'pool_member', 'system_auto'] as const;
export type ActingAs = (typeof ACTING_AS)[number];
export const ACTING_AS_LABELS = labels<ActingAs>({
  assignee: 'Approver', delegate: 'Delegate', admin_override: 'Admin override', rerouted: 'Re-routed approver',
  pool_member: 'Pool member', system_auto: 'System',
});

export const DELEGATION_SCOPES = ['leave', 'claims', 'both'] as const;
export type DelegationScope = (typeof DELEGATION_SCOPES)[number];
export const DELEGATION_SCOPE_LABELS = labels<DelegationScope>({ leave: 'Leave', claims: 'Claims', both: 'Both' });
export const DELEGATION_STATES = ['scheduled', 'active', 'ended'] as const;
export type DelegationState = (typeof DELEGATION_STATES)[number];
export const DELEGATION_STATE_LABELS = labels<DelegationState>({ scheduled: 'Scheduled', active: 'Active', ended: 'Ended' });
export const DELEGATION_STATE_TONE = labels<DelegationState>({ scheduled: 'info', active: 'success', ended: 'grey' });

// ===========================================================================
// Shared views
// ===========================================================================
export type PersonRef = { id: string; employeeNo: string | null; name: string };

/** LA19 approval trail row (P4, P27, P28). */
export type ApprovalTrailRow = {
  taskId: string;
  subjectType: TaskSubject;
  level: number;
  source: ApproverSource;
  sourceLabel: string;
  /** resolved approver ("Any Admin" for pools) */
  approverName: string;
  /** "Delegated by …", "Re-routed: approver on leave", "Reassigned by HR: …", "Merged with level 1" */
  routingNote: string | null;
  status: TaskStatus;
  decidedByName: string | null;
  actingAs: ActingAs | null;
  comment: string | null;
  decidedAt: string | null;
  createdAt: string;
};

/** What the current user may do with one open task (decision views). */
export type TaskActionability = {
  taskId: string;
  version: number;
  level: number;
  /** true → APPROVE / REJECT */
  canDecide: boolean;
  /** true → only as Admin override (comment/reason required) — UXQ-10 */
  overrideOnly: boolean;
  /** true when the user acts as an active delegate of the assignee */
  asDelegate: boolean;
  /** the reason the user cannot act ("You can't decide your own leave.") */
  blockedReason: string | null;
};

// ===========================================================================
// P30 Decision dialog — single and bulk (BR-LV-64)
// ===========================================================================
export const DECISIONS = ['approve', 'reject'] as const;
export type Decision = (typeof DECISIONS)[number];

export const decideTaskSchema = z.object({
  taskId: uuidSchema,
  decision: z.enum(DECISIONS),
  /** approve: optional (0/500) · reject: required (≥ 5 chars) · admin override: required */
  comment: optionalText(500, 'Comment'),
  /** optimistic lock: the task version the user saw (first decision wins) */
  expectedVersion: z.coerce.number().int().min(1),
  /** the user confirmed acting as Admin override (BR-LV-62) */
  asOverride: booleanSchema.default(false),
}).superRefine((v, ctx) => {
  if (v.decision === 'reject' && (!v.comment || v.comment.length < 5))
    ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Add a comment to reject (at least 5 characters).' });
  if (v.asOverride && (!v.comment || v.comment.length < 5))
    ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Give the reason for the Admin override (at least 5 characters).' });
});
export type DecideTaskInput = z.input<typeof decideTaskSchema>;

export type DecisionOutcome =
  | 'approved'          // final approval (subject Approved / credit Approved / cancellation Cancelled)
  | 'moved_to_next'     // level k approved → level k+1 opened
  | 'rejected'
  | 'skipped';          // bulk only: not actionable for this user
export type DecideTaskResult = {
  outcome: DecisionOutcome;
  subjectType: TaskSubject;
  reference: string;               // LV-…, RL-…
  /** "Moved to level 2 (Any Admin)" / "Approved" / "Rejected" */
  message: string;
  nextLevel: number | null;
};

export const bulkDecideSchema = z.object({
  taskIds: z.array(uuidSchema).min(1, 'Select at least one item.').max(100, 'At most 100 items at a time.'),
  decision: z.enum(DECISIONS),
  comment: optionalText(500, 'Comment'),
}).superRefine((v, ctx) => {
  if (v.decision === 'reject' && (!v.comment || v.comment.length < 5))
    ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Add a comment to decline (at least 5 characters).' });
});
export type BulkDecideInput = z.input<typeof bulkDecideSchema>;
export type BulkDecisionRow = {
  taskId: string;
  reference: string;
  employeeName: string;
  /** ✓ Approved / ⤳ Moved to L2 / ✕ Rejected / ✕ Skipped */
  outcome: DecisionOutcome;
  /** "Your own leave" / "Already decided by … at dd/mm/yyyy HH:mm" / "Not at your level" */
  note: string | null;
};
export type BulkDecisionResult = { rows: BulkDecisionRow[]; approved: number; moved: number; rejected: number; skipped: number };

// ===========================================================================
// P26 Approvals inbox (leave parts; claims tabs arrive with W2-005)
// ===========================================================================
export const INBOX_TABS = ['leave', 'cancellations', 'credits', 'claims', 'claims_approved', 'batches'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];
export const INBOX_TAB_LABELS = labels<InboxTab>({
  leave: 'Leave', cancellations: 'Cancellations', credits: 'Replacement credits', claims: 'Claims',
  claims_approved: 'Approved claims – not disbursed', batches: 'Batches & runs',
});

export const inboxParamsSchema = pageParamsSchema.extend({
  tab: z.enum(INBOX_TABS).default('leave'),
  departmentIds: multi(uuidSchema),
  locationIds: multi(uuidSchema),
  leaveTypeIds: multi(uuidSchema),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  emergencyOnly: booleanSchema.default(false),
  /** default true; ADM/SA turn it off to see every pending item (override) */
  onlyMine: booleanSchema.default(true),
  sort: z.enum(['applied', 'from', 'employee', 'waiting']).default('applied'),
});
export type InboxParams = z.input<typeof inboxParamsSchema>;

/** Tab badges = actionable counts for the current user. claims tabs: 0 until W2-005. */
export type InboxCounts = Record<InboxTab, number>;

export type InboxLeaveRow = {
  taskId: string; taskVersion: number;
  applicationId: string; refNo: string;                       // link → /approvals/leave/{refNo}
  employee: PersonRef; department: string;
  leaveType: { id: string; code: string; name: string; colour: string };
  startDate: string; startSession: 'full' | 'am' | 'pm'; endDate: string; endSession: 'full' | 'am' | 'pm';
  days: string;                                               // 1 dp
  reason: string | null;
  attachmentCount: number;                                    // 📎
  isEmergency: boolean;
  appliedAt: string;
  level: number; levels: number;                              // "L1" of n
  waitingWorkingDays: number;
  /** false → shown for override / information only (not selectable for bulk) */
  canDecide: boolean;
  overrideOnly: boolean;
};
export type InboxCancellationRow = {
  taskId: string; taskVersion: number;
  applicationId: string; refNo: string;
  employee: PersonRef; department: string;
  leaveType: { id: string; code: string; name: string; colour: string };
  startDate: string; endDate: string; days: string;
  requestedAt: string; reason: string | null; waitingWorkingDays: number;
  canDecide: boolean; overrideOnly: boolean;
};
export type InboxCreditRow = {
  taskId: string; taskVersion: number;
  creditId: string; creditNo: string;                         // link → /approvals/credits/{creditNo}
  employee: PersonRef; department: string;
  dateWorked: string; dayTypeLabel: string;                   // "Rest day" / "Off day" / "Public holiday: …"
  duration: 'full_day' | 'half_day'; days: string; reason: string;
  submittedAt: string; waitingWorkingDays: number;
  canDecide: boolean; overrideOnly: boolean;
};
export type InboxPage =
  | ({ tab: 'leave' } & { rows: InboxLeaveRow[]; total: number; page: number; pageSize: number })
  | ({ tab: 'cancellations' } & { rows: InboxCancellationRow[]; total: number; page: number; pageSize: number })
  | ({ tab: 'credits' } & { rows: InboxCreditRow[]; total: number; page: number; pageSize: number })
  | ({ tab: 'claims' | 'claims_approved' | 'batches' } & { rows: never[]; total: 0; page: number; pageSize: number; placeholder: string });

// ===========================================================================
// L14 Delegations (ADM/SA, all) and G6 Delegation tab (own — MGR, ADM, SA)
// ===========================================================================
export const delegationListParamsSchema = pageParamsSchema.extend({
  approverUserId: uuidSchema.optional().catch(undefined),
  delegateUserId: uuidSchema.optional().catch(undefined),
  activeOn: isoDateSchema.optional().catch(undefined),
  scopes: multi(z.enum(DELEGATION_SCOPES)),
  states: multi(z.enum(DELEGATION_STATES)),
  sort: z.enum(['from', 'approver', 'delegate']).default('from'),
});
export type DelegationListParams = z.input<typeof delegationListParamsSchema>;
export type DelegationRow = {
  id: string;
  approver: PersonRef;                 // delegator
  delegate: PersonRef;
  validFrom: string; validTo: string;
  scope: DelegationScope;
  setBy: 'self' | 'admin'; setByName: string;
  state: DelegationState;
  cancelledAt: string | null; cancelledByName: string | null;
  createdAt: string;
  /** EDIT (future only) / END NOW (scheduled or active) */
  canEdit: boolean; canEnd: boolean;
};

/** G6 ADD DELEGATE (own) — delegatorUserId omitted. L14 ADD DELEGATION (ADM/SA) — delegatorUserId required. */
export const saveDelegationSchema = z.object({
  /** EDIT = end the old one and create the replacement in one transaction (delegations are cancel-only rows) */
  replaceId: uuidSchema.optional().catch(undefined),
  delegatorUserId: uuidSchema.optional(),
  delegateUserId: uuidSchema,
  validFrom: isoDateSchema,
  validTo: isoDateSchema,
  scope: z.enum(DELEGATION_SCOPES, { error: 'Select the scope.' }),
}).refine((v) => v.validTo >= v.validFrom, { path: ['validTo'], message: 'To must be on or after From.' })
  .refine((v) => v.delegatorUserId !== v.delegateUserId, { path: ['delegateUserId'], message: "You can't delegate to the same person." });
export type SaveDelegationInput = z.input<typeof saveDelegationSchema>;
export const endDelegationSchema = z.object({ id: uuidSchema });
export type EndDelegationInput = z.input<typeof endDelegationSchema>;

/** Delegate / approver pickers: active employee users (and internal ADM users) — never External (BR-ADM-04). */
export const approverOptionsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  excludeUserId: uuidSchema.optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ApproverOptionsInput = z.input<typeof approverOptionsSchema>;
export type ApproverOption = { userId: string; employeeId: string | null; employeeNo: string | null; name: string; position: string | null; isAdmin: boolean };

/** L14 panel "Approvers on leave today without a delegate" (BR-LV-61, informational). */
export type ApproverOnLeaveRow = { approver: PersonRef; leaveUntil: string; openItems: number; reroutedTo: string };

// L14 Reassign pending items (UXQ-05)
export const REASSIGN_ITEM_TYPES = ['leave', 'cancellations', 'credits', 'claims'] as const;
export type ReassignItemType = (typeof REASSIGN_ITEM_TYPES)[number];
export const REASSIGN_ITEM_TYPE_LABELS = labels<ReassignItemType>({ leave: 'Leave', cancellations: 'Cancellations', credits: 'Credits', claims: 'Claims' });
export const reassignSchema = z.object({
  fromUserId: uuidSchema,
  toUserId: uuidSchema,
  itemTypes: z.array(z.enum(REASSIGN_ITEM_TYPES)).min(1, 'Select at least one item type.'),
  reason: requiredText(500, 'Reason').refine((s) => s.length >= 10, 'Reason must be at least 10 characters.'),
}).refine((v) => v.fromUserId !== v.toUserId, { path: ['toUserId'], message: 'Choose a different approver.' });
export type ReassignInput = z.input<typeof reassignSchema>;
export const reassignPreviewSchema = z.object({ fromUserId: uuidSchema, toUserId: uuidSchema.optional().catch(undefined), itemTypes: z.array(z.enum(REASSIGN_ITEM_TYPES)).default(['leave', 'cancellations', 'credits']) });
export type ReassignPreviewInput = z.input<typeof reassignPreviewSchema>;
export type ReassignPreview = {
  count: number;
  /** items of which the new approver is the applicant — listed and skipped */
  skipped: { reference: string; employeeName: string; note: string }[];
  items: { reference: string; subjectType: TaskSubject; employeeName: string; level: number }[];
};
export type ReassignResult = { reassigned: number; skipped: { reference: string; note: string }[] };

// ===========================================================================
// FUNCTION REGISTER (exact names and signatures — implementations must match)
// ===========================================================================
// QUERIES — src/server/queries/approvals.ts (server-only; requireUser([...]) → withUserTx)
//   getInboxCounts(): Promise<InboxCounts>                                                      [MGR, ADM, SA] (EMP-only users: all 0)
//   listInbox(p: InboxParams): Promise<InboxPage>                                               [MGR, ADM, SA]
//   listDelegations(p: DelegationListParams): Promise<Paged<DelegationRow>>                     [ADM, SA]  (L14 — everyone's)
//   listMyDelegations(): Promise<DelegationRow[]>                                               [MGR, ADM, SA] (G6 — own, as delegator or delegate)
//   listApproversOnLeaveToday(): Promise<ApproverOnLeaveRow[]>                                  [ADM, SA]
//
// SERVER ACTIONS — src/server/actions/approvals.ts ('use server')
//   P30 decideTask(i: DecideTaskInput): Promise<ActionResult<DecideTaskResult>>                 [MGR, ADM, SA] (DB: app.decide_task — not own; first decision wins)
//       bulkDecide(i: BulkDecideInput): Promise<ActionResult<BulkDecisionResult>>               [MGR, ADM, SA] (per item; desktop only)
//   P26 exportInboxCsv(p: InboxParams): Promise<ActionResult<CsvFile>>                          [MGR, ADM, SA]
//       fetchInboxCounts(): Promise<ActionResult<{ counts: InboxCounts }>>                      [MGR, ADM, SA] (badge refresh)
//   G6  saveMyDelegation(i: SaveDelegationInput): Promise<ActionResult<{ id: string }>>         [MGR, ADM, SA] (own; N-17)
//       endMyDelegation(i: EndDelegationInput): Promise<ActionResult>                           [MGR, ADM, SA] (own)
//   L14 saveDelegation(i: SaveDelegationInput): Promise<ActionResult<{ id: string }>>           [ADM, SA] (on behalf of an approver; N-17)
//       endDelegation(i: EndDelegationInput): Promise<ActionResult>                             [ADM, SA]
//       exportDelegationsCsv(p: DelegationListParams): Promise<ActionResult<CsvFile>>           [ADM, SA]
//       previewReassign(i: ReassignPreviewInput): Promise<ActionResult<ReassignPreview>>        [ADM, SA]
//       reassignPendingItems(i: ReassignInput): Promise<ActionResult<ReassignResult>>           [ADM, SA] (trail: "Reassigned by HR: reason")
//   client-callable while typing:
//       searchApproverOptions(i: ApproverOptionsInput): Promise<ActionResult<{ rows: ApproverOption[] }>>  [MGR, ADM, SA]
//
// Error messages the UI may branch on (ActionFail.error is a readable sentence):
//   own item → "You can't decide your own request." · already decided → "Already decided by {name} at dd/mm/yyyy HH:mm." ·
//   not eligible → "This item is not waiting for you." · reject without comment → fieldErrors.comment ·
//   overlapping delegation → fieldErrors.validFrom "You already have a delegate for these dates."
