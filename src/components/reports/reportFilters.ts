// R4 report filters (wireframes-reports.md §R4) — one definition per report. Every filter key is the
// contract parameter name (src/server/contracts/reports.ts REPORT_PARAM_SCHEMAS), kept in the URL as a
// string ('' = not set; multi-selects are comma lists; booleans 'true'). Server-safe (no React).
import type { ReportFilterOptions, ReportId } from '@/server/contracts/reports';
import {
  COMPLETENESS_CATEGORIES,
  COMPLETENESS_CATEGORY_LABELS,
  HEADCOUNT_GROUP_BY,
  HEADCOUNT_GROUP_BY_LABELS,
  PROBATION_WINDOWS,
} from '@/server/contracts/reports';
import { EMPLOYMENT_STATUS_LABELS } from '@/server/contracts/employees';
import { CREDIT_STATUS_LABELS, LEAVE_STATUS_LABELS } from '@/server/contracts/leave';
import { BATCH_STATUS_LABELS, CLAIM_STATUS_LABELS } from '@/server/contracts/claims';

export type Opt = { value: string; label: string };
/** Option lists filled by getReportFilterOptions. */
export type OptionSource = 'departments' | 'locations' | 'leaveTypes' | 'claimCategories' | 'batches' | 'separationTypes' | 'employees';

export type FilterDef =
  | { kind: 'keyword'; key: 'q'; hint: string }
  | { kind: 'select'; key: string; label: string; options: Opt[]; required?: boolean; noClear?: boolean }
  | { kind: 'multi'; key: string; label: string; options?: Opt[]; source?: OptionSource }
  | { kind: 'date'; key: string; label: string; required?: boolean }
  | { kind: 'month'; key: string; label: string; required?: boolean }
  | { kind: 'year'; key: string; label: string; required?: boolean }
  | { kind: 'bool'; key: string; label: string }
  | { kind: 'source'; key: string; label: string; source: OptionSource; required?: boolean }
  | { kind: 'employee'; key: string; label: string; required?: boolean }
  | { kind: 'columns'; key: 'columns'; label: string };

const o = <T extends string>(values: readonly T[], labels: Record<T, string>): Opt[] => values.map((v) => ({ value: v, label: labels[v] }));
const nums = (values: readonly number[], suffix: string): Opt[] => values.map((n) => ({ value: String(n), label: `${n} ${suffix}` }));

const dept: FilterDef = { kind: 'multi', key: 'departmentIds', label: 'Department', source: 'departments' };
const loc: FilterDef = { kind: 'multi', key: 'locationIds', label: 'Work location', source: 'locations' };
const types: FilterDef = { kind: 'multi', key: 'leaveTypeIds', label: 'Leave type', source: 'leaveTypes' };

const ACTIVE_STATUSES = ['pending_join', 'on_probation', 'confirmed', 'notice_period'] as const;
const ALL_STATUSES = [...ACTIVE_STATUSES, 'separated'] as const;
const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'cancellation_pending', 'cancelled'] as const;
const CLAIM_STATUSES = ['submitted', 'approved', 'disbursed', 'rejected', 'withdrawn', 'cancelled'] as const;
const BATCH_STATUSES = ['draft', 'pending_approval', 'approved', 'exported', 'disbursed', 'cancelled'] as const;
const CREDIT_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;

