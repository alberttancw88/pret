import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getLeaveSetupOptions, getYearEnd } from '@/server/queries/leave';
import YearEnd from '@/components/leave/YearEnd';
import { yearOrUndef } from '@/components/leave/filters';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'Year-end roll-over' };
export const dynamic = 'force-dynamic';

// L13 · S-LV-13 · /leave/year-end?year= — Admin and Super Admin. Default closing year: the current year in
// December, the previous year in January (window 01/12 – 31/01), otherwise the current year.
export default async function YearEndPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const today = todayMyt();
  const currentYear = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const closingYear = yearOrUndef(spValue(await searchParams, 'year') ?? '') ?? (month === 1 ? currentYear - 1 : currentYear);
  const [status, options] = await Promise.all([getYearEnd(closingYear), getLeaveSetupOptions()]);
  return <YearEnd key={closingYear} status={status} departments={options.departments} currentYear={currentYear} />;
}
