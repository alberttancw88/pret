import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getLeaveCalendar } from '@/server/queries/leave';
import { addDaysIso, type CalendarParams } from '@/server/contracts/leave';
import LeaveCalendarView from '@/components/leave/LeaveCalendar';
import { CALENDAR_FILTERS } from '@/components/leave/filters';
import { isoOrUndef, uuidList, uuidOrUndef } from '@/components/employees/filters';
import { readListParams, type SearchParamsRecord } from '@/lib/list-params';
import { leaveFilterOptions } from '@/app/_lib/leave-options';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'Leave calendar' };
export const dynamic = 'force-dynamic';

// P10 · S-PT-10 · /leave/calendar — every signed-in role; scope and type visibility decided by the server
// (EMP peers per LP12, MGR team with type, ADM/SA all). ?month=yyyy-mm-dd anchor · ?view=week.
export default async function LeaveCalendarPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: CALENDAR_FILTERS });
  const f = lp.filters;
  const anchor = isoOrUndef(f.month) ?? todayMyt();
  const view = f.view === 'week' ? 'week' : 'month';
  let from: string;
  let to: string;
  if (view === 'week') {
    const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7;
    from = addDaysIso(anchor, -dow);
    to = addDaysIso(from, 6);
  } else {
    from = `${anchor.slice(0, 7)}-01`;
    const [y, m] = anchor.split('-').map(Number) as [number, number];
    to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  }
  const canSeePending = user.roles.some((r) => r === 'MGR' || r === 'ADM' || r === 'SA');
  const params: CalendarParams = {
    from,
    to,
    view,
    departmentIds: uuidList(f.departmentIds),
    locationIds: uuidList(f.locationIds),
    holidayLocationId: uuidOrUndef(f.holidayLocationId),
    leaveTypeIds: uuidList(f.leaveTypeIds),
    includePending: canSeePending && f.includePending === 'yes',
    q: f.q || undefined,
  };
  const [cal, options] = await Promise.all([getLeaveCalendar(params), leaveFilterOptions(user)]);
  return <LeaveCalendarView cal={cal} params={params} options={options} anchor={anchor} view={view} canSeePending={canSeePending} />;
}
