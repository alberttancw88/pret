import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getBatch } from '@/server/queries/claims';
import { getLeaveSetupOptions } from '@/server/queries/leave';
import { BatchDetailView } from '@/components/claims/Batches';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Disbursement batch' };
export const dynamic = 'force-dynamic';

// C11 · S-CL-11 · /claims/batches/{no} — ADM / SA (SA approves when the setting is on; approver ≠ preparer).
export default async function BatchPage({ params }: { params: Promise<{ batchNo: string }> }) {
  await requireUser(['ADM', 'SA']);
  const batchNo = decodeURIComponent((await params).batchNo);
  const [batch, setup] = await Promise.all([getBatch(batchNo), getLeaveSetupOptions()]);
  if (!batch) notFound();
  return (
    <>
      <PageTitle title={batch.batchNo} breadcrumbs={[{ label: 'Claims', href: '/claims' }, { label: 'Disbursement batches', href: '/claims/batches' }, { label: batch.batchNo }]} />
      <BatchDetailView batch={batch} departments={setup.departments} />
    </>
  );
}
