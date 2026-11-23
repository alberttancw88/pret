import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getMyHolidays } from '@/server/queries/portal';
import { HOLIDAY_TYPES, type MyHolidaysParams } from '@/server/contracts/portal';
import MyHolidays, { MY_HOLIDAY_FILTERS } from '@/components/portal/MyHolidays';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import { pickList } from '@/components/employees/filters';
import { readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Public holidays' };
export const dynamic = 'force-dynamic';

// P11 · S-PT-11 · /my/holidays — published holidays of MY state for a year (F-PRT-10).
export default async function MyHolidaysPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  if (user.isExternal) notFound();
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: MY_HOLIDAY_FILTERS, sort: { key: 'date', direction: 'asc' } });
  const view = spValue(sp, 'view') === 'calendar' ? 'calendar' : 'list';
  const y = Number(spValue(sp, 'year'));
  const base = toPageParams(lp, ['date', 'name'] as const);
  const params: MyHolidaysParams = {
    ...base,
    sort: base.sort ?? 'date',
    year: Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : undefined,
    types: pickList(lp.filters.types, HOLIDAY_TYPES),
  };
  const data = await getMyHolidays(params);
  if (!data.hasEmployeeRecord) return <NoEmployeeRecord />;
  return <MyHolidays data={data} params={params} view={view} />;
}
