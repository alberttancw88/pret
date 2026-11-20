import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getCredit } from '@/server/queries/leave';
import { CreditView } from '@/components/leave/Credits';
import PageTitle from '@/components/shell/PageTitle';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Replacement-credit decision' };
export const dynamic = 'force-dynamic';

// P28 · S-AP-03 · /approvals/credits/{no} — MGR (team / routed), ADM, SA; ADM: COMPENSATE BY PAY.
export default async function CreditDecisionPage({ params, searchParams }: { params: Promise<{ creditNo: string }>; searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['MGR', 'ADM', 'SA']);
  const { creditNo } = await params;
  const from = spValue(await searchParams, 'from');
  const c = await getCredit(decodeURIComponent(creditNo));
  if (!c) notFound();
  const admin = user.roles.includes('ADM') || user.roles.includes('SA');
  const back = from === 'credits' && admin ? { label: 'Replacement credits', href: '/leave/credits' } : { label: 'Approvals', href: '/approvals?tab=credits' };
  return (
    <>
      <PageTitle title={c.creditNo} breadcrumbs={[back, { label: c.creditNo }]} />
      <CreditView c={c} mode="approver" backHref={back.href} />
    </>
  );
}
