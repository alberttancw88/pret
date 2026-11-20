import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listBalances } from '@/server/queries/leave';
import BalancesList from '@/components/leave/BalancesList';
import { balanceListParams } from '@/app/_lib/leave-params';
import { leaveFilterOptions } from '@/app/_lib/leave-options';
import type { SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Leave balances' };
export const dynamic = 'force-dynamic';

// L3 · S-LV-03 · /leave/balances — Admin and Super Admin (everyone).
export default async function BalancesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const params = balanceListParams(await searchParams);
  const [data, options] = await Promise.all([listBalances(params), leaveFilterOptions(user)]);
  return <BalancesList data={data} params={params} options={options} scope="all" />;
}
