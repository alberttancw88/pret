import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getEmployeeGroup, listEmployeeGroups } from '@/server/queries/org';
import type { GroupListParams } from '@/server/contracts/org';
import EmployeeGroupsList from '@/components/org/EmployeeGroupsList';
import { GROUP_FILTERS, isUuid } from '@/components/org/filters';
import { activeParam } from '@/components/org/common';
import { readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Employee groups' };
export const dynamic = 'force-dynamic';

// O10 · S-OR-10 · /organisation/groups — Admin and Super Admin (F-ORG-14, Could).
export default async function EmployeeGroupsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: GROUP_FILTERS, sort: { key: 'name', direction: 'asc' } });
  const params: GroupListParams = { ...toPageParams(lp, ['name'] as const), active: activeParam(lp.filters.active) };
  const editId = spValue(sp, 'edit');
  const [list, detail] = await Promise.all([listEmployeeGroups(params), isUuid(editId) ? getEmployeeGroup(editId) : Promise.resolve(null)]);
  return <EmployeeGroupsList rows={list.rows} total={list.total} params={params} detail={detail} />;
}
