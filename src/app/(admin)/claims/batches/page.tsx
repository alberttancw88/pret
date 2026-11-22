import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listBatches } from '@/server/queries/claims';
import { BATCH_STATUSES, type BatchListParams } from '@/server/contracts/claims';
import { BatchesList } from '@/components/claims/Batches';
import { BATCH_FILTERS, BATCH_SORTS, monthOrUndef } from '@/components/claims/filters';
import { yearOrUndef } from '@/components/leave/filters';
import { pickList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'Disbursement batches' };
export const dynamic = 'force-dynamic';

// C9 · S-CL-09 · /claims/batches — ADM / SA.
export default async function BatchesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: BATCH_FILTERS, sort: { key: 'month', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, BATCH_SORTS);
  const params: BatchListParams = { ...pp, dir: pp.sort ? pp.dir : 'desc', year: yearOrUndef(f.year), month: monthOrUndef(f.month), statuses: pickList(f.statuses, BATCH_STATUSES) };
  const page = await listBatches(params);
  return <BatchesList page={page} params={params} currentYear={Number(todayMyt().slice(0, 4))} />;
}
