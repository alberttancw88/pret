import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import EmployeeHome from '@/components/dashboard/EmployeeHome';
import { roleChipLabel } from '@/components/shell/nav';
import { homePlaceholder } from './placeholder';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

// S-PT-01 · /home — any signed-in employee user (manager panel for MGR).
export default async function HomePage() {
  const user = await requireUser();
  return (
    <EmployeeHome
      displayName={user.displayName}
      roleLabel={roleChipLabel(user)}
      data={homePlaceholder(user.roles.includes('MGR'))}
      placeholder
    />
  );
}
