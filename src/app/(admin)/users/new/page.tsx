import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listInvitableEmployees } from '@/server/queries/users';
import InviteUserForm from '@/components/access/InviteUserForm';
import PageTitle from '@/components/shell/PageTitle';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Invite user' };
export const dynamic = 'force-dynamic';

// A6 · S-AC-02 · /users/new — Super Admin (external administrator; employee user after W2-003);
// Admin (employee user only, after W2-003). Server Action re-checks the role per user type.
export default async function InviteUserPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const invitable = await listInvitableEmployees();
  const isSuperAdmin = user.roles.includes('SA');
  const initialType = spValue(sp, 'type') === 'employee' && invitable.available ? 'employee' : isSuperAdmin ? 'external' : 'employee';
  return (
    <>
      <PageTitle title="Invite user" breadcrumbs={[{ label: 'Users & access' }, { label: 'Users', href: '/users' }]} />
      <InviteUserForm isSuperAdmin={isSuperAdmin} invitable={invitable} initialType={initialType} />
    </>
  );
}
