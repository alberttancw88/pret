import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getAdminDashboard } from '@/server/queries/reports';
import AdminDashboard from '@/components/dashboard/AdminDashboard';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

// R1 · S-RP-01 · /dashboard — Admin and Super Admin only (enforced here, in the query and by RLS; not by the nav).
// Live figures (W2-007): each tile is null when it failed → "Couldn't load — RETRY" without blocking the others.
export default async function DashboardPage() {
  await requireUser(['ADM', 'SA']);
  const data = await getAdminDashboard({ claimPeriod: 'this' });
  return <AdminDashboard data={data} />;
}
