import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getMyProfile, listMyChangeRequests } from '@/server/queries/employees';
import { CR_CATEGORIES, CR_STATUSES, type ChangeRequestListParams } from '@/server/contracts/employees';
import { MyChangeRequestsList } from '@/components/employees/portal/MyLists';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import { CR_SORTS, MY_CR_FILTERS, isoOrUndef, pickList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'My change requests' };
export const dynamic = 'force-dynamic';

// P18 · S-PT-18 · /my/profile/change-requests — own requests only (server-scoped).
export default async function MyChangeRequestsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  if (!(await getMyProfile())) return <NoEmployeeRecord />;
  const lp = readListParams(await searchParams, { filters: MY_CR_FILTERS, sort: { key: 'submittedAt', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, CR_SORTS);
  const params: ChangeRequestListParams = {
    ...pp,
    dir: pp.sort ? pp.dir : 'desc',
    statuses: pickList(f.statuses, CR_STATUSES) ?? [...CR_STATUSES],
    categories: pickList(f.categories, CR_CATEGORIES),
    submittedFrom: isoOrUndef(f.submittedFrom),
    submittedTo: isoOrUndef(f.submittedTo),
  };
  const list = await listMyChangeRequests(params);
  return <MyChangeRequestsList rows={list.rows} total={list.total} params={params} />;
}
