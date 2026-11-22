import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listTeamClaims } from '@/server/queries/claims';
import ClaimsList from '@/components/claims/ClaimsList';
import { claimFilterOptions } from '@/app/_lib/claim-options';
import { claimListParams } from '@/app/_lib/claim-params';
import type { SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Team claims' };
export const dynamic = 'force-dynamic';

// C1 (team scope) · /team/claims — Managers: reportees' claims + claims routed to them. No batch / bank data.
export default async function TeamClaimsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['MGR']);
  const params = claimListParams(await searchParams, false);
  const [page, options] = await Promise.all([listTeamClaims(params), claimFilterOptions(user)]);
  return <ClaimsList page={page} params={params} options={options} scope="team" />;
}
