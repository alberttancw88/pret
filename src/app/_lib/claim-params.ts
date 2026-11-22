// URL → contract params for C1 (/claims, /team/claims). Server- and client-safe.
import { CLAIM_FLAGS, CLAIM_STATUSES, type ClaimListParams } from '@/server/contracts/claims';
import { CLAIM_LIST_FILTERS, CLAIM_LIST_SORTS } from '@/components/claims/filters';
import { isoOrUndef, pickList, uuidList, uuidOrUndef } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export function claimListParams(sp: SearchParamsRecord, admin: boolean): ClaimListParams {
  const lp = readListParams(sp, { filters: CLAIM_LIST_FILTERS, sort: { key: 'submitted', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, CLAIM_LIST_SORTS);
  return {
    ...pp,
    dir: pp.sort ? pp.dir : 'desc',
    view: f.view === 'line' ? 'line' : 'header',
    employeeId: admin ? uuidOrUndef(f.employeeId) : undefined,
    departmentIds: uuidList(f.departmentIds),
    categoryIds: uuidList(f.categoryIds),
    statuses: pickList(f.statuses, CLAIM_STATUSES),
    from: isoOrUndef(f.from),
    to: isoOrUndef(f.to),
    submittedFrom: isoOrUndef(f.submittedFrom),
    submittedTo: isoOrUndef(f.submittedTo),
    decidedFrom: isoOrUndef(f.decidedFrom),
    decidedTo: isoOrUndef(f.decidedTo),
    disbursedFrom: admin ? isoOrUndef(f.disbursedFrom) : undefined,
    disbursedTo: admin ? isoOrUndef(f.disbursedTo) : undefined,
    batchNo: admin && f.batchNo ? f.batchNo : undefined,
    flags: pickList(f.flags, CLAIM_FLAGS),
    onBehalfOnly: f.onBehalfOnly === 'yes',
    includeSeparated: f.includeSeparated === 'yes' ? true : f.includeSeparated === 'no' ? false : undefined,
  };
}
