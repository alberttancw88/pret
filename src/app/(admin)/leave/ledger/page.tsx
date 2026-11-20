import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getLedger } from '@/server/queries/leave';
import { LEDGER_TRANSACTIONS, type LedgerParams } from '@/server/contracts/leave';
import { LedgerView } from '@/components/leave/Balances';
import { LEDGER_FILTERS, yearOrUndef } from '@/components/leave/filters';
import { isoOrUndef, pickList, uuidOrUndef } from '@/components/employees/filters';
import PageTitle from '@/components/shell/PageTitle';
import { readListParams, spValue, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'Balance ledger' };
export const dynamic = 'force-dynamic';

// P6 (HR entry from L3 / E3) · /leave/ledger?employee={id}&type={leaveTypeId}&year= — Admin and Super Admin.
// Managers never see the ledger (F-LV-28): the page guard excludes MGR and getLedger refuses.
export default async function EmployeeLedgerPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const employeeId = uuidOrUndef(spValue(sp, 'employee') ?? '');
  const leaveTypeId = uuidOrUndef(spValue(sp, 'type') ?? '');
  if (!employeeId || !leaveTypeId) notFound();
  const currentYear = Number(todayMyt().slice(0, 4));
  const lp = readListParams(sp, { filters: { ...LEDGER_FILTERS, year: String(currentYear) }, rowsPerPage: 50, sort: { key: 'date', direction: 'asc' } });
  const year = yearOrUndef(lp.filters.year) ?? currentYear;
  const p: LedgerParams = {
    employeeId,
    leaveTypeId,
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
  const years = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
  return (
    <>
      <PageTitle
        title={`${page.employee.name} · ${page.leaveType.name} ledger`}
        breadcrumbs={[{ label: 'Leave balances', href: '/leave/balances' }, { label: page.employee.employeeNo ?? page.employee.name }, { label: page.leaveType.name }]}
      />
      <LedgerView page={page} params={p} years={years} selfView={false} />
    </>
  );
}
