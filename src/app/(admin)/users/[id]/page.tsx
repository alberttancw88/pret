import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getUser, listUserLoginHistory } from '@/server/queries/users';
import { LOGIN_OUTCOMES, type LoginHistoryParams, type LoginOutcome } from '@/server/contracts/users';
import UserDetailView from '@/components/access/UserDetailView';
import { LOGIN_HISTORY_FILTERS } from '@/components/access/filters';
import { isUuid } from '@/components/org/filters';
import { optList, readListParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'User' };
export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// A7 · S-AC-03 · /users/{id} — Super Admin (all users) and Admin (employee users without
// privileged roles — getUser returns null outside scope → "Not found or no access").
export default async function UserDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await getUser(id);
  if (!user) notFound();

  let history: { rows: Awaited<ReturnType<typeof listUserLoginHistory>>['rows']; total: number } | null = null;
  let historyParams: LoginHistoryParams | null = null;
  if (user.can.viewLoginHistory) {
    const sp = await searchParams;
    const lp = readListParams(sp, { filters: LOGIN_HISTORY_FILTERS });
    const outcome = optList(lp.filters.outcome)?.filter((o): o is LoginOutcome => (LOGIN_OUTCOMES as readonly string[]).includes(o));
    historyParams = {
      userId: id,
      page: lp.page + 1,
      pageSize: lp.rowsPerPage,
      dir: 'desc',
      outcome: outcome?.length ? outcome : undefined,
      from: ISO.test(lp.filters.from) ? lp.filters.from : undefined,
      to: ISO.test(lp.filters.to) ? lp.filters.to : undefined,
    };
    const h = await listUserLoginHistory(historyParams);
    history = { rows: h.rows, total: h.total };
  }
  return <UserDetailView user={user} history={history} historyParams={historyParams} />;
}
