import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getLeavePolicy, getLeaveSetupOptions } from '@/server/queries/leave';
import { PolicyForm } from '@/components/leave/SetupScreens';

export const metadata: Metadata = { title: 'Leave policy' };
export const dynamic = 'force-dynamic';

// L11 · S-LV-11 · /leave/setup/policy — Admin and Super Admin (operating settings).
export default async function PolicyPage() {
  await requireUser(['ADM', 'SA']);
  const [policy, options] = await Promise.all([getLeavePolicy(), getLeaveSetupOptions()]);
  return <PolicyForm key={policy.version} policy={policy} options={options} />;
}
