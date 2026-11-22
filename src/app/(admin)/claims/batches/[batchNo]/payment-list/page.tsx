import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getPaymentListReport } from '@/server/queries/claims';
import { PaymentListView } from '@/components/claims/Batches';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'HLB payment list' };
export const dynamic = 'force-dynamic';

// C12 · S-CL-12 · /claims/batches/{no}/payment-list — ADM / SA. D31: full account numbers on screen; every view is
// access-logged by the query (app.payment_list_view); .xlsx / PDF downloads via getExportFileUrl (logged).
export default async function PaymentListPage({ params }: { params: Promise<{ batchNo: string }> }) {
  await requireUser(['ADM', 'SA']);
  const batchNo = decodeURIComponent((await params).batchNo);
  const report = await getPaymentListReport(batchNo);
  if (!report) notFound();
  return (
    <>
      <PageTitle title={`HLB payment list · ${batchNo}`} breadcrumbs={[{ label: 'Disbursement batches', href: '/claims/batches' }, { label: batchNo, href: `/claims/batches/${encodeURIComponent(batchNo)}` }, { label: 'Payment list' }]} />
      <PaymentListView report={report} batchNo={batchNo} />
    </>
  );
}
