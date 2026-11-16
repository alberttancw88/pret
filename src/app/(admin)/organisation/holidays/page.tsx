import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getCopyToNextYearPreview, getHoliday, getHolidayYearSummary, listHolidayYears, listHolidays } from '@/server/queries/org';
import { HOLIDAY_TYPES, MY_STATES, type HolidayListParams, type HolidayType, type MyState } from '@/server/contracts/org';
import HolidaysScreen from '@/components/org/HolidaysScreen';
import { HOLIDAY_FILTERS, isUuid } from '@/components/org/filters';
import { optList, readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'Public holidays' };
export const dynamic = 'force-dynamic';

// O7 · S-OR-07 · /organisation/holidays — Admin and Super Admin (F-ORG-07–10).
export default async function HolidaysPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: HOLIDAY_FILTERS, sort: { key: 'date', direction: 'asc' } });
  const y = Number(lp.filters.year);
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : Number(todayMyt().slice(0, 4));
  const view = lp.filters.view === 'calendar' ? 'calendar' : 'list';
  const states = optList(lp.filters.states)?.filter((s): s is MyState => (MY_STATES as readonly string[]).includes(s));
  const types = optList(lp.filters.types)?.filter((t): t is HolidayType => (HOLIDAY_TYPES as readonly string[]).includes(t));
  const base = toPageParams(lp, ['date', 'name'] as const);
  const params: HolidayListParams = {
    ...base,
    // Calendar view shows the whole year on one page.
    ...(view === 'calendar' ? { page: 1, pageSize: 500 } : {}),
    year,
    states: states?.length ? states : undefined,
    types: types?.length ? types : undefined,
    observed: lp.filters.observed === 'yes' || lp.filters.observed === 'no' ? lp.filters.observed : 'all',
    includeInactive: true,
  };
  const editId = spValue(sp, 'edit');
  const wantCopy = spValue(sp, 'copy') === '1';
  const [years, summary, list, detail, copyPreview] = await Promise.all([
    listHolidayYears(),
    getHolidayYearSummary(year),
    listHolidays(params),
    isUuid(editId) ? getHoliday(editId) : Promise.resolve(null),
    wantCopy ? getCopyToNextYearPreview(year) : Promise.resolve(null),
  ]);
  return (
    <HolidaysScreen
      year={year}
      years={years}
      summary={summary}
      rows={list.rows}
      total={list.total}
      params={params}
      view={view}
      detail={detail}
      copyPreview={copyPreview}
    />
  );
}
