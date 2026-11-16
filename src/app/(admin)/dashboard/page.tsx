import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import AdminDashboard from '@/components/dashboard/AdminDashboard';
import { ADMIN_DASHBOARD_PLACEHOLDER } from './placeholder';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

// S-RP-01 · /dashboard — Admin and Super Admin only (enforced here, not by the nav).
export default async function DashboardPage() {
  await requireUser(['ADM', 'SA']);
  return <AdminDashboard data={{ ...ADMIN_DASHBOARD_PLACEHOLDER, asAt: new Date().toISOString() }} placeholder />;
}
