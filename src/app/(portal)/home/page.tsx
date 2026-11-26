import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getHomeLeave } from '@/server/queries/leave';
import { getHomeClaims } from '@/server/queries/claims';
import { getManagerDashboard } from '@/server/queries/reports';
import { CLAIM_STATUS_LABELS } from '@/server/contracts/claims';
import type { StatusValue } from '@/components/StatusChip';
import { sumMoney } from '@/lib/format';
import EmployeeHome, { type HomeData } from '@/components/dashboard/EmployeeHome';
import { roleChipLabel } from '@/components/shell/nav';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// S-PT-01 · /home — any signed-in employee user (manager panel for MGR). Leave parts are live (W2-004:
// getHomeLeave — incl. the next 3 published holidays for my work state); claims parts live (W2-005: getHomeClaims);
// manager panel live (W2-007: getManagerDashboard, F-RPT-22).
export default async function HomePage() {
  const user = await requireUser();
  const isManager = user.roles.includes('MGR') && !user.isExternal;
  const [leave, claims, mgr] = await Promise.all([getHomeLeave(), getHomeClaims(), isManager ? getManagerDashboard() : Promise.resolve(null)]);
  const submitted = claims.pending.filter((c) => c.status === 'submitted');
  const claimChip = (s: keyof typeof CLAIM_STATUS_LABELS) => CLAIM_STATUS_LABELS[s] as StatusValue<'claim'>;
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
    pendingClaims: { count: submitted.length, amount: sumMoney(submitted.map((c) => c.total)) },
    pendingItems: [
      ...leave.pendingItems.map((p) => ({ ref: p.reference, href: p.href, label: p.label, set: 'generic' as const, status: p.status, tone: p.tone })),
      ...claims.pending.map((c) => ({ ref: c.claimNo, href: c.href, label: c.label, set: 'claim' as const, status: claimChip(c.status) })),
    ].slice(0, 5),
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
    recentClaims: claims.recent.slice(0, 3).map((c) => ({ ref: c.claimNo, href: c.href, title: c.title, total: c.total, status: claimChip(c.status) })),
    // F-RPT-22 manager panel (W2-007): one query for the five figures and their report drill-ins.
    manager: mgr
      ? { approvals: mgr.approvalsWaiting, onLeaveToday: mgr.teamOnLeaveToday, onLeaveWeek: mgr.teamOnLeaveThisWeek, probationDue: mgr.probationDue, teamClaimsSubmitted: mgr.teamClaimsSubmitted, links: mgr.links }
      : null,
  };
  return <EmployeeHome displayName={user.displayName} roleLabel={roleChipLabel(user)} data={data} />;
}
