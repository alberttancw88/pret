import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getLeaveSetupOptions, listAdjustments } from '@/server/queries/leave';
import type { AdjustmentListParams } from '@/server/contracts/leave';
import { AdjustmentsList } from '@/components/leave/AdjustOverride';
import { ADJUSTMENT_FILTERS, ADJUSTMENT_SORTS, yearOrUndef } from '@/components/leave/filters';
import { isoOrUndef, uuidList, uuidOrUndef } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Balance adjustments' };
export const dynamic = 'force-dynamic';

// L4 · S-LV-04 · /leave/adjustments (+ L5 dialog) — Admin and Super Admin; never on the own record.
export default async function AdjustmentsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: ADJUSTMENT_FILTERS, sort: { key: 'date', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, ADJUSTMENT_SORTS);
  const params: AdjustmentListParams = {
    ...pp,
    dir: pp.sort ? pp.dir : 'desc',
    employeeId: uuidOrUndef(f.employeeId),
    leaveTypeIds: uuidList(f.leaveTypeIds),
    year: yearOrUndef(f.year),
    from: isoOrUndef(f.from),
    to: isoOrUndef(f.to),
    reasonContains: f.reasonContains || undefined,
  };
  const [list, opts] = await Promise.all([listAdjustments(params), getLeaveSetupOptions()]);
  return <AdjustmentsList rows={list.rows} total={list.total} params={params} types={opts.leaveTypes} currentYear={opts.currentYear} />;
}
