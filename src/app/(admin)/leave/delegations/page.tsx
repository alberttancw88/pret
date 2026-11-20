import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listApproversOnLeaveToday, listDelegations } from '@/server/queries/approvals';
import { DELEGATION_SCOPES, DELEGATION_STATES, type DelegationListParams } from '@/server/contracts/approvals';
import DelegationsScreen from '@/components/approvals/Delegations';
import { DELEGATION_FILTERS, DELEGATION_SORTS } from '@/components/leave/filters';
import { isoOrUndef, pickList, uuidOrUndef } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Delegations' };
export const dynamic = 'force-dynamic';

// L14 · S-LV-14 · /leave/delegations — Admin and Super Admin: everyone's delegations, reassign pending items,
// approvers on leave today without a delegate.
export default async function DelegationsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: DELEGATION_FILTERS, sort: { key: 'from', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, DELEGATION_SORTS);
  const params: DelegationListParams = {
    ...pp,
    dir: pp.sort ? pp.dir : 'desc',
    approverUserId: uuidOrUndef(f.approverUserId),
    delegateUserId: uuidOrUndef(f.delegateUserId),
    activeOn: isoOrUndef(f.activeOn),
    scopes: pickList(f.scopes, DELEGATION_SCOPES),
    states: pickList(f.states, DELEGATION_STATES),
  };
  const [list, onLeave] = await Promise.all([listDelegations(params), listApproversOnLeaveToday()]);
  return <DelegationsScreen rows={list.rows} total={list.total} params={params} onLeave={onLeave} />;
}