export const REPORT_FILTERS: Record<ReportId, FilterDef[]> = {
  'employee-master': [
    { kind: 'keyword', key: 'q', hint: 'Employee no. or name.' },
    { kind: 'multi', key: 'statuses', label: 'Status', options: o(ALL_STATUSES, EMPLOYMENT_STATUS_LABELS) },
    dept,
    loc,
    { kind: 'date', key: 'joinFrom', label: 'Join date from' },
    { kind: 'date', key: 'joinTo', label: 'Join date to' },
    { kind: 'date', key: 'asAt', label: 'As at' },
    { kind: 'columns', key: 'columns', label: 'Columns' },
  ],
  headcount: [
    { kind: 'date', key: 'asAt', label: 'As at', required: true },
    { kind: 'select', key: 'groupBy', label: 'Group by', options: o(HEADCOUNT_GROUP_BY, HEADCOUNT_GROUP_BY_LABELS), required: true, noClear: true },
    { kind: 'month', key: 'trendFrom', label: 'Trend from (month)' },
    { kind: 'month', key: 'trendTo', label: 'Trend to (month)' },
  ],
  'joiners-leavers': [
    { kind: 'keyword', key: 'q', hint: 'Employee no. or name.' },
    { kind: 'date', key: 'from', label: 'Date from', required: true },
    { kind: 'date', key: 'to', label: 'Date to', required: true },
    dept,
    { kind: 'multi', key: 'separationTypes', label: 'Separation type', source: 'separationTypes' },
    {
      kind: 'select',
      key: 'kind',
      label: 'Show',
      noClear: true,
      options: [
        { value: 'both', label: 'Joiners and leavers' },
        { value: 'joiners', label: 'Joiners' },
        { value: 'leavers', label: 'Leavers' },
      ],
    },
  ],
  'probation-due': [
    { kind: 'keyword', key: 'q', hint: 'Employee no. or name.' },
    { kind: 'select', key: 'withinDays', label: 'Ending within', options: nums(PROBATION_WINDOWS, 'days'), noClear: true },
    { kind: 'bool', key: 'overdueOnly', label: 'Overdue only' },
    dept,
  ],
  'retirement-milestones': [
    { kind: 'keyword', key: 'q', hint: 'Employee no. or name.' },
    { kind: 'select', key: 'windowMonths', label: 'Window', options: nums([3, 6, 12, 24, 36], 'months'), required: true, noClear: true },
    {
      kind: 'select',
      key: 'milestone',
      label: 'Milestone type',
      noClear: true,
      options: [
        { value: 'all', label: 'All milestones' },
        { value: 'retirement', label: 'Retirement' },
        { value: 'service_band', label: 'Service band' },
      ],
    },
  ],
  'data-completeness': [
    { kind: 'keyword', key: 'q', hint: 'Employee no. or name.' },
    dept,
    { kind: 'multi', key: 'statuses', label: 'Status', options: o(ACTIVE_STATUSES, EMPLOYMENT_STATUS_LABELS) },
    { kind: 'select', key: 'missingCategory', label: 'Missing category', options: o(COMPLETENESS_CATEGORIES, COMPLETENESS_CATEGORY_LABELS) },
    { kind: 'bool', key: 'incompleteOnly', label: 'Incomplete only' },
  ],
  'leave-balances': [
    { kind: 'keyword', key: 'q', hint: 'Employee no. or name.' },
    { kind: 'date', key: 'asAt', label: 'As at', required: true },
    dept,
    loc,
    types,
    {
      kind: 'select',
      key: 'employmentStatus',
      label: 'Employment status',
      noClear: true,
      options: [
        { value: 'active', label: 'Active' },
        { value: 'separated', label: 'Separated' },
        { value: 'all', label: 'All (incl. separated)' },
      ],
    },
  ],
  'leave-transactions': [
    { kind: 'keyword', key: 'q', hint: 'Reference or employee name.' },
    {
      kind: 'select',
      key: 'dateBasis',
      label: 'Date basis',
      noClear: true,
      options: [
        { value: 'leave', label: 'Leave dates' },
        { value: 'applied', label: 'Applied dates' },
      ],
    },
    { kind: 'date', key: 'from', label: 'From', required: true },
    { kind: 'date', key: 'to', label: 'To', required: true },
    types,
    { kind: 'multi', key: 'statuses', label: 'Status', options: o(LEAVE_STATUSES, LEAVE_STATUS_LABELS) },
    dept,
    { kind: 'bool', key: 'emergencyOnly', label: 'Emergency only' },
    { kind: 'bool', key: 'onBehalfOnly', label: 'Applied on behalf only' },
  ],
  'leave-summary': [
    { kind: 'year', key: 'year', label: 'Year', required: true },
    { kind: 'select', key: 'monthFrom', label: 'Month from', options: monthNumberOptions(), noClear: true },
    { kind: 'select', key: 'monthTo', label: 'Month to', options: monthNumberOptions(), noClear: true },
  ],
  'whos-on-leave': [
    { kind: 'keyword', key: 'q', hint: 'Employee name.' },
    { kind: 'date', key: 'from', label: 'Date (or from)', required: true },
    { kind: 'date', key: 'to', label: 'To' },
    dept,
    loc,
  ],
  'unpaid-leave': [
    { kind: 'keyword', key: 'q', hint: 'Employee name.' },
    { kind: 'month', key: 'month', label: 'Month', required: true },
    dept,
  ],
  'sick-hospitalisation': [
    { kind: 'keyword', key: 'q', hint: 'Employee name.' },
    { kind: 'year', key: 'year', label: 'Year', required: true },
    dept,
  ],
  'replacement-leave': [
    { kind: 'keyword', key: 'q', hint: 'Employee name or credit no.' },
    { kind: 'date', key: 'from', label: 'Date worked from' },
    { kind: 'date', key: 'to', label: 'Date worked to' },
    { kind: 'multi', key: 'statuses', label: 'Status', options: o(CREDIT_STATUSES, CREDIT_STATUS_LABELS) },
    { kind: 'select', key: 'expiringWithinDays', label: 'Expiring within', options: nums([30, 60, 90], 'days') },
  ],
  'carry-forward': [
    { kind: 'keyword', key: 'q', hint: 'Employee name.' },
    { kind: 'year', key: 'year', label: 'Year', required: true },
  ],
  'leave-individual': [
    { kind: 'employee', key: 'employeeId', label: 'Employee', required: true },
    { kind: 'year', key: 'year', label: 'Year', required: true },
  ],
  'claims-detail': [
    { kind: 'keyword', key: 'q', hint: 'Claim no. or employee name.' },
    {
      kind: 'select',
      key: 'dateBasis',
      label: 'Date basis',
      noClear: true,
      options: [
        { value: 'transaction', label: 'Transaction date' },
        { value: 'application', label: 'Application date' },
        { value: 'approval', label: 'Approval date' },
        { value: 'disbursement', label: 'Disbursement date' },
      ],
    },
    { kind: 'date', key: 'from', label: 'From' },
    { kind: 'date', key: 'to', label: 'To' },
    { kind: 'multi', key: 'categoryIds', label: 'Category', source: 'claimCategories' },
    { kind: 'multi', key: 'statuses', label: 'Status', options: o(CLAIM_STATUSES, CLAIM_STATUS_LABELS) },
    dept,
    { kind: 'source', key: 'batchNo', label: 'Batch', source: 'batches' },
  ],
  'claims-summary': [
    { kind: 'date', key: 'from', label: 'From', required: true },
    { kind: 'date', key: 'to', label: 'To', required: true },
    dept,
    { kind: 'multi', key: 'categoryIds', label: 'Category', source: 'claimCategories' },
  ],
  'approved-not-disbursed': [
    { kind: 'keyword', key: 'q', hint: 'Claim no. or employee name.' },
    { kind: 'date', key: 'asAt', label: 'As at', required: true },
    { kind: 'select', key: 'ageOver', label: 'Age over', options: nums([30, 60, 90], 'days') },
  ],
  'disbursement-batches': [
    { kind: 'keyword', key: 'q', hint: 'Batch no.' },
    { kind: 'date', key: 'from', label: 'Payment date from' },
    { kind: 'date', key: 'to', label: 'Payment date to' },
    { kind: 'month', key: 'month', label: 'Disbursement month' },
    { kind: 'multi', key: 'statuses', label: 'Status', options: o(BATCH_STATUSES, BATCH_STATUS_LABELS) },
  ],
  'claims-tax-treatment': [
    { kind: 'keyword', key: 'q', hint: 'Employee name.' },
    { kind: 'year', key: 'year', label: 'Year', required: true },
    { kind: 'employee', key: 'employeeId', label: 'Employee' },
  ],
};

