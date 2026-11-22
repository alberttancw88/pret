import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getBatchDefaults } from '@/server/queries/claims';
import { getLeaveSetupOptions } from '@/server/queries/leave';
import { NewBatchWizard } from '@/components/claims/Batches';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'New month-end batch' };
export const dynamic = 'force-dynamic';

// C10 · S-CL-10 · /claims/batches/new — ADM / SA.
export default async function NewBatchPage() {
  await requireUser(['ADM', 'SA']);
  const [defaults, setup] = await Promise.all([getBatchDefaults(), getLeaveSetupOptions()]);
  return (
    <>
      <PageTitle title="New month-end batch" breadcrumbs={[{ label: 'Disbursement batches', href: '/claims/batches' }, { label: 'New' }]} />
      <NewBatchWizard defaults={defaults} departments={setup.departments} />
    </>
  );
}
