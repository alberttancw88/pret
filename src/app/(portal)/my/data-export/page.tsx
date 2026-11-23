import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getMyDataExports } from '@/server/queries/portal';
import MyDataExport from '@/components/portal/MyDataExport';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';

export const metadata: Metadata = { title: 'Download my data' };
export const dynamic = 'force-dynamic';

// P20 · S-PT-20 · /my/data-export — the employee's own data file (F-PRT-16, PDPA). Own only;
// external administrators (no employee record) never get this screen (FR-PRT-12).
export default async function MyDataExportPage() {
  const user = await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  if (user.isExternal) notFound();
  const data = await getMyDataExports();
  if (!data.hasEmployeeRecord) return <NoEmployeeRecord />;
  return <MyDataExport initial={data} />;
}
