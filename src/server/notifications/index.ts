import 'server-only';
import { sql, withUserTx, type UserTxContext } from '../db';

// In-app notifications for the bell (F-PRT-13). Rows are created by database functions /
// triggers / jobs (app.notify); users can only read their own and mark them read.

export interface NotificationItem {
  id: string;
  eventCode: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  isActionRequired: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export async function listMyNotifications(ctx: UserTxContext, limit = 20) {
  return withUserTx(ctx, async (tx) => {
    const rows = await tx
      .selectFrom('app.notifications')
      .select(['id', 'event_code', 'title', 'body', 'link_path', 'is_action_required', 'read_at', 'created_at'])
      .orderBy('created_at', 'desc')
      .limit(Math.min(Math.max(limit, 1), 100))
      .execute();
    const unread = await tx
      .selectFrom('app.notifications')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('read_at', 'is', null)
      .executeTakeFirst();
    const items: NotificationItem[] = rows.map((r) => ({
      id: r.id,
      eventCode: r.event_code,
      title: r.title,
      body: r.body,
      linkPath: r.link_path,
      isActionRequired: r.is_action_required,
      readAt: r.read_at,
      createdAt: r.created_at,
    }));
    return { items, unreadCount: unread?.n ?? 0 };
  });
}

/** Marks the given notifications (or all, when ids is empty) as read — own rows only (RLS). */
export async function markNotificationsRead(ctx: UserTxContext, ids: string[] = []) {
  await withUserTx(ctx, async (tx) => {
    let q = tx.updateTable('app.notifications').set({ read_at: sql<Date>`now()` }).where('read_at', 'is', null);
    if (ids.length > 0) q = q.where('id', 'in', ids);
    await q.execute();
  });
}
