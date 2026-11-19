import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getMyProfile } from '@/server/queries/employees';
import MyProfileView, { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';

export const metadata: Metadata = { title: 'My profile' };
export const dynamic = 'force-dynamic';

// P16 · S-PT-16 · /my/profile — any signed-in user with an employee record (own data only;
// External administrators have none). null = no employee record yet (e.g. the first Super Admin).
export default async function MyProfilePage() {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const me = await getMyProfile();
  if (!me) return <NoEmployeeRecord />;
  return <MyProfileView me={me} />;
}
