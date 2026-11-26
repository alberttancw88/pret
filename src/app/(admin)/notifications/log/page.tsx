import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listNotificationLog } from '@/server/queries/notifications';
import { DELIVERY_STATUSES, NOTIFICATION_CHANNELS, type NotificationLogParams } from '@/server/contracts/notifications';
import NotificationLog from '@/components/notifications/NotificationLog';
import { NOTIFICATION_LOG_FILTERS, NOTIFICATION_LOG_SORTS } from '@/components/notifications/filters';
import { isoOrUndef, pickList } from '@/components/employees/filters';
import { optList, readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Notification log' };
export const dynamic = 'force-dynamic';

// A15 · S-AC-12 · /notifications/log — ADM / SA (recipients' email addresses are shown to these roles only).
export default async function NotificationLogPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: NOTIFICATION_LOG_FILTERS, sort: { key: 'at', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, NOTIFICATION_LOG_SORTS);
  const params: NotificationLogParams = {
    ...pp,
    sort: pp.sort ?? 'at',
    dir: pp.sort ? pp.dir : 'desc',
    eventCodes: optList(f.eventCodes)?.filter((c) => /^N-\d{2}$/.test(c)),
    channels: pickList(f.channels, NOTIFICATION_CHANNELS),
    statuses: pickList(f.statuses, DELIVERY_STATUSES),
    from: isoOrUndef(f.from),
    to: isoOrUndef(f.to),
  };
  const res = await listNotificationLog(params);
  return <NotificationLog rows={res.rows} total={res.total} params={params} delivery={res.delivery} canSendNow={user.roles.includes('SA')} />;
}
