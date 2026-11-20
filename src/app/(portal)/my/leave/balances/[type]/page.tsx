import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getLedger, getMyBalances } from '@/server/queries/leave';
import { LEDGER_TRANSACTIONS, type LedgerParams } from '@/server/contracts/leave';
import { LedgerView } from '@/components/leave/Balances';
import { LEDGER_FILTERS, yearOrUndef } from '@/components/leave/filters';
import { isoOrUndef, pickList } from '@/components/employees/filters';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import PageTitle from '@/components/shell/PageTitle';
import { readListParams, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'Balance ledger' };
export const dynamic = 'force-dynamic';

// P6 · S-PT-06 · /my/leave/balances/{type code}?year= — own ledger only.
export default async function MyLedgerPage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const { type } = await params;
  const currentYear = Number(todayMyt().slice(0, 4));
  const lp = readListParams(await searchParams, { filters: { ...LEDGER_FILTERS, year: String(currentYear) }, rowsPerPage: 50, sort: { key: 'date', direction: 'asc' } });
  const year = yearOrUndef(lp.filters.year) ?? currentYear;
  const balances = await getMyBalances(year);
  if (!balances) return <NoEmployeeRecord />;
  const card = balances.cards.find((c) => c.leaveType.code === decodeURIComponent(type).toUpperCase());
  if (!card) notFound();
  const p: LedgerParams = {
    leaveTypeId: card.leaveType.id,
    year,
    q: lp.filters.q || undefined,
    transactions: pickList(lp.filters.transactions, LEDGER_TRANSACTIONS),
    from: isoOrUndef(lp.filters.from),
    to: isoOrUndef(lp.filters.to),
    dir: lp.sort?.direction ?? 'asc',
    page: lp.page + 1,
    pageSize: lp.rowsPerPage,
  };
  const page = await getLedger(p);
  if (!page) notFound();
  return (
    <>
      <PageTitle title={`${page.leaveType.name} ledger`} breadcrumbs={[{ label: 'My balances', href: `/my/leave/balances?year=${year}` }, { label: page.leaveType.name }]} />
      <LedgerView page={page} params={p} years={balances.years} selfView />
    </>
  );
}
