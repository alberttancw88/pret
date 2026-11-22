// URL filter defaults + allowed sort keys for the W2-005 claims lists (server- and client-safe).
// Pages read them with readListParams(); list components keep them in the URL with useServerList().

/** P12 · My claims. Year default = current (set by the page). */
export const MY_CLAIM_FILTERS = { q: '', statuses: '', categoryIds: '', year: '', from: '', to: '' };
export const MY_CLAIM_SORTS = ['created', 'submitted', 'claimNo', 'total', 'status'] as const;

/** C1 · Claims (ADM/SA /claims; MGR /team/claims). '' statuses → server default (all except New unless on behalf). */
export const CLAIM_LIST_FILTERS = {
  q: '',
  view: 'header',
  employeeId: '',
  employeeName: '',
  departmentIds: '',
  categoryIds: '',
  statuses: '',
  from: '',
  to: '',
  submittedFrom: '',
  submittedTo: '',
  decidedFrom: '',
  decidedTo: '',
  disbursedFrom: '',
  disbursedTo: '',
  batchNo: '',
  flags: '',
  onBehalfOnly: '',
  includeSeparated: '',
};
export const CLAIM_LIST_SORTS = ['submitted', 'claimNo', 'employee', 'total', 'status', 'transaction'] as const;

/** C5 · Categories. */
export const CATEGORY_FILTERS = { q: '', groups: '', active: 'all', taxTreatments: '' };
export const CATEGORY_SORTS = ['order', 'code', 'name', 'group'] as const;

/** C7 · Limits. */
export const LIMIT_FILTERS = { q: '', categoryIds: '', appliesTo: '', effectiveOn: '', behaviours: '' };
export const LIMIT_SORTS = ['category', 'appliesTo', 'from'] as const;

/** C4 · Late overrides. */
export const LATE_OVERRIDE_FILTERS = { q: '', employeeId: '', employeeName: '', from: '', to: '' };
export const LATE_OVERRIDE_SORTS = ['applied', 'employee'] as const;

/** C9 · Batches. */
export const BATCH_FILTERS = { q: '', year: '', month: '', statuses: '' };
export const BATCH_SORTS = ['month', 'batchNo', 'status', 'total'] as const;

/** E3 Claims tab (inside the profile; tab kept in the URL). */
export const EMPLOYEE_CLAIM_FILTERS = { statuses: '', year: '' };

/** P26 claims tabs — extra keys on top of INBOX_FILTERS (leave/filters.ts). */
export const INBOX_CLAIM_FILTERS = { categoryIds: '', amountFrom: '', amountTo: '', flags: '', inBatch: '' };

const MONEY_RE = /^\d{1,7}(\.\d{1,2})?$/;
export const moneyOrUndef = (v: string) => (MONEY_RE.test(v.trim()) ? v.trim() : undefined);
export const monthOrUndef = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : undefined;
};
