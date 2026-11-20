import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listLeaveTypes } from '@/server/queries/leave';
import { LEAVE_CATEGORIES, type LeaveTypeListParams } from '@/server/contracts/leave';
import { LeaveTypesList } from '@/components/leave/LeaveTypes';
import { LEAVE_TYPE_FILTERS, LEAVE_TYPE_SORTS } from '@/components/leave/filters';
import { pickList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Leave types' };
export const dynamic = 'force-dynamic';

// L8 · S-LV-08 · /leave/setup/types — Admin and Super Admin.
export default async function LeaveTypesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: LEAVE_TYPE_FILTERS, sort: { key: 'order', direction: 'asc' } });
  const f = lp.filters;
  const params: LeaveTypeListParams = {
    ...toPageParams(lp, LEAVE_TYPE_SORTS),
    categories: pickList(f.categories, LEAVE_CATEGORIES),
    active: f.active === 'active' || f.active === 'inactive' ? f.active : 'all',
  };
  const list = await listLeaveTypes(params);
  return <LeaveTypesList rows={list.rows} total={list.total} params={params} />;
}
