import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getApplyLeaveForm } from '@/server/queries/leave';
import { RequestCreditForm } from '@/components/leave/Credits';
import { MyLeaveTabs } from '@/components/leave/MyLeave';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Request replacement credit' };
export const dynamic = 'force-dynamic';

// P8 · S-PT-08 · /my/leave/credits/new — own request.
export default async function RequestCreditPage() {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const form = await getApplyLeaveForm();
  if (!form) return <NoEmployeeRecord />;
  const rl = [...form.types, ...form.ineligible.map((i) => i.type)].find((t) => t.category === 'replacement');
  return (
    <>
      <PageTitle title="Request replacement credit" breadcrumbs={[{ label: 'Replacement credits', href: '/my/leave/credits' }, { label: 'Request credit' }]} />
      <MyLeaveTabs />
      <RequestCreditForm rlTypeId={rl?.id ?? null} />
    </>
  );
}
