import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getClaimPolicy, getClaimSetupOptions } from '@/server/queries/claims';
import { ClaimSettingsForm } from '@/components/claims/Setup';

export const metadata: Metadata = { title: 'Claims settings' };
export const dynamic = 'force-dynamic';

// C8 · S-CL-08 · /claims/setup/settings — ADM / SA (SA-only batch-approval toggle; server ignores it for ADM).
export default async function ClaimSettingsPage() {
  await requireUser(['ADM', 'SA']);
  const [policy, options] = await Promise.all([getClaimPolicy(), getClaimSetupOptions()]);
  return <ClaimSettingsForm policy={policy} glAccounts={options.glAccounts} />;
}
