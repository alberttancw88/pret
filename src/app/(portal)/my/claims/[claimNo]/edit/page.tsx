import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getClaimForm } from '@/server/queries/claims';
import ClaimForm from '@/components/claims/ClaimForm';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Edit claim' };
export const dynamic = 'force-dynamic';

// P13 · S-PT-13 · /my/claims/{no}/edit — own New claims only (others → detail).
export default async function EditClaimPage({ params }: { params: Promise<{ claimNo: string }> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const claimNo = decodeURIComponent((await params).claimNo);
  const form = await getClaimForm(claimNo);
  if (!form || !form.claim || !form.claim.isOwn) notFound();
  if (form.claim.status !== 'new') redirect(`/my/claims/${encodeURIComponent(claimNo)}`);
  return (
    <>
      <PageTitle title={`Edit ${claimNo}`} breadcrumbs={[{ label: 'My claims', href: '/my/claims' }, { label: claimNo, href: `/my/claims/${encodeURIComponent(claimNo)}` }, { label: 'Edit' }]} />
      <ClaimForm form={form} />
    </>
  );
}
