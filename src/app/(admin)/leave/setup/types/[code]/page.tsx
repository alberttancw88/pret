import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getLeaveSetupOptions, getLeaveType } from '@/server/queries/leave';
import { LeaveTypeForm } from '@/components/leave/LeaveTypes';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Leave type' };
export const dynamic = 'force-dynamic';

// L9 · S-LV-09 · /leave/setup/types/{code} (and /new) — Admin and Super Admin; SA may save below the
// Employment Act minimum with a logged reason (BR-LV-02).
export default async function LeaveTypePage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser(['ADM', 'SA']);
  const { code } = await params;
  const isNew = code === 'new';
  const [detail, options] = await Promise.all([isNew ? Promise.resolve(null) : getLeaveType(decodeURIComponent(code)), getLeaveSetupOptions()]);
  if (!isNew && !detail) notFound();
  const title = detail ? `${detail.values.name} (${detail.values.code})` : 'New leave type';
  return (
    <>
      <PageTitle title={title} breadcrumbs={[{ label: 'Leave types', href: '/leave/setup/types' }, { label: detail?.values.code ?? 'New' }]} />
      <LeaveTypeForm key={detail?.id ?? 'new'} detail={detail} options={options} isSuperAdmin={user.roles.includes('SA')} />
    </>
  );
}
