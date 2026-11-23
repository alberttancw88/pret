import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listNotifications } from '@/server/queries/portal';
import { NOTIFICATION_CATEGORIES, type NotificationListParams } from '@/server/contracts/portal';
import NotificationsList, { NOTIFICATION_FILTERS } from '@/components/portal/NotificationsList';
import { pickList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// G5 · S-GL-07 · /notifications — every signed-in user (incl. External ADM), own rows only.
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: NOTIFICATION_FILTERS, rowsPerPage: 25, sort: { key: 'createdAt', direction: 'desc' } });
  const base = toPageParams(lp, ['createdAt'] as const);
  const f = lp.filters;
  const params: NotificationListParams = {
    q: base.q,
    page: base.page,
    pageSize: base.pageSize,
    dir: lp.sort?.direction ?? 'desc',
    read: f.read === 'unread' || f.read === 'read' ? f.read : 'all',
    categories: pickList(f.categories, NOTIFICATION_CATEGORIES),
    dateFrom: ISO.test(f.dateFrom) ? f.dateFrom : undefined,
    dateTo: ISO.test(f.dateTo) ? f.dateTo : undefined,
  };
  const list = await listNotifications(params);
  return <NotificationsList rows={list.rows} total={list.total} params={params} />;
}
