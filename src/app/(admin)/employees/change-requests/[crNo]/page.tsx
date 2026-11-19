import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getChangeRequest } from '@/server/queries/employees';
import { ChangeRequestDetailView } from '@/components/employees/ChangeRequests';
import PageTitle from '@/components/shell/PageTitle';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Change request' };
export const dynamic = 'force-dynamic';

// E13 · S-EM-13 · /employees/change-requests/{no} — Admin and Super Admin. Deciding one's own
// request is blocked in the UI (can.decide), the Server Action and the database (rls §7).
export default async function ChangeRequestPage({ params, searchParams }: { params: Promise<{ crNo: string }>; searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const { crNo } = await params;
  const cr = await getChangeRequest(decodeURIComponent(crNo));
  if (!cr) notFound();
  const decide = spValue(await searchParams, 'decide');
  return (
    <>
      <PageTitle title={cr.crNo} breadcrumbs={[{ label: 'Employees', href: '/employees' }, { label: 'Change requests', href: '/employees/change-requests' }, { label: cr.crNo }]} />
      <ChangeRequestDetailView cr={cr} mode="hr" revealMode={user.roles.includes('SA') ? 'sa' : 'adm'} initialDecision={decide === 'approve' || decide === 'reject' ? decide : null} />
    </>
  );
}
