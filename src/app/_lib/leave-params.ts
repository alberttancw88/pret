// URL list state → contract params for L1 (/leave/applications, /team/leave). Server-side only use.
import { LEAVE_STATUSES, MC_FILTERS, addDaysIso, type BalanceListParams, type LeaveApplicationListParams } from '@/server/contracts/leave';
import { BALANCE_FILTERS, LEAVE_APP_FILTERS, LEAVE_APP_SORTS } from '@/components/leave/filters';
import { isoOrUndef, pickList, uuidList, uuidOrUndef } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export function leaveApplicationParams(sp: SearchParamsRecord): LeaveApplicationListParams {
  const lp = readListParams(sp, { filters: LEAVE_APP_FILTERS, sort: { key: 'applied', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, LEAVE_APP_SORTS);
  // Home tiles: ?when=today | week (Mon–Sun of this week) — leave-date range, approved + pending.
  let from = isoOrUndef(f.from);
  let to = isoOrUndef(f.to);
  if (!from && !to && (f.when === 'today' || f.when === 'week')) {
    const today = todayMyt();
    if (f.when === 'today') from = to = today;
    else {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0
      from = addDaysIso(today, -dow);
      to = addDaysIso(from, 6);
    }
  }
  const level = Number(f.level);
  return {
    ...pp,
    dir: pp.sort ? pp.dir : 'desc',
    employeeId: uuidOrUndef(f.employeeId),
    locationIds: uuidList(f.locationIds),
    departmentIds: uuidList(f.departmentIds),
    from,
    to,
    leaveTypeIds: uuidList(f.leaveTypeIds),
    statuses: pickList(f.statuses, LEAVE_STATUSES) ?? (f.when ? ['pending', 'approved', 'cancellation_pending'] : undefined),
    emergencyOnly: f.emergencyOnly === 'yes',
    onBehalfOnly: f.onBehalfOnly === 'yes',
    appliedFrom: isoOrUndef(f.appliedFrom),
    appliedTo: isoOrUndef(f.appliedTo),
    level: level >= 1 && level <= 3 ? level : undefined,
    mcFilters: pickList(f.mcFilters, MC_FILTERS),
    includeSeparated: f.includeSeparated === 'yes' ? true : f.includeSeparated === 'no' ? false : undefined,
  };
}

/** L3 balances. */
export function balanceListParams(sp: SearchParamsRecord): BalanceListParams {
  const lp = readListParams(sp, { filters: BALANCE_FILTERS, sort: { key: 'department', direction: 'asc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, ['department', 'employee'] as const);
  const status = f.employmentStatus === 'separated' || f.employmentStatus === 'all' ? f.employmentStatus : 'active';
  return {
    ...pp,
    asAt: isoOrUndef(f.asAt),
    departmentIds: uuidList(f.departmentIds),
    locationIds: uuidList(f.locationIds),
    leaveTypeIds: uuidList(f.leaveTypeIds),
    employmentStatus: status,
  };
}
