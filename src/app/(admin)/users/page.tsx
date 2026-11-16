import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listUsers } from '@/server/queries/users';
import { USER_STATUSES, type UserListParams, type UserStatus } from '@/server/contracts/users';
import UsersList from '@/components/access/UsersList';
import { USER_FILTERS } from '@/components/access/filters';
import { optList, readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// A5 · S-AC-01 · /users — Super Admin (all) and Admin (employee users without privileged roles; server-scoped).
export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: USER_FILTERS, sort: { key: 'displayName', direction: 'asc' } });
  const f = lp.filters;
  const status = optList(f.status)?.filter((s): s is UserStatus => (USER_STATUSES as readonly string[]).includes(s));
  const params: UserListParams = {
    ...toPageParams(lp, ['displayName', 'loginEmail', 'userType', 'status', 'lastLogin', 'accessEnd'] as const),
    userType: f.userType === 'employee' || f.userType === 'external' ? f.userType : undefined,
    role: f.role === 'ADM' || f.role === 'SA' || f.role === 'none' ? f.role : undefined,
    status: status?.length ? status : undefined,
    lastLoginFrom: ISO.test(f.lastLoginFrom) ? f.lastLoginFrom : undefined,
    lastLoginTo: ISO.test(f.lastLoginTo) ? f.lastLoginTo : undefined,
    mfa: f.mfa === 'enrolled' || f.mfa === 'not_enrolled' ? f.mfa : undefined,
  };
  const list = await listUsers(params);
  return <UsersList rows={list.rows} total={list.total} params={params} isSuperAdmin={user.roles.includes('SA')} />;
}
