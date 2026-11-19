import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getDirectoryFilterOptions, listMyTeam } from '@/server/queries/employees';
import type { MyTeamParams } from '@/server/contracts/employees';
import { MyTeamList } from '@/components/employees/portal/Team';
import { TEAM_FILTERS, TEAM_SORTS, uuidList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'My team' };
export const dynamic = 'force-dynamic';

// P31 · S-AP-06 · /team — managers (direct + indirect reportees, server-scoped).
export default async function MyTeamPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['MGR']);
  const lp = readListParams(await searchParams, { filters: TEAM_FILTERS, sort: { key: 'name', direction: 'asc' } });
  const f = lp.filters;
  const params: MyTeamParams = { ...toPageParams(lp, TEAM_SORTS), departmentIds: uuidList(f.departmentIds), scope: f.scope === 'direct' ? 'direct' : 'all' };
  const [list, opts] = await Promise.all([listMyTeam(params), getDirectoryFilterOptions()]);
  return <MyTeamList rows={list.rows} total={list.total} params={params} departments={opts.departments} />;
}
