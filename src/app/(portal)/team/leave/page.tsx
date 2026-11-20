import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listLeaveApplications } from '@/server/queries/leave';
import ApplicationsList from '@/components/leave/ApplicationsList';
import { leaveApplicationParams } from '@/app/_lib/leave-params';
import { leaveFilterOptions } from '@/app/_lib/leave-options';
import type { SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Team leave' };
export const dynamic = 'force-dynamic';

// L1 (team scope) · /team/leave — Manager: reportees (direct + indirect) and items routed to them; read-only
// except decisions on items routed to them. The query scopes to the manager's team (RLS §5.4).
export default async function TeamLeavePage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['MGR']);
  const params = leaveApplicationParams(await searchParams);
  const [list, options] = await Promise.all([listLeaveApplications(params), leaveFilterOptions(user)]);
  return <ApplicationsList rows={list.rows} total={list.total} params={params} options={options} scope="team" />;
}
