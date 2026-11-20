import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getLeaveApplication } from '@/server/queries/leave';
import LeaveApplicationView from '@/components/leave/LeaveApplicationView';
import PageTitle from '@/components/shell/PageTitle';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Leave decision' };
export const dynamic = 'force-dynamic';

// P27 · S-AP-02 · /approvals/leave/{ref} — MGR (team / routed / delegate), ADM, SA. Out of scope → null → not found.
// ?from=applications|team returns to L1 instead of the inbox after a decision.
export default async function LeaveDecisionPage({ params, searchParams }: { params: Promise<{ refNo: string }>; searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['MGR', 'ADM', 'SA']);
  const { refNo } = await params;
  const from = spValue(await searchParams, 'from');
  const app = await getLeaveApplication(decodeURIComponent(refNo));
  if (!app) notFound();
  const admin = user.roles.includes('ADM') || user.roles.includes('SA');
  const back = from === 'applications' && admin ? { label: 'Leave applications', href: '/leave/applications' } : from === 'team' ? { label: 'Team leave', href: '/team/leave' } : { label: 'Approvals', href: '/approvals?tab=leave' };
  return (
    <>
      <PageTitle title={app.refNo} breadcrumbs={[back, { label: app.refNo }]} />
      <LeaveApplicationView app={app} mode="approver" backHref={back.href} />
    </>
  );
}
