import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getClaim } from '@/server/queries/claims';
import ClaimView from '@/components/claims/ClaimView';
import PageTitle from '@/components/shell/PageTitle';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Claim decision' };
export const dynamic = 'force-dynamic';

// P29 · S-AP-04 · /approvals/claims/{no} — MGR (team / routed / delegate; no bank, batch, tax/GL data), ADM, SA.
// Out of scope → null → not found. ?from=claims|team returns to C1 instead of the inbox.
export default async function ClaimDecisionPage({ params, searchParams }: { params: Promise<{ claimNo: string }>; searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['MGR', 'ADM', 'SA']);
  const claimNo = decodeURIComponent((await params).claimNo);
  const from = spValue(await searchParams, 'from');
  const claim = await getClaim(claimNo);
  if (!claim) notFound();
  const admin = user.roles.includes('ADM') || user.roles.includes('SA');
  const back =
    from === 'claims' && admin
      ? { label: 'Claims', href: '/claims' }
      : from === 'team' && user.roles.includes('MGR')
        ? { label: 'Team claims', href: '/team/claims' }
        : { label: 'Approvals', href: `/approvals?tab=${claim.status === 'approved' ? 'claims_approved' : 'claims'}` };
  return (
    <>
      <PageTitle title={claim.claimNo} breadcrumbs={[back, { label: claim.claimNo }]} />
      <ClaimView claim={claim} mode="approver" backHref={back.href} />
    </>
  );
}
