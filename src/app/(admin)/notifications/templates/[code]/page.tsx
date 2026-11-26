import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getNotificationTemplate } from '@/server/queries/notifications';
import TemplateDetail from '@/components/notifications/TemplateDetail';

export const metadata: Metadata = { title: 'Notification template' };
export const dynamic = 'force-dynamic';

// A16 detail — ADM / SA view; SA edits (saveNotificationTemplate / resetNotificationTemplate are SA-only on the server).
export default async function NotificationTemplatePage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser(['ADM', 'SA']);
  const { code } = await params;
  if (!/^[a-z][a-z0-9_]{2,59}$/.test(code)) notFound();
  const template = await getNotificationTemplate(code);
  if (!template) notFound();
  return <TemplateDetail template={template} canEdit={user.roles.includes('SA')} />;
}
