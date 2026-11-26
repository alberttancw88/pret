import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getPayrollInputPack } from '@/server/queries/reports';
import { PAYROLL_INPUT_SHEETS, type PayrollInputSheet } from '@/server/contracts/reports';
import PayrollInputPack from '@/components/reports/PayrollInputPack';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'Monthly payroll-input pack' };
export const dynamic = 'force-dynamic';

// R5 · S-RP-23 · /reports/payroll-input — ADM / SA only (sensitive: the server logs the view and every export).
export default async function PayrollInputPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const m = spValue(sp, 'month');
  const s = spValue(sp, 'sheet');
  const month = m && /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : undefined;
  const sheet = s && (PAYROLL_INPUT_SHEETS as readonly string[]).includes(s) ? (s as PayrollInputSheet) : undefined;
  const pack = await getPayrollInputPack({ month, sheet });
  return <PayrollInputPack pack={pack} today={todayMyt()} />;
}
