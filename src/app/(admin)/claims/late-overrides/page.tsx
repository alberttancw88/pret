import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listLateOverrides } from '@/server/queries/claims';
import type { LateOverrideListParams } from '@/server/contracts/claims';
import LateOverridesList from '@/components/claims/LateOverrides';
import { LATE_OVERRIDE_FILTERS, LATE_OVERRIDE_SORTS } from '@/components/claims/filters';
import { isoOrUndef, uuidOrUndef } from '@/components/employees/filters';
import { readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Late overrides' };
export const dynamic = 'force-dynamic';

// C4 · S-CL-04 · /claims/late-overrides — ADM / SA. ?new=1&employee={id} opens the new-override dialog (from S-AP-04 / C2).
export default async function LateOverridesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: LATE_OVERRIDE_FILTERS, sort: { key: 'applied', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, LATE_OVERRIDE_SORTS);
  const params: LateOverrideListParams = { ...pp, dir: pp.sort ? pp.dir : 'desc', employeeId: uuidOrUndef(f.employeeId), from: isoOrUndef(f.from), to: isoOrUndef(f.to) };
  const res = await listLateOverrides(params);
  const emp = uuidOrUndef(spValue(sp, 'employee') ?? '');
  const openFor = spValue(sp, 'new') === '1' ? (emp ? { id: emp, employeeNo: null, name: 'Selected employee' } : 'new') : null;
  return <LateOverridesList rows={res.rows} total={res.total} params={params} openFor={openFor} />;
}
