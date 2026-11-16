import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getSystemSettings } from '@/server/queries/org';
import SystemSettings from '@/components/org/SystemSettings';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

// O11 · S-OR-11 · /settings — Admin (view) and Super Admin (edit control settings) (F-ORG-12).
export default async function SettingsPage() {
  await requireUser(['ADM', 'SA']);
  const settings = await getSystemSettings();
  return <SystemSettings settings={settings} />;
}
