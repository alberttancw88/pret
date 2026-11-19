import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getReportingLines } from '@/server/queries/org';
import ReportingLinesView from '@/components/org/ReportingLinesView';

export const metadata: Metadata = { title: 'Reporting lines' };
export const dynamic = 'force-dynamic';

// O8 · S-OR-08 · /organisation/reporting-lines — Admin and Super Admin (F-ORG-11, US-ORG-009).
export default async function ReportingLinesPage() {
  await requireUser(['ADM', 'SA']);
  const data = await getReportingLines();
  return <ReportingLinesView data={data} />;
}
