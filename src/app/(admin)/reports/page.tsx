import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getReportCatalogue } from '@/server/queries/reports';
import ReportCatalogue from '@/components/reports/ReportCatalogue';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

// R2 · S-RP-02 · /reports — every signed-in user; cards are filtered by role on the server
// (ADM/SA all · MGR team reports · EMP Leave report by individual). Each report page enforces its own roles.
export default async function ReportsPage() {
  const user = await requireUser();
  const catalogue = await getReportCatalogue();
  const admin = user.roles.includes('ADM') || user.roles.includes('SA');
  return (
    <>
      {!admin && <PageTitle title={user.roles.includes('MGR') ? 'Team reports' : 'Reports'} />}
      <ReportCatalogue catalogue={catalogue} showPayrollNote={admin} />
    </>
  );
}
