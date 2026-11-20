import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getHomeLeave } from '@/server/queries/leave';
import EmployeeHome, { type HomeData } from '@/components/dashboard/EmployeeHome';
import { roleChipLabel } from '@/components/shell/nav';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// S-PT-01 · /home — any signed-in employee user (manager panel for MGR). Leave parts are live (W2-004:
// getHomeLeave — incl. the next 3 published holidays for my work state and probation-due counts); claims → W2-005.
export default async function HomePage() {
  const user = await requireUser();
  const leave = await getHomeLeave();
  const data: HomeData = {
    balances: leave.tiles.map((t, i) => {
      const noBalance = t.leaveType.entitlementMethod === 'no_entitlement' || t.leaveType.entitlementMethod === 'fixed_per_occurrence';
      return {
        id: t.leaveType.code,
        name: t.leaveType.name,
        available: noBalance ? null : Number(t.available),
        earnedToDate: t.earnedToDate != null ? Number(t.earnedToDate) : undefined,
        expiring: t.expiringSoon ? { days: Number(t.expiringSoon.days), date: t.expiringSoon.date } : undefined,
        colorIndex: i,
        colour: t.leaveType.colour,
        href: `/my/leave/balances/${encodeURIComponent(t.leaveType.code)}`,
        noBalanceLabel: noBalance ? t.availableLabel : undefined,
      };
    }),
    pendingClaims: { count: 0, amount: 0 },
    pendingItems: leave.pendingItems.map((p) => ({ ref: p.reference, href: p.href, label: p.label, set: 'generic' as const, status: p.status, tone: p.tone })),
    upcomingLeave: leave.upcoming.map((u, i) => ({
      id: u.id,
      type: u.leaveType.name,
      colorIndex: i,
      colour: u.leaveType.colour,
      from: u.startDate,
      to: u.endDate,
      days: u.days,
      href: `/my/leave/${encodeURIComponent(u.refNo)}`,
    })),
    holidays: leave.holidays.slice(0, 3).map((h) => ({
      date: h.date,
      name: h.half ? `${h.name} (half day)` : h.name,
      weekday: WEEKDAYS[new Date(`${h.date}T00:00:00Z`).getUTCDay()]!,
      state: h.stateLabel,
    })),
    holidaysNote: leave.holidaysNote,
    recentClaims: [],
    manager: leave.manager
      ? { approvals: leave.manager.approvalsWaiting, onLeaveToday: leave.manager.teamOnLeaveToday, onLeaveWeek: leave.manager.teamOnLeaveThisWeek, probationDue: leave.manager.probationDue, teamClaimsSubmitted: null }
      : null,
  };
  return <EmployeeHome displayName={user.displayName} roleLabel={roleChipLabel(user)} data={data} claimsDeferred />;
}
