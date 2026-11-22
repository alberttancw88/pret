import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listCategories } from '@/server/queries/claims';
import { CLAIM_GROUPS, TAX_TREATMENTS, type CategoryListParams } from '@/server/contracts/claims';
import { CategoriesList } from '@/components/claims/Setup';
import { CATEGORY_FILTERS, CATEGORY_SORTS } from '@/components/claims/filters';
import { pickList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Claim categories' };
export const dynamic = 'force-dynamic';

// C5 · S-CL-05 · /claims/setup/categories — ADM / SA.
export default async function ClaimCategoriesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: CATEGORY_FILTERS, sort: { key: 'order', direction: 'asc' } });
  const f = lp.filters;
  const params: CategoryListParams = {
    ...toPageParams(lp, CATEGORY_SORTS),
    groups: pickList(f.groups, CLAIM_GROUPS),
    active: f.active === 'active' || f.active === 'inactive' ? f.active : 'all',
    taxTreatments: pickList(f.taxTreatments, TAX_TREATMENTS),
  };
  const res = await listCategories(params);
  return <CategoriesList rows={res.rows} total={res.total} params={params} />;
}
