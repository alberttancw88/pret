import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listChangeRequests } from '@/server/queries/employees';
import { CR_CATEGORIES, CR_STATUSES, type ChangeRequestListParams } from '@/server/contracts/employees';
import { ChangeRequestsQueue } from '@/components/employees/ChangeRequests';
import { CR_FILTERS, CR_SORTS, isoOrUndef, pickList, uuidOrUndef } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Change requests' };
export const dynamic = 'force-dynamic';

// E12 · S-EM-12 · /employees/change-requests — Admin and Super Admin.
export default async function ChangeRequestsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: CR_FILTERS, sort: { key: 'submittedAt', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, CR_SORTS);
  const params: ChangeRequestListParams = {
    ...pp,
    dir: pp.sort ? pp.dir : 'desc',
    statuses: pickList(f.statuses, CR_STATUSES) ?? [...CR_STATUSES],
    categories: pickList(f.categories, CR_CATEGORIES),
    submittedFrom: isoOrUndef(f.submittedFrom),
    submittedTo: isoOrUndef(f.submittedTo),
    employeeId: uuidOrUndef(f.employeeId),
  };
  const list = await listChangeRequests(params);
  return <ChangeRequestsQueue rows={list.rows} total={list.total} params={params} />;
}
