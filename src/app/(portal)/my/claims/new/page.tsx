import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getClaimForm } from '@/server/queries/claims';
import ClaimForm from '@/components/claims/ClaimForm';
import PageTitle from '@/components/shell/PageTitle';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';

export const metadata: Metadata = { title: 'New claim' };
export const dynamic = 'force-dynamic';

// P13 · S-PT-13 · /my/claims/new — own claim (status New after the first SAVE).
export default async function NewClaimPage() {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const form = await getClaimForm();
  if (!form) return <NoEmployeeRecord />;
  return (
    <>
      <PageTitle title="New claim" breadcrumbs={[{ label: 'My claims', href: '/my/claims' }, { label: 'New claim' }]} />
      <ClaimForm form={form} />
    </>
  );
}
