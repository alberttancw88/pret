import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getLeaveSetupOptions, listCredits } from '@/server/queries/leave';
import { CREDIT_STATUSES, type CreditListParams } from '@/server/contracts/leave';
import { CreditsAdminList } from '@/components/leave/Credits';
import { CREDIT_FILTERS, CREDIT_SORTS } from '@/components/leave/filters';
import { isoOrUndef, pickList, uuidList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Replacement credits' };
export const dynamic = 'force-dynamic';

// L7 · S-LV-07 · /leave/credits — Admin and Super Admin (all employees) + BATCH APPLY.
export default async function CreditsAdminPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: CREDIT_FILTERS, sort: { key: 'dateWorked', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, CREDIT_SORTS);
  const exp = Number(f.expiringWithin);
  const params: CreditListParams = {
    ...pp,
    dir: pp.sort ? pp.dir : 'desc',
    statuses: pickList(f.statuses, CREDIT_STATUSES),
    from: isoOrUndef(f.from),
    to: isoOrUndef(f.to),
    departmentIds: uuidList(f.departmentIds),
    expiringWithin: exp === 30 || exp === 60 || exp === 90 ? exp : undefined,
  };
  const [list, opts] = await Promise.all([listCredits(params), getLeaveSetupOptions()]);
  return <CreditsAdminList rows={list.rows} total={list.total} params={params} departments={opts.departments} />;
}
