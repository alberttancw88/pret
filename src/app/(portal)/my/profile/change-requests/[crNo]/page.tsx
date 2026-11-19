import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getMyChangeRequest } from '@/server/queries/employees';
import { ChangeRequestDetailView } from '@/components/employees/ChangeRequests';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Change request' };
export const dynamic = 'force-dynamic';

// P18 detail · /my/profile/change-requests/{no} — the requester only (null otherwise → not found).
// Attachments visible to the employee until decided, then HR-only ("Attachment kept by HR").
export default async function MyChangeRequestPage({ params }: { params: Promise<{ crNo: string }> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const { crNo } = await params;
  const cr = await getMyChangeRequest(decodeURIComponent(crNo));
  if (!cr) notFound();
  return (
    <>
      <PageTitle title={cr.crNo} breadcrumbs={[{ label: 'My profile', href: '/my/profile' }, { label: 'Change requests', href: '/my/profile/change-requests' }, { label: cr.crNo }]} />
      <ChangeRequestDetailView cr={cr} mode="own" revealMode="owner" />
    </>
  );
}
