// PLACEHOLDER figures for W2-001 layout review — synthetic, no real people or amounts.
// Replaced by live queries in W2-007 (Reports).
import type { AdminDashboardData } from '@/components/dashboard/AdminDashboard';

export const ADMIN_DASHBOARD_PLACEHOLDER: Omit<AdminDashboardData, 'asAt'> = {
  hr: {
    headcount: 42,
    onLeaveToday: 3,
    pendingLeave: 5,
    pendingLeaveAdmin: 2,
    probationDue: 1,
    missingPayroll: 0,
    changeRequests: 2,
    phYear: 2027,
    phStatus: 'Draft',
  },
  alerts: [
    { message: '2 reportees without an active manager', href: '/admin/organisation/reporting-lines' },
    { message: 'External access ends in 7 days', href: '/admin/access/users' },
  ],
  claims: {
    submitted: 6,
    approvedNotDisbursed: 11,
    disbursed: 24,
    rejected: 1,
    exclSst: 18204.11,
    sst: 612.4,
    total: 18816.51,
    awaiting: { count: 6, amount: 1204.1 },
    approvedNd: { count: 11, amount: 2140.6, aged: 2 },
    batch: { ref: 'PB-2026-011', href: '/admin/claims/batches/PB-2026-011', status: 'Exported', outOfDate: true },
  },
};
