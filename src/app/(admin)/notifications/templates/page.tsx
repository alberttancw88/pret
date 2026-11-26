import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listNotificationTemplates } from '@/server/queries/notifications';
import NotificationTemplates from '@/components/notifications/NotificationTemplates';

export const metadata: Metadata = { title: 'Notification templates' };
export const dynamic = 'force-dynamic';

// A16 · S-AC-13 · /notifications/templates — ADM / SA can list and view; only SA edits (detail page and Server Actions).
// Search / filter / paging run in the browser over the full list (≈ 50 events, no personal data).
export default async function NotificationTemplatesPage() {
  await requireUser(['ADM', 'SA']);
  const rows = await listNotificationTemplates({});
  return <NotificationTemplates rows={rows} />;
}
