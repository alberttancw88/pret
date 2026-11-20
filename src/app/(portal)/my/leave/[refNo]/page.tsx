import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getLeaveApplication } from '@/server/queries/leave';
import LeaveApplicationView from '@/components/leave/LeaveApplicationView';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Leave application' };
export const dynamic = 'force-dynamic';

// P4 · S-PT-04 · /my/leave/{ref} — the applicant only; anything else → "Not found or no access".
export default async function MyLeaveDetailPage({ params }: { params: Promise<{ refNo: string }> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const { refNo } = await params;
  const app = await getLeaveApplication(decodeURIComponent(refNo));
  if (!app || !app.isOwn) notFound();
  return (
    <>
      <PageTitle title={app.refNo} breadcrumbs={[{ label: 'My leave', href: '/my/leave' }, { label: app.refNo }]} />
      <LeaveApplicationView app={app} mode="own" />
    </>
  );
}
