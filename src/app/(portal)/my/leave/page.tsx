import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getApplyLeaveForm, listMyLeave } from '@/server/queries/leave';
import { LEAVE_STATUSES, type LeaveTypeRef, type MyLeaveParams } from '@/server/contracts/leave';
import { MyLeaveList } from '@/components/leave/MyLeave';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import { MY_LEAVE_FILTERS, MY_LEAVE_SORTS, yearOrUndef } from '@/components/leave/filters';
import { isoOrUndef, pickList, uuidList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'My leave' };
export const dynamic = 'force-dynamic';

// P3 · S-PT-03 · /my/leave — own applications only (server-scoped).
export default async function MyLeavePage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const form = await getApplyLeaveForm();
  if (!form) return <NoEmployeeRecord />;
  const currentYear = Number(todayMyt().slice(0, 4));
  const lp = readListParams(await searchParams, { filters: { ...MY_LEAVE_FILTERS, year: String(currentYear) }, sort: { key: 'from', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, MY_LEAVE_SORTS);
  const params: MyLeaveParams = {
    ...pp,
    dir: pp.sort ? pp.dir : 'desc',
    year: yearOrUndef(f.year),
    leaveTypeIds: uuidList(f.leaveTypeIds),
    statuses: pickList(f.statuses, LEAVE_STATUSES),
    from: isoOrUndef(f.from),
    to: isoOrUndef(f.to),
  };
  const list = await listMyLeave(params);
  const types: LeaveTypeRef[] = [...form.types, ...form.ineligible.map((i) => i.type)];
  return <MyLeaveList rows={list.rows} total={list.total} params={params} types={types} currentYear={currentYear} />;
}
