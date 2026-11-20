import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getCredit } from '@/server/queries/leave';
import { CreditView } from '@/components/leave/Credits';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Replacement credit' };
export const dynamic = 'force-dynamic';

// P9 detail · /my/leave/credits/{no} — own credit: RC fields, approval trail, consumption ("Used by LV-…").
export default async function MyCreditPage({ params }: { params: Promise<{ creditNo: string }> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const { creditNo } = await params;
  const c = await getCredit(decodeURIComponent(creditNo));
  if (!c || !c.isOwn) notFound();
  return (
    <>
      <PageTitle title={c.creditNo} breadcrumbs={[{ label: 'Replacement credits', href: '/my/leave/credits' }, { label: c.creditNo }]} />
      <CreditView c={c} mode="own" backHref="/my/leave/credits" />
    </>
  );
}
