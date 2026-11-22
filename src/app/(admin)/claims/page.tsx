import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listClaims } from '@/server/queries/claims';
import ClaimsList from '@/components/claims/ClaimsList';
import { claimFilterOptions } from '@/app/_lib/claim-options';
import { claimListParams } from '@/app/_lib/claim-params';
import type { SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Claims' };
export const dynamic = 'force-dynamic';

// C1 · S-CL-01 · /claims — Admin and Super Admin (all claims; New only when entered on behalf — BR-CLM-27).
export default async function ClaimsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const params = claimListParams(await searchParams, true);
  const [page, options] = await Promise.all([listClaims(params), claimFilterOptions(user)]);
  return <ClaimsList page={page} params={params} options={options} scope="admin" />;
}
