import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getClaim } from '@/server/queries/claims';
import ClaimView from '@/components/claims/ClaimView';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Claim' };
export const dynamic = 'force-dynamic';

// P15 · S-PT-15 · /my/claims/{no} — own claim only; anything else → not found.
export default async function MyClaimPage({ params }: { params: Promise<{ claimNo: string }> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const claimNo = decodeURIComponent((await params).claimNo);
  const claim = await getClaim(claimNo);
  if (!claim || !claim.isOwn) notFound();
  return (
    <>
      <PageTitle title={claim.claimNo} breadcrumbs={[{ label: 'My claims', href: '/my/claims' }, { label: claim.claimNo }]} />
      <ClaimView claim={claim} mode="own" backHref="/my/claims" />
    </>
  );
}
