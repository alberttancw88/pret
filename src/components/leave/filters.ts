// URL filter defaults + allowed sort keys for the W2-004 lists (server- and client-safe).
// Pages read them with readListParams(); list components keep them in the URL with useServerList().

/** P3 · My leave applications. */
export const MY_LEAVE_FILTERS = { q: '', year: '', leaveTypeIds: '', statuses: '', from: '', to: '' };
export const MY_LEAVE_SORTS = ['from', 'submitted', 'status', 'type'] as const;

/** L1 · Leave applications (ADM/SA /leave/applications; MGR /team/leave). '' statuses → default all except Withdrawn. */
export const LEAVE_APP_FILTERS = {
  q: '',
  employeeId: '',
  employeeName: '',
  locationIds: '',
  departmentIds: '',
  from: '',
  to: '',
  leaveTypeIds: '',
  statuses: '',
  emergencyOnly: '',
  onBehalfOnly: '',
  appliedFrom: '',
  appliedTo: '',
  level: '',
  mcFilters: '',
  includeSeparated: '',
  when: '',
};
export const LEAVE_APP_SORTS = ['applied', 'from', 'employee', 'type', 'status'] as const;

/** P9 · My credits / L7 · Replacement credits. */
export const MY_CREDIT_FILTERS = { q: '', year: '', statuses: '', expiringWithin: '' };
export const CREDIT_FILTERS = { q: '', statuses: '', from: '', to: '', departmentIds: '', expiringWithin: '' };
export const CREDIT_SORTS = ['dateWorked', 'creditNo', 'expiry', 'employee'] as const;

/** P6 · Ledger. */
export const LEDGER_FILTERS = { q: '', year: '', transactions: '', from: '', to: '' };

/** L3 · Balances. */
export const BALANCE_FILTERS = { q: '', asAt: '', departmentIds: '', locationIds: '', leaveTypeIds: '', employmentStatus: 'active' };

/** L4 · Adjustments. */
export const ADJUSTMENT_FILTERS = { q: '', employeeId: '', employeeName: '', leaveTypeIds: '', year: '', from: '', to: '', reasonContains: '' };
export const ADJUSTMENT_SORTS = ['date', 'employee'] as const;

/** L6 · Overrides. */
export const OVERRIDE_FILTERS = { q: '', employeeId: '', employeeName: '', leaveTypeIds: '', year: '' };
export const OVERRIDE_SORTS = ['employee', 'year'] as const;

/** L8 · Leave types. */
export const LEAVE_TYPE_FILTERS = { q: '', categories: '', active: 'all' };
export const LEAVE_TYPE_SORTS = ['order', 'code', 'name', 'category'] as const;

/** L12 · Workflows. */
export const WORKFLOW_FILTERS = { q: '', active: 'all' };

/** L14 · Delegations. */
export const DELEGATION_FILTERS = { q: '', approverUserId: '', approverName: '', delegateUserId: '', delegateName: '', activeOn: '', scopes: '', states: '' };
export const DELEGATION_SORTS = ['from', 'approver', 'delegate'] as const;

/** P26 · Approvals inbox (tab kept in the URL too). onlyMine default on. */
export const INBOX_FILTERS = { q: '', departmentIds: '', locationIds: '', leaveTypeIds: '', from: '', to: '', emergencyOnly: '', onlyMine: 'yes' };
export const INBOX_SORTS = ['applied', 'from', 'employee', 'waiting'] as const;

/** L13 · Year-end preview. */
export const ROLLOVER_FILTERS = { q: '', departmentIds: '', onlyForfeiting: '' };

/** P10 · Calendar. */
export const CALENDAR_FILTERS = { q: '', month: '', view: 'month', departmentIds: '', locationIds: '', holidayLocationId: '', leaveTypeIds: '', includePending: '' };

const YEAR_RE = /^\d{4}$/;
export const yearOrUndef = (v: string) => (YEAR_RE.test(v) ? Number(v) : undefined);
export const yesNo = (v: string) => v === 'yes';
