import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getApplyLeaveForm } from '@/server/queries/leave';
import ApplyLeaveForm from '@/components/leave/ApplyLeaveForm';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import PageTitle from '@/components/shell/PageTitle';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Apply leave' };
export const dynamic = 'force-dynamic';

// P2 · S-PT-02 · /my/leave/apply — own application (any employee user). ?type=AL preselects a type.
export default async function ApplyLeavePage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const sp = await searchParams;
  const form = await getApplyLeaveForm();
  if (!form) return <NoEmployeeRecord />;
  return (
    <>
      <PageTitle title="Apply leave" breadcrumbs={[{ label: 'My leave', href: '/my/leave' }, { label: 'Apply leave' }]} />
      <ApplyLeaveForm form={form} mode="own" initialTypeCode={spValue(sp, 'type') ?? null} />
    </>
  );
}
