import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listBalances } from '@/server/queries/leave';
import BalancesList from '@/components/leave/BalancesList';
import { balanceListParams } from '@/app/_lib/leave-params';
import { leaveFilterOptions } from '@/app/_lib/leave-options';
import type { SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Team balances' };
export const dynamic = 'force-dynamic';

// L3 (team scope) · /team/balances — Manager: reportees only (balance summary; never the ledger, F-LV-28).
export default async function BalancesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['MGR']);
  const params = balanceListParams(await searchParams);
  const [data, options] = await Promise.all([listBalances(params), leaveFilterOptions(user)]);
  return <BalancesList data={data} params={params} options={options} scope="team" />;
}
