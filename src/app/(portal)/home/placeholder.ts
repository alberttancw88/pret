// PLACEHOLDER data for W2-001 layout review — synthetic, no real people.
// Replaced by live queries in W2-004 (Leave), W2-005 (Claims) and W2-006 (Portal).
import type { HomeData } from '@/components/dashboard/EmployeeHome';

export function homePlaceholder(isManager: boolean): HomeData {
  return {
    balances: [
      { id: 'AL', name: 'Annual leave', available: 8.5, earnedToDate: 6.0, expiring: { days: 3.0, date: '2027-03-31' }, colorIndex: 0 },
      { id: 'SL', name: 'Sick leave', available: 14.0, colorIndex: 1 },
      { id: 'HL', name: 'Hospitalisation', available: 60.0, colorIndex: 2 },
      { id: 'RL', name: 'Replacement', available: 1.0, colorIndex: 3 },
      { id: 'UL', name: 'Unpaid leave', available: null, colorIndex: 4 },
    ],
    pendingClaims: { count: 2, amount: 245.6 },
    pendingItems: [
      { ref: 'LV-2026-00012', href: '/leave/applications/LV-2026-00012', label: 'Annual leave · 2.0 days', set: 'leave', status: 'Pending L1' },
      { ref: 'CL-2026-00031', href: '/claims/CL-2026-00031', label: 'Sample client visit', set: 'claim', status: 'Submitted' },
      { ref: 'CR-2026-00004', href: '/profile/change-requests/CR-2026-00004', label: 'Bank details', set: 'changeRequest', status: 'Submitted' },
    ],
    upcomingLeave: [
      { id: 'u1', type: 'Annual', colorIndex: 0, from: '2026-12-24', to: '2026-12-26', days: 2.0 },
      { id: 'u2', type: 'Annual', colorIndex: 0, from: '2027-01-29', to: '2027-01-29', days: 0.5 },
    ],
    holidays: [
      { date: '2026-12-25', name: 'Christmas Day', weekday: 'Friday', state: 'Selangor' },
      { date: '2027-01-01', name: "New Year's Day", weekday: 'Friday', state: 'Selangor' },
      { date: '2027-02-06', name: 'Chinese New Year', weekday: 'Saturday', state: 'Selangor' },
    ],
    recentClaims: [
      { ref: 'CL-2026-00031', href: '/claims/CL-2026-00031', title: 'Sample client visit', total: 245.6, status: 'Submitted' },
      { ref: 'CL-2026-00027', href: '/claims/CL-2026-00027', title: 'Sample training materials', total: 89.9, status: 'Approved' },
      { ref: 'CL-2026-00019', href: '/claims/CL-2026-00019', title: 'Sample mileage', total: 54.0, status: 'Disbursed' },
    ],
    manager: isManager ? { approvals: 4, onLeaveToday: 1, onLeaveWeek: 2, probationDue: 1, teamClaimsSubmitted: 3 } : null,
  };
}
