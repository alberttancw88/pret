import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getLeaveSetupOptions, listOverrides } from '@/server/queries/leave';
import type { OverrideListParams } from '@/server/contracts/leave';
import { OverridesList } from '@/components/leave/AdjustOverride';
import { OVERRIDE_FILTERS, OVERRIDE_SORTS, yearOrUndef } from '@/components/leave/filters';
import { uuidList, uuidOrUndef } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Entitlement overrides' };
export const dynamic = 'force-dynamic';

// L6 · S-LV-06 · /leave/overrides — Admin and Super Admin (SA may override the statutory floor with a reason).
export default async function OverridesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: OVERRIDE_FILTERS, sort: { key: 'employee', direction: 'asc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, OVERRIDE_SORTS);
  const params: OverrideListParams = {
    ...pp,
    employeeId: uuidOrUndef(f.employeeId),
    leaveTypeIds: uuidList(f.leaveTypeIds),
    year: yearOrUndef(f.year),
  };
  const [list, opts] = await Promise.all([listOverrides(params), getLeaveSetupOptions()]);
  return <OverridesList rows={list.rows} total={list.total} params={params} types={opts.leaveTypes} currentYear={opts.currentYear} isSuperAdmin={user.roles.includes('SA')} />;
}
