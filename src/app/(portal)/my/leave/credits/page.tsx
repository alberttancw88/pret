import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getMyBalances, listMyCredits } from '@/server/queries/leave';
import { CREDIT_STATUSES, type CreditListParams } from '@/server/contracts/leave';
import { MyCreditsList } from '@/components/leave/Credits';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import { CREDIT_SORTS, MY_CREDIT_FILTERS, yearOrUndef } from '@/components/leave/filters';
import { pickList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'My replacement credits' };
export const dynamic = 'force-dynamic';

// P9 · S-PT-09 · /my/leave/credits — own credits only.
export default async function MyCreditsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  if (!(await getMyBalances())) return <NoEmployeeRecord />;
  const currentYear = Number(todayMyt().slice(0, 4));
  const lp = readListParams(await searchParams, { filters: { ...MY_CREDIT_FILTERS, year: String(currentYear) }, sort: { key: 'dateWorked', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, CREDIT_SORTS);
  const exp = Number(f.expiringWithin);
  const params: CreditListParams = {
    ...pp,
    dir: pp.sort ? pp.dir : 'desc',
    year: yearOrUndef(f.year),
    statuses: pickList(f.statuses, CREDIT_STATUSES),
    expiringWithin: exp === 30 || exp === 60 || exp === 90 ? exp : undefined,
  };
  const list = await listMyCredits(params);
  return <MyCreditsList rows={list.rows} total={list.total} params={params} currentYear={currentYear} />;
}
