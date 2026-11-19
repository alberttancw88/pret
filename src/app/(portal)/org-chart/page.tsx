import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getDirectoryFilterOptions, getOrgChart } from '@/server/queries/employees';
import { OrgChartView } from '@/components/employees/Directory';

export const metadata: Metadata = { title: 'Org chart' };
export const dynamic = 'force-dynamic';

// G11 · S-GL-13 · /org-chart — every signed-in user (names, positions and reporting lines only).
export default async function OrgChartPage() {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const [chart, options] = await Promise.all([getOrgChart(), getDirectoryFilterOptions()]);
  return <OrgChartView chart={chart} departments={options.departments} />;
}
