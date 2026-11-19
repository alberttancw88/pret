import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listInvitableEmployees } from '@/server/queries/users';
import InviteUserForm from '@/components/access/InviteUserForm';
import PageTitle from '@/components/shell/PageTitle';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Invite user' };
export const dynamic = 'force-dynamic';

// A6 · S-AC-02 · /users/new — Super Admin (employee user or external administrator);
// Admin (employee user only, W2-003). Server Action re-checks the role per user type.
export default async function InviteUserPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const invitable = await listInvitableEmployees();
  const isSuperAdmin = user.roles.includes('SA');
  const initialType = !isSuperAdmin || spValue(sp, 'type') !== 'external' ? 'employee' : 'external';
  return (
    <>
      <PageTitle title="Invite user" breadcrumbs={[{ label: 'Users & access' }, { label: 'Users', href: '/users' }]} />
      <InviteUserForm isSuperAdmin={isSuperAdmin} invitable={invitable} initialType={initialType} />
    </>
  );
}
