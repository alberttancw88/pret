import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getDirectoryFilterOptions, listDirectory } from '@/server/queries/employees';
import type { DirectoryParams } from '@/server/contracts/employees';
import { StaffDirectory } from '@/components/employees/Directory';
import { DIRECTORY_FILTERS, DIRECTORY_SORTS, uuidList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Staff directory' };
export const dynamic = 'force-dynamic';

// G10 · S-GL-12 · /directory — every signed-in user (T0 directory projection: 7 fields only).
export default async function DirectoryPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: DIRECTORY_FILTERS, sort: { key: 'name', direction: 'asc' } });
  const f = lp.filters;
  const params: DirectoryParams = { ...toPageParams(lp, DIRECTORY_SORTS), departmentIds: uuidList(f.departmentIds), locationIds: uuidList(f.locationIds) };
  const [list, options] = await Promise.all([listDirectory(params), getDirectoryFilterOptions()]);
  return <StaffDirectory rows={list.rows} total={list.total} params={params} options={options} />;
}
