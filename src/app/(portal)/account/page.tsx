import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getAccountSettings, getNotificationPreferences } from '@/server/queries/portal';
import { listMyDelegations } from '@/server/queries/approvals';
import AccountSettings from '@/components/portal/AccountSettings';

export const metadata: Metadata = { title: 'Account settings' };
export const dynamic = 'force-dynamic';

// G6 · S-GL-08 · /account — every signed-in user (incl. External ADM). Tabs come from the
// server (Delegation: MGR / ADM / SA, never External — BR-ADM-04; Two-factor: ADM / SA).
export default async function AccountPage() {
  const user = await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const settings = await getAccountSettings();
  const [preferences, delegations] = await Promise.all([
    settings.tabs.includes('notifications') ? getNotificationPreferences() : Promise.resolve(null),
    settings.tabs.includes('delegation') ? listMyDelegations() : Promise.resolve(null),
  ]);
  return <AccountSettings settings={settings} preferences={preferences} delegations={delegations} selfUserId={user.id} />;
}
