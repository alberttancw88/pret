import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getCostCentre, listCostCentres } from '@/server/queries/org';
import type { CostCentreListParams } from '@/server/contracts/org';
import CostCentresList from '@/components/org/CostCentresList';
import { COST_CENTRE_FILTERS, isUuid } from '@/components/org/filters';
import { activeParam } from '@/components/org/common';
import { readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Cost centres' };
export const dynamic = 'force-dynamic';

// O9 · S-OR-09 · /organisation/cost-centres — Admin and Super Admin (F-ORG-13, Could).
export default async function CostCentresPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: COST_CENTRE_FILTERS, sort: { key: 'code', direction: 'asc' } });
  const params: CostCentreListParams = { ...toPageParams(lp, ['code', 'name'] as const), active: activeParam(lp.filters.active) };
  const editId = spValue(sp, 'edit');
  const [list, detail] = await Promise.all([listCostCentres(params), isUuid(editId) ? getCostCentre(editId) : Promise.resolve(null)]);
  return <CostCentresList rows={list.rows} total={list.total} params={params} detail={detail} />;
}