function monthNumberOptions(): Opt[] {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return names.map((n, i) => ({ value: String(i + 1), label: n }));
}

/** Filter keys of a report plus `run` (heavy reports: set when SEARCH is pressed). */
export function filterKeys(id: ReportId): string[] {
  return [...REPORT_FILTERS[id].map((f) => f.key), 'run'];
}

/** URL defaults ('' everywhere — the backend applies its own defaults, which getReportFilterOptions reports). */
export function emptyFilters(id: ReportId): Record<string, string> {
  return Object.fromEntries(filterKeys(id).map((k) => [k, '']));
}

/** Contract defaults (options.defaults) as URL strings, for pre-filling the filter card. */
export function defaultFilters(id: ReportId, defaults: ReportFilterOptions['defaults'] | undefined): Record<string, string> {
  const out = emptyFilters(id);
  for (const k of Object.keys(out)) {
    const v = defaults?.[k];
    if (v === undefined || v === null) continue;
    out[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  out.run = '';
  return out;
}

const MULTI_KINDS = new Set(['multi', 'columns']);

/**
 * URL filter strings → raw contract params (the Server Action / query validates them with the report's zod schema).
 * page is 1-based in the contract.
 */
export function toReportParams(
  id: ReportId,
  filters: Record<string, string>,
  paging: { page: number; pageSize: number; sort?: { key: string; direction: 'asc' | 'desc' } },
): Record<string, unknown> {
  const out: Record<string, unknown> = { page: paging.page + 1, pageSize: paging.pageSize };
  if (paging.sort) {
    out.sort = paging.sort.key;
    out.dir = paging.sort.direction;
  }
  for (const f of REPORT_FILTERS[id]) {
    const v = filters[f.key];
    if (v === undefined || v === '') continue;
    if (MULTI_KINDS.has(f.kind)) out[f.key] = v.split(',').filter(Boolean);
    else if (f.kind === 'bool') out[f.key] = v === 'true';
    else out[f.key] = v;
  }
  if (filters.run === 'true') out.run = true;
  return out;
}

export function optionsFor(source: OptionSource, options: ReportFilterOptions): Opt[] {
  return (options[source] ?? []).map((x) => ({ value: x.id, label: x.label }));
}
