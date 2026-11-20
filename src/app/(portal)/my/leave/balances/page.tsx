import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getMyBalances } from '@/server/queries/leave';
import { MyBalancesView } from '@/components/leave/Balances';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import { yearOrUndef } from '@/components/leave/filters';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'My balances' };
export const dynamic = 'force-dynamic';

// P5 · S-PT-05 · /my/leave/balances?year= — own balances (ledger-derived, ADR-0005).
export default async function MyBalancesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const data = await getMyBalances(yearOrUndef(spValue(await searchParams, 'year') ?? ''));
  if (!data) return <NoEmployeeRecord />;
  return <MyBalancesView data={data} />;
}
