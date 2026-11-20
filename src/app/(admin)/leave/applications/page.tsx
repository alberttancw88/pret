import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listLeaveApplications } from '@/server/queries/leave';
import ApplicationsList from '@/components/leave/ApplicationsList';
import { leaveApplicationParams } from '@/app/_lib/leave-params';
import { leaveFilterOptions } from '@/app/_lib/leave-options';
import type { SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Leave applications' };
export const dynamic = 'force-dynamic';

// L1 · S-LV-01 · /leave/applications — Admin and Super Admin (everyone).
export default async function LeaveApplicationsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const params = leaveApplicationParams(await searchParams);
  const [list, options] = await Promise.all([listLeaveApplications(params), leaveFilterOptions(user)]);
  return <ApplicationsList rows={list.rows} total={list.total} params={params} options={options} scope="all" />;
}
