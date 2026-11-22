import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getClaimSetupOptions, listLimits } from '@/server/queries/claims';
import { LIMIT_APPLIES_TO, LIMIT_BEHAVIOURS, type LimitListParams } from '@/server/contracts/claims';
import { LimitsList } from '@/components/claims/Setup';
import { LIMIT_FILTERS, LIMIT_SORTS } from '@/components/claims/filters';
import { isoOrUndef, pickList, uuidList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';
import { claimFilterOptions } from '@/app/_lib/claim-options';

export const metadata: Metadata = { title: 'Claim limits' };
export const dynamic = 'force-dynamic';

// C7 · S-CL-07 · /claims/setup/limits — ADM / SA.
export default async function ClaimLimitsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: LIMIT_FILTERS, sort: { key: 'category', direction: 'asc' } });
  const f = lp.filters;
  const params: LimitListParams = {
    ...toPageParams(lp, LIMIT_SORTS),
    categoryIds: uuidList(f.categoryIds),
    appliesTo: pickList(f.appliesTo, LIMIT_APPLIES_TO),
    effectiveOn: isoOrUndef(f.effectiveOn),
    behaviours: pickList(f.behaviours, LIMIT_BEHAVIOURS),
  };
  const [res, options, filterOptions] = await Promise.all([listLimits(params), getClaimSetupOptions(), claimFilterOptions(user)]);
  return <LimitsList rows={res.rows} total={res.total} params={params} categories={filterOptions.categoryRefs} options={options} />;
}
